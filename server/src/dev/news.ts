// BRIEF.md › Sample data › News (round 3) as rows, so the News page can be built before ingest (N2)
// and sorting (N3) exist. The outlets and companies are real and every event is invented (incidents
// happen to Fabrikam); local stories stay at the level of Los Angeles. The user last looked Mon at 10:40
// PM, so a story seen then and given a fact since is updated (◐), one never seen is new (●).
//
// - All: Local, Tech, AI and General with the brief's stories, then enough more for "12 more in
//   Local", "7 more in Tech", "4 more in AI" and "9 more in General" (one AI story is also General's).
// - Missed: 14 stories that left the page unseen on Tuesday (Local 3, Tech 2, AI 4, General 5): their
//   last facts came on Sunday, 48 hours before. They're archived as the expiry leaves them: no facts,
//   no text, only their own image's large copy and thumbnail.
// - Upcoming: the Apple event, Tue Oct 20 at 10 AM, from the invites story.
// - Sources: the built-in list and the local stand-ins, with invented `.example` URLs for anything
//   not on the built-in list, all `dev` so nothing ever fetches them. FOX 11 is failing (board 30a).
// - Images are invented tinted gradients, kept through the same image store as real copies.
import {SEED_NOW, SEED_TIME_ZONE} from '@setpoint/shared';
import type {NewsSection} from '@setpoint/shared';
import * as t from '../db/schema.ts';
import {zonedInstant} from '../domain/time.ts';
import {expiresAt} from '../domain/news.ts';
import {saveNewsImage} from '../news/images.ts';
import {DEFAULT_NEWS_SOURCES, sourceValues} from '../news/sources.ts';
import type {NewsSourceSpec} from '../news/sources.ts';
import {transaction} from '../store.ts';
import type {Store} from '../store.ts';
import {LARGE_SIZE, THUMB_SIZE, tintedImage} from './newsImages.ts';

const MINUTE = 60_000;
const DAYS = {sun: '2026-10-04', mon: '2026-10-05', tue: '2026-10-06', wed: '2026-10-07'} as const;
const at = (day: keyof typeof DAYS, time: string) => zonedInstant(DAYS[day], time, SEED_TIME_ZONE);

/** When the user last looked at News: Mon, Oct 5, 10:40 PM. */
export const NEWS_LAST_LOOKED = at('mon', '22:40');

// ---- Sources ----

const example = (slug: string, path = 'feed') => `https://${slug}.example/${path}`;
const local = (key: string, name: string, url: string, reads = 'Feed', extra: Partial<NewsSourceSpec> = {}): NewsSourceSpec =>
  ({key: `local:${key}`, name, section: 'local', kind: 'feed', adapter: 'feed', url, reads, ...extra});
const other = (key: string, name: string, section: NewsSection): NewsSourceSpec =>
  ({key: `seed:${key}`, name, section, kind: 'feed', adapter: 'feed', url: example(key), reads: 'Feed'});

/** The local list's stand-ins (D91 keeps the real one out of the repository). */
const SEED_LOCAL: NewsSourceSpec[] = [
  local('ktla', 'KTLA · Local news', example('ktla', 'news/local/feed/'), 'Feed, summary only', {summaryOnly: true, icon: 'live_tv'}),
  local('nbc-la', 'NBC Los Angeles · Local', example('nbclosangeles', 'news/local/?rss=y'), 'Feed and two area tags', {icon: 'live_tv'}),
  local('cbs-la', 'CBS Los Angeles', example('cbsnews', 'losangeles/latest/rss/local-news'), 'Feed, Local News only', {icon: 'live_tv'}),
  local('fox-11', 'FOX 11 · Local news', example('foxla', 'tag/local-news/feed'), 'Feed', {icon: 'live_tv'}),
  local('abc7', 'ABC7 · Local', example('abc7', 'feed/local'), 'Feed', {icon: 'live_tv'}),
  local('laist', 'LAist', example('laist', 'index.atom')),
  local('streetsblog-la', 'Streetsblog LA', example('streetsblogla')),
  local('county-crime-wire', 'County crime wire', example('sheriff', 'newsroom/feed'), 'Feed', {icon: 'local_police'}),
  local('la-county', 'LA County newsroom', example('lacounty', 'news/feed')),
  local('aqmd', 'South Coast AQMD advisories', example('aqmd', 'advisories/rss'), 'Feed, advisories'),
  local('la-times', 'Los Angeles Times', example('latimes', 'local/rss2.0.xml'), 'Feed; counts toward stories, never shown', {metered: true}),
  {key: 'local:google-news-area', name: 'Google News · area search', section: 'local', kind: 'discovery', adapter: 'google_news', url: null,
    reads: 'Finds stories, never read', config: {query: '"Los Angeles"'}},
];

/** Outlets the sample cites that aren't on either list. */
const SEED_OTHERS: NewsSourceSpec[] = [
  other('9to5mac', '9to5Mac', 'tech'), other('engadget', 'Engadget', 'tech'), other('android-authority', 'Android Authority', 'tech'),
  other('venturebeat', 'VentureBeat · AI', 'ai'), other('wired', 'Wired · AI', 'ai'), other('zdnet', 'ZDNET · AI', 'ai'),
  other('axios', 'Axios', 'general'), other('reuters', 'Reuters · US', 'general'),
  other('usa-today', 'USA Today', 'general'), other('ap-news', 'AP News · US', 'general'), other('cnn', 'CNN · US', 'general'),
];

