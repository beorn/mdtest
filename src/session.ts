// Session management for shared state across commands in a test file

import {
  writeFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  mkdtempSync,
  rmSync,
} from "fs";
import { join } from "node:path";
import { tmpdir } from "os";
import { splitNorm, matchLines, hintMismatch } from "./core.js";
import type { ShellAdapter } from "./shell.js";
import type { CommandResult } from "./api.js";
import {
  createStatePaths,
  ensureStateFiles,
  type StateFiles,
} from "./state.js";
import createDebug from "debug";

const debug = createDebug("mdtest:session");

export class TestSession {
  private statePaths: StateFiles;
  private baseDir: string;
  private testTempDir: string;
  private originalCwd: string;
  private helperFiles = new Map<string, string>(); // filename -> filepath in tempDir
  private hookFiles = new Map<string, string>(); // hookName -> filepath in tempDir
  private shell: ShellAdapter;

  // Expose state file paths for compatibility
  get envFile(): string {
    return this.statePaths.envFile;
  }
  get cwdFile(): string {
    return this.statePaths.cwdFile;
  }
  get funcFile(): string {
    return this.statePaths.funcFile;
  }

  constructor(
    public filePath: string,
    shellAdapter: ShellAdapter,
  ) {
    this.shell = shellAdapter;
    // ADR-004: Auto-chdir to temp directory for test isolation
    this.originalCwd = process.cwd();
    this.testTempDir = mkdtempSync(join(tmpdir(), "mdtest-"));

    // Store state files in the unique temp directory to avoid race conditions
    // when running the same test file multiple times concurrently
    this.baseDir = this.testTempDir;
    this.statePaths = createStatePaths(filePath, this.baseDir);
  }

  /**
   * Add a helper file or hook from a file= code block
   * Writes the content to a file in the test temp directory
   */
  addHelperFile(filename: string, content: string): void {
    const filepath = join(this.testTempDir, filename);
    debug("Creating file: %s", filepath);
    debug("Content length: %d bytes", content.length);
    writeFileSync(filepath, content, "utf8");
    debug("File written successfully");

    // Check if this is a lifecycle hook
    const hookNames = ["beforeAll", "beforeEach", "afterEach", "afterAll"];
    if (hookNames.includes(filename)) this.hookFiles.set(filename, filepath);
    else this.helperFiles.set(filename, filepath);
  }

  loadState(): void {
    // Ensure base directory exists
    if (!existsSync(this.baseDir)) mkdirSync(this.baseDir, { recursive: true });

    // Set ROOT to original project root for tests to reference source
    if (!process.env.ROOT) process.env.ROOT = this.originalCwd;

    // Change to temp directory for test isolation
    process.chdir(this.testTempDir);

    // Initialize state files if they don't exist
    ensureStateFiles(this.statePaths, this.testTempDir);
  }

  async runCommand(
    command: string,
    expected?: { stdout?: string[]; stderr?: string[]; exit?: number },
    _opts?: { verbose?: boolean },
  ): Promise<CommandResult> {
    const startTime = Date.now();

    // Build script that sources helpers, restores state, runs command, saves state
    const script = this.buildCommandScript(command);

    const result = await this.shell.execute(["bash", "-lc", script]);

    const stdout = splitNorm(result.stdout.toString());
    const stderr = splitNorm(result.stderr.toString());

    // Remove trailing empty lines
    while (stdout.length > 0 && stdout[stdout.length - 1] === "") stdout.pop();
    while (stderr.length > 0 && stderr[stderr.length - 1] === "") stderr.pop();

    const duration = Date.now() - startTime;

    // Validate output if expected is provided
    let passed = true;
    let diff: string | undefined;

    if (expected) {
      const caps: Record<string, string> = {};

      // Check stdout
      const stdoutMatch = matchLines(expected.stdout || [], stdout, caps);
      if (!stdoutMatch.ok) {
        passed = false;
        diff = hintMismatch(
          "stdout",
          expected.stdout || [],
          stdout,
          stdoutMatch.msg,
        );
      }

      // Check stderr
      if (passed && expected.stderr) {
        const stderrMatch = matchLines(expected.stderr, stderr, caps);
        if (!stderrMatch.ok) {
          passed = false;
          diff = hintMismatch(
            "stderr",
            expected.stderr,
            stderr,
            stderrMatch.msg,
          );
        }
      }

      // Check exit code
      if (passed && expected.exit !== undefined) {
        const actualExit = result.exitCode ?? 0;
        if (expected.exit !== actualExit) {
          passed = false;
          diff = `Exit code mismatch: expected ${expected.exit}, got ${actualExit}`;
        }
      }
    }

    return {
      command,
      displayName: `$ ${command}`,
      passed,
      duration,
      stdout,
      stderr,
      exitCode: result.exitCode ?? 0,
      expected: expected
        ? {
            stdout: expected.stdout ?? [],
            stderr: expected.stderr ?? [],
            exitCode: expected.exit ?? 0,
          }
        : undefined,
      diff,
    };
  }

