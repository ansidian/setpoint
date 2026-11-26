// The reading pane: 680 px beside the list, there only while an email is open. On the desktop it
// reads the email's whole conversation. It holds the conversation's tools (Done H on Attention mail,
// Trash E, Pin P, Snooze S, Open in Gmail O, Mark unread ⇧U, previous, next, More), the account band,
// the conversation's head (the protected line, subject, triage's summary, a code, mail's slot and the
// actions: Add to calendar, Add as task, Ask about this email, Unsubscribe), then its emails stacked
// (ConversationStack.tsx), each with its own Reply, Reply all, Forward and More, and the Reply box at
// its foot. Add to calendar and Add as task open the proposal card at the top (board 08). Ask about
// this email opens Alfred's card scoped to it, in its place whenever it's shown with no proposal open,
// and in Alfred's window otherwise. The button stays held while its card is open. A plain-text body
// highlights `marks`: the words a search matched in it, or the phrases Alfred's answer rests on.
// Reading it here doesn't mark it read. Opening it (InboxPage) does. The head has mail's slot above
// the actions (slots.tsx), which another module may fill.
//
// On the phone (board 21) it covers the page and reads the same conversation: Back and Pin at the
// top, the head and the stack full width, and Done (on Attention mail) or Trash, Reply and More at
// the bottom (phone/ReaderBar.tsx), which act on the whole conversation, More holding Snooze, Add to
// calendar and Add as task among the rest. Its Find in email puts the find field where Back and Pin
// were (search/FindBar.tsx).
//
// Find in email (search/find.ts) searches the open conversation: ⌘F on the desktop, More's Find in
// email on the phone. The reader holds the email as find's target and runs find over its scroller.
//
// EmailOnly is the email without the rest, for a pane on a page that isn't mail: its head and its
// body, with no tools, actions, slot or commands of its own.
import type {AccountOut, DraftsOut, FromOut, ItemKind, MailConversationOut, MessageOut, MessageRowOut, ProposalOut, ProposalPrefillFailure, RuleOut} from '@setpoint/shared';
import {Fragment, useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {CSSProperties, ReactNode} from 'react';
import {ApiFailure, useResource} from '../api/client.ts';
import {DRAFTS_PATH, FROM_PATH} from '../api/drafts.ts';
import {conversationPath, markRead, markUnread, messagePath} from '../api/mail.ts';
import {prefillFromMessage, proposeFromMessage} from '../api/search.ts';
import {RULES_PATH} from '../api/settings.ts';
import {hasOthers} from '../logic/composer.ts';
import {fullTimestamp, localDate, readerTime, trashLeft} from '../logic/format.ts';
import {holds, replyTarget} from '../logic/conversation.ts';
import {factRows, fitTools, mailboxState, READING_PANE, readerActions, readerSummary, senderLine, summaryTile} from '../logic/reader.ts';
import type {ToolsNeed, ToolsSize} from '../logic/reader.ts';
import {snoozeable, snoozedLine, snoozeWhen} from '../logic/snooze.ts';
import {recipientLine, recipientText} from '../logic/sent.ts';
import {PREFILL_WAIT_MS} from '../logic/search.ts';
import type {PrefillMiss} from '../logic/search.ts';
import {Icon} from '../ui/Icon.tsx';
import {ICONS} from '../ui/glyphs.ts';
import type {IconName} from '../ui/glyphs.ts';
import {colourVar, dotStyle} from './accounts.ts';
import {CreatedItemCard} from './CreatedItem.tsx';
import {CodeCard} from './Code.tsx';
import {ReaderBar} from './phone/ReaderBar.tsx';
import {openEditorSheet} from './phone/EditorSheet.tsx';
import {answerKey, showEmail, useOpenComposer} from './compose/composer.ts';
import {Body, ConversationStack, MoreMenu} from './ConversationStack.tsx';
import {copyText, openContextMenu} from './ContextMenu.tsx';
import {emailActions} from './emailActions.ts';
import {foldAway} from './fold.ts';
import {useCommands} from './palette/commands.ts';
import {usePhone} from './Phone.tsx';
import {setReadingPaneWidth, useReadingPaneWidth} from './readingPane.ts';
import {zoomOf} from './calendar/geometry.ts';
import {ReaderSlot} from './slots.tsx';
import {AnswerCard} from './search/AnswerCard.tsx';
import {ProposalCard} from './search/ProposalCard.tsx';
import {LoadFailed, useArrival, useLoadFailed} from './states/Loading.tsx';
import type {Load} from './states/Loading.tsx';
import {BodySkeleton, HeadSkeleton} from './states/Skeletons.tsx';
import {SummaryTile} from './SummaryTile.tsx';
import {alfredOf, closeAlfred, startAlfred, useAlfredThread, useClaim} from './search/alfred.ts';
import {SnoozeMenu} from './SnoozeMenu.tsx';
import {FindBar} from './search/FindBar.tsx';
import {openFind, useFind, useFindIn, useFindTarget} from './search/find.ts';
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
  // Whether S opens the snooze menu here (the Inbox's), so its key is named only where it works.
  snoozeKey?: boolean;
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
  // Where the phone's Back goes: the Inbox, the search results the email was opened from, or Back to
  // the email of its thread it was opened from.
  back?: 'Inbox' | 'Search' | 'Back' | 'Sent' | 'Snoozed';
  // Opened from Sent: its tools are Trash and Open in Gmail, as sent-only mail's are anywhere.
  sent?: boolean;
}) {
  const width = useReadingPaneWidth();
  const phone = usePhone();
  // The reader reads the email's conversation, stacked (ConversationStack.tsx): its tools act on all
  // of it, and its emails are the email's own.
  const conversationLoad = {path: conversationPath(id), ...useResource<MailConversationOut>(conversationPath(id))};
  const conversation = conversationLoad.data?.emails.some(email => email.id === id) ? conversationLoad.data : undefined;
  const message = conversation?.emails.find(email => email.id === id);
  // The email of the conversation the cards (a proposal, Alfred) are about: the one opened, else
  // the one whose More asked for a card.
  const [carded, setCarded] = useState<{id: number; email: number} | null>(null);
  const cardEmail = carded?.id === id ? carded.email : id;
  const cards = useCards(cardEmail);
  const askOn = (email: number, card: ItemKind | 'ask') => {
    setCarded({id, email});
    askCard(email, card);
  };
  // The More menu, open for this email. It shows only on Security and Noise mail, where it holds the
  // proposals.
  const [moreFor, setMoreFor] = useState<number | null>(null);
  // Done only on Attention mail not yet Done. The tools are the conversation's, from its row.
  const listed = conversation?.row ?? (row && holds(row, id) ? row : undefined);
  const moreItems = listed && readerActions(listed).proposals === 'more';
  const unsubscribeUrl = message?.unsubscribe_url;
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
  const snoozes = !sentMail && !!actions.snooze && !!listed && snoozeable(listed);
  const canSnooze = !phone && snoozes;
  // A snoozed email's Snoozed tool, on the desktop: its menu changes the time or ends it.
  const snoozedMenu = !phone && !!snoozedUntil && !!actions.unsnooze && !!actions.snooze;
  // And on the phone, More's Snoozed row and its sheet.
  const phoneSnoozed = phone && !sentMail && !!snoozedUntil && !!actions.unsnooze && !!actions.snooze;
  // The composer, and the drafts that open it again: the desktop's only. A draft answering any email
  // of the conversation opens by itself at its foot, and once closed it's a "Draft" line there.
  const composer = useOpenComposer();
  const {data: drafts} = useResource<DraftsOut>(phone ? null : DRAFTS_PATH);
  // From: whom Reply all would reach, on the phone too.
  const {data: from} = useResource<FromOut>(FROM_PATH);
  const answering = conversation ? conversation.draft?.message_id ?? id : null;
  useEffect(() => {
    if (!phone && answering !== null) showEmail(answering, drafts?.drafts);
  }, [answering, drafts, phone]);
  // Reply, Reply all and Forward on the whole conversation (R, A, F, the phone's bar) answer its
  // newest email someone else sent, as the foot's Reply does.
  const target = conversation ? replyTarget(conversation.emails) : null;
  const answered = conversation?.emails.find(email => email.id === target);
  const replyAll = answered ? hasOthers(answered, from) : false;
  // Whether the tools' words fit (useToolsFit), for this set of tools.
  const {bar: toolsBar, size} = useToolsFit([doneable, isDone, sentMail, pinned, canSnooze, snoozedUntil, gmail, phone, replyAll, listed?.unread].join(), width);
  // A tool's tip, while its words are hidden.
  const tip = (words: string, answer = false) => (size === 'tight' || (answer && size === 'narrow') ? words : undefined);
  // Mark unread on the phone keeps the email open and offers Mark read. The subject shows the unread
  // dot meanwhile.
  const [unreadFor, setUnreadFor] = useState<number | null>(null);
  const markedUnread = unreadFor === id;
  const toggleRead = () => {
    setUnreadFor(markedUnread ? null : id);
    void (markedUnread ? markRead(id) : markUnread(id)).catch(toastFailure(markedUnread ? 'Failed to mark read' : 'Failed to mark unread'));
  };
  // A copied code reads the email. On the phone it does so after Mark unread too, as Mark read would.
  const codeCopied = () => (markedUnread ? toggleRead() : actions.codeCopied());
  // ⌘K's This email (board 20): the tools, the actions and Mark unread, which closes the reader so
  // the email stays unread. It draws from the email's row too, as the tools do, so it's there at
  // once. It is the same list as the row's right-click menu and More (emailActions.ts).
  const handlers = {...actions, propose: cards.propose, ask: cards.ask, snoozeMenu: canSnooze || snoozedMenu,
    // As R, A and F: the conversation's newest email someone else sent.
    reply: () => answerKey(id, 'reply'),
    ...(replyAll ? {replyAll: () => answerKey(id, 'reply_all')} : {}),
    forward: () => answerKey(id, 'forward'),
    ...(unsubscribeUrl ? {unsubscribe: () => openUnsubscribe(unsubscribeUrl)} : {})};
  const {data: rules} = useResource<RuleOut[]>(RULES_PATH);
  const offered = listed ? emailActions(listed, gmail, handlers, 'palette', rules, sentMail) : [];
  useCommands(() => (listed ? {
    context: {label: listed.subject, colour: accounts.get(listed.account_id)?.colour ?? 'ink3'},
    commands: offered.map(action => ({...action, section: 'email' as const})),
  } : {commands: []}));
  // Find searches this email while it's open (⌘F, or the phone's Find in email).
  useFindTarget(listed ? {id, subject: listed.subject} : null);
  const pane = useRef<HTMLElement>(null);
  useFindIn(pane);
  const finding = useFind().open?.id === id;
  return (
    <section ref={pane} className="pane" aria-label="Reading pane" style={{'--readingPane': `${width}px`} as CSSProperties}>
      {!phone && <PaneEdge width={width} />}
      {phone && finding && <FindBar />}
      {phone && !finding && (
        <div className="ph-top">
          <button className="btn quiet ph-back" type="button" onClick={actions.close}><Icon name="chevron_left" size={20} />{back}</button>
          <span className="grow" />
          {!snoozedUntil && !sentMail && (
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
            <button className="tool" type="button" data-hint={actions.snoozeKey ? 's' : undefined} aria-label="Snooze" aria-haspopup="menu" aria-expanded={open}
              data-tip={open ? undefined : tip(actions.snoozeKey ? 'Snooze · S' : 'Snooze')} onClick={toggle}>
              <Icon name="snooze" /><span className="lbl">Snooze</span>{actions.snoozeKey && <span className="kbd">S</span>}
            </button>
          )} />
        )}
        {/* A snoozed email's Snoozed, its return in its tip and atop its menu, which changes the time or ends it. */}
        {snoozedMenu && (
          <SnoozeMenu keyed="reader" onPick={actions.snooze!} onUnsnooze={actions.unsnooze} title={snoozedLine(snoozedUntil!, now, timeZone)} button={(open, toggle) => (
            <button className="tool snoozed" type="button" data-hint={actions.snoozeKey ? 's' : undefined} aria-label={snoozedLine(snoozedUntil, now, timeZone)} aria-haspopup="menu" aria-expanded={open}
              data-tip={open ? undefined : `${snoozedLine(snoozedUntil, now, timeZone)}${actions.snoozeKey ? ' · S' : ''}`} onClick={toggle}>
              <Icon name="snooze" /><span className="lbl">Snoozed</span>{actions.snoozeKey && <span className="kbd">S</span>}
            </button>
          )} />
        )}
        {gmail !== false && (
          <button className="tool" type="button" data-hint="o" aria-label="Open in Gmail" data-tip={tip('Open in Gmail · O')} onClick={actions.openInGmail} style={gmail === null ? {visibility: 'hidden'} : undefined}>
            <Icon name="open_in_new" /><span className="lbl">Open in Gmail</span><span className="kbd">O</span>
          </button>
        )}
        {/* Reply, Reply all and Forward are each email's, in the stack. Mark unread is the conversation's. */}
        {!phone && !sentMail && (
          <button className="tool" type="button" aria-label="Mark unread" data-tip={tip('Mark unread · ⇧U')} onClick={actions.markUnread}>
            <Icon name="mark_email_unread" /><span className="lbl">Mark unread</span><span className="kbd">⇧U</span>
          </button>
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
      <AccountBand listed={listed} accounts={accounts} now={now} timeZone={timeZone} />
      <Swap id={id} travel={travel} anchor={conversation ? conversation.opened_id : null}>
        {/* The head from the email's row at once. Only the body waits for the email. */}
        <CardPlace cards={cards} id={cardEmail} accounts={accounts} now={now} timeZone={timeZone} onOpen={onOpen} />
        {listed ? <ConversationHead listed={listed} conversation={conversation} now={now} timeZone={timeZone} unsubscribe={message?.unsubscribe_url} cards={cardEmail === id ? cards : null} onCard={card => askOn(id, card)} unread={markedUnread} onCodeCopied={codeCopied} /> : <HeadSkeleton />}
        {conversation
          ? <ConversationStack conversation={conversation} accounts={accounts} now={now} timeZone={timeZone} marks={marks} from={from} composer={composer} onCard={askOn} />
          : <ConversationLoading load={conversationLoad} attachment={(listed?.attachment_count ?? 0) > 0} />}
      </Swap>
      {/* The actions share the bar evenly, drawn once the email's row is known, so none moves in or
          along when the email arrives. Until then the bar stays empty. Done leads, the phone's main job on Attention mail (phone/ReaderBar.tsx). */}
      {phone && (
        <div data-theme="night" className="ph-acts">
          {listed && (
            <ReaderBar email={{doneable: !!doneable, replyAll, markedUnread, sent: sentMail, snoozeable: snoozes,
              snoozed: phoneSnoozed ? {until: snoozedUntil!, when: snoozeWhen(snoozedUntil!, now, timeZone)} : null}} on={{
              done: actions.done, trash: actions.trash, toggleRead, snooze: until => actions.snooze?.(until), unsnooze: () => actions.unsnooze?.(),
              addEvent: () => openEditorSheet({kind: 'event', date: localDate(now, timeZone), message: id}),
              addTask: () => openEditorSheet({kind: 'task', date: localDate(now, timeZone), message: id}),
              reply: () => answerKey(id, 'reply'),
              replyAll: () => answerKey(id, 'reply_all'),
              forward: () => answerKey(id, 'forward'),
              find: () => void openFind(),
            }} />
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
function Swap({id, travel, anchor = null, children}: {id: number; travel: Travel | null; anchor?: number | null; children: ReactNode}) {
  const [arrived] = useState(id);
  const [moved, setMoved] = useState(false);
  if (!moved && id !== arrived) setMoved(true);
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [id]);
  // A conversation opens at its top, or at the email it was opened at when that isn't its first.
  useLayoutEffect(() => {
    const box = scroller.current;
    const email = anchor === null ? null : box?.querySelector<HTMLElement>(`.cv > [data-email="${anchor}"]`);
    if (!box || !email || email === box.querySelector('.cv > [data-email]')) return;
    box.scrollTop += email.getBoundingClientRect().top - box.getBoundingClientRect().top - 8;
  }, [id, anchor]);
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
    <>
      <AccountBand listed={message} accounts={accounts} now={now} timeZone={timeZone} />
      <Swap id={id} travel={travel}>
        <Email key={id} listed={message} message={message} load={load} accounts={accounts} now={now} timeZone={timeZone} marks={[]} />
      </Swap>
    </>
  );
}

/**
 * The account band across the card under the tools, outside the email's scroller so it spans the
 * card's whole width: the account's icon and name in its colour, its address (for sent mail, the
 * account it was sent from), and the email's state on the right (on the phone, only when it isn't the Inbox). The list's Inbox rows don't name
 * the account, so this is where it shows. Until the email's row is known it holds its place, empty.
 */
function AccountBand({listed, accounts, now, timeZone}: {listed: MessageRowOut | undefined; accounts: Map<number, AccountOut>; now: number; timeZone: string}) {
  const phone = usePhone();
  const account = listed ? accounts.get(listed.account_id) : undefined;
  const icon = account && account.icon in ICONS ? (account.icon as IconName) : 'mail';
  // On the phone, Back already says Inbox over it: the band names the state only when it's another.
  const state = listed ? mailboxState(listed, now, timeZone) : null;
  const named = phone && state === 'Inbox' ? null : state;
  return (
    <div className="rd-acct" style={dotStyle(account?.colour)}>
      {account && listed && (
        <>
          <Icon name={icon} size={16} />
          <span className="name">{account.label}</span>
          <span className="addr selectable">{account.address}</span>
          {named && <span className="state">{named}</span>}
        </>
      )}
    </div>
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
  // An item just created from the card: its detail in the card's place (CreatedItem.tsx), until
  // it's closed or another card opens. Kept apart from the panel, which leaves the place free.
  const [made, setMade] = useState<{id: number; item: number} | null>(null);
  const created = made?.id === id ? made.item : null;
  // What the user does sets this email's card, whatever another email left open. An answer
  // arriving late lands only if this email and its card are still the ones shown.
  const show = (next: Panel) => {
    setMade(null);
    setState({id, panel: next});
  };
  const settle = (change: (panel: Panel) => Panel) => setState(current => (current.id === id ? {id, panel: change(current.panel)} : current));
  // Alfred's thread about this email shows here unless a proposal has the card's place. The place
  // is claimed whether or not there's a thread yet, so one asked here never shows in the window first.
  // The panel itself never holds the ask: the thread does.
  const free = panel === null;
  useClaim(free ? {kind: 'email', id} : null);
  const thread = useAlfredThread();
  const mine = thread?.origin.kind === 'email' && thread.origin.id === id;
  const asking = mine && free;
  const alfred = alfredOf(asking ? thread : null);
  // Its button again closes the card: it folds away as its own × does (app/fold.ts).
  const foldCard = () => foldAway(document.querySelector('.pane .rd-swap > .card'));
  // A card asked for from the list opens, rather than toggling one already open shut.
  const latest = useRef({panel, propose: (_kind: ItemKind) => {}, ask: () => {}});
  const cards = {
    panel: asking ? {kind: 'ask'} as const : panel, alfred,
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
      if (asking) {
        foldCard();
        closeAlfred();
        return show(null);
      }
      // This email's thread, in the window while a proposal had the place, comes back here.
      if (!mine) startAlfred({kind: 'email', id});
      show(null);
    },
    close() {
      if (asking) closeAlfred();
      show(null);
    },
    created,
    // The card's Create went through: the item's detail takes its place.
    made(item: number) {
      setState({id, panel: null});
      setMade({id, item});
    },
    closeMade: () => setMade(null),
  };
  useEffect(() => {
    latest.current = {panel: cards.panel, propose: cards.propose, ask: cards.ask};
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

/** The card at the top of the open email or conversation: a proposal, the item it made, or Alfred about email `id`. */
function CardPlace({cards, id, accounts, now, timeZone, onOpen}: {
  cards: Cards;
  id: number;
  accounts: Map<number, AccountOut>;
  now: number;
  timeZone: string;
  onOpen: (id: number, sent?: boolean) => void;
}) {
  const {panel, alfred} = cards;
  return (
    <>
      {panel && panel.kind !== 'ask' && (panel.fill === 'filled' ? panel.filled : panel.rules) && (
        <ProposalCard key={panel.kind} proposal={(panel.fill === 'filled' ? panel.filled : panel.rules)!} now={now} timeZone={timeZone} onClose={cards.close} onCreated={cards.made}
          fill={panel.fill === 'waiting' ? 'waiting' : panel.fill === 'missed' ? panel.miss : null} />
      )}
      {cards.created !== null && (
        <>
          <div className="created-at" aria-hidden="true" />
          <CreatedItemCard key={cards.created} id={cards.created} line=".pane .rd-swap > .created-at" onClose={cards.closeMade} />
        </>
      )}
      {panel?.kind === 'ask' && alfred.open && (
        <AnswerCard alfred={{...alfred, close: cards.close}} scoped openId={id} accounts={accounts} now={now} timeZone={timeZone} onOpen={onOpen} />
      )}
    </>
  );
}

/**
 * The conversation's head: its subject, its summary tile (the conversation's own summary, else
 * triage's summary of an email), its code, mail's slot and the actions, which are that email's.
 */
function ConversationHead({listed, conversation, now, timeZone, unsubscribe, cards, onCard, unread, onCodeCopied}: {
  listed: MessageRowOut;
  // Its conversation once it's in, for the conversation's own summary.
  conversation: MailConversationOut | undefined;
  now: number;
  timeZone: string;
  unsubscribe: string | undefined;
  // The cards while they're about this email (else another email's More asked for one).
  cards: Cards | null;
  onCard: (card: ItemKind | 'ask') => void;
  // Marked unread on the phone, where it stays open: the list's unread dot before the subject.
  unread: boolean;
  onCodeCopied: () => void;
}) {
  const tile = summaryTile(listed, conversation, now, timeZone);
  const held = (kind: ItemKind | 'ask') => (cards?.panel?.kind === kind ? 'btn ghost' : 'btn out');
  // Pressed again while its card is open, the card closes, as the one email's buttons do.
  const press = (kind: ItemKind | 'ask') => (cards ? (kind === 'ask' ? cards.ask() : cards.propose(kind)) : onCard(kind));
  return (
    <div className="rd-head">
      {listed.protected && <div className="protected-line"><Icon name="shield-fill" size={16} />Protected, always stays in Attention</div>}
      <h1 className={listed.protected ? 'rd-subj protected' : 'rd-subj'} data-find="">{unread && <span className="rd-unread" role="img" aria-label="Unread" data-tip="Unread" />}{listed.subject}</h1>
      {tile && <SummaryTile tile={tile} />}
      {listed.code && <CodeCard code={listed.code} onCopied={onCodeCopied} />}
      <ReaderSlot row={listed} />
      <div className="rd-acts">
        {readerActions(listed).proposals === 'buttons' && (
          <>
            <button className={held('event')} type="button" onClick={() => press('event')}><Icon name="event" size={17} />Add to calendar</button>
            <button className={held('task')} type="button" onClick={() => press('task')}><Icon name="task_alt" size={17} />Add as task</button>
          </>
        )}
        <button className={held('ask')} type="button" onClick={() => press('ask')}><Icon name="auto_awesome" size={17} alfred />Ask about this email</button>
        {unsubscribe && <button className="btn out" type="button" onClick={() => openUnsubscribe(unsubscribe)}><Icon name="unsubscribe" size={17} />Unsubscribe</button>}
      </div>
    </div>
  );
}

/** The conversation on its way: a body's skeleton, or why it couldn't load. */
function ConversationLoading({load, attachment}: {load: Load; attachment: boolean}) {
  const failed = useLoadFailed([load]);
  return <div className="rd-body">{failed ? <LoadFailed what="this conversation" loads={[load]} /> : <BodySkeleton attachment={attachment} />}</div>;
}

/**
 * The email alone: its head and its body. The head draws from the email's row (`listed`) until the
 * email itself is in, so it's there at once. The body waits: a skeleton meanwhile (with an
 * attachment's card when it has one), or why it couldn't load. No slot, actions or tools.
 */
function Email({listed, message, load, accounts, now, timeZone, marks}: {
  listed: MessageRowOut | undefined;
  message: MessageOut | undefined;
  load: Load;
  accounts: Map<number, AccountOut>;
  now: number;
  timeZone: string;
  marks: string[];
}) {
  const failed = useLoadFailed([load]);
  const arrived = useArrival(message !== undefined);
  return (
    <>
      {listed ? <Head listed={listed} message={message} accounts={accounts} now={now} timeZone={timeZone} /> : <HeadSkeleton />}
      {message ? <Body message={message} marks={marks} arrived={arrived} /> : (
        <div className="rd-body">{failed ? <LoadFailed what="this email" loads={[load]} /> : <BodySkeleton attachment={(listed?.attachment_count ?? 0) > 0} />}</div>
      )}
    </>
  );
}

/** The head: from the row while the email loads, then from the email (its domain, its security facts). */
function Head({listed, message, accounts, now, timeZone}: {
  listed: MessageRowOut;
  message: MessageOut | undefined;
  accounts: Map<number, AccountOut>;
  now: number;
  timeZone: string;
}) {
  const account = accounts.get(listed.account_id);
  const colour = colourVar(account?.colour);
  const who = listed.organisation ?? listed.from_name;
  const line = senderLine(message ?? listed);
  const summary = readerSummary(listed);
  // Mail the user sent to others names who it went to, once the email is in.
  const sentTo = listed.sent_only && message ? recipientLine(message.to ?? null, message.cc ?? null) : null;
  return (
    <div className="rd-head">
      {listed.protected && <div className="protected-line"><Icon name="shield-fill" size={16} />Protected, always stays in Attention</div>}
      <h1 className={listed.protected ? 'rd-subj protected' : 'rd-subj'}>{listed.subject}</h1>
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
          <div className={listed.sent_only ? 'to sent' : 'to'}>{listed.sent_only
            ? sentTo && <span data-tip={sentTo.tip ?? undefined} data-tip-quick>{recipientText(sentTo).replace(/^To /, 'to ')}</span>
            : <span data-tip={account?.address} data-tip-quick>to you</span>}</div>
        </div>
        {/* The time, and under it a waiting trash in words, as the row shows it: reading
            doesn't spare it, pinning does. A code's own trash names its expiry
            rather than a second countdown beside the code card's. */}
        <div className="rd-right">
          <div>
            <span className="time" data-tip={fullTimestamp(listed.received_at, timeZone)} data-tip-quick>{readerTime(listed.received_at, now, timeZone)}</span>
          </div>
          {listed.trash_due_at && !listed.pinned && (
            <span className="trash-in num"><Icon name="auto_delete" size={14} />
              {listed.code && listed.trash_due_at === listed.code.expires_at ? 'Trash when the code expires' : `Trash in ${trashLeft(listed.trash_due_at, now)}`}
            </span>
          )}
        </div>
      </div>
      {/* A verification code lifted out of the body, with Copy and its countdown, from the row at once. */}
      {listed.code && <CodeCard code={listed.code} />}
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
    </div>
  );
}

/** The sender's unsubscribe page, in a new tab that can't reach back to Setpoint. */
const openUnsubscribe = (url: string) => void window.open(url, '_blank', 'noopener,noreferrer');

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
