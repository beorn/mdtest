/**
 * CmdSession - Manages a persistent subprocess for custom command execution
 *
 * Instead of running each command as a separate process (like the default bash mode),
 * CmdSession keeps a subprocess alive and sends commands to its stdin, capturing
 * stdout/stderr with timeout-based completion detection.
 *
 * This enables testing REPLs like `km sh` where state persists between commands.
 *
 * ## OSC 133 Shell Integration Protocol
 *
 * When useOsc133 is enabled, CmdSession uses the OSC 133 terminal shell integration
 * protocol (used by Kitty, WezTerm, iTerm2, VS Code) for deterministic command
 * completion detection instead of silence timeouts.
 *
 * Protocol sequences:
 * - \x1b]133;A\x07 - Prompt start (REPL is ready for input)
 * - \x1b]133;C\x07 - Command start (execution beginning)
 * - \x1b]133;D;N\x07 - Command end with exit code N
 *
 * The REPL must emit these sequences when TERM_SHELL_INTEGRATION=1 is set.
 */

import type { Subprocess } from "bun";
import type { ShellResult } from "./shell.js";
import { DEFAULTS } from "./constants.js";

// OSC 133 escape sequence patterns (using BEL \x07 as terminator)
// Pattern to match OSC 133;D with optional exit code: \x1b]133;D;N\x07 or \x1b]133;D\x07
const OSC_133_D_PATTERN = /\x1b\]133;D(?:;(-?\d+))?\x07/;
// Pattern to match OSC 133;A (prompt start - REPL is ready for input)
const OSC_133_A_PATTERN = /\x1b\]133;A\x07/;
// Pattern to match any OSC 133 sequence for stripping
const OSC_133_ANY_PATTERN = /\x1b\]133;[A-Z](?:;[^\x07]*)?\x07/g;

export interface CmdSessionOpts {
  cwd?: string;
  env?: Record<string, string>;
  minWait?: number; // ms of silence to wait (default: 100)
  maxWait?: number; // max ms total (default: 2000)
  startupDelay?: number; // ms to wait for subprocess to be ready (default: 0)
  useOsc133?: boolean; // If true, detect OSC 133;D marker instead of silence (default: false)
  // State files for loading bash session state
  envFile?: string;
  cwdFile?: string;
  funcFile?: string;
}

export class CmdSession {
  // Use explicit type for subprocess with piped stdin/stdout/stderr
  private proc: Subprocess<"pipe", "pipe", "pipe">;
  private stdoutBuffer: string = "";
  private stderrBuffer: string = "";
  private minWait: number;
  private maxWait: number;
  private startupDelay: number;
  private useOsc133: boolean;
  private firstExecute = true;
  private closed = false;

  // Track reader promises for cleanup
  private stdoutReader: Promise<void> | null = null;
  private stderrReader: Promise<void> | null = null;

