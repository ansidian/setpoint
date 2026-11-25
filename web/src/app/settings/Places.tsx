// Settings › Places (not drawn), right after Calendar, on the phone too: the places "@Name" in an
// event's line, the Place field and Alfred take the address of. Home is pinned first, its address
// changeable but not its name, and it can't be removed (Time to Leave and the forecast start from
// it). The other saved places follow by name, each with Edit and Remove. Add place is one row: a
// Name field, then the address search Home uses, and picking a result saves it. Edit opens the same
// row with the name filled in and the full address under it: Save keeps a new name, and a result
// picked saves the name and its address. Names are unique in any case, "Home" is Home's, up to
// 80 characters. Last, the Google Maps key the search
// and Time to Leave's routes use. Without it (and outside a dev run's invented places), the search
// says so instead of searching.
import type {PlaceOut, PlaceSuggestionOut, SavedPlace, SecretOut, Settings, SourceOut} from '@setpoint/shared';
import {byName, HOME_NAME, PLACE_NAME_MAX, placeNameProblem} from '@setpoint/shared';
import {useState} from 'react';
import type {KeyboardEvent, ReactNode} from 'react';
import {useResource} from '../../api/client.ts';
import {placeSuggestions, SETTINGS_PATH} from '../../api/items.ts';
import {findPlace, patchSettings, SECRETS_PATH, SOURCES_PATH} from '../../api/settings.ts';
import {Icon} from '../../ui/Icon.tsx';
import {uuid} from '../uuid.ts';
import {Line, Page, Row, Section, SkeletonRows, useAttempt} from './parts.tsx';
import {SecretRow} from './Ai.tsx';

const NO_KEY = 'Set the Google Maps key below';
type Editing = {kind: 'add'} | {kind: 'home'} | {kind: 'edit'; name: string} | null;

export function PlacesPage() {
  const settingsLoad = {path: SETTINGS_PATH, ...useResource<Settings>(SETTINGS_PATH)};
  const settings = settingsLoad.data;
  const secretsLoad = {path: SECRETS_PATH, ...useResource<SecretOut[]>(SECRETS_PATH)};
  const secrets = secretsLoad.data;
  const sourcesLoad = {path: SOURCES_PATH, ...useResource<SourceOut[]>(SOURCES_PATH)};
  const sources = sourcesLoad.data;
  const [editing, setEditing] = useState<Editing>(null);
  const save = useAttempt();
  // A dev run's places are invented, with no key (as the server's search has them).
  const searchable = !!secrets?.find(one => one.name === 'places_api_key')?.set || !!sources?.some(source => source.dev);
  const home = settings?.calendar.home ?? null;
  const saved = settings?.places.saved ?? [];
  const done = () => setEditing(null);
  const keep = (next: SavedPlace[], said: string) => void save.attempt(() => patchSettings({places: {saved: next}}), () => said).then(answer => answer && done());
  const others = (name: string | null) => saved.filter(one => one.name !== name).map(one => one.name);

  return (
    <Page title="Places" loads={[settingsLoad, secretsLoad, sourcesLoad]}>
      <Section label="Places">
        {!settings || !secrets || !sources ? <SkeletonRows count={2} /> : (
          <div className="set-group" data-places>
            {editing?.kind === 'home' ? (
              <PlaceSearch label={HOME_NAME} searchable={searchable} onDone={done} onPick={place => patchSettings({calendar: {home: {label: HOME_NAME, address: place.address || place.name, lat: place.lat, lng: place.lng}}})} />
            ) : (
              <Row title={HOME_NAME} sub={home ? home.address : 'Not set · Time to Leave and the forecast start from Home'}>
                <button className="btn out sm" type="button" onClick={() => setEditing({kind: 'home'})}>{home ? 'Change' : 'Set Home'}</button>
              </Row>
            )}
            {byName(saved).map(place => editing?.kind === 'edit' && editing.name === place.name ? (
              <PlaceSearch key={place.name} label={place.name} named={others(place.name)} current={place} searchable={searchable} onDone={done}
                onSave={(name, address) => keep(saved.map(one => (one.name === place.name ? {name, address} : one)), `Saved ${name}`)} />
            ) : (
              <div className="set-row" key={place.name} data-place={place.name}>
                <div className="lines grow"><span className="t">{place.name}</span><span className="s">{place.address}</span></div>
                <button className="btn quiet sm" type="button" onClick={() => {
                  save.clear();
                  setEditing({kind: 'edit', name: place.name});
                }}>Edit</button>
                <button className="btn quiet sm" type="button" onClick={() => keep(saved.filter(one => one.name !== place.name), `Removed ${place.name}`)}>Remove</button>
              </div>
            ))}
            {editing?.kind === 'add' ? (
              <PlaceSearch label="New place" named={others(null)} searchable={searchable} onDone={done}
                onPick={(found, name) => patchSettings({places: {saved: [...saved, {name, address: found.address || found.name}]}})} />
            ) : (
              <button className="set-row one add-place" type="button" onClick={() => {
                save.clear();
                setEditing({kind: 'add'});
              }}>
                <Icon name="add" size={16} />
                <span className="t grow">Add place</span>
              </button>
            )}
          </div>
        )}
        <Line text={save.line?.text ?? null} tone={save.line?.tone} />
      </Section>

      <Section label="Google Maps">
        {!secrets ? <SkeletonRows count={1} /> : (
          <div className="set-group">
            <SecretRow name="places_api_key" title="Google Maps key" sub="Search for places and Time to Leave's routes" secrets={secrets} />
          </div>
        )}
      </Section>
    </Page>
  );
}

