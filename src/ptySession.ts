/**
 * PtySession - PTY-based subprocess for REPL testing
 *
 * Uses Bun's native PTY support (v1.3.5+) to spawn subprocesses in a real
 * pseudo-terminal. This means:
 * - process.stdout.isTTY is true in the subprocess
 * - Terminals/REPLs automatically enable features like colors, OSC 133, etc.
 * - No need for TERM_SHELL_INTEGRATION env var - it's a real TTY
 *
 * Comparison with CmdSession (pipe-based):
 * - PtySession: Real TTY, subprocess sees isTTY=true, automatic feature detection
 * - CmdSession: Pipes, subprocess sees isTTY=false, needs env var opt-in
 *
 * Platform support: POSIX only (Linux, macOS). Windows not supported.
 */

import type { ShellResult } from "./shell.js";
import { DEFAULTS } from "./constants.js";

// OSC 133 escape sequence patterns
const OSC_133_A_PATTERN = /\x1b\]133;A\x07/; // Prompt ready (ready for input)
const OSC_133_D_PATTERN = /\x1b\]133;D(?:;(-?\d+))?\x07/; // Command complete
const OSC_133_ANY_PATTERN = /\x1b\]133;[A-Z](?:;[^\x07]*)?\x07/g;
// Strip ANSI escape codes (colors, cursor movement, clearing, etc.)
// Common codes: m=color, G=cursor column, J=clear, K=erase, H=position, A-D=move
const ANSI_ESCAPE_PATTERN = /\x1b\[[0-9;]*[A-Za-z]/g;

export interface PtySessionOpts {
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
  minWait?: number; // ms of silence to wait (default: 50)
  maxWait?: number; // max ms total (default: 2000)
  startupDelay?: number; // ms to wait for subprocess to be ready (default: 100)
  stripAnsi?: boolean; // Strip ANSI color codes (default: true)
  // State files for loading bash session state (same as CmdSession)
  envFile?: string;
  cwdFile?: string;
  funcFile?: string;
}

export class PtySession {
  private outputBuffer: string = "";
  private minWait: number;
  private maxWait: number;
  private startupDelay: number;
  private stripAnsi: boolean;
  private firstExecute = true;
  private closed = false;
  private proc: ReturnType<typeof Bun.spawn> | null = null;
  private terminal: {
    write: (data: string) => void;
    close: () => void;
  } | null = null;

  constructor(cmd: string, opts: PtySessionOpts = {}) {
    this.minWait = opts.minWait ?? DEFAULTS.PTY_SESSION.MIN_WAIT;
    this.maxWait = opts.maxWait ?? DEFAULTS.PTY_SESSION.MAX_WAIT;
    this.startupDelay = opts.startupDelay ?? DEFAULTS.PTY_SESSION.STARTUP_DELAY;
    this.stripAnsi = opts.stripAnsi ?? true;

    // Build wrapper script that loads session state before running the cmd
    // (same approach as CmdSession for compatibility)
    const prelude: string[] = ["set +e"];
    if (opts.envFile) {
      prelude.push(
        `if [ -f "${opts.envFile}" ]; then set -a; . "${opts.envFile}"; set +a; fi`,
      );
    }
    if (opts.cwdFile) {
      prelude.push(
        `if [ -f "${opts.cwdFile}" ]; then cd "$(cat "${opts.cwdFile}")" 2>/dev/null || true; fi`,
      );
    }
    if (opts.funcFile) {
      prelude.push(
        `if [ -f "${opts.funcFile}" ]; then . "${opts.funcFile}"; fi`,
      );
    }
    // Don't use exec - the command might be a bash function from funcFile.
    // exec only works with executables, not shell functions.
    prelude.push(cmd);
    const wrapperScript = prelude.join("\n");

    this.proc = Bun.spawn(["bash", "-c", wrapperScript], {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      terminal: {
        cols: opts.cols ?? 80,
        rows: opts.rows ?? 24,
        data: (_terminal, data) => {
          this.outputBuffer += data.toString();
        },
      },
    });

    // @ts-expect-error - terminal is added by Bun when terminal option is used
    this.terminal = this.proc.terminal;
  }

  /**
   * Wait for subprocess to be ready. Detects readiness via:
   * 1. OSC 133;A marker (best - explicit ready signal)
   * 2. Any output received (good - subprocess has started)
   * 3. Timeout reached (fallback)
   * Clears the buffer after detecting ready state.
   */
  private async waitForReady(timeout: number): Promise<void> {
    const startTime = Date.now();

    while (true) {
      // Check for OSC 133;A (prompt ready) - most reliable signal
      if (OSC_133_A_PATTERN.test(this.outputBuffer)) {
        // Clear buffer - we're ready for next command
        this.outputBuffer = "";
        return;
      }

      // Check for any output - subprocess has started
      if (this.outputBuffer.length > 0) {
        // Wait a tiny bit more to let any OSC 133;A arrive
        await Bun.sleep(20);
        // Clear buffer - ready to proceed
        this.outputBuffer = "";
        return;
      }

      // Fallback: timeout
      if (Date.now() - startTime >= timeout) {
        // Clear any accumulated output
        this.outputBuffer = "";
        return;
      }

      await Bun.sleep(10);
    }
  }

  /**
   * Execute a command and wait for output
   */
  async execute(command: string): Promise<ShellResult> {
    // Wait for subprocess to be ready before each command
    // First command uses startupDelay, subsequent use minWait
    const readyTimeout = this.firstExecute ? this.startupDelay : this.minWait;
    await this.waitForReady(readyTimeout);
    this.firstExecute = false;

    // Check if terminal is still alive
    if (this.closed || !this.terminal) {
      throw new Error(
        `Terminal is closed (exit code: ${this.proc?.exitCode ?? "unknown"}, stdout so far: ${this.outputBuffer.slice(0, 200)})`,
      );
    }

    // Write command to PTY (may throw if process exited)
    try {
      this.terminal.write(command + "\n");
    } catch (e) {
      throw new Error(
        `Failed to write to terminal (exit code: ${this.proc?.exitCode ?? "unknown"}, stdout so far: ${this.outputBuffer.slice(0, 500)}): ${String(e)}`,
      );
    }

    // Wait for output with timeout logic
    const startTime = Date.now();
    let lastOutputTime = Date.now();
    let lastLen = 0;
    let exitCode = 0;

    while (true) {
      const elapsed = Date.now() - startTime;
      const currentLen = this.outputBuffer.length;

      // New output? Reset silence timer
      if (currentLen > lastLen) {
        lastOutputTime = Date.now();
        lastLen = currentLen;
      }

      // Check for OSC 133;D completion marker (auto-emitted by TTY-aware REPLs)
      const match = this.outputBuffer.match(OSC_133_D_PATTERN);
      if (match) {
        exitCode = match[1] ? parseInt(match[1], 10) : 0;
        break;
      }

      // Silence timeout reached? (only if we have some output)
      const silenceTime = Date.now() - lastOutputTime;
      if (silenceTime >= this.minWait && currentLen > 0) {
        break;
      }

      // Max timeout reached?
      if (elapsed >= this.maxWait) {
        break;
      }

      await Bun.sleep(10);
    }

    // Process output
    let stdout = this.outputBuffer;

    // Strip OSC 133 sequences
    stdout = stdout.replace(OSC_133_ANY_PATTERN, "");

    // Strip ANSI escape codes if requested
    if (this.stripAnsi) {
      stdout = stdout.replace(ANSI_ESCAPE_PATTERN, "");
    }

    // Normalize line endings (PTY uses \r\n)
    stdout = stdout.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    // Remove the echoed command from output (PTY echoes input by default)
    const lines = stdout.split("\n");
    if (lines[0]?.includes(command)) {
      lines.shift();
    }
    stdout = lines.join("\n");

    return {
      stdout: Buffer.from(stdout),
      stderr: Buffer.from(""), // PTY merges stderr into stdout
      exitCode,
    };
  }

  /**
   * Close the PTY session
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    try {
      this.terminal?.close();
      if (this.proc) {
        await Promise.race([
          this.proc.exited,
          new Promise<void>((resolve) => {
            setTimeout(resolve, 1000);
          }),
        ]);
        this.proc.kill();
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  get isRunning(): boolean {
    return !this.closed && this.proc?.exitCode === null;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}
