// Bash plugin for mdtest - default execution mode
// Extracts state-based bash execution logic into plugin interface

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { splitNorm, trimTrailingEmptyLines } from "../core.js"
import { buildScript, buildHookScript } from "../shell.js"
import { bunShell } from "../integrations/bun.js"
import { DEFAULTS } from "../constants.js"
import type { Plugin, FileOpts, BlockOpts, ExecFn, ReplResult } from "../types.js"
import type { ShellResult, ShellOptions } from "../shell.js"

/** Shell function signature matching bunShell/vitestShell */
export type ShellFn = (cmd: string[], opts?: ShellOptions) => Promise<ShellResult>

/** Options for the bash plugin factory */
export interface BashPluginOptions {
  /** Custom shell function. Defaults to bunShell. */
  shellFn?: ShellFn
}

/**
 * Bash plugin - default mdtest execution mode
 * Uses stateful bash execution with env/cwd/function persistence
 */
export function bash(opts: FileOpts, pluginOpts?: BashPluginOptions): Plugin {
  const shell: ShellFn = pluginOpts?.shellFn ?? bunShell

  // Create temp directory for state files
  const stateDir = mkdtempSync(join(tmpdir(), "mdtest-"))
  const envFile = join(stateDir, ".env")
  const cwdFile = join(stateDir, ".cwd")
  const funcFile = join(stateDir, ".functions")

  // Write initial state files
  writeFileSync(envFile, "")
  writeFileSync(cwdFile, process.cwd())
  writeFileSync(funcFile, "")

  // Write all file= blocks to cwd (the test's working directory)
  const cwd = process.cwd()
  for (const [filename, content] of opts.files) {
    const filePath = join(cwd, filename)
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, content)
  }

  return {
    block(opts: BlockOpts): ExecFn | null {
      // Skip file= blocks (already written in factory)
      if (opts.file) return null

      // Only handle shell blocks
      if (!["console", "sh", "bash"].includes(opts.type)) {
        return null
      }

      // Handle reset option: clear state files
      if (opts.reset) {
        writeFileSync(envFile, "")
        writeFileSync(cwdFile, process.cwd())
        writeFileSync(funcFile, "")
      }

      // Return execution function
      return async (cmd: string): Promise<ReplResult> => {
        const timeout = (opts.timeout as number | undefined) ?? DEFAULTS.TIMEOUT
        const cwd = (opts.cwd as string | undefined) ?? process.cwd()

        // Convert BlockOpts to BlockOptions for buildScript
        const blockOpts = {
          exit: opts.exit as number | undefined,
          cwd: opts.cwd as string | undefined,
          env: opts.env as Record<string, string> | undefined,
          reset: opts.reset as boolean | undefined,
          timeout: opts.timeout as number | undefined,
        }

        // Build script with state persistence
        const script = buildScript([cmd], blockOpts, envFile, cwdFile, funcFile)

        // Execute command
        const res = await shell(["bash", "-lc", script], {
          cwd,
          env: process.env as Record<string, string>,
          timeout,
        })

        // Parse output
        const stdout = splitNorm(res.stdout.toString())
        const stderr = splitNorm(res.stderr.toString())

        // Remove trailing empty lines
        trimTrailingEmptyLines(stdout)
        trimTrailingEmptyLines(stderr)

        return {
          stdout: stdout.join("\n"),
          stderr: stderr.join("\n"),
          exitCode: res.exitCode ?? 0,
        }
      }
    },

    // Lifecycle hooks - call bash functions from state
    async beforeAll(): Promise<void> {
      await callHook("beforeAll")
    },

    async afterAll(): Promise<void> {
      await callHook("afterAll")
      // Clean up temp state directory
      try {
        rmSync(stateDir, { recursive: true, force: true })
      } catch {
        // Ignore cleanup errors
      }
    },

    async beforeEach(): Promise<void> {
      await callHook("beforeEach")
    },

    async afterEach(): Promise<void> {
      await callHook("afterEach")
    },
  }

  // Helper to call bash hooks
  async function callHook(hookName: string): Promise<void> {
    const script = buildHookScript(hookName, envFile, cwdFile, funcFile)
    await shell(["bash", "-lc", script], {
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
    })
  }
}
