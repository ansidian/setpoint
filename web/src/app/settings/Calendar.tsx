// Settings › Calendar (not drawn): which calendars show and each Google calendar's colour (written
// to Google), in one group with each account's address heading its calendars, indented under it. Then Time to Leave's switch and Buffer; it leaves from Home, which is Settings ›
// Places'. Then weather on or off and the forecast's Pirate Weather key (the weather source's credential),
// write-only. The page scrolls.
import type {CalendarOut, Settings, SourceOut} from '@setpoint/shared';
import {SWATCH_COLOURS} from '@setpoint/shared';
import {Fragment} from 'react';
import {useResource} from '../../api/client.ts';
import {CALENDARS_PATH, setCalendarColour, setCalendarListed, settleCalendarColour, SETTINGS_PATH} from '../../api/items.ts';
import {patchSettings, setSourceKey, SOURCES_PATH} from '../../api/settings.ts';
import {calendarGroups} from '../../logic/calendar.ts';
import {Icon} from '../../ui/Icon.tsx';
import {dotStyle, useAccounts} from '../accounts.ts';
import {Line, Menu, Page, Row, Section, SkeletonRows, Stepper, Switch, useAttempt} from './parts.tsx';
import {KeyRow} from './Ai.tsx';
import {openSettings} from './store.ts';
import {refusalWords, withCode} from '../../logic/providerWords.ts';

const BUFFER_STEP = 5;
export function CalendarPage() {
  const calendarsLoad = {path: CALENDARS_PATH, ...useResource<CalendarOut[]>(CALENDARS_PATH)};
  const calendars = calendarsLoad.data;
  const {list: accounts} = useAccounts();
  const settingsLoad = {path: SETTINGS_PATH, ...useResource<Settings>(SETTINGS_PATH)};
  const settings = settingsLoad.data;
  const sourcesLoad = {path: SOURCES_PATH, ...useResource<SourceOut[]>(SOURCES_PATH)};
  const sources = sourcesLoad.data;
  const weather = sources?.find(source => source.provider === 'weather');
  const save = useAttempt();
  const saveLeave = useAttempt();

  return (
    <Page title="Calendar" loads={[calendarsLoad, settingsLoad, sourcesLoad]}>
      <Section label="Calendars">
        {!calendars ? <SkeletonRows count={4} one /> : (
          <div className="set-group">
            {calendarGroups(calendars, accounts).map(group => (
              <Fragment key={group.account?.id ?? 'other'}>
                <div className="set-row one cal-acct" data-account={group.account?.id ?? 'other'}>
                  <span className="t grow ell">{group.account?.address ?? 'Other'}</span>
                </div>
                {group.calendars.map(calendar => (
                  <CalendarRow key={calendar.id} calendar={calendar} nested onShow={on => void save.attempt(() => setCalendarListed(calendar.id, on))} />
                ))}
              </Fragment>
            ))}
          </div>
        )}
      </Section>

      <Section label="Time to Leave">
        {!settings ? <SkeletonRows count={2} /> : <TimeToLeave settings={settings} change={patch => void saveLeave.attempt(() => patchSettings(patch))} />}
        <Line text={saveLeave.line?.text ?? null} tone={saveLeave.line?.tone} />
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
export function CalendarRow({calendar, nested, onShow}: {calendar: CalendarOut; nested?: boolean; onShow: (on: boolean) => void}) {
  const pick = useAttempt();
  const settle = useAttempt();
  const {command} = calendar;
  const failed = command?.state === 'failed';
  return (
    <div className={`set-row one cal-row${nested ? ' nest' : ''}${command?.state === 'pending' ? ' pending' : ''}`} data-calendar={calendar.id}>
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
