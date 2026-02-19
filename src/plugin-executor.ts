// Plugin execution wrapper for mdtest
// Bridges between old block execution and new plugin system

import type { Plugin, FileOpts, BlockOpts, ReplResult } from "./types.js"
import { loadPlugin } from "./loader.js"
import { parseFrontmatter, mergeOptions, parseHeadingOptions } from "./options.js"
import { parseInfo } from "./core.js"
import type { Heading, CodeBlock } from "./markdown.js"

/**
 * Plugin-based file executor
 * Manages plugin lifecycle for a single test file
 */
export class PluginExecutor {
  private plugin: Plugin | null = null
  private frontmatterOpts: Record<string, unknown> = {}

  constructor(
    private testFilePath: string,
    private markdown: string,
  ) {}

  /**
   * Initialize plugin from frontmatter
   */
  async initialize(codeBlocks: CodeBlock[]): Promise<void> {
    // Parse frontmatter
    this.frontmatterOpts = parseFrontmatter(this.markdown)

    // Collect file= blocks
    const files = new Map<string, string>()
    for (const block of codeBlocks) {
      if (block.filename) {
        files.set(block.filename, block.value)
      }
    }

    // Load plugin (defaults to bash)
    const pluginSpecifier = (this.frontmatterOpts.plugin as string) ?? "bash"
    const factory = await loadPlugin(pluginSpecifier, this.testFilePath)

    // Create plugin instance
    const fileOpts: FileOpts = {
      path: this.testFilePath,
      files,
      ...this.frontmatterOpts,
    }

    this.plugin = await factory(fileOpts)
  }

  /**
   * Execute a code block using the plugin
   * Returns null if plugin doesn't handle this block
   */
  async executeBlock(
    block: { lang: string; info: string; text: string },
    heading: Heading | null,
  ): Promise<{
    results: Array<{ command: string; stdout: string[]; stderr: string[] }>
    exitCode: number
  } | null> {
    if (!this.plugin) {
      throw new Error("PluginExecutor not initialized - call initialize() first")
    }

    // Parse block fence options
    const fenceOptsParsed = parseInfo(block.info)
    const fenceOpts: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(fenceOptsParsed)) {
      fenceOpts[key] = value
    }

    // Parse heading options if present
    const headingOpts = heading ? parseHeadingOptions(heading.text) : {}

    // Merge options: frontmatter → heading → fence
    const merged = mergeOptions(this.frontmatterOpts, headingOpts, fenceOpts)

    // Build BlockOpts
    const blockOpts: BlockOpts = {
      type: block.lang,
      content: block.text,
      heading: heading ? this.buildHeadingPath(heading) : [],
      ...merged,
    }

    // Get execution function from plugin
    const exec = this.plugin.block(blockOpts)

    // Plugin doesn't handle this block (file= block or unsupported type)
    if (!exec) return null

    // Parse commands from block
    const commands = this.extractCommands(block.text)

    // Execute each command
    const results: Array<{
      command: string
      stdout: string[]
      stderr: string[]
    }> = []
    let lastExitCode = 0

    for (const cmd of commands) {
      const result = await exec(cmd)
      // null result means "not handled" - skip this command
      if (result === null) {
        continue
      }
      results.push({
        command: cmd,
        stdout: result.stdout ? result.stdout.split("\n").filter((l) => l !== "") : [],
        stderr: result.stderr ? result.stderr.split("\n").filter((l) => l !== "") : [],
      })
      lastExitCode = result.exitCode
    }

    return {
      results,
      exitCode: lastExitCode,
    }
  }

  /**
   * Call beforeAll hook
   */
  async beforeAll(): Promise<void> {
    if (this.plugin?.beforeAll) {
      await this.plugin.beforeAll()
    }
  }

  /**
   * Call afterAll hook
   */
  async afterAll(): Promise<void> {
    if (this.plugin?.afterAll) {
      await this.plugin.afterAll()
    }
  }

  /**
   * Call beforeEach hook
   */
  async beforeEach(): Promise<void> {
    if (this.plugin?.beforeEach) {
      await this.plugin.beforeEach()
    }
  }

  /**
   * Call afterEach hook
   */
  async afterEach(): Promise<void> {
    if (this.plugin?.afterEach) {
      await this.plugin.afterEach()
    }
  }

  /**
   * Build hierarchical heading path
   */
  private buildHeadingPath(heading: Heading): string[] {
    const path: string[] = []
    let current: Heading | undefined = heading
    while (current) {
      path.unshift(current.text)
      current = current.parent
    }
    return path
  }

  /**
   * Extract commands from block text
   * Filters out continuations and empty lines
   */
  private extractCommands(text: string): string[] {
    const commands: string[] = []
    let currentCommand: string[] = []

    for (const line of text.split("\n")) {
      if (line.startsWith("$")) {
        // New command - save previous if exists
        if (currentCommand.length > 0) {
          commands.push(currentCommand.join("\n"))
          currentCommand = []
        }
        // Add command without $ prefix
        currentCommand.push(line.slice(1).trimStart())
      } else if (line.startsWith(">")) {
        // Continuation line
        currentCommand.push(line.slice(1).trimStart())
      }
      // Ignore expected output lines and blank lines
    }

    // Add final command if exists
    if (currentCommand.length > 0) {
      commands.push(currentCommand.join("\n"))
    }

    return commands
  }
}
