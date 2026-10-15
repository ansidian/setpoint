// What the floating detail shows of an item (board 12a; DESIGN.md › The floating detail): the
// colour dot and title, the date and time, the place and its address (a link alone as `videocam` and
// its host, and any link with Open, SV-77), Time to Leave (in `caution`
// once it's time to go and gone once the event starts, as in the day agenda, SV-56), attendees, a
// recurring event's repeat (#126), reminders and the calendar, its glyph in the item's colour; then Edit E and the icon actions (F6): Clone, Copy (⌘V pastes on the
// selected day), Colour (an event's own, from the swatches Google's event colours fall on) and
// Delete; a Todoist task also has Complete, Reopen once it's done (SV-25, D55). Google's own kinds
// of event take none of them. Off Calendar (the Today block's card, #78) a page offers the ones it
// can carry out and Open in Calendar; the others aren't drawn.
import type {EventColour, ItemOut} from '@setpoint/shared';
import {EVENT_COLOURS} from '@setpoint/shared';
import {useState} from 'react';
import type {CSSProperties, ReactNode} from 'react';
import {describeTaskRepeat} from '../../../logic/compose.ts';
import {attendeesLine, detailWhen, leaveBy, remindersLine, repeatLine} from '../../../logic/detail.ts';
import {placeLines, placeLink} from '../../../logic/place.ts';
import {Icon, TaskGlyph} from '../../../ui/Icon.tsx';
import type {IconName} from '../../../ui/glyphs.ts';
import {colourVar} from '../../accounts.ts';
import {useNow} from '../../clock.ts';
import {useRingColour} from '../Chip.tsx';
import {useJustDone} from '../done.ts';
import type {DetailTarget} from './motion.ts';

/** The card's icon actions, carried out by the Calendar page, or the ones another page offers. */
export interface DetailActions {
  complete: (task: ItemOut) => void;
  clone?: (item: ItemOut) => void;
  copy?: (item: ItemOut) => void;
  colour?: (item: ItemOut, colour: EventColour | null) => void;
  remove?: (item: ItemOut) => void;
  // Off Calendar: the item there, with its card.
  open?: (item: ItemOut) => void;
}

interface DetailContentProps {
  target: DetailTarget;
  timeZone: string;
  actions?: DetailActions;
  onClose: () => void;
  onEdit: () => void;
}

function Fact({icon, className, style, children}: {icon: IconName; className?: string; style?: CSSProperties; children: ReactNode}) {
  return <div className={className ? `fact ${className}` : 'fact'} style={style}><Icon name={icon} size={17} />{children}</div>;
}

/** Open (SV-77): the place's link in a new tab, as `O` does on Calendar. */
function OpenLink({url}: {url: string}) {
  return (
    <a className="btn ghost sm fd-open" href={url} target="_blank" rel="noopener noreferrer" data-hint="o" title={`Open ${url} · O`}>
      <Icon name="open_in_new" size={16} />Open
    </a>
  );
}

