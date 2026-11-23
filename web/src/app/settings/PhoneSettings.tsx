// Settings on the phone: a page at /settings/<page>, not the desktop's modal. Notifications and
// Appearance are the desktop's own pages, in the phone's column; the header's title is a menu between
// them, with Inbox after a divider, the way back as the Inbox's menu has Settings. Each of the other pages (Accounts, Mail, Calendar, News, Jobs, AI, Security) says it's on the
// desktop, so a reconnect alert's link, a notification's or Alfred's "Settings › AI" always lands on a
// page. Sign out is at the foot of each, asking once in the toast. Security stays on the desktop:
// signing out a device or adding a passkey is rare and awkward on a phone.
import {SETTINGS_NAV} from '../../logic/settings.ts';
import type {SettingsPage} from '../../logic/route.ts';
import {Icon, Mark} from '../../ui/Icon.tsx';
import {TitleMenu} from '../phone/TitleMenu.tsx';
import {navigate} from '../router.ts';
import {askSignOut} from '../signOut.ts';
import {AppearancePage} from './Appearance.tsx';
import {NotificationsPage} from './Notifications.tsx';
import './settings.css';

const ON_THE_PHONE = ['notifications', 'appearance'] as const satisfies readonly SettingsPage[];

export function PhoneSettings({page}: {page: SettingsPage}) {
  const {label, icon} = SETTINGS_NAV[page];
  return (
    <>
      <header className="hd">
        <Mark />
        <TitleMenu title={label} rows={[...ON_THE_PHONE.map(one => ({
          label: SETTINGS_NAV[one].label,
          checked: one === page,
          onChoose: () => navigate({page: 'settings', section: one}, {replace: true}),
        })), 'divider', {label: 'Inbox', command: true, onChoose: () => navigate({page: 'inbox', open: null})}]} />
      </header>
      <div className="content settings ph-set">
        {page === 'notifications' ? <NotificationsPage /> : page === 'appearance' ? <AppearancePage /> : (
          <section className="set-main ph-set-away" aria-label={label}>
            <Icon name={icon} size={20} />
            <p>{label} is on the desktop</p>
          </section>
        )}
        <div className="ph-set-foot">
          <button className="btn ghost" type="button" onClick={askSignOut}><Icon name="door_open" size={17} />Sign out</button>
        </div>
      </div>
    </>
  );
}
