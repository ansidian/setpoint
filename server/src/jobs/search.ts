// Jobs's search (J5, decisions 52 and 62, D306, D316): company or role first, then a match only in a
// JD's text with the line it matched. Pure, so its ranking and its loose company matching are tested
// as tables; queries.ts runs it over the store. It's Jobs's own: mail's search and ⌘K never see it.

/** Words as search compares them: case and punctuation ignored ("City Power & Light" is city power light). */
export const searchWords = (text: string): string[] => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * The query's words start the name, in order, the last one perhaps unfinished: "wide world" and "wide
 * wor" are Wide World Importers, "humongous" both Humongous Insurance applications. Loose as companies
 * match elsewhere (rules.ts › sameCompany): case and punctuation don't count.
 */
export function startsName(name: string[], query: string[]): boolean {
  if (query.length === 0 || query.length > name.length) return false;
  return query.every((word, index) => (index === query.length - 1 ? name[index]!.startsWith(word) : name[index] === word));
}

/** Every query word starts one of the words: "insurance" finds Humongous Insurance, "eng ii" Software Engineer II. */
export const startsWords = (words: string[], query: string[]): boolean => query.length > 0 && query.every(word => words.some(each => each.startsWith(word)));

/**
 * How well an application's company and role answer the query, best first, or null for no match:
 * 0 the company starts with it, 1 its words start the company's words, 2 the role's, 3 the company's
 * and the role's together ("humongous claims").
 */
export function nameRank(company: string, title: string, query: string[]): number | null {
  const companyWords = searchWords(company);
  const titleWords = searchWords(title);
  if (startsName(companyWords, query)) return 0;
  if (startsWords(companyWords, query)) return 1;
  if (startsWords(titleWords, query)) return 2;
  if (startsWords([...companyWords, ...titleWords], query)) return 3;
  return null;
}

// A line's markdown, as it reads: list and heading marks, emphasis and links' targets dropped.
const plainLine = (line: string) => line
  .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)/, '')
  .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  .replace(/[*_`]+/g, '')
  .trim();

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// How far the quoted line reaches on each side of the match, in words, stopping at a clause's start
// before it and a sentence's end after it.
const WORDS_BEFORE = 6;
const WORDS_AFTER = 11;
const ENDS_BEFORE = /[.:;!?]$/;
const ENDS_AFTER = /[.;!?]$/;

/**
 * The line of a JD's text a query matched, as the search result quotes it with an ellipsis at each
 * end: "…our services run on Kubernetes across two regions, so you’ll pick it up from day one…" (36b).
 * Null when a query word isn't in the text at the start of a word.
 */
export function matchedLine(fullText: string, query: string[]): string | null {
  if (query.length === 0) return null;
  const words = new Set(searchWords(fullText));
  if (!query.every(word => [...words].some(each => each.startsWith(word)))) return null;
  const first = new RegExp(`(?:^|[^\\p{L}\\p{N}])(${escape(query[0]!)})`, 'iu');
  for (const raw of fullText.split('\n')) {
    const line = plainLine(raw);
    const found = first.exec(line);
    if (!found) continue;
    const at = found.index + found[0].length - found[1]!.length;
    const spans = [...line.matchAll(/\S+/g)];
    const tokens = spans.map(span => span[0]);
    // The token the match is in.
    const index = Math.max(0, spans.findIndex(span => span.index + span[0].length > at));
    let from = index;
    while (from > 0 && index - from < WORDS_BEFORE && !ENDS_BEFORE.test(tokens[from - 1]!)) from -= 1;
    let to = index;
    while (to < tokens.length - 1 && to - index < WORDS_AFTER && !ENDS_AFTER.test(tokens[to]!)) to += 1;
    const quoted = tokens.slice(from, to + 1).join(' ').replace(/[,.:;!?]+$/, '');
    return `…${quoted}…`;
  }
  return null;
}

/** An application as search reads it: its names, when it was applied to, and its JD's text if it has one. */
export interface Searchable {
  id: number;
  company: string;
  title: string;
  appliedAt: string;
  fullText: string | null;
}

/**
 * The search's answer: company or role matches by rank, newest first within each; then the ones
 * whose JD alone matched, newest first, each with its line.
 */
export function searchApplications(applications: Searchable[], q: string): {companyOrRole: number[]; inJd: {id: number; line: string}[]} {
  const query = searchWords(q);
  const newest = (a: Searchable, b: Searchable) => b.appliedAt.localeCompare(a.appliedAt) || b.id - a.id;
  const ranked = applications.map(application => ({application, rank: nameRank(application.company, application.title, query)}));
  const companyOrRole = ranked.filter(each => each.rank !== null)
    .sort((a, b) => a.rank! - b.rank! || newest(a.application, b.application))
    .map(each => each.application.id);
  const inJd = ranked.filter(each => each.rank === null && each.application.fullText !== null)
    .map(each => ({application: each.application, line: matchedLine(each.application.fullText!, query)}))
    .filter((each): each is {application: Searchable; line: string} => each.line !== null)
    .sort((a, b) => newest(a.application, b.application))
    .map(each => ({id: each.application.id, line: each.line}));
  return {companyOrRole, inJd};
}
