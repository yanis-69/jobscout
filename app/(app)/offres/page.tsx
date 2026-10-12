import { offresCounts, parseMinScore, searchOffres } from "@/lib/db/offres";
import { PageHeader } from "@/components/app/page-header";
import { OffresList } from "./list";
import { ScanButton } from "./scan-button";
import { userScope } from "@/lib/session";

export const dynamic = "force-dynamic";

const numberFormat = new Intl.NumberFormat("fr-FR");

function plural(count: number, word: string): string {
  return `${numberFormat.format(count)} ${word}${count > 1 ? "s" : ""}`;
}

async function OffresPageContent({ searchParams }: { searchParams: Promise<{ vie?: string; score?: string }> }) {
  const { vie, score } = await searchParams;
  const vieOnly = vie === "1";
  // ?score=70 (carte « Offres à 70 et plus » de l'accueil) active la puce de score à ce seuil.
  const minScore = parseMinScore(score);
  // Même requête que celle de la liste côté navigateur : ?vie=1 coche la puce contrat « V.I.E ».
  const initial = searchOffres({ contracts: vieOnly ? ["vie"] : [], minScore });
  // Total et V.I.E lus dans les facettes (sans le filtre de score, pour décrire la base) : mêmes chiffres que la liste et la puce « V.I.E ».
  const { total, contractCounts } = initial.facets;
  const subtitle = [
    plural(total, "offre"),
    `${numberFormat.format(offresCounts().today)} aujourd'hui`,
    ...(contractCounts.vie > 0 ? [`${numberFormat.format(contractCounts.vie)} V.I.E`] : []),
  ].join(" · ");

  return (
    <>
      <PageHeader
        eyebrow="Découvrir"
        title="Vos prochaines opportunités"
        subtitle={subtitle}
        actions={<ScanButton />}
      />
      <OffresList initialResult={initial} initialVieOnly={vieOnly} initialMinScore={minScore} />
    </>
  );
}

// Rendue en tant que l'utilisateur connecté (lib/session.ts), sinon redirection vers /login.
export default async function OffresPage(props: Parameters<typeof OffresPageContent>[0]) {
  return userScope(() => OffresPageContent(props));
}
