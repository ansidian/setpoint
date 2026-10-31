// Mail's search field (DESIGN.md › Search; D385). Typing runs a keyword search after a short pause,
// and its words stay words. Enter asks the server to read the whole search into chips, and that one
// answer updates the list. The field keeps the keys until it lands, so J and K can't land on a row
// that moves, and typing meanwhile drops it. A reading that fell back changes nothing on screen.
//
// Chips in the field stay in force while the words around them change (`read: 'kept'`), so nothing
// but Enter reads again, and a chip taken off stays off though the same reading is held on the server.
// A later Enter on other words reads the whole search anew, in the order typed.
//
// The phone's field is `plain` (D387 is SI-64's): its words stay words and Enter only hands it the
// results.
import type {SearchChip, SearchOut, SearchReadingFallback, SearchResultOut} from '@setpoint/shared';
import {useEffect, useRef, useState} from 'react';
import {searchChipRemoved, searchMail, searchOpened} from '../../api/search.ts';
import type {SearchQuery} from '../../api/search.ts';
import {alfredQuestion, foldFor, isSearching, standsForWords, toggledFold, typedAfter, wordsBack, worthAskingAgain} from '../../logic/search.ts';
import type {LeftOut, MentionsFold} from '../../logic/search.ts';
import {TYPING_MS} from './state.ts';
import type {SearchFieldState, Settled} from './state.ts';

export interface Search extends SearchFieldState<SearchChip, SearchOut, SearchResultOut> {
  // Enter's reading is on its way: the field's glyph turns, and nothing else moves.
  reading: boolean;
  // What the answers are for: another search's fold is drawn afresh, without motion.
  answering: string;
  // Whether the results that only mention the search show (logic/search.ts › foldFor).
  mentions: boolean;
  toggleMentions: () => void;
  // What Enter's chips left out, once the user has opened its line: `read: 'left_out'`.
  leftOut: LeftOut<SearchResultOut> | null;
  toggleLeftOut: () => void;
  // Another page of them is there to ask for.
  moreLeftOut: boolean;
  loadLeftOut: () => void;
  // Every row the list can show.
  listed: SearchResultOut[];
  /** The search log: the user opened this result, at its place in the list. */
  opened: (id: number) => void;
  /** A result as an action left it: read once opened, Done (UX #9). */
  mark: (id: number, change: Partial<SearchResultOut>) => void;
  question: () => string;
}

/** The field as an answer left it, to tell whether Enter has anything left to do. */
interface FieldAt {
  chips: SearchChip[];
  text: string;
}

/** What the "more" line has loaded, for the search it belongs to. */
interface LeftRows extends LeftOut<SearchResultOut> {
  answering: string;
  rows: SearchResultOut[];
  next: number | null;
}

const atField = (at: FieldAt | null, chips: SearchChip[], text: string) => at !== null && at.chips === chips && at.text.trim() === text.trim();

