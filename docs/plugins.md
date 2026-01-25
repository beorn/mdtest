# mdtest Plugin System

mdtest supports custom plugins to enable in-process command execution, replacing the default bash subprocess execution.

## Overview

By default, mdtest executes console blocks by spawning bash subprocesses for each command. This is flexible but adds ~200ms overhead per command. For test suites with hundreds of commands, this adds up to 30-40 seconds of pure subprocess overhead.

**Plugins solve this** by allowing custom execution engines that can run commands in-process, reducing test time from ~41s to ~5s (8x speedup).

## Plugin Interface

A plugin is a TypeScript module that exports a factory function:

```typescript
import type { Plugin, FileOpts, BlockOpts, ReplResult } from "@beorn/mdtest"

export default function myPlugin(fileOpts: FileOpts): Plugin {
  // File-level initialization

  return {
    // Required: decide whether to handle a block
    block(blockOpts: BlockOpts): ((cmd: string) => Promise<ReplResult>) | null {
      // Return null to fall back to bash
      if (blockOpts.type !== "console") return null

      // Return executor function to handle this block
      return async (cmd: string) => {
        // Execute command and return result
        return {
          stdout: "...",
          stderr: "",
          exitCode: 0,
        }
      }
    },

    // Optional: lifecycle hooks
    async beforeAll(): Promise<void> { },
    async afterAll(): Promise<void> { },
    async beforeEach(): Promise<void> { },
    async afterEach(): Promise<void> { },
  }
}
```

### Types

```typescript
// File-level options passed to plugin factory
interface FileOpts {
  path: string                    // Test file path
  files: Map<string, string>     // file= blocks
  [key: string]: unknown         // Frontmatter options
}

// Block-level options passed to block() method
interface BlockOpts {
  type: string                   // Block language (console, sh, bash)
  content: string                // Raw block text
  heading: string[]              // Heading path
  [key: string]: unknown         // Merged options (frontmatter + heading + fence)
}

// Command execution result
interface ReplResult {
  stdout: string                 // Command output
  stderr: string                 // Error output
  exitCode: number               // Exit code (0 = success)
}
```

## Using Plugins

### Via Frontmatter

Add frontmatter to your test file:

```markdown
---
mdtest:
  plugin: ./my-plugin.ts
  customOption: value
---

# My Tests

\`\`\`console
$ my-command arg1 arg2
expected output
\`\`\`
```

Plugin resolution:
- **Relative path** (starts with `./` or `../`): resolved relative to test file
- **Built-in** name (`bash`): uses built-in plugin
- **Bare specifier** (`@scope/package`): resolved from node_modules

### Options Merging

Options cascade from multiple levels:

```markdown
---
mdtest:
  plugin: ./plugin.ts
  fixture: default     # File-level
---

## Test Suite {fixture=two-columns}  # Heading-level

\`\`\`console fixture=custom reset   # Fence-level
$ command
\`\`\`
```

Priority: **frontmatter** → **heading** → **fence** (later overrides earlier)

## Built-in Bash Plugin

The default `bash` plugin extracts mdtest's current bash execution logic:

```typescript
import { bash } from "@beorn/mdtest/plugins"

export default function myPlugin(opts: FileOpts): Plugin {
  // Use bash for mixed commands
  if (hasMixedCommands) {
    return bash(opts)
  }

  // Custom handling for pure commands
  return { /* ... */ }
}
```

Features:
- State persistence (env vars, cwd, bash functions)
- Hook support (beforeAll, afterEach, etc.)
- Continuation lines (`>`)
- Reset flag support

## Example: km CLI Plugin

Real-world example from the km project:

