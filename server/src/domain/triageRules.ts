// Matching triage rules against an email (BRIEF.md › Triage: rules first). The match shape is v1's
// `preflight-rules.json` (harvested, SV-4): sender keys are alternatives, every other key present
// must match too, text matches ignore case, and `none_includes` vetoes a match. v2 adds
// `organisation` and `type`, which match what the model extracted, so a rule using them (every
// learned rule) applies only after the model has read the email.
//
// Rules decide a lane; they never decide protection. src/domain/triagePolicy.ts applies the
// protected class after every rule (decision 29).
import type {Kind, Lane, MessageType, RuleMatch} from '@setpoint/shared';

export interface RuleEmail {
  fromName: string;
  fromAddress: string;
  subject: string;
  snippet: string;
  bodyText: string;
}

/** What the model (or the history pass) read: what `organisation` and `type` rules match. */
export interface Extracted {
  organisation: string | null;
  type: MessageType | null;
}

/**
 * A rule as triage applies it: the user's written ones (by position), then learned ones, then the
 * shipped defaults (src/triage/defaultRules.json). A default with `lane: null` decides nothing; it
 * only routes the email to the model (v1's `route_model`).
 */
export interface Rule {
  id: number | null;
  key: string;
  source: 'written' | 'learned' | 'default';
  match: RuleMatch;
  lane: Lane | null;
  kind: Kind | null;
  // A shipped default may also say the type ("shipping").
  type: MessageType | null;
}

const lower = (value: unknown) => String(value ?? '').toLowerCase();

interface Parts {
  subject: string;
  snippet: string;
  body: string;
  fromName: string;
  fromAddress: string;
  fromDomain: string;
  all: string;
}

function partsOf(email: RuleEmail): Parts {
  const fromAddress = lower(email.fromAddress).trim();
  const parts = {
    subject: lower(email.subject), snippet: lower(email.snippet), body: lower(email.bodyText), fromName: lower(email.fromName),
    fromAddress, fromDomain: fromAddress.slice(fromAddress.lastIndexOf('@') + 1),
  };
  return {...parts, all: [parts.fromName, parts.fromAddress, parts.subject, parts.snippet, parts.body].join('\n')};
}

const includesAny = (text: string, needles: readonly string[] = []) => needles.some(needle => text.includes(lower(needle)));

// Patterns are case-insensitive with no `g` flag, so a compiled one keeps no state between tests
// and can be shared (v1's cache). One that doesn't compile never matches.
const compiled = new Map<string, RegExp | null>();
function regex(pattern: string): RegExp | null {
  if (!compiled.has(pattern)) {
    let value: RegExp | null;
    try {
      value = new RegExp(pattern, 'i');
    } catch {
      value = null;
    }
    compiled.set(pattern, value);
  }
  return compiled.get(pattern) ?? null;
}
const regexMatches = (text: string, pattern: string) => regex(pattern)?.test(text) ?? false;

/** A rule using `organisation` or `type` needs the model's reading first. */
export const needsReading = (match: RuleMatch) => match.organisation !== undefined || match.type !== undefined;

/** A match that names who sent it (v1's "scoped" rule). */
export const isScoped = (match: RuleMatch) => Boolean(match.from_addresses || match.from_domains || match.from_name_includes);

export const organisationKey = (organisation: string) => organisation.trim().toLowerCase().replace(/\s+/g, ' ');

/** Whether one rule's match fits the email (and, for `organisation` and `type`, what was read). */
export function matchesRule(email: RuleEmail, match: RuleMatch, extracted: Extracted | null, parts = partsOf(email)): boolean {
  if (needsReading(match) && !extracted) return false;
  if (match.none_includes && includesAny(parts.all, match.none_includes)) return false;
  // Sender keys are alternatives: an address, a domain (or its subdomain), or a name.
  const senders: boolean[] = [];
  if (match.from_addresses) senders.push(match.from_addresses.map(lower).includes(parts.fromAddress));
  if (match.from_domains) senders.push(match.from_domains.map(lower).some(domain => parts.fromDomain === domain || parts.fromDomain.endsWith(`.${domain}`)));
  if (match.from_name_includes) senders.push(includesAny(parts.fromName, match.from_name_includes));
  if (senders.length && !senders.some(Boolean)) return false;
  if (match.subject_includes && !includesAny(parts.subject, match.subject_includes)) return false;
  if (match.subject_regex && !regexMatches(parts.subject, match.subject_regex)) return false;
  if (match.body_includes && !includesAny(`${parts.snippet}\n${parts.body}`, match.body_includes)) return false;
  if (match.body_regex && !regexMatches(`${parts.snippet}\n${parts.body}`, match.body_regex)) return false;
  if (match.organisation !== undefined && organisationKey(extracted?.organisation ?? '') !== organisationKey(match.organisation)) return false;
  if (match.type !== undefined && extracted?.type !== match.type) return false;
  // A match needs at least one positive key (the shared schema refuses one without).
  return Object.entries(match).some(([key, value]) => key !== 'none_includes' && value !== undefined);
}

/** The first rule that fits, in the order given; rules needing a reading are skipped without one. */
export function firstMatch<T extends Rule>(rules: readonly T[], email: RuleEmail, extracted: Extracted | null): T | null {
  const parts = partsOf(email);
  return rules.find(rule => matchesRule(email, rule.match, extracted, parts)) ?? null;
}

/**
 * v1's hard-risk words, kept as they were: mail that may cost money, a deadline or an account. The
 * strong model reads such mail even when a rule matched (see ruleDecides).
 */
const HARD_RISK_PATTERNS = [
  /\bpast due\b/i, /\boverdue\b/i, /\blow balance\b/i, /\binsufficient funds\b/i,
  /\bservice (?:interruption|suspension|disconnect|disconnection)\b/i, /\bmay be interrupted\b/i,
  /\bcard (?:expired|expiring|declined)\b/i, /\bpayment due\b/i, /\bpayment (?:failed|failure|declined|unsuccessful)\b/i,
  /\blegal notice\b/i, /\btax document\b/i, /\btuition\b/i, /\bregistration deadline\b/i, /\bassignment (?:deadline|due)\b/i,
  /\bunrecognized sign-?in\b/i, /\bsuspicious sign-?in\b/i, /\bpassword changed\b/i, /\baccount recovery\b/i,
  /\bthird-party oauth application\b/i,
];

export function hasHardRisk(email: RuleEmail): boolean {
  const {all} = partsOf(email);
  return HARD_RISK_PATTERNS.some(pattern => pattern.test(all));
}

/**
 * Whether a matched rule may decide the lane by itself. Hard-risk mail is the strong model's to
 * read unless the rule keeps it in Attention or names its sender (the user's explicit choice for that
 * sender, as v1's scoped hard-risk finalizers).
 */
export function ruleDecides(rule: Rule, hardRisk: boolean): boolean {
  if (rule.lane === null) return false;
  if (!hardRisk || rule.lane === 'attention') return true;
  return rule.source !== 'default' && isScoped(rule.match);
}
