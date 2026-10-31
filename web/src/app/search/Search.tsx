// Search (DESIGN.md › Search; board 06): the header's field with its chips, and the results that
// replace the list: Alfred's Answer card above them, the results line, each result with why it
// matched and its matches highlighted, the fold over those that only mention the search, the line of
// what a suggestion's chips left out, the suggestion itself in the results line, and the no-results
// line with each chip removable. Kept thin: the rules are logic/search.ts's, and the state is mailSearch.ts's and
// state.ts's.
import type {AccountOut, CalendarSearchChip, SearchChip, SearchResultOut} from '@setpoint/shared';
import {Fragment, useEffect, useId, useMemo, useRef, useState} from 'react';
import type {CSSProperties, KeyboardEvent, MouseEvent, ReactNode} from 'react';
import {age, fullTimestamp} from '../../logic/format.ts';
import type {Entry, Fold, FoldRules} from '../../logic/fold.ts';
import {LEFT_OUT_KEY, MENTIONS_KEY} from '../../logic/inbox.ts';
import {fieldSegments, firstSection, indexingLine, leftOutLine, mentionsLine, queryParts, reasonParts, resultSender, resultsLine, shownReasons, suggestionLine} from '../../logic/search.ts';
import type {Segment} from '../../logic/search.ts';
import {motion} from '../../tokens.ts';
import {Icon} from '../../ui/Icon.tsx';
import {keepTextUnselected} from '../../ui/keys.ts';
import {dotStyle} from '../accounts.ts';
import {FOLD_HOLD_MS, foldDelays, foldRef, leaveCopy, useFold} from '../fold.ts';
import {usePhone} from '../Phone.tsx';
import type {Search} from './mailSearch.ts';
import type {SearchFieldState} from './state.ts';
import './search.css';

const CHIP_KEYS: Record<SearchChip['kind'] | CalendarSearchChip['kind'], string> = {organisation: 'Org', type: 'Type', date: 'Date', account: 'Account', kind: 'Kind', calendar: 'Calendar'};
// A mail chip typed after "!" leaves its matches out: "Not Type Confirmation".
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
  // SV-23: the calendar's field ("Search calendar"), where ↓ goes to the first result as Enter does,
  // and Esc closes what's on top (the floating detail, then the search).
  label?: string;
  arrowDown?: boolean;
  onEscape?: () => void;
  autoFocus?: boolean;
}

// The field on screen's select-all, for App's `/` and ⌘F.
let selectWhole: (() => void) | null = null;

/**
 * `/` or ⌘F: focuses the header's field and selects its whole query, chips too, so what's typed next
 * replaces it (SV-25). False with no field on screen.
 */
export function selectSearch() {
  selectWhole?.();
  return selectWhole !== null;
}

/**
 * The header's field. `/` or ⌘F focuses it, selecting the query; Enter hands the keys to the results (J, K, Enter), the
 * cursor on the first; Tab takes a suggestion that's showing, and otherwise moves on as it does anywhere; ⌘Enter asks
 * Alfred; Esc clears the search; Backspace in an empty field removes the last chip.
 */
