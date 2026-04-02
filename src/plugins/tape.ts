// Tape plugin for mdspec — executable terminal demos with visual regression
//
// Handles `tape` code blocks using the VHS .tape format. Executes commands
// against a termless headless terminal (in-process, no subprocess) and
// generates SVG screenshots for visual regression testing.

import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join, basename } from "node:path"
import type { Plugin, FileOpts, BlockOpts, ExecFn, ReplResult } from "../types.js"

// Termless imports are dynamic to avoid tsc errors in standalone CI
// (these packages are optional peer deps, only available in the km monorepo)
type TapeCommand = { type: string; text: string; key: string; count?: number; value: string; path?: string }
type Terminal = { feed(data: string): void; cols: number; rows: number; resize(cols: number, rows: number): void; close(): Promise<void> }

async function loadTermless() {
  const core = await import("@termless/core")
  const vt100 = await import("@termless/vt100")
  return {
    parseTape: core.parseTape as (content: string) => { commands: TapeCommand[]; settings: Record<string, string> },
    createTerminal: core.createTerminal as (opts: { backend: unknown; cols: number; rows: number }) => Terminal,
    screenshotSvg: core.screenshotSvg as (term: unknown, opts?: { fontSize?: number }) => string,
    createVt100Backend: vt100.createVt100Backend as (opts?: { cols?: number; rows?: number }) => unknown,
  }
}

// ── Defaults ──

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24
const DEFAULT_FONT_SIZE = 14

// ── Snapshot helpers ──

