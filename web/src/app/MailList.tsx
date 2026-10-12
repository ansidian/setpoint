// The Inbox's list (DESIGN.md › The list): group headers, one-line rows, Attention's three-line
// rows and its pattern prompt, code rows with Copy, the Pinned shelf with Unpin under the pointer,
// the footer and All caught up. Kept thin: what shows comes from logic/inbox.ts, and every action is
// the page's (InboxPage.tsx). Rows fold out as they leave and in as they arrive (app/fold.ts). A
// group opened at the foot of the list scrolls its rows into view.
import type {AccountOut, MessageRowOut} from '@setpoint/shared';
import {useEffect, useMemo, useRef, useState} from 'react';
import type {MouseEvent, Ref} from 'react';
import {age, codeGroups, fullTimestamp} from '../logic/format.ts';
import {GROUP_GLYPHS, groupKey, promptText, rowKey, rowLine, sender, showsPending} from '../logic/inbox.ts';
import type {GroupView, PatternPrompt} from '../logic/inbox.ts';
import type {Entry, Folded, FoldRules} from '../logic/fold.ts';
import {motion} from '../tokens.ts';
import {Icon, Mark} from '../ui/Icon.tsx';
import {dotStyle} from './accounts.ts';
import {CodeCopy, useCountdown} from './Code.tsx';
import {Count} from './Count.tsx';
import {beats, FOLD_HOLD_MS, foldDelays, foldRef, STAGGER_CAP_MS, useFold} from './fold.ts';
import type {Beat} from './fold.ts';
import {TriageNote, useHealthBars} from './states/States.tsx';

export interface ListProps {
  views: GroupView[];
  cursor: string | null;
  openId: number | null;
  accounts: Map<number, AccountOut>;
  now: number;
  timeZone: string;
  caughtUp: boolean;
  // Whether Mark all as read has anything to read; its footer shows only then (UX #16).
  markable: boolean;
  onPoint: (key: string) => void;
  onOpen: (id: number, key: string) => void;
  onToggle: (view: GroupView) => void;
  onMarkAllRead: () => void;
  onOpenAll: () => void;
  onUnpin: (id: number) => void;
  // The pattern prompt at the end of Attention, and its Yes and No.
  prompt: PatternPrompt | null;
  onAnswer: (prompt: PatternPrompt, yes: boolean) => void;
}

/** What the list draws, in order: each group's header, its rows, and Attention's prompt. */
type Part = {kind: 'header'; view: GroupView} | {kind: 'row'; view: GroupView; row: MessageRowOut} | {kind: 'prompt'; prompt: PatternPrompt};

function parts(views: GroupView[], prompt: PatternPrompt | null): Entry<Part>[] {
  return views.flatMap(view => [
    {key: groupKey(view.group), id: null, item: {kind: 'header', view}},
    ...view.rows.map((row): Entry<Part> => ({key: rowKey(view.group, row.id), id: row.id, item: {kind: 'row', view, row}})),
    ...(view.group === 'attention' && prompt ? [{key: `prompt:${prompt.id}`, id: null, item: {kind: 'prompt', prompt}} as Entry<Part>] : []),
  ]);
}

const groupOf = (part: Part) => (part.kind === 'prompt' ? 'attention' : part.view.group);

// Every row that leaves (Done, Trash, Mark all as read, read elsewhere, Unpin, its group closing)
// folds out, and one moved or brought back (Pin, Undo) folds in, as do a group's rows as it opens
// (inbox-14), like a drawer.
const RULES: FoldRules<Part> = {
  folds: () => true,
  arrives: () => true,
  opens: (entry, was) => {
    const header = was(groupKey(groupOf(entry.item)))?.item;
    return header?.kind === 'header' && header.view.collapsed;
  },
};

export function MailList(props: ListProps) {
  const {views, caughtUp, prompt} = props;
  // All caught up keeps the Pinned shelf above the line (board 04).
  const entries = useMemo(() => parts(caughtUp ? views.filter(view => view.group === 'pinned') : views, prompt), [views, caughtUp, prompt]);
  const shown = useFold(entries, RULES, FOLD_HOLD_MS);
  // A row Done or Trash took beats first; a group's rows folding together start one after another.
  const delays = foldDelays(shown, entry => (entry.item.kind === 'row' ? entry.item.view.group : null));
  // Under a health bar the first group keeps its top line (boards 17, 19a).
  const bars = useHealthBars();
  return (
    <>
      {bars}
      {shown.map((entry, index) => <Part key={entry.key} entry={entry} delay={delays.get(entry.key) ?? 0} first={index === 0 && !bars} {...props} />)}
      {caughtUp ? (
        // A small finish (states-10, inbox-08): the mark settles in, then the line, then Open All with its U.
        <div className="empty">
          <div className="empty-line">
            <Mark size={44} settle />
            <span className="t">All caught up</span>
            <button className="btn ghost sm" type="button" onClick={props.onOpenAll}>Open All<span className="kbd">U</span></button>
          </div>
        </div>
      ) : props.markable && (
        <div className="listfoot">
          <button className="lnk" type="button" data-hint="shift+i" onClick={props.onMarkAllRead}><Icon name="mark_email_read" size={16} />Mark all as read <span className="kbd">⇧I</span></button>
        </div>
      )}
    </>
  );
}

