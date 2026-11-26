// Search (board 06): the header's field with its chips, and the results that
// replace the list: Alfred's Answer card above them, the results line, each result with why it
// matched and its matches highlighted, the fold over those that only mention the search, the line of
// what a suggestion's chips left out, the suggestion itself in the results line, and the no-results
// line with each chip removable. Kept thin: the rules are logic/search.ts's, and the state is
// mailSearch.ts's and state.ts's.
import type {AccountOut, CalendarSearchChip, Recipient, SearchChip, SearchResultOut} from '@setpoint/shared';
import {Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {CSSProperties, KeyboardEvent, MouseEvent, ReactNode, RefObject} from 'react';
import {age, fullTimestamp} from '../../logic/format.ts';
import type {Entry, Fold, FoldRules} from '../../logic/fold.ts';
import {LEFT_OUT_KEY, MENTIONS_KEY} from '../../logic/inbox.ts';
import {suggestPeople} from '../../api/drafts.ts';
import {fieldSegments, firstSection, indexingLine, nextAsk, leftOutLine, mentionsLine, operatorAt, operatorMarks, operatorValues, queryParts, reasonParts, resultSender, resultsLine, shownReasons, suggestionLine, withOperatorPick} from '../../logic/search.ts';
import type {Run, Segment} from '../../logic/search.ts';
import {motion} from '../../tokens.ts';
import {Icon} from '../../ui/Icon.tsx';
import {keepTextUnselected} from '../../ui/keys.ts';
import {PlaceList} from '../../ui/PlaceList.tsx';
import {useMirror} from '../../ui/useMirror.ts';
import {dotStyle} from '../accounts.ts';
import {ConversationFrom, RepliedMark, SnoozedMark} from '../AllList.tsx';
import {FOLD_HOLD_MS, foldDelays, foldRef, leaveCopy, useFold} from '../fold.ts';
import {usePhone} from '../Phone.tsx';
import type {Search} from './mailSearch.ts';
import type {SearchFieldState} from './state.ts';
import {SentFrom} from '../SentFrom.tsx';
import './search.css';
import {ScrollThumb} from '../ScrollThumb.tsx';

const CHIP_KEYS: Record<SearchChip['kind'] | CalendarSearchChip['kind'], string> = {organisation: 'Org', type: 'Type', date: 'Date', account: 'Account', kind: 'Kind', calendar: 'Calendar'};
// A mail chip typed after "!" or "-" leaves its matches out: "Not Type Confirmation".
const negated = (chip: SearchChip | CalendarSearchChip) => 'not' in chip && chip.not === true;
const chipKey = (chip: SearchChip | CalendarSearchChip) => `${negated(chip) ? 'not:' : ''}${chip.kind}:${chip.label}`;

/** Text with its highlighted runs (`sun` at 26%). */
export function Marked({parts}: {parts: Segment[]}) {
  return <>{parts.map((part, index) => (part.mark ? <mark className="hl" key={index}>{part.text}</mark> : <Fragment key={index}>{part.text}</Fragment>))}</>;
}

export function Account({account}: {account: AccountOut | undefined}) {
  return <><span className="dot sm" style={dotStyle(account?.colour)} /><span className="label">{account?.label}</span></>;
}

type FieldSearch<R> = Pick<SearchFieldState<SearchChip | CalendarSearchChip, unknown, R>, 'chips' | 'text' | 'active' | 'setText' | 'settle' | 'removeChip' | 'clear'> & {pending?: boolean; suggestion?: unknown; acceptSuggestion?: () => void};

interface SearchFieldProps<R> {
  search: FieldSearch<R>;
  // Mail's ⌘Enter, Ask Alfred.
  onAsk?: () => void;
  onEnter: (first: R) => void;
  // The calendar's field ("Search calendar"), where ↓ goes to the first result as Enter does,
  // and Esc closes what's on top (the floating detail, then the search).
  label?: string;
  arrowDown?: boolean;
  onEscape?: () => void;
  autoFocus?: boolean;
  // Mail's Inbox and Sent: Gmail-style operators are marked as the search reads them, and from:,
  // to:, has: and is: offer what they take.
  operators?: boolean;
}

/** What the list under an operator offers: a person (their address goes in) or a value. */
interface Offer {
  name: string;
  address: string | null;
  value: string;
}

/** The field's text cut at its operators' marks, for the mirror under its input. */
function OperatorMarks({text, marks}: {text: string; marks: Run[]}) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const mark of marks) {
    parts.push(text.slice(at, mark.start), <span key={mark.start} className="tok-q">{text.slice(mark.start, mark.end)}</span>);
    at = mark.end;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

/**
 * The list under the operator at the caret: people after from: (everyone who wrote) and to: (everyone
 * written to), fetched after a 120 ms pause, and has:'s and is:'s values. Only people found for what's
 * typed now are offered, so Enter never picks an answer to older letters. Esc closes it until the
 * caret leaves that operator. `cur` is the row Enter or Tab picks.
 */
function useOperatorList(on: boolean, text: string, caret: number | null) {
  const at = on && caret !== null ? operatorAt(text, caret) : null;
  const person = at && (at.name === 'from' || at.name === 'to') ? at.name : null;
  const query = at?.query ?? '';
  const [people, setPeople] = useState<{mode: 'from' | 'to'; query: string; list: Recipient[]} | null>(null);
  useEffect(() => {
    if (!person) return;
    let live = true;
    // Nothing typed yet shows the top people at once.
    const timer = window.setTimeout(() => {
      void suggestPeople(query, person).then(list => live && setPeople({mode: person, query, list})).catch(() => live && setPeople(null));
    }, query ? 120 : 0);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [person, query]);
  const [closed, setClosed] = useState<string | null>(null);
  const [cursor, setCursor] = useState({key: '', cur: 0});
  const key = at ? `${at.start}:${at.name}` : '';
  if (closed !== null && closed !== key) setClosed(null);
  const offers: Offer[] = !at || closed === key ? []
    : at.name === 'has' || at.name === 'is' ? operatorValues(at.name, at.query).map(value => ({name: value, address: null, value}))
      : people?.mode === at.name && people.query === query ? people.list.map(one => ({name: one.name ?? one.address, address: one.name ? one.address : null, value: one.address})) : [];
  // A value typed out in full needs no list.
  const shown = offers.length === 1 && offers[0]!.value.toLowerCase() === query.toLowerCase() ? [] : offers;
  const listKey = `${key}:${query}`;
  const cur = cursor.key === listKey ? Math.min(cursor.cur, shown.length - 1) : 0;
  return {
    at, offers: shown, cur, person: person !== null,
    move: (step: 1 | -1) => setCursor({key: listKey, cur: (cur + step + shown.length) % shown.length}),
    close: () => setClosed(key),
  };
}

/**
 * On the phone the list under an operator ends above the keys: its height stops at the foot of what
 * Safari shows (the visual viewport), and it scrolls within that, as the phone's sheet follows it.
 */
function useListAboveKeys(on: boolean, field: RefObject<HTMLLabelElement | null>) {
  useLayoutEffect(() => {
    const list = field.current?.querySelector<HTMLElement>(':scope > .places');
    const viewport = window.visualViewport;
    if (!on || !list || !viewport) return;
    const fit = () => {
      const room = viewport.offsetTop + viewport.height - list.getBoundingClientRect().top - 8;
      list.style.maxHeight = `${Math.max(room, 0)}px`;
    };
    fit();
    viewport.addEventListener('resize', fit);
    viewport.addEventListener('scroll', fit);
    return () => {
      viewport.removeEventListener('resize', fit);
      viewport.removeEventListener('scroll', fit);
    };
  }, [on, field]);
}

// The field on screen's select-all, for App's `/` and ⌘F.
let selectWhole: (() => void) | null = null;

/**
 * `/` or ⌘F: focuses the header's field and selects its whole query, chips too, so what's typed next
 * replaces it. False with no field on screen.
 */
export function selectSearch() {
  selectWhole?.();
  return selectWhole !== null;
}

/**
 * The header's field. `/` or ⌘F focuses it, selecting the query. Enter hands the keys to the results
 * (J, K, Enter), the cursor on the first. Tab takes a suggestion that's showing, and otherwise moves
 * on as it does anywhere. ⌘Enter asks Alfred. Esc clears the search. Backspace in an empty field
 * removes the last chip.
 */
export function SearchField<R>({search, onAsk, onEnter, label = 'Search mail', arrowDown = false, onEscape, autoFocus, operators = false}: SearchFieldProps<R>) {
  const input = useRef<HTMLInputElement>(null);
  const mirror = useRef<HTMLSpanElement>(null);
  useMirror(input, mirror, search.text);
  const [caret, setCaret] = useState<number | null>(null);
  const field = useRef<HTMLLabelElement>(null);
  // A chip removed (its × or Backspace) collapses away over 120 ms, and the rest close up after it. A
  // new one pops in (search.css).
  const removeChip = (index: number) => {
    leaveCopy(field.current?.querySelectorAll(':scope > .qchip')[index] ?? null,
      chip => [{maxWidth: `${chip.offsetWidth}px`, opacity: 1}, {maxWidth: '0px', opacity: 0, paddingLeft: '0px', paddingRight: '0px', marginRight: '-8px'}],
      {duration: motion.fast, easing: motion.ease});
    search.removeChip(index);
  };
  // The field is a label for its words. A click on a chip, the glyph or the hint goes to them, and
  // its hover lights no chip's ×, which, as the label's first button, would otherwise be its control.
  const inputId = useId();
  // The chips are selected with the words (selectSearch) until the next key, click or blur.
  const [whole, setWhole] = useState(false);
  // The phone has no Esc: a search there is left by its clear button, where the hint would be.
  const phone = usePhone();
  // While the field has focus, / types a slash and Esc is the way out, so the hint says Esc.
  const [focused, setFocused] = useState(false);
  const marked = operators;
  const list = useOperatorList(marked && focused, search.text, caret);
  const listOpen = list.offers.length > 0;
  useListAboveKeys(phone && listOpen, field);
  // After a pick the caret goes after the space it put in.
  const placeCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (placeCaret.current === null || !input.current) return;
    input.current.setSelectionRange(placeCaret.current, placeCaret.current);
    placeCaret.current = null;
  });
  const pick = (offer: Offer) => {
    if (!list.at) return;
    const next = withOperatorPick(search.text, list.at, offer.value);
    placeCaret.current = next.caret;
    setCaret(next.caret);
    search.setText(next.text);
  };
  useEffect(() => {
    const select = () => {
      input.current?.focus();
      input.current?.select();
      setWhole(true);
    };
    selectWhole = select;
    return () => {
      if (selectWhole === select) selectWhole = null;
    };
  }, []);
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    setWhole(false);
    // Typing or deleting over the whole query replaces its chips too. The input replaces its words.
    if (whole && search.chips.length && (event.key === 'Backspace' || event.key === 'Delete' || (event.key.length === 1 && !event.metaKey && !event.ctrlKey))) {
      search.clear();
      return;
    }
    // The list under an operator has the keys first: ↓ and ↑ move, Enter and Tab pick, Esc closes it.
    if (listOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      list.move(event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (listOpen && ((event.key === 'Enter' && !event.metaKey && !event.ctrlKey) || (event.key === 'Tab' && !event.shiftKey))) {
      event.preventDefault();
      pick(list.offers[list.cur]!);
      return;
    }
    if (listOpen && event.key === 'Escape') {
      event.preventDefault();
      list.close();
      return;
    }
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (search.active && onAsk) onAsk();
    } else if (event.key === 'Tab' && !event.shiftKey && search.suggestion) {
      event.preventDefault();
      search.acceptSuggestion?.();
    } else if (event.key === 'Enter' || (arrowDown && event.key === 'ArrowDown')) {
      event.preventDefault();
      // The keys stay here until the answer's in, if the pause hadn't run out, so what's typed meanwhile
      // is typed. Not if the user has gone elsewhere since.
      void search.settle().then(settled => {
        if (!settled || document.activeElement !== input.current) return;
        input.current?.blur();
        if (settled.first) onEnter(settled.first);
      });
    } else if (event.key === 'Escape') {
      if (onEscape) {
        event.preventDefault();
        onEscape();
        return;
      }
      if (search.active) search.clear();
      input.current?.blur();
    } else if (event.key === 'Backspace' && !search.text && search.chips.length) {
      // Its word may come back into the field, and Backspace isn't to take a letter off it.
      event.preventDefault();
      removeChip(search.chips.length - 1);
    }
  };
  const words = (
    <input ref={input} id={inputId} className={marked ? 'q-input' : 'grow'} placeholder={search.chips.length ? '' : label} aria-label={label} value={search.text} autoFocus={autoFocus}
      role={marked ? 'combobox' : undefined} aria-expanded={marked ? listOpen : undefined} aria-autocomplete={marked ? 'list' : undefined}
      onChange={event => {
        setCaret(event.target.selectionStart);
        search.setText(event.target.value);
      }}
      onSelect={event => setCaret(event.currentTarget.selectionStart)} onKeyDown={onKeyDown} onMouseDown={() => setWhole(false)} onFocus={() => setFocused(true)}
      onBlur={() => {
        setWhole(false);
        setFocused(false);
      }} />
  );
  return (
    <label ref={field} className={['search', marked && 'ops', search.active && 'active', search.pending && 'pending'].filter(Boolean).join(' ')} htmlFor={inputId}>
      {/* While a search is on its way, once it's taken a moment, its glyph turns. */}
      <span className="glass">
        {search.pending && <span className="spin"><Icon name="progress_activity" size={16} /></span>}
        <Icon name="search" size={16} />
      </span>
      {search.chips.map((chip, index) => (
        <span className={whole ? 'qchip sel' : 'qchip'} key={chipKey(chip)}>
          <span className="k">{negated(chip) ? `Not ${CHIP_KEYS[chip.kind]}` : CHIP_KEYS[chip.kind]}</span>{chip.label}
          {/* Its own click stays its own: the label would send it on to the words. */}
          <button className="x" type="button" aria-label={`Remove ${chip.label}`} onClick={event => {
            event.preventDefault();
            removeChip(index);
          }}><Icon name="close" size={14} /></button>
        </span>
      ))}
      {marked ? (
        // The input's own letters are clear over a mirror that holds the marks, as the editor's line.
        <span className="q-line">
          <span ref={mirror} className="q-marks" aria-hidden="true"><span className="q-text"><OperatorMarks text={search.text} marks={operatorMarks(search.text)} /></span></span>
          {words}
        </span>
      ) : words}
      {listOpen && (
        <PlaceList places={list.offers} cur={list.cur} query={list.at?.query ?? ''} floating icon={list.person ? 'person' : null} label={list.person ? 'People' : 'Values'}
          keyOf={offer => offer.value} onPick={pick} />
      )}
      {phone && search.active ? (
        // Its own tap stays its own: the label would send it on to the words.
        <button className="search-clear" type="button" aria-label="Clear search" onClick={event => {
          event.preventDefault();
          search.clear();
          input.current?.blur();
        }}><Icon name="close" size={18} /></button>
      ) : <span className="kbd">{search.active || focused ? 'Esc' : '/'}</span>}
    </label>
  );
}