/** Each outlet the sample cites: the source its articles come through, and its short name for rows. */
const OUTLETS: Record<string, {source: string; short?: string}> = {
  'KTLA': {source: 'local:ktla'}, 'NBC Los Angeles': {source: 'local:nbc-la', short: 'NBC LA'}, 'CBS Los Angeles': {source: 'local:cbs-la', short: 'CBS LA'},
  'FOX 11': {source: 'local:fox-11'}, 'ABC7': {source: 'local:abc7'}, 'LAist': {source: 'local:laist'}, 'Streetsblog LA': {source: 'local:streetsblog-la'},
  'LA County': {source: 'local:la-county'}, 'South Coast AQMD': {source: 'local:aqmd'}, 'Los Angeles Times': {source: 'local:la-times'},
  'Daily News': {source: 'local:google-news-area'}, 'NWS': {source: 'nws-alerts'}, 'USGS': {source: 'usgs-earthquakes'},
  'The Verge': {source: 'the-verge-tech'}, 'MacRumors': {source: 'macrumors'}, '9to5Google': {source: '9to5google'}, '9to5Mac': {source: 'seed:9to5mac'},
  'Engadget': {source: 'seed:engadget'}, 'TechCrunch': {source: 'techcrunch-ai'}, 'Android Authority': {source: 'seed:android-authority'},
  'Apple': {source: 'apple-newsroom'}, 'Google': {source: 'google-products'}, 'Samsung': {source: 'samsung-newsroom'}, 'Microsoft': {source: 'microsoft-news'},
  'Anthropic': {source: 'anthropic-news'}, 'OpenAI': {source: 'openai-news'}, 'Google DeepMind': {source: 'google-deepmind'}, 'Hugging Face': {source: 'hugging-face'},
  'Mistral AI': {source: 'mistral-news', short: 'Mistral'}, 'Ars Technica': {source: 'ars-technica-ai'}, 'VentureBeat': {source: 'seed:venturebeat'},
  'Wired': {source: 'seed:wired'}, 'ZDNET': {source: 'seed:zdnet'}, 'Axios': {source: 'seed:axios'},
  'NPR': {source: 'npr-national'}, 'PBS News': {source: 'pbs-newshour'}, 'ABC News': {source: 'abc-news'}, 'CBS News': {source: 'cbs-news'},
  'NBC News': {source: 'nbc-news'}, 'The Guardian': {source: 'guardian-us'}, 'BBC News': {source: 'bbc-us'}, 'Courthouse News': {source: 'courthouse-news'},
  'Reuters': {source: 'seed:reuters'}, 'USA Today': {source: 'seed:usa-today'}, 'AP News': {source: 'seed:ap-news'}, 'CNN': {source: 'seed:cnn'},
};

/** Each source's last check before SEED_NOW, in minutes (board 30a: "Checked 9:10 AM"); 2 unless listed. */
const CHECKED_AGO: Record<string, number> = {
  'local:ktla': 2, 'local:nbc-la': 2, 'local:cbs-la': 4, 'local:county-crime-wire': 1, 'nws-alerts': 1, 'usgs-earthquakes': 1, 'cal-fire': 2,
  'local:google-news-area': 14, 'apple-newsroom': 3, 'the-verge-tech': 3,
};

// ---- Stories ----

interface SampleArticle {
  outlet: string;
  at: string;
  headline?: string;
  byline?: string;
  feedSummary?: string;
  text?: string;
  // The image's hue, for an article with one.
  image?: number;
  discovery?: boolean;
}

interface SampleStory {
  sections: NewsSection[];
  headline: string;
  oneLine?: string;
  summary?: string;
  // N3's ranking, 0–100; a block shows its top three and up to two more scoring 70 or over.
  score: number;
  first: string;
  // [at, fact], oldest first; the last is the last new fact.
  facts: [string, string][];
  // Seen when the user last looked.
  seen?: true;
  // The leading outlet's article first, then the others; a string is an outlet whose article carries
  // the story's headline, a little before the lead's.
  articles: [SampleArticle, ...(SampleArticle | string)[]];
  // Left the page before the user saw it: archived, in Missed.
  missed?: true;
  upcoming?: {name: string; startsAt: string};
}

const NBC_FIRE_TEXT = `A brush fire in the hills above the 210 Freeway grew to about 400 acres overnight, fire officials said Wednesday morning, as crews worked to keep it away from homes in the foothills.

Evacuation warnings went out late Tuesday for neighborhoods north of the freeway. No homes had been damaged as of 7 a.m., and no one had been hurt.

Firefighters held the fire's western edge through the night with help from water-dropping helicopters. Containment stood at 10%.

A Red Flag Warning takes effect at noon and runs through Thursday evening, with gusts up to 50 mph and humidity below 10% expected across the valleys.

Two schools inside the warning area closed for the day. Officials asked residents to keep their cars fueled and to sign up for the county's emergency alerts.`;

/** A Missed story: last facts on Sunday, so it left the page on Tuesday, 48 hours later. */
const gone = (time: string) => ({first: at('sun', time), facts: [[at('sun', time), 'First reported']] as [string, string][], missed: true as const});

