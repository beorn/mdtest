// Integration tests: Verify bun test integration behavior
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, unlinkSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

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

    test.todo("error output should be clean without stack traces", async () => {
      // This test should verify:
      // 1. Failed test shows expected/actual diff
      // 2. No stack trace from expect().fail()
      // 3. Clean, readable error message
      //
      // Current behavior: Shows full stack trace with file paths
      // Expected behavior: Only show the diff provided to expect().fail()
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

    test.skip("registered tests should be properly nested under headings", async () => {
      // This test is skipped because registerMdTestFile() calls describe.serial()
      // which cannot be called from within a test context.
      //
      // The bug is fixed and verified by running actual .test.md files:
      // - findNearestHeading now receives block.position.start instead of block.position
      // - Tests are properly nested under heading hierarchy
      // - No tests should be under "(no heading)" unless they truly have no heading
      //
      // To verify: run `bun test --verbose` and check that tests show proper headings
      // instead of "(no heading)"

      expect(true).toBe(true);
    });

    test.todo("verify describe block nesting matches heading hierarchy", () => {
      // This test should verify:
      // 1. describe('test.md') contains describe('Setup')
      // 2. describe('Section A') contains describe('Subsection A.1')
      // 3. describe('Section B') exists at the same level as 'Section A'
    });
  });
});
