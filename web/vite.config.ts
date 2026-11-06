// The production build is served by the server from the same origin. In development Vite proxies
// /api (the live stream included) to the server on 127.0.0.1:7430 (SETPOINT_PORT), keeping the
// browser's Host so the session cookie and the server's own-page check see Vite's origin.
// A worktree's Vite in front of setpoint-dev's API (`npm run try` from a worktree, SV-212) sets
// SETPOINT_PAGE_ORIGIN to setpoint-dev's page: a change sent from this Vite's own page is passed
// on as from that one, so the shared API takes it; one from anywhere else still isn't.
// Fonts and glyphs are bundled: nothing loads from the network at runtime.
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';
import type {ProxyOptions} from 'vite';

const pageOrigin = process.env.SETPOINT_PAGE_ORIGIN;

/** Passes a request from this Vite's own page on as from `origin`. */
function asPage(origin: string): ProxyOptions['configure'] {
  return proxy => proxy.on('proxyReq', (request, incoming) => {
    const sent = incoming.headers.origin;
    const own = incoming.headers.host;
    if (!sent || !own || !URL.canParse(sent)) return;
    const from = new URL(sent);
    const loopback = from.hostname === 'localhost' || from.hostname === '127.0.0.1';
    if (loopback && from.host === own) request.setHeader('origin', origin);
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
