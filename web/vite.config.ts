// The production build is served by the server from the same origin. In development Vite proxies
// /api (the live stream included) to the server on 127.0.0.1:7430 (SETPOINT_PORT), keeping the
// browser's Host so the session cookie and the server's own-page check see Vite's origin.
// Fonts and glyphs are bundled: nothing loads from the network at runtime.
import react from '@vitejs/plugin-react';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    cors: false,
    proxy: {'/api': {target: `http://127.0.0.1:${process.env.SETPOINT_PORT ?? 7430}`, changeOrigin: false}},
  },
  build: {outDir: 'dist', emptyOutDir: true, target: 'es2022'},
});
