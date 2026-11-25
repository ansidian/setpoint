// Settings › Calendar (not drawn): which calendars show and each Google calendar's colour (written
// to Google). Then Time to Leave's switch and Buffer; it leaves from Home, which is Settings ›
// Places'. Then Todoist's projects with their colours (written to Todoist) and the default project
// for a task with none. Settings has no Todoist page: its connection is Accounts › Sources' row.
// Then weather on or off and the forecast's Pirate Weather key (the weather source's credential),
// write-only. The page scrolls.
import type {CalendarOut, Settings, SourceOut, TodoistColour, TodoistProjectOut} from '@setpoint/shared';
import {SWATCH_COLOURS, TODOIST_COLOURS, TODOIST_COLOUR_NAMES} from '@setpoint/shared';
import type {CSSProperties} from 'react';
import {useResource} from '../../api/client.ts';
import {CALENDARS_PATH, setCalendarColour, setCalendarListed, setProjectColour, settleCalendarColour, settleProjectColour, SETTINGS_PATH, TODOIST_PROJECTS_PATH} from '../../api/items.ts';
import {patchSettings, setSourceKey, SOURCES_PATH} from '../../api/settings.ts';
import {todoistConnected} from '../../logic/settings.ts';
import {Icon} from '../../ui/Icon.tsx';
import {dotStyle} from '../accounts.ts';
import {Line, Menu, Page, Row, Section, Select, SkeletonRows, Stepper, Switch, useAttempt} from './parts.tsx';
import {KeyRow} from './Ai.tsx';
import {openSettings} from './store.ts';
import {refusalWords, withCode} from '../../logic/providerWords.ts';

const INBOX = '';
const BUFFER_STEP = 5;
export function CalendarPage() {
  const calendarsLoad = {path: CALENDARS_PATH, ...useResource<CalendarOut[]>(CALENDARS_PATH)};
  const calendars = calendarsLoad.data;
  const settingsLoad = {path: SETTINGS_PATH, ...useResource<Settings>(SETTINGS_PATH)};
  const settings = settingsLoad.data;
  const sourcesLoad = {path: SOURCES_PATH, ...useResource<SourceOut[]>(SOURCES_PATH)};
  const sources = sourcesLoad.data;
  const weather = sources?.find(source => source.provider === 'weather');
  const projectsLoad = {path: TODOIST_PROJECTS_PATH, ...useResource<TodoistProjectOut[]>(TODOIST_PROJECTS_PATH)};
  const projects = projectsLoad.data;
  const save = useAttempt();
  const saveProject = useAttempt();
  const saveLeave = useAttempt();

  return (
    <Page title="Calendar" loads={[calendarsLoad, settingsLoad, sourcesLoad, projectsLoad]}>
      <Section label="Calendars">
        {!calendars ? <SkeletonRows count={4} one /> : (
          <div className="set-group">
            {[...calendars].sort((a, b) => a.position - b.position).map(calendar => (
              <CalendarRow key={calendar.id} calendar={calendar} onShow={on => void save.attempt(() => setCalendarListed(calendar.id, on))} />
            ))}
          </div>
        )}
      </Section>

      <Section label="Time to Leave">
        {!settings ? <SkeletonRows count={2} /> : <TimeToLeave settings={settings} change={patch => void saveLeave.attempt(() => patchSettings(patch))} />}
        <Line text={saveLeave.line?.text ?? null} tone={saveLeave.line?.tone} />
      </Section>

      <Section label="Todoist">
        {/* Whether it's connected is said only once it's known. */}
        {!sources || !projects || !settings ? <SkeletonRows count={3} one /> : !todoistConnected(sources) ? (
          <div className="set-group">
            <Row title="Not connected" sub="Tasks with a date show on the calendar">
              <button className="btn out sm" type="button" onClick={() => openSettings('accounts')}>Connect in Accounts</button>
            </Row>
          </div>
        ) : (
          <>
            {projects.length > 0 && <div className="set-group">{projects.map(project => <ProjectRow key={project.id} project={project} />)}</div>}
            <div className={projects.length > 0 ? 'set-group next' : 'set-group'}>
              <Row title="Default project" sub="Where a task goes when it names none" kind="ctl">
                <Select value={settings.todoist.default_project ?? INBOX} label="Default project"
                  options={[
                    {value: INBOX, label: projects.find(project => project.inbox)?.name ?? 'Inbox'},
                    ...projects.filter(project => !project.inbox).map(project => ({value: project.name, label: project.name})),
                  ]}
                  onChange={name => void saveProject.attempt(() => patchSettings({todoist: {default_project: name || null}}))} />
              </Row>
            </div>
          </>
        )}
        <Line text={saveProject.line?.text ?? null} tone={saveProject.line?.tone} />
      </Section>

      <Section label="Weather">
        {!settings || !sources ? <SkeletonRows count={2} /> : <div className="set-group">
          <Row title="Weather" sub="The forecast on each day, from Home">
            <Switch on={settings.calendar.weather} label="Weather" onChange={on => void save.attempt(() => patchSettings({calendar: {weather: on}}))} />
          </Row>
          {weather && (
            <KeyRow id="weather" title="Pirate Weather key" set={weather.has_credentials} disabled={weather.dev} save={key => setSourceKey(weather.id, key)}
              sub={weather.dev ? 'The forecast · invented in dev runs' : `The forecast · ${weather.has_credentials ? 'Set' : 'Not set'}`} />
          )}
        </div>}
        <Line text={save.line?.text ?? null} tone={save.line?.tone} />
      </Section>
    </Page>
  );
}

