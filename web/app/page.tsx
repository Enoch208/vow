import { HeroArtwork } from "@/components/HeroArtwork";
import { LandingActionButton } from "@/components/LandingActionButton";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { ArrowRight, EyeOff, Fingerprint, LockKeyhole, ReceiptText, ShieldCheck } from "@/components/icons";
import { productUrl } from "@/lib/product-url";

const steps = [
  ["01", "Commit", "The owner commits a padded set of one-use permissions. The unused supplier list stays off-chain."],
  ["02", "Reserve", "The operator selects an already-approved permission. It cannot replace the supplier, token, cap, or deadline."],
  ["03", "Authorize", "The supplier signs the exact collection terms with a local claim key that never leaves its browser."],
  ["04", "Collect", "The contract releases the reserved amount only through the pinned STRK20 pool and exact destination-bound note."],
] as const;

const boundaries = [
  ["Owner", "Commits the permission set, funds the mandate, and retains recovery authority.", Fingerprint, "mint"],
  ["Operator", "May reserve a committed purchase. Holds neither the funds nor a general spending key.", LockKeyhole, "blue"],
  ["Supplier", "Authorizes one exact collection into its signed STRK20 note.", ShieldCheck, "yellow"],
  ["Public verifier", "Checks the receipt, events, pool deposit, state, and token-pull trace without a wallet.", ReceiptText, "orange"],
] as const;

const facts = [
  ["16", "padded permission slots in the local VowVault model"],
  ["01", "use per permission, with expiry that never rearms it"],
  ["05", "separate accounting totals: funded, available, reserved, paid, reclaimed"],
  ["00", "generic calls, upgrade paths, or admin sweeps"],
] as const;

export default function Home() {
  const appRoot = productUrl("/demo/dashboard");
  return (
    <main className="vow-theme">
      <SiteHeader productHref={appRoot} />

      <section className="hero-grid grid-paper">
        <div className="hero-copy">
          <p className="kicker"><span>STRK20</span> Confidential delegated procurement</p>
          <h1>VOW</h1>
          <h2>Let an agent approve a purchase. Never let it redirect the money.</h2>
          <p className="hero-text">VOW gives an operator constrained authority to reserve an owner-approved purchase while the contract keeps custody and binds collection to the intended supplier, token, cap, and destination note.</p>
          <div className="hero-actions">
            <LandingActionButton href="/demo" tone="dark">Explore the protocol</LandingActionButton>
            <LandingActionButton href={appRoot} tone="yellow">Open the product</LandingActionButton>
          </div>
          <div className="safety-note">
            <ShieldCheck size={18} aria-hidden="true" />
            <p><strong>Evidence before claims.</strong> Vault 0x641ca5237870312273ed2cd693372ee49e103d5c585af6185324f3662e15227, class 0x3c85f692be0a2280bc85fc9802019121a8b52ef4de0db9273c3806f7355ce14, is deployed by 0x3f3cc7727c66634967621dc8d4697f1bfd6c29f81757496a4783bf5c90deb89 and bound to pool 0x40337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a. One 0.1 STRK reservation is open with zero paid; no collection is claimed and 0 of 5 release gates pass.</p>
          </div>
        </div>
        <aside className="hero-rail" aria-label="VOW protocol artwork"><HeroArtwork /></aside>
      </section>

      <section className="flow-section">
        <div className="section-bar light"><span>How authority moves</span><span>&lt;flow&gt; commit / reserve / authorize / collect &lt;/flow&gt;</span></div>
        <div className="section-heading">
          <h2>A purchase path with no redirect field.</h2>
          <p>Authority narrows at every step. Each participant receives only the capability needed for its role.</p>
        </div>
        <div className="step-grid">
          {steps.map(([number, title, body]) => (
            <article className="step-card" key={title}>
              <span>{number}</span><h3>{title}</h3><p>{body}</p><ArrowRight aria-hidden="true" />
            </article>
          ))}
        </div>
      </section>

      <section className="boundary-section grid-paper">
        <div className="section-bar dark"><span>Role boundaries</span><span>&lt;authority&gt; visible, narrow, accountable &lt;/authority&gt;</span></div>
        <div className="section-heading ink-heading">
          <h2>Separation you can inspect.</h2>
          <p>The contract owns the escrow. The operator never receives custody, and the supplier signs only the collection it expects.</p>
        </div>
        <div className="boundary-grid">
          {boundaries.map(([title, body, Icon, tone]) => (
            <article className={`boundary-card tone-${tone}`} key={title}>
              <Icon size={30} aria-hidden="true" /><h3>{title}</h3><p>{body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="privacy-section">
        <div className="privacy-copy">
          <p className="kicker"><span>Privacy boundary</span> Commit the set, reveal the selected purchase</p>
          <h2>Unused permissions do not become a public procurement plan.</h2>
          <p>The chain receives a commitment root. A selected permission becomes public when used, while unused supplier permissions remain in the owner’s encrypted local backup.</p>
          <a className="inline-link" href="https://github.com/Enoch208/vow/blob/main/PRIVACY.md">Read the privacy boundary <ArrowRight size={18} /></a>
        </div>
        <div className="privacy-symbol" aria-hidden="true"><EyeOff size={92} /></div>
      </section>

      <section className="fact-section grid-paper">
        <div className="section-bar light"><span>Protocol shape</span><span>&lt;invariants&gt; encoded and tested locally &lt;/invariants&gt;</span></div>
        <div className="fact-grid">
          {facts.map(([value, label]) => <article key={label}><strong>{value}</strong><p>{label}</p></article>)}
        </div>
      </section>

      <section className="status-section">
        <div>
          <p className="kicker">Release truth</p>
          <h2>The interface says exactly what the evidence proves.</h2>
        </div>
        <div className="status-ledger">
          <div><span className="status-dot verified" /><p><strong>Verified on mainnet</strong> VowVault class and deployment, plus one controlled 0.1 STRK funded reservation that remains open with zero paid.</p></div>
          <div><span className="status-dot tested" /><p><strong>Tested locally</strong> Contract invariants, encodings, reviews, journals, and receipt checks.</p></div>
          <div><span className="status-dot pending" /><p><strong>Still pending</strong> Supplier collection, note-credit proof, and all five release gates. Deployment and reservation alone pass none.</p></div>
        </div>
      </section>

      <SiteFooter productHref={appRoot} />
    </main>
  );
}
