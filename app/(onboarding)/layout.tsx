import { requireAccount } from "@/lib/session";

// Session lue à chaque visite (jamais prérendue au build).
export const dynamic = "force-dynamic";

/** Onboarding d'un utilisateur connecté (lib/session.ts), sinon redirection vers /login. */
export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  await requireAccount();
  return <div className="min-h-[100dvh]">{children}</div>;
}
