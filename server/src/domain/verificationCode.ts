// Verification codes (BRIEF.md › Security mail: "codes are temporary"): one exact code found in an
// email's subject, snippet or body, or none. Harvested from v1's `verification-code-detector`
// (SV-4's harvest note): conservative and context-bound, because v1's production sampling found
// that matching "code" broadly catches programming and news mail, order numbers, phone numbers and
// prices. A code is returned only when exactly one candidate scores highest; anything ambiguous is
// no code. When that strict pass finds none and the subject says it's a code email, a second pass
// applies Android's rule (SV-68, from AOSP's NotificationOtpDetectionHelper, Apache-2.0): a context
// word within 50 characters of the code, in its sentence or the one before, with any words between;
// again exactly one code or none. Both read the HTML part's text as well as the text part, since
// some senders put the code only in the HTML. The row leaves the Inbox after Settings › Mail's code
// expiry (15 minutes by default), counted from the email's arrival; v1 used a fixed 30.
//
// Pure: no I/O, and nothing here logs a code or its surroundings.

export const CODE_KINDS = ['numeric', 'alphanumeric', 'hyphenated'] as const;
export type CodeKind = (typeof CODE_KINDS)[number];

export interface DetectedCode {
  // The token exactly as written: leading zeroes, case and hyphens kept.
  code: string;
  kind: CodeKind;
  // When its row leaves the Inbox.
  expiresAt: string;
}

export interface CodeInput {
  subject: string | null | undefined;
  snippet: string | null | undefined;
  bodyText: string | null | undefined;
  bodyHtml?: string | null | undefined;
  // When the email arrived (ISO 8601 UTC); without a valid one, freshness can't be known.
  receivedAt: string | null | undefined;
  expiryMinutes: number;
}

interface Candidate {
  code: string;
  kind: CodeKind;
  start: number;
  end: number;
  // Letters only in hyphenated groups ("abcd-efgh"): accepted only in the strongest templates.
  alphabeticHyphenated: boolean;
}

interface Scored {
  code: string;
  kind: CodeKind;
  score: number;
}

const NAMED_ENTITIES: Record<string, string> = {amp: '&', apos: '\'', gt: '>', lt: '<', nbsp: ' ', quot: '"'};

// Phrases that say "this is a code": strong ones always count; the bare word "code" counts only
// when the subject already has a strong one (v1: "Your code is 482913" in a code email's body).
const STRONG_MARKER_SOURCE = [
  String.raw`(?:verification|security|authentication|confirmation|login|sign[\s-]?in|one[\s-]?time)\s+(?:code|passcode|pin|password)`,
  String.raw`(?:otp|passcode|pin(?:\s+code)?)`,
  String.raw`verif(?:y|ying)\s+(?:your\s+)?identity`,
].join('|');
const STRONG_MARKER = new RegExp(`\\b(?:${STRONG_MARKER_SOURCE})\\b`, 'i');
const STRONG_MARKER_EXACT = new RegExp(`^(?:${STRONG_MARKER_SOURCE})$`, 'i');
// "Confirmation code" also heads payment receipts and offers ("Confirmation Code: 7351902"), so it
// counts in an email only when the subject says it's a code email (SV-68; Android dropped
// "confirmation" for the same reason).
const CONFIRMATION_MARKER = /^confirmation\s/i;