/** One entry: a leaving one keeps its look, without its cursor, its key or the pointer, while it folds. */
function Part({entry, delay, first, ...props}: ListProps & {entry: Folded<Part>; delay: number; first: boolean}) {
  const {item, fold} = entry;
  // A row folding onto the shelf holds `sub3` a moment after, so it's clear where the email landed (inbox-09).
  const ref = foldRef(fold, delay, item.kind === 'row' && item.view.group === 'pinned');
  const leaving = fold === 'out';
  if (item.kind === 'header') {
    return <GroupHeader view={item.view} first={first} cur={!leaving && props.cursor === entry.key} leaving={leaving} fold={ref} onPoint={props.onPoint} onToggle={props.onToggle} />;
  }
  if (item.kind === 'prompt') return <Prompt prompt={item.prompt} onAnswer={props.onAnswer} leaving={leaving} fold={ref} />;
  const beat = leaving ? beats.get(item.row.id) ?? null : null;
  const rowProps = {...props, row: item.row, rowKey: entry.key, leaving, beat, fold: ref, ...(leaving ? {cursor: null, openId: null} : {})};
  return item.view.group === 'attention' ? <AttentionRow {...rowProps} /> : <Row {...rowProps} pinnedShelf={item.view.group === 'pinned'} noise={item.view.group === 'noise'} />;
}

/**
 * Scrolls the list just enough to show a group's last row, never past its header (Decided while
 * building #70). The header's own place is where the row before it ends, as a stuck header (inbox-10)
 * reports where it's stuck.
 */
function revealGroup(header: HTMLElement | null) {
  const list = header?.closest<HTMLElement>('.list');
  if (!header || !list) return;
  let last: Element = header;
  for (let next = header.nextElementSibling; next && !next.classList.contains('gh'); next = next.nextElementSibling) last = next;
  const box = list.getBoundingClientRect();
  const before = header.previousElementSibling;
  const top = before ? before.getBoundingClientRect().bottom : box.top - list.scrollTop;
  const below = last.getBoundingClientRect().bottom - box.bottom;
  if (below > 0) list.scrollBy({top: Math.min(below, top - box.top), behavior: 'smooth'});
}

type FoldRef = Ref<HTMLDivElement> | undefined;

function GroupHeader({view, first, cur, leaving, fold, onPoint, onToggle}: {
  view: GroupView;
  first: boolean;
  cur: boolean;
  leaving: boolean;
  fold: FoldRef;
  onPoint: (key: string) => void;
  onToggle: (view: GroupView) => void;
}) {
  const classes = ['gh', first && 'first', view.group === 'attention' && 'att', view.collapsible && 'toggle', view.collapsed && 'collapsed', cur && 'cur', leaving && 'leaving']
    .filter(Boolean).join(' ');
  // Opened (not shown open from the start): once its rows have folded in, they come into view, its
  // header kept on screen.
  const wasCollapsed = useRef(view.collapsed);
  useEffect(() => {
    const opened = wasCollapsed.current && !view.collapsed;
    wasCollapsed.current = view.collapsed;
    if (!opened) return;
    const timer = window.setTimeout(() => revealGroup(document.querySelector<HTMLElement>(`.list .gh[data-key="${groupKey(view.group)}"]`)), motion.medium + STAGGER_CAP_MS);
    return () => window.clearTimeout(timer);
  }, [view.collapsed, view.group]);
  const attributes = leaving ? {'aria-hidden': true} : {
    'data-key': groupKey(view.group), onClick: view.collapsible ? () => onToggle(view) : undefined, onMouseMove: view.collapsed ? () => onPoint(groupKey(view.group)) : undefined,
  };
  return (
    <div className={classes} ref={fold} {...attributes}>
      <span className="gi"><Icon name={GROUP_GLYPHS[view.group]} size={14} /></span>
      {view.label} <span className="n"><Count value={view.count} /></span>
      {view.preview && <span className="preview">{view.preview}</span>}
      {view.group === 'unsorted' && <TriageNote />}
      {/* One chevron, turned to point right while the group is collapsed (inbox-14). */}
      {view.collapsible && <span className="chev"><Icon name="expand_more" /></span>}
    </div>
  );
}

interface RowProps extends ListProps {
  row: MessageRowOut;
  rowKey: string;
  pinnedShelf?: boolean;
  // A Noise row recedes (DESIGN.md #168).
  noise?: boolean;
  leaving: boolean;
  // Leaving by Done or Trash: its beat before it folds (inbox-05).
  beat: Beat | null;
  fold: FoldRef;
}

function rowClasses(base: string, {row, rowKey: key, cursor, openId, leaving, beat}: RowProps): string {
  return [base, row.unread && 'unread', row.protected && base === 'arow' && 'protected', cursor === key && 'cur', openId === row.id && 'open',
    showsPending(row) && 'pending', leaving && 'leaving', beat && `beat-${beat}`].filter(Boolean).join(' ');
}

