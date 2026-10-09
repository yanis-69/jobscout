import { afterEach, describe, expect, it, vi } from "vitest";
import { meteojobScraper, meteojobToScraped, parseMeteojobState } from "@/lib/scrapers/meteojob";
import { adeccoCityName, adeccoCityNames, adeccoScraper, adeccoToScraped } from "@/lib/scrapers/adecco";
import type { ResolvedCity } from "@/lib/geo";
import type { ScrapedOffre, ScrapeCriteria } from "@/lib/scrapers/base";
import { displayCityLabel } from "@/lib/cities";
import { DEFAULT_SOURCE_IDS, SOURCES_META } from "@/lib/sources-meta";
import { VALID_SOURCES } from "@/lib/scrapers/registry";

/**
 * Meteojob et Adecco : lecture des réponses des deux sites (structures relevées
 * le 9 octobre 2026) et requêtes envoyées. fetch simulé, aucun appel réseau.
 */

const lyon: ResolvedCity = { city: "Lyon", country: "France", label: "Lyon", lat: 45.76, lon: 4.83, insee: "69123" };
const LONG = "Tenue de la comptabilité générale, rapprochements bancaires, déclarations de TVA et clôtures mensuelles. ".repeat(2);

const mjOffer = {
  id: "56836007",
  title: "Comptable H/F",
  publicationDate: "2026-10-08T23:07:41.340Z",
  description: `<p>${LONG}</p>`,
  profileDescription: "<p>Bac+2 en comptabilité.</p>",
  contractTypes: ["CDD"],
  locations: [{ name: "Lyon 05 (69)", countryLabel: "France" }],
  company: { name: "Lynx RH" },
  url: { jobOffer: "/jobs/56836007" },
  labels: { contractTypeList: [{ value: "CDD" }], salary: { value: "30 000 € - 32 000 € par an" } },
};

function meteojobPage(offers: unknown[]): string {
  const state = { "app:search:offers": { total: offers.length, content: offers, facets: {} } };
  return `<html><body><script id="candidate-front-state" type="application/json">${JSON.stringify(state)}</script></body></html>`;
}

const criteria = (over: Partial<ScrapeCriteria> = {}): ScrapeCriteria => ({
  sectors: ["comptable"],
  countries: ["France"],
  cities: [],
  radiusKm: 20,
  ...over,
});

async function drain(gen: AsyncGenerator<ScrapedOffre>): Promise<ScrapedOffre[]> {
  const out: ScrapedOffre[] = [];
  for await (const o of gen) out.push(o);
  return out;
}

afterEach(() => vi.unstubAllGlobals());

describe("sources déclarées", () => {
  it("Meteojob et Adecco sont enregistrées, décochées par défaut (conditions des sites)", () => {
    for (const id of ["meteojob", "adecco"]) {
      expect(VALID_SOURCES).toContain(id);
      expect(SOURCES_META.find((s) => s.id === id)).toMatchObject({ optIn: true, scope: "fr" });
      expect(DEFAULT_SOURCE_IDS).not.toContain(id);
    }
  });
});

describe("Meteojob", () => {
  it("lit l'état embarqué, brut ou échappé à la manière d'Angular", () => {
    expect(parseMeteojobState(meteojobPage([mjOffer]))?.content).toHaveLength(1);
    const escaped = meteojobPage([mjOffer]).replace(/"/g, "&q;");
    const fixed = escaped.replace('id=&q;candidate-front-state&q; type=&q;application/json&q;', 'id="candidate-front-state" type="application/json"');
    expect(parseMeteojobState(fixed)?.content?.[0]?.id).toBe("56836007");
    expect(parseMeteojobState("<html></html>")).toBeNull();
  });

  it("convertit une offre (description, lieu, contrat, salaire, date)", () => {
    const o = meteojobToScraped(mjOffer)!;
    expect(o).toMatchObject({
      source_id: "56836007",
      url: "https://www.meteojob.com/jobs/56836007",
      company: "Lynx RH",
      country: "France",
      location: "Lyon 05",
      contract_type: "CDD",
      salary: "30 000 € - 32 000 € par an",
      posted_at: "2026-10-08",
      description_status: "ok",
    });
    expect(o.description_text).toContain("Profil recherché");
    expect(meteojobToScraped({ ...mjOffer, labels: { salary: { value: "Salaire non précisé" } } })!.salary).toBeNull();
  });

  it("cherche par ville cible, et pas hors de France", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      urls.push(String(input));
      return new Response(meteojobPage([mjOffer]), { status: 200 });
    });
    const offers = await drain(meteojobScraper.scrape(criteria({ cities: [lyon] }), () => {}));
    expect(offers.map((o) => o.source_id)).toEqual(["56836007"]);
    const params = new URL(urls[0]).searchParams;
    expect(params.get("what")).toBe("comptable");
    expect(params.get("where")).toBe("Lyon");

    urls.length = 0;
    expect(await drain(meteojobScraper.scrape(criteria({ countries: ["Belgique"] }), () => {}))).toEqual([]);
    expect(urls).toEqual([]);
  });
});

