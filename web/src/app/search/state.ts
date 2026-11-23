// The calendar's and News's search fields, and the Answer card's view of Alfred's thread (alfred.ts
// keeps the thread); mail's field is mailSearch.ts, whose chips come from Enter.
//
// The calendar's search runs as the user types (a short pause), with the chips already in the field
// and the words after them. The server answers with every chip in force; the field takes them once a
// word is finished (a space, Enter) so a word isn't chipped while it's still being typed ("mar" →
// "march"). A pause chips the finished words before the last one too, though no pause came after
// their spaces. Results show at once either way.
import type {AnswerOut, AskStep, CalendarSearchChip, CalendarSearchOut, CalendarSearchResultOut, StoryRowOut} from '@setpoint/shared';
import {useEffect, useRef, useState} from 'react';
import {searchNews} from '../../api/news.ts';
import {searchCalendar} from '../../api/search.ts';
import {finishedWords, isSearching} from '../../logic/search.ts';

export const TYPING_MS = 120;

/** A page of answers: the chips in force, the words left, this page's results and the next page's offset. */
interface Page<C, R> {
  chips: C[];
  text: string;
  results: R[];
  next_offset: number | null;
}

/** What Enter came to: the first result, if any. Null when it was dropped, the field having moved on. */
export type Settled<R> = {first: R | null} | null;

/** The field and its results, as mail's and the calendar's searches share them. */
export interface SearchFieldState<C, O, R> {
  chips: C[];
  text: string;
  active: boolean;
  out: O | null;
  results: R[];
  error: string | null;
  // A search is on its way: the field's glyph turns once it has taken a moment.
  pending: boolean;
  setText: (text: string) => void;
  /** Enter: takes the chips the server found, and resolves once that's done, ready for the keys to leave the field. */
  settle: () => Promise<Settled<R>>;
  removeChip: (index: number) => void;
  clearText: () => void;
  clear: () => void;
  loadMore: () => void;
  /** Changes the results shown, as the user acts on them. */
  update: (change: (results: R[]) => R[]) => void;
}

/**
 * The field's state: `fetch` answers the field's chips and words, or the page after `after`. A
 * `plain` field (the phone's) leaves the words as typed, never chips.
 */
