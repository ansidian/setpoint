// The line's phrases against the editor's rows: the latest change wins each field. A row's pick
// or clear deletes the phrase that set its field from the line, and a phrase for a field typed
// afterwards takes the field back from the row.
import type {Mark, ParsedTitle} from './compose.ts';

/** A field the line's phrases can set, as the editor's rows name them. */
export type LineField = 'date' | 'time' | 'place' | 'calendar' | 'recurrence' | 'project';

export const LINE_FIELDS: readonly LineField[] = ['date', 'time', 'place', 'calendar', 'recurrence', 'project'];

/** What a read gives a field: a span of days counts as the date's, a length as the time's. */
function valueOf(parsed: ParsedTitle, field: LineField): unknown[] {
  if (field === 'date') return [parsed.date, parsed.days];
  if (field === 'time') return [parsed.start, parsed.end, parsed.length];
  return [parsed[field]];
}

const same = (a: unknown[], b: unknown[]) => a.every((value, index) => value === b[index]);

/** The fields a read of the line sets: those a phrase there names. */
export const namedFields = (parsed: ParsedTitle): LineField[] =>
  LINE_FIELDS.filter(field => valueOf(parsed, field).some(value => value !== null));

/**
 * The line with one phrase taken out, and the spaces it leaves: the space after it goes with it, or
 * the one before when it ends the line. `start` is where it was cut and `length` how much went.
 */
export function withoutPhrase(text: string, mark: Mark): {text: string; start: number; length: number} {
  let [start, end] = [mark.start, mark.end];
  const after = /^\s+/.exec(text.slice(end));
  if (after) end += after[0].length;
  else if (end >= text.length) start -= /\s*$/.exec(text.slice(0, start))![0].length;
  return {text: text.slice(0, start) + text.slice(end), start, length: end - start};
}

/** The caret once `cut` is taken out: moved back only if it sat after it, to its start if inside. */
export const caretAfterCut = (caret: number, cut: {start: number; length: number}) =>
  caret >= cut.start + cut.length ? caret - cut.length : caret > cut.start ? cut.start : caret;

/**
 * The phrase that sets `field`, and every field it sets ("fri 7-9pm" sets the date and the time),
 * found by reading the line without each phrase in turn. Null when no phrase sets it.
 */
export function phraseOf(text: string, read: (text: string) => ParsedTitle, field: LineField): {mark: Mark; fields: LineField[]} | null {
  const parsed = read(text);
  for (const mark of parsed.marks) {
    const without = read(withoutPhrase(text, mark).text);
    const fields = LINE_FIELDS.filter(one => !same(valueOf(parsed, one), valueOf(without, one)));
    if (fields.includes(field)) return {mark, fields};
  }
  return null;
}

/**
 * The line once the rows have set `fields`: each one's phrase deleted. `held` are the other fields
 * those phrases set, which keep the values they had as if set in their rows too.
 */
export function dropPhrases(text: string, read: (text: string) => ParsedTitle, fields: LineField[], caret: number | null = null): {text: string; caret: number | null; held: LineField[]} {
  const held = new Set<LineField>();
  for (const field of fields) {
    const found = phraseOf(text, read, field);
    if (!found) continue;
    const cut = withoutPhrase(text, found.mark);
    text = cut.text;
    if (caret !== null) caret = caretAfterCut(caret, cut);
    for (const one of found.fields) if (!fields.includes(one)) held.add(one);
  }
  return {text, caret, held: [...held]};
}

/**
 * The fields set in their rows that stay so: a phrase the line now names takes its field back. A
 * row's change deletes the field's phrase, so one there now was typed after it.
 */
export const keptPicks = <F extends string>(manual: F[], parsed: ParsedTitle): F[] => {
  const named = namedFields(parsed) as string[];
  return manual.filter(field => !named.includes(field));
};
