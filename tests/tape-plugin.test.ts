import { describe, test, expect, beforeEach, afterEach } from "vitest"
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import tapePlugin from "../src/plugins/tape"
import type { BlockOpts, FileOpts } from "../src/types"

// ── Helpers ──

function createFileOpts(overrides: Partial<FileOpts> = {}): FileOpts {
  return {
    path: "/fake/test.spec.md",
    files: new Map(),
    ...overrides,
  }
}

function createBlockOpts(content: string, overrides: Partial<BlockOpts> = {}): BlockOpts {
  return {
    type: "tape",
    content,
    heading: ["Test"],
    ...overrides,
  }
}

// ── Plugin basics ──

describe("tape plugin", () => {
  test("returns null for non-tape blocks", () => {
    const plugin = tapePlugin(createFileOpts())
    const exec = plugin.block(createBlockOpts("test", { type: "console" }))
    expect(exec).toBeNull()
  })

  test("returns null for file= blocks", () => {
    const plugin = tapePlugin(createFileOpts())
    const exec = plugin.block(createBlockOpts("test", { file: "test.txt" }))
    expect(exec).toBeNull()
  })

  test("returns ExecFn for tape blocks", () => {
    const plugin = tapePlugin(createFileOpts())
    const exec = plugin.block(createBlockOpts('Type "hello"'))
    expect(exec).not.toBeNull()
    expect(typeof exec).toBe("function")
  })
})

// ── Command execution ──

describe("tape command execution", () => {
  let snapDir: string
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "mdspec-tape-test-"))
    snapDir = join(testDir, "__snapshots__", "test")
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test("Type command feeds text to terminal", async () => {
    const testPath = join(testDir, "test.spec.md")
    const plugin = tapePlugin(createFileOpts({ path: testPath }))
    const exec = plugin.block(createBlockOpts('Type "hello world"'))!

    const result = await exec('Type "hello world"')
    expect(result).not.toBeNull()
    expect(result!.exitCode).toBe(0)
    expect(result!.stdout).toContain("Typed: hello world")
  })

  test("Enter key command produces key log", async () => {
    const testPath = join(testDir, "test.spec.md")
    const plugin = tapePlugin(createFileOpts({ path: testPath }))
    const exec = plugin.block(createBlockOpts("Enter"))!

    const result = await exec("Enter")
    expect(result).not.toBeNull()
    expect(result!.exitCode).toBe(0)
    expect(result!.stdout).toContain("Key: Enter")
  })

  test("Sleep command is a no-op (logged but no delay)", async () => {
    const testPath = join(testDir, "test.spec.md")
    const plugin = tapePlugin(createFileOpts({ path: testPath }))
    const exec = plugin.block(createBlockOpts("Sleep 500ms"))!

    const start = Date.now()
    const result = await exec("Sleep 500ms")
    const elapsed = Date.now() - start

    expect(result).not.toBeNull()
    expect(result!.exitCode).toBe(0)
    // Should be fast — no real sleep in headless mode
    expect(elapsed).toBeLessThan(200)
  })

  test("Ctrl+C sends control character", async () => {
    const testPath = join(testDir, "test.spec.md")
    const plugin = tapePlugin(createFileOpts({ path: testPath }))
    const exec = plugin.block(createBlockOpts("Ctrl+C"))!

    const result = await exec("Ctrl+C")
    expect(result).not.toBeNull()
    expect(result!.exitCode).toBe(0)
    expect(result!.stdout).toContain("Ctrl+C")
  })

  test("multiple commands execute in sequence", async () => {
    const testPath = join(testDir, "test.spec.md")
    const plugin = tapePlugin(createFileOpts({ path: testPath }))
    const content = 'Type "hello"\nEnter\nType "world"'
    const exec = plugin.block(createBlockOpts(content))!

    const result = await exec(content)
    expect(result).not.toBeNull()
    expect(result!.exitCode).toBe(0)
    expect(result!.stdout).toContain("Typed: hello")
    expect(result!.stdout).toContain("Key: Enter")
    expect(result!.stdout).toContain("Typed: world")
  })

  test("Set Width/Height resizes terminal", async () => {
    const testPath = join(testDir, "test.spec.md")
    const plugin = tapePlugin(createFileOpts({ path: testPath }))
    const content = "Set Width 120\nSet Height 40"
    const exec = plugin.block(createBlockOpts(content))!

    const result = await exec(content)
    expect(result).not.toBeNull()
    expect(result!.exitCode).toBe(0)
    expect(result!.stdout).toContain("Set Width 120")
    expect(result!.stdout).toContain("Set Height 40")
  })

  test("comments and blank lines are ignored", async () => {
    const testPath = join(testDir, "test.spec.md")
    const plugin = tapePlugin(createFileOpts({ path: testPath }))
    const content = '# This is a comment\n\nType "hello"\n\n# Another comment'
    const exec = plugin.block(createBlockOpts(content))!

    const result = await exec(content)
    expect(result).not.toBeNull()
    expect(result!.exitCode).toBe(0)
    expect(result!.stdout).toBe("Typed: hello")
  })
})

