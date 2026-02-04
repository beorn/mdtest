# mdtest

Write shell tests in markdown with executable `console` code fences.

Inspired by Python's [Cram](https://bitheap.org/cram/) and doctest, mdtest turns CLI documentation into tests. Features include temp directory per test file, persistent shell context across blocks, rich pattern matching (wildcards, regex, named captures), and Bun test runner integration (experimental - see [ROADMAP.md](./ROADMAP.md) for known issues).

## Quick Start

**1. Write a test** (`example.test.md`):

````markdown
# My CLI Tests

```console
$ echo "Hello, mdtest!"
Hello, mdtest!
```

```console
$ date +"%Y"
/\d{4}/
```
````

**2. Run tests:**

```bash
mdtest example.test.md  # Standalone CLI (recommended)
```

**Alternative: Bun test runner** (currently limited - see [Bun Integration](#bun-integration)):

```typescript
// tests/md.test.ts
import { registerMdTests } from "@beorn/mdtest/bun"
await registerMdTests("tests/**/*.test.md")
```

```bash
bun test tests/md.test.ts
```

## Features

- **Temp directory** - Each test file runs in fresh temp dir, `$ROOT` points to source tree
- **Persistent context** - Environment, cwd, bash functions persist across blocks
- **Helper files** - Create files from code fences using `file=` syntax
- **Pattern matching** - Wildcards `*`, regex `/pattern/`, ellipsis `[...]`, named captures `{{name:*}}`
- **Exit codes & stderr** - Test failures `[N]`, stderr with `!` prefix
- **Lifecycle hooks** - `beforeAll`, `afterAll`, `beforeEach`, `afterEach`
- **Snapshot updates** - `--update` flag to refresh expected output

## Installation

```bash
bun add -d mdtest
```

## Usage

### Standalone CLI

Run `.test.md` files with markdown-formatted output:

```bash
mdtest tests/example.test.md           # Single file
mdtest tests/**/*.test.md              # Multiple files (glob pattern)
mdtest --update tests/example.test.md  # Update snapshots
```

**CLI Options:**

- `--update` - Replace expected output with actual output (snapshot mode)
- `--hide-body` - Hide markdown body text in output (body shown by default)
- `--no-trunc` - Disable truncation of long lines (truncates at 70 chars by default)
- File patterns - Glob patterns or file paths

**Output:** Markdown format with headings, ✓/✗ marks, colored diffs, and body text

**Debug Mode:**

```bash
DEBUG='mdtest:*' mdtest tests/example.test.md       # All debug output
DEBUG='mdtest:runner' mdtest tests/example.test.md  # Test execution only
DEBUG='mdtest:files' mdtest tests/example.test.md   # File creation only
DEBUG='mdtest:session' mdtest tests/example.test.md # Session state only
```

Uses the [debug](https://www.npmjs.com/package/debug) package. Available namespaces:

- `mdtest:runner` - Test file discovery, parsing, and execution
- `mdtest:files` - Helper file creation from `file=` blocks
- `mdtest:session` - Session state management (env, cwd, functions)

### Bun Integration

**⚠️ Known Issue**: Bun test runner integration currently broken due to `Bun.spawn()` subprocess regression (empty stdout/stderr when run inside `bun test`). Tests worked previously but stopped working (likely Bun version regression or environment change). Use the standalone CLI instead. See [ROADMAP.md](./ROADMAP.md) for investigation status and workarounds.

Run `.test.md` through `bun test` for mixed `.ts`/`.md` suites:

**Setup:** Create `tests/md.test.ts`:

```typescript
import { registerMdTests } from "@beorn/mdtest/bun"
await registerMdTests("tests/**/*.test.md")
```

**Run:**

```bash
bun test                              # All tests (.ts + .md)
bun test tests/md.test.ts             # Just .md tests
bun test --test-name-pattern="init"   # Filter by test name
```

**Planned Benefits:** Uses Bun's reporters, works with `--watch`, `--coverage`, `--bail` (when Bun.spawn() issue resolved)

## Comparison

mdtest builds on ideas from existing markdown shell testing tools:

| Tool                                       | Format           | Temp Dir               | Context Persistence        | Test Framework Integration | Pattern Matching                           |
| ------------------------------------------ | ---------------- | ---------------------- | -------------------------- | -------------------------- | ------------------------------------------ |
| **mdtest**                                 | `console` fences | Auto                   | Yes (env, cwd, functions)  | Bun (Jest/Vitest planned)  | Wildcards, regex, ellipsis, named captures |
| **[Cram](https://bitheap.org/cram/)**      | Indented blocks  | Manual (`cd $CRAMTMP`) | Limited (env only)         | Standalone only            | Basic wildcards, ellipsis                  |
| **[mdsh](https://github.com/bashup/mdsh)** | `bash` fences    | None                   | Yes (single shell session) | None (documentation focus) | None (exact matching)                      |
| **mdsh + Cram**                            | Mixed            | Manual                 | Partial                    | Standalone only            | Basic wildcards                            |

**Key differences:**

- **Automatic temp dir** - Tests run in fresh temp dir by default (ADR-004)
- **Bun integration** - Mixed `.test.ts` + `.test.md` suites (Jest/Vitest planned)
- **Rich patterns** - Named captures, regex, capture reuse
- **Lifecycle hooks** - `beforeAll`, `afterAll`, `beforeEach`, `afterEach`

**Use mdtest for:** CLI testing with framework integration, mixed suites, rich assertions
**Use Cram for:** Simple Python-based testing, minimal dependencies
**Use mdsh for:** Executable documentation, literate programming

## Test Syntax

### Basic Command Syntax

Commands start with `$` and can be single-line or multi-line:

````markdown
```console
$ echo "single line"
Hello
```

```console
$ node --eval "
> console.log('multi-line command');
> console.log('use > for continuation');
> "
multi-line command
use > for continuation
```

```console
$ cat <<EOF
> Line 1
> Line 2
> EOF
Line 1
Line 2
```
````

**Multi-line rules:**

- First line starts with `$`
- Continuation lines start with `>`
- Expected output comes after the command completes
- Works with any shell command (heredocs, pipes, node --eval, etc.)

### Pattern Matching

Match dynamic output with patterns instead of exact strings:

````markdown
```console
$ date +"%Y-%m-%d"
/\d{4}-\d{2}-\d{2}/
```

```console
$ echo "UUID: $(uuidgen)"
UUID: {{uuid:/[0-9A-F-]{36}/}}
```

```console
$ echo "Saved as: {{uuid}}"
Saved as: {{uuid}}
```
````

**Available patterns:**

- `[...]` or `...` - Ellipsis (matches 0+ lines when alone, or inline text)
- `/regex/` - Regular expression
- `{{name:*}}` - Named capture (wildcard)
- `{{name:/regex/}}` - Named capture (regex)
- `{{name}}` - Reuse captured value

#### Ellipsis (`[...]` or `...`) - Universal wildcard

Both `[...]` and `...` work identically as a universal wildcard pattern:

**On separate line** (matches 0+ lines):

````markdown
```console
$ ls -1
[...]
README.md
[...]
```

```console
$ echo -e "Start\nMiddle\nEnd"
Start
...
End
```
````

**Inline** (matches text within a line):

````markdown
```console
$ echo "Prefix: some-random-id-12345 Suffix"
Prefix: [...] Suffix
```

```console
$ echo "User: $USER, Time: $(date +%s)"
User: ..., Time: ...
```

```console
$ echo "A: value1 B: value2 C: value3"
A: [...] B: ... C: [...]
```
````

**With brackets** (JSON/arrays - use `[...]` for clarity):

````markdown
```console
$ echo '["item1", "item2", "item3"]'
[[...]]
```
````

**Indented** (preserves indentation):

````markdown
```console
$ cat structure.json
{
  [...]
  "key": "value"
}
```
````

**Usage notes:**

- When alone on a line (trimmed): matches zero or more lines
- When inline: matches text (equivalent to regex `.+`)
- Both `[...]` and `...` are functionally identical
- Use `[...]` when `...` might be ambiguous (e.g., in prose)
- Multiple wildcards per line: `A: ... B: ... C: ...`

### Exit Codes & Stderr

````markdown
```console
$ false
[1]
```

```console
$ echo "error" >&2
! error
```

```console
$ nonexistent-command
! command not found: nonexistent-command
[127]
```
````

### Block Options

Configure test blocks via fence info string:

````markdown
```console cwd=/tmp
$ pwd
/tmp
```

```console env=DEBUG=1
$ echo $DEBUG
1
```

```console timeout=5000
$ sleep 10
! Command timed out after 5000ms
[124]
```

```console reset
$ # Fresh context (env/cwd reset)
```
````

### Custom Command Mode

Test REPLs and interactive shells using `cmd="..."` to keep a subprocess running across commands:

````markdown
```console cmd="km sh board.md"
$ key j
$ state
cursor: [0,1]
node: Task A
```
````

**How it works:**

- A single subprocess is started for the block (not one per command)
- Commands are sent to stdin, output captured from stdout/stderr
- State persists between commands (unlike standard bash mode)
- On POSIX (Linux/macOS): Uses PTY mode with OSC 133 shell integration for fast, deterministic detection
- On Windows: Falls back to pipe mode with silence-based detection

**Options:**

- `cmd="..."` - Command to run as persistent subprocess
- `pty=false` - Force pipe mode instead of PTY (for separate stderr capture)
- `minWait=N` - Milliseconds of silence before capture complete (default: 50 for PTY, 100 for pipes)
- `maxWait=N` - Maximum wait time per command in milliseconds (default: 2000)
- `startupDelay=N` - Milliseconds to wait for subprocess to be ready (default: 100 for PTY, 0 for pipes)

**PTY mode (default on POSIX):**

Uses Bun's native PTY support to give the subprocess a real terminal (`isTTY=true`). This enables:

- **OSC 133 detection**: Programs that emit shell integration sequences (like `km sh`) signal command completion immediately, making tests ~6x faster
- **Automatic feature detection**: TTY-aware programs enable colors, prompts, etc.
- **No silence guessing**: Deterministic completion instead of waiting for output to stop

REPLs can emit OSC 133 sequences when they detect a TTY:

```typescript
// After command output, emit completion marker with exit code
process.stdout.write("\x1b]133;D;0\x07")
```

**Use cases:**

- Testing REPLs where state persists (Node.js, Python, etc.)
- Testing TUI shells with in-memory state
- Any interactive command-line tool

### Lifecycle Hooks

Define setup/teardown as bash functions:

````markdown
```console
$ beforeAll() {
>   mkdir -p test-data
> }
$ afterAll() {
>   rm -rf test-data
> }
```
````

**Available hooks:** `beforeAll`, `afterAll`, `beforeEach`, `afterEach`

### Helper Files

Create files in the test temp directory using `file=` in fence info:

````markdown
```bash file=helpers.sh
greet() {
  echo "Hello, $1!"
}

export API_URL="http://localhost:3000"
```

```console
$ source helpers.sh
$ greet "mdtest"
Hello, mdtest!
```
````

````markdown
```typescript file=config.ts
export const config = {
  timeout: 5000,
  retries: 3,
}
```

```console
$ cat config.ts
export const config = {
  timeout: 5000,
  retries: 3
}
```
````

**How it works:**

- Files are created in test temp directory before any tests run
- Available to all test commands in that file
- Bash helper files can be sourced with `source filename`
- Any language fence can use `file=` (bash, typescript, json, etc.)
- File path is relative to temp directory (`$PWD`)

**Use cases:**

- Shared bash functions across multiple test blocks
- Configuration files for CLI tools
- Mock data files (JSON, YAML, etc.)
- Test fixtures

## How It Works

- **Markdown parsing**: Extracts `console` code fences using remark
- **Per-command matching**: Each `$ command` gets its own expected output (not shared across block)
- **Persistent context**: Shell state (env, cwd, bash functions) saved to temp files between blocks
- **Serial execution**: Tests run sequentially to preserve state
- **Shell execution**: Uses custom shell adapter wrapping bash (runtime-portable design)

## Advanced

### Alternative Registration

Register individual files instead of glob pattern:

```typescript
import { registerMdTestFile } from "@beorn/mdtest/bun"
await registerMdTestFile("tests/specific.test.md")
```

## Development

For planned features, known issues, and development priorities, see [ROADMAP.md](./ROADMAP.md).

## Completion Detection

mdtest detects command completion using markers or silence:

### Detection Logic

**Ready Detection (before command):**

```
1. Wait for subprocess to be ready (first command only, or between commands):
   - OSC 133;A marker detected → immediate ready (best)
   - Any output received → subprocess started, proceed
   - startupDelay ms elapsed → timeout, proceed anyway (fallback)
2. Clear buffer
```

**Completion Detection (after command):**

```
1. Send command to subprocess
2. Wait for completion signal:
   - OSC 133;D marker detected → immediate completion (fastest)
   - minWait ms of silence → assume complete (fallback)
   - maxWait ms elapsed → timeout (safety net)
3. Strip escape sequences from output
```

### Typical Scenarios

| Scenario                               | Platform    | Mode | Ready Detection | Completion Detection | First Cmd    | Subsequent |
| -------------------------------------- | ----------- | ---- | --------------- | -------------------- | ------------ | ---------- |
| OSC 133-aware REPL (e.g., `km sh`)     | macOS/Linux | PTY  | OSC 133;A       | OSC 133;D            | ~50ms        | ~10ms      |
| REPL with banner/prompt (e.g., Python) | macOS/Linux | PTY  | Any output      | Silence              | ~20ms        | ~50ms      |
| OSC 133-aware REPL                     | Windows     | Pipe | Any output      | OSC 133;D            | ~20ms        | ~10ms      |
| Silent REPL (no startup output)        | macOS/Linux | PTY  | Timeout         | Silence              | ~300ms       | ~50ms      |
| Standard command (e.g., `cat`)         | macOS/Linux | PTY  | N/A             | Silence              | immediate    | ~50ms      |
| Slow/hanging command                   | Any         | Any  | Timeout         | Timeout              | startupDelay | maxWait    |

### Options

- `startupDelay=N` - Max wait for subprocess ready before first command (default: 300ms PTY, 0ms pipe). If the subprocess emits OSC 133;A before this timeout, execution proceeds immediately.
- `minWait=N` - Silence duration to assume completion (default: 50ms PTY, 100ms pipe)
- `maxWait=N` - Maximum wait before timeout (default: 2000ms)

### PTY vs Pipe Mode

|                 | PTY (POSIX default) | Pipe (`pty=false` or Windows)       |
| --------------- | ------------------- | ----------------------------------- |
| Subprocess sees | `isTTY=true`        | `isTTY=false`                       |
| OSC 133         | Auto-detected       | Requires `TERM_SHELL_INTEGRATION=1` |
| stderr          | Merged with stdout  | Separate stream                     |
| Platform        | macOS, Linux        | All platforms                       |

### Implementing OSC 133 in Your REPL

To enable fast, deterministic testing:

```typescript
// Emit completion marker after each command
if (process.stdout.isTTY) {
  process.stdout.write(`\x1b]133;D;${exitCode}\x07`)
}
```

See [Kitty Shell Integration](https://sw.kovidgoyal.net/kitty/shell-integration/) for the full protocol.

## See Also

- [Expect](https://en.wikipedia.org/wiki/Expect) - Original prompt-based automation
- [Shelldoc](https://github.com/endocode/shelldoc) - Persistent shell per markdown file
- [Cram](https://bitheap.org/cram/) - Shell testing patterns
- [pexpect REPLWrapper](https://pexpect.readthedocs.io/en/latest/api/replwrap.html) - Python REPL automation
