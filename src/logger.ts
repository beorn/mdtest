/**
 * Logger with auto-detection
 *
 * Uses @beorn/logger if available (when used in km), falls back to debug library.
 * Supports the conditional `?.` pattern for zero-cost when disabled.
 */

// Debug library style: (msg, ...args) - printf-style formatting
type DebugFn = (msg: string, ...args: unknown[]) => void

interface ConditionalLogger {
  debug?: DebugFn
}

const loggers = new Map<string, ConditionalLogger>()

function createFallbackLogger(namespace: string): ConditionalLogger {
  // Dynamic require to avoid bundling debug if not needed
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const createDebug = require("debug") as (
      ns: string
    ) => DebugFn & { enabled: boolean }
    const debug = createDebug(namespace)
    return { debug: debug.enabled ? debug : undefined }
  } catch {
    // debug not installed either
    return { debug: undefined }
  }
}

async function detectLogger(namespace: string): Promise<ConditionalLogger> {
  try {
    const { createConditionalLogger } = await import("@beorn/logger")
    const logger = createConditionalLogger(namespace)
    // Wrap @beorn/logger to accept printf-style args
    if (logger.debug) {
      const originalDebug = logger.debug
      return {
        debug: (msg: string, ...args: unknown[]) => {
          // Format printf-style placeholders
          let i = 0
          const formatted = msg.replace(/%[sdOo]/g, () => {
            const arg = args[i++]
            if (arg === undefined) return ""
            if (arg === null) return "null"
            if (typeof arg === "object") return JSON.stringify(arg)
            return String(arg)
          })
          originalDebug(formatted)
        },
      }
    }
    return { debug: undefined }
  } catch {
    return createFallbackLogger(namespace)
  }
}

/**
 * Get or create a logger for a namespace.
 * Use with optional chaining: `log.debug?.('message')`
 */
export async function getLogger(namespace: string): Promise<ConditionalLogger> {
  let logger = loggers.get(namespace)
  if (!logger) {
    logger = await detectLogger(namespace)
    loggers.set(namespace, logger)
  }
  return logger
}

// Pre-initialize common namespaces
export const log = await getLogger("mdtest:runner")
export const logFiles = await getLogger("mdtest:files")
export const logSession = await getLogger("mdtest:session")
