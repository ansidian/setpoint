// The reader's conversation, stacked oldest first under its head, as Gmail stacks one. The
// first email, the newest and any unread one open expanded, and so does the one it was opened at when
// it was opened from elsewhere than its row in a list (search, Alfred, a link). The rest show
// collapsed, every one of them: the sender's avatar and name, a paperclip and when, and its first words
// under them. A click on one expands it. What's expanded is decided once per opening, from the answer to the
// open (which judges unread on the state before it read them), and held here: a later load doesn't
// fold an email under the user. An email that arrives meanwhile opens as the server says.
//
// Each expanded email has its head (sender, to, time) with its own Reply, Reply all, Forward and More
// (Add to calendar, Add as task, Ask about this email), its security facts, the images-hidden bar, its
// body with its quoted history folded behind •••, and its attachments. The foot holds the composer
// when one is open on any of its emails, else a draft's "Draft" line and the Reply box, which answers
// the newest email someone else sent.
//
// On the phone each expanded email has one ••• in place of its tools, a finger's size, opening a
// bottom sheet of Reply, Reply all, Forward, Add to calendar and Add as task (phone/ReaderBar.tsx ›
// emailRows). The composer is the phone's own sheet over the reader, so the foot never holds it.
//
// Body and MoreMenu are the reader's too (Reader.tsx), on other pages' panes.
//
// Find in email (search/find.ts) counts every email: an expanded one's sender line, paragraphs and
// files on screen, and what's folded by its text. A collapsed email and a folded quoted history
// count their matches unseen and open when find steps onto one. An HTML email's folded history is
// counted from its whole page in a frame that isn't shown, less what the folded page shows, asked
// for once while find is on.
import type {AccountOut, FromOut, ItemKind, MailConversationOut, MessageOut} from '@setpoint/shared';
import {Fragment, useEffect, useRef, useState} from 'react';
import type {MouseEvent} from 'react';
import {openingOf, trustDomain} from '../api/mail.ts';
import {paragraphs} from '../logic/body.ts';
import {hasOthers} from '../logic/composer.ts';
import {replyTarget} from '../logic/conversation.ts';
import {fullTimestamp, localDate, readerTime, trashLeft} from '../logic/format.ts';
import {splitQuoted} from '../logic/quoted.ts';
import {factRows, hasRemoteContent, remoteImages, senderLine} from '../logic/reader.ts';
import {recipientLine, recipientText} from '../logic/sent.ts';
import {phraseRuns, segments} from '../logic/search.ts';
import {Icon} from '../ui/Icon.tsx';
import {colourVar} from './accounts.ts';
import {Attachments} from './Attachments.tsx';
import {ComposerSlot} from './compose/Composer.tsx';
import {openDraft, startComposer} from './compose/composer.ts';
import type {OpenComposer} from './compose/composer.ts';
import {copyText, openContextMenu} from './ContextMenu.tsx';
import type {MenuAction} from './ContextMenu.tsx';
import {MailFrame} from './MailFrame.tsx';
import {openEditorSheet} from './phone/EditorSheet.tsx';
import {EmailSheetButton} from './phone/ReaderBar.tsx';
import {usePhone} from './Phone.tsx';
import {QuotedHistory} from './QuotedHistory.tsx';
import {Marked} from './search/Search.tsx';
import {countFinds, findWords} from '../logic/find.ts';
import {registerFold, useFind} from './search/find.ts';
import {toastFailure} from './toast.ts';

/** A card asked for on one email of the conversation: a proposal, or Alfred about it. */
export type CardAsk = (id: number, card: ItemKind | 'ask') => void;

