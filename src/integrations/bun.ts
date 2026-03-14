// Bun test integration for .test.md files
// Usage: Create a wrapper test file that calls registerMdTests()
//
// Example: tests/md.test.ts
// import { registerMdTests } from '@beorn/mdtest/bun'
// await registerMdTests('tests/e2e/**/*.test.md')

import { test, describe, beforeAll, afterAll, beforeEach, afterEach } from "bun:test"
import type { FrameworkAdapter } from "./shared.js"
import {
  registerMdTests as registerMdTestsShared,
  registerMdTestFile as registerMdTestFileShared,
  discoverMdTests,
} from "./shared.js"
import type { ShellResult, ShellOptions } from "../shell.js"

// Bun adapter: uses describe.serial/test.serial for sequential execution
const bunAdapter: FrameworkAdapter = {
  describe: (name, fn) => describe.serial(name, fn),
  test: (name, fn) => test.serial(name, fn),
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
}

// Re-export discovery API
export { discoverMdTests }

// Register all .test.md files as Bun tests
export async function registerMdTests(pattern: string | string[] = "**/*.test.md"): Promise<void> {
  return registerMdTestsShared(bunAdapter, pattern)
}

// Register a single .test.md file as Bun tests
export async function registerMdTestFile(filePath: string): Promise<void> {
  return registerMdTestFileShared(bunAdapter, filePath)
}

// ============ Shell Adapter (Bun-specific) ============

/**
 * Execute command via Bun.spawn
 *
 * @param cmd - Command array (e.g., ['bash', '-lc', script])
 * @param opts - Execution options (cwd, env, timeout)
 * @returns Promise<ShellResult> with stdout, stderr, exitCode
 */
export async function bunShell(cmd: string[], opts?: ShellOptions): Promise<ShellResult> {
  const timeout = opts?.timeout ?? 30000 // Default 30s

  // Spawn process using Bun.spawn
  // TERM=dumb prevents shell from emitting escape sequences (bracketed paste mode, etc.)
  const baseEnv = opts?.env ?? (process.env as Record<string, string>)
  const proc = Bun.spawn(cmd, {
    cwd: opts?.cwd ?? process.cwd(),
    env: { ...baseEnv, TERM: "dumb" },
    stdout: "pipe",
    stderr: "pipe",
  })

  // Implement timeout using Promise.race
  const processPromise = (async () => {
    // Read streams and wait for exit concurrently
    // This prevents streams from being closed before we read them
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])

    return {
      stdout: Buffer.from(stdout),
      stderr: Buffer.from(stderr),
      exitCode: exitCode,
    }
  })()

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    setTimeout(() => reject(new Error("TIMEOUT")), timeout)
  })

  try {
    return await Promise.race([processPromise, timeoutPromise])
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "TIMEOUT") {
      // Kill the process
      proc.kill()

      return {
        stdout: Buffer.from(""),
        stderr: Buffer.from(`Command timed out after ${timeout}ms`),
        exitCode: 124, // Standard timeout exit code
      }
    }
    throw err
  }
}
