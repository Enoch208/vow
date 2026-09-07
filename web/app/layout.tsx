import type { Metadata } from "next";
import "./globals.css";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://github.com/Enoch208/vow";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "VOW — Confidential delegated procurement on Starknet",
  description: "Commit one-use purchase permissions without publishing the supplier list, then enforce an exact supplier, token, cap, and collection path on Starknet.",
  openGraph: {
    title: "VOW — Confidential delegated procurement on Starknet",
    description: "Let an operator reserve an approved purchase without giving it a spending key or a way to redirect funds.",
    type: "website",
    siteName: "VOW",
  },
  twitter: {
    card: "summary_large_image",
    title: "VOW — Confidential delegated procurement on Starknet",
    description: "One-use purchase permissions, supplier-bound collection, and explicit accounting.",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
