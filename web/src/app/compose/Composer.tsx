// The composer, in the reading pane under the email it answers (the email scrolls above it). From
// is the account's colour and label, its Gmail aliases under each account. Popped out, a title bar
// leads it: the subject, or "New message". To is always there; Cc
// and Bcc show together with ⌘⇧B or the Cc Bcc button (and by themselves when the draft has them),
// stay once shown, and hide again on ⌘⇧B when both are empty. A recipient is a chip with a name or an address; typing
// suggests people from the user's mail. A new message has a subject field; a reply's or a
// forward's subject is the server's ("Re: …", "Fwd: …"), shown as the window's title.
// The body is the description field's rich text, with its format row always there; a reply's quote
// is folded behind "…" and opens to be trimmed (the recipient gets the quote as it is left).
//
// Keys: ⌘Enter sends, ⌘⇧B shows Cc and Bcc, ⌘J opens help me write's line (WriteLine.tsx), Esc
// closes it (the draft kept). The format row leads with Send, has Attach and help me write after the
// formats, and ends with Discard (no key). Files come by Attach, a drop anywhere on the composer or
// a pasted image; each is a chip under the user's text with its name and size, a forward's kept
// originals among them, and the reason one was refused shows over them. The top right pops it out into a floating window (no
// key), and the same button docks it again; the format row keeps a place for buttons of its own.
//
// Waiting for the server to start its draft (composer.ts), it shows its fields in their places at
// once: To, the subject of a new message, the body and the format row are live, and what the server
// has yet to fill (From, a reply's recipients, Reply all's Cc, the quote) draws its skeleton. The
// answer fills those in around what was typed; the rows were there from the start, Reply all's Cc
// and Bcc too when the shared fill rule says it has Cc, so nothing moves.
//
// It is mounted once, by ComposerRoot, into the host element its places take in turn (place.ts):
// the reader under its email, a new message's pane, Drafts' pane and the floating window.
import type {AccountOut, DraftOut, DraftsOut, DraftUpdateInput, FromOut, MessageOut, Recipient} from '@setpoint/shared';
import {isEmpty, sameDescription} from '@setpoint/shared/richText';
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import type {ClipboardEvent, CSSProperties, DragEvent, KeyboardEvent, ReactNode, RefObject} from 'react';
import {ApiFailure, useResource} from '../../api/client.ts';
import {timeZone as userTimeZone} from '../../api/auth.ts';
import {draftPath, DRAFTS_PATH, FROM_PATH, suggestPeople} from '../../api/drafts.ts';
import {messagePath} from '../../api/mail.ts';
import {paragraphs} from '../../logic/body.ts';
import {chipLabel, forwardLines, quoteOf, readRecipient, readRecipients, replyLine, startsWithCopies, withRecipients} from '../../logic/composer.ts';
import {attachmentType, fileSize, hasRemoteContent, remoteImages} from '../../logic/reader.ts';
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
import {attachFiles, canReplyAll, closeComposer, closeComposerAt, discard, dismissFileError, dock, foldWindows, popOut, queueSave, queueTyped, removeFile, switchKind, toggleMinimized, send, unsaved, useComposers, useFills, useFileError, useSaveError, useUploads, watchSends} from './composer.ts';
import type {OpenComposer} from './composer.ts';
import {attach, composerHost, detach, pruneHosts, whenPlaced} from './place.ts';
import {Bar, Dot, Sk} from '../states/Loading.tsx';
import {useHelpMeWrite, WriteButton, WriteLine} from './WriteLine.tsx';
import './compose.css';

export function Composer({open, message, accounts, timeZone}: {
  open: OpenComposer;
  // The email it answers, once it's in (for the quote).
  message: MessageOut | undefined;
  accounts: Map<number, AccountOut>;
  timeZone: string;
}) {
  const {data, error} = useResource<DraftOut>(open.draftId === null ? null : draftPath(open.draftId));
  const {data: from} = useResource<FromOut>(FROM_PATH);
  // Gone meanwhile (sent or discarded elsewhere): nothing left to write.
  const gone = error instanceof ApiFailure && error.status === 404;
  useEffect(() => {
    if (gone && open.draftId !== null) closeComposer(open.draftId);
  }, [gone, open.draftId]);
  // One Fields from the key to the draft's arrival, so what's typed and the caret stay.
  const draft = data && data.id === open.draftId ? data : null;
  return <Fields draft={draft} open={open} from={from} message={message} accounts={accounts} timeZone={timeZone} />;
}

