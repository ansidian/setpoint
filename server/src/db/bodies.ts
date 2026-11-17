import {eq, inArray} from 'drizzle-orm';
import type {Db} from './open.ts';
import * as t from './schema.ts';

/** An email's bodies (`message_bodies`), read only by what needs them. */
export interface MessageBody {
  bodyText: string;
  bodyHtml: string | null;
}

const NO_BODY: MessageBody = {bodyText: '', bodyHtml: null};

/** Writes an email's bodies, replacing any it had. */
export function writeBody(db: Db, messageId: number, body: MessageBody) {
  db.insert(t.messageBodies).values({messageId, bodyText: body.bodyText, bodyHtml: body.bodyHtml})
    .onConflictDoUpdate({target: t.messageBodies.messageId, set: {bodyText: body.bodyText, bodyHtml: body.bodyHtml}}).run();
}

/** One email's bodies. Every email has a row; an id with none reads as empty. */
export function bodyOf(db: Db, messageId: number): MessageBody {
  return db.select({bodyText: t.messageBodies.bodyText, bodyHtml: t.messageBodies.bodyHtml}).from(t.messageBodies)
    .where(eq(t.messageBodies.messageId, messageId)).get() ?? NO_BODY;
}

/** Rows with their bodies, in the order given. */
export function withBodies<T extends {id: number}>(db: Db, rows: T[]): (T & MessageBody)[] {
  if (!rows.length) return [];
  const bodies = new Map(db.select().from(t.messageBodies).where(inArray(t.messageBodies.messageId, rows.map(row => row.id))).all()
    .map(({messageId, ...body}) => [messageId, body]));
  return rows.map(row => ({...row, ...(bodies.get(row.id) ?? NO_BODY)}));
}

/** One row with its bodies. */
export const withBody = <T extends {id: number}>(db: Db, row: T): T & MessageBody => ({...row, ...bodyOf(db, row.id)});

/** Inserts an email with its bodies, for the seed, fixtures and tests that write rows by hand. Returns its id. */
export function insertMessage(db: Pick<Db, 'insert'>, {bodyText, bodyHtml = null, ...values}: typeof t.messages.$inferInsert & {bodyText: string; bodyHtml?: string | null}): number {
  const {id} = db.insert(t.messages).values(values).returning({id: t.messages.id}).get();
  db.insert(t.messageBodies).values({messageId: id, bodyText, bodyHtml}).run();
  return id;
}
