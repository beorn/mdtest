// Plugin loader for mdtest
// Handles resolution and loading of built-in and custom plugins

import { resolve, dirname } from "node:path";
import type { PluginFactory } from "./types.js";
import { bash } from "./plugins/bash.js";

/**
 * Built-in plugins
 */
const BUILTIN_PLUGINS: Record<string, PluginFactory> = {
  bash,
  sh: bash, // alias
};

/**
 * Load a plugin by specifier
 *
 * Resolution order:
 * 1. Built-in names (bash, sh)
 * 2. Relative paths (resolve from test file dir)
 * 3. Bare specifiers (use Bun's import resolution)
 *
 * @param specifier - Plugin specifier (e.g., 'bash', './plugin.ts', '@km/cli/mdtest')
 * @param testFilePath - Absolute path to the .test.md file (for relative resolution)
 * @returns Plugin factory function
 */
export async function loadPlugin(
  specifier: string,
  testFilePath: string,
): Promise<PluginFactory> {
  // Built-in plugin?
  if (specifier in BUILTIN_PLUGINS) {
    const plugin = BUILTIN_PLUGINS[specifier];
    if (!plugin) {
      throw new Error(`Built-in plugin ${specifier} not found`);
    }
    return plugin;
  }

  // Relative or absolute path - resolve from test file location
  const resolved = specifier.startsWith(".")
    ? resolve(dirname(testFilePath), specifier)
    : specifier; // Bare specifier or absolute path

  // Disable TTY before loading plugin to ensure consistent output
  // (e.g., chalk caches isTTY at module load time)
  const originalIsTTY = process.stdout.isTTY
  Object.defineProperty(process.stdout, "isTTY", {
    value: false,
    configurable: true,
  })

  // Dynamic import (Bun handles .ts files natively)
  const module = await import(resolved);

  // Restore TTY state
  Object.defineProperty(process.stdout, "isTTY", {
    value: originalIsTTY,
    configurable: true,
  })

  // Export should be default export
  if (!module.default) {
    throw new Error(
      `Plugin module ${specifier} must have a default export (got: ${Object.keys(module).join(", ")})`,
    );
  }

  return module.default;
}