  constructor(cmd: string, opts: CmdSessionOpts = {}) {
    this.minWait = opts.minWait ?? DEFAULTS.CMD_SESSION.MIN_WAIT;
    this.maxWait = opts.maxWait ?? DEFAULTS.CMD_SESSION.MAX_WAIT;
    this.startupDelay = opts.startupDelay ?? DEFAULTS.CMD_SESSION.STARTUP_DELAY;
    this.useOsc133 = opts.useOsc133 ?? false;

    // Build wrapper script that loads session state before running the cmd
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
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      cwd: opts.cwd,
      env: {
        ...process.env,
        ...opts.env,
        // TERM=dumb prevents shell from emitting escape sequences (bracketed paste mode, etc.)
        TERM: "dumb",
        // Enable OSC 133 shell integration in subprocess
        ...(this.useOsc133 ? { TERM_SHELL_INTEGRATION: "1" } : {}),
      },
    });

    // Start background readers for both streams
    this.startReaders();
  }

  private startReaders(): void {
    // Background reader for stdout using Bun's ReadableStream
    this.stdoutReader = (async () => {
      const stream = this.proc.stdout;
      const reader = stream.getReader();
      try {
        while (!this.closed) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            this.stdoutBuffer += new TextDecoder().decode(value);
          }
        }
      } catch {
        // Stream closed or error - ignore during cleanup
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // Ignore
        }
      }
    })();

    // Background reader for stderr using Bun's ReadableStream
    this.stderrReader = (async () => {
      const stream = this.proc.stderr;
      const reader = stream.getReader();
      try {
        while (!this.closed) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            this.stderrBuffer += new TextDecoder().decode(value);
          }
        }
      } catch {
        // Stream closed or error - ignore during cleanup
      } finally {
        try {
          reader.releaseLock();
        } catch {
          // Ignore
        }
      }
    })();
  }

  /**
   * Wait for subprocess to be ready by detecting OSC 133;A prompt marker.
   * This is more robust than a fixed delay as it adapts to actual subprocess startup time.
   * Falls back to startupDelay timeout if no marker is received.
   */
  private async waitForReady(): Promise<void> {
    const startTime = Date.now();
    // Use a longer timeout for startup (5 seconds) to handle high-concurrency scenarios
    const maxStartupWait = Math.max(this.maxWait, 5000);

    while (true) {
      // Check for OSC 133;A (prompt start marker)
      if (OSC_133_A_PATTERN.test(this.stdoutBuffer)) {
        return;
      }

      const elapsed = Date.now() - startTime;
      if (elapsed >= maxStartupWait) {
        // Timeout - proceed anyway, execute() will handle any issues
        return;
      }

      await Bun.sleep(10);
    }
  }

  /**
   * Execute a command and wait for output with timeout-based completion detection
   *
   * When useOsc133 is enabled, waits for OSC 133;D marker and extracts exit code.
   * Falls back to silence-based detection on timeout.
   */
  async execute(command: string): Promise<ShellResult> {
    // Wait for subprocess to be ready on first execute
    const isFirstExecute = this.firstExecute;
    if (isFirstExecute) {
      if (this.useOsc133) {
        // For OSC 133 mode, wait for initial prompt marker (more robust than fixed delay)
        await this.waitForReady();
      } else if (this.startupDelay > 0) {
        // For non-OSC 133 mode, use fixed delay
        await Bun.sleep(this.startupDelay);
      }
      this.firstExecute = false;
    }

    // Clear buffers (but preserve initial prompt for first command in OSC 133 mode)
    // The initial prompt is expected to be part of the output for first command
    if (!isFirstExecute || !this.useOsc133) {
      this.stdoutBuffer = "";
      this.stderrBuffer = "";
    }

    // Write command to stdin using Bun's FileSink
    // FileSink has write() method that accepts strings or Uint8Array
    // Note: write() and flush() return promises but we intentionally fire-and-forget
    // as the timeout-based read loop will handle waiting for output
    void this.proc.stdin.write(command + "\n");
    void this.proc.stdin.flush();

    // Wait for output with timeout logic
    const startTime = Date.now();
    let lastOutputTime = Date.now();
    let lastLen = 0;
    let exitCode = 0;

    while (true) {
      const elapsed = Date.now() - startTime;
      const currentLen = this.stdoutBuffer.length + this.stderrBuffer.length;

      // New output? Reset silence timer
      if (currentLen > lastLen) {
        lastOutputTime = Date.now();
        lastLen = currentLen;
      }

      // OSC 133 mode: check for completion marker
      // We need BOTH OSC 133;D (command done) AND OSC 133;A (next prompt ready)
      // to ensure we capture the full output including the next prompt
      if (this.useOsc133) {
        const matchD = this.stdoutBuffer.match(OSC_133_D_PATTERN);
        if (matchD) {
          exitCode = matchD[1] ? parseInt(matchD[1], 10) : 0;
          // Also wait for OSC 133;A (prompt ready) which comes after D
          // This ensures we capture the next prompt in the output
          if (OSC_133_A_PATTERN.test(this.stdoutBuffer.slice(matchD.index!))) {
            break;
          }
        }
      }

      // Silence timeout reached? (only if we have some output)
      // In OSC 133 mode, we rely on markers instead - only use silence for non-OSC 133
      if (!this.useOsc133) {
        const silenceTime = Date.now() - lastOutputTime;
        if (silenceTime >= this.minWait && currentLen > 0) {
          break;
        }
      }

      // Max timeout reached?
      if (elapsed >= this.maxWait) {
        break;
      }

      // Small sleep to avoid busy-waiting
      await Bun.sleep(10);
    }

    // Strip OSC 133 sequences from output (always strip when useOsc133 is enabled)
    let stdout = this.stdoutBuffer;
    let stderr = this.stderrBuffer;
    if (this.useOsc133) {
      stdout = stdout.replace(OSC_133_ANY_PATTERN, "");
      stderr = stderr.replace(OSC_133_ANY_PATTERN, "");
    }

    return {
      stdout: Buffer.from(stdout),
      stderr: Buffer.from(stderr),
      exitCode,
    };
  }

  /**
   * Close the subprocess
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    try {
      // Close stdin to signal EOF (returns a number, not a promise)
      void this.proc.stdin.end();

      // Wait for process to exit with timeout
      const exitPromise = this.proc.exited;
      const timeoutPromise = new Promise<"timeout">((resolve) => {
        setTimeout(() => resolve("timeout"), 1000);
      });

      const result = await Promise.race([exitPromise, timeoutPromise]);
      if (result === "timeout") {
        // Force kill if it doesn't exit gracefully
        this.proc.kill();
        await this.proc.exited;
      }
    } catch {
      // Ignore errors during cleanup
    }
  }

  /**
   * Check if the subprocess is still running
   */
  get isRunning(): boolean {
    return !this.closed && this.proc.exitCode === null;
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close();
  }
}
