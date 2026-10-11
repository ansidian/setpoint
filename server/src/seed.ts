// Loads BRIEF.md's sample data into an empty database, for building and checking the app, with
// News from data/news-snapshot/, real news taken once from prod, when the checkout has one
// (src/dev/newsSnapshot.ts).
//
//   npm run seed                   data/dev/setpoint.sqlite
//   npm run seed -- --reset        deletes that database first
//   npm run seed -- --sample-news  the sample's News all the same (the browser checks')
//   SETPOINT_DATA_DIR=/tmp/sp npm run seed
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {newsSnapshotIn} from './dev/newsSnapshot.ts';
import {seedFile} from './dev/seedFile.ts';

const args = process.argv.slice(2);
const unknown = args.filter(arg => arg !== '--reset' && arg !== '--sample-news');
if (unknown.length) {
  console.error(`Unknown argument: ${unknown.join(' ')}. Usage: npm run seed [-- --reset] [--sample-news]`);
  process.exit(2);
}
const dataDir = process.env.SETPOINT_DATA_DIR?.trim()
  ? path.resolve(process.env.SETPOINT_DATA_DIR)
  : fileURLToPath(new URL('../../data/dev', import.meta.url));
const file = path.join(dataDir, 'setpoint.sqlite');

try {
  const newsSnapshot = args.includes('--sample-news') ? null : newsSnapshotIn(fileURLToPath(new URL('../../data', import.meta.url)));
  const {now, emails, items, stories} = seedFile(file, {reset: args.includes('--reset'), newsSnapshot});
  console.log(`Seeded ${emails} emails, ${items} calendar items and ${stories} news stories into ${file} (now is ${now}).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