// ── Screenshot generation ──

describe("tape screenshots", () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "mdspec-tape-snap-"))
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test("Screenshot saves SVG as reference on first run", async () => {
    const testPath = join(testDir, "test.spec.md")
    const plugin = tapePlugin(createFileOpts({ path: testPath }))
    const content = 'Type "hello"\nScreenshot'
    const exec = plugin.block(createBlockOpts(content))!

    const result = await exec(content)
    expect(result).not.toBeNull()
    expect(result!.exitCode).toBe(0)
    expect(result!.stdout).toContain("(saved as reference)")

    // Check the snapshot was created
    const snapDir = join(testDir, "__snapshots__", "test")
    expect(existsSync(snapDir)).toBe(true)

    const files = readdirSync(snapDir)
    expect(files.length).toBe(1)
    expect(files[0]).toMatch(/\.svg$/)
  })

  test("Screenshot with custom name uses that name", async () => {
    const testPath = join(testDir, "test.spec.md")
    const plugin = tapePlugin(createFileOpts({ path: testPath }))
    const content = 'Type "hello"\nScreenshot my-demo'
    const exec = plugin.block(createBlockOpts(content))!

    const result = await exec(content)
    expect(result).not.toBeNull()
    expect(result!.exitCode).toBe(0)

    const snapDir = join(testDir, "__snapshots__", "test")
    const files = readdirSync(snapDir)
    expect(files).toContain("my-demo.svg")
  })

  test("Screenshot matches reference on re-run with same input", async () => {
    const testPath = join(testDir, "test.spec.md")

    // First run — creates reference
    const plugin1 = tapePlugin(createFileOpts({ path: testPath }))
    const content = 'Type "hello"\nScreenshot'
    const exec1 = plugin1.block(createBlockOpts(content))!
    await exec1(content)

    // Second run — should match
    const plugin2 = tapePlugin(createFileOpts({ path: testPath }))
    const exec2 = plugin2.block(createBlockOpts(content))!
    const result = await exec2(content)

    expect(result).not.toBeNull()
    expect(result!.exitCode).toBe(0)
    expect(result!.stdout).toContain("(match)")
  })

  test("Screenshot detects visual regression with different input", async () => {
    const testPath = join(testDir, "test.spec.md")

    // First run — creates reference with "hello"
    const plugin1 = tapePlugin(createFileOpts({ path: testPath }))
    const content1 = 'Type "hello"\nScreenshot'
    const exec1 = plugin1.block(createBlockOpts(content1))!
    await exec1(content1)

    // Second run — different content should mismatch
    const plugin2 = tapePlugin(createFileOpts({ path: testPath }))
    const content2 = 'Type "goodbye"\nScreenshot'
    const exec2 = plugin2.block(createBlockOpts(content2))!
    const result = await exec2(content2)

    expect(result).not.toBeNull()
    expect(result!.exitCode).toBe(1)
    expect(result!.stderr).toContain("Visual regression detected")

    // Should have saved .actual.svg for inspection
    const snapDir = join(testDir, "__snapshots__", "test")
    const files = readdirSync(snapDir)
    expect(files.some((f) => f.endsWith(".actual.svg"))).toBe(true)
  })

  test("multiple screenshots get sequential names", async () => {
    const testPath = join(testDir, "test.spec.md")
    const plugin = tapePlugin(createFileOpts({ path: testPath }))
    const content = 'Type "first"\nScreenshot\nType "second"\nScreenshot'
    const exec = plugin.block(createBlockOpts(content))!

    const result = await exec(content)
    expect(result).not.toBeNull()
    expect(result!.exitCode).toBe(0)

    const snapDir = join(testDir, "__snapshots__", "test")
    const files = readdirSync(snapDir).sort()
    expect(files.length).toBe(2)
    expect(files[0]).toMatch(/01\.svg$/)
    expect(files[1]).toMatch(/02\.svg$/)
  })

  test("SVG output contains valid SVG content", async () => {
    const testPath = join(testDir, "test.spec.md")
    const plugin = tapePlugin(createFileOpts({ path: testPath }))
    const content = 'Type "hello"\nScreenshot my-check'
    const exec = plugin.block(createBlockOpts(content))!
    await exec(content)

    const snapDir = join(testDir, "__snapshots__", "test")
    const svg = readFileSync(join(snapDir, "my-check.svg"), "utf8")
    expect(svg).toContain("<svg")
    expect(svg).toContain("</svg>")
    expect(svg).toContain("hello")
  })
})

