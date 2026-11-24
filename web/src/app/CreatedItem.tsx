// The detail of an item just created from an email, as the answer that it's on the calendar: the
// reader's Add to calendar or Add as task (its card, or a row's right-click), and on the phone an
// invitation's Add to calendar too. On the desktop it's the floating detail's card (ItemCard) in the
// proposal card's place, until Esc, its close button or a click outside it. On the phone it's the
// detail as the Agenda shows it, over a scrim that closes it, as does its ×. Each has Edit, Delete
// with Undo and a task's Complete, and Open in Calendar.
import type {CalendarOut, ItemOut} from '@setpoint/shared';
import {useEffect} from 'react';
import {timeZone} from '../api/auth.ts';
import {useResource} from '../api/client.ts';
import {CALENDARS_PATH, itemPath} from '../api/items.ts';
import {itemDays} from '../logic/calendar.ts';
import {localDate} from '../logic/format.ts';
import type {Route} from '../logic/route.ts';
import {DetailContent} from './calendar/detail/DetailContent.tsx';
import type {DetailActions} from './calendar/detail/DetailContent.tsx';
import {ItemCard} from './calendar/detail/ItemCard.tsx';
import type {ItemCardProps} from './calendar/detail/ItemCard.tsx';
import {useNow} from './clock.ts';
import {deleteWithUndo, toggleDone} from './phone/itemActions.ts';
import {navigate} from './router.ts';
import {Bar, Sk} from './states/Loading.tsx';

const itemRoute = (item: ItemOut, edit = false): Route => ({page: 'calendar', date: null, item: item.id, at: item.occurrence_start, ...(edit ? {edit: true} as const : {})});

/** The item as it stands now, read by its id, and its calendar. One that's gone closes its card. */
function useCreated(id: number | null, onClose: () => void): {item: ItemOut | undefined; calendar: CalendarOut | undefined} {
  const {data: item, error} = useResource<ItemOut>(id === null ? null : itemPath(id));
  const {data: calendars} = useResource<CalendarOut[]>(CALENDARS_PATH);
  useEffect(() => {
    if (error) onClose();
  }, [error, onClose]);
  return {item, calendar: item && calendars?.find(calendar => calendar.id === item.calendar_id)};
}

/** Complete, Delete (which closes the card, the toast keeping Undo) and Open in Calendar. */
function actionsFor(onClose: () => void, remove: ((item: ItemOut) => void) | null): DetailActions {
  return {
    complete: task => toggleDone(task),
    open: one => navigate(itemRoute(one)),
    ...(remove ? {remove: (one: ItemOut) => {
      onClose();
      remove(one);
    }} : {}),
  };
}

/**
 * The desktop's card, at `line`'s place: its top left where the proposal card's was. A repeating
 * event leaves Delete to Calendar, which asks which of its events go.
 */
export function CreatedItemCard({id, line, onClose}: {id: number; line: string; onClose: () => void}) {
  const {item, calendar} = useCreated(id, onClose);
  if (!item) return null;
  const actions = actionsFor(onClose, item.kind === 'event' && item.recurring ? null : one => deleteWithUndo(one));
  const at: ItemCardProps['at'] = place => ({left: place.left, top: place.top});
  return (
    <ItemCard item={item} calendar={calendar} timeZone={timeZone()} className="created-card" line={line} lines={line} at={at}
      actions={actions} onClose={onClose} onEdit={() => navigate(itemRoute(item, true))} />
  );
}

/**
 * The phone's: the Agenda's detail over a scrim, its body held by a skeleton until the item is in
 * (`id` null while it's being made). Edit and Delete are the editor sheet's (phone/EditorSheet.tsx).
 */
export function CreatedItemDetail({id, onClose, onEdit, remove}: {id: number | null; onClose: () => void; onEdit: (item: ItemOut, day: string) => void; remove: (item: ItemOut) => void}) {
  const zone = timeZone();
  const today = localDate(useNow(), zone);
  const {item, calendar} = useCreated(id, onClose);
  return (
    <>
      <button className="ph-scrim" type="button" aria-label="Close" onClick={onClose} />
      <div className="fd ph-detail created-detail" role="dialog" aria-label={item?.title ?? 'New item'}>
        <div className="card">
          <div className="fd-body">
            {item ? (
              <DetailContent target={{item, date: itemDays(item, zone)[0] ?? today, calendar}} timeZone={zone} actions={actionsFor(onClose, remove)}
                onClose={onClose} onEdit={() => onEdit(item, itemDays(item, zone)[0] ?? today)} />
            ) : (
              <Sk kind="created" className="sk-created"><Bar w="62%" h={11} /><Bar w="40%" /><Bar w="48%" /></Sk>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
