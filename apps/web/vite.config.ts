import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg"],
      manifest: {
        name: "BAZE P2P",
        short_name: "BAZE P2P",
        description: "Fast mobile P2P USDT and USDC trading",
        theme_color: "#0f172a",
        background_color: "#f8fafc",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        icons: [{ src: "/favicon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }]
      },
      workbox: {
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith("/api/"),
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "baze-api-cache",
              expiration: { maxEntries: 80, maxAgeSeconds: 60 }
            }
          },
          {
            urlPattern: ({ request }) => request.destination === "document",
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "baze-pages",
              expiration: { maxEntries: 10, maxAgeSeconds: 24 * 60 * 60 }
            }
          }
        ]
      }
    })
  ],
  server: {
    host: "0.0.0.0",
    port: 5173
  }
});
