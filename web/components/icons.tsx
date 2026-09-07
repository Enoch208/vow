import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Icon({ size = 24, children, ...props }: IconProps) {
  return (
    <svg
      {...props}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function ArrowRight(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </Icon>
  );
}

export function ArrowUpRight(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M7 17 17 7" />
      <path d="M7 7h10v10" />
    </Icon>
  );
}

export function ShieldCheck(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3v8Z" />
      <path d="m9 12 2 2 4-4" />
    </Icon>
  );
}

export function Fingerprint(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 10a2 2 0 0 0-2 2c0 1.5-.3 3.5-1.5 5" />
      <path d="M14 21c1.2-2.2 1.8-5.4 1.8-9a3.8 3.8 0 0 0-7.6 0c0 3.8-1.2 6.1-2.2 7.5" />
      <path d="M18.5 18c.7-2 1.1-4 1.1-6a7.6 7.6 0 0 0-15.2 0c0 1.1-.1 2.2-.4 3.2" />
      <path d="M12 3a9 9 0 0 1 9 9" />
    </Icon>
  );
}

export function LockKeyhole(props: IconProps) {
  return (
    <Icon {...props}>
      <rect width="18" height="12" x="3" y="10" rx="2" />
      <path d="M7 10V7a5 5 0 0 1 10 0v3" />
      <path d="M12 14v4" />
    </Icon>
  );
}

export function ReceiptText(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" />
      <path d="M16 8h-6" />
      <path d="M16 12h-6" />
      <path d="M13 16h-3" />
    </Icon>
  );
}

export function EyeOff(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m2 2 20 20" />
      <path d="M6.7 6.7C4.7 8 3.2 9.8 2.5 12c1.4 4.2 5 7 9.5 7 1.5 0 2.9-.3 4.1-.9" />
      <path d="M10.7 5.1c.4-.1.8-.1 1.3-.1 4.5 0 8.1 2.8 9.5 7-.5 1.5-1.3 2.8-2.4 3.9" />
      <path d="M14.1 14.1a3 3 0 0 1-4.2-4.2" />
    </Icon>
  );
}
