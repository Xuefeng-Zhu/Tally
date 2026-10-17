import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const portValue = process.env.TALLY_WEB_PORT ?? '5173';
if (!/^\d{1,5}$/.test(portValue) || Number(portValue) < 1 || Number(portValue) > 65535) {
  throw new Error('TALLY_WEB_PORT must be a valid local TCP port.');
}
const proxyUrl = new URL(process.env.TALLY_API_PROXY_TARGET ?? 'http://127.0.0.1:4318');
if (proxyUrl.protocol !== 'http:' || !['127.0.0.1','localhost'].includes(proxyUrl.hostname) || proxyUrl.username || proxyUrl.password || proxyUrl.pathname !== '/' || proxyUrl.search || proxyUrl.hash) {
  throw new Error('TALLY_API_PROXY_TARGET must be a loopback HTTP origin.');
}

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  server: { host: '127.0.0.1', port: Number(portValue), strictPort: true, proxy: {
    '/api': { target: proxyUrl.origin, changeOrigin: true },
    '/fixtures': { target: proxyUrl.origin, changeOrigin: true },
  } },
  build: { outDir: '../../dist/web', emptyOutDir: true },
});
