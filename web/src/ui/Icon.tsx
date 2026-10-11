// Icons and the Todoist rings, drawn from the bundled paths in glyphs.ts in currentColor, and the mark.
// DESIGN.md's sizes: 18 in the sidebar and rows, 16 in buttons and tools, 14 in chips, 17 in facts.
import {ICON_VIEWBOX, ICONS, type IconName, TASK_GLYPHS} from './glyphs.ts';

export function Icon({name, size = 18}: {name: IconName; size?: number}) {
  return (
    <svg className="icon" width={size} height={size} viewBox={ICON_VIEWBOX} fill="currentColor" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

/** A Todoist task's glyph: the open ring, or the done disc in `good`. */
export function TaskGlyph({done, size = 13}: {done: boolean; size?: number}) {
  return (
    <svg className={done ? 'task-glyph done' : 'task-glyph'} width={size} height={size} viewBox={TASK_GLYPHS.viewBox} aria-hidden="true"
      dangerouslySetInnerHTML={{__html: done ? TASK_GLYPHS.done : TASK_GLYPHS.open}} />
  );
}

/** Day stack (decision 44, #87): three calendar chips, the middle one lifted, in the theme's own
 * `cool`, `caution` and `violet`, which stay put when an account or calendar is recoloured.
 * web/public/favicon.svg draws the same chips on darma's tile. */
export function Mark({size = 18}: {size?: number}) {
  return (
    <svg className="mark" width={size} height={size} viewBox="0 0 22 22" aria-hidden="true">
      <rect x="2" y="2.6" width="13.5" height="4.6" rx="2.3" style={{fill: 'var(--cool)'}} />
      <rect x="5.5" y="8.7" width="13.5" height="4.6" rx="2.3" style={{fill: 'var(--caution)'}} transform="rotate(-6 12.25 11)" />
      <rect x="2" y="14.8" width="10" height="4.6" rx="2.3" style={{fill: 'var(--violet)'}} />
    </svg>
  );
}
