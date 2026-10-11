// The Inbox's list (DESIGN.md › The list): group headers, one-line rows, Attention's three-line
// rows and its pattern prompt, code rows with Copy, the Pinned shelf with Unpin under the pointer,
// the footer and All caught up. Kept thin: what shows comes from logic/inbox.ts, and every action is
// the page's (InboxPage.tsx). Rows fold out as they leave and in as they arrive (app/fold.ts). A
// group opened at the foot of the list scrolls its rows into view.
import type {AccountOut, MessageRowOut} from '@setpoint/shared';
import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {MouseEvent, Ref} from 'react';
import {age, codeGroups, expiresIn, fullTimestamp} from '../logic/format.ts';
import {GROUP_GLYPHS, groupKey, promptText, rowKey, rowLine, sender, showsPending} from '../logic/inbox.ts';
import type {GroupView, PatternPrompt} from '../logic/inbox.ts';
import type {Entry, Folded, FoldRules} from '../logic/fold.ts';
import {Icon} from '../ui/Icon.tsx';
import {dotStyle} from './accounts.ts';
import {foldIn, foldOut, useFold} from './fold.ts';
import {TriageNote, useHealthBars} from './states/States.tsx';
import {showToast} from './toast.ts';

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

export function MailList(props: ListProps) {
  const {views, caughtUp, prompt} = props;
  // All caught up keeps the Pinned shelf above the line (board 04).
  const entries = useMemo(() => parts(caughtUp ? views.filter(view => view.group === 'pinned') : views, prompt), [views, caughtUp, prompt]);
  // A collapsed group's rows just go and an expanded one's just show; every other row that leaves
  // (Done, Trash, Mark all as read, read elsewhere, Unpin) folds out, and one moved or brought back
  // (Pin, Undo) folds in.
  const rules: FoldRules<Part> = {
    folds: gone => gone.item.kind !== 'row' || !views.find(view => view.group === groupOf(gone.item))?.collapsed,
    arrives: (entry, was) => {
      const header = was(groupKey(groupOf(entry.item)))?.item;
      return !(header?.kind === 'header' && header.view.collapsed);
    },
  };
  const shown = useFold(entries, rules);
  // Under a health bar the first group keeps its top line (boards 17, 19a).
  const bars = useHealthBars();
  return (
    <>
      {bars}
      {shown.map((entry, index) => <Part key={entry.key} entry={entry} first={index === 0 && !bars} {...props} />)}
      {caughtUp ? (
        <div className="empty">
          <div className="empty-line">
            <Icon name="done_all" size={20} />
            <span>All caught up</span>
            <button className="btn ghost sm" type="button" onClick={props.onOpenAll}>Open All</button>
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
function Part({entry, first, ...props}: ListProps & {entry: Folded<Part>; first: boolean}) {
  const {item, fold} = entry;
  const ref = fold === 'out' ? foldOut : fold === 'in' ? foldIn : undefined;
  const leaving = fold === 'out';
  if (item.kind === 'header') {
    return <GroupHeader view={item.view} first={first} cur={!leaving && props.cursor === entry.key} leaving={leaving} fold={ref} onPoint={props.onPoint} onToggle={props.onToggle} />;
  }
  if (item.kind === 'prompt') return <Prompt prompt={item.prompt} onAnswer={props.onAnswer} leaving={leaving} fold={ref} />;
  const rowProps = {...props, row: item.row, rowKey: entry.key, leaving, fold: ref, ...(leaving ? {cursor: null, openId: null} : {})};
  return item.view.group === 'attention' ? <AttentionRow {...rowProps} /> : <Row {...rowProps} pinnedShelf={item.view.group === 'pinned'} noise={item.view.group === 'noise'} />;
}

/** Scrolls the list just enough to show a group's last row, never past its header (Decided while building #70). */
function revealGroup(header: HTMLElement | null) {
  const list = header?.closest<HTMLElement>('.list');
  if (!header || !list) return;
  let last: Element = header;
  for (let next = header.nextElementSibling; next && !next.classList.contains('gh'); next = next.nextElementSibling) last = next;
  const box = list.getBoundingClientRect();
  const below = last.getBoundingClientRect().bottom - box.bottom;
  if (below > 0) list.scrollBy({top: Math.min(below, header.getBoundingClientRect().top - box.top), behavior: 'smooth'});
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
  // Opened (not shown open from the start): its rows come into view, its header kept on screen.
  const wasCollapsed = useRef(view.collapsed);
  useLayoutEffect(() => {
    if (wasCollapsed.current && !view.collapsed) revealGroup(document.querySelector<HTMLElement>(`.list .gh[data-key="${groupKey(view.group)}"]`));
    wasCollapsed.current = view.collapsed;
  }, [view.collapsed, view.group]);
  const attributes = leaving ? {'aria-hidden': true} : {
    'data-key': groupKey(view.group), onClick: view.collapsible ? () => onToggle(view) : undefined, onMouseMove: view.collapsed ? () => onPoint(groupKey(view.group)) : undefined,
  };
  return (
    <div className={classes} ref={fold} {...attributes}>
      <span className="gi"><Icon name={GROUP_GLYPHS[view.group]} size={14} /></span>
      {view.label} <span className="n">{view.count}</span>
      {view.preview && <span className="preview">{view.preview}</span>}
      {view.group === 'unsorted' && <TriageNote />}
      {view.collapsible && <span className="chev"><Icon name={view.collapsed ? 'chevron_right' : 'expand_more'} /></span>}
    </div>
  );
}

interface RowProps extends ListProps {
  row: MessageRowOut;
  rowKey: string;
  pinnedShelf?: boolean;
  // A Noise row recedes (DESIGN.md #131).
  noise?: boolean;
  leaving: boolean;
  fold: FoldRef;
}

function rowClasses(base: string, {row, rowKey: key, cursor, openId, leaving}: RowProps): string {
  return [base, row.unread && 'unread', row.protected && base === 'arow' && 'protected', cursor === key && 'cur', openId === row.id && 'open',
    showsPending(row) && 'pending', leaving && 'leaving'].filter(Boolean).join(' ');
}

/** A row's own attributes: a leaving one has no key, no id and no handlers, and is hidden from the tree. */
function rowAttributes({row, rowKey: key, leaving, fold, onPoint, onOpen}: RowProps) {
  return leaving ? {ref: fold, 'aria-hidden': true} : {ref: fold, 'data-key': key, 'data-id': row.id, onMouseMove: () => onPoint(key), onClick: () => onOpen(row.id, key)};
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
      <span className="ud" />
      <span className="from">{line.from}</span>
      {line.code ? <CodeLine code={line.code} now={now} /> : (
        <span className="subj"><b>{line.subject}</b>{line.summary && <>{' '}<span className="sum">· {line.summary}</span></>}</span>
      )}
      <span className="ac"><Account account={accounts.get(row.account_id)} /></span>
      <span className="age" title={fullTimestamp(row.received_at, timeZone)}>{age(row.received_at, now, timeZone)}</span>
      {/* On the Pinned shelf, Unpin takes the age's place under the pointer (board 10). */}
      {pinnedShelf && <span className="hact"><button className="unpin" type="button" onClick={unpin}><Icon name="keep_off" size={15} />Unpin</button></span>}
    </div>
  );
}

const COPIED_MS = 1500;

/** A code row: the code in two groups of three, Copy (the code without its space), and its countdown. */
function CodeLine({code, now}: {code: {value: string; expires_at: string}; now: number}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);
  // A clipboard that refuses says so (#41).
  const copy = (event: MouseEvent) => {
    event.stopPropagation();
    const writing = navigator.clipboard ? navigator.clipboard.writeText(code.value) : Promise.reject(new Error('No clipboard'));
    writing.then(() => setCopied(true), () => showToast('Couldn\'t copy it'));
  };
  return (
    <span className="subj code-line">
      <span className="code">{codeGroups(code.value)}</span>
      <button className="btn ghost sm copy" type="button" onClick={copy}><Icon name={copied ? 'check' : 'content_copy'} size={14} />{copied ? 'Copied' : 'Copy'}</button>
      <span className="sum">{expiresIn(code.expires_at, now)}</span>
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
      <span className="ud" />
      <div className="l1">
        <span className="from">{sender(row)}</span>
        {row.via && <span className="via">via {row.via}</span>}
        {row.protected && <span className="tag alert"><Icon name="shield" size={14} />Protected</span>}
      </div>
      <div className="r1">
        <Account account={accounts.get(row.account_id)} />
        <span className="age" title={fullTimestamp(row.received_at, timeZone)}>{age(row.received_at, now, timeZone)}</span>
      </div>
      <div className="l2">{row.subject}</div>
      {row.summary && <div className="l3">{row.summary}</div>}
    </div>
  );
}
