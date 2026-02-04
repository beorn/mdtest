import { describe, test, expect } from "vitest"
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { $ } from "bun"
import {
  parseInfo,
  parseBlock,
  splitNorm,
  matchLines,
  hasPatterns,
  compileExpectedLineToRegex,
} from "../src/core"
import { parseMarkdown } from "../src/markdown"

const MDTEST = join(import.meta.dirname, "../src/index.ts")

// ============ Helpers ============

function mkBlock(code: string, info = ""): string {
  return `\`\`\`console${info ? " " + info : ""}\n${code}\n\`\`\``
}

function createTestFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mdtest-test-"))
  const file = join(dir, "test.md")
  writeFileSync(file, `# Test\n${content}`)
  return file
}

async function runMdtest(file: string, args: string[] = []) {
  return await $`bun ${MDTEST} ${args} ${file}`.nothrow().quiet()
}

// ============ Parsing Tests ============

describe("parsing", () => {
  describe("fences", () => {
    test("console", () => {
      const md = "# Test\n```console\n$ echo hi\nhi\n```\n"
      const { codeBlocks } = parseMarkdown(md)
      const fences = codeBlocks.filter(
        (b) => b.lang === "console" || b.lang === "sh",
      )
      expect(fences).toHaveLength(1)
      expect(fences[0]!.lang).toBe("console")
      expect(fences[0]!.value).toBe("$ echo hi\nhi")
    })

    test("sh", () => {
      const md = "```sh\n$ pwd\n/tmp\n```"
      const { codeBlocks } = parseMarkdown(md)
      const fences = codeBlocks.filter(
        (b) => b.lang === "console" || b.lang === "sh",
      )
      expect(fences[0]!.lang).toBe("sh")
    })

    test("multiple", () => {
      const md = "```console\n$ echo 1\n```\ntext\n```console\n$ echo 2\n```"
      const { codeBlocks } = parseMarkdown(md)
      const fences = codeBlocks.filter(
        (b) => b.lang === "console" || b.lang === "sh",
      )
      expect(fences).toHaveLength(2)
    })

    test("with info", () => {
      const md = "```console exit=1 cwd=/tmp\n$ false\n```"
      const { codeBlocks } = parseMarkdown(md)
      const fences = codeBlocks.filter(
        (b) => b.lang === "console" || b.lang === "sh",
      )
      expect(fences[0]!.meta).toBe("exit=1 cwd=/tmp")
    })

    test("ignores non-shell", () => {
      const md = "```javascript\nconst x = 1\n```\n```console\n$ echo\n```"
      const { codeBlocks } = parseMarkdown(md)
      const fences = codeBlocks.filter(
        (b) => b.lang === "console" || b.lang === "sh",
      )
      expect(fences).toHaveLength(1)
      expect(fences[0]!.lang).toBe("console")
    })
  })

  describe("info", () => {
    test("empty", () => {
      const opts = parseInfo("")
      expect(opts).toEqual({})
    })

    test("exit", () => {
      const opts = parseInfo("exit=1")
      expect(opts.exit).toBe(1)
    })

    test("cwd", () => {
      const opts = parseInfo("cwd=/tmp")
      expect(opts.cwd).toBe("/tmp")
    })

    test("env", () => {
      const opts = parseInfo("env=FOO=bar,BAZ=qux")
      expect(opts.env?.FOO).toBe("bar")
    })

    test("reset", () => {
      const opts = parseInfo("reset")
      expect(opts.reset).toBe(true)
    })

    test("combined", () => {
      const opts = parseInfo("exit=1 cwd=/tmp env=FOO=bar reset")
      expect(opts.exit).toBe(1)
      expect(opts.cwd).toBe("/tmp")
      expect(opts.env).toEqual({ FOO: "bar" })
      expect(opts.reset).toBe(true)
    })
  })

  describe("block", () => {
    test("single cmd", () => {
      const { commands, expect: exp } = parseBlock("$ echo hello\nhello\n")
      expect(commands).toEqual(["echo hello"])
      expect(exp.stdout).toEqual(["hello"])
    })

    test("multiple cmds", () => {
      const { commands } = parseBlock("$ echo 1\n$ echo 2\n")
      expect(commands).toEqual(["echo 1", "echo 2"])
    })

    test("continuation", () => {
      const { commands } = parseBlock('$ echo "line 1" \\\n>   "line 2"\n')
      expect(commands).toEqual(['echo "line 1" \\\n  "line 2"'])
    })

    test("stdout", () => {
      const { expect: exp } = parseBlock(
        "$ cmd\noutput line 1\noutput line 2\n",
      )
      expect(exp.stdout).toEqual(["output line 1", "output line 2"])
    })

    test("stderr", () => {
      const { expect: exp } = parseBlock("$ cmd\n! error line\n")
      expect(exp.stderr).toEqual(["error line"])
    })

    test("exit", () => {
      const { expect: exp } = parseBlock("$ false\n[1]\n")
      expect(exp.exit).toBe(1)
    })

    test("combined", () => {
      const { commands, expect: exp } = parseBlock("$ cmd\nout\n! err\n[2]\n")
      expect(commands).toEqual(["cmd"])
      expect(exp.stdout).toEqual(["out"])
      expect(exp.stderr).toEqual(["err"])
      expect(exp.exit).toBe(2)
    })
  })

  describe("splitNorm", () => {
    test("normalize", () => {
      const lines = splitNorm("line1  \nline2\nline3  ")
      expect(lines).toEqual(["line1", "line2", "line3"])
    })

    test("CRLF", () => {
      const lines = splitNorm("line1\r\nline2\r\n")
      expect(lines).toEqual(["line1", "line2", ""])
    })
  })
})

