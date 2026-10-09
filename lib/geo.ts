import "server-only";
import { normalizePlace, type TargetCity } from "@/lib/cities";

/**
 * Géocodage des villes cibles, une fois par scan et par ville (cache mémoire du
 * processus). France : API Découpage administratif (geo.api.gouv.fr) — donne le
 * code INSEE attendu par France Travail. Ailleurs : Nominatim (OpenStreetMap),
 * appelé au plus une fois par seconde comme le demande sa politique d'usage.
 * Échec réseau ou ville inconnue : la ville reste utilisable par son nom
 * (sources qui cherchent par libellé, filtre sur le lieu de l'offre).
 */
export type ResolvedCity = TargetCity & {
  /** Nom officiel quand le géocodage a réussi (« Lyon » pour « lyon »). */
  label: string;
  lat: number | null;
  lon: number | null;
  /** Code commune INSEE (France uniquement). */
  insee: string | null;
};

const TIMEOUT_MS = 8000;
const USER_AGENT = "JobScout (application locale de recherche d'emploi)";
const cache = new Map<string, ResolvedCity>();
let lastNominatimCall = 0;

async function geocodeFrance(city: string): Promise<Omit<ResolvedCity, "city" | "country"> | null> {
  const params = new URLSearchParams({ nom: city, fields: "code,nom,centre,population", boost: "population", limit: "1" });
  const res = await fetch(`https://geo.api.gouv.fr/communes?${params}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) return null;
  const rows = (await res.json()) as { code?: string; nom?: string; centre?: { coordinates?: [number, number] } }[];
  const hit = rows[0];
  if (!hit?.code) return null;
  const [lon, lat] = hit.centre?.coordinates ?? [null, null];
  return { label: hit.nom ?? city, insee: hit.code, lat: lat ?? null, lon: lon ?? null };
}

async function geocodeWorld(city: string, country: string): Promise<Omit<ResolvedCity, "city" | "country"> | null> {
  const wait = lastNominatimCall + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatimCall = Date.now();
  const params = new URLSearchParams({ city, country, format: "jsonv2", limit: "1", "accept-language": "fr" });
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
    headers: { "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const rows = (await res.json()) as { lat?: string; lon?: string; name?: string }[];
  const hit = rows[0];
  if (!hit?.lat || !hit.lon) return null;
  return { label: hit.name || city, insee: null, lat: Number(hit.lat), lon: Number(hit.lon) };
}

export async function resolveCity(target: TargetCity): Promise<ResolvedCity> {
  const key = `${normalizePlace(target.country)}|${normalizePlace(target.city)}`;
  const cached = cache.get(key);
  if (cached) return cached;
  let found: Omit<ResolvedCity, "city" | "country"> | null = null;
  try {
    found =
      normalizePlace(target.country) === "france"
        ? await geocodeFrance(target.city)
        : await geocodeWorld(target.city, target.country);
  } catch {
    // hors ligne, délai dépassé : on garde le nom seul, sans mise en cache
    return { ...target, label: target.city, lat: null, lon: null, insee: null };
  }
  const resolved: ResolvedCity = found
    ? { ...target, ...found }
    : { ...target, label: target.city, lat: null, lon: null, insee: null };
  cache.set(key, resolved);
  return resolved;
}

// ----------- Communes françaises autour d'une ville -----------
// Pour les sources qui ne filtrent que sur un nom de commune exact (Adecco) :
// le rayon du profil devient la liste des communes dont le centre est dans le
// cercle. Liste complète des communes (~35 000, ~5 Mo) chargée une fois par
// processus, seulement si une telle source est utilisée avec un rayon.

type Commune = { nom: string; population: number; lat: number; lon: number };
let communesPromise: Promise<Commune[]> | null = null;

function loadCommunes(): Promise<Commune[]> {
  communesPromise ??= (async () => {
    const res = await fetch("https://geo.api.gouv.fr/communes?fields=nom,centre,population&format=json", {
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`geo.api.gouv.fr HTTP ${res.status}`);
    const rows = (await res.json()) as { nom?: string; population?: number; centre?: { coordinates?: [number, number] } }[];
    return rows.flatMap((r) => {
      const [lon, lat] = r.centre?.coordinates ?? [];
      return r.nom && lat != null && lon != null ? [{ nom: r.nom, population: r.population ?? 0, lat, lon }] : [];
    });
  })();
  // Échec (hors ligne) : on retentera au prochain scan.
  communesPromise.catch(() => {
    communesPromise = null;
  });
  return communesPromise;
}

function distanceKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLon = (bLon - aLon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/**
 * Noms des communes françaises dans le rayon (la ville d'abord, puis les plus
 * peuplées), au plus `limit`. Rayon 0, ville non localisée ou liste
 * indisponible : la ville seule.
 */
export async function frenchCommunesAround(city: ResolvedCity, radiusKm: number, limit = 60): Promise<string[]> {
  if (radiusKm <= 0 || city.lat == null || city.lon == null) return [city.label];
  let communes: Commune[];
  try {
    communes = await loadCommunes();
  } catch {
    return [city.label];
  }
  const near = communes
    .filter((c) => distanceKm(city.lat!, city.lon!, c.lat, c.lon) <= radiusKm)
    .sort((a, b) => b.population - a.population)
    .map((c) => c.nom)
    .filter((nom) => normalizePlace(nom) !== normalizePlace(city.label));
  return [city.label, ...near].slice(0, limit);
}

export async function resolveCities(targets: TargetCity[]): Promise<ResolvedCity[]> {
  const out: ResolvedCity[] = [];
  for (const t of targets) out.push(await resolveCity(t));
  return out;
}
