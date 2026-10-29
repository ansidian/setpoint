// The shell (DESIGN.md › Layout): the sidebar, then the page under its header, with the offline
// pill over it while Setpoint's live stream is down, and the one toast (ToastPill.tsx) above it all,
// Settings included. The keys that work everywhere: `1` Inbox, `2` Calendar, `3` News, `/` search,
// ⌘K the palette, ⌘, Settings, and `4` Jobs while it's on (jobs/, a wiring point). Settings is a modal over the page, not in the address bar: /settings/<page>
// opens it over the Inbox. Below 640 px the phone's shell (Phone.tsx) takes the sidebar's place,
// Calendar is the agenda, and Settings, ⌘K, News and Jobs stay on the desktop (their addresses open the Inbox).
import {useEffect} from 'react';
import {useDown, useOfflineSince} from '../api/live.ts';
import {connectFailed, connectNote} from '../logic/settings.ts';
import {isTyping, plainKey} from '../ui/keys.ts';
import {CalendarPage} from './calendar/CalendarPage.tsx';
import {Agenda} from './calendar/Agenda.tsx';
import {InboxPage} from './InboxPage.tsx';
import {goToJobs, JobsPage} from './jobs/index.ts';
import {NewsPage} from './news/NewsPage.tsx';
import {ContextMenu} from './ContextMenu.tsx';
import {Palette} from './palette/Palette.tsx';
import {isPhone, PhoneSettings, PhoneTabs, usePhone} from './Phone.tsx';
import {currentRoute, navigate, useRoute} from './router.ts';
import {selectSearch} from './search/Search.tsx';
import {Settings} from './settings/Settings.tsx';
import {openSettings} from './settings/store.ts';
import {Sidebar} from './Sidebar.tsx';
import {OfflinePill} from './states/States.tsx';
import {toInbox} from './toInbox.ts';
import {showToast} from './toast.ts';
import {ToastPill} from './ToastPill.tsx';

/** `arrive`: it follows Setpoint's mark at the start, and fades in (#233). */
export function App({arrive = false}: {arrive?: boolean}) {
  const route = useRoute();
  const offline = useOfflineSince() !== null;
  // From the moment the stream drops, before the pill: what would change something takes no pointer (states-05).
  const down = useDown();
  const phone = usePhone();

  // An address for a Settings page opens the modal over the Inbox, and the address becomes the Inbox's.
  const settingsLink = route.page === 'settings' && !phone ? route.section : null;
  useEffect(() => {
    if (!settingsLink) return;
    // Back from Google's or Todoist's consent: say how it went.
    const note = connectNote(settingsLink, window.location.search);
    if (note) showToast(note, null, connectFailed(settingsLink, window.location.search) ? 'failed' : null);
    openSettings(settingsLink);
    navigate(toInbox(), {replace: true});
  }, [settingsLink]);

  // Below 640 px News and Jobs aren't in the navigation (D85, D303): their addresses open the Inbox.
  const phoneNews = phone && (route.page === 'news' || route.page === 'jobs');
  useEffect(() => {
    if (phoneNews) navigate(toInbox(), {replace: true});
  }, [phoneNews]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key === ',') {
        event.preventDefault();
        openSettings('accounts');
        return;
      }
      // ⌘F, like `/`, focuses the header's search (DESIGN.md › Search), even from another field,
      // selecting the query it holds so typing replaces it.
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
        if (selectSearch()) event.preventDefault();
        return;
      }
      if (isTyping(event) || event.defaultPrevented) return;
      // 1 goes to the Inbox from another page; on it, U goes to New (D264).
      if (plainKey(event, '1') && currentRoute().page !== 'inbox') {
        event.preventDefault();
        navigate(toInbox());
      } else if (plainKey(event, '2')) {
        event.preventDefault();
        navigate({page: 'calendar', date: null, item: null, at: null});
      } else if (plainKey(event, '3') && !isPhone()) {
        event.preventDefault();
        navigate({page: 'news', view: 'all', story: null, article: null});
      } else if (plainKey(event, '4') && !isPhone()) {
        if (goToJobs()) event.preventDefault();
      } else if (plainKey(event, '/') && selectSearch()) {
        event.preventDefault();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={arrive ? 'app boot-after' : 'app'}>
      {!phone && <Sidebar route={route} />}
      <main className={['main', offline && 'offline', down && 'down'].filter(Boolean).join(' ')}>
        {route.page === 'inbox' ? <InboxPage key={route.account ?? 'all'} route={route} />
          : route.page === 'calendar' ? (phone ? <Agenda route={route} /> : <CalendarPage route={route} />)
            : route.page === 'news' ? (phone ? null : <NewsPage route={route} />)
              : route.page === 'jobs' ? (phone ? null : <JobsPage route={route} />)
              : phone ? <PhoneSettings /> : null}
        <OfflinePill />
        <ToastPill />
      </main>
      {phone ? <PhoneTabs route={route} /> : (
        <>
          <Settings />
          <Palette />
          <ContextMenu />
        </>
      )}
    </div>
  );
}
