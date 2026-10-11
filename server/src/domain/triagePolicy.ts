// Triage's policy (BRIEF.md › Triage and Security mail; decisions 4, 10, 16, 29, 30): pure rules
// that turn what the rules and models said into the record's lane, kind, organisation, type, key
// date, summary, security facts, protection and code.
//
// - Unsure defaults to FYI, never Attention (decision 30): a model below the confidence floor, or a
//   reading that didn't parse, decides nothing.
// - The protected class always goes to Attention and nothing moves it (decision 29): settle()
//   applies it after every rule and model, and it can't be configured.
// - Backfilled history never enters Attention, protected or not (SV-4 D19): only mail that
//   arrives after an account's first sync can be Attention. Protected history keeps `protected` and
//   sits in FYI, where no rule can move it either.
// - A verification code is never Attention: it sits in Security with its code until it expires.
//   Protected mail is never a code row, because a code row leaves the Inbox at its expiry.
// - Noise has no kind; FYI and Attention always have one.
import type {Kind, Lane, MessageType, ProtectedReason, SecurityFacts} from '@setpoint/shared';
import type {DetectedCode} from './verificationCode.ts';

/** v1's floor: a cheap answer less sure than this goes to the strong model; a strong one is unsure. */
export const CONFIDENCE_FLOOR = 0.72;

/** What a model (or the rules-only history pass) read in an email, normalised. */
export interface Reading {
  lane: Lane;
  kind: Kind | null;
  organisation: string | null;
  via: string | null;
  type: MessageType | null;
  keyDate: string | null;
  summary: string | null;
  security: SecurityFacts | null;
  protectedClaim: ProtectedReason | null;
  confidence: number | null;
}

/** Whether a reading is sure enough to decide a lane. */
export const isSure = (reading: Reading | null): reading is Reading =>
  reading !== null && reading.confidence !== null && reading.confidence >= CONFIDENCE_FLOOR;

/**
 * Why the cheap model's reading goes to the strong model, or null to accept it: it didn't parse,
 * it's unsure, it says Attention (the lane that costs the user, so it's checked; v1 escalated only its
 * risk categories and precision fell, decision 30), or it claims the protected class.
 */
export function escalation(cheap: Reading | null): 'malformed' | 'unsure' | 'attention' | 'protected' | null {
  if (!cheap) return 'malformed';
  if (!isSure(cheap)) return 'unsure';
  if (cheap.lane === 'attention') return 'attention';
  if (cheap.protectedClaim) return 'protected';
  return null;
}

// ---- The protected class ----

/**
 * The protected class in plain words, read from the subject and body. Past tense on purpose: "your
 * password was changed" is protected, "reset your password" (asked for) is not. The model can claim
 * the rest (an unfamiliar device or place, money the user didn't send); these need no model.
 */