/** Mail's search under the header. A `plain` one (the phone's) leaves the words as typed, never chips. */
export function useSearch(account: number | null, plain = false): Search {
  const [chips, setChips] = useState<SearchChip[]>([]);
  const [text, setTextState] = useState('');
  const [out, setOut] = useState<SearchOut | null>(null);
  const [results, setResults] = useState<SearchResultOut[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  // The latest request, so an older answer never replaces a newer one.
  const latest = useRef(0);
  // The latest request asked, and the latest answered (or refused): a search is pending between them.
  const [asked, setAsked] = useState(0);
  const [answered, setAnswered] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  // The offset of the page on its way, so nearing the end twice asks for it once.
  const paging = useRef<number | null>(null);
  // The list's rows as of the last answer, for an Enter that hands the keys over without asking.
  const shown = useRef<SearchResultOut[]>([]);
  // The field the list answers.
  const landed = useRef<FieldAt | null>(null);
  // The field as Enter or a × left it, and the fallback of a reading that didn't come. Typing away
  // and back is still that field, so a chip taken off doesn't return on an Enter there.
  const settled = useRef<FieldAt & {fallback: SearchReadingFallback | null} | null>(null);
  // The Enter on its way, which a second one joins.
  const asking = useRef<Promise<Settled<SearchResultOut>> | null>(null);
  // The whole search in the order typed, for Alfred and a new reading; null once an edit lost it.
  const typed = useRef<string | null>('');
  // The words the chips' "more" number counts from: `reading.typed`, and what's typed after it.
  const keptTyped = useRef('');

  function answer(id: number, query: SearchQuery, at: FieldAt): Promise<SearchOut | null> {
    return searchMail(query).then(found => {
      if (id !== latest.current) return null;
      paging.current = null;
      shown.current = found.results;
      landed.current = at;
      setOut(found);
      setResults(found.results);
      setError(null);
      setAnswered(id);
      return found;
    }, (failure: Error) => {
      if (id === latest.current) {
        setError(failure.message);
        setAnswered(id);
      }
      return null;
    });
  }

  const wordsOf = (nextChips: SearchChip[], nextText: string, kept: boolean): SearchQuery =>
    (kept ? {text: nextText, chips: nextChips, account, read: 'kept', typed: keptTyped.current} : {text: nextText, chips: [], account});

  function run(nextChips: SearchChip[], nextText: string, kept = nextChips.length > 0) {
    window.clearTimeout(timer.current);
    const id = ++latest.current;
    setAsked(id);
    if (!isSearching(nextChips, nextText)) {
      shown.current = [];
      landed.current = null;
      settled.current = null;
      setOut(null);
      setResults([]);
      setError(null);
      setAnswered(id);
      return;
    }
    void answer(id, wordsOf(nextChips, nextText, kept), {chips: nextChips, text: nextText});
  }

  /** The field moved on, so Enter's answer, if one is coming, is no longer wanted. */
  function dropReading() {
    latest.current += 1;
    asking.current = null;
    setReading(false);
  }

  function read(id: number): Promise<Settled<SearchResultOut>> {
    // The words as typed read whole, chips and all, unless an edit lost their order.
    const question = typed.current?.trim() ? {text: typed.current, chips: []} : {text, chips};
    const stayed = (fallback: SearchReadingFallback | null): Settled<SearchResultOut> => {
      asking.current = null;
      setReading(false);
      setAnswered(id);
      settled.current = {chips, text, fallback};
      return {first: shown.current[0] ?? null};
    };
    return searchMail({...question, account, read: 'ask'}).then(found => {
      if (id !== latest.current) return null;
      const fallback = found.reading?.fallback ?? null;
      // Only what needed no model takes effect without one: a date alone, or a "!word".
      if (fallback && fallback !== 'nothing_to_read' && landed.current) {
        setOut(now => now && {...now, search_id: found.search_id});
        return stayed(fallback);
      }
      const at = {chips: found.chips, text: found.text};
      keptTyped.current = found.reading?.typed ?? found.text;
      paging.current = null;
      shown.current = found.results;
      landed.current = at;
      settled.current = {...at, fallback};
      asking.current = null;
      setChips(found.chips);
      setTextState(found.text);
      setOut(found);
      setResults(found.results);
      setError(null);
      setAnswered(id);
      setReading(false);
      return {first: found.results[0] ?? null};
    }, () => (id === latest.current ? stayed('failed') : null));
  }

  function settle(): Promise<Settled<SearchResultOut>> {
    if (!isSearching(chips, text)) return Promise.resolve({first: null});
    if (asking.current) return asking.current;
    const nothingToRead = plain || (settled.current !== null && atField(settled.current, chips, text) && !worthAskingAgain(settled.current.fallback));
    const inPlace = atField(landed.current, chips, text);
    if (nothingToRead && inPlace) return Promise.resolve({first: shown.current[0] ?? null});
    window.clearTimeout(timer.current);
    const id = ++latest.current;
    setAsked(id);
    // The words' own answer first, if the pause hadn't run out: those show as soon as they would have.
    const words = inPlace ? Promise.resolve() : answer(id, wordsOf(chips, text, chips.length > 0), {chips, text});
    if (nothingToRead) return words.then(() => (id === latest.current ? {first: shown.current[0] ?? null} : null));
    setReading(true);
    asking.current = words.then(() => (id === latest.current ? read(id) : null));
    return asking.current;
  }

  const [fold, setFold] = useState<MentionsFold | null>(null);
  const current = foldFor(fold, out);
  if (current !== fold) setFold(current);
  const answering = JSON.stringify([out?.chips, out?.text]);

  const [left, setLeft] = useState<LeftRows | null>(null);
  if (left && left.answering !== answering) setLeft(null);
  const shownLeft = left?.answering === answering ? left : null;
  const leftPaging = useRef<number | null>(null);

  function leftPage(offset: number) {
    if (!out?.reading || leftPaging.current === offset) return;
    leftPaging.current = offset;
    const merge = (change: (now: LeftRows) => LeftRows) => setLeft(now => (now?.answering === answering ? change(now) : now));
    searchMail({text: out.text, chips: out.chips, account, read: 'left_out', typed: out.reading.typed, page: {search_id: out.search_id, offset}}).then(page => {
      leftPaging.current = null;
      merge(now => ({...now, rows: [...now.rows, ...page.results], next: page.next_offset}));
    }, () => {
      // Its line stays, and a click asks again.
      leftPaging.current = null;
      merge(now => ({...now, open: false}));
    });
  }

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const update = (change: (rows: SearchResultOut[]) => SearchResultOut[]) => setResults(change);
  return {
    chips, text, out, results, error, reading, answering,
    active: isSearching(chips, text),
    pending: isSearching(chips, text) && asked !== answered,
    setText(next) {
      typed.current = chips.length === 0 ? next : typedAfter(typed.current, text, next);
      keptTyped.current = typedAfter(keptTyped.current, text, next) ?? next;
      dropReading();
      setTextState(next);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => run(chips, next), TYPING_MS);
    },
    settle,
    removeChip(index) {
      const chip = chips[index]!;
      const next = chips.filter((_, at) => at !== index);
      const back = standsForWords(chip) ? wordsBack(keptTyped.current, text, next) : text;
      // The search log, best effort: the chip comes off either way.
      if (out) void searchChipRemoved(out.search_id, chip).catch(() => {});
      if (!standsForWords(chip)) typed.current = next.length === 0 ? back : null;
      settled.current = {chips: next, text: back, fallback: null};
      dropReading();
      setChips(next);
      setTextState(back);
      run(next, back, true);
    },
    clearText() {
      typed.current = chips.length === 0 ? '' : null;
      keptTyped.current = '';
      dropReading();
      setTextState('');
      run(chips, '');
    },
    clear() {
      typed.current = '';
      keptTyped.current = '';
      dropReading();
      setChips([]);
      setTextState('');
      run([], '');
    },
    update,
    loadMore() {
      if (!out || out.next_offset === null || paging.current === out.next_offset) return;
      paging.current = out.next_offset;
      const id = latest.current;
      const kept = out.reading ? {read: 'kept' as const, typed: out.reading.typed} : {};
      searchMail({text: out.text, chips: out.chips, account, ...kept, page: {search_id: out.search_id, offset: out.next_offset}}).then(page => {
        if (id !== latest.current) return;
        setOut(page);
        setResults(now => [...now, ...page.results]);
      }, () => {});
    },
    mentions: current?.open ?? false,
    toggleMentions: () => setFold(last => last && toggledFold(last)),
    leftOut: shownLeft,
    toggleLeftOut() {
      if (shownLeft?.rows.length) return setLeft({...shownLeft, open: !shownLeft.open});
      setLeft({answering, open: true, rows: [], next: null});
      leftPaging.current = null;
      leftPage(0);
    },
    moreLeftOut: shownLeft?.open === true && shownLeft.next !== null,
    loadLeftOut() {
      if (shownLeft?.next != null) leftPage(shownLeft.next);
    },
    listed: [...results, ...(shownLeft?.rows ?? [])],
    opened(id) {
      // `results` are in the server's order, the fold's rows after what's above it, loaded or shown
      // or not, so this is the place the list shows it at. What the chips left out comes after all
      // of those: a place past `total`, so the log tells an open that the reading had hidden.
      const position = results.findIndex(result => result.id === id);
      const beyond = shownLeft?.rows.findIndex(result => result.id === id) ?? -1;
      // Best effort: the open is only logged for search's ranking, and the email opens either way.
      if (out && position >= 0) void searchOpened(out.search_id, id, position).catch(() => {});
      else if (out && beyond >= 0) void searchOpened(out.search_id, id, out.total + beyond).catch(() => {});
    },
    mark(id, change) {
      const marked = (rows: SearchResultOut[]) => rows.map(result => (result.id === id ? {...result, ...change} : result));
      update(marked);
      setLeft(now => now && {...now, rows: marked(now.rows)});
    },
    question: () => alfredQuestion(chips, text, typed.current),
  };
}
