import { describe, test, expect } from "vitest"
import { PluginExecutor } from "../src/plugin-executor"
import { parseMarkdown } from "../src/markdown"
import { writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * Creates a temp directory with a mock plugin and test markdown file.
 * The mock plugin returns fixed stdout/stderr for any command.
 */
function createTestSetup(pluginStdout: string, pluginStderr = "") {
  const dir = mkdtempSync(join(tmpdir(), "mdtest-plugin-test-"))

  // Write a mock plugin that returns fixed output
  const pluginPath = join(dir, "mock-plugin.ts")
  writeFileSync(
    pluginPath,
    `export default function(fileOpts) {
  return {
    block(opts) {
      return async (cmd) => ({
        stdout: ${JSON.stringify(pluginStdout)},
        stderr: ${JSON.stringify(pluginStderr)},
        exitCode: 0,
      })
    },
  }
}
`,
  )

  const mdContent = `---\nmdtest:\n  plugin: ./mock-plugin.ts\n---\n\n# Test\n\n\`\`\`console\n$ run\n\`\`\`\n`
  const mdPath = join(dir, "test.test.md")
  writeFileSync(mdPath, mdContent)

  return { dir, mdPath, mdContent }
}

describe("PluginExecutor", () => {
  describe("blank line handling", () => {
    test("preserves internal blank lines in stdout", async () => {
      const { mdPath, mdContent } = createTestSetup("line1\n\nline3\n")

      const executor = new PluginExecutor(mdPath, mdContent)
      const { codeBlocks } = parseMarkdown(mdContent)
      await executor.initialize(codeBlocks)

      const result = await executor.executeBlock({ lang: "console", info: "", text: "$ run" }, null)

      expect(result).not.toBeNull()
      // Internal blank line should be preserved
      expect(result!.results[0]!.stdout).toEqual(["line1", "", "line3"])
    })

    test("trims trailing blank lines in stdout", async () => {
      const { mdPath, mdContent } = createTestSetup("line1\nline2\n\n\n")

      const executor = new PluginExecutor(mdPath, mdContent)
      const { codeBlocks } = parseMarkdown(mdContent)
      await executor.initialize(codeBlocks)

      const result = await executor.executeBlock({ lang: "console", info: "", text: "$ run" }, null)

      expect(result).not.toBeNull()
      // Trailing blank lines should be trimmed
      expect(result!.results[0]!.stdout).toEqual(["line1", "line2"])
    })

    test("preserves internal blank lines in stderr", async () => {
      const { mdPath, mdContent } = createTestSetup("", "err1\n\nerr3\n")

      const executor = new PluginExecutor(mdPath, mdContent)
      const { codeBlocks } = parseMarkdown(mdContent)
      await executor.initialize(codeBlocks)

      const result = await executor.executeBlock({ lang: "console", info: "", text: "$ run" }, null)

      expect(result).not.toBeNull()
      // Internal blank line should be preserved
      expect(result!.results[0]!.stderr).toEqual(["err1", "", "err3"])
    })
  })
})
