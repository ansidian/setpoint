// Snoozed: the emails out of the Inbox until they return (GET /api/mail/snoozed), soonest first. Each
// row names its sender, its subject, its account and when it returns ("Mon 9:00 AM") after a small
// `snooze`. Under the pointer Unsnooze takes that time's place: the email goes back to the Inbox as it
// was, with Undo snoozing it again. A row opens its email in the reader (/snoozed/12), whose tools
// have a snooze menu naming the return in Snooze's place: Tomorrow, Next weekday and Pick change the
// time, Unsnooze ends it. A snoozed email has no Pin, and Done ends its snooze for good. Done, Trash,
// Unsnooze and a new time each say so in a toast with Undo and ⌘Z, and Undo opens the email again
// where it was open. A row's right-click menu is the Inbox's, with Snooze's new times and Unsnooze in
// Pin's place. Keys: J and K move the cursor (with an email open, they open the next and previous
// one), Enter opens, Esc closes the reader, and H, E, O, R, A, F and ⇧U do what they do in the Inbox,
// on the open email or else the one under the cursor (A only with the email open, where the reader
// knows its recipients). The sidebar's row shows only while something is snoozed; the list emptied
// here says so.
import type {ItemKind, MessageRowOut, RuleOut, Settings, SnoozedOut} from '@setpoint/shared';
import {useEffect, useLayoutEffect, useMemo, useState} from 'react';
import type {MouseEvent as ReactMouseEvent} from 'react';
import {serverNow, timeZone} from '../api/auth.ts';
import {getCached, getJson, prefetch, useResource} from '../api/client.ts';
import {SETTINGS_PATH} from '../api/items.ts';
import {markRead, markUnread, messagePath, openMessage, setDone, snooze, SNOOZED_PATH, trashMessage, unsnooze, untrashMessage} from '../api/mail.ts';
import {RULES_PATH} from '../api/settings.ts';
import type {MessageOut} from '@setpoint/shared';
import {fullTimestamp} from '../logic/format.ts';
import {rowLine} from '../logic/inbox.ts';
import type {Route} from '../logic/route.ts';
import {readerActions} from '../logic/reader.ts';
import {snoozedLine, snoozeWhen} from '../logic/snooze.ts';
import {tabTitle} from '../logic/title.ts';
import {Icon} from '../ui/Icon.tsx';
import {echoKey, isTyping, keepTextUnselected, plainKey} from '../ui/keys.ts';
import {dotStyle, useAccountColumn, useAccounts} from './accounts.ts';
import {startComposer} from './compose/composer.ts';
import {openContextMenu} from './ContextMenu.tsx';
import {emailActions, snoozeItems} from './emailActions.ts';
import {useNow} from './clock.ts';
import {Gutter} from './AllList.tsx';
import {askCard, Reader} from './Reader.tsx';
import {navigate} from './router.ts';
import {LoadFailed, useLoadFailed} from './states/Loading.tsx';
import {AllSkeleton} from './states/Skeletons.tsx';
import {dismissToast, showToast, toastFailure} from './toast.ts';
import {toInbox} from './toInbox.ts';

type SnoozedRoute = Extract<Route, {page: 'snoozed'}>;

// The page's Undos, newest last, for ⌘Z: each takes its own toast with it.
const undos: (() => void)[] = [];

