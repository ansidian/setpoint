// The dev copy's owner with a short password (SV-206). A real claim needs MIN_PASSWORD_LENGTH
// characters, so `npm run try` writes the owner into its database itself, before the server starts:
// it makes one with recovery codes if there's none, and puts the password back if it was changed.
// For a local copy of the sample only; nothing here runs in the server.
import bcrypt from 'bcryptjs';
import {SEED_NOW} from '@setpoint/shared';
import {generateRecoveryCodes, hashPassword, hashRecoveryCode} from '../auth/owner.ts';
import {openDatabase} from '../db/open.ts';
import * as t from '../db/schema.ts';

export async function ensureDevOwner(file: string, password: string): Promise<void> {
  const {sqlite, db} = openDatabase(file);
  try {
    const owner = db.select().from(t.owner).get();
    if (owner && await bcrypt.compare(password, owner.passwordHash)) return;
    const passwordHash = await hashPassword(password);
    if (owner) {
      db.update(t.owner).set({passwordHash}).run();
      return;
    }
    sqlite.transaction(() => {
      db.insert(t.owner).values({id: 1, passwordHash, claimedAt: SEED_NOW}).run();
      db.delete(t.recoveryCodes).run();
      for (const code of generateRecoveryCodes()) db.insert(t.recoveryCodes).values({hash: hashRecoveryCode(code), generatedAt: SEED_NOW}).run();
    })();
  } finally {
    sqlite.close();
  }
}