export function ConversationStack({conversation, accounts, now, timeZone, marks, from, composer, onCard}: {
  conversation: MailConversationOut;
  accounts: Map<number, AccountOut>;
  now: number;
  timeZone: string;
  // What a search matched, or what Alfred's answer rests on: marked in plain-text bodies.
  marks: string[];
  // Whom Reply all would reach, for each email's Reply all.
  from: FromOut | undefined;
  composer: OpenComposer | null;
  onCard: CardAsk;
}) {
  const phone = usePhone();
  const {emails} = conversation;
  // Each email's expanded state as this opening decided it, then as the user changed it. Until the
  // opening's answer is in, the emails show as the latest load has them.
  const opening = openingOf(conversation.opened_id);
  const [seeded, setSeeded] = useState<Map<number, boolean> | null>(null);
  if (!seeded && opening) setSeeded(new Map(opening.emails.map(email => [email.id, email.expanded])));
  const [toggled, setToggled] = useState<Map<number, boolean>>(new Map());
  const expanded = (email: MailConversationOut['emails'][number]) => toggled.get(email.id) ?? seeded?.get(email.id) ?? email.expanded;
  const toggle = (id: number, open: boolean) => setToggled(state => new Map(state).set(id, open));
  // Find opens a collapsed email to reach a match in it, and folds it back as it ends.
  useEffect(() => {
    const unregister = emails.map(email => registerFold(`email:${email.id}`, {
      unfold: () => setToggled(state => new Map(state).set(email.id, true)),
      fold: () => setToggled(state => new Map(state).set(email.id, false)),
    }));
    return () => unregister.forEach(off => off());
  }, [emails]);
  const byId = new Map(emails.map(email => [email.id, email]));
  const answering = composer && !composer.floating && composer.messageId !== null && byId.has(composer.messageId) ? composer.messageId : null;
  const target = replyTarget(emails);
  const answered = target !== null ? byId.get(target) : undefined;
  return (
    <div className="cv">
      {emails.map(email => {
        const opened = email.id === conversation.opened_id;
        return expanded(email)
          ? <ExpandedEmail key={email.id} email={email} opened={opened} accounts={accounts} now={now} timeZone={timeZone} marks={marks} from={from} onCollapse={() => toggle(email.id, false)} onCard={onCard} />
          : <CollapsedEmail key={email.id} email={email} opened={opened} accounts={accounts} now={now} timeZone={timeZone} onExpand={() => toggle(email.id, true)} />;
      })}
      <div className="cv-foot">
        {/* On the phone the composer is in its own sheet, over the reader. */}
        {answering !== null && !phone ? <ComposerSlot open={composer} messageId={answering} /> : (
          <>
            {conversation.draft && (
              <button type="button" className="cv-draft" onClick={() => openDraft(conversation.draft!.id)}>
                <Icon name="draft" size={16} /><span className="drafted">Draft</span><span className="words">Open the reply you started</span>
              </button>
            )}
            {answered && (
              <button type="button" className="cv-reply" data-hint="r" onClick={() => startComposer({kind: 'reply', message_id: answered.id})}>
                <Icon name="reply" size={18} />{answered.sent_only ? 'Reply' : `Reply to ${answered.from_name}`}{!phone && <span className="kbd">R</span>}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** The sender's initial on their account's colour, as each email's head shows it. */
function Avatar({email, accounts}: {email: MessageOut; accounts: Map<number, AccountOut>}) {
  const colour = colourVar(accounts.get(email.account_id)?.colour);
  const who = email.organisation ?? email.from_name;
  return <span className="avatar" style={{background: `color-mix(in oklch, ${colour} 22%, var(--cardOn))`, color: colour}}>{who.slice(0, 1).toUpperCase()}</span>;
}

/** What an email's head says, as find reads it: who sent it, its sender line, and whom it went to. */
function headText(email: MessageOut): string {
  const line = senderLine(email);
  const sentTo = email.sent_only ? recipientLine(email.to ?? null, email.cc ?? null) : null;
  return [email.from_name, line?.text, email.sent_only ? sentTo && recipientText(sentTo) : 'to you'].filter(Boolean).join('\n');
}

/** A collapsed email: its avatar, who, a paperclip when it has files and when, then its first words. */
function CollapsedEmail({email, opened, accounts, now, timeZone, onExpand}: {
  email: MailConversationOut['emails'][number];
  opened: boolean;
  accounts: Map<number, AccountOut>;
  now: number;
  timeZone: string;
  onExpand: () => void;
}) {
  const find = useFind();
  const words = find.open ? findWords(find.text) : '';
  const [inPage, setInPage] = useState(0);
  const count = words ? countFinds(headText(email), words) + email.attachments.reduce((sum, file) => sum + countFinds(file.filename, words), 0)
    + (email.body_html ? inPage : countFinds(email.body_text, words)) : 0;
  return (
    <button type="button" className={opened ? 'cv-line opened' : 'cv-line'} data-email={email.id} aria-expanded={false} onClick={onExpand}
      data-find-hidden={`email:${email.id}`} data-find-count={count}>
      {!!words && !!email.body_html && <MailFrame messageId={email.id} show={false} title={email.subject} counting onCount={setInPage} />}
      <Avatar email={email} accounts={accounts} />
      <span className="lines">
        <span className="top">
          <span className="who">{email.from_name}</span>
          {email.attachments.length > 0 && <span className="attached" role="img" aria-label="Has attachments"><Icon name="attach_file" size={14} /></span>}
          <span className="when" data-tip={fullTimestamp(email.received_at, timeZone)}>{readerTime(email.received_at, now, timeZone)}</span>
        </span>
        <span className="words">{email.excerpt}</span>
      </span>
    </button>
  );
}

/** An expanded email: its head and tools, its security facts, its body and its files. */
function ExpandedEmail({email, opened, accounts, now, timeZone, marks, from, onCollapse, onCard}: {
  email: MailConversationOut['emails'][number];
  opened: boolean;
  accounts: Map<number, AccountOut>;
  now: number;
  timeZone: string;
  marks: string[];
  from: FromOut | undefined;
  onCollapse: () => void;
  onCard: CardAsk;
}) {
  const phone = usePhone();
  const [more, setMore] = useState(false);
  const account = accounts.get(email.account_id);
  const line = senderLine(email);
  const sentTo = email.sent_only ? recipientLine(email.to ?? null, email.cc ?? null) : null;
  const replyAll = hasOthers(email, from);
  const moreActions: MenuAction[] = [
    {id: 'event', label: 'Add to calendar', icon: 'event', run: () => onCard(email.id, 'event')},
    {id: 'task', label: 'Add as task', icon: 'task_alt', run: () => onCard(email.id, 'task')},
    {id: 'ask', label: 'Ask about this email', icon: 'auto_awesome', run: () => onCard(email.id, 'ask')},
  ];
  // A click anywhere on the head but its tools folds the email back to its line, as Gmail's does.
  // A drag that selects its text doesn't.
  const fold = (event: MouseEvent) => {
    if ((event.target as Element).closest('button, a, .pop') || window.getSelection()?.toString()) return;
    onCollapse();
  };
  return (
    <article className={opened ? 'cv-mail opened' : 'cv-mail'} data-email={email.id} aria-label={`From ${email.from_name}`}>
      <div className="rd-meta cv-head" onClick={fold}>
        <Avatar email={email} accounts={accounts} />
        <div className="who grow" data-find="" onContextMenu={event => openContextMenu(event, event.currentTarget, [
          {id: 'copy-address', label: 'Copy sender address', icon: 'alternate_email', run: () => copyText(email.from_address)},
        ])}>
          <div className="ell selectable">
            <span className="name" data-tip={email.from_address} data-tip-quick>{email.from_name}</span>{line && <> <span className={line.tone}><span className="rd-sep">· </span>{line.text}</span></>}
          </div>
          <div className={email.sent_only ? 'to sent' : 'to'}>{email.sent_only
            ? sentTo && <span data-tip={sentTo.tip ?? undefined} data-tip-quick>{recipientText(sentTo).replace(/^To /, 'to ')}</span>
            : <span data-tip={account?.address} data-tip-quick>to you</span>}</div>
        </div>
        <div className="rd-right">
          <div>
            <span className="time" data-tip={fullTimestamp(email.received_at, timeZone)} data-tip-quick>{readerTime(email.received_at, now, timeZone)}</span>
          </div>
          {/* A waiting trash in words, as the row shows it: reading doesn't spare it, pinning does. A
              code's own trash names its expiry rather than a second countdown beside the code card's. */}
          {email.trash_due_at && !email.pinned && (
            <span className="trash-in num"><Icon name="auto_delete" size={14} />
              {email.code && email.trash_due_at === email.code.expires_at ? 'Trash when the code expires' : `Trash in ${trashLeft(email.trash_due_at, now)}`}
            </span>
          )}
        </div>
        {phone ? (
          <div className="cv-tools">
            <EmailSheetButton from={email.from_name} on={{
              reply: () => startComposer({kind: 'reply', message_id: email.id}),
              replyAll: replyAll ? () => startComposer({kind: 'reply_all', message_id: email.id}) : null,
              forward: () => startComposer({kind: 'forward', message_id: email.id}),
              addEvent: () => openEditorSheet({kind: 'event', date: localDate(now, timeZone), message: email.id}),
              addTask: () => openEditorSheet({kind: 'task', date: localDate(now, timeZone), message: email.id}),
            }} />
          </div>
        ) : <div className="cv-tools">
          <button className="ibtn sm" type="button" aria-label="Reply" data-tip="Reply" onClick={() => startComposer({kind: 'reply', message_id: email.id})}><Icon name="reply" size={18} /></button>
          {replyAll && <button className="ibtn sm" type="button" aria-label="Reply all" data-tip="Reply all" onClick={() => startComposer({kind: 'reply_all', message_id: email.id})}><Icon name="reply_all" size={18} /></button>}
          <button className="ibtn sm" type="button" aria-label="Forward" data-tip="Forward" onClick={() => startComposer({kind: 'forward', message_id: email.id})}><Icon name="forward" size={18} /></button>
          <span className="menu-anchor">
            <button className="ibtn sm" type="button" aria-label="More" aria-expanded={more} onClick={() => setMore(!more)}><Icon name="more_horiz" size={18} /></button>
            {more && <MoreMenu actions={moreActions} onClose={() => setMore(false)} />}
          </span>
        </div>}
      </div>
      {email.security && (
        <div className={email.protected || email.security.unfamiliar ? 'facts-card alert' : 'facts-card'}>
          <dl className="facts">
            {factRows(email.security, email.received_at, now, timeZone).map(row => (
              <Fragment key={row.label}>
                <dt><Icon name={row.icon} size={16} />{row.label}</dt>
                <dd className={row.icon === 'schedule' ? 'num' : undefined}>{row.value}{row.note && <> <span className="unfamiliar">{row.note}</span></>}</dd>
              </Fragment>
            ))}
          </dl>
        </div>
      )}
      <Body message={email} marks={marks} arrived={false} fold={email.quoted_history ? 'html' : 'text'} findable />
    </article>
  );
}

/**
 * An email's body: plain text or its frame, the images-hidden bar and the attachments. It fades in
 * after a wait (`arrived`). With `fold`, its quoted history folds behind •••: plain text's as the web
 * finds it, an HTML email's (`html`, when the server found one) by its folded page.
 */
export function Body({message, marks, arrived, fold, findable = false}: {message: MessageOut; marks: string[]; arrived: boolean; fold?: 'html' | 'text'; findable?: boolean}) {
  // "Show" loads this email's images this time. It lasts while it's open.
  const [shown, setShown] = useState(false);
  const [history, setHistory] = useState(false);
  const images = remoteImages(message.remote_content, hasRemoteContent(message.body_html), shown);
  const text = (body: string) => paragraphs(body).map((lines, index) => (
    <p key={index} data-find="">{lines.map((one, at) => <Fragment key={at}>{at > 0 && <br />}<Marked parts={segments(one, phraseRuns(one, marks))} /></Fragment>)}</p>
  ));
  const quoted = fold && !message.body_html ? splitQuoted(message.body_text) : null;
  // Find reaches into the folded history, and folds it back as it ends.
  const find = useFind();
  const words = findable && find.open ? findWords(find.text) : '';
  useEffect(() => (findable ? registerFold(`quoted:${message.id}`, {unfold: () => setHistory(true), fold: () => setHistory(false)}) : undefined), [findable, message.id]);
  // An HTML email's folded history: what its whole page holds less what the folded page shows.
  const [whole, setWhole] = useState(0);
  const [folded, setFolded] = useState(0);
  const hiddenHtml = !!words && fold === 'html' && !history;
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
      {message.body_html ? (
        <>
          <MailFrame messageId={message.id} show={images.load} title={message.subject} fold={fold === 'html' && !history} onCount={setFolded} />
          {hiddenHtml && <MailFrame messageId={message.id} show={false} title={message.subject} counting onCount={setWhole} />}
          {fold === 'html' && <QuotedHistory open={history} onToggle={setHistory} find={hiddenHtml ? {key: `quoted:${message.id}`, count: Math.max(0, whole - folded)} : undefined} />}
        </>
      ) : quoted?.quoted ? (
        <div className="mailtext">
          {text(quoted.fresh)}
          <QuotedHistory open={history} onToggle={setHistory} find={!!words && !history ? {key: `quoted:${message.id}`, count: countFinds(quoted.quoted, words)} : undefined}>{text(quoted.quoted)}</QuotedHistory>
        </div>
      ) : <div className="mailtext">{text(message.body_text)}</div>}
      <Attachments messageId={message.id} files={message.attachments} />
    </div>
  );
}

/** A small menu under its button: the reader's More, and each stacked email's. */
export function MoreMenu({actions, onClose}: {actions: MenuAction[]; onClose: () => void}) {
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

