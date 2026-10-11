// News's tables from a running Setpoint, as JSON on stdout, for a dev seed on real news
// (`npm run seed -- --prod-news`, src/dev/newsSnapshot.ts). Self-contained, node:sqlite only, so it
// runs inside the app's container, whatever its image, read-only:
//
//   docker compose exec -T app node --input-type=module-typescript - < server/src/dev/exportNews.ts > data/news-snapshot/news.json
//
// SETPOINT_DB moves it off the container's database. The images are the data directory's
// news-images/, copied beside the JSON as they are. The host's own steps live in the private ops
// workspace, not here.
import {DatabaseSync} from 'node:sqlite';

const NEWS_TABLES = [
  'news_sources', 'news_articles', 'news_stories', 'news_story_sections', 'news_story_articles', 'news_facts', 'news_images', 'news_events', 'news_sorting',
] as const;

const database = new DatabaseSync(process.env.SETPOINT_DB ?? '/data/setpoint.sqlite', {readOnly: true});
try {
  const tables = Object.fromEntries(NEWS_TABLES.map(table => [table, database.prepare(`select * from ${table}`).all()]));
  process.stdout.write(JSON.stringify({taken_at: new Date().toISOString(), tables}));
} finally {
  database.close();
}
