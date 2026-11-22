// The overdue banner: on an arrival with Todoist tasks overdue, the page dims under its own colour
// and the task sits on it large, with no card or chrome. An arrival is a page load or the user
// coming back to the tab or the window (app/arrival.ts), never a page change inside the app, so a
// task going overdue mid-use raises nothing until the next one, and a banner due while they're away
// waits for their return. An arrival shows every overdue task not snoozed, until it's done, unless
// the banner was on screen in this browser less than 5 minutes before (its cooldown). One
// task is its title over its ring, project and due ("Errands · Due today, 8:00 AM"). Several are
// "3 tasks" over a list, the most recently due first, four and "and 3 more".
// It enters by Reveal: the veil and label fade in, the title slides up from behind its own
// baseline, then the due line (or the list) rises under it. Until the title is up it takes no
// click or key: they go to the page under it, as the click that brings the window back does. Then
// a press pushes the text in, the hint fades in late, and a click anywhere or Esc dismisses it for
// this visit, until the next arrival. It leaves by Return to its row: each title due today goes
// back to its Today line, which takes the landing tint, and the rest fades where it is
// (overdueExit.ts finds the lines, and the icon where they aren't on screen).
// Snooze: once the title is up each title has a snooze button after it, opening a menu of 1 hour,
// 3 hours and Tomorrow. A pick keeps the snooze in this browser (overdueSnoozed.ts) and the title
// fades where it is, its row closing up and the next hidden task taking its place; snoozing the
// last one sends the banner out, that title fading rather than returning. The button and menu take
// their own clicks, and a press outside an open menu closes only the menu. Esc closes a menu first,
// then the banner. Tab and Shift-Tab move among the snooze buttons (or a menu's presets, where the
// arrows move too), and Enter or Space presses one; no other key acts, on it or the page under it,
// and its click reaches nothing else. It sits over every page and the composer, under the toast.
// It waits while Settings or ⌘K is open, and isn't drawn below 640 px (App.tsx). Timings are
// tokens.ts's `overdue`.
import type {ItemOut, ItemsOut, Settings} from '@setpoint/shared';
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {SyntheticEvent} from 'react';
import {serverNow, timeZone} from '../api/auth.ts';
import {useResource} from '../api/client.ts';
import {itemsPath, SETTINGS_PATH} from '../api/items.ts';
import {overdueTasks} from '../logic/overdue.ts';
import type {Overdue} from '../logic/overdue.ts';
import {arrivalTasks, bannerRange, dueLine, exitLength, exitSplit, inCooldown, isSnoozed, keptSnoozes, listed, shortDue, snoozeFor, SNOOZES, snoozeUntil} from '../logic/overdueBanner.ts';
import type {SnoozeChoice} from '../logic/overdueBanner.ts';
import {motion, overdue as timing} from '../tokens.ts';
import {Icon, OverdueGlyph} from '../ui/Icon.tsx';
import {useRingColour} from './calendar/Chip.tsx';
import {useArrival} from './arrival.ts';
import {planExit} from './overdueExit.ts';
import {readSeen, readSnoozes, writeSeen, writeSnoozes} from './overdueSnoozed.ts';
import type {ExitPlan} from './overdueExit.ts';
import type {Arrival} from './arrival.ts';
import {usePaletteOpen} from './palette/Palette.tsx';
import {useSettingsPage} from './settings/store.ts';
import './overdue.css';

// While the banner is up, every key comes here first. It's listened for from the start, ahead of
// every page's own listeners, so none of them sees a key before the banner has kept it.
let keysUp: ((event: KeyboardEvent) => void) | null = null;
window.addEventListener('keydown', event => keysUp?.(event), true);

// The record an earlier banner kept of the tasks it had shown, so as not to show them again. Nothing
// reads it now; it's removed from this browser.
function forgetShown() {
  try {
    localStorage.removeItem('setpoint.overdueShown');
  } catch {
    // Storage refused: there's nothing kept to remove.
  }
}

/** The arrivals' banner: the last 30 days' items, judged as each arrival comes, and Settings' task time for Tomorrow. */
export function OverdueArrival() {
  const zone = timeZone();
  const {arrival, present} = useArrival();
  // The range follows the day of the latest arrival, so a tab left open overnight looks at the new one.
  const range = bannerRange(arrival?.at ?? serverNow(), zone);
  const {data} = useResource<ItemsOut>(itemsPath(range.from, range.to));
  const {data: settings} = useResource<Settings>(SETTINGS_PATH);
  return <OverdueArrivals arrival={arrival} present={present} items={data?.items} taskTime={settings?.reminders.task_time ?? null} timeZone={zone} />;
}

