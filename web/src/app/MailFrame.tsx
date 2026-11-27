// An HTML email in the reader: a sandboxed frame as wide as the reading pane, radius 14 on white.
// It is as tall as the email, so the reading pane scrolls it with the head. The frame loads the
// server's body page by `src` (GET /api/mail/messages/:id/body), which carries its own policy: no
// scripts but the reader's measuring script, and remote images only when the remote-content rule
// allows them or the user said Show. The sandbox gives the page no origin of its own, so nothing can
// reach in to measure it. Instead the measuring script posts the page's height as it lays out and as
// its images load, and the frame takes it. Keys pressed with the email clicked into come the same
// way. They are pressed again on the frame, so Setpoint's keys still work. On the phone the page is
// asked for as the phone's, so a text-like email has room inside the card.
//
// Find in email (search/find.ts) reaches the page the same way: the frame sends it the words and
// which of its matches is current, and the page marks them and answers with its count and where the
// current one sits, so the reading pane can bring it into view. A page loaded again (Show, the
// quoted history) is sent them again once it says its height. `counting` is a frame that isn't
// shown, holding the email's whole page only to count what find matches in it: with no layout it
// can't say a height, so it's sent them once its page has loaded.
import {useEffect, useRef, useState} from 'react';
import {emailBodyPath} from '../api/mail.ts';
import {findWords} from '../logic/find.ts';
import {registerFrame, revealInPane, useFind} from './search/find.ts';
import {usePhone} from './Phone.tsx';

/** No email is taller than this. A height past it is a fault, not an email. */
const TALLEST = 200_000;
/** What a frame holds before its page says its height. */
const RESERVED = 240;

// The height each body page last said, the latest last. An email opened again (the browser keeps its
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

export function MailFrame({messageId, show, title, fold = false, counting = false, onCount}: {
  messageId: number;
  show: boolean;
  title: string;
  fold?: boolean;
  counting?: boolean;
  // How many of find's matches the page holds, as it answers.
  onCount?: (count: number) => void;
}) {
  // The phone's card gives the email no room, so its page gives a text-like email its own.
  const src = emailBodyPath(messageId, show, fold, usePhone());
  const frame = useRef<HTMLIFrameElement>(null);
  // The page the frame holds, for the height it says.
  const shown = useRef(src);
  useEffect(() => {
    shown.current = src;
  }, [src]);
  // Null until the page has said how tall it is: until then the frame holds 240 px on `sub`, unseen,
  // then fades in at its height. An email seen before starts at its last height.
  const [height, setHeight] = useState<number | null>(() => heights.get(src) ?? null);

  // Find's words, the matches the page last counted, and which one is current here.
  const find = useFind();
  const words = find.open ? findWords(find.text) : '';
  const [count, setCount] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const asked = useRef({words: '', current: -1, reveal: false});
  // Moves when a page first says its height: it's ready for the words.
  const [ready, setReady] = useState(0);
  const readyFor = useRef<string | null>(null);
  const counted = useRef(onCount);
  useEffect(() => {
    counted.current = onCount;
  });
  const ask = (next: {words: string; current: number; reveal: boolean}) => {
    asked.current = next;
    frame.current?.contentWindow?.postMessage({setpointFind: {words: next.words, current: next.current}}, '*');
  };
  useEffect(() => {
    if (!words && !asked.current.words) return;
    ask({words, current: -1, reveal: false});
  }, [words, ready]);
  useEffect(() => {
    const element = box.current;
    if (counting || !element) return;
    return registerFrame(element, (current, reveal) => {
      const was = asked.current;
      if (was.current === current && !reveal) return;
      ask({words: was.words, current, reveal: reveal && current >= 0});
    });
  }, [counting]);

  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const data = event.data as {setpointMailHeight?: unknown; setpointMailKey?: unknown; setpointFound?: unknown} | null;
      const reported = data?.setpointMailHeight;
      if (typeof reported === 'number' && Number.isFinite(reported) && reported >= 0) {
        const next = Math.min(Math.ceil(reported), TALLEST);
        keepHeight(shown.current, next);
        setHeight(next);
        if (readyFor.current !== shown.current) {
          readyFor.current = shown.current;
          setReady(times => times + 1);
        }
      }
      const found = data?.setpointFound as {words?: unknown; count?: unknown; top?: unknown; bottom?: unknown} | undefined;
      if (found && found.words === asked.current.words && typeof found.count === 'number') {
        setCount(found.count);
        counted.current?.(found.count);
        if (asked.current.reveal && typeof found.top === 'number' && typeof found.bottom === 'number') {
          asked.current = {...asked.current, reveal: false};
          const place = frame.current.getBoundingClientRect();
          const scale = frame.current.offsetHeight ? place.height / frame.current.offsetHeight : 1;
          revealInPane(frame.current.closest('.rd-scroll'), place.top + found.top * scale, place.top + found.bottom * scale);
        }
      }
      // A key pressed in the email comes to the page's own keys as if the frame itself held it.
      const key = pressedKey(data?.setpointMailKey);
      if (key) frame.current.dispatchEvent(new KeyboardEvent('keydown', {...key, bubbles: true, cancelable: true}));
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, []);

  if (counting) {
    // Unseen, its page has no layout to say a height from, so its load says it's ready for the words.
    return <iframe key={src} ref={frame} className="mailframe-count" title={title} aria-hidden="true" tabIndex={-1} sandbox="allow-scripts" referrerPolicy="no-referrer" src={src}
      onLoad={() => setReady(times => times + 1)} />;
  }
  return (
    <div ref={box} className={height === null ? 'mailframe-box measuring' : 'mailframe-box'} data-find-frame="" data-find-count={words ? count : 0}>
      <iframe key={src} ref={frame} className="mailframe" title={title} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer"
        src={src} style={{height: height ?? RESERVED}} />
    </div>
  );
}
