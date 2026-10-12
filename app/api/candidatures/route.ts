import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/session";
import {
  listCandidatures,
  createCandidature,
  updateCandidature,
  deleteCandidature,
  STATUS,
} from "@/lib/db/candidatures";

export const runtime = "nodejs";

async function handleGET() {
  return NextResponse.json({ candidatures: listCandidatures() });
}

async function handlePOST(req: NextRequest) {
  const body = await req.json();
  if (body?.status != null && !STATUS.includes(body.status)) {
    return NextResponse.json({ error: "statut invalide" }, { status: 400 });
  }
  const id = createCandidature(body);
  return NextResponse.json({ id, ok: true });
}

async function handlePATCH(req: NextRequest) {
  const body = await req.json();
  const { id, ...patch } = body;
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  if (patch.status && !STATUS.includes(patch.status)) {
    return NextResponse.json({ error: "statut invalide" }, { status: 400 });
  }
  updateCandidature(Number(id), patch);
  return NextResponse.json({ ok: true });
}

async function handleDELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = Number(searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  deleteCandidature(id);
  return NextResponse.json({ ok: true });
}

// Exécutées en tant que l'utilisateur connecté (lib/session.ts).
export const GET = withUser(handleGET);
export const POST = withUser(handlePOST);
export const PATCH = withUser(handlePATCH);
export const DELETE = withUser(handleDELETE);
