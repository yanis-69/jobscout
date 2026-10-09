// Informations affichées pour chaque modèle dans Profil › Génération IA.
// Module partagé client/serveur : aucune dépendance Node ici.
//
// - Jetons maximum : lus chez le fournisseur quand son API les donne (Gemini,
//   OpenRouter, Groq, Mistral…).
// - Prix : tarif public du fournisseur, recopié ci-dessous avec sa date (aucune
//   API de prix chez Google) ; OpenRouter donne les siens dans sa liste.
// - Limites de requêtes (par minute, par jour) : propres à chaque compte et à son
//   palier ; Google ne les publie ni par API ni dans sa documentation, seulement
//   dans AI Studio. JobScout renvoie donc vers cette page plutôt que d'afficher
//   des chiffres qui seraient faux pour une partie des comptes.

import type { ProviderId } from "./providers";

export type ModelInfo = {
  id: string;
  /** Nom lisible donné par le fournisseur (« Gemini 3.8 Flash »). */
  label?: string;
  /** Jetons maximum en entrée (contexte) et en sortie. */
  inputTokens?: number;
  outputTokens?: number;
  /** Prix en dollars US par million de jetons. */
  priceIn?: number;
  priceOut?: number;
  /** Utilisable sur l'offre gratuite du fournisseur, dans la limite de ses quotas. */
  freeTier?: boolean;
  /** false : modèle qui ne rédige pas de texte (voix, image, vidéo, embeddings…). */
  textCapable: boolean;
};

/**
 * Tarif « Standard » de l'API Gemini, texte, invites ≤ 200 000 jetons
 * (https://ai.google.dev/gemini-api/docs/pricing, mise à jour du 7 octobre 2026,
 * tarifs annoncés jusqu'au 31 décembre 2026). Prix en $ par million de jetons.
 */
export const GEMINI_PRICING_DATE = "7 octobre 2026";
export const GEMINI_PRICING_URL = "https://ai.google.dev/gemini-api/docs/pricing";
const GEMINI_PRICES: Record<string, { in: number; out: number; free: boolean }> = {
  "gemini-3.8-flash": { in: 0.75, out: 3.75, free: true },
  "gemini-3.7-flash": { in: 0.75, out: 3.75, free: true },
  "gemini-3.6-flash": { in: 0.75, out: 3.75, free: true },
  "gemini-3.5-flash": { in: 1.5, out: 9, free: true },
  "gemini-3.5-flash-lite": { in: 0.3, out: 2.5, free: true },
  "gemini-3.1-flash-lite": { in: 0.25, out: 1.5, free: true },
  "gemini-3.1-pro-preview": { in: 2, out: 12, free: false },
  "gemini-3.1-pro-preview-customtools": { in: 2, out: 12, free: false },
  "gemini-3-flash-preview": { in: 0.5, out: 3, free: true },
  "gemini-omni-1.1-flash": { in: 1.5, out: 9, free: false },
  "gemini-omni-flash-preview": { in: 1.5, out: 9, free: false },
  "gemini-2.5-pro": { in: 1.25, out: 10, free: true },
  "gemini-2.5-flash": { in: 0.3, out: 2.5, free: true },
  "gemini-2.5-flash-lite": { in: 0.1, out: 0.4, free: true },
};

/** Modèles Gemini qui ne servent pas à rédiger du texte (ou pas par l'API compatible OpenAI). */
const GEMINI_NOT_TEXT =
  /(tts|image|embedding|veo|lyria|live|transcribe|aqa|banana|robotics|computer-use|deep-research|antigravity|native-audio)/;

export function geminiModelInfo(raw: {
  name?: string;
  displayName?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
}): ModelInfo | null {
  const id = (raw.name ?? "").replace(/^models\//, "");
  if (!id) return null;
  const price = GEMINI_PRICES[id];
  const methods = raw.supportedGenerationMethods ?? [];
  return {
    id,
    label: raw.displayName || undefined,
    inputTokens: raw.inputTokenLimit || undefined,
    outputTokens: raw.outputTokenLimit || undefined,
    priceIn: price?.in,
    priceOut: price?.out,
    freeTier: price?.free,
    textCapable: methods.includes("generateContent") && !GEMINI_NOT_TEXT.test(id),
  };
}

/** Prix Gemini connu pour un identifiant (pour un modèle saisi à la main). */
export function knownPrice(provider: ProviderId, id: string): Pick<ModelInfo, "priceIn" | "priceOut" | "freeTier"> {
  if (provider !== "gemini") return {};
  const p = GEMINI_PRICES[id.trim().replace(/^models\//, "")];
  return p ? { priceIn: p.in, priceOut: p.out, freeTier: p.free } : {};
}

/**
 * Jetons d'un dossier (CV + lettre, relecture comprise), en ordre de grandeur :
 * le prompt de chaque document (~6 Ko), le profil et l'offre (6 000 caractères
 * au plus), puis la relecture des deux documents. Les modèles « à réflexion »
 * (Gemini 3.x…) facturent aussi leurs jetons de réflexion, comptés en sortie.
 * Le nombre réel de jetons de chaque appel est écrit dans le journal du serveur
 * (lignes « [llm] … »).
 */
export const DOSSIER_TOKENS = {
  writer: { input: 16_000, output: 7_000 },
  reviewer: { input: 12_000, output: 6_000 },
} as const;

type Priced = Pick<ModelInfo, "priceIn" | "priceOut">;

function callCost(m: Priced | undefined, t: { input: number; output: number }): number | null {
  if (m?.priceIn == null || m.priceOut == null) return null;
  return (t.input * m.priceIn + t.output * m.priceOut) / 1_000_000;
}

/** Coût estimé d'un dossier ($) si ce modèle fait tout (rédaction et relecture). */
export function dossierCostAlone(m: Priced): number | null {
  const a = callCost(m, DOSSIER_TOKENS.writer);
  const b = callCost(m, DOSSIER_TOKENS.reviewer);
  return a == null || b == null ? null : a + b;
}

/** Coût estimé d'un dossier ($) avec le couple choisi (relecture = rédaction si vide). */
export function dossierCost(writer: Priced | undefined, reviewer: Priced | undefined): number | null {
  const a = callCost(writer, DOSSIER_TOKENS.writer);
  const b = callCost(reviewer ?? writer, DOSSIER_TOKENS.reviewer);
  return a == null || b == null ? null : a + b;
}

/** Page où le fournisseur affiche les limites de requêtes du compte (par minute, par jour). */
export const RATE_LIMITS_URL: Partial<Record<ProviderId, string>> = {
  gemini: "https://aistudio.google.com/rate-limit",
};

const fr = (n: number, digits = 2) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(n);

/** « 1 048 576 » → « 1 M », « 65 536 » → « 65,5 k ». */
export function formatTokens(n: number | undefined): string | null {
  if (!n) return null;
  if (n >= 1_000_000) return `${fr(n / 1_000_000, 1)} M`;
  if (n >= 1_000) return `${fr(n / 1_000, 1)} k`;
  return fr(n, 0);
}

export function formatUsd(n: number | null | undefined): string | null {
  if (n == null) return null;
  if (n === 0) return "0 $";
  return n < 0.01 ? `< 0,01 $` : `${fr(n, n < 1 ? 3 : 2)} $`;
}
