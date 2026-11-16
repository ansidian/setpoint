// The composer, in the reading pane under the email it answers (the email scrolls above it). From
// is the account's colour and label, its Gmail aliases under each account. Popped out, a title bar
// leads it: the subject, or "New message". To is always there; Cc
// and Bcc show together with ⌘⇧B (and by themselves when the draft has them), and hide again when
// both are empty and the caret leaves them. A recipient is a chip with a name or an address; typing
// suggests people from the user's mail. A new message has a subject field; a reply's or a
// forward's subject is the server's ("Re: …", "Fwd: …"), shown as the window's title.
// The body is the description field's rich text, with its format row always there; a reply's quote
// is folded behind "…" and opens to be trimmed (the recipient gets the quote as it is left).
//
// Keys: ⌘Enter sends, ⌘⇧B shows Cc and Bcc, ⌘J opens help me write's line (WriteLine.tsx), Esc
// closes it (the draft kept). The format row leads with Send, has help me write after the formats,
// and ends with Discard (no key). The top right pops it out into a floating window (no
// key), and the same button docks it again; the format row keeps a place for buttons of its own.
//
// It is mounted once, by ComposerRoot, into the host element its places take in turn (place.ts):
// the reader under its email, a new message's pane, Drafts' pane and the floating window.
import type {AccountOut, DraftOut, DraftsOut, FromOut, MessageOut, Recipient} from '@setpoint/shared';
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import type {ClipboardEvent, CSSProperties, KeyboardEvent, ReactNode, RefObject} from 'react';
import {ApiFailure, useResource} from '../../api/client.ts';
import {timeZone as userTimeZone} from '../../api/auth.ts';
import {draftPath, DRAFTS_PATH, FROM_PATH, suggestPeople} from '../../api/drafts.ts';
import {messagePath} from '../../api/mail.ts';
import {paragraphs} from '../../logic/body.ts';
import {chipLabel, forwardLines, quoteOf, readRecipient, readRecipients, replyLine, withRecipients} from '../../logic/composer.ts';
import {attachmentLabel, attachmentType, hasRemoteContent, remoteImages} from '../../logic/reader.ts';
import {TYPE_GLYPHS} from '../Attachments.tsx';
import {MailFrame} from '../MailFrame.tsx';
import type {Block} from '../../logic/description.ts';
import {Icon} from '../../ui/Icon.tsx';
import {dotStyle, useAccounts} from '../accounts.ts';
import {DescriptionField, mountBlocks} from '../calendar/DescriptionField.tsx';
import {PaneEdge} from '../Reader.tsx';
import {useReadingPaneWidth} from '../readingPane.ts';
import {readHtml} from '../../logic/description.ts';
import {arrangeWindows, placeWindows} from '../../logic/composer.ts';
import {canReplyAll, closeComposer, discard, dock, foldWindows, popOut, queueSave, switchKind, toggleMinimized, send, unsaved, useComposers, useSaveError, watchSends} from './composer.ts';
import type {OpenComposer} from './composer.ts';
import {attach, composerHost, detach, pruneHosts, whenPlaced} from './place.ts';
import {useHelpMeWrite, WriteButton, WriteLine} from './WriteLine.tsx';
import './compose.css';

export function Composer({open, message, accounts, timeZone}: {
  open: OpenComposer;
  // The email it answers, once it's in (for the quote).
  message: MessageOut | undefined;
  accounts: Map<number, AccountOut>;
  timeZone: string;
}) {
  const {data: draft, error} = useResource<DraftOut>(draftPath(open.draftId));
  const {data: from} = useResource<FromOut>(FROM_PATH);
  // Gone meanwhile (sent or discarded elsewhere): nothing left to write.
  const gone = error instanceof ApiFailure && error.status === 404;
  useEffect(() => {
    if (gone) closeComposer(open.draftId);
  }, [gone, open.draftId]);
  if (!draft || draft.id !== open.draftId) return <section className="composer" aria-label="Composer" />;
  return <Fields draft={draft} open={open} from={from} message={message} accounts={accounts} timeZone={timeZone} />;
}

