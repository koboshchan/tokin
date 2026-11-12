# Multichain release QA

Local tests use throwaway keys and simulated balances only. No real funds spent.

All 12 EVM option combinations passed against Ganache forks of Base 8453, Ethereum 1, Polygon 137, and BNB 56 using scripts/test-multichain.cjs.

The coordinator independently reran scripts/test-ui.cjs and scripts/ui-evm-lifecycle.cjs against the final built application. All five network controls, wallet chain-switch/add flow, currency labels, estimate invalidation, and four actual EVM deployment/mint UI lifecycles passed, including chain-isolated lists.

The coordinator independently reran scripts/ui-solana.cjs with SOL_RPC=http://127.0.0.1:18937 and SOL_WS=ws://127.0.0.1:18938. The actual production Solana module completed JSON-only deployment, mint, freeze/thaw, account change, authority revocations and pending-estimate chain-switch protection in Chromium against the local validator with cloned Metaplex program.

Responsive screenshots of all five networks at 390px and 1280px were reviewed by the UI owner. Mobile chain selection is a single row and text/control alignment fixes are included.

See test-solana-qa.md for 13-group on-chain module coverage and full dependency risk assessment. Tests do not establish live mainnet RPC availability or actual paid Irys service acceptance; browser upload tests use mocked Irys HTTP and real disposable signing keys.
