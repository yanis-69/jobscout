import "server-only";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { currentUserId } from "./session-context";

/**
 * Résolution centralisée des emplacements de données utilisateur.
 *
 * En développement, tout vit dans `<projet>/data`.
 * En version installée, le launcher pose `JOBSCOUT_DATA_DIR` sur
 * `%LOCALAPPDATA%\JobScout` : le répertoire d'installation reste en lecture
 * seule et aucune donnée personnelle ne s'écrit à côté du binaire.
 */
export function userDataDir(): string {
  const explicit = process.env.JOBSCOUT_DATA_DIR?.trim();
  if (explicit) return path.resolve(explicit);
  return path.join(process.cwd(), "data");
}

/** Registre des comptes (noms d'utilisateur), commun à tous. */
export function accountsFile(): string {
  return path.join(userDataDir(), "accounts.json");
}

/** Dossier propre à un compte : sa base et ses documents. */
export function accountDir(userId: string): string {
  return path.join(userDataDir(), "users", userId);
}

/** Base de l'utilisateur connecté (lib/session-context.ts). */
export function dbPath(): string {
  return path.join(accountDir(currentUserId()), "jobscout.db");
}

/** Dossier de documents par défaut de l'utilisateur connecté (réglable dans Profil). */
export function documentsDir(): string {
  return path.join(accountDir(currentUserId()), "documents");
}

/**
 * Base unique d'avant les comptes (3.4.x) : `data/jobscout.db`, ou
 * JOBSCOUT_DB_PATH. Le premier compte créé en reçoit une copie
 * (lib/accounts.ts) ; l'original reste en place, en sauvegarde.
 */
export function legacyDbPath(): string {
  const explicit = process.env.JOBSCOUT_DB_PATH?.trim();
  if (explicit) return path.resolve(explicit);
  return path.join(userDataDir(), "jobscout.db");
}

/** Navigateurs Playwright (moteur LinkedIn) — téléchargés à la demande. */
export function browsersDir(): string {
  const explicit = process.env.PLAYWRIGHT_BROWSERS_PATH?.trim();
  if (explicit) return path.resolve(explicit);
  return path.join(userDataDir(), "browsers");
}

export function ensureDir(dir: string): string {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Racines dans lesquelles l'utilisateur a le droit de placer son dossier de
 * documents. On autorise son répertoire personnel et la racine de données de
 * l'application (les deux lui appartiennent), jamais un chemin système.
 */
export function writableRoots(): string[] {
  const roots = [userDataDir()];
  const home = envPath("USERPROFILE") || envPath("HOME");
  if (home) roots.push(home);
  return roots.map((r) => path.resolve(r));
}

/*
 * Chemins du poste lus de façon OPAQUE pour le traceur de fichiers de Next
 * (@vercel/nft) : au build, il évalue `process.env.X` et `os.homedir()` avec
 * les valeurs de la machine de build et, quand l'expression désigne un dossier
 * existant (profil, AppData\Local), il le parcourt en entier. Si le projet et
 * le profil sont sur deux lecteurs différents (runner Windows de GitHub
 * Actions, projet cloné sur D:), ce parcours échappe au filtre « hors du
 * projet » et le build plante sur la jonction protégée « Application Data »
 * (EPERM). Un appel de fonction avec paramètre, lui, n'est pas évalué.
 */

/** Variable d'environnement contenant un chemin (non vide), sinon undefined. */
export function envPath(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() ? value : undefined;
}

/** Appel indirect : le traceur n'évalue pas une fonction reçue en paramètre. */
function opaque<T>(fn: () => T): T {
  return fn();
}

/** Dossier personnel de l'utilisateur, suivi des segments donnés. */
export function homePath(...segments: string[]): string {
  return path.join(opaque(os.homedir), ...segments);
}

/**
 * Chemin de dossier saisi par l'utilisateur → chemin absolu, ou null s'il n'est
 * pas complet. « ~ » en tête désigne le dossier personnel (réflexe sous macOS et
 * Linux). Avant la 3.4.15, un chemin relatif — « ~/Documents/JobScout », ou sur
 * Mac un chemin Windows « C:\… » — était résolu DANS le dossier du projet, qui
 * recevait alors un dossier nommé « ~ ».
 */
export function resolveUserFolderInput(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  const expanded = /^~(?=[\\/]|$)/.test(text) ? path.join(homePath(), text.slice(1)) : text;
  return path.isAbsolute(expanded) ? path.resolve(expanded) : null;
}
