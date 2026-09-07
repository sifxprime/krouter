import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'open-sse': path.resolve(__dirname, './open-sse')
    }
  },
  test: {
    environment: 'node',
    // `next build` copies the whole tree, tests included, into .next/standalone.
    // Vitest's default include would then run every test twice -- once from source
    // and once from a stale build artifact -- so a green suite turns red purely
    // because someone built first.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**'],
  }
});