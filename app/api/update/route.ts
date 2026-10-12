import { NextResponse } from "next/server";
import { getUpdateStatus } from "@/lib/update/check";
import { withUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Version courante + disponibilité d'une mise à jour.
 * Le résultat distant est mis en cache pour toute la durée de vie du process :
 * une seule requête réseau par démarrage.
 */
async function handleGET() {
  return NextResponse.json(await getUpdateStatus());
}

// Exécutées en tant que l'utilisateur connecté (lib/session.ts).
export const GET = withUser(handleGET);
