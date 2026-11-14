// SV-274 (D564): the selected day's USPS mail, near the bottom of the agenda rail, over its footer.
// No section on a day with no digest; "No mail today" when the digest says nothing is coming; else
// one row of thumbnails, as many as fit, the last "+3" when there are more (logic/mailpieces.ts). A
// thumbnail opens the viewer at that scan: the scan large, "2 of 5" and the day, ← → (buttons, keys
// or a swipe) stopping at the ends, Esc, a click outside or × closing it. `L` opens it at the first
// scan (D573). Desktop only (D275).
import type {MailpiecesOut} from '@setpoint/shared';
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {PointerEvent as ReactPointerEvent} from 'react';
import {useResource} from '../../api/client.ts';
import {mailpiecesPath} from '../../api/mail.ts';
import {dayTitle} from '../../logic/calendar.ts';
import {MAIL_GAP, MAIL_TILE, mailLine, mailStrip, stepScan} from '../../logic/mailpieces.ts';
import {useFocusReturn} from '../../ui/focusReturn.ts';
import {Icon} from '../../ui/Icon.tsx';
import {isTyping, plainKey} from '../../ui/keys.ts';

/** A swipe this far (px) across the scan steps to the next or previous one. */
const SWIPE_PX = 40;

export function MailStrip({date}: {date: string}) {
  const {data} = useResource<MailpiecesOut>(mailpiecesPath(date));
  const row = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  // The viewer, open at a scan of a day: a day changed under it closes it.
  const [opened, setOpen] = useState<{date: string; at: number} | null>(null);
  const open = opened?.date === date ? opened.at : null;
  const digest = data?.day === date ? data.digest : null;
  const showsRow = !!digest && digest.pieces > 0 && digest.scans.length > 0;

  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return;
    const measure = () => setWidth(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [showsRow]);

  // `L` opens the selected day's mail at its first scan (D573), as a thumbnail does; on a day with
  // nothing to show, or with a field, the editor or another dialog in front, it does nothing.
  useEffect(() => {
    if (!showsRow || open !== null) return;
    const onKey = (event: KeyboardEvent) => {
      if (!plainKey(event, 'l') || isTyping(event) || event.defaultPrevented || document.querySelector('[aria-modal="true"]')) return;
      event.preventDefault();
      setOpen({date, at: 0});
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showsRow, open, date]);

  if (!digest) return null;
  const scans = digest.scans;
  const {shown, more} = mailStrip(width, scans.length);
  return (
    <section className="rp-mail" aria-label="USPS Informed Delivery">
      <div className="rp-mail-head">
        <Icon name="mail" size={16} />
        <span className="grow">USPS Informed Delivery</span>
        {digest.pieces > 0 && <span className="ink3 num">{mailLine(digest.pieces, scans.length)}</span>}
        {showsRow && <span className="kbd" aria-hidden="true">L</span>}
      </div>
      {!showsRow
        ? <div className="rp-mail-none ink3">{digest.pieces === 0 ? 'No mail today' : 'No pictures today'}</div>
        : (
          <div className="rp-mail-row" ref={row} style={{gap: MAIL_GAP}}>
            {width > 0 && scans.slice(0, shown).map((scan, index) => (
              <button key={scan.id} type="button" className="rp-mail-tile" style={{width: MAIL_TILE, height: MAIL_TILE}}
                aria-label={`Mailpiece ${index + 1} of ${scans.length}`} onClick={() => setOpen({date, at: index})}>
                <img src={scan.url} alt="" draggable={false} />
              </button>
            ))}
            {width > 0 && more > 0 && (
              <button type="button" className="rp-mail-tile more num" style={{width: MAIL_TILE, height: MAIL_TILE}}
                aria-label={`${more} more mailpieces`} onClick={() => setOpen({date, at: shown})}>+{more}</button>
            )}
          </div>
        )}
      {open !== null && scans.length > 0 && <MailViewer date={date} urls={scans.map(scan => scan.url)} start={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

function MailViewer({date, urls, start, onClose}: {date: string; urls: string[]; start: number; onClose: () => void}) {
  const [at, setAt] = useState(Math.min(start, urls.length - 1));
  const dialog = useRef<HTMLDivElement>(null);
  const swipe = useRef<{x: number; id: number} | null>(null);
  useFocusReturn();
  useEffect(() => dialog.current?.focus(), []);
  const step = (by: number) => setAt(current => stepScan(current, by, urls.length));

  // The viewer has the keys while it's open: nothing reaches the calendar underneath.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowLeft') step(-1);
      else if (event.key === 'ArrowRight') step(1);
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  });

  const onPointerDown = (event: ReactPointerEvent) => {
    if (event.pointerType === 'mouse') return;
    swipe.current = {x: event.clientX, id: event.pointerId};
  };
  const onPointerUp = (event: ReactPointerEvent) => {
    const began = swipe.current;
    swipe.current = null;
    if (!began || began.id !== event.pointerId) return;
    const dx = event.clientX - began.x;
    if (Math.abs(dx) >= SWIPE_PX) step(dx < 0 ? 1 : -1);
  };

  return (
    <>
      <div className="mail-scrim" onPointerDown={onClose} />
      <div className="mail-viewer" ref={dialog} role="dialog" aria-modal="true" aria-label={`USPS Informed Delivery, ${dayTitle(date)}`} tabIndex={-1}>
        <div className="mail-viewer-head">
          <span className="num" aria-live="polite">{at + 1} of {urls.length}</span>
          <span className="ink3">{dayTitle(date)}</span>
          <span className="grow" />
          <button type="button" className="ibtn" aria-label="Close" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="mail-viewer-body" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => (swipe.current = null)}>
          <button type="button" className="ibtn mail-step" aria-label="Previous mailpiece" disabled={at === 0} onClick={() => step(-1)}><Icon name="chevron_left" /></button>
          <img key={urls[at]} className="mail-scan" src={urls[at]} alt={`Mailpiece ${at + 1} of ${urls.length}`} draggable={false} />
          <button type="button" className="ibtn mail-step" aria-label="Next mailpiece" disabled={at === urls.length - 1} onClick={() => step(1)}><Icon name="chevron_right" /></button>
        </div>
      </div>
    </>
  );
}
