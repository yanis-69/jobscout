import { NextRequest, NextResponse } from "next/server";
import { getSetting, setSetting } from "@/lib/db";
import {
  LLM_SETTING_KEYS,
  anthropicBaseUrl,
  getLlmConfig,
  getLlmState,
  packAvailable,
  providerBaseUrl,
  providerBaseUrlSetting,
  providerKeySetting,
  providerModels,
  providerModelsSetting,
  proxyBaseUrl,
  resetClaude,
  type LlmConfig,
} from "@/lib/ai/client";
import { listModelDetails, listModels } from "@/lib/ai/llm";
import { translateAiError } from "@/lib/ai/errors";
import {
  PROVIDERS,
  PROVIDER_IDS,
  isProviderId,
  missingModels,
  noLocalModelMessage,
  normalizeBaseURLInput,
  validateBaseURL,
  type ProviderId,
} from "@/lib/ai/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Configuration de la génération IA.
 *
 * GET  : état courant (mode, fournisseur, configuré, hints masqués) + quota du
 *        pack si joignable (timeout 4 s, échec totalement silencieux).
 * POST : { action: "save" | "verify" | "models" | "reset" } — les clés ne sont
 *        JAMAIS renvoyées en clair (hint = 4 derniers symboles).
 *
 * Clé personnelle : n'importe quel fournisseur du catalogue (lib/ai/providers.ts).
 * Champs : provider, key (ou byok_key, ancien nom), base_url, model_writer, model_reviewer.
 */

type Quota = {
  status: string | null;
  plan: string | null;
  points_remaining: number | null;
  dossiers_estimes: number | null;
  rate_limit: { limit: number; used_1h: number } | null;
};

const QUOTA_TIMEOUT_MS = 4000;

