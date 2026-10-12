import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { findAccount, listAccounts, normalizeAccountName, signIn } from "@/lib/accounts";
import { accountDir, dbPath, documentsDir, legacyDbPath } from "@/lib/paths";
import { currentUserId, NoUserError, runAsUser } from "@/lib/session-context";
import { withUser } from "@/lib/session";
import { getProfile, saveProfile } from "@/lib/db/queries";
import { getSetting, setSetting } from "@/lib/db";
import { searchOffres, upsertOffreFromSource } from "@/lib/db/offres";
import { middleware } from "@/middleware";
import { profile } from "./fixtures";

/**
 * Comptes locaux (nom d'utilisateur, sans mot de passe) : une base et un dossier
 * de documents par utilisateur, session par cookie. Base temporaire (tests/setup.ts).
 */

const SCHEMA = fs.readFileSync(path.join(process.cwd(), "lib", "db", "schema.sql"), "utf8");

describe("reprise des données d'avant les comptes", () => {
  // Premier test du fichier : le registre des comptes est encore vide.
  it("le premier compte reçoit une copie de l'ancienne base, l'original reste en place", () => {
    const legacy = new DatabaseSync(legacyDbPath());
    legacy.exec(SCHEMA);
    legacy.prepare("INSERT INTO profile (full_name, email) VALUES (?, ?)").run("Ancien Profil", "ancien@example.org");
    legacy.prepare("INSERT INTO settings (key, value) VALUES ('llm:provider', 'gemini')").run();
    legacy.close();

    const first = signIn("Yanis");
    expect(first).toMatchObject({ created: true, migrated: true, account: { id: "yanis", name: "Yanis" } });
    const copy = path.join(accountDir("yanis"), "jobscout.db");
    expect(fs.existsSync(copy)).toBe(true);
    expect(fs.existsSync(legacyDbPath())).toBe(true);
    runAsUser("yanis", () => {
      expect(getProfile()?.full_name).toBe("Ancien Profil");
      expect(getSetting("llm:provider")).toBe("gemini");
    });

    // Le deuxième compte part d'une base vide.
    const second = signIn("Camille");
    expect(second).toMatchObject({ created: true, migrated: false });
    runAsUser("camille", () => expect(getProfile()).toBeNull());
  });
});

describe("noms d'utilisateur", () => {
  it("identifiant de dossier sans accents ni espaces", () => {
    expect(normalizeAccountName("  Élodie   Martin ")).toEqual({ name: "Élodie Martin", id: "elodie-martin" });
    expect(normalizeAccountName("jean_paul.2")).toEqual({ name: "jean_paul.2", id: "jean-paul-2" });
  });

  it("refuse les noms vides, trop longs, à caractères spéciaux ou de chemin", () => {
    for (const bad of ["", "a", "x".repeat(41), "../admin", "nom/avec/slash", "<script>", "日本"]) {
      expect(() => normalizeAccountName(bad), bad).toThrow();
    }
  });

  it("un nom déjà pris ouvre le même compte, sans tenir compte de la casse ni des accents", () => {
    const a = signIn("Zoé Durand");
    const b = signIn("zoe durand");
    expect(a.created).toBe(true);
    expect(b).toMatchObject({ created: false, account: { id: "zoe-durand", name: "Zoé Durand" } });
    expect(listAccounts().filter((x) => x.id === "zoe-durand")).toHaveLength(1);
    expect(findAccount("../zoe-durand")).toBeNull();
  });
});

describe("isolation des données", () => {
  it("profil, réglages (clés API), offres et dossiers sont propres à chaque compte", () => {
    signIn("Alice");
    signIn("Bob");
    runAsUser("alice", () => {
      saveProfile({ ...profile, full_name: "Alice A." });
      setSetting("llm:key:gemini", "cle-alice");
      upsertOffreFromSource("hellowork", {
        source_id: "a-1", url: "https://example.org/1", title: "Offre d'Alice", company: "X", country: "France",
        location: "Lyon", contract_type: "CDI", salary: null, description_html: "<p>x</p>", description_text: "x",
        description_status: "ok", posted_at: null, is_vie: false, raw_payload: {},
      });
    });
    runAsUser("bob", () => {
      expect(getProfile()).toBeNull();
      expect(getSetting("llm:key:gemini")).toBeNull();
      expect(searchOffres().total).toBe(0);
      expect(dbPath()).toBe(path.join(accountDir("bob"), "jobscout.db"));
      expect(documentsDir()).toBe(path.join(accountDir("bob"), "documents"));
    });
    runAsUser("alice", () => {
      expect(getProfile()?.full_name).toBe("Alice A.");
      expect(getSetting("llm:key:gemini")).toBe("cle-alice");
      expect(searchOffres().total).toBe(1);
    });
  });

  it("le contexte suit les attentes asynchrones", async () => {
    const seen = await runAsUser("alice", async () => {
      await new Promise((r) => setTimeout(r, 5));
      return currentUserId();
    });
    expect(seen).toBe("alice");
  });

  it("hors requête et sans utilisateur par défaut : accès refusé", () => {
    const saved = process.env.JOBSCOUT_DEFAULT_USER;
    delete process.env.JOBSCOUT_DEFAULT_USER;
    try {
      expect(() => currentUserId()).toThrow(NoUserError);
      expect(() => runAsUser("../evil", () => 1)).toThrow(NoUserError);
    } finally {
      process.env.JOBSCOUT_DEFAULT_USER = saved;
    }
  });
});

