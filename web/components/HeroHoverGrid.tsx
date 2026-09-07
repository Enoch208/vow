"use client";

import { type RefObject, useEffect, useMemo, useState } from "react";

interface HeroHoverGridProps {
  className?: string;
  targetRef?: RefObject<HTMLElement | null>;
}

const columns = 18;
const rows = 14;
export function HeroHoverGrid({ className = "", targetRef }: HeroHoverGridProps) {
  const [activeIndex, setActiveIndex] = useState(-1);
  const cells = useMemo(() => Array.from({ length: columns * rows }, (_, index) => index), []);

  useEffect(() => {
    const target = targetRef?.current;
    if (!target) return;

    const updateCell = (event: PointerEvent) => {
      const rect = target.getBoundingClientRect();
      const x = Math.max(0, Math.min(columns - 1, Math.floor(((event.clientX - rect.left) / rect.width) * columns)));
      const y = Math.max(0, Math.min(rows - 1, Math.floor(((event.clientY - rect.top) / rect.height) * rows)));
      setActiveIndex(y * columns + x);
    };
    const clearCell = () => setActiveIndex(-1);

    target.addEventListener("pointermove", updateCell);
    target.addEventListener("pointerleave", clearCell);
    return () => {
      target.removeEventListener("pointermove", updateCell);
      target.removeEventListener("pointerleave", clearCell);
    };
  }, [targetRef]);

  return (
    <div className={`hero-hover-grid ${className}`.trim()} aria-hidden="true">
      {cells.map((index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const active = index === activeIndex;
        return (
          <span
            key={index}
            className={`tint-${(column + row) % 5}${active ? " is-active" : ""}`}
          />
        );
      })}
    </div>
  );
}
