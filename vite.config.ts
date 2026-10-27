import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { availableParallelism } from 'node:os';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * Development only: original map art is not bundled (native downloads each map on first
 * use), so the dev server answers `/pet-map-art/<hash>.webp` from the unbundled delivery
 * folder for the browser preview. Only exact file names of the manifest are served; builds
 * never include them.
 */
function devMapArt(): Plugin {
  const folder = new URL('./artwork/delivery/pet-map-art/', import.meta.url);
  const manifest = JSON.parse(
    readFileSync(new URL('./frontend/src/data/pet-map-art.json', import.meta.url), 'utf8'),
  ) as { images: { file: string }[]; overviews: { file: string }[] };
  const known = new Set([...manifest.images, ...manifest.overviews].map((e) => e.file));
  return {
    name: 'aion-dev-map-art',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/pet-map-art/', (req, res) => {
        const name = (req.url ?? '').replace(/^\//, '').split('?')[0]!;
        let body: Buffer | null = null;
        // Like the native protocol: anything but a known delivered file is absent.
        if (/^[a-f0-9]{20}\.webp$/.test(name) && known.has(name))
          try {
            body = readFileSync(new URL(name, folder));
          } catch {
            body = null;
          }
        if (!body) {
          res.statusCode = 404;
          res.end();
          return;
        }
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(body);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devMapArt()],
  root: 'frontend',
  // `@/` is the alias components.json gives the shadcn CLI (see docs/DESIGN_SYSTEM.md).
  resolve: { alias: { '@': fileURLToPath(new URL('./frontend/src', import.meta.url)) } },
  clearScreen: false,
  server: { host: '127.0.0.1', port: Number(process.env.AION_DEV_PORT ?? 1420), strictPort: true },
  build: { outDir: '../dist', emptyOutDir: true },
  test: {
    environment: 'jsdom',
    // Each worker owns a browser environment; keep interaction tests responsive under load.
    maxWorkers: Math.min(4, Math.max(1, availableParallelism() - 1)),
    include: ['src/**/*.test.{ts,tsx}'],
    // A real translation engine over the shipped catalogs, in English unless a test switches.
    setupFiles: ['src/i18n/testSetup.ts'],
  },
});
