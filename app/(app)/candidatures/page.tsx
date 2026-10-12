import { listCandidatures, candidaturesCounts } from "@/lib/db/candidatures";
import { PageHeader } from "@/components/app/page-header";
import { CandidaturesTable } from "./table";
import { userScope } from "@/lib/session";

export const dynamic = "force-dynamic";

async function CandidaturesPageContent() {
  const items = listCandidatures();
  const { upcoming } = candidaturesCounts();
  const inProgress = items.filter((item) => item.status === "en_cours").length;
  // Sous-titre chiffré (comme en 3.4.10) plutôt qu'un slogan.
  const subtitle = items.length
    ? `${items.length} candidature${items.length > 1 ? "s" : ""} · ${inProgress} en préparation · ${upcoming ? `${upcoming} échéance${upcoming > 1 ? "s" : ""} à venir` : "aucune échéance à venir"}`
    : "Aucune candidature suivie pour l'instant.";
  return (
    <>
      <PageHeader eyebrow="Faire avancer" title="Candidatures" subtitle={subtitle} />
      <CandidaturesTable initial={items} />
    </>
  );
}

// Rendue en tant que l'utilisateur connecté (lib/session.ts), sinon redirection vers /login.
export default async function CandidaturesPage() {
  return userScope(() => CandidaturesPageContent());
}
