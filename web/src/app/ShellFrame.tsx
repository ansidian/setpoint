// Setpoint's shell while it starts, in a browser that was signed in (DESIGN.md › Decided while
// building #234): the sidebar as it last stood (the mark, the pages, the accounts and their counts,
// Today's place) and the page's header and skeleton, before Setpoint has said whether the session
// still holds, so the app opens already itself. It asks for nothing; the app replaces it in place.
// On the phone, the header with the mark, the page's skeleton and the tabs; an email's address its
// reader's skeleton (phone-12).
import {useEffect} from 'react';
import {Icon, Mark} from '../ui/Icon.tsx';
import {PhoneTabs, usePhone} from './Phone.tsx';
import {useRoute} from './router.ts';
import {Sidebar} from './Sidebar.tsx';
import {carrySkeletons} from './states/Loading.tsx';
import {AllSkeleton, BodySkeleton, HeadSkeleton, NewsSkeleton, PhoneAgendaSkeleton} from './states/Skeletons.tsx';

export function ShellFrame() {
  const route = useRoute();
  const phone = usePhone();
  // The app's skeletons take over this one's where it showed, rather than fading in again.
  useEffect(carrySkeletons, []);

  if (phone) {
    return (
      <div className="app" data-frame>
        <main className="main">
          <header className="hd">
            <Mark />
            <span className="hd-title">{route.page === 'calendar' ? 'Agenda' : 'Inbox'}</span>
            {/* The Inbox's search field holds its row, so the list doesn't move down when the app comes. */}
            {route.page !== 'calendar' && <span className="search"><Icon name="search" size={16} /><span className="grow">Search mail</span></span>}
          </header>
          <div className="content">
            {route.page === 'calendar' ? <section className="ph-agenda"><PhoneAgendaSkeleton /></section>
              : route.page === 'inbox' && route.open !== null ? (
                <section className="pane">
                  <div className="ph-top"><span className="btn quiet ph-back"><Icon name="chevron_left" size={20} />Inbox</span></div>
                  <div className="rd-scroll"><HeadSkeleton /><div className="rd-body"><BodySkeleton /></div></div>
                </section>
              ) : <section className="list all"><AllSkeleton /></section>}
          </div>
        </main>
        <PhoneTabs route={route} />
      </div>
    );
  }

  const title = route.page === 'inbox' ? 'Inbox' : route.page === 'news' ? 'News' : route.page === 'settings' ? 'Inbox' : '';
  return (
    <div className="app" data-frame>
      <Sidebar route={route} frame />
      <main className="main">
        <header className="hd"><span className="hd-title">{title}</span></header>
        <div className="content">
          {route.page === 'inbox' || route.page === 'settings' ? <section className="list all"><AllSkeleton /></section>
              : route.page === 'news' ? <section className="nw-list"><div className="nw-body"><div className="list"><NewsSkeleton blocks={route.view === 'all'} /></div></div></section>
                : null}
        </div>
      </main>
    </div>
  );
}
