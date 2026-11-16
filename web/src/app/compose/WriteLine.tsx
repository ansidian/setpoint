// Help me write: the Alfred-marked button in the composer's format row, or ⌘J, opens a one-line
// prompt right above the row. Over an empty body it reads "Describe your message", over text
// "Describe your change". Enter writes the draft into the body; with text selected in the body, only
// the selection changes. The line stays open after a draft so the user can refine it, and undo and
// redo beside it step between the body's versions (logic/composer.ts › recordVersion). Esc closes the
// line and puts the caret back in the body. The line, what it asked and the versions are saved with
// the draft.
//
// While it works the line says so and takes no new ask; the body stays the user's to type in, and the
// answer replaces it as it is when the answer comes (undo brings that back). A failure leaves the body
// as it was and says why under the line. The AI fills the body only: never recipients, the subject or
// the quote, and it never sends.
import type {DraftWriteState} from '@setpoint/shared';
import {plainText} from '@setpoint/shared/richText';
import {useEffect, useRef, useState} from 'react';
import type {RefObject} from 'react';
import {canRedo, canUndo, NO_VERSIONS, recordVersion, redoVersion, undoVersion, writePlaceholder} from '../../logic/composer.ts';
import type {Versions} from '../../logic/composer.ts';
import type {Block} from '../../logic/description.ts';
import {Icon} from '../../ui/Icon.tsx';
import {mountBlocks} from '../calendar/DescriptionField.tsx';
import {helpMeWrite, takeWritten, useWriting, writeError} from './composer.ts';

export const NO_WRITE: DraftWriteState = {prompt: '', open: false, ...NO_VERSIONS};

/** The selection in the body the line will change: kept as the caret leaves the body for the line. */
interface Selected {
  range: Range;
  text: string;
}

// The selection shows while the line has the caret, as the body's own selection would.
const HIGHLIGHT = 'cmp-write';
function highlight(range: Range | null) {
  const highlights = typeof CSS !== 'undefined' && 'highlights' in CSS ? CSS.highlights : null;
  if (!highlights || typeof Highlight === 'undefined') return;
  if (range) highlights.set(HIGHLIGHT, new Highlight(range));
  else highlights.delete(HIGHLIGHT);
}

/**
 * The composer's side of help me write: the saved line and versions, the body's selection, and the
 * answer put into the body. `body` is the editable field; `current` reads its blocks as they are now.
 */
