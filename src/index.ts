// mdtest — Cram-style Markdown doctest runner (Bun, per-command execution with state persistence)
//
// Usage:
//   bun mdtest [--update] <file.md> [more.md ...]
//
// Fences (cram style only):
//   ```console     (preferred for nice highlighting)   or   ```sh
//
// Inside a fence:
//   $ cmd                -> command to run (each command runs separately with state persistence)
//   > continuation       -> multi-line command continuation (for hooks and multi-line commands)
//   plain lines          -> expected STDOUT
//   ! line               -> expected STDERR (without "! " prefix)
//   [N]                  -> expected exit code of the *last* command (default 0)
//
// Matching patterns (for expected output):
//   /regex/              -> whole-line regex match
//   [...]                -> multi-line wildcard: match any number of lines (when on its own line)
//   ...                  -> multi-line wildcard: match any number of lines (when on its own line)
//                        -> inline wildcard: match any characters on the same line (e.g., {"a":1,...})
//   {{name:*}}           -> capture any substring; later {{name}} must repeat exact value
//   {{name:/regex/}}     -> capture by regex; later {{name}} must repeat exact value
//   {{name}}             -> reuse a previously captured value (exact match)
//
// Per-block options via fence info (space-separated key=value or lone flags):
//   ```console exit=1 cwd=./examples env=FOO=1,BAR=2 reset
//     - exit=NUM   : expected exit code override (also supported by trailing [NUM])
//     - cwd=PATH   : cd to PATH before running (persists globally afterwards)
//     - env=K=V,...: export vars before running (persist globally afterwards)
//     - reset      : clear the global env/cwd/func snapshot before this block
//
// Setup/Teardown hooks (bash functions):
//   Define bash functions in console blocks:
//     ```console
//     $ beforeAll() {
//     >   export TEST_DIR=$(mktemp -d)
//     > }
//     ```
//
//   Hook types (auto-called at lifecycle points if defined):
//     - beforeAll()  : run once before first test block (after it's defined)
//     - beforeEach() : run before each test block
//     - afterEach()  : run after each test block (even on failure)
//     - afterAll()   : run once after all test blocks (even on failure)
//
//   Helper functions:
//     Any other function name becomes a reusable command:
//     ```console
//     $ setup() { mkdir -p "$TEST_DIR/data"; }
//     $ setup
//     ```
//
// Test naming:
//   - Tests are named using GitHub-style slugs from nearest markdown heading
//   - Example: `## 2. Import Dry Run` → test name `file.md#2-import-dry-run`
//   - Multiple blocks under same heading get `-2`, `-3` suffix
//
// Output format:
//   - Each command is shown with `$ ` prefix followed immediately by its output
//   - Blank line separates different commands within a test
//   - Blank line separates different tests
//   - Skipped tests (no commands) shown with `- (skip)` prefix
//
// Execution model:
//   - Commands run individually (not as one combined script)
//   - State (env vars, cwd, bash functions) persists across commands via temp files
//   - Each command loads previous state, runs, then saves updated state
//   - This allows clear attribution of output to specific commands
//
// Notes:
//   - There is one *global* persistent context per input file (env + cwd + functions)
//   - Commands starting with `>` are continuations (for multi-line functions/commands)
//   - Trailing empty lines are automatically stripped from both actual and expected output
//   - Use `--update` to replace expected output with actual output (snapshot testing)
//
// -----------------------------------------------------------------------------

import { readFile, writeFile } from 'node:fs/promises'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { glob } from 'glob'
import { Command } from '@commander-js/extra-typings'
import { parseInfo, parseBlock, splitNorm, matchLines, hasPatterns, hintMismatch } from './core.js'
import { parseMarkdown, findNearestHeading, generateTestId } from './markdown.js'
import { buildScript, buildHookScript } from './shell.js'
import { bunShell } from './integrations/bun.js'
import type { BlockOptions } from './api.js'
import createDebug from 'debug'

const debug = createDebug('mdtest:runner')
const debugFiles = createDebug('mdtest:files')

// -------- Version Helper --------
async function getVersion(): Promise<string> {
  const __dirname = dirname(fileURLToPath(import.meta.url))
  const packageJson = JSON.parse(await readFile(join(__dirname, '../package.json'), 'utf-8')) as {
    version: string
  }
  return packageJson.version
}

