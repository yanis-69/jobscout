import Link from "next/link";
import { ArrowRight, ArrowUpRight, Download, FileText, FolderOpen, Mail, MessageSquare } from "lucide-react";
import { listDocuments, type DocumentRow } from "@/lib/db/documents";
import { getDb } from "@/lib/db";
import { PageHeader } from "@/components/app/page-header";
import path from "node:path";
import { userScope } from "@/lib/session";

export const dynamic = "force-dynamic";

type Dossier = { key: string; offreId: number | null; title: string; company: string | null; docs: DocumentRow[]; latest: string };
const TYPE_LABELS = { cv: "CV", lm: "Lettre de motivation", msg: "Message V.I.E" } as const;
const TYPE_ICONS = { cv: FileText, lm: Mail, msg: MessageSquare } as const;

function displayDate(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value.slice(0, 10) : date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

async function DocumentsPageContent() {
  const docs = listDocuments();
  const ids = [...new Set(docs.map((doc) => doc.offre_id).filter((id): id is number => id != null))];
  const offerRows = ids.length ? getDb().prepare(`SELECT id, title, company FROM offres WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids) as { id: number; title: string; company: string }[] : [];
  const offers = new Map(offerRows.map((offer) => [offer.id, offer]));
  const dossierMap = new Map<string, Dossier>();

  for (const doc of docs) {
    const offer = doc.offre_id ? offers.get(doc.offre_id) : null;
    const key = offer ? `offer:${doc.offre_id}` : `file:${doc.id}`;
    if (!dossierMap.has(key)) dossierMap.set(key, {
      key,
      offreId: offer?.id ?? null,
      title: offer?.title || path.basename(doc.file_path),
      // `||` et non `??` : des offres ont une entreprise vide (chaîne ""), pas NULL.
      company: offer?.company || null,
      docs: [],
      latest: doc.generated_at,
    });
    dossierMap.get(key)!.docs.push(doc);
  }
  const dossiers = [...dossierMap.values()].sort((a, b) => b.latest.localeCompare(a.latest));
  // Sous-titre daté plutôt qu'un slogan ; les compteurs sont dans le bandeau juste en dessous.
  const subtitle = dossiers.length
    ? `Classés par offre, du plus récent au plus ancien · dernière génération le ${displayDate(dossiers[0].latest)}`
    : "Aucun document généré pour l'instant.";

  return (
    <>
      <PageHeader eyebrow="Préparer" title="Vos dossiers" subtitle={subtitle} />
      <div className="glass-panel mb-7 flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4 text-small text-textSecondary">
        <span className="brand-mark mr-1 h-10 w-10 rounded-[14px]"><FolderOpen className="h-5 w-5" strokeWidth={1.5} /></span>
        <span><strong className="text-text tabular-nums">{dossiers.length}</strong> dossier{dossiers.length > 1 ? "s" : ""}</span>
        <span><strong className="text-text tabular-nums">{docs.length}</strong> fichier{docs.length > 1 ? "s" : ""}</span>
        <span>Formats Word et PDF téléchargeables séparément</span>
      </div>

      {dossiers.length === 0 ? (
        <div className="glass-panel px-6 py-16 text-center">
          <FolderOpen className="mx-auto mb-4 h-9 w-9 text-accent" />
          <h2 className="font-display text-h2">Vos dossiers apparaîtront ici</h2>
          <p className="mx-auto mt-2 max-w-[45ch] text-body text-textSecondary">Choisissez une offre et générez un CV ou une lettre. Les fichiers seront réunis par poste.</p>
          <Link href="/offres" className="mt-5 inline-flex items-center gap-1 text-small font-semibold text-accent hover:underline">Explorer les offres <ArrowRight className="h-4 w-4" /></Link>
        </div>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          {dossiers.map((dossier) => <DossierCard key={dossier.key} dossier={dossier} />)}
        </div>
      )}
    </>
  );
}

function DossierCard({ dossier }: { dossier: Dossier }) {
  const types = (["cv", "lm", "msg"] as const).map((type) => ({ type, docs: dossier.docs.filter((doc) => doc.type === type) })).filter((group) => group.docs.length);
  return (
    <article className="glass-panel overflow-hidden">
      <div className="relative border-b border-border px-5 py-6 sm:px-6">
        <span className="brand-mark mb-5 h-12 w-12 rounded-[16px]"><FolderOpen className="h-6 w-6" strokeWidth={1.25} /></span>
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-textSecondary">{dossier.offreId != null ? dossier.company || "Entreprise non précisée" : "Document indépendant"}</p>
        {dossier.offreId ? (
          <Link href={`/offres/${dossier.offreId}`} className="group inline-flex items-start gap-2 font-display text-[22px] font-semibold leading-tight hover:text-accent">
            {dossier.title}<ArrowUpRight className="mt-1 h-4 w-4 shrink-0 opacity-50 group-hover:opacity-100" />
          </Link>
        ) : <h2 className="font-display text-[22px] font-semibold leading-tight">{dossier.title}</h2>}
        <p className="mt-2 text-small text-textSecondary">Dernière génération : <time dateTime={dossier.latest.slice(0, 10)}>{displayDate(dossier.latest)}</time></p>
      </div>
      <div className="divide-y divide-border px-5 sm:px-6">
        {types.map(({ type, docs }) => {
          const Icon = TYPE_ICONS[type];
          return (
            <div key={type} className="flex flex-wrap items-center gap-3 py-4">
              <span className="glass-inset flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] text-accent"><Icon className="h-4 w-4" strokeWidth={1.5} /></span>
              <span className="min-w-0 flex-1 text-small font-semibold">{TYPE_LABELS[type]}</span>
              <span className="flex items-center gap-2">
                {docs.map((doc) => <a key={doc.id} href={`/api/documents/${doc.id}`} download className="inline-flex h-10 items-center gap-1 rounded-md border border-border px-3 text-small font-semibold transition-colors hover:border-accent hover:text-accent" aria-label={`Télécharger ${TYPE_LABELS[type]} en ${doc.format.toUpperCase()}`}><Download className="h-3.5 w-3.5" /> {doc.format === "docx" ? "Word" : doc.format.toUpperCase()}</a>)}
              </span>
            </div>
          );
        })}
      </div>
    </article>
  );
}

// Rendue en tant que l'utilisateur connecté (lib/session.ts), sinon redirection vers /login.
export default async function DocumentsPage() {
  return userScope(() => DocumentsPageContent());
}
