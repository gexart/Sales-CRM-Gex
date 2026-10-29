import { defineConfig } from "vitest/config";

// Unit tests cover pure logic (no Workers runtime). API behaviour is covered by scripts/smoke.mjs.
export default defineConfig({ test: { include: ["test/**/*.test.ts"], environment: "node" } });
