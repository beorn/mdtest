import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { shellEscape, buildScript, buildHookScript } from "../src/shell";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("shell", () => {
  describe("shellEscape", () => {
    test("passes through safe strings unchanged", () => {
      expect(shellEscape("hello")).toBe("hello");
      expect(shellEscape("path/to/file.txt")).toBe("path/to/file.txt");
      expect(shellEscape("foo-bar_baz")).toBe("foo-bar_baz");
      expect(shellEscape("file:name")).toBe("file:name");
      expect(shellEscape("123")).toBe("123");
    });

    test("escapes strings with spaces", () => {
      expect(shellEscape("hello world")).toBe("'hello world'");
      expect(shellEscape("path/to/my file.txt")).toBe("'path/to/my file.txt'");
    });

    test("escapes strings with special shell characters", () => {
      expect(shellEscape("$HOME")).toBe("'$HOME'");
      expect(shellEscape("`whoami`")).toBe("'`whoami`'");
      expect(shellEscape("foo;bar")).toBe("'foo;bar'");
      expect(shellEscape("foo|bar")).toBe("'foo|bar'");
      expect(shellEscape("foo&bar")).toBe("'foo&bar'");
      expect(shellEscape("foo>bar")).toBe("'foo>bar'");
      expect(shellEscape("foo<bar")).toBe("'foo<bar'");
      expect(shellEscape("foo*bar")).toBe("'foo*bar'");
      expect(shellEscape("foo?bar")).toBe("'foo?bar'");
      expect(shellEscape("foo[bar]")).toBe("'foo[bar]'");
      expect(shellEscape("foo(bar)")).toBe("'foo(bar)'");
      expect(shellEscape("foo{bar}")).toBe("'foo{bar}'");
    });

    test("escapes single quotes by breaking out and escaping", () => {
      expect(shellEscape("it's")).toBe("'it'\\''s'");
      expect(shellEscape("don't")).toBe("'don'\\''t'");
      expect(shellEscape("'quoted'")).toBe("''\\''quoted'\\'''");
    });

    test("escapes double quotes", () => {
      expect(shellEscape('"quoted"')).toBe("'\"quoted\"'");
    });

    test("escapes newlines", () => {
      expect(shellEscape("line1\nline2")).toBe("'line1\nline2'");
    });

    test("escapes backslashes", () => {
      expect(shellEscape("path\\to\\file")).toBe("'path\\to\\file'");
    });

    test("handles empty string", () => {
      expect(shellEscape("")).toBe("");
    });
  });

  describe("buildScript", () => {
    let tempDir: string;
    let envFile: string;
    let cwdFile: string;
    let funcFile: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "mdtest-shell-test-"));
      envFile = join(tempDir, "test.env.sh");
      cwdFile = join(tempDir, "test.cwd.txt");
      funcFile = join(tempDir, "test.func.sh");
    });

    afterEach(() => {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    });

    test("generates script with state loading", () => {
      const script = buildScript(
        ["echo hello"],
        {},
        envFile,
        cwdFile,
        funcFile,
      );

      expect(script).toContain("set +e");
      expect(script).toContain(`if [ -f "${envFile}" ]`);
      expect(script).toContain(`if [ -f "${cwdFile}" ]`);
      expect(script).toContain(`if [ -f "${funcFile}" ]`);
    });

    test("includes commands in script", () => {
      const script = buildScript(
        ["echo hello", "echo world"],
        {},
        envFile,
        cwdFile,
        funcFile,
      );

      expect(script).toContain("echo hello");
      expect(script).toContain("echo world");
    });

    test("includes state saving at end", () => {
      const script = buildScript(
        ["echo hello"],
        {},
        envFile,
        cwdFile,
        funcFile,
      );

      expect(script).toContain("_EXIT=$?");
      expect(script).toContain(`pwd > "${cwdFile}"`);
      expect(script).toContain(`export -p`);
      expect(script).toContain(`declare -f > "${funcFile}"`);
      expect(script).toContain("exit $_EXIT");
    });

    test("applies cwd option", () => {
      const script = buildScript(
        ["pwd"],
        { cwd: "/tmp" },
        envFile,
        cwdFile,
        funcFile,
      );

      expect(script).toContain("cd /tmp");
    });

    test("escapes cwd with special characters", () => {
      const script = buildScript(
        ["pwd"],
        { cwd: "/path/with spaces" },
        envFile,
        cwdFile,
        funcFile,
      );

      expect(script).toContain("cd '/path/with spaces'");
    });

    test("applies env options", () => {
      const script = buildScript(
        ["echo $FOO"],
        { env: { FOO: "bar", BAZ: "qux" } },
        envFile,
        cwdFile,
        funcFile,
      );

      expect(script).toContain("export FOO=bar");
      expect(script).toContain("export BAZ=qux");
    });

    test("escapes env values with special characters", () => {
      const script = buildScript(
        ["echo $FOO"],
        { env: { FOO: "hello world" } },
        envFile,
        cwdFile,
        funcFile,
      );

      expect(script).toContain("export FOO='hello world'");
    });

    test("combines cwd and env options", () => {
      const script = buildScript(
        ["pwd && echo $FOO"],
        { cwd: "/tmp", env: { FOO: "bar" } },
        envFile,
        cwdFile,
        funcFile,
      );

      expect(script).toContain("cd /tmp");
      expect(script).toContain("export FOO=bar");
    });
  });

  describe("buildHookScript", () => {
    let tempDir: string;
    let envFile: string;
    let cwdFile: string;
    let funcFile: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "mdtest-hook-test-"));
      envFile = join(tempDir, "test.env.sh");
      cwdFile = join(tempDir, "test.cwd.txt");
      funcFile = join(tempDir, "test.func.sh");
    });

    afterEach(() => {
      try {
        rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    });

    test("generates script that checks for hook existence", () => {
      const script = buildHookScript("beforeAll", envFile, cwdFile, funcFile);

      expect(script).toContain("if type beforeAll");
      expect(script).toContain("beforeAll");
    });

    test("loads state files before running hook", () => {
      const script = buildHookScript("afterEach", envFile, cwdFile, funcFile);

      expect(script).toContain(`[ -f "${envFile}" ]`);
      expect(script).toContain(`[ -f "${cwdFile}" ]`);
      expect(script).toContain(`[ -f "${funcFile}" ]`);
    });

    test("saves state after running hook", () => {
      const script = buildHookScript("beforeEach", envFile, cwdFile, funcFile);

      expect(script).toContain("_EXIT=$?");
      expect(script).toContain(`pwd > "${cwdFile}"`);
      expect(script).toContain("export -p");
      expect(script).toContain(`declare -f > "${funcFile}"`);
      expect(script).toContain("exit $_EXIT");
    });

    test("works with different hook names", () => {
      const hooks = ["beforeAll", "afterAll", "beforeEach", "afterEach"];

      for (const hook of hooks) {
        const script = buildHookScript(hook, envFile, cwdFile, funcFile);
        expect(script).toContain(`if type ${hook}`);
        expect(script).toContain(`${hook}`);
      }
    });
  });
});
