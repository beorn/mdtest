// Options parsing and merging for mdtest plugin system

import { parseInfo } from "./core.js";

/**
 * Parse YAML frontmatter from markdown
 * Returns the mdtest section (or empty object if no frontmatter)
 */
export function parseFrontmatter(markdown: string): Record<string, unknown> {
  const frontmatterMatch = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return {};

  const yaml = frontmatterMatch[1];
  if (!yaml) return {};

  // Simple YAML parser for mdtest section
  // Format: mdtest:\n  key: value
  const mdtestMatch = yaml.match(/mdtest:\s*\n((?:  .*\n?)*)/);
  if (!mdtestMatch) return {};

  const mdtestYaml = mdtestMatch[1];
  if (!mdtestYaml) return {};

  const opts: Record<string, unknown> = {};

  // Parse key: value pairs (indented with 2 spaces)
  for (const line of mdtestYaml.split("\n")) {
    const match = line.match(/^\s\s(\w+):\s*(.+)$/);
    if (!match) continue;

    const key = match[1];
    const value = match[2];
    if (!key || !value) continue;

    // Parse value (string, number, boolean, or multiline)
    if (value === "true") opts[key] = true;
    else if (value === "false") opts[key] = false;
    else if (/^\d+$/.test(value)) opts[key] = parseInt(value, 10);
    else if (value.startsWith("|")) {
      // Multiline string - collect following indented lines
      opts[key] = value; // Store as-is for now (needs proper multiline handling)
    } else {
      // Remove quotes if present
      opts[key] = value.replace(/^["']|["']$/g, "");
    }
  }

  return opts;
}

/**
 * Parse heading options
 * Format: ## Title {key1=value1 key2 key3=value3}
 */
export function parseHeadingOptions(
  headingText: string,
): Record<string, unknown> {
  const match = headingText.match(/\{([^}]+)\}$/);
  if (!match || !match[1]) return {};

  const optString = match[1].trim();
  const parsed = parseInfo(optString);

  // Convert BlockOptions to plain object
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    result[key] = value;
  }
  return result;
}

/**
 * Merge options from multiple levels
 * Later levels override earlier levels
 */
export function mergeOptions(
  ...optionSets: Array<Record<string, unknown>>
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};

  for (const opts of optionSets) {
    for (const [key, value] of Object.entries(opts)) {
      merged[key] = value;
    }
  }

  return merged;
}
