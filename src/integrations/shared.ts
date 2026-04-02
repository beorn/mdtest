// Shared test registration logic for framework integrations (Bun, Vitest)
// Extracts the common code from bun.ts and vitest.ts

import { glob } from "glob"
import { basename, isAbsolute, resolve, join } from "node:path"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { parseBlock, matchLines, hintMismatch } from "../core.js"
import { parseMarkdown, findNearestHeading, generateTestId } from "../markdown.js"
import type { Heading, CodeBlock } from "../markdown.js"
import { readFile } from "fs/promises"
import { PluginExecutor } from "../plugin-executor.js"
import { parseFrontmatter } from "../options.js"
import { PLUGIN_LANGUAGES } from "../loader.js"

// Constants
const MAX_TEST_NAME_LENGTH = 60

// ============ Framework Adapter Interface ============

/**
 * Adapter for test framework primitives (describe, test, hooks).
 * Bun uses describe.serial/test.serial; Vitest uses describe/test.
 */
export interface FrameworkAdapter {
  describe(name: string, fn: () => void): void
  test(name: string, fn: () => Promise<void>): void
  beforeAll(fn: () => Promise<void>): void
  afterAll(fn: () => Promise<void>): void
  beforeEach(fn: () => Promise<void>): void
  afterEach(fn: () => Promise<void>): void
}

// ============ Types ============

interface TestStep {
  cmd: string
  expected: { stdout?: string[]; stderr?: string[]; exit?: number }
}

interface TestStructure {
  headings: Array<{
    path: string[] // ['Setup', 'Basic Command Execution']
    slug: string
    steps: TestStep[]
    index: number // Original index in document
    block: CodeBlock // Keep reference to original block
    heading: Heading | null // Keep reference to nearest heading
  }>
}

// ============ Discovery & Registration ============

export async function discoverMdTests(pattern = "**/*.spec.md"): Promise<string[]> {
  return glob(pattern)
}

export async function registerMdTests(
  adapter: FrameworkAdapter,
  pattern: string | string[] = "**/*.spec.md",
): Promise<void> {
  const files = Array.isArray(pattern) ? pattern : await discoverMdTests(pattern)
  for (const file of files) await registerMdTestFile(adapter, file)
}

export async function registerMdTestFile(adapter: FrameworkAdapter, filePath: string): Promise<void> {
  const absPath = isAbsolute(filePath) ? filePath : resolve(filePath)
  const md = await readFile(absPath, "utf8")
  const { headings, codeBlocks } = parseMarkdown(md)

  // Determine which languages are valid based on the plugin
  const frontmatter = parseFrontmatter(md)
  const pluginName = (frontmatter.plugin as string) ?? "bash"
  const pluginLangs = PLUGIN_LANGUAGES[pluginName]
  const acceptedLangs = pluginLangs ?? ["console", "sh", "bash"]

  const structure = buildTestStructure(codeBlocks, headings, acceptedLangs)
  const displayName = basename(absPath)
  registerTests(adapter, displayName, absPath, md, structure, codeBlocks, headings)
}

// ============ Constants ============

const SHELL_LANGS = new Set(["console", "sh", "bash"])

// ============ Test Structure ============

function buildTestStructure(
  codeBlocks: CodeBlock[],
  headings: Heading[],
  acceptedLangs: string[] = ["console", "sh", "bash"],
): TestStructure {
  const result: TestStructure = { headings: [] }
  const headingBlockCounts = new Map<string, number>()
  const accepted = new Set(acceptedLangs)

  for (let i = 0; i < codeBlocks.length; i++) {
    const block = codeBlocks[i]
    if (!block) continue

    // Skip file= blocks (they're helper files/hooks, not test commands)
    if (block.filename) continue

    // Only process blocks with accepted languages
    if (!block.lang || !accepted.has(block.lang)) {
      continue
    }

    let steps: TestStep[]

    if (SHELL_LANGS.has(block.lang)) {
      // Shell blocks: parse $ commands with expected output
      const parsed = parseBlock(block.value)
      steps = parsed.steps
      if (!steps.length) continue // Skip empty fences silently
    } else {
      // Non-shell blocks (tape, etc.): entire block is a single step
      // The plugin receives the full content and handles its own parsing
      const content = block.value.trim()
      if (!content) continue
      steps = [{ cmd: content, expected: { stdout: undefined, stderr: undefined, exit: undefined } }]
    }

    const nearestHeading = findNearestHeading(headings, block.position.start)
    const testId = generateTestId(nearestHeading, i, headingBlockCounts)

    // Build heading path hierarchy
    const headingPath = buildHeadingPath(nearestHeading, headings)

    result.headings.push({
      path: headingPath,
      slug: testId,
      steps,
      index: i,
      block,
      heading: nearestHeading,
    })
  }

  return result
}

