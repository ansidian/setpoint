// ⌘K (DESIGN.md › ⌘K; board 20): commands, not search. ⌘K opens it over everything with the scrim
// behind; on an open email it lists This email (the reader's, commands.ts), then Go to and
// Appearance with the current theme ticked. Typing finds every command, the ones that only have a
// key too. ↑ ↓ (or the pointer) move the cursor, a `sub2` fill; Enter runs; Esc closes it, and focus
// goes back where it was.
import type {AccountOut} from '@setpoint/shared';
import {useEffect, useRef, useState} from 'react';
import type {KeyboardEvent as ReactKeyboardEvent} from 'react';
import {markAllRead} from '../../api/mail.ts';
import {paletteList, SECTION_LABELS, stepCursor} from '../../logic/palette.ts';
import {SETTINGS_NAV} from '../../logic/settings.ts';
import {THEME_CHOICES, THEME_LABELS} from '../../logic/theme.ts';
import {Icon} from '../../ui/Icon.tsx';
import {dotStyle, useAccounts} from '../accounts.ts';
import type {SettingsPage} from '../../logic/route.ts';
import {currentRoute, navigate} from '../router.ts';
import {openSettings} from '../settings/store.ts';
import {askSignOut} from '../signOut.ts';
import {setThemeChoice, useThemeChoice} from '../theme.ts';
import {showToast} from '../toast.ts';
import {toInbox} from '../toInbox.ts';
import {offered} from './commands.ts';
import type {Command, Offer} from './commands.ts';
import './palette.css';

const THEME_ICONS = {system: 'contrast', light: 'light_mode', night: 'dark_mode'} as const;

// Settings' sections, found by typing what they hold ("rules", "ntfy", "keys"; UX #20), each with its nav's glyph (#164).
const SETTINGS_SECTIONS: {page: SettingsPage; keywords: string}[] = [
  {page: 'accounts', keywords: 'gmail google icloud reconnect connect'},
  {page: 'calendar', keywords: 'calendars home weather forecast maps places'},
  {page: 'todoist', keywords: 'projects tasks'},
  {page: 'notifications', keywords: 'ntfy reminders time to leave buffer alerts'},
  {page: 'mail', keywords: 'rules domains trusted codes expiry triage'},
  {page: 'news', keywords: 'sources feeds airnow'},
  {page: 'ai', keywords: 'keys models anthropic openai claude gpt alfred usage cap'},
  {page: 'appearance', keywords: 'theme'},
  {page: 'security', keywords: 'password passkeys recovery codes'},
];

/**
 * The palette's own commands: Go to, Appearance, and the ones with a key that typing finds, with the
 * Inbox filtered to each account, which the compact tier's rail has no rows for (#258).
 */
function ownCommands(theme: ReturnType<typeof useThemeChoice>, accounts: AccountOut[]): Command[] {
  const route = currentRoute();
  return [
    {id: 'inbox', section: 'goto', label: 'Inbox', icon: 'inbox', hint: '1', run: () => navigate(toInbox())},
    {id: 'calendar', section: 'goto', label: 'Calendar', icon: 'calendar_month', hint: '2', run: () => navigate({page: 'calendar', date: null, item: null, at: null})},
    {id: 'news', section: 'goto', label: 'News', icon: 'newspaper', hint: '3', run: () => navigate({page: 'news', view: 'all', story: null, article: null})},
    {id: 'settings', section: 'goto', label: 'Settings', icon: 'settings', hint: '⌘,', run: () => openSettings('accounts')},
    ...THEME_CHOICES.map((choice): Command => ({
      id: `theme-${choice}`, section: 'appearance', label: THEME_LABELS[choice], icon: THEME_ICONS[choice], ticked: theme === choice,
      keywords: `theme appearance${choice === 'night' ? ' dark' : ''}`, run: () => setThemeChoice(choice),
    })),
    {id: 'new-event', section: 'more', label: 'New event', icon: 'event', hint: 'C', run: () => navigate({page: 'calendar', date: null, item: null, at: null, compose: {kind: 'event', message: null}})},
    {id: 'new-task', section: 'more', label: 'New task', icon: 'task_alt', hint: 'D', run: () => navigate({page: 'calendar', date: null, item: null, at: null, compose: {kind: 'task', message: null}})},
    {id: 'mark-all-read', section: 'more', label: 'Mark all as read', icon: 'mark_email_read', hint: '⇧I',
      run: () => void markAllRead(route.page === 'inbox' ? route.account : null).catch((error: Error) => showToast(error.message, null, 'failed'))},
    ...SETTINGS_SECTIONS.map(({page, keywords}): Command => ({
      id: `settings-${page}`, section: 'more', label: `Settings › ${SETTINGS_NAV[page].label}`, icon: SETTINGS_NAV[page].icon, keywords, run: () => openSettings(page),
    })),
    {id: 'sign-out', section: 'more', label: 'Sign out', icon: 'door_open', run: askSignOut},
    ...accounts.map((account): Command => ({
      id: `account-${account.id}`, section: 'more', label: `Inbox · ${account.label}`, icon: 'inbox', keywords: 'account filter', run: () => navigate(toInbox(account.id)),
    })),
  ];
}

