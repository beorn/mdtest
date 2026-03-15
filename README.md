# mdspec

**_Executable Markdown Testing._**

**Your docs are your tests. Write CLI commands and expected output in markdown code fences — mdspec runs them with persistent shell context, pattern matching, and snapshot updates.**

## Quick Start

```bash
bun add -d mdspec
```

Write a test (`example.spec.md`):

````markdown
# My CLI

```console
$ echo "Hello, mdspec!"
Hello, mdspec!
```

```console
$ date +"%Y"
/\d{4}/
```
````

Run it:

```bash
mdspec example.spec.md
```

When output changes, update snapshots in place:

```bash
mdspec --update example.spec.md
```

## Features

### Pattern Matching

Wildcards, regex, and named captures for dynamic output:

````markdown
```console
$ uuidgen
{{id:/[0-9A-F-]{36}/}}
```
````

Ellipsis wildcards (`[...]` or `...`) match any text inline or across lines.

### Persistent Context

Shell state carries across separate code fences — env vars, working directory, functions all persist within a file:

````markdown
```console
$ export DB="postgres://localhost/myapp"
$ createdb myapp
```

```console
$ my-cli migrate --db "$DB"
Applied 3 migrations.
```
````

### Plugins

Replace shell execution with in-process TypeScript plugins for dramatically faster test runs:

```markdown
---
mdspec:
  plugin: ./my-plugin.ts
---
```

### REPL Testing

Test interactive REPLs with persistent subprocess mode:

````markdown
```console cmd="node -i"
$ 1 + 1
2
$ 'hello'.toUpperCase()
'HELLO'
```
````

### Test Runner Integration

Runs inside Vitest or Bun — same config, reporters, and CI you already have:

```typescript
import { registerMdTests } from "mdspec/vitest"
await registerMdTests("tests/**/*.spec.md")
```

## CLI

```bash
mdspec <patterns...>            # Run tests
mdspec --update tests/*.spec.md # Update snapshots
mdspec --dots tests/*.spec.md   # Compact dots reporter
mdspec --tap tests/*.spec.md    # TAP output
```

## How mdspec Is Different

Most CLI testing tools were built for a specific language ecosystem or require custom file formats. mdspec takes a different approach:

**Standard markdown, not custom formats.** Tests are `.md` files that render on GitHub, in docs sites, and in editors. No `.t` files, no TOML manifests, no new syntax to learn. If you already write console examples in your README, you're halfway there.

**JavaScript-native with in-process plugins.** For JS/TS CLIs, plugins bypass the shell entirely — your test calls your code as a function, not a subprocess. This is unique to mdspec and makes tests dramatically faster.

**Integrated, not standalone.** mdspec runs inside Vitest or Bun's test runner with the same config, reporters, and CI you already have. No separate tool to install, no parallel test pipeline to maintain.

| | mdspec | [Cram](https://bitheap.org/cram/) | [trycmd](https://github.com/assert-rs/trycmd) | [shelltestrunner](https://github.com/simonmichael/shelltestrunner) | [doctest](https://docs.python.org/3/library/doctest.html) |
|---|---|---|---|---|---|
| Ecosystem | JS/TS (Bun) | Python | Rust | Haskell | Python |
| Format | Markdown | `.t` files | TOML + `.md` | Custom | Docstrings |
| In-process | Plugins | No | No | No | Yes |
| Test runner | Vitest, Bun | Standalone | cargo test | Standalone | unittest |
| Persistent context | Across fences | Per block | Per file | No | No |
| Named captures | Yes | No | No | No | No |

## Documentation

Full documentation: [beorn.github.io/mdspec](https://beorn.github.io/mdspec/)

## Security

mdspec executes shell commands from markdown blocks. Do not run it on untrusted content.

## License

MIT
