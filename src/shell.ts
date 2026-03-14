// Shared shell execution abstraction and helpers for mdtest
// Allows mdtest core to work with different runtimes (Bun, Node.js, Deno)

import type { BlockOptions } from "./api.js"

// ============ Shell Adapter Interface ============

export interface ShellResult {
  stdout: Buffer
  stderr: Buffer
  exitCode: number | null
}

export interface ShellOptions {
  cwd?: string
  env?: Record<string, string>
  timeout?: number // milliseconds
}

/**
 * Shell adapter interface for executing commands
 * Different runtimes (Bun, Node.js, Deno) implement this interface
 */
export interface ShellAdapter {
  /**
   * Execute a shell command
   * @param cmd - Command array (e.g., ['bash', '-lc', script])
   * @param opts - Execution options (cwd, env, timeout)
   * @returns Promise<ShellResult> with stdout, stderr, exitCode
   */
  execute(cmd: string[], opts?: ShellOptions): Promise<ShellResult>
}

// ============ Session Prelude Builder ============

interface StateFiles {
  envFile?: string
  cwdFile?: string
  funcFile?: string
}

/**
 * Build a bash prelude script that loads session state and then runs a command.
 * Used by CmdSession and PtySession to wrap the subprocess command.
 *
 * The prelude:
 * 1. Disables errexit (set +e) so the runner can check exit codes
 * 2. Sources environment variables from envFile (if present)
 * 3. Restores working directory from cwdFile (if present)
 * 4. Sources function definitions from funcFile (if present)
 * 5. Runs the given command (without exec, since it may be a shell function)
 */
export function buildSessionPrelude(cmd: string, stateFiles: StateFiles): string {
  const lines: string[] = ["set +e"]
  if (stateFiles.envFile) {
    lines.push(`if [ -f "${stateFiles.envFile}" ]; then set -a; . "${stateFiles.envFile}"; set +a; fi`)
  }
  if (stateFiles.cwdFile) {
    lines.push(`if [ -f "${stateFiles.cwdFile}" ]; then cd "$(cat "${stateFiles.cwdFile}")" 2>/dev/null || true; fi`)
  }
  if (stateFiles.funcFile) {
    lines.push(`if [ -f "${stateFiles.funcFile}" ]; then . "${stateFiles.funcFile}"; fi`)
  }
  // Don't use exec - the command might be a bash function from funcFile.
  // exec only works with executables, not shell functions.
  lines.push(cmd)
  return lines.join("\n")
}

// ============ Shell Script Builders ============

/**
 * Escape a string for safe use in shell commands
 */
export function shellEscape(s: string): string {
  if (/^[A-Za-z0-9_/.:-]*$/.test(s)) return s
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * Build a bash script that loads persistent state, runs commands, and saves state
 *
 * State persistence files:
 * - envFile: Exported environment variables
 * - cwdFile: Current working directory
 * - funcFile: Bash function definitions
 */
export function buildScript(
  commands: string[],
  opts: BlockOptions,
  envFile: string,
  cwdFile: string,
  funcFile: string,
): string {
  const pre: string[] = []
  const post: string[] = []

  // Load previous state
  pre.push("set +e") // runner checks exit codes itself
  pre.push(`if [ -f "${envFile}" ]; then set -a; . "${envFile}"; set +a; fi`)
  pre.push(`if [ -f "${cwdFile}" ]; then cd "$(cat "${cwdFile}")" 2>/dev/null || true; fi`)
  pre.push(`if [ -f "${funcFile}" ]; then . "${funcFile}"; fi`)

  // Apply block options
  if (opts.cwd) pre.push(`cd ${shellEscape(opts.cwd)}`)
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env)) {
      pre.push(`export ${k}=${shellEscape(v)}`)
    }
  }

  const body = commands.join("\n")

  // Save updated state
  post.push("_EXIT=$?")
  post.push(`pwd > "${cwdFile}"`)
  post.push(`export -p | sed -E 's/^declare -x //g' > "${envFile}"`)
  post.push(`declare -f > "${funcFile}"`)
  post.push("exit $_EXIT")

  return [...pre, body, ...post].join("\n").trim() + "\n"
}

/**
 * Build a script to call a hook if it exists
 */
export function buildHookScript(hookName: string, envFile: string, cwdFile: string, funcFile: string): string {
  return `
    set +e
    [ -f "${envFile}" ] && { set -a; . "${envFile}"; set +a; }
    [ -f "${cwdFile}" ] && cd "$(cat "${cwdFile}")" 2>/dev/null || true
    [ -f "${funcFile}" ] && . "${funcFile}"

    if type ${hookName} &>/dev/null; then
      ${hookName}
      _EXIT=$?
      pwd > "${cwdFile}"
      export -p | sed -E 's/^declare -x //g' > "${envFile}"
      declare -f > "${funcFile}"
      exit $_EXIT
    fi
  `
}
