import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@billing/shared": fileURLToPath(new URL("./shared/billing/index.ts", import.meta.url)) } },
  // Remote bindings (Workers AI) need a Cloudflare login; set CF_REMOTE_BINDINGS=1 to use them in dev.
  plugins: [react(), tailwindcss(), cloudflare({ remoteBindings: process.env.CF_REMOTE_BINDINGS === "1" })],
});
