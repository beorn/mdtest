# mdtest

Write tests in markdown. Run them as code.

> Early release (0.x) -- API may evolve before 1.0.

mdtest turns CLI documentation into executable tests. Write commands and expected output in `console` code fences, and mdtest runs them with persistent shell context, rich pattern matching, and snapshot updates. Your documentation stays accurate because it _is_ the test suite.

> **Security note**: mdtest executes shell commands from markdown blocks. Do not run it on untrusted content.

## Requirements

- **Bun** >= 1.0.0 (runtime and package manager)
- **Shell**: bash / POSIX shell (macOS, Linux; Windows via WSL)

## Quick Start

Install:

```bash
bun add -d @beorn/mdtest
```

Write a test (`example.test.md`):

````markdown
# My CLI

```console
$ echo "Hello, mdtest!"
Hello, mdtest!
```

```console
$ date +"%Y"
/\d{4}/
```
````

Run it:

```bash
mdtest example.test.md
```

### When Tests Fail

When expected output changes, mdtest shows a colored diff. Update snapshots automatically:

```bash
mdtest --update example.test.md
```

The markdown file is rewritten in place with the actual output replacing the expected output.

## Features

### Pattern Matching

Match dynamic output with wildcards, regex, and named captures:

````markdown
```console
$ uuidgen
{{id:/[0-9A-F-]{36}/}}
```

```console
$ echo "Your ID: {{id}}"
Your ID: {{id}}
```
````

Ellipsis wildcards (`[...]` or `...`) match any text inline or zero or more lines when alone on a line.

### Persistent Context

Environment variables, working directory, and bash functions carry across blocks:

````markdown
```console
$ export NAME="world"
```

```console
$ echo "Hello, $NAME!"
Hello, world!
```
````

### Plugins

Replace bash subprocess execution with in-process plugins for up to 8x faster test runs:

```markdown
---
mdtest:
  plugin: ./my-plugin.ts
---
```

### REPL Testing

Test interactive shells with persistent subprocess mode and OSC 133 completion detection:

````markdown
```console cmd="node -i"
$ 1 + 1
2
$ 'hello'.toUpperCase()
'HELLO'
```
````

### Helper Files

Create test fixtures from code fences:

````markdown
```json file=config.json
{ "port": 3000 }
```

```console
$ cat config.json
{ "port": 3000 }
```
````

## CLI

```bash
mdtest <patterns...>          # Run tests
mdtest --update tests/*.md    # Update snapshots
mdtest --dots tests/*.md      # Compact dots reporter
mdtest --tap tests/*.md       # TAP output
```

## Vitest Integration

```typescript
// tests/md.test.ts
import { registerMdTests } from "@beorn/mdtest/vitest"
await registerMdTests("tests/**/*.test.md")
```

```bash
bunx vitest run tests/md.test.ts
```

## Documentation

Full documentation: [https://beorn.github.io/mdtest/](https://beorn.github.io/mdtest/)

## License

MIT
