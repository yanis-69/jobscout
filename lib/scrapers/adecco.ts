import "server-only";
import type { Scraper, ScrapedOffre, ScrapeCriteria, ProgressEvent } from "./base";
import { htmlToText } from "./base";
import { detectVie } from "@/lib/vie";
import { citiesForCountry, displayCityLabel } from "@/lib/cities";
import { frenchCommunesAround } from "@/lib/geo";
import { BROWSER_HEADERS, sleep } from "./dom";

/**
 * Adecco France (adecco.com/fr-fr). Le site interroge son propre service de
 * recherche (/api/data/jobs/summarized, POST, 10 offres par appel, syntaxe
 * proche de Solr : q, fq, sort), puis charge la description de chaque offre
 * (/api/data/jobs/job-description-details/…). JobScout fait les mêmes appels.
 * Lieu : seul un filtre sur le nom exact de commune fonctionne (« LYON 03 »,
 * « ST PRIEST ») ; le rayon du profil devient la liste des communes du cercle.
 * Structure vérifiée le 9 octobre 2026.
 */
const SOURCE = "adecco";
const SITE = "https://www.adecco.com";
const SEARCH_URL = `${SITE}/api/data/jobs/summarized`;
const PAGE_SIZE = 10;
const MAX_PAGES = 6;
/** Communes par requête : le filtre devient une suite de « CityName eq … or … ». */
const CITIES_PER_QUERY = 20;

type AdeccoJob = {
  jobId?: string | null;
  jobTitle?: string | null;
  cityName?: string | null;
  stateName?: string | null;
  employmentTypeTitle?: string | null;
  contractDurationTitle?: string | null;
  minsalary?: number | null;
  maxsalary?: number | null;
  salaryTimeScaleID?: string | null;
  postedDate?: string | null;
  isRemote?: boolean | null;
};
type AdeccoDetail = { jobDescription?: string | null; clientDescription?: string | null; jobUrl?: string | null; companyName?: string | null };

/** Nom de commune au format Adecco : capitales sans accents, « ST »/« STE » pour Saint/Sainte. */
export function adeccoCityName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[-'’]/g, " ")
    .replace(/\bSAINTE\b/g, "STE")
    .replace(/\bSAINT\b/g, "ST")
    .replace(/\s+/g, " ")
    .trim();
}

const ARRONDISSEMENTS: Record<string, number> = { PARIS: 20, LYON: 9, MARSEILLE: 16 };

/** Noms à filtrer pour une liste de communes, arrondissements de Paris, Lyon et Marseille compris. */
export function adeccoCityNames(communes: string[]): string[] {
  const names = new Set<string>();
  for (const c of communes) {
    const name = adeccoCityName(c);
    if (!name) continue;
    names.add(name);
    const n = ARRONDISSEMENTS[name];
    for (let i = 1; n && i <= n; i++) names.add(`${name} ${String(i).padStart(2, "0")}`);
  }
  return [...names];
}

