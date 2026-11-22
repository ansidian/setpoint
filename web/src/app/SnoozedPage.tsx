// Snoozed: the emails out of the Inbox until they return (GET /api/mail/snoozed), soonest first. Each
// row names its sender, its subject, its account and when it returns ("Mon 9:00 AM") after a small
// `snooze`. Under the pointer Unsnooze takes that time's place: the email goes back to the Inbox as it
// was, with Undo snoozing it again. A row opens its email in the reader (/snoozed/12), whose tools
// have Unsnooze in Snooze's place. J and K move the cursor (with an email open, they open the next and
// previous one), Enter opens, Esc closes the reader. The sidebar's row shows only while something is
// snoozed; the list emptied here says so.
import type {MessageRowOut, SnoozedOut} from '@setpoint/shared';
import {useEffect, useLayoutEffect, useMemo, useState} from 'react';
import type {MouseEvent as ReactMouseEvent} from 'react';
import {timeZone} from '../api/auth.ts';
import {getCached, useResource} from '../api/client.ts';
import {markUnread, messagePath, openMessage, setDone, setPinned, snooze, SNOOZED_PATH, trashMessage, unsnooze, untrashMessage} from '../api/mail.ts';
import type {MessageOut} from '@setpoint/shared';
import {fullTimestamp} from '../logic/format.ts';
import {rowLine} from '../logic/inbox.ts';
import type {Route} from '../logic/route.ts';
import {snoozedLine, snoozeWhen} from '../logic/snooze.ts';
import {tabTitle} from '../logic/title.ts';
import {Icon} from '../ui/Icon.tsx';
import {isTyping, keepTextUnselected, plainKey} from '../ui/keys.ts';
import {dotStyle, useAccountColumn, useAccounts} from './accounts.ts';
import {useNow} from './clock.ts';
import {Gutter} from './AllList.tsx';
import {Reader} from './Reader.tsx';
import {navigate} from './router.ts';
import {LoadFailed, useLoadFailed} from './states/Loading.tsx';
import {AllSkeleton} from './states/Skeletons.tsx';
import {showToast, toastFailure} from './toast.ts';
import {toInbox} from './toInbox.ts';

type SnoozedRoute = Extract<Route, {page: 'snoozed'}>;

