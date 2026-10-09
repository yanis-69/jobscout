import { afterEach, describe, expect, it, vi } from "vitest";
import {
  citiesForCountry,
  cityFromLocation,
  displayCityLabel,
  keepCitiesOfCountries,
  locationMatchesCities,
  preferCityLabel,
} from "@/lib/cities";
import { ProfileFullSchema } from "@/lib/cv/types";
import { getProfile, saveProfile } from "@/lib/db/queries";
import type { ResolvedCity } from "@/lib/geo";
import type { ScrapedOffre } from "@/lib/scrapers/base";
import { profile } from "./fixtures";

/**
 * Villes cibles : correspondance avec le lieu des offres, enregistrement dans
 * le profil, et recherche France Travail limitée à la ville (fetch simulé,
 * aucun appel réseau).
 */

const lyon: ResolvedCity = { city: "lyon", country: "France", label: "Lyon", lat: 45.76, lon: 4.83, insee: "69123" };

describe("locationMatchesCities", () => {
  const cities = [{ city: "Paris", country: "France" }, { city: "Saint-Étienne", country: "France" }];

  it("reconnaît les libellés des sources", () => {
    expect(locationMatchesCities("75 - Paris 15e Arrondissement", cities)).toBe(true);
    expect(locationMatchesCities("PARIS", cities)).toBe(true);
    expect(locationMatchesCities("St Etienne, Auvergne-Rhône-Alpes", cities)).toBe(true);
  });

  it("refuse les villes voisines au nom proche", () => {
    expect(locationMatchesCities("Cormeilles-en-Parisis", cities)).toBe(false);
    expect(locationMatchesCities("Lyons-la-Forêt", [{ city: "Lyon", country: "France" }])).toBe(false);
    expect(locationMatchesCities(null, cities)).toBe(false);
  });

  it("utilise aussi le nom officiel trouvé au géocodage", () => {
    expect(locationMatchesCities("69 - LYON", [lyon])).toBe(true);
  });
});

describe("cityFromLocation", () => {
  const key = (s: string | null) => cityFromLocation(s)?.key ?? null;

  it("ramène les graphies des sources à une même ville", () => {
    expect(key("Paris 15e Arrondissement")).toBe("paris");
    expect(key("PARIS 16")).toBe("paris");
    expect(key("75 - Paris")).toBe("paris");
    expect(key("Lyon 1er Arrondissement")).toBe("lyon");
    expect(key("Saint-Étienne, Auvergne-Rhône-Alpes, France")).toBe("saint etienne");
    expect(key("ST ETIENNE")).toBe("saint etienne");
    expect(key("Nanterre Cedex")).toBe("nanterre");
  });

  it("ignore un département seul, un pays ou un lieu vide", () => {
    expect(key("69")).toBeNull();
    expect(key("France")).toBeNull();
    expect(key("Télétravail")).toBeNull();
    expect(key(null)).toBeNull();
  });

  it("préfère le libellé accentué et remet en casse les capitales", () => {
    expect(preferCityLabel("DECINES CHARPIEU", "Décines-Charpieu")).toBe("Décines-Charpieu");
    expect(displayCityLabel("SAINT-PRIEST")).toBe("Saint-Priest");
    expect(displayCityLabel("Lyon")).toBe("Lyon");
  });
});

describe("villes par pays", () => {
  const cities = [
    { city: "Lyon", country: "France" },
    { city: "Bruxelles", country: "Belgique" },
  ];
  it("rattache les villes à leur pays sans tenir compte des accents", () => {
    expect(citiesForCountry(cities, "france").map((c) => c.city)).toEqual(["Lyon"]);
  });
  it("oublie les villes d'un pays qui n'est plus ciblé", () => {
    expect(keepCitiesOfCountries(cities, ["Belgique"]).map((c) => c.city)).toEqual(["Bruxelles"]);
  });
});

describe("profil", () => {
  it("un ancien profil sans villes reçoit les valeurs par défaut", () => {
    const { target_cities, city_radius_km, ...old } = profile;
    const parsed = ProfileFullSchema.parse(old);
    expect(parsed.target_cities).toEqual([]);
    expect(parsed.city_radius_km).toBe(20);
  });

  it("enregistre villes et rayon, sans les villes d'un pays retiré", () => {
    saveProfile({
      ...profile,
      target_countries: ["France"],
      target_cities: [
        { city: "Lyon", country: "France" },
        { city: "Genève", country: "Suisse" },
      ],
      city_radius_km: 30,
    });
    const saved = getProfile()!;
    expect(saved.target_cities).toEqual([{ city: "Lyon", country: "France" }]);
    expect(saved.city_radius_km).toBe(30);
  });
});

describe("France Travail : recherche autour de la ville", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("passe le code INSEE et le rayon à la recherche", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const url = String(input);
      urls.push(url);
      return new Response("<html><body><ul></ul></body></html>", { status: 200 });
    });
    const { francetravailScraper } = await import("@/lib/scrapers/francetravail");
    const out: ScrapedOffre[] = [];
    for await (const o of francetravailScraper.scrape(
      { sectors: ["comptable"], countries: ["France"], cities: [lyon], radiusKm: 10 },
      () => {}
    )) {
      out.push(o);
    }
    const search = urls.find((u) => u.includes("/offres/recherche?"));
    expect(search).toBeDefined();
    const params = new URL(search!).searchParams;
    expect(params.get("lieux")).toBe("69123");
    expect(params.get("rayon")).toBe("10");
    expect(params.get("motsCles")).toBe("comptable");
  });

  it("sans ville : toute la France", async () => {
    const urls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL) => {
      urls.push(String(input));
      return new Response("<html><body></body></html>", { status: 200 });
    });
    const { francetravailScraper } = await import("@/lib/scrapers/francetravail");
    for await (const _ of francetravailScraper.scrape(
      { sectors: ["comptable"], countries: ["France"], cities: [], radiusKm: 20 },
      () => {}
    )) {
      // aucune offre
    }
    const search = urls.find((u) => u.includes("/offres/recherche?"))!;
    expect(new URL(search).searchParams.has("lieux")).toBe(false);
  });
});
