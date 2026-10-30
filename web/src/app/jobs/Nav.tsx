// Jobs in the shell (DESIGN.md › Jobs › Shell; D313, D325): the sidebar's item under News, `work`, its
// count the Needs you count in ink2 (gone at zero), its tooltip "Jobs · 3 need you"; in a narrow
// window the rail's slot after News, its count a neutral 16 px badge (jobs.css). Only while Jobs is on:
// turned on, it folds in under News over 180 ms (39a); off, it has no item, and `4` opens the off page
// (38c). ⌘K's Go to lists "Jobs 4" only while it's on, as the sidebar does. What this browser last saw is
// kept, so the shell draws it as it starts (#234).
import type {JobsNavOut} from '@setpoint/shared';
import {useEffect, useState} from 'react';
import type {MouseEvent} from 'react';
import {useResource} from '../../api/client.ts';
import {routePath} from '../../logic/route.ts';
import {Icon} from '../../ui/Icon.tsx';
import {Count} from '../Count.tsx';
import type {Command} from '../palette/commands.ts';
import {foldRef} from '../fold.ts';
import {navigate} from '../router.ts';
import {cachedNav, NAV_PATH} from './api.ts';

const KEY = 'setpoint.jobsNav';

function remembered(): JobsNavOut | null {
  try {
    const kept = JSON.parse(localStorage.getItem(KEY) ?? 'null') as JobsNavOut | null;
    return kept && typeof kept.enabled === 'boolean' && typeof kept.needs_you === 'number' ? kept : null;
  } catch {
    return null;
  }
}

function remember(nav: JobsNavOut) {
  try {
    localStorage.setItem(KEY, JSON.stringify(nav));
  } catch {
    // Private windows may refuse; the shell then draws it once it's answered.
  }
}

const JOBS = {page: 'jobs', open: null} as const;

/** Whether Jobs is on, as last answered (or last seen in this browser), for `4`. */
export const jobsOn = () => (cachedNav() ?? remembered())?.enabled ?? false;

/** `4`: Jobs, on or off (off, its page says so, with Turn on). */
export function goToJobs(): boolean {
  navigate(JOBS);
  return true;
}

/** ⌘K's Go to: "Jobs 4", while it's on. */
export const jobsCommands = (): Command[] => (jobsOn() ? [{id: 'jobs', section: 'goto', label: 'Jobs', icon: 'work', hint: '4', run: () => navigate(JOBS)}] : []);

/** The sidebar's item, or the rail's slot. `frame`: drawn while Setpoint starts, asking for nothing. */
export function JobsNavItem({current, frame}: {current: boolean; frame: boolean}) {
  const {data} = useResource<JobsNavOut>(frame ? null : NAV_PATH);
  useEffect(() => {
    if (data) remember(data);
  }, [data]);
  const nav = data ?? remembered();
  const on = nav?.enabled ?? false;
  // Turned on while Setpoint is open: the item folds in, rather than being there at once.
  const [was, setWas] = useState({on, arrives: false});
  if (was.on !== on) setWas({on, arrives: on});
  if (!nav?.enabled) return null;
  const count = nav.needs_you;
  const onClick = (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    navigate(JOBS);
  };
  return (
    <a ref={was.arrives ? foldRef('in') : undefined} className={current ? 'nav jobs on' : 'nav jobs'} href={routePath(JOBS)} title={count > 0 ? `Jobs · ${count} need${count === 1 ? 's' : ''} you` : 'Jobs'} onClick={onClick}>
      <Icon name="work" />
      <span className="grow">Jobs</span>
      {count > 0 && <span className="cnt num"><Count value={count} /></span>}
    </a>
  );
}