/**
 * The address search Home and every saved place use: type a place, pick a suggestion, and the pick
 * saves. With `named` (the other places' names), a Name field comes first on the row, checked before
 * anything saves: Add place's row (`onPick`), or Edit's, which starts from the place's `current`
 * name with its full address under the row, and whose Save (or Enter in the name) keeps a new name
 * (`onSave`, as a pick does with the new address). Without the Maps key the search says so instead.
 */
function PlaceSearch({label, named, current, searchable, onPick, onSave, onDone}: {
  label: string;
  named?: string[];
  current?: SavedPlace;
  searchable: boolean;
  onPick?: (place: PlaceOut, name: string) => Promise<unknown>;
  onSave?: (name: string, address: string) => void;
  onDone: () => void;
}) {
  const [session] = useState(() => uuid());
  const [found, setFound] = useState<PlaceSuggestionOut[]>([]);
  const [name, setName] = useState(current?.name ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const ask = useAttempt();
  const pick = useAttempt();
  const escape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    onDone();
  };
  // The name as it stands, or why it can't be.
  const checked = () => {
    const refused = named ? placeNameProblem(name, named) : null;
    if (refused) setProblem(refused);
    return refused ? null : name.trim();
  };
  const save = () => {
    if (!current || !onSave) return;
    if (name.trim() === current.name) return onDone();
    const kept = checked();
    if (kept !== null) onSave(kept, current.address);
  };
  const choose = (place: PlaceSuggestionOut) => {
    const kept = checked();
    if (kept === null) return;
    void pick.attempt(async () => {
      const details = await findPlace(place.place_id, session);
      if (current) onSave!(kept, details.address || details.name);
      else await onPick!(details, kept);
      return true;
    }).then(saved => saved && !current && onDone());
  };
  return (
    <>
      <div className="set-row ctl form">
        {named && (
          <input className="fld place-name-field" placeholder="Name" aria-label="Name" maxLength={PLACE_NAME_MAX} autoFocus value={name} onKeyDown={event => {
            if (event.key === 'Enter') save();
            escape(event);
          }} onChange={event => {
            setName(event.target.value);
            setProblem(null);
          }} />
        )}
        {searchable ? (
          <span className="fld-pin grow">
            <Icon name="location_on" size={16} />
            <input className="fld" placeholder={current ? 'Search for a new address' : named ? 'Search for its address' : `Search for ${label}`} aria-label={named ? 'Address' : label} autoFocus={!named} onKeyDown={escape} onChange={event => {
            const typed = event.target.value.trim();
            if (!typed) return setFound([]);
            void ask.attempt(() => placeSuggestions(typed, session)).then(list => list && setFound(list));
          }} />
          </span>
        ) : <span className="s grow">{NO_KEY}</span>}
        {current && <button className="btn sm" type="button" onClick={save}>Save</button>}
        <button className="btn quiet sm" type="button" onClick={onDone}>Cancel</button>
      </div>
      {current && !found.length && <div className="set-row one"><span className="s">{current.address}</span></div>}
      {found.map(place => (
        <button key={place.place_id} type="button" className="set-row one" style={{width: '100%', textAlign: 'left'}} onClick={() => choose(place)}>
          <div className="lines grow"><span className="t">{place.name}</span><span className="s">{place.address}</span></div>
        </button>
      ))}
      <Problem text={problem ?? (pick.line ?? ask.line)?.text ?? null} />
    </>
  );
}

const Problem = ({text}: {text: ReactNode | null}) => text && <div className="set-row one"><span className="s" style={{color: 'var(--alert)'}} role="alert">{text}</span></div>;