/**
 * Time to Leave (moved from Notifications): its switch, which needs Home and says so without
 * one, pointing to Places where it's set, and the buffer, in 5 min steps from 0 to 120.
 */
function TimeToLeave({settings, change}: {settings: Settings; change: (patch: Parameters<typeof patchSettings>[0]) => void}) {
  const leave = settings.time_to_leave;
  const home = settings.calendar.home;
  return (
    <div className="set-group">
      <Row title="Time to Leave" sub={home ? `Live routes from ${home.label}` : 'Set Home first'}>
        {!home && <button className="btn out sm" type="button" onClick={() => openSettings('places')}>Set Home in Places</button>}
        <Switch on={leave.enabled && !!home} disabled={!home} label="Time to Leave" onChange={on => change({time_to_leave: {enabled: on}})} />
      </Row>
      <Row title="Buffer" kind="ctl">
        <Stepper value={`${leave.buffer_minutes} min`} label="Buffer" onStep={delta => {
          const next = Math.min(120, Math.max(0, leave.buffer_minutes + delta * BUFFER_STEP));
          if (next !== leave.buffer_minutes) change({time_to_leave: {buffer_minutes: next}});
        }} />
      </Row>
    </div>
  );
}

/**
 * A calendar's row: its colour, picked from the swatches and written to Google, so
 * Google's own app matches. Then its name and whether it shows. Todoist has its ring and no colour.
 * A colour waiting for Google shows at .5 with the spinner. One Google refused stays, with Google's
 * words, Try again and Change back.
 */
