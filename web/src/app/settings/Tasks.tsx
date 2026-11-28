// Settings › Tasks (not drawn): Todoist, whether its tasks show, its projects under it with their
// colours (written to Todoist) and the default project for a task with none. Its connection is
// Accounts › Sources' row, and a task's reminder time is Notifications'.
import type {CalendarOut, Settings, SourceOut, TodoistColour, TodoistProjectOut} from '@setpoint/shared';
import {TODOIST_COLOURS, TODOIST_COLOUR_NAMES} from '@setpoint/shared';
import type {CSSProperties} from 'react';
import {useResource} from '../../api/client.ts';
import {CALENDARS_PATH, setCalendarListed, setProjectColour, settleProjectColour, SETTINGS_PATH, TODOIST_PROJECTS_PATH} from '../../api/items.ts';
import {patchSettings, SOURCES_PATH} from '../../api/settings.ts';
import {todoistConnected} from '../../logic/settings.ts';
import {refusalWords, withCode} from '../../logic/providerWords.ts';
import {Icon} from '../../ui/Icon.tsx';
import {CalendarRow} from './Calendar.tsx';
import {Line, Menu, Page, Row, Section, Select, SkeletonRows, useAttempt} from './parts.tsx';
import {openSettings} from './store.ts';

const INBOX = '';

export function TasksPage() {
  const calendarsLoad = {path: CALENDARS_PATH, ...useResource<CalendarOut[]>(CALENDARS_PATH)};
  const calendars = calendarsLoad.data;
  const todoist = calendars?.find(calendar => calendar.provider === 'todoist');
  const settingsLoad = {path: SETTINGS_PATH, ...useResource<Settings>(SETTINGS_PATH)};
  const settings = settingsLoad.data;
  const sourcesLoad = {path: SOURCES_PATH, ...useResource<SourceOut[]>(SOURCES_PATH)};
  const sources = sourcesLoad.data;
  const projectsLoad = {path: TODOIST_PROJECTS_PATH, ...useResource<TodoistProjectOut[]>(TODOIST_PROJECTS_PATH)};
  const projects = projectsLoad.data;
  const save = useAttempt();
  const saveProject = useAttempt();

  return (
    <Page title="Tasks" loads={[calendarsLoad, settingsLoad, sourcesLoad, projectsLoad]}>
      <Section label="Todoist">
        {/* Whether it's connected is said only once it's known. */}
        {!sources || !projects || !settings || !calendars ? <SkeletonRows count={3} one /> : !todoistConnected(sources) ? (
          <div className="set-group">
            <Row title="Not connected" sub="Tasks with a date show on the calendar">
              <button className="btn out sm" type="button" onClick={() => openSettings('accounts')}>Connect in Accounts</button>
            </Row>
          </div>
        ) : (
          <>
            {(todoist || projects.length > 0) && (
              <div className="set-group">
                {todoist && <CalendarRow calendar={todoist} onShow={on => void save.attempt(() => setCalendarListed(todoist.id, on))} />}
                {projects.map(project => <ProjectRow key={project.id} project={project} nested={!!todoist} />)}
              </div>
            )}
            <div className={todoist || projects.length > 0 ? 'set-group next' : 'set-group'}>
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
        <Line text={(saveProject.line ?? save.line)?.text ?? null} tone={(saveProject.line ?? save.line)?.tone} />
      </Section>

    </Page>
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
function ProjectRow({project, nested}: {project: TodoistProjectOut; nested?: boolean}) {
  const pick = useAttempt();
  const settle = useAttempt();
  const {command} = project;
  const failed = command?.state === 'failed';
  const label = `${project.name} colour`;
  return (
    <div className={`set-row one cal-row${nested ? ' nest' : ''}${command?.state === 'pending' ? ' pending' : ''}`} data-project={project.id}>
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
