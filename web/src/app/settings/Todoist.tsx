// Settings › Todoist (not drawn; DESIGN.md › Settings' row pattern): the connection, with its
// state and Connect or Reconnect (Todoist's consent), each project's colour (SV-25, written to
// Todoist), and the default project for a task with none.
import type {Settings, SourceOut, TodoistColour, TodoistProjectOut} from '@setpoint/shared';
import {TODOIST_COLOURS, TODOIST_COLOUR_NAMES} from '@setpoint/shared';
import type {CSSProperties} from 'react';
import {timeZone} from '../../api/auth.ts';
import {useResource} from '../../api/client.ts';
import {SETTINGS_PATH, setProjectColour, settleProjectColour, TODOIST_PROJECTS_PATH} from '../../api/items.ts';
import {connectTodoist, patchSettings, SOURCES_PATH} from '../../api/settings.ts';
import {sourceState, syncLine} from '../../logic/health.ts';
import {Icon} from '../../ui/Icon.tsx';
import {useNow} from '../clock.ts';
import {HealthGlyph, Line, Menu, Page, Row, Section, Select, useAttempt} from './parts.tsx';

const INBOX = '';

export function TodoistPage() {
  const {data: sources} = useResource<SourceOut[]>(SOURCES_PATH);
  const {data: projects} = useResource<TodoistProjectOut[]>(TODOIST_PROJECTS_PATH);
  const {data: settings} = useResource<Settings>(SETTINGS_PATH);
  const now = useNow();
  const connect = useAttempt();
  const save = useAttempt();
  const source = sources?.find(one => one.provider === 'todoist');
  const state = source ? sourceState(source.health, now, timeZone()) : null;
  const connected = source !== undefined && (source.has_credentials || source.dev);

  return (
    <Page title="Todoist">
      <Section label="Connection">
        <div className="set-group">
          {/* Its state leads the title with its glyph, as Accounts' rows do (settings-01). */}
          <Row title={connected ? <span className="health-t"><HealthGlyph kind={state?.kind ?? null} />Connected</span> : 'Not connected'} sub={source && state ? `${syncLine(source, timeZone())} · ${state.text}` : 'Tasks with a date show on the calendar'}>
            <button className={state?.reconnect || !connected ? 'btn sm' : 'btn out sm'} type="button" disabled={connect.busy}
              onClick={() => void connect.attempt(connectTodoist, ({url}) => {
                window.location.assign(url);
                return null;
              })}>{connected ? 'Reconnect' : 'Connect Todoist'}</button>
          </Row>
        </div>
        <Line text={connect.line?.text ?? null} tone={connect.line?.tone} />
      </Section>

      <Section label="Projects">
        <div className="set-group">
          {(projects ?? []).map(project => <ProjectRow key={project.id} project={project} />)}
        </div>
      </Section>

      <Section label="New tasks">
        <div className="set-group">
          <Row title="Default project" sub="Where a task goes when it names none" kind="ctl">
            <Select value={settings?.todoist.default_project ?? INBOX} label="Default project"
              options={[
                {value: INBOX, label: projects?.find(project => project.inbox)?.name ?? 'Inbox'},
                ...(projects ?? []).filter(project => !project.inbox).map(project => ({value: project.name, label: project.name})),
              ]}
              onChange={name => void save.attempt(() => patchSettings({todoist: {default_project: name || null}}))} />
          </Row>
        </div>
        <Line text={save.line?.text ?? null} tone={save.line?.tone} />
      </Section>
    </Page>
  );
}

/** Todoist's name for a colour, as words: berry_red → "Berry red". */
const colourName = (colour: TodoistColour) => colour[0]!.toUpperCase() + colour.slice(1).replace('_', ' ');
const swatch = (colour: TodoistColour | null) => ({'--c': colour ? TODOIST_COLOURS[colour] : 'var(--ink2)'}) as CSSProperties;

/**
 * A project's row (SV-25, D54), as Settings › Calendar's calendar rows: its colour, picked from
 * Todoist's own 20 and written to Todoist, so its apps match and its tasks' rings take it. Waiting
 * for Todoist it shows at .5 with the spinner; one Todoist refused stays, with Todoist's words, Try
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
      <Menu label={label} align="left" button={<button className="sw" type="button" style={swatch(project.colour)} aria-label={label} title={project.colour ? colourName(project.colour) : undefined} disabled={!!command} />}>
        {close => (
          <div className="swatches todoist">
            {TODOIST_COLOUR_NAMES.map(colour => (
              <button key={colour} type="button" className={colour === project.colour ? 'sw on' : 'sw'} style={swatch(colour)} aria-label={colourName(colour)} title={colourName(colour)} data-colour={colour} onClick={() => {
                close();
                if (colour !== project.colour) void pick.attempt(() => setProjectColour(project.id, colour));
              }} />
            ))}
          </div>
        )}
      </Menu>
      <div className="lines grow">
        <span className="t">{project.name}</span>
        {failed && <span className="s failed" role="alert">{`Couldn't change its colour, Todoist, ${command.provider_message ?? 'No answer'}`}</span>}
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
