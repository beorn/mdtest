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
CLI (src/index.ts) — standalone runner with reporters
  ├── Markdown parser (src/markdown.ts) — extract headings + code fences
  ├── Core (src/core.ts) — pure parsing + pattern matching
  └── Plugin Executor (src/plugin-executor.ts) — run blocks via plugins
        ├── Loader (src/loader.ts) — resolve + load plugins
        ├── Bash Plugin (src/plugins/bash.ts) — default bash execution
        ├── CmdSession (src/cmdSession.ts) — persistent subprocess (cmd=)
        └── PTY Session (src/ptySession.ts) — interactive shell via PTY

Integrations (src/integrations/)
  ├── shared.ts — common test registration logic
  ├── vitest.ts — Vitest adapter
  ├── bun.ts — Bun test adapter
  └── vitest-plugin.ts — Vite plugin for .test.md transforms
```

## Key Files

| File                                | Purpose                                    |
| ----------------------------------- | ------------------------------------------ |
| `src/index.ts`                      | CLI entry point                            |
| `src/core.ts`                       | Pure functions: parsing, pattern matching  |
| `src/markdown.ts`                   | Markdown parsing, fence extraction         |
| `src/plugin-executor.ts`            | Plugin-based block execution               |
| `src/plugins/bash.ts`               | Default bash plugin with state persistence |
| `src/integrations/shared.ts`        | Common test registration (Bun + Vitest)    |
| `src/integrations/vitest.ts`        | Vitest integration (`registerMdTests`)     |
| `src/integrations/bun.ts`           | Bun test runner integration                |
| `src/integrations/vitest-plugin.ts` | Vite plugin for direct `.test.md` runs     |

## Subpath Exports

```typescript
import { registerMdTests } from "@beorn/mdtest/vitest" // Vitest integration
import { registerMdTests } from "@beorn/mdtest/bun" // Bun integration
import { parseBlock, matchLines } from "@beorn/mdtest/core" // Core parsing/matching
import { shellEscape } from "@beorn/mdtest/shell" // Shell utilities
import type { Plugin, FileOpts, BlockOpts, ReplResult } from "@beorn/mdtest/types" // Plugin types
```

## Code Style

Factory functions, no classes, no globals. ESM imports only. TypeScript strict mode.
