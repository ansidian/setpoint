// The first claim as POST /api/auth/claim leaves it, for the browser checks' templates (harness.ts ›
// template): the owner and one signed-in session, at the seed's moment, with tests' bcrypt cost. Run
// once per template rather than by every check, whose claim was 0.25 s of a core each time (SV-143).
//
//   node server/src/dev/claim.ts <setup token> <password>   prints the session's cookie as JSON
import {cookieNames} from '../api/auth.ts';
import {claimOwner} from '../auth/owner.ts';
import {createSession} from '../auth/sessions.ts';
import {loadConfig} from '../config.ts';
import {openDatabase} from '../db/open.ts';
import {isoNow, storeClock} from '../store.ts';
import type {Store} from '../store.ts';

const [setupToken, password] = process.argv.slice(2);
if (!setupToken || !password) throw new Error('Usage: claim.ts <setup token> <password>');
const config = loadConfig();
if (config.production) throw new Error('claim.ts is for development only.');

const {sqlite, db} = openDatabase(config.databasePath);
try {
  const store: Store = {sqlite, db, timeZone: config.timeZone, ...storeClock('frozen'), keyring: null};
  const {owner} = await claimOwner(store, setupToken, password, 4);
  const value = createSession(store, {generation: owner.securityGeneration, method: 'claim', passwordAt: isoNow(store)});
  console.log(JSON.stringify({name: cookieNames(false).session, value}));
} finally {
  sqlite.close();
}