/**
 * The banner for each arrival over `items`: judged once the user is there and the items are in, and
 * shown unless one is up already, without the tasks a snooze holds off. An arrival with nothing to
 * show is done with, so a task that goes overdue later waits for the next one, as do one dismissed
 * and one whose snooze ends mid-use. An arrival within the cooldown after the banner was last on
 * screen, by this browser's clock, shows nothing. Each arrival drops the snoozes no longer needed.
 * It waits while Settings or ⌘K is open. A snooze picked on it is kept from then, Tomorrow at
 * `taskTime`.
 */
export function OverdueArrivals({arrival, present, items, taskTime, timeZone: zone}: {arrival: Arrival | null; present: boolean; items: readonly ItemOut[] | undefined; taskTime: string | null; timeZone: string}) {
  const [judged, setJudged] = useState(0);
  const [shown, setShown] = useState<{tasks: Overdue[]; at: number; key: number} | null>(null);
  // What the latest arrival was judged over, for its snoozes to be pruned once it's drawn.
  const [pruning, setPruning] = useState<{items: readonly ItemOut[]; at: number} | null>(null);
  const settings = useSettingsPage();
  const palette = usePaletteOpen();
  useEffect(forgetShown, []);
  if (arrival && arrival.count > judged && items && present) {
    setJudged(arrival.count);
    setPruning({items, at: arrival.at});
    if (!shown && !inCooldown(readSeen(), arrival.clock)) {
      const snoozes = readSnoozes();
      const tasks = arrivalTasks(overdueTasks(items, arrival.at, zone), zone).filter(task => !isSnoozed(task.item, snoozes, arrival.at));
      if (tasks.length) setShown({tasks, at: arrival.at, key: arrival.count});
    }
  }
  useEffect(() => {
    if (pruning) writeSnoozes(keptSnoozes(readSnoozes(), pruning.items, pruning.at));
  }, [pruning]);
  // On screen from its arrival until it has left: the cooldown runs from the last of it.
  useEffect(() => {
    if (shown) writeSeen(Date.now());
  }, [shown]);
  const gone = useCallback(() => {
    writeSeen(Date.now());
    setShown(null);
  }, []);
  const snooze = useCallback((item: ItemOut, choice: SnoozeChoice) => {
    const until = snoozeUntil(choice, serverNow(), taskTime, zone);
    writeSnoozes([...readSnoozes().filter(kept => kept.id !== item.id), snoozeFor(item, until)]);
  }, [taskTime, zone]);
  if (!shown || settings !== null || palette) return null;
  return <OverdueBanner key={shown.key} overdue={shown.tasks} now={shown.at} timeZone={zone} onGone={gone} onSnooze={snooze} />;
}

const keep = (event: SyntheticEvent) => event.stopPropagation();

/** A title's snooze button and, when `open`, its menu of presets under it. `large` beside one task's title: 30 px with an 18 px glyph. */
function SnoozeButton({task, large, open, onOpen, onPick}: {task: string; large: boolean; open: boolean; onOpen: (open: boolean) => void; onPick: (choice: SnoozeChoice) => void}) {
  return (
    <span className="overdue-snooze" data-for={task}>
      <button type="button" className={large ? 'ibtn overdue-snooze-button' : 'ibtn sm overdue-snooze-button'} aria-label="Snooze" aria-haspopup="menu" aria-expanded={open} data-tip={open ? undefined : 'Snooze'}
        onClick={() => onOpen(!open)}>
        <Icon name="snooze" size={large ? 18 : 16} />
      </button>
      {open && (
        <div className="pop menu overdue-menu" role="menu" aria-label="Snooze">
          {SNOOZES.map(({choice, label}) => (
            <button key={choice} type="button" role="menuitem" className="menu-i" onClick={() => onPick(choice)}>{label}</button>
          ))}
        </div>
      )}
    </span>
  );
}

/** How long the banner takes to enter, taking no click or key meanwhile: the Reveal's title. */
export const ENTRANCE_MS = timing.titleDelay + timing.title;

