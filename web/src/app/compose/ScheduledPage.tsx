// Scheduled: the emails Send later holds until their moment, soonest first, out of Drafts until then.
// Each row names who it goes to, its subject and first words, its account and when it sends ("Mon
// 9:00 AM") in `caution`, after a small `schedule`. Send later opens it here. A row
// opens the email to read (/scheduled/4), not to edit: its head, "Send scheduled for Mon 9:00 AM",
// and its body, with Cancel send in its tools. Cancel send takes it off the schedule and opens it in
// Drafts' pane to edit. A row's right-click has Open and Cancel send. J and K move the cursor (with
// an email open, they open the next and previous one), Enter opens, Esc closes the email. The
// sidebar's row shows only while something is scheduled; the list emptied here says so.
import type {DraftRowOut, DraftsOut} from '@setpoint/shared';
import {useEffect, useLayoutEffect, useMemo, useState} from 'react';
import {useKept, useKeptScroll} from '../keptPlace.ts';
import type {CSSProperties, MouseEvent as ReactMouseEvent} from 'react';
import {timeZone} from '../../api/auth.ts';
import {useResource} from '../../api/client.ts';
import {DRAFTS_PATH} from '../../api/drafts.ts';
import {fullTimestamp} from '../../logic/format.ts';
import type {Route} from '../../logic/route.ts';
import {scheduledAt} from '../../logic/selection.ts';
import {scheduledWhen, snoozeWhen} from '../../logic/snooze.ts';
import {tabTitle} from '../../logic/title.ts';
import {Icon} from '../../ui/Icon.tsx';
import {isTyping, keepTextUnselected, plainKey} from '../../ui/keys.ts';
import {dotStyle, useAccountColumn, useAccounts} from '../accounts.ts';
import {useNow} from '../clock.ts';
import {openContextMenu} from '../ContextMenu.tsx';
import type {MenuAction} from '../ContextMenu.tsx';
import {PaneEdge} from '../Reader.tsx';
import {useReadingPaneWidth} from '../readingPane.ts';
import {navigate} from '../router.ts';
import {LoadFailed, useLoadFailed} from '../states/Loading.tsx';
import {AllSkeleton} from '../states/Skeletons.tsx';
import {cancelScheduled} from './composer.ts';
import {DraftCard, subjectOf, toLine} from './DraftsPage.tsx';
import {ScrollThumb} from '../ScrollThumb.tsx';

type ScheduledRoute = Extract<Route, {page: 'scheduled'}>;

