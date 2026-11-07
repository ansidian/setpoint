// An HTML email in the reader (DESIGN.md › The reader): a sandboxed frame as wide as the reading
// pane, radius 14 on white, as tall as the email so the reading pane scrolls it with the head. The
// frame loads the server's body page by `src` (GET /api/mail/messages/:id/body), which carries its
// own policy: no scripts but the reader's measuring script, and remote images only when the
// remote-content rule allows them or the user said Show. The sandbox gives the page no origin of its
// own, so nothing can reach in to measure it; instead the measuring script posts the page's height
// as it lays out and as its images load, and the frame takes it. Keys pressed with the email clicked
// into come the same way, and are pressed again on the frame, so Setpoint's keys still work (SV-149).
import {useEffect, useRef, useState} from 'react';
import {emailBodyPath} from '../api/mail.ts';

/** No email is taller than this; a height past it is a fault, not an email. */
const TALLEST = 200_000;
/** What a frame holds before its page says its height. */
const RESERVED = 240;

// The height each body page last said, the latest last: an email opened again (the browser keeps its
// page) draws at once at that height instead of fading in, and its page corrects it if the pane changed.
const KEPT_HEIGHTS = 60;
const heights = new Map<string, number>();

function keepHeight(src: string, height: number) {
  heights.delete(src);
  heights.set(src, height);
  if (heights.size > KEPT_HEIGHTS) heights.delete(heights.keys().next().value!);
}

const KEY_FLAGS = ['metaKey', 'ctrlKey', 'altKey', 'shiftKey', 'repeat', 'isComposing'] as const;

/** The key the measuring script says was pressed in the email, or null when it isn't one. */
function pressedKey(sent: unknown): KeyboardEventInit | null {
  if (!sent || typeof sent !== 'object') return null;
  const {key, code} = sent as Record<string, unknown>;
  if (typeof key !== 'string' || typeof code !== 'string') return null;
  return {key, code, ...Object.fromEntries(KEY_FLAGS.map(flag => [flag, (sent as Record<string, unknown>)[flag] === true]))};
}

export function MailFrame({messageId, show, title}: {messageId: number; show: boolean; title: string}) {
  const src = emailBodyPath(messageId, show);
  const frame = useRef<HTMLIFrameElement>(null);
  // The page the frame holds, for the height it says.
  const shown = useRef(src);
  useEffect(() => {
    shown.current = src;
  }, [src]);
  // Null until the page has said how tall it is: until then the frame holds 240 px on `sub`, unseen,
  // then fades in at its height (reader-01, #229). An email seen before starts at its last height.
  const [height, setHeight] = useState<number | null>(() => heights.get(src) ?? null);

  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const data = event.data as {setpointMailHeight?: unknown; setpointMailKey?: unknown} | null;
      const reported = data?.setpointMailHeight;
      if (typeof reported === 'number' && Number.isFinite(reported) && reported >= 0) {
        const next = Math.min(Math.ceil(reported), TALLEST);
        keepHeight(shown.current, next);
        setHeight(next);
      }
      // A key pressed in the email comes to the page's own keys as if the frame itself held it (SV-149).
      const key = pressedKey(data?.setpointMailKey);
      if (key) frame.current.dispatchEvent(new KeyboardEvent('keydown', {...key, bubbles: true, cancelable: true}));
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, []);

  return (
    <div className={height === null ? 'mailframe-box measuring' : 'mailframe-box'}>
      <iframe key={src} ref={frame} className="mailframe" title={title} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer"
        src={src} style={{height: height ?? RESERVED}} />
    </div>
  );
}
