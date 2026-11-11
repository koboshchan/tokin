# tokin
Minimal noncustodial Base token launcher. All signing stays in the injected EVM wallet. No backend, analytics, API keys, or private keys.

`npm ci`, `npm run build`, `npm test`. `node scripts/ui-test.cjs` and `node scripts/ui-wallet-test.cjs` test the served build on port 43871 with Chromium. Tests spend only local simulated ETH, including a Base mainnet fork.

OpenZeppelin ERC20, Burnable, Capped, Pausable, Ownable; solc optimized200 targeting Shanghai. Immutable options. No tax or upgradeability. Cap is outstanding total supply, so burning can create minting headroom. Owner may mint or pause only when selected. Renunciation permanently removes administration; renunciation while paused is prohibited. Fixed supply without pause automatically has no owner.

Images are center-cropped to at most128px and capped at8192 UTF-8 data URI bytes in storage. Wallet/explorer logos remain off-chain. Standard JSON compiler inputs are served for reproducibility; deployment does not automatically verify on Basescan.

Your coins are local to this browser and origin, keyed by Base wallet, with feature and ownership reads from chain. Clearing browser storage loses the local list, not tokens. No global on-chain deployment index is claimed. Deployments do not create trading liquidity or price.

The displayed fee estimates L2 execution only, not the Base L1 data fee. The wallet shows the final transaction fee. Review every transaction before signing.
