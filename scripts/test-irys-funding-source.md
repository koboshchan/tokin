Funding finality fix evidence, November 11 2026

Checked the repository and parent directories for AGENTS.md and CLAUDE.md; none found.
chub search irys --json returned no documentation entries. Used the current installed official SDK source and its upstream instead.

Official upstream https://github.com/Irys-xyz/js-sdk
Browser package https://github.com/Irys-xyz/js-sdk/blob/master/packages/solana-web/README.md

Installed sources inspected
node_modules/@irys/upload-core/src/fund.ts
node_modules/@irys/upload-core/src/utils.ts
node_modules/@irys/web-upload-solana/dist/esm/token.js
node_modules/@metaplex-foundation/umi-uploader-irys/dist/esm/webPlugin.mjs
node_modules/@irys/upload-core/src/api.ts

Fund.fund obtains utils.getBundlerAddress(token), calls tokenConfig.createTx(amount,to,fee) and tokenConfig.sendTx(tx.tx), then confirmationPoll. confirmationPoll returns a timeout error instead of rejecting; Fund.fund nevertheless calls submitTransaction. Solana getTx defaults to finalized and throws Confirmed tx not found when getTransaction is null. This is a confirmed SDK control-flow weakness, not proof why the attempted mainnet signature was absent.

Fund.submitFundTransaction publicly wraps private submitTransaction and retries only for about five seconds. The exact registration request is api.post('/account/balance/' + token,{tx_id:signature}) with response status 202. New code uses that same request directly with bounded 8-second timeout per request and larger bounded backoff. No private method is called.

Funding now sends once, saves signature immediately, polls only signature statuses + getTransaction at tokenConfig.finality (finalized by default), tries alternate read RPCs on null/indexing lag, then registers only after both chain status and full transaction meta are visible and successful. Retry paths never create/sign/send a second funding transaction. An unknown send outcome is fail-closed. Explicit wallet rejection clears an unsent guard. Pending guard persists through registration and deposit credit. Token minting and uploads do not run after a timeout.

No priority-fee amount/instruction is requested for storage funding. Existing quote ceiling, separate confirmation, wallet owner checks and cached image/metadata behavior retained.

Automated checks use entirely mocked RPC and SDK objects. No browser, chain send, wallet access or funds used. Live mainnet deploy test is explicitly gated on a new user go.

Processed-deposit recovery, November 11 2026
The actual confirmed mainnet registration returned HTTP200 body "Tx already processed (confirmed)" instead of SDK expected202. This is acknowledged only for exact duplicate-response text, JSON-encoded string, or message/error object fields on HTTP200. An ACK does not prove spendable credit: bounded getBalance polling must succeed before releasing pending guard or uploading. HTTP202 behavior unchanged. Axios response objects are handled equivalently. All retry paths reuse the persisted signature; no new create/send call.
Pending quote drift can no longer abort deposit recovery or advertise a new storage payment. New-payment price ceilings remain unchanged.
21 mocked funding groups pass, including actual duplicate response, delayed credit, timeout and changed-ceiling retry with zero new broadcasts. Six source-pattern checks cover uploader guards but are not runtime integration coverage. Existing contract tests, ID tests and full production build pass. No wallet or chain sends in these tests.
