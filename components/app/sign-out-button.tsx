"use client";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { cn } from "@/lib/utils";

/** « Changer d'utilisateur » : efface la session puis revient à l'écran de connexion. */
export function SignOutButton({ userName, compact = false }: { userName: string; compact?: boolean }) {
  const [pending, setPending] = useState(false);
  async function signOut() {
    setPending(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.assign("/login");
    }
  }
  if (compact) {
    return (
      <button
        type="button"
        onClick={signOut}
        disabled={pending}
        aria-label={`Changer d'utilisateur (connecté : ${userName})`}
        title={`Connecté : ${userName} — changer d'utilisateur`}
        className="flex h-10 w-10 items-center justify-center rounded-full text-textSecondary transition-colors hover:bg-surfaceHover hover:text-text disabled:opacity-60"
      >
        <LogOut className="h-[18px] w-[18px]" strokeWidth={1.65} />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={signOut}
      disabled={pending}
      className={cn(
        "flex h-11 w-full items-center gap-3 rounded-[14px] px-3 text-left text-small text-textSecondary transition-colors hover:bg-surfaceHover hover:text-text disabled:opacity-60"
      )}
    >
      <LogOut className="h-[18px] w-[18px] shrink-0" strokeWidth={1.65} />
      <span className="min-w-0">
        <span className="block truncate font-medium text-text">{userName}</span>
        <span className="block text-caption">Changer d'utilisateur</span>
      </span>
    </button>
  );
}
