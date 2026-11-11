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
    // `.claude/worktrees/` holds this repo's git worktrees, each a full checkout
    // with its own copy of this suite. Without this, a run here globs into them
    // and executes another branch's tests against THIS checkout's source -- which
    // showed up as nine failures that belonged to neither tree.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.next/**', '**/.claude/**'],
    // Drops the developer's HTTP_PROXY / HTTPS_PROXY / ALL_PROXY / NO_PROXY
    // before every test file. Without it, a shell running kRouter's proxy
    // capture mode supplies a resolvable proxy to every request, and the
    // strict-proxy tests pass or fail by machine state. See the file header.
    setupFiles: ['./tests/setup/no-ambient-proxy.js'],
  }
});