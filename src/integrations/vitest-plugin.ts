/**
 * Vitest Plugin for .test.md files
 *
 * Allows running `vitest tests/foo.test.md` directly without wrapper files.
 */

import type { Plugin } from "vite"
import { resolve, isAbsolute, dirname, join } from "path"
import { fileURLToPath } from "url"

// Resolve the vitest integration path at load time (same directory as this plugin)
const __dirname = dirname(fileURLToPath(import.meta.url))
const vitestIntegrationPath = join(__dirname, "vitest.ts")

export function mdtest(): Plugin {
  return {
    name: "vitest-mdtest",
    enforce: "pre",

    // Transform .test.md files into runnable test modules
    transform(code: string, id: string) {
      if (!id.endsWith(".test.md")) {
        return null
      }

      // Generate a virtual test module that registers the markdown tests
      const absPath = isAbsolute(id) ? id : resolve(id)

      // Use absolute path to vitest integration (resolved at plugin load time)
      const transformed = `
import { registerMdTestFile } from ${JSON.stringify(vitestIntegrationPath)}

await registerMdTestFile(${JSON.stringify(absPath)})
`
      return {
        code: transformed,
        map: null,
      }
    },
  }
}

export default mdtest
