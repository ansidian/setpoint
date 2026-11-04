// The CLI line `npm run try` prints for its copy (SV-173). `npm run cli` runs in server/ (npm runs a
// workspace's script there), so the data dir goes in whole: a relative one opens server/data/….
import path from 'node:path';

/** `npm run cli -- <command>` against the Setpoint at `dataDir` and `port`, quoted for a shell. */
export function cliLine(dataDir: string, port: number, command: string): string {
  const dir = path.resolve(dataDir);
  const quoted = /^[\w@%+=:,./-]+$/.test(dir) ? dir : `'${dir.replaceAll('\'', '\'\\\'\'')}'`;
  return `SETPOINT_DATA_DIR=${quoted} SETPOINT_PORT=${port} npm run cli -- ${command}`;
}