/**
 * "No emails match", then each chip and the words as the same chips the field draws, each knocked off
 * by its ×. A Not chip keeps its "Not" label.
 */
export function NoResults({lead, search, children}: {lead: string; search: Pick<SearchFieldState<SearchChip | CalendarSearchChip, unknown, unknown>, 'chips' | 'text' | 'removeChip' | 'clearText'>; children?: ReactNode}) {
  return (
    <div className="no-results">
      <Icon name="search_off" size={20} />
      <span>{lead}</span>
      {search.chips.map((chip, index) => (
        <span className="part" key={chipKey(chip)}>
          {negated(chip) && <span className="k">Not</span>}{chip.label}
          <button className="x" type="button" aria-label={`Remove ${chip.label}`} onClick={() => search.removeChip(index)}><Icon name="close" size={14} /></button>
        </span>
      ))}
      {search.text.trim() && (
        <span className="part">{search.text.trim()}<button className="x" type="button" aria-label={`Remove ${search.text.trim()}`} onClick={search.clearText}><Icon name="close" size={14} /></button></span>
      )}
      {children}
    </div>
  );
}

export interface ResultsProps {
  search: Search;
  // The results by section (logic/search.ts › resultSections), without those in Trash.
  sections: {about: SearchResultOut[]; more: number; mentions: SearchResultOut[]; leftOut: {more: number; rows: SearchResultOut[]}};
  cursor: string | null;
  openId: number | null;
  // The emails selected, drawn as the open one is.
  selected?: ReadonlySet<number>;
  accounts: Map<number, AccountOut>;
  now: number;
  timeZone: string;
  // Alfred's Answer card, above the results.
  card: ReactNode;
  onPoint: (key: string) => void;
  // A click on a result, with its modifiers: ⌘ or Ctrl and ⇧ select, a plain one opens.
  onOpen: (id: number, key: string, event: MouseEvent) => void;
  // Ask Alfred, leading the results. Sent's search has none.
  onAsk?: () => void;
}

