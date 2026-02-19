// mdtest core - pure functions for parsing and matching
// These functions have no side effects and are easy to test

import type { BlockOptions } from "./api.js"
import { DEFAULTS } from "./constants.js"

type Expect = {
  stdout: string[]
  stderr: string[]
  exit: number | undefined
}

type Step = {
  cmd: string
  expected: Expect
}

// ============ Block Option Parsing ============

export function parseInfo(info: string): BlockOptions {
  const opts: BlockOptions = {}
  if (!info) return opts

  if (/\breset\b/.test(info)) opts.reset = true
  if (/\bpty=false\b/.test(info)) opts.pty = false
  else if (/\bpty\b/.test(info)) opts.pty = true

  // Parse cmd="..." (quoted value)
  const cmdMatch = info.match(/\bcmd="([^"]+)"/)
  if (cmdMatch) opts.cmd = cmdMatch[1]

  const pairs = info.match(/\b\w+=\S+/g) ?? []
  for (const kv of pairs) {
    const idx = kv.indexOf("=")
    if (idx === -1) continue
    const k = kv.slice(0, idx)
    const v = kv.slice(idx + 1)
    if (!v) continue
    // Skip cmd - it's handled specially above with quoted value extraction
    if (k === "cmd") continue
    if (k === "exit") {
      const n = Number(v)
      if (!Number.isNaN(n)) opts.exit = n
    } else if (k === "timeout") {
      const n = Number(v)
      if (!Number.isNaN(n) && n > 0) opts.timeout = n
    } else if (k === "minWait") {
      const n = Number(v)
      if (!Number.isNaN(n) && n > 0) opts.minWait = n
    } else if (k === "maxWait") {
      const n = Number(v)
      if (!Number.isNaN(n) && n > 0) opts.maxWait = n
    } else if (k === "startupDelay") {
      const n = Number(v)
      if (!Number.isNaN(n) && n >= 0) opts.startupDelay = n
    } else if (k === "cwd") opts.cwd = v
    else if (k === "env") {
      const env: Record<string, string> = {}
      for (const ent of v.split(",")) {
        if (!ent) continue
        const [ek, ev] = ent.split("=", 2)
        if (ek) env[ek] = ev ?? ""
      }
      opts.env = env
    } else {
      // Pass through arbitrary key=value pairs for plugins
      // Convert "true"/"false" to booleans for convenience
      if (v === "true") {
        ;(opts as Record<string, unknown>)[k] = true
      } else if (v === "false") {
        ;(opts as Record<string, unknown>)[k] = false
      } else {
        ;(opts as Record<string, unknown>)[k] = v
      }
    }
  }
  return opts
}

export function parseBlock(body: string): {
  commands: string[]
  expect: Expect
  steps: Step[]
} {
  const lines = body.split("\n")
  const steps: Step[] = []
  let currentCmd: string | null = null
  let expOut: string[] = []
  let expErr: string[] = []
  let expExit: number | undefined

  const finalizeStep = () => {
    if (currentCmd !== null) {
      // Remove trailing empty lines
      while (expOut.length > 0 && expOut[expOut.length - 1] === "") {
        expOut.pop()
      }
      while (expErr.length > 0 && expErr[expErr.length - 1] === "") {
        expErr.pop()
      }
      steps.push({
        cmd: currentCmd,
        expected: { stdout: expOut, stderr: expErr, exit: expExit },
      })
      expOut = []
      expErr = []
      expExit = undefined
    }
  }

  for (const raw of lines) {
    if (raw.startsWith("$ ")) {
      // New command - finalize previous step
      finalizeStep()
      currentCmd = raw.slice(2)
    } else if (raw.startsWith("> ")) {
      // Multi-line command continuation
      if (currentCmd !== null) currentCmd += "\n" + raw.slice(2)
      else expOut.push(raw)
    } else if (raw.startsWith("! ")) expErr.push(raw.slice(2))
    else {
      const m = raw.match(/^\[(\d+)\]\s*$/)
      if (m) expExit = Number(m[1])
      else expOut.push(raw)
    }
  }

  // Finalize last step
  finalizeStep()

  // Build legacy format for backward compatibility
  const allCommands = steps.map((s) => s.cmd)
  const combinedExpect: Expect = {
    stdout: steps.flatMap((s) => s.expected.stdout),
    stderr: steps.flatMap((s) => s.expected.stderr),
    exit: steps[steps.length - 1]?.expected.exit,
  }

  return { commands: allCommands, expect: combinedExpect, steps }
}

// ============ Line Normalization ============

function normLine(s: string): string {
  return s.replace(/\s+$/g, "")
}

export function splitNorm(s: string): string[] {
  return s.replace(/\r\n/g, "\n").split("\n").map(normLine)
}

function escapeRegex(s: string): string {
  return s.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")
}

// ============ Pattern Matching ============

