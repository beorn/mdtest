# API Reference

## TypeScript Types

mdtest exports its core types for plugin authors and integrations.

### Plugin Types

```typescript
import type { Plugin, FileOpts, BlockOpts, ReplResult, ExecFn, PluginFactory } from "@beorn/mdtest/types"
```

#### `ReplResult`

Result of executing a single command.

```typescript
interface ReplResult {
  stdout: string
  stderr: string
  exitCode: number | null
}
```

#### `FileOpts`

File-level options passed to the plugin factory. Includes all frontmatter options and collected `file=` blocks.

```typescript
interface FileOpts {
  /** Absolute path to the .test.md file */
  path: string
  /** All file= blocks: filename -> content */
  files: Map<string, string>
  /** Frontmatter options (excluding 'plugin' field) */
  [key: string]: unknown
}
```

#### `BlockOpts`

Block-level options passed to `plugin.block()`. Options are pre-merged from frontmatter, heading attributes, and fence info.

```typescript
interface BlockOpts {
  /** Block language: console, sh, bash, json, etc. */
  type: string
  /** Raw block content */
  content: string
  /** Heading path: ['Setup', 'Basic'] */
  heading: string[]
  /** If file="...", the filename */
  file?: string
  /** Pre-merged options from all levels */
  [key: string]: unknown
}
```

#### `Plugin`

The plugin interface. The `block()` method is required; lifecycle hooks are optional.

```typescript
interface Plugin {
  block(opts: BlockOpts): ExecFn | null
  beforeAll?(): Promise<void>
  afterAll?(): Promise<void>
  beforeEach?(): Promise<void>
  afterEach?(): Promise<void>
}
```

#### `ExecFn`

Function to execute a single command. Return `null` to indicate "not handled" (falls back to the next handler).

```typescript
type ExecFn = (cmd: string) => Promise<ReplResult | null>
```

#### `PluginFactory`

Factory function that creates a plugin instance from file-level options.

```typescript
type PluginFactory = (opts: FileOpts) => Plugin | Promise<Plugin>
```

### API Types

```typescript
import type { BlockOptions, CommandResult, HeadingResult, FileResult } from "@beorn/mdtest/api"
```

#### `BlockOptions`

Options that can be set on a code fence.

```typescript
interface BlockOptions {
  exit?: number
  cwd?: string
  env?: Record<string, string>
  reset?: boolean
  timeout?: number
  cmd?: string
  minWait?: number
  maxWait?: number
  startupDelay?: number
  pty?: boolean
}
```

#### `CommandResult`

Result of a single command execution within a block.

```typescript
interface CommandResult {
  command: string
  displayName: string
  passed: boolean
  duration: number
  stdout: string[]
  stderr: string[]
  exitCode: number
  expected?: {
    stdout: string[]
    stderr: string[]
    exitCode: number
  }
  diff?: string
}
```

#### `HeadingResult`

Result for a heading section containing one or more commands.

```typescript
interface HeadingResult {
  level: number
  title: string
  slug: string
  path: string[]
  commands: CommandResult[]
}
```

#### `FileResult`

Result for an entire test file.

```typescript
interface FileResult {
  path: string
  headings: HeadingResult[]
  totalCommands: number
  passedCommands: number
  duration: number
}
```

## Integrations

### Vitest

```typescript
import { registerMdTests } from "@beorn/mdtest/vitest"
await registerMdTests("tests/**/*.test.md")
```

### Bun

```typescript
import { registerMdTests } from "@beorn/mdtest/bun"
await registerMdTests("tests/**/*.test.md")
```

### Single File Registration

```typescript
import { registerMdTestFile } from "@beorn/mdtest/vitest"
await registerMdTestFile("tests/specific.test.md")
```

## Built-in Plugins

### Bash

The default bash plugin is available for composition:

```typescript
import { bash } from "@beorn/mdtest/plugins/bash"
```
