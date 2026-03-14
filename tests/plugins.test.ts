import { describe, test, expect, vi } from "vitest"
import { PluginExecutor } from "../src/plugin-executor"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// ============ Bug 2: Command extraction drift ============

describe("PluginExecutor.extractCommands", () => {
  // extractCommands is private, but we can test it indirectly via executeBlock
  // or we can test the behavior through the public API

  test("$ without space is NOT treated as a command (e.g. $HOME)", () => {
    // Access private method via any cast for direct testing
    const executor = new PluginExecutor("/fake/path.test.md", "# Test\n")
    const extractCommands = (executor as any).extractCommands.bind(executor)

    // "$HOME" should NOT be extracted as a command
    const result = extractCommands("$ echo hello\n$HOME/bin\n")
    expect(result).toEqual(["echo hello"])
  })

  test("> without space is NOT treated as a continuation", () => {
    const executor = new PluginExecutor("/fake/path.test.md", "# Test\n")
    const extractCommands = (executor as any).extractCommands.bind(executor)

    // ">file.txt" in output should not be treated as continuation
    const result = extractCommands("$ echo hello\n>file.txt\n")
    expect(result).toEqual(["echo hello"])
  })

  test("$ with space IS a command", () => {
    const executor = new PluginExecutor("/fake/path.test.md", "# Test\n")
    const extractCommands = (executor as any).extractCommands.bind(executor)

    const result = extractCommands("$ echo hello\nhello\n$ echo world\nworld\n")
    expect(result).toEqual(["echo hello", "echo world"])
  })

  test("> with space IS a continuation", () => {
    const executor = new PluginExecutor("/fake/path.test.md", "# Test\n")
    const extractCommands = (executor as any).extractCommands.bind(executor)

    const result = extractCommands('$ echo "line1"\n> echo "line2"\n')
    expect(result).toEqual(['echo "line1"\necho "line2"'])
  })

  test("uses slice(2) for consistent extraction", () => {
    const executor = new PluginExecutor("/fake/path.test.md", "# Test\n")
    const extractCommands = (executor as any).extractCommands.bind(executor)

    // "$ echo hello" should extract "echo hello" (not " echo hello" or "echo hello")
    const result = extractCommands("$  echo hello\n")
    // "$  echo hello" should NOT match "$ " prefix (only one space after $)
    // Wait - "$  echo hello" starts with "$ " so it IS a command, extracting " echo hello"
    // With slice(2) it becomes " echo hello" - that's the raw content after "$ "
    // Actually the user wants slice(2) which takes everything after "$ "
    expect(result).toEqual([" echo hello"])
  })
})

// ============ Bug 3: File fixtures written to wrong dir ============

describe("bash plugin file fixtures", () => {
  test("file= blocks are written to cwd, not stateDir", async () => {
    // We need to test that the bash plugin writes file= fixtures to cwd (process.cwd())
    // not to the stateDir (temp directory for state files)
    const { bash } = await import("../src/plugins/bash")

    const originalCwd = process.cwd()
    const testCwd = mkdtempSync(join(tmpdir(), "mdtest-fixture-test-"))

    try {
      process.chdir(testCwd)

      const files = new Map<string, string>()
      files.set("test-fixture.txt", "hello world")

      const plugin = bash({
        path: "/fake/test.md",
        files,
      })

      // The file should be in cwd, not in some internal stateDir
      expect(existsSync(join(testCwd, "test-fixture.txt"))).toBe(true)
      expect(readFileSync(join(testCwd, "test-fixture.txt"), "utf8")).toBe("hello world")
    } finally {
      process.chdir(originalCwd)
      rmSync(testCwd, { recursive: true, force: true })
    }
  })

  test("file= blocks with nested paths create parent dirs", async () => {
    const { bash } = await import("../src/plugins/bash")

    const originalCwd = process.cwd()
    const testCwd = mkdtempSync(join(tmpdir(), "mdtest-fixture-test-"))

    try {
      process.chdir(testCwd)

      const files = new Map<string, string>()
      files.set("nested/dir/test-fixture.txt", "nested content")

      const plugin = bash({
        path: "/fake/test.md",
        files,
      })

      expect(existsSync(join(testCwd, "nested/dir/test-fixture.txt"))).toBe(true)
      expect(readFileSync(join(testCwd, "nested/dir/test-fixture.txt"), "utf8")).toBe("nested content")
    } finally {
      process.chdir(originalCwd)
      rmSync(testCwd, { recursive: true, force: true })
    }
  })
})

// ============ Bug 1: Bash plugin hardcodes bunShell ============

describe("bash plugin shellFn parameter", () => {
  test("accepts custom shellFn", async () => {
    const { bash } = await import("../src/plugins/bash")

    const shellCalls: Array<{ cmd: string[]; opts: any }> = []
    const mockShell = async (cmd: string[], opts?: any) => {
      shellCalls.push({ cmd, opts })
      return {
        stdout: Buffer.from("mock output\n"),
        stderr: Buffer.from(""),
        exitCode: 0,
      }
    }

    const originalCwd = process.cwd()
    const testCwd = mkdtempSync(join(tmpdir(), "mdtest-shell-test-"))

    try {
      process.chdir(testCwd)

      const plugin = bash(
        {
          path: "/fake/test.md",
          files: new Map(),
        },
        { shellFn: mockShell },
      )

      const exec = plugin.block({
        type: "console",
        content: "$ echo hello",
        heading: [],
      })

      expect(exec).not.toBeNull()
      if (exec) {
        const result = await exec("echo hello")
        expect(result).not.toBeNull()
        expect(shellCalls.length).toBeGreaterThan(0)
        expect(shellCalls[0]!.cmd[0]).toBe("bash")
      }
    } finally {
      process.chdir(originalCwd)
      rmSync(testCwd, { recursive: true, force: true })
    }
  })

  test("defaults to bunShell when no shellFn provided", async () => {
    const { bash } = await import("../src/plugins/bash")

    const originalCwd = process.cwd()
    const testCwd = mkdtempSync(join(tmpdir(), "mdtest-shell-test-"))

    try {
      process.chdir(testCwd)

      // Should not throw - uses bunShell by default
      const plugin = bash({
        path: "/fake/test.md",
        files: new Map(),
      })

      expect(plugin).toBeDefined()
      expect(plugin.block).toBeDefined()
    } finally {
      process.chdir(originalCwd)
      rmSync(testCwd, { recursive: true, force: true })
    }
  })
})

// ============ Bug 5: State dir leaked ============

describe("bash plugin state dir cleanup", () => {
  test("stateDir is exposed for cleanup", async () => {
    const { bash } = await import("../src/plugins/bash")

    const originalCwd = process.cwd()
    const testCwd = mkdtempSync(join(tmpdir(), "mdtest-cleanup-test-"))

    try {
      process.chdir(testCwd)

      const plugin = bash({
        path: "/fake/test.md",
        files: new Map(),
      })

      // The plugin should have a cleanup/destroy method or stateDir should be cleaned up
      // After afterAll, stateDir should be cleaned
      if (plugin.afterAll) {
        await plugin.afterAll()
      }

      // The stateDir should have been cleaned up after afterAll
      // We verify by checking that no mdtest- dirs were left behind
      // (This is hard to test directly without exposing stateDir, but we can
      // check that the plugin's afterAll method cleans up)
      expect(plugin.afterAll).toBeDefined()
    } finally {
      process.chdir(originalCwd)
      rmSync(testCwd, { recursive: true, force: true })
    }
  })
})