function CalendarRow({calendar, onShow}: {calendar: CalendarOut; onShow: (on: boolean) => void}) {
  const pick = useAttempt();
  const settle = useAttempt();
  const {command} = calendar;
  const failed = command?.state === 'failed';
  return (
    <div className={command?.state === 'pending' ? 'set-row one cal-row pending' : 'set-row one cal-row'} data-calendar={calendar.id}>
      {calendar.colour === null ? <span className="ring" /> : (
        <Menu label={`${calendar.name} colour`} align="left" button={<button className="sw" type="button" style={dotStyle(calendar.colour)} aria-label={`${calendar.name} colour`} disabled={!!command} />}>
          {close => (
            <div className="swatches">
              {SWATCH_COLOURS.map(colour => (
                <button key={colour} type="button" className={colour === calendar.colour ? 'sw on' : 'sw'} style={dotStyle(colour)} aria-label={colour} onClick={() => {
                  close();
                  if (colour !== calendar.colour) void pick.attempt(() => setCalendarColour(calendar.id, colour));
                }} />
              ))}
            </div>
          )}
        </Menu>
      )}
      <div className="lines grow">
        <span className="t">{calendar.name}</span>
        {failed && <span className="s failed" role="alert" data-tip={withCode(refusalWords('google_calendar', command.provider_message, 'Google Calendar didn’t answer.'), command.provider_message)}>{refusalWords('google_calendar', command.provider_message, 'Google Calendar didn’t answer.')}</span>}
        {(pick.line ?? settle.line) && <span className="s failed" role="alert">{(pick.line ?? settle.line)!.text}</span>}
      </div>
      {command?.state === 'pending' && <span className="spin" aria-label="Saving"><Icon name="progress_activity" size={16} /></span>}
      {failed && (
        <>
          <button className="btn sm" type="button" onClick={() => void settle.attempt(() => settleCalendarColour(command.id, 'retry'))}><Icon name="refresh" size={16} />Try again</button>
          <button className="btn out sm" type="button" onClick={() => void settle.attempt(() => settleCalendarColour(command.id, 'move-back'))}><Icon name="undo" size={16} />Change back</button>
        </>
      )}
      <Switch on={calendar.listed} label={`Show ${calendar.name}`} onChange={onShow} />
    </div>
  );
}

/** Todoist's name for a colour, as words: berry_red → "Berry red". */
const colourName = (colour: TodoistColour) => colour[0]!.toUpperCase() + colour.slice(1).replace('_', ' ');
const swatch = (colour: TodoistColour | null) => ({'--c': colour ? TODOIST_COLOURS[colour] : 'var(--ink2)'}) as CSSProperties;

/**
 * A project's row, as Settings › Calendar's calendar rows: its colour, picked from
 * Todoist's own 20 and written to Todoist, so its apps match and its tasks' rings take it. Waiting
 * for Todoist it shows at .5 with the spinner. One Todoist refused stays, with Todoist's words, Try
 * again and Change back.
 */
function ProjectRow({project}: {project: TodoistProjectOut}) {
  const pick = useAttempt();
  const settle = useAttempt();
  const {command} = project;
  const failed = command?.state === 'failed';
  const label = `${project.name} colour`;
  return (
    <div className={command?.state === 'pending' ? 'set-row one cal-row pending' : 'set-row one cal-row'} data-project={project.id}>
      <Menu label={label} align="left" button={<button className="sw" type="button" style={swatch(project.colour)} aria-label={label} data-tip={project.colour ? colourName(project.colour) : undefined} disabled={!!command} />}>
        {close => (
          <div className="swatches todoist">
            {TODOIST_COLOUR_NAMES.map(colour => (
              <button key={colour} type="button" className={colour === project.colour ? 'sw on' : 'sw'} style={swatch(colour)} aria-label={colourName(colour)} data-tip={colourName(colour)} data-colour={colour} onClick={() => {
                close();
                if (colour !== project.colour) void pick.attempt(() => setProjectColour(project.id, colour));
              }} />
            ))}
          </div>
        )}
      </Menu>
      <div className="lines grow">
        <span className="t">{project.name}</span>
        {failed && <span className="s failed" role="alert" data-tip={withCode(refusalWords('todoist', command.provider_message, 'Todoist didn’t answer.'), command.provider_message)}>{refusalWords('todoist', command.provider_message, 'Todoist didn’t answer.')}</span>}
        {(pick.line ?? settle.line) && <span className="s failed" role="alert">{(pick.line ?? settle.line)!.text}</span>}
      </div>
      {command?.state === 'pending' && <span className="spin" aria-label="Saving"><Icon name="progress_activity" size={16} /></span>}
      {failed && (
        <>
          <button className="btn sm" type="button" onClick={() => void settle.attempt(() => settleProjectColour(command.id, 'retry'))}><Icon name="refresh" size={16} />Try again</button>
          <button className="btn out sm" type="button" onClick={() => void settle.attempt(() => settleProjectColour(command.id, 'move-back'))}><Icon name="undo" size={16} />Change back</button>
        </>
      )}
    </div>
  );
}
