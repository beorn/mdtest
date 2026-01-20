// State file management for mdtest
// Provides utilities for creating and managing shell state persistence files

import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Paths to shell state persistence files
 */
export interface StateFiles {
  envFile: string; // Exported environment variables
  cwdFile: string; // Current working directory
  funcFile: string; // Bash function definitions
}

/**
 * Generate state file paths for a given file identifier
 * @param fileId - Identifier for the file (will be sanitized)
 * @param baseDir - Directory to store state files in
 */
export function createStatePaths(fileId: string, baseDir: string): StateFiles {
  const safe = fileId.replace(/[^A-Za-z0-9._-]/g, "_");
  return {
    envFile: join(baseDir, `${safe}.env.sh`),
    cwdFile: join(baseDir, `${safe}.cwd.txt`),
    funcFile: join(baseDir, `${safe}.func.sh`),
  };
}

/**
 * Ensure state files exist, creating empty files if needed
 * @param paths - State file paths
 * @param initialCwd - Initial working directory to write to cwdFile
 */
export function ensureStateFiles(paths: StateFiles, initialCwd: string): void {
  if (!existsSync(paths.envFile)) writeFileSync(paths.envFile, "", "utf8");
  if (!existsSync(paths.cwdFile)) writeFileSync(paths.cwdFile, initialCwd, "utf8");
  if (!existsSync(paths.funcFile)) writeFileSync(paths.funcFile, "", "utf8");
}

/**
 * Clear state files (reset to empty/initial state)
 * @param paths - State file paths
 * @param initialCwd - Working directory to reset to
 */
export function clearState(paths: StateFiles, initialCwd: string): void {
  writeFileSync(paths.envFile, "", "utf8");
  writeFileSync(paths.cwdFile, initialCwd, "utf8");
  writeFileSync(paths.funcFile, "", "utf8");
}
