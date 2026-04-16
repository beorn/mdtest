import { defineConfig } from "vitest/config"

// Standalone vitest config for mdspec. Without this, vitest run from inside
// vendor/mdspec walks up to the km root vitest.config.ts and inherits its
// setupFiles path ("./packages/km-infra/vitest/setup.ts"), which then resolves
// relative to mdspec's directory and breaks ("Cannot find module
// vendor/mdspec/packages/km-infra/vitest/setup.ts").
//
// mdspec is a standalone submodule per vendor/CLAUDE.md — `bun test` and
// `vitest` must work from the package root without km infrastructure. Keep
// this config self-contained.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.slow.*", "**/*.spec.md"],
  },
})
