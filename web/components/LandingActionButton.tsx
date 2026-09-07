import { ArrowUpRight } from "@/components/icons";

interface LandingActionButtonProps {
  children: React.ReactNode;
  href: string;
  tone?: "dark" | "yellow" | "blue";
}

export function LandingActionButton({ children, href, tone = "dark" }: LandingActionButtonProps) {
  return (
    <a className={`action-button action-button-${tone}`} href={href}>
      <span className="action-button-label">{children}</span>
      <span className="action-button-icon" aria-hidden="true">
        <ArrowUpRight size={19} strokeWidth={3} />
      </span>
    </a>
  );
}
