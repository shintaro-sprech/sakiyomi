import { defineConfig } from 'vitest/config'

// Tests run in plain Node, without the Cloudflare and React plugins.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
})