export function useHelpMeWrite({draftId, initial, body, current, onWrite}: {
  draftId: number;
  initial: DraftWriteState | null;
  body: RefObject<HTMLDivElement | null>;
  current: () => Block[];
  // The line or versions changed: the composer keeps them and saves them with the draft.
  onWrite: (write: DraftWriteState) => void;
}) {
  // The line and versions as drawn, and as of the last change for what runs between renders.
  const [shown, setShown] = useState<DraftWriteState>(initial ?? NO_WRITE);
  const write = useRef<DraftWriteState>(shown);
  const selected = useRef<Selected | null>(null);
  // Each opening asks the line for the caret.
  const [focusAsks, setFocusAsks] = useState(0);
  const writing = useWriting(draftId);
  const set = (changes: Partial<DraftWriteState>) => {
    write.current = {...write.current, ...changes};
    setShown(write.current);
    onWrite(write.current);
  };

  // The body's selection, kept while the caret is elsewhere (in the line). A caret back in the body
  // with nothing selected lets it go.
  useEffect(() => {
    const track = () => {
      const selection = document.getSelection();
      const field = body.current;
      if (!selection || !field || !selection.rangeCount || !field.contains(selection.anchorNode)) return;
      selected.current = selection.isCollapsed || !selection.toString().trim() ? null : {range: selection.getRangeAt(0).cloneRange(), text: selection.toString()};
    };
    document.addEventListener('selectionchange', track);
    return () => {
      document.removeEventListener('selectionchange', track);
      highlight(null);
    };
  }, [body]);

  /** The body's blocks replaced from outside, through the field's own input so it reads them as typed. */
  const replaceBody = (blocks: Block[]) => {
    const field = body.current;
    if (!field) return;
    mountBlocks(field, blocks);
    field.dispatchEvent(new Event('input', {bubbles: true}));
  };

  // What's written comes here, for as long as this composer shows the draft.
  useEffect(() => takeWritten(draftId, (blocks, toSelection) => {
    const before = current();
    if (toSelection) {
      const kept = selected.current;
      const field = body.current;
      if (!kept || !field || !field.contains(kept.range.commonAncestorContainer)) {
        writeError(draftId, 'The selection changed while it was written; select the text again.');
        return;
      }
      field.focus();
      const selection = document.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(kept.range);
      // Typed in as the user would, so the field reads it and the browser's own undo has it too.
      document.execCommand('insertText', false, plainText(blocks));
      selected.current = null;
      highlight(null);
    } else {
      replaceBody(blocks);
    }
    const versions = recordVersion(write.current, before, current());
    set(versions);
  }), [draftId]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = () => {
    if (!write.current.open) set({open: true});
    setFocusAsks(asks => asks + 1);
  };
  const close = () => {
    set({open: false});
    highlight(null);
    const field = body.current;
    if (!field) return;
    field.focus();
    const kept = selected.current;
    if (kept && field.contains(kept.range.commonAncestorContainer)) {
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(kept.range);
    }
  };
  const submit = () => {
    const prompt = write.current.prompt.trim();
    if (!prompt || writing.working) return;
    const kept = selected.current && body.current?.contains(selected.current.range.commonAncestorContainer) ? selected.current : null;
    void helpMeWrite(draftId, {prompt, body: current(), selection: kept?.text ?? null});
  };
  const step = (stepped: {state: Versions; body: Block[]} | null) => {
    if (!stepped) return;
    replaceBody(stepped.body);
    set(stepped.state);
  };

  return {
    write: shown, writing, focusAsks, open, close, submit,
    prompt: (prompt: string) => {
      set({prompt});
      if (writing.error) writeError(draftId, null);
    },
    undo: () => step(undoVersion(write.current, current())),
    redo: () => step(redoVersion(write.current, current())),
    canUndo: (body: Block[]) => canUndo(shown, body),
    canRedo: (body: Block[]) => canRedo(shown, body),
    // The body's selection drawn while the line has the caret.
    showSelection: () => highlight(selected.current && body.current?.contains(selected.current.range.commonAncestorContainer) ? selected.current.range : null),
  };
}

export type HelpMeWrite = ReturnType<typeof useHelpMeWrite>;

/** The button in the format row. */
export function WriteButton({help}: {help: HelpMeWrite}) {
  return (
    <button className="ibtn sm" type="button" aria-label="Help me write" data-tip="Help me write · ⌘J" aria-pressed={help.write.open}
      onMouseDown={event => event.preventDefault()} onClick={() => (help.write.open ? help.close() : help.open())}>
      <Icon name="auto_awesome" size={17} alfred />
    </button>
  );
}

/** The line, above the format row while it's open. */
export function WriteLine({help, body}: {help: HelpMeWrite; body: Block[]}) {
  const input = useRef<HTMLInputElement>(null);
  const {focusAsks, write: {open}} = help;
  useEffect(() => {
    if (open && focusAsks) input.current?.focus();
  }, [open, focusAsks]);
  if (!open) return null;
  const {writing} = help;
  return (
    <div className="cmp-write-wrap">
      <div className={writing.working ? 'cmp-write working' : 'cmp-write'} role="group" aria-label="Help me write" aria-busy={writing.working}>
        {writing.working ? <span className="spin"><Icon name="progress_activity" size={16} /></span> : <Icon name="auto_awesome" size={16} alfred />}
        <input ref={input} className="grow" aria-label="Help me write" placeholder={writePlaceholder(body)} value={help.write.prompt} readOnly={writing.working} spellCheck={false}
          onChange={event => help.prompt(event.target.value)}
          onFocus={help.showSelection} onBlur={() => highlight(null)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
              event.preventDefault();
              help.submit();
            } else if (event.key === 'Escape') {
              // The line first; Esc again closes the composer.
              event.preventDefault();
              help.close();
            }
          }} />
        {writing.working && <span className="ink3 cmp-write-state">Writing…</span>}
        <button className="ibtn sm" type="button" aria-label="Undo" data-tip="Undo" disabled={writing.working || !help.canUndo(body)} onMouseDown={event => event.preventDefault()} onClick={help.undo}>
          <Icon name="undo" size={16} />
        </button>
        <button className="ibtn sm" type="button" aria-label="Redo" data-tip="Redo" disabled={writing.working || !help.canRedo(body)} onMouseDown={event => event.preventDefault()} onClick={help.redo}>
          <Icon name="redo" size={16} />
        </button>
      </div>
      {writing.error && <div className="cmp-write-error" role="alert"><Icon name="error" size={16} /><span className="grow">{writing.error}</span></div>}
    </div>
  );
}