export function ScheduledPage({route}: {route: ScheduledRoute}) {
  const now = useNow();
  const zone = timeZone();
  const {list: accountList, byId: accounts} = useAccounts();
  const accountWidth = useAccountColumn(accountList);
  const load = {path: DRAFTS_PATH, ...useResource<DraftsOut>(DRAFTS_PATH)};
  const failed = useLoadFailed([load]);
  const listed = load.data?.drafts;
  // Those Cancel send took out here, hidden at once.
  const [going, setGoing] = useState<ReadonlySet<number>>(new Set());
  const rows = useMemo(() => (listed ?? [])
    .flatMap(row => {
      const at = scheduledAt(row, now);
      return at && !going.has(row.id) ? [{row, at}] : [];
    })
    .sort((a, b) => a.at.localeCompare(b.at) || a.row.id - b.row.id), [listed, going, now]);
  const [cursor, setCursor] = useKept<number | null>('cursor', null);
  useKeptScroll('list', () => document.querySelector<HTMLElement>('.scheduled-list'), listed !== undefined, 'id');
  const shown = route.open;
  const openOne = rows.find(one => one.row.id === shown);
  const go = (id: number | null) => navigate({page: 'scheduled', open: id});

  // An email that sent meanwhile, or that came off the schedule elsewhere, closes.
  useEffect(() => {
    if (shown !== null && load.data && !openOne) navigate({page: 'scheduled', open: null}, {replace: true});
  }, [shown, load.data, openOne]);
  useEffect(() => {
    document.title = tabTitle({page: 'scheduled', subject: openOne ? subjectOf(openOne.row) : null});
  }, [openOne]);

  const cancel = (id: number) => {
    setGoing(now => new Set([...now, id]));
    cancelScheduled(id, () => setGoing(now => new Set([...now].filter(one => one !== id))));
  };

  const at = cursor !== null && rows.some(one => one.row.id === cursor) ? cursor : null;
  const neighbour = (id: number, delta: 1 | -1) => rows[rows.findIndex(one => one.row.id === id) + delta]?.row.id ?? null;
  const step = (delta: 1 | -1) => {
    if (shown !== null) {
      const next = neighbour(shown, delta);
      if (next !== null) go(next);
      return;
    }
    const index = at === null ? (delta > 0 ? -1 : rows.length) : rows.findIndex(one => one.row.id === at);
    const next = rows[Math.min(rows.length - 1, Math.max(0, index + delta))];
    if (next) setCursor(next.row.id);
  };

  function onContextMenu(event: ReactMouseEvent) {
    const element = (event.target as Element).closest<HTMLElement>('.scheduled-list .row[data-id]');
    const id = Number(element?.dataset.id);
    if (!element || !rows.some(one => one.row.id === id)) return;
    const offered: MenuAction[] = [
      {id: 'open', group: 'open', label: 'Open', icon: 'draft', hint: '↵', run: () => go(id)},
      {id: 'cancel-send', group: 'act', label: 'Cancel send', icon: 'edit', run: () => cancel(id)},
    ];
    if (openContextMenu(event, element, offered)) setCursor(id);
  }

  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event) || event.defaultPrevented) return;
      const run = (action: () => void) => {
        event.preventDefault();
        action();
      };
      if (plainKey(event, 'j')) run(() => step(1));
      else if (plainKey(event, 'k')) run(() => step(-1));
      else if (plainKey(event, 'Enter') && at !== null) run(() => go(at));
      else if (plainKey(event, 'Escape')) {
        if (shown !== null) run(() => go(null));
        else if (at !== null) run(() => setCursor(null));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  return (
    <>
      <header data-theme="night" className="hd">
        <h1 className="hd-title">Scheduled</h1>
        <span className="grow" />
      </header>
      <div className="content" style={accountWidth}>
        <section className="list scheduled-list" aria-label="Scheduled" onContextMenu={onContextMenu}>
          <ScrollThumb />
          {!load.data ? (failed ? <LoadFailed what="Scheduled" loads={[load]} /> : <AllSkeleton />) : rows.length === 0 ? (
            <div className="view-empty">
              <div className="ve-block">
                <p className="ve-head">Nothing scheduled</p>
                <button className="btn ghost sm" type="button" onClick={() => navigate({page: 'drafts', open: null})}>Go to Drafts</button>
              </div>
            </div>
          ) : rows.map(({row, at: sendAt}) => {
            const account = accounts.get(row.account_id);
            const classes = ['row', at === row.id && 'cur', shown === row.id && 'open'].filter(Boolean).join(' ');
            return (
              <div key={row.id} className={classes} data-id={row.id} onMouseMove={() => at !== row.id && setCursor(row.id)} onMouseDown={keepTextUnselected} onClick={() => go(row.id)}>
                <span className="ud" />
                <span className="from">{toLine(row)}</span>
                <span className="subj">
                  <b>{subjectOf(row)}</b>
                  {row.snippet && <>{' '}<span className="sum">· {row.snippet}</span></>}
                </span>
                <span className="ac"><span className="dot sm" style={dotStyle(account?.colour)} /><span className="label">{account?.label}</span></span>
                <span className="age back num" data-tip={`Sends ${fullTimestamp(sendAt, zone)}`}><Icon name="schedule" size={14} />{snoozeWhen(sendAt, now, zone)}</span>
              </div>
            );
          })}
        </section>
        {openOne && <ScheduledPane row={openOne.row} sendAt={openOne.at} accounts={accounts} now={now} timeZone={zone} onCancel={() => cancel(openOne.row.id)} onClose={() => go(null)} />}
      </div>
    </>
  );
}

/** The open scheduled email, to read: its tools, its head, when it sends, and its body. */
function ScheduledPane({row, sendAt, accounts, now, timeZone, onCancel, onClose}: {
  row: DraftRowOut;
  sendAt: string;
  accounts: ReturnType<typeof useAccounts>['byId'];
  now: number;
  timeZone: string;
  onCancel: () => void;
  onClose: () => void;
}) {
  const width = useReadingPaneWidth();
  return (
    <section className="pane" aria-label="Scheduled email" style={{'--readingPane': `${width}px`} as CSSProperties}>
      <PaneEdge width={width} />
      <div className="rd-tools">
        {/* Only in the compact tier, where the pane covers the list. */}
        <button className="ibtn rd-back" type="button" aria-label="Back to the list" data-tip="Back · Esc" onClick={onClose}><Icon name="arrow_back" /></button>
        <button className="tool trash" type="button" onClick={onCancel}><Icon name="edit" /><span className="lbl">Cancel send</span></button>
      </div>
      <div className="rd-scroll">
        <DraftCard row={row} accounts={accounts} now={now} timeZone={timeZone} notice={(
          <div className="sch-notice num"><Icon name="schedule" size={16} />Send scheduled for {scheduledWhen(sendAt, now, timeZone)}</div>
        )} />
      </div>
    </section>
  );
}
