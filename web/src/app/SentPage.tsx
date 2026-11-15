// Sent: the mail the user sent, newest first under day headings as All draws it, each row reading
// "To Sam Ortiz" where a received row names its sender. Mail to yourself is here too.
//
// The header's segmented control holds All, then each account with its colour and label. The choice
// rides in the address (/sent?account=2). Tab and Shift-Tab step All and the accounts with sent mail;
// an account with none reads quieter, and a click on it still opens it, to an empty view. The Inbox
// has no account filter: here the account is the address the user chose to write from.
//
// The reader opens a sent email as any other. Its tools are Trash, Open in Gmail, Reply R and Reply
// all A, and C writes a new message from the selected account. A received email
// of its conversation opens in the Inbox. J and K move the
// cursor (with an email open, they open the next and previous one), Enter opens, E Trash (with Undo in
// the toast, and ⌘Z), O Open in Gmail, Esc closes the reader, then the search.
//
// Search: the header's field searches sent mail only, in the selected account when one is. Its words
// stay words, with no suggestions.
import type {ItemKind, MessageRowOut, MessageOut, SentOut, SentRowOut} from '@setpoint/shared';
import {useEffect, useLayoutEffect, useMemo, useState} from 'react';
import type {MouseEvent as ReactMouseEvent} from 'react';
import {timeZone} from '../api/auth.ts';
import {getCached, getJson, prefetch, useResource, useResources} from '../api/client.ts';
import {messagePath, openMessage, sentPath, trashMessage, untrashMessage} from '../api/mail.ts';
import type {SearchScope} from '../api/search.ts';
import {dayStops} from '../logic/all.ts';
import type {DayView} from '../logic/all.ts';
import {keepCursor, moveCursor, neighbour, nextAfterLeaving, searchStops, stopOf} from '../logic/inbox.ts';
import type {Stop} from '../logic/inbox.ts';
import type {Route} from '../logic/route.ts';
import {leftOutSection, resultSections} from '../logic/search.ts';
import {tabTitle} from '../logic/title.ts';
import {skeleton} from '../tokens.ts';
import {echoKey, isTyping, plainKey} from '../ui/keys.ts';
import {dotStyle, useAccountColumn, useAccounts} from './accounts.ts';
import {AllList} from './AllList.tsx';
import {useNow} from './clock.ts';
import {openContextMenu} from './ContextMenu.tsx';
import {emailActions} from './emailActions.ts';
import {SentEmptyView} from './EmptyView.tsx';
import {beats} from './fold.ts';
import {askCard, Reader} from './Reader.tsx';
import {answerKey, closeComposer, newMessage, openComposer, useOpenComposer} from './compose/composer.ts';
import {NewMessagePane} from './compose/Composer.tsx';
import type {ReaderActions, Travel} from './Reader.tsx';
import {navigate} from './router.ts';
import {SearchField, SearchResults} from './search/Search.tsx';
import {useSearch} from './search/mailSearch.ts';
import {ALL_ACCOUNTS, SentAccounts} from './SentAccounts.tsx';
import {SentFrom} from './SentFrom.tsx';
import {LoadFailed, useAfter, useArrival, useLoadFailed} from './states/Loading.tsx';
import {AllSkeleton, SearchSkeleton} from './states/Skeletons.tsx';
import {dismissToast, showToast, toastFailure} from './toast.ts';

type SentRoute = Extract<Route, {page: 'sent'}>;

const ALL = ALL_ACCOUNTS;

// The email last opened, so the address following an open doesn't open it twice.
let lastOpened: number | null = null;
// ⌘Z: what undoes each Trash made here, newest last. The toast's Undo runs the same one.
const undos: (() => void)[] = [];

/**
 * A sent email's row as Sent draws it: read, in no lane, with its subject. Mail to yourself keeps
 * its Inbox life (lane, Done, a summary in the subject's place) in the Inbox.
 */
