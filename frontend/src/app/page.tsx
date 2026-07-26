"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { fetchSession } from "@/lib/auth";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    // Checking for a session now needs a round-trip (the cookie is httpOnly).
    // The landing page renders immediately either way; a signed-in visitor is
    // just redirected a moment later.
    fetchSession()
      .then((user) => {
        if (user) router.replace("/dashboard");
      })
      .catch(() => {
        // Can't reach the API - leave the landing page up.
      });
  }, [router]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-zinc-50 px-4 text-center dark:bg-zinc-950">
      <h1 className="text-3xl font-semibold text-zinc-900 dark:text-zinc-100">Trade Journal</h1>
      <p className="max-w-md text-zinc-500 dark:text-zinc-400">
        Track your trades and see your monthly performance at a glance.
      </p>
      <div className="flex gap-3">
        <Link
          href="/login"
          className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          Log in
        </Link>
        <Link
          href="/register"
          className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Sign up
        </Link>
      </div>
    </div>
  );
}
