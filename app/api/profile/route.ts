import { NextRequest, NextResponse } from "next/server";
import { saveProfile, getProfile } from "@/lib/db/queries";
import { setSetting } from "@/lib/db";
import { ProfileFullSchema } from "@/lib/cv/types";
import { withUser } from "@/lib/session";

export const runtime = "nodejs";

async function handleGET() {
  return NextResponse.json({ profile: getProfile() });
}

async function handlePOST(req: NextRequest) {
  const body = await req.json();
  const parsed = ProfileFullSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Profil invalide", details: parsed.error.flatten() }, { status: 400 });
  }
  const id = saveProfile(parsed.data);
  setSetting("has_completed_onboarding", "true");
  return NextResponse.json({ id, ok: true });
}

// Exécutées en tant que l'utilisateur connecté (lib/session.ts).
export const GET = withUser(handleGET);
export const POST = withUser(handlePOST);
