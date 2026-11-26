// Where a right-click's menu opens: from the pointer, down and to the right, as the system's do. A
// menu that would run past the right opens to the pointer's left instead. One that would run past
// the bottom opens upward. Either way it stays 8 px inside the window.

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

/**
 * Whether a menu hanging under its anchor opens upward instead (ui/popover.ts › placeMenu):
 * when its foot would run past what can show it and there's more room above the anchor than below.
 */
export function opensUp(bottom: number, anchor: {top: number; bottom: number}, room: {top: number; bottom: number}): boolean {
  return bottom > room.bottom && anchor.top - room.top > room.bottom - anchor.bottom;
}

// How far inside its room an anchored menu is kept once it would run out of it.
export const ROOM_MARGIN = 16;

/**
 * What keeps an anchored menu inside its room once its side is chosen (ui/popover.ts › placeMenu):
 * `shift`, how far right it moves when lining up with its anchor's right edge takes it past the
 * room's left, and `maxHeight`, the height it's held to (scrolling inside) when it runs past the
 * room on the side it opens to. A menu that fits stays as it is. `menu` is where it would rest.
 */
export function menuInside(menu: {left: number; top: number; height: number}, up: boolean, anchor: {top: number; bottom: number}, room: {top: number; bottom: number; left: number}): {shift: number; maxHeight: number | null} {
  const gap = menu.top - anchor.bottom;
  const space = up ? anchor.top - gap - room.top : room.bottom - menu.top;
  return {
    shift: menu.left < room.left ? room.left + ROOM_MARGIN - menu.left : 0,
    maxHeight: menu.height > space ? Math.max(0, space - ROOM_MARGIN) : null,
  };
}
