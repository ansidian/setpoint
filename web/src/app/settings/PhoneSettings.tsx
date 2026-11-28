// Settings on the phone: a page, not the desktop's modal. /settings is its index, listing the pages
// the phone has (Places, Notifications and Appearance), each a row to its page, which is the
// desktop's own page in the phone's column under a Back to the index. Each of the other pages
// (Accounts, Mail, Calendar, Tasks, News, Jobs, AI, Security) says it's on the desktop and lists the phone's
// pages under that, so a reconnect alert's link or a notification always lands on a page that leads
// somewhere. Sign out is at the foot of each, asking there. The Inbox's tab is lit here,
// as Settings is the Inbox's title menu's. Security stays on the desktop: signing out a device or
// adding a passkey is rare and awkward on a phone.
import {SETTINGS_NAV} from '../../logic/settings.ts';
import type {SettingsPage} from '../../logic/route.ts';
import {Icon, Mark} from '../../ui/Icon.tsx';
import {navigate} from '../router.ts';
import {AppearancePage} from './Appearance.tsx';
import {NotificationsPage} from './Notifications.tsx';
import {PlacesPage} from './Places.tsx';
import {SignOut} from './SignOut.tsx';
import './settings.css';

const ON_THE_PHONE = ['places', 'notifications', 'appearance'] as const satisfies readonly SettingsPage[];

/** The phone's pages as rows, each with its glyph and a chevron. */
function PhonePages() {
  return (
    <nav className="set-group ph-set-pages" aria-label="Settings pages">
      {ON_THE_PHONE.map(one => (
        <a key={one} className="set-row" href={`/settings/${one}`} onClick={event => {
          event.preventDefault();
          navigate({page: 'settings', section: one});
        }}>
          <span className="aico"><Icon name={SETTINGS_NAV[one].icon} size={16} /></span>
          <span className="t grow">{SETTINGS_NAV[one].label}</span>
          <Icon name="chevron_right" size={18} />
        </a>
      ))}
    </nav>
  );
}

export function PhoneSettings({page}: {page: SettingsPage | null}) {
  const label = page ? SETTINGS_NAV[page].label : 'Settings';
  return (
    <>
      <header data-theme="night" className={page ? 'hd ph-set-hd' : 'hd'}>
        {page ? (
          <>
            <button className="btn quiet ph-back" type="button" onClick={() => navigate({page: 'settings', section: null})}><Icon name="chevron_left" size={20} />Settings</button>
            <h1 className="hd-title ell">{label}</h1>
          </>
        ) : <><Mark /><h1 className="hd-title">Settings</h1></>}
      </header>
      <div className="content settings ph-set">
        {page === null ? (
          <section className="set-main" aria-label="Settings"><PhonePages /></section>
        ) : page === 'places' ? <PlacesPage /> : page === 'notifications' ? <NotificationsPage /> : page === 'appearance' ? <AppearancePage /> : (
          <section className="set-main" aria-label={label}>
            <div className="ph-set-away">
              <Icon name={SETTINGS_NAV[page].icon} size={20} />
              <p>{label} is on the desktop. These are here:</p>
            </div>
            <PhonePages />
          </section>
        )}
        <div className="ph-set-foot">
          <SignOut phone />
        </div>
      </div>
    </>
  );
}