const resultKey = (id: number) => `all:${id}`;

/**
 * What the search could narrow to, at the end of the results line, a place that's already
 * there, so nothing moves as it comes and goes. Its press leaves the keys in the field. Tab is said
 * only while the field has them (search.css).
 */
function Suggestion({search}: {search: Search}) {
  if (!search.suggestion) return null;
  const {filters, count} = suggestionLine(search.suggestion);
  return (
    <button className="suggest" type="button" data-tip={`${filters} · ${count}`} onMouseDown={event => event.preventDefault()} onClick={search.acceptSuggestion}>
      <span className="ell">{filters}</span>
      <span className="num ink3">{count}</span>
      <span className="kbd">Tab</span>
    </button>
  );
}

export function SearchResults(props: ResultsProps) {
  const {search, sections, card} = props;
  const {out} = search;
  const end = useRef<HTMLDivElement>(null);
  // The next page as the list nears its end, which is the fold while it's folded. The rows under it
  // aren't asked for until they'd show.
  const ask = nextAsk(out, search.mentions, search.results.length, search.moreLeftOut);
  useEffect(() => {
    const target = end.current;
    if (!target || !ask) return;
    // The list is the root. Its margin means nothing for a box scrolling inside the page, and at the
    // very end a fraction of a pixel can leave the empty marker just outside what the list shows.
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) (ask === 'more' ? search.loadMore : search.loadLeftOut)();
    }, {root: target.parentElement, rootMargin: '400px'});
    observer.observe(target);
    return () => observer.disconnect();
  });
  const indexing = out ? indexingLine(out.indexing) : null;
  const indexed = out?.indexing ? `${Math.round(out.indexing.progress * 1000) / 10}%` : null;
  const parts = queryParts(search.chips, search.text);
  // It shows once the first answer is in (InboxPage keeps the list until then), and fades in. A
  // refinement on its way dims what it replaces, once it's taken a moment.
  return (
    <section className={search.pending ? 'list search-list arrive pending' : 'list search-list arrive'} aria-label="Search results">
      <ScrollThumb />
      {card}
      {/* Ask Alfred leads the results, where the Answer card stands once asked (board 06). */}
      {out && !card && props.onAsk && (
        <button className="ask" type="button" onClick={props.onAsk}>
          <Icon name="auto_awesome" size={16} alfred />
          <span className="grow ell">Ask Alfred <span className="ink3">· {parts.join(' · ')}</span></span>
          <span className="kbd">⌘Enter</span>
        </button>
      )}
      {/* The first backfill: the shared spinner, the words, and its progress along the line's foot. */}
      {indexing && (
        <div className="bar muted progress indexing" style={{'--done': indexed} as CSSProperties}>
          <span className="spin"><Icon name="progress_activity" size={16} /></span>
          <span className="num">{indexing}</span>
        </div>
      )}
      {search.error && <div className="bar muted failing"><Icon name="warning" size={16} />{search.error}</div>}
      {out && out.total > 0 && (
        <div className={card ? 'bar muted after-card' : 'bar muted'}>
          {resultsLine({...out, total: firstSection(out)}).map((part, index) => <Fragment key={part}>{index > 0 && <span>·</span>}<span className="num">{part}</span></Fragment>)}
          <Suggestion search={search} />
        </div>
      )}
      {sections.about.map(result => <ResultRow key={result.id} result={result} {...props} />)}
      {/* A new search's fold is its own: no rows folding between one search's and the next's. */}
      {sections.more > 0 && (
        <Folding key={search.answering} {...props} line={MENTIONS_KEY} rows={sections.mentions} open={search.mentions} toggle={search.toggleMentions} words={mentionsLine(sections.more, out?.partial ?? false)} />
      )}
      {out && out.total === 0 && <NoResults lead="No emails match" search={search}><Suggestion search={search} /></NoResults>}
      {/* Past the chips, under whatever they let through: the fold is what they kept and only mentions the words. */}
      {sections.leftOut.more > 0 && (
        <Folding key={`left:${search.answering}`} {...props} line={LEFT_OUT_KEY} rows={sections.leftOut.rows} open={search.leftOut?.open ?? false} toggle={search.toggleLeftOut} words={leftOutLine(sections.leftOut.more)} />
      )}
      <div ref={end} />
    </section>
  );
}

