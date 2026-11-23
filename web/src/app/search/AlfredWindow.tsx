// Alfred's window: the open conversation when no place on screen shows it inline (search/alfred.ts),
// at the right end of the composer windows' row over any desktop page. Its title folds it to its bar
// and back, as a composer window's does. Beside a
// composer window on a narrow desktop, it narrows so the composer keeps its toolbar whole. It's the same
// Answer card: a follow-up continues the thread, an email's row opens it in the Inbox's reader, and
// an item's row opens its detail card beside the window. × and Esc in the window close it; Esc
// elsewhere leaves it alone, as with composer windows.
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {KeyboardEvent} from 'react';
import {timeZone} from '../../api/auth.ts';
import {openMessage} from '../../api/mail.ts';
import {alfredWindowWidth} from '../../logic/composer.ts';
import {useComposers} from '../compose/composer.ts';
import {useAccounts} from '../accounts.ts';
import {useNow} from '../clock.ts';
import {navigate, useRoute} from '../router.ts';
import {toastFailure} from '../toast.ts';
import {alfredOf, alfredWindowed, closeAlfred, toggleAlfredMinimized, useAlfredMinimized, useAlfredThread, useAlfredWindowed} from './alfred.ts';
import {AnswerCard} from './AnswerCard.tsx';
import './search.css';

export function AlfredWindow() {
  const thread = useAlfredThread();
  const windowed = useAlfredWindowed();
  const minimized = useAlfredMinimized();
  const route = useRoute();
  const now = useNow(null);
  const {byId: accounts} = useAccounts();
  // Beside composer windows on a narrow row, it narrows for them (logic/composer.ts › alfredWindowWidth).
  const beside = useComposers().some(one => one.floating);
  const row = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  const shown = thread !== null && windowed;
  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return;
    const measure = () => setRoom(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [shown]);
  if (!thread || !windowed) return null;
  const alfred = alfredOf(thread);
  const close = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.stopPropagation();
    alfred.close();
  };
  return (
    <div ref={row} className="cmp-windows alf-windows">
      <section className={minimized ? 'alf-window min' : 'alf-window'} aria-label="Alfred's window" onKeyDown={close}
        style={room ? {width: alfredWindowWidth(room, beside, minimized)} : {visibility: 'hidden'}}>
        <AnswerCard alfred={alfred} scoped={thread.origin.kind === 'email'} openId={route.page === 'inbox' ? route.open : null} accounts={accounts} now={now} timeZone={timeZone()}
          windowed minimized={minimized} onMinimize={toggleAlfredMinimized} onOpen={id => {
            navigate({page: 'inbox', open: id});
            void openMessage(id).catch(toastFailure('Failed to mark read'));
          }} />
      </section>
    </div>
  );
}

/** On the phone, which has no windows: a thread no place shows closes, as it did when its page went. */
export function AlfredLetGo() {
  const windowed = useAlfredWindowed();
  useEffect(() => {
    // As the store has it now, not as it was when this drew: a place may have claimed it since.
    if (windowed && alfredWindowed()) closeAlfred();
  }, [windowed]);
  return null;
}
