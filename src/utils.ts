// Shared utilities for mdtest

/**
 * ANSI escape code pattern for stripping.
 *
 * Matches:
 * - SGR escape sequences: \x1b[31m (red), \x1b[0m (reset)
 * - Extended SGR codes: \x1b[4:3m (curly underline), \x1b[58:2::r:g:bm (underline color)
 * - OSC 8 hyperlink sequences: \x1b]8;;<url>\x1b\\ (opening and closing)
 */
const ANSI_REGEX = /\x1b\[[0-9;:]*m|\x1b\]8;;[^\x1b]*\x1b\\/g

/**
 * Strip ANSI escape codes from output unless FORCE_COLOR is set.
 * Used to normalize command output for test comparison.
 */
export function stripAnsi(s: string): string {
  return process.env.FORCE_COLOR ? s : s.replace(ANSI_REGEX, "")
}