/** Mots-clés sans les caractères qui casseraient la chaîne de requête. */
const cleanQuery = (q: string) => q.replace(/[&()"=:]/g, " ").replace(/\s+/g, " ").trim();

async function searchPage(q: string, cityNames: string[] | null, offset: number): Promise<{ jobs: AdeccoJob[]; total: number }> {
  let queryString = "";
  if (q) queryString += `&q=${cleanQuery(q)}`;
  queryString += "&fq=WebSiteName:(adecco.fr)";
  if (cityNames?.length) queryString += `&fq=CityName:(${cityNames.join(" OR ")})`;
  // Comme le site : pertinence avec un mot-clé, sinon les plus récentes.
  queryString += q ? "&sort=score desc" : "&sort=PostedDate desc";
  const res = await fetch(SEARCH_URL, {
    method: "POST",
    headers: { ...BROWSER_HEADERS, "content-type": "text/plain;charset=UTF-8", origin: SITE, referer: `${SITE}/fr-fr/offres-emploi` },
    body: JSON.stringify({
      queryString,
      filtersToDisplay: "",
      range: offset,
      siteName: "adecco",
      brand: "adecco",
      countryCode: "FR",
      languageCode: "fr-FR",
    }),
  });
  if (!res.ok) throw new Error(`Adecco HTTP ${res.status}`);
  const data = (await res.json()) as { jobs?: AdeccoJob[]; pagination?: { total?: number } };
  return { jobs: data.jobs ?? [], total: data.pagination?.total ?? 0 };
}

async function fetchDetail(jobId: string): Promise<AdeccoDetail | null> {
  const res = await fetch(`${SITE}/api/data/jobs/job-description-details/${encodeURIComponent(jobId)}/ADECCO/FR/fr-FR/job-details`, {
    headers: { ...BROWSER_HEADERS, referer: `${SITE}/fr-fr/offres-emploi` },
  });
  if (!res.ok) return null;
  return (await res.json()) as AdeccoDetail;
}

function salaryLabel(job: AdeccoJob): string | null {
  const min = job.minsalary || 0;
  const max = job.maxsalary || 0;
  if (!min && !max) return null;
  const fmt = (n: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(n);
  const per = { PERHOUR: "/ heure", PERMONTH: "/ mois", PERYEAR: "/ an", PERDAY: "/ jour", PERWEEK: "/ semaine" }[job.salaryTimeScaleID ?? ""] ?? "";
  const range = min && max && max > min ? `${fmt(min)} – ${fmt(max)}` : fmt(max || min);
  return `${range} € ${per}`.trim();
}

export function adeccoToScraped(job: AdeccoJob, detail: AdeccoDetail | null): ScrapedOffre | null {
  const id = (job.jobId ?? "").trim();
  const title = (job.jobTitle ?? "").trim();
  if (!id || !title) return null;
  const url = detail?.jobUrl || `${SITE}/fr-fr/offres-emploi/detail/${id}`;
  const description_html = [detail?.jobDescription, detail?.clientDescription ? `<h2>Entreprise</h2>${detail.clientDescription}` : ""]
    .filter(Boolean)
    .join("");
  const description_text = htmlToText(description_html);
  const ok = description_text.length >= 100;
  const contract = [job.employmentTypeTitle, job.contractDurationTitle].filter(Boolean).join(" · ") || null;
  return {
    source_id: id,
    url,
    title,
    // L'entreprise cliente n'est presque jamais nommée : l'offre est portée par Adecco.
    company: (detail?.companyName ?? "").trim() || "Adecco",
    country: "France",
    location: job.cityName ? displayCityLabel(job.cityName) : job.stateName ?? null,
    contract_type: contract,
    salary: salaryLabel(job),
    description_html,
    description_text,
    description_status: ok ? "ok" : "failed",
    posted_at: job.postedDate ? job.postedDate.slice(0, 10) : null,
    is_vie: detectVie({ source: SOURCE, title, description: description_text, url }),
    raw_payload: { jobId: id, employmentType: job.employmentTypeTitle ?? null, state: job.stateName ?? null },
    scrape_errors: ok ? undefined : "description introuvable",
  };
}

export const adeccoScraper: Scraper = {
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

    const max = criteria.maxOffres ?? 50;
    const queries = criteria.sectors.length ? criteria.sectors : [""];
    // Villes cibles : pour chacune, les communes du rayon, filtrées par paquets.
    // Sans ville : toute la France (un seul « paquet » sans filtre).
    const cities = citiesForCountry(criteria.cities, "France");
    const places: (string[] | null)[][] = [];
    for (const city of cities) {
      const names = adeccoCityNames(await frenchCommunesAround(city, criteria.radiusKm));
      const chunks: string[][] = [];
      for (let i = 0; i < names.length; i += CITIES_PER_QUERY) chunks.push(names.slice(i, i + CITIES_PER_QUERY));
      places.push(chunks);
    }
    if (!places.length) places.push([null]);
    const perPlace = Math.max(10, Math.ceil(max / places.length));

    const seen = new Map<string, AdeccoJob>();
    let lastError: string | null = null;
    for (const chunks of places) {
      const target = Math.min(max, seen.size + perPlace);
      for (const names of chunks) {
        for (const q of queries) {
          for (let page = 0; page < MAX_PAGES && seen.size < target; page++) {
            try {
              const { jobs, total } = await searchPage(q, names, page * PAGE_SIZE);
              for (const j of jobs) {
                const id = (j.jobId ?? "").trim();
                if (id && !seen.has(id) && seen.size < target) seen.set(id, j);
              }
              if (jobs.length < PAGE_SIZE || (page + 1) * PAGE_SIZE >= total) break;
              await sleep(700 + Math.random() * 500);
            } catch (e) {
              lastError = e instanceof Error ? e.message : String(e);
              break;
            }
          }
          if (seen.size >= target) break;
        }
        if (seen.size >= target) break;
      }
    }
    if (lastError && seen.size === 0) throw new Error(lastError);

    const list = Array.from(seen.values());
    onEvent({ kind: "list", source: SOURCE, total: list.length });
    let ok = 0;
    let failed = 0;
    let consecutiveFails = 0;
    for (let i = 0; i < list.length; i++) {
      let detail: AdeccoDetail | null = null;
      try {
        detail = await fetchDetail(String(list[i].jobId));
      } catch {
        // description indisponible : offre enregistrée en « annonce partielle »
      }
      const offre = adeccoToScraped(list[i], detail);
      const good = !!offre && offre.description_status === "ok";
      if (offre) yield offre;
      if (good) {
        ok++;
        consecutiveFails = 0;
      } else {
        failed++;
        consecutiveFails++;
      }
      onEvent({ kind: "offre", source: SOURCE, index: i + 1, total: list.length, status: good ? "ok" : "failed" });
      if (consecutiveFails >= 10) break; // probable blocage ou changement de structure
      await sleep(600 + Math.random() * 500);
    }
    onEvent({ kind: "done", source: SOURCE, seen: list.length, ok, failed });
  },
};
