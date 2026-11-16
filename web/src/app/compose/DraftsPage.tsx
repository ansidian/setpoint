// Drafts: the mail the user is writing, kept in Setpoint until it's sent, newest change first, with
// no account control. Each row names who it goes to, its subject and first words, its account and
// its age. A draft whose send the provider refused says so in `alert`, one being sent says Sending.
//
// A row opens its draft in the pane (/drafts/4): a reply's or a forward's under its email, which
// stays readable above it, a new message's by itself. J and K move the cursor, Enter opens, C writes a
// new message, Esc closes the composer (the draft kept), then the pane.
import type {DraftRowOut, DraftsOut} from '@setpoint/shared';
import {useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import type {CSSProperties} from 'react';
import {timeZone} from '../../api/auth.ts';
import {useResource} from '../../api/client.ts';
import {DRAFTS_PATH} from '../../api/drafts.ts';
import {chipLabel} from '../../logic/composer.ts';
import {age, fullTimestamp} from '../../logic/format.ts';
import type {Route} from '../../logic/route.ts';
import {tabTitle} from '../../logic/title.ts';
import {Icon} from '../../ui/Icon.tsx';
import {echoKey, isTyping, plainKey} from '../../ui/keys.ts';
import {dotStyle, useAccountColumn, useAccounts} from '../accounts.ts';
import {useNow} from '../clock.ts';
import {EmptyPane} from '../EmptyPane.tsx';
import {EmailOnly, PaneEdge} from '../Reader.tsx';
import {useReadingPaneWidth} from '../readingPane.ts';
import {navigate} from '../router.ts';
import {LoadFailed, useLoadFailed} from '../states/Loading.tsx';
import {AllSkeleton} from '../states/Skeletons.tsx';
import {ComposerPlace} from './Composer.tsx';
import {closeComposer, newMessage, openDraft, useOpenComposer} from './composer.ts';
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

export function DraftsPage({route}: {route: DraftsRoute}) {
  const now = useNow();
  const zone = timeZone();
  const {list: accountList, byId: accounts} = useAccounts();
  const accountWidth = useAccountColumn(accountList);
  const load = {path: DRAFTS_PATH, ...useResource<DraftsOut>(DRAFTS_PATH)};
  const rows = useMemo(() => load.data?.drafts ?? [], [load.data]);
  const failed = useLoadFailed([load]);
  const composer = useOpenComposer();
  const [cursor, setCursor] = useState<number | null>(null);
  const shown = route.open;

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
    if (composer && composer.draftId !== shown) navigate({page: 'drafts', open: composer.draftId}, {replace: true});
    else if (!composer && before && before.draftId === shown) navigate({page: 'drafts', open: null});
  }, [composer, shown]);

  const open = composer && composer.draftId === shown ? composer : null;
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
      else if (plainKey(event, 'Enter') && at !== null) run(() => navigate({page: 'drafts', open: at}));
      else if (plainKey(event, 'c')) run(() => newMessage());
      else if (plainKey(event, 'Escape')) {
        if (open) run(closeComposer);
        else if (shown !== null) run(() => navigate({page: 'drafts', open: null}));
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
      </header>
      <div className="content" style={accountWidth}>
        <section className="list drafts-list" aria-label="Drafts">
          {!load.data ? (failed ? <LoadFailed what="Drafts" loads={[load]} /> : <AllSkeleton />) : rows.length === 0 ? (
            <div className="drafts-empty ink3"><Icon name="draft" size={20} />No drafts</div>
          ) : rows.map(row => {
            const account = accounts.get(row.account_id);
            const classes = ['row', at === row.id && 'cur', shown === row.id && 'open'].filter(Boolean).join(' ');
            return (
              <div key={row.id} className={classes} data-id={row.id} onMouseMove={() => at !== row.id && setCursor(row.id)} onClick={() => navigate({page: 'drafts', open: row.id})}>
                <span className="ud" />
                <span className="from">{toLine(row)}</span>
                <span className="subj">
                  <b>{row.subject.trim() || 'No subject'}</b>
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
        {open ? <DraftPane open={open} accounts={accounts} timeZone={zone} /> : <EmptyPane label="Draft" keys={KEYS}>{null}</EmptyPane>}
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
