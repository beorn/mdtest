// Plugin system types for mdtest

/**
 * Result of executing a single command
 */
export interface ReplResult {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * File-level options passed to plugin factory
 * Includes all frontmatter options and collected file= blocks
 */
export interface FileOpts {
  /** Absolute path to the .test.md file */
  path: string
  /** All file= blocks: filename → content */
  files: Map<string, string>
  /** Frontmatter options (excluding 'plugin' field) */
  [key: string]: unknown
}

/**
 * Block-level options passed to plugin.block()
 * Pre-merged: frontmatter + section + fence options
 */
export interface BlockOpts {
  /** Block language: console, sh, bash, json, etc. */
  type: string
  /** Raw block content */
  content: string
  /** Heading path: ['Setup', 'Basic'] */
  heading: string[]
  /** If file="...", the filename (block already added to files) */
  file?: string
  /** Pre-merged options from all levels */
  [key: string]: unknown
}

/**
 * Function to execute a single command
 * Returns stdout, stderr, and exit code
 * Return null to indicate "not handled" (falls back to next handler)
 */
export type ExecFn = (cmd: string) => Promise<ReplResult | null>

/**
 * Plugin interface for custom command execution
 */
export interface Plugin {
  /**
   * Called for each code block
   * Return ExecFn to handle block, null to skip (file= blocks, unsupported types)
   */
  block(opts: BlockOpts): ExecFn | null

  /** Optional lifecycle hooks */
  beforeAll?(): Promise<void>
  afterAll?(): Promise<void>
  beforeEach?(): Promise<void>
  afterEach?(): Promise<void>
}

/**
 * Plugin factory function
 * Takes file-level options, returns plugin instance
 */
export type PluginFactory = (opts: FileOpts) => Plugin | Promise<Plugin>