const CANDIDATE_RE = /(?<![A-Za-z0-9])(?:[A-Za-z0-9]{3,4}(?:-[A-Za-z0-9]{3,4}){1,3}|[A-Za-z0-9]{4,12})(?![A-Za-z0-9])/g;
// What may sit between a marker and the code after it ("code: 482913", "code is below 482913").
const DIRECT_GAP_RE = /^[\s:;,.#=()–—-]*(?:(?:is|is below|below|following|to use)[\s:;,.#=()–—-]*)?$/i;
// …and between a code and the marker after it ("482913 is your verification code").
const LEADING_DIRECT_GAP_RE = /^[\s:;,.#=()–—-]*(?:is\s+your|is\s+the|[-–—:])[\s:;,.#=()–—-]*$/i;

function decodeEntity(entity: string, body: string): string {
  const normalized = body.toLowerCase();
  if (normalized.startsWith('#x')) {
    const value = Number.parseInt(normalized.slice(2), 16);
    return Number.isFinite(value) && value <= 0x10FFFF ? String.fromCodePoint(value) : entity;
  }
  if (normalized.startsWith('#')) {
    const value = Number.parseInt(normalized.slice(1), 10);
    return Number.isFinite(value) && value <= 0x10FFFF ? String.fromCodePoint(value) : entity;
  }
  return NAMED_ENTITIES[normalized] ?? entity;
}

/** Visible text: entities decoded, invisible formatting (zero-width, BOM) dropped, whitespace collapsed. */
export function normalizeCodeText(value: unknown): string {
  return String(value ?? '')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|apos|gt|lt|nbsp|quot);/gi, decodeEntity)
    .replace(/[\p{Cf}\uFEFF]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Text with any markup in it (a text part can carry raw tags) read as spaces. */
function stripTags(value: string): string {
  return value.replace(/<\/?[A-Za-z][^<>]*>/g, ' ');
}

// Enough of the HTML part's text to hold a code, however long the email.
const HTML_TEXT_LIMIT = 20_000;

/** The HTML part's visible text: head, styles, scripts and comments dropped, every tag a space. */
function htmlText(html: string | null | undefined): string {
  if (!html) return '';
  const body = html.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(head|style|script)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  return normalizeCodeText(stripTags(body)).slice(0, HTML_TEXT_LIMIT);
}

/** A strict ISO 8601 UTC instant that round-trips (v1 refused anything else rather than guess). */
function validInstant(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 19) === value.slice(0, 19) ? parsed : null;
}

/**
 * Blanks out what looks like a code but isn't, keeping positions: links, addresses, UUIDs, IPv6
 * addresses, prices, dates, clock times, phone numbers, ZIP and postal codes, dial-in passcodes
 * ending "#", promotion codes (promo, coupon, discount, offer, voucher, gift, referral), and
 * order/tracking/claim/ticket/invoice numbers.
 */
function maskRejected(text: string): string {
  const mask = (value: string) => ' '.repeat(value.length);
  return text
    .replace(/https?:\/\/\S+/gi, mask)
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, mask)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, mask)
    .replace(/\b(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}\b/gi, mask)
    .replace(/[$€£]\s*\d[\d,.]*/g, mask)
    .replace(/\b\d{1,4}[/-]\d{1,2}[/-]\d{1,4}\b/g, mask)
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?\b/gi, mask)
    .replace(/(?:\+?\d[\s().-]*){10,}/g, mask)
    .replace(/,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/g, mask)
    .replace(/\b\d{4,}#/g, mask)
    .replace(/\b(?:postal(?:\s+code)?|zip(?:\s+code)?|post\s*code)\s*[:#-]?\s*[A-Za-z0-9]{3,10}(?:[\s-][A-Za-z0-9]{3,4})?\b/gi, mask)
    .replace(/\b(?:promo(?:tion(?:al)?)?|coupon|discount|offer|voucher|gift|referral)\s+(?:code\s*)?[:#-]?\s*[A-Za-z0-9-]{4,}\b/gi, mask)
    .replace(/\b(?:order|tracking|claim|ticket|invoice)\s*(?:(?:number|no\.?|id)\s*)?[:#-]?\s*[A-Za-z0-9-]{4,}\b/gi, mask);
}

/** 4–8 digits; 4–12 letters and digits with at least one of each; or 2–4 hyphenated groups of 3–4. */
function classify(code: string): Pick<Candidate, 'kind' | 'alphabeticHyphenated'> | null {
  if (/^\d{4,8}$/.test(code)) return {kind: 'numeric', alphabeticHyphenated: false};
  // Three lowercase letters in a row are a word run into digits ("418265Please"); Android found no
  // code that has them.
  if (/^[A-Za-z0-9]{4,12}$/.test(code) && /[A-Za-z]/.test(code) && /\d/.test(code) && !/[a-z]{3}/.test(code)) return {kind: 'alphanumeric', alphabeticHyphenated: false};
  if (/^[A-Za-z0-9]{3,4}(?:-[A-Za-z0-9]{3,4}){1,3}$/.test(code)) return {kind: 'hyphenated', alphabeticHyphenated: !/\d/.test(code)};
  // Ordinary words ("hello", "SIGNIN") are never codes.
  return null;
}

function candidatesIn(text: string): Candidate[] {
  const candidates: Candidate[] = [];
  for (const match of maskRejected(text).matchAll(CANDIDATE_RE)) {
    const classified = classify(match[0]);
    if (!classified || match.index === undefined) continue;
    candidates.push({code: match[0], ...classified, start: match.index, end: match.index + match[0].length});
  }
  return candidates;
}

/**
 * Scores each candidate by its nearest marker: the field's base (subject 100, snippet 70, body 60),
 * plus up to 20 for closeness, plus 30 when nothing but "is", "below", punctuation and the like
 * stands between them ("direct"). Only direct candidates count.
 */
function scoreField(text: string, fieldBase: number, allowBareCode: boolean, codeEmail: boolean): Scored[] {
  const candidates = candidatesIn(text);
  if (!candidates.length) return [];
  const markers = [...text.matchAll(new RegExp(`\\b(?:${STRONG_MARKER_SOURCE})\\b${allowBareCode ? '|\\bcode\\b' : ''}`, 'gi'))]
    .filter(marker => codeEmail || !CONFIRMATION_MARKER.test(marker[0]));
  const scored: Scored[] = [];
  for (const candidate of candidates) {
    let best = -1;
    let direct = false;
    let strong = false;
    for (const marker of markers) {
      if (marker.index === undefined) continue;
      const markerStart = marker.index;
      const markerEnd = markerStart + marker[0].length;
      const isStrong = STRONG_MARKER_EXACT.test(marker[0]);
      let distance: number;
      let isDirect: boolean;
      if (candidate.start >= markerEnd) {
        // The code after its marker ("verification code: 482913"), within 64 characters.
        distance = candidate.start - markerEnd;
        if (distance > 64) continue;
        const gap = text.slice(markerEnd, candidate.start);
        isDirect = DIRECT_GAP_RE.test(gap)
          // "code for sign-in: 4F7K2Q" when the subject says it's a code email.
          || (allowBareCode && marker[0].toLowerCase() === 'code'
            && /^.{0,40}\b(?:login|sign[\s-]?in|verif(?:y|ication)|auth(?:enticate|entication))\s*:\s*$/i.test(gap));
      } else if (candidate.end <= markerStart) {
        // The code before its marker ("482913 is your verification code"), within 48 characters.
        distance = markerStart - candidate.end;
        if (distance > 48) continue;
        const gap = text.slice(candidate.end, markerStart);
        isDirect = LEADING_DIRECT_GAP_RE.test(gap) || (allowBareCode && /^\s*[-–—]/.test(gap));
      } else {
        continue;
      }
      const score = fieldBase + Math.max(0, 20 - distance) + (isDirect ? 30 : 0);
      if (score > best) {
        best = score;
        direct = isDirect;
        strong = isStrong;
      }
    }
    if (best < 0 || !direct) continue;
    // Letters-only hyphenated groups look like words ("plan-this-week"): only a direct strong
    // marker scoring 105 is enough (anywhere in the subject, within 15 characters in the snippet,
    // within 5 in the body).
    if (candidate.alphabeticHyphenated && (!strong || best < 105)) continue;
    scored.push({code: candidate.code, kind: candidate.kind, score: best});
  }
  return scored;
}

// Android's context words, less "TAN" (a German bank's transaction number, and an English word).
const CONTEXT_RE = new RegExp(String.raw`\b(?:pin|pass[-\s]?(?:code|word)|otp|2fa|(?:two|2)[-\s]?factor|log[-\s]?in|auth(?:enticat(?:e|ion))?|code|secret|verif(?:y|ication)|one[-\s]?time|access|validat(?:e|ion))\b`, 'gi');
// A subject that says it's a code email, which the second pass needs: without it, "log in" near an
// account number or "code" near a promotion would read as a code.
const CODE_SUBJECT = /\b(?:verif(?:y|ication)|one[-\s]?time|2fa|two[-\s]?factor|authenticat(?:e|ion))\b/i;
const CONTEXT_REACH = 50;

/**
 * The second pass (Android's rule): candidates with a context word within 50 characters, in their
 * sentence or the one before (the word first), or in their sentence (the word after). Years are
 * dates, and letters-only hyphenated groups are words, so neither counts here.
 */
function contextCodes(text: string): Scored[] {
  const contexts = [...text.matchAll(CONTEXT_RE)].map(match => ({start: match.index!, end: match.index! + match[0].length}));
  if (!contexts.length) return [];
  const found: Scored[] = [];
  for (const candidate of candidatesIn(text)) {
    if (candidate.alphabeticHyphenated || /^(?:19|20)\d\d$/.test(candidate.code)) continue;
    const near = contexts.some(context => {
      if (context.end <= candidate.start) {
        const gap = text.slice(context.end, candidate.start);
        return gap.length <= CONTEXT_REACH && (gap.match(/[.?!]/g)?.length ?? 0) <= 1;
      }
      if (candidate.end <= context.start) {
        const gap = text.slice(candidate.end, context.start);
        return gap.length <= CONTEXT_REACH && !/[.?!]/.test(gap);
      }
      return false;
    });
    if (near) found.push({code: candidate.code, kind: candidate.kind, score: 0});
  }
  return found;
}

/** The one code with the top score, or null when there's none or two tie. */
function onlyBest(matches: Scored[]): Scored | null {
  if (!matches.length) return null;
  // The same code seen in several fields counts once, at its best.
  const bestByCode = new Map<string, Scored>();
  for (const match of matches) {
    const existing = bestByCode.get(match.code);
    if (!existing || match.score > existing.score) bestByCode.set(match.code, match);
  }
  const top = Math.max(...[...bestByCode.values()].map(match => match.score));
  const winners = [...bestByCode.values()].filter(match => match.score === top);
  // Two different codes equally likely: no code.
  return winners.length === 1 ? winners[0]! : null;
}

/** The email's one verification code and when its row expires, or null. */
export function detectVerificationCode(input: CodeInput): DetectedCode | null {
  const received = validInstant(input.receivedAt);
  if (!received) return null;
  const subject = normalizeCodeText(stripTags(String(input.subject ?? '')));
  const snippet = normalizeCodeText(stripTags(String(input.snippet ?? '')));
  const bodyText = normalizeCodeText(stripTags(String(input.bodyText ?? '')));
  const html = htmlText(input.bodyHtml);
  const subjectHasStrongMarker = STRONG_MARKER.test(subject);
  const codeEmail = subjectHasStrongMarker || CODE_SUBJECT.test(subject);
  const winner = onlyBest([
    ...scoreField(subject, 100, false, codeEmail),
    ...scoreField(snippet, 70, subjectHasStrongMarker, codeEmail),
    ...scoreField(bodyText, 60, subjectHasStrongMarker, codeEmail),
    ...scoreField(html, 60, subjectHasStrongMarker, codeEmail),
  ]) ?? (codeEmail ? onlyBest([subject, snippet, bodyText, html].flatMap(contextCodes)) : null);
  if (!winner) return null;
  return {code: winner.code, kind: winner.kind, expiresAt: new Date(received.getTime() + input.expiryMinutes * 60_000).toISOString()};
}
