import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { accountDir, accountsFile, legacyDbPath } from "./paths";
import { ACCOUNT_ID_PATTERN } from "./session-context";

/**
 * Comptes locaux, identifiés par un nom d'utilisateur, sans mot de passe pour
 * l'instant. Chaque compte a son dossier (data/users/<id>/) avec sa base :
 * profil et CV, offres, candidatures, documents, clés API et réglages IA.
 * Le registre (data/accounts.json) ne contient que les noms.
 */
export type Account = {
  /** Nom de dossier dérivé du nom : « Yanis Ben » → « yanis-ben ». */
  id: string;
  /** Nom tel que saisi à la création. */
  name: string;
  created_at: string;
  last_login_at: string | null;
};

type Registry = { version: 1; accounts: Account[] };

export class AccountNameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccountNameError";
  }
}

function readRegistry(): Registry {
  try {
    const parsed = JSON.parse(fs.readFileSync(accountsFile(), "utf8")) as Partial<Registry>;
    const accounts = Array.isArray(parsed.accounts)
      ? parsed.accounts.filter((a): a is Account => !!a && typeof a.id === "string" && ACCOUNT_ID_PATTERN.test(a.id) && typeof a.name === "string")
      : [];
    return { version: 1, accounts };
  } catch {
    return { version: 1, accounts: [] };
  }
}

/** Écriture atomique : un fichier à moitié écrit ne doit jamais effacer les comptes. */
function writeRegistry(registry: Registry): void {
  const file = accountsFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 2), "utf8");
  fs.renameSync(tmp, file);
}

export function listAccounts(): Account[] {
  return readRegistry().accounts.sort((a, b) => (b.last_login_at ?? b.created_at).localeCompare(a.last_login_at ?? a.created_at));
}

export function findAccount(id: string | null | undefined): Account | null {
  if (!id || !ACCOUNT_ID_PATTERN.test(id)) return null;
  return readRegistry().accounts.find((a) => a.id === id) ?? null;
}

/** Nom saisi → nom propre et identifiant de dossier ; erreur en français si invalide. */
export function normalizeAccountName(raw: unknown): { name: string; id: string } {
  const name = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (name.length < 2) throw new AccountNameError("Le nom d'utilisateur doit compter au moins 2 caractères.");
  if (name.length > 40) throw new AccountNameError("Le nom d'utilisateur ne doit pas dépasser 40 caractères.");
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._'-]*$/u.test(name)) {
    throw new AccountNameError("Le nom d'utilisateur ne peut contenir que des lettres, des chiffres, des espaces et . _ ' -");
  }
  const id = name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");
  if (!ACCOUNT_ID_PATTERN.test(id)) {
    throw new AccountNameError("Ce nom d'utilisateur doit contenir au moins une lettre ou un chiffre latin (a-z, 0-9).");
  }
  return { name, id };
}

/**
 * Connexion par nom : compte existant (même nom, sans tenir compte de la casse
 * ni des accents), sinon création. Le premier compte créé reprend une copie des
 * données d'avant les comptes, s'il y en a.
 */
export function signIn(rawName: unknown): { account: Account; created: boolean; migrated: boolean } {
  const { name, id } = normalizeAccountName(rawName);
  const registry = readRegistry();
  const now = new Date().toISOString();
  const existing = registry.accounts.find((a) => a.id === id);
  if (existing) {
    existing.last_login_at = now;
    writeRegistry(registry);
    return { account: existing, created: false, migrated: false };
  }
  const account: Account = { id, name, created_at: now, last_login_at: now };
  fs.mkdirSync(accountDir(id), { recursive: true });
  const migrated = registry.accounts.length === 0 && adoptLegacyData(id);
  registry.accounts.push(account);
  writeRegistry(registry);
  return { account, created: true, migrated };
}

/**
 * Copie cohérente de l'ancienne base unique (data/jobscout.db) vers le compte,
 * par VACUUM INTO (journal WAL compris). L'original n'est pas modifié. Les
 * documents déjà générés restent où ils sont : la base copiée garde leurs
 * chemins, ils restent téléchargeables ; les nouveaux vont dans le dossier du
 * compte. Rien à reprendre (pas de base, ou base sans profil) : false.
 */
export function adoptLegacyData(id: string): boolean {
  const source = legacyDbPath();
  const target = path.join(accountDir(id), "jobscout.db");
  if (!fs.existsSync(source) || fs.existsSync(target)) return false;
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(source);
    const hasProfile = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'profile'").get()
      && db.prepare("SELECT 1 FROM profile LIMIT 1").get();
    if (!hasProfile) return false;
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
    return true;
  } catch (e) {
    console.error("[accounts] reprise des données existantes impossible :", e);
    try {
      fs.rmSync(target, { force: true });
    } catch {}
    return false;
  } finally {
    db?.close();
  }
}
