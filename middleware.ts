import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/session-cookie";

/**
 * Garde-fou de l'application locale. JobScout écoute uniquement sur la machine,
 * et son API ne doit répondre qu'à l'application elle-même.
 *
 * - Session (3.5) : sans cookie de session, toute route de l'API répond 401,
 *   sauf /api/auth/* (les pages redirigent vers /login, voir lib/session.ts).
 * - En-tête Host : uniquement localhost / 127.0.0.1 / [::1]. Bloque le
 *   « DNS rebinding » (un site qui fait pointer son propre nom vers 127.0.0.1
 *   pour lire le profil ou les candidatures).
 * - Sec-Fetch-Site : un navigateur l'envoie toujours ; seules les requêtes de
 *   la même origine (ou tapées dans la barre d'adresse) passent. Un site
 *   ouvert dans un autre onglet ne peut donc ni lancer un scan, ni écraser le
 *   profil, ni consommer la clé API par une génération.
 * - Origin (requêtes qui modifient) : si présent, il doit être local et
 *   correspondre au Host.
 *
 * Les scripts locaux (ligne de commande, recette d'installation) n'envoient ni
 * Origin ni Sec-Fetch-Site : ils passent, tant qu'ils visent un hôte local.
 */
export const config = { matcher: "/api/:path*" };

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

function hostnameOf(hostHeader: string): string {
  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function forbidden(reason: string): NextResponse {
  return NextResponse.json({ error: `Requête refusée (${reason}).` }, { status: 403 });
}

export function middleware(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  if (!LOCAL_HOSTNAMES.has(hostnameOf(host))) return forbidden("hôte non local");

  const refused = apiOriginCheck(req, host);
  if (refused) return refused;

  // Comptes (3.5) : API sans session → 401. Le cookie n'est ici que présent ;
  // withUser() (lib/session.ts) vérifie qu'il désigne un compte existant.
  // Les pages, elles, redirigent vers /login côté serveur (userScope() et
  // requireAccount() dans les mises en page) : une redirection émise ici
  // passerait par req.url, où Next remplace 127.0.0.1 par localhost, et le
  // cookie posé sur l'un n'est pas envoyé à l'autre.
  if (!req.nextUrl.pathname.startsWith("/api/auth/") && !req.cookies.get(SESSION_COOKIE)?.value) {
    return NextResponse.json({ error: "Aucun utilisateur connecté : reconnectez-vous." }, { status: 401 });
  }
  return NextResponse.next();
}

/** Un site ouvert dans un autre onglet ne peut pas appeler l'API (scan, profil, génération). */
function apiOriginCheck(req: NextRequest, host: string): NextResponse | null {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return forbidden("origine externe");

  const method = req.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const origin = req.headers.get("origin");
    if (origin) {
      let o: URL;
      try {
        o = new URL(origin);
      } catch {
        return forbidden("origine invalide");
      }
      if (!LOCAL_HOSTNAMES.has(o.hostname.toLowerCase()) || o.host.toLowerCase() !== host.toLowerCase()) {
        return forbidden("origine externe");
      }
    }
  }
  return null;
}
