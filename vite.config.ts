import { defineConfig } from 'vitest/config';

export default defineConfig({
  // GitHub Pages serves the site at /<repo-name>/
  base: '/ReallyBigSword/',
  build: { target: 'es2022', chunkSizeWarningLimit: 6000 },
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 60000,
  },
});
