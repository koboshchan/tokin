# tokin

Minimal noncustodial token launcher for Base, Ethereum, Polygon PoS, BNB Smart Chain and Solana. Signing stays in your injected wallet. Static site, no backend or private keys.

## Development

`npm ci` then `npm run build`. `npm test` runs original EVM contract tests. `CHAIN_ID=137 FORK_URL=https://polygon.drpc.org node scripts/test-multichain.cjs` runs the full feature matrix against a local Ganache mainnet fork. Repeat for Base (8453), Ethereum (1) and BNB Smart Chain (56). These tests use simulated funds only. UI test scripts use Chromium and the static preview on port 43871.

## EVM

The same OpenZeppelin ERC20 contract is deployed on each selected chain, compiled with solc optimized200 targeting Shanghai. Burnable, capped, pausable and mintable options are immutable. No tax or upgradeability. A cap limits outstanding supply, so burns create minting headroom. The owner can mint or pause only when selected. Renunciation permanently removes administration; renunciation while paused is prohibited. Fixed supply without pause automatically has no owner.

EVM tokens use 18 decimals. Images are center-cropped to at most128px and limited to8192 UTF-8 data URI bytes in contract storage. Wallet/explorer logos remain separate and off-chain. Public compiler JSON inputs allow reproduction; deployment does not automatically verify the contract on explorers.

Fees are displayed in the selected chain's native currency (ETH, POL or BNB). Base estimates exclude the additional L1 data fee. The wallet displays the final transaction fee.

## Solana

Solana uses the original SPL Token program with 9 decimals and Metaplex token metadata, not the EVM contract. Phantom signs transactions on Solana mainnet. Fixed supply revokes mint authority after initial mint; mintable retains it. Burning is always supported for holders. There is no native supply cap. Freezable retains freeze authority for specific token accounts, not a global pause. Revoking authorities is irreversible.

Solana image and JSON uploads use wallet-authorized Irys storage without server secrets. Current Irys uploads target Irys L1, not Arweave: Irys retired its Arweave upload endpoints on November 1, 2026. Storage pricing is quoted before deployment. Uploads and storage funding cannot be rolled back if token creation is declined later. An advanced custom metadata URI also supports externally hosted JSON. Data URIs are not used as Metaplex metadata URIs. A mutable web server can change its JSON/image even if the on-chain URI is immutable.

## Your coins

The list is local to this browser and origin, isolated by chain and wallet. Feature/authority and balance reads come from chain. Clearing browser storage loses the list, not the tokens. No global deployment index is claimed. Deploying a token does not create liquidity or a price. Review every wallet transaction before signing.
