import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CmdSession } from "../src/cmdSession";
import { parseInfo } from "../src/core";

describe("CmdSession", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cmdSession-test-"));
  });

  afterAll(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("basic execution", () => {
    test("executes a simple command", async () => {
      const session = new CmdSession("cat", { minWait: 50, maxWait: 1000 });
      try {
        const result = await session.execute("hello world");
        expect(result.stdout.toString()).toBe("hello world\n");
        expect(result.stderr.toString()).toBe("");
      } finally {
        await session.close();
      }
    });

    test("maintains state between commands", async () => {
      // Use bash as the REPL to test state persistence
      const session = new CmdSession("bash", { minWait: 50, maxWait: 1000 });
      try {
        // Set a variable
        await session.execute("export FOO=bar");

        // Read it back
        const result = await session.execute("echo $FOO");
        expect(result.stdout.toString().trim()).toBe("bar");
      } finally {
        await session.close();
      }
    });

    test("captures stderr", async () => {
      const session = new CmdSession("bash", { minWait: 50, maxWait: 1000 });
      try {
        const result = await session.execute("echo error >&2");
        expect(result.stderr.toString().trim()).toBe("error");
      } finally {
        await session.close();
      }
    });
  });

  describe("timeout behavior", () => {
    test("respects minWait for silence detection", async () => {
      const session = new CmdSession("cat", { minWait: 100, maxWait: 2000 });
      try {
        const start = Date.now();
        await session.execute("test");
        const elapsed = Date.now() - start;

        // Should wait at least minWait after output
        expect(elapsed).toBeGreaterThanOrEqual(100);
        // But not too long
        expect(elapsed).toBeLessThan(500);
      } finally {
        await session.close();
      }
    });

    test("respects maxWait timeout", async () => {
      // Use a command that produces no output to trigger maxWait
      const session = new CmdSession("sleep 10", { minWait: 50, maxWait: 200 });
      try {
        const start = Date.now();
        await session.execute(""); // sleep doesn't read stdin, just waits
        const elapsed = Date.now() - start;

        // Should timeout around maxWait
        expect(elapsed).toBeGreaterThanOrEqual(200);
        expect(elapsed).toBeLessThan(500);
      } finally {
        await session.close();
      }
    });
  });

  describe("custom command", () => {
    test("works with a custom script", async () => {
      // Create a simple "REPL" script that echoes input with a prefix
      const scriptPath = join(tempDir, "echo-repl.sh");
      writeFileSync(
        scriptPath,
        `#!/bin/bash
while IFS= read -r line; do
  echo "GOT: $line"
done
`,
        { mode: 0o755 },
      );

      const session = new CmdSession(`bash ${scriptPath}`, {
        minWait: 50,
        maxWait: 1000,
      });
      try {
        const result = await session.execute("hello");
        expect(result.stdout.toString().trim()).toBe("GOT: hello");
      } finally {
        await session.close();
      }
    });
  });

  describe("cleanup", () => {
    test("close() terminates the subprocess", async () => {
      const session = new CmdSession("cat", { minWait: 50, maxWait: 1000 });
      expect(session.isRunning).toBe(true);

      await session.close();

      // After close, isRunning should be false
      expect(session.isRunning).toBe(false);
    });

    test("multiple close() calls are safe", async () => {
      const session = new CmdSession("cat", { minWait: 50, maxWait: 1000 });

      await session.close();
      await session.close(); // Should not throw
      await session.close(); // Should not throw

      expect(session.isRunning).toBe(false);
    });
  });
});

describe("OSC 133 shell integration", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "osc133-test-"));
  });

  afterAll(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  test("detects OSC 133;D marker and extracts exit code", async () => {
    // Create a script that emits OSC 133 sequences
    const scriptPath = join(tempDir, "osc133-repl.sh");
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
    );

    const session = new CmdSession(`bash ${scriptPath}`, {
      minWait: 50,
      maxWait: 1000,
      useOsc133: true,
    });
    try {
      const start = Date.now();
      const result = await session.execute("hello");
      const elapsed = Date.now() - start;

      // Should complete quickly (not wait for minWait silence)
      expect(elapsed).toBeLessThan(100);
      // Output should be stripped of OSC sequences
      expect(result.stdout.toString().trim()).toBe("output: hello");
      // Exit code should be extracted
      expect(result.exitCode).toBe(0);
    } finally {
      await session.close();
    }
  });

  test("extracts non-zero exit code from OSC 133;D", async () => {
    const scriptPath = join(tempDir, "osc133-error.sh");
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
    );

    const session = new CmdSession(`bash ${scriptPath}`, {
      minWait: 50,
      maxWait: 1000,
      useOsc133: true,
    });
    try {
      const result = await session.execute("fail");
      expect(result.exitCode).toBe(1);
    } finally {
      await session.close();
    }
  });

  test("falls back to silence detection when no OSC marker", async () => {
    // Regular cat doesn't emit OSC 133, should fall back to silence
    const session = new CmdSession("cat", {
      minWait: 50,
      maxWait: 1000,
      useOsc133: true,
    });
    try {
      const start = Date.now();
      const result = await session.execute("no marker");
      const elapsed = Date.now() - start;

      // Should wait for minWait since no marker
      expect(elapsed).toBeGreaterThanOrEqual(50);
      expect(result.stdout.toString().trim()).toBe("no marker");
      // Exit code defaults to 0
      expect(result.exitCode).toBe(0);
    } finally {
      await session.close();
    }
  });

  test("strips all OSC 133 sequences from output", async () => {
    const scriptPath = join(tempDir, "osc133-full.sh");
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
    );

    const session = new CmdSession(`bash ${scriptPath}`, {
      minWait: 50,
      maxWait: 1000,
      useOsc133: true,
    });
    try {
      const result = await session.execute("test");
      // All OSC sequences should be stripped
      expect(result.stdout.toString().trim()).toBe("result: test");
    } finally {
      await session.close();
    }
  });

  test("sets TERM_SHELL_INTEGRATION env var when useOsc133 is true", async () => {
    const session = new CmdSession("bash", {
      minWait: 50,
      maxWait: 1000,
      useOsc133: true,
    });
    try {
      const result = await session.execute("echo $TERM_SHELL_INTEGRATION");
      expect(result.stdout.toString().trim()).toBe("1");
    } finally {
      await session.close();
    }
  });
});

describe("parseInfo with cmd options", () => {
  test("parses cmd option with quoted value", () => {
    const opts = parseInfo('cmd="km sh board.md"');
    expect(opts.cmd).toBe("km sh board.md");
  });

  test("parses cmd with minWait and maxWait", () => {
    const opts = parseInfo('cmd="my-repl" minWait=50 maxWait=500');
    expect(opts.cmd).toBe("my-repl");
    expect(opts.minWait).toBe(50);
    expect(opts.maxWait).toBe(500);
  });

  test("parses cmd with other options", () => {
    const opts = parseInfo('cmd="test-cmd" cwd=/tmp exit=1');
    expect(opts.cmd).toBe("test-cmd");
    expect(opts.cwd).toBe("/tmp");
    expect(opts.exit).toBe(1);
  });
});