function Fields({draft, open, from, message, accounts, timeZone}: {
  draft: DraftOut;
  open: OpenComposer;
  from: FromOut | undefined;
  message: MessageOut | undefined;
  accounts: Map<number, AccountOut>;
  timeZone: string;
}) {
  // What the user has, from the draft as it was when the composer opened, with any change the server
  // is still owed. From then on it's theirs.
  const [fields, setFields] = useState(() => {
    const {from, to, cc, bcc, subject, body} = {...draft, ...unsaved(draft.id)} as DraftOut;
    return {from, to, cc, bcc, subject, body};
  });
  const [copies, setCopies] = useState(draft.cc.length + draft.bcc.length > 0);
  // A reply's or forward's subject shows as a field once the reply-type menu's Edit subject asks.
  // After it, the reply-type menu is gone.
  const [subjectShown, setSubjectShown] = useState(draft.kind === 'new' || open.subjectEdited);
  const subjectField = useRef<HTMLInputElement>(null);
  const saveError = useSaveError(draft.id);
  const body = useRef<HTMLDivElement>(null);
  const to = useRef<HTMLInputElement>(null);
  const cc = useRef<HTMLInputElement>(null);
  const copiesRow = useRef<HTMLDivElement>(null);
  // The fields as of the last change, for Send right after one (an address typed, then ⌘Enter).
  const latest = useRef(fields);
  const change = <K extends keyof typeof fields>(key: K, value: (typeof fields)[K]) => {
    latest.current = {...latest.current, [key]: value};
    setFields(latest.current);
    queueSave(draft.id, {[key]: value});
  };
  // Help me write's line and the body's versions, saved with the draft.
  const help = useHelpMeWrite({
    draftId: draft.id, initial: ({...draft, ...unsaved(draft.id)} as DraftOut).write, body, current: () => latest.current.body,
    onWrite: write => queueSave(draft.id, {write}),
  });
  const failed = draft.send?.state === 'failed' ? draft.send.error : null;
  // Send: an address still being typed becomes a chip first (the field's leaving does it). With
  // no one to send to, the caret goes to To.
  const sendNow = () => {
    const typing = document.activeElement;
    if (typing instanceof HTMLInputElement && typing.closest('.cmp-recipients')) typing.blur();
    const fresh = latest.current;
    if (fresh.to.length + fresh.cc.length + fresh.bcc.length === 0) {
      to.current?.focus();
      return;
    }
    send({...draft, ...fresh});
  };

  // The caret: in the body, at its start, when there's someone to send to already; else in To.
  // Once it's in its place, which may come after it's drawn.
  useLayoutEffect(() => {
    if (!open.focus) return;
    whenPlaced(open.key, () => {
      if (open.focus === 'to') return to.current?.focus();
      const field = body.current;
      if (!field) return;
      field.focus();
      const range = document.createRange();
      range.setStart(field, 0);
      range.collapse(true);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);
    });
    // Once per opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open.key]);

  const showCopies = () => {
    setCopies(true);
    requestAnimationFrame(() => cc.current?.focus());
  };
  const toggleCopies = () => {
    if (!copies) return showCopies();
    if (!fields.cc.length && !fields.bcc.length) setCopies(false);
    else cc.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const command = event.metaKey || event.ctrlKey;
    if (command && !event.shiftKey && !event.altKey && event.key === 'Enter') {
      event.preventDefault();
      sendNow();
      return;
    }
    if (command && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'j') {
      event.preventDefault();
      help.open();
      return;
    }
    if (command && event.shiftKey && !event.altKey && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      toggleCopies();
      return;
    }
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      closeComposer(draft.id);
      return;
    }
    // The page's own letters (J, K, E, R…) stay out of the composer.
    if (!command && !event.altKey) event.stopPropagation();
  };

  return (
    <section className="composer" aria-label="Composer" onKeyDown={onKeyDown}
      onBlur={event => {
        // Cc and Bcc fold away again when both are empty and the caret has left them.
        if (copies && !fields.cc.length && !fields.bcc.length && !copiesRow.current?.contains(event.relatedTarget as Node | null)) {
          const typed = [...(copiesRow.current?.querySelectorAll('input') ?? [])].some(input => input.value.trim());
          if (!typed && copiesRow.current?.contains(event.target as Node)) setCopies(false);
        }
      }}>
      {/* Popped out: the title folds the window to its bar and back, and the pop-out button docks
          it. The caret stays where it was as the composer moves. */}
      {open.floating && (
        <div className="cmp-title" onMouseDown={event => event.preventDefault()} onClick={() => toggleMinimized(draft.id)}>
          <button className="cmp-title-text ell" type="button" aria-expanded={!open.minimized} aria-label={open.minimized ? 'Open the window' : 'Minimize the window'}>
            {draft.kind === 'new' ? 'New message' : fields.subject || 'No subject'}
          </button>
          <button className="ibtn sm" type="button" aria-label="Back in the reading pane" data-tip="Back in the reading pane"
            onClick={event => {
              event.stopPropagation();
              dock(draft.id);
            }}><Icon name="pip" size={16} /></button>
        </div>
      )}
      <div className="cmp-row cmp-head">
        {!subjectShown && draft.kind !== 'new' && (
          <ReplyType kind={draft.kind} messageId={draft.message_id} floating={open.floating} onPopOut={() => popOut(draft.id)}
            onKind={kind => switchKind({...draft, ...latest.current}, kind)}
            onEditSubject={() => {
              // Edit subject doubles as Forward: a reply becomes a forward that keeps its recipients.
              if (draft.kind !== 'forward') return switchKind({...draft, ...latest.current}, 'forward', {editSubject: true});
              setSubjectShown(true);
              requestAnimationFrame(() => body.current?.focus());
            }} />
        )}
        <span className="cmp-label">From</span>
        <FromPicker value={fields.from} from={from} accounts={accounts} onChange={value => change('from', value)} />
        <span className="grow" />
        {!open.floating && (
          <button className="ibtn sm" type="button" aria-label="Pop out" data-tip="Pop out" onMouseDown={event => event.preventDefault()} onClick={() => popOut(draft.id)}><Icon name="pip" size={16} /></button>
        )}
      </div>
      <div className="cmp-row">
        <span className="cmp-label">To</span>
        <RecipientField label="To" recipients={fields.to} inputRef={to} onChange={value => change('to', value)} />
        {!copies && <button className="btn quiet sm cmp-copies" type="button" data-tip="Cc and Bcc · ⌘⇧B" onClick={showCopies}>Cc Bcc</button>}
      </div>
      {copies && (
        <div ref={copiesRow}>
          <div className="cmp-row">
            <span className="cmp-label">Cc</span>
            <RecipientField label="Cc" recipients={fields.cc} inputRef={cc} onChange={value => change('cc', value)} />
          </div>
          <div className="cmp-row">
            <span className="cmp-label">Bcc</span>
            <RecipientField label="Bcc" recipients={fields.bcc} onChange={value => change('bcc', value)} />
          </div>
        </div>
      )}
      {subjectShown && (
        <div className="cmp-row">
          <input ref={subjectField} className="cmp-subject grow" aria-label="Subject" placeholder="Subject" value={fields.subject} onChange={event => change('subject', event.target.value)} />
        </div>
      )}
      {failed && (
        <div className="cmp-failed" role="alert">
          <Icon name="error" size={16} /><span className="grow">{failed}</span>
          <button className="btn quiet sm" type="button" onClick={sendNow}><Icon name="refresh" size={16} />Try again</button>
        </div>
      )}
      {saveError && <div className="cmp-failed" role="alert"><Icon name="error" size={16} /><span className="grow">{saveError}</span></div>}
      <DescriptionField blocks={fields.body} kind="mail" note={null} label="Message" placeholder="" bar="always" fieldRef={body}
        onChange={blocks => change('body', blocks)}
        after={draft.kind === 'reply' || draft.kind === 'reply_all' ? <Quote draft={draft} message={message} timeZone={timeZone} />
          : draft.kind === 'forward' ? <Forwarded draft={draft} message={message} timeZone={timeZone} /> : null}
        beforeBar={<WriteLine help={help} body={fields.body} />}
        barStart={(
          <button className="btn cmp-send" type="button" onMouseDown={event => event.preventDefault()} onClick={sendNow}>
            Send<span className="kbd">⌘↵</span>
          </button>
        )}
        barEnd={(
          <>
            <span className="cmp-bar-slot"><WriteButton help={help} /></span>
            <span className="grow" />
            <button className="ibtn sm danger" type="button" aria-label="Discard" data-tip="Discard" onMouseDown={event => event.preventDefault()} onClick={() => discard({...draft, ...latest.current})}>
              <Icon name="delete" size={17} />
            </button>
          </>
        )} />
    </section>
  );
}

