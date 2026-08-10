"use client";

import { AppHeader } from "@/components/AppHeader";
import { PositionCalculator } from "@/components/PositionCalculator";

/**
 * The calculator holds no server state: it reads nothing and saves nothing, so
 * unlike the other pages there is no fetch, no auth redirect and no loading
 * state. It is deliberately usable before the first trade is ever logged.
 */
export default function CalculatorPage() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <AppHeader active="calculator" />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <div className="mb-5">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
            Position size &amp; risk/reward
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Size a trade from the risk you want, or work out the risk a size carries.
          </p>
        </div>
        <PositionCalculator />
      </main>
    </div>
  );
}
