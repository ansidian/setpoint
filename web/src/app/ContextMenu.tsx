// The right-click menu (DESIGN.md › Decided while building #248, following darma's DA-14 D13): a
// right-click on an email, a calendar item or empty day, a story, an attachment or a sidebar row opens
// that thing's actions at the pointer, the ones it already has elsewhere (More, the floating detail,
// ⌘K, its keys) with their key hints, plus Copy items. It's the reader's More menu (`.pop.menu`),
// kept on screen (logic/contextMenu.ts). Its cursor starts on the first item; ↑ ↓ move it, Enter
// runs it, an item's key runs that item, and Esc, a press elsewhere, a scroll or the window
// resizing close it. An item with a panel (Colour) shows the panel in its place, at the same spot.
//
// The browser keeps its own menu on a link or field inside the thing, on selected text, inside an
// email's body (its frame never reaches here), and with ⌥ held. A right-click that closes an open
// popover, this menu included, opens neither (darma D1). The phone has none.
import type {KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode} from 'react';
import {useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore} from 'react';
import {placeMenuAt} from '../logic/contextMenu.ts';
import type {IconName} from '../ui/glyphs.ts';
import {Icon} from '../ui/Icon.tsx';
import {isPhone} from './Phone.tsx';
import {showToast} from './toast.ts';

export interface MenuAction {
  id: string;
  label: string;
  icon: IconName;
  // Its key, as a hint ("H", "⇧U", "⌘C"); a single letter, with ⇧ or ⌘ or not, also runs it here.
  hint?: string;
  // More words ⌘K finds it by, where it's offered there too.
  keywords?: string;
  run: () => void;
  // Destructive: `alert` under the pointer (#169).
  danger?: boolean;
  disabled?: boolean;
  // Items of different groups have a hairline between them.
  group?: string;
  // Picked, it shows this in its place, at the same spot, rather than running (Colour's swatches).
  panel?: (close: () => void) => ReactNode;
}

interface Open {
  x: number;
  y: number;
  actions: MenuAction[];
  n: number;
}

let state: Open | null = null;
let opened = 0;
const listeners = new Set<() => void>();
const set = (next: Open | null) => {
  state = next;
  listeners.forEach(listener => listener());
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const closeContextMenu = () => state && set(null);

// The page's zoom from 2200 px (styles.css): the pointer is in the window's pixels, the menu's place in the page's.
const zoom = () => (document.documentElement as HTMLElement & {currentCSSZoom?: number}).currentCSSZoom || 1;

/** Whether a right-click on `owner` is Setpoint's: not with ⌥, not on a link or field inside it, not on selected text. */
export function takesContextMenu(event: ReactMouseEvent, owner: Element): boolean {
  if (event.altKey) return false;
  const target = event.target as Element;
  const inner = target.closest('a[href]:not([href="#"]), input, textarea, select, [contenteditable="true"], iframe');
  if (inner && inner !== owner && owner.contains(inner)) return false;
  const selection = window.getSelection();
  return !(selection && !selection.isCollapsed && selection.toString().trim() && selection.containsNode(target, true));
}

/**
 * Opens `actions` at the pointer for `owner` (a row, a chip, a day), taking the event, and says
 * whether it did. With nothing to offer, or where the browser keeps its menu, it leaves the event be.
 */
export function openContextMenu(event: ReactMouseEvent, owner: Element, actions: MenuAction[]): boolean {
  if (!actions.length || isPhone() || !takesContextMenu(event, owner)) return false;
  event.preventDefault();
  event.stopPropagation();
  const z = zoom();
  set({x: event.clientX / z, y: event.clientY / z, actions, n: ++opened});
  return true;
}

/** Copy items: the text onto the clipboard, saying what it took ("Copied pat@contoso.example", #40), or that it couldn't (#109). */
export function copyText(text: string, said = text) {
  const writing = navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject(new Error('No clipboard'));
  writing.then(() => showToast(`Copied ${said}`), () => showToast('Couldn\'t copy it'));
}

// A right-click (or a Ctrl-click) pressed while a popover is open only closes it: its menu, and the
// browser's, stay shut (darma D1). Read on the press, before the popover's own press closes it.
let swallow = false;
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', event => {
    const secondary = event.button === 2 || (event.button === 0 && event.ctrlKey);
    const target = event.target as Node;
    swallow = secondary && [...document.querySelectorAll('.pop:not(.closing)')].some(pop => !pop.contains(target));
    // A press outside the menu closes it, as any menu's does.
    if (state && !document.querySelector('.ctx-menu')?.contains(target)) set(null);
  }, true);
  document.addEventListener('contextmenu', event => {
    if (!swallow) return;
    swallow = false;
    event.preventDefault();
    event.stopPropagation();
  }, true);
}

