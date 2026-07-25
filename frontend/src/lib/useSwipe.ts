"use client";

import { useRef } from "react";
import type { TouchEvent } from "react";

interface SwipeHandlers {
  onTouchStart: (e: TouchEvent) => void;
  onTouchEnd: (e: TouchEvent) => void;
}

/** Horizontal swipe detection for touch devices. Swipe left = onSwipeLeft (e.g. next), swipe right = onSwipeRight (e.g. prev). */
export function useSwipe(onSwipeLeft: () => void, onSwipeRight: () => void, threshold = 50): SwipeHandlers {
  const startX = useRef<number | null>(null);

  function onTouchStart(e: TouchEvent) {
    startX.current = e.touches[0].clientX;
  }

  function onTouchEnd(e: TouchEvent) {
    if (startX.current === null) return;
    const deltaX = e.changedTouches[0].clientX - startX.current;
    if (deltaX <= -threshold) onSwipeLeft();
    else if (deltaX >= threshold) onSwipeRight();
    startX.current = null;
  }

  return { onTouchStart, onTouchEnd };
}
