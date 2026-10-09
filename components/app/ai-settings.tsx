"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, ExternalLink, KeyRound, ListRestart, RotateCcw, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { PROVIDERS, PROVIDER_IDS, noLocalModelMessage, type ProviderId } from "@/lib/ai/providers";
import { GEMINI_PRICING_DATE, GEMINI_PRICING_URL, RATE_LIMITS_URL, dossierCost, formatUsd, knownPrice, type ModelInfo } from "@/lib/ai/model-catalog";
import { ModelMeta, ModelPicker } from "@/components/app/model-picker";

type Quota = {
  points_remaining: number | null;
  dossiers_estimes: number | null;
  plan: string | null;
};

type ProviderState = {
  keyHint: string | null;
  baseURL: string;
  models: { writer: string; reviewer: string };
};

type LlmStatus = {
  mode: "pack" | "byok" | "unset";
  configured: boolean;
  source: "settings" | "env" | null;
  licenseHint: string | null;
  byokHint: string | null;
  /** Mode « Pack » proposé seulement si un relais est configuré (JOBSCOUT_PROXY_URL). */
  packAvailable: boolean;
  provider: ProviderId;
  providers: Record<ProviderId, ProviderState>;
  quota: Quota | null;
};

const selectClass =
  "h-10 w-full rounded-md bg-surface border border-border px-3 text-body text-text transition-all duration-150 focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/15 disabled:opacity-40";

/**
 * Carte de configuration de la génération IA (patron settings-folder).
 * Montée dans l'onboarding (avant l'uploader, qu'elle débloque) et dans la
 * pile de cartes du Profil. Les clés ne transitent JAMAIS en clair depuis le
 * serveur : seuls des hints masqués (…XXXX) sont affichés.
 *
 * Clé personnelle : n'importe quel fournisseur (Anthropic, OpenAI, Gemini,
 * Mistral, DeepSeek, Groq, OpenRouter, Ollama, LM Studio, compatible OpenAI).
 */
