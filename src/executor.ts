// Block execution logic for mdtest
// Handles running commands via bash or persistent subprocess sessions

import { splitNorm } from "./core.js"
import { buildScript, buildHookScript } from "./shell.js"
import { bunShell } from "./integrations/bun.js"
import { CmdSession } from "./cmdSession.js"
import { PtySession } from "./ptySession.js"
import { DEFAULTS } from "./constants.js"
import type { BlockOptions } from "./api.js"

/**
 * Result of executing a block of commands
 */
export interface BlockResult {
  stdout: string[]
  stderr: string[]
  exitCode: number
  results: Array<{
    command: string
    stdout: string[]
    stderr: string[]
  }>
}

/**
 * Execute a block of commands
 * Either via persistent subprocess (cmd= mode) or as individual bash processes
 */
export async function runBlock(
  commands: string[],
  opts: BlockOptions,
  envFile: string,
  cwdFile: string,
  funcFile: string,
  cwd: string,
): Promise<BlockResult> {
  const results: Array<{
    command: string
    stdout: string[]
    stderr: string[]
  }> = []
  let lastExitCode = 0
  const timeout = opts.timeout ?? DEFAULTS.TIMEOUT

  // Custom command mode: use persistent subprocess with CmdSession or PtySession
  if (opts.cmd) {
    // Choose session type: PTY for real TTY (auto OSC 133), CmdSession for pipes
    const sessionOpts = {
      cwd: cwd,
      env: process.env as Record<string, string>,
      minWait: opts.minWait,
      maxWait: opts.maxWait,
      startupDelay: opts.startupDelay,
      // Pass state files so cmd inherits bash session state (env, cwd, functions)
      envFile: envFile,
      cwdFile: cwdFile,
      funcFile: funcFile,
    }

    // Default to PtySession on POSIX (faster OSC 133 detection, real TTY).
    // Use CmdSession on Windows or when pty=false is explicitly set.
    const isPosix = process.platform !== "win32"
    const usePty = opts.pty ?? isPosix // default to PTY on POSIX
    const session = usePty ? new PtySession(opts.cmd, sessionOpts) : new CmdSession(opts.cmd, sessionOpts)

    try {
      for (const cmd of commands) {
        const res = await session.execute(cmd)
        const stdout = splitNorm(res.stdout.toString())
        // PtySession merges stderr into stdout, so stderr is always empty for PTY
        const stderr = splitNorm(res.stderr.toString())
        // Remove trailing empty lines
        while (stdout.length > 0 && stdout[stdout.length - 1] === "") {
          stdout.pop()
        }
        while (stderr.length > 0 && stderr[stderr.length - 1] === "") {
          stderr.pop()
        }
        lastExitCode = res.exitCode ?? 0
        results.push({ command: cmd, stdout, stderr })
      }
    } finally {
      await session.close()
    }
  } else {
    // Standard bash mode: each command runs as separate process
    for (const cmd of commands) {
      const script = buildScript([cmd], opts, envFile, cwdFile, funcFile)

      // Execute command with timeout
      const res = await bunShell(["bash", "-lc", script], {
        cwd: cwd,
        env: process.env as Record<string, string>,
        timeout: timeout,
      })
      const stdout = splitNorm(res.stdout.toString())
      const stderr = splitNorm(res.stderr.toString())
      // Remove trailing empty line if present (split creates '' when string ends with \n)
      while (stdout.length > 0 && stdout[stdout.length - 1] === "") {
        stdout.pop()
      }
      while (stderr.length > 0 && stderr[stderr.length - 1] === "") {
        stderr.pop()
      }
      lastExitCode = res.exitCode ?? 0
      results.push({ command: cmd, stdout, stderr })
    }
  }

  // Combine all output for matching (backward compat)
  const allStdout = results.flatMap((r) => r.stdout)
  const allStderr = results.flatMap((r) => r.stderr)

  return {
    stdout: allStdout,
    stderr: allStderr,
    exitCode: lastExitCode,
    results,
  }
}

/**
 * Call a lifecycle hook if it exists in the shell state
 */
export async function callHookIfExists(
  hookName: string,
  envFile: string,
  cwdFile: string,
  funcFile: string,
): Promise<void> {
  const script = buildHookScript(hookName, envFile, cwdFile, funcFile)
  await bunShell(["bash", "-lc", script], {
    cwd: process.cwd(),
    env: process.env as Record<string, string>,
  })
}
