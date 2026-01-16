// Markdown parsing utilities using unified/remark
import { unified } from "unified";
import remarkParse from "remark-parse";
import { toString } from "mdast-util-to-string";
import GithubSlugger from "github-slugger";
import type { Root, Heading as MdastHeading, Code } from "mdast";

export type Heading = {
  text: string;
  position: { line: number; column: number; offset?: number };
  slug: string; // Slug with dashes replaced by spaces for readability
  depth: number;
  parent?: Heading; // Parent heading in hierarchy
};

export type CodeBlock = {
  lang: string | null;
  position: {
    start: { line: number; column: number; offset?: number };
    end: { line: number; column: number; offset?: number };
  };
  value: string;
  meta: string | null;
  filename?: string; // Parsed from meta (e.g., "helpers.sh" from file=helpers.sh)
};

export type MarkdownStructure = {
  headings: Heading[];
  codeBlocks: CodeBlock[];
};

/**
 * Parse markdown into AST and extract headings and code blocks
 */
export function parseMarkdown(md: string): MarkdownStructure {
  const tree = unified().use(remarkParse).parse(md) as Root;
  const slugger = new GithubSlugger();
  const headings: Heading[] = [];
  const codeBlocks: CodeBlock[] = [];

  // Walk the AST
  visit(tree, (node) => {
    if (node.type === "heading") {
      const heading = node as MdastHeading;
      const text = toString(heading);
      const rawSlug = slugger.slug(text);
      // Remove dashes and normalize spaces: "1-initialize-repo" -> "1 initialize repo"
      const slug = rawSlug.replace(/-/g, " ").replace(/\s+/g, " ").trim();
      headings.push({
        text,
        slug,
        depth: heading.depth,
        position: heading.position?.start ?? { line: 0, column: 0, offset: 0 },
      });
    } else if (node.type === "code") {
      const code = node as Code;
      // Parse filename from meta: "file=helpers.sh" -> "helpers.sh"
      const filename = code.meta?.match(/file=(\S+)/)?.[1];
      codeBlocks.push({
        lang: code.lang ?? null,
        value: code.value,
        meta: code.meta ?? null,
        filename,
        position: {
          start: code.position?.start ?? { line: 0, column: 0, offset: 0 },
          end: code.position?.end ?? { line: 0, column: 0, offset: 0 },
        },
      });
    }
  });

  // Sort by position for deterministic order
  headings.sort(
    (a, b) =>
      a.position.line - b.position.line ||
      a.position.column - b.position.column,
  );
  codeBlocks.sort(
    (a, b) =>
      a.position.start.line - b.position.start.line ||
      a.position.start.column - b.position.start.column,
  );

  // Build parent links for hierarchical navigation
  buildParentLinks(headings);

  return { headings, codeBlocks };
}

/**
 * Find the nearest heading before a given position
 */
export function findNearestHeading(
  headings: Heading[],
  pos: { line: number; column: number },
): Heading | null {
  let nearest: Heading | null = null;
  for (const h of headings) {
    if (isBefore(h.position, pos)) nearest = h;
    else break;
  }
  return nearest;
}

/**
 * Generate a unique test identifier for a code block
 * Handles multiple blocks under the same heading by adding a counter
 */
export function generateTestId(
  heading: Heading | null,
  blockIndex: number,
  headingBlockCounts: Map<string, number>,
): string {
  if (!heading) return `block-${blockIndex + 1}`;

  const slug = heading.slug;
  const count = headingBlockCounts.get(slug) || 0;
  headingBlockCounts.set(slug, count + 1);

  // If multiple blocks under same heading, append counter
  if (count > 0) return `${slug}-${count + 1}`;

  return slug;
}

// ============ Helpers ============

/**
 * Compare two positions (line/column)
 * Returns true if position a comes before position b
 */
function isBefore(
  a: { line: number; column: number },
  b: { line: number; column: number },
): boolean {
  return a.line < b.line || (a.line === b.line && a.column <= b.column);
}

interface AstNode {
  type: string;
  children?: AstNode[];
}

/**
 * Simple AST visitor - walks all nodes depth-first
 */
function visit(node: AstNode, callback: (node: AstNode) => void) {
  callback(node);
  if (node.children) for (const child of node.children) visit(child, callback);
}

/**
 * Build parent links for headings using a depth-based stack
 * This enables O(1) ancestor lookup instead of O(n) scanning
 */
function buildParentLinks(headings: Heading[]): void {
  const stack: Heading[] = [];

  for (const heading of headings) {
    // Pop stack until we find a higher-level heading (lower depth number)
    while (stack.length > 0 && stack[stack.length - 1].depth >= heading.depth) {
      stack.pop();
    }

    // Top of stack is the parent (if any)
    if (stack.length > 0) heading.parent = stack[stack.length - 1];

    // Push current heading onto stack
    stack.push(heading);
  }
}