export function DetailContent({target, timeZone, actions, onClose, onEdit}: DetailContentProps) {
  const {item, calendar} = target;
  const [picking, setPicking] = useState(false);
  const now = useNow();
  const colour = {'--c': colourVar(item.colour ?? calendar?.colour ?? (item.kind === 'task' ? undefined : 'cool'))} as CSSProperties;
  const fixed = item.read_only || !actions;
  const act = (run: (one: ItemOut) => void) => () => !fixed && run(item);
  // Without actions (Google's own kinds, the phone) every one is drawn, unavailable.
  const offers = (action: 'clone' | 'copy' | 'colour' | 'remove') => !actions || !!actions[action];
  const leave = leaveBy(item, timeZone, now);
  const attendees = attendeesLine(item.attendees);
  const reminders = remindersLine(item.reminders);
  const place = placeLines(item.place, item.address);
  const link = item.kind === 'event' ? placeLink(item) : null;
  const repeat = repeatLine(item, timeZone);
  // A task's card is drawn as the task is on the grid (polish audit calflows-10, shell-15): its ring in
  // its project's colour, struck through once done, at .5 with the spinner while Todoist hasn't
  // confirmed, and Complete landing its done check as everywhere else (done.ts).
  const ring = useRingColour();
  const pending = item.command?.state === 'pending';
  const justDone = useJustDone(item.kind === 'task' ? [item] : []);
  return (
    <>
      <div className="card-h">
        <span className={`fd-mark${pending ? ' pending' : ''}${justDone.has(item.key) ? ' just-done' : ''}`}>
          {item.kind === 'event' ? <span className="dot" style={{...colour, width: 10, height: 10}} />
            : item.done ? <TaskGlyph done size={13} /> : <span className="ring" style={ring(item.project)} />}
        </span>
        <span className={`grow ell fd-title${item.kind === 'task' && item.done ? ' done' : ''}`} title={item.title}>{item.title}</span>
        {pending && <span className="spin" aria-label="Saving"><Icon name="progress_activity" size={16} /></span>}
        <button className="ibtn sm" aria-label="Close" title="Close · Esc" onClick={onClose}><Icon name="close" size={16} /></button>
      </div>
      <div className="card-b">
        <div className="ink2 num fd-when">{detailWhen(item, timeZone)}</div>
        {link?.only ? (
          <Fact icon="videocam" className="link">
            <span className="grow"><span className="v fd-place" title={link.url}>{link.host}</span></span>
            <OpenLink url={link.url} />
          </Fact>
        ) : place && (
          <Fact icon="location_on" className={link ? 'link' : undefined}>
            <span className="grow"><span className="v fd-place">{place.name}</span>{place.address && <span className="ink3 fd-address">{place.address}</span>}</span>
            {link && <OpenLink url={link.url} />}
          </Fact>
        )}
        {leave && <Fact icon="directions_car" className={leave.state === 'due' ? 'leave due' : 'leave'}><span className="num"><span className="v">{leave.at}</span> · {leave.travel}</span></Fact>}
        {attendees && <Fact icon="group"><span>{attendees}</span></Fact>}
        {repeat && <Fact icon="repeat"><span>{repeat}</span></Fact>}
        {item.kind === 'task' && item.project && (
          <div className="fact project"><span className="fact-dot"><span className="dot" style={ring(item.project)} /></span><span>{item.project}</span></div>
        )}
        {item.due_string && item.recurring && <Fact icon="repeat"><span>{describeTaskRepeat(item.due_string)}</span></Fact>}
        {reminders && <Fact icon="notifications"><span>{reminders}</span></Fact>}
        <Fact icon="calendar_today" className="cal" style={colour}><span>{calendar?.name ?? 'Calendar'}</span></Fact>
      </div>
      <div className="card-acts">
        <button className="btn ghost sm" data-hint="e" aria-disabled={item.read_only || undefined} title={item.read_only ? 'Google doesn\'t let this kind of event change' : 'Edit · E'}
          onClick={item.read_only ? undefined : onEdit}>
          <Icon name="edit" size={16} />Edit<span className="kbd">E</span>
        </button>
        <span className="grow" />
        {item.kind === 'task' && (
          <button className={item.done ? 'ibtn sm' : 'ibtn sm affirm'} aria-label={item.done ? 'Reopen' : 'Complete'} aria-disabled={fixed || !!item.command || (item.done && item.recurring) || undefined}
            title={item.command ? 'Waiting for Todoist' : item.done && item.recurring ? 'Todoist has moved this repeating task on' : item.done ? 'Reopen' : 'Complete'}
            onClick={act(task => !task.command && !(task.done && task.recurring) && actions!.complete(task))}>
            <Icon name={item.done ? 'undo' : 'task_alt'} size={16} />
          </button>
        )}
        {actions?.open && <button className="ibtn sm" aria-label="Open in Calendar" title="Open in Calendar" onClick={() => actions.open!(item)}><Icon name="calendar_month" size={16} /></button>}
        {offers('clone') && <button className="ibtn sm" aria-label="Clone" aria-disabled={fixed || undefined} title="Clone" onClick={act(one => actions!.clone!(one))}><Icon name="control_point_duplicate" size={16} /></button>}
        {offers('copy') && <button className="ibtn sm" aria-label="Copy" aria-disabled={fixed || undefined} title="Copy · ⌘C" onClick={act(one => actions!.copy!(one))}><Icon name="content_copy" size={16} /></button>}
        {offers('colour') && item.kind === 'event' && (
          <button className="ibtn sm" aria-label="Colour" aria-expanded={picking} aria-disabled={fixed || undefined} title="Colour" onClick={() => !fixed && setPicking(!picking)}>
            <span className="dot" style={{...colour, width: 12, height: 12}} />
          </button>
        )}
        {offers('remove') && <button className="ibtn sm danger" aria-label="Delete" aria-disabled={fixed || undefined} title="Delete · Del" onClick={act(one => actions!.remove!(one))}><Icon name="delete" size={16} /></button>}
      </div>
      {picking && (
        <div className="fd-swatches" role="radiogroup" aria-label="Colour">
          <button role="radio" aria-checked={item.colour === null} aria-label={`${calendar?.name ?? 'Calendar'}'s colour`} title={`${calendar?.name ?? 'Calendar'}'s colour`}
            className={`swatch calendar${item.colour === null ? ' on' : ''}`} style={{'--c': colourVar(calendar?.colour ?? 'cool')} as CSSProperties}
            onClick={() => {
              setPicking(false);
              if (item.colour !== null) actions!.colour!(item, null);
            }} />
          {EVENT_COLOURS.map(swatch => (
            <button key={swatch} role="radio" aria-checked={item.colour === swatch} aria-label={swatch} className={`swatch${item.colour === swatch ? ' on' : ''}`}
              style={{'--c': colourVar(swatch)} as CSSProperties} onClick={() => {
                setPicking(false);
                if (item.colour !== swatch) actions!.colour!(item, swatch);
              }} />
          ))}
        </div>
      )}
    </>
  );
}
