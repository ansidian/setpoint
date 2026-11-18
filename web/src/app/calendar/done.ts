// One completion moment (styles.css): a task ticked off where it's drawn plays it, as the Today
// block's line does, for DONE_MOMENT_MS. A task already done when first drawn, or reopened, plays
// nothing, and one reopened while it plays stops.
import {useEffect, useState} from 'react';
import {playsDone} from '../../logic/calendar.ts';
import {DONE_MOMENT_MS} from '../../logic/today.ts';

/** The keys of `tasks` that turned done since they were last drawn here, until DONE_MOMENT_MS after the last. */
export function useJustDone(tasks: readonly {key: string; done: boolean}[]): ReadonlySet<string> {
  const states = tasks.map(task => `${task.key}:${task.done ? 1 : 0}`).join('\n');
  const [last, setLast] = useState(() => ({states, done: new Map(tasks.map(task => [task.key, task.done])), just: new Set<string>() as ReadonlySet<string>}));
  if (last.states !== states) {
    const turned = playsDone(last.done, tasks);
    const done = new Map(last.done);
    for (const task of tasks) done.set(task.key, task.done);
    // A task reopened while its moment plays stops playing it.
    const playing = [...last.just].filter(key => done.get(key));
    setLast({states, done, just: turned.length || playing.length < last.just.size ? new Set([...playing, ...turned]) : last.just});
  }
  useEffect(() => {
    if (!last.just.size) return;
    const timer = window.setTimeout(() => setLast(current => ({...current, just: new Set()})), DONE_MOMENT_MS);
    return () => window.clearTimeout(timer);
  }, [last.just]);
  return last.just;
}
