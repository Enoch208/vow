# Contributing to VOW

VOW currently implements a collection compatibility experiment. It is not the complete VowVault product. Read [README.md](README.md), [THREAT_MODEL.md](THREAT_MODEL.md), [PRIVACY.md](PRIVACY.md), [COMPATIBILITY.md](COMPATIBILITY.md), and [evidence/claims.json](evidence/claims.json) before changing transaction, wallet, or evidence code.

## Security rules

- Preserve exact destination binding, single-use collection, reservation accounting, pool-only collection, and owner/operator separation.
- Never turn an unresolved mainnet dependency into a mock presented as live behavior.
- Treat a timeout or missing receipt as unknown. Reconcile it before allowing a retry.
- Keep private keys, recovery phrases, permission witnesses, proof material, and confidential purchase data out of source, fixtures, logs, URLs, screenshots, and evidence files.
- Add a negative or adversarial test with every money-moving change. Keep public claims within the tier recorded in `evidence/claims.json`.

## Local checks

Use Node.js 24.14 or newer within major version 24 and the pinned dependencies.

```sh
npm ci
npm run check
sh scripts/cairo.sh test
```

`npm run diagnostic` serves the local wallet, activation, deployment, and collection review routes. `npm run supplier` serves the isolated supplier-key tool. These loopback pages are not a public demo and do not establish mainnet execution.

## Contribution rules

- Keep public documentation limited to `README.md`, `JUDGES.md`, `AGENTS.md`, `DECISIONS.md`, `THREAT_MODEL.md`, `PRIVACY.md`, `COMPATIBILITY.md`, `REPRODUCE.md`, `PROTOCOL_FINDINGS.md` when backed by a real finding, and `LICENSE`.
- Use exact integer units for token values. Pin chain, pool, token, class, and wallet assumptions in evidence rather than relying on defaults.
- Prefer small typed modules. Do not ship placeholders, `TODO` or `FIXME` markers, unused dependencies, or source comments; use names, types, and small functions to carry meaning. Shebangs are the exception.
- Update tests, evidence, and public documentation together when behavior or privacy boundaries change.
