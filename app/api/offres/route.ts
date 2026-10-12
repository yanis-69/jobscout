import { NextRequest, NextResponse } from "next/server";
import { listOffres, offresCounts } from "@/lib/db/offres";
import { withUser } from "@/lib/session";

export const runtime = "nodejs";

async function handleGET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const country = searchParams.get("country") || undefined;
  const source = searchParams.get("source") || undefined;
  const vieOnly = searchParams.get("vie") === "1";
  const minScore = searchParams.get("minScore") ? Number(searchParams.get("minScore")) : undefined;
  const offres = listOffres({ country, source, vieOnly, minScore });
  const counts = offresCounts();
  return NextResponse.json({ offres, counts });
}

// Exécutées en tant que l'utilisateur connecté (lib/session.ts).
export const GET = withUser(handleGET);
