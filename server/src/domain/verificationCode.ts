// Verification codes (BRIEF.md › Security mail: "codes are temporary"): one exact code found in an
// email's subject, snippet or body, or none. Harvested from v1's `verification-code-detector`
// (SV-4's harvest note): conservative and context-bound, because v1's production sampling found
// that matching "code" broadly catches programming and news mail, order numbers, phone numbers and
// prices. A code is returned only when exactly one candidate scores highest; anything ambiguous is
// no code. The row leaves the Inbox after Settings › Mail's code expiry (15 minutes by default),
// counted from the email's arrival; v1 used a fixed 30.
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

/** A strict ISO 8601 UTC instant that round-trips (v1 refused anything else rather than guess). */
function validInstant(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 19) === value.slice(0, 19) ? parsed : null;
}

/**
 * Blanks out what looks like a code but isn't, keeping positions: links, addresses, UUIDs, prices,
 * dates, clock times, phone numbers and order/tracking/claim/ticket/invoice numbers.
 */
function maskRejected(text: string): string {
  const mask = (value: string) => ' '.repeat(value.length);
  return text
    .replace(/https?:\/\/\S+/gi, mask)
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, mask)
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, mask)
    .replace(/[$€£]\s*\d[\d,.]*/g, mask)
    .replace(/\b\d{1,4}[/-]\d{1,2}[/-]\d{1,4}\b/g, mask)
    .replace(/\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*[ap]m)?\b/gi, mask)
    .replace(/(?:\+?\d[\s().-]*){10,}/g, mask)
    .replace(/\b(?:order|tracking|claim|ticket|invoice)\s*(?:(?:number|no\.?|id)\s*)?[:#-]?\s*[A-Za-z0-9-]{4,}\b/gi, mask);
}

/** 4–8 digits; 4–12 letters and digits with at least one of each; or 2–4 hyphenated groups of 3–4. */
function classify(code: string): Pick<Candidate, 'kind' | 'alphabeticHyphenated'> | null {
  if (/^\d{4,8}$/.test(code)) return {kind: 'numeric', alphabeticHyphenated: false};
  if (/^[A-Za-z0-9]{4,12}$/.test(code) && /[A-Za-z]/.test(code) && /\d/.test(code)) return {kind: 'alphanumeric', alphabeticHyphenated: false};
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
function scoreField(text: string, fieldBase: number, allowBareCode: boolean): Scored[] {
  const candidates = candidatesIn(text);
  if (!candidates.length) return [];
  const markers = [...text.matchAll(new RegExp(`\\b(?:${STRONG_MARKER_SOURCE})\\b${allowBareCode ? '|\\bcode\\b' : ''}`, 'gi'))];
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

/** The email's one verification code and when its row expires, or null. */
export function detectVerificationCode(input: CodeInput): DetectedCode | null {
  const received = validInstant(input.receivedAt);
  if (!received) return null;
  const subject = normalizeCodeText(input.subject);
  const snippet = normalizeCodeText(input.snippet);
  const bodyText = normalizeCodeText(input.bodyText);
  const subjectHasStrongMarker = STRONG_MARKER.test(subject);
  const matches = [
    ...scoreField(subject, 100, false),
    ...scoreField(snippet, 70, subjectHasStrongMarker),
    ...scoreField(bodyText, 60, subjectHasStrongMarker),
  ];
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
  if (winners.length !== 1) return null;
  const winner = winners[0]!;
  return {code: winner.code, kind: winner.kind, expiresAt: new Date(received.getTime() + input.expiryMinutes * 60_000).toISOString()};
}
