import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const text = (path) => readFileSync(join(root, path), "utf8");
const implementationRoots = ["app", "components", "lib"];

function filesBelow(path) {
  return readdirSync(path).flatMap((name) => {
    const child = join(path, name);
    return statSync(child).isDirectory() ? filesBelow(child) : [child];
  });
}

const sourceFiles = implementationRoots
  .flatMap((path) => filesBelow(join(root, path)))
  .filter((path) => /\.(?:css|ts|tsx)$/.test(path));

function sourceBundle() {
  return sourceFiles.map((path) => `\n${relative(root, path)}\n${readFileSync(path, "utf8")}`).join("");
}

test("the shell identifies only VOW and keeps release claims within current evidence", () => {
  const sources = sourceBundle();
  const home = text("app/page.tsx");
  const demo = text("app/demo/page.tsx");
  const docs = text("app/docs/page.tsx");

  assert.doesNotMatch(sources, /\b(?:clasp|fiber)\b/i);
  assert.doesNotMatch(sources, /\b(?:TODO|FIXME|coming soon)\b/i);
  assert.match(home, /<h1>VOW<\/h1>/);
  assert.match(home, /0x641ca5237870312273ed2cd693372ee49e103d5c585af6185324f3662e15227/i);
  assert.match(home, /0x3c85f692be0a2280bc85fc9802019121a8b52ef4de0db9273c3806f7355ce14/i);
  assert.match(home, /0x40337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a/i);
  assert.match(home, /0x3f3cc7727c66634967621dc8d4697f1bfd6c29f81757496a4783bf5c90deb89/i);
  assert.match(home, /One 0\.1 STRK reservation is open with zero paid; no collection is claimed and 0 of 5 release gates pass/i);
  assert.match(home, /Verified on mainnet[\s\S]*one controlled 0\.1 STRK funded reservation that remains open with zero paid/i);
  assert.match(demo, /functional VOW product pinned to the verified mainnet VowVault/i);
  assert.match(demo, /<strong>Pending<\/strong>/);
  assert.match(demo, /<strong>Fail closed<\/strong>/);
  assert.match(docs, /Architecture/);
  assert.match(docs, /Privacy boundary/);
  assert.match(docs, /Pinned mainnet deployment/);
  assert.match(docs, /Quickstart/);
});

test("navigation separates shell routes from the functional VOW product", () => {
  const home = text("app/page.tsx");
  const demo = text("app/demo/page.tsx");
  const header = text("components/SiteHeader.tsx");
  const footer = text("components/SiteFooter.tsx");
  const product = text("lib/product-url.ts");

  assert.match(product, /http:\/\/127\.0\.0\.1:4319/);
  assert.match(product, /NEXT_PUBLIC_VOW_APP_URL/);
  assert.match(home, /href="\/demo"/);
  assert.match(header, /href="\/"/);
  assert.match(header, /href="\/demo"/);
  assert.match(footer, /href="\/demo"/);
  assert.match(footer, /https:\/\/github\.com\/Enoch208\/vow/);
  assert.match(home, /github\.com\/Enoch208\/vow\/blob\/main\/PRIVACY\.md/);

  for (const path of ["/owner", "/operator", "/claim/0x45cc6c11f29f5fe7b53eee680c0626324e344af8d021ca7af58a1b1ecf2bb2b", "/verify"]) {
    assert.match(demo, new RegExp(`href: ["']${path.replace("/", "\\/")}["']`));
  }
  assert.match(demo, /href=\{productUrl\(href\)\}/);
  assert.doesNotMatch(sourceBundle(), /href=["'](?:#|javascript:|)["']/i);
});

test("the shell has no remote image, script, stylesheet, or font dependency", () => {
  const sources = sourceBundle();
  const css = text("app/globals.css");
  const config = text("next.config.ts");
  const packageJson = JSON.parse(text("package.json"));

  assert.doesNotMatch(sources, /<(?:Image|img|script|source|video|audio)\b[^>]*(?:src|poster)=\s*["'{]\s*https?:/i);
  assert.doesNotMatch(sources, /<(?:link)\b[^>]*href=\s*["'{]\s*https?:/i);
  assert.doesNotMatch(css, /@import\b|@font-face\b|url\(\s*["']?https?:/i);
  assert.doesNotMatch(sources, /next\/font\/google|fonts\.(?:googleapis|gstatic)\.com/i);
  assert.doesNotMatch(config, /remotePatterns|domains\s*:/);
  assert.deepEqual(Object.keys(packageJson.dependencies).sort(), ["next", "react", "react-dom"]);

  const imagePath = join(root, "public/vow-hero.png");
  assert.equal(existsSync(imagePath), true);
  const image = readFileSync(imagePath);
  assert.deepEqual([...image.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(image.readUInt32BE(16), 1254);
  assert.equal(image.readUInt32BE(20), 1254);
  assert.match(text("components/HeroArtwork.tsx"), /src="\/vow-hero\.png"/);
  assert.match(text("components/HeroArtwork.tsx"), /alt="[^"\n]+"/);
});

test("pages retain keyboard, landmark, reduced-motion, and mobile essentials", () => {
  const layout = text("app/layout.tsx");
  const home = text("app/page.tsx");
  const demo = text("app/demo/page.tsx");
  const header = text("components/SiteHeader.tsx");
  const footer = text("components/SiteFooter.tsx");
  const css = text("app/globals.css");

  assert.match(layout, /<html lang="en">/);
  for (const page of [home, demo]) {
    assert.equal((page.match(/<h1[ >]/g) ?? []).length, 1);
    assert.match(page, /<main\b/);
  }
  assert.match(header, /<header\b/);
  assert.match(header, /<nav[^>]+aria-label="Primary navigation"/);
  assert.match(header, /aria-label="VOW home"/);
  assert.match(footer, /<footer\b/);
  assert.doesNotMatch(sourceBundle(), /tabIndex=\{?["']?[1-9]/);
  assert.match(css, /:focus-visible[^{]*\{[^}]*outline:\s*3px/);
  assert.doesNotMatch(css, /outline:\s*(?:0|none)\b/);
  assert.match(css, /@media\s*\(max-width:\s*680px\)/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(css, /\.step-grid,\s*\.boundary-grid\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(css, /\.privacy-section\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(css, /\.fact-grid\s*\{\s*grid-template-columns:\s*1fr/);
  assert.match(css, /\.status-section\s*\{\s*grid-template-columns:\s*1fr/);
});