function useSearchField<C, R, O extends Page<C, R>>(fetch: (text: string, chips: C[], after: O | null) => Promise<O>, plain: boolean): SearchFieldState<C, O, R> {
  const [chips, setChips] = useState<C[]>([]);
  const [text, setTextState] = useState('');
  const [out, setOut] = useState<O | null>(null);
  const [results, setResults] = useState<R[]>([]);
  const [error, setError] = useState<string | null>(null);
  // The latest request, so an older answer never replaces a newer one, and the field as it is now.
  const latest = useRef(0);
  // The latest request asked, and the latest answered (or refused): a search is pending between them.
  const [asked, setAsked] = useState(0);
  const [answered, setAnswered] = useState(0);
  const field = useRef({chips, text});
  useEffect(() => {
    field.current = {chips, text};
  });
  const timer = useRef<number | undefined>(undefined);
  // The offset of the page on its way, so nearing the end twice asks for it once.
  const paging = useRef<number | null>(null);
  const active = isSearching(chips, text);

  function run(nextChips: C[], nextText: string, settle: boolean): Promise<Settled<R>> {
    window.clearTimeout(timer.current);
    const id = ++latest.current;
    setAsked(id);
    if (!isSearching(nextChips, nextText)) {
      setOut(null);
      setResults([]);
      setError(null);
      setAnswered(id);
      return Promise.resolve({first: null});
    }
    // Words finished before the one still being typed: their chips first, then the whole search
    // with them, so the search log's last row is the whole search.
    const finished = !plain && !settle ? finishedWords(nextText) : null;
    if (finished) {
      return fetch(finished.words, nextChips, null).then(answer => {
        if (id !== latest.current) return null;
        const now = field.current;
        if (now.text !== nextText || now.chips !== nextChips || answer.chips.length === nextChips.length) return search(id, nextChips, nextText, false);
        const text = `${answer.text ? `${answer.text} ` : ''}${finished.last}`;
        setChips(answer.chips);
        setTextState(text);
        field.current = {chips: answer.chips, text};
        return search(id, answer.chips, text, false);
      }, () => search(id, nextChips, nextText, false));
    }
    return search(id, nextChips, nextText, settle);
  }

  function search(id: number, nextChips: C[], nextText: string, settle: boolean): Promise<Settled<R>> {
    return fetch(nextText, nextChips, null).then(answer => {
      if (id !== latest.current) return null;
      setOut(answer);
      setResults(answer.results);
      setError(null);
      setAnswered(id);
      // The field takes the server's chips only if it still holds what was sent.
      const now = field.current;
      if (!plain && (settle || /\s$/.test(nextText)) && now.text === nextText && now.chips === nextChips) {
        setChips(answer.chips);
        setTextState(answer.text ? `${answer.text}${settle ? '' : ' '}` : '');
      }
      return {first: answer.results[0] ?? null};
    }, (failure: Error) => {
      if (id !== latest.current) return null;
      setError(failure.message);
      setAnswered(id);
      return {first: null};
    });
  }

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return {
    chips, text, active, out, results, error, pending: active && asked !== answered,
    setText(next) {
      setTextState(next);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void run(chips, next, false), TYPING_MS);
    },
    settle: () => run(chips, text, true),
    removeChip(index) {
      const next = chips.filter((_, at) => at !== index);
      setChips(next);
      void run(next, text, false);
    },
    clearText() {
      setTextState('');
      void run(chips, '', false);
    },
    clear() {
      setChips([]);
      setTextState('');
      void run([], '', false);
    },
    update: change => setResults(change),
    loadMore() {
      if (!out || out.next_offset === null || paging.current === out.next_offset) return;
      paging.current = out.next_offset;
      const id = latest.current;
      fetch(out.text, out.chips, out).then(answer => {
        if (id !== latest.current) return;
        setOut(answer);
        setResults(current => [...current, ...answer.results]);
      }, () => {});
    },
  };
}

export type CalendarSearch = SearchFieldState<CalendarSearchChip, CalendarSearchOut, CalendarSearchResultOut>;

/** The calendar's search, its results in the right pane. The phone's Agenda's is `plain`: its words as typed, never chips. */
export const useCalendarSearch = (plain = false): CalendarSearch =>
  useSearchField<CalendarSearchChip, CalendarSearchResultOut, CalendarSearchOut>((text, chips, after) => searchCalendar({text, chips, offset: after?.next_offset ?? 0}), plain);

/** News's search: words only, no chips, over the 90-day archive. One page of stories, newest first. */
export interface NewsSearchPage {
  chips: never[];
  text: string;
  results: StoryRowOut[];
  next_offset: null;
  total: number;
}
export type NewsSearch = SearchFieldState<never, NewsSearchPage, StoryRowOut>;

export const useNewsSearch = (): NewsSearch => useSearchField<never, StoryRowOut, NewsSearchPage>(
  text => searchNews(text).then(out => ({chips: [], text, results: out.stories, next_offset: null, total: out.total})), true);

export interface Alfred {
  // Whether the card shows.
  open: boolean;
  // The thread is being read back after a reload: the card holds its place with a skeleton.
  loading?: boolean;
  turns: AnswerOut[];
  // The question on its way (answers aren't streamed), and what Alfred is doing for it.
  waiting: string | null;
  step: AskStep | null;
  // Every step Alfred has taken for the last question, in turn, the last its current one.
  trail: AskStep[];
  // The server's words for the last question that failed, and that question, for the field again.
  error: string | null;
  failed: string | null;
  /** Opens the card, empty (Ask about this email) or with a first question. */
  start: (question?: string) => void;
  ask: (question: string) => void;
  close: () => void;
}
