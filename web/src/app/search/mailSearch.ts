// Mail's search field (DESIGN.md › Search; D392). Typing runs a keyword search after a short pause,
// and its words stay words: the results are the words' results, the same with or without Enter, which
// only moves the keyboard into them.
//
// A longer pause asks for a suggestion for the field's exact text: the grammar's date at once, then a
// reading from the model. Results don't wait for it and it never changes them. The first change to
// the field takes it away and drops whatever was on its way. It says everything accepting needs, so
// that asks no model and can't rest on a partial search: a click or Tab makes its chips the field's
// (`read: 'kept'`), and those filter until they're taken off. A chip's × puts its word back, and a
// suggestion the user turned down doesn't return for those words.
//
// The phone's field is `plain` (SI-64 comes later): its words stay words and no suggestion is asked.
import type {SearchChip, SearchOut, SearchResultOut, SearchSuggestionOut} from '@setpoint/shared';
import {useEffect, useRef, useState} from 'react';
import {searchChipRemoved, searchMail, searchOpened, searchSuggestion, searchSuggestionLog} from '../../api/search.ts';
import type {SearchQuery} from '../../api/search.ts';
import {alfredQuestion, asksForSuggestion, foldFor, isSearching, sameSuggestion, standsForWords, suggestionKey, toggledFold, typedAfter, wordsBack} from '../../logic/search.ts';
import type {LeftOut, MentionsFold} from '../../logic/search.ts';
import {TYPING_MS} from './state.ts';
import type {SearchFieldState, Settled} from './state.ts';

// How long typing must stop before a suggestion is asked for: long enough that it never reaches for a
// word still being typed, short enough to be there by the time the results have been looked at.
export const SUGGESTION_PAUSE_MS = 700;

export interface Search extends SearchFieldState<SearchChip, SearchOut, SearchResultOut> {
  // A narrowing to offer, for the field exactly as it is.
  suggestion: SearchSuggestionOut | null;
  acceptSuggestion: () => void;
  // What the answers are for: another search's fold is drawn afresh, without motion.
  answering: string;
  // Whether the results that only mention the search show (logic/search.ts › foldFor).
  mentions: boolean;
  toggleMentions: () => void;
  // What a suggestion's chips left out, once the user has opened its line: `read: 'left_out'`.
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

/** The field as an answer left it, to tell whether the list answers what's in it. */
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
  const [suggestion, setSuggestion] = useState<SearchSuggestionOut | null>(null);
  // The latest request, so an older answer never replaces a newer one.
  const latest = useRef(0);
  // The latest request asked, and the latest answered (or refused): a search is pending between them.
  const [asked, setAsked] = useState(0);
  const [answered, setAnswered] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  // The offset of the page on its way, so nearing the end twice asks for it once.
  const paging = useRef<number | null>(null);
  // The list's answer as it last came, and the field it answers.
  const shown = useRef<SearchOut | null>(null);
  const landed = useRef<FieldAt | null>(null);
  // The words' answer on its way, which a suggestion waits for: it speaks of the list on screen.
  const wordsIn = useRef<Promise<unknown>>(Promise.resolve());
  // The pause before a suggestion, the suggestion on its way, and the one showing.
  const pause = useRef<number | undefined>(undefined);
  const suggesting = useRef<AbortController | null>(null);
  const offered = useRef<SearchSuggestionOut | null>(null);
  // The text a suggestion was turned down for, by taking its chip off, for as long as the page stays.
  const declined = useRef(new Set<string>());
  // The whole search in the order typed, for Alfred; null once an edit lost it.
  const typed = useRef<string | null>('');
  // The words the chips' "more" number counts from: a suggestion's `typed`, and what's typed after it.
  // And the same less the words a date chip stands for, which × gives back only with the date.
  const keptTyped = useRef('');
  const keptUndated = useRef('');