export function compileExpectedLineToRegex(line: string, caps: Record<string, string>): { re: RegExp; keys: string[] } {
  // Full-line regex
  if (line.length >= 2 && line.startsWith("/") && line.endsWith("/")) {
    return { re: new RegExp(`^${line.slice(1, -1)}$`), keys: [] }
  }

  const TOKEN_RE = /\{\{([a-zA-Z_][\w-]*)(?::(\*|\/.*?\/))?\}\}/g
  const placeholders: { key: string; spec?: string; idx: number }[] = []
  let idx = 0

  const tmp = line.replace(TOKEN_RE, (_m, name: string, spec?: string) => {
    placeholders.push({ key: name, spec, idx: idx++ })
    return `\u0000CAP${idx - 1}\u0000`
  })

  // Replace both ... and [...] with inline wildcard marker
  let escaped = tmp.replace(/\.\.\.|\[\.\.\.]/g, "\u0000WILDCARD\u0000")

  escaped = escaped.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")
  const keys: string[] = []

  for (const ph of placeholders) {
    const tag = new RegExp(`\\u0000CAP${ph.idx}\\u0000`, "g")
    let frag: string
    let shouldCapture = true

    if (ph.spec === undefined) {
      const prev = caps[ph.key]
      if (prev === undefined) frag = `(?<${ph.key}>.+)`
      else {
        frag = `(?:${escapeRegex(prev)})`
        shouldCapture = false
      }
    } else if (ph.spec === "*") frag = `(?<${ph.key}>.+)`
    else if (ph.spec.startsWith("/") && ph.spec.endsWith("/")) {
      frag = `(?<${ph.key}>${ph.spec.slice(1, -1)})`
    } else frag = `(?<${ph.key}>.+)`

    escaped = escaped.replace(tag, frag)
    if (shouldCapture) keys.push(ph.key)
  }

  // Replace wildcard marker with regex that matches anything
  escaped = escaped.replace(/\u0000WILDCARD\u0000/g, ".+")

  return { re: new RegExp(`^${escaped}$`), keys }
}

export function matchLines(
  expectedRaw: string[],
  actualRaw: string[],
  caps: Record<string, string>,
): { ok: boolean; msg?: string } {
  const expected = expectedRaw.map(normLine)
  const actual = actualRaw.map(normLine)

  let i = 0
  let j = 0

  while (i < expected.length) {
    const e = expected[i]

    // Both [...] and ... can match multiple lines when on their own line
    if (e!.trim() === "[...]" || e!.trim() === "...") {
      const tail = expected.slice(i + 1)
      if (tail.length === 0) return { ok: true }
      for (let k = j; k <= actual.length; k++) {
        const probe = matchLines(tail, actual.slice(k), { ...caps })
        if (probe.ok) return { ok: true }
      }
      return {
        ok: false,
        msg: "ellipsis could not align with subsequent expected lines",
      }
    }

    if (j >= actual.length) {
      return {
        ok: false,
        msg: `missing actual line for expected: ${JSON.stringify(e)}`,
      }
    }

    const a = actual[j]!
    const { re, keys } = compileExpectedLineToRegex(e!, caps)
    const m = a.match(re)
    if (!m) {
      return {
        ok: false,
        msg: `line mismatch\n expected: ${JSON.stringify(e)}\n actual:   ${JSON.stringify(a)}`,
      }
    }

    for (const k of keys) {
      const val = (m.groups?.[k] ?? "") as string
      if (caps[k] === undefined) caps[k] = val
      else if (caps[k] !== val) {
        return {
          ok: false,
          msg: `capture "${k}" mismatch: expected ${JSON.stringify(caps[k])}, got ${JSON.stringify(val)}`,
        }
      }
    }

    i++
    j++
  }

  if (j !== actual.length) {
    return {
      ok: false,
      msg: `extra actual lines starting at ${JSON.stringify(actual[j])}`,
    }
  }

  return { ok: true }
}

// ============ Pattern Detection ============

export function hasPatterns(text: string): boolean {
  if (/\{\{[a-zA-Z_][\w-]*(?::.*?)?\}\}/.test(text)) return true
  if (/^\s*(\[\.\.\.]|\.\.\.)\s*$/m.test(text)) return true
  if (/\.\.\.|\[\.\.\.]/.test(text)) return true
  if (/^\/.*\/$/m.test(text)) return true
  return false
}

export function hintMismatch(kind: "stdout" | "stderr", exp: string[], act: string[], _detail?: string) {
  const header = `Mismatch in ${kind}`
  const show = (arr: string[]) => {
    if (!arr.length) return "⟂(empty)"
    const text = arr.join("\n")
    // Truncate long output to avoid overwhelming test output
    if (text.length > DEFAULTS.OUTPUT_MAX_LENGTH) {
      return (
        text.slice(0, DEFAULTS.OUTPUT_MAX_LENGTH) +
        `\n... [${text.length - DEFAULTS.OUTPUT_MAX_LENGTH} characters truncated]`
      )
    }
    return text
  }
  return [header, "---- expected ----", show(exp), "---- actual ------", show(act)].join("\n")
}
