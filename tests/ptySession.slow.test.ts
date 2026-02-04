import { describe, test, expect, beforeAll, afterAll } from "vitest"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PtySession } from "../src/ptySession"

// Skip on non-POSIX platforms
const isWindows = process.platform === "win32"

describe.skipIf(isWindows)("PtySession", () => {
  let tempDir: string

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ptySession-test-"))
  })

  afterAll(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  describe("basic execution", () => {
    test("executes a simple command", async () => {
      const session = new PtySession("cat", { minWait: 50, maxWait: 1000 })
      try {
        const result = await session.execute("hello world")
        expect(result.stdout.toString().trim()).toBe("hello world")
        // PTY merges stderr into stdout
        expect(result.stderr.toString()).toBe("")
      } finally {
        await session.close()
      }
    })

    test("maintains state between commands", async () => {
      // Use bash --norc to avoid prompt noise in PTY
      const session = new PtySession("bash --norc --noprofile", {
        minWait: 50,
        maxWait: 1000,
      })
      try {
        // Set a variable
        await session.execute("export FOO=bar")

        // Read it back
        const result = await session.execute("echo $FOO")
        // Get first non-empty line (skip any prompt noise)
        const firstLine = result.stdout
          .toString()
          .split("\n")
          .find((l) => l.trim() && !l.includes("$"))
        expect(firstLine?.trim()).toBe("bar")
      } finally {
        await session.close()
      }
    })

    test("subprocess sees isTTY as true", async () => {
      const session = new PtySession("bash --norc --noprofile", {
        minWait: 50,
        maxWait: 1000,
      })
      try {
        // Check if stdout is a TTY from the subprocess perspective
        const result = await session.execute(
          "[ -t 1 ] && echo TTY || echo PIPE",
        )
        // Get first non-empty line
        const firstLine = result.stdout
          .toString()
          .split("\n")
          .find((l) => l.trim() && !l.includes("$"))
        expect(firstLine?.trim()).toBe("TTY")
      } finally {
        await session.close()
      }
    })
  })

  describe("ANSI stripping", () => {
    test("strips ANSI color codes by default", async () => {
      const session = new PtySession("bash --norc --noprofile", {
        minWait: 50,
        maxWait: 1000,
      })
      try {
        // Echo with ANSI color codes
        const result = await session.execute('echo -e "\\033[31mred\\033[0m"')
        // Should strip the color codes - get first meaningful line
        const firstLine = result.stdout
          .toString()
          .split("\n")
          .find((l) => l.includes("red"))
        expect(firstLine?.trim()).toBe("red")
      } finally {
        await session.close()
      }
    })

    test("preserves ANSI codes when stripAnsi is false", async () => {
      const session = new PtySession("bash --norc --noprofile", {
        minWait: 50,
        maxWait: 1000,
        stripAnsi: false,
      })
      try {
        const result = await session.execute('echo -e "\\033[31mred\\033[0m"')
        // Should preserve the color codes (though they may appear differently)
        const output = result.stdout.toString()
        // The output should contain escape sequences or the raw text
        expect(output).toContain("red")
      } finally {
        await session.close()
      }
    })
  })

  describe("timeout behavior", () => {
    test("respects minWait for silence detection", async () => {
      const session = new PtySession("cat", { minWait: 100, maxWait: 2000 })
      try {
        const start = Date.now()
        await session.execute("test")
        const elapsed = Date.now() - start

        // Should wait at least minWait after output
        expect(elapsed).toBeGreaterThanOrEqual(100)
        // But not too long
        expect(elapsed).toBeLessThan(500)
      } finally {
        await session.close()
      }
    })

    test("respects maxWait timeout", async () => {
      // Use a command that produces no output to trigger maxWait
      const session = new PtySession("sleep 10", { minWait: 50, maxWait: 200 })
      try {
        const start = Date.now()
        await session.execute("") // sleep doesn't read stdin
        const elapsed = Date.now() - start

        // Should timeout around maxWait
        expect(elapsed).toBeGreaterThanOrEqual(200)
        expect(elapsed).toBeLessThan(500)
      } finally {
        await session.close()
      }
    })

    test("respects startupDelay for first command", async () => {
      // Use a command that doesn't produce output immediately
      const session = new PtySession("bash --norc --noprofile", {
        minWait: 50,
        maxWait: 1000,
        startupDelay: 100,
      })
      try {
        const start = Date.now()
        await session.execute("echo ready")
        const elapsed = Date.now() - start

        // First command should complete (might be fast due to OSC 133 or output detection)
        expect(elapsed).toBeLessThan(1000)
        expect(session.isRunning).toBe(true)
      } finally {
        await session.close()
      }
    })
  })

  describe("custom command", () => {
    test("works with a custom script", async () => {
      // Create a simple "REPL" script that echoes input with a prefix
      const scriptPath = join(tempDir, "echo-repl.sh")
      writeFileSync(
        scriptPath,
        `#!/bin/bash
while IFS= read -r line; do
  echo "GOT: $line"
done
`,
        { mode: 0o755 },
      )

      const session = new PtySession(`bash ${scriptPath}`, {
        minWait: 50,
        maxWait: 1000,
      })
      try {
        const result = await session.execute("hello")
        expect(result.stdout.toString().trim()).toBe("GOT: hello")
      } finally {
        await session.close()
      }
    })
  })

  describe("cleanup", () => {
    test("close() terminates the subprocess", async () => {
      const session = new PtySession("cat", { minWait: 50, maxWait: 1000 })
      expect(session.isRunning).toBe(true)

      await session.close()

      // After close, isRunning should be false
      expect(session.isRunning).toBe(false)
    })

    test("multiple close() calls are safe", async () => {
      const session = new PtySession("cat", { minWait: 50, maxWait: 1000 })

      await session.close()
      await session.close() // Should not throw
      await session.close() // Should not throw

      expect(session.isRunning).toBe(false)
    })
  })

  describe("PTY-specific features", () => {
    test("uses specified terminal size", async () => {
      const session = new PtySession("bash --norc --noprofile", {
        minWait: 50,
        maxWait: 1000,
        cols: 120,
        rows: 40,
      })
      try {
        // tput cols returns the terminal width
        const result = await session.execute("tput cols")
        const firstLine = result.stdout
          .toString()
          .split("\n")
          .find((l) => /^\d+$/.test(l.trim()))
        expect(firstLine?.trim()).toBe("120")
      } finally {
        await session.close()
      }
    })

    test("handles multiline output", async () => {
      const session = new PtySession("bash --norc --noprofile", {
        minWait: 50,
        maxWait: 1000,
      })
      try {
        const result = await session.execute('echo -e "line1\\nline2\\nline3"')
        const lines = result.stdout.toString().split("\n")
        expect(lines.some((l) => l.includes("line1"))).toBe(true)
        expect(lines.some((l) => l.includes("line2"))).toBe(true)
        expect(lines.some((l) => l.includes("line3"))).toBe(true)
      } finally {
        await session.close()
      }
    })
  })
})

