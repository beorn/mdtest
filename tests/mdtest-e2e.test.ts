// Wrapper to register mdtest's own .test.md files with Bun test runner
import { registerMdTests } from '../src/integrations/bun.js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const testPattern = join(__dirname, '*.test.md')

await registerMdTests(testPattern)
