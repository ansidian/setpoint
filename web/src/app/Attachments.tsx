// An email's attachments (DESIGN.md › The reader): 44 px cards, radius 14, 280 wide, with the type's
// tile (its colour and glyph, #122), the name and "PDF · 184 KB". PDF, image and CSV open a preview
// over the reading pane, which Esc or × closes. Every card and the preview's head offer Download; a
// card with no preview is one Download link (SV-25). An invitation (.ics) has Add to calendar, which
// reads the stored attachment on the server into the same review as an import from Calendar (SV-182,
// D441); one that can't be read says so in place of its size. Desktop only: on the phone (frozen,
// D275) it stays a Download link.
import type {AttachmentOut} from '@setpoint/shared';
import {useEffect, useState} from 'react';
import {timeZone} from '../api/auth.ts';
import {ApiFailure} from '../api/client.ts';
import {readIcsAttachment} from '../api/icsImport.ts';
import {attachmentBlob, attachmentUrl} from '../api/mail.ts';
import {attachmentLabel, attachmentType, parseCsv, previewKind} from '../logic/reader.ts';
import type {AttachmentType, PreviewKind} from '../logic/reader.ts';
import type {IconName} from '../ui/glyphs.ts';
import {Icon} from '../ui/Icon.tsx';
import {landIcs} from './calendar/importRun.ts';
import {openContextMenu} from './ContextMenu.tsx';
import {usePhone} from './Phone.tsx';
import {PreviewSkeleton} from './states/Skeletons.tsx';
import {failureLine} from './toast.ts';

const CSV_ROWS = 500;

/** Each type's glyph on its tile; the tile's colour is the stylesheet's, by `data-type`. */
const TYPE_GLYPHS: Record<AttachmentType, IconName> = {
  pdf: 'picture_as_pdf', image: 'image', sheet: 'table_chart', doc: 'description', archive: 'folder_zip', calendar: 'calendar_month', other: 'draft',
};

export function Attachments({messageId, files}: {messageId: number; files: AttachmentOut[]}) {
  const [open, setOpen] = useState<AttachmentOut | null>(null);
  const phone = usePhone();
  if (!files.length) return null;
  return (
    <>
      <div className="attachments">
        {files.map(file => {
          const kind = previewKind(file);
          const type = attachmentType(file);
          if (type === 'calendar' && !phone) return <Invitation key={file.id} messageId={messageId} file={file} />;
          const about = (
            <>
              <span className="type"><Icon name={TYPE_GLYPHS[type]} /></span>
              <span className="grow names">
                <span className="ell name selectable">{file.filename}</span>
                <span className="size num">{attachmentLabel(file)}</span>
              </span>
            </>
          );
          return kind ? (
            // A right-click offers Preview and Download (#248); a card that's only a Download link keeps the browser's menu for it.
            <div key={file.id} className="attach" data-id={file.id} data-type={type} onContextMenu={event => openContextMenu(event, event.currentTarget, [
              {id: 'preview', label: 'Preview', icon: 'visibility', run: () => setOpen(file)},
              {id: 'download', label: 'Download', icon: 'download', run: () => download(attachmentUrl(messageId, file.id), file.filename)},
            ])}>
              <button type="button" className="open" onClick={() => setOpen(file)}>{about}<span className="look"><Icon name="visibility" size={16} /></span></button>
              <Download messageId={messageId} file={file} />
            </div>
          ) : (
            <a key={file.id} className="attach" data-id={file.id} data-type={type} href={attachmentUrl(messageId, file.id)} download={file.filename}>{about}<span className="dl"><Icon name="download" size={16} />Download</span></a>
          );
        })}
      </div>
      {open && <Preview key={open.id} messageId={messageId} file={open} kind={previewKind(open)!} onClose={() => setOpen(null)} />}
    </>
  );
}

/**
 * An .ics card: Add to calendar reads it on the server and lands where a file from Calendar would
 * (landIcs: the editor's draft, the review, or the toast when there's nothing to import). A file
 * that can't be read says so in place of its size, in the parser's words.
 */