export function Palette() {
  const [offer, setOffer] = useState<Offer | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      setOffer(current => (current ? null : offered()));
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return offer && <Open offer={offer} onClose={() => setOffer(null)} />;
}

function Open({offer, onClose}: {offer: Offer; onClose: () => void}) {
  const theme = useThemeChoice();
  const {list: accounts} = useAccounts();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  // A page's command stands in for the palette's own of the same id (Mark all as read on the Inbox).
  const groups = paletteList([...offer.commands, ...ownCommands(theme, accounts).filter(own => !offer.commands.some(command => command.id === own.id))], query);
  const items = groups.flatMap(group => group.items);
  const at = Math.min(cursor, Math.max(0, items.length - 1));

  // Focus goes back where it was when it closes.
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => before?.focus?.();
  }, []);

  useEffect(() => {
    document.querySelector('.palette .item.cur')?.scrollIntoView({block: 'nearest'});
  }, [at]);

  function run(command: Command | undefined) {
    if (!command) return;
    onClose();
    // After the palette has gone and focus is back, so the command acts on the page.
    requestAnimationFrame(command.run);
  }

  function onKeyDown(event: ReactKeyboardEvent) {
    // Nothing typed here reaches the page's own keys.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor(stepCursor(at, event.key === 'ArrowDown' ? 1 : -1, items.length));
    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      run(items[at]);
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      onClose();
    }
  }

  let index = 0;
  return (
    <>
      <div className="palette-scrim" onPointerDown={onClose} />
      <div className="palette" role="dialog" aria-label="Command palette" onKeyDown={onKeyDown}>
        {offer.context && (
          <div className="ctx"><span className="tag"><span className="dot sm" style={dotStyle(offer.context.colour)} /><span className="ell">{offer.context.label}</span></span></div>
        )}
        <div className="cmdk-in">
          <Icon name="search" size={20} />
          <input ref={input} className="grow" value={query} placeholder="Type a command…" aria-label="Type a command" spellCheck={false}
            onChange={event => {
              setQuery(event.target.value);
              setCursor(0);
            }} />
          <span className="kbd">Esc</span>
        </div>
        <div className="cmdk-list" role="listbox">
          {groups.map(group => (
            <div key={group.section} role="group" aria-label={SECTION_LABELS[group.section]}>
              <div className="cmdk-label">{SECTION_LABELS[group.section]}</div>
              {group.items.map(command => {
                const mine = index++;
                return (
                  <button key={command.id} type="button" role="option" aria-selected={mine === at} className={mine === at ? 'item cur' : 'item'}
                    onMouseMove={() => mine !== at && setCursor(mine)} onClick={() => run(command)}>
                    <Icon name={command.icon} />
                    <span>{command.label}</span>
                    {command.hint && <span className="kbd">{command.hint}</span>}
                    {command.ticked && <span className="tick"><Icon name="check" size={16} /></span>}
                  </button>
                );
              })}
            </div>
          ))}
          {!items.length && <div className="none"><Icon name="search_off" size={16} />No command matches</div>}
        </div>
      </div>
    </>
  );
}
