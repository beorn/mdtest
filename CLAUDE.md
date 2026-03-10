# mdtest

Bun-native Cram-style markdown testing. Write CLI commands and expected output in `console` code fences — mdtest runs them with persistent shell context, pattern matching, and snapshot updates.

## Commands

```bash
bun test              # Run all tests
bun run typecheck     # Type check
bun run ci            # Full CI suite
bun run docs:dev      # Local docs dev server
```

## Architecture

```
CLI (src/index.ts)
  └── Loader (src/loader.ts) — find + parse .test.md files
        └── Markdown parser (src/markdown.ts) — extract code fences
              └── Executor (src/executor.ts) — run commands, compare output
                    ├── Session (src/session.ts) — persistent env/cwd across blocks
                    ├── PTY Session (src/ptySession.ts) — interactive shell (.slow.)
                    └── Plugin Executor (src/plugin-executor.ts) — in-process plugins
```

## Key Files

| File                         | Purpose                                       |
| ---------------------------- | --------------------------------------------- |
| `src/index.ts`               | CLI entry point                               |
| `src/markdown.ts`            | Markdown parsing, fence extraction            |
| `src/executor.ts`            | Command execution, output matching            |
| `src/session.ts`             | Persistent context (env, cwd, bash functions) |
| `src/integrations/vitest.ts` | Vitest integration (`registerMdTests`)        |
| `src/integrations/bun.ts`    | Bun test runner integration                   |
| `src/plugins/bash.ts`        | In-process bash plugin (up to 8x faster)      |

## Subpath Exports

```typescript
import { registerMdTests } from "@beorn/mdtest/vitest" // Vitest integration
import { registerMdTests } from "@beorn/mdtest/bun" // Bun integration
import { parseFences } from "@beorn/mdtest/core" // Core parsing
import { shellEscape } from "@beorn/mdtest/shell" // Shell utilities
```

## Code Style

Factory functions, no classes, no globals. ESM imports only. TypeScript strict mode.
