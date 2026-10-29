import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {name: 'server', include: ['tests/**/*.test.ts', 'src/jobs/tests/**/*.test.ts'], environment: 'node', setupFiles: ['tests/setup.ts']},
});
