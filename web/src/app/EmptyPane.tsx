// The pane beside the Inbox, News and Jobs with nothing open in it (SV-217, D464): always there on a
// desktop, at the dragged width, so the list and header never move as an item opens or closes. Each
// page fills it: the Inbox's mail day (SV-218, InboxDay.tsx), News's recap (SV-219, NewsDay.tsx) and
// Jobs's recent movement (SV-220, JobsDay.tsx).
//
// In a narrow window an open item covers the list, and the empty pane comes over it only from a
// 30 px `right_panel_open` button before search, as Calendar's day does (#196): lit while showing,
// closed by the button again or Esc, on every load, and when an item opens.
import {useState} from 'react';
import type {CSSProperties, KeyboardEvent, ReactNode} from 'react';
import type {IconName} from '../ui/glyphs.ts';
import {Icon} from '../ui/Icon.tsx';
import {useCompact, usePhone} from './Phone.tsx';
import {PaneEdge} from './Reader.tsx';
import {useReadingPaneWidth} from './readingPane.ts';

export interface EmptyPaneState {
  // Whether the page draws the empty pane: nothing open, and a desktop or the narrow window's button.
  drawn: boolean;
  // Whether the narrow window's button is in the header, and whether it has the pane showing.
  button: boolean;
  shown: boolean;
  toggle: () => void;
  close: () => void;
}

/** The empty pane's state for a page; `open` is whether an item has the pane. */
export function useEmptyPane(open: boolean): EmptyPaneState {
  const compact = useCompact();
  const phone = usePhone();
  const [asked, setAsked] = useState(false);
  // An item opening puts it away, as does a window wide enough to show it anyway.
  if (asked && (open || !compact)) setAsked(false);
  const shown = asked && compact && !open;
  return {
    drawn: !phone && !open && (!compact || shown),
    button: compact,
    shown,
    toggle: () => setAsked(!shown),
    close: () => setAsked(false),
  };
}

/** The narrow window's header button that shows the empty pane over the list. */
export function EmptyPaneButton({pane}: {pane: EmptyPaneState}) {
  if (!pane.button) return null;
  return (
    <button className="ibtn pane-open" type="button" aria-label="The pane" aria-pressed={pane.shown} data-tip={pane.shown ? 'Hide the pane · Esc' : 'Show the pane'}
      onClick={pane.toggle}><Icon name="right_panel_open" /></button>
  );
}

export type PaneKey = {keys: string[]; does: string};

/** Something wrong the page's pane names, with its fix when it has one ("Reconnect", "Settings › AI"). */
export interface PaneTrouble {
  text: string;
  glyph: IconName;
  fix?: {label: string; run: () => void};
}

/**
 * The pane's trouble, folded under one `warning` chip in `alert` at the start of the foot's facts line
 * (SV-219, DESIGN.md #335), so the block above never moves: the pointer over it, or focus, shows a card
 * above it listing each in `alert` with its fix, which the pointer can move into; leaving it or Esc
 * puts it away. Nothing shows without trouble.
 */
function TroubleChip({trouble}: {trouble: PaneTrouble[]}) {
  const [open, setOpen] = useState(false);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !open) return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
  };
  return (
    <span className="pane-trouble" onPointerEnter={() => setOpen(true)} onPointerLeave={() => setOpen(false)} onKeyDown={onKeyDown}
      onFocus={() => setOpen(true)} onBlur={event => !event.currentTarget.contains(event.relatedTarget) && setOpen(false)}>
      <button className="pt-chip num" type="button" aria-expanded={open} aria-label={trouble.length === 1 ? 'Something needs attention' : `${trouble.length} things need attention`}
        onClick={() => setOpen(true)}>
        <Icon name="warning" size={14} />{trouble.length}
      </button>
      {open && (
        <span className="pop pt-card" role="group" aria-label="Trouble">
          {trouble.map(one => (
            <span key={one.text} className="pt-line">
              <Icon name={one.glyph} size={16} /><span className="num">{one.text}</span>
              {one.fix && <><span className="sep">·</span><button className="act" type="button" onClick={one.fix.run}>{one.fix.label}</button></>}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

/** The empty pane: what the page puts in it, and its foot (any trouble's chip and a quiet line, then the keys) pinned to the bottom. */
export function EmptyPane({label, keys, foot, trouble = [], children}: {label: string; keys: PaneKey[]; foot?: ReactNode; trouble?: PaneTrouble[]; children: ReactNode}) {
  const width = useReadingPaneWidth();
  return (
    <section className="pane idle" aria-label={label} style={{'--readingPane': `${width}px`} as CSSProperties}>
      <PaneEdge width={width} />
      <div className="pane-empty">
        {children}
        <footer className="pane-foot">
          {(foot || trouble.length > 0) && <div className="pane-facts">{trouble.length > 0 && <TroubleChip trouble={trouble} />}{foot}</div>}
          <ul className="pane-keys">
          {keys.map(key => (
            <li key={key.does}>{key.keys.map(one => <span key={one} className="kbd">{one}</span>)}<span>{key.does}</span></li>
          ))}
          </ul>
        </footer>
      </div>
    </section>
  );
}
