import { defineConfig } from 'vitest/config'

// Engine tests run in plain Node, without the Cloudflare and React plugins.
export default defineConfig({
  test: {
    include: ['src/engine/**/*.test.ts'],
  },
})
