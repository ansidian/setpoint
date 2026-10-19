import {defineConfig} from 'vitest/config';

// Each tested workspace has its own config.
export default defineConfig({
  test: {projects: ['server', 'web', 'web/vitest.components.config.ts']},
});
