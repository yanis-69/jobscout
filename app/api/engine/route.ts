import { NextResponse } from "next/server";
import { withUser } from "@/lib/session";
import {
  getEngineState,
  startEngineInstall,
  ENGINE_LABEL,
  ENGINE_SIZE_LABEL,
  ENGINE_DISK_SIZE_LABEL,
} from "@/lib/scrapers/browser-engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** État du moteur de navigation optionnel (Chromium, requis par LinkedIn). */
async function handleGET() {
  return NextResponse.json({
    ...getEngineState(),
    label: ENGINE_LABEL,
    size: ENGINE_SIZE_LABEL,
    diskSize: ENGINE_DISK_SIZE_LABEL,
  });
}

/** Démarre le téléchargement du moteur. Non bloquant : l'UI interroge GET. */
async function handlePOST() {
  const res = startEngineInstall();
  return NextResponse.json({ ...res, ...getEngineState() });
}

// Exécutées en tant que l'utilisateur connecté (lib/session.ts).
export const GET = withUser(handleGET);
export const POST = withUser(handlePOST);