export const SAMPLE_STORIES: SampleStory[] = [
  // ---- Local: 5 in the block, then 12 more ----
  {sections: ['local'], headline: 'Brush fire near the 210 grows to 400 acres', oneLine: 'Evacuation warnings for foothill homes; crews held the west flank overnight',
    summary: 'A brush fire near the 210 grew from 150 to 400 acres overnight. Evacuation warnings cover foothill homes north of the freeway. Crews held the west flank, and winds are forecast to pick up this afternoon under a Red Flag Warning.',
    score: 95, first: at('mon', '06:12'), seen: true,
    facts: [
      [at('mon', '06:12'), 'A brush fire broke out in the hills above the 210; about 60 acres'],
      [at('mon', '21:30'), 'Grew to 150 acres; crews on the west flank'],
      [at('wed', '06:55'), 'Two schools in the warning area are closed for the day'],
      [at('wed', '08:40'), 'Grew from 150 to 400 acres overnight; evacuation warnings widened'],
    ],
    articles: [
      {outlet: 'KTLA', at: at('wed', '08:02'), headline: 'Brush fire near the 210 explodes overnight, prompting warnings', image: 18,
        feedSummary: 'A brush fire burning above the 210 Freeway grew to roughly 400 acres overnight, forcing evacuation warnings for foothill neighborhoods as crews braced for gusty Red Flag conditions expected by noon Wednesday.'},
      {outlet: 'NBC Los Angeles', at: at('wed', '07:10'), headline: 'Fire burns 400 acres in the foothills; evacuation warnings issued', byline: 'Staff report', text: NBC_FIRE_TEXT, image: 28},
      {outlet: 'Los Angeles Times', at: at('wed', '07:30'), headline: 'Foothill fire reaches 400 acres as warnings spread'},
      {outlet: 'CBS Los Angeles', at: at('wed', '06:05'), headline: 'Crews battle brush fire as Red Flag conditions loom'},
      {outlet: 'ABC7', at: at('wed', '05:01'), headline: 'Brush fire near 210 Freeway prompts evacuation warnings'},
      {outlet: 'FOX 11', at: at('wed', '03:10'), headline: 'Brush fire breaks out near the 210'},
    ]},
  {sections: ['local'], headline: 'Red Flag Warning for the valleys until Thu 6 PM', oneLine: 'Gusts to 50 mph, humidity under 10%',
    summary: 'The National Weather Service issued a Red Flag Warning for the valleys from noon today until Thursday at 6 PM. Gusts may reach 50 mph with humidity under 10%, so any fire could spread quickly.',
    score: 90, first: at('wed', '06:12'), facts: [[at('wed', '06:12'), 'Red Flag Warning issued from noon today until Thu 6 PM']],
    articles: [{outlet: 'NWS', at: at('wed', '06:12'), headline: 'Red Flag Warning issued for the valleys'}]},
  {sections: ['local'], headline: 'Man arrested after a stabbing outside a Metro station', oneLine: 'The victim is in stable condition',
    summary: 'A man was stabbed outside a Metro station on Monday evening. The victim is in stable condition, and police arrested a suspect this morning.',
    score: 85, first: at('mon', '20:35'), seen: true,
    facts: [[at('mon', '20:35'), 'A man was stabbed outside a Metro station and taken to a hospital'], [at('mon', '21:50'), 'The victim is in stable condition'], [at('wed', '07:55'), 'Suspect arrested']],
    articles: [{outlet: 'NBC Los Angeles', at: at('wed', '04:12'), image: 205}, {outlet: 'LAist', at: at('wed', '07:58'), headline: 'Police arrest a suspect in the Metro station stabbing'}, 'CBS Los Angeles']},
  {sections: ['local'], headline: 'Federal agents detain 9 at a car wash', oneLine: 'Neighbors gathered to film; two were released by evening',
    summary: 'Federal immigration agents detained nine workers at a car wash on Monday afternoon as neighbors gathered to film. Two were released by evening.',
    score: 78, first: at('mon', '13:05'), seen: true,
    facts: [[at('mon', '13:05'), 'Federal agents detained 9 workers at a car wash'], [at('mon', '19:30'), 'Two were released by evening']],
    articles: [{outlet: 'LAist', at: at('tue', '15:20'), image: 40}, 'KTLA', 'NBC Los Angeles', 'CBS Los Angeles']},
  {sections: ['local'], headline: 'Council approves a 120-unit housing project on a former parking lot', oneLine: 'Construction could start next spring',
    score: 72, first: at('mon', '12:40'), seen: true, facts: [[at('mon', '12:40'), 'The council approved the project 11 to 3']],
    articles: [{outlet: 'Streetsblog LA', at: at('mon', '12:40')}]},
  {sections: ['local'], headline: 'Water main break floods an intersection; repairs through Thursday', oneLine: 'Detours on two blocks; no service loss for nearby homes',
    score: 66, first: at('wed', '03:50'), facts: [[at('wed', '03:50'), 'A water main broke under an intersection']],
    articles: [{outlet: 'ABC7', at: at('wed', '04:12'), image: 195}, 'KTLA', 'LAist']},
  {sections: ['local'], headline: 'M3.4 earthquake near the foothills, felt lightly across the valleys', oneLine: 'No damage reported',
    score: 64, first: at('wed', '02:05'), facts: [[at('wed', '02:05'), 'A magnitude 3.4 earthquake struck near the foothills']],
    articles: [{outlet: 'USGS', at: at('wed', '02:12')}, 'KTLA', 'NBC Los Angeles', 'ABC7']},
  {sections: ['local'], headline: 'Smoke advisory for the valleys through Thursday', oneLine: 'Air quality may reach unhealthy levels near the fire',
    score: 62, first: at('wed', '01:12'), facts: [[at('wed', '01:12'), 'A smoke advisory runs through Thursday']],
    articles: [{outlet: 'South Coast AQMD', at: at('wed', '01:12')}, 'KTLA']},
  {sections: ['local'], headline: 'Three Metro stations close this weekend for track work', oneLine: 'Shuttle buses replace trains Saturday and Sunday',
    score: 58, first: at('wed', '05:00'), facts: [[at('wed', '05:00'), 'Three stations close Saturday and Sunday']],
    articles: [{outlet: 'LAist', at: at('wed', '05:12'), image: 280}, 'NBC Los Angeles']},
  {sections: ['local'], headline: 'County opens cooling centers as temperatures reach 100°', oneLine: 'Libraries and senior centers stay open until 8 PM',
    score: 55, first: at('mon', '16:00'), seen: true, facts: [[at('mon', '16:00'), 'Cooling centers open through Thursday']],
    articles: [{outlet: 'LA County', at: at('tue', '11:00'), image: 35}, 'ABC7', 'KTLA']},
  {sections: ['local'], headline: 'Pedestrian killed in a hit-and-run; police look for a white pickup', oneLine: 'The crash happened just after 11 PM',
    score: 54, first: at('tue', '23:20'), facts: [[at('tue', '23:20'), 'A pedestrian was killed by a driver who didn\'t stop']],
    articles: [{outlet: 'NBC Los Angeles', at: at('tue', '23:40'), image: 220}, 'KTLA']},
  {sections: ['local'], headline: 'Overnight ramp closures on the 5 through Saturday', oneLine: 'Ramps shut from 10 PM to 5 AM for paving',
    score: 50, first: at('wed', '03:40'), facts: [[at('wed', '03:40'), 'Overnight ramp closures begin tonight']],
    articles: [{outlet: 'CBS Los Angeles', at: at('wed', '03:40')}, 'KTLA']},
  {sections: ['local'], headline: 'Teachers union and the district reach a tentative contract', oneLine: 'Members vote next week',
    score: 48, first: at('tue', '18:00'), facts: [[at('tue', '18:00'), 'A tentative agreement was reached']],
    articles: [{outlet: 'LAist', at: at('tue', '18:00'), image: 260}, 'KTLA', 'NBC Los Angeles']},
  {sections: ['local'], headline: 'Two arrested in a string of catalytic converter thefts', oneLine: 'Police recovered 30 converters from a storage unit',
    score: 46, first: at('tue', '09:30'), facts: [[at('tue', '09:30'), 'Two people were arrested']],
    articles: [{outlet: 'KTLA', at: at('tue', '09:30'), image: 10}, 'CBS Los Angeles']},
  {sections: ['local'], headline: 'Beach water advisory after a sewage spill', oneLine: 'Avoid the water near two piers until tests come back clean',
    score: 44, first: at('tue', '14:10'), facts: [[at('tue', '14:10'), 'A water advisory covers two piers']],
    articles: [{outlet: 'ABC7', at: at('tue', '14:10')}, 'LA County']},
  {sections: ['local'], headline: 'Library branch reopens after a two-year renovation', oneLine: 'New study rooms and a maker space',
    score: 40, first: at('mon', '15:00'), seen: true, facts: [[at('mon', '15:00'), 'The branch reopened']],
    articles: [{outlet: 'LAist', at: at('mon', '15:00'), image: 48}]},
  // Found only by Google News: its headline and link, no text.
  {sections: ['local'], headline: 'Four bus lines get more frequent service from Sunday', oneLine: 'Buses every 10 minutes at rush hour',
    score: 38, first: at('mon', '17:20'), seen: true, facts: [[at('mon', '17:20'), 'Service changes take effect Sunday']],
    articles: [{outlet: 'Daily News', at: at('mon', '17:20'), discovery: true}]},

  // ---- Tech: 3 in the block (with Upcoming), then 7 more ----
  {sections: ['tech'], headline: 'Pixel Watch 5 goes on sale with two-day battery life', oneLine: 'From $349; preorders ship Friday',
    summary: 'Google\'s Pixel Watch 5 is on sale from $349, with battery life Google puts at two days. Preorders ship Friday.',
    score: 88, first: at('wed', '07:00'), facts: [[at('wed', '07:00'), 'Pixel Watch 5 on sale from $349']],
    articles: [{outlet: 'The Verge', at: at('wed', '07:12'), image: 150}, '9to5Google', 'Engadget', 'Google', 'Android Authority', 'TechCrunch']},
  {sections: ['tech'], headline: 'Samsung opens the One UI 9 beta to Galaxy S26 owners in the US', oneLine: 'Sign-ups open in the Members app today',
    score: 80, first: at('wed', '03:00'), facts: [[at('wed', '03:00'), 'The beta opened in the US']],
    articles: [{outlet: '9to5Google', at: at('wed', '03:12'), image: 230}, 'Samsung', 'Android Authority']},
  {sections: ['tech'], headline: 'Apple sends invites for an Oct 20 event', oneLine: 'Expected: new iPads and Macs',
    summary: 'Apple sent invites for an event on Tuesday, Oct 20, at 10 AM Pacific. New iPads and Macs are expected.',
    score: 75, first: at('mon', '20:15'), seen: true, facts: [[at('mon', '20:15'), 'Apple sent invites for Tue, Oct 20, 10 AM']],
    articles: [{outlet: 'MacRumors', at: at('tue', '10:05'), image: 0}, '9to5Mac', 'The Verge', 'Engadget', 'TechCrunch', 'Apple', 'Ars Technica'],
    upcoming: {name: 'Apple event', startsAt: zonedInstant('2026-10-20', '10:00', SEED_TIME_ZONE)}},
  {sections: ['tech'], headline: 'visionOS 26.1 brings shared Personas to group FaceTime calls', oneLine: 'Up to five people in one space',
    score: 66, first: at('wed', '05:20'), facts: [[at('wed', '05:20'), 'visionOS 26.1 released']],
    articles: [{outlet: 'MacRumors', at: at('wed', '05:30'), image: 270}, '9to5Mac', 'The Verge', 'Apple', 'Engadget']},
  {sections: ['tech'], headline: 'Microsoft brings Copilot to Windows taskbar search for everyone', oneLine: 'Rolling out over the next two weeks',
    score: 64, first: at('wed', '01:30'), facts: [[at('wed', '01:30'), 'The rollout began']],
    articles: [{outlet: 'Microsoft', at: at('wed', '01:30'), image: 200}, 'The Verge', 'Engadget', 'TechCrunch']},
  {sections: ['tech'], headline: 'Chrome syncs tab groups to iPhone and iPad', oneLine: 'Groups made on a computer now show up on iOS',
    score: 60, first: at('tue', '16:00'), facts: [[at('tue', '16:00'), 'Tab group sync reached iOS']],
    articles: [{outlet: 'Google', at: at('tue', '16:00')}, '9to5Google']},
  {sections: ['tech'], headline: 'Apple releases iOS 26.0.2 with a fix for Wi-Fi drops', oneLine: 'Also fixes a Messages crash',
    score: 58, first: at('tue', '11:00'), facts: [[at('tue', '11:00'), 'iOS 26.0.2 released']],
    articles: [{outlet: 'MacRumors', at: at('tue', '11:00'), image: 210}, '9to5Mac', 'Apple', 'The Verge']},
  {sections: ['tech'], headline: 'Galaxy Tab S11 FE goes on sale in the US', oneLine: 'From $499 with a pen in the box',
    score: 52, first: at('tue', '08:00'), facts: [[at('tue', '08:00'), 'On sale in the US']],
    articles: [{outlet: 'Samsung', at: at('tue', '08:00'), image: 240}, '9to5Google', 'Engadget']},
  {sections: ['tech'], headline: 'Google Maps adds live lane guidance to more cars', oneLine: 'Cars with Google built-in from four more makers',
    score: 50, first: at('mon', '18:00'), seen: true, facts: [[at('mon', '18:00'), 'Lane guidance reached more cars']],
    articles: [{outlet: '9to5Google', at: at('mon', '18:00')}, 'Google']},
  {sections: ['tech'], headline: 'Edge adds a password health check', oneLine: 'It flags reused and leaked passwords',
    score: 47, first: at('tue', '13:00'), facts: [[at('tue', '13:00'), 'The check is in Edge 141']],
    articles: [{outlet: 'The Verge', at: at('tue', '13:00')}, 'Microsoft']},

  // ---- AI: 4 in the block, then 4 more ----
  {sections: ['ai'], headline: 'Anthropic releases Claude Haiku 5.5', oneLine: 'Faster and cheaper, available in the API and Claude apps today',
    summary: 'Anthropic released Claude Haiku 5.5, its fastest model, at a lower price than the last one. It\'s available today in the API and the Claude apps.',
    score: 96, first: at('wed', '07:05'), facts: [[at('wed', '07:05'), 'Claude Haiku 5.5 released in the API and Claude apps']],
    articles: [{outlet: 'Anthropic', at: at('wed', '07:12'), image: 25}, 'The Verge', 'TechCrunch', 'Ars Technica', 'VentureBeat', 'Wired', 'Engadget', 'Axios', 'ZDNET']},
  {sections: ['ai'], headline: 'Fabrikam Hub resets every access token after a leak', oneLine: 'Tokens from Sep 28 to Oct 5 may be exposed',
    summary: 'Fabrikam Hub, a model hosting service, reset every access token after finding a leak. Tokens created from Sep 28 to Oct 5 may have been exposed. The company says no models were altered.',
    score: 84, first: at('mon', '19:00'), seen: true,
    facts: [[at('mon', '19:00'), 'Fabrikam Hub found a token leak and reset every token'], [at('mon', '21:00'), 'Tokens from Sep 28 to Oct 5 may be exposed'], [at('wed', '06:30'), 'Fabrikam says no models were altered']],
    articles: [{outlet: 'Ars Technica', at: at('wed', '00:12'), image: 0}, 'The Verge', 'TechCrunch', 'Wired', 'VentureBeat']},
  {sections: ['ai'], headline: 'Gemini app adds scheduled tasks on Android', oneLine: 'Ask it to do something every morning',
    score: 76, first: at('wed', '02:00'), facts: [[at('wed', '02:00'), 'Scheduled tasks reached Android']],
    articles: [{outlet: 'Google', at: at('wed', '02:12')}, '9to5Google', 'Android Authority']},
  {sections: ['ai'], headline: 'OpenAI testifies before a Senate committee on AI safety', oneLine: 'Senators asked about testing before release',
    score: 71, first: at('mon', '17:30'), seen: true,
    facts: [[at('mon', '17:30'), 'OpenAI agreed to testify before the Senate Commerce Committee'], [at('mon', '21:45'), 'The hearing focuses on testing before release']],
    articles: [{outlet: 'NPR', at: at('tue', '14:00'), image: 215}, 'The Verge', 'Axios', 'The Guardian', 'CBS News', 'TechCrunch']},
  {sections: ['ai'], headline: 'Hugging Face adds hosted inference for open video models', oneLine: 'Pay per second of video generated',
    score: 62, first: at('tue', '09:00'), facts: [[at('tue', '09:00'), 'Video inference launched']],
    articles: [{outlet: 'Hugging Face', at: at('tue', '09:00'), image: 45}, 'VentureBeat']},
  {sections: ['ai'], headline: 'OpenAI adds memory controls for ChatGPT teams', oneLine: 'Admins can turn memory off for a workspace',
    score: 60, first: at('wed', '00:30'), facts: [[at('wed', '00:30'), 'Memory controls released']],
    articles: [{outlet: 'OpenAI', at: at('wed', '00:30'), image: 160}, 'The Verge', 'TechCrunch', 'Engadget']},
  // In AI and General: its seen state is shared.
  {sections: ['ai', 'general'], headline: 'A federal rule on AI chip exports takes effect', oneLine: 'Licenses now needed for sales to 40 more countries',
    score: 58, first: at('tue', '21:00'), facts: [[at('tue', '21:00'), 'The rule took effect at midnight Eastern']],
    articles: [{outlet: 'Reuters', at: at('tue', '21:00')}, 'NPR', 'Axios', 'The Guardian', 'CBS News']},
  {sections: ['ai'], headline: 'Google DeepMind publishes a weather model that forecasts 15 days out', oneLine: 'Open weights for research use',
    score: 52, first: at('mon', '15:30'), seen: true, facts: [[at('mon', '15:30'), 'The model and paper were published']],
    articles: [{outlet: 'Google DeepMind', at: at('mon', '15:30'), image: 190}, 'Ars Technica', 'The Verge']},

  // ---- General: 3 in the block, then 9 more (the chip rule above is one) ----
  {sections: ['general'], headline: 'Hurricane Teresa makes landfall in the Florida Panhandle as a Category 3', oneLine: 'About 400,000 without power',
    summary: 'Hurricane Teresa came ashore in the Florida Panhandle early this morning as a Category 3 storm. About 400,000 homes and businesses are without power, and storm surge flooded coastal roads.',
    score: 97, first: at('tue', '20:00'), facts: [[at('tue', '20:00'), 'Teresa strengthened to a Category 3'], [at('wed', '04:40'), 'Landfall in the Florida Panhandle']],
    articles: [{outlet: 'NPR', at: at('wed', '06:12'), image: 210}, 'ABC News', 'CBS News', 'NBC News', 'PBS News', 'The Guardian', 'BBC News', 'Reuters', 'USA Today', 'Axios', 'AP News', 'CNN']},
  {sections: ['general'], headline: 'Federal judge blocks a rule ending work permits for asylum seekers', oneLine: 'The rule was to take effect Friday',
    score: 86, first: at('wed', '03:00'), facts: [[at('wed', '03:00'), 'A federal judge blocked the rule nationwide']],
    articles: [{outlet: 'Courthouse News', at: at('wed', '03:12')}, 'NPR', 'Reuters', 'The Guardian', 'CBS News']},
  {sections: ['general'], headline: 'Four killed in a warehouse shooting in Ohio; suspect in custody', oneLine: 'The shooting happened during a shift change',
    score: 82, first: at('mon', '18:30'), seen: true,
    facts: [[at('mon', '18:30'), 'Four people were killed in a shooting at an Ohio warehouse'], [at('mon', '20:10'), 'Police are searching for the gunman'], [at('wed', '07:10'), 'Suspect in custody']],
    articles: [{outlet: 'ABC News', at: at('wed', '01:12'), image: 350}, 'CBS News', 'NBC News', 'NPR', 'Reuters', 'USA Today', 'The Guardian', 'AP News']},
  {sections: ['general'], headline: 'Government shutdown enters its third day; national parks close', oneLine: 'About 800,000 federal workers are furloughed',
    score: 68, first: at('mon', '21:00'), facts: [[at('wed', '00:01'), 'National parks closed at midnight']],
    articles: [{outlet: 'NPR', at: at('wed', '05:00'), image: 120}, 'ABC News', 'CBS News', 'NBC News', 'The Guardian', 'Reuters']},
  {sections: ['general'], headline: 'New overtime rule takes effect for 4 million workers', oneLine: 'The salary threshold rises to $58,656',
    score: 65, first: at('wed', '04:00'), facts: [[at('wed', '04:00'), 'The rule took effect']],
    articles: [{outlet: 'NBC News', at: at('wed', '04:00')}, 'NPR', 'Reuters', 'Axios']},
  {sections: ['general'], headline: 'Boil-water notice lifted for 150,000 residents after a week', oneLine: 'Tests came back clean on Tuesday',
    score: 56, first: at('tue', '17:00'), facts: [[at('tue', '17:00'), 'The notice was lifted']],
    articles: [{outlet: 'CBS News', at: at('tue', '17:00'), image: 185}, 'AP News', 'NPR']},
  {sections: ['general'], headline: 'Appeals court lets a state\'s social media age-check law take effect', oneLine: 'Platforms must verify ages from next month',
    score: 54, first: at('tue', '15:00'), facts: [[at('tue', '15:00'), 'The appeals court lifted an injunction']],
    articles: [{outlet: 'Courthouse News', at: at('tue', '15:00')}, 'Reuters', 'NPR', 'The Guardian']},
  {sections: ['general'], headline: 'Wildfire smoke brings air quality alerts to six Midwest states', oneLine: 'Alerts run through Thursday',
    score: 52, first: at('tue', '10:00'), facts: [[at('tue', '10:00'), 'Air quality alerts issued in six states']],
    articles: [{outlet: 'ABC News', at: at('tue', '10:00'), image: 30}, 'NPR', 'CBS News', 'NBC News', 'USA Today']},
  {sections: ['general'], headline: 'Amtrak restores Northeast service after a power failure', oneLine: 'Trains ran up to two hours late',
    score: 49, first: at('mon', '19:45'), seen: true, facts: [[at('mon', '19:45'), 'Service restored']],
    articles: [{outlet: 'NBC News', at: at('mon', '19:45')}, 'AP News', 'CBS News']},
  {sections: ['general'], headline: 'Fabrikam Foods recalls infant formula over bacteria concerns', oneLine: 'Lots sold in 30 states since August',
    score: 47, first: at('tue', '08:30'), facts: [[at('tue', '08:30'), 'The FDA announced the recall']],
    articles: [{outlet: 'CBS News', at: at('tue', '08:30'), image: 330}, 'NBC News', 'AP News', 'USA Today']},
  {sections: ['general'], headline: 'Interstate bridge in Pennsylvania closes for emergency repairs', oneLine: 'Detours add about 20 minutes',
    score: 44, first: at('mon', '16:10'), seen: true, facts: [[at('mon', '16:10'), 'The bridge closed']],
    articles: [{outlet: 'PBS News', at: at('mon', '16:10')}, 'AP News']},

  // ---- Missed: left the page unseen on Tuesday (Local 3, Tech 2, AI 4, General 5 = 14), biggest first ----
  {sections: ['general'], headline: 'Tornado outbreak across Oklahoma and Kansas leaves 6 dead', oneLine: 'More than 30 tornadoes touched down overnight; thousands without power',
    score: 90, ...gone('09:10'), articles: [{outlet: 'NPR', at: at('tue', '06:40'), image: 215}, 'ABC News', 'CBS News', 'NBC News', 'Reuters', 'AP News', 'USA Today', 'The Guardian', 'CNN', 'PBS News']},
  {sections: ['ai'], headline: 'Google DeepMind releases Gemini 3.5 Flash', oneLine: 'Cheaper and faster, rolling out in the Gemini app and API',
    score: 86, ...gone('10:30'), articles: [{outlet: 'Google', at: at('tue', '07:00')}, 'Google DeepMind', 'The Verge', 'TechCrunch', 'Ars Technica', 'VentureBeat', '9to5Google']},
  {sections: ['local'], headline: 'Overnight closures on the 10 Freeway through Friday', oneLine: 'Four lanes shut from 10 PM to 5 AM for bridge work',
    score: 84, ...gone('11:00'), articles: [{outlet: 'KTLA', at: at('tue', '06:15'), image: 30}, 'ABC7', 'CBS Los Angeles']},
  {sections: ['ai'], headline: 'OpenAI opens its agent platform to every paid ChatGPT plan', oneLine: 'Agents can now run scheduled tasks',
    score: 82, ...gone('12:15'), articles: [{outlet: 'OpenAI', at: at('tue', '06:50'), image: 160}, 'The Verge', 'TechCrunch', 'Engadget', 'Wired', 'Axios']},
  {sections: ['general'], headline: 'Amtrak derailment in Montana injures 20', oneLine: 'Seven cars left the track; the cause is under investigation',
    score: 80, ...gone('13:05'), articles: [{outlet: 'ABC News', at: at('tue', '07:20')}, 'NBC News', 'CBS News', 'NPR', 'AP News', 'Reuters', 'USA Today']},
  {sections: ['tech'], headline: 'iOS 26.1 fixes the battery drain some iPhone owners reported', oneLine: 'Also adds a new Live Translation language',
    score: 78, ...gone('14:20'), articles: [{outlet: 'MacRumors', at: at('tue', '06:30'), image: 205}, '9to5Mac', 'The Verge', 'Apple', 'Engadget']},
  {sections: ['general'], headline: 'Measles cases pass 400 across 12 states', oneLine: 'Health officials urge vaccination before the holidays',
    score: 76, ...gone('15:00'), articles: [{outlet: 'NPR', at: at('tue', '07:05'), image: 0}, 'CBS News', 'NBC News', 'AP News', 'The Guardian', 'USA Today']},
  {sections: ['local'], headline: 'Teen hurt in a skatepark shooting; police look for a suspect', oneLine: 'The teen is expected to recover',
    score: 74, ...gone('16:40'), articles: [{outlet: 'NBC Los Angeles', at: at('tue', '06:05')}, 'KTLA', 'ABC7']},
  {sections: ['ai'], headline: 'Mistral releases an open-weights coding model', oneLine: 'Licensed for commercial use',
    score: 72, ...gone('17:30'), articles: [{outlet: 'Mistral AI', at: at('tue', '07:10'), image: 25}, 'VentureBeat', 'TechCrunch', 'Ars Technica']},
  {sections: ['tech'], headline: 'Samsung sets Galaxy Unpacked for Jan 21', oneLine: 'Invites point to the Galaxy S27',
    score: 70, ...gone('18:10'), articles: [{outlet: '9to5Google', at: at('tue', '06:45')}, 'Samsung', 'The Verge', 'Android Authority']},
  {sections: ['local'], headline: 'Power outage leaves 8,000 homes without service for three hours', oneLine: 'A blown transformer was replaced by morning',
    score: 68, ...gone('19:00'), articles: [{outlet: 'ABC7', at: at('tue', '06:20'), image: 50}, 'KTLA']},
  {sections: ['ai'], headline: 'Hugging Face adds gated access for large model downloads', oneLine: 'Repos over 100 GB now need a signed-in account',
    score: 66, ...gone('20:00'), articles: [{outlet: 'Hugging Face', at: at('tue', '07:25')}, 'VentureBeat', 'ZDNET']},
  {sections: ['general'], headline: 'Chemical plant fire forces a shelter-in-place order in Louisiana', oneLine: 'The order was lifted after six hours',
    score: 64, ...gone('20:45'), articles: [{outlet: 'ABC News', at: at('tue', '06:55'), image: 25}, 'CBS News', 'AP News', 'NBC News']},
  {sections: ['general'], headline: 'Automaker recalls 1.2 million pickups over a brake defect', oneLine: 'Dealers will replace a brake line for free',
    score: 62, ...gone('21:30'), articles: [{outlet: 'NBC News', at: at('tue', '07:15')}, 'Reuters', 'USA Today']},
];

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/**
 * Loads the sample's News: its sources, then each story with its articles, image copies, sections,
 * facts and seen state. `imagesDir` null records the images without writing files (an in-memory
 * database). Runs inside the caller's transaction when there is one.
 */
