import { NextRequest, NextResponse } from "next/server";
import { AccountNameError, signIn } from "@/lib/accounts";
import { sessionCookie } from "@/lib/session";

export const runtime = "nodejs";

/** Connexion par nom d'utilisateur (sans mot de passe) : compte existant, sinon créé. */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { name?: unknown } | null;
  try {
    const { account, created, migrated } = signIn(body?.name);
    const res = NextResponse.json({ ok: true, account: { id: account.id, name: account.name }, created, migrated });
    res.cookies.set(sessionCookie(account.id));
    return res;
  } catch (e) {
    if (e instanceof AccountNameError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("[auth/login]", e);
    return NextResponse.json({ error: "Connexion impossible : réessayez." }, { status: 500 });
  }
}
