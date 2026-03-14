// Vitest test integration for .test.md files
// Usage: Create a wrapper test file that calls registerMdTests()
//
// Example: tests/md.test.ts
// import { registerMdTests } from '@beorn/mdtest/vitest'
// await registerMdTests('tests/e2e/**/*.test.md')

import { test, describe, beforeAll, afterAll, beforeEach, afterEach } from "vitest"
import type { FrameworkAdapter } from "./shared.js"
import {
  registerMdTests as registerMdTestsShared,
  registerMdTestFile as registerMdTestFileShared,
  discoverMdTests,
} from "./shared.js"
import type { ShellResult, ShellOptions } from "../shell.js"

// Vitest adapter: uses standard describe/test (Vitest runs tests sequentially by default within a file)
const vitestAdapter: FrameworkAdapter = {
  describe,
  test,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
}

// Re-export discovery API
export { discoverMdTests }

// Register all .test.md files as Vitest tests
export async function registerMdTests(pattern: string | string[] = "**/*.test.md"): Promise<void> {
  return registerMdTestsShared(vitestAdapter, pattern)
}

// Register a single .test.md file as Vitest tests
export async function registerMdTestFile(filePath: string): Promise<void> {
  return registerMdTestFileShared(vitestAdapter, filePath)
}

// ============ Shell Adapter (Node.js-based for Vitest) ============

/**
 * Execute command via Node.js spawn (compatible with Vitest environment)
 *
 * @param cmd - Command array (e.g., ['bash', '-lc', script])
 * @param opts - Execution options (cwd, env, timeout)
 * @returns Promise<ShellResult> with stdout, stderr, exitCode
 */
export async function vitestShell(cmd: string[], opts?: ShellOptions): Promise<ShellResult> {
  const { spawn } = await import("node:child_process")
  const timeout = opts?.timeout ?? 30000 // Default 30s

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
