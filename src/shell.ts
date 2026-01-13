// Shared shell execution abstraction and helpers for mdtest
// Allows mdtest core to work with different runtimes (Bun, Node.js, Deno)

import type { BlockOptions } from "./api.js";

// ============ Shell Adapter Interface ============

export interface ShellResult {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number;
}

export interface ShellOptions {
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number; // milliseconds
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
  execute(cmd: string[], opts?: ShellOptions): Promise<ShellResult>;
}

// ============ Shell Script Builders ============

/**
 * Escape a string for safe use in shell commands
 */
export function shellEscape(s: string): string {
  if (/^[A-Za-z0-9_/.:-]*$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
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
  const pre: string[] = [];
  const post: string[] = [];

  // Load previous state
  pre.push("set +e"); // runner checks exit codes itself
  pre.push(`if [ -f "${envFile}" ]; then set -a; . "${envFile}"; set +a; fi`);
  pre.push(
    `if [ -f "${cwdFile}" ]; then cd "$(cat "${cwdFile}")" 2>/dev/null || true; fi`,
  );
  pre.push(`if [ -f "${funcFile}" ]; then . "${funcFile}"; fi`);

  // Apply block options
  if (opts.cwd) pre.push(`cd ${shellEscape(opts.cwd)}`);
  if (opts.env) {
    for (const [k, v] of Object.entries(opts.env))
      pre.push(`export ${k}=${shellEscape(v)}`);
  }

  const body = commands.join("\n");

  // Save updated state
  post.push("_EXIT=$?");
  post.push(`pwd > "${cwdFile}"`);
  post.push(`export -p | sed -E 's/^declare -x //g' > "${envFile}"`);
  post.push(`declare -f > "${funcFile}"`);
  post.push("exit $_EXIT");

  return [...pre, body, ...post].join("\n").trim() + "\n";
}

/**
 * Build a script to call a hook if it exists
 */
export function buildHookScript(
  hookName: string,
  envFile: string,
  cwdFile: string,
  funcFile: string,
): string {
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
  `;
}
