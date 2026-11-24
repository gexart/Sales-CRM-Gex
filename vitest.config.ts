import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests cover pure logic (no Workers runtime). API behaviour is covered by scripts/smoke.mjs.
export default defineConfig({ resolve: { alias: { "@billing/shared": fileURLToPath(new URL("./shared/billing/index.ts", import.meta.url)) } }, test: { include: ["test/**/*.test.ts"], environment: "node" } });