const asSent = (row: SentRowOut): MessageRowOut => ({
  ...row, lane: null, kind: null, unread: false, done: false, pinned: false, protected: false, summary: null, fact: null, code: null, trash_due_at: null,
});

/** The pages' days as the list draws them: one run of rows a day, a day split across two pages joined. */
function sentDays(pages: (SentOut | undefined)[], gone: ReadonlySet<number>): DayView[] {
  const days: DayView[] = [];
  for (const day of pages.flatMap(page => page?.days ?? [])) {
    const rows = day.rows.filter(row => !gone.has(row.id)).map(row => ({row: asSent(row), kind: null}));
    if (!rows.length) continue;
    const last = days.at(-1);
    if (last?.date === day.date) last.lanes[0]!.rows.push(...rows);
    else days.push({date: day.date, lanes: [{lane: 'unsorted', label: '', rows}], noise: null});
  }
  return days;
}

export function SentPage({route}: {route: SentRoute}) {
  const now = useNow();
  const zone = timeZone();
  const {list: accountList, byId: accounts} = useAccounts();
  const accountWidth = useAccountColumn(accountList);
  // An address naming no mail account goes to All, once the accounts are in.
  const unknownAccount = route.account !== undefined && accountList.length > 0 && !accounts.has(route.account);
  const account = route.account && !unknownAccount ? route.account : null;
  useEffect(() => {
    if (unknownAccount) navigate({page: 'sent', open: route.open}, {replace: true});
  }, [unknownAccount, route.open]);

  // The pages for this account: the first, then one more each time the list nears its end. Another
  // account starts again at its top.
  const [paging, setPaging] = useState<{account: number | null; befores: string[]}>({account, befores: []});
  if (paging.account !== account) setPaging({account, befores: []});
  const befores = paging.account === account ? paging.befores : [];
  const pages = useResources<SentOut>([sentPath(account), ...befores.map(before => sentPath(account, before))]);
  const {error: firstError} = useResource<SentOut>(sentPath(account));
  const loadMore = () => {
    const next = pages.at(-1)?.next_before;
    if (next && !befores.includes(next)) setPaging({account, befores: [...befores, next]});
  };

  // The accounts with sent mail, held from the last answer, so one on its way never reads as none.
  const answered = pages[0]?.accounts;
  const [withMail, setWithMail] = useState<ReadonlySet<number> | null>(null);
  const [answeredFrom, setAnsweredFrom] = useState<number[] | undefined>(undefined);
  if (answered && answered !== answeredFrom) {
    setAnsweredFrom(answered);
    setWithMail(new Set(answered));
  }

  // Emails Trash took out here, hidden at once. Undo, or a refused Trash, lets one back.
  const [trashing, setTrashing] = useState<ReadonlySet<number>>(new Set());
  const untrashing = (id: number) => setTrashing(ids => new Set([...ids].filter(one => one !== id)));
  const days = useMemo(() => sentDays(pages, trashing), [pages, trashing]);
  const sentRows = useMemo(() => new Map(pages.flatMap(page => page?.days.flatMap(day => day.rows) ?? []).map(row => [row.id, row])), [pages]);

  const scope = useMemo((): SearchScope => ({sent: 'only', ...(account ? {account_id: account} : {})}), [account]);
  const search = useSearch(true, scope);
  const searching = search.active;
  const firstWait = searching && search.out === null && search.error === null;
  const waitedLong = useAfter(firstWait, skeleton.delayMs);
  const sections = useMemo(() => ({...resultSections(search.results, search.out, search.mentions, trashing), leftOut: leftOutSection(search.results, search.out, search.leftOut, trashing)}),
    [search.results, search.out, search.mentions, search.leftOut, trashing]);

  const stops = useMemo((): Stop[] => (searching ? searchStops(sections) : dayStops(days)), [searching, sections, days]);
  // The cursor, kept with the stops it was set among, so when the list changes it lands on the stop
  // that took its place.
  const [track, setTrack] = useState<{stops: Stop[]; cursor: string | null}>({stops, cursor: null});
  let cursor = track.cursor;
  if (track.stops !== stops) {
    cursor = keepCursor(track.stops, stops, track.cursor);
    setTrack({stops, cursor});
  }
  const setCursor = (key: string | null) => setTrack(current => ({...current, cursor: key}));

  const open = route.open;
  const [travelled, setTravelled] = useState<{id: number; travel: Travel} | null>(null);
  // An email the address opens (a deep link, a reload, Back) is opened, as a click would.
  useEffect(() => {
    if (open === null || open === lastOpened) return;
    lastOpened = open;
    void openMessage(open).catch(toastFailure('Couldn\'t mark it read'));
  }, [open]);

  const go = (changes: Partial<SentRoute>) => navigate({...route, ...changes});

  /** Another account, from its segment or Tab: the open email gives way. */
  function pick(next: number) {
    if (next === (account ?? ALL)) return;
    setCursor(null);
    navigate({page: 'sent', open: null, ...(next === ALL ? {} : {account: next})});
  }

  function openEmail(id: number, key?: string, travel: Travel | null = null) {
    setTravelled(travel ? {id, travel} : null);
    const stop = (key ? stops.find(item => item.key === key) : null) ?? stopOf(stops, id);
    if (stop?.kind === 'row') setCursor(stop.key);
    lastOpened = id;
    if (searching) search.opened(id);
    go({open: id});
    void openMessage(id).catch(toastFailure('Couldn\'t mark it read'));
  }

  // From the reader: an email of its conversation the user didn't send is received mail, not
  // Sent's, so it opens in the Inbox with the Inbox's tools. The rest open here.
  const openFromReader = (id: number, sent?: boolean) => (sent === false ? navigate({page: 'inbox', open: id}) : openEmail(id));

  const close = () => go({open: null});
  const cursorStop = stops.find(stop => stop.key === cursor) ?? null;
  // What E acts on: the open email, else the row under the cursor.
  const target = open ?? (cursorStop?.kind === 'row' ? cursorStop.id : null);
  // A new message has the pane to itself while no email is open.
  const composer = useOpenComposer();
  const writing = open === null && composer?.messageId === null ? composer : null;
  const rowOf = (id: number): MessageRowOut | undefined => {
    const row = sentRows.get(id);
    return row ? asSent(row) : search.listed.find(result => result.id === id);
  };
  const subject = open !== null ? rowOf(open)?.subject ?? getCached<MessageOut>(messagePath(open))?.subject ?? null : null;
  useEffect(() => {
    document.title = tabTitle({page: 'sent', subject});
  }, [subject]);

  /**
   * Trash: the email leaves the list at once. On the open email the next one opens, or the reader
   * closes at the end. The toast's Undo, or ⌘Z later, puts it back, and an open email back in the reader.
   */
  function trash(id: number) {
    const wasOpen = open === id;
    beats.set(id, 'trash');
    setTrashing(ids => new Set([...ids, id]));
    if (wasOpen) {
      const next = nextAfterLeaving(stops, cursor, id);
      if (next !== null) openEmail(next, undefined, 'next');
      else close();
    }
    const sent = trashMessage(id).then(() => true, (error: unknown) => {
      beats.delete(id);
      untrashing(id);
      toastFailure('Couldn\'t move it to Trash')(error);
      return false;
    });
    let toastId = 0;
    const back = () => {
      const at = undos.indexOf(back);
      if (at < 0) return;
      undos.splice(at, 1);
      dismissToast(toastId);
      beats.delete(id);
      untrashing(id);
      void sent.then(took => (took ? untrashMessage(id).then(() => undefined) : undefined)).catch(toastFailure('Couldn\'t bring it back from Trash'));
      if (wasOpen) {
        lastOpened = id;
        navigate({...route, open: id});
      }
    };
    undos.push(back);
    toastId = showToast('Moved to Trash', {label: 'Undo', run: back});
  }

  // The email's Gmail link. The open one's is in. A row's comes with the email, asked for as its menu opened.
  function openInGmail(id: number) {
    const url = getCached<MessageOut>(messagePath(id))?.open_url;
    if (url) window.open(url, '_blank', 'noopener');
    else if (id !== open) {
      const tab = window.open('about:blank', '_blank');
      void getJson<MessageOut>(messagePath(id)).then(message => {
        if (!tab || !message.open_url) return tab?.close();
        tab.opener = null;
        tab.location.href = message.open_url;
      }, () => tab?.close());
    }
  }

  const nothing = () => {};
  const actions: ReaderActions = {
    done: nothing,
    pin: nothing,
    markUnread: nothing,
    codeCopied: nothing,
    trash: () => target !== null && trash(target),
    openInGmail: () => open !== null && openInGmail(open),
    step: (delta: 1 | -1) => {
      const next = open ? neighbour(stops, open, delta) : null;
      if (next !== null) openEmail(next, undefined, delta > 0 ? 'next' : 'prev');
    },
    close,
  };

  useLayoutEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event) || event.defaultPrevented) return;
      const run = (action: () => void, hint?: string) => {
        event.preventDefault();
        if (hint) echoKey(hint);
        action();
      };
      const move = (delta: 1 | -1) => run(() => {
        if (open !== null) {
          actions.step(delta);
          return;
        }
        const key = moveCursor(stops, cursor, delta);
        setCursor(key);
        if (key) requestAnimationFrame(() => document.querySelector(`[data-key="${key}"]`)?.scrollIntoView({block: 'nearest'}));
      });
      if (plainKey(event, 'j')) move(1);
      else if (plainKey(event, 'k')) move(-1);
      else if (plainKey(event, 'Enter')) {
        if (cursorStop?.kind === 'row') run(() => openEmail(cursorStop.id, cursorStop.key));
        else if (cursorStop?.kind === 'mentions') run(search.toggleMentions);
        else if (cursorStop?.kind === 'leftOut') run(search.toggleLeftOut);
      } else if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'z' && undos.length) run(undos.at(-1)!);
      else if (plainKey(event, 'e')) run(actions.trash, 'e');
      else if (plainKey(event, 'o')) run(actions.openInGmail, 'o');
      // R and A answer the open email, or the one under the cursor, which opens with its composer.
      else if ((plainKey(event, 'r') || plainKey(event, 'a')) && target !== null) {
        const kind = plainKey(event, 'r') ? 'reply' : 'reply_all';
        run(() => answerOn(target, cursorStop?.kind === 'row' && cursorStop.id === target ? cursorStop.key : undefined, kind), kind === 'reply' ? 'r' : 'a');
      } else if (plainKey(event, 'c')) run(() => newMessage(account ?? undefined));
      else if (plainKey(event, 'Escape')) {
        if (open !== null && openComposer()?.messageId === open) run(closeComposer);
        else if (writing) run(closeComposer);
        else if (open !== null) run(close);
        else if (searching) run(() => search.clear());
        else if (cursor !== null) run(() => setCursor(null));
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  /** Reply or Reply all on an email: it opens (if it isn't) with the composer under it. */
  function answerOn(id: number, key: string | null | undefined, kind: 'reply' | 'reply_all') {
    if (id !== open) openEmail(id, key ?? undefined);
    answerKey(id, kind);
  }

  /** A right-click on a row opens its actions: Open, Trash, Open in Gmail, Reply and the make actions. */
  function onContextMenu(event: ReactMouseEvent) {
    const element = (event.target as Element).closest<HTMLElement>('.list [data-key][data-id]');
    const id = element ? Number(element.dataset.id) : NaN;
    const row = rowOf(id);
    if (!element || !row) return;
    const key = element.dataset.key ?? null;
    const gmail = accounts.get(row.account_id)?.provider;
    const withCard = (card: ItemKind | 'ask') => {
      askCard(id, card);
      if (id !== open) openEmail(id, key ?? undefined);
    };
    const offered = emailActions(row, gmail === undefined ? null : gmail === 'gmail', {
      open: () => openEmail(id, key ?? undefined),
      trash: () => trash(id),
      openInGmail: () => openInGmail(id),
      done: nothing, pin: nothing, markUnread: nothing,
      // Add to calendar, Add as task and Ask open the email with their card.
      propose: card => withCard(card),
      ask: () => withCard('ask'),
      reply: () => answerOn(id, key, 'reply'),
    }, 'menu', undefined, true);
    if (!openContextMenu(event, element, offered)) return;
    if (key && stops.some(stop => stop.key === key)) setCursor(key);
    if (gmail === 'gmail' && id !== open) prefetch(messagePath(id));
  }

  const firstLoad = {path: sentPath(account), data: pages[0], error: firstError};
  const failed = useLoadFailed([firstLoad]);
  const ready = pages[0] !== undefined;
  const arrived = useArrival(ready, account);
  const more = pages.length > 1 && pages.at(-1) === undefined;
  const shownAccount = account ? accounts.get(account) ?? null : null;
  const empty = ready && !days.length && !more && !pages.at(-1)?.next_before;
  const from = (row: MessageRowOut) => {
    const sent = sentRows.get(row.id);
    return <SentFrom to={sent?.to} cc={sent?.cc} />;
  };

  return (
    <>
      <header className="hd">
        <h1 className="hd-title">{searching ? 'Search' : 'Sent'}</h1>
        {!searching && accountList.length > 0 && (
          <SentAccounts accounts={accountList} withMail={withMail} value={account ?? ALL} onPick={pick} />
        )}
        <span className="grow" />
        <SearchField search={search} label={shownAccount ? `Search sent from ${shownAccount.label}` : 'Search sent mail'} onEnter={first => setCursor(`all:${first.id}`)} />
      </header>
      <div className="content" style={accountWidth} onContextMenu={onContextMenu}>
        {firstWait && waitedLong ? (
          <section className="list" aria-label="Search results"><SearchSkeleton immediate /></section>
        ) : searching && !firstWait ? (
          <SearchResults search={search} sections={sections} cursor={cursor} openId={open} accounts={accounts} now={now} timeZone={zone} card={null}
            onPoint={key => key !== cursor && setCursor(key)} onOpen={(id, key) => openEmail(id, key)} />
        ) : (
          <AllList key={account ?? ALL} label="Sent" attention={[]} shelf={[]} days={days} lanes={false} from={from} slot={false}
            empty={empty ? <SentEmptyView account={shownAccount} style={dotStyle(shownAccount?.colour)} onAll={() => pick(ALL)} /> : null}
            cursor={cursor} openId={open} accounts={accounts} now={now} timeZone={zone} arrived={arrived} more={more} dimmed={firstWait}
            loading={!ready ? (failed ? <LoadFailed what="Sent" loads={[firstLoad]} /> : <AllSkeleton />) : null}
            onPoint={key => key !== cursor && setCursor(key)} onOpen={(id, key) => openEmail(id, key)} onToggleNoise={nothing} onNearEnd={loadMore} onUnpin={nothing} />
        )}
        {writing && <NewMessagePane open={writing} accounts={accounts} timeZone={zone} />}
        {open !== null && (
          <Reader id={open} travel={travelled?.id === open ? travelled.travel : null} row={rowOf(open)} accounts={accounts} now={now} timeZone={zone} actions={actions} onOpen={openFromReader}
            sent canStep={{previous: neighbour(stops, open, -1) !== null, next: neighbour(stops, open, 1) !== null}} />
        )}
      </div>
    </>
  );
}
