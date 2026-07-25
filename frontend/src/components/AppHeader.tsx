"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { clearToken } from "@/lib/auth";

interface AppHeaderProps {
  active: "dashboard" | "analytics";
  right?: ReactNode;
}

export function AppHeader({ active, right }: AppHeaderProps) {
  const router = useRouter();

  function handleLogout() {
    clearToken();
    router.replace("/login");
  }

  return (
    <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-6 py-4">
      <div className="flex items-center gap-6">
        <h1 className="text-lg font-semibold text-zinc-900">Trade Journal</h1>
        <nav className="flex gap-4 text-sm font-medium">
          <Link
            href="/dashboard"
            className={active === "dashboard" ? "text-zinc-900" : "text-zinc-500 hover:text-zinc-900"}
          >
            Calendar
          </Link>
          <Link
            href="/analytics"
            className={active === "analytics" ? "text-zinc-900" : "text-zinc-500 hover:text-zinc-900"}
          >
            Analytics
          </Link>
        </nav>
      </div>
      <div className="flex items-center gap-4">
        {right}
        <button
          type="button"
          onClick={handleLogout}
          className="text-sm text-zinc-500 transition-colors hover:text-zinc-900"
        >
          Log out
        </button>
      </div>
    </header>
  );
}
