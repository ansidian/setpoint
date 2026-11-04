// SV-190: a file dragged over the month or week grid (DESIGN.md #305). The grid's section takes the
// drop and lights while one is over it (`data-file-drop`, calendar.css), its pill at the centre
// saying whether it will import; the right pane takes none.
import {useEffect, useRef, useState} from 'react';
import type {DOMAttributes, DragEvent as ReactDragEvent} from 'react';
import {fileDrag, FILE_DRAG_LINES} from '../../logic/icsImport.ts';
import type {FileDrag} from '../../logic/icsImport.ts';
import {Icon} from '../../ui/Icon.tsx';

/** What a grid's section takes: the handlers, and what's over it for `data-file-drop`. */
export interface FileDropBinding {
  over: FileDrag;
  handlers: Required<Pick<DOMAttributes<HTMLElement>, 'onDragEnter' | 'onDragOver' | 'onDragLeave' | 'onDrop'>>;
}

const dragOf = (event: ReactDragEvent) => fileDrag([...event.dataTransfer.types], [...event.dataTransfer.items]);

/** The state and handlers for the grid's section; `onFile` gets the one file a drop that can import brings. */
export function useFileDrop(onFile: (file: File) => void): FileDropBinding {
  const [over, setOver] = useState<FileDrag>(null);
  // dragenter and dragleave fire for every child the pointer crosses, the next one's enter before the
  // last one's leave, so the section counts them and clears when the count is back to 0.
  const depth = useRef(0);
  const clear = () => {
    depth.current = 0;
    setOver(null);
  };
  // A drop elsewhere, a drag that ends or the window losing focus clears it too, so a leave the
  // section missed can't leave the grid lit.
  useEffect(() => {
    if (!over) return;
    const reset = () => {
      depth.current = 0;
      setOver(null);
    };
    // Caught on the way down, so nothing stopping them hides them; blur only as the window's own.
    window.addEventListener('dragend', reset, true);
    window.addEventListener('drop', reset, true);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('dragend', reset, true);
      window.removeEventListener('drop', reset, true);
      window.removeEventListener('blur', reset);
    };
  }, [over]);
  const handlers: FileDropBinding['handlers'] = {
    onDragEnter: event => {
      const drag = dragOf(event);
      if (!drag) return;
      depth.current += 1;
      setOver(drag);
    },
    onDragOver: event => {
      const drag = dragOf(event);
      if (!drag) return;
      // Always, so the browser never opens the file in the tab; one that can't import shows "not allowed".
      event.preventDefault();
      event.dataTransfer.dropEffect = drag === 'ics' ? 'copy' : 'none';
    },
    onDragLeave: event => {
      // Read from the drag, not from `over`, which may not be drawn yet when a leave follows an enter.
      if (!dragOf(event)) return;
      // Leaving the window, or Esc during the drag, is a leave with nothing after it.
      const to = event.relatedTarget;
      const outside = to instanceof Node && !event.currentTarget.contains(to);
      depth.current -= 1;
      if (outside || depth.current <= 0) clear();
    },
    onDrop: event => {
      const drag = dragOf(event);
      if (!drag) return;
      event.preventDefault();
      clear();
      const file = event.dataTransfer.files[0];
      if (drag === 'ics' && file) onFile(file);
    },
  };
  return {over, handlers};
}

/** The pill at the grid's centre while a file is over it. */
export function FileDropTip({over}: {over: FileDrag}) {
  if (!over) return null;
  return (
    <div className={`drag-tip file-drop-tip ${over}`} role="status">
      {over === 'ics' && <Icon name="download" size={14} />}
      {FILE_DRAG_LINES[over]}
    </div>
  );
}