/** What a composer waiting for its draft has before the server fills it. */
const WAITING = {from: {account_id: 0, address: ''}, to: [], cc: [], bcc: [], subject: '', body: []};

function Fields({draft, open, from, message, accounts, timeZone}: {
  // Null while the server starts it.
  draft: DraftOut | null;
  open: OpenComposer;
  from: FromOut | undefined;
  message: MessageOut | undefined;
  accounts: Map<number, AccountOut>;
  timeZone: string;
}) {
  // What the user has, from the draft as it was when the composer opened, with any change the server
  // is still owed. From then on it's theirs.
  const [fields, setFields] = useState<Pick<DraftOut, 'from' | 'to' | 'cc' | 'bcc' | 'subject' | 'body'>>(() => {
    if (!draft) return WAITING;
    const {from, to, cc, bcc, subject, body} = {...draft, ...unsaved(draft.id)} as DraftOut;
    return {from, to, cc, bcc, subject, body};
  });
  const kind = open.kind;
  const waiting = draft === null;
  // Cc and Bcc show when the draft has them, and while it's on its way when it will (Reply all's
  // other recipients), so their rows don't push in when it comes.
  const [copies, setCopies] = useState(() => (draft ? draft.cc.length + draft.bcc.length > 0 : startsWithCopies(kind, message, from)));
  // A reply's or forward's subject shows as a field once the reply-type menu's Edit subject asks.
  // After it, the reply-type menu is gone.
  const [subjectShown, setSubjectShown] = useState(kind === 'new' || open.subjectEdited);
  const subjectField = useRef<HTMLInputElement>(null);
  const saveError = useSaveError(draft?.id ?? null);
  const body = useRef<HTMLDivElement>(null);
  const to = useRef<HTMLInputElement>(null);
  const cc = useRef<HTMLInputElement>(null);
  const bcc = useRef<HTMLInputElement>(null);
  // The fields as of the last change, for Send right after one (an address typed, then ⌘Enter).
  const latest = useRef(fields);
  const waitedFor = useRef(draft === null);
  // A change is saved into the draft, or, while it's on its way, kept for it.
  const save = (changes: DraftUpdateInput) => (draft ? queueSave(draft.id, changes) : queueTyped(open.key, changes));
  const change = <K extends keyof typeof fields>(key: K, value: (typeof fields)[K]) => {
    latest.current = {...latest.current, [key]: value};
    setFields(latest.current);
    save({[key]: value});
  };
  // Help me write's line and the body's versions, saved with the draft.
  const help = useHelpMeWrite({
    draftId: draft?.id ?? null, initial: draft ? ({...draft, ...unsaved(draft.id)} as DraftOut).write : null, body, current: () => latest.current.body,
    onWrite: write => save({write}),
  });
  // A forward's originals the user took off it: they leave the chips, and the rest go with it.
  const [removed, setRemoved] = useState(() => (draft ? unsaved(draft.id).removed_attachments ?? draft.removed_attachments : []));
  const originals = kind === 'forward' && message ? message.attachments : [];
  const removeOriginal = (id: number) => {
    const next = [...removed, id];
    setRemoved(next);
    save({removed_attachments: next});
  };
  // Files wait for the draft: there's nowhere to upload them before it.
  const attach = (files: File[]) => draft && attachFiles(draft.id, files, originals, removed);

  // The draft arrived, or words typed before Esc came in with it while this composer had it open:
  // what came in goes around what was typed (already saved into it), before the frame is drawn. The
  // body is drawn again only when it changed, the caret after what was typed here.
  const [arrived, setArrived] = useState(false);
  const fills = useFills(open.key);
  const drawnFills = useRef(fills);
  useLayoutEffect(() => {
    if (!draft) return;
    const arriving = waitedFor.current;
    if (!arriving && fills === drawnFills.current) return;
    waitedFor.current = false;
    drawnFills.current = fills;
    const now = {...draft, ...unsaved(draft.id)} as DraftOut;
    const shown = latest.current.body;
    latest.current = {from: now.from, to: now.to, cc: now.cc, bcc: now.bcc, subject: now.subject, body: now.body};
    setFields(latest.current);
    if (now.cc.length + now.bcc.length > 0) setCopies(true);
    setRemoved(now.removed_attachments);
    if (arriving) help.adopt(now.write);
    const field = body.current;
    if (field && !sameDescription(now.body, shown)) {
      const caret = document.activeElement === field;
      mountBlocks(field, now.body);
      if (caret) {
        // After what was typed here, which is last; at the start when nothing was.
        const range = document.createRange();
        range.selectNodeContents(field);
        range.collapse(isEmpty(shown));
        document.getSelection()?.removeAllRanges();
        document.getSelection()?.addRange(range);
      }
    }
    // No one to send to after all, and nothing written yet: the caret goes to To, as it would have.
    const someone = now.to.length + now.cc.length + now.bcc.length > 0;
    if (arriving && !someone && isEmpty(now.body) && document.activeElement === field) to.current?.focus();
    if (arriving) setArrived(true);
    // As it arrives, and as each fill comes in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id, fills]);
  const picker = useRef<HTMLInputElement>(null);
  // A drag with files over the composer: it says where they'll go.
  const [dropping, setDropping] = useState(false);
  const carriesFiles = (event: DragEvent) => event.dataTransfer.types.includes('Files');
  const failed = draft?.send?.state === 'failed' ? draft.send.error : null;
  // Send: an address still being typed becomes a chip first (the field's leaving does it). With
  // no one to send to, the caret goes to To.
  const sendNow = () => {
    if (!draft) return;
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
  // ⌘⇧B again hides them when both are empty, words typed in them included; the caret, if it was
  // in them, goes to To.
  const toggleCopies = () => {
    if (!copies) return showCopies();
    const typed = [cc, bcc].some(field => field.current?.value.trim());
    if (fields.cc.length || fields.bcc.length || typed) return cc.current?.focus();
    const inside = [cc, bcc].some(field => field.current === document.activeElement);
    setCopies(false);
    if (inside) to.current?.focus();
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
      closeComposerAt(open.key);
      return;
    }
    // The page's own letters (J, K, E, R…) stay out of the composer.
    if (!command && !event.altKey) event.stopPropagation();
  };

  return (
    <section className={`composer${dropping ? ' dropping' : ''}`} aria-label="Composer" onKeyDown={onKeyDown}
      onDragOver={event => {
        if (!carriesFiles(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setDropping(true);
      }}
      onDragLeave={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false);
      }}
      onDropCapture={event => {
        if (!carriesFiles(event)) return;
        // Before the fields' own drop, which keeps anything else out.
        event.preventDefault();
        event.stopPropagation();
        setDropping(false);
        attach([...event.dataTransfer.files]);
      }}
      // A pasted image (or any file) is attached, not put in the text.
      onPasteCapture={event => {
        const files = [...event.clipboardData.files];
        if (!files.length) return;
        event.preventDefault();
        event.stopPropagation();
        attach(files);
      }}>
      {/* Popped out: the title folds the window to its bar and back, and the pop-out button docks
          it. The caret stays where it was as the composer moves. */}
      {open.floating && (
        <div className="cmp-title" onMouseDown={event => event.preventDefault()} onClick={() => draft && toggleMinimized(draft.id)}>
          <button className="cmp-title-text ell" type="button" aria-expanded={!open.minimized} aria-label={open.minimized ? 'Open the window' : 'Minimize the window'}>
            {kind === 'new' ? 'New message' : fields.subject || (draft ? 'No subject' : '')}
          </button>
          <button className="ibtn sm" type="button" aria-label="Back in the reading pane" data-tip="Back in the reading pane"
            onClick={event => {
              event.stopPropagation();
              if (draft) dock(draft.id);
            }}><Icon name="pip" size={16} /></button>
        </div>
      )}
      <div className="cmp-row cmp-head">
        {!subjectShown && kind !== 'new' && (
          <ReplyType kind={kind} messageId={open.messageId} floating={open.floating} waiting={waiting} onPopOut={() => draft && popOut(draft.id)}
            onKind={next => draft && switchKind({...draft, ...latest.current}, next)}
            onEditSubject={() => {
              if (!draft) return;
              // Edit subject doubles as Forward: a reply becomes a forward that keeps its recipients.
              if (draft.kind !== 'forward') return switchKind({...draft, ...latest.current}, 'forward', {editSubject: true});
              setSubjectShown(true);
              requestAnimationFrame(() => body.current?.focus());
            }} />
        )}
        <span className="cmp-label">From</span>
        {draft ? <FromPicker value={fields.from} from={from} accounts={accounts} arrived={arrived} onChange={value => change('from', value)} /> : (
          <Sk kind="composer-from" className="cmp-from-sk"><Dot size={7} /><Bar w={58} /><Bar w={128} /></Sk>
        )}
        <span className="grow" />
        {!open.floating && (
          <button className="ibtn sm" type="button" aria-label="Pop out" data-tip="Pop out" onMouseDown={event => event.preventDefault()} onClick={() => draft && popOut(draft.id)}><Icon name="pip" size={16} /></button>
        )}
      </div>
      <div className="cmp-row">
        <span className="cmp-label">To</span>
        <RecipientField label="To" recipients={fields.to} inputRef={to} arrived={arrived} onChange={value => change('to', value)}
          waiting={waiting && (kind === 'reply' || kind === 'reply_all') ? <Sk kind="composer-to" className="cmp-chips-sk">{kind === 'reply_all' ? <><Bar w={76} h={24} /><Bar w={92} h={24} /></> : <Bar w={76} h={24} />}</Sk> : null} />
        {/* Click-only (and ⌘⇧B): Tab from To goes on to Subject. */}
        {!copies && <button className="btn quiet sm cmp-copies" type="button" tabIndex={-1} data-tip="Cc and Bcc · ⌘⇧B" onClick={showCopies}>Cc Bcc</button>}
      </div>
      {copies && (
        <div>
          <div className="cmp-row">
            <span className="cmp-label">Cc</span>
            <RecipientField label="Cc" recipients={fields.cc} inputRef={cc} arrived={arrived} onChange={value => change('cc', value)}
              waiting={waiting && kind === 'reply_all' ? <Sk kind="composer-cc" className="cmp-chips-sk"><Bar w={84} h={24} /></Sk> : null} />
          </div>
          <div className="cmp-row">
            <span className="cmp-label">Bcc</span>
            <RecipientField label="Bcc" recipients={fields.bcc} inputRef={bcc} onChange={value => change('bcc', value)} />
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
        after={(
          <>
            <Files draft={draft} originals={originals.filter(file => !removed.includes(file.id))} onRemoveOriginal={removeOriginal} />
            {kind === 'reply' || kind === 'reply_all' ? (draft ? <Quote draft={draft} message={message} timeZone={timeZone} arrived={arrived} /> : (
              <div className="cmp-quote"><Sk kind="composer-quote" className="cmp-fold-sk"><Bar w={30} h={18} /></Sk></div>
            )) : kind === 'forward' ? <Forwarded message={message} timeZone={timeZone} /> : null}
          </>
        )}
        beforeBar={<WriteLine help={help} body={fields.body} />}
        barStart={(
          <button className="btn cmp-send" type="button" onMouseDown={event => event.preventDefault()} onClick={sendNow}>
            Send<span className="kbd">⌘↵</span>
          </button>
        )}
        barEnd={(
          <>
            <button className="ibtn sm" type="button" aria-label="Attach files" data-tip="Attach files" onMouseDown={event => event.preventDefault()} onClick={() => picker.current?.click()}>
              <Icon name="attach_file" size={17} />
            </button>
            <input ref={picker} type="file" multiple hidden aria-hidden="true" tabIndex={-1} onChange={event => {
              attach([...event.currentTarget.files ?? []]);
              event.currentTarget.value = '';
            }} />
            <span className="cmp-bar-slot"><WriteButton help={help} /></span>
            <span className="grow" />
            <button className="ibtn sm danger" type="button" aria-label="Discard" data-tip="Discard" onMouseDown={event => event.preventDefault()} onClick={() => draft && discard({...draft, ...latest.current})}>
              <Icon name="delete" size={17} />
            </button>
          </>
        )} />
    </section>
  );
}

/** A reply's quote, folded behind "…". Opened, it can be trimmed: the recipient gets it as it's left. */
function Quote({draft, message, timeZone, arrived}: {draft: DraftOut; message: MessageOut | undefined; timeZone: string; arrived: boolean}) {
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
      <button className={arrived ? 'cmp-fold sk-arrive' : 'cmp-fold'} type="button" aria-expanded={shown} aria-label={shown ? 'Hide the quoted email' : 'Show the quoted email'}
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
 * The message's files, right under the user's text (above a quote or a forward): a forward's kept originals, then the user's own
 * in the order attached, then those still uploading. Each is a chip with its name and size, and its
 * x takes it off. The reason a file was refused shows over them until the next attach.
 */
function Files({draft, originals, onRemoveOriginal}: {draft: DraftOut | null; originals: MessageOut['attachments']; onRemoveOriginal: (id: number) => void}) {
  const uploads = useUploads(draft?.id ?? null);
  const error = useFileError(draft?.id ?? null);
  const own = draft?.files ?? [];
  if (!originals.length && !own.length && !uploads.length && !error) return null;
  const chip = (key: string, file: {filename: string; mime_type: string; size_bytes: number}, remove: (() => void) | null) => (
    <span key={key} className={`cmp-file${remove ? '' : ' uploading'}`} data-tip={file.filename} data-tip-quick>
      {remove ? <Icon name={TYPE_GLYPHS[attachmentType(file)]} size={14} /> : <span className="spin" aria-label="Uploading"><Icon name="progress_activity" size={14} /></span>}
      <span className="ell">{file.filename}</span><span className="ink3 num">{fileSize(file.size_bytes)}</span>
      {remove && (
        <button type="button" className="cmp-chip-x" aria-label={`Remove ${file.filename}`} onMouseDown={event => event.preventDefault()} onClick={remove}>
          <Icon name="close" size={14} />
        </button>
      )}
    </span>
  );
  return (
    <div className="cmp-attached">
      {error && (
        <div className="cmp-failed" role="alert">
          <Icon name="error" size={16} /><span className="grow">{error}</span>
          <button type="button" className="cmp-chip-x" aria-label="Dismiss" onClick={() => draft && dismissFileError(draft.id)}><Icon name="close" size={14} /></button>
        </div>
      )}
      {(originals.length > 0 || own.length > 0 || uploads.length > 0) && (
        <div className="cmp-files" aria-label="Attachments">
          {originals.map(file => chip(`o${file.id}`, file, () => onRemoveOriginal(file.id)))}
          {draft && own.map(file => chip(`f${file.id}`, file, () => removeFile(draft.id, file.id)))}
          {uploads.map(upload => chip(`u${upload.key}`, {filename: upload.name, mime_type: '', size_bytes: upload.size}, null))}
        </div>
      )}
    </div>
  );
}

/**
 * A forward's email, in full and not folded: its header lines as the recipient gets them, then the
 * email itself. Its attachments are chips with the user's own files (Files).
 */
function Forwarded({message, timeZone}: {message: MessageOut | undefined; timeZone: string}) {
  if (!message) return null;
  const images = remoteImages(message.remote_content, hasRemoteContent(message.body_html), false);
  return (
    <div className="cmp-forward">
      <div className="cmp-forward-head">
        {forwardLines(message, timeZone).map(line => <div key={line}>{line}</div>)}
      </div>
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
function ReplyType({kind, messageId, floating, waiting, onPopOut, onKind, onEditSubject}: {
  kind: 'reply' | 'reply_all' | 'forward';
  messageId: number | null;
  floating: boolean;
  // The draft is on its way: the menu opens once it's there.
  waiting: boolean;
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
        onMouseDown={event => event.preventDefault()} onClick={() => !waiting && setMenu(!menu)}>
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
function FromPicker({value, from, accounts, arrived, onChange}: {
  value: {account_id: number; address: string};
  // It replaced its skeleton: it fades in.
  arrived: boolean;
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
    <span className={arrived ? 'menu-anchor cmp-from sk-arrive' : 'menu-anchor cmp-from'} ref={anchor} onKeyDown={onKeyDown}>
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
export function RecipientField({label, recipients, onChange, inputRef, waiting = null, arrived = false}: {
  label: string;
  recipients: Recipient[];
  onChange: (recipients: Recipient[]) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  // The skeleton of the recipients the server has yet to fill, before what's typed.
  waiting?: ReactNode;
  // They replaced their skeleton: they fade in.
  arrived?: boolean;
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
      {waiting}
      {recipients.map(recipient => (
        <span key={recipient.address} className={arrived ? 'cmp-chip sk-arrive' : 'cmp-chip'} data-tip={recipient.name ? recipient.address : undefined} data-tip-quick>
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
      {hidden.length > 0 && <MoreWindows draftIds={windows.flatMap(one => (hidden.includes(one.key) && one.draftId !== null ? [one.draftId] : []))} right={end} />}
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
