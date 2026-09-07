"use client";

import { type RefObject } from "react";
import { HeroHoverGrid } from "@/components/HeroHoverGrid";

interface HoverGridBackgroundProps {
  targetRef?: RefObject<HTMLElement | null>;
}

export function HoverGridBackground({ targetRef }: HoverGridBackgroundProps) {
  return (
    <div className="hover-grid-background">
      <HeroHoverGrid targetRef={targetRef} />
    </div>
  );
}
