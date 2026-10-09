"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import {
  CITY_RADIUS_OPTIONS,
  MAX_TARGET_CITIES,
  keepCitiesOfCountries,
  normalizePlace,
  radiusLabel,
  sameCity,
  type TargetCity,
} from "@/lib/cities";

/**
 * Villes cibles, facultatives : un pays sans ville est parcouru en entier, un
 * pays avec des villes seulement autour d'elles. Les villes d'un pays retiré
 * des pays cibles ne sont ni affichées ni utilisées par le scan.
 */
export function CityPicker({
  countries,
  cities,
  radiusKm,
  onChange,
  compact = false,
}: {
  countries: string[];
  cities: TargetCity[];
  radiusKm: number;
  onChange: (patch: { target_cities?: TargetCity[]; city_radius_km?: number }) => void;
  compact?: boolean;
}) {
  const [input, setInput] = useState("");
  const [picked, setPicked] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const country =
    countries.find((c) => c === picked) ??
    countries.find((c) => normalizePlace(c) === "france") ??
    countries[0] ??
    "";
  const visible = keepCitiesOfCountries(cities, countries);
  const showCountry = countries.length > 1;

  const add = () => {
    const city = input.trim().replace(/\s+/g, " ");
    if (!city || !country) return;
    const entry = { city, country };
    if (cities.some((c) => sameCity(c, entry))) {
      setInput("");
      return;
    }
    if (visible.length >= MAX_TARGET_CITIES) {
      setError(`${MAX_TARGET_CITIES} villes au maximum.`);
      return;
    }
    setError(null);
    onChange({ target_cities: [...cities, entry] });
    setInput("");
  };

  const remove = (entry: TargetCity) =>
    onChange({ target_cities: cities.filter((c) => !sameCity(c, entry)) });

  const Label = compact ? "p" : "h3";
  return (
    <div>
      <Label className={compact ? "text-caption uppercase text-textSecondary mb-2" : "text-body font-semibold mb-1"}>
        Villes {compact ? `(${visible.length})` : "(facultatif)"}
      </Label>
      <p className="text-small text-textSecondary mb-2">
        Sans ville, tout le pays est parcouru. Avec une ou plusieurs villes, le scan de ce pays se limite à leurs alentours.
      </p>

      {visible.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {visible.map((c) => (
            <Chip key={`${c.country}|${c.city}`} active onRemove={() => remove(c)}>
              {showCountry ? `${c.city} · ${c.country}` : c.city}
            </Chip>
          ))}
        </div>
      )}

      {countries.length === 0 ? (
        <p className="text-small text-textSecondary">Choisissez d'abord un pays.</p>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          {showCountry && (
            <select
              value={country}
              onChange={(e) => setPicked(e.target.value)}
              aria-label="Pays de la ville"
              className="glass-inset h-11 rounded-md px-3 text-body text-text focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/15 sm:w-48"
            >
              {countries.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
          <div className="flex flex-1 gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ex. Lyon, Bordeaux, Lille…"
              aria-label={`Ville en ${country}`}
              maxLength={80}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())}
            />
            <Button variant="secondary" size={compact ? "sm" : undefined} onClick={add} aria-label="Ajouter la ville">
              <Plus className="h-4 w-4" />
              {!compact && " Ajouter"}
            </Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-small text-danger">{error}</p>}

      {visible.length > 0 && (
        <div className="mt-3">
          <p className="text-caption uppercase text-textSecondary mb-2">Autour des villes</p>
          <div className="flex flex-wrap gap-1.5">
            {CITY_RADIUS_OPTIONS.map((km) => (
              <Chip key={km} active={radiusKm === km} onClick={() => onChange({ city_radius_km: km })}>
                {radiusLabel(km)}
              </Chip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
