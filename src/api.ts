// Public API for mdtest - used by integrations and standalone CLI

export interface BlockOptions {
  exit?: number;
  cwd?: string;
  env?: Record<string, string>;
  reset?: boolean;
  timeout?: number; // Timeout in milliseconds (default: 30000ms / 30s)
}

export interface MdTestOptions {
  update?: boolean;
  format?: "default" | "compact" | "tap";
  useHeadings?: boolean; // true = show full headings, false = slugs
  showCommandPrefix?: boolean; // true = include $ in output
  serial?: boolean; // Always true for now (future: concurrent)
  timeout?: number; // Per-command timeout (ms)
  verbose?: boolean; // Show all output
  quiet?: boolean; // Suppress passing test output
}

export interface CommandResult {
  command: string;
  displayName: string; // Includes $ prefix if enabled
  passed: boolean;
  duration: number; // milliseconds
  stdout: string[];
  stderr: string[];
  exitCode: number;
  expected?: {
    stdout: string[];
    stderr: string[];
    exitCode: number;
  };
  diff?: string; // Human-readable diff if failed
}

export interface HeadingResult {
  level: number;
  title: string;
  slug: string;
  path: string[]; // Hierarchical path: ['kimmi', 'import']
  commands: CommandResult[];
}

export interface FileResult {
  path: string;
  headings: HeadingResult[];
  totalCommands: number;
  passedCommands: number;
  duration: number;
}

// Core execution API (to be implemented)
export async function runMdTestFile(
  _file: string,
  _options?: MdTestOptions,
): Promise<FileResult> {
  throw new Error("Not implemented yet - will be implemented in next phase");
}

export async function runMdTests(
  files: string[],
  options?: MdTestOptions,
): Promise<FileResult[]> {
  const results: FileResult[] = [];

  for (const file of files) {
    const result = await runMdTestFile(file, options);
    results.push(result);
  }

  return results;
}
