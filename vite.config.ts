import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(() => {
  const isGasSingleFile = process.env.GAS_SINGLE_FILE === 'true';
  const rawBase = (process.env.VITE_BASE_PATH || '/').trim();
  const webBase = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;

  return {
    base: isGasSingleFile ? './' : webBase,
    plugins: [
      react(),
      tailwindcss(),
      ...(isGasSingleFile
        ? [
            {
              name: 'gas-single-file-stubs',
              resolveId(id: string) {
                if (id === 'virtual:pwa-register') return '\0virtual:pwa-register';
                if (
                  id === 'pdfjs-dist' ||
                  id === 'html2canvas' ||
                  id === 'canvg' ||
                  id === 'dompurify'
                ) {
                  return `\0gas-stub:${id}`;
                }
                return null;
              },
              load(id: string) {
                if (id === '\0virtual:pwa-register') {
                  return 'export function registerSW() { return () => Promise.resolve(); }';
                }
                if (id === '\0gas-stub:pdfjs-dist') {
                  return 'export const GlobalWorkerOptions = {}; export const getDocument = undefined;';
                }
                if (
                  id === '\0gas-stub:html2canvas' ||
                  id === '\0gas-stub:canvg' ||
                  id === '\0gas-stub:dompurify'
                ) {
                  return 'export default function() { return Promise.reject(new Error("Unused in GAS build")); } export const Canvg = undefined;';
                }
                return null;
              },
            },
          ]
        : [
            VitePWA({
              registerType: 'autoUpdate',
              includeAssets: [
                'apple-touch-icon.png',
                'pwa-192x192.png',
                'pwa-512x512.png',
                'pwa-maskable-512x512.png',
              ],
              devOptions: {
                enabled: true,
                type: 'module',
              },
              manifest: {
                id: webBase,
                name: 'SUNVILOZ Clean Care',
                short_name: 'SUNVILOZ',
                description:
                  'Operations, orders, accounting, supervisor field jobs, and financial reporting for SUNVILOZ Clean Care.',
                theme_color: '#0B1F3A',
                background_color: '#F8FAFC',
                display: 'standalone',
                orientation: 'portrait',
                scope: webBase,
                start_url: webBase,
                icons: [
                  {
                    src: `${webBase}pwa-192x192.png`,
                    sizes: '192x192',
                    type: 'image/png',
                    purpose: 'any',
                  },
                  {
                    src: `${webBase}pwa-512x512.png`,
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'any',
                  },
                  {
                    src: `${webBase}pwa-maskable-512x512.png`,
                    sizes: '512x512',
                    type: 'image/png',
                    purpose: 'maskable',
                  },
                ],
              },
              workbox: {
                maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
                globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
                navigateFallback: `${webBase}index.html`,
                navigateFallbackDenylist: [/^\/api\//],
                runtimeCaching: [
                  {
                    urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
                    handler: 'NetworkOnly',
                  },
                  {
                    urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/i,
                    handler: 'CacheFirst',
                    options: {
                      cacheName: 'google-fonts-cache',
                      expiration: {
                        maxEntries: 20,
                        maxAgeSeconds: 60 * 60 * 24 * 365,
                      },
                      cacheableResponse: { statuses: [0, 200] },
                    },
                  },
                ],
              },
            }),
          ]),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error || isGasSingleFile) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, { recursive: true, force: true });
          }
        },
      },
    ],
    ...(isGasSingleFile
      ? {
          base: './',
          build: {
            outDir: 'dist-gas',
            emptyOutDir: true,
            cssCodeSplit: false,
            assetsInlineLimit: 100_000_000,
            rollupOptions: {
              output: {
                codeSplitting: false,
              },
            },
          },
        }
      : {}),
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
