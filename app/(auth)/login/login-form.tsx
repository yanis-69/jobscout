"use client";
import { useState } from "react";
import { ArrowRight, LogIn } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

type AccountChoice = { id: string; name: string };

export function LoginForm({ accounts }: { accounts: AccountChoice[] }) {
  const [name, setName] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signIn(value: string) {
    setPending(value);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: value }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || `Connexion impossible (HTTP ${res.status}).`);
        return;
      }
      // Navigation complète : toutes les pages repartent avec la nouvelle session.
      window.location.assign("/");
    } catch {
      setError("Connexion impossible : JobScout ne répond pas.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mt-6 space-y-6">
      {accounts.length > 0 && (
        <section aria-labelledby="comptes">
          <h2 id="comptes" className="mb-2 text-caption font-semibold uppercase tracking-[0.12em] text-textSecondary">Continuer en tant que</h2>
          <ul className="space-y-2">
            {accounts.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => signIn(a.name)}
                  disabled={!!pending}
                  className="glass-inset flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left transition-colors hover:bg-surfaceHover disabled:opacity-60"
                >
                  <span className="brand-mark h-8 w-8 shrink-0 rounded-full text-small font-semibold text-accent">
                    {a.name.slice(0, 1).toLocaleUpperCase("fr-FR")}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-body font-medium">{a.name}</span>
                  {pending === a.name ? <Spinner size={16} /> : <ArrowRight className="h-4 w-4 text-textSecondary" />}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) signIn(name);
        }}
      >
        <label htmlFor="username" className="mb-2 block text-caption font-semibold uppercase tracking-[0.12em] text-textSecondary">
          {accounts.length ? "Autre utilisateur" : "Nom d'utilisateur"}
        </label>
        <div className="flex gap-2">
          <Input
            id="username"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex. Yanis"
            autoComplete="username"
            maxLength={40}
            autoFocus={accounts.length === 0}
          />
          <Button type="submit" disabled={!!pending || name.trim().length < 2}>
            {pending === name ? <Spinner size={16} className="text-onAccent" /> : <LogIn className="h-4 w-4" />}
            Entrer
          </Button>
        </div>
        <p className="mt-2 text-caption text-textSecondary">
          Un nom déjà utilisé ouvre son espace ; un nouveau nom crée un espace vide. Pas de mot de passe pour l'instant : toute
          personne qui a accès à cet ordinateur peut ouvrir n'importe quel espace.
        </p>
        {error && <p role="alert" className="mt-3 text-small text-danger">{error}</p>}
      </form>
    </div>
  );
}
