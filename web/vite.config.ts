// The server serves the production build from the same origin. In development Vite proxies /api
// (the live stream included) to the server on 127.0.0.1:7430 (SETPOINT_PORT). It keeps the
// browser's Host, so the session cookie and the server's own-page check see Vite's origin.
// A worktree's Vite in front of setpoint-dev's API (`npm run try` from a worktree) sets
// SETPOINT_PAGE_ORIGIN to setpoint-dev's page. Then it passes a change sent from this Vite's own page
// on as from that page, so the shared API takes it. A change from anywhere else still isn't.
// `npm run try -- --lan` also sets SETPOINT_LAN: Vite listens on the LAN, and a change from its own
// page at a LAN address (the Origin naming the same host the request came to) passes on as from
// SETPOINT_PAGE_ORIGIN. Vite's host check refuses unknown host names, so a rebound name can't pose
// as the page.
// Fonts and glyphs are bundled: nothing loads from the network at runtime.
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';
import type {ProxyOptions} from 'vite';

const pageOrigin = process.env.SETPOINT_PAGE_ORIGIN;
const lan = process.env.SETPOINT_LAN === '1';

/** Passes a request from this Vite's own page on as from `origin`. */
function asPage(origin: string): ProxyOptions['configure'] {
  return proxy => proxy.on('proxyReq', (request, incoming) => {
    const sent = incoming.headers.origin;
    const own = incoming.headers.host;
    if (!sent || !own || !URL.canParse(sent)) return;
    const from = new URL(sent);
    const loopback = from.hostname === 'localhost' || from.hostname === '127.0.0.1';
    if ((loopback || lan) && from.host === own) request.setHeader('origin', origin);
  });
}

export default defineConfig({
  plugins: [react()],
  server: {
    cors: false,
    proxy: {'/api': {target: `http://127.0.0.1:${process.env.SETPOINT_PORT ?? 7430}`, changeOrigin: false, ...(pageOrigin ? {configure: asPage(pageOrigin)} : {})}},
  },
  build: {outDir: 'dist', emptyOutDir: true, target: 'es2022'},
});
