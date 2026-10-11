// Settings (DESIGN.md › Settings; boards 17, 18a, 18b, 30a, 30b): a 1040 × 720 modal over the page,
// the scrim behind, not in the address bar. The 220 px nav holds the pages, Accounts marked while a
// source needs sign-in and News while a feed fails, and Sign out at its foot. ↑ ↓ in the nav change page; Esc closes the
// topmost thing (a menu first, then Settings); keys inside never reach the page under it, and
// focus goes back where it was.
import type {AccountOut, NewsSourcesOut} from '@setpoint/shared';
import {useEffect, useRef} from 'react';
import type {JSX, KeyboardEvent} from 'react';
import {askSignOut} from '../signOut.ts';
import {useResource} from '../../api/client.ts';
import {ACCOUNTS_PATH} from '../../api/mail.ts';
import {NEWS_SOURCES_PATH} from '../../api/news.ts';
import {feedFailing} from '../../logic/news.ts';
import {SETTINGS_PAGES} from '../../logic/route.ts';
import type {SettingsPage} from '../../logic/route.ts';
import type {IconName} from '../../ui/glyphs.ts';
import {Icon} from '../../ui/Icon.tsx';
import {AccountsPage} from './Accounts.tsx';
import {AiPage} from './Ai.tsx';
import {AppearancePage} from './Appearance.tsx';
import {CalendarPage} from './Calendar.tsx';
import {MailPage} from './Mail.tsx';
import {NewsSettingsPage} from './News.tsx';
import {NotificationsPage} from './Notifications.tsx';
import {SecurityPage} from './Security.tsx';
import {closeSettings, openSettings, useSettingsPage} from './store.ts';
import {TodoistPage} from './Todoist.tsx';
import './settings.css';

const NAV: Record<SettingsPage, {label: string; icon: IconName}> = {
  accounts: {label: 'Accounts', icon: 'alternate_email'},
  calendar: {label: 'Calendar', icon: 'calendar_month'},
  todoist: {label: 'Todoist', icon: 'task_alt'},
  notifications: {label: 'Notifications', icon: 'notifications'},
  mail: {label: 'Mail', icon: 'mail'},
  news: {label: 'News', icon: 'newspaper'},
  ai: {label: 'AI', icon: 'auto_awesome'},
  appearance: {label: 'Appearance', icon: 'contrast'},
  security: {label: 'Security', icon: 'lock'},
};

const PAGES: Record<SettingsPage, () => JSX.Element> = {
  accounts: AccountsPage, calendar: CalendarPage, todoist: TodoistPage, notifications: NotificationsPage,
  mail: MailPage, news: NewsSettingsPage, ai: AiPage, appearance: AppearancePage, security: SecurityPage,
};

export function Settings() {
  const page = useSettingsPage();
  return page && <Open page={page} />;
}

function Open({page}: {page: SettingsPage}) {
  const modal = useRef<HTMLDivElement>(null);
  const {data: accounts} = useResource<AccountOut[]>(ACCOUNTS_PATH);
  const reconnect = accounts?.some(account => account.health.state === 'needs_reconnect') ?? false;
  const {data: newsSources} = useResource<NewsSourcesOut>(NEWS_SOURCES_PATH);
  const failing = feedFailing(newsSources);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    modal.current?.querySelector<HTMLElement>('.set-nav .nav.on')?.focus();
    return () => before?.focus?.();
  }, []);

  function onKeyDown(event: KeyboardEvent) {
    // ⌘K and ⌘, still work from here; nothing else reaches the page underneath (the browser's own
    // keys, copy and paste among them, still do what they do).
    if ((event.metaKey || event.ctrlKey) && ['k', ','].includes(event.key.toLowerCase())) return;
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      closeSettings();
    }
  }

  function onNavKey(event: KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const at = SETTINGS_PAGES.indexOf(page);
    const next = SETTINGS_PAGES[(at + (event.key === 'ArrowDown' ? 1 : -1) + SETTINGS_PAGES.length) % SETTINGS_PAGES.length]!;
    openSettings(next);
    requestAnimationFrame(() => modal.current?.querySelector<HTMLElement>('.set-nav .nav.on')?.focus());
  }

  const Body = PAGES[page];
  return (
    <>
      <div className="settings-scrim" onPointerDown={closeSettings} />
      <div className="settings" ref={modal} role="dialog" aria-modal="true" aria-label="Settings" tabIndex={-1} onKeyDown={onKeyDown}>
        <nav className="set-nav" aria-label="Settings pages" onKeyDown={onNavKey}>
          <div className="set-navtitle">Settings</div>
          {SETTINGS_PAGES.map(name => (
            <button key={name} type="button" className={name === page ? 'nav on' : 'nav'} aria-current={name === page ? 'page' : undefined} onClick={() => openSettings(name)}>
              <Icon name={NAV[name].icon} />
              <span className="grow">{NAV[name].label}</span>
              {name === 'accounts' && reconnect && <span className="warn" title="An account needs sign-in"><Icon name="warning" size={16} /></span>}
              {name === 'news' && failing && <span className="warn" title="A feed is failing"><Icon name="warning" size={16} /></span>}
            </button>
          ))}
          <button type="button" className="nav foot" onClick={() => {
            closeSettings();
            askSignOut();
          }}>
            <Icon name="door_open" />
            <span className="grow">Sign out</span>
          </button>
        </nav>
        <Body />
      </div>
    </>
  );
}
