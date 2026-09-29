import { cloudflare } from '@cloudflare/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Cible JS explicite (Browserslist ne configure pas Vite).
 * Minimum des moteurs résolus par la requête Browserslist de package.json au 2026-09-27 :
 * voir docs/ARCHITECTURE.md § « Stack et compatibilité » et DECISIONS D21.
 */
export const BUILD_TARGET = ['chrome109', 'edge150', 'firefox140', 'safari18.5', 'ios18.5', 'opera134'];

export default defineConfig({
  // `cloudflare()` exécute le Worker (wrangler.jsonc) dans workerd en dev et en preview, sur la même origine
  // que le front, et construit son bundle avec le client (dist/client, dist/elem3nts) : PFC-011, D35.
  plugins: [react(), cloudflare()],
  build: {
    target: BUILD_TARGET,
    cssTarget: BUILD_TARGET,
    sourcemap: true,
    // Seul chunk au-delà de 500 kB : Three.js et le moteur de la maquette (541 kB, 140 kB gzip), chargés
    // à la demande hors du chargement initial (D33). Le seuil reste bas pour tout autre chunk.
    chunkSizeWarningLimit: 560,
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
});
