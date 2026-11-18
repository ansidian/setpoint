// The overdue banner: on a page load with Todoist tasks overdue that this browser hasn't shown, the
// page dims under its own colour and the task sits on it large, with no card or chrome. One task is
// its title over its ring, project and due ("Errands · Due today, 8:00 AM"). Several are "3 tasks"
// over a list, the most recently due first, four and "and 3 more". A click anywhere or Esc dismisses
// it, and marks its tasks shown in this browser (overdueShown.ts) so it doesn't come back for them.
// While it's up no other key acts, on it or the page under it, and its click reaches nothing else.
// It sits over every page and the composer, under the toast. It waits while Settings or ⌘K is open,
// and isn't drawn below 640 px (App.tsx). It fades in and out (120 ms, the veil 180 ms).
import type {ItemsOut} from '@setpoint/shared';
import {useCallback, useEffect, useRef, useState} from 'react';
import type {SyntheticEvent} from 'react';
import {serverNow, timeZone} from '../api/auth.ts';
import {useResource} from '../api/client.ts';
import {itemsPath} from '../api/items.ts';
import {overdueTasks} from '../logic/overdue.ts';
import type {Overdue} from '../logic/overdue.ts';
import {arrivalTasks, bannerRange, dueLine, listed, shortDue, shownKey} from '../logic/overdueBanner.ts';
import {motion} from '../tokens.ts';
import {useRingColour} from './calendar/Chip.tsx';
import {markShown, shownTasks} from './overdueShown.ts';
import {usePaletteOpen} from './palette/Palette.tsx';
import {useSettingsPage} from './settings/store.ts';
import './overdue.css';

// While the banner is up, every key comes here first. It's listened for from the start, ahead of
// every page's own listeners, so none of them sees a key before the banner has kept it.
let keysUp: ((event: KeyboardEvent) => void) | null = null;
window.addEventListener('keydown', event => keysUp?.(event), true);

/**
 * The page load's banner: the last 30 days' items, judged once as they first come, so a task going
 * overdue later raises nothing. It waits while Settings or ⌘K is open.
 */
export function OverdueArrival() {
  const zone = timeZone();
  const [range] = useState(() => bannerRange(serverNow(), zone));
  const [overdue, setOverdue] = useState<{tasks: Overdue[]; at: number} | null>(null);
  const {data} = useResource<ItemsOut>(overdue ? null : itemsPath(range.from, range.to));
  const settings = useSettingsPage();
  const palette = usePaletteOpen();
  if (data && !overdue) {
    const at = serverNow();
    setOverdue({tasks: overdueTasks(data.items, at, zone), at});
  }
  if (!overdue || settings !== null || palette) return null;
  return <OverdueBanner overdue={overdue.tasks} now={overdue.at} timeZone={zone} />;
}

const keep = (event: SyntheticEvent) => event.stopPropagation();

/** The banner over `overdue`, less what this browser has shown. Nothing when that's all of them. */
export function OverdueBanner({overdue, now, timeZone: zone}: {overdue: readonly Overdue[]; now: number; timeZone: string}) {
  const [tasks] = useState(() => arrivalTasks(overdue, shownTasks(), zone));
  const [phase, setPhase] = useState<'in' | 'out' | 'gone'>(tasks.length ? 'in' : 'gone');
  const ring = useRingColour();
  const banner = useRef<HTMLDivElement>(null);

  // Shown once it's dismissed, not when it appears, so a reload before then shows it again.
  const dismiss = useCallback(() => {
    if (phase !== 'in') return;
    markShown(tasks.map(task => shownKey(task.item)), now, zone);
    setPhase('out');
  }, [phase, tasks, now, zone]);

  useEffect(() => {
    if (phase !== 'in') return;
    banner.current?.focus();
    keysUp = event => {
      event.stopImmediatePropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        dismiss();
      } else if (!event.metaKey && !event.ctrlKey) {
        // A plain key does nothing (Tab, Space, Enter). The browser's own shortcuts still work.
        event.preventDefault();
      }
    };
    return () => {
      keysUp = null;
    };
  }, [phase, dismiss]);

  useEffect(() => {
    if (phase !== 'out') return;
    const timer = window.setTimeout(() => setPhase('gone'), motion.medium);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (phase === 'gone') return null;
  const one = tasks.length === 1 ? tasks[0]!.item : null;
  const {listed: rows, more} = listed(tasks);
  return (
    <div ref={banner} className={`overdue ${phase}`} role="dialog" aria-modal="true" aria-label="Overdue tasks" tabIndex={-1} data-state={phase}
      onClick={event => {
        keep(event);
        dismiss();
      }}
      onPointerDown={keep} onMouseDown={keep} onPointerUp={keep} onMouseUp={keep} onDoubleClick={keep}
      onContextMenu={event => {
        keep(event);
        event.preventDefault();
      }}>
      <div className="overdue-veil" />
      <div className="overdue-place">
        <div className="overdue-stack">
          <div className="overdue-label"><span className="overdue-dot" />Overdue</div>
          {one ? (
            <div className="overdue-one">
              <div className="overdue-title">{one.title}</div>
              <div className="overdue-due">
                <span className="ring" style={ring(one.project)} />
                <span>{[one.project, dueLine(one, now, zone)].filter(Boolean).join(' · ')}</span>
              </div>
            </div>
          ) : (
            <div className="overdue-many">
              <div className="overdue-title">{tasks.length} tasks</div>
              <ul className="overdue-list">
                {rows.map(({item}) => (
                  <li key={item.key}>
                    <span className="ring" style={ring(item.project)} />
                    <span className="overdue-name">{item.title}</span>
                    <span className="overdue-when">{shortDue(item, now, zone)}</span>
                  </li>
                ))}
                {more > 0 && <li className="overdue-more">and {more} more</li>}
              </ul>
            </div>
          )}
        </div>
      </div>
      <div className="overdue-hint"><span>Click anywhere to dismiss</span><span className="kbd">Esc</span></div>
    </div>
  );
}
