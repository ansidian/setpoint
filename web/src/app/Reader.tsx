// The reading pane: 680 px beside the list, there only while an email is open. It holds the tools
// (Done H on Attention mail, Trash E, Pin P, Open in Gmail O, Reply R, Reply all A and Forward F, previous, next,
// More), the head (the protected line, subject, sender, organisation and platform, account, time),
// security mail's facts card, the actions, then the body: plain text, or HTML in a sandboxed frame
// with the images-hidden bar, and the attachments. Add to calendar and Add as task open the proposal
// card at the top (board 08). Ask about this email opens Alfred's card scoped to it. The button stays
// held while its card is open. A plain-text body highlights `marks`: the words a search matched in
// it, or the phrases Alfred's answer rests on. Reading it here doesn't mark it read. Opening it
// (InboxPage) does. Its head has mail's slot under the sender's line and above the actions
// (slots.tsx), which another module may fill.
//
// On the desktop, Reply R, Reply all A (only when the email has others to reply to) and Forward F sit
// after Open in Gmail, and open the composer under the email (compose/Composer.tsx). An email with a draft
// opens its composer again when it's shown.
//
// On the phone (board 21) it covers the page: Back and Pin at the top, the email
// full width, and Done (on Attention mail), Trash, Mark unread (then Mark read) and Open in Gmail at the bottom.
//
// EmailOnly is the email without the rest, for a pane on a page that isn't mail: its head and its
// body, with no tools, actions, slot or commands of its own.
import type {AccountOut, DraftsOut, FromOut, ItemKind, MessageOut, MessageRowOut, ProposalOut, ProposalPrefillFailure, RuleOut} from '@setpoint/shared';
import {Fragment, useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {CSSProperties, ReactNode} from 'react';
import {ApiFailure, useResource} from '../api/client.ts';
import {DRAFTS_PATH, FROM_PATH} from '../api/drafts.ts';
import {markRead, markUnread, messagePath, trustDomain} from '../api/mail.ts';
import {prefillFromMessage, proposeFromMessage} from '../api/search.ts';
import {RULES_PATH} from '../api/settings.ts';
import {paragraphs} from '../logic/body.ts';
import {hasOthers} from '../logic/composer.ts';
import {dayOf, fullTimestamp, readerTime, trashLeft} from '../logic/format.ts';
import {factRows, fitTools, hasRemoteContent, READING_PANE, readerActions, readerSummary, remoteImages, senderLine} from '../logic/reader.ts';
import type {ToolsNeed, ToolsSize} from '../logic/reader.ts';
import {snoozeable, snoozedLine} from '../logic/snooze.ts';
import {recipientLine, recipientText} from '../logic/sent.ts';
import {phraseRuns, PREFILL_WAIT_MS, segments} from '../logic/search.ts';
import type {PrefillMiss} from '../logic/search.ts';
import {Icon} from '../ui/Icon.tsx';
import {colourVar, dotStyle} from './accounts.ts';
import {Attachments} from './Attachments.tsx';
import {CodeCard} from './Code.tsx';
import {ComposerSlot} from './compose/Composer.tsx';
import {showEmail, startComposer, useOpenComposer} from './compose/composer.ts';
import {Conversation} from './Conversation.tsx';
import {copyText, openContextMenu} from './ContextMenu.tsx';
import type {MenuAction} from './ContextMenu.tsx';
import {emailActions} from './emailActions.ts';
import {foldAway} from './fold.ts';
import {MailFrame} from './MailFrame.tsx';
import {useCommands} from './palette/commands.ts';
import {usePhone} from './Phone.tsx';
import {setReadingPaneWidth, useReadingPaneWidth} from './readingPane.ts';
import {zoomOf} from './calendar/geometry.ts';
import {ReaderSlot} from './slots.tsx';
import {AnswerCard} from './search/AnswerCard.tsx';
import {ProposalCard} from './search/ProposalCard.tsx';
import {Marked} from './search/Search.tsx';
import {LoadFailed, useArrival, useLoadFailed} from './states/Loading.tsx';
import type {Load} from './states/Loading.tsx';
import {BodySkeleton, HeadSkeleton} from './states/Skeletons.tsx';
import {useAlfred} from './search/state.ts';
import {SnoozeMenu} from './SnoozeMenu.tsx';
import {showToast, toastFailure} from './toast.ts';

/**
 * The tools give way to their glyphs when their words don't fit: Reply, Reply all and Forward first,
 * then every tool, each named in its tip then (logic/reader.ts › fitTools). Measured before each
 * paint, so no size shows that doesn't fit. A new set of tools (another email, Pin to Unpin) starts
 * from the widest again.
 */
export function useToolsFit(tools: string, paneWidth: number) {
  const bar = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{tools: string; size: ToolsSize; need: ToolsNeed}>({tools, size: 'wide', need: {wide: 0, narrow: 0}});
  const [width, setWidth] = useState(0);
  const current = fit.tools === tools ? fit : {tools, size: 'wide' as const, need: {wide: 0, narrow: 0}};
  // Each size drawn is measured once more: it steps until it fits, never back to a size that didn't.
  useLayoutEffect(() => {
    const element = bar.current;
    if (!element) return;
    const shown = fit.tools === tools ? fit : {tools, size: 'wide' as const, need: {wide: 0, narrow: 0}};
    const next = fitTools(shown.size, shown.need, element.clientWidth, element.scrollWidth);
    if (next.size !== shown.size || next.need !== shown.need || shown !== fit) setFit({tools, ...next});
  }, [fit, tools, width, paneWidth]);
  useLayoutEffect(() => {
    const element = bar.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry?.contentRect.width ?? 0)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return {bar, size: current.size};
}

/** The way the user stepped to the email shown: down the list (J, ↓, Done or Trash moving on) or up (K, ↑). */
export type Travel = 'next' | 'prev';

export interface ReaderActions {
  done: () => void;
  trash: () => void;
  pin: () => void;
  // Snooze until a moment (ms), and Unsnooze on a snoozed email: the Inbox's and Snoozed's, not Sent's. On a
  // snoozed email, Snooze changes its time. A snoozed email has no Pin.
  snooze?: (until: number) => void;
  unsnooze?: () => void;
  openInGmail: () => void;
  step: (delta: 1 | -1) => void;
  close: () => void;
  // ⇧U: unread again, and the reader closes so it stays so.
  markUnread: () => void;
  // Its code copied: read, quietly.
  codeCopied: () => void;
}

export function Reader({id, travel = null, row, accounts, now, timeZone, canStep, actions, marks = [], onOpen, back = 'Inbox', sent = false}: {
  id: number;
  // How the user stepped to it, for its swap, or null for a click.
  travel?: Travel | null;
  // Its row in the list, so the tools are right before the email itself has loaded.
  row: MessageRowOut | undefined;
  accounts: Map<number, AccountOut>;
  now: number;
  timeZone: string;
  canStep: {previous: boolean; next: boolean};
  actions: ReaderActions;
  marks?: string[];
  // Opens another email (an Answer card's source).
  // `sent` says whether the user sent it, when the caller knows (a conversation line, the reply line).
  onOpen: (id: number, sent?: boolean) => void;
  // Where the phone's Back goes: the Inbox, or the search results the email was opened from.
  back?: 'Inbox' | 'Search';
  // Opened from Sent: its tools are Trash and Open in Gmail, as sent-only mail's are anywhere.
  sent?: boolean;
}) {
  const width = useReadingPaneWidth();
  const messageLoad = {path: messagePath(id), ...useResource<MessageOut>(messagePath(id))};
  const {data} = messageLoad;
  const message = data?.id === id ? data : undefined;
  const cards = useCards(id);
  // The More menu, open for this email. It shows only on Security and Noise mail, where it holds the
  // proposals.
  const [moreFor, setMoreFor] = useState<number | null>(null);
  // Done only on Attention mail not yet Done.
  const listed = message ?? (row?.id === id ? row : undefined);
  const moreItems = listed && readerActions(listed).proposals === 'more';
  // Sent mail, mail to yourself opened from Sent included, has no Done.
  const sentMail = sent || listed?.sent_only === true;
  const doneable = listed && !sentMail ? readerActions(listed).done : false;
  // Attention mail already Done says so in its place.
  const isDone = listed && !sentMail ? listed.lane === 'attention' && listed.done : false;
  // The tools draw from the email's row until the email itself is in, so they're right at once:
  // Unpin on pinned mail, and Open in Gmail on Gmail's mail only (an email has its Gmail link exactly
  // when its account is Gmail's). Its place is held while that's unknown.
  const pinned = listed?.pinned ?? false;
  // Snooze on received mail, or on a snoozed email when it returns and Unsnooze.
  const snoozedUntil = listed?.snoozed_until ?? null;
  const provider = listed ? accounts.get(listed.account_id)?.provider : undefined;
  const gmail = message ? message.open_url !== null : provider === undefined ? null : provider === 'gmail';
  const phone = usePhone();
  const canSnooze = !phone && !sentMail && !!actions.snooze && !!listed && snoozeable(listed);
  // A snoozed email's Snoozed tool, on the desktop: its menu changes the time or ends it.
  const snoozedMenu = !phone && !!snoozedUntil && !!actions.unsnooze && !!actions.snooze;
  // The composer, and the drafts that open it again: the desktop's only.
  const composer = useOpenComposer();
  const {data: drafts} = useResource<DraftsOut>(phone ? null : DRAFTS_PATH);
  const {data: from} = useResource<FromOut>(phone ? null : FROM_PATH);
  useEffect(() => {
    if (!phone) showEmail(id, drafts?.drafts);
  }, [id, drafts, phone]);
  const replyAll = message ? hasOthers(message, from) : false;
  // Whether the tools' words fit (useToolsFit), for this set of tools.
  const {bar: toolsBar, size} = useToolsFit([doneable, isDone, sentMail, pinned, canSnooze, snoozedUntil, gmail, phone, replyAll].join(), width);
  // A tool's tip, while its words are hidden.
  const tip = (words: string, answer = false) => (size === 'tight' || (answer && size === 'narrow') ? words : undefined);
  // Mark unread on the phone keeps the email open and offers Mark read. The subject shows the unread
  // dot meanwhile. Each tap pops the swapped icon in (`toggles` keys it), but the first draw doesn't.
  const [unreadFor, setUnreadFor] = useState<number | null>(null);
  const [toggles, setToggles] = useState<{id: number; count: number}>({id, count: 0});
  const markedUnread = unreadFor === id;
  const toggled = toggles.id === id ? toggles.count : 0;
  const toggleRead = () => {
    setUnreadFor(markedUnread ? null : id);
    setToggles({id, count: toggled + 1});
    void (markedUnread ? markRead(id) : markUnread(id)).catch(toastFailure(markedUnread ? 'Failed to mark read' : 'Failed to mark unread'));
  };
  // A copied code reads the email. On the phone it does so after Mark unread too, as Mark read would.
  const codeCopied = () => (markedUnread ? toggleRead() : actions.codeCopied());
  // ⌘K's This email (board 20): the tools, the actions and Mark unread, which closes the reader so
  // the email stays unread. It draws from the email's row too, as the tools do, so it's there at
  // once. It is the same list as the row's right-click menu and More (emailActions.ts).
  const handlers = {...actions, propose: cards.propose, ask: cards.ask, snoozeMenu: canSnooze || snoozedMenu, ...(phone ? {} : {
    reply: () => startComposer({kind: 'reply', message_id: id}),
    ...(replyAll ? {replyAll: () => startComposer({kind: 'reply_all', message_id: id})} : {}),
    forward: () => startComposer({kind: 'forward', message_id: id}),
  })};
  const {data: rules} = useResource<RuleOut[]>(RULES_PATH);
  const offered = listed ? emailActions(listed, gmail, handlers, 'palette', rules, sentMail) : [];
  useCommands(() => (listed ? {
    context: {label: listed.subject, colour: accounts.get(listed.account_id)?.colour ?? 'ink3'},
    commands: offered.map(action => ({...action, section: 'email' as const})),
  } : {commands: []}));
  return (
    <section className="pane" aria-label="Reading pane" style={{'--readingPane': `${width}px`} as CSSProperties}>
      {!phone && <PaneEdge width={width} />}
      {phone && (
        <div className="ph-top">
          <button className="btn quiet ph-back" type="button" onClick={actions.close}><Icon name="chevron_left" size={20} />{back}</button>
          <span className="grow" />
          {!snoozedUntil && (
            <button className="ibtn ph-icon" type="button" aria-label={pinned ? 'Unpin' : 'Pin'} aria-pressed={pinned} onClick={actions.pin}>
              <Icon name={pinned ? 'keep-fill' : 'keep'} size={20} />
            </button>
          )}
        </div>
      )}
      <div ref={toolsBar} className="rd-tools" data-size={size}>
        {/* Only in the compact tier, where the reader covers the list. */}
        <button className="ibtn rd-back" type="button" aria-label="Back to the list" data-tip="Back · Esc" onClick={actions.close}><Icon name="arrow_back" /></button>
        {doneable && <button className="tool done" type="button" data-hint="h" aria-label="Done" data-tip={tip('Done · H')} onClick={actions.done}><Icon name="check" /><span className="lbl">Done</span><span className="kbd">H</span></button>}
        {isDone && <span className="rd-done"><Icon name="check" />Done</span>}
        <button className="tool trash" type="button" data-hint="e" aria-label="Trash" data-tip={tip('Trash · E')} onClick={actions.trash}><Icon name="delete" /><span className="lbl">Trash</span><span className="kbd">E</span></button>
        {!sentMail && !snoozedUntil && (
          <button className={pinned ? 'tool active' : 'tool'} type="button" data-hint="p" aria-pressed={pinned} aria-label={pinned ? 'Unpin' : 'Pin'} data-tip={tip(pinned ? 'Unpin · P' : 'Pin · P')} onClick={actions.pin}>
            <Icon name={pinned ? 'keep-fill' : 'keep'} /><span className="lbl">{pinned ? 'Unpin' : 'Pin'}</span><span className="kbd">P</span>
          </button>
        )}
        {canSnooze && (
          <SnoozeMenu keyed="reader" onPick={actions.snooze!} button={(open, toggle) => (
            <button className="tool" type="button" data-hint="s" aria-label="Snooze" aria-haspopup="menu" aria-expanded={open} data-tip={open ? undefined : tip('Snooze · S')} onClick={toggle}>
              <Icon name="snooze" /><span className="lbl">Snooze</span><span className="kbd">S</span>
            </button>
          )} />
        )}
        {/* A snoozed email's Snoozed, its return in its tip and atop its menu, which changes the time or ends it. */}
        {snoozedMenu && (
          <SnoozeMenu keyed="reader" onPick={actions.snooze!} onUnsnooze={actions.unsnooze} title={snoozedLine(snoozedUntil!, now, timeZone)} button={(open, toggle) => (
            <button className="tool snoozed" type="button" aria-label={snoozedLine(snoozedUntil, now, timeZone)} aria-haspopup="menu" aria-expanded={open}
              data-tip={open ? undefined : snoozedLine(snoozedUntil, now, timeZone)} onClick={toggle}>
              <Icon name="snooze" /><span className="lbl">Snoozed</span>
            </button>
          )} />
        )}
        {gmail !== false && (
          <button className="tool" type="button" data-hint="o" aria-label="Open in Gmail" data-tip={tip('Open in Gmail · O')} onClick={actions.openInGmail} style={gmail === null ? {visibility: 'hidden'} : undefined}>
            <Icon name="open_in_new" /><span className="lbl">Open in Gmail</span><span className="kbd">O</span>
          </button>
        )}
        {!phone && (
          <>
            <button className="tool answering" type="button" data-hint="r" aria-label="Reply" data-tip={tip('Reply · R', true)} onClick={() => startComposer({kind: 'reply', message_id: id})}>
              <Icon name="reply" /><span className="lbl">Reply</span><span className="kbd">R</span>
            </button>
            {replyAll && (
              <button className="tool answering" type="button" data-hint="a" aria-label="Reply all" data-tip={tip('Reply all · A', true)} onClick={() => startComposer({kind: 'reply_all', message_id: id})}>
                <Icon name="reply_all" /><span className="lbl">Reply all</span><span className="kbd">A</span>
              </button>
            )}
            <button className="tool answering" type="button" data-hint="f" aria-label="Forward" data-tip={tip('Forward · F', true)} onClick={() => startComposer({kind: 'forward', message_id: id})}>
              <Icon name="forward" /><span className="lbl">Forward</span><span className="kbd">F</span>
            </button>
          </>
        )}
        <span className="grow" />
        <button className="ibtn" type="button" aria-label="Previous email" disabled={!canStep.previous} onClick={() => actions.step(-1)}><Icon name="keyboard_arrow_up" /></button>
        <button className="ibtn" type="button" aria-label="Next email" disabled={!canStep.next} onClick={() => actions.step(1)}><Icon name="keyboard_arrow_down" /></button>
        {moreItems && (
          <span className="menu-anchor">
            <button className="ibtn" type="button" aria-label="More" aria-expanded={moreFor === id} onClick={() => setMoreFor(moreFor === id ? null : id)}><Icon name="more_horiz" /></button>
            {moreFor === id && <MoreMenu actions={offered.filter(action => action.id === 'event' || action.id === 'task')} onClose={() => setMoreFor(null)} />}
          </span>
        )}
      </div>
      <Swap id={id} travel={travel}>
        {/* The head from the email's row at once. Only the body waits for the email. */}
        <Message key={id} id={id} listed={listed} message={message} load={messageLoad} accounts={accounts} now={now} timeZone={timeZone} marks={marks} onOpen={onOpen} cards={cards} unread={markedUnread} onCodeCopied={codeCopied} />
      </Swap>
      {!phone && <ComposerSlot open={composer} messageId={id} />}
      {/* The actions share the bar evenly (2, 3 or 4 of them), drawn once the email's row or the
          email and its account are known, so none moves in or along when the email arrives. Until
          then the bar stays empty. Done leads, the phone's main job on Attention mail. */}
      {phone && (
        <div className="ph-acts">
          {listed && gmail !== null && (
            <>
              {doneable && <button className="ph-done" type="button" onClick={actions.done}><Icon name="check" size={22} />Done</button>}
              <button className="trash" type="button" onClick={actions.trash}><Icon name="delete" size={22} />Trash</button>
              <button type="button" onClick={toggleRead}>
                <span key={toggled} className={toggled ? 'ph-swap' : undefined}><Icon name={markedUnread ? 'mark_email_read' : 'mark_email_unread'} size={22} /></span>
                {markedUnread ? 'Mark read' : 'Mark unread'}
              </button>
              {gmail && <button type="button" onClick={actions.openInGmail}><Icon name="open_in_new" size={22} />Open in Gmail</button>}
            </>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * The pane's scroller. Each email opens at its top, one shown before (straight from the cache) too.
 * It swaps in from the side the user stepped from: up 8 px from below going down the list, down from
 * above going up, a fade for a click. The first email shows at once (in a narrow window it arrives
 * with the pane's slide over the list), not as a swap. The tools stay still.
 */
function Swap({id, travel, children}: {id: number; travel: Travel | null; children: ReactNode}) {
  const [arrived] = useState(id);
  const [moved, setMoved] = useState(false);
  if (!moved && id !== arrived) setMoved(true);
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [id]);
  return (
    <div className="rd-scroll" ref={scroller}>
      <div key={id} className="rd-swap" data-swap={moved ? travel ?? 'fade' : undefined}>{children}</div>
    </div>
  );
}

/** The email alone, for a pane on another page. Reading it here turns nothing read. */
export function EmailOnly({id, travel = null, accounts, now, timeZone}: {
  id: number;
  travel?: Travel | null;
  accounts: Map<number, AccountOut>;
  now: number;
  timeZone: string;
}) {
  const load = {path: messagePath(id), ...useResource<MessageOut>(messagePath(id))};
  const message = load.data?.id === id ? load.data : undefined;
  return (
    <Swap id={id} travel={travel}>
      <Email key={id} listed={message} message={message} load={load} accounts={accounts} now={now} timeZone={timeZone} marks={[]} />
    </Swap>
  );
}

/**
 * The email as the selection's stack shows it in front: its head from its row at once, its body
 * when it's in (a skeleton until then). No tools, actions or slot, and showing it reads nothing.
 */
export function EmailCard({id, row, accounts, now, timeZone}: {
  id: number;
  row: MessageRowOut | undefined;
  accounts: Map<number, AccountOut>;
  now: number;
  timeZone: string;
}) {
  const load = {path: messagePath(id), ...useResource<MessageOut>(messagePath(id))};
  const message = load.data?.id === id ? load.data : undefined;
  return <Email listed={row ?? message} message={message} load={load} accounts={accounts} now={now} timeZone={timeZone} marks={[]} />;
}

/**
 * A proposal's prefill: `waiting` while the model reads the email (the fields locked under
 * skeletons), then once only `filled` (its answer), `missed` (past PREFILL_WAIT_MS or failed: the
 * rules' fields and a red line) or `none` (no call: an invite, no key). A late answer finds it
 * moved on and is dropped, so nothing typed is overwritten.
 */
export type Fill = 'waiting' | 'filled' | 'missed' | 'none';
type ProposalPanel = {kind: ItemKind; opened: number; rules: ProposalOut | null; filled: ProposalOut | null; fill: Fill; miss: PrefillMiss | null};
type Panel = ProposalPanel | {kind: 'ask'} | null;
let openings = 0;
type Cards = ReturnType<typeof useCards>;

// A card asked for from outside the reader (an email row's right-click: Add to calendar, Add as task,
// Ask about this email), taken by the reader once it shows that email.
let asked: {id: number; card: ItemKind | 'ask'} | null = null;
const askers = new Set<() => void>();

/** Opens `card` on email `id` in the reader, now if it shows that email, else as it opens it. */
export function askCard(id: number, card: ItemKind | 'ask') {
  asked = {id, card};
  askers.forEach(take => take());
}

/** The card at the top of the open email: a proposal (on its way, then shown), or Alfred about it. */
function useCards(id: number) {
  const [state, setState] = useState<{id: number; panel: Panel}>({id, panel: null});
  // Another email starts with no card.
  const panel = state.id === id ? state.panel : null;
  // What the user does sets this email's card, whatever another email left open. An answer
  // arriving late lands only if this email and its card are still the ones shown.
  const show = (next: Panel) => setState({id, panel: next});
  const settle = (change: (panel: Panel) => Panel) => setState(current => (current.id === id ? {id, panel: change(current.panel)} : current));
  const alfred = useAlfred(id);
  // Its button again closes the card: it folds away as its own × does (app/fold.ts).
  const foldCard = () => foldAway(document.querySelector('.pane .rd-swap > .card'));
  // A card asked for from the list opens, rather than toggling one already open shut.
  const latest = useRef({panel, propose: (_kind: ItemKind) => {}, ask: () => {}});
  const cards = {
    panel, alfred,
    propose(kind: ItemKind) {
      if (panel?.kind === kind) {
        foldCard();
        return show(null);
      }
      openings += 1;
      const opened = openings;
      show({kind, opened, rules: null, filled: null, fill: 'waiting', miss: null});
      // Only this opening's card: closed and opened again, it's another.
      const mine = (current: Panel): current is ProposalPanel => current !== null && current.kind === kind && 'opened' in current && current.opened === opened;
      const unlock = (miss: PrefillMiss) => settle(current => (mine(current) && current.fill === 'waiting' ? {...current, fill: 'missed', miss} : current));
      const cutoff = setTimeout(() => unlock({slow: true}), PREFILL_WAIT_MS);
      proposeFromMessage(id, kind).then(
        rules => settle(current => (mine(current) ? {...current, rules} : current)),
        (error: Error) => {
          clearTimeout(cutoff);
          settle(current => (mine(current) ? null : current));
          showToast(error.message, null, 'failed');
        },
      );
      prefillFromMessage(id, kind).then(
        out => {
          clearTimeout(cutoff);
          settle(current => (mine(current) && current.fill === 'waiting' ? {...current, ...(out.proposal ? {filled: out.proposal, fill: 'filled'} : {fill: 'none'})} : current));
        },
        (error: Error) => {
          clearTimeout(cutoff);
          const details = error instanceof ApiFailure && error.code === 'prefill_failed' ? error.details as ProposalPrefillFailure | undefined : undefined;
          unlock(details ?? (error instanceof ApiFailure && error.status === 0 ? {unreachable: true} : {reason: 'unreachable', status: null}));
        },
      );
    },
    ask() {
      if (panel?.kind === 'ask') {
        foldCard();
        alfred.close();
        return show(null);
      }
      alfred.start();
      show({kind: 'ask'});
    },
    close() {
      alfred.close();
      show(null);
    },
  };
  useEffect(() => {
    latest.current = {panel, propose: cards.propose, ask: cards.ask};
  });
  useEffect(() => {
    const take = () => {
      if (asked?.id !== id) return;
      const {card} = asked;
      asked = null;
      const {panel: shown, propose, ask} = latest.current;
      if (shown?.kind === card) return;
      if (card === 'ask') ask();
      else propose(card);
    };
    take();
    askers.add(take);
    return () => {
      askers.delete(take);
    };
  }, [id]);
  return cards;
}

/** The reader's More menu: Add to calendar and Add as task on Security and Noise mail. */
function MoreMenu({actions, onClose}: {actions: MenuAction[]; onClose: () => void}) {
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    menu.current?.querySelector('button')?.focus();
    const away = (event: PointerEvent) => !menu.current?.parentElement?.contains(event.target as Node) && onClose();
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', escape, true);
    };
  });
  return (
    <div ref={menu} className="pop menu more-menu" role="menu">
      {actions.map(action => (
        <button key={action.id} type="button" role="menuitem" className="menu-i" onClick={() => {
          onClose();
          action.run();
        }}><Icon name={action.icon} size={16} />{action.label}</button>
      ))}
    </div>
  );
}

/** The open email: its card, and the email under it. */
function Message({id, listed, message, load, accounts, now, timeZone, marks, onOpen, cards, unread, onCodeCopied}: {
  id: number;
  listed: MessageRowOut | undefined;
  message: MessageOut | undefined;
  load: Load;
  accounts: Map<number, AccountOut>;
  now: number;
  timeZone: string;
  marks: string[];
  onOpen: (id: number, sent?: boolean) => void;
  cards: Cards;
  // Marked unread on the phone, where it stays open: the list's unread dot before the subject.
  unread: boolean;
  // Its code copied, which reads it.
  onCodeCopied: () => void;
}) {
  const {panel, alfred} = cards;
  return (
    <>
      {panel && panel.kind !== 'ask' && (panel.fill === 'filled' ? panel.filled : panel.rules) && (
        <ProposalCard key={panel.kind} proposal={(panel.fill === 'filled' ? panel.filled : panel.rules)!} now={now} timeZone={timeZone} onClose={cards.close}
          fill={panel.fill === 'waiting' ? 'waiting' : panel.fill === 'missed' ? panel.miss : null} />
      )}
      {panel?.kind === 'ask' && alfred.open && (
        <AnswerCard alfred={{...alfred, close: cards.close}} scoped openId={id} accounts={accounts} now={now} timeZone={timeZone} onOpen={onOpen} />
      )}
      <Email listed={listed} message={message} load={load} accounts={accounts} now={now} timeZone={timeZone} marks={marks} cards={cards} unread={unread} onCodeCopied={onCodeCopied} onOpen={onOpen} />
    </>
  );
}

/**
 * The email: its head and its body. The head draws from the email's row (`listed`) until the email
 * itself is in, so it's there at once. The body waits: a skeleton meanwhile (with an attachment's
 * card when it has one), or why it couldn't load. With no `cards`, it's the email alone: no slot
 * and no actions.
 */
function Email({listed, message, load, accounts, now, timeZone, marks, cards, unread = false, onCodeCopied, onOpen}: {
  listed: MessageRowOut | undefined;
  message: MessageOut | undefined;
  load: Load;
  accounts: Map<number, AccountOut>;
  now: number;
  timeZone: string;
  marks: string[];
  cards?: Cards;
  unread?: boolean;
  onCodeCopied?: () => void;
  // Opens another email of its conversation. Without it, as on another page's pane, there is no
  // "You replied" line and no conversation list.
  onOpen?: (id: number, sent?: boolean) => void;
}) {
  const failed = useLoadFailed([load]);
  const arrived = useArrival(message !== undefined);
  // The phone's reader is frozen as it was: no line, no list.
  const phone = usePhone();
  const conversation = cards && onOpen && !phone ? onOpen : undefined;
  return (
    <>
      {listed ? <Head listed={listed} message={message} accounts={accounts} now={now} timeZone={timeZone} cards={cards} unread={unread} onCodeCopied={onCodeCopied} onOpen={conversation} /> : <HeadSkeleton />}
      {message ? <Body message={message} marks={marks} arrived={arrived} /> : (
        <div className="rd-body">{failed ? <LoadFailed what="this email" loads={[load]} /> : <BodySkeleton attachment={(listed?.attachment_count ?? 0) > 0} />}</div>
      )}
      {message && conversation && <Conversation key={message.id} message={message} timeZone={timeZone} onOpen={conversation} />}
    </>
  );
}

/** The head: from the row while the email loads, then from the email (its domain, its security facts). */
function Head({listed, message, accounts, now, timeZone, cards, unread, onCodeCopied, onOpen}: {
  listed: MessageRowOut;
  message: MessageOut | undefined;
  accounts: Map<number, AccountOut>;
  now: number;
  timeZone: string;
  cards: Cards | undefined;
  // Marked unread on the phone, where it stays open: the list's unread dot before the subject.
  unread: boolean;
  onCodeCopied: (() => void) | undefined;
  // Opens the reply from the "You replied" line, which shows only with it.
  onOpen: ((id: number, sent?: boolean) => void) | undefined;
}) {
  const account = accounts.get(listed.account_id);
  // The line draws from the row at once. A click opens the reply once the email names it.
  const replied = message ? message.replied_at : listed.replied_at;
  const replyId = message?.reply_id;
  const colour = colourVar(account?.colour);
  const who = listed.organisation ?? listed.from_name;
  const line = senderLine(message ?? listed);
  const summary = readerSummary(listed);
  // Mail the user sent to others names who it went to, once the email is in.
  const sentTo = listed.sent_only && message ? recipientLine(message.to ?? null, message.cc ?? null) : null;
  return (
    <div className="rd-head">
      {listed.protected && <div className="protected-line"><Icon name="shield-fill" size={16} />Protected, always stays in Attention</div>}
      <h1 className={listed.protected ? 'rd-subj protected' : 'rd-subj'}>{unread && <span className="rd-unread" role="img" aria-label="Unread" data-tip="Unread" />}{listed.subject}</h1>
      {/* Triage's summary, which the list shows in the subject's place, kept here once it's open. */}
      {summary && <p className="rd-sum selectable">{summary}</p>}
      <div className="rd-meta">
        <span className="avatar" style={{background: `color-mix(in oklch, ${colour} 22%, var(--cardOn))`, color: colour}}>{who.slice(0, 1).toUpperCase()}</span>
        <div className="who grow" onContextMenu={event => openContextMenu(event, event.currentTarget, [
          {id: 'copy-address', label: 'Copy sender address', icon: 'alternate_email', run: () => copyText(listed.from_address)},
        ])}>
          <div className="ell selectable">
            <span className="name" data-tip={listed.from_address} data-tip-quick>{listed.from_name}</span>{line && <> <span className={line.tone}><span className="rd-sep">· </span>{line.text}</span></>}
          </div>
          <div className="to">{listed.sent_only
            ? sentTo && <span data-tip={sentTo.tip ?? undefined} data-tip-quick>{recipientText(sentTo).replace(/^To /, 'to ')}</span>
            : <span data-tip={account?.address} data-tip-quick>to you</span>}</div>
        </div>
        {/* The account and time, and under them a waiting trash in words, as the row shows it: reading
            doesn't spare it, pinning does. A code's own trash names its expiry
            rather than a second countdown beside the code card's. */}
        <div className="rd-right">
          <div>
            <span className="account"><span className="dot sm" style={dotStyle(account?.colour)} />{account?.label}</span>
            <span className="time" data-tip={fullTimestamp(listed.received_at, timeZone)} data-tip-quick>{readerTime(listed.received_at, now, timeZone)}</span>
          </div>
          {listed.trash_due_at && !listed.pinned && (
            <span className="trash-in num"><Icon name="auto_delete" size={14} />
              {listed.code && listed.trash_due_at === listed.code.expires_at ? 'Trash when the code expires' : `Trash in ${trashLeft(listed.trash_due_at, now)}`}
            </span>
          )}
        </div>
      </div>
      {replied && onOpen && (
        <button className="rd-replied" type="button" disabled={replyId === undefined} data-tip={fullTimestamp(replied, timeZone)} data-tip-quick
          onClick={() => replyId !== undefined && onOpen(replyId, true)}>
          <Icon name="reply" size={16} />You replied {dayOf(replied, now, timeZone)}
        </button>
      )}
      {/* A verification code lifted out of the body, with Copy and its countdown, from the row at once. */}
      {listed.code && <CodeCard code={listed.code} onCopied={onCodeCopied} />}
      {message?.security && (
        <div className={message.protected || message.security.unfamiliar ? 'facts-card alert' : 'facts-card'}>
          <dl className="facts">
            {factRows(message.security, message.received_at, now, timeZone).map(row => (
              <Fragment key={row.label}>
                <dt><Icon name={row.icon} size={16} />{row.label}</dt>
                <dd className={row.icon === 'schedule' ? 'num' : undefined}>{row.value}{row.note && <> <span className="unfamiliar">{row.note}</span></>}</dd>
              </Fragment>
            ))}
          </dl>
        </div>
      )}
      {cards && (
        <>
          <ReaderSlot row={listed} />
          <Actions listed={listed} cards={cards} />
        </>
      )}
    </div>
  );
}

/** The actions under the head: the proposals where they're offered, then Ask about this email. */
function Actions({listed, cards}: {listed: MessageRowOut; cards: Cards}) {
  const {panel} = cards;
  const held = (kind: Exclude<Panel, null>['kind']) => (panel?.kind === kind ? 'btn ghost' : 'btn out');
  return (
    <div className="rd-acts">
      {readerActions(listed).proposals === 'buttons' && (
        <>
          <button className={held('event')} type="button" onClick={() => cards.propose('event')}><Icon name="event" size={17} />Add to calendar</button>
          <button className={held('task')} type="button" onClick={() => cards.propose('task')}><Icon name="task_alt" size={17} />Add as task</button>
        </>
      )}
      <button className={held('ask')} type="button" onClick={cards.ask}><Icon name="auto_awesome" size={17} alfred />Ask about this email</button>
    </div>
  );
}

/** The body, once the email is in: plain text or its frame, the images-hidden bar and the attachments. It fades in after a wait. */
function Body({message, marks, arrived}: {message: MessageOut; marks: string[]; arrived: boolean}) {
  // "Show" loads this email's images this time. It lasts while it's open.
  const [shown, setShown] = useState(false);
  const images = remoteImages(message.remote_content, hasRemoteContent(message.body_html), shown);
  return (
    <div className={arrived ? 'rd-body sk-arrive' : 'rd-body'}>
      {images.bar && (
        <div className="imgbar">
          <Icon name="hide_image" size={16} />
          <span>Images hidden</span>
          <button type="button" className="lnk" onClick={() => setShown(true)}>Show</button>
          <button type="button" className="lnk" onClick={() => void trustDomain(message.remote_content.trust_domain, message.id).catch(toastFailure(`Failed to trust ${message.remote_content.trust_domain}`))}>
            Always show from {message.remote_content.trust_domain}
          </button>
        </div>
      )}
      {message.body_html ? <MailFrame messageId={message.id} show={images.load} title={message.subject} /> : (
        <div className="mailtext">
          {paragraphs(message.body_text).map((lines, index) => (
            <p key={index}>{lines.map((text, at) => <Fragment key={at}>{at > 0 && <br />}<Marked parts={segments(text, phraseRuns(text, marks))} /></Fragment>)}</p>
          ))}
        </div>
      )}
      <Attachments messageId={message.id} files={message.attachments} />
    </div>
  );
}

/**
 * The pane's left edge, dragged (or ← → when focused) to make it wider or narrower, and double-clicked
 * to put it back to 680 (News's story pane shares it). Its grip sits fixed at the edge's middle. A
 * grip that followed the pointer ran ahead of it under the wide screen's zoom. The pointer moves in the
 * window's pixels and the pane's width is the page's, so the drag divides by the zoom.
 */
export function PaneEdge({width}: {width: number}) {
  const drag = useRef<{x: number; width: number; zoom: number} | null>(null);
  const [dragging, setDragging] = useState(false);
  const end = () => {
    drag.current = null;
    setDragging(false);
  };
  return (
    <div className={dragging ? 'pane-edge dragging' : 'pane-edge'} role="separator" aria-orientation="vertical" aria-label="Resize the reading pane" tabIndex={0}
      aria-valuenow={width} aria-valuemin={READING_PANE.min} aria-valuemax={READING_PANE.max}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {x: event.clientX, width, zoom: zoomOf(event.currentTarget)};
        setDragging(true);
      }}
      onPointerMove={event => {
        if (drag.current) setReadingPaneWidth(drag.current.width + Math.round((drag.current.x - event.clientX) / drag.current.zoom));
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => setReadingPaneWidth(READING_PANE.start)}
      onKeyDown={event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        setReadingPaneWidth(width + (event.key === 'ArrowLeft' ? READING_PANE.step : -READING_PANE.step));
      }}>
      <span className="grip"><i /><i /><i /></span>
    </div>
  );
}
