// The proposal card (DESIGN.md › Proposal; board 08): an event or task pre-filled from the email, each
// field it gave marked "from the email", the conflict line, Create, More options and Cancel. Nothing
// is created until the user presses Create, which sends the proposal's item (with the title, place,
// calendar, project and reminder as they left them) through the command layer: the card waits at .5
// until the provider confirms, and a failure stays in the card with the provider's words. The day
// and times take typing as the editor's do, blank when the email gave no day (SV-24); the conflict
// line is the email's time's, so it goes once they change (the editor's preview follows them).
import type {CalendarOut, CommandOut, ProposalField, ProposalItemOut, ProposalOut, Settings, TodoistProjectOut} from '@setpoint/shared';
import {useMemo, useRef, useState} from 'react';
import type {FormEvent} from 'react';
import {refresh, useResource} from '../../api/client.ts';
import {CALENDARS_PATH, TODOIST_PROJECTS_PATH} from '../../api/items.ts';
import {createItem, SETTINGS_PATH} from '../../api/search.ts';
import {remindersLine} from '../../logic/detail.ts';
import {parseClock, parseDay, parseEnd, timeChoices} from '../../logic/compose.ts';
import {localDate} from '../../logic/format.ts';
import {failedLine, projectChoice, proposalAt, proposalDay, proposalWhen, REMINDER_CHOICES} from '../../logic/search.ts';
import {Icon} from '../../ui/Icon.tsx';
import {useMenuRef} from '../../ui/popover.ts';
import {colourVar, dotStyle} from '../accounts.ts';
import {useRingColour} from '../calendar/Chip.tsx';
import {handProposal} from '../calendar/Editor.tsx';
import {DateField, ProjectField, TimeField} from '../calendar/Pickers.tsx';
import {navigate} from '../router.ts';
import {foldAway} from '../fold.ts';
import {showToast} from '../toast.ts';

// A time added to an all-day proposal starts here, as the editor's do.
const DEFAULT_START = 9 * 60;

const reminderLabel = (minutes: number | null) => (minutes === null ? 'No reminder' : remindersLine([minutes])!);