// ============ Matching Tests ============

describe("matching", () => {
  describe("lines", () => {
    test("exact", () => {
      const result = matchLines(["hello", "world"], ["hello", "world"], {})
      expect(result.ok).toBe(true)
    })

    test("mismatch", () => {
      const result = matchLines(["hello"], ["goodbye"], {})
      expect(result.ok).toBe(false)
      expect(result.msg).toContain("mismatch")
    })

    test("extra", () => {
      const result = matchLines(["hello"], ["hello", "extra"], {})
      expect(result.ok).toBe(false)
      expect(result.msg).toContain("extra actual lines")
    })

    test("missing", () => {
      const result = matchLines(["hello", "world"], ["hello"], {})
      expect(result.ok).toBe(false)
      expect(result.msg).toContain("missing actual line")
    })

    test("ellipsis", () => {
      const result = matchLines(
        ["start", "[...]", "end"],
        ["start", "middle1", "middle2", "end"],
        {},
      )
      expect(result.ok).toBe(true)
    })

    test("ellipsis at end", () => {
      const result = matchLines(
        ["start", "[...]"],
        ["start", "any", "thing"],
        {},
      )
      expect(result.ok).toBe(true)
    })

    test("regex", () => {
      const result = matchLines(["/\\d{4}-\\d{2}-\\d{2}/"], ["2025-10-17"], {})
      expect(result.ok).toBe(true)
    })

    test("capture wildcard", () => {
      const caps: Record<string, string> = {}
      const result = matchLines(["ID: {{id:*}}"], ["ID: ABC-123"], caps)
      expect(result.ok).toBe(true)
      expect(caps.id).toBe("ABC-123")
    })

    test("capture regex", () => {
      const caps: Record<string, string> = {}
      const result = matchLines(
        ["UUID: {{uuid:/[0-9A-F-]{36}/}}"],
        ["UUID: 123E4567-E89B-12D3-A456-426614174000"],
        caps,
      )
      expect(result.ok).toBe(true)
      expect(caps.uuid).toBe("123E4567-E89B-12D3-A456-426614174000")
    })

    test("capture reuse", () => {
      const caps: Record<string, string> = { id: "ABC-123" }
      const result = matchLines(
        ["ID again: {{id}}"],
        ["ID again: ABC-123"],
        caps,
      )
      expect(result.ok).toBe(true)
    })

    test("capture mismatch", () => {
      const caps: Record<string, string> = { id: "ABC-123" }
      const result = matchLines(
        ["ID again: {{id}}"],
        ["ID again: XYZ-789"],
        caps,
      )
      expect(result.ok).toBe(false)
      expect(result.msg).toContain("line mismatch")
    })
  })

  describe("patterns", () => {
    test("none", () => {
      expect(hasPatterns("$ echo hello\nhello\n")).toBe(false)
    })

    test("wildcard", () => {
      expect(hasPatterns("ID: {{id:*}}")).toBe(true)
    })

    test("capture", () => {
      expect(hasPatterns("{{id}}")).toBe(true)
    })

    test("ellipsis", () => {
      expect(hasPatterns("line 1\n[...]\nline 2")).toBe(true)
    })

    test("regex", () => {
      expect(hasPatterns("/\\d+/")).toBe(true)
    })
  })

  describe("regex compile", () => {
    test("literal", () => {
      const { re, keys } = compileExpectedLineToRegex("hello world", {})
      expect(re.test("hello world")).toBe(true)
      expect(re.test("hello there")).toBe(false)
      expect(keys).toEqual([])
    })

    test("regex pattern", () => {
      const { re, keys } = compileExpectedLineToRegex("/hello \\w+/", {})
      expect(re.test("hello world")).toBe(true)
      expect(re.test("hello there")).toBe(true)
      expect(re.test("goodbye world")).toBe(false)
      expect(keys).toEqual([])
    })

    test("capture first", () => {
      const { re, keys } = compileExpectedLineToRegex("ID: {{id:*}}", {})
      const match = "ID: ABC-123".match(re)
      expect(match).not.toBeNull()
      expect(match?.groups?.id).toBe("ABC-123")
      expect(keys).toEqual(["id"])
    })

    test("capture reuse", () => {
      const caps = { id: "ABC-123" }
      const { re, keys } = compileExpectedLineToRegex("ID: {{id}}", caps)
      expect(re.test("ID: ABC-123")).toBe(true)
      expect(re.test("ID: XYZ-789")).toBe(false)
      expect(keys).toEqual([])
    })

    test("capture with regex", () => {
      const { re, keys } = compileExpectedLineToRegex(
        "UUID: {{uuid:/[0-9A-F-]{36}/}}",
        {},
      )
      const match = "UUID: 123E4567-E89B-12D3-A456-426614174000".match(re)
      expect(match).not.toBeNull()
      expect(match?.groups?.uuid).toBe("123E4567-E89B-12D3-A456-426614174000")
      expect(keys).toEqual(["uuid"])
    })

    test("multiple", () => {
      const { re, keys } = compileExpectedLineToRegex("{{a:*}} and {{b:*}}", {})
      const match = "foo and bar".match(re)
      expect(match?.groups?.a).toBe("foo")
      expect(match?.groups?.b).toBe("bar")
      expect(keys).toEqual(["a", "b"])
    })

    test("escape special chars", () => {
      const { re } = compileExpectedLineToRegex("cost: $5.00", {})
      expect(re.test("cost: $5.00")).toBe(true)
      expect(re.test("cost: X5X00")).toBe(false)
    })
  })
})

