// Drafts: the mail the user is writing, kept in Setpoint until it's sent, newest change first, with
// no account control. Each row names who it goes to, its subject and first words, its account and
// its age. A draft whose send the provider refused says so in `alert`, one being sent says Sending.
//
// A row opens its draft in the pane (/drafts/4): a reply's or a forward's under its email, which
// stays readable above it, a new message's by itself. J and K move the cursor, Enter opens, C writes a
// new message, Esc closes the composer (the draft kept), then the pane.
//
// In a narrow window an open draft covers the list, and the empty pane comes over it only from the
// header's button, as on the Inbox (EmptyPane.tsx).
//
// A row's right-click has Open (docked, as a click), Pop out (a window, the page as it was) and
// Discard with Undo; a draft being sent has no Discard. ⌘ or Ctrl-click and ⇧-click select drafts, as
// on the Inbox: the first takes the open draft too, its composer closing (the draft kept), and the
// pane shows the selection (SelectionPane) with Open ↵, which opens each in a window, and Discard
// for the ones that can go, under one toast with Undo. A draft up in a window stays up. A selected
// row's right-click has the same, Esc ends the selection, and a plain click opens the one clicked.
import type {DraftRowOut, DraftsOut} from '@setpoint/shared';
import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {CSSProperties, MouseEvent as ReactMouseEvent} from 'react';
import {timeZone} from '../../api/auth.ts';
import {useResource} from '../../api/client.ts';
import {DRAFTS_PATH} from '../../api/drafts.ts';
import {chipLabel} from '../../logic/composer.ts';
import {age, fullTimestamp} from '../../logic/format.ts';
import type {Stop} from '../../logic/inbox.ts';
import type {Route} from '../../logic/route.ts';
import {counted, discardable, draftOffers, inListOrder, NO_SELECTION, ranged, toggled} from '../../logic/selection.ts';
import type {Selection} from '../../logic/selection.ts';
import {tabTitle} from '../../logic/title.ts';
import {Icon} from '../../ui/Icon.tsx';
import {echoKey, isTyping, keepTextUnselected, plainKey} from '../../ui/keys.ts';
import {dotStyle, useAccountColumn, useAccounts} from '../accounts.ts';
import {useNow} from '../clock.ts';
import {openContextMenu} from '../ContextMenu.tsx';
import type {MenuAction} from '../ContextMenu.tsx';
import {EmptyPane, EmptyPaneButton, useEmptyPane} from '../EmptyPane.tsx';
import {DraftsEmptyView} from '../EmptyView.tsx';
import {useCompact} from '../Phone.tsx';
import {EmailOnly, PaneEdge} from '../Reader.tsx';
import {useReadingPaneWidth} from '../readingPane.ts';
import {navigate} from '../router.ts';
import {SelectionPane} from '../SelectionPane.tsx';
import {LoadFailed, useLoadFailed} from '../states/Loading.tsx';
import {AllSkeleton} from '../states/Skeletons.tsx';
import {ComposerPlace} from './Composer.tsx';
import {closeComposer, discardDrafts, newMessage, openDraft, popOutDrafts, useOpenComposer} from './composer.ts';
import type {OpenComposer} from './composer.ts';

type DraftsRoute = Extract<Route, {page: 'drafts'}>;

const KEYS = [
  {keys: ['J', 'K'], does: 'Move'},
  {keys: ['Enter'], does: 'Open'},
  {keys: ['C'], does: 'New message'},
];

/** "To Sam Lee +2", or that it has no one yet. */
function toLine(row: DraftRowOut): string {
  const [first, ...rest] = row.to;
  if (!first) return 'No recipients';
  return `To ${chipLabel(first)}${rest.length ? ` +${rest.length}` : ''}`;
}

const subjectOf = (row: DraftRowOut) => row.subject.trim() || 'No subject';