// ── Fence options ──

describe("tape fence options", () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "mdspec-tape-opts-"))
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test("cols/rows fence options override terminal size", async () => {
    const testPath = join(testDir, "test.spec.md")
    const plugin = tapePlugin(createFileOpts({ path: testPath }))
    const content = 'Type "hello"\nScreenshot size-test'
    const exec = plugin.block(createBlockOpts(content, { cols: 120, rows: 30 }))!
    await exec(content)

    const snapDir = join(testDir, "__snapshots__", "test")
    const svg = readFileSync(join(snapDir, "size-test.svg"), "utf8")
    // SVG dimensions should reflect 120 cols
    expect(svg).toContain("<svg")
    // With default cell width of 8.4, 120 cols = 1008 width
    expect(svg).toMatch(/width="1008"/)
  })

  test("heading slug is used in screenshot names", async () => {
    const testPath = join(testDir, "test.spec.md")
    const plugin = tapePlugin(createFileOpts({ path: testPath }))
    const content = 'Type "hello"\nScreenshot'
    const exec = plugin.block(createBlockOpts(content, { heading: ["My Demo Test"] }))!
    await exec(content)

    const snapDir = join(testDir, "__snapshots__", "test")
    const files = readdirSync(snapDir)
    // The heading "My Demo Test" should be slugified in the filename
    expect(files[0]).toContain("my-demo-test")
  })
})

// ── Integration with shared.ts (language filter) ──

describe("tape language filter", () => {
  test("PLUGIN_LANGUAGES has tape entry", async () => {
    const { PLUGIN_LANGUAGES } = await import("../src/loader")
    expect(PLUGIN_LANGUAGES.tape).toEqual(["tape"])
  })

  test("PLUGIN_LANGUAGES has bash entries", async () => {
    const { PLUGIN_LANGUAGES } = await import("../src/loader")
    expect(PLUGIN_LANGUAGES.bash).toEqual(["console", "sh", "bash"])
    expect(PLUGIN_LANGUAGES.sh).toEqual(["console", "sh", "bash"])
  })
})

// ── PluginExecutor handles tape blocks ──

describe("PluginExecutor with tape", () => {
  let testDir: string

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "mdspec-tape-exec-"))
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  test("tape blocks pass content directly (no $ extraction)", async () => {
    const { PluginExecutor } = await import("../src/plugin-executor")
    const { parseMarkdown } = await import("../src/markdown")

    const md = `---
mdspec:
  plugin: tape
---

# Demo

\`\`\`tape
Type "hello"
Enter
\`\`\`
`
    const testPath = join(testDir, "test.spec.md")
    writeFileSync(testPath, md)

    const executor = new PluginExecutor(testPath, md)
    const { codeBlocks } = parseMarkdown(md)
    await executor.initialize(codeBlocks)

    const result = await executor.executeBlock({ lang: "tape", info: "", text: 'Type "hello"\nEnter' }, null)

    expect(result).not.toBeNull()
    expect(result!.exitCode).toBe(0)
    expect(result!.results.length).toBe(1)
    expect(result!.results[0]!.stdout).toContain("Typed: hello")
    expect(result!.results[0]!.stdout).toContain("Key: Enter")
  })
})