// ============ CLI Integration Tests ============

describe("cli", () => {
  test.concurrent("basic exec", async () => {
    const file = createTestFile(mkBlock('$ echo "Hello"\nHello'))
    const result = await runMdtest(file)
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toContain("✅")
    expect(result.stdout.toString()).toContain("1 block(s), 0 failed")
  })

  test.concurrent("mismatch", async () => {
    const file = createTestFile(mkBlock('$ echo "Hello"\nGoodbye'))
    const result = await runMdtest(file)
    expect(result.exitCode).toBe(1)
    expect(result.stderr.toString()).toContain("✗")
    expect(result.stderr.toString()).toContain("Mismatch in stdout")
  })

  test.concurrent("persistent context", async () => {
    const file = createTestFile(
      mkBlock("$ export FOO=bar\n$ export BAZ=qux") +
        "\n\n" +
        mkBlock('$ echo "$FOO-$BAZ"\nbar-qux'),
    )
    const result = await runMdtest(file)
    expect(result.exitCode).toBe(0)
  })

  test.concurrent("persistent captures", async () => {
    const file = createTestFile(
      mkBlock('$ export MY_ID=ABC-123\n$ echo "ID: $MY_ID"\nID: {{id:*}}') +
        "\n\n" +
        mkBlock('$ echo "Reuse: $MY_ID"\nReuse: {{id}}'),
    )
    const result = await runMdtest(file)
    expect(result.exitCode).toBe(0)
  })

  test.concurrent("update mode", async () => {
    const file = createTestFile(mkBlock('$ echo "Hello"\nWrong'))
    const result = await runMdtest(file, ["--update"])
    expect(result.exitCode).toBe(1)

    const updated = readFileSync(file, "utf8")
    expect(updated).toContain("Hello")
    expect(updated).not.toContain("Wrong")
  })

  test.concurrent("update preserves patterns", async () => {
    const file = createTestFile(mkBlock('$ echo "ID: ABC-123"\nID: {{id:*}}'))
    const result = await runMdtest(file, ["--update"])
    expect(result.exitCode).toBe(0)

    const updated = readFileSync(file, "utf8")
    expect(updated).toContain("{{id:*}}")
  })

  test.concurrent("regex", async () => {
    const file = createTestFile(
      mkBlock('$ date +"%Y-%m-%d"\n/\\d{4}-\\d{2}-\\d{2}/'),
    )
    const result = await runMdtest(file)
    expect(result.exitCode).toBe(0)
  })

  test.concurrent("ellipsis", async () => {
    const file = createTestFile(
      mkBlock('$ echo -e "Line 1\\nLine 2\\nLine 3"\nLine 1\n[...]\nLine 3'),
    )
    const result = await runMdtest(file)
    expect(result.exitCode).toBe(0)
  })

  test.concurrent("beforeAll hook", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mdtest-test-"))
    const file = join(dir, "test.md")
    const counterFile = join(dir, "counter.txt")
    writeFileSync(
      file,
      `# Test\n` +
        mkBlock(`$ beforeAll() {\n>   echo "0" > ${counterFile}\n> }`) +
        "\n\n" +
        mkBlock(
          `$ echo "$(( $(cat ${counterFile}) + 1 ))" > ${counterFile}\n$ cat ${counterFile}\n1`,
        ) +
        "\n\n" +
        mkBlock(
          `$ echo "$(( $(cat ${counterFile}) + 1 ))" > ${counterFile}\n$ cat ${counterFile}\n2`,
        ),
    )
    const result = await runMdtest(file)
    expect(result.exitCode).toBe(0)
    expect(readFileSync(counterFile, "utf8").trim()).toBe("2")
  })

  test.concurrent("exit code", async () => {
    const file = createTestFile(mkBlock("$ false\n[1]", "exit=1"))
    const result = await runMdtest(file)
    expect(result.exitCode).toBe(0)
  })

  test.concurrent("stderr", async () => {
    const file = createTestFile(
      mkBlock('$ echo "error message" >&2\n! error message'),
    )
    const result = await runMdtest(file)
    expect(result.exitCode).toBe(0)
  })
})
