import "server-only";
import type { Scraper, ScrapedOffre, ScrapeCriteria, ProgressEvent } from "./base";
import { htmlToText } from "./base";
import { detectVie } from "@/lib/vie";
import { citiesForCountry } from "@/lib/cities";
import { BROWSER_HEADERS, sleep } from "./dom";

/**
 * Meteojob (France). La page de résultats est rendue côté serveur (Angular) et
 * embarque les offres complètes — description, profil, entreprise, salaire —
 * dans son état de transfert (<script id="candidate-front-state">) : une
 * requête par page de 20 offres, aucune visite des fiches.
 * Structure vérifiée le 9 octobre 2026.
 */
const SOURCE = "meteojob";
const SITE = "https://www.meteojob.com";
const PAGE_SIZE = 20;
const MAX_PAGES = 5;

type MjLocation = { name?: string | null; admin3Label?: string | null; countryLabel?: string | null; countryCode?: string | null };
type MjOffer = {
  id?: string | number;
  title?: string | null;
  publicationDate?: string | null;
  description?: string | null;
  profileDescription?: string | null;
  companyDescription?: string | null;
  contractTypes?: string[] | null;
  locations?: MjLocation[] | null;
  company?: { name?: string | null } | null;
  recruiter?: string | null;
  anonymous?: boolean;
  url?: { jobOffer?: string | null } | null;
  labels?: {
    contractTypeList?: { value?: string | null }[] | null;
    salary?: { value?: string | null } | null;
  } | null;
};
type MjSearch = { total?: number; content?: MjOffer[] };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** État de transfert Angular : JSON brut, ou échappé (&q; &a; …) selon les versions. */
export function parseMeteojobState(html: string): MjSearch | null {
  const m = html.match(/<script id="candidate-front-state"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let state: Record<string, unknown>;
  try {
    state = JSON.parse(m[1]);
  } catch {
    try {
      state = JSON.parse(
        m[1].replace(/&q;/g, '"').replace(/&s;/g, "'").replace(/&l;/g, "<").replace(/&g;/g, ">").replace(/&a;/g, "&")
      );
    } catch {
      return null;
    }
  }
  const search = state["app:search:offers"] as MjSearch | undefined;
  return search && Array.isArray(search.content) ? search : null;
}

/** « Lyon 05 (69) » → « Lyon 05 » ; l'arrondissement est ramené à la ville par le filtre « Ville ». */
function cityLabel(loc: MjLocation | undefined): string | null {
  const name = (loc?.name ?? loc?.admin3Label ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  return name || null;
}

export function meteojobToScraped(o: MjOffer): ScrapedOffre | null {
  const id = o.id != null ? String(o.id) : "";
  const title = (o.title ?? "").trim();
  if (!id || !title) return null;
  const url = `${SITE}${o.url?.jobOffer || `/jobs/${id}`}`;
  const sections = [
    o.description ? `<h2>Missions</h2>${o.description}` : "",
    o.profileDescription ? `<h2>Profil recherché</h2>${o.profileDescription}` : "",
    o.companyDescription ? `<h2>Entreprise</h2>${o.companyDescription}` : "",
  ].filter(Boolean);
  const description_html = sections.join("");
  const description_text = htmlToText(description_html);
  const ok = description_text.length >= 100;
  const loc = o.locations?.[0];
  const salary = o.labels?.salary?.value ?? null;
  return {
    source_id: id,
    url,
    title,
    company: (o.anonymous ? "" : o.company?.name ?? o.recruiter ?? "").trim(),
    country: loc?.countryLabel || "France",
    location: cityLabel(loc),
    contract_type: o.labels?.contractTypeList?.[0]?.value ?? o.contractTypes?.[0] ?? null,
    salary: salary && !/non pr[ée]cis/i.test(salary) ? salary : null,
    description_html: description_html || `<p>${esc(title)}</p>`,
    description_text,
    description_status: ok ? "ok" : "failed",
    posted_at: o.publicationDate ? o.publicationDate.slice(0, 10) : null,
    is_vie: detectVie({ source: SOURCE, title, description: description_text, url }),
    raw_payload: { id, contractTypes: o.contractTypes ?? null },
    scrape_errors: ok ? undefined : "description introuvable",
  };
}

async function fetchPage(what: string, where: string, page: number): Promise<MjSearch> {
  const params = new URLSearchParams();
  if (what) params.set("what", what);
  if (where) params.set("where", where);
  if (page > 1) params.set("page", String(page));
  const res = await fetch(`${SITE}/jobs?${params}`, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`Meteojob HTTP ${res.status}`);
  const search = parseMeteojobState(await res.text());
  if (!search) throw new Error("Meteojob : résultats introuvables dans la page (structure modifiée ?)");
  return search;
}

export const meteojobScraper: Scraper = {
  name: SOURCE,
  async *scrape(criteria: ScrapeCriteria, onEvent: (e: ProgressEvent) => void) {
    onEvent({ kind: "start", source: SOURCE });

    const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
    const wantsFrance = !criteria.countries.length || criteria.countries.some((c) => norm(c) === "france");
    if (!wantsFrance) {
      onEvent({ kind: "list", source: SOURCE, total: 0 });
      onEvent({ kind: "done", source: SOURCE, seen: 0, ok: 0, failed: 0 });
      return;
    }

    const max = criteria.maxOffres ?? 60;
    const queries = criteria.sectors.length ? criteria.sectors : [""];
    // Villes cibles en France : une recherche par ville (Meteojob inclut ses environs).
    const cities = citiesForCountry(criteria.cities, "France");
    const places = cities.length ? cities.map((c) => c.label) : [""];
    const perPlace = Math.max(10, Math.ceil(max / places.length));

    const seen = new Map<string, MjOffer>();
    let lastError: string | null = null;
    for (const place of places) {
      const target = Math.min(max, seen.size + perPlace);
      for (const q of queries) {
        for (let page = 1; page <= MAX_PAGES && seen.size < target; page++) {
          try {
            const { content = [] } = await fetchPage(q, place, page);
            for (const o of content) {
              const id = o.id != null ? String(o.id) : "";
              if (id && !seen.has(id) && seen.size < target) seen.set(id, o);
            }
            if (content.length < PAGE_SIZE) break;
            await sleep(900 + Math.random() * 600);
          } catch (e) {
            lastError = e instanceof Error ? e.message : String(e);
            break;
          }
        }
        if (seen.size >= target) break;
      }
    }
    if (lastError && seen.size === 0) throw new Error(lastError);

    const list = Array.from(seen.values());
    onEvent({ kind: "list", source: SOURCE, total: list.length });
    let ok = 0;
    let failed = 0;
    for (let i = 0; i < list.length; i++) {
      const offre = meteojobToScraped(list[i]);
      const good = !!offre && offre.description_status === "ok";
      if (offre) yield offre;
      if (good) ok++;
      else failed++;
      onEvent({ kind: "offre", source: SOURCE, index: i + 1, total: list.length, status: good ? "ok" : "failed" });
    }
    onEvent({ kind: "done", source: SOURCE, seen: list.length, ok, failed });
  },
};