export function ProposalCard({proposal, now, timeZone, onClose, inAnswer = false}: {
  proposal: ProposalOut;
  now: number;
  timeZone: string;
  // The reader's card closes through the reader; one in an answer closes itself.
  onClose?: () => void;
  inAnswer?: boolean;
}) {
  const {data: calendars} = useResource<CalendarOut[]>(CALENDARS_PATH);
  const {data: settings} = useResource<Settings>(SETTINGS_PATH);
  const {data: projects} = useResource<TodoistProjectOut[]>(proposal.kind === 'task' ? TODOIST_PROJECTS_PATH : null);
  const ring = useRingColour();
  const {item, kind} = proposal;
  const [title, setTitle] = useState(item.title);
  const [place, setPlace] = useState(item.place ?? '');
  const [project, setProject] = useState(item.project ?? '');
  // Set when the user picks New project for what's typed: only then is a project made (SV-24, D50).
  const [newProject, setNewProject] = useState(false);
  const [calendarId, setCalendarId] = useState(item.calendar_id);
  const emailed = useMemo(() => proposalWhen(item, timeZone), [item, timeZone]);
  const [when, setWhen] = useState(emailed);
  // Null until the user picks one: Settings' default then applies.
  const [reminder, setReminder] = useState<{minutes: number | null} | null>(null);
  const [menu, setMenu] = useState<'calendar' | 'reminder' | null>(null);
  const menuRef = useMenuRef(menu, () => setMenu(null));
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  if (closed) return null;
  // Closed (Cancel, Esc, Create), it folds away (app/fold.ts).
  const close = () => {
    foldAway(form.current);
    if (onClose) onClose();
    else setClosed(true);
  };

  const choices = (calendars ?? []).filter(calendar => calendar.provider === (kind === 'event' ? 'google' : 'todoist'));
  const calendar = calendars?.find(one => one.id === calendarId);
  const moved = when.date !== emailed.date || when.start !== emailed.start || when.end !== emailed.end;
  const today = localDate(now, timeZone);
  const defaultReminder = settings?.reminders.event_minutes_before ?? null;
  const shownReminder = reminder ? reminder.minutes : defaultReminder;
  const fromEmail = (...fields: ProposalField[]) => (fields.some(field => proposal.from_email.includes(field))
    ? <span className="srcm" title="From the email"><Icon name="mail" size={14} /></span> : <span />);

  // The item as the fields hold it now.
  const current = (): ProposalItemOut => ({
    ...(moved && when.date ? proposalAt(item, {...when, date: when.date}, timeZone) : item), title: title.trim(), place: kind === 'task' ? null : place.trim() || null, calendar_id: calendarId,
  });
  const reminders = reminder ? {reminders: reminder.minutes === null ? [] : [reminder.minutes]} : {};

  async function create(event: FormEvent) {
    event.preventDefault();
    if (pending || !calendarId || !title.trim()) return;
    if (!when.date) return setFailed('Pick a day first');
    const chosen = kind === 'task' ? projectChoice(project, projects ?? [], newProject) : null;
    if (chosen && 'problem' in chosen) return setFailed(chosen.problem);
    setPending(true);
    setFailed(null);
    let command: CommandOut | null = null;
    try {
      command = await createItem({...current(), ...chosen, ...reminders}, () => {});
    } catch (error) {
      setFailed((error as Error).message);
    }
    setPending(false);
    if (!command) return;
    if (command.state === 'failed') setFailed(failedLine(command.provider, command.provider_message));
    else {
      if (chosen?.create_project) void refresh(TODOIST_PROJECTS_PATH);
      close();
      showToast(`Added to ${calendar?.name ?? (kind === 'task' ? 'Todoist' : 'Calendar')}`);
    }
  }

  // More options carries the fields as they are (S4); those changed lose the email's mark.
  const moreOptions = () => {
    const changed: ProposalField[] = [...(title.trim() !== item.title ? ['title' as const] : []), ...(moved ? ['date' as const, 'time' as const] : []), ...(place.trim() !== (item.place ?? '') ? ['place' as const] : [])];
    handProposal({
      proposal: {...proposal, item: {...current(), title: title.trim() || item.title, project: kind === 'task' ? project.trim() || null : item.project}, from_email: proposal.from_email.filter(field => !changed.includes(field))},
      reminders: reminders.reminders ?? null, newProject,
    });
    navigate({page: 'calendar', date: null, item: null, at: null, compose: {kind, message: proposal.message_id}});
  };

  return (
    <form ref={form} className={['card', 'prop', pending && 'pending', inAnswer && 'in-answer'].filter(Boolean).join(' ')} aria-label={kind === 'event' ? 'Proposal: add to calendar' : 'Proposal: add as task'}
      onSubmit={event => void create(event)}
      onKeyDown={event => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        if (menu) setMenu(null);
        else close();
      }}>
      <div className="card-h">
        <span style={{color: colourVar(calendar?.colour ?? undefined)}}><Icon name={kind === 'event' ? 'event' : 'task_alt'} size={16} /></span>
        <span className="card-title">Proposal</span>
        <span className="card-sub">· from this email</span>
      </div>
      <div className="card-b">
        <div className="pgrid">
          <span />
          <label className="field title"><input className="grow" aria-label="Title" value={title} autoFocus={!inAnswer} onChange={event => setTitle(event.target.value)} /></label>
          {fromEmail('title')}

          <Icon name="schedule" size={17} />
          <div className="prow">
            <DateField className="date" label="Date" placeholder="Pick a day" value={when.date} shown={when.date ? proposalDay(when.date, now, timeZone) : ''} today={today}
              read={text => parseDay(text, today)} onValue={date => setWhen({...when, date})} />
            {when.start !== null ? (
              <>
                <TimeField className="time num" label={kind === 'task' ? 'Time' : 'Start'} value={when.start} choices={timeChoices()} read={text => parseClock(text, when.start)}
                  onValue={start => setWhen({...when, start, end: when.end === null ? null : start + (when.end - when.start!)})} />
                {when.end !== null && (
                  <>
                    <span className="ink3">–</span>
                    <TimeField className="time num" label="End" value={when.end} choices={timeChoices(when.start)} read={text => parseEnd(text, when.start!, when.end)} onValue={end => setWhen({...when, end})} />
                  </>
                )}
                <button type="button" className="ibtn sm" aria-label={kind === 'event' ? 'All day' : 'Remove time'} title={kind === 'event' ? 'All day' : 'Remove time'}
                  onClick={() => setWhen({...when, start: null, end: null})}><Icon name="close" size={16} /></button>
              </>
            ) : when.date && (
              <button type="button" className="btn quiet sm" onClick={() => setWhen({...when, start: DEFAULT_START, end: kind === 'event' ? DEFAULT_START + 60 : null})}>
                {kind === 'event' ? 'All day · Add a time' : 'Add a time'}
              </button>
            )}
            {!moved && proposal.conflict && (
              <span className={proposal.conflict.free ? 'conflict free' : 'conflict'}>
                <Icon name={proposal.conflict.free ? 'check_circle' : 'layers'} size={16} />{proposal.conflict.label}
              </span>
            )}
          </div>
          {moved ? <span /> : fromEmail('date', 'time')}

          {kind === 'event' && (
            <>
              <Icon name="location_on" size={17} />
              <label className="field"><input className="grow" aria-label="Place" placeholder="Place" value={place} onChange={event => setPlace(event.target.value)} /></label>
              {fromEmail('place')}
            </>
          )}

          <Icon name="calendar_today" size={17} />
          <div className="prow">
            {kind === 'event' ? (
              <>
                <span className="menu-anchor">
                  <button type="button" className="field pick" aria-label="Calendar" onClick={() => setMenu(menu === 'calendar' ? null : 'calendar')}>
                    <span className="dot sm" style={dotStyle(calendar?.colour ?? undefined)} /><span className="grow">{calendar?.name ?? 'Calendar'}</span><Icon name="expand_more" size={16} />
                  </button>
                  {menu === 'calendar' && (
                    <div ref={menuRef} className="pop menu">
                      {choices.map(choice => (
                        <button key={choice.id} type="button" className={choice.id === calendarId ? 'menu-i cur' : 'menu-i'} onClick={() => {
                          setCalendarId(choice.id);
                          setMenu(null);
                        }}><span className="dot sm" style={dotStyle(choice.colour ?? undefined)} />{choice.name}</button>
                      ))}
                    </div>
                  )}
                </span>
                <span className="menu-anchor">
                  <button type="button" className="field pick" aria-label="Reminder" onClick={() => setMenu(menu === 'reminder' ? null : 'reminder')}>
                    <Icon name="notifications" size={16} /><span className="grow">{reminderLabel(shownReminder)}</span><Icon name="expand_more" size={16} />
                  </button>
                  {menu === 'reminder' && (
                    <div ref={menuRef} className="pop menu">
                      {[null, ...REMINDER_CHOICES].map(minutes => (
                        <button key={String(minutes)} type="button" className={minutes === shownReminder ? 'menu-i cur' : 'menu-i'} onClick={() => {
                          setReminder({minutes});
                          setMenu(null);
                        }}>{reminderLabel(minutes)}</button>
                      ))}
                    </div>
                  )}
                </span>
              </>
            ) : (
              <ProjectField className="pick" lead={<span className="ring" style={ring(project || null)} />} value={project} isNew={newProject} projects={projects ?? []}
                placeholder={settings?.todoist.default_project ?? projects?.find(one => one.inbox)?.name ?? 'Inbox'}
                onText={text => {
                  setProject(text);
                  setNewProject(false);
                }}
                onPick={(name, isNew) => {
                  setProject(name);
                  setNewProject(isNew);
                  setFailed(null);
                }} />
            )}
          </div>
          <span />
        </div>

        {failed && <div className="failed-line"><Icon name="error" size={16} />{failed}</div>}

        <div className="prop-foot">
          <button type="submit" className="btn" disabled={!calendarId || !title.trim()}>
            {pending && <span className="spin"><Icon name="progress_activity" size={16} /></span>}Create
          </button>
          <button type="button" className="btn out" onClick={moreOptions}><Icon name="open_in_new" size={17} />More options</button>
          <button type="button" className="btn quiet" onClick={close}>Cancel<span className="kbd">Esc</span></button>
          <span className="grow" />
          {proposal.from_email.length > 0 && <span className="legend"><Icon name="mail" size={14} />From the email</span>}
        </div>
      </div>
    </form>
  );
}
