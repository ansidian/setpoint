// Search (DESIGN.md › Search; board 06): the header's field with its chips, and the results that
// replace the list: Alfred's Answer card above them, the results line, each result with why it
// matched and its matches highlighted, Ask Alfred ⌘Enter last, and the no-results line with each
// chip removable. Kept thin: the rules are logic/search.ts's, and the state is state.ts's.
import type {AccountOut, CalendarSearchChip, SearchChip, SearchResultOut} from '@setpoint/shared';
import {Fragment, useEffect, useId, useRef, useState} from 'react';
import type {KeyboardEvent, ReactNode} from 'react';
import {age, fullTimestamp} from '../../logic/format.ts';
import {fieldSegments, indexingLine, queryParts, reasonParts, resultSender, resultsLine} from '../../logic/search.ts';
import type {Segment} from '../../logic/search.ts';
import {motion} from '../../tokens.ts';
import {Icon} from '../../ui/Icon.tsx';
import {dotStyle} from '../accounts.ts';
import {leaveCopy} from '../fold.ts';
import {usePhone} from '../Phone.tsx';
import type {Search, SearchFieldState} from './state.ts';
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

type FieldSearch<R> = Pick<SearchFieldState<SearchChip | CalendarSearchChip, unknown, R>, 'chips' | 'text' | 'active' | 'setText' | 'settle' | 'removeChip' | 'clear'>;

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
 * The header's field. `/` or ⌘F focuses it, selecting the query; Enter takes the chips and hands the keys to the results
 * (J, K, Enter), the cursor on the first; ⌘Enter asks Alfred; Esc clears the search; Backspace in an empty field removes the
 * last chip.
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
  // While the field has focus, / types a slash and Esc is the way out, so the hint says Esc (#135).
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
    } else if (event.key === 'Enter' || (arrowDown && event.key === 'ArrowDown')) {
      event.preventDefault();
      input.current?.blur();
      void search.settle().then(first => first && onEnter(first));
    } else if (event.key === 'Escape') {
      if (onEscape) {
        event.preventDefault();
        onEscape();
        return;
      }
      if (search.active) search.clear();
      input.current?.blur();
    } else if (event.key === 'Backspace' && !search.text && search.chips.length) {
      removeChip(search.chips.length - 1);
    }
  };
  return (
    <label ref={field} className={search.active ? 'search active' : 'search'} htmlFor={inputId}>
      <Icon name="search" size={16} />
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

/** "No emails match **Northwind · Rejection · Mar 2026**", each chip and the words removable. */
export function NoResults({lead, search}: {lead: string; search: Pick<SearchFieldState<SearchChip | CalendarSearchChip, unknown, unknown>, 'chips' | 'text' | 'removeChip' | 'clearText'>}) {
  return (
    <div className="no-results">
      <Icon name="search_off" size={20} />
      <span>{lead}</span>
      {search.chips.map((chip, index) => (
        <Fragment key={chipKey(chip)}>
          {index > 0 && <span className="ink3">·</span>}
          <span className="part"><b>{negated(chip) ? `Not ${chip.label}` : chip.label}</b><button className="x" type="button" aria-label={`Remove ${chip.label}`} onClick={() => search.removeChip(index)}><Icon name="close" size={14} /></button></span>
        </Fragment>
      ))}
      {search.text.trim() && (
        <>
          {search.chips.length > 0 && <span className="ink3">·</span>}
          <span className="part"><b>{search.text.trim()}</b><button className="x" type="button" aria-label={`Remove ${search.text.trim()}`} onClick={search.clearText}><Icon name="close" size={14} /></button></span>
        </>
      )}
    </div>
  );
}

export interface ResultsProps {
  search: Search;
  cursor: string | null;
  openId: number | null;
  accounts: Map<number, AccountOut>;
  now: number;
  timeZone: string;
  // Alfred's Answer card, above the results.
  card: ReactNode;
  onPoint: (key: string) => void;
  onOpen: (id: number, key: string) => void;
  onAsk: () => void;
}

const resultKey = (id: number) => `all:${id}`;

export function SearchResults(props: ResultsProps) {
  const {search, card} = props;
  const {out, results} = search;
  const end = useRef<HTMLDivElement>(null);
  // The next page as the list nears its end.
  useEffect(() => {
    const target = end.current;
    if (!target) return;
    const observer = new IntersectionObserver(entries => entries.some(entry => entry.isIntersecting) && search.loadMore(), {rootMargin: '400px'});
    observer.observe(target);
    return () => observer.disconnect();
  });
  const indexing = out ? indexingLine(out.indexing) : null;
  const parts = queryParts(search.chips, search.text);
  return (
    <section className="list search-list" aria-label="Search results">
      {card}
      {/* Ask Alfred leads the results, where the Answer card stands once asked (board 06). */}
      {out && !card && (
        <button className="ask" type="button" onClick={props.onAsk}>
          <Icon name="auto_awesome" size={16} alfred />
          <span className="grow ell">Ask Alfred <span className="ink3">· {parts.join(' · ')}</span></span>
          <span className="kbd">⌘Enter</span>
        </button>
      )}
      {indexing && <div className="bar muted">{indexing}</div>}
      {search.error && <div className="bar muted failing">{search.error}</div>}
      {out && out.total > 0 && (
        <div className={card ? 'bar muted after-card' : 'bar muted'}>
          {resultsLine(out).map((part, index) => <Fragment key={part}>{index > 0 && <span>·</span>}<span className="num">{part}</span></Fragment>)}
        </div>
      )}
      {results.map(result => <ResultRow key={result.id} result={result} {...props} />)}
      {out && out.total === 0 && <NoResults lead="No emails match" search={search} />}
      <div ref={end} />
    </section>
  );
}

function ResultRow({result, cursor, openId, accounts, now, timeZone, onPoint, onOpen}: ResultsProps & {result: SearchResultOut}) {
  const key = resultKey(result.id);
  const classes = ['arow', 'result', result.unread && 'unread', result.done && 'done', result.protected && 'protected', cursor === key && 'cur', openId === result.id && 'open'].filter(Boolean).join(' ');
  return (
    <div className={classes} data-key={key} data-id={result.id} onMouseMove={() => onPoint(key)} onClick={() => onOpen(result.id, key)}>
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
      <div className="why">
        {result.reasons.map((reason, index) => {
          const {key: kind, value} = reasonParts(reason.label);
          return <Fragment key={reason.label}>{index > 0 && <span>·</span>}<span>{kind} <b>{value}</b></span></Fragment>;
        })}
      </div>
    </div>
  );
}
