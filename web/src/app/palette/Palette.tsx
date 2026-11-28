// ⌘K (board 20): commands, not search. ⌘K opens it over everything with the scrim behind. On an
// open email it lists This email (the reader's, commands.ts), then Go to and Appearance with the
// current theme ticked (and, from 1100 px, Open or Fold the sidebar). Typing finds every command,
// the ones that only have a key too. ↑ ↓ (or the pointer) move the cursor, a `sub2` fill. Enter
// runs. Esc closes it, and focus goes back where it was. It rises in over 180 ms and closes at once
// (DESIGN.md › Motion).
//
// Alfred is asked from here on any page. Once something is typed, an Ask Alfred row sits above the
// first result, the cursor still starting on that result, so Enter does what it did. Up from it (or
// the wrap from the bottom) reaches the Ask row, and ⌘Enter asks from anywhere in the list. With no
// command matching, the Ask row is the only row and has the cursor. The question carries the page
// and what's open there (logic/search.ts › pageContext), and the thread opens in Alfred's window.
// Asked over Settings, Settings closes first, so the window isn't under it.
import {useEffect, useRef, useState, useSyncExternalStore} from 'react';
import type {KeyboardEvent as ReactKeyboardEvent, ReactNode} from 'react';
import {markAllRead} from '../../api/mail.ts';
import {matchedRuns, paletteList, SECTION_LABELS, stepCursor} from '../../logic/palette.ts';
import {pageContext} from '../../logic/search.ts';
import {SETTINGS_NAV} from '../../logic/settings.ts';
import {sidebarFoldable} from '../../logic/sidebar.ts';
import {THEME_CHOICES, THEME_LABELS} from '../../logic/theme.ts';
import {useFocusReturn} from '../../ui/focusReturn.ts';
import {Icon} from '../../ui/Icon.tsx';
import {dotStyle} from '../accounts.ts';
import {newMessage} from '../compose/composer.ts';
import {jobsCommands} from '../jobs/index.ts';
import type {SettingsPage} from '../../logic/route.ts';
import {currentRoute, goTo, navigate} from '../router.ts';
import {startAlfred} from '../search/alfred.ts';
import {askSignOut, closeSettings, openSettings} from '../settings/store.ts';
import {isRail, toggleSidebar} from '../sidebarRail.ts';
import {setThemeChoice, useThemeChoice} from '../theme.ts';
import {toastFailure} from '../toast.ts';
import {offered} from './commands.ts';
import type {Command, Offer} from './commands.ts';
import './palette.css';

const THEME_ICONS = {system: 'contrast', light: 'light_mode', night: 'dark_mode'} as const;

// Settings' sections in the nav's order, found by typing what they hold ("rules", "ntfy", "keys"), each with its nav's glyph.
const SETTINGS_SECTIONS: {page: SettingsPage; keywords: string}[] = [
  {page: 'accounts', keywords: 'gmail google icloud todoist reconnect connect'},
  {page: 'mail', keywords: 'rules domains trusted codes expiry triage'},
  {page: 'calendar', keywords: 'calendars home time to leave buffer todoist projects tasks weather forecast maps places'},
  {page: 'news', keywords: 'sources feeds airnow'},
  {page: 'jobs', keywords: 'applications history reads'},
  {page: 'notifications', keywords: 'ntfy reminders alerts'},
  {page: 'ai', keywords: 'keys models anthropic claude alfred usage cap'},
  {page: 'appearance', keywords: 'theme'},
  {page: 'security', keywords: 'password passkeys recovery codes'},
];

/** Open the sidebar or Fold the sidebar, as it is now. */
const sidebarCommand = (rail: boolean): Command => ({
  id: 'sidebar', section: 'appearance', label: rail ? 'Open the sidebar' : 'Fold the sidebar', icon: rail ? 'chevron_right' : 'chevron_left', hint: '`',
  keywords: `sidebar rail ${rail ? 'expand' : 'collapse'}`, run: () => void toggleSidebar(),
});

