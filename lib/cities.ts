// Villes cibles du profil : un affinage facultatif des pays cibles.
// Un pays sans ville est parcouru en entier ; un pays avec une ou plusieurs
// villes n'est parcouru qu'autour de celles-ci (rayon commun du profil).
// Module partagé client/serveur : aucune dépendance Node ici.

export type TargetCity = { city: string; country: string };

/** Rayons proposés (km). 0 = la ville seule, sans ses alentours. */
export const CITY_RADIUS_OPTIONS = [0, 10, 20, 30, 50] as const;
export const DEFAULT_CITY_RADIUS_KM = 20;
export const MAX_TARGET_CITIES = 20;

export function normalizePlace(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[-'’_]/g, " ")
    .replace(/\bst\b/g, "saint")
    .replace(/\bste\b/g, "sainte")
    .replace(/\s+/g, " ")
    .trim();
}

export function sameCity(a: TargetCity, b: TargetCity): boolean {
  return normalizePlace(a.city) === normalizePlace(b.city) && normalizePlace(a.country) === normalizePlace(b.country);
}

/** Villes rattachées à un pays (comparaison sans accents ni casse). */
export function citiesForCountry<T extends TargetCity>(cities: T[], country: string): T[] {
  const c = normalizePlace(country);
  return cities.filter((x) => normalizePlace(x.country) === c);
}

/** Ne garde que les villes dont le pays est encore ciblé. */
export function keepCitiesOfCountries<T extends TargetCity>(cities: T[], countries: string[]): T[] {
  const set = new Set(countries.map(normalizePlace));
  return cities.filter((x) => set.has(normalizePlace(x.country)));
}

/**
 * Le libellé de lieu d'une offre désigne-t-il l'une des villes ?
 * Mot entier, sans accents : « Paris 15e Arrondissement », « 69 - LYON » ou
 * « Lyon, Auvergne-Rhône-Alpes » correspondent ; « Lyons-la-Forêt » non.
 */
export function locationMatchesCities(
  location: string | null | undefined,
  cities: (TargetCity & { label?: string })[]
): boolean {
  const loc = ` ${normalizePlace(location).replace(/[^a-z0-9]+/g, " ")} `;
  if (!loc.trim()) return false;
  return cities.some((c) =>
    [c.city, c.label].some((n) => {
      const name = normalizePlace(n).replace(/[^a-z0-9]+/g, " ").trim();
      return !!name && loc.includes(` ${name} `);
    })
  );
}

/**
 * Ville d'une offre à partir de son libellé de lieu, pour le filtre « Ville » :
 * « 69 - LYON 03 », « Lyon 2e Arrondissement », « Lyon, Auvergne-Rhône-Alpes,
 * France » donnent tous la clé « lyon ». Département seul (« 69 »), pays ou
 * libellé vide : null. `label` est le libellé nettoyé tel qu'écrit par la source.
 */
export function cityFromLocation(location: string | null | undefined): { key: string; label: string } | null {
  let s = (location ?? "").replace(/\s+/g, " ").trim();
  s = s.split(/,|\s\/\s|\(/)[0];
  s = s
    .replace(/^\d{2,3}[AB]?\s*-\s*/i, "") // « 69 - LYON » (France Travail)
    .replace(/\s+-\s+\d{2,3}$/, "")
    .replace(/\s+cedex\b.*$/i, "")
    .replace(/\s+\d{1,2}\s*(?:e|er|ème|eme)?(?:\s+arrondissement)?$/i, "") // « Lyon 03 », « Paris 15e Arrondissement »
    .trim();
  if (!s || /^\d+$/.test(s)) return null;
  const key = normalizePlace(s);
  if (!key || COUNTRY_LIKE.has(key)) return null;
  return { key, label: s };
}

/** Libellés de lieu qui ne sont pas une ville. */
const COUNTRY_LIKE = new Set([
  "france", "belgique", "suisse", "luxembourg", "canada", "maroc", "tunisie", "senegal",
  "etats unis", "united states", "remote", "teletravail", "full remote", "europe",
]);

/** Libellé d'affichage préféré : accentué plutôt qu'en capitales sans accents. */
export function preferCityLabel(a: string, b: string): string {
  const rank = (s: string) => (/[^\x00-\x7f]/.test(s) ? 2 : 0) + (s !== s.toUpperCase() ? 1 : 0);
  return rank(b) > rank(a) ? b : a;
}

const LOWERCASE_PARTICLES = new Set(["de", "du", "des", "la", "le", "les", "et", "en", "sur", "sous", "aux", "au", "lès", "lez", "l", "d"]);

/** « SAINT-PRIEST » → « Saint-Priest », « CALUIRE ET CUIRE » → « Caluire et Cuire » ; un libellé déjà en casse mixte est gardé. */
export function displayCityLabel(label: string): string {
  if (label !== label.toUpperCase()) return label;
  return label
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{L}+)/gu, (_, sep: string, word: string) =>
      sep && LOWERCASE_PARTICLES.has(word) ? sep + word : sep + word[0].toUpperCase() + word.slice(1)
    );
}

export function radiusLabel(km: number): string {
  return km === 0 ? "Ville seule" : `${km} km`;
}
