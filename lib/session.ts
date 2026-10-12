import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse, type NextRequest } from "next/server";
import { findAccount, type Account } from "./accounts";
import { runAsUser } from "./session-context";

import { SESSION_COOKIE } from "./session-cookie";

/** Cookie de session : identifiant du compte connecté (pas de mot de passe pour l'instant). */
export { SESSION_COOKIE };
const ONE_YEAR = 60 * 60 * 24 * 365;

export function sessionCookie(id: string) {
  return {
    name: SESSION_COOKIE,
    value: id,
    httpOnly: true,
    sameSite: "strict" as const,
    path: "/",
    maxAge: ONE_YEAR,
  };
}

/**
 * Route de l'API exécutée en tant que l'utilisateur du cookie : sa base, ses
 * documents, ses clés. Sans session valide : 401, rien n'est lu ni écrit.
 * Toutes les routes sauf /api/auth/* doivent passer par ici (test dédié).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withUser<A extends any[]>(handler: (req: NextRequest, ...rest: A) => Response | Promise<Response>) {
  return async (req: NextRequest, ...rest: A): Promise<Response> => {
    const account = findAccount(req.cookies.get(SESSION_COOKIE)?.value);
    if (!account) {
      return NextResponse.json({ error: "Session expirée ou utilisateur inconnu : reconnectez-vous." }, { status: 401 });
    }
    return runAsUser(account.id, () => handler(req, ...rest));
  };
}

/** Compte connecté d'après le cookie, ou redirection vers /login. */
export async function requireAccount(): Promise<Account> {
  const store = await cookies();
  const account = findAccount(store.get(SESSION_COOKIE)?.value);
  if (!account) redirect("/login");
  return account;
}

/**
 * Page rendue en tant que l'utilisateur connecté : tout ce que `fn` lit en base
 * (directement ou après des await) vient de sa base. Les composants serveur
 * enfants ne doivent pas lire la base eux-mêmes : leurs données sont lues ici
 * et passées en props.
 */
export async function userScope<T>(fn: (account: Account) => T | Promise<T>): Promise<T> {
  const account = await requireAccount();
  return runAsUser(account.id, () => fn(account));
}