  function answer(id: number, query: SearchQuery, at: FieldAt): Promise<SearchOut | null> {
    return searchMail(query).then(found => {
      if (id !== latest.current) return null;
      paging.current = null;
      shown.current = found;
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

  function run(nextChips: SearchChip[], nextText: string, kept = nextChips.length > 0): Promise<SearchOut | null> {
    window.clearTimeout(timer.current);
    const id = ++latest.current;
    setAsked(id);
    if (!isSearching(nextChips, nextText)) {
      shown.current = null;
      landed.current = null;
      setOut(null);
      setResults([]);
      setError(null);
      setAnswered(id);
      return Promise.resolve(null);
    }
    const found = answer(id, wordsOf(nextChips, nextText, kept), {chips: nextChips, text: nextText});
    wordsIn.current = found;
    return found;
  }

  /** What's asked or shown for the field as it was is gone: it speaks only of that text. */
  function dropSuggestion() {
    window.clearTimeout(pause.current);
    suggesting.current?.abort();
    suggesting.current = null;
    offered.current = null;
    setSuggestion(null);
  }

  /** Shows what came, once the list it speaks of is on screen. A later answer replaces it, unless it says the same. */
  function offer(found: SearchSuggestionOut | null, at: FieldAt, asking: AbortController) {
    return wordsIn.current.then(() => {
      if (asking.signal.aborted || !atField(landed.current, at.chips, at.text) || sameSuggestion(found, offered.current)) return;
      offered.current = found;
      setSuggestion(found);
      // The search log, best effort.
      if (found) void searchSuggestionLog(found.id, 'shown').catch(() => {});
    });
  }

  function suggest(at: FieldAt) {
    const asking = new AbortController();
    suggesting.current = asking;
    const query = {...at, account};
    // A slow or failed one, or no key, is no suggestion and says nothing.
    searchSuggestion(query, false, asking.signal).then(async first => {
      await offer(first.suggestion, at, asking);
      if (!first.reads || asking.signal.aborted) return;
      await offer((await searchSuggestion(query, true, asking.signal)).suggestion, at, asking);
    }).catch(() => {});
  }

  function suggestAfterPause(nextChips: SearchChip[], nextText: string) {
    window.clearTimeout(pause.current);
    suggesting.current?.abort();
    if (plain || !asksForSuggestion(nextChips, nextText, declined.current)) return;
    pause.current = window.setTimeout(() => suggest({chips: nextChips, text: nextText}), SUGGESTION_PAUSE_MS);
  }

  /** A "!word" that formed a Not chip moves into the field as one, as the list already has it. */
  function takeNotChips(found: SearchOut) {
    if (found.chips.length === chips.length) return;
    landed.current = {chips: found.chips, text: found.text};
    keptTyped.current = found.text;
    keptUndated.current = found.text;
    setChips(found.chips);
    setTextState(found.text);
    if (!offered.current) suggestAfterPause(found.chips, found.text);
  }

  /** Enter: the words' answer, if the pause hadn't run out, and then it's the keys' turn. It asks no model. */
  function settle(): Promise<Settled<SearchResultOut>> {
    if (!isSearching(chips, text)) return Promise.resolve({first: null});
    if (atField(landed.current, chips, text)) {
      if (shown.current) takeNotChips(shown.current);
      return Promise.resolve({first: shown.current?.results[0] ?? null});
    }
    const id = latest.current + 1;
    return run(chips, text).then(found => {
      if (id !== latest.current) return null;
      if (found) takeNotChips(found);
      return {first: shown.current?.results[0] ?? null};
    });
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

  useEffect(() => () => {
    window.clearTimeout(timer.current);
    window.clearTimeout(pause.current);
    suggesting.current?.abort();
  }, []);

  const update = (change: (rows: SearchResultOut[]) => SearchResultOut[]) => setResults(change);
  return {
    chips, text, out, results, error, suggestion, answering,
    active: isSearching(chips, text),
    pending: isSearching(chips, text) && asked !== answered,
    setText(next) {
      typed.current = chips.length === 0 ? next : typedAfter(typed.current, text, next);
      keptTyped.current = typedAfter(keptTyped.current, text, next) ?? next;
      keptUndated.current = typedAfter(keptUndated.current, text, next) ?? next;
      dropSuggestion();
      setTextState(next);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void run(chips, next), TYPING_MS);
      suggestAfterPause(chips, next);
    },
    settle,
    acceptSuggestion() {
      if (!suggestion) return;
      const {id, chips: accepted, text: left, typed: words, undated} = suggestion;
      keptTyped.current = words;
      keptUndated.current = undated;
      dropSuggestion();
      setChips(accepted);
      setTextState(left);
      // The search log, best effort: the chips are in the field either way.
      void run(accepted, left, true).then(found => (found ? searchSuggestionLog(id, 'accepted', found.search_id) : undefined)).catch(() => {});
    },
    removeChip(index) {
      const chip = chips[index]!;
      const next = chips.filter((_, at) => at !== index);
      const stands = standsForWords(chip);
      const back = stands ? wordsBack(next.some(rest => rest.kind === 'date' && !rest.not) ? keptUndated.current : keptTyped.current, text, next) : text;
      // The search log, best effort: the chip comes off either way.
      if (out) void searchChipRemoved(out.search_id, chip).catch(() => {});
      if (!stands) typed.current = next.length === 0 ? back : null;
      else for (const words of [back, keptTyped.current]) declined.current.add(suggestionKey(words));
      dropSuggestion();
      setChips(next);
      setTextState(back);
      void run(next, back, true);
      suggestAfterPause(next, back);
    },
    clearText() {
      typed.current = chips.length === 0 ? '' : null;
      keptTyped.current = '';
      keptUndated.current = '';
      dropSuggestion();
      setTextState('');
      void run(chips, '');
    },
    clear() {
      typed.current = '';
      keptTyped.current = '';
      keptUndated.current = '';
      dropSuggestion();
      setChips([]);
      setTextState('');
      void run([], '');
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
      // of those: a place past `total`, so the log tells an open that a chip had hidden.
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
