// The reading pane (DESIGN.md › The reader): 680 px beside the list, there only while an email is
// open. Tools (Done H on Attention mail, Trash E, Pin P, Open in Gmail O, Reply's reserved place, previous, next,
// More), the head (the protected line, subject, sender, organisation and platform, account, time),
// security mail's facts card, the actions, then the body: plain text, or HTML in a sandboxed frame
// with the images-hidden bar, and the attachments. Add to calendar and Add as task open the proposal
// card at the top (board 08), Ask about this email Alfred's card scoped to it; the button stays held
// while its card is open. A plain-text body highlights `marks`: the words a search matched in it, or
// the phrases Alfred's answer rests on. Reading it here doesn't mark it read: opening it
// (InboxPage) does.
//
// On the phone (DESIGN.md › Phone; board 21) it covers the page: Back and Pin at the top, the email
// full width, and Done (on Attention mail), Trash, Mark unread (then Mark read) and Open in Gmail at the bottom.
import type {AccountOut, ItemKind, MessageOut, MessageRowOut, ProposalOut} from '@setpoint/shared';
import {Fragment, useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {CSSProperties} from 'react';
import {useResource} from '../api/client.ts';
import {markRead, markUnread, messagePath, trustDomain} from '../api/mail.ts';
import {proposeFromMessage} from '../api/search.ts';
import {paragraphs} from '../logic/body.ts';
import {fullTimestamp, readerTime} from '../logic/format.ts';
import {factRows, hasRemoteContent, READING_PANE, readerActions, remoteImages, senderLine} from '../logic/reader.ts';
import {phraseRuns, segments} from '../logic/search.ts';
import {Icon} from '../ui/Icon.tsx';
import {colourVar, dotStyle} from './accounts.ts';
import {Attachments} from './Attachments.tsx';
import {foldAway} from './fold.ts';
import {MailFrame} from './MailFrame.tsx';
import {useCommands} from './palette/commands.ts';
import {usePhone} from './Phone.tsx';
import {setReadingPaneWidth, useReadingPaneWidth} from './readingPane.ts';
import {AnswerCard} from './search/AnswerCard.tsx';
import {ProposalCard} from './search/ProposalCard.tsx';
import {Marked} from './search/Search.tsx';
import {useAlfred} from './search/state.ts';
import {showToast, toastFailure} from './toast.ts';

export interface ReaderActions {
  done: () => void;
  trash: () => void;
  pin: () => void;
  openInGmail: () => void;
  step: (delta: 1 | -1) => void;
  close: () => void;
  // ⇧U: unread again, and the reader closes so it stays so (UX #11).
  markUnread: () => void;
}

export function Reader({id, row, accounts, now, timeZone, canStep, actions, marks = [], onOpen, back = 'Inbox'}: {
  id: number;
  // Its row in the list, so the tools are right before the email itself has loaded.
  row: MessageRowOut | undefined;
  accounts: Map<number, AccountOut>;
  now: number;
  timeZone: string;
  canStep: {previous: boolean; next: boolean};
  actions: ReaderActions;
  marks?: string[];
  // Opens another email (an Answer card's source).
  onOpen: (id: number) => void;
  // Where the phone's Back goes: the Inbox, or the search results the email was opened from.
  back?: 'Inbox' | 'Search';
}) {
  const width = useReadingPaneWidth();
  const {data} = useResource<MessageOut>(messagePath(id));
  const message = data?.id === id ? data : undefined;
  const cards = useCards(id);
  // The More menu, open for this email; it shows only on Security and Noise mail, where it holds the
  // proposals (2026-10-08; SV-24).
  const [moreFor, setMoreFor] = useState<number | null>(null);
  const moreItems = message && readerActions(message).proposals === 'more';
  // Done only on Attention mail not yet Done (#93).
  const listed = message ?? (row?.id === id ? row : undefined);
  const doneable = listed ? readerActions(listed).done : false;
  // The tools draw from the email's row until the email itself is in, so they're right at once:
  // Unpin on pinned mail, and Open in Gmail on Gmail's mail only (an email has its Gmail link exactly
  // when its account is Gmail's), its place held while that's unknown.
  const pinned = listed?.pinned ?? false;
  const provider = listed ? accounts.get(listed.account_id)?.provider : undefined;
  const gmail = message ? message.open_url !== null : provider === undefined ? null : provider === 'gmail';
  // Each email opens at its top, one shown before (straight from the cache) too.
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [id]);
  const phone = usePhone();
  // Mark unread on the phone keeps the email open and offers Mark read; the subject shows the unread
  // dot meanwhile. Each tap pops the swapped icon in (`toggles` keys it), the first draw doesn't.
  const [unreadFor, setUnreadFor] = useState<number | null>(null);
  const [toggles, setToggles] = useState<{id: number; count: number}>({id, count: 0});
  const markedUnread = unreadFor === id;
  const toggled = toggles.id === id ? toggles.count : 0;
  const toggleRead = () => {
    setUnreadFor(markedUnread ? null : id);
    setToggles({id, count: toggled + 1});
    void (markedUnread ? markRead(id) : markUnread(id)).catch((error: Error) => showToast(error.message, null, 'failed'));
  };
  // ⌘K's This email (board 20): the tools, the actions and Mark unread, which closes the reader so
  // the email stays unread.
  useCommands(() => (message ? {
    context: {label: message.subject, colour: accounts.get(message.account_id)?.colour ?? 'ink3'},
    commands: [
      ...(doneable ? [{id: 'done', section: 'email' as const, label: 'Done', icon: 'check' as const, hint: 'H', run: actions.done}] : []),
      {id: 'trash', section: 'email', label: 'Trash', icon: 'delete', hint: 'E', run: actions.trash},
      {id: 'pin', section: 'email', label: message.pinned ? 'Unpin' : 'Pin', icon: message.pinned ? 'keep_off' : 'keep', hint: 'P', run: actions.pin},
      ...(message.open_url === null ? [] : [{id: 'gmail', section: 'email' as const, label: 'Open in Gmail', icon: 'open_in_new' as const, hint: 'O', run: actions.openInGmail}]),
      {id: 'event', section: 'email', label: 'Add to calendar', icon: 'event', run: () => cards.propose('event')},
      {id: 'task', section: 'email', label: 'Add as task', icon: 'task_alt', run: () => cards.propose('task')},
      {id: 'ask', section: 'email', label: 'Ask about this email', icon: 'auto_awesome', keywords: 'alfred', run: cards.ask},
      {id: 'unread', section: 'email', label: 'Mark unread', icon: 'mark_email_unread', hint: '⇧U', run: actions.markUnread},
    ],
  } : {commands: []}));
  return (
    <section className="pane" aria-label="Reading pane" style={{'--readingPane': `${width}px`} as CSSProperties}>
      {!phone && <PaneEdge width={width} />}
      {phone && (
        <div className="ph-top">
          <button className="btn quiet ph-back" type="button" onClick={actions.close}><Icon name="chevron_left" size={20} />{back}</button>
          <span className="grow" />
          <button className="ibtn ph-icon" type="button" aria-label={pinned ? 'Unpin' : 'Pin'} aria-pressed={pinned} onClick={actions.pin}>
            <Icon name={pinned ? 'keep-fill' : 'keep'} size={20} />
          </button>
        </div>
      )}
      <div className="rd-tools">
        {/* Only in the compact tier, where the reader covers the list (#258). */}
        <button className="ibtn rd-back" type="button" aria-label="Back to the list" title="Back · Esc" onClick={actions.close}><Icon name="arrow_back" /></button>
        {doneable && <button className="tool done" type="button" data-hint="h" onClick={actions.done}><Icon name="check" />Done<span className="kbd">H</span></button>}
        <button className="tool trash" type="button" data-hint="e" onClick={actions.trash}><Icon name="delete" />Trash<span className="kbd">E</span></button>
        <button className={pinned ? 'tool active' : 'tool'} type="button" data-hint="p" aria-pressed={pinned} onClick={actions.pin}>
          <Icon name={pinned ? 'keep-fill' : 'keep'} />{pinned ? 'Unpin' : 'Pin'}<span className="kbd">P</span>
        </button>
        {gmail !== false && (
          <button className="tool" type="button" data-hint="o" onClick={actions.openInGmail} style={gmail === null ? {visibility: 'hidden'} : undefined}>
            <Icon name="open_in_new" />Open in Gmail<span className="kbd">O</span>
          </button>
        )}
        <span className="reply-slot" />
        <span className="grow" />
        <button className="ibtn" type="button" aria-label="Previous email" disabled={!canStep.previous} onClick={() => actions.step(-1)}><Icon name="keyboard_arrow_up" /></button>
        <button className="ibtn" type="button" aria-label="Next email" disabled={!canStep.next} onClick={() => actions.step(1)}><Icon name="keyboard_arrow_down" /></button>
        {moreItems && (
          <span className="menu-anchor">
            <button className="ibtn" type="button" aria-label="More" aria-expanded={moreFor === id} onClick={() => setMoreFor(moreFor === id ? null : id)}><Icon name="more_horiz" /></button>
            {moreFor === id && <MoreMenu onClose={() => setMoreFor(null)} onPropose={kind => {
              setMoreFor(null);
              cards.propose(kind);
            }} />}
          </span>
        )}
      </div>
      <div className="rd-scroll" ref={scroller}>
        {message && <Message key={message.id} message={message} accounts={accounts} now={now} timeZone={timeZone} marks={marks} onOpen={onOpen} cards={cards} unread={markedUnread} />}
      </div>
      {/* The actions share the bar evenly (2, 3 or 4 of them), drawn once the email's row or the
          email and its account are known, so none moves in or along when the email arrives; until
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

type Panel = {kind: ItemKind; proposal: ProposalOut | null} | {kind: 'ask'} | null;
type Cards = ReturnType<typeof useCards>;

/** The card at the top of the open email: a proposal (on its way, then shown), or Alfred about it. */
function useCards(id: number) {
  const [state, setState] = useState<{id: number; panel: Panel}>({id, panel: null});
  // Another email starts with no card.
  const panel = state.id === id ? state.panel : null;
  // What the user does sets this email's card, whatever another email left open (SV-24); an answer
  // arriving late lands only if this email and its card are still the ones shown.
  const show = (next: Panel) => setState({id, panel: next});
  const settle = (change: (panel: Panel) => Panel) => setState(current => (current.id === id ? {id, panel: change(current.panel)} : current));
  const alfred = useAlfred(id);
  // Its button again closes the card: it folds away as its own × does (app/fold.ts).
  const foldCard = () => foldAway(document.querySelector('.pane .rd-scroll > .card'));
  return {
    panel, alfred,
    propose(kind: ItemKind) {
      if (panel?.kind === kind) {
        foldCard();
        return show(null);
      }
      show({kind, proposal: null});
      proposeFromMessage(id, kind).then(
        proposal => settle(current => (current?.kind === kind ? {kind, proposal} : current)),
        (error: Error) => {
          settle(current => (current?.kind === kind ? null : current));
          showToast(error.message, null, 'failed');
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
}

/** The reader's More menu (2026-10-08): Add to calendar and Add as task on Security and Noise mail. */
function MoreMenu({onClose, onPropose}: {onClose: () => void; onPropose: (kind: ItemKind) => void}) {
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
      <button type="button" role="menuitem" className="menu-i" onClick={() => onPropose('event')}><Icon name="event" size={16} />Add to calendar</button>
      <button type="button" role="menuitem" className="menu-i" onClick={() => onPropose('task')}><Icon name="task_alt" size={16} />Add as task</button>
    </div>
  );
}

function Message({message, accounts, now, timeZone, marks, onOpen, cards, unread}: {
  message: MessageOut;
  accounts: Map<number, AccountOut>;
  now: number;
  timeZone: string;
  marks: string[];
  onOpen: (id: number) => void;
  cards: Cards;
  // Marked unread on the phone, where it stays open: the list's unread dot before the subject.
  unread: boolean;
}) {
  const account = accounts.get(message.account_id);
  // "Show" loads this email's images this time; it lasts while it's open.
  const [shown, setShown] = useState(false);
  const {panel, alfred} = cards;
  const held = (kind: Exclude<Panel, null>['kind']) => (panel?.kind === kind ? 'btn ghost' : 'btn out');
  const colour = colourVar(account?.colour);
  const who = message.organisation ?? message.from_name;
  const line = senderLine(message);
  const offers = readerActions(message);
  const images = remoteImages(message.remote_content, hasRemoteContent(message.body_html), shown);
  return (
    <>
      {panel && panel.kind !== 'ask' && panel.proposal && (
        <ProposalCard key={panel.kind} proposal={panel.proposal} now={now} timeZone={timeZone} onClose={cards.close} />
      )}
      {panel?.kind === 'ask' && alfred.open && (
        <AnswerCard alfred={{...alfred, close: cards.close}} scoped openId={message.id} accounts={accounts} now={now} timeZone={timeZone} onOpen={onOpen} />
      )}
      <div className="rd-head">
        {message.protected && <div className="protected-line"><Icon name="shield-fill" size={16} />Protected · always stays in Attention</div>}
        <h1 className={message.protected ? 'rd-subj protected' : 'rd-subj'}>{unread && <span className="rd-unread" title="Unread" />}{message.subject}</h1>
        <div className="rd-meta">
          <span className="avatar" style={{background: `color-mix(in oklch, ${colour} 22%, var(--cardOn))`, color: colour}}>{who.slice(0, 1).toUpperCase()}</span>
          <div className="who grow">
            <div className="ell selectable" title={message.from_address}>
              <span className="name">{message.from_name}</span>{line && <> <span className={line.tone}><span className="rd-sep">· </span>{line.text}</span></>}
            </div>
            <div className="to">to you</div>
          </div>
          <span className="account"><span className="dot sm" style={dotStyle(account?.colour)} />{account?.label}</span>
          <span className="time" title={fullTimestamp(message.received_at, timeZone)}>{readerTime(message.received_at, now, timeZone)}</span>
        </div>
        {message.security && (
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
        <div className="rd-acts">
          {offers.proposals === 'buttons' && (
            <>
              <button className={held('event')} type="button" onClick={() => cards.propose('event')}><Icon name="event" size={17} />Add to calendar</button>
              <button className={held('task')} type="button" onClick={() => cards.propose('task')}><Icon name="task_alt" size={17} />Add as task</button>
            </>
          )}
          <button className={held('ask')} type="button" onClick={cards.ask}><Icon name="auto_awesome" size={17} alfred />Ask about this email</button>
        </div>
      </div>
      <div className="rd-body">
        {images.bar && (
          <div className="imgbar">
            <Icon name="hide_image" size={16} />
            <span>Images hidden</span>
            <span className="sep">·</span>
            <button type="button" className="lnk" onClick={() => setShown(true)}>Show</button>
            <span className="sep">·</span>
            <button type="button" className="lnk" onClick={() => void trustDomain(message.remote_content.trust_domain, message.id).catch(toastFailure(`Couldn't trust ${message.remote_content.trust_domain}`))}>
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
    </>
  );
}

/** The pane's left edge, dragged (or ← → when focused) to make it wider or narrower (News's story pane shares it). */
export function PaneEdge({width}: {width: number}) {
  const drag = useRef<{x: number; width: number} | null>(null);
  return (
    <div className="pane-edge" role="separator" aria-orientation="vertical" aria-label="Resize the reading pane" tabIndex={0}
      aria-valuenow={width} aria-valuemin={READING_PANE.min} aria-valuemax={READING_PANE.max}
      onPointerDown={event => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {x: event.clientX, width};
      }}
      onPointerMove={event => {
        if (drag.current) setReadingPaneWidth(drag.current.width + drag.current.x - event.clientX);
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onKeyDown={event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        setReadingPaneWidth(width + (event.key === 'ArrowLeft' ? READING_PANE.step : -READING_PANE.step));
      }} />
  );
}