function buildHeadingPath(heading: Heading | null, allHeadings: Heading[]): string[] {
  if (!heading) return ["(no heading)"]

  // Count H1 headings (depth 1)
  const h1Count = allHeadings.filter((h) => h.depth === 1).length
  const skipH1 = h1Count === 1 // Skip H1 if there's only one (document title)

  // Build path by ascending parent links
  const path: string[] = []
  let current: Heading | undefined = heading

  while (current) {
    // Skip single H1 (document title)
    if (!(skipH1 && current.depth === 1)) path.push(current.slug)

    current = current.parent
  }

  // Reverse to get root-to-leaf order
  path.reverse()

  return path.length > 0 ? path : ["(no heading)"]
}

// ============ Test Registration ============

function registerTests(
  adapter: FrameworkAdapter,
  displayName: string,
  filePath: string,
  md: string,
  structure: TestStructure,
  codeBlocks: CodeBlock[],
  headings: Heading[],
): void {
  adapter.describe(displayName, () => {
    const executor = new PluginExecutor(filePath, md)

    // Capture state for assertions
    const capsStdout: Record<string, string> = {}
    const capsStderr: Record<string, string> = {}

    // Test isolation: temp directory per file (matches CLI behavior)
    let originalCwd: string
    let tempDir: string

    adapter.beforeAll(async () => {
      originalCwd = process.cwd()
      tempDir = mkdtempSync(join(tmpdir(), "mdspec-"))
      process.chdir(tempDir)

      if (!process.env.ROOT) {
        process.env.ROOT = originalCwd
      }

      await executor.initialize(codeBlocks)

      // Pre-scan: find blocks that define hook functions and execute them first
      // This ensures beforeAll() can be defined in any block, not just the first
      const hookPattern = /^\$ (beforeAll|afterAll|beforeEach|afterEach)\(\)/m
      for (const block of codeBlocks) {
        if (block.lang !== "console" && block.lang !== "sh") continue
        if (hookPattern.test(block.value)) {
          const heading = findNearestHeading(headings, block.position.start)
          await executor.executeBlock({ lang: block.lang, info: block.meta || "", text: block.value }, heading)
        }
      }

      await executor.beforeAll()
    })

    adapter.beforeEach(async () => {
      await executor.beforeEach()
    })

    adapter.afterEach(async () => {
      await executor.afterEach()
    })

    adapter.afterAll(async () => {
      await executor.afterAll()

      process.chdir(originalCwd)
      try {
        rmSync(tempDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }
    })

    // Group steps by heading path for proper nesting
    const pathGroups = new Map<
      string,
      Array<{
        steps: TestStep[]
        index: number
        block: CodeBlock
        heading: Heading | null
      }>
    >()

    for (const heading of structure.headings) {
      const key = heading.path.join("\x00") // Use null byte as separator
      if (!pathGroups.has(key)) pathGroups.set(key, [])

      const group = pathGroups.get(key)
      if (group) {
        group.push({
          steps: heading.steps,
          index: heading.index,
          block: heading.block,
          heading: heading.heading,
        })
      }
    }

    // Sort by first occurrence in document to preserve execution order
    const sortedPaths = Array.from(pathGroups.entries()).sort((a, b) => {
      const aIndex = structure.headings.findIndex((h) => h.path.join("\x00") === a[0])
      const bIndex = structure.headings.findIndex((h) => h.path.join("\x00") === b[0])
      return aIndex - bIndex
    })

    for (const [pathKey, items] of sortedPaths) {
      items.sort((a, b) => a.index - b.index)
      const path = pathKey.split("\x00")
      registerNestedTests(adapter, path, items, executor, capsStdout, capsStderr)
    }
  })
}

function registerNestedTests(
  adapter: FrameworkAdapter,
  path: string[],
  items: Array<{
    steps: TestStep[]
    index: number
    block: CodeBlock
    heading: Heading | null
  }>,
  executor: PluginExecutor,
  capsStdout: Record<string, string>,
  capsStderr: Record<string, string>,
  depth = 0,
): void {
  if (depth >= path.length) {
    // Leaf level - register ONE test per block (not per step)
    for (const item of items) {
      // Build test name from first command
      const firstCmd = item.steps[0]?.cmd ?? "(empty)"
      let testName = firstCmd
        .replace(/\x1b\[[0-9;]*m/g, "") // Strip ANSI codes
        .replace(/\n/g, " ") // Replace newlines with spaces
        .replace(/\s+/g, " ") // Condense multiple spaces
        .trim()
      if (item.steps.length > 1) {
        testName += ` (+${item.steps.length - 1} more)`
      }
      if (testName.length > MAX_TEST_NAME_LENGTH) {
        testName = testName.slice(0, MAX_TEST_NAME_LENGTH - 3) + "..."
      }

      const isShell = SHELL_LANGS.has(item.block.lang || "console")
      const testPrefix = isShell ? "$ " : ""

      adapter.test(`${testPrefix}${testName}`, async () => {
        for (const step of item.steps) {
          // Shell blocks: wrap with $ prefix for extractCommands()
          // Non-shell blocks: pass content as-is to the plugin
          let blockText: string
          if (isShell) {
            const cmdLines = step.cmd.split("\n")
            blockText =
              cmdLines.length === 1
                ? `$ ${step.cmd}`
                : `$ ${cmdLines[0]}\n${cmdLines
                    .slice(1)
                    .map((l) => `> ${l}`)
                    .join("\n")}`
          } else {
            blockText = step.cmd
          }

          const blockResult = await executor.executeBlock(
            {
              lang: item.block.lang || "console",
              info: item.block.meta || "",
              text: blockText,
            },
            item.heading,
          )

          if (!blockResult) {
            throw new Error("Plugin did not handle command")
          }

          const { results, exitCode } = blockResult
          const stdout = results.flatMap((r) => r.stdout)
          const stderr = results.flatMap((r) => r.stderr)

          const wantStdout = step.expected.stdout ?? []
          const wantStderr = step.expected.stderr ?? []
          const wantExit = step.expected.exit ?? 0

          const outMatch = matchLines(wantStdout, stdout, capsStdout)
          const errMatch =
            wantStderr.length === 0
              ? matchLines(
                  [],
                  stderr.filter((l) => l.length),
                  capsStderr,
                )
              : matchLines(
                  wantStderr,
                  stderr.filter((l) => l.length),
                  capsStderr,
                )
          // null exitCode means "unknown" (no OSC 133 available) -- treat as passing
          const exitOk = exitCode === null || exitCode === wantExit

          if (!outMatch.ok || !errMatch.ok || !exitOk) {
            const errors: string[] = []
            errors.push(`Failed at command: $ ${step.cmd}`)
            if (!outMatch.ok) {
              errors.push(hintMismatch("stdout", wantStdout, stdout, outMatch.msg))
            }
            if (!errMatch.ok) {
              errors.push(hintMismatch("stderr", wantStderr, stderr, errMatch.msg))
            }
            if (!exitOk) {
              errors.push(`exit code: expected ${wantExit}, got ${exitCode}`)
            }
            throw new Error(errors.join("\n"))
          }
        }
      })
    }
    return
  }

  // Create describe block and recurse to preserve execution order
  adapter.describe(path[depth]!, () => {
    registerNestedTests(adapter, path, items, executor, capsStdout, capsStderr, depth + 1)
  })
}