  async callHook(
    hookName: "beforeAll" | "afterAll" | "beforeEach" | "afterEach",
  ): Promise<void> {
    const hookFile = this.hookFiles.get(hookName);
    if (!hookFile) return; // Hook not defined

    const parts: string[] = [];

    // 1. Source all helper files (functions available)
    for (const filepath of this.helperFiles.values()) {
      parts.push(
        `[ -f "${filepath}" ] && source "${filepath}" 2>/dev/null || true`,
      );
    }

    // 2. Restore state from previous commands
    parts.push(
      `[ -f "${this.envFile}" ] && { set -a; . "${this.envFile}"; set +a; }`,
    );
    parts.push(
      `[ -f "${this.cwdFile}" ] && cd "$(cat "${this.cwdFile}")" 2>/dev/null || true`,
    );
    parts.push(
      `[ -f "${this.funcFile}" ] && source "${this.funcFile}" 2>/dev/null || true`,
    );

    // 3. Run the hook
    parts.push(`source "${hookFile}"`);

    // 4. Save state after hook
    parts.push(`pwd > "${this.cwdFile}"`);
    parts.push(`export -p | sed -E 's/^declare -x //g' > "${this.envFile}"`);
    parts.push(`declare -f > "${this.funcFile}"`);

    const script = parts.join("\n");
    await this.shell.execute(["bash", "-lc", script]);
  }

  /**
   * Build a bash script for running a command with proper state management
   * Execution order (Option 2 - beforeEach as reset):
   * 1. Source helper files (functions available)
   * 2. Restore env/cwd/functions from previous command
   * 3. Run beforeEach hook (acts as reset, runs after state restoration)
   * 4. User command
   * 5. Run afterEach hook
   * 6. Save env/cwd/functions state
   */
  private buildCommandScript(command: string): string {
    const parts: string[] = [];

    // 1. Source all helper files (functions available)
    for (const filepath of this.helperFiles.values()) {
      parts.push(
        `[ -f "${filepath}" ] && source "${filepath}" 2>/dev/null || true`,
      );
    }

    // 2. Restore state from previous command
    parts.push(
      `[ -f "${this.envFile}" ] && { set -a; . "${this.envFile}"; set +a; }`,
    );
    parts.push(
      `[ -f "${this.cwdFile}" ] && cd "$(cat "${this.cwdFile}")" 2>/dev/null || true`,
    );
    parts.push(
      `[ -f "${this.funcFile}" ] && source "${this.funcFile}" 2>/dev/null || true`,
    );

    // 3. Run beforeEach hook (AFTER state restoration - acts as reset)
    const beforeEach = this.hookFiles.get("beforeEach");
    if (beforeEach) {
      parts.push(
        `[ -f "${beforeEach}" ] && source "${beforeEach}" 2>/dev/null || true`,
      );
    }

    // 4. User command
    parts.push(command);

    // 5. Run afterEach hook
    const afterEach = this.hookFiles.get("afterEach");
    if (afterEach) {
      parts.push(
        `[ -f "${afterEach}" ] && source "${afterEach}" 2>/dev/null || true`,
      );
    }

    // 6. Save state for next command
    parts.push("_EXIT=$?");
    parts.push(`pwd > "${this.cwdFile}"`);
    parts.push(`export -p | sed -E 's/^declare -x //g' > "${this.envFile}"`);
    parts.push(`declare -f > "${this.funcFile}"`);
    parts.push("exit $_EXIT");

    return parts.join("\n");
  }

  cleanup(): void {
    // Restore original directory
    try {
      process.chdir(this.originalCwd);
    } catch {
      // Ignore chdir errors
    }

    // Clean up state files
    try {
      if (existsSync(this.envFile)) unlinkSync(this.envFile);
      if (existsSync(this.cwdFile)) unlinkSync(this.cwdFile);
      if (existsSync(this.funcFile)) unlinkSync(this.funcFile);
    } catch {
      // Ignore cleanup errors
    }

    // Clean up temp directory (includes helper files and hook files)
    try {
      if (existsSync(this.testTempDir)) {
        rmSync(this.testTempDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}
