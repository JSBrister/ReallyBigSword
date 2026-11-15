import { defineConfig } from 'vitest/config';

// Measurement experiments (not pass/fail tests). Run one with:
//   npm run exp -- tools/experiments/moves.exp.ts
export default defineConfig({
  test: { include: ['tools/experiments/**/*.exp.ts'], testTimeout: 120000 },
});
