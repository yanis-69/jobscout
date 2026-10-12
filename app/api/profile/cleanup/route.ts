import { NextRequest, NextResponse } from "next/server";
import { dedupProfile } from "@/lib/cv/merge";
import { getProfile, saveProfile } from "@/lib/db/queries";
import { withUser } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Two-step:
 *   - GET → preview (returns the report without saving)
 *   - POST → apply (saves the cleaned profile)
 */
async function handleGET() {
  const current = getProfile();
  if (!current) return NextResponse.json({ error: "Aucun profil" }, { status: 400 });
  const { report } = dedupProfile(current);
  return NextResponse.json({ report });
}

async function handlePOST(_req: NextRequest) {
  const current = getProfile();
  if (!current) return NextResponse.json({ error: "Aucun profil" }, { status: 400 });
  const { profile, report } = dedupProfile(current);
  saveProfile(profile);
  return NextResponse.json({ ok: true, report });
}

// Exécutées en tant que l'utilisateur connecté (lib/session.ts).
export const GET = withUser(handleGET);
export const POST = withUser(handlePOST);
