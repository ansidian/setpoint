// How far a bottom sheet is dragged down before letting go closes it: a third of its height, but at
// least 48 px (a short sheet isn't closed by a wobble) and at most 120 px (a tall one closes without
// a long drag). Any less and it settles back.

const LEAST = 48;
const MOST = 120;

/** Whether a sheet `height` px tall, dragged `distance` px down, closes when it's let go. */
export function dragCloses(distance: number, height: number): boolean {
  return distance >= Math.min(MOST, Math.max(LEAST, height / 3));
}