function Invitation({messageId, file}: {messageId: number; file: AttachmentOut}) {
  const [reading, setReading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const add = () => {
    if (reading) return;
    setReading(true);
    setProblem(null);
    readIcsAttachment(messageId, file.id).then(read => {
      setReading(false);
      landIcs(file.filename, read, timeZone());
    }, (error: unknown) => {
      setReading(false);
      setProblem(error instanceof ApiFailure && error.code === 'invalid_input' ? error.message : failureLine(`Couldn't read ${file.filename}`, error));
    });
  };
  return (
    <div className="attach" data-id={file.id} data-type="calendar" onContextMenu={event => openContextMenu(event, event.currentTarget, [
      {id: 'add', label: 'Add to calendar', icon: 'event', run: add},
      {id: 'download', label: 'Download', icon: 'download', run: () => download(attachmentUrl(messageId, file.id), file.filename)},
    ])}>
      <span className="type"><Icon name="calendar_month" /></span>
      <span className="grow names">
        <span className="ell name selectable">{file.filename}</span>
        {problem ? <span className="size problem" role="alert">{problem}</span> : <span className="size num">{attachmentLabel(file)}</span>}
      </span>
      <button type="button" className="dl" disabled={reading} aria-busy={reading || undefined} onClick={add}><Icon name="event" size={16} />Add to calendar</button>
      <Download messageId={messageId} file={file} />
    </div>
  );
}

/** Download from a menu: as the card's own link would. */
function download(url: string, filename: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
}

function Download({messageId, file}: {messageId: number; file: AttachmentOut}) {
  return <a className="dl" href={attachmentUrl(messageId, file.id)} download={file.filename}><Icon name="download" size={16} />Download</a>;
}

type Loaded = {state: 'loading'} | {state: 'failed'; message: string} | {state: 'ready'; url: string; rows: string[][] | null};

function Preview({messageId, file, kind, onClose}: {messageId: number; file: AttachmentOut; kind: PreviewKind; onClose: () => void}) {
  const [loaded, setLoaded] = useState<Loaded>({state: 'loading'});

  useEffect(() => {
    let url: string | null = null;
    let live = true;
    attachmentBlob(messageId, file.id).then(async blob => {
      const rows = kind === 'csv' ? parseCsv(await blob.text(), CSV_ROWS) : null;
      url = URL.createObjectURL(kind === 'pdf' ? new Blob([blob], {type: 'application/pdf'}) : blob);
      if (live) setLoaded({state: 'ready', url, rows});
    }, (error: Error) => live && setLoaded({state: 'failed', message: error.message}));
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [messageId, file.id, kind]);

  // Esc closes the preview first, before the reader.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  return (
    <div className="attach-preview pop" role="dialog" aria-label={`Preview of ${file.filename}`}>
      <div className="preview-head">
        <span className="ell grow">{file.filename}</span>
        <span className="ink3 num">{attachmentLabel(file)}</span>
        <Download messageId={messageId} file={file} />
        <button type="button" className="ibtn sm" aria-label="Close preview" onClick={onClose}><Icon name="close" size={16} /></button>
      </div>
      <div className="preview-body">
        {loaded.state === 'loading' && <PreviewSkeleton />}
        {loaded.state === 'failed' && <div className="preview-line">Couldn’t load the preview, {loaded.message}</div>}
        {loaded.state === 'ready' && kind === 'pdf' && <iframe className="preview-pdf" title={file.filename} src={loaded.url} />}
        {loaded.state === 'ready' && kind === 'image' && <img className="preview-image" alt={file.filename} src={loaded.url} />}
        {loaded.state === 'ready' && kind === 'csv' && (
          <table className="preview-csv">
            <tbody>
              {loaded.rows!.map((row, index) => <tr key={index}>{row.map((cell, at) => <td key={at}>{cell}</td>)}</tr>)}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
