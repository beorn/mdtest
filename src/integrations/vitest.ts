// Vitest test integration for .test.md files
// Usage: Create a wrapper test file that calls registerMdTests()
//
// Example: tests/md.test.ts
// import { registerMdTests } from '@beorn/mdtest/vitest'
// await registerMdTests('tests/e2e/**/*.test.md')

import {
  test,
  describe,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "vitest"
import { glob } from "glob"
import { basename, isAbsolute, resolve, join } from "node:path"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { parseBlock, matchLines, hintMismatch } from "../core.js"
import {
  parseMarkdown,
  findNearestHeading,
  generateTestId,
} from "../markdown.js"
import type { Heading, CodeBlock } from "../markdown.js"
import { readFile } from "fs/promises"
import { PluginExecutor } from "../plugin-executor.js"
import type { ShellResult, ShellOptions } from "../shell.js"

// Constants
const MAX_TEST_NAME_LENGTH = 60

// Discovery API
export async function discoverMdTests(
  pattern = "**/*.test.md",
): Promise<string[]> {
  return glob(pattern)
}

// Register all .test.md files as Vitest tests
export async function registerMdTests(
  pattern: string | string[] = "**/*.test.md",
): Promise<void> {
  // Handle both string patterns and arrays of file paths
  const files = Array.isArray(pattern)
    ? pattern
    : await discoverMdTests(pattern)

  for (const file of files) await registerMdTestFile(file)
}

// Register a single .test.md file as Vitest tests
export async function registerMdTestFile(filePath: string): Promise<void> {
  // Resolve to absolute path
  const absPath = isAbsolute(filePath) ? filePath : resolve(filePath)
  const md = await readFile(absPath, "utf8")
  const { headings, codeBlocks } = parseMarkdown(md)

  // Build hierarchical test structure
  const structure = buildTestStructure(codeBlocks, headings, absPath)

  // Use basename only (relative to test discovery file)
  // Pattern like 'packages/mdtest/tests/*.test.md' → 'features.test.md'
  const displayName = basename(absPath)

  // Register tests with Vitest
  registerVitestTests(displayName, absPath, md, structure, codeBlocks, headings)
}

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

function buildTestStructure(
  codeBlocks: CodeBlock[],
  headings: Heading[],
  _filePath: string,
): TestStructure {
  const result: TestStructure = { headings: [] }
  const headingBlockCounts = new Map<string, number>()

  for (let i = 0; i < codeBlocks.length; i++) {
    const block = codeBlocks[i]
    if (!block) continue

    // Skip file= blocks (they're helper files/hooks, not test commands)
    if (block.filename) continue

    // Only process shell code blocks
    if (!block.lang || !["console", "sh", "bash"].includes(block.lang)) {
      continue
    }

    const { steps } = parseBlock(block.value)

    if (!steps.length) continue // Skip empty fences silently

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

function buildHeadingPath(
  heading: Heading | null,
  allHeadings: Heading[],
): string[] {
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

function registerVitestTests(
  displayName: string,
  filePath: string,
  md: string,
  structure: TestStructure,
  codeBlocks: CodeBlock[],
  _headings: Heading[],
): void {
  // Wrap entire file in a describe block with sequential execution
  // (shared plugin state must not be accessed concurrently)
  describe(displayName, () => {
    // Create plugin executor for this file
    const executor = new PluginExecutor(filePath, md)

    // Capture state for assertions
    const capsStdout: Record<string, string> = {}
    const capsStderr: Record<string, string> = {}

    // Test isolation: temp directory per file (matches CLI behavior)
    let originalCwd: string
    let tempDir: string

    // Track beforeAll timing - call after first test (like CLI does)
    // This allows the first test to define beforeAll() function
    let beforeAllCalled = false
    let firstTestCompleted = false

    beforeAll(async () => {
      // Create isolated temp directory and chdir into it
      originalCwd = process.cwd()
      tempDir = mkdtempSync(join(tmpdir(), "mdtest-"))
      process.chdir(tempDir)

      // Set ROOT so tests can reference source tree
      if (!process.env.ROOT) {
        process.env.ROOT = originalCwd
      }

      // Initialize plugin (loads from frontmatter, writes file= blocks)
      await executor.initialize(codeBlocks)

      // NOTE: Don't call beforeAll() here - wait until after first test
      // so that test can define beforeAll() function first
    })

    beforeEach(async () => {
      // Call plugin's beforeAll after first test completes (matches CLI)
      if (firstTestCompleted && !beforeAllCalled) {
        await executor.beforeAll()
        beforeAllCalled = true
      }
      await executor.beforeEach()
    })

    afterEach(async () => {
      await executor.afterEach()
      firstTestCompleted = true
    })

    afterAll(async () => {
      await executor.afterAll()

      // Restore original cwd and cleanup temp directory
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
      if (group)
        group.push({
          steps: heading.steps,
          index: heading.index,
          block: heading.block,
          heading: heading.heading,
        })
    }

    // Register nested describe blocks for each unique path
    // Sort by first occurrence in document to preserve execution order
    const sortedPaths = Array.from(pathGroups.entries()).sort((a, b) => {
      // Get first heading for each path from structure.headings
      const aIndex = structure.headings.findIndex(
        (h) => h.path.join("\x00") === a[0],
      )
      const bIndex = structure.headings.findIndex(
        (h) => h.path.join("\x00") === b[0],
      )
      return aIndex - bIndex
    })

    for (const [pathKey, items] of sortedPaths) {
      // Sort items by original document index to preserve order
      items.sort((a, b) => a.index - b.index)
      const path = pathKey.split("\x00")
      registerNestedTests(path, items, executor, capsStdout, capsStderr)
    }
  })
}

function registerNestedTests(
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
    // Leaf level - register tests for each block
    for (const item of items) {
      // Register one test per step within the block
      for (const step of item.steps) {
        // Sanitize command for test name: strip ANSI, condense whitespace, truncate
        let testName = step.cmd
          .replace(/\x1b\[[0-9;]*m/g, "") // Strip ANSI codes
          .replace(/\n/g, " ") // Replace newlines with spaces
          .replace(/\s+/g, " ") // Condense multiple spaces
          .trim()
        if (testName.length > MAX_TEST_NAME_LENGTH) {
          testName = testName.slice(0, MAX_TEST_NAME_LENGTH - 3) + "..."
        }

        test(`$ ${testName}`, async () => {
          // Format command as block text with proper continuation syntax
          // Multi-line commands have newlines in step.cmd that need > prefix
          const cmdLines = step.cmd.split("\n")
          const blockText =
            cmdLines.length === 1
              ? `$ ${step.cmd}`
              : `$ ${cmdLines[0]}\n${cmdLines
                  .slice(1)
                  .map((l) => `> ${l}`)
                  .join("\n")}`

          // Execute single command using plugin
          const blockResult = await executor.executeBlock(
            {
              lang: item.block.lang || "console",
              info: item.block.meta || "",
              text: blockText,
            },
            item.heading,
          )

          // Plugin didn't handle this block
          if (!blockResult) {
            throw new Error("Plugin did not handle command")
          }

          const { results, exitCode } = blockResult
          const stdout = results.flatMap((r) => r.stdout)
          const stderr = results.flatMap((r) => r.stderr)

          // Get expected values
          const wantStdout = step.expected.stdout ?? []
          const wantStderr = step.expected.stderr ?? []
          const wantExit = step.expected.exit ?? 0

          // Match output
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
          const exitOk = exitCode === wantExit

          if (!outMatch.ok || !errMatch.ok || !exitOk) {
            const errors: string[] = []
            if (!outMatch.ok) {
              errors.push(
                hintMismatch("stdout", wantStdout, stdout, outMatch.msg),
              )
            }
            if (!errMatch.ok) {
              errors.push(
                hintMismatch("stderr", wantStderr, stderr, errMatch.msg),
              )
            }
            if (!exitOk) {
              errors.push(`exit code: expected ${wantExit}, got ${exitCode}`)
            }
            throw new Error(errors.join("\n"))
          }
        })
      }
    }
    return
  }

  // Create describe block and recurse to preserve execution order
  describe(path[depth]!, () => {
    registerNestedTests(
      path,
      items,
      executor,
      capsStdout,
      capsStderr,
      depth + 1,
    )
  })
}

// ============ Shell Adapter (Node.js-based for Vitest) ============

/**
 * Execute command via Node.js spawn (compatible with Vitest environment)
 *
 * @param cmd - Command array (e.g., ['bash', '-lc', script])
 * @param opts - Execution options (cwd, env, timeout)
 * @returns Promise<ShellResult> with stdout, stderr, exitCode
 */
export async function vitestShell(
  cmd: string[],
  opts?: ShellOptions,
): Promise<ShellResult> {
  const { spawn } = await import("node:child_process")
  const timeout = opts?.timeout ?? 30000 // Default 30s

  // Debug: Log what we're executing
  if (process.env.DEBUG_MDTEST) {
    console.error(`[vitestShell] Executing:`, cmd)
    console.error(`[vitestShell] CWD:`, opts?.cwd ?? process.cwd())
    const env = opts?.env ?? (process.env as Record<string, string>)
    console.error(`[vitestShell] ROOT:`, env.ROOT)
    console.error(`[vitestShell] KIMMI_REPO:`, env.KIMMI_REPO)
    // Extract and log the actual command from the script
    const actualCmd = cmd[2]! // The bash -lc script
    const cmdMatch = actualCmd.match(/\nkimmi[^\n]+/)
    if (cmdMatch) console.error(`[vitestShell] Command:`, cmdMatch[0].trim())
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(cmd[0]!, cmd.slice(1), {
      cwd: opts?.cwd ?? process.cwd(),
      env: opts?.env ?? (process.env as Record<string, string>),
      stdio: ["ignore", "pipe", "pipe"],
    })

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []

    proc.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk)
    })

    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk)
    })

    // Timeout handler
    const timer = setTimeout(() => {
      proc.kill()
      resolve({
        stdout: Buffer.from(""),
        stderr: Buffer.from(`Command timed out after ${timeout}ms`),
        exitCode: 124, // Standard timeout exit code
      })
    }, timeout)

    proc.on("close", (exitCode) => {
      clearTimeout(timer)

      const stdout = Buffer.concat(stdoutChunks)
      const stderr = Buffer.concat(stderrChunks)

      if (process.env.DEBUG_MDTEST) {
        console.error(`[vitestShell] Result:`)
        console.error(`[vitestShell]   stdout length: ${stdout.length}`)
        console.error(`[vitestShell]   stderr length: ${stderr.length}`)
        console.error(`[vitestShell]   exitCode: ${exitCode}`)
        console.error(
          `[vitestShell]   stdout preview: ${JSON.stringify(stdout.toString("utf8").slice(0, 100))}`,
        )
      }

      resolve({
        stdout,
        stderr,
        exitCode: exitCode ?? 0,
      })
    })

    proc.on("error", (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}
