import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Utilisateur de la requête en cours.
 *
 * Chaque utilisateur a sa propre base et son propre dossier de documents
 * (lib/paths.ts). getDb() et les chemins lisent l'utilisateur ici, sans qu'il
 * faille le passer à chaque fonction : les routes de l'API passent par
 * withUser() et les pages par userScope() (lib/session.ts), qui exécutent tout
 * le traitement « en tant que » l'utilisateur du cookie de session. Le contexte
 * suit les attentes asynchrones : un scan qui continue après la fermeture de
 * l'onglet reste dans la base de son utilisateur.
 */
const storage = new AsyncLocalStorage<string>();

/** Identifiant de compte valide : sert de nom de dossier, jamais de chemin. */
export const ACCOUNT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/;

export class NoUserError extends Error {
  constructor() {
    super("Aucun utilisateur connecté : reconnectez-vous.");
    this.name = "NoUserError";
  }
}

export function runAsUser<T>(userId: string, fn: () => T): T {
  if (!ACCOUNT_ID_PATTERN.test(userId)) throw new NoUserError();
  return storage.run(userId, fn);
}

/**
 * Utilisateur courant. Hors requête (tests, scripts), JOBSCOUT_DEFAULT_USER en
 * tient lieu ; sinon l'accès est refusé plutôt que de toucher la base d'un autre.
 */
export function currentUserId(): string {
  const id = storage.getStore() ?? process.env.JOBSCOUT_DEFAULT_USER?.trim();
  if (!id || !ACCOUNT_ID_PATTERN.test(id)) throw new NoUserError();
  return id;
}
