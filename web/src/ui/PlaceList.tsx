// The list under a field that suggests as it's typed: places under the editor's place (board 13),
// people and values under mail search's operators.
import type {Ref} from 'react';
import {Icon} from './Icon.tsx';
import type {IconName} from './glyphs.ts';

/**
 * Each row's name with what was typed in bold, its address under it, "Saved" on a saved place, and ↵
 * on the one Enter picks. The proposal card's floats under its field as a menu.
 */
export function PlaceList<T extends {name: string; address?: string | null; saved?: true}>({ref, places, cur, query, floating = false, icon = 'location_on', label = 'Places', keyOf = place => place.name, onPick}: {
  ref?: Ref<HTMLDivElement>;
  places: T[];
  cur: number;
  query: string;
  floating?: boolean;
  // Each row's glyph, or none.
  icon?: IconName | null;
  label?: string;
  keyOf?: (place: T) => string;
  onPick: (place: T) => void;
}) {
  return (
    <div ref={ref} className={`pop places${floating ? ' menu' : ''}`} role="listbox" aria-label={label}>
      {places.map((place, index) => {
        const at = query ? place.name.toLowerCase().indexOf(query.toLowerCase()) : -1;
        const name = at < 0 ? place.name : <>{place.name.slice(0, at)}<b>{place.name.slice(at, at + query.length)}</b>{place.name.slice(at + query.length)}</>;
        return (
          <div key={keyOf(place)} className={`menu-i place${index === cur ? ' cur' : ''}`} role="option" aria-selected={index === cur}
            onMouseDown={event => event.preventDefault()} onClick={() => onPick(place)}>
            {icon && <Icon name={icon} />}
            <span className="grow place-text"><span className="ell place-name">{name}</span>{place.address && <span className="ell ink3 place-address">{place.address}</span>}</span>
            {place.saved && <span className="ink3 place-saved">Saved</span>}
            {index === cur && <span className="kbd">↵</span>}
          </div>
        );
      })}
    </div>
  );
}
