# Implementation decisions

The first deliverable is a narrowly scoped collection experiment plus reusable authorization primitives. It must remain clearly separate from the eventual VowVault. Full procurement functionality is gated on live supplier collection compatibility.

Collection amounts use u128 to match the documented pool deposit interface. All client money calculations use bigint. Cumulative accounting in the final vault will use checked widths appropriate to total funding.

SDK signatures use a canonical, fixed-order Poseidon digest that binds chain, contract, mandate, reservation, token, exact amount, note identifier, and deadline. Cross-language vectors must agree before the digest is used with funds.

Only public dependency sources and synthetic local tests may supply test data. User wallet keys, real permission witnesses, and plaintext purchase details must not appear in fixtures or outputs.

Supplier key generation and signing run on a separate loopback origin from wallet preparation. Encrypted backup restoration is required before displaying a public key for deployment, reducing the chance of committing a key without a usable saved backup. The application never needs the supplier's plaintext key or password in its server or collection page.

Test-budget calculations require explicit principal, all fee categories and a recent quote. A missing estimate remains unknown; a local cap calculation is not a transaction authorization.
