// The reader head's summary tile (logic/reader.ts, summaryTile): the words, marked with Alfred's mark
// as written by AI, and what they sum up. On the desktop the mark sits in a gutter, the scope under
// the words. On the phone a header row has the mark and "Summary" on the left and the scope on the
// right, the words under it. While the summary is being written, a bar stands where the words go.
// When it couldn't be, a `caution` glyph follows the scope: its tip on the desktop, and a tap on the
// phone, says why.
import {useEffect, useRef, useState} from 'react';
import type {SummaryTile as Tile} from '../logic/reader.ts';
import {Icon} from '../ui/Icon.tsx';
import {usePhone} from './Phone.tsx';
import {SummarySkeleton} from './states/Skeletons.tsx';

const FAILED = 'Conversation summary failed';

export function SummaryTile({tile}: {tile: Tile}) {
  const phone = usePhone();
  const words = tile.text === null ? <SummarySkeleton /> : <p className="rd-sum selectable">{tile.text}</p>;
  if (phone) return <PhoneTile tile={tile} words={words} />;
  return (
    <div className="rd-sumtile">
      <Icon name="auto_awesome" size={16} alfred className="mark" />
      <div className="rd-sumtile-body">
        {words}
        <span className="scope">
          {tile.scope}
          {tile.tip && <span className="warn" role="img" aria-label={FAILED} data-tip={tile.tip}><Icon name="warning" size={14} /></span>}
        </span>
      </div>
    </div>
  );
}

/** The phone's tile: a tap on the glyph opens its words under the header, and a tap anywhere else puts them away. */
function PhoneTile({tile, words}: {tile: Tile; words: React.ReactNode}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => {
      if (!ref.current?.querySelector('.warn')?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  return (
    <div className="rd-sumtile" ref={ref}>
      <div className="rd-sumtile-hd">
        <Icon name="auto_awesome" size={15} alfred className="mark" />
        <span className="label">Summary</span>
        <span className="scope">{tile.phoneScope}</span>
        {tile.tip && (
          <button className="warn" type="button" aria-label={FAILED} aria-expanded={open} onClick={() => setOpen(was => !was)}>
            <Icon name="warning" size={16} />
          </button>
        )}
      </div>
      {words}
      {open && tile.tip && <div className="rd-sumtile-tip" role="tooltip">{tile.tip}</div>}
    </div>
  );
}