/** The palette's own commands: Go to, Appearance, and the ones with a key that typing finds. */
function ownCommands(theme: ReturnType<typeof useThemeChoice>): Command[] {
  return [
    {id: 'inbox', section: 'goto', label: 'Inbox', icon: 'inbox', hint: '1', run: () => goTo('inbox')},
    // The sidebar's mail pages; none has a key.
    {id: 'sent', section: 'goto', label: 'Sent', icon: 'send', run: () => goTo('sent')},
    {id: 'drafts', section: 'goto', label: 'Drafts', icon: 'draft', run: () => goTo('drafts')},
    {id: 'snoozed', section: 'goto', label: 'Snoozed', icon: 'snooze', run: () => goTo('snoozed')},
    {id: 'scheduled', section: 'goto', label: 'Scheduled', icon: 'schedule', run: () => goTo('scheduled')},
    {id: 'calendar', section: 'goto', label: 'Calendar', icon: 'calendar_month', hint: '2', run: () => goTo('calendar')},
    {id: 'news', section: 'goto', label: 'News', icon: 'newspaper', hint: '3', run: () => goTo('news')},
    ...jobsCommands(),
    {id: 'settings', section: 'goto', label: 'Settings', icon: 'settings', hint: '⌘,', run: () => openSettings('accounts')},
    ...THEME_CHOICES.map((choice): Command => ({
      id: `theme-${choice}`, section: 'appearance', label: THEME_LABELS[choice], icon: THEME_ICONS[choice], ticked: theme === choice,
      keywords: `theme appearance${choice === 'night' ? ' dark' : ''}`, run: () => setThemeChoice(choice),
    })),
    // Under Appearance, with `` ` ``, from 1100 px up, where the sidebar opens and folds.
    ...(sidebarFoldable(window.innerWidth) ? [sidebarCommand(isRail())] : []),
    // C is mail's key for it, as it is Calendar's for New event.
    {id: 'new-message', section: 'more', label: 'New message', icon: 'edit', hint: 'C', run: () => newMessage()},
    {id: 'new-event', section: 'more', label: 'New event', icon: 'event', hint: 'C', run: () => navigate({page: 'calendar', date: null, item: null, at: null, compose: {kind: 'event', message: null}})},
    {id: 'new-task', section: 'more', label: 'New task', icon: 'task_alt', hint: 'D', run: () => navigate({page: 'calendar', date: null, item: null, at: null, compose: {kind: 'task', message: null}})},
    {id: 'mark-all-read', section: 'more', label: 'Mark all as read', icon: 'mark_email_read', hint: '⇧I',
      run: () => void markAllRead().catch(toastFailure('Failed to mark all read'))},
    ...SETTINGS_SECTIONS.map(({page, keywords}): Command => ({
      id: `settings-${page}`, section: 'more', label: `Settings › ${SETTINGS_NAV[page].label}`, icon: SETTINGS_NAV[page].icon, keywords, run: () => openSettings(page),
    })),
    {id: 'sign-out', section: 'more', label: 'Sign out', icon: 'door_open', run: askSignOut},
  ];
}

// Whether it's open, for what waits until it closes (the overdue banner).
let isOpen = false;
const openListeners = new Set<() => void>();
const subscribeOpen = (listener: () => void) => {
  openListeners.add(listener);
  return () => {
    openListeners.delete(listener);
  };
};
/** Whether ⌘K is open, followed. */
export const usePaletteOpen = () => useSyncExternalStore(subscribeOpen, () => isOpen);

