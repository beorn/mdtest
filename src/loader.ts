// Plugin loader for mdspec
// Handles resolution and loading of built-in and custom plugins

import { resolve, dirname } from "node:path"
import type { PluginFactory } from "./types.js"
import { bash } from "./plugins/bash.js"

/**
 * Built-in plugins — static imports for common plugins, lazy for optional ones
 */
const BUILTIN_PLUGINS: Record<string, PluginFactory | (() => Promise<PluginFactory>)> = {
  bash,
  sh: bash, // alias
  tape: () => import("./plugins/tape.js").then((m) => m.default),
}

/**
 * Maps plugin names to the code block languages they accept.
 * Used by the test integration layer to discover which blocks to process.
 */
export const PLUGIN_LANGUAGES: Record<string, string[]> = {
  bash: ["console", "sh", "bash"],
  sh: ["console", "sh", "bash"],
  tape: ["tape"],
}

/**
 * Load a plugin by specifier
 *
 * Resolution order:
 * 1. Built-in names (bash, sh)
 * 2. Relative paths (resolve from test file dir)
 * 3. Bare specifiers (use Bun's import resolution)
 *
 * @param specifier - Plugin specifier (e.g., 'bash', './plugin.ts', '@km/cli/mdspec')
 * @param testFilePath - Absolute path to the .spec.md file (for relative resolution)
 * @returns Plugin factory function
 */
export async function loadPlugin(specifier: string, testFilePath: string): Promise<PluginFactory> {
  // Built-in plugin?
  if (specifier in BUILTIN_PLUGINS) {
    const entry = BUILTIN_PLUGINS[specifier]
    if (!entry) {
      throw new Error(`Built-in plugin ${specifier} not found`)
    }
    // Lazy loaders are zero-arg functions; PluginFactory takes 1+ args (FileOpts)
    if (typeof entry === "function" && entry.length === 0) {
      return await (entry as () => Promise<PluginFactory>)()
    }
    return entry as PluginFactory
  }

  // Relative or absolute path - resolve from test file location
  const resolved = specifier.startsWith(".") ? resolve(dirname(testFilePath), specifier) : specifier // Bare specifier or absolute path

  // Dynamic import (Bun handles .ts files natively)
  const module = await import(resolved)

  // Export should be default export
  if (!module.default) {
    throw new Error(`Plugin module ${specifier} must have a default export (got: ${Object.keys(module).join(", ")})`)
  }

  return module.default
}
