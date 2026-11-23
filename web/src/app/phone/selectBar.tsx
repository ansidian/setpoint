// The phone Inbox's Select bar: while Select's mode is on, it takes the tab bar's place with Done,
// Pin, Read and Trash for every selected email, as the iOS app's did. Each ends the mode. The Inbox says what it offers
// (`showSelectBar`), and the shell draws it where the tabs are (Phone.tsx).
import {useSyncExternalStore} from 'react';
import {Icon} from '../../ui/Icon.tsx';

export interface SelectBarModel {
  // How many are selected: none, and nothing can be pressed.
  count: number;
  // Whether any selected email can be Done (Attention mail not yet Done).
  done: boolean;
  // Pin while any isn't pinned, else Unpin.
  pin: boolean;
  // Read while any is unread, else Unread.
  read: boolean;
  on: {done: () => void; pin: () => void; read: () => void; trash: () => void};
}

let current: SelectBarModel | null = null;
const listeners = new Set<() => void>();

/** The bar to show in the tabs' place, or none. */
export function showSelectBar(bar: SelectBarModel | null) {
  if (bar === current) return;
  current = bar;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The bar the Inbox shows, while Select's mode is on. */
export const useSelectBar = () => useSyncExternalStore(subscribe, () => current);

export function SelectBar({bar}: {bar: SelectBarModel}) {
  const none = bar.count === 0;
  return (
    <nav className="ph-acts ph-selbar" aria-label="Selected emails">
      <button className="ph-done" type="button" disabled={none || !bar.done} onClick={bar.on.done}><Icon name="check" size={20} />Done</button>
      <button type="button" disabled={none} onClick={bar.on.pin}><Icon name={bar.pin ? 'keep' : 'keep_off'} size={20} />{bar.pin ? 'Pin' : 'Unpin'}</button>
      <button type="button" disabled={none} onClick={bar.on.read}><Icon name={bar.read ? 'mark_email_read' : 'mark_email_unread'} size={20} />{bar.read ? 'Read' : 'Unread'}</button>
      <button className="trash" type="button" disabled={none} onClick={bar.on.trash}><Icon name="delete" size={20} />Trash</button>
    </nav>
  );
}
