import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      vscode: fileURLToPath(new URL('./tests/mocks/vscode.ts', import.meta.url)),
      'vscode-languageclient/node': fileURLToPath(new URL('./tests/mocks/vscode-languageclient.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    environment: 'node',
    hookTimeout: 20_000,
    testTimeout: 20_000,
  },
});
