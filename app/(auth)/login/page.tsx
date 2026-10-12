import { Search } from "lucide-react";
import { listAccounts } from "@/lib/accounts";
import { LoginForm } from "./login-form";

// Liste des comptes lue à chaque visite (jamais prérendue au build).
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const accounts = listAccounts().map((a) => ({ id: a.id, name: a.name }));
  return (
    <div className="app-shell flex min-h-[100dvh] items-center justify-center px-4 py-10">
      <main className="glass-panel w-full max-w-[440px] p-6 sm:p-8">
        <div className="mb-7 flex items-center gap-3">
          <span className="brand-mark h-11 w-11 rounded-[15px]"><Search className="h-6 w-6" strokeWidth={1.75} /></span>
          <span className="font-display text-[26px] font-semibold leading-none">JobScout<span className="text-accent">.</span></span>
        </div>
        <h1 className="font-display text-h2">Qui utilise JobScout ?</h1>
        <p className="mt-2 text-small text-textSecondary">
          Chaque utilisateur a son propre espace : profil et CV, offres, candidatures, documents et clés d'IA.
        </p>
        <LoginForm accounts={accounts} />
      </main>
    </div>
  );
}
