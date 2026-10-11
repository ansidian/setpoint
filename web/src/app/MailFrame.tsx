// An HTML email in the reader (DESIGN.md › The reader): a sandboxed frame as wide as the reading
// pane, radius 14 on white, as tall as the email so the reading pane scrolls it with the head. The
// frame loads the server's body page by `src` (GET /api/mail/messages/:id/body), which carries its
// own policy: no scripts but the reader's measuring script, and remote images only when the
// remote-content rule allows them or the user said Show. The sandbox gives the page no origin of its
// own, so nothing can reach in to measure it; instead the measuring script posts the page's height
// as it lays out and as its images load, and the frame takes it.
import {useEffect, useRef, useState} from 'react';
import {emailBodyPath} from '../api/mail.ts';

/** No email is taller than this; a height past it is a fault, not an email. */
const TALLEST = 200_000;

export function MailFrame({messageId, show, title}: {messageId: number; show: boolean; title: string}) {
  const src = emailBodyPath(messageId, show);
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (!frame.current || event.source !== frame.current.contentWindow) return;
      const reported: unknown = (event.data as {setpointMailHeight?: unknown} | null)?.setpointMailHeight;
      if (typeof reported === 'number' && Number.isFinite(reported) && reported >= 0) setHeight(Math.min(Math.ceil(reported), TALLEST));
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, []);

  return (
    <iframe key={src} ref={frame} className="mailframe" title={title} sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer"
      src={src} style={{height}} />
  );
}