/** Whether `event` is `hint`'s key: "H", "⇧U" or "⌘C"; other hints (Del, ↵) run only from the menu's cursor. */
function isHint(hint: string | undefined, event: ReactKeyboardEvent): boolean {
  const parts = /^(⇧|⌘)?([A-Z])$/.exec(hint ?? '');
  if (!parts || event.altKey || event.ctrlKey) return false;
  const [, modifier, letter] = parts;
  return event.key.toLowerCase() === letter!.toLowerCase() && event.shiftKey === (modifier === '⇧') && event.metaKey === (modifier === '⌘');
}

export function ContextMenu() {
  const open = useSyncExternalStore(subscribe, () => state);
  return open && <Menu key={open.n} open={open} />;
}

function Menu({open}: {open: Open}) {
  const menu = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{left: number; top: number; right: boolean; up: boolean} | null>(null);
  const [panel, setPanel] = useState<MenuAction | null>(null);
  const actions = open.actions;
  const firstEnabled = Math.max(0, actions.findIndex(action => !action.disabled));
  const [cursor, setCursor] = useState(firstEnabled);
  // What had focus, given back when the menu closes by its own keys or a pick.
  const [was] = useState(() => document.activeElement as HTMLElement | null);

  // Placed once measured, before it's drawn, then given the keys.
  useLayoutEffect(() => {
    const element = menu.current;
    if (!element) return;
    const z = zoom();
    setPlace(placeMenuAt({x: open.x, y: open.y}, {width: element.offsetWidth, height: element.offsetHeight}, {width: window.innerWidth / z, height: window.innerHeight / z}));
  }, [open, panel]);
  // Once it shows: a hidden element can't take focus.
  const placed = place !== null;
  useLayoutEffect(() => {
    if (placed) menu.current?.focus({preventScroll: true});
  }, [placed, panel]);

  // A scroll, the window resizing or losing focus closes it: it belongs to where the pointer was.
  useEffect(() => {
    const away = (event: Event) => {
      if (event.type === 'scroll' && menu.current?.contains(event.target as Node)) return;
      set(null);
    };
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    window.addEventListener('blur', away);
    return () => {
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
      window.removeEventListener('blur', away);
    };
  }, []);

  const close = () => {
    set(null);
    if (was?.isConnected) was.focus({preventScroll: true});
    else (document.activeElement as HTMLElement | null)?.blur?.();
  };
  const run = (action: MenuAction | undefined) => {
    if (!action || action.disabled) return;
    if (action.panel) {
      setPanel(action);
      return;
    }
    close();
    // Once the menu has gone and focus is back, so it acts on the page (as ⌘K's commands do).
    requestAnimationFrame(action.run);
  };
  const step = (delta: 1 | -1) => {
    for (let at = cursor + delta, tries = 0; tries < actions.length; at += delta, tries++) {
      const index = (at + actions.length) % actions.length;
      if (!actions[index]!.disabled) return setCursor(index);
    }
  };

  return (
    <div ref={menu} className={panel ? 'pop menu ctx-menu panel' : 'pop menu ctx-menu'} role="menu" tabIndex={-1}
      data-right={place?.right ? '' : undefined} data-up={place?.up ? '' : undefined}
      style={place ? {left: place.left, top: place.top} : {left: open.x, top: open.y, visibility: 'hidden'}}
      onContextMenu={event => event.preventDefault()}
      onKeyDown={event => {
        // Nothing pressed here reaches the page's own keys.
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          close();
        } else if (event.key === 'Tab') {
          event.preventDefault();
          close();
        } else if (panel) {
          return;
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          step(event.key === 'ArrowDown' ? 1 : -1);
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          run(actions[cursor]);
        } else {
          const keyed = actions.find(action => isHint(action.hint, event));
          if (keyed) {
            event.preventDefault();
            run(keyed);
          }
        }
      }}>
      {panel ? panel.panel!(close) : actions.map((action, index) => (
        <MenuRow key={action.id} action={action} divided={index > 0 && action.group !== actions[index - 1]!.group} current={index === cursor}
          onPoint={() => !action.disabled && index !== cursor && setCursor(index)} onRun={() => run(action)} />
      ))}
    </div>
  );
}

function MenuRow({action, divided, current, onPoint, onRun}: {action: MenuAction; divided: boolean; current: boolean; onPoint: () => void; onRun: () => void}) {
  const classes = ['menu-i', current && 'cur', action.danger && 'danger'].filter(Boolean).join(' ');
  return (
    <>
      {divided && <div className="menu-sep" role="separator" />}
      <button type="button" role="menuitem" className={classes} tabIndex={-1} disabled={action.disabled} onPointerMove={onPoint} onClick={onRun}>
        <Icon name={action.icon} size={16} alfred={action.icon === 'auto_awesome'} />
        <span className="ell">{action.label}</span>
        {action.hint && <span className="kbd">{action.hint}</span>}
      </button>
    </>
  );
}