```typescript
// apps/km-cli/tests/mdtest-plugin.ts
import { $ } from "bun"
import type { Plugin, FileOpts, BlockOpts, ReplResult } from "@beorn/mdtest"

export default function kmPlugin(_opts: FileOpts): Plugin {
  return {
    block(blockOpts: BlockOpts) {
      // Only handle console blocks with km commands
      if (blockOpts.type !== "console") return null

      const commands = extractCommands(blockOpts.content)
      const hasKmCommands = commands.some((c) => c.startsWith("km "))
      const hasOtherCommands = commands.some((c) => !c.startsWith("km "))

      // Only handle pure km command blocks
      if (!hasKmCommands || hasOtherCommands) return null

      // Return executor using bunShell
      return async (cmd: string): Promise<ReplResult> => {
        const kmPath = `${process.env.ROOT}/apps/km-cli/src/index.ts`
        const result = await $\`bash -c ${setupKmFunction(kmPath)} && ${cmd}\`\`.quiet()

        return {
          stdout: result.stdout.toString().trimEnd(),
          stderr: result.stderr.toString().trimEnd(),
          exitCode: result.exitCode,
        }
      }
    },
  }
}
```

Usage in test file:

```markdown
---
mdtest:
  plugin: ../apps/km-cli/tests/mdtest-plugin.ts
---

# KM CLI Tests

\`\`\`console
$ km init .
Created .km directory

$ km list
inbox.md
\`\`\`
```

## Performance Benefits

**Before (bash subprocess per command):**
```
222 commands × 200ms overhead = ~44 seconds
Actual test logic: ~3 seconds
Total: ~47 seconds
```

**After (in-process execution):**
```
222 commands × ~20ms (bun shell) = ~4 seconds
Actual test logic: ~3 seconds
Total: ~7 seconds (~7x speedup)
```

**With true in-process (planned):**
```
222 commands × ~1ms = ~0.2 seconds
Actual test logic: ~3 seconds
Total: ~3 seconds (~15x speedup)
```

## Lifecycle Hooks

Plugins can provide lifecycle hooks for setup/teardown:

```typescript
export default function myPlugin(opts: FileOpts): Plugin {
  let sharedResource: any

  return {
    async beforeAll() {
      // Run once before any blocks
      sharedResource = await initialize()
    },

    async beforeEach() {
      // Run before each block
      await sharedResource.reset()
    },

    async afterEach() {
      // Run after each block (even on failure)
      await sharedResource.cleanup()
    },

    async afterAll() {
      // Run once after all blocks (even on failure)
      await sharedResource.dispose()
    },

    block(opts) { /* ... */ },
  }
}
```

Note: `beforeAll` runs **after** the first block executes, allowing hooks to be defined in the first block (backward compatible with bash behavior).

## State Management

Plugins can maintain state across blocks:

```typescript
export default function statefulPlugin(opts: FileOpts): Plugin {
  // File-level state (persists across blocks)
  let vaultPath: string | null = null
  let connection: any = null

  return {
    block(blockOpts) {
      // Reset state if requested
      if (blockOpts.reset) {
        vaultPath = null
        connection?.close()
        connection = null
      }

      return async (cmd: string) => {
        // Use/update state
        if (!connection) {
          connection = await connect(vaultPath ?? ".")
        }

        return executeWithConnection(connection, cmd)
      }
    },
  }
}
```

## Mixing Plugins and Bash

You can fall back to bash for specific blocks:

```typescript
export default function selectivePlugin(opts: FileOpts): Plugin {
  return {
    block(blockOpts) {
      // Let bash handle setup blocks
      if (blockOpts.heading.includes("Setup")) {
        return null  // Fall back to bash
      }

      // Handle application blocks in-process
      return async (cmd) => executeInProcess(cmd)
    },
  }
}
```

## Best Practices

1. **Start simple:** Use bunShell or similar before building full in-process execution
2. **Test isolation:** Reset state between blocks unless explicitly shared
3. **Graceful fallback:** Return `null` from `block()` to let bash handle edge cases
4. **Handle errors:** Wrap execution in try/catch and return proper exit codes
5. **Document options:** Clearly document what frontmatter options your plugin accepts

## Debugging

Enable debug logging:

```bash
DEBUG=mdtest:* bun run mdtest test.md
```

This shows:
- Plugin loading
- Block handling decisions
- Command execution
- State changes

## Future Enhancements

Planned features:
- Plugin composition (chain multiple plugins)
- Built-in plugins for common tools (npm, git, etc.)
- Snapshot testing support
- Watch mode with fast re-runs
