const { defineConfig } = require('vite');
const { nodePolyfills } = require('vite-plugin-node-polyfills');

module.exports = defineConfig({
  plugins: [nodePolyfills({
    // Required by Irys's browser SDK, including its EventEmitter uploader.
    include: ['buffer', 'crypto', 'events', 'stream', 'util', 'process'],
    globals: { Buffer: true, global: true, process: true },
    protocolImports: true,
  })],
});
