import type { ProfileFull } from "@/lib/cv/types";
import type { OffreFiltered } from "@/lib/db/offres";
import type { LlmConfig } from "@/lib/ai/client";
import { PROVIDERS, type ProviderId } from "@/lib/ai/providers";

/** Profil entièrement fictif. */
export const profile = {
  id: 1,
  full_name: "Camille Martin",
  email: "camille.martin@example.org",
  phone: null,
  location: "Lyon, France",
  linkedin_url: null,
  portfolio_url: null,
  summary: "Cheffe de projet digital, cinq ans d'expérience en pilotage de sites web.",
  raw_cv_text: null,
  sectors: ["digital"],
  target_countries: ["France"],
  target_cities: [],
  city_radius_km: 20,
  sources_enabled: [],
  preferred_contracts: ["cdi"],
  extraction_confidence: 90,
  experiences: [
    {
      id: 11,
      title: "Cheffe de projet digital",
      company: "Studio Nova",
      location: "Lyon",
      start_date: "2021-01",
      end_date: null,
      description: "Pilotage de projets web pour des clients PME.",
      bullet_points: ["Pilotage de 3 refontes de sites e-commerce", "Coordination d'une équipe de 5 personnes"],
      skills_used: ["Gestion de projet", "SQL"],
    },
  ],
  educations: [
    { id: 21, school: "Université de Lyon", degree: "Master", field: "Management", location: "Lyon", start_date: "2016", end_date: "2018", description: null },
  ],
  skills: [
    { id: 31, name: "Gestion de projet", category: "soft", level: "advanced", evidence_experience_ids: [11] },
    { id: 32, name: "SQL", category: "technical", level: "intermediate", evidence_experience_ids: [11] },
  ],
  languages: [{ id: 41, name: "Anglais", level: "C1" }],
} as unknown as ProfileFull;

/** Offre fictive, en français, à Lyon (pas de réparation « mobilité » attendue). */
export const offre = {
  id: 99,
  source: "hellowork",
  source_id: "test-99",
  url: "https://example.org/offre/99",
  title: "Chef de projet digital",
  company: "Entreprise Exemple",
  country: "France",
  location: "Lyon",
  contract_type: "CDI",
  salary: null,
  description_text:
    "Nous recherchons un chef de projet digital pour piloter la refonte de nos sites. Vous coordonnerez les équipes techniques et suivrez les indicateurs. Maîtrise de la gestion de projet et de SQL appréciée.",
  raw_payload: null,
  is_vie: 0,
} as unknown as OffreFiltered;

/** Configuration « clé personnelle » sans passer par la base. */
export function cfgFor(provider: ProviderId, over: Partial<LlmConfig> = {}): LlmConfig {
  const p = PROVIDERS[provider];
  return {
    mode: "byok",
    provider,
    kind: p.kind,
    apiKey: p.keyRequired ? "test-key-123456" : null,
    baseURL: p.baseURL || "http://127.0.0.1:9/v1",
    models: { writer: p.models.writer || "writer-model", reviewer: p.models.reviewer || "reviewer-model" },
    source: "settings",
    ...over,
  };
}
