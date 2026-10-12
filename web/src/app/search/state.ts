// The search field's state and Alfred's thread, for the Inbox page and the reader; SV-23 runs the
// calendar's search on the same field, and N5 News's.
//
// Search runs as the user types (a short pause), with the chips already in the field and the words
// after them. The server answers with every chip in force; the field takes them once a word is
// finished (a space, Enter) so a word isn't chipped while it's still being typed ("mar" → "march").
// A pause chips the finished words before the last one too, though no pause came after their
// spaces. Results show at once either way.
import type {AnswerOut, AskStep, CalendarSearchChip, CalendarSearchOut, CalendarSearchResultOut, SearchChip, SearchOut, SearchResultOut, StoryRowOut} from '@setpoint/shared';
import {useEffect, useRef, useState} from 'react';
import {ApiFailure} from '../../api/client.ts';
import {searchNews} from '../../api/news.ts';
import {alfredStep, askAlfred, searchCalendar, searchMail, searchOpened} from '../../api/search.ts';
import {alfredQuestion, finishedWords, isSearching, withStep} from '../../logic/search.ts';

const TYPING_MS = 120;
const STEP_POLL_MS = 400;

/** A page of answers: the chips in force, the words left, this page's results and the next page's offset. */
interface Page<C, R> {
  chips: C[];
  text: string;
  results: R[];
  next_offset: number | null;
}

/** The field and its results, as mail's and the calendar's searches share them. */
export interface SearchFieldState<C, O, R> {
  chips: C[];
  text: string;
  active: boolean;
  out: O | null;
  results: R[];
  error: string | null;
  // A search is on its way (search-03): the field's glyph turns once it has taken a moment.
  pending: boolean;
  setText: (text: string) => void;
  /** Takes the chips the server found now (Enter); resolves with the first result, if any. */
  settle: () => Promise<R | null>;
  removeChip: (index: number) => void;
  clearText: () => void;
  clear: () => void;
  loadMore: () => void;
  /** Changes the results shown, as the user acts on them. */
  update: (change: (results: R[]) => R[]) => void;
}

export interface Search extends SearchFieldState<SearchChip, SearchOut, SearchResultOut> {
  /** The search log: the user opened this result. */
  opened: (id: number) => void;
  /** A result as an action left it: read once opened, Done (UX #9). */
  mark: (id: number, change: Partial<SearchResultOut>) => void;
  question: () => string;
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

  function run(nextChips: C[], nextText: string, settle: boolean): Promise<R | null> {
    window.clearTimeout(timer.current);
    const id = ++latest.current;
    setAsked(id);
    if (!isSearching(nextChips, nextText)) {
      setOut(null);
      setResults([]);
      setError(null);
      setAnswered(id);
      return Promise.resolve(null);
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

  function search(id: number, nextChips: C[], nextText: string, settle: boolean): Promise<R | null> {
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
      return answer.results[0] ?? null;
    }, (failure: Error) => {
      if (id === latest.current) {
        setError(failure.message);
        setAnswered(id);
      }
      return null;
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

/** Mail's search under the header; a `plain` one (the phone's) leaves the words as typed, never chips. */
export function useSearch(account: number | null, plain = false): Search {
  const search = useSearchField<SearchChip, SearchResultOut, SearchOut>((text, chips, after) => searchMail({
    text, chips, account, ...(after ? {page: {search_id: after.search_id, offset: after.next_offset!}} : {}),
  }), plain);
  return {
    ...search,
    opened(id) {
      const position = search.results.findIndex(result => result.id === id);
      // Best effort: the open is only logged for search's ranking, and the email opens either way.
      if (search.out && position >= 0) void searchOpened(search.out.search_id, id, position).catch(() => {});
    },
    mark: (id, change) => search.update(results => results.map(result => (result.id === id ? {...result, ...change} : result))),
    question: () => alfredQuestion(search.chips, search.text),
  };
}

export type CalendarSearch = SearchFieldState<CalendarSearchChip, CalendarSearchOut, CalendarSearchResultOut>;

/** SV-23: the calendar's search, its results in the right pane. */
export const useCalendarSearch = (): CalendarSearch =>
  useSearchField<CalendarSearchChip, CalendarSearchResultOut, CalendarSearchOut>((text, chips, after) => searchCalendar({text, chips, offset: after?.next_offset ?? 0}), false);

/** News's search (N5): words only, no chips, over the 90-day archive; one page of stories, newest first. */
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
  turns: AnswerOut[];
  // The question on its way (answers aren't streamed), and what Alfred is doing for it.
  waiting: string | null;
  step: AskStep | null;
  // Every step Alfred has taken for the last question, in turn, the last its current one (search-04).
  trail: AskStep[];
  // The server's words for the last question that failed, and that question, for the field again.
  error: string | null;
  failed: string | null;
  /** Opens the card, empty (Ask about this email) or with a first question. */
  start: (question?: string) => void;
  ask: (question: string) => void;
  close: () => void;
}

/** Alfred's short thread: a question, then follow-ups in the same conversation. `scope` is the email it's about. */
export function useAlfred(scope: number | null = null): Alfred {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<AnswerOut[]>([]);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [stepOf, setStepOf] = useState<{ask: string; step: AskStep | null} | null>(null);
  const step = asking && stepOf?.ask === asking ? stepOf.step : null;
  // The last question's steps, kept after its answer so the card can fold them away.
  const [trailOf, setTrailOf] = useState<{ask: string; steps: AskStep[]}>({ask: '', steps: []});
  const conversation = useRef<number | null>(null);
  // Bumped when the card closes or starts over, so an answer to an earlier thread is dropped.
  const thread = useRef(0);

  // While a question is on its way, what Alfred is doing for it, asked again every STEP_POLL_MS.
  useEffect(() => {
    if (!asking) return;
    let live = true;
    const timer = window.setInterval(() => {
      alfredStep(asking).then(out => {
        if (!live) return;
        setStepOf({ask: asking, step: out.step});
        setTrailOf(current => ({ask: asking, steps: withStep(current.ask === asking ? current.steps : [], out.step)}));
      }, () => {});
    }, STEP_POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [asking]);

  function ask(question: string, fresh = false) {
    const asked = question.trim();
    if (!asked || (waiting !== null && !fresh)) return;
    const id = fresh ? ++thread.current : thread.current;
    const askId = `ask-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    setWaiting(asked);
    setAsking(askId);
    setError(null);
    setFailed(null);
    askAlfred(asked, {conversation: fresh ? null : conversation.current, message: scope, ask: askId}).then(answer => {
      if (id !== thread.current) return;
      conversation.current = answer.conversation_id;
      setTurns(current => [...current, answer]);
      setWaiting(null);
      setAsking(null);
    }, (failure: Error) => {
      if (id !== thread.current) return;
      // After four idle hours the thread has ended: the next question starts a new one.
      if (failure instanceof ApiFailure && failure.code === 'conversation_ended') conversation.current = null;
      setError(failure.message);
      setFailed(asked);
      setWaiting(null);
      setAsking(null);
    });
  }

  return {
    open, turns, waiting, step, error, failed, trail: !asking || trailOf.ask === asking ? trailOf.steps : [],
    start(question) {
      thread.current += 1;
      conversation.current = null;
      setOpen(true);
      setTurns([]);
      setError(null);
      setFailed(null);
      setWaiting(null);
      setAsking(null);
      if (question) ask(question, true);
    },
    ask: question => ask(question),
    close() {
      thread.current += 1;
      conversation.current = null;
      setOpen(false);
      setTurns([]);
      setWaiting(null);
      setAsking(null);
      setError(null);
      setFailed(null);
    },
  };
}
