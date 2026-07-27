"use client";

import { useEffect } from "react";

interface ScreenshotLightboxProps {
  src: string;
  onClose: () => void;
}

/**
 * Full-size screenshot overlay.
 *
 * Separate from Modal because this wants no chrome, no padding and no width
 * cap - the point is to see the chart as large as the viewport allows.
 */
export function ScreenshotLightbox({ src, onClose }: ScreenshotLightboxProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Trade screenshot"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close screenshot"
        className="absolute right-4 top-4 rounded-lg px-3 py-1.5 text-2xl leading-none text-white/80 hover:bg-white/10 hover:text-white"
      >
        &times;
      </button>
      {/* Runtime upload path, so next/image can't optimize it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="Trade screenshot"
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full rounded-lg object-contain"
      />
    </div>
  );
}
