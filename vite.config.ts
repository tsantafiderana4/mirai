
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
// IMPORTANT : ne jamais injecter de clé API ici (via `define`) : tout ce qui
// est injecté finit en clair dans le JavaScript envoyé aux visiteurs.
// Les appels IA passent par l'Edge Function Supabase `gemini-api`.
export default defineConfig(() => {
  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['logo.svg', 'logo.png'],
        manifest: {
          name: "TeacherMada AI",
          short_name: "TeacherMada",
          description: "Apprenez les langues intelligemment avec votre professeur IA personnel.",
          theme_color: "#4f46e5",
          background_color: "#0f172a",
          display: "standalone",
          orientation: "portrait",
          icons: [
            {
              src: "/logo.svg",
              sizes: "any",
              type: "image/svg+xml",
              purpose: "any maskable"
            },
            {
              src: "/logo.png",
              sizes: "512x512",
              type: "image/png"
            }
          ]
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg}'],
          navigateFallback: '/index.html',
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              // Network Only for API and Supabase to ensure fresh data
              urlPattern: ({ url }) => url.hostname.includes('supabase.co') || url.pathname.includes('/api/'),
              handler: 'NetworkOnly',
            },
            {
              // Styles (Tailwind CDN) et polices : nécessaires pour ouvrir l'app
              // sans Internet (leçons au tableau hors ligne).
              urlPattern: ({ url }) => url.hostname === 'cdn.tailwindcss.com' || url.hostname === 'fonts.googleapis.com',
              handler: 'StaleWhileRevalidate',
              options: {
                cacheName: 'app-styles',
                cacheableResponse: { statuses: [0, 200] },
                expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 30 }
              }
            },
            {
              urlPattern: ({ url }) => url.hostname === 'fonts.gstatic.com',
              handler: 'CacheFirst',
              options: {
                cacheName: 'app-fonts',
                cacheableResponse: { statuses: [0, 200] },
                expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 365 }
              }
            },
            {
              // Cache external images (e.g., flags, avatars)
              urlPattern: ({ url }) => url.hostname.includes('flagcdn.com') || url.hostname.includes('dicebear.com') || url.hostname.includes('ibb.co'),
              handler: 'CacheFirst',
              options: {
                cacheName: 'external-images',
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 60 * 60 * 24 * 30 // 30 Days
                }
              }
            }
          ]
        }
      })
    ],
    build: {
      outDir: 'dist',
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react': ['react', 'react-dom', 'react-markdown', 'remark-gfm'],
            'vendor-ui': ['lucide-react'],
            'vendor-ai': ['@google/genai'],
            'vendor-db': ['@supabase/supabase-js'],
          }
        }
      }
    }
  }
})