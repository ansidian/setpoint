// What a model is told when it reads a whole search (src/search/reading.ts), and how its answer is
// checked. A change to the prompt bumps SEARCH_READING_PROMPT_VERSION, which the search log records
// beside each reading, so wrong readings can be told apart by the prompt that made them.
//
// It's given only the organisations and types in the search's best keyword matches, with counts. A
// version given every organisation misread more and repeated itself less (SV-133's query
// understanding test). Dates aren't the model's: the grammar reads them (dateChip), the same every
// time, and the model only says when the words the grammar took for a date are really a name.
import {MESSAGE_TYPES} from '@setpoint/shared';
import type {MessageType} from '@setpoint/shared';
import {wordsOf} from '../domain/searchChips.ts';
import {FILLER_WORDS} from '../domain/searchMatch.ts';
import type {ToolSpec} from '../providers/ai/index.ts';

export const SEARCH_READING_PROMPT_VERSION = 1;
export const SEARCH_READING_MODEL = 'claude-haiku-5-5';
export const SEARCH_READING_MAX_OUTPUT_TOKENS = 300;

// The best keyword matches facets are counted over, and how many of each the model is shown.
export const FACET_MATCHES = 60;
const FACET_ORGANISATIONS = 25;
const FACET_TYPES = 6;
// A typed word this short is a fragment of too many names to bring one to the model's list.
const NAME_WORD_MIN = 3;
// What one reading may filter by, so its chips always fit a later request's.
const MAX_ORGANISATIONS = 5;
const MAX_TYPES = 3;

export const SEARCH_READING_SYSTEM = `You read one search typed into the user's personal email search and say what filters it asks for. Answer only with the submit_reading tool.

A filter hides every email that doesn't match it, so use one only when the search clearly asks for it. Every other meaningful word stays in keywords.

organisations: only when the search names who the email is from, or clearly means one organisation in the list you're given. Use names exactly as listed, and all the listed names that are the same organisation. A word that only looks like part of a name is not a filter: "first aid" doesn't mean First Proseware.
types: only when the search asks for that kind of email ("receipts", "my rejections"). A word used in another sense stays a keyword: "statement of work" isn't a statement, "alert dog" isn't an alert. A bill is a statement.
is_date: you may be told the app found a date in the search. Say true when those words say when the email came, and false when they are part of a name or a topic instead. A month inside a name isn't a date. Say true when no date was found.
keywords: the words left to search for, without filter words, date words or filler. Empty when the filters say it all.

Say nothing you can't support from the search itself and the lists given.`;

export const SEARCH_READING_TOOL: ToolSpec = {
  name: 'submit_reading',
  description: 'Submit what the search asks for.',
  schema: {
    type: 'object',
    properties: {
      organisations: {type: 'array', items: {type: 'string'}},
      types: {type: 'array', items: {type: 'string', enum: [...MESSAGE_TYPES]}},
      is_date: {type: 'boolean'},
      keywords: {type: 'string'},
    },
    required: ['organisations', 'types', 'is_date', 'keywords'],
    additionalProperties: false,
  },
};

type Counted = [name: string, count: number];

export interface ReadingFacets {
  organisations: Counted[];
  types: Counted[];
}

const byCount = (counts: Map<string, number>, limit: number): Counted[] => [...counts].sort(([a, one], [b, other]) => other - one || a.localeCompare(b)).slice(0, limit);

/**
 * What the best matches hold, most first, and with no count the organisations whose name has a word
 * starting as a typed word does, for the search that names one its mail doesn't match.
 */
export function readingFacets(matches: {organisation: string | null; type: string | null}[], organisations: string[], search: string): ReadingFacets {
  const orgs = new Map<string, number>();
  const types = new Map<string, number>();
  const add = (counts: Map<string, number>, name: string | null) => {
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  };
  for (const {organisation, type} of matches) {
    add(orgs, organisation);
    add(types, type);
  }
  const words = wordsOf(search).filter(word => word.length >= NAME_WORD_MIN && !FILLER_WORDS.has(word));
  for (const name of organisations) {
    if (!orgs.has(name) && wordsOf(name).some(own => words.some(word => own.startsWith(word)))) orgs.set(name, 0);
  }
  return {organisations: byCount(orgs, FACET_ORGANISATIONS), types: byCount(types, FACET_TYPES)};
}

const counted = (list: Counted[]) => list.map(([name, count]) => `${name} (${count})`).join('; ') || 'none';

/** The prompt's input for one search. `dates` are the labels of the dates the grammar found in it. */
export function searchReadingInput({search, today, facets, dates}: {search: string; today: string; facets: ReadingFacets; dates: string[]}): string {
  return [
    `Today: ${today}`,
    `Organisations near this search, with how many of the best keyword matches each has: ${counted(facets.organisations)}`,
    `Types in those matches: ${counted(facets.types)}`,
    ...(dates.length ? [`The app found a date in this search: ${dates.join('; ')}`] : []),
    '',
    `Search: ${search}`,
  ].join('\n');
}

export interface Reading {
  organisations: string[];
  types: MessageType[];
  // Whether the date the grammar found stands.
  isDate: boolean;
  keywords: string;
}

const isType = (value: unknown): value is MessageType => MESSAGE_TYPES.includes(value as MessageType);
const strings = (value: unknown) => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : []);

/** An answer as a reading, or null for one that didn't give one. */
export function readingOf(input: Record<string, unknown> | null): Reading | null {
  if (!input || !Array.isArray(input.organisations) || !Array.isArray(input.types) || typeof input.keywords !== 'string') return null;
  return {
    organisations: [...new Set(strings(input.organisations))].slice(0, MAX_ORGANISATIONS),
    types: [...new Set(input.types.filter(isType))].slice(0, MAX_TYPES),
    isDate: input.is_date !== false,
    keywords: input.keywords,
  };
}
