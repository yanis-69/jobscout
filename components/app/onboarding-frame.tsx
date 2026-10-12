import Link from "next/link";
import { Search } from "lucide-react";
import { OnboardingStepper } from "./onboarding-stepper";

export function OnboardingFrame({ current, title, description, children, wide = false }: {
  current: "upload" | "verify" | "preferences";
  title: string;
  description: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="app-shell min-h-[100dvh]">
      <header className="mobile-header border-b border-border">
        <div className="mx-auto flex max-w-[900px] items-center justify-between px-5 py-4 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5" aria-label="JobScout, accueil">
            <span className="brand-mark h-9 w-9 rounded-[13px]"><Search className="h-5 w-5" strokeWidth={1.75} /></span>
            <span className="font-display text-[23px] font-semibold">JobScout<span className="text-accent">.</span></span>
          </Link>
          <span className="flex items-center gap-4 text-small text-textSecondary">
            <span className="hidden sm:inline">Configuration du profil</span>
            {/* La page de connexion remplace la session par celle choisie. */}
            <Link href="/login" className="font-semibold text-accent hover:underline">Changer d'utilisateur</Link>
          </span>
        </div>
      </header>
      {/* Espacements resserrés : à 1440×900, la zone de dépôt du CV (étape 1)
          doit apparaître entière sans défiler. */}
      <main className={`mx-auto px-5 pb-16 pt-6 sm:px-8 sm:pt-8 ${wide ? "max-w-[800px]" : "max-w-[700px]"}`}>
        <OnboardingStepper current={current} />
        <div className="mb-7 mt-8">
          <p className="eyebrow mb-3"><span className="signal-dot" aria-hidden="true" />Étape {current === "upload" ? "1" : current === "verify" ? "2" : "3"} sur 3</p>
          <h1 className="font-display text-h1 text-balance">{title}</h1>
          <p className="mt-3 max-w-[60ch] text-body text-textSecondary">{description}</p>
        </div>
        {children}
      </main>
    </div>
  );
}
