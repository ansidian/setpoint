// Alfred on the phone, which has no windows: an always-on button above the tab bar, at the right.
// With no conversation it's a round sparkle that opens the sheet on an empty question field, focused,
// the question carrying the page under it (logic/search.ts › pageContext); Back on that empty sheet
// leaves no conversation behind. The open conversation, when no place on screen shows it
// inline (search/alfred.ts), waits as a small pill in its place. A tap opens it in the
// full-screen sheet, the same Answer card under the sheet's top bar, where a follow-up continues it.
// Back folds the sheet to the pill again, and the pill's × closes the conversation for good. An
// email's row opens it in the phone's reader and an item's row its detail on the Agenda, folding the
// sheet to the pill on the way. The pill keeps out of the reader's and the detail's way: it shows
// only over a page with its tab bar.
import {useState} from 'react';
import {timeZone} from '../../api/auth.ts';
import {openMessage} from '../../api/mail.ts';
import type {Route} from '../../logic/route.ts';
import {Icon} from '../../ui/Icon.tsx';
import {useAccounts} from '../accounts.ts';
import {useNow} from '../clock.ts';
import {Sheet} from '../phone/Sheet.tsx';
import {navigate} from '../router.ts';
import {toastFailure} from '../toast.ts';
import {pageContext} from '../../logic/search.ts';
import {alfredOf, closeAlfred, scopedEmail, startAlfred, useAlfredClaimed, useAlfredThread, useAlfredWindowed} from './alfred.ts';
import {AnswerCard, answerItemRoute} from './AnswerCard.tsx';
import './search.css';

// Where the sheet's Back goes: the page under it.
const PAGE_NAMES: Partial<Record<Route['page'], string>> = {inbox: 'Inbox', sent: 'Sent', drafts: 'Drafts', snoozed: 'Snoozed', calendar: 'Agenda', news: 'News', settings: 'Settings'};

export function PhoneAlfred({route}: {route: Route}) {
  const thread = useAlfredThread();
  const windowed = useAlfredWindowed();
  const now = useNow(null);
  const {byId: accounts} = useAccounts();
  const claimed = useAlfredClaimed();
  const [open, setOpen] = useState(false);
  // Shown inline again, or closed: the next time it's away from search it starts as the pill.
  if (open && !windowed) setOpen(false);
  // Shown inline (Inbox search), the thread is there, not here.
  if (claimed) return null;
  if (open && thread) {
    // Back on a thread that was never asked anything leaves none: the round button comes back.
    const back = () => {
      setOpen(false);
      if (!thread.turns.length && thread.waiting === null && !thread.restoring) closeAlfred();
    };
    return (
      <Sheet title="Alfred" back={PAGE_NAMES[route.page] ?? 'Back'} onClose={back}>
        <AnswerCard alfred={alfredOf(thread)} scoped={scopedEmail(thread.origin) !== null} openId={null} accounts={accounts} now={now} timeZone={timeZone()} sheet
          focusField={!thread.turns.length && thread.waiting === null}
          onOpen={id => {
            setOpen(false);
            navigate({page: 'inbox', open: id});
            void openMessage(id).catch(toastFailure('Failed to mark read'));
          }}
          onItem={item => {
            setOpen(false);
            navigate(answerItemRoute(item));
          }} />
      </Sheet>
    );
  }
  // Over the reader or an item's detail the tab bar is out of sight, and so is the pill.
  const covered = ((route.page === 'inbox' || route.page === 'sent' || route.page === 'snoozed') && route.open !== null) || (route.page === 'calendar' && route.item !== null);
  if (covered) return null;
  if (!thread) {
    return (
      <button className="alf-fab" type="button" aria-label="Ask Alfred" onClick={() => {
        startAlfred({kind: 'page', context: pageContext(route)});
        setOpen(true);
      }}><Icon name="auto_awesome" size={20} alfred /></button>
    );
  }
  return (
    <div className={thread.waiting !== null ? 'alf-pill asking' : 'alf-pill'}>
      <button className="alf-pill-open" type="button" aria-label="Open Alfred" onClick={() => setOpen(true)}>
        <Icon name="auto_awesome" size={16} alfred />Alfred
      </button>
      <button className="alf-pill-x" type="button" aria-label="Close Alfred" onClick={closeAlfred}><Icon name="close" size={16} /></button>
    </div>
  );
}
