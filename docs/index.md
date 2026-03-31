---
layout: home

hero:
  name: mdspec
  text: "Executable Markdown Testing"
  tagline: "Documentation drifts from code. READMEs show commands that no longer work. API examples break silently. mdspec makes your docs executable — if the example is wrong, the test fails."
  actions:
    - theme: brand
      text: Get Started
      link: /guide/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/beorn/mdspec

features:
  - title: Executable Docs
    details: Turn CLI documentation into tests. Console code fences become runnable test cases with expected output assertions.
  - title: Pattern Matching
    details: Match dynamic output with ellipsis wildcards, regular expressions, and named captures that can be reused across commands.
  - title: Persistent Context
    details: Environment variables, working directory, and bash functions persist across code blocks within a test file.
  - title: Plugin System
    details: Replace bash subprocess execution with in-process plugins for up to 8x faster test runs.
  - title: REPL Testing
    details: Test interactive shells and REPLs with persistent subprocess mode, PTY support, and OSC 133 completion detection.
  - title: Framework Integration
    details: Run markdown tests through Vitest or Bun alongside your TypeScript test suite.
---

> Early release (0.x) -- API may evolve before 1.0. Requires Bun >= 1.0 and bash/POSIX shell (macOS/Linux; Windows via WSL).
