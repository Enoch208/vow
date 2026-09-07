import Link from "next/link";
import { ArrowRight } from "@/components/icons";

interface SiteHeaderProps {
  productHref: string;
}

export function SiteHeader({ productHref }: SiteHeaderProps) {
  return (
    <header className="site-header">
      <Link className="site-brand" href="/" aria-label="VOW home">
        <span className="brand-mark" aria-hidden="true">
          <i>V</i><i>O</i><i>W</i>
        </span>
        <span className="brand-copy">
          <strong>VOW</strong>
          <small>Confidential delegated procurement</small>
        </span>
      </Link>
      <nav className="header-actions" aria-label="Primary navigation">
        <div className="network-status" aria-label="Network target: Starknet mainnet">
          <span>Network target</span>
          <b><i aria-hidden="true" /> Starknet mainnet</b>
        </div>
        <Link className="header-link" href="/demo">How it works</Link>
        <a className="header-launch" href={productHref}>
          <span className="header-launch-icon" aria-hidden="true"><ArrowRight size={18} /></span>
          <span className="header-launch-label">Open product</span>
        </a>
      </nav>
    </header>
  );
}