export function Palette() {
  const [offer, setOffer] = useState<Offer | null>(null);

  useEffect(() => {
    isOpen = offer !== null;
    openListeners.forEach(listener => listener());
  }, [offer]);

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
  const [query, setQuery] = useState('');
  // Null: where it starts, on the first result.
  const [cursor, setCursor] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  // A page's command stands in for the palette's own of the same id (Mark all as read on the Inbox).
  const groups = paletteList([...offer.commands, ...ownCommands(theme).filter(own => !offer.commands.some(command => command.id === own.id))], query);
  const items = groups.flatMap(group => group.items);
  // The Ask row is the list's first row once something is typed.
  const asks = query.trim() !== '';
  const lead = asks ? 1 : 0;
  const rows = items.length + lead;
  const at = Math.min(cursor ?? (asks && items.length ? 1 : 0), Math.max(0, rows - 1));

  // Focus goes back where it was as it closes, so a command acts on the page.
  useFocusReturn();
  useEffect(() => {
    input.current?.focus();
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

  function ask() {
    if (!asks) return;
    const question = query;
    onClose();
    // Asked over Settings, it closes, so Alfred's window isn't drawn under it.
    closeSettings();
    requestAnimationFrame(() => startAlfred({kind: 'page', context: pageContext(currentRoute(), offer.dates ?? null)}, question));
  }

  function onKeyDown(event: ReactKeyboardEvent) {
    // Nothing typed here reaches the page's own keys.
    event.stopPropagation();
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setCursor(stepCursor(at, event.key === 'ArrowDown' ? 1 : -1, rows));
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
      event.preventDefault();
      ask();
    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (asks && at === 0) ask();
      else run(items[at - lead]);
    } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      onClose();
    }
  }

  let index = lead;
  return (
    <>
      <div className="palette-scrim" onPointerDown={onClose} />
      <div className="palette" role="dialog" aria-label="Command palette" onKeyDown={onKeyDown}>
        {offer.context && (
          <div data-theme="night" className="ctx"><span className="tag"><span className="dot sm" style={dotStyle(offer.context.colour)} /><span className="ell">{offer.context.label}</span></span></div>
        )}
        <div data-theme="night" className="cmdk-in">
          <Icon name="search" size={20} />
          <input ref={input} className="grow" value={query} placeholder="Type a command…" aria-label="Type a command" spellCheck={false}
            onChange={event => {
              setQuery(event.target.value);
              setCursor(null);
            }} />
          <span className="kbd">Esc</span>
        </div>
        <div className="cmdk-list" role="listbox">
          {asks && (
            <button type="button" role="option" aria-selected={at === 0} className={at === 0 ? 'item ask cur' : 'item ask'}
              onMouseMove={() => at !== 0 && setCursor(0)} onClick={ask}>
              <Icon name="auto_awesome" alfred />
              <span className="grow ell">Ask Alfred <span className="ink3">· {query.trim()}</span></span>
              <span className="kbd">⌘Enter</span>
            </button>
          )}
          {groups.map(group => (
            <div key={group.section} role="group" aria-label={SECTION_LABELS[group.section]}>
              <div className="cmdk-label">{SECTION_LABELS[group.section]}</div>
              {group.items.map(command => {
                const mine = index++;
                return (
                  <button key={command.id} type="button" role="option" aria-selected={mine === at} className={mine === at ? 'item cur' : 'item'}
                    onMouseMove={() => mine !== at && setCursor(mine)} onClick={() => run(command)}>
                    {/* Alfred's sparkle is drawn in his ink wherever it shows. */}
                    <Icon name={command.icon} alfred={command.icon === 'auto_awesome'} />
                    <span><Matched label={command.label} query={query} /></span>
                    {command.hint && <span className="kbd">{command.hint}</span>}
                    {command.ticked && <span className="tick"><Icon name="check" size={16} /></span>}
                  </button>
                );
              })}
            </div>
          ))}
          {!items.length && !asks && <div className="none"><Icon name="search_off" size={16} />No command matches</div>}
        </div>
      </div>
    </>
  );
}

/** A command's label with the word prefixes typed marked, so the results answer what was typed. */
function Matched({label, query}: {label: string; query: string}) {
  const parts: ReactNode[] = [];
  let at = 0;
  for (const run of matchedRuns(label, query)) {
    if (run.start > at) parts.push(label.slice(at, run.start));
    parts.push(<mark key={run.start}>{label.slice(run.start, run.end)}</mark>);
    at = run.end;
  }
  parts.push(label.slice(at));
  return <>{parts}</>;
}
