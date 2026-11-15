// Drafts and sending. A draft lives in Setpoint only until it is sent: Gmail and iCloud never see
// one. Starting a draft fills it on the server (who it goes to, the subject, the From), so the web
// and the iPhone app agree. Send holds the email on the server for SEND_HOLD_MS, with Undo, then
// sends it through the account's provider. None of these answers is in the iPhone app's contract.
import {z} from 'zod';
import type {Block, List} from '../richText.ts';
import type {Recipient} from '../message.ts';

/** What a draft is: a reply to an email, a reply to all of it, its forward, or a new message. */
export const DRAFT_KINDS = ['reply', 'reply_all', 'forward', 'new'] as const;
export type DraftKind = (typeof DRAFT_KINDS)[number];

/**
 * Where a draft's send stands. `held`: Send was pressed and the server holds it until `send_at`,
 * Undo still possible. `sending`: the provider has it, or is being asked. `failed`: the provider
 * refused it, in its own words, and the draft waits for Try again (send once more) or an edit.
 * A draft that was never sent has none.
 */
export const SEND_STATES = ['held', 'sending', 'failed'] as const;
export type SendState = (typeof SEND_STATES)[number];

/** How long Send holds an email for Undo before it goes to the provider (DESIGN.md's undo toast). */
export const SEND_HOLD_MS = 6000;

const address = z.string().trim().toLowerCase().max(320).regex(/^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/, 'Not an email address.');

export const recipientInput = z.strictObject({
  name: z.string().trim().max(200).nullable().transform(name => name || null),
  address,
});

const runSchema = z.strictObject({
  text: z.string().max(100_000),
  marks: z.array(z.enum(['bold', 'italic', 'underline', 'strike', 'code'])).max(5),
  href: z.string().max(4000).nullable(),
});
const runsSchema = z.array(runSchema).max(5000);

const itemsSchema = z.array(z.strictObject({runs: runsSchema, get sub() {
  return listSchema.optional();
}})).max(1000);
const listSchema: z.ZodType<List> = z.strictObject({ordered: z.boolean(), items: itemsSchema});

const blockSchema: z.ZodType<Block> = z.discriminatedUnion('type', [
  z.strictObject({type: z.literal('paragraph'), runs: runsSchema}),
  z.strictObject({type: z.literal('heading'), level: z.number().int().min(1).max(6), runs: runsSchema}),
  z.strictObject({type: z.literal('quote'), runs: runsSchema}),
  z.strictObject({type: z.literal('code'), text: z.string().max(100_000)}),
  z.strictObject({type: z.literal('list'), ordered: z.boolean(), items: itemsSchema}),
]);

/** A draft's body: the rich-text blocks the description field uses (shared/src/richText.ts). */
export const draftBodySchema = z.array(blockSchema).max(5000);

const recipients = z.array(recipientInput).max(100);

/**
 * Starts a draft. A reply, reply all or forward names the email it answers, and there is one such
 * draft per email and kind: starting it again returns the one there is. A new message may name the
 * account to write from (Sent with an account selected); otherwise it starts from the account the
 * user last sent from.
 */
export const draftCreateInput = z.strictObject({
  kind: z.enum(DRAFT_KINDS),
  message_id: z.number().int().positive().optional(),
  account_id: z.number().int().positive().optional(),
}).refine(input => (input.kind === 'new') === (input.message_id === undefined), {message: 'A reply or forward names its email, and a new message names none.'});
export type DraftCreateInput = z.infer<typeof draftCreateInput>;

/**
 * Saves what the user typed, as they type: only the fields given change, and the last write wins.
 * From is one of the account's own addresses (its address or a Gmail alias), and may move to
 * another account's.
 */
export const draftUpdateInput = z.strictObject({
  from: z.strictObject({account_id: z.number().int().positive(), address}).optional(),
  to: recipients.optional(),
  cc: recipients.optional(),
  bcc: recipients.optional(),
  subject: z.string().max(998).optional(),
  body: draftBodySchema.optional(),
  // A reply's quote, trimmed by the user. Null puts the original back in full.
  quote: draftBodySchema.nullable().optional(),
});
export type DraftUpdateInput = z.infer<typeof draftUpdateInput>;

export interface DraftFromOut {
  account_id: number;
  address: string;
}

export interface DraftSendOut {
  state: SendState;
  // When a held send goes to the provider. Null once it is sending or failed.
  send_at: string | null;
  // The provider's words, when it refused.
  error: string | null;
}

/** A draft in full, as the composer opens it. */
export interface DraftOut {
  id: number;
  kind: DraftKind;
  // The email it answers or forwards. Null for a new message, and once that email is gone.
  message_id: number | null;
  from: DraftFromOut;
  to: Recipient[];
  cc: Recipient[];
  bcc: Recipient[];
  subject: string;
  body: Block[];
  // A reply's quote as the user trimmed it, or null for the original in full (the server quotes it
  // at send time).
  quote: Block[] | null;
  created_at: string;
  updated_at: string;
  send: DraftSendOut | null;
}

/** What a save answers: enough to know it landed, and cheap. */
export interface DraftSavedOut {
  id: number;
  updated_at: string;
}

/** One draft in the Drafts list: newest change first. */
export interface DraftRowOut {
  id: number;
  kind: DraftKind;
  message_id: number | null;
  account_id: number;
  to: Recipient[];
  subject: string;
  // The body's first words, as plain text.
  snippet: string;
  updated_at: string;
  send_state: SendState | null;
}

export interface DraftsOut {
  drafts: DraftRowOut[];
  count: number;
}

/** One address an account can send as: its own, or a Gmail alias. */
export interface FromAddressOut {
  address: string;
  // The name the provider sends with. Null where it has none.
  name: string | null;
  // The account's own address, not an alias.
  primary: boolean;
}

/** An account in the From picker, with the addresses it can send as. */
export interface FromAccountOut {
  account_id: number;
  addresses: FromAddressOut[];
}

/** The From picker: each account with its addresses, and the one a new message starts from. */
export interface FromOut {
  accounts: FromAccountOut[];
  default_account_id: number | null;
}

/** Recipient suggestions: what the user typed so far, and how many to offer. */
export const peopleInput = z.strictObject({
  q: z.string().max(200).optional().default(''),
  limit: z.coerce.number().int().min(1).max(20).optional().default(8),
});

/** People to suggest as recipients, best first (src/domain/people.ts on the server). */
export interface PeopleOut {
  people: Recipient[];
}