/** A reply's quote, folded behind "…". Opened, it can be trimmed: the recipient gets it as it's left. */
function Quote({draft, message, timeZone}: {draft: DraftOut; message: MessageOut | undefined; timeZone: string}) {
  const [shown, setShown] = useState(false);
  const field = useRef<HTMLDivElement>(null);
  const owedQuote = unsaved(draft.id).quote;
  const blocks = (owedQuote === undefined ? draft.quote : owedQuote) ?? (message ? quoteOf(message) : null);
  useLayoutEffect(() => {
    if (shown && field.current && blocks) mountBlocks(field.current, blocks);
    // Mounted as it opens: from then on the text is the user's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);
  if (!message) return null;
  return (
    <div className="cmp-quote">
      <button className="cmp-fold" type="button" aria-expanded={shown} aria-label={shown ? 'Hide the quoted email' : 'Show the quoted email'}
        data-tip={shown ? 'Hide the quoted email' : 'Show the quoted email'} onMouseDown={event => event.preventDefault()} onClick={() => setShown(!shown)}>
        <Icon name="more_horiz" size={16} />
      </button>
      {shown && (
        <>
          <div className="cmp-quote-line">{replyLine(message, timeZone)}</div>
          <div ref={field} className="desc cmp-quote-text" contentEditable role="textbox" aria-multiline="true" aria-label="Quoted email" suppressContentEditableWarning spellCheck={false}
            onInput={event => queueSave(draft.id, {quote: readHtml(event.currentTarget.innerHTML, {literal: true}).blocks as Block[]})}
            onPaste={event => event.preventDefault()} onDrop={event => event.preventDefault()} />
        </>
      )}
    </div>
  );
}

/**
 * A forward's email, in full and not folded: its header lines as the recipient gets them, its
 * attachments as chips that can be taken off (the recipient gets the rest), then the email itself.
 */
function Forwarded({draft, message, timeZone}: {draft: DraftOut; message: MessageOut | undefined; timeZone: string}) {
  const [removed, setRemoved] = useState(() => unsaved(draft.id).removed_attachments ?? draft.removed_attachments);
  if (!message) return null;
  const files = message.attachments.filter(file => !removed.includes(file.id));
  const remove = (id: number) => {
    const next = [...removed, id];
    setRemoved(next);
    queueSave(draft.id, {removed_attachments: next});
  };
  const images = remoteImages(message.remote_content, hasRemoteContent(message.body_html), false);
  return (
    <div className="cmp-forward">
      <div className="cmp-forward-head">
        {forwardLines(message, timeZone).map(line => <div key={line}>{line}</div>)}
      </div>
      {files.length > 0 && (
        <div className="cmp-files">
          {files.map(file => (
            <span key={file.id} className="cmp-file" data-tip={file.filename} data-tip-quick>
              <Icon name={TYPE_GLYPHS[attachmentType(file)]} size={14} /><span className="ell">{file.filename}</span><span className="ink3">{attachmentLabel(file).split(' · ')[1]}</span>
              <button type="button" className="cmp-chip-x" aria-label={`Remove ${file.filename}`} onMouseDown={event => event.preventDefault()} onClick={() => remove(file.id)}>
                <Icon name="close" size={14} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="cmp-forward-body">
        {message.body_html ? <MailFrame messageId={message.id} show={images.load} title={message.subject} /> : (
          <div className="mailtext">{paragraphs(message.body_text).map((lines, index) => <p key={index}>{lines.join('\n')}</p>)}</div>
        )}
      </div>
    </div>
  );
}

const KIND_GLYPHS = {reply: 'reply', reply_all: 'reply_all', forward: 'forward'} as const;
const KIND_NAMES = {reply: 'Reply', reply_all: 'Reply all', forward: 'Forward'} as const;

/**
 * The reply-type menu, before From on a reply or a forward: Reply, Reply all (when the email has
 * others to reply to) and Forward turn the draft into that kind, keeping what was written. Edit
 * subject doubles as Forward: a reply becomes a forward that keeps its recipients too, its subject
 * a field and this menu gone, the caret in the body. Pop out reply pops it out (in the pane only).
 */
function ReplyType({kind, messageId, floating, onPopOut, onKind, onEditSubject}: {
  kind: 'reply' | 'reply_all' | 'forward';
  messageId: number | null;
  floating: boolean;
  onPopOut: () => void;
  onKind: (kind: 'reply' | 'reply_all' | 'forward') => void;
  onEditSubject: () => void;
}) {
  const [menu, setMenu] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (event: PointerEvent) => !anchor.current?.contains(event.target as Node) && setMenu(false);
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [menu]);
  const kinds = (['reply', 'reply_all', 'forward'] as const).filter(one => one !== 'reply_all' || kind === 'reply_all' || (messageId !== null && canReplyAll(messageId)));
  const choose = (run: () => void) => {
    setMenu(false);
    run();
  };
  return (
    <span className="menu-anchor cmp-type" ref={anchor} onKeyDown={event => {
      if (menu && event.key === 'Escape') {
        event.preventDefault();
        setMenu(false);
      }
    }}>
      <button className="btn quiet sm" type="button" aria-label={`${KIND_NAMES[kind]}, change`} aria-haspopup="menu" aria-expanded={menu}
        onMouseDown={event => event.preventDefault()} onClick={() => setMenu(!menu)}>
        <Icon name={KIND_GLYPHS[kind]} size={16} /><Icon name="expand_more" size={16} />
      </button>
      {menu && (
        <div className="pop menu cmp-type-menu" role="menu">
          {kinds.map(one => (
            <button key={one} type="button" role="menuitemradio" aria-checked={one === kind} className="menu-i" onMouseDown={event => event.preventDefault()} onClick={() => choose(() => onKind(one))}>
              <Icon name={KIND_GLYPHS[one]} size={16} /><span className="grow">{KIND_NAMES[one]}</span>{one === kind && <Icon name="check" size={16} />}
            </button>
          ))}
          <div className="menu-sep" />
          <button type="button" role="menuitem" className="menu-i" onMouseDown={event => event.preventDefault()} onClick={() => choose(onEditSubject)}>
            <Icon name="forward" size={16} /><span className="grow">Edit subject</span>
          </button>
          {!floating && <button type="button" role="menuitem" className="menu-i plain" onMouseDown={event => event.preventDefault()} onClick={() => choose(onPopOut)}>Pop out {kind === 'forward' ? 'forward' : 'reply'}</button>}
        </div>
      )}
    </span>
  );
}

/** From: the account's colour and label, and the address it sends as. Each account lists its aliases under it. */
function FromPicker({value, from, accounts, onChange}: {
  value: {account_id: number; address: string};
  from: FromOut | undefined;
  accounts: Map<number, AccountOut>;
  onChange: (value: {account_id: number; address: string}) => void;
}) {
  const [menu, setMenu] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const account = accounts.get(value.account_id);
  const choices = (from?.accounts ?? []).flatMap(one => one.addresses.map(address => ({account_id: one.account_id, ...address})));
  const chosen = choices.findIndex(one => one.account_id === value.account_id && one.address === value.address);
  const [cursor, setCursor] = useState(0);
  useEffect(() => {
    if (!menu) return;
    const away = (event: PointerEvent) => !anchor.current?.contains(event.target as Node) && setMenu(false);
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [menu]);
  const pick = (index: number) => {
    const one = choices[index];
    setMenu(false);
    anchor.current?.querySelector('button')?.focus();
    if (one && (one.account_id !== value.account_id || one.address !== value.address)) onChange({account_id: one.account_id, address: one.address});
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!menu) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setCursor(Math.max(0, chosen));
        setMenu(true);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setMenu(false);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor((cursor + (event.key === 'ArrowDown' ? 1 : -1) + choices.length) % choices.length);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      pick(cursor);
    }
  };
  return (
    <span className="menu-anchor cmp-from" ref={anchor} onKeyDown={onKeyDown}>
      <button className="btn quiet sm" type="button" aria-haspopup="menu" aria-expanded={menu} onClick={() => {
        setCursor(Math.max(0, chosen));
        setMenu(!menu);
      }}>
        <span className="dot sm" style={dotStyle(account?.colour)} />{account?.label}<span className="ink3">{value.address}</span><Icon name="expand_more" size={16} />
      </button>
      {menu && (
        <div className="pop menu cmp-from-menu" role="menu">
          {choices.map((one, index) => {
            const owner = accounts.get(one.account_id);
            return (
              <button key={`${one.account_id}:${one.address}`} type="button" role="menuitemradio" aria-checked={index === chosen}
                className={['menu-i', !one.primary && 'alias', index === cursor && 'cur'].filter(Boolean).join(' ')}
                onPointerMove={() => setCursor(index)} onClick={() => pick(index)}>
                {one.primary ? <><span className="dot sm" style={dotStyle(owner?.colour)} /><span>{owner?.label}</span></> : null}
                <span className={one.primary ? 'ink3 grow' : 'grow'}>{one.address}</span>
                {index === chosen && <Icon name="check" size={16} />}
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}

/**
 * A recipient field: chips, then what's being typed. Enter, Tab, a comma or leaving the field makes
 * what's typed a chip when it's an address (Send leaves the field first, so it counts too). Backspace on an empty field takes the last chip back.
 * While something is typed, people from the user's mail are suggested under it (↑ ↓ and Enter).
 */
export function RecipientField({label, recipients, onChange, inputRef}: {
  label: string;
  recipients: Recipient[];
  onChange: (recipients: Recipient[]) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const [text, setText] = useState('');
  const [offered, setOffered] = useState<{for: string; people: Recipient[]}>({for: '', people: []});
  const [cursor, setCursor] = useState(0);
  const [focused, setFocused] = useState(false);
  const own = useRef<HTMLInputElement>(null);
  const input = inputRef ?? own;
  const query = text.trim();
  // Suggestions for what's typed, asked a moment after the last letter. An answer for older text is dropped.
  useEffect(() => {
    if (!query) return;
    const timer = window.setTimeout(() => void suggestPeople(query).then(people => setOffered(current => (current.for === query ? current : {for: query, people})), () => {}), 120);
    return () => window.clearTimeout(timer);
  }, [query]);
  const taken = new Set(recipients.map(one => one.address));
  const people = focused && query && offered.for === query ? offered.people.filter(person => !taken.has(person.address)) : [];
  const at = Math.min(cursor, Math.max(0, people.length - 1));
  const add = (added: Recipient[]) => {
    onChange(withRecipients(recipients, added));
    setText('');
    setCursor(0);
  };
  const commit = (): boolean => {
    const typed = readRecipient(text);
    if (!typed) return false;
    add([typed]);
    return true;
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!people.length) return;
      event.preventDefault();
      setCursor((at + (event.key === 'ArrowDown' ? 1 : -1) + people.length) % people.length);
    } else if ((event.key === 'Enter' || event.key === 'Tab') && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
      if (people.length) {
        event.preventDefault();
        add([people[at]!]);
      } else if (query && commit()) {
        event.preventDefault();
      } else if (event.key === 'Enter') {
        event.preventDefault();
      }
    } else if (event.key === 'Backspace' && !text && recipients.length) {
      event.preventDefault();
      onChange(recipients.slice(0, -1));
    } else if (event.key === 'Escape' && people.length) {
      // The suggestions go first; Esc again closes the composer.
      event.preventDefault();
      setOffered({for: '', people: []});
    }
  };
  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text/plain');
    const read = readRecipients(pasted);
    if (!read.recipients.length) return;
    event.preventDefault();
    onChange(withRecipients(recipients, read.recipients));
    setText(read.rest);
  };
  const invalid = !focused && query !== '' && !readRecipient(text);
  return (
    <div className="cmp-recipients grow" onClick={() => input.current?.focus()}>
      {recipients.map(recipient => (
        <span key={recipient.address} className="cmp-chip" data-tip={recipient.name ? recipient.address : undefined} data-tip-quick>
          {chipLabel(recipient)}
          <button type="button" className="cmp-chip-x" aria-label={`Remove ${chipLabel(recipient)}`} tabIndex={-1}
            onClick={event => {
              event.stopPropagation();
              onChange(recipients.filter(one => one.address !== recipient.address));
            }}><Icon name="close" size={14} /></button>
        </span>
      ))}
      <span className="menu-anchor grow cmp-typing">
        <input ref={input} className={invalid ? 'invalid' : undefined} aria-label={label} value={text} spellCheck={false} autoComplete="off"
          data-tip={invalid ? 'Not an email address' : undefined}
          onChange={event => {
            const value = event.target.value;
            setCursor(0);
            // A comma or semicolon after an address makes it a chip.
            if (/[,;]\s*$/.test(value)) {
              const read = readRecipients(value);
              if (read.recipients.length) {
                onChange(withRecipients(recipients, read.recipients));
                setText(read.rest);
                return;
              }
            }
            setText(value);
          }}
          onKeyDown={onKeyDown} onPaste={onPaste}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            commit();
          }} />
        {people.length > 0 && (
          <div className="pop menu cmp-people" role="listbox" aria-label="Suggestions">
            {people.map((person, index) => (
              <button key={person.address} type="button" role="option" aria-selected={index === at} className={index === at ? 'menu-i cur' : 'menu-i'}
                onPointerMove={() => setCursor(index)} onMouseDown={event => event.preventDefault()} onClick={() => add([person])}>
                {person.name ? <><span>{person.name}</span><span className="ink3 ell">{person.address}</span></> : <span>{person.address}</span>}
              </button>
            ))}
          </div>
        )}
      </span>
    </div>
  );
}

/** Every open composer, each mounted once on the desktop, into the host its places take in turn. */
export function ComposerRoot() {
  const composers = useComposers();
  // A closed composer's host goes once it has unmounted.
  useEffect(() => pruneHosts(composers.map(one => one.key)), [composers]);
  return <>{composers.map(open => <Mounted key={open.key} open={open} />)}</>;
}

function Mounted({open}: {open: OpenComposer}) {
  const {byId: accounts} = useAccounts();
  const {data} = useResource<MessageOut>(open.messageId === null ? null : messagePath(open.messageId));
  const message = data?.id === open.messageId ? data : undefined;
  return createPortal(<Composer open={open} message={message} accounts={accounts} timeZone={userTimeZone()} />, composerHost(open.key));
}

/** A place composer `composerKey` shows in. */
export function ComposerPlace({composerKey}: {composerKey: number}) {
  const place = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = place.current!;
    attach(composerKey, element);
    return () => detach(composerKey, element);
  }, [composerKey]);
  return <div ref={place} className="cmp-place" />;
}

/** The reader's place for the composer, under the email: the pane's one, when it's this email's. */
export function ComposerSlot({open, messageId}: {open: OpenComposer | null; messageId: number}): ReactNode {
  if (!open || open.floating || open.messageId !== messageId) return null;
  return <ComposerPlace composerKey={open.key} />;
}

/**
 * The windows, in the main area's bottom right corner over any page, lined up leftward in the
 * order they popped out. Their tops stay under the reading pane's tools, and the toast shows over
 * them. When they don't all fit, the one touched longest ago folds to its title bar first, and
 * once even the bars don't fit, the oldest go into a "+N" chip at the row's left end.
 */
export function ComposerWindows() {
  const windows = useComposers().filter(one => one.floating);
  const row = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  const any = windows.length > 0;
  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return;
    const measure = () => setRoom(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [any]);
  const {fold, hidden} = room ? arrangeWindows(windows, room) : {fold: [], hidden: []};
  // Folded in the store, so a window stays folded until the user brings it back.
  useLayoutEffect(() => foldWindows(fold));
  if (!any) return null;
  const {at, end} = placeWindows(windows, hidden, room);
  return (
    <div ref={row} className="cmp-windows">
      {windows.map(open => (
        <section key={open.key} className={['cmp-window', open.minimized && 'min', hidden.includes(open.key) && 'shut'].filter(Boolean).join(' ')} aria-label="Composer window"
          style={{right: at.get(open.key)?.right, width: at.get(open.key)?.width}}>
          <ComposerPlace composerKey={open.key} />
        </section>
      ))}
      {hidden.length > 0 && <MoreWindows draftIds={windows.filter(one => hidden.includes(one.key)).map(one => one.draftId)} right={end} />}
    </div>
  );
}

/** The "+N" chip for windows that don't fit even as bars: its menu brings one back. */
function MoreWindows({draftIds, right}: {draftIds: number[]; right: number}) {
  const [menu, setMenu] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (event: PointerEvent) => !anchor.current?.contains(event.target as Node) && setMenu(false);
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [menu]);
  return (
    <div ref={anchor} className="menu-anchor cmp-more" style={{right}}>
      <button className="cmp-more-btn" type="button" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>+{draftIds.length}</button>
      {menu && (
        <div className="pop menu cmp-more-menu" role="menu">
          {draftIds.map(id => <MoreItem key={id} draftId={id} onPick={() => setMenu(false)} />)}
        </div>
      )}
    </div>
  );
}

function MoreItem({draftId, onPick}: {draftId: number; onPick: () => void}) {
  const {data: draft} = useResource<DraftOut>(draftPath(draftId));
  return (
    <button type="button" role="menuitem" className="menu-i" onClick={() => {
      onPick();
      toggleMinimized(draftId);
    }}>
      <span className="ell">{draft ? draft.subject.trim() || (draft.kind === 'new' ? 'New message' : 'No subject') : ''}</span>
      {draft?.to[0] && <span className="ink3 ell">{chipLabel(draft.to[0])}{draft.to.length > 1 ? ` +${draft.to.length - 1}` : ''}</span>}
    </button>
  );
}

/** Drafts, watched on every desktop page, so a send the provider refused comes back wherever the user is. */
export function SendWatch() {
  const {data} = useResource<DraftsOut>(DRAFTS_PATH);
  useEffect(() => watchSends(data?.drafts), [data]);
  return null;
}

/** A new message's pane on a mail page: the composer by itself, at the reading pane's width. */
export function NewMessagePane({open}: {open: OpenComposer}) {
  const width = useReadingPaneWidth();
  return (
    <section className="pane writing" aria-label="New message" style={{'--readingPane': `${width}px`} as CSSProperties}>
      <PaneEdge width={width} />
      <ComposerPlace composerKey={open.key} />
    </section>
  );
}
