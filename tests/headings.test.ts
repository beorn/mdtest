// Test that mdtest properly parses and associates headings with code blocks
import { describe, test, expect } from "vitest";
import { parseMarkdown, findNearestHeading } from "../src/markdown.js";

describe("markdown heading parsing", () => {
  test("parses headings with correct depth", () => {
    const md = `
# Title

## Section 1

Some text

### Subsection 1.1

More text
`;
    const { headings } = parseMarkdown(md);

    expect(headings).toHaveLength(3);
    expect(headings[0]!.text).toBe("Title");
    expect(headings[0]!.depth).toBe(1);
    expect(headings[1]!.text).toBe("Section 1");
    expect(headings[1]!.depth).toBe(2);
    expect(headings[2]!.text).toBe("Subsection 1.1");
    expect(headings[2]!.depth).toBe(3);
  });

  test("findNearestHeading returns correct heading for code block", () => {
    const md = `
# Title

## Section 1

\`\`\`console
$ echo "test 1"
\`\`\`

## Section 2

\`\`\`console
$ echo "test 2"
\`\`\`
`;
    const { headings, codeBlocks } = parseMarkdown(md);

    expect(headings).toHaveLength(3);
    expect(codeBlocks).toHaveLength(2);

    // First code block should be under "Section 1"
    const heading1 = findNearestHeading(
      headings,
      codeBlocks[0]!.position.start,
    );
    expect(heading1).not.toBeNull();
    expect(heading1?.text).toBe("Section 1");

    // Second code block should be under "Section 2"
    const heading2 = findNearestHeading(
      headings,
      codeBlocks[1]!.position.start,
    );
    expect(heading2).not.toBeNull();
    expect(heading2?.text).toBe("Section 2");
  });

  test("findNearestHeading handles code blocks before any heading", () => {
    const md = `
Some intro text

\`\`\`console
$ echo "test"
\`\`\`

## First Heading
`;
    const { headings, codeBlocks } = parseMarkdown(md);

    expect(codeBlocks).toHaveLength(1);
    const heading = findNearestHeading(headings, codeBlocks[0]!.position.start);
    expect(heading).toBeNull();
  });

  test("code blocks after horizontal rules associate with correct heading", () => {
    const md = `
## Setup

\`\`\`console
$ echo "setup"
\`\`\`

---

## Section 1

\`\`\`console
$ echo "section 1"
\`\`\`
`;
    const { headings, codeBlocks } = parseMarkdown(md);

    expect(headings).toHaveLength(2);
    expect(codeBlocks).toHaveLength(2);

    // First code block under "Setup"
    const heading1 = findNearestHeading(
      headings,
      codeBlocks[0]!.position.start,
    );
    expect(heading1?.text).toBe("Setup");

    // Second code block under "Section 1" (after horizontal rule)
    const heading2 = findNearestHeading(
      headings,
      codeBlocks[1]!.position.start,
    );
    expect(heading2?.text).toBe("Section 1");
  });
});