// -------- CLI Setup --------
const program = new Command()
  .name('mdtest')
  .description('Markdown-based shell testing with persistent context')
  .version(await getVersion())
  .argument('<patterns...>', 'Test file paths or glob patterns (e.g., tests/**/*.test.md)')
  .option('-u, --update', 'Update snapshots (replace expected output with actual)', false)
  .option('--hide-body', 'Hide markdown body text in output (markdown reporter only)', false)
  .option('--trunc', 'Enable truncation of long lines in output (default: true)', true)
  .option('--no-trunc', 'Disable truncation of long lines in output')
  .showHelpAfterError('(add --help for additional information)')
  .parse()

const opts = program.opts()
const patterns = program.args
const UPDATE = opts.update
const SHOW_BODY = !opts.hideBody
const TRUNCATE = opts.trunc
const TRUNC_WIDTH = 70

// Helper to truncate long lines
function maybeTrunc(line: string): string {
  if (!TRUNCATE || line.length <= TRUNC_WIDTH) return line
  return line.slice(0, TRUNC_WIDTH - 3) + '...'
}

// Expand glob patterns (handles both shell-expanded and quoted patterns)
const files: string[] = []
for (const pattern of patterns) {
  const matches = await glob(pattern, { nodir: true })
  if (matches.length === 0) {
    // If no glob match, treat as literal file path (preserves shell behavior)
    files.push(pattern)
  } else files.push(...matches)
}

if (files.length === 0) {
  console.error('Error: No test files found matching patterns:', patterns)
  process.exit(2)
}

debug('Found %d test files', files.length)
debug('Files: %O', files)

// -------- Global (per-file) persistent context (env + cwd + functions) --------
const baseDir = mkdtempSync(join(tmpdir(), 'mdtest-'))
// We’ll keep one pair of files per *input file path* so parallel files don’t collide.
function statePathsFor(file: string) {
  const safe = file.replace(/[^A-Za-z0-9._-]/g, '_')
  return {
    envFile: join(baseDir, `${safe}.env.sh`),
    cwdFile: join(baseDir, `${safe}.cwd.txt`),
    funcFile: join(baseDir, `${safe}.func.sh`),
  }
}

function ensureStateFiles(envFile: string, cwdFile: string, funcFile: string) {
  if (!existsSync(envFile)) writeFileSync(envFile, '', 'utf8')
  if (!existsSync(cwdFile)) writeFileSync(cwdFile, process.cwd(), 'utf8')
  if (!existsSync(funcFile)) writeFileSync(funcFile, '', 'utf8')
}

function clearState(envFile: string, cwdFile: string, funcFile: string) {
  writeFileSync(envFile, '', 'utf8')
  writeFileSync(cwdFile, process.cwd(), 'utf8')
  writeFileSync(funcFile, '', 'utf8')
}

async function runBlock(
  commands: string[],
  opts: BlockOptions,
  envFile: string,
  cwdFile: string,
  funcFile: string,
  cwd: string
) {
  const results: Array<{ command: string; stdout: string[]; stderr: string[] }> = []
  let lastExitCode = 0
  const timeout = opts.timeout ?? 30000 // Default 30s timeout

  for (const cmd of commands) {
    const script = buildScript([cmd], opts, envFile, cwdFile, funcFile)

    // Execute command with timeout
    let res
    try {
      res = await bunShell(['bash', '-lc', script], {
        cwd: cwd,
        env: process.env as Record<string, string>,
        timeout: timeout,
      })
    } catch (err: any) {
      // Handle unexpected errors (timeout handled inside bunShell())
      throw err
    }
    let stdout = splitNorm(res.stdout.toString())
    let stderr = splitNorm(res.stderr.toString())
    // Remove trailing empty line if present (split creates '' when string ends with \n)
    while (stdout.length > 0 && stdout[stdout.length - 1] === '') stdout.pop()
    while (stderr.length > 0 && stderr[stderr.length - 1] === '') stderr.pop()
    lastExitCode = res.exitCode ?? 0
    results.push({ command: cmd, stdout, stderr })
  }

  // Combine all output for matching (backward compat)
  const allStdout = results.flatMap((r) => r.stdout)
  const allStderr = results.flatMap((r) => r.stderr)

  return { stdout: allStdout, stderr: allStderr, exitCode: lastExitCode, results }
}

// -------- Hook auto-calling --------
async function callHookIfExists(
  hookName: string,
  envFile: string,
  cwdFile: string,
  funcFile: string
) {
  const script = buildHookScript(hookName, envFile, cwdFile, funcFile)
  await bunShell(['bash', '-lc', script], {
    cwd: process.cwd(),
    env: process.env as Record<string, string>,
  })
}