export function SnoozedPage({route}: {route: SnoozedRoute}) {
  const now = useNow();
  const zone = timeZone();
  const {list: accountList, byId: accounts} = useAccounts();
  const accountWidth = useAccountColumn(accountList);
  const load = {path: SNOOZED_PATH, ...useResource<SnoozedOut>(SNOOZED_PATH)};
  const failed = useLoadFailed([load]);
  // Emails Done, Trash or Unsnooze took out here, hidden at once until Undo or the list no longer has them.
  const [leaving, setLeaving] = useState<ReadonlySet<number>>(new Set());
  const rows = useMemo(() => (load.data?.rows ?? []).filter(row => !leaving.has(row.id)), [load.data, leaving]);
  const [cursor, setCursor] = useState<number | null>(null);
  const open = route.open;
  const at = cursor !== null && rows.some(row => row.id === cursor) ? cursor : null;
  const go = (id: number | null) => navigate({page: 'snoozed', open: id});
  const neighbour = (id: number, delta: 1 | -1) => {
    const index = rows.findIndex(row => row.id === id);
    return index < 0 ? null : rows[index + delta]?.id ?? null;
  };
  const listed = (id: number): MessageRowOut | undefined => rows.find(row => row.id === id) ?? getCached<MessageOut>(messagePath(id));
  const {data: settings} = useResource<Settings>(SETTINGS_PATH);
  const {data: rules} = useResource<RuleOut[]>(RULES_PATH);

  useEffect(() => {
    if (open !== null) void openMessage(open).catch(toastFailure('Failed to mark read'));
  }, [open]);
  const subject = open !== null ? listed(open)?.subject ?? null : null;
  useEffect(() => {
    document.title = tabTitle({page: 'snoozed', subject});
  }, [subject]);

  /** A change that may take the email out of the list, said in a toast with Undo and ⌘Z. Undo puts it back, and opens it again if it was open. */
  function act(id: number, {leaves, change, toast, undo, failed, undoFailed}: {
    leaves: boolean;
    change: () => Promise<unknown>;
    toast: string;
    undo: () => Promise<unknown>;
    failed: string;
    undoFailed: string;
  }) {
    const wasOpen = open === id;
    const show = () => setLeaving(ids => new Set([...ids].filter(one => one !== id)));
    if (leaves) {
      if (wasOpen) go(neighbour(id, 1) ?? neighbour(id, -1));
      setLeaving(ids => new Set(ids).add(id));
    }
    const sent = change().then(() => true, error => {
      show();
      toastFailure(failed)(error);
      return false;
    });
    let toastId = 0;
    const back = () => {
      const index = undos.indexOf(back);
      if (index < 0) return;
      undos.splice(index, 1);
      dismissToast(toastId);
      void sent.then(took => {
        if (!took) return;
        void undo().then(() => {
          show();
          if (wasOpen) go(id);
        }, toastFailure(undoFailed));
      });
    };
    undos.push(back);
    toastId = showToast(toast, {label: 'Undo', run: back, key: '⌘Z'});
  }

  /** Unsnooze: back to the Inbox as it was, with Undo snoozing it again until the same time. */
  function unsnoozeRow(id: number) {
    const until = listed(id)?.snoozed_until;
    if (!until) return;
    act(id, {leaves: true, change: () => unsnooze(id), toast: 'Back in the Inbox', undo: () => snooze(id, Date.parse(until)), failed: 'Failed to unsnooze', undoFailed: 'Failed to snooze'});
  }

  /** A new time: it stays here, in its new place, with Undo going back to the old one. */
  function resnooze(id: number, next: number) {
    const until = listed(id)?.snoozed_until;
    if (!until) return;
    act(id, {leaves: false, change: () => snooze(id, next), toast: snoozedLine(new Date(next).toISOString(), serverNow(), zone), undo: () => snooze(id, Date.parse(until)), failed: 'Failed to snooze', undoFailed: 'Failed to undo the snooze'});
  }

  /** Done ends the snooze for good, on Attention mail only. Undo takes Done back and snoozes it again. */
  function doneRow(id: number) {
    const row = listed(id);
    const until = row?.snoozed_until;
    if (!row || !until || !readerActions(row).done) return;
    act(id, {leaves: true, change: () => setDone(id), toast: 'Marked Done', undo: () => setDone(id, false).then(() => snooze(id, Date.parse(until))), failed: 'Failed to mark Done', undoFailed: 'Failed to undo Done'});
  }

  function trashRow(id: number) {
    act(id, {leaves: true, change: () => trashMessage(id), toast: 'Moved to Trash', undo: () => untrashMessage(id), failed: 'Failed to move to Trash', undoFailed: 'Failed to bring back'});
  }

  // ⇧U: unread again, and the reader closes so it stays so, as in the Inbox.
  function unreadRow(id: number) {
    if (open === id) go(null);
    void markUnread(id).catch(toastFailure('Failed to mark unread'));
  }

  // Open in Gmail: the email's own link, asked for now when it isn't in yet.
  function openInGmail(id: number) {
    const url = getCached<MessageOut>(messagePath(id))?.open_url;
    if (url) {
      window.open(url, '_blank', 'noopener');
      return;
    }
    const tab = window.open('about:blank', '_blank');
    void getJson<MessageOut>(messagePath(id)).then(message => {
      if (!tab || !message.open_url) return tab?.close();
      tab.opener = null;
      tab.location.href = message.open_url;
    }, () => tab?.close());
  }

  // Reply and Forward open the email with its composer under it.
  function answer(id: number, kind: 'reply' | 'reply_all' | 'forward') {
    if (open !== id) go(id);
    startComposer({kind, message_id: id});
  }

  function onContextMenu(event: ReactMouseEvent) {
    const element = (event.target as Element).closest<HTMLElement>('.snoozed-list [data-id]');
    const id = element ? Number(element.dataset.id) : NaN;
    const row = rows.find(one => one.id === id);
    if (!element || !row) return;
    const provider = accounts.get(row.account_id)?.provider;
    const withCard = (card: ItemKind | 'ask') => {
      askCard(id, card);
      if (open !== id) go(id);
    };
    const offered = emailActions(row, provider === undefined ? null : provider === 'gmail', {
      open: () => go(id),
      done: () => doneRow(id),
      trash: () => trashRow(id),
      pin: () => {},
      openInGmail: () => openInGmail(id),
      propose: withCard,
      ask: () => withCard('ask'),
      markRead: () => void markRead(id).catch(toastFailure('Failed to mark read')),
      markUnread: () => unreadRow(id),
      reply: () => answer(id, 'reply'),
      forward: () => answer(id, 'forward'),
      snoozeTimes: snoozeItems(serverNow(), settings?.reminders.task_time ?? null, zone, until => resnooze(id, until), () => unsnoozeRow(id)),
    }, 'menu', rules);
    if (!openContextMenu(event, element, offered)) return;
    setCursor(id);
    if (provider === 'gmail' && id !== open) prefetch(messagePath(id));
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
      // The open email's, or else the one under the cursor's.
      const target = open ?? at;
      const on = (hint: string, action: (id: number) => void) => target !== null && run(() => {
        echoKey(hint);
        action(target);
      });
      if (plainKey(event, 'j')) run(() => step(1));
      else if (plainKey(event, 'k')) run(() => step(-1));
      else if (plainKey(event, 'Enter') && at !== null) run(() => go(at));
      else if (plainKey(event, 'Escape')) {
        if (open !== null) run(() => go(null));
        else if (at !== null) run(() => setCursor(null));
      } else if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z' && undos.length) run(undos.at(-1)!);
      else if (plainKey(event, 'h')) on('h', doneRow);
      else if (plainKey(event, 'e')) on('e', trashRow);
      else if (plainKey(event, 'o')) on('o', openInGmail);
      else if (plainKey(event, 'r')) on('r', id => answer(id, 'reply'));
      else if (plainKey(event, 'f')) on('f', id => answer(id, 'forward'));
      // Reply all needs the email's recipients: the reader's button, shown only when there are others.
      else if (plainKey(event, 'a') && open !== null) {
        const button = document.querySelector<HTMLElement>('.rd-tools [data-hint="a"]');
        if (button?.checkVisibility()) run(() => button.click());
      } else if (plainKey(event, 'u', {shift: true})) on('shift+u', unreadRow);
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
        <section className="list snoozed-list" aria-label="Snoozed" onContextMenu={onContextMenu}>
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
              done: () => doneRow(open),
              trash: () => trashRow(open),
              // A snoozed email shows no Pin.
              pin: () => {},
              snooze: until => resnooze(open, until),
              unsnooze: () => unsnoozeRow(open),
              openInGmail: () => openInGmail(open),
              step: delta => step(delta),
              close: () => go(null),
              markUnread: () => unreadRow(open),
              codeCopied: () => {},
            }} />
        )}
      </div>
    </>
  );
}