// A colour mix of the theme's `caution`, read where it's drawn so WAAPI keyframes get a value.
const cautionMix = (element: Element, percent: number) => `color-mix(in oklch, ${getComputedStyle(element).getPropertyValue('--caution').trim()} ${percent}%, transparent)`;

/** Plays the way out: the titles fly, each line lands, and the icon comes and goes. */
function playExit(banner: HTMLElement, plan: ExitPlan) {
  const ease = {easing: motion.ease};
  const toIcon = plan.icon !== null;
  const hold = (toIcon ? timing.iconHoldPct : timing.flyHoldPct) / 100;
  plan.flights.forEach((flight, index) => {
    const title = banner.querySelector<HTMLElement>(`[data-key="${CSS.escape(flight.key)}"]`);
    const delay = index * timing.flyStagger;
    // As a CSS animation's keyframes: the easing runs per stretch, so opacity holds, then fades.
    title?.animate([
      {offset: 0, transform: 'none', opacity: 1, easing: timing.flyEase},
      {offset: hold, opacity: 1, easing: timing.flyEase},
      {offset: 1, transform: `translate(${flight.x}px, ${flight.y}px) scale(${flight.scale})`, opacity: 0},
    ], {duration: timing.fly, delay, fill: 'both'});
    if (toIcon) return;
    // Its line takes the landing tint as it arrives, fading to none (a lone keyframe at 0, as CSS's
    // `from`). The animation is the line's, so it outlives the banner.
    const line = document.querySelector(`.sb .today-row[data-key="${CSS.escape(flight.key)}"]`);
    line?.animate([{offset: 0, background: cautionMix(line, timing.landTintPct), ...ease}], {duration: timing.land, delay: delay + timing.fly});
  });
  const icon = banner.querySelector<HTMLElement>('.overdue-icon');
  if (!icon || !plan.flights.length) return;
  icon.animate([{opacity: 0, transform: `scale(${timing.iconFrom})`, ...ease}, {opacity: 1, transform: 'none'}], {duration: timing.iconIn, fill: 'forwards'});
  const tile = (percent: number) => cautionMix(icon, percent);
  const arrived = (plan.flights.length - 1) * timing.flyStagger + timing.fly;
  icon.animate([
    {offset: 0, opacity: 1, background: tile(timing.iconTintPct), ...ease},
    {offset: timing.iconSettleAt / 100, opacity: 1, background: tile(timing.iconSettlePct), ...ease},
    {offset: timing.iconHoldAt / 100, opacity: 1, background: tile(timing.iconSettlePct), ...ease},
    {offset: 1, opacity: 0, background: tile(0)},
  ], {duration: timing.iconLand, delay: arrived, fill: 'forwards'});
}

/**
 * The banner over `overdue`, the most recently due first. Nothing when there are none. `onGone`
 * hears when it has left, or that it had nothing to show.
 */
