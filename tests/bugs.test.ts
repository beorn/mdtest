// Tests for bug fixes in mdtest
// Bug 1: km-mdtest.session-exit-code — sessions report exitCode=0 when OSC 133 unavailable
// Bug 2: km-mdtest.before-all-first-block — beforeAll() only works when defined in first block
// Bug 3: km-mdtest.hook-cleanup-no-finally — afterEach/afterAll not protected by try/finally

import { describe, test, expect } from "vitest"
import { CmdSession } from "../src/cmdSession"
import { PtySession } from "../src/ptySession"

const isWindows = process.platform === "win32"

// ============ Bug 1: session-exit-code ============

describe("session exit code when OSC 133 unavailable", () => {
  test("CmdSession returns null exitCode on silence-based completion", async () => {
    // cat echoes input but doesn't emit OSC 133 — exit code is unknown
    const session = new CmdSession("cat", {
      minWait: 50,
      maxWait: 1000,
      useOsc133: false,
    })
    try {
      const result = await session.execute("hello")
      expect(result.stdout.toString().trim()).toBe("hello")
      // Without OSC 133, we don't know the exit code — should be null
      expect(result.exitCode).toBeNull()
    } finally {
      await session.close()
    }
  })

  test("CmdSession returns null exitCode on maxWait timeout", async () => {
    const session = new CmdSession("sleep 10", {
      minWait: 50,
      maxWait: 200,
      useOsc133: false,
    })
    try {
      const result = await session.execute("")
      // Timed out — exit code is unknown
      expect(result.exitCode).toBeNull()
    } finally {
      await session.close()
    }
  })

  test("CmdSession with OSC 133 and maxWait timeout returns null exit code", async () => {
    // When OSC 133 is enabled but no marker received, exit code is null
    // Note: waitForReady() uses Math.max(maxWait, 5000) for startup
    const session = new CmdSession("cat", {
      minWait: 50,
      maxWait: 500,
      useOsc133: true,
    })
    try {
      const result = await session.execute("test")
      // cat doesn't emit OSC 133 — maxWait timeout — exit code unknown
      expect(result.exitCode).toBeNull()
    } finally {
      await session.close()
    }
  }, 15000)

  test.skipIf(isWindows)("PtySession returns null exitCode on silence-based fallback", async () => {
    // cat doesn't emit OSC 133;D — falls back to silence detection
    const session = new PtySession("cat", {
      minWait: 50,
      maxWait: 1000,
    })
    try {
      const result = await session.execute("hello")
      expect(result.stdout.toString().trim()).toBe("hello")
      // Without OSC 133;D marker, exit code is unknown
      expect(result.exitCode).toBeNull()
    } finally {
      await session.close()
    }
  })

  test.skipIf(isWindows)("PtySession returns null exitCode on maxWait timeout", async () => {
    const session = new PtySession("sleep 10", {
      minWait: 50,
      maxWait: 200,
    })
    try {
      const result = await session.execute("")
      // Timed out — exit code is unknown
      expect(result.exitCode).toBeNull()
    } finally {
      await session.close()
    }
  })
})
