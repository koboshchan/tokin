export const DEFAULT_CHAIN = "base";
export const CHAINS = [
  { key: "base", kind: "evm", id: 8453, hex: "0x2105", name: "Base", symbol: "ETH", currency: "Ether", rpc: ["https://mainnet.base.org"],
    explorer: "https://basescan.org", explorerName: "basescan", explorerSuffix: "", listingUrl: "https://basescan.org/tokenupdate",
    l1Note: "base l2 estimate only. base also charges an l1 data fee that isn't included here, so your wallet's final number will be higher." },
  { key: "ethereum", kind: "evm", id: 1, hex: "0x1", name: "Ethereum", symbol: "ETH", currency: "Ether", rpc: ["https://ethereum-rpc.publicnode.com"],
    explorer: "https://etherscan.io", explorerName: "etherscan", explorerSuffix: "", listingUrl: "https://etherscan.io/tokenupdate" },
  { key: "polygon", kind: "evm", id: 137, hex: "0x89", name: "Polygon", symbol: "POL", currency: "POL", rpc: ["https://polygon.drpc.org"],
    explorer: "https://polygonscan.com", explorerName: "polygonscan", explorerSuffix: "", listingUrl: "https://polygonscan.com/tokenupdate" },
  { key: "bnb", kind: "evm", id: 56, hex: "0x38", name: "BNB Chain", symbol: "BNB", currency: "BNB", rpc: ["https://bsc-dataseed.bnbchain.org"],
    explorer: "https://bscscan.com", explorerName: "bscscan", explorerSuffix: "", listingUrl: "https://bscscan.com/tokenupdate" },
  { key: "solana", kind: "sol", id: "solana", name: "Solana", symbol: "SOL", explorer: "https://solscan.io", explorerName: "solscan", explorerSuffix: "" },
];
export const chainByKey = (k) => CHAINS.find((c) => c.key === k) || null;
export const addParams = (c) => ({
  chainId: c.hex, chainName: c.name,
  nativeCurrency: { name: c.currency, symbol: c.symbol, decimals: 18 },
  rpcUrls: c.rpc, blockExplorerUrls: [c.explorer],
});