export function OverdueBanner({overdue, now, timeZone: zone, onGone, onSnooze}: {overdue: readonly Overdue[]; now: number; timeZone: string; onGone?: () => void; onSnooze?: (item: ItemOut, choice: SnoozeChoice) => void}) {
  // The tasks still on it: a snoozed one goes once its row has closed up.
  const [tasks, setTasks] = useState(() => arrivalTasks(overdue, zone));
  // The arrival's layout holds: several stay a list as they're snoozed down to one.
  const [many] = useState(() => tasks.length > 1);
  // The keys listed as it arrived; a task drawn later takes a snoozed one's place.
  const [arrived] = useState(() => new Set(listed(tasks).listed.map(task => task.item.key)));
  const [phase, setPhase] = useState<'entering' | 'in' | 'out' | 'gone'>(tasks.length ? 'entering' : 'gone');
  // The dismiss hint comes late, so a quick click never sees it.
  const [hinted, setHinted] = useState(false);
  // The way out, measured at the click.
  const [exit, setExit] = useState<ExitPlan | null>(null);
  // The snooze menu open, by its task's key.
  const [menu, setMenu] = useState<string | null>(null);
  // The snoozed titles leaving, by key.
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set());
  // A press that closed the menu, so its click doesn't dismiss the banner too.
  const closing = useRef(false);
  const ring = useRingColour();
  const banner = useRef<HTMLDivElement>(null);
  // Where focus was as it settled, given back once it's dismissed (a draft in the composer).
  const before = useRef<Element | null>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    if (phase !== 'entering') return;
    const timer = window.setTimeout(() => setPhase('in'), ENTRANCE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  useEffect(() => {
    const timer = window.setTimeout(() => setHinted(true), timing.hintDelay);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => () => timers.current.forEach(timer => window.clearTimeout(timer)), []);

  // The way out is measured now, from layout, and nothing waits on it. The titles in `gone`, snoozed,
  // fade rather than return.
  const leave = useCallback((gone: ReadonlySet<string>) => {
    if (phase !== 'in') return;
    const returning = exitSplit(tasks).returning.filter(task => !gone.has(task.item.key)).map(task => task.item.key);
    setExit(banner.current ? planExit(banner.current, returning) : {flights: [], icon: null});
    setMenu(null);
    setPhase('out');
  }, [phase, tasks]);
  const dismiss = useCallback(() => leave(leaving), [leave, leaving]);

  const closeMenu = useCallback(() => {
    banner.current?.querySelector<HTMLElement>(`.overdue-snooze[data-for="${CSS.escape(menu ?? '')}"] > button`)?.focus();
    setMenu(null);
  }, [menu]);

  /** Snoozes a task: its title fades and its row closes up, or with none left the banner goes. */
  const pick = (task: Overdue, choice: SnoozeChoice) => {
    if (phase !== 'in') return;
    const {key} = task.item;
    onSnooze?.(task.item, choice);
    setMenu(null);
    banner.current?.focus();
    const gone = new Set(leaving).add(key);
    setLeaving(gone);
    if (tasks.every(each => gone.has(each.item.key))) {
      leave(gone);
      return;
    }
    timers.current.push(window.setTimeout(() => {
      setTasks(now => now.filter(each => each.item.key !== key));
      setLeaving(now => new Set([...now].filter(each => each !== key)));
    }, timing.snoozeOut + timing.closeUp));
  };

  useEffect(() => {
    if (phase !== 'in') return;
    before.current = document.activeElement;
    banner.current?.focus();
  }, [phase]);

  // A menu opened takes the focus to its first preset.
  useEffect(() => {
    if (menu) banner.current?.querySelector<HTMLElement>('.overdue-menu [role="menuitem"]')?.focus();
  }, [menu]);

  useEffect(() => {
    if (phase !== 'in') return;
    keysUp = event => {
      event.stopImmediatePropagation();
      const root = banner.current;
      const active = document.activeElement;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (menu) closeMenu();
        else dismiss();
        return;
      }
      // Tab and the arrows move among the snooze buttons, or an open menu's presets, never out to the page.
      const stops = [...root?.querySelectorAll<HTMLElement>(menu ? '.overdue-menu [role="menuitem"]' : ':not([data-leaving]) > .overdue-snooze > button') ?? []];
      const step = event.key === 'Tab' ? (event.shiftKey ? -1 : 1) : menu && event.key === 'ArrowDown' ? 1 : menu && event.key === 'ArrowUp' ? -1 : 0;
      if (step) {
        event.preventDefault();
        const at = stops.indexOf(active as HTMLElement);
        const next = at < 0 ? (step > 0 ? 0 : stops.length - 1) : (at + step + stops.length) % stops.length;
        stops[next]?.focus();
        return;
      }
      // Enter or Space presses the snooze button or preset that has the focus.
      if ((event.key === 'Enter' || event.key === ' ') && active instanceof HTMLElement && stops.includes(active)) return;
      // Any other plain key does nothing. The browser's own shortcuts still work.
      if (!event.metaKey && !event.ctrlKey) event.preventDefault();
    };
    return () => {
      keysUp = null;
    };
  }, [phase, dismiss, menu, closeMenu]);

  // A snoozed row fades where it is, then closes up.
  useLayoutEffect(() => {
    for (const row of banner.current?.querySelectorAll<HTMLElement>('.overdue-list li[data-leaving]:not([data-closing])') ?? []) {
      row.dataset.closing = '';
      row.animate([{opacity: 1}, {opacity: 0}], {duration: timing.snoozeOut, easing: motion.ease, fill: 'forwards'});
      row.animate([{height: `${row.offsetHeight}px`}, {height: '0px', paddingTop: '0px', paddingBottom: '0px', borderTopWidth: '0px'}],
        {duration: timing.closeUp, delay: timing.snoozeOut, easing: motion.ease, fill: 'forwards'});
    }
  }, [leaving]);

  // Played once its exit marks and the icon are drawn.
  useLayoutEffect(() => {
    if (phase === 'out' && exit && banner.current) playExit(banner.current, exit);
  }, [phase, exit]);

  useEffect(() => {
    if (phase !== 'out') return;
    if (before.current instanceof HTMLElement && before.current.isConnected) before.current.focus();
    const timer = window.setTimeout(() => setPhase('gone'), exitLength(exit?.flights.length ?? 0, Boolean(exit?.icon)));
    return () => window.clearTimeout(timer);
  }, [phase, exit]);

  useEffect(() => {
    if (phase === 'gone') onGone?.();
  }, [phase, onGone]);

  if (phase === 'gone') return null;
  const one = many ? null : tasks[0]!.item;
  const {listed: rows, more} = listed(tasks);
  const count = tasks.length - leaving.size;
  // On the way out each drawn title says whether it returns or fades.
  const flying = new Set(exit?.flights.map(flight => flight.key));
  const exitOf = (key: string) => (exit ? (flying.has(key) ? 'return' : 'fade') : undefined);
  const icon = exit?.icon;
  // The snooze buttons are there once the title is up, and gone on the way out.
  const snoozeable = phase === 'in';
  const snoozeOf = (task: Overdue, large = false) => (
    <SnoozeButton key="snooze" task={task.item.key} large={large} open={menu === task.item.key} onOpen={open => setMenu(open ? task.item.key : null)} onPick={choice => pick(task, choice)} />
  );
  return (
    <div ref={banner} className={`overdue ${phase}`} role="dialog" aria-modal="true" aria-label="Overdue tasks" tabIndex={-1} data-state={phase}
      onClick={event => {
        keep(event);
        // A snooze button or menu takes its own click, and a press that closed a menu ends there.
        if (closing.current || (event.target as Element).closest('.overdue-snooze')) {
          closing.current = false;
          return;
        }
        dismiss();
      }}
      onPointerDown={event => {
        keep(event);
        closing.current = menu !== null && !(event.target as Element).closest('.overdue-snooze');
        if (closing.current) setMenu(null);
      }} onMouseDown={keep} onPointerUp={keep} onMouseUp={keep} onDoubleClick={keep}
      onContextMenu={event => {
        keep(event);
        event.preventDefault();
      }}>
      {icon && (
        <div className="overdue-icon" style={{left: icon.left, top: icon.top, width: icon.width, height: icon.height}}>
          <OverdueGlyph />
        </div>
      )}
      <div className="overdue-veil" />
      <div className="overdue-place">
        <div className="overdue-stack">
          <div className="overdue-label"><span className="overdue-dot" />Overdue</div>
          {one ? (
            <div className="overdue-one">
              <div className="overdue-mask">
                <div className="overdue-title" data-key={one.key} data-exit={exitOf(one.key)}>{one.title}{snoozeable && snoozeOf(tasks[0]!, true)}</div>
              </div>
              <div className="overdue-due">
                <span className="ring" style={ring(one.project)} />
                <span>{[one.project, dueLine(one, now, zone)].filter(Boolean).join(' · ')}</span>
              </div>
            </div>
          ) : (
            <div className="overdue-many">
              <div className="overdue-mask">
                <div className="overdue-title">{count} {count === 1 ? 'task' : 'tasks'}</div>
              </div>
              <ul className="overdue-list">
                {rows.map(task => (
                  <li key={task.item.key} className={arrived.has(task.item.key) ? undefined : 'refill'} data-leaving={leaving.has(task.item.key) ? '' : undefined}>
                    <span className="ring" style={ring(task.item.project)} />
                    <span className="overdue-name"><span className="overdue-fly" data-key={task.item.key} data-exit={exitOf(task.item.key)}>{task.item.title}</span></span>
                    {snoozeable && snoozeOf(task)}
                    <span className="overdue-when">{shortDue(task.item, now, zone)}</span>
                  </li>
                ))}
                {more > 0 && <li className="overdue-more">and {more} more</li>}
              </ul>
            </div>
          )}
        </div>
      </div>
      {hinted && <div className="overdue-hint"><span>Click anywhere to dismiss</span><span className="kbd">Esc</span></div>}
    </div>
  );
}
