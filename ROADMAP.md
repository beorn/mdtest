# mdtest Development Roadmap

## In Progress

None - ready for next high priority items

## Planned

### High Priority

**Test Coverage Gaps**

- [ ] **Add tests for stderr redirection** (`2>&1`) - Currently no tests verify this works
- [ ] **Add tests for pipes** (`cmd1 | cmd2`) - Basic pipe functionality not tested
- [ ] **Add tests for combined pipes + redirection** (`cmd1 | cmd2 2>&1`) - Complex shell patterns not tested
- [ ] **Add tests for `!` stderr matching** - Multi-line stderr assertions not tested

### Medium Priority

**Scrut-Inspired Features**

Scrut (Facebook's Rust-based Cram successor) provides a roadmap for mdtest enhancements:

- [ ] **Detached processes** - `console detached` for server/daemon testing
  - Track PIDs, auto-cleanup on test completion
  - Essential for testing servers, watch mode, etc.

- [ ] **Wait-for-file/port** - `console wait=file:/tmp/ready timeout=5s`
  - Block until file exists or port responds
  - Critical for async startup sequences

- [ ] **Per-block config** - YAML frontmatter or extended attributes
  - `console timeout=5s cwd=subdir env=PORT=3000`
  - More granular control than current global options

- [ ] **Pattern quantifiers** - Multi-line pattern matching
  - `(glob+)` - match one or more lines with glob
  - `(regex*)` - match zero or more lines with regex
  - More powerful than current `...` ellipsis

- [ ] **Shell function/alias capture** - Expand state serialization
  - Currently captures env vars and cwd
  - Could capture functions, aliases, shell options

**NOT adopting from Scrut** (intentional decisions):

- Shell-per-block isolation (destroys speed, complicates debugging)
- State file serialization (persistent session is simpler)
- `(esc)` emoji escaping (keep full Unicode)
- Rust binary requirement (zero-dependency philosophy)

**Runtime Portability** (when needed for wider adoption)

- [ ] **Node.js runtime support** - `src/integrations/node.ts`
  - Implement `shell()` using `child_process.spawn()`
  - Same interface as Bun integration
  - Enables mdtest without Bun dependency
  - ~50 LOC (copy Bun integration, swap spawn method)

- [ ] **Deno runtime support** - `src/integrations/deno.ts`
  - Implement `shell()` using `Deno.Command()`
  - Same interface as Bun integration
  - Completes cross-runtime story

**Test Framework Integration** (when needed for wider adoption)

- [ ] **Jest integration** - `src/integrations/jest.ts`
  - Transform `.test.md` files via Jest transformer
  - Uses Node.js integration under the hood
  - Larger user base than Bun

- [ ] **Vitest integration** - `src/integrations/vitest.ts`
  - Plugin for Vitest (similar to Bun integration)
  - Popular in Vue/React ecosystems

**Quality of Life** (when limitations hit)

- [ ] **Better error messages** - Show line numbers, context, suggestions
- [ ] **Multi-file test suites** - Share helper files across test files
- [ ] **Custom matchers** - User-defined pattern matching functions
- [ ] **Custom normalization filters** - Timestamps, paths, PIDs, etc.
- [ ] **Parallel file execution** - Run independent test files in parallel (preserve serial within file)
- [ ] **Watch mode improvements** - Better integration with framework watch modes
- [ ] **Coverage reporting** - Track which commands were tested

### Low Priority

- [ ] CLI enhancements
  - [ ] Add useful CLI flags (e.g., `--bail`, `--timeout`, `--filter`)
  - [ ] Interactive `--update` mode (selective snapshot updates)
  - Note: Bun reporters require `bun test` integration - no programmatic API (bun#5411)
- [ ] Add edge case test coverage (empty fences, nested ellipsis, hook order)
- [ ] Create Cram migration guide (syntax differences, conversion examples)
- [ ] Performance optimizations for large test suites

### Backlog

**Known Issues (not blocking)**

- [ ] **Fix Bun test runner subprocess regression (was working, now broken)**
  - **Tracked**: [Bun issue #24690](https://github.com/oven-sh/bun/issues/24690)
  - **Issue**: `Bun.spawn()` returns empty stdout/stderr when run inside `bun test`
  - **Status**: Bug confirmed and reported to Bun maintainers (Nov 13, 2025)
  - **Minimal reproduction**: `tests/bun-bugs.test.ts` - expects failure, will alert when Bun fixes it
  - **Workaround**: Use mdtest CLI instead of Bun test runner (documented in package.json scripts)
  - **Next steps**: Wait for Bun fix, then re-enable bun test integration

## Rejected

**External Tool Adoption**

After evaluating Cram, Scrut, trycmd, byexample, and mdsh:

- **Cram/byexample** rejected due to Python dependency, isolation issues, no named captures
- **Scrut** is best external tool but lacks named captures, requires Rust binary
- **trycmd** excellent for Rust but not applicable to Bun/TypeScript
- **Decision**: Build mdtest as Bun-native solution, learn from Scrut's feature set

**Smart Bash Parsing**

- **Why rejected**: Bash wrapper is unavoidable for state persistence
- Bun `$` can't capture state changes (need bash `export -p`, `pwd`, `declare -f`)
- Bun `$` can't source files (need bash `source` for hooks)
- Even with perfect bash parser, still need bash wrapper
- Parser libraries (340KB-25MB) add unnecessary dependencies
- **Decision**: Accept bash wrapper, use custom shell adapter for portability

**Other Rejected Approaches:**

- **Parallel execution within files** - Conflicts with session state persistence
- **Direct `bun test file.test.md`** - Bun doesn't support custom file extensions yet
- **Using Bun $ directly** - Can't persist state, can't source files

## Completed

### v0.1 - Core Functionality

**Test Execution:**

- [x] Core markdown parsing with `remark`
- [x] Pattern matching (wildcards, ellipsis, regex, named captures)
- [x] Persistent shell context (env, cwd, functions via `declare -f`)
- [x] Lifecycle hooks (beforeAll, afterAll, beforeEach, afterEach)
- [x] Bun test integration with direct registration
- [x] Standalone CLI with `--update` flag
- [x] Step-based parsing (1:1 cmd→expected mapping)
- [x] Serial file suites (prevent parallel state corruption)
- [x] Hook persistence (state saved after hook execution)
- [x] Markdown-structured output format (heading hierarchy, inline check marks)
- [x] File creation from fences (`file=filename` for all languages)
- [x] Temp directory isolation
- [x] Exit code and stderr testing

**Architecture:**

- [x] Custom shell adapter (`src/integrations/bun.ts`)
- [x] Runtime-portable design (Bun-specific code isolated)
- [x] Bash wrapper strategy (unavoidable, optimized)
- [x] Function persistence using `declare -f`
- [x] Removed Bun `$` dependency

**Code Quality:**

- [x] Standardize path imports to `node:path`
- [x] Fix dynamic import in hot path
- [x] Extract magic constants
- [x] Consolidate test files
- [x] Timeout configuration per block
- [x] Duplicate test ID validation
- [x] Delete unused TestExecutor class
- [x] Use commander.js for CLI argument parsing
- [x] Consolidate markdown parsing to remark
- [x] DRY refactoring - extracted shared shell helpers
- [x] Remove prototype parser code