describe("Adecco", () => {
  it("écrit les communes comme Adecco, arrondissements compris", () => {
    expect(adeccoCityName("Sainte-Foy-lès-Lyon")).toBe("STE FOY LES LYON");
    expect(adeccoCityName("Saint-Priest")).toBe("ST PRIEST");
    expect(adeccoCityName("Décines-Charpieu")).toBe("DECINES CHARPIEU");
    const names = adeccoCityNames(["Lyon", "Villeurbanne"]);
    expect(names).toContain("LYON");
    expect(names).toContain("LYON 03");
    expect(names).toContain("LYON 09");
    expect(names).not.toContain("LYON 10");
    expect(names).toContain("VILLEURBANNE");
  });

  it("convertit une offre (lieu, contrat, salaire, URL publique)", () => {
    const o = adeccoToScraped(
      { jobId: "2130479401", jobTitle: "Comptable Fournisseurs (h/f)", cityName: "CALUIRE ET CUIRE", employmentTypeTitle: "Intérim", contractDurationTitle: "3 mois", minsalary: 13.72, maxsalary: 0, salaryTimeScaleID: "PERHOUR", postedDate: "2026-10-07T08:00:00Z" },
      { jobDescription: `<p>${LONG}</p>`, jobUrl: "https://www.adecco.com/fr-fr/offres-emploi/detail/2130479401" }
    )!;
    expect(o).toMatchObject({
      url: "https://www.adecco.com/fr-fr/offres-emploi/detail/2130479401",
      company: "Adecco",
      location: "Caluire et Cuire",
      contract_type: "Intérim · 3 mois",
      salary: "13,72 € / heure",
      posted_at: "2026-10-07",
      description_status: "ok",
    });
    expect(adeccoToScraped({ jobId: "1", jobTitle: "Poste" }, null)!.description_status).toBe("failed");
  });

  it("ville seule (rayon 0) : filtre CityName sur la ville et ses arrondissements, puis description", async () => {
    const bodies: string[] = [];
    const details: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/data/jobs/summarized")) {
        bodies.push(String(init?.body));
        return Response.json({ jobs: [{ jobId: "42", jobTitle: "Comptable (h/f)", cityName: "LYON 03" }], pagination: { total: 1 } });
      }
      details.push(url);
      return Response.json({ jobDescription: `<p>${LONG}</p>` });
    });
    const offers = await drain(adeccoScraper.scrape(criteria({ cities: [lyon], radiusKm: 0 }), () => {}));
    expect(offers.map((o) => [o.source_id, o.location])).toEqual([["42", "Lyon 03"]]);
    const body = JSON.parse(bodies[0]);
    expect(body.queryString).toContain("&q=comptable");
    expect(body.queryString).toContain("&fq=CityName:(LYON OR LYON 01 OR LYON 02");
    expect(body.range).toBe(0);
    expect(details[0]).toContain("/job-description-details/42/ADECCO/FR/fr-FR/job-details");
  });
});

describe("displayCityLabel", () => {
  it("laisse en minuscules les petits mots des noms composés", () => {
    expect(displayCityLabel("STE FOY LES LYON")).toBe("Ste Foy les Lyon");
    expect(displayCityLabel("CHALON SUR SAONE")).toBe("Chalon sur Saone");
    expect(displayCityLabel("LE PONT DE CLAIX")).toBe("Le Pont de Claix");
  });
});
