// Setpoint's command line.
//
//   npm run cli -- setup-token      a one-time token for the first claim, valid an hour
//   npm run cli -- status           whether Setpoint is claimed, and its sources' health
//   npm run cli -- ha-token         a new bearer token for Home Assistant's GET /api/status/ha,
//                                   replacing (revoking) any earlier one; shown once
//   npm run cli -- ha-token --revoke   revoke Home Assistant's token
//   npm run cli -- import-v1 <file>          v1's export file, once: accounts, sign-in, keys, rules,
//                                            trusted senders and pins (src/importV1.ts has the format)
//   npm run cli -- import-v1-triage <file>   only v1's triage rules and lane corrections
//   npm run cli -- triage-history   start or resume the one-time model pass over backfilled history
//   npm run cli -- codes            which sorted emails' verification codes reading again would change,
//                                   and the code emails still without one (SV-68)
//   npm run cli -- codes --apply    write those changes
//
// It uses the same SETPOINT_DATA_DIR as the server (data/dev by default).
import fs from 'node:fs';
import path from 'node:path';
import {loadConfig} from './config.ts';
import {openDatabase} from './db/open.ts';
import {haTokenIssuedAt, issueHaToken, revokeHaToken} from './auth/haToken.ts';
import {getOwner, issueSetupToken} from './auth/owner.ts';
import {SetpointError} from './errors.ts';
import {importV1} from './importV1.ts';
import {sourceList} from './queries/sources.ts';
import {loadKeyring} from './secrets/crypto.ts';
import type {Store} from './store.ts';
import {rereadCodes} from './triage/codes.ts';
import type {CodeEmail} from './triage/codes.ts';
import {startHistoryExtraction} from './triage/history.ts';
import {importV1Triage} from './triage/importV1.ts';

const USAGE = `Usage:
  setup-token     print a one-time token for claiming Setpoint (valid an hour)
  status          whether Setpoint is claimed, and each source's health
  ha-token        print a new token for Home Assistant's status endpoint, replacing any earlier one
  ha-token --revoke   revoke Home Assistant's token
  import-v1 <file>          import v1's export file (src/importV1.ts has the format); safe to run again
  import-v1-triage <file>   import only v1's triage rules and lane corrections (src/triage/importV1.ts)
  triage-history  start or resume the model pass over backfilled history (needs an AI key; the server runs it)
  codes           list sorted emails whose verification code reading again would change, and code emails with none
  codes --apply   write those changes`;

function main(argv: string[]): number {
  const [command, ...rest] = argv;
  const valid = (command === 'ha-token' && (rest.length === 0 || (rest.length === 1 && rest[0] === '--revoke')))
    || (command === 'codes' && (rest.length === 0 || (rest.length === 1 && rest[0] === '--apply')))
    || (['setup-token', 'status', 'triage-history'].includes(command ?? '') && rest.length === 0)
    || ((command === 'import-v1' || command === 'import-v1-triage') && rest.length === 1);
  if (!command || !valid) {
    console.log(USAGE);
    return command === '--help' || command === '-h' ? 0 : 1;
  }
  const config = loadConfig();
  const {sqlite, db} = openDatabase(config.databasePath);
  // The import seals v1's secrets with Setpoint's key (production refuses to run without one).
  const keyring = command === 'import-v1' ? loadKeyring(process.env, config.dataDir).keyring : null;
  const store: Store = {sqlite, db, timeZone: config.timeZone, now: () => new Date(), keyring};
  try {
    if (command === 'setup-token') {
      const {token, expiresAt} = issueSetupToken(store);
      console.log(`Setup token for ${config.databasePath}, valid until ${expiresAt}. It's shown once:\n\n${token}\n`);
      return 0;
    }
    if (command === 'ha-token') {
      if (rest[0] === '--revoke') {
        console.log(revokeHaToken(store) ? 'Home Assistant\'s token is revoked.' : 'There was no Home Assistant token.');
        return 0;
      }
      const replaced = haTokenIssuedAt(store) !== null;
      const {token} = issueHaToken(store);
      console.log(`Home Assistant token for ${config.databasePath}${replaced ? ' (the earlier one no longer works)' : ''}. It's shown once:\n\n${token}\n`);
      console.log('Send it as "Authorization: Bearer <token>" to GET /api/status/ha.');
      return 0;
    }
    if (command === 'triage-history') {
      const {state, done, total, queued} = startHistoryExtraction(store);
      console.log(state === 'waiting_for_key'
        ? `Started, but there's no AI key yet: add one in Settings › AI and the server reads ${total - done} emails.`
        : `${done} of ${total} backfilled emails read; ${queued} more queued for the server to read.`);
      return 0;
    }
    if (command === 'codes') {
      const apply = rest[0] === '--apply';
      const {changes, missing} = rereadCodes(store, {apply});
      const line = (email: CodeEmail) => `  #${email.id}\t${email.fromAddress.split('@')[1] ?? email.fromAddress}\t${email.subject}`;
      console.log(changes.length
        ? `${changes.length} ${changes.length === 1 ? 'email\'s code' : 'emails\' codes'} ${apply ? 'changed' : 'would change (run codes --apply to write them)'}:`
        : 'No code changes.');
      for (const change of changes) console.log(`${line(change)}\t${change.before ?? 'none'} → ${change.after ?? 'none'}`);
      console.log(missing.length ? `\n${missing.length} code ${missing.length === 1 ? 'email has' : 'emails have'} no code:` : '\nEvery code email has a code.');
      for (const email of missing) console.log(line(email));
      return 0;
    }
    // npm runs this in server/; a relative path is from where npm was started.
    const file = () => JSON.parse(fs.readFileSync(path.resolve(process.env.INIT_CWD ?? process.cwd(), rest[0]!), 'utf8')) as unknown;
    if (command === 'import-v1-triage') {
      console.log(JSON.stringify(importV1Triage(store, file()), null, 2));
      return 0;
    }
    if (command === 'import-v1') {
      const report = importV1(store, file(), {gmailPush: config.gmailPubSub !== null});
      const lines = (title: string, items: string[]) => (items.length ? `${title}\n${items.map(item => `  - ${item}`).join('\n')}\n` : '');
      console.log([
        `Imported into ${config.databasePath}:\n`, lines('Imported', report.imported), lines('Skipped', report.skipped), lines('Afterwards', report.notes),
        `Triage: ${JSON.stringify(report.triage)}\n`,
        'Delete the export file now: it holds v1\'s secrets in plain text. Setpoint keeps them sealed with its own key.',
      ].join('\n'));
      return 0;
    }
    const owner = getOwner(store);
    console.log(owner ? `Claimed ${owner.claimedAt} (${owner.authMode}).` : 'Not claimed yet: run `npm run cli -- setup-token`.');
    const haIssued = haTokenIssuedAt(store);
    console.log(haIssued ? `Home Assistant token issued ${haIssued}.` : 'No Home Assistant token.');
    for (const source of sourceList(store)) console.log(`${source.id}\t${source.name}\t${source.health.state}${source.dev ? ' (dev)' : ''}`);
    return 0;
  } catch (error) {
    if (error instanceof SetpointError) {
      console.error(error.message);
      return 1;
    }
    throw error;
  } finally {
    sqlite.close();
  }
}

process.exitCode = main(process.argv.slice(2));
