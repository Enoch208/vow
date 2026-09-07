import { LandingActionButton } from "@/components/LandingActionButton";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { ArrowRight, Fingerprint, LockKeyhole, ReceiptText, ShieldCheck } from "@/components/icons";
import { productUrl } from "@/lib/product-url";

const roles = [
  {
    number: "01",
    label: "Owner",
    title: "Commit the purchase envelope",
    body: "Build the permission set locally, preview every public field, download the encrypted backup, restore it, and only then enable creation.",
    href: "/owner",
    action: "Open owner screen",
    Icon: Fingerprint,
    tone: "mint",
  },
  {
    number: "02",
    label: "Operator",
    title: "Choose an approved purchase",
    body: "Unlock the committed set and reserve one exact permission. Editing the supplier, token, cap, or deadline breaks membership.",
    href: "/operator",
    action: "Open operator screen",
    Icon: LockKeyhole,
    tone: "blue",
  },
  {
    number: "03",
    label: "Supplier",
    title: "Authorize exact collection",
    body: "Review the public reservation, unlock the local claim-key backup, and sign the exact destination-bound STRK20 collection terms.",
    href: "/claim/0x45cc6c11f29f5fe7b53eee680c0626324e344af8d021ca7af58a1b1ecf2bb2b",
    action: "Open claim screen",
    Icon: ShieldCheck,
    tone: "yellow",
  },
  {
    number: "04",
    label: "Verifier",
    title: "Reject unrelated receipts",
    body: "Check the accepted receipt, exact VOW event, pool deposit, claimed state, and token-pull trace with no wallet connection.",
    href: "/verify",
    action: "Open public verifier",
    Icon: ReceiptText,
    tone: "orange",
  },
] as const;

export default function DemoPage() {
  const appRoot = productUrl("/demo/dashboard");
  return (
    <main className="vow-theme demo-page">
      <SiteHeader productHref={appRoot} />
      <section className="demo-hero grid-paper">
        <p className="kicker"><span>Product tour</span> Four roles, one narrowing authority path</p>
        <h1>See who can do what.</h1>
        <p>These links open the functional VOW product pinned to the verified mainnet VowVault. One controlled 0.1 STRK mandate is funded and fully reserved; the reservation remains open with zero paid. No supplier collection is presented as complete.</p>
        <div className="hero-actions">
          <LandingActionButton href={appRoot} tone="yellow">Open product home</LandingActionButton>
          <LandingActionButton href="/" tone="dark">Return to overview</LandingActionButton>
        </div>
      </section>

      <section className="role-tour">
        {roles.map(({ number, label, title, body, href, action, Icon, tone }) => (
          <article className="role-row" key={label}>
            <div className={`role-index tone-${tone}`}><span>{number}</span><Icon size={34} aria-hidden="true" /></div>
            <div className="role-copy"><p className="role-label">{label}</p><h2>{title}</h2><p>{body}</p></div>
            <a className="role-action" href={productUrl(href)}>{action}<ArrowRight size={19} aria-hidden="true" /></a>
          </article>
        ))}
      </section>

      <section className="demo-truth">
        <div><span>Current mode</span><strong>Mainnet pinned</strong></div>
        <div><span>VOW deployment</span><strong>Verified</strong></div>
        <div><span>Qualifying collection</span><strong>Pending</strong></div>
        <div><span>Write behavior</span><strong>Fail closed</strong></div>
      </section>

      <SiteFooter productHref={appRoot} />
    </main>
  );
}
