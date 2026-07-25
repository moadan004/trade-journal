"use client";

import { useEffect, useState } from "react";

/** Tracks the `dark` class on <html>, kept in sync via ThemeToggle mutating classList directly. */
export function useIsDarkMode(): boolean {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    Promise.resolve().then(() => setIsDark(root.classList.contains("dark")));

    const observer = new MutationObserver(() => {
      setIsDark(root.classList.contains("dark"));
    });
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}
