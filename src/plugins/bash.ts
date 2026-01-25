// Bash plugin for mdtest - default execution mode
// Extracts state-based bash execution logic into plugin interface

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { splitNorm } from "../core.js";
import { buildScript, buildHookScript } from "../shell.js";
import { bunShell } from "../integrations/bun.js";
import { DEFAULTS } from "../constants.js";
import type { Plugin, PluginFactory, FileOpts, BlockOpts, ExecFn, ReplResult } from "../types.js";

/**
 * Bash plugin - default mdtest execution mode
 * Uses stateful bash execution with env/cwd/function persistence
 */
export const bash: PluginFactory = (opts: FileOpts): Plugin => {
  // Create temp directory for state files
  const stateDir = mkdtempSync(join(tmpdir(), "mdtest-"));
  const envFile = join(stateDir, ".env");
  const cwdFile = join(stateDir, ".cwd");
  const funcFile = join(stateDir, ".functions");

  // Write initial state files
  writeFileSync(envFile, "");
  writeFileSync(cwdFile, process.cwd());
  writeFileSync(funcFile, "");

  // Write all file= blocks to temp dir
  for (const [filename, content] of opts.files) {
    const filePath = join(stateDir, filename);
    writeFileSync(filePath, content);
  }

  return {
    block(opts: BlockOpts): ExecFn | null {
      // Skip file= blocks (already written in factory)
      if (opts.file) return null;

      // Only handle shell blocks
      if (!['console', 'sh', 'bash'].includes(opts.type)) {
        return null;
      }

      // Handle reset option: clear state files
      if (opts.reset) {
        writeFileSync(envFile, "");
        writeFileSync(cwdFile, process.cwd());
        writeFileSync(funcFile, "");
      }

      // Return execution function
      return async (cmd: string): Promise<ReplResult> => {
        const timeout = (opts.timeout as number | undefined) ?? DEFAULTS.TIMEOUT;
        const cwd = (opts.cwd as string | undefined) ?? process.cwd();

        // Convert BlockOpts to BlockOptions for buildScript
        const blockOpts = {
          exit: opts.exit as number | undefined,
          cwd: opts.cwd as string | undefined,
          env: opts.env as Record<string, string> | undefined,
          reset: opts.reset as boolean | undefined,
          timeout: opts.timeout as number | undefined,
        };

        // Build script with state persistence
        const script = buildScript([cmd], blockOpts, envFile, cwdFile, funcFile);

        // Execute command
        const res = await bunShell(["bash", "-lc", script], {
          cwd,
          env: process.env as Record<string, string>,
          timeout,
        });

        // Parse output
        const stdout = splitNorm(res.stdout.toString());
        const stderr = splitNorm(res.stderr.toString());

        // Remove trailing empty lines
        while (stdout.length > 0 && stdout[stdout.length - 1] === "") {
          stdout.pop();
        }
        while (stderr.length > 0 && stderr[stderr.length - 1] === "") {
          stderr.pop();
        }

        return {
          stdout: stdout.join('\n'),
          stderr: stderr.join('\n'),
          exitCode: res.exitCode ?? 0,
        };
      };
    },

    // Lifecycle hooks - call bash functions from state
    async beforeAll(): Promise<void> {
      await callHook('beforeAll');
    },

    async afterAll(): Promise<void> {
      await callHook('afterAll');
    },

    async beforeEach(): Promise<void> {
      await callHook('beforeEach');
    },

    async afterEach(): Promise<void> {
      await callHook('afterEach');
    },
  };

  // Helper to call bash hooks
  async function callHook(hookName: string): Promise<void> {
    const script = buildHookScript(hookName, envFile, cwdFile, funcFile);
    await bunShell(["bash", "-lc", script], {
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
    });
  }
};