// -------- File processing & snapshot updating --------
type Replacement = { start: number; end: number; newText: string }

// Helper to convert character position to line/column
function positionToLineColumn(text: string, offset: number): { line: number; column: number } {
  const lines = text.slice(0, offset).split('\n')
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  }
}

async function testFile(
  path: string,
  isFirstFile: boolean
): Promise<{ fails: number; total: number; replacements: Replacement[] }> {
  debug('Testing file: %s', path)

  // ADR-004: Auto-chdir to temp directory for test isolation
  const originalCwd = process.cwd()
  const testTempDir = mkdtempSync(join(tmpdir(), 'mdtest-'))
  debug('Created temp directory: %s', testTempDir)

  // Set ROOT to original project root for tests to reference source
  if (!process.env.ROOT) process.env.ROOT = originalCwd

  try {
    // Read test file from original path (before chdir)
    const { isAbsolute } = await import('node:path')
    const testFilePath = isAbsolute(path) ? path : join(originalCwd, path)
    debug('Reading test file: %s', testFilePath)
    const md = await readFile(testFilePath, 'utf8')
    const { headings, codeBlocks } = parseMarkdown(md)
    debug('Parsed %d headings, %d code blocks', headings.length, codeBlocks.length)

    // Extract ALL markdown content (for --show-body)
    // This includes: frontmatter, paragraphs between code blocks (but NOT headings)
    const bodyTexts = new Map<number, string>()
    if (SHOW_BODY) {
      const lines = md.split('\n')
      let lastEndLine = 0

      for (const block of codeBlocks) {
        if (block.lang !== 'console' && block.lang !== 'sh') continue

        const blockStartLine = block.position.start.line - 1 // 0-indexed

        // Collect all lines from last code block end to this code block start
        // EXCLUDING headings (we output those separately)
        const bodyLines: string[] = []
        for (let i = lastEndLine; i < blockStartLine; i++) {
          const line = lines[i]
          if (line.startsWith('```')) continue // Skip fence markers
          if (line.startsWith('#')) continue // Skip headings (we output those separately)
          bodyLines.push(line)
        }

        // Trim leading/trailing blank lines but preserve internal structure
        while (bodyLines.length > 0 && bodyLines[0].trim() === '') bodyLines.shift()
        while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === '')
          bodyLines.pop()

        if (bodyLines.length > 0)
          bodyTexts.set(block.position.start.offset || 0, bodyLines.join('\n'))

        lastEndLine = block.position.end.line // Ready for next iteration
      }
    }

    // Change to temp directory BEFORE creating helper files
    process.chdir(testTempDir)

    // Create helper files from file= blocks (must happen after chdir)
    for (const block of codeBlocks) {
      if (block.filename) {
        const { writeFileSync } = await import('node:fs')
        const { join } = await import('node:path')
        const filepath = join(testTempDir, block.filename)
        debugFiles('Creating file: %s', filepath)
        debugFiles('Content length: %d bytes', block.value.length)
        writeFileSync(filepath, block.value, 'utf8')
        debugFiles('File written successfully')
      }
    }

    // Filter to console/sh blocks and convert to fence format for compatibility
    const fences = codeBlocks
      .filter((block) => block.lang === 'console' || block.lang === 'sh')
      .map((block) => ({
        lang: block.lang as 'console' | 'sh',
        info: block.meta || '',
        text: block.value,
        start: block.position.start.offset || 0,
        end: block.position.end.offset || 0,
        body: bodyTexts.get(block.position.start.offset || 0),
      }))

    const { envFile, cwdFile, funcFile } = statePathsFor(path)
    ensureStateFiles(envFile, cwdFile, funcFile)

    // Output file header (markdown format)
    if (!isFirstFile) console.log('\n---\n')
    console.log(`${path}:\n`)

    let failures = 0
    let total = 0
    const replacements: Replacement[] = []
    let beforeAllRan = false
    const capsStdout: Record<string, string> = {}
    const capsStderr: Record<string, string> = {}
    const headingBlockCounts = new Map<string, number>()
    const seenTestIds = new Set<string>()
    let lastHeadingText: string | null = null

    // Run all blocks as tests
    for (let i = 0; i < fences.length; i++) {
      const f = fences[i]
      total++
      const { commands, expect } = parseBlock(f.text)

      // Generate test ID from nearest heading
      const blockStartPos = positionToLineColumn(md, f.start)
      const nearestHeading = findNearestHeading(headings, blockStartPos)
      const testId = generateTestId(nearestHeading, i, headingBlockCounts)
      const testName = `${path}#${testId}`
      const headingText = nearestHeading?.text ?? testId
      const headingDepth = nearestHeading?.depth ?? 1
      const headingPrefix = '#'.repeat(headingDepth)

      // Validate for duplicate test IDs
      if (seenTestIds.has(testId)) {
        console.error(`\n❌ ERROR: Duplicate test ID detected: "${testId}"`)
        console.error(`   Test IDs must be unique within a file.`)
        console.error(`   This usually happens when two code blocks are at the same heading level.`)
        console.error(
          `   Consider adding subheadings or unique identifiers to distinguish tests.\n`
        )
        process.exit(1)
      }
      seenTestIds.add(testId)

      if (!commands.length) {
        total--
        continue
      }

      const opts = parseInfo(f.info)
      if (opts.reset) {
        clearState(envFile, cwdFile, funcFile)
        Object.keys(capsStdout).forEach((k) => delete capsStdout[k])
        Object.keys(capsStderr).forEach((k) => delete capsStderr[k])
      }

      // Call beforeEach hook if exists
      await callHookIfExists('beforeEach', envFile, cwdFile, funcFile)

      const { stdout, stderr, exitCode, results } = await runBlock(
        commands,
        opts,
        envFile,
        cwdFile,
        funcFile,
        process.cwd()
      )

      // Run beforeAll once, after first block that defines it
      if (!beforeAllRan) {
        await callHookIfExists('beforeAll', envFile, cwdFile, funcFile)
        beforeAllRan = true
      }

      const wantExit = expect.exit ?? opts.exit ?? 0

      const wantStdout = expect.stdout
      const wantStderr = expect.stderr.length ? expect.stderr : []

      const outMatch = matchLines(wantStdout, stdout, capsStdout)
      const errMatch =
        expect.stderr.length === 0
          ? matchLines(
              [],
              stderr.filter((l) => l.length),
              capsStderr
            )
          : matchLines(
              wantStderr,
              stderr.filter((l) => l.length),
              capsStderr
            )

      const exitOk = exitCode === wantExit

      if (outMatch.ok && errMatch.ok && exitOk) {
        // Output test heading (markdown format) - only if changed
        if (headingText !== lastHeadingText) {
          if (lastHeadingText !== null) console.log('')
          console.log(`${headingPrefix} ${headingText}`)
          console.log('') // Blank line after heading
          lastHeadingText = headingText
        }

        // Output body text if --show-body is enabled
        if (f.body) {
          console.log(f.body)
          console.log('') // Blank line after body
        }

        // Output each command with its output (indented for markdown)
        const nonHookResults = results.filter((r) => !r.command.startsWith('>'))
        for (let i = 0; i < nonHookResults.length; i++) {
          const { command, stdout: cmdStdout } = nonHookResults[i]
          // Format multi-line commands with ┊ continuation
          const cmdLines = command.split('\n')
          if (cmdLines.length === 1) console.log(`    \x1b[32m✓\x1b[0m ${maybeTrunc(command)}`)
          else {
            console.log(`    \x1b[32m✓\x1b[0m ${maybeTrunc(cmdLines[0])}`)
            for (let j = 1; j < cmdLines.length; j++)
              console.log(`    ┊ ${maybeTrunc(cmdLines[j])}`)
          }
          cmdStdout.forEach((line) => console.log(`      ${maybeTrunc(line)}`))
          // Add blank line between commands only if current command has output or not last
          const hasOutput = cmdStdout.length > 0
          const isLast = i === nonHookResults.length - 1
          if (!isLast && (hasOutput || nonHookResults[i + 1].stdout.length > 0)) console.log('')
        }
        console.log('') // Blank line after test
      } else {
        failures++
        // Output test heading (markdown format) - only if changed
        if (headingText !== lastHeadingText) {
          if (lastHeadingText !== null) console.error('')
          console.error(`${headingPrefix} ${headingText}`)
          console.error('') // Blank line after heading
          lastHeadingText = headingText
        }

        // Output body text if --show-body is enabled
        if (f.body) {
          console.error(f.body)
          console.error('') // Blank line after body
        }

        // Output each command with failure indicator (indented for markdown)
        const nonHookResults = results.filter((r) => !r.command.startsWith('>'))
        for (const { command } of nonHookResults) {
          // Format multi-line commands with ┊ continuation
          const cmdLines = command.split('\n')
          if (cmdLines.length === 1) console.error(`    \x1b[31m✗\x1b[0m ${maybeTrunc(command)}`)
          else {
            console.error(`    \x1b[31m✗\x1b[0m ${maybeTrunc(cmdLines[0])}`)
            for (let j = 1; j < cmdLines.length; j++)
              console.error(`    ┊ ${maybeTrunc(cmdLines[j])}`)
          }
        }
        console.error('') // Blank line before error details

        if (!outMatch.ok) console.error(hintMismatch('stdout', wantStdout, stdout, outMatch.msg))
        if (!errMatch.ok) console.error(hintMismatch('stderr', wantStderr, stderr, errMatch.msg))
        if (!exitOk) console.error(`exit code: expected ${wantExit}, got ${exitCode}`)
        console.error('') // Blank line after test
      }

      // Call afterEach hook if exists (run even on failure)
      await callHookIfExists('afterEach', envFile, cwdFile, funcFile)

      // Update logic if test failed
      if (!(outMatch.ok && errMatch.ok && exitOk) && UPDATE) {
        // Warn if block has wildcards/regex/ellipsis patterns (but still update)
        if (hasPatterns(f.text)) {
          console.error(
            `⚠️  ${testName} contains patterns - updating anyway (patterns will be replaced)`
          )
          console.error(`   Patterns found: wildcards {{...}}, regex /.../, or ellipsis ...`)
          console.error(`   Review changes carefully before committing`)
        }

        // Rebuild the fence with actual output
        const rebuilt: string[] = []
        // keep commands and continuations
        for (const c of f.text.split('\n'))
          if (c.startsWith('$ ') || c.startsWith('> ')) rebuilt.push(c)

        // stdout
        if (stdout.length) rebuilt.push(...stdout)
        // stderr (only if non-empty)
        const nonBlankErr = stderr.filter((l) => l.length)
        if (nonBlankErr.length) for (const l of stderr) rebuilt.push(l.length ? `! ${l}` : l)
        // exit code
        if (exitCode !== 0) rebuilt.push(`[${exitCode}]`)

        const newFence =
          '```' + f.lang + (f.info ? ' ' + f.info : '') + '\n' + rebuilt.join('\n') + '\n```'
        replacements.push({ start: f.start, end: f.end, newText: newFence })
      }
    }

    // Call afterAll hook if exists (run even on failure)
    await callHookIfExists('afterAll', envFile, cwdFile, funcFile)

    return { fails: failures, total, replacements }
  } finally {
    // ADR-004: Restore original working directory and cleanup temp directory
    process.chdir(originalCwd)

    // Cleanup temp directory (future: add --keep-temp flag to preserve for debugging)
    try {
      const { rmSync } = await import('node:fs')
      rmSync(testTempDir, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors (temp will be cleaned by OS eventually)
    }
  }
}

