// Where a right-click's menu opens (DESIGN.md #248): from the pointer, down and to the right, as
// the system's do; one that would run past the right opens to the pointer's left instead, one that
// would run past the bottom opens upward, and either way it stays 8 px inside the window.

export const MENU_MARGIN = 8;

export interface MenuPlace {
  left: number;
  top: number;
  // Which way it opened, for the corner its entrance grows from.
  right: boolean;
  up: boolean;
}

export function placeMenuAt(point: {x: number; y: number}, size: {width: number; height: number}, viewport: {width: number; height: number}): MenuPlace {
  const right = point.x + size.width > viewport.width - MENU_MARGIN;
  const up = point.y + size.height > viewport.height - MENU_MARGIN && point.y - size.height >= MENU_MARGIN;
  const clamp = (value: number, room: number, length: number) => Math.max(MENU_MARGIN, Math.min(value, room - length - MENU_MARGIN));
  return {
    left: clamp(right ? point.x - size.width : point.x, viewport.width, size.width),
    top: clamp(up ? point.y - size.height : point.y, viewport.height, size.height),
    right,
    up,
  };
}