type Part = {kind: 'fold'; open: boolean} | {kind: 'row'; result: SearchResultOut};
// Its rows open and close as a group's do; a page arriving under it just comes.
const foldRules = (line: string): FoldRules<Part> => ({
  folds: () => true,
  arrives: () => true,
  opens: (_, was) => {
    const fold = was(line)?.item;
    return fold?.kind === 'fold' && !fold.open;
  },
});
const FOLD_RULES = {[MENTIONS_KEY]: foldRules(MENTIONS_KEY), [LEFT_OUT_KEY]: foldRules(LEFT_OUT_KEY)};

interface FoldingProps extends ResultsProps {
  line: typeof MENTIONS_KEY | typeof LEFT_OUT_KEY;
  rows: SearchResultOut[];
  open: boolean;
  toggle: () => void;
  words: string;
}

/**
 * A line and the rows it folds, open from the start or in place on a click or Enter: "12 more mention
 * these words", and "6 more emails match your words" after it.
 */
function Folding({line: lineKey, rows, open, toggle, words, ...props}: FoldingProps) {
  const {cursor, onPoint} = props;
  const entries = useMemo((): Entry<Part>[] => [
    {key: lineKey, id: null, item: {kind: 'fold', open}},
    ...rows.map((result): Entry<Part> => ({key: resultKey(result.id), id: result.id, item: {kind: 'row', result}})),
  ], [lineKey, open, rows]);
  const shown = useFold(entries, FOLD_RULES[lineKey], FOLD_HOLD_MS);
  const delays = foldDelays(shown, entry => (entry.item.kind === 'row' ? lineKey : null));
  const line = useRef<HTMLButtonElement>(null);
  // Opened at the foot of the list, its rows come into view once they're in. A search that
  // starts open leaves the list where it is.
  const wasOpen = useRef(open);
  useEffect(() => {
    const opened = open && !wasOpen.current;
    wasOpen.current = open;
    if (!opened) return;
    const timer = window.setTimeout(() => line.current?.nextElementSibling?.scrollIntoView({block: 'nearest'}), FOLD_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [open]);
  return shown.map(({key, item, fold}) => {
    if (item.kind === 'row') return <ResultRow key={key} {...props} result={item.result} fold={fold} delay={delays.get(key)} />;
    return (
      <button key={key} ref={line} type="button" className={['mentions', lineKey === LEFT_OUT_KEY && 'left-out', !item.open && 'collapsed', cursor === key && 'cur'].filter(Boolean).join(' ')} aria-expanded={item.open}
        data-key={key} onMouseMove={() => key !== cursor && onPoint(key)} onClick={toggle}>
        <span className="num">{words}</span>
        {/* One chevron, turned to point right while it's folded, as a group's. */}
        <span className="chev"><Icon name="expand_more" /></span>
      </button>
    );
  });
}

function ResultRow({result, cursor, openId, selected, accounts, now, timeZone, onPoint, onOpen, fold = null, delay}: ResultsProps & {result: SearchResultOut; fold?: Fold; delay?: number}) {
  const key = resultKey(result.id);
  const reasons = shownReasons(result);
  const leaving = fold === 'out';
  const classes = ['arow', 'result', result.unread && 'unread', result.done && 'done', result.protected && 'protected', cursor === key && 'cur', openId === result.id && 'open', selected?.has(result.id) && 'sel', leaving && 'leaving'].filter(Boolean).join(' ');
  return (
    <div ref={foldRef(fold, delay)} className={classes} data-key={leaving ? undefined : key} data-id={leaving ? undefined : result.id} aria-hidden={leaving || undefined} onMouseMove={leaving ? undefined : () => onPoint(key)} onMouseDown={keepTextUnselected}
      onClick={leaving ? undefined : event => onOpen(result.id, key, event)}>
      <span className="ud" />
      <div className="l1">
        {/* Sent mail names who it went to, where received mail names its sender. */}
        {/* A conversation names everyone in it, as the Inbox's rows do. */}
        {(result.thread?.count ?? 1) > 1 && (result.thread?.people.length ?? 0) > 1 ? <ConversationFrom row={result} lone={result.from_name} />
          : 'to' in result ? <SentFrom to={result.to} cc={result.cc} /> : <span className="from"><Marked parts={resultSender(result)} /></span>}
        {result.via && <span className="via">via {result.via}</span>}
        {result.replied_at && <RepliedMark at={result.replied_at} now={now} timeZone={timeZone} />}
        {result.pinned && <span className="pin"><Icon name="keep" size={16} /></span>}
        {result.protected && <span className="tag alert"><Icon name="shield" size={14} />Protected</span>}
        {result.done && <span className="tag"><Icon name="check" size={14} />Done</span>}
        {result.snoozed_until && <SnoozedMark until={result.snoozed_until} now={now} timeZone={timeZone} />}
      </div>
      <div className="r1">
        <Account account={accounts.get(result.account_id)} />
        <span className="age" data-tip={fullTimestamp(result.received_at, timeZone)}>{age(result.received_at, now, timeZone)}</span>
      </div>
      <div className="l2"><Marked parts={fieldSegments(result, 'subject')} /></div>
      {result.excerpt && <div className="l3"><Marked parts={fieldSegments(result, 'excerpt')} /></div>}
      {/* Only what the row doesn't already show. None left, no line. */}
      {reasons.length > 0 && (
        <div className="why">
          {reasons.map((reason, index) => {
            const {key: kind, value} = reasonParts(reason.label);
            return <Fragment key={reason.label}>{index > 0 && <span>·</span>}<span>{kind} <b>{value}</b></span></Fragment>;
          })}
        </div>
      )}
    </div>
  );
}
