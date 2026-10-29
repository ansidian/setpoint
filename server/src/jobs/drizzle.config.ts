// Jobs's migrations (J1), apart from the app's: from server/,
//   npx drizzle-kit generate --config src/jobs/drizzle.config.ts --name <name>
import {defineConfig} from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/jobs/schema.ts',
  out: './src/jobs/drizzle',
});
