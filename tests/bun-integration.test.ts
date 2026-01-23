// Integration tests: Verify bun test integration behavior
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, unlinkSync, mkdtempSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { $ } from "bun";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mdtestCli = join(__dirname, "../src/index.ts");

describe("bun integration", () => {
  describe("error output formatting", () => {
    let tempFile: string;
    let tempDir: string;

    beforeAll(() => {
      tempDir = mkdtempSync(join(tmpdir(), "mdtest-error-test-"));
      tempFile = join(tempDir, "test-error.md");

      // Create a test markdown file that will fail
      const testContent = `
# Test Error Output

## Failing Test

\`\`\`console
$ echo "hello"
goodbye
\`\`\`
`;
      writeFileSync(tempFile, testContent, "utf8");
    });

    afterAll(() => {
      try {
        unlinkSync(tempFile);
      } catch {}
    });

    test("error output should be clean without stack traces", async () => {
      // Run mdtest on the failing test file and capture both stdout and stderr
      const proc = Bun.spawn(["bun", mdtestCli, tempFile], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      const result = stdout + stderr;

      // Should show expected/actual diff
      expect(result).toContain("expected");
      expect(result).toContain("actual");

      // Should show the failing test content
      expect(result).toContain("hello");
      expect(result).toContain("goodbye");

      // Should NOT contain raw stack traces from internal code
      // (Some path info is acceptable in test output, but not internal stack frames)
      expect(result).not.toContain("at processTicksAndRejections");
    });
  });

  describe("heading hierarchy", () => {
    let tempFile: string;
    let tempDir: string;

    beforeAll(() => {
      tempDir = mkdtempSync(join(tmpdir(), "mdtest-heading-test-"));
      tempFile = join(tempDir, "test.md");

      // Create a test markdown file with clear heading structure
      const testContent = `
# Test File

## Setup

\`\`\`console
$ echo "setup"
setup
\`\`\`

## Section A

\`\`\`console
$ echo "test A"
test A
\`\`\`

### Subsection A.1

\`\`\`console
$ echo "test A.1"
test A.1
\`\`\`

## Section B

\`\`\`console
$ echo "test B"
test B
\`\`\`
`;
      writeFileSync(tempFile, testContent, "utf8");
    });

    afterAll(() => {
      try {
        unlinkSync(tempFile);
      } catch {}
    });

    test("verify describe block nesting matches heading hierarchy", async () => {
      // Run mdtest on the test file and check output shows proper heading hierarchy
      const result = await $`bun ${mdtestCli} ${tempFile}`
        .nothrow()
        .quiet()
        .text();

      // Should show proper heading structure in output
      expect(result).toContain("Setup");
      expect(result).toContain("Section A");
      expect(result).toContain("Subsection A.1");
      expect(result).toContain("Section B");

      // All tests should pass (output contains checkmarks or success indicator)
      expect(result).toContain("✓");
      // Should NOT show "(no heading)" - that indicates broken heading detection
      expect(result).not.toContain("(no heading)");
    });
  });
});