describe("session (cookie)", () => {
  const handler = withUser(async () => Response.json({ user: currentUserId() }));
  const req = (cookie?: string) => new NextRequest("http://127.0.0.1:3000/api/x", { headers: cookie ? { cookie } : {} });

  it("withUser : 401 sans cookie ou pour un compte inconnu, sinon exécute en tant que l'utilisateur", async () => {
    signIn("Bob");
    expect((await handler(req())).status).toBe(401);
    expect((await handler(req("jobscout_user=inconnu"))).status).toBe(401);
    expect((await handler(req("jobscout_user=..%2Fbob"))).status).toBe(401);
    const ok = await handler(req("jobscout_user=bob"));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ user: "bob" });
  });

  it("middleware : API sans session → 401 ; /api/auth reste ouvert", () => {
    const mw = (url: string, cookie?: string) =>
      middleware(new NextRequest(url, { headers: { host: "127.0.0.1:3000", ...(cookie ? { cookie } : {}) } }));
    expect(mw("http://127.0.0.1:3000/api/profile").status).toBe(401);
    expect(mw("http://127.0.0.1:3000/api/auth/login").headers.get("x-middleware-next")).toBe("1");
    expect(mw("http://127.0.0.1:3000/api/profile", "jobscout_user=bob").headers.get("x-middleware-next")).toBe("1");
  });
});

describe("garde-fous du code", () => {
  const root = process.cwd();
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, out);
      else out.push(full);
    }
    return out;
  };

  it("toute route de l'API (sauf /api/auth) passe par withUser", () => {
    const routes = walk(path.join(root, "app", "api")).filter((f) => f.endsWith("route.ts"));
    const unprotected = routes
      .filter((f) => !f.includes(`${path.sep}auth${path.sep}`))
      .filter((f) => {
        const src = fs.readFileSync(f, "utf8");
        const exported = [...src.matchAll(/^export (?:async )?(?:function|const) (GET|POST|PATCH|PUT|DELETE)\b(.*)$/gm)];
        return exported.length === 0 || exported.some((m) => !/= withUser\(/.test(m[2]));
      })
      .map((f) => path.relative(root, f));
    expect(routes.length).toBeGreaterThan(20);
    expect(unprotected).toEqual([]);
  });

  it("toute page exige une session : elle-même ou une mise en page parente (sauf /login)", () => {
    const appDir = path.join(root, "app");
    const guarded = (f: string) => /userScope\(|requireAccount\(/.test(fs.readFileSync(f, "utf8"));
    const unprotected = walk(appDir)
      .filter((f) => f.endsWith("page.tsx") && !f.includes(`${path.sep}(auth)${path.sep}`))
      .filter((page) => {
        if (guarded(page)) return false;
        for (let dir = path.dirname(page); dir.startsWith(appDir); dir = path.dirname(dir)) {
          const layout = path.join(dir, "layout.tsx");
          if (dir !== appDir && fs.existsSync(layout) && guarded(layout)) return false;
        }
        return true;
      })
      .map((f) => path.relative(root, f));
    expect(unprotected).toEqual([]);
  });

  it("toute page ou mise en page qui lit la base passe par userScope", () => {
    const pages = walk(path.join(root, "app")).filter((f) => /(page|layout)\.tsx$/.test(f));
    const offenders = pages
      .filter((f) => {
        const src = fs.readFileSync(f, "utf8");
        return /from "@\/lib\/db/.test(src) && !/userScope\(/.test(src);
      })
      .map((f) => path.relative(root, f));
    expect(offenders).toEqual([]);
  });
});