async function applyReplacements(path: string, reps: Replacement[]) {
  if (reps.length === 0) return
  let md = await readFile(path, 'utf8')
  reps.sort((a, b) => b.start - a.start) // apply back-to-front
  for (const r of reps) md = md.slice(0, r.start) + r.newText + md.slice(r.end)
  await writeFile(path, md, 'utf8')
}

async function main() {
  let fails = 0
  let total = 0
  const toUpdate: { path: string; reps: Replacement[] }[] = []
  let isFirstFile = true

  for (const f of files) {
    const { fails: ff, total: tt, replacements: reps } = await testFile(f, isFirstFile)
    fails += ff
    total += tt
    if (UPDATE && reps.length) toUpdate.push({ path: f, reps })
    isFirstFile = false
  }

  if (UPDATE) for (const u of toUpdate) await applyReplacements(u.path, u.reps)

  const ok = fails === 0
  console.log(
    `\n${ok ? '✅' : '❌'} ${total} block(s), ${fails} failed${UPDATE ? ' (updated snapshots where needed)' : ''}`
  )
  process.exit(ok ? 0 : 1)
}

main()

// -----------------------------------------------------------------------------
// Future ideas (not implemented; keeping notes here):
// - Named contexts: fence info `ctx=name` to multiplex persistent sessions
//   (env/cwd per name), plus `ctx=isolated` for one-off.
// - JUnit reporter: `--junit report.xml` producing per-block testcase entries.
// - Rich stderr control: `>2` blocks or per-line channel markers.
// - Partial updates: `--update-out` vs `--update-err`.
// -----------------------------------------------------------------------------