/** The unread gutter: its dot, or while a row beats, Done's check or Trash's bin in its place. */
export function Gutter({beat}: {beat: Beat | null}) {
  return <span className="ud">{beat && <Icon name={beat === 'done' ? 'check' : 'delete'} size={14} />}</span>;
}

/** A row's own attributes: a leaving one has no key, no id and no handlers, and is hidden from the tree. */
function rowAttributes({row, rowKey: key, leaving, fold, onPoint, onOpen}: RowProps) {
  return leaving ? {ref: fold, 'aria-hidden': true} : {ref: fold, 'data-key': key, 'data-id': row.id, onMouseMove: () => onPoint(key), onClick: () => onOpen(row.id, key)};
}

/**
 * A pinned email's row in its group keeps a 14 px keep-fill in `ink3` before its account (inbox-09), so
 * P visibly sticks a pin in it; one pinned while the list shows it grows in from .6 over 120 ms.
 */
function PinMark({pinned}: {pinned: boolean}) {
  const [atFirst] = useState(pinned);
  if (!pinned) return null;
  return <span className={atFirst ? 'pinmark' : 'pinmark new'} title="Pinned"><Icon name="keep-fill" size={14} /></span>;
}

function Account({account}: {account: AccountOut | undefined}) {
  return <><span className="dot sm" style={dotStyle(account?.colour)} /><span className="label">{account?.label}</span></>;
}

function Row(props: RowProps) {
  const {row, accounts, now, timeZone, pinnedShelf, noise} = props;
  const line = rowLine(row);
  const unpin = (event: MouseEvent) => {
    event.stopPropagation();
    props.onUnpin(row.id);
  };
  return (
    <div className={`${rowClasses('row', props)}${pinnedShelf ? ' shelf' : ''}${noise ? ' noise' : ''}`} title={line.title ?? undefined} {...rowAttributes(props)}>
      <Gutter beat={props.beat} />
      <span className="from">{line.from}</span>
      {line.code ? <CodeLine code={line.code} /> : (
        <span className="subj"><b>{line.subject}</b>{line.summary && <>{' '}<span className="sum">· {line.summary}</span></>}</span>
      )}
      {!pinnedShelf && <PinMark pinned={row.pinned} />}
      <span className="ac"><Account account={accounts.get(row.account_id)} /></span>
      <span className="age" title={fullTimestamp(row.received_at, timeZone)}>{age(row.received_at, now, timeZone)}</span>
      {/* On the Pinned shelf, Unpin takes the age's place under the pointer (board 10). */}
      {pinnedShelf && <span className="hact"><button className="unpin" type="button" onClick={unpin}><Icon name="keep_off" size={15} />Unpin</button></span>}
    </div>
  );
}

/** A code row: the code in two groups of three, Copy (the code without its space), and its countdown. */
function CodeLine({code}: {code: {value: string; expires_at: string}}) {
  const countdown = useCountdown(code.expires_at);
  return (
    <span className="subj code-line">
      <span className="code">{codeGroups(code.value)}</span>
      <CodeCopy value={code.value} />
      <span className={countdown.soon ? 'sum soon' : 'sum'}>{countdown.text}</span>
    </span>
  );
}

/** The pattern prompt: one card line at the end of Attention (board 09), never for protected mail. */
function Prompt({prompt, onAnswer, leaving, fold}: {prompt: PatternPrompt; onAnswer: (prompt: PatternPrompt, yes: boolean) => void; leaving: boolean; fold: FoldRef}) {
  return (
    <div className={leaving ? 'prompt leaving' : 'prompt'} ref={fold} data-prompt={leaving ? undefined : prompt.id} aria-hidden={leaving || undefined}>
      <span className="prompt-icon"><Icon name="low_priority" size={20} /></span>
      <span className="grow">{promptText(prompt)}</span>
      <button className="btn sm" type="button" onClick={() => onAnswer(prompt, true)}>Yes</button>
      <button className="btn ghost sm" type="button" onClick={() => onAnswer(prompt, false)}>No</button>
    </div>
  );
}

function AttentionRow(props: RowProps) {
  const {row, accounts, now, timeZone} = props;
  return (
    <div className={`${rowClasses('arow', props)} att`} {...rowAttributes(props)}>
      <Gutter beat={props.beat} />
      <div className="l1">
        <span className="from">{sender(row)}</span>
        {row.via && <span className="via">via {row.via}</span>}
        {row.protected && <span className="tag alert"><Icon name="shield" size={14} />Protected</span>}
      </div>
      <div className="r1">
        <PinMark pinned={row.pinned} />
        <Account account={accounts.get(row.account_id)} />
        <span className="age" title={fullTimestamp(row.received_at, timeZone)}>{age(row.received_at, now, timeZone)}</span>
      </div>
      <div className="l2">{row.subject}</div>
      {row.summary && <div className="l3">{row.summary}</div>}
    </div>
  );
}
