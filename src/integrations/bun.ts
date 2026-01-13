// Bun test integration for .test.md files
// Usage: Create a wrapper test file that calls registerMdTests()
//
// Example: tests/md.test.ts
// import { registerMdTests } from '@beorn/mdtest/bun'
// await registerMdTests('tests/e2e/**/*.test.md')

import {
  test,
  describe,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from "bun:test";
import { glob } from "glob";
import { basename } from "node:path";
import { parseBlock } from "../core.js";
import {
  parseMarkdown,
  findNearestHeading,
  generateTestId,
} from "../markdown.js";
import type { Heading, CodeBlock } from "../markdown.js";
import { readFile } from "fs/promises";
import { TestSession } from "../session.js";
import type { ShellAdapter, ShellResult, ShellOptions } from "../shell.js";

// Constants
const MAX_TEST_NAME_LENGTH = 60;

// Discovery API
export async function discoverMdTests(
  pattern = "**/*.test.md",
): Promise<string[]> {
  return glob(pattern);
}

// Register all .test.md files as Bun tests
export async function registerMdTests(
  pattern: string | string[] = "**/*.test.md",
): Promise<void> {
  // Handle both string patterns and arrays of file paths
  const files = Array.isArray(pattern)
    ? pattern
    : await discoverMdTests(pattern);

  for (const file of files) await registerMdTestFile(file);
}

// Register a single .test.md file as Bun tests
export async function registerMdTestFile(filePath: string): Promise<void> {
  const md = await readFile(filePath, "utf8");
  const { headings, codeBlocks } = parseMarkdown(md);

  // Build hierarchical test structure
  const structure = buildTestStructure(codeBlocks, headings, filePath);

  // Use basename only (relative to test discovery file)
  // Pattern like 'packages/mdtest/tests/*.test.md' → 'features.test.md'
  const displayName = basename(filePath);

  // Register tests with Bun
  registerBunTests(displayName, structure, codeBlocks);
}

interface TestStep {
  cmd: string;
  expected: Record<string, unknown>;
}

interface TestStructure {
  headings: Array<{
    path: string[]; // ['Setup', 'Basic Command Execution']
    slug: string;
    steps: TestStep[];
    index: number; // Original index in document
  }>;
}

function buildTestStructure(
  codeBlocks: CodeBlock[],
  headings: Heading[],
  _filePath: string,
): TestStructure {
  const result: TestStructure = { headings: [] };
  const headingBlockCounts = new Map<string, number>();

  for (let i = 0; i < codeBlocks.length; i++) {
    const block = codeBlocks[i];
    if (!block) continue;

    // Skip file= blocks (they're helper files/hooks, not test commands)
    if (block.filename) continue;

    // Only process shell code blocks
    if (!block.lang || !["console", "sh", "bash"].includes(block.lang))
      continue;

    const { steps } = parseBlock(block.value);

    if (!steps.length) continue; // Skip empty fences silently

    const nearestHeading = findNearestHeading(headings, block.position.start);
    const testId = generateTestId(nearestHeading, i, headingBlockCounts);

    // Build heading path hierarchy
    const headingPath = buildHeadingPath(nearestHeading, headings);

    result.headings.push({
      path: headingPath,
      slug: testId,
      steps,
      index: i,
    });
  }

  return result;
}

function buildHeadingPath(
  heading: Heading | null,
  allHeadings: Heading[],
): string[] {
  if (!heading) return ["(no heading)"];

  // Count H1 headings (depth 1)
  const h1Count = allHeadings.filter((h) => h.depth === 1).length;
  const skipH1 = h1Count === 1; // Skip H1 if there's only one (document title)

  // Build path by ascending parent links
  const path: string[] = [];
  let current: Heading | undefined = heading;

  while (current) {
    // Skip single H1 (document title)
    if (!(skipH1 && current.depth === 1)) path.push(current.slug);

    current = current.parent;
  }

  // Reverse to get root-to-leaf order
  path.reverse();

  return path.length > 0 ? path : ["(no heading)"];
}

function registerBunTests(
  filePath: string,
  structure: TestStructure,
  codeBlocks: CodeBlock[],
): void {
  // Wrap entire file in a describe.serial block to prevent parallel execution
  // (shared TestSession state must not be accessed concurrently)
  describe.serial(filePath, () => {
    // Create one session per file for shared state
    const session = new TestSession(filePath, bunShellAdapter);

    beforeAll(async () => {
      session.loadState();

      // Extract and register all file= blocks (helpers, hooks, and arbitrary files)
      for (const block of codeBlocks) {
        if (block.filename) session.addHelperFile(block.filename, block.value);
      }

      // Then call beforeAll hook if it exists
      await session.callHook("beforeAll");
    });

    beforeEach(async () => {
      await session.callHook("beforeEach");
    });

    afterEach(async () => {
      await session.callHook("afterEach");
    });

    afterAll(async () => {
      await session.callHook("afterAll");
      session.cleanup();
    });

    // Group steps by heading path for proper nesting
    const pathGroups = new Map<
      string,
      Array<{ steps: TestStep[]; index: number }>
    >();

    for (const heading of structure.headings) {
      const key = heading.path.join("\x00"); // Use null byte as separator
      if (!pathGroups.has(key)) pathGroups.set(key, []);

      const group = pathGroups.get(key);
      if (group) group.push({ steps: heading.steps, index: heading.index });
    }

    // Register nested describe blocks for each unique path
    // Sort by first occurrence in document to preserve execution order
    const sortedPaths = Array.from(pathGroups.entries()).sort((a, b) => {
      // Get first heading for each path from structure.headings
      const aIndex = structure.headings.findIndex(
        (h) => h.path.join("\x00") === a[0],
      );
      const bIndex = structure.headings.findIndex(
        (h) => h.path.join("\x00") === b[0],
      );
      return aIndex - bIndex;
    });

    for (const [pathKey, items] of sortedPaths) {
      // Sort items by original document index to preserve order
      items.sort((a, b) => a.index - b.index);
      const path = pathKey.split("\x00");
      registerNestedTests(path, items, session);
    }
  });
}

function registerNestedTests(
  path: string[],
  items: Array<{ steps: TestStep[]; index: number }>,
  session: TestSession,
  depth = 0,
): void {
  if (depth >= path.length) {
    // Leaf level - register all steps as tests
    for (const item of items) {
      for (const step of item.steps) {
        // Sanitize command for test name: strip ANSI, condense whitespace, truncate
        let testName = step.cmd
          .replace(/\x1b\[[0-9;]*m/g, "") // Strip ANSI codes
          .replace(/\n/g, " ") // Replace newlines with spaces
          .replace(/\s+/g, " ") // Condense multiple spaces
          .trim();
        if (testName.length > MAX_TEST_NAME_LENGTH) {
          testName = testName.slice(0, MAX_TEST_NAME_LENGTH - 3) + "...";
        }

        test.serial(`$ ${testName}`, async () => {
          const result = await session.runCommand(step.cmd, step.expected);
          if (!result.passed)
            throw new Error(result.diff || "Command output mismatch");
        });
      }
    }
    return;
  }

  // Create describe.serial block and recurse to preserve execution order
  describe.serial(path[depth], () => {
    registerNestedTests(path, items, session, depth + 1);
  });
}

// ============ Helper Functions ============

// ============ Shell Adapter (Bun-specific) ============

/**
 * Bun implementation of ShellAdapter using Bun.spawn
 */
export const bunShellAdapter: ShellAdapter = {
  execute: bunShell,
};

/**
 * Execute command via Bun.spawn
 *
 * @param cmd - Command array (e.g., ['bash', '-lc', script])
 * @param opts - Execution options (cwd, env, timeout)
 * @returns Promise<ShellResult> with stdout, stderr, exitCode
 */
export async function bunShell(
  cmd: string[],
  opts?: ShellOptions,
): Promise<ShellResult> {
  const timeout = opts?.timeout ?? 30000; // Default 30s

  // Debug: Log what we're executing
  if (process.env.DEBUG_MDTEST) {
    console.error(`[bunShell] Executing:`, cmd);
    console.error(`[bunShell] CWD:`, opts?.cwd ?? process.cwd());
    const env = opts?.env ?? (process.env as Record<string, string>);
    console.error(`[bunShell] ROOT:`, env.ROOT);
    console.error(`[bunShell] KIMMI_REPO:`, env.KIMMI_REPO);
    // Extract and log the actual command from the script
    const actualCmd = cmd[2]; // The bash -lc script
    const cmdMatch = actualCmd.match(/\nkimmi[^\n]+/);
    if (cmdMatch) console.error(`[bunShell] Command:`, cmdMatch[0].trim());
  }

  // Spawn process using Bun.spawn
  const proc = Bun.spawn(cmd, {
    cwd: opts?.cwd ?? process.cwd(),
    env: opts?.env ?? (process.env as Record<string, string>),
    stdout: "pipe",
    stderr: "pipe",
  });

  // Implement timeout using Promise.race
  const processPromise = (async () => {
    // Read streams and wait for exit concurrently
    // This prevents streams from being closed before we read them
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (process.env.DEBUG_MDTEST) {
      console.error(`[bunShell] Result:`);
      console.error(`[bunShell]   stdout length: ${stdout.length}`);
      console.error(`[bunShell]   stderr length: ${stderr.length}`);
      console.error(`[bunShell]   exitCode: ${exitCode}`);
      console.error(
        `[bunShell]   stdout preview: ${JSON.stringify(stdout.slice(0, 100))}`,
      );
    }

    return {
      stdout: Buffer.from(stdout),
      stderr: Buffer.from(stderr),
      exitCode: exitCode,
    };
  })();

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    setTimeout(() => reject(new Error("TIMEOUT")), timeout);
  });

  try {
    return await Promise.race([processPromise, timeoutPromise]);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "TIMEOUT") {
      // Kill the process
      proc.kill();

      return {
        stdout: Buffer.from(""),
        stderr: Buffer.from(`Command timed out after ${timeout}ms`),
        exitCode: 124, // Standard timeout exit code
      };
    }
    throw err;
  }
}
