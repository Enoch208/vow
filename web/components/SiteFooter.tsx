import Link from "next/link";

export function SiteFooter({ productHref }: { productHref: string }) {
  return (
    <footer className="site-footer">
      <div className="footer-lead">
        <p className="kicker">Destination binding is the product.</p>
        <h2>Approve the purchase.<br />Keep control of the money.</h2>
      </div>
      <div className="footer-links">
        <strong>VOW</strong>
        <Link href="/demo">Protocol flow</Link>
        <a href={productHref}>Open product</a>
        <a href="https://github.com/Enoch208/vow">Source</a>
      </div>
    </footer>
  );
}