/** Derive a snapshot directory and file prefix from the test file path and heading */
function snapshotDir(testFilePath: string): string {
  const dir = dirname(testFilePath)
  const base = basename(testFilePath, ".spec.md").replace(/\.md$/, "")
  return join(dir, "__snapshots__", base)
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

// ── Tape executor ──

/** Execute a parsed tape command against a terminal */
function executeCommand(term: Terminal, cmd: TapeCommand): void {
  switch (cmd.type) {
    case "type":
      term.feed(cmd.text)
      break
    case "key": {
      const key = cmd.key.toLowerCase()
      const count = cmd.count ?? 1
      for (let i = 0; i < count; i++) {
        switch (key) {
          case "enter":
            term.feed("\r\n")
            break
          case "backspace":
            term.feed("\x7f")
            break
          case "tab":
            term.feed("\t")
            break
          case "space":
            term.feed(" ")
            break
          case "escape":
            term.feed("\x1b")
            break
          case "delete":
            term.feed("\x1b[3~")
            break
          case "up":
            term.feed("\x1b[A")
            break
          case "down":
            term.feed("\x1b[B")
            break
          case "right":
            term.feed("\x1b[C")
            break
          case "left":
            term.feed("\x1b[D")
            break
          case "home":
            term.feed("\x1b[H")
            break
          case "end":
            term.feed("\x1b[F")
            break
          case "pageup":
            term.feed("\x1b[5~")
            break
          case "pagedown":
            term.feed("\x1b[6~")
            break
          default:
            // Single character key
            if (cmd.key.length === 1) term.feed(cmd.key)
            break
        }
      }
      break
    }
    case "ctrl": {
      const ch = cmd.key.toLowerCase()
      const code = ch.charCodeAt(0) - 0x60
      if (code >= 1 && code <= 26) {
        term.feed(String.fromCharCode(code))
      }
      break
    }
    case "alt":
      term.feed(`\x1b${cmd.key}`)
      break
    case "sleep":
      // No-op in headless mode — no real delay needed
      break
    case "hide":
    case "show":
    case "output":
    case "source":
    case "require":
      // No-op — not applicable in mdspec context
      break
    case "set":
    case "screenshot":
      // Handled by the caller, not here
      break
  }
}

// ── Plugin factory ──

/**
 * Tape plugin — execute VHS .tape blocks in a headless terminal
 *
 * Supports all standard tape commands (Type, Enter, Sleep, Screenshot, etc.)
 * and generates SVG screenshots for visual regression testing.
 */
export default function tapePlugin(opts: FileOpts): Plugin {
  const testFilePath = opts.path

  return {
    block(blockOpts: BlockOpts): ExecFn | null {
      // Only handle tape blocks
      if (blockOpts.type !== "tape") return null

      // Skip file= blocks
      if (blockOpts.file) return null

      // Return executor — receives the full tape block content
      return async (content: string): Promise<ReplResult> => {
        // Lazy-load termless (optional peer dep)
        const { parseTape, createTerminal, screenshotSvg, createVt100Backend } = await loadTermless()

        // Parse tape commands
        const tape = parseTape(content)

        // Extract settings for terminal dimensions
        const cols = Number(blockOpts.cols ?? tape.settings.Width ?? DEFAULT_COLS)
        const rows = Number(blockOpts.rows ?? tape.settings.Height ?? DEFAULT_ROWS)
        const fontSize = Number(tape.settings.FontSize ?? DEFAULT_FONT_SIZE)

        // Create headless terminal
        const backend = createVt100Backend({ cols, rows })
        const term = createTerminal({ backend, cols, rows })

        try {
          // Execute commands
          const log: string[] = []
          let screenshotIndex = 0
          const snapDir = snapshotDir(testFilePath)

          // Build heading slug for snapshot naming
          const headingSlug =
            blockOpts.heading.length > 0 ? slugify(blockOpts.heading[blockOpts.heading.length - 1]!) : "tape"

          for (const cmd of tape.commands) {
            // Handle Set commands — resize terminal if Width/Height changes
            if (cmd.type === "set") {
              if (cmd.key === "Width" || cmd.key === "Height") {
                const newCols = cmd.key === "Width" ? Number(cmd.value) : term.cols
                const newRows = cmd.key === "Height" ? Number(cmd.value) : term.rows
                term.resize(newCols, newRows)
                log.push(`Set ${cmd.key} ${cmd.value}`)
              }
              continue
            }

            // Handle Screenshot command
            if (cmd.type === "screenshot") {
              screenshotIndex++
              const name = cmd.path ?? `${headingSlug}-${String(screenshotIndex).padStart(2, "0")}`
              const filename = name.endsWith(".svg") ? name : `${name}.svg`

              // Generate SVG screenshot
              const svgOpts = { fontSize }
              const svg = screenshotSvg(term, svgOpts)

              // Ensure snapshot directory exists
              mkdirSync(snapDir, { recursive: true })

              const snapPath = join(snapDir, filename)

              if (existsSync(snapPath)) {
                // Compare with reference
                const reference = readFileSync(snapPath, "utf8")
                if (svg === reference) {
                  log.push(`Screenshot: ${filename} (match)`)
                } else {
                  // Write actual for inspection
                  const actualPath = join(snapDir, filename.replace(".svg", ".actual.svg"))
                  writeFileSync(actualPath, svg)
                  log.push(`Screenshot: ${filename} (MISMATCH — actual saved to ${basename(actualPath)})`)

                  return {
                    stdout: log.join("\n"),
                    stderr: `Visual regression detected: ${filename}\nReference: ${snapPath}\nActual: ${actualPath}`,
                    exitCode: 1,
                  }
                }
              } else {
                // First run — save as reference
                writeFileSync(snapPath, svg)
                log.push(`Screenshot: ${filename} (saved as reference)`)
              }
              continue
            }

            // Execute other commands
            executeCommand(term, cmd)

            // Log what happened
            if (cmd.type === "type") {
              log.push(`Typed: ${cmd.text}`)
            } else if (cmd.type === "key") {
              log.push(`Key: ${cmd.key}${cmd.count && cmd.count > 1 ? ` x${cmd.count}` : ""}`)
            } else if (cmd.type === "ctrl") {
              log.push(`Ctrl+${cmd.key}`)
            } else if (cmd.type === "alt") {
              log.push(`Alt+${cmd.key}`)
            }
          }

          return {
            stdout: log.join("\n"),
            stderr: "",
            exitCode: 0,
          }
        } finally {
          await term.close()
        }
      }
    },
  }
}
