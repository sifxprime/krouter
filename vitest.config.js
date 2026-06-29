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
  }
});