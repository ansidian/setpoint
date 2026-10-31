// What a model is told to write as an email's search terms (src/search/terms.ts), and how its answer
// becomes the `search_terms` column. A change to the prompt bumps SEARCH_TERMS_PROMPT_VERSION, so the
// mail it should be run on again can be told from the mail that has it.
import type {ToolSpec} from '../providers/ai/index.ts';

export const SEARCH_TERMS_PROMPT_VERSION = 1;
export const SEARCH_TERMS_MODEL = 'claude-haiku-5-5';
export const SEARCH_TERMS_MAX_OUTPUT_TOKENS = 300;

// How much of the clean body the model reads.
export const SEARCH_TERMS_BODY_LIMIT = 4000;
const MAX_TERMS = 12;
const MAX_TERM_LENGTH = 60;

export const SEARCH_TERMS_SYSTEM = `You write search terms for one email in the user's personal mailbox. Answer only with the submit_search_terms tool.

The user finds email by what it is about, in their own everyday words, which are often not the sender's words. Give 3 to 10 lowercase terms of one to three words, the things they would type to find THIS email:
- what it is in plain everyday words, using the common name where the sender uses a formal one. A mobile carrier's "Your statement is ready" is a phone bill; a pharmacy's "Your order is ready" is a prescription pickup.
- what it means for the user: an application status, an order, a payment, an appointment, a claim.
- the specific thing: the product, the service, the job title.

Never guess what a company does. Name a kind of service or bill only when the email says it, or you know the sender for it for certain. Close isn't enough: no neighbouring kind, and no broad label to cover a guess. If neither the email nor the sender's name says what a bill is for, write only plain words such as invoice, bill, statement and payment. An invoice from Harbor Ridge Services that says nothing more gets invoice, bill, account statement, invoice payment; it is not a landscaping bill, a home services bill or any other kind of bill.

People type different forms of a word. When the plain word for what this email is about has two everyday forms, give the term in both: dental appointment and dentist appointment, rent payment and rental payment.

Only what this email is about. Leave out what it merely mentions: ads, footers, related articles, legal text. Leave out the sender's name, the user's name, dates, amounts and reference numbers, since those are searched already. A newsletter or promotion gets its actual topic only, at most three terms.`;

export const SEARCH_TERMS_TOOL: ToolSpec = {
  name: 'submit_search_terms',
  description: 'Submit the search terms for one email.',
  schema: {type: 'object', properties: {terms: {type: 'array', items: {type: 'string'}}}, required: ['terms'], additionalProperties: false},
};

export interface TermsEmail {
  fromName: string;
  fromAddress: string;
  organisation: string | null;
  subject: string;
  type: string | null;
  summary: string | null;
  searchBody: string;
}

/** The email as the model reads it: who and what, then the start of the clean body. */
export function searchTermsInput(email: TermsEmail): string {
  return [
    `From: ${email.fromName} <${email.fromAddress}>`,
    ...(email.organisation ? [`Organisation: ${email.organisation}`] : []),
    `Subject: ${email.subject}`,
    ...(email.type ? [`Type: ${email.type}`] : []),
    ...(email.summary ? [`Summary: ${email.summary}`] : []),
    '',
    'Body:',
    email.searchBody.replace(/\s+/g, ' ').trim().slice(0, SEARCH_TERMS_BODY_LIMIT),
  ].join('\n');
}

/** The usable terms of an answer, tidied and once each; none for an answer without any. */
export function termsOf(input: Record<string, unknown> | null): string[] {
  const raw = Array.isArray(input?.terms) ? input.terms : [];
  const clean = raw.flatMap(term => (typeof term === 'string' ? [term.replace(/\s+/g, ' ').trim().toLowerCase()] : []))
    .filter(term => term && term.length <= MAX_TERM_LENGTH);
  return [...new Set(clean)].slice(0, MAX_TERMS);
}

/** Terms as `search_terms` holds them: one a line, so a term stays a unit. Null for none. */
export const termsText = (terms: string[]) => (terms.length ? terms.join('\n') : null);
