// A browser check's starting point (harness.ts › template), in one process: the seed with the
// sample's News, the board fixtures asked for, a setup token and, with --claim, the first claim as
// POST /api/auth/claim leaves it: the owner and one signed-in session, at the seed's moment, with
// tests' bcrypt cost. Built once per set of fixtures rather than by every check, whose claim was
// 0.25 s of a core each time (SV-143), and in one process rather than four (SV-145).
//
//   SETPOINT_DATA_DIR=… node server/src/dev/template.ts [--claim <password>] [fixture…]
//
// It prints the setup token and the session's cookie, null unless claimed, as JSON.
import {cookieNames} from '../api/auth.ts';
import {claimOwner, issueSetupToken} from '../auth/owner.ts';
import {createSession} from '../auth/sessions.ts';
import {loadConfig} from '../config.ts';
import {openDatabase} from '../db/open.ts';
import {isoNow, storeClock} from '../store.ts';
import type {Store} from '../store.ts';
import {applyFixtures} from './fixtures/index.ts';
import {seedFile} from './seedFile.ts';

const args = process.argv.slice(2);
const claiming = args[0] === '--claim';
const password = claiming ? args[1] : null;
if (claiming && !password) throw new Error('Usage: template.ts [--claim <password>] [fixture…]');
const fixtures = args.slice(claiming ? 2 : 0);
const config = loadConfig();
if (config.production) throw new Error('template.ts is for development only.');

seedFile(config.databasePath);
if (fixtures.length) applyFixtures(config.databasePath, fixtures);
const {sqlite, db} = openDatabase(config.databasePath);
try {
  const store: Store = {sqlite, db, timeZone: config.timeZone, ...storeClock('frozen'), keyring: null};
  const setupToken = issueSetupToken(store).token;
  let cookie: {name: string; value: string | null} | null = null;
  if (password) {
    const {owner} = await claimOwner(store, setupToken, password, 4);
    cookie = {name: cookieNames(false).session, value: createSession(store, {generation: owner.securityGeneration, method: 'claim', passwordAt: isoNow(store)})};
  }
  console.log(JSON.stringify({setupToken, cookie}));
} finally {
  sqlite.close();
}
