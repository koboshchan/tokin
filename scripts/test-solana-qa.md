# Solana implementation QA

Execution used an official Agave 3.1.8 local validator bound to 127.0.0.1, HTTP 18937 and websocket 18938, with the live Metaplex Token Metadata program cloned into the local ledger. All payer/mint keys were throwaway in-memory keys. No real wallet or funds were used. Devnet faucet returned HTTP 410, so no devnet success is claimed.

`node scripts/test-solana.mjs` passes 13 groups. It executes real transactions against that validator and reads actual SPL mint, token account, and Metaplex metadata account state. Only the RPC constant is rewritten in a temporary test copy of the production module. The temporary file is removed afterward.

The groups cover u64 parsing, unsafe URI rejection, atomic mint/ATA/initial supply, actual immutable Metaplex name/symbol/URI, mint/burn, frozen burn/refreeze-authority revocation rejection, thaw and authority revocation with holder burns still allowed, all four mintable/freezable combinations, live maximum-u64 supply and overflow rejection, concurrent mutation rejection, wallet-signature rejection without fake success and reusable metadata URI, and account changes during an RPC preventing signing.

`npm run build` and existing `npm test` pass. The latter covers existing EVM creation, minting/owner checks/renunciation and 12 feature combinations. Ganache uses its JavaScript fallback because the optional native uWS binary does not match Node 24. This does not skip the tests.

Browser dynamic import of the production Irys uploader bundle passes after adding narrowly scoped browser polyfills. This is NOT an end-to-end upload pass. Signed browser uploads with mocked Irys HTTP and a throwaway signing wallet remain an explicit publication gate. UI/browser integration scripts are owned by the UI worker and are not included in this implementation commit.

## Storage and wallet safety

Irys uploads use the supported `https://uploader.irys.xyz` Irys L1 endpoint. They are not described as Arweave; former Arweave nodes were retired November 1, 2026. Prices are read for each serialized data item including signature header and tags. Displayed funding has a 10% quote ceiling and is cached for five minutes, tied to the exact wallet, form fields and image SHA-256. Deploy fails closed if the current price or required deposit exceeds that ceiling. Funding uses an exact amount and `skipBalanceCheck=true`, never implicit auto-funding. A separate explicit confirmation precedes the wallet funding signature. All storage signatures recheck the captured wallet. Image and metadata URIs are cached separately to permit retries without re-uploading a successful image. Custom metadata URLs skip importing the uploader entirely.

Mutation operations are serialized. Wallet identity is captured before asynchronous work and rechecked before signing. Freeze authority revocation scans all mint accounts at confirmed commitment and at least the current confirmed slot, refusing while any is frozen. RPC scan errors fail closed. External wallets independently using the same authority remain outside the application's local mutex.

`getCoin` and holder burns use the wallet's associated token account, not arbitrary ancillary token accounts. The UI should not describe that balance as an aggregate of every possible account.

## Dependency audit, November 11, 2026

No zero-vulnerability claim is made. A scoped compatible override updates `@ethersproject/providers -> ws` from pinned 8.18.0 to the patched 8.21.x line. No forced major upgrades were used.

A clean separate installation with only package.json production dependencies and the same overrides reports 34 findings: 0 critical, 6 high, 13 moderate, 15 low. These totals include parent packages marked vulnerable through their dependencies, not 34 distinct root advisories. `npm audit --omit=dev` in the original working tree reports 65 findings: 4 critical, 25 high, 19 moderate, 17 low; this includes bundled Ganache dependencies despite Ganache being a dev dependency. Both reports are preserved as `scripts/test-solana-audit-production.json` and `scripts/test-solana-audit-worktree.json`.

Remaining root advisory paths and scope follow.

`@solana/spl-token -> @solana/buffer-layout-utils -> bigint-buffer@1.1.5`, GHSA-3gc7-fjrx-p6mg, high native toBigIntLE buffer overflow. Its package browser map replaces dist/node.js with dist/browser.js. Inspected browser source implements conversion using Buffer and BigInt and never calls the native converter. This mitigates the reported native issue for the static browser deployment; Node consumers should not treat the native dependency as cleared. No compatible upstream fix is available in this dependency line. Do not use this application as a Node service parsing untrusted native buffers.

`@solana/web3.js -> jayson -> stream-json@1.9.1`, GHSA-528h-pc64-c93x, GHSA-hqr4-qq8f-hg3x and GHSA-mjw6-4jj6-33hc, moderate parsing/prototype/DoS issues. Jayson's browser client imports uuid.v4 and does not import lib/utils.js, where its server stream-json parser lives. Production application uses the browser client and JSON RPC over fetch, not the server stream parser. Available fixes require incompatible stream-json majors; no major override was attempted.

`@solana/web3.js -> jayson -> uuid@8.3.2`, GHSA-w5hq-g745-h8pq, moderate bounds checks in v3/v5/v6 with caller-provided buffers. Installed jayson/lib/client/browser/index.js uses only uuid.v4 without an output buffer, outside the advisory's reported variants. Upgrading uuid through its current API boundary would be a breaking change, so no blind override was added.

`@metaplex-foundation/umi-uploader-irys -> @irys/upload -> csv-parse@5.6.0`, GHSA-8cw4-87c7-c6xx, moderate prototype replacement via columns parsing. This is imported by the Node folder-upload implementation, not @irys/web-upload's file/data-item path. The browser application calls only signed raw data-item uploads and never parses CSV or accepts columns options. The compatible 5.x line has no patch; fixed 7.x is a major change, not forced here.

`@metaplex-foundation/umi-uploader-irys -> Irys bundles -> @ethersproject/signing-key -> elliptic`, GHSA-848j-6mx2-7j84, low risky cryptographic primitive. Irys carries other-chain signer implementations in its bundle. This application uses the injected Solana Ed25519 signer and Phantom transaction signatures, not elliptic ECDSA key operations. It never imports a private wallet key. The dependency remains reported rather than being suppressed.

The browser bundle still has an optional vm externalization from parse-asn1/asn1.js. Module import succeeds, but full browser Irys signed-upload execution is required before publishing. Lazy loading confines the heavy Irys dependency graph to actual upload users; custom metadata URL users do not load it.