export function SnoozedPage({route}: {route: SnoozedRoute}) {
  const now = useNow();
  const zone = timeZone();
  const {list: accountList, byId: accounts} = useAccounts();
  const accountWidth = useAccountColumn(accountList);
  const load = {path: SNOOZED_PATH, ...useResource<SnoozedOut>(SNOOZED_PATH)};
  const failed = useLoadFailed([load]);
  // Emails Trash took out here, hidden at once until Undo or the list no longer has them.
  const [trashing, setTrashing] = useState<ReadonlySet<number>>(new Set());
  const rows = useMemo(() => (load.data?.rows ?? []).filter(row => !trashing.has(row.id)), [load.data, trashing]);
  const [cursor, setCursor] = useState<number | null>(null);
  const open = route.open;
  const at = cursor !== null && rows.some(row => row.id === cursor) ? cursor : null;
  const go = (id: number | null) => navigate({page: 'snoozed', open: id});
  const neighbour = (id: number, delta: 1 | -1) => {
    const index = rows.findIndex(row => row.id === id);
    return index < 0 ? null : rows[index + delta]?.id ?? null;
  };
  const listed = (id: number): MessageRowOut | undefined => rows.find(row => row.id === id) ?? getCached<MessageOut>(messagePath(id));

  useEffect(() => {
    if (open !== null) void openMessage(open).catch(toastFailure('Failed to mark read'));
  }, [open]);
  const subject = open !== null ? listed(open)?.subject ?? null : null;
  useEffect(() => {
    document.title = tabTitle({page: 'snoozed', subject});
  }, [subject]);

  /** Unsnooze: back to the Inbox as it was, with Undo snoozing it again until the same time. Off the open email, the next one opens. */
  function unsnoozeRow(id: number) {
    const until = listed(id)?.snoozed_until;
    if (open === id) go(neighbour(id, 1) ?? neighbour(id, -1));
    void unsnooze(id).then(() => {
      if (until) showToast('Back in the Inbox', {label: 'Undo', run: () => void snooze(id, Date.parse(until)).catch(toastFailure('Failed to snooze'))});
    }, toastFailure('Failed to unsnooze'));
  }

  function trashRow(id: number) {
    if (open === id) go(neighbour(id, 1) ?? neighbour(id, -1));
    setTrashing(ids => new Set(ids).add(id));
    const back = () => setTrashing(ids => new Set([...ids].filter(one => one !== id)));
    void trashMessage(id).then(() => showToast('Moved to Trash', {label: 'Undo', run: () => {
      back();
      void untrashMessage(id).catch(toastFailure('Failed to bring back'));
    }}), error => {
      back();
      toastFailure('Failed to move to Trash')(error);
    });
  }

  const step = (delta: 1 | -1) => {
    if (open !== null) {
      const next = neighbour(open, delta);
      if (next !== null) go(next);
      return;
    }
    const index = at === null ? (delta > 0 ? -1 : rows.length) : rows.findIndex(row => row.id === at);
    const next = rows[Math.min(rows.length - 1, Math.max(0, index + delta))];
    if (next) setCursor(next.id);
  };

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
        if (open !== null) run(() => go(null));
        else if (at !== null) run(() => setCursor(null));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const openRow = listed(open ?? -1);
  return (
    <>
      <header className="hd">
        <h1 className="hd-title">Snoozed</h1>
        <span className="grow" />
      </header>
      <div className="content" style={accountWidth}>
        <section className="list snoozed-list" aria-label="Snoozed">
          {!load.data ? (failed ? <LoadFailed what="Snoozed" loads={[load]} /> : <AllSkeleton />) : rows.length === 0 ? (
            <div className="view-empty">
              <div className="ve-block">
                <p className="ve-head">Nothing snoozed</p>
                <button className="btn ghost sm" type="button" onClick={() => navigate(toInbox())}>Go to the Inbox</button>
              </div>
            </div>
          ) : rows.map(row => {
            const account = accounts.get(row.account_id);
            const line = rowLine(row);
            const until = row.snoozed_until!;
            const classes = ['row', row.unread && 'unread', at === row.id && 'cur', open === row.id && 'open'].filter(Boolean).join(' ');
            const unsnoozeClick = (event: ReactMouseEvent) => {
              event.stopPropagation();
              unsnoozeRow(row.id);
            };
            return (
              <div key={row.id} className={classes} data-id={row.id} onMouseMove={() => at !== row.id && setCursor(row.id)} onMouseDown={keepTextUnselected} onClick={() => go(row.id)}>
                <Gutter beat={null} />
                <span className="from">{line.from}</span>
                <span className="subj">
                  <b data-tip={line.title ?? undefined}>{line.subject}</b>
                  {line.summary && <>{' '}<span className="sum">· {line.summary}</span></>}
                </span>
                <span className="ac"><span className="dot sm" style={dotStyle(account?.colour)} /><span className="label">{account?.label}</span></span>
                <span className="age back num" data-tip={`${snoozedLine(until, now, zone)} · came ${fullTimestamp(row.received_at, zone)}`}><Icon name="snooze" size={14} />{snoozeWhen(until, now, zone)}</span>
                <span className="hact"><button className="unpin" type="button" onClick={unsnoozeClick}><Icon name="snooze" size={15} />Unsnooze</button></span>
              </div>
            );
          })}
        </section>
        {open !== null && (
          <Reader id={open} row={openRow} accounts={accounts} now={now} timeZone={zone}
            canStep={{previous: neighbour(open, -1) !== null, next: neighbour(open, 1) !== null}} onOpen={id => go(id)}
            actions={{
              done: () => void setDone(open).catch(toastFailure('Failed to mark Done')),
              trash: () => trashRow(open),
              pin: () => void setPinned(open, !openRow?.pinned).catch(toastFailure(openRow?.pinned ? 'Failed to unpin' : 'Failed to pin')),
              unsnooze: () => unsnoozeRow(open),
              openInGmail: () => {
                const url = getCached<MessageOut>(messagePath(open))?.open_url;
                if (url) window.open(url, '_blank', 'noopener');
              },
              step: delta => step(delta),
              close: () => go(null),
              markUnread: () => {
                go(null);
                void markUnread(open).catch(toastFailure('Failed to mark unread'));
              },
              codeCopied: () => {},
            }} />
        )}
      </div>
    </>
  );
}