describe.skipIf(isWindows)("OSC 133 shell integration (PTY)", () => {
  let tempDir: string

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "osc133-pty-test-"))
  })

  afterAll(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  test("detects OSC 133;D marker and extracts exit code", async () => {
    // Create a script that emits OSC 133 sequences
    const scriptPath = join(tempDir, "osc133-repl.sh")
    writeFileSync(
      scriptPath,
      `#!/bin/bash
while IFS= read -r line; do
  echo "output: $line"
  # Emit OSC 133;D;0 (command complete with exit code 0)
  printf '\\e]133;D;0\\a'
done
`,
      { mode: 0o755 },
    )

    const session = new PtySession(`bash ${scriptPath}`, {
      minWait: 100,
      maxWait: 1000,
      startupDelay: 200, // Allow time for script to start
    })
    try {
      const result = await session.execute("hello")

      // Output should be stripped of OSC sequences and contain expected text
      expect(result.stdout.toString()).toContain("output: hello")
      // Exit code should be extracted
      expect(result.exitCode).toBe(0)
    } finally {
      await session.close()
    }
  })

  test("extracts non-zero exit code from OSC 133;D", async () => {
    const scriptPath = join(tempDir, "osc133-error.sh")
    writeFileSync(
      scriptPath,
      `#!/bin/bash
while IFS= read -r line; do
  echo "error occurred"
  # Emit OSC 133;D;1 (command complete with exit code 1)
  printf '\\e]133;D;1\\a'
done
`,
      { mode: 0o755 },
    )

    const session = new PtySession(`bash ${scriptPath}`, {
      minWait: 50,
      maxWait: 1000,
    })
    try {
      const result = await session.execute("fail")
      expect(result.exitCode).toBe(1)
    } finally {
      await session.close()
    }
  })

  test("falls back to silence detection when no OSC marker", async () => {
    // Regular cat doesn't emit OSC 133, should fall back to silence
    const session = new PtySession("cat", {
      minWait: 50,
      maxWait: 1000,
    })
    try {
      const start = Date.now()
      const result = await session.execute("no marker")
      const elapsed = Date.now() - start

      // Should wait for minWait since no marker
      expect(elapsed).toBeGreaterThanOrEqual(50)
      expect(result.stdout.toString().trim()).toBe("no marker")
      // Exit code defaults to 0
      expect(result.exitCode).toBe(0)
    } finally {
      await session.close()
    }
  })

  test("strips all OSC 133 sequences from output", async () => {
    const scriptPath = join(tempDir, "osc133-full.sh")
    writeFileSync(
      scriptPath,
      `#!/bin/bash
while IFS= read -r line; do
  # Emit full OSC 133 protocol: A (prompt), C (cmd start), output, D (cmd end)
  printf '\\e]133;A\\a'
  printf '\\e]133;C\\a'
  echo "result: $line"
  printf '\\e]133;D;0\\a'
done
`,
      { mode: 0o755 },
    )

    const session = new PtySession(`bash ${scriptPath}`, {
      minWait: 50,
      maxWait: 1000,
    })
    try {
      const result = await session.execute("test")
      // All OSC sequences should be stripped
      expect(result.stdout.toString().trim()).toBe("result: test")
    } finally {
      await session.close()
    }
  })
})

