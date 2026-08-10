"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { logout } from "@/lib/api";
import { ThemeToggle } from "@/components/ThemeToggle";

/** Tabs in nav order. A list rather than four near-identical <Link> blocks. */
const NAV_ITEMS = [
  { key: "dashboard", href: "/dashboard", label: "Calendar" },
  { key: "analytics", href: "/analytics", label: "Analytics" },
  { key: "calculator", href: "/calculator", label: "Calculator" },
  { key: "reviews", href: "/reviews", label: "Reviews" },
] as const;

interface AppHeaderProps {
  active: (typeof NAV_ITEMS)[number]["key"];
  right?: ReactNode;
}

export function AppHeader({ active, right }: AppHeaderProps) {
  const router = useRouter();

  function handleLogout() {
    // The cookie is httpOnly, so only the server can clear it. Navigate away
    // regardless of the outcome so a failed request can't trap the user here.
    logout()
      .catch(() => {})
      .finally(() => router.replace("/login"));
  }

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-4 sm:px-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-6">
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Trade Journal</h1>
        <nav className="flex gap-4 text-sm font-medium">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              aria-current={active === item.key ? "page" : undefined}
              className={
                active === item.key
                  ? "text-zinc-900 dark:text-zinc-100"
                  : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
      <div className="flex items-center gap-3 sm:gap-4">
        {right}
        <ThemeToggle />
        <button
          type="button"
          onClick={handleLogout}
          className="text-sm text-zinc-500 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Log out
        </button>
      </div>
    </header>
  );
}
