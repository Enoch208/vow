"use client";

import { useRef } from "react";
import Image from "next/image";
import { HoverGridBackground } from "@/components/HoverGridBackground";

export function HeroArtwork() {
  const stageRef = useRef<HTMLDivElement | null>(null);

  return (
    <div ref={stageRef} className="hero-art-stage">
      <HoverGridBackground targetRef={stageRef} />
      <Image
        className="hero-art-image"
        src="/vow-hero.png"
        alt="VOW represented as colorful dimensional letter blocks"
        width={1254}
        height={1254}
        fetchPriority="high"
      />
      <p className="hero-art-label">Owner bound · Supplier bound · Single use</p>
    </div>
  );
}