const PROTECTED_PATTERNS: [ProtectedReason, RegExp][] = [
  ['password_changed', /\bpassword (?:was|has been|had been) (?:changed|reset|updated)\b|\bpassword (?:changed|updated)\b|\bwe(?:'ve| have)? (?:changed|reset|updated) your password\b/i],
  ['recovery_changed', /\brecovery (?:email|phone|address|number|information|info|options?) (?:was |has been )?(?:changed|updated|added|removed|deleted)\b|\b(?:changed|updated|added|removed) (?:a |your |the )?recovery (?:email|phone|address|number|information|info|options?)\b/i],
  ['two_step_changed', /\b(?:2-step|two-step|2-factor|two-factor|2fa|mfa|multi-factor) (?:verification |authentication )?(?:is |was )?now (?:off|on)\b|\b(?:2-step|two-step|2-factor|two-factor|2fa|mfa|multi-factor) (?:verification |authentication )?(?:was |has been |is )?(?:turned off|disabled|removed|changed|turned on|enabled|added|reset)\b|\b(?:turned off|disabled|removed|changed|reset) (?:2-step|two-step|two-factor|2fa|multi-factor)\b/i],
  ['account_deleted', /\baccount (?:was |has been |is |will be )?(?:deleted|closed|scheduled for deletion)\b|\bdelet(?:ed|ion of) your account\b/i],
  ['account_locked', /\baccount (?:was |has been |is |is temporarily |has been temporarily )?(?:locked|suspended|disabled|deactivated|restricted|frozen)\b/i],
  ['critical_alert', /\bcritical (?:security )?alert\b/i],
  ['unfamiliar_sign_in', /\b(?:suspicious|unrecogni[sz]ed|unusual|unfamiliar) (?:sign-?in|log-?in|login|activity|sign-?in attempt|device|location)\b|\bsomeone (?:may )?(?:has |have )?(?:tried to )?(?:sign(?:ed)? in|log(?:ged)? in) to your account\b/i],
  ['money_leaving', /\bunauthori[sz]ed (?:charge|transaction|payment|transfer|withdrawal)\b|\b(?:withdrawal|transfer|wire) of [$€£][\d,.]+ (?:was |has been )?(?:made |sent |initiated )?(?:from|out of) your\b/i],
];

/** The protected reason the email's own words give, if any. */
export function protectedFromText(subject: string, body: string): ProtectedReason | null {
  const text = `${subject}\n${body}`;
  return PROTECTED_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

// ---- Settling a decision ----

export interface SettleInput {
  // The lane a rule or a sure model decided; null when nothing was sure (FYI, decision 30).
  lane: Lane | null;
  // A rule's kind and type, which win over the reading's.
  kind?: Kind | null;
  type?: MessageType | null;
  // What was read (model or history pass); null when nothing was.
  reading: Reading | null;
  code: DetectedCode | null;
  // From protectedFromText.
  textProtected: ProtectedReason | null;
  // The body was cut short for the model: what it couldn't see can't make it Noise (v1's rule that
  // incomplete evidence can't establish an email needs nothing).
  incomplete?: boolean;
  // Backfilled history: never Attention.
  history?: boolean;
}

export interface Settled {
  lane: Lane;
  kind: Kind | null;
  type: MessageType | null;
  organisation: string | null;
  via: string | null;
  keyDate: string | null;
  summary: string | null;
  securityFacts: SecurityFacts | null;
  protected: boolean;
  protectedReason: ProtectedReason | null;
  code: string | null;
  codeExpiresAt: string | null;
}

const PROTECTED_KIND: Record<ProtectedReason, Kind> = {
  password_changed: 'security', recovery_changed: 'security', two_step_changed: 'security', account_deleted: 'security',
  account_locked: 'security', critical_alert: 'security', unfamiliar_sign_in: 'security', money_leaving: 'money',
};

const PROTECTED_WHAT: Record<ProtectedReason, string> = {
  password_changed: 'Password changed', recovery_changed: 'Recovery changed', two_step_changed: '2-Step Verification changed',
  account_deleted: 'Account deleted', account_locked: 'Account locked', critical_alert: 'Critical alert',
  unfamiliar_sign_in: 'Sign-in from an unfamiliar device or place', money_leaving: 'Money left an account',
};

/**
 * The record's triage fields. Order matters and is the policy: protection first (nothing outranks
 * it, and a model's protected claim doesn't count on a code email, whose own words would have to
 * say it), then codes (never Attention), then the decided lane or FYI when unsure. History is never
 * Attention: its protected mail is fixed at FYI instead, and a rule's Attention becomes FYI.
 */
export function settle(input: SettleInput): Settled {
  const reading = input.reading;
  const claim = input.code ? null : reading?.protectedClaim ?? null;
  const protectedReason = input.textProtected ?? claim;
  let lane: Lane = input.lane ?? 'fyi';
  let kind: Kind | null = input.kind !== undefined && input.kind !== null ? input.kind : reading?.kind ?? null;
  let type: MessageType | null = input.type ?? reading?.type ?? null;
  let code = input.code;
  if (protectedReason) {
    lane = input.history ? 'fyi' : 'attention';
    kind = PROTECTED_KIND[protectedReason];
    code = null;
    if (type === 'verification_code' || type === null) type = 'alert';
  } else if (code) {
    lane = 'fyi';
    kind = 'security';
    type = 'verification_code';
  } else if (lane === 'noise' && input.incomplete) {
    lane = 'fyi';
  }
  if (input.history && lane === 'attention') lane = 'fyi';
  if (lane === 'noise') kind = null;
  else kind ??= 'other';
  let securityFacts: SecurityFacts | null = kind === 'security' && reading?.security?.what ? reading.security : null;
  if (protectedReason && !securityFacts) securityFacts = {what: PROTECTED_WHAT[protectedReason]};
  if (protectedReason === 'unfamiliar_sign_in' && securityFacts) securityFacts = {...securityFacts, unfamiliar: true};
  return {
    lane, kind, type,
    organisation: reading?.organisation ?? null,
    via: reading?.via ?? null,
    keyDate: reading?.keyDate ?? null,
    summary: reading?.summary ?? null,
    securityFacts,
    protected: protectedReason !== null,
    protectedReason,
    code: code?.code ?? null,
    codeExpiresAt: code?.expiresAt ?? null,
  };
}

// ---- The rules-only reading, for backfilled history (no model) ----

const BULK_LOCALPARTS = ['no-reply', 'noreply', 'no_reply', 'do-not-reply', 'donotreply', 'notifications', 'notification', 'newsletter', 'news', 'mailer', 'updates', 'marketing'];
const BULK_BODY_CUES = ['unsubscribe', 'manage preferences', 'manage your preferences', 'view in browser', 'view this email in your browser', 'update your email preferences'];
const GENERIC_NAME_SUFFIX = /\s+(?:team|support|notifications?|alerts?|no-?reply|customer (?:service|care)|billing|accounts?|security|news|newsletter|updates|mail)$/i;
const VIA = /\s+(?:via|through)\s+(.+)$/i;

const localPart = (address: string) => address.slice(0, address.indexOf('@') < 0 ? address.length : address.indexOf('@')).toLowerCase();
/** v1's bulk-sender signal: a no-reply style address. */
export const isBulkSender = (address: string) => {
  const local = localPart(address);
  return BULK_LOCALPARTS.some(prefix => local === prefix || local.startsWith(`${prefix}.`) || local.startsWith(`${prefix}-`) || local.startsWith(`${prefix}+`));
};
const titleCase = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** The name a domain stands for: "eng.northwind.example" → "Northwind". */
export function organisationFromDomain(address: string): string | null {
  const domain = address.slice(address.lastIndexOf('@') + 1).toLowerCase();
  const labels = domain.split('.').filter(Boolean);
  if (labels.length < 2) return null;
  return titleCase(labels.at(-2)!.replace(/-/g, ' '));
}

/**
 * Who it's from without a model (the history pass): the display name without "via Greenhouse" and
 * generic tails ("Woodgrove Bank Alerts" → "Woodgrove Bank"), or the domain's name when there's no display name or a
 * person's name on a no-reply address.
 */
export function organisationFromSender(fromName: string, fromAddress: string): {organisation: string | null; via: string | null} {
  let name = fromName.replace(/^["']|["']$/g, '').trim();
  let via: string | null = null;
  const viaMatch = VIA.exec(name);
  if (viaMatch) {
    via = viaMatch[1]!.trim();
    name = name.slice(0, viaMatch.index).trim();
  }
  name = name.replace(GENERIC_NAME_SUFFIX, '').trim();
  const fromDomain = organisationFromDomain(fromAddress);
  // Through a platform, the domain is the platform's, never the organisation.
  if (!name || name.includes('@')) return {organisation: via ? name || null : fromDomain, via};
  // "Priya Raman" <no-reply@northwind.example>: a person writing through the company's system,
  // when neither word of the name is in the domain ("Tailspin Toys" <news@tailspintoys.example> isn't).
  const domainCompact = (fromDomain ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const person = /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(name) && !name.toLowerCase().split(' ').some(word => domainCompact.includes(word));
  if (!via && fromDomain && isBulkSender(fromAddress) && person) return {organisation: fromDomain, via};
  return {organisation: name, via};
}

/** The type the words say, in order of how decisive they are (the history pass). */
const TYPE_PATTERNS: [MessageType, RegExp][] = [
  ['rejection', /\b(?:unfortunately|not (?:be )?moving forward|other candidates|decided not to proceed|won't be moving forward|not selected)\b/i],
  ['shipping', /\b(?:shipped|out for delivery|delivered|arriving (?:today|tomorrow)|in transit|tracking number)\b/i],
  ['statement', /\b(?:statement (?:is )?(?:ready|available)|bill is (?:ready|available)|e-?statement|your statement)\b/i],
  ['receipt', /\b(?:receipt|you sent|payment (?:received|confirmation)|we received (?:your )?(?:payment|\$)|order total)\b/i],
  ['confirmation', /\b(?:confirm(?:ed|ation)|application received|thanks for (?:applying|your order)|we(?:'ve| have) received your application|ordered:)\b/i],
  ['alert', /\b(?:security alert|new sign-?in|sign-?in (?:attempt|from)|new device|was granted access|alert)\b/i],
  ['deadline', /\b(?:due (?:by|on|date)|deadline|expires on|sign by)\b/i],
  ['reminder', /\b(?:reminder|renewal notice|don't forget|coming up)\b/i],
  ['newsletter', /\b(?:newsletter|digest|this week|weekly|monthly|journal|edition)\b/i],
];

export function typeFromText(subject: string, body: string): MessageType | null {
  const subjectType = TYPE_PATTERNS.find(([, pattern]) => pattern.test(subject))?.[0];
  if (subjectType) return subjectType;
  return TYPE_PATTERNS.find(([, pattern]) => pattern.test(body.slice(0, 2000)))?.[0] ?? null;
}

const KIND_OF_TYPE: Partial<Record<MessageType, Kind>> = {
  shipping: 'deliveries', receipt: 'money', statement: 'money', rejection: 'career', alert: 'security', verification_code: 'security', newsletter: 'updates',
};

/**
 * A reading without a model, for backfilled history: organisation from the sender, type from the
 * words, and Noise only for bulk mail with an unsubscribe footer and no important subject (v1's
 * no-model scorer's signals, made stricter: history is read, not triaged into a queue).
 */
export function historyReading(email: {fromName: string; fromAddress: string; subject: string; bodyText: string}): Reading {
  const {organisation, via} = organisationFromSender(email.fromName, email.fromAddress);
  const type = typeFromText(email.subject, email.bodyText);
  const body = email.bodyText.toLowerCase();
  const bulk = isBulkSender(email.fromAddress) && BULK_BODY_CUES.some(cue => body.includes(cue));
  const important = /\b(?:invoice|payment|receipt|past due|overdue|security|verify|verification|action required|appointment|deadline|due date)\b/i.test(email.subject);
  const noise = bulk && !important && (type === null || type === 'newsletter');
  return {
    lane: noise ? 'noise' : 'fyi', kind: noise ? null : (type ? KIND_OF_TYPE[type] ?? 'other' : 'other'), organisation, via, type,
    keyDate: null, summary: null, security: null, protectedClaim: null, confidence: 1,
  };
}
