// Constants and default values for mdtest
// Centralized to avoid magic numbers scattered across the codebase

/**
 * Default timeout values in milliseconds
 */
export const DEFAULTS = {
  /** Global command timeout (30 seconds) */
  TIMEOUT: 30000,

  /** Maximum output length before truncation in error messages */
  OUTPUT_MAX_LENGTH: 500,

  /** Width for truncating long lines in output */
  TRUNCATE_WIDTH: 70,

  /** CmdSession (pipe-based) defaults */
  CMD_SESSION: {
    /** Milliseconds of silence before assuming command complete */
    MIN_WAIT: 100,
    /** Maximum wait time per command */
    MAX_WAIT: 2000,
    /** Milliseconds to wait for subprocess to be ready (0 = no startup wait) */
    STARTUP_DELAY: 0,
  },

  /** PtySession (PTY-based) defaults */
  PTY_SESSION: {
    /** Milliseconds of silence before assuming command complete */
    MIN_WAIT: 50,
    /** Maximum wait time per command */
    MAX_WAIT: 2000,
    /** Milliseconds to wait for subprocess to be ready */
    STARTUP_DELAY: 300,
  },
} as const;
