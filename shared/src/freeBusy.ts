// An event's free/busy (Google's transparency), read the same by the web app (the editor's conflict
// preview, the agenda's Overlaps line) and the server (a proposal card's conflict line).
import type {Transparency} from './enums.ts';

/**
 * A free event (Google's transparency `transparent`) is never a clash: it overlaps nothing, and
 * nothing overlaps it (SV-180, D440 and its extension). A task, or an item with no transparency, is busy.
 */
export const isFree = (item: {transparency?: Transparency | null}) => item.transparency === 'transparent';