function parseQuota(data: unknown): Quota {
  const d = (data ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const rl = (d.rate_limit ?? null) as { limit?: unknown; used_1h?: unknown } | null;
  return {
    status: str(d.status),
    plan: str(d.plan),
    points_remaining: num(d.points_remaining),
    dossiers_estimes: num(d.dossiers_estimes),
    rate_limit:
      rl && typeof rl.limit === "number" && typeof rl.used_1h === "number"
        ? { limit: rl.limit, used_1h: rl.used_1h }
        : null,
  };
}

/** GET /v1/quota du proxy. Renvoie { ok, status, quota } — jamais d'exception. */
async function fetchQuota(
  licenseKey: string,
  { timeoutMs = QUOTA_TIMEOUT_MS }: { timeoutMs?: number } = {}
): Promise<{ ok: boolean; status: number; quota: Quota | null; code: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${proxyBaseUrl()}/v1/quota`, {
      signal: controller.signal,
      cache: "no-store",
      headers: { "x-api-key": licenseKey, accept: "application/json" },
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
      return { ok: false, status: res.status, quota: null, code: typeof code === "string" ? code : null };
    }
    return { ok: true, status: res.status, quota: parseQuota(body), code: null };
  } catch {
    // Hors-ligne, proxy pas encore déployé, DNS absent : silence total.
    return { ok: false, status: 0, quota: null, code: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const state = getLlmState();
  let quota: Quota | null = null;
  // Quota UNIQUEMENT si le mode pack est configuré : le mode non configuré ne
  // doit produire AUCUN appel réseau (recette d'installation).
  if (state.mode === "pack" && state.configured) {
    const cfg = getLlmConfig();
    if (cfg.apiKey) {
      const res = await fetchQuota(cfg.apiKey);
      quota = res.ok ? res.quota : null;
    }
  }
  return NextResponse.json({ ...state, quota });
}

const clean = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
};

async function verifyPack(licenseKey: string): Promise<NextResponse> {
  const res = await fetchQuota(licenseKey, { timeoutMs: 6000 });
  if (res.ok) {
    return NextResponse.json({ ok: true, mode: "pack", quota: res.quota });
  }
  if (res.status === 0) {
    return NextResponse.json(
      { error: "Impossible de joindre le serveur JobScout — vérifiez votre connexion internet puis réessayez." },
      { status: 502 }
    );
  }
  const messages: Record<string, string> = {
    LICENSE_INVALID: "Clé de licence invalide ou inconnue — vérifiez la saisie.",
    LICENSE_SUSPENDED: "Licence refusée par le relais — passez sur votre clé API.",
    QUOTA_EXHAUSTED: "Licence valide mais crédits du relais épuisés — passez sur votre clé API.",
    RATE_LIMITED: "Trop de requêtes — patientez quelques minutes puis réessayez.",
  };
  const fallback =
    res.status === 401
      ? messages.LICENSE_INVALID
      : `Vérification impossible (HTTP ${res.status}) — réessayez plus tard.`;
  return NextResponse.json(
    { error: (res.code && messages[res.code]) || fallback },
    { status: res.status >= 400 ? res.status : 502 }
  );
}

type ByokDraft = { ok: true; cfg: LlmConfig } | { ok: false; error: string };

/**
 * Configuration clé personnelle construite à partir du formulaire, complétée
 * par ce qui est déjà enregistré (champ clé laissé vide = clé enregistrée).
 */
function byokDraft(body: Record<string, unknown>, requireWriter = true): ByokDraft {
  const providerRaw = clean(body.provider) ?? "anthropic";
  if (!isProviderId(providerRaw)) return { ok: false, error: "Fournisseur d'IA inconnu." };
  const provider: ProviderId = providerRaw;
  const preset = PROVIDERS[provider];

  const apiKey = clean(body.key) ?? clean(body.byok_key) ?? clean(getSetting(providerKeySetting(provider)));
  if (preset.keyRequired && !apiKey) return { ok: false, error: `Saisissez votre clé API ${preset.label}.` };
  // Espace insécable, caractère invisible ou apostrophe typographique collés avec la clé :
  // l'en-tête serait refusé avant tout envoi, et l'erreur passait pour une panne réseau.
  if (apiKey && /[^\x21-\x7E]/.test(apiKey)) {
    return { ok: false, error: "La clé contient un espace ou un caractère invisible — copiez-la de nouveau depuis la console du fournisseur, sans rien autour." };
  }

  let baseURL = provider === "anthropic" ? anthropicBaseUrl() : providerBaseUrl(provider);
  if (preset.editableBaseURL) {
    const v = validateBaseURL(normalizeBaseURLInput(clean(body.base_url) ?? baseURL, provider));
    if (!v.ok) return { ok: false, error: v.error };
    baseURL = v.url;
  }

  const stored = providerModels(provider);
  const writer = clean(body.model_writer) ?? stored.writer;
  const reviewer = clean(body.model_reviewer) ?? (clean(body.model_writer) ? writer : stored.reviewer) ?? writer;
  // « Charger la liste » doit marcher avant tout choix de modèle (LM Studio : champs vides par défaut).
  if (!writer && requireWriter) return { ok: false, error: "Indiquez le modèle de rédaction (bouton « Charger la liste » pour voir les modèles disponibles)." };

  return {
    ok: true,
    cfg: {
      mode: "byok",
      provider,
      kind: preset.kind,
      apiKey,
      baseURL,
      models: { writer: writer ?? "", reviewer: reviewer || writer || "" },
      source: "settings",
    },
  };
}

function aiErrorResponse(e: unknown, fallback: string): NextResponse {
  const t = translateAiError(e);
  if (t) return NextResponse.json({ error: t.message }, { status: t.status >= 400 ? t.status : 502 });
  console.error("[settings/llm]", e);
  return NextResponse.json({ error: fallback }, { status: 502 });
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") {
    return NextResponse.json({ error: "Requête invalide." }, { status: 400 });
  }
  const action = body.action;
  const mode = clean(body.mode);
  const licenseKey = clean(body.license_key) ?? clean(getSetting(LLM_SETTING_KEYS.licenseKey));

  if (action === "reset") {
    setSetting(LLM_SETTING_KEYS.mode, "");
    setSetting(LLM_SETTING_KEYS.licenseKey, "");
    for (const id of PROVIDER_IDS) setSetting(providerKeySetting(id), "");
    resetClaude(); // best-effort — l'empreinte relue à chaque appel fait le vrai travail
    return NextResponse.json({ ok: true, ...getLlmState(), quota: null });
  }

  if (mode !== "pack" && mode !== "byok") {
    return NextResponse.json({ error: "Choisissez un mode : relais ou clé API." }, { status: 400 });
  }
  // Sans proxy configuré, le mode Pack n'existe pas : aucune clé de licence ne
  // doit partir vers un hôte que personne ne contrôle.
  if (mode === "pack" && !packAvailable()) {
    return NextResponse.json(
      { error: "Aucun relais n'est configuré dans cette version — utilisez votre propre clé API." },
      { status: 400 }
    );
  }

  if (mode === "pack") {
    if (!licenseKey)
      return NextResponse.json({ error: "Saisissez votre clé de licence JobScout." }, { status: 400 });
    if (action === "verify") return verifyPack(licenseKey);
    if (action === "save") {
      setSetting(LLM_SETTING_KEYS.mode, "pack");
      setSetting(LLM_SETTING_KEYS.licenseKey, licenseKey);
      resetClaude();
      return NextResponse.json({ ok: true, ...getLlmState(), quota: null });
    }
    return NextResponse.json({ error: "Action inconnue." }, { status: 400 });
  }

  const draft = byokDraft(body, action !== "models");
  if (!draft.ok) return NextResponse.json({ error: draft.error }, { status: 400 });
  const { cfg } = draft;
  const label = PROVIDERS[cfg.provider].label;

  if (action === "models") {
    try {
      const details = await listModelDetails(cfg);
      return NextResponse.json({ ok: true, models: details.map((m) => m.id), details });
    } catch (e) {
      return aiErrorResponse(e, `Vérification impossible auprès de ${label} — réessayez plus tard.`);
    }
  }

  if (action === "verify") {
    let models: string[];
    try {
      models = await listModels(cfg);
    } catch (e) {
      return aiErrorResponse(e, `Vérification impossible auprès de ${label} — réessayez plus tard.`);
    }
    // Serveur local joint mais sans modèle : avant la 3.4.14, « Vérifier » affichait
    // « Connexion réussie ✓ » et l'échec n'apparaissait qu'à l'import du CV.
    if (PROVIDERS[cfg.provider].local && models.length === 0) {
      return NextResponse.json({ error: noLocalModelMessage(cfg.provider, cfg.models.writer, cfg.models.reviewer) }, { status: 422 });
    }
    // Un serveur distant peut renvoyer une liste vide : on ne conclut alors rien sur les modèles.
    const missing = models.length ? missingModels(models, [cfg.models.writer, cfg.models.reviewer]) : [];
    return NextResponse.json({ ok: true, mode: "byok", provider: cfg.provider, models, missing });
  }

  if (action === "save") {
    setSetting(LLM_SETTING_KEYS.mode, "byok");
    setSetting(LLM_SETTING_KEYS.provider, cfg.provider);
    if (cfg.apiKey) setSetting(providerKeySetting(cfg.provider), cfg.apiKey);
    if (PROVIDERS[cfg.provider].editableBaseURL) setSetting(providerBaseUrlSetting(cfg.provider), cfg.baseURL);
    setSetting(providerModelsSetting(cfg.provider), JSON.stringify(cfg.models));
    resetClaude(); // best-effort — l'empreinte relue à chaque appel fait le vrai travail
    return NextResponse.json({ ok: true, ...getLlmState(), quota: null });
  }

  return NextResponse.json({ error: "Action inconnue." }, { status: 400 });
}
