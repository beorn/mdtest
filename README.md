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
import { registerMdTests } from "@beorn/mdtest/bun";
await registerMdTests("tests/**/*.test.md");
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
import { registerMdTests } from "@beorn/mdtest/bun";
await registerMdTests("tests/**/*.test.md");
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
```console cmd="km sh board.md" minWait=50 maxWait=500
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
- Timeout-based completion detection waits for output silence

**Options:**

- `cmd="..."` - Command to run as persistent subprocess
- `minWait=N` - Milliseconds of silence before capture complete (default: 100)
- `maxWait=N` - Maximum wait time per command in milliseconds (default: 2000)

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
};
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
import { registerMdTestFile } from "@beorn/mdtest/bun";
await registerMdTestFile("tests/specific.test.md");
```

## Development

For planned features, known issues, and development priorities, see [ROADMAP.md](./ROADMAP.md).

## Roadmap

### Marker Protocol (Future)

For more deterministic REPL testing, mdtest may implement a marker-based protocol
inspired by [pexpect's REPLWrapper](https://pexpect.readthedocs.io/en/latest/api/replwrap.html):

1. mdtest sets `MDTEST_MARKER=<uuid>` environment variable
2. REPL outputs marker after each command completes
3. mdtest reads until marker, eliminating timeout guesswork

This would require REPLs to opt-in by detecting and using the marker. Benefits:

- Faster tests (no waiting for silence timeout)
- More deterministic (no timing dependencies)
- Handles slow output correctly

See also:

- [Expect](https://en.wikipedia.org/wiki/Expect) - Original prompt-based automation
- [Shelldoc](https://github.com/endocode/shelldoc) - Persistent shell per markdown file
- [Cram](https://bitheap.org/cram/) - Shell testing patterns