export function seedNews(store: Store, imagesDir: string | null) {
  const now = Date.parse(SEED_NOW);
  return transaction(store, () => {
    const sourceIds = new Map<string, number>();
    const sources = [
      ...DEFAULT_NEWS_SOURCES.map((spec, position) => ({spec, origin: 'default' as const, position})),
      ...SEED_OTHERS.map((spec, position) => ({spec, origin: 'default' as const, position: DEFAULT_NEWS_SOURCES.length + position})),
      ...SEED_LOCAL.map((spec, position) => ({spec, origin: 'local' as const, position})),
    ];
    for (const {spec, origin, position} of sources) {
      const checked = new Date(now - (CHECKED_AGO[spec.key] ?? 2) * MINUTE).toISOString();
      const failing = spec.key === 'local:fox-11'
        ? {lastSuccessAt: at('wed', '05:47'), lastErrorAt: checked, lastError: '404 Not Found', failingSince: at('wed', '06:02')}
        : {lastSuccessAt: checked};
      const row = store.db.insert(t.newsSources).values({
        ...sourceValues(spec, origin, position), dev: true, lastCheckAt: checked, ...failing, createdAt: zonedInstant('2026-08-01', '09:00', SEED_TIME_ZONE),
      }).returning({id: t.newsSources.id}).get();
      sourceIds.set(spec.key, row.id);
    }
    const sourceFlags = new Map(sources.map(({spec}) => [spec.key, spec]));

    for (const story of SAMPLE_STORIES) {
      const lastNewFact = story.facts.at(-1)![0];
      const [lead, ...rest] = story.articles;
      const articles: SampleArticle[] = [lead, ...rest.map((entry, index) => (typeof entry === 'string'
        ? {outlet: entry, at: new Date(Math.max(Date.parse(story.first), Date.parse(lead.at) - (index + 1) * 23 * MINUTE)).toISOString()}
        : entry))];
      const articleIds: number[] = [];
      let imageArticle: {id: number; hue: number} | null = null;
      for (const article of articles) {
        const outlet = OUTLETS[article.outlet];
        if (!outlet) throw new Error(`The sample's outlet ${article.outlet} has no source.`);
        const spec = sourceFlags.get(outlet.source)!;
        const url = `https://${slug(article.outlet)}.example/news/${slug(article.headline ?? story.headline)}`;
        const row = store.db.insert(t.newsArticles).values({
          sourceId: sourceIds.get(outlet.source)!, url, canonicalUrl: url, outlet: article.outlet, outletShort: outlet.short ?? null,
          byline: article.byline ?? null, headline: article.headline ?? story.headline,
          feedSummary: article.feedSummary ?? story.oneLine ?? null,
          extractedText: story.missed ? null : article.text ?? null,
          summaryOnly: spec.summaryOnly ?? false, metered: spec.metered ?? false, discovery: article.discovery ?? false,
          publishedAt: article.at, fetchedAt: new Date(Math.min(now, Date.parse(article.at) + 3 * MINUTE)).toISOString(),
        }).returning({id: t.newsArticles.id}).get();
        articleIds.push(row.id);
        if (article.image !== undefined) {
          imageArticle ??= {id: row.id, hue: article.image};
          // A story in Missed keeps only its own image's copies, as the expiry leaves them (keepsImage).
          if (!story.missed || imageArticle.id === row.id) {
            saveNewsImage(store, imagesDir, row.id, 'large', {bytes: tintedImage(LARGE_SIZE.width, LARGE_SIZE.height, article.image), mimeType: 'image/png', ...LARGE_SIZE});
            saveNewsImage(store, imagesDir, row.id, 'thumb', {bytes: tintedImage(THUMB_SIZE.width, THUMB_SIZE.height, article.image), mimeType: 'image/png', ...THUMB_SIZE});
          }
        }
      }
      const expiredAt = story.missed ? expiresAt(lastNewFact) : null;
      const storyId = store.db.insert(t.newsStories).values({
        headline: story.headline, oneLine: story.oneLine ?? null, summary: story.summary ?? (story.oneLine ? `${story.headline}. ${story.oneLine}.` : `${story.headline}.`),
        score: story.score, leadArticleId: articleIds[0]!, imageArticleId: imageArticle?.id ?? null,
        firstReportedAt: story.first, lastNewFactAt: lastNewFact, seenAt: story.seen ? NEWS_LAST_LOOKED : null,
        expiredAt, expiredUnseen: story.missed ?? false, createdAt: story.first,
      }).returning({id: t.newsStories.id}).get().id;
      story.sections.forEach((section, position) => store.db.insert(t.newsStorySections).values({storyId, section, position}).run());
      articleIds.forEach((articleId, index) => store.db.insert(t.newsStoryArticles).values({storyId, articleId, linkedAt: articles[index]!.at}).run());
      // The archive keeps a story's summary, not its timeline.
      if (!story.missed) for (const [factAt, text] of story.facts) store.db.insert(t.newsFacts).values({storyId, at: factAt, text}).run();
      if (story.upcoming) {
        store.db.insert(t.newsEvents).values({storyId, section: 'tech', name: story.upcoming.name, startsAt: story.upcoming.startsAt, allDay: false, createdAt: lastNewFact}).run();
      }
    }
    return {stories: SAMPLE_STORIES.length};
  });
}
