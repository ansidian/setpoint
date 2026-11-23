// The shell: the sidebar, then the page under its header. The offline pill sits over the page while
// Setpoint's live stream is down. The one toast (ToastPill.tsx) sits above it all, Settings included.
// The keys that work everywhere: `1` Inbox, `2` Calendar, `3` News, `/` search, ⌘K the palette,
// ⌘, Settings, ⌘J Light or Night, `4` Jobs (jobs/, a wiring point; when it's off, its page says so),
// and `` ` `` to open or fold the sidebar from 1100 px (sidebarRail.ts). Settings is a modal over
// the page, not in the address bar: /settings/<page> opens it over the Inbox. Below 640 px the
// phone's shell (Phone.tsx) takes the sidebar's place and Calendar is the agenda. Settings says
// it's on the desktop; the composer opens in a full-screen sheet. ⌘K, Jobs and Sent stay there (their
// addresses open the Inbox). Alfred's window is the phone's pill and sheet (PhoneAlfred.tsx). On the
// desktop every arrival (a
// load, a return to the tab) with an overdue task opens on its banner (OverdueBanner.tsx), over
// everything but the toast.
import {useEffect} from 'react';
import {useDown, useOfflineSince} from '../api/live.ts';
import {connectFailed, connectNote} from '../logic/settings.ts';
import {isTyping, plainKey} from '../ui/keys.ts';
import {CalendarPage} from './calendar/CalendarPage.tsx';
import {Agenda} from './calendar/Agenda.tsx';
import {InboxPage} from './InboxPage.tsx';
import {SentPage} from './SentPage.tsx';
import {goToJobs, jobsMailSlots, JobsPage} from './jobs/index.ts';
import {NewsPage} from './news/NewsPage.tsx';
import {ContextMenu} from './ContextMenu.tsx';
import {Palette} from './palette/Palette.tsx';
import {isPhone, PhoneSettings, PhoneTabs, usePhone} from './Phone.tsx';
import {currentRoute, navigate, useRoute} from './router.ts';
import {selectSearch} from './search/Search.tsx';
import {Settings} from './settings/Settings.tsx';
import {openSettings} from './settings/store.ts';
import {Sidebar} from './Sidebar.tsx';
import {toggleSidebar, useRail} from './sidebarRail.ts';
import {OverdueArrival} from './OverdueBanner.tsx';
import {OfflinePill} from './states/States.tsx';
import {Tip} from './Tip.tsx';
import {flipTheme} from './theme.ts';
import {toInbox} from './toInbox.ts';
import {fillMailSlots} from './slots.tsx';
import {showToast} from './toast.ts';
import {ToastPill} from './ToastPill.tsx';
import {ComposerRoot, ComposerWindows, SendWatch} from './compose/Composer.tsx';
import {AlfredWindow} from './search/AlfredWindow.tsx';
import {PhoneAlfred} from './search/PhoneAlfred.tsx';
import {restoreAlfred} from './search/alfred.ts';
import {DraftsPage} from './compose/DraftsPage.tsx';
import {SnoozedPage} from './SnoozedPage.tsx';
import {ScheduledPage} from './compose/ScheduledPage.tsx';

// Jobs fills mail's slots: the reader's JD chip and Applied before, before Setpoint first draws.
fillMailSlots(jobsMailSlots);

/** `arrive`: it follows Setpoint's mark at the start, and fades in. */
export function App({arrive = false}: {arrive?: boolean}) {
  const route = useRoute();
  const offline = useOfflineSince() !== null;
  // From the moment the stream drops, before the pill: what would change something takes no pointer.
  const down = useDown();
  const phone = usePhone();
  const rail = useRail();

  // Alfred's conversation from before a reload comes back (search/alfred.ts).
  useEffect(() => {
    restoreAlfred();
  }, []);

  // An address for a Settings page opens the modal over the Inbox, and the address becomes the Inbox's.
  const settingsLink = route.page === 'settings' && !phone ? route.section : null;
  useEffect(() => {
    if (!settingsLink) return;
    // Back from Google's or Todoist's consent: say how it went.
    const note = connectNote(window.location.search);
    if (note) showToast(note, null, connectFailed(window.location.search) ? 'failed' : null);
    openSettings(settingsLink);
    navigate(toInbox(), {replace: true});
  }, [settingsLink]);

  // Below 640 px Jobs, Sent and the other mail pages aren't in the navigation: their addresses open the Inbox.
  const phoneElsewhere = phone && (route.page === 'jobs' || route.page === 'sent' || route.page === 'drafts' || route.page === 'snoozed' || route.page === 'scheduled');
  useEffect(() => {
    if (phoneElsewhere) navigate(toInbox(), {replace: true});
  }, [phoneElsewhere]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key === ',') {
        event.preventDefault();
        openSettings('accounts');
        return;
      }
      // ⌘J switches Light and Night, from a field too. On System it does nothing. In a composer it's
      // help me write's, which takes it first.
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'j' && !event.defaultPrevented) {
        event.preventDefault();
        flipTheme();
        return;
      }
      // ⌘F, like `/`, focuses the header's search, even from another field.
      // It selects the query the search holds, so typing replaces it.
      if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
        if (selectSearch()) event.preventDefault();
        return;
      }
      if (isTyping(event) || event.defaultPrevented) return;
      // 1 goes to the Inbox from another page. On the Inbox, U goes to the next unread email.
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
      } else if (plainKey(event, '`') && !isPhone() && toggleSidebar()) {
        event.preventDefault();
      } else if (plainKey(event, '/') && selectSearch()) {
        event.preventDefault();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className={['app', arrive && 'boot-after', rail && !phone && 'rail'].filter(Boolean).join(' ')}>
      {!phone && <Sidebar route={route} />}
      <main className={['main', offline && 'offline', down && 'down'].filter(Boolean).join(' ')}>
        {route.page === 'inbox' ? <InboxPage route={route} />
          : route.page === 'sent' ? (phone ? null : <SentPage route={route} />)
          : route.page === 'drafts' ? (phone ? null : <DraftsPage route={route} />)
          : route.page === 'snoozed' ? (phone ? null : <SnoozedPage route={route} />)
          : route.page === 'scheduled' ? (phone ? null : <ScheduledPage route={route} />)
          : route.page === 'calendar' ? (phone ? <Agenda route={route} /> : <CalendarPage route={route} />)
            : route.page === 'news' ? <NewsPage route={route} />
              : route.page === 'jobs' ? (phone ? null : <JobsPage route={route} />)
              : phone ? <PhoneSettings /> : null}
        {!phone && <ComposerWindows />}
        {phone ? <PhoneAlfred route={route} /> : <AlfredWindow />}
        <OfflinePill />
        <ToastPill />
      </main>
      {phone ? <PhoneTabs route={route} /> : (
        <>
          <Settings />
          <Palette />
          <ContextMenu />
          <Tip />
          <OverdueArrival />
        </>
      )}
      {/* The composers, on the phone too, where each puts up its own sheet. */}
      <SendWatch />
      <ComposerRoot />
    </div>
  );
}