export function AiSettings({
  onStatusChange,
}: {
  onStatusChange?: (status: { configured: boolean }) => void;
}) {
  const [status, setStatus] = useState<LlmStatus | null>(null);
  const [mode, setMode] = useState<"pack" | "byok">("byok");
  const [provider, setProvider] = useState<ProviderId>("anthropic");
  const [licenseKey, setLicenseKey] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [baseURL, setBaseURL] = useState("");
  const [writer, setWriter] = useState("");
  const [reviewer, setReviewer] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState<null | "save" | "verify" | "models" | "reset">(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const preset = PROVIDERS[provider];

  /** Remplit le formulaire avec les réglages enregistrés du fournisseur (ou ses valeurs par défaut). */
  const loadProvider = useCallback((p: ProviderId, s: LlmStatus | null) => {
    const saved = s?.providers?.[p];
    setBaseURL(saved?.baseURL ?? PROVIDERS[p].baseURL);
    setWriter(saved?.models.writer ?? PROVIDERS[p].models.writer);
    setReviewer(saved?.models.reviewer ?? PROVIDERS[p].models.reviewer);
    setApiKey("");
    setModels([]);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/llm", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json().catch(() => null)) as LlmStatus | null;
      if (!data) return;
      setStatus(data);
      if (data.mode === "byok" || (data.mode === "pack" && data.packAvailable)) setMode(data.mode);
      const p = data.provider && PROVIDERS[data.provider] ? data.provider : "anthropic";
      setProvider(p);
      loadProvider(p, data);
      onStatusChange?.({ configured: !!data.configured });
    } catch {
      // hors-ligne : la carte reste utilisable, le gate reste fermé
    }
  }, [onStatusChange, loadProvider]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function call(action: "save" | "verify" | "models" | "reset") {
    setLoading(action);
    setError(null);
    setInfo(null);
    try {
      const res = await fetch("/api/settings/llm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          mode,
          provider,
          license_key: licenseKey.trim() || undefined,
          key: apiKey.trim() || undefined,
          base_url: preset.editableBaseURL ? baseURL.trim() || undefined : undefined,
          model_writer: writer.trim() || undefined,
          model_reviewer: reviewer.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        setError((data && typeof data.error === "string" && data.error) || `Erreur serveur (HTTP ${res.status}).`);
        return;
      }
      if (action === "models") {
        const list = Array.isArray(data?.details)
          ? (data.details as ModelInfo[])
          : Array.isArray(data?.models)
            ? (data.models as string[]).map((id) => ({ id, textCapable: true }))
            : [];
        setModels(list);
        if (!list.length && preset.local) setError(noLocalModelMessage(provider, writer, reviewer));
        else setInfo(list.length ? `${list.length} modèle(s) disponible(s) chez ${preset.label}.` : `${preset.label} n'a renvoyé aucun modèle — saisissez son nom à la main.`);
        return;
      }
      if (action === "verify") {
        if (mode === "pack") {
          const quota = (data?.quota ?? null) as Quota | null;
          setInfo(`Licence valide ✓${quota?.dossiers_estimes != null ? ` — ≈ ${quota.dossiers_estimes} dossiers restants` : ""}`);
          return;
        }
        const list = Array.isArray(data?.models) ? (data.models as string[]) : [];
        // « Vérifier » ne renvoie que les noms : on garde les détails déjà chargés.
        if (list.length) setModels((prev) => list.map((id) => prev.find((m) => m.id === id) ?? { id, textCapable: true }));
        const missing = Array.isArray(data?.missing) ? (data.missing as string[]) : [];
        if (missing.length) {
          setError(`Connexion à ${preset.label} réussie, mais modèle introuvable : ${missing.join(", ")} — choisissez-en un dans la liste.`);
        } else {
          setInfo(`Connexion à ${preset.label} réussie ✓${list.length ? ` — ${list.length} modèle(s) disponible(s)` : ""}`);
        }
        return;
      }
      if (action === "reset") {
        setLicenseKey("");
        setApiKey("");
        setInfo("Configuration réinitialisée.");
      } else {
        setLicenseKey("");
        setApiKey("");
        setInfo(mode === "pack" ? "Relais activé ✓" : `${preset.label} activé ✓`);
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setLoading(null);
    }
  }

  const configured = !!status?.configured;
  const storedKeyHint = status?.providers?.[provider]?.keyHint ?? null;
  const canSubmit =
    mode === "pack"
      ? !!licenseKey.trim() || !!status?.licenseHint
      : (!preset.keyRequired || !!apiKey.trim() || !!storedKeyHint) &&
        !!writer.trim() &&
        (!preset.editableBaseURL || !!baseURL.trim());
  const activeLabel = useMemo(() => {
    if (!status?.configured) return null;
    if (status.mode === "pack") return "Pack actif";
    return `${PROVIDERS[status.provider]?.label ?? "Clé API"} actif`;
  }, [status]);
  /** Infos du modèle choisi : liste chargée, sinon tarif connu (Gemini) pour un nom saisi. */
  const infoOf = (id: string): ModelInfo | undefined => {
    const name = id.trim();
    if (!name) return undefined;
    const found = models.find((m) => m.id === name);
    if (found) return found;
    const price = knownPrice(provider, name);
    return price.priceIn != null ? { id: name, textCapable: true, ...price } : undefined;
  };
  const writerInfo = infoOf(writer);
  const reviewerInfo = infoOf(reviewer) ?? (reviewer.trim() ? undefined : writerInfo);
  const pairCost = dossierCost(writerInfo, reviewerInfo);
  const rateLimitsUrl = RATE_LIMITS_URL[provider];

  return (
    <Card data-testid="ai-settings">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-8 w-8 rounded-md bg-surface flex items-center justify-center text-textSecondary">
          <Sparkles className="h-5 w-5" />
        </div>
        <h2 className="text-h3">Génération IA</h2>
        {configured && activeLabel && (
          <span className="ml-auto inline-flex items-center gap-1 text-caption text-success">
            <Check className="h-3.5 w-3.5" />
            {activeLabel}
          </span>
        )}
      </div>
      <p className="text-small text-textSecondary mb-4">
        L'extraction de CV et la rédaction des documents utilisent un modèle d'IA :{" "}
        {status?.packAvailable ? "le relais configuré pour ce poste, " : ""}votre propre clé chez le
        fournisseur de votre choix (facturée à l'usage par ce fournisseur) ou un modèle qui tourne sur votre machine
        (Ollama, LM Studio). À configurer dès l'import du CV.
      </p>

      {status?.packAvailable && (
        <div className="flex flex-wrap gap-2 mb-4">
          <ModeChip active={mode === "pack"} onClick={() => { setMode("pack"); setError(null); setInfo(null); }}>
            Relais (licence)
          </ModeChip>
          <ModeChip active={mode === "byok"} onClick={() => { setMode("byok"); setError(null); setInfo(null); }}>
            Ma propre clé / mon modèle
          </ModeChip>
        </div>
      )}

      {mode === "pack" ? (
        <>
          <Input
            type="password"
            value={licenseKey}
            onChange={(e) => setLicenseKey(e.target.value)}
            placeholder="JSC-XXXXXXXXXXXXXXXX"
            autoComplete="off"
            spellCheck={false}
          />
          <p className="text-caption text-textSecondary mt-1.5">
            {status?.licenseHint ? (
              <>Clé de licence enregistrée : <code>{status.licenseHint}</code></>
            ) : (
              <>Saisissez la clé de licence fournie avec ce relais.</>
            )}
          </p>
        </>
      ) : (
        <div className="space-y-3">
          <label className="block">
            <span className="text-caption text-textSecondary">Fournisseur</span>
            <select
              className={cn(selectClass, "mt-1")}
              value={provider}
              data-testid="ai-provider"
              onChange={(e) => {
                const p = e.target.value as ProviderId;
                setProvider(p);
                loadProvider(p, status);
                setError(null);
                setInfo(null);
              }}
            >
              {PROVIDER_IDS.map((id) => (
                <option key={id} value={id}>
                  {PROVIDERS[id].label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-caption text-textSecondary">
            {preset.help}
            {preset.keyUrl && (
              <>
                {" "}
                <a className="inline-flex items-center gap-0.5 text-accent hover:underline" href={preset.keyUrl} target="_blank" rel="noreferrer">
                  {preset.local ? "Télécharger" : "Créer une clé"} <ExternalLink className="h-3 w-3" />
                </a>
              </>
            )}
          </p>

          {(preset.keyRequired || provider === "custom") && (
            <label className="block">
              <span className="text-caption text-textSecondary">Clé API{preset.keyRequired ? "" : " (facultative)"}</span>
              <Input
                className="mt-1"
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={preset.keyPlaceholder}
                autoComplete="off"
                spellCheck={false}
              />
              <span className="block text-caption text-textSecondary mt-1">
                {storedKeyHint ? <>Clé enregistrée : <code>{storedKeyHint}</code> — laissez vide pour la garder.</> : <>La clé reste sur cette machine.</>}
              </span>
            </label>
          )}

          {preset.editableBaseURL && (
            <label className="block">
              <span className="text-caption text-textSecondary">Adresse du serveur</span>
              <Input
                className="mt-1"
                value={baseURL}
                onChange={(e) => setBaseURL(e.target.value)}
                placeholder={preset.baseURL || "https://mon-serveur.exemple/v1"}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-caption text-textSecondary">Modèle de rédaction (CV, lettre)</span>
              <ModelPicker value={writer} onChange={setWriter} models={models} placeholder="nom du modèle" />
              {writerInfo && <ModelMeta model={writerInfo} />}
            </label>
            <label className="block">
              <span className="text-caption text-textSecondary">Modèle de relecture (plus léger)</span>
              <ModelPicker value={reviewer} onChange={setReviewer} models={models} placeholder="même modèle si vide" />
              {reviewer.trim() && reviewerInfo && <ModelMeta model={reviewerInfo} />}
            </label>
          </div>
          {!preset.local && (pairCost != null || rateLimitsUrl) && (
            <div className="rounded-md border border-border px-3 py-2.5 text-caption text-textSecondary space-y-1">
              {pairCost != null && (
                <p>
                  <span className="font-semibold text-text">Coût estimé d'un dossier</span> (CV + lettre, relecture comprise) : ≈ {formatUsd(pairCost)}. Ordre de grandeur : les jetons réels de chaque appel sont dans le journal du serveur.
                  {provider === "gemini" && (
                    <>
                      {" "}Prix : <a className="text-accent hover:underline" href={GEMINI_PRICING_URL} target="_blank" rel="noreferrer">tarif Google</a> du {GEMINI_PRICING_DATE}. Sur l'offre gratuite, rien n'est facturé dans la limite des quotas.
                    </>
                  )}
                </p>
              )}
              {rateLimitsUrl && (
                <p>
                  <span className="font-semibold text-text">Requêtes par minute et par jour</span> : propres à votre compte et à son palier, {preset.label} ne les communique qu'ici :{" "}
                  <a className="inline-flex items-center gap-0.5 text-accent hover:underline" href={rateLimitsUrl} target="_blank" rel="noreferrer">
                    voir mes limites <ExternalLink className="h-3 w-3" />
                  </a>
                  . Un dossier fait 4 à 6 requêtes.
                </p>
              )}
            </div>
          )}
          {!preset.local && provider !== "anthropic" && (
            <p className="text-caption text-textSecondary">
              JobScout a été mis au point avec Claude. Avec un autre modèle, la qualité et le coût varient : relisez vos premiers documents.
            </p>
          )}
          {preset.local && (
            <p className="text-caption text-textSecondary">
              Un modèle local respecte moins bien le format demandé et le français soutenu qu'un grand modèle en ligne : préférez au moins 14 milliards de paramètres.
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-4">
        <Button onClick={() => call("save")} disabled={!!loading || !canSubmit}>
          {loading === "save" ? <Spinner size={16} className="text-onAccent" /> : <Check className="h-4 w-4" />}
          Enregistrer
        </Button>
        <Button variant="secondary" onClick={() => call("verify")} disabled={!!loading || (mode === "pack" ? !canSubmit : preset.keyRequired && !apiKey.trim() && !storedKeyHint)}>
          {loading === "verify" ? <Spinner size={16} /> : <KeyRound className="h-4 w-4" />}
          Vérifier
        </Button>
        {mode === "byok" && (
          <Button variant="secondary" onClick={() => call("models")} disabled={!!loading || (preset.keyRequired && !apiKey.trim() && !storedKeyHint)}>
            {loading === "models" ? <Spinner size={16} /> : <ListRestart className="h-4 w-4" />}
            Charger la liste
          </Button>
        )}
        {configured && status?.source === "settings" && (
          <Button variant="ghost" onClick={() => call("reset")} disabled={!!loading}>
            <RotateCcw className="h-4 w-4" /> Réinitialiser
          </Button>
        )}
      </div>

      {status?.mode === "pack" && status.quota?.points_remaining != null && (
        <p className="text-caption text-textSecondary mt-3">
          Pack : ≈ {status.quota.dossiers_estimes ?? Math.floor(status.quota.points_remaining / 10)} dossiers restants (
          {status.quota.points_remaining} points).
        </p>
      )}
      {status?.source === "env" && (
        <p className="text-caption text-textSecondary mt-3">Mode développement : clé Anthropic lue depuis l'environnement.</p>
      )}

      {info && (
        <div className="mt-3 flex items-start gap-2 p-3 rounded-md bg-[rgba(48,209,88,0.08)] text-success text-small">
          <Check className="h-4 w-4 mt-0.5 shrink-0" /> {info}
        </div>
      )}
      {error && (
        <div className="mt-3 flex items-start gap-2 p-3 rounded-md bg-[rgba(255,59,48,0.08)] text-danger text-small">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" /> {error}
        </div>
      )}
    </Card>
  );
}

function ModeChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-9 px-4 rounded-full border text-small font-medium transition-colors",
        active
          ? "border-accent bg-accent text-onAccent hover:bg-accentHover"
          : "border-border bg-surface text-textSecondary hover:text-text hover:bg-surfaceHover"
      )}
    >
      {children}
    </button>
  );
}