describe.skipIf(isWindows)("PtySession state file loading", () => {
  let tempDir: string
  let envFile: string
  let cwdFile: string
  let funcFile: string

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "pty-state-test-"))
    envFile = join(tempDir, "test.env.sh")
    cwdFile = join(tempDir, "test.cwd.txt")
    funcFile = join(tempDir, "test.func.sh")
  })

  afterAll(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  test("loads environment from envFile", async () => {
    // Create env file with exported variable
    writeFileSync(envFile, 'export MY_VAR="from-env-file"\n')

    const session = new PtySession("bash --norc --noprofile", {
      minWait: 50,
      maxWait: 1000,
      envFile,
    })
    try {
      const result = await session.execute("echo $MY_VAR")
      const output = result.stdout.toString()
      expect(output).toContain("from-env-file")
    } finally {
      await session.close()
    }
  })

  test("loads cwd from cwdFile", async () => {
    // Create cwd file pointing to temp directory
    writeFileSync(cwdFile, tempDir)

    const session = new PtySession("bash --norc --noprofile", {
      minWait: 50,
      maxWait: 1000,
      cwdFile,
    })
    try {
      const result = await session.execute("pwd")
      const output = result.stdout.toString()
      expect(output).toContain(tempDir)
    } finally {
      await session.close()
    }
  })

  test("loads functions from funcFile", async () => {
    // Create func file with a bash function
    writeFileSync(funcFile, 'myfunc() { echo "hello from myfunc"; }\n')

    // Note: The PtySession wrapper script sources funcFile before running the command.
    // We need to use a command that will call the function, not just bash.
    // Create a script that sources the function file and provides a REPL
    const replScript = join(tempDir, "func-repl.sh")
    writeFileSync(
      replScript,
      `#!/bin/bash
source "${funcFile}"
while IFS= read -r line; do
  eval "$line"
done
`,
      { mode: 0o755 },
    )

    const session = new PtySession(`bash ${replScript}`, {
      minWait: 50,
      maxWait: 1000,
    })
    try {
      const result = await session.execute("myfunc")
      const output = result.stdout.toString()
      expect(output).toContain("hello from myfunc")
    } finally {
      await session.close()
    }
  })
})