export function SearchField<R>({search, onAsk, onEnter, label = 'Search mail', arrowDown = false, onEscape, autoFocus}: SearchFieldProps<R>) {
  const input = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLLabelElement>(null);
  // A chip removed (its × or Backspace) collapses away over 120 ms, and the rest close up after it; a
  // new one pops in (search.css).
  const removeChip = (index: number) => {
    leaveCopy(field.current?.querySelectorAll(':scope > .qchip')[index] ?? null,
      chip => [{maxWidth: `${chip.offsetWidth}px`, opacity: 1}, {maxWidth: '0px', opacity: 0, paddingLeft: '0px', paddingRight: '0px', marginRight: '-8px'}],
      {duration: motion.fast, easing: motion.ease});
    search.removeChip(index);
  };
  // The field is a label for its words: a click on a chip, the glyph or the hint goes to them, and
  // its hover lights no chip's ×, which, as the label's first button, would otherwise be its control.
  const inputId = useId();
  // The chips are selected with the words (selectSearch) until the next key, click or blur.
  const [whole, setWhole] = useState(false);
  // The phone has no Esc: a search there is left by its clear button, where the hint would be.
  const phone = usePhone();
  // While the field has focus, / types a slash and Esc is the way out, so the hint says Esc (#172).
  const [focused, setFocused] = useState(false);
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
    // Typing or deleting over the whole query replaces its chips too; the input replaces its words.
    if (whole && search.chips.length && (event.key === 'Backspace' || event.key === 'Delete' || (event.key.length === 1 && !event.metaKey && !event.ctrlKey))) {
      search.clear();
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
  return (
    <label ref={field} className={['search', search.active && 'active', search.pending && 'pending'].filter(Boolean).join(' ')} htmlFor={inputId}>
      {/* While a search is on its way, once it's taken a moment, its glyph turns (search-03, #235). */}
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
      <input ref={input} id={inputId} className="grow" placeholder={search.chips.length ? '' : label} aria-label={label} value={search.text} autoFocus={autoFocus}
        onChange={event => search.setText(event.target.value)} onKeyDown={onKeyDown} onMouseDown={() => setWhole(false)} onFocus={() => setFocused(true)}
        onBlur={() => {
          setWhole(false);
          setFocused(false);
        }} />
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
 * by its × (search-13); a Not chip keeps its "Not" label.
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
  // The emails selected (#249), drawn as the open one is.
  selected?: ReadonlySet<number>;
  accounts: Map<number, AccountOut>;
  now: number;
  timeZone: string;
  // Alfred's Answer card, above the results.
  card: ReactNode;
  onPoint: (key: string) => void;
  // A click on a result, with its modifiers: ⌘ or Ctrl and ⇧ select (#249), a plain one opens.
  onOpen: (id: number, key: string, event: MouseEvent) => void;
  onAsk: () => void;
}

const resultKey = (id: number) => `all:${id}`;

/**
 * What the search could narrow to (D392), at the end of the results line, a place that's already
 * there, so nothing moves as it comes and goes. Its press leaves the keys in the field. Tab is said
 * only while the field has them (search.css).
 */
function Suggestion({search}: {search: Search}) {
  if (!search.suggestion) return null;
  const {filters, count} = suggestionLine(search.suggestion);
  return (
    <button className="suggest" type="button" title={`${filters} · ${count}`} onMouseDown={event => event.preventDefault()} onClick={search.acceptSuggestion}>
      <span className="ell">{filters}</span>
      <span className="num ink3">· {count}</span>
      <span className="kbd">Tab</span>
    </button>
  );
}

export function SearchResults(props: ResultsProps) {
  const {search, sections, card} = props;
  const {out} = search;
  const end = useRef<HTMLDivElement>(null);
  // The next page as the list nears its end, which is the fold while it's folded: the rows under it
  // aren't asked for until they'd show.
  const ended = out !== null && !search.mentions && search.results.length >= firstSection(out);
  const moreResults = !ended && out?.next_offset != null;
  useEffect(() => {
    const target = end.current;
    if (!target || (ended && !search.moreLeftOut)) return;
    // The list is the root: its margin means nothing for a box scrolling inside the page, and at the
    // very end a fraction of a pixel can leave the empty marker just outside what the list shows.
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) (moreResults ? search.loadMore : search.loadLeftOut)();
    }, {root: target.parentElement, rootMargin: '400px'});
    observer.observe(target);
    return () => observer.disconnect();
  });
  const indexing = out ? indexingLine(out.indexing) : null;
  const indexed = out?.indexing ? `${Math.round(out.indexing.progress * 1000) / 10}%` : null;
  const parts = queryParts(search.chips, search.text);
  // It shows once the first answer is in (InboxPage keeps the list until then), and fades in; a
  // refinement on its way dims what it replaces, once it's taken a moment (search-03, #235).
  return (
    <section className={search.pending ? 'list search-list arrive pending' : 'list search-list arrive'} aria-label="Search results">
      {card}
      {/* Ask Alfred leads the results, where the Answer card stands once asked (board 06). */}
      {out && !card && (
        <button className="ask" type="button" onClick={props.onAsk}>
          <Icon name="auto_awesome" size={16} alfred />
          <span className="grow ell">Ask Alfred <span className="ink3">· {parts.join(' · ')}</span></span>
          <span className="kbd">⌘Enter</span>
        </button>
      )}
      {/* The first backfill: the shared spinner, the words, and its progress along the line's foot (states-15, search-12). */}
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
// Its rows open and close as a group's do (#198); a page arriving under it just comes.
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
  // Opened at the foot of the list, its rows come into view once they're in (#70); a search that
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
        <span className="from"><Marked parts={resultSender(result)} /></span>
        {result.via && <span className="via">via {result.via}</span>}
        {result.pinned && <span className="pin"><Icon name="keep" size={16} /></span>}
        {result.protected && <span className="tag alert"><Icon name="shield" size={14} />Protected</span>}
        {result.done && <span className="tag"><Icon name="check" size={14} />Done</span>}
      </div>
      <div className="r1">
        <Account account={accounts.get(result.account_id)} />
        <span className="age" title={fullTimestamp(result.received_at, timeZone)}>{age(result.received_at, now, timeZone)}</span>
      </div>
      <div className="l2"><Marked parts={fieldSegments(result, 'subject')} /></div>
      {result.excerpt && <div className="l3"><Marked parts={fieldSegments(result, 'excerpt')} /></div>}
      {/* Only what the row doesn't already show (search-11); none left, no line. */}
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
