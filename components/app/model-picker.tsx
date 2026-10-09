"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { dossierCostAlone, formatTokens, formatUsd, type ModelInfo } from "@/lib/ai/model-catalog";

/**
 * Champ « modèle » avec la liste complète des modèles du fournisseur.
 * Remplace un <datalist> : le navigateur n'y montrait que les modèles dont le
 * nom contient le texte du champ (3 sur 62 avec « gemini-3.8-flash » saisi).
 * Ici, la liste s'ouvre entière ; elle ne se filtre que sur ce que l'on tape.
 * Le nom reste modifiable à la main (modèle absent de la liste).
 */
export function ModelPicker({
  value,
  onChange,
  models,
  placeholder,
}: {
  value: string;
  onChange: (id: string) => void;
  models: ModelInfo[];
  placeholder?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [active, setActive] = useState(0);
  const wrapper = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const hidden = models.filter((m) => !m.textCapable).length;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return models.filter(
      (m) => (showAll || m.textCapable || m.id === value) && (!q || m.id.toLowerCase().includes(q) || (m.label ?? "").toLowerCase().includes(q))
    );
  }, [models, query, showAll, value]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function openList() {
    // Ouverture : liste entière, positionnée sur le modèle choisi.
    setQuery("");
    setOpen(true);
    const i = models.filter((m) => showAll || m.textCapable || m.id === value).findIndex((m) => m.id === value);
    setActive(Math.max(0, i));
  }

  function pick(id: string) {
    onChange(id);
    setQuery("");
    setOpen(false);
  }

  return (
    <div ref={wrapper} className="relative mt-1">
      <div className="relative">
        <input
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && visible[active] ? `${listId}-${active}` : undefined}
          className="glass-inset h-11 w-full rounded-md pl-3 pr-10 text-body text-text placeholder:text-textSecondary transition-all duration-150 focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/15"
          value={value}
          placeholder={placeholder}
          spellCheck={false}
          autoComplete="off"
          onFocus={() => models.length && openList()}
          onBlur={(e) => {
            if (!wrapper.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
          }}
          onClick={() => models.length && !open && openList()}
          onChange={(e) => {
            onChange(e.target.value);
            setQuery(e.target.value);
            setActive(0);
            if (models.length) setOpen(true);
          }}
          onKeyDown={(e) => {
            if (!models.length) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              if (!open) openList();
              else setActive((i) => Math.min(visible.length - 1, i + 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === "Enter" && open && visible[active]) {
              e.preventDefault();
              pick(visible[active].id);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {models.length > 0 && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={open ? "Fermer la liste des modèles" : "Ouvrir la liste des modèles"}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => (open ? setOpen(false) : openList())}
            className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-md text-textSecondary hover:text-text"
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-md border border-border bg-surface shadow-lg sm:min-w-[420px]">
          <p className="border-b border-border px-3 py-2 text-caption text-textSecondary">
            {visible.length} modèle{visible.length > 1 ? "s" : ""}
            {query ? ` contenant « ${query} »` : ""} · prix en $ par million de jetons (entrée / sortie)
          </p>
          <ul id={listId} ref={listRef} role="listbox" className="max-h-80 overflow-y-auto py-1">
            {visible.map((m, i) => (
              <li
                key={m.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={m.id === value}
                data-index={i}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(m.id)}
                onMouseEnter={() => setActive(i)}
                className={cn("cursor-pointer px-3 py-2", i === active && "bg-surfaceHover", m.id === value && "border-l-2 border-accent")}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-small font-semibold text-text">{m.id}</span>
                  {m.label && m.label !== m.id && <span className="shrink-0 text-caption text-textSecondary">{m.label}</span>}
                </div>
                <ModelMeta model={m} />
              </li>
            ))}
          </ul>
          {visible.length === 0 && (
            <p className="px-3 pb-3 text-small text-textSecondary">Aucun modèle de la liste ne contient « {query} » : le nom saisi sera utilisé tel quel.</p>
          )}
          {hidden > 0 && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setShowAll((v) => !v)}
              className="w-full border-t border-border px-3 py-2 text-left text-caption font-semibold text-accent hover:underline"
            >
              {showAll ? `Masquer les ${hidden} modèles qui ne rédigent pas de texte` : `Afficher aussi ${hidden} modèles qui ne rédigent pas de texte (voix, image, vidéo…)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Ligne d'informations d'un modèle : jetons, prix, coût d'un dossier, offre gratuite. */
export function ModelMeta({ model, className }: { model: ModelInfo; className?: string }) {
  const parts: string[] = [];
  const inTok = formatTokens(model.inputTokens);
  const outTok = formatTokens(model.outputTokens);
  if (inTok || outTok) parts.push(`max ${inTok ?? "?"} jetons en entrée · ${outTok ?? "?"} en sortie`);
  if (model.priceIn != null && model.priceOut != null) {
    parts.push(`${formatUsd(model.priceIn)} / ${formatUsd(model.priceOut)}`);
    const cost = dossierCostAlone(model);
    if (cost != null) parts.push(`≈ ${formatUsd(cost)} par dossier`);
  } else {
    parts.push("prix non communiqué");
  }
  if (model.freeTier) parts.push("offre gratuite possible");
  if (!model.textCapable) parts.push("ne rédige pas de texte");
  return <p className={cn("mt-0.5 text-caption text-textSecondary", className)}>{parts.join(" · ")}</p>;
}
