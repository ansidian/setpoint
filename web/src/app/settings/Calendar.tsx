// Settings › Calendar (not drawn; DESIGN.md › Settings' row pattern, BRIEF.md › Settings): which
// calendars show and each Google calendar's colour (SV-20, written to Google), Home for Time to Leave and the forecast (a place, with its coordinates), weather
// on or off, the forecast's Pirate Weather key (the weather source's credential, D16) and the Google
// Maps key that Places and Time to Leave's routes use, both write-only.
import type {CalendarOut, PlaceSuggestionOut, SecretOut, Settings, SourceOut} from '@setpoint/shared';
import {SWATCH_COLOURS} from '@setpoint/shared';
import {useState} from 'react';
import {useResource} from '../../api/client.ts';
import {CALENDARS_PATH, placeSuggestions, setCalendarColour, setCalendarVisible, settleCalendarColour, SETTINGS_PATH} from '../../api/items.ts';
import {findPlace, patchSettings, SECRETS_PATH, setSourceKey, SOURCES_PATH} from '../../api/settings.ts';
import {Icon} from '../../ui/Icon.tsx';
import {dotStyle} from '../accounts.ts';
import {Line, Menu, Page, Row, Section, Switch, useAttempt} from './parts.tsx';
import {KeyRow, SecretRow} from './Ai.tsx';

export function CalendarPage() {
  const {data: calendars} = useResource<CalendarOut[]>(CALENDARS_PATH);
  const {data: settings} = useResource<Settings>(SETTINGS_PATH);
  const {data: secrets} = useResource<SecretOut[]>(SECRETS_PATH);
  const {data: sources} = useResource<SourceOut[]>(SOURCES_PATH);
  const weather = sources?.find(source => source.provider === 'weather');
  const save = useAttempt();
  const [editingHome, setEditingHome] = useState(false);
  const home = settings?.calendar.home ?? null;

  return (
    <Page title="Calendar">
      <Section label="Calendars">
        <div className="set-group">
          {[...calendars ?? []].sort((a, b) => a.position - b.position).map(calendar => (
            <CalendarRow key={calendar.id} calendar={calendar} onShow={on => void save.attempt(() => setCalendarVisible(calendar.id, on))} />
          ))}
        </div>
      </Section>

      <Section label="Home">
        <div className="set-group">
          {editingHome ? <HomeSearch onDone={() => setEditingHome(false)} /> : (
            <Row title={home ? home.label : 'Not set'} sub={home ? home.address : 'Time to Leave and the forecast start from Home'}>
              <button className="btn out sm" type="button" onClick={() => setEditingHome(true)}>{home ? 'Change' : 'Set Home'}</button>
            </Row>
          )}
        </div>
      </Section>

      <Section label="Weather and places">
        <div className="set-group">
          <Row title="Weather" sub="The forecast on each day, from Home">
            <Switch on={settings?.calendar.weather ?? true} label="Weather" onChange={on => void save.attempt(() => patchSettings({calendar: {weather: on}}))} />
          </Row>
          {weather && (
            <KeyRow id="weather" title="Pirate Weather key" set={weather.has_credentials} disabled={weather.dev} save={key => setSourceKey(weather.id, key)}
              sub={weather.dev ? 'The forecast · invented in dev runs' : `The forecast · ${weather.has_credentials ? 'Set' : 'Not set'}`} />
          )}
          <SecretRow name="places_api_key" title="Google Maps key" sub="Places and Time to Leave's routes" secrets={secrets} />
        </div>
        <Line text={save.line?.text ?? null} tone={save.line?.tone} />
      </Section>
    </Page>
  );
}

/**
 * A calendar's row: its colour, picked from darma's swatches and written to Google (SV-20, D33), so
 * Google's own app matches; then its name and whether it shows. Todoist has its ring and no colour.
 * A colour waiting for Google shows at .5 with the spinner; one Google refused stays, with Google's
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
        {failed && <span className="s failed" role="alert">{`Couldn't change its colour, Google Calendar, ${command.provider_message ?? 'No answer'}`}</span>}
        {(pick.line ?? settle.line) && <span className="s failed" role="alert">{(pick.line ?? settle.line)!.text}</span>}
      </div>
      {command?.state === 'pending' && <span className="spin" aria-label="Saving"><Icon name="progress_activity" size={16} /></span>}
      {failed && (
        <>
          <button className="btn sm" type="button" onClick={() => void settle.attempt(() => settleCalendarColour(command.id, 'retry'))}><Icon name="refresh" size={16} />Try again</button>
          <button className="btn out sm" type="button" onClick={() => void settle.attempt(() => settleCalendarColour(command.id, 'move-back'))}><Icon name="undo" size={16} />Change back</button>
        </>
      )}
      <Switch on={calendar.visible} label={`Show ${calendar.name}`} onChange={onShow} />
    </div>
  );
}

/** Home: type a place, pick a suggestion; its coordinates come with it. */
function HomeSearch({onDone}: {onDone: () => void}) {
  const [session] = useState(() => crypto.randomUUID());
  const [found, setFound] = useState<PlaceSuggestionOut[]>([]);
  const ask = useAttempt();
  const pick = useAttempt();
  return (
    <>
      <div className="set-row ctl form">
        <Icon name="location_on" size={16} />
        <input className="fld grow" placeholder="Search for Home" aria-label="Home" autoFocus onChange={event => {
          const query = event.target.value.trim();
          if (!query) return setFound([]);
          void ask.attempt(() => placeSuggestions(query, session)).then(list => list && setFound(list));
        }} onKeyDown={event => {
          if (event.key !== 'Escape') return;
          event.stopPropagation();
          onDone();
        }} />
        <button className="btn quiet sm" type="button" onClick={onDone}>Cancel</button>
      </div>
      {found.map(place => (
        <button key={place.place_id} type="button" className="set-row one" style={{width: '100%', textAlign: 'left'}} onClick={() => void pick.attempt(async () => {
          const chosen = await findPlace(place.place_id, session);
          await patchSettings({calendar: {home: {label: 'Home', address: chosen.address || chosen.name, lat: chosen.lat, lng: chosen.lng}}});
          return true;
        }).then(done => done && onDone())}>
          <div className="lines grow"><span className="t">{place.name}</span><span className="s">{place.address}</span></div>
        </button>
      ))}
      {(ask.line || pick.line) && <div className="set-row one"><span className="s" style={{color: 'var(--alert)'}} role="alert">{(pick.line ?? ask.line)!.text}</span></div>}
    </>
  );
}