export function DraftsPage({route}: {route: DraftsRoute}) {
  const now = useNow();
  const zone = timeZone();
  const {list: accountList, byId: accounts} = useAccounts();
  const accountWidth = useAccountColumn(accountList);
  const compact = useCompact();
  const load = {path: DRAFTS_PATH, ...useResource<DraftsOut>(DRAFTS_PATH)};
  const listed = load.data?.drafts;
  // Drafts Discard took out here, hidden at once until the list no longer has them. A refused
  // Discard lets one back.
  const [going, setGoing] = useState<ReadonlySet<number>>(new Set());
  const [goingFrom, setGoingFrom] = useState(listed);
  if (listed !== goingFrom) {
    setGoingFrom(listed);
    const ids = new Set(listed?.map(row => row.id));
    if ([...going].some(id => !ids.has(id))) setGoing(new Set([...going].filter(id => ids.has(id))));
  }
  const rows = useMemo(() => (listed ?? []).filter(row => !going.has(row.id)), [listed, going]);
  const stops = useMemo(() => rows.map((row): Stop => ({key: `draft:${row.id}`, kind: 'row', group: 'all', id: row.id})), [rows]);
  const failed = useLoadFailed([load]);
  const composer = useOpenComposer();
  const [cursor, setCursor] = useState<number | null>(null);
  const shown = route.open;
  // The drafts ⌘ or Ctrl-click and ⇧-click selected: those still listed, in the list's order.
  const [selection, setSelection] = useState<Selection>(NO_SELECTION);
  const selected = useMemo(() => inListOrder(selection.ids, stops), [selection.ids, stops]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedRows = selected.flatMap(id => rows.find(row => row.id === id) ?? []);
  const clearSelection = () => setSelection(NO_SELECTION);

  // The address names the open draft: it opens in the pane. The composer closing (Esc, Send,
  // Discard) empties the pane, and one opening here (C, Undo) takes the address.
  useEffect(() => {
    if (shown !== null) openDraft(shown);
  }, [shown]);
  const was = useRef<OpenComposer | null>(composer);
  useEffect(() => {
    const before = was.current;
    was.current = composer;
    // Windows aren't the pane's: popping it out empties the pane, and its row docks it again.
    if (composer && composer.draftId !== null && composer.draftId !== shown) navigate({page: 'drafts', open: composer.draftId}, {replace: true});
    else if (!composer && before && before.draftId === shown) navigate({page: 'drafts', open: null});
  }, [composer, shown]);

  const open = composer && composer.draftId !== null && composer.draftId === shown ? composer : null;
  // The pane beside the list: the open draft, else the selection. From 640 to 1099 px a pane covers
  // the list, so the selection shows only on its rows there.
  const showsSelection = open === null && selected.length > 0 && !compact;
  const pane = useEmptyPane(open !== null || showsSelection, []);
  const subject = open ? rows.find(row => row.id === open.draftId)?.subject ?? null : null;
  useEffect(() => {
    document.title = tabTitle({page: 'drafts', subject});
  }, [subject]);

  const at = cursor !== null && rows.some(row => row.id === cursor) ? cursor : null;
  const move = (delta: 1 | -1) => {
    const index = at === null ? (delta > 0 ? -1 : rows.length) : rows.findIndex(row => row.id === at);
    const next = rows[Math.min(rows.length - 1, Math.max(0, index + delta))];
    if (!next) return;
    setCursor(next.id);
    requestAnimationFrame(() => document.querySelector(`.drafts-list [data-id="${next.id}"]`)?.scrollIntoView({block: 'nearest'}));
  };

  /** A draft opens in the pane, as a click on its row does, and the selection ends. */
  function openRow(id: number) {
    clearSelection();
    navigate({page: 'drafts', open: id});
  }

  /**
   * A click on a row. With ⌘ or Ctrl it joins the selection or leaves it, the first one taking the
   * open draft too, whose composer closes (the draft kept). With ⇧ every draft from the last one
   * clicked to it joins. A plain click ends the selection and opens it.
   */
  function clickRow(id: number, event: ReactMouseEvent) {
    const adding = !event.altKey && (event.metaKey || event.ctrlKey);
    const ranging = !event.altKey && !adding && event.shiftKey;
    if (!adding && !ranging) {
      openRow(id);
      return;
    }
    const current = {ids: selected, anchor: selection.anchor};
    setSelection(adding ? toggled(current, id, shown) : ranged(current, stops, id, shown));
    setCursor(id);
    // The composer closing empties the pane and the address with it.
    if (open) closeComposer();
    else if (shown !== null) navigate({page: 'drafts', open: null});
  }

  /** Discard on rows: they leave the list at once, and the toast's Undo brings them back. */
  function discardRows(ids: number[]) {
    if (!ids.length) return;
    setGoing(now => new Set([...now, ...ids]));
    void discardDrafts(ids).then(refused => {
      if (refused.length) setGoing(now => new Set([...now].filter(id => !refused.includes(id))));
    });
  }

  // The selection's actions, for its pane, its right-click menu and its keys. Open and Discard end it.
  const offer = draftOffers(selectedRows);
  const discardLabel = offer.discard === selectedRows.length ? 'Discard' : `Discard ${offer.discard}`;
  const forSelection = {
    open: () => {
      popOutDrafts(selected);
      clearSelection();
    },
    discard: () => {
      discardRows(selectedRows.filter(discardable).map(row => row.id));
      clearSelection();
    },
    clear: clearSelection,
  };
  const selectionMenu: MenuAction[] = [
    {id: 'open', group: 'open', label: 'Open', icon: 'draft', hint: '↵', run: forSelection.open},
    ...(offer.discard ? [{id: 'discard', group: 'act', label: discardLabel, icon: 'delete', danger: true, run: forSelection.discard} satisfies MenuAction] : []),
    {id: 'clear', group: 'clear', label: 'Clear selection', icon: 'close', hint: 'Esc', run: forSelection.clear},
  ];
  // Whether the keys act on the selection: while no draft is open over it.
  const onSelection = open === null && selected.length > 0;

  /** A right-click on a row: Open, Pop out and Discard, or on a selected row the selection's. */
  function onContextMenu(event: ReactMouseEvent) {
    const element = (event.target as Element).closest<HTMLElement>('.drafts-list .row[data-id]');
    const row = element ? rows.find(one => one.id === Number(element.dataset.id)) : undefined;
    if (!element || !row) return;
    const offered: MenuAction[] = selected.includes(row.id) ? selectionMenu : [
      {id: 'open', group: 'open', label: 'Open', icon: 'draft', hint: '↵', run: () => openRow(row.id)},
      {id: 'pop-out', group: 'open', label: 'Pop out', icon: 'pip', run: () => popOutDrafts([row.id])},
      // A draft being sent can't be changed.
      ...(discardable(row) ? [{id: 'discard', group: 'act', label: 'Discard', icon: 'delete', danger: true, run: () => discardRows([row.id])} satisfies MenuAction] : []),
    ];
    if (openContextMenu(event, element, offered)) setCursor(row.id);
  }

  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event) || event.defaultPrevented) return;
      const run = (action: () => void, hint?: string) => {
        event.preventDefault();
        if (hint) echoKey(hint);
        action();
      };
      if (plainKey(event, 'j')) run(() => move(1));
      else if (plainKey(event, 'k')) run(() => move(-1));
      else if (plainKey(event, 'Enter') && onSelection) run(forSelection.open, 'enter');
      else if (plainKey(event, 'Enter') && at !== null) run(() => openRow(at));
      else if (plainKey(event, 'c')) run(() => newMessage());
      else if (plainKey(event, 'Escape')) {
        if (selected.length) run(clearSelection, 'escape');
        else if (open) run(closeComposer);
        else if (shown !== null) run(() => navigate({page: 'drafts', open: null}));
        else if (pane.shown) run(pane.close);
        else if (at !== null) run(() => setCursor(null));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  return (
    <>
      <header className="hd">
        <h1 className="hd-title">Drafts</h1>
        <span className="grow" />
        <EmptyPaneButton pane={pane} />
      </header>
      <div className="content" style={accountWidth} onContextMenu={onContextMenu}>
        <section className="list drafts-list" aria-label="Drafts">
          {!load.data ? (failed ? <LoadFailed what="Drafts" loads={[load]} /> : <AllSkeleton />) : rows.length === 0 ? (
            <DraftsEmptyView onNew={() => newMessage()} />
          ) : rows.map(row => {
            const account = accounts.get(row.account_id);
            const classes = ['row', at === row.id && 'cur', shown === row.id && 'open', selectedSet.has(row.id) && 'sel'].filter(Boolean).join(' ');
            return (
              <div key={row.id} className={classes} data-id={row.id} onMouseMove={() => at !== row.id && setCursor(row.id)} onMouseDown={keepTextUnselected} onClick={event => clickRow(row.id, event)}>
                <span className="ud" />
                <span className="from">{toLine(row)}</span>
                <span className="subj">
                  <b>{subjectOf(row)}</b>
                  {row.snippet && <>{' '}<span className="sum">· {row.snippet}</span></>}
                </span>
                {row.send_state === 'failed' && <span className="drafted">Couldn't send</span>}
                {(row.send_state === 'held' || row.send_state === 'sending') && <span className="ink3">Sending</span>}
                <span className="ac"><span className="dot sm" style={dotStyle(account?.colour)} /><span className="label">{account?.label}</span></span>
                <span className="age" data-tip={fullTimestamp(row.updated_at, zone)}>{age(row.updated_at, now, zone)}</span>
              </div>
            );
          })}
        </section>
        {open ? <DraftPane open={open} accounts={accounts} timeZone={zone} /> : showsSelection ? (
          <SelectionPane label="Selected drafts" heading={counted(selectedRows.length, '1 draft selected', n => `${n} drafts selected`)}
            tools={<>
              <button className="tool" type="button" data-hint="enter" onClick={forSelection.open}><Icon name="draft" />Open<span className="kbd">↵</span></button>
              {offer.discard > 0 && <button className="tool trash" type="button" onClick={forSelection.discard}><Icon name="delete" />{discardLabel}</button>}
            </>}
            lines={selectedRows.map(row => ({id: row.id, from: <span className="from">{toLine(row)}</span>, subject: subjectOf(row), name: subjectOf(row)}))}
            onClear={clearSelection} onOpen={openRow} onDrop={id => setSelection({...selection, ids: selected.filter(one => one !== id)})} />
        ) : pane.drawn && <EmptyPane label="Draft" keys={KEYS}>{null}</EmptyPane>}
      </div>
    </>
  );
}

/** The open draft: under its email for a reply or a forward, by itself for a new message. */
function DraftPane({open, accounts, timeZone}: {open: OpenComposer; accounts: ReturnType<typeof useAccounts>['byId']; timeZone: string}) {
  const width = useReadingPaneWidth();
  const now = useNow();
  return (
    <section className={open.messageId === null ? 'pane writing' : 'pane'} aria-label="Draft" style={{'--readingPane': `${width}px`} as CSSProperties}>
      <PaneEdge width={width} />
      {open.messageId !== null && <EmailOnly id={open.messageId} accounts={accounts} now={now} timeZone={timeZone} />}
      <ComposerPlace composerKey={open.key} />
    </section>
  );
}
