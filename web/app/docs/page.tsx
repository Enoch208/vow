import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { productUrl } from "@/lib/product-url";

const documents = [
  ["README", "/docs/README.md", "Scope, current status, public interfaces, and evidence tiers."],
  ["JUDGES", "/docs/JUDGES.md", "The shortest review path through claims and evidence."],
  ["THREAT MODEL", "/docs/THREAT_MODEL.md", "Actors, trust boundaries, abuse cases, and enforced invariants."],
  ["PRIVACY", "/docs/PRIVACY.md", "What remains local, what becomes public, and what can be inferred."],
  ["REPRODUCE", "/docs/REPRODUCE.md", "Pinned toolchain, clean-clone gate, and mainnet verification commands."],
] as const;

export default function DocsPage() {
  const productHome = productUrl("/demo/dashboard");
  return (
    <main className="vow-theme docs-page">
      <SiteHeader productHref={productHome} />
      <section className="demo-hero grid-paper">
        <p className="kicker"><span>Public documentation</span> Evidence before claims</p>
        <h1>Inspect VOW.</h1>
        <p>Architecture, privacy boundaries, deployment identifiers, and exact reproduction commands are public and readable without a wallet or account.</p>
      </section>
      <section className="docs-grid" aria-label="Documentation index">
        {documents.map(([name, href, description]) => <article key={name}><h2><a href={href}>{name}</a></h2><p>{description}</p></article>)}
      </section>
      <section className="status-section">
        <div><p className="kicker">Architecture</p><h2>Authority narrows at every stage.</h2></div>
        <div className="status-ledger">
          <div><p><strong>Owner</strong> Commits the permission set, funds the mandate, and retains recovery authority.</p></div>
          <div><p><strong>Operator</strong> Reserves an approved purchase without custody or a general spending key.</p></div>
          <div><p><strong>Supplier and verifier</strong> Bind collection to one destination note and verify public settlement evidence without a wallet.</p></div>
        </div>
      </section>
      <section className="docs-reference grid-paper">
        <article><p className="kicker">Privacy boundary</p><h2>Unused permissions stay off-chain.</h2><p>The chain receives a commitment root. Only a selected permission becomes public when used; private keys, salts, backups, witnesses, and proof material stay out of the public site.</p></article>
        <article><p className="kicker">Pinned mainnet deployment</p><dl><dt>Vault</dt><dd>0x641ca5237870312273ed2cd693372ee49e103d5c585af6185324f3662e15227</dd><dt>Class</dt><dd>0x3c85f692be0a2280bc85fc9802019121a8b52ef4de0db9273c3806f7355ce14</dd><dt>Pool</dt><dd>0x40337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a</dd></dl></article>
        <article><p className="kicker">Quickstart</p><pre><code>npm ci{"\n"}npm run check{"\n"}sh scripts/cairo.sh test{"\n"}npm run verify:vault</code></pre><p><a href="/docs/REPRODUCE.md">Read the complete clean-clone procedure →</a></p></article>
      </section>
      <SiteFooter productHref={productHome} />
    </main>
  );
}
