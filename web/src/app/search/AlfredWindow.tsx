// Alfred's window: the open conversation when no place on screen shows it inline (search/alfred.ts),
// at the right end of the composer windows' row over any desktop page, never folded. It's the same
// Answer card: a follow-up continues the thread, an email's row opens it in the Inbox's reader, and
// an item's row opens its detail card beside the window. × and Esc in the window close it; Esc
// elsewhere leaves it alone, as with composer windows.
import {useEffect} from 'react';
import type {KeyboardEvent} from 'react';
import {timeZone} from '../../api/auth.ts';
import {openMessage} from '../../api/mail.ts';
import {ALFRED_WINDOW_WIDTH} from '../../logic/composer.ts';
import {useAccounts} from '../accounts.ts';
import {useNow} from '../clock.ts';
import {navigate, useRoute} from '../router.ts';
import {toastFailure} from '../toast.ts';
import {alfredOf, alfredWindowed, closeAlfred, useAlfredThread, useAlfredWindowed} from './alfred.ts';
import {AnswerCard} from './AnswerCard.tsx';

export function AlfredWindow() {
  const thread = useAlfredThread();
  const windowed = useAlfredWindowed();
  const route = useRoute();
  const now = useNow(null);
  const {byId: accounts} = useAccounts();
  if (!thread || !windowed) return null;
  const alfred = alfredOf(thread);
  const close = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.stopPropagation();
    alfred.close();
  };
  return (
    <div className="cmp-windows alf-windows">
      <section className="alf-window" aria-label="Alfred's window" style={{width: `min(${ALFRED_WINDOW_WIDTH}px, 100%)`}} onKeyDown={close}>
        <AnswerCard alfred={alfred} scoped={thread.origin.kind === 'email'} openId={route.page === 'inbox' ? route.open : null} accounts={accounts} now={now} timeZone={timeZone()}
          windowed onOpen={id => {
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
