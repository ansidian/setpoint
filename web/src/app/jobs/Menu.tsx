// Jobs's menus (DESIGN.md › Needs you, Corrections; boards 34a, 35a, 35b; #266–#268): Assign to…,
// Choose…, More, the status chip's Set status, an event's ···, a row's right-click, and their
// submenus (Set status ›, Merge with… ›, Move to… ›). Each is the reader's menu (`.pop`, `.menu-i`)
// growing over 180 ms from its anchor's corner: under a button from its bottom-left corner, More and
// an event's ··· from their top-right, a right-click at the pointer. Items are 32 px, or 44 px with a
// second line; a label names a company's group; a search field leads Merge with… and Another
// application…, its items following what's typed.
//
// Keys: ↑ ↓ move the cursor, Enter (or Space) picks, → opens a submenu and ← or Esc closes it, Esc
// closes the menu and gives focus back to what opened it, and Tab closes it. A submenu opens to the
// left of its item at its height (to the right where there's no room), and under the pointer as it
// rests on its item. A press outside, a scroll, the window resizing or losing focus closes it all.
// It's drawn in the page's main landmark, beside the page, so a band or a pane that clips can't cut it.
import type {ReactNode} from 'react';
import {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import type {IconName} from '../../ui/glyphs.ts';
import {Icon} from '../../ui/Icon.tsx';
import type {Mark} from './words.ts';

export interface MenuItem {
  kind: 'item';
  id: string;
  label: string;
  icon?: IconName;
  // A status's mark in its place, its label in the table's colours (Set status).
  mark?: Mark;
  // A second line: the item is 44 px.
  sub?: string;
  hint?: string;
  checked?: boolean;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  // A posting to look at first, without picking it: a 26 px open_in_new beside it (Choose…).
  peek?: string;
  run?: () => void;
  submenu?: () => MenuSpec;
}

export type MenuEntry = MenuItem | {kind: 'label'; label: string} | {kind: 'sep'};

export interface MenuSpec {
  label: string;
  width: number;
  entries: MenuEntry[];
  // A search field first: its items follow what's typed.
  search?: {placeholder: string; entries: (query: string) => MenuEntry[]};
}

/** Where a menu opens: under a button from one of its bottom corners, or at the pointer. */
export type MenuAnchor = {element: HTMLElement; corner: 'left' | 'right'} | {point: {x: number; y: number}};

// The page's zoom from 2200 px (styles.css): rects are in the window's pixels, places in the page's.
const zoom = () => (document.documentElement as HTMLElement & {currentCSSZoom?: number}).currentCSSZoom || 1;
const GAP = 4;
const EDGE = 8;

const selectable = (entry: MenuEntry): entry is MenuItem => entry.kind === 'item' && !entry.disabled;

/** One menu's place: by its anchor, then kept on screen, opening upward where it won't fit below. */
function placeAt(anchor: MenuAnchor, size: {width: number; height: number}): {left: number; top: number; up: boolean; right: boolean} {
  const z = zoom();
  const view = {width: window.innerWidth / z, height: window.innerHeight / z};
  let left: number;
  let top: number;
  let up = false;
  const right = 'element' in anchor && anchor.corner === 'right';
  if ('point' in anchor) {
    left = anchor.point.x;
    top = anchor.point.y;
    if (top + size.height > view.height - EDGE) top = Math.max(EDGE, top - size.height);
  } else {
    const rect = anchor.element.getBoundingClientRect();
    const box = {left: rect.left / z, right: rect.right / z, top: rect.top / z, bottom: rect.bottom / z};
    left = right ? box.right - size.width : box.left;
    top = box.bottom + GAP;
    if (top + size.height > view.height - EDGE && box.top - GAP - size.height >= EDGE) {
      top = box.top - GAP - size.height;
      up = true;
    }
  }
  left = Math.min(Math.max(EDGE, left), view.width - size.width - EDGE);
  top = Math.min(Math.max(EDGE, top), Math.max(EDGE, view.height - size.height - EDGE));
  return {left, top, up, right};
}

/** A submenu's place: to the left of its item at its height, or to the right where the left has no room. */
function placeBeside(item: HTMLElement, parent: HTMLElement, size: {width: number; height: number}) {
  const z = zoom();
  const view = {width: window.innerWidth / z, height: window.innerHeight / z};
  const at = item.getBoundingClientRect();
  const menu = parent.getBoundingClientRect();
  let left = menu.left / z - GAP - size.width;
  const right = left >= EDGE;
  if (!right) left = Math.min(menu.right / z + GAP, view.width - size.width - EDGE);
  const top = Math.min(Math.max(EDGE, at.top / z - 6), Math.max(EDGE, view.height - size.height - EDGE));
  return {left, top, up: false, right};
}

export function JobsMenu({spec, anchor, onClose}: {spec: MenuSpec; anchor: MenuAnchor; onClose: () => void}) {
  const tree = useId();
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  });
  // What had focus, given back when the menu closes by its own keys.
  const [was] = useState(() => document.activeElement as HTMLElement | null);
  const close = (giveBack: boolean) => {
    latest.current();
    if (giveBack && was?.isConnected) was.focus({preventScroll: true});
  };

  // A press outside it (but on what opened it, which toggles it), a scroll, a resize or the window's blur closes it.
  useEffect(() => {
    const inside = (target: EventTarget | null) => target instanceof Node && [...document.querySelectorAll(`[data-menu-tree="${CSS.escape(tree)}"]`)].some(menu => menu.contains(target));
    const press = (event: PointerEvent) => {
      if (inside(event.target)) return;
      if ('element' in anchor && anchor.element.contains(event.target as Node)) return;
      latest.current();
    };
    // A scroll that moves what it hangs from closes it; one that was already under way as it opened
    // (a button scrolled into view, then pressed) leaves it be.
    const was = 'element' in anchor ? anchor.element.getBoundingClientRect() : null;
    const opened = performance.now();
    const away = (event: Event) => {
      if (event.type === 'scroll') {
        if (inside(event.target)) return;
        // A box that clips rather than scrolls (a band unfolding) is moved by the page, not the user.
        if (event.target instanceof Element && getComputedStyle(event.target).overflowY === 'hidden') return;
        if (was) {
          const now = (anchor as {element: HTMLElement}).element.getBoundingClientRect();
          if (Math.abs(now.top - was.top) < 1 && Math.abs(now.left - was.left) < 1) return;
        } else if (performance.now() - opened < 100) {
          return;
        }
      }
      latest.current();
    };
    document.addEventListener('pointerdown', press, true);
    window.addEventListener('scroll', away, true);
    window.addEventListener('resize', away);
    window.addEventListener('blur', away);
    return () => {
      document.removeEventListener('pointerdown', press, true);
      window.removeEventListener('scroll', away, true);
      window.removeEventListener('resize', away);
      window.removeEventListener('blur', away);
    };
  }, [anchor, tree]);

  // Drawn in the page's main landmark, as the toast is, beside the page rather than inside what clips it.
  return createPortal(<Level spec={spec} tree={tree} place={size => placeAt(anchor, size)} onBack={null} onClose={close} />, document.querySelector('main') ?? document.body);
}

function Level({spec, tree, place, onBack, onClose}: {
  spec: MenuSpec;
  tree: string;
  place: (size: {width: number; height: number}) => {left: number; top: number; up: boolean; right: boolean};
  // A submenu's way back to its parent (← or Esc); null for the menu itself.
  onBack: (() => void) | null;
  onClose: (giveBack: boolean) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const entries = spec.search ? spec.search.entries(query) : spec.entries;
  const items = entries.filter(selectable);
  const [cursor, setCursor] = useState(0);
  const current = items[Math.min(cursor, items.length - 1)];
  const [sub, setSub] = useState<{id: string; spec: MenuSpec; item: HTMLElement} | null>(null);
  const [where, setWhere] = useState<{left: number; top: number; up: boolean; right: boolean} | null>(null);

  // Placed once measured, before it's drawn; then it takes the keys.
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    setWhere(place({width: element.offsetWidth, height: element.offsetHeight}));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- placed once, where it opened
  }, []);
  const placed = where !== null;
  useLayoutEffect(() => {
    if (!placed) return;
    (field.current ?? box.current)?.focus({preventScroll: true});
  }, [placed]);

  // A submenu takes the keys as it opens, from a key or the pointer resting on its item.
  const openSub = (item: MenuItem, element: HTMLElement | null) => {
    if (!item.submenu || !element || item.disabled) return;
    if (sub?.id !== item.id) setSub({id: item.id, spec: item.submenu(), item: element});
  };
  const closeSub = () => {
    if (!sub) return;
    setSub(null);
    box.current?.focus({preventScroll: true});
  };
  const itemElement = (id: string) => box.current?.querySelector<HTMLElement>(`[data-item="${CSS.escape(id)}"]`) ?? null;
  const pick = (item: MenuItem | undefined) => {
    if (!item || item.disabled) return;
    if (item.submenu) return openSub(item, itemElement(item.id));
    onClose(true);
    item.run?.();
  };
  const step = (delta: 1 | -1) => {
    if (!items.length) return;
    const at = items.indexOf(current!);
    setCursor((at + delta + items.length) % items.length);
  };

  return (
    <>
      <div ref={box} className={spec.search ? 'pop jb-menu searching' : 'pop jb-menu'} role={spec.search ? undefined : 'menu'} aria-label={spec.search ? undefined : spec.label}
        tabIndex={-1} data-menu-tree={tree} data-up={where?.up ? '' : undefined} data-right={where?.right ? '' : undefined}
        style={{width: spec.width, ...(where ? {left: where.left, top: where.top} : {left: 0, top: 0, visibility: 'hidden'})}}
        onContextMenu={event => event.preventDefault()}
        onKeyDown={event => {
          // Nothing pressed in a menu reaches the page's own keys.
          event.stopPropagation();
          const typing = event.target === field.current;
          if (event.key === 'Escape') {
            event.preventDefault();
            if (onBack) onBack();
            else onClose(true);
          } else if (event.key === 'Tab') {
            event.preventDefault();
            onClose(true);
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            step(event.key === 'ArrowDown' ? 1 : -1);
          } else if (event.key === 'ArrowRight' && !typing && current?.submenu) {
            event.preventDefault();
            openSub(current, itemElement(current.id));
          } else if (event.key === 'ArrowLeft' && !typing && onBack) {
            event.preventDefault();
            onBack();
          } else if (event.key === 'Enter' || (event.key === ' ' && !typing)) {
            event.preventDefault();
            pick(current);
          }
        }}>
        {spec.search && (
          <label className="jb-mfield">
            <Icon name="search" size={16} />
            <input ref={field} placeholder={spec.search.placeholder} aria-label={spec.search.placeholder} value={query} onChange={event => {
              setQuery(event.target.value);
              setCursor(0);
            }} />
          </label>
        )}
        <Entries entries={entries} current={current} sub={sub?.id ?? null} role={spec.search ? 'menu' : undefined} label={spec.label}
          onPoint={(item, element) => {
            setCursor(items.indexOf(item));
            if (item.submenu) openSub(item, element);
            else closeSub();
          }}
          onPick={pick} />
      </div>
      {sub && (
        <Level key={sub.id} spec={sub.spec} tree={tree} place={size => placeBeside(sub.item, box.current!, size)} onClose={onClose}
          onBack={closeSub} />
      )}
    </>
  );
}

function Entries({entries, current, sub, role, label, onPoint, onPick}: {
  entries: MenuEntry[];
  current: MenuItem | undefined;
  sub: string | null;
  role: 'menu' | undefined;
  label: string;
  onPoint: (item: MenuItem, element: HTMLElement) => void;
  onPick: (item: MenuItem) => void;
}) {
  const list: ReactNode = entries.map((entry, index) => {
    if (entry.kind === 'sep') return <div key={`sep-${index}`} className="menu-sep" role="separator" />;
    if (entry.kind === 'label') return <div key={`label-${index}`} className="jb-mlab" role="presentation">{entry.label}</div>;
    const classes = ['menu-i', entry.sub && 'tall', entry === current && 'cur', entry.danger && 'danger', sub === entry.id && 'open'].filter(Boolean).join(' ');
    const button = (
      <button key={entry.id} type="button" role="menuitem" className={classes} tabIndex={-1} disabled={entry.disabled} title={entry.title} data-item={entry.id}
        aria-haspopup={entry.submenu ? 'menu' : undefined} aria-expanded={entry.submenu ? sub === entry.id : undefined} aria-checked={entry.checked === undefined ? undefined : entry.checked}
        onPointerMove={event => !entry.disabled && onPoint(entry, event.currentTarget)} onClick={() => onPick(entry)}>
        {entry.mark ? <span className="mk"><i className={`sd ${entry.mark}`} /></span> : entry.icon && <Icon name={entry.icon} size={16} />}
        {entry.sub ? (
          <span className="two"><span className={entry.mark ? `sl ${entry.mark}` : undefined}>{entry.label}</span><span className="s">{entry.sub}</span></span>
        ) : <span className={entry.mark ? `ell sl ${entry.mark}` : 'ell'}>{entry.label}</span>}
        {entry.hint && <span className="kbd">{entry.hint}</span>}
        {entry.checked && <Icon name="check" size={16} className="after" />}
        {entry.submenu && <Icon name="chevron_right" size={16} className="after" />}
      </button>
    );
    if (!entry.peek) return button;
    return (
      <div key={entry.id} className="jb-mrow">
        {button}
        <a className="ibtn sm" role="menuitem" href={entry.peek} target="_blank" rel="noopener noreferrer" aria-label={`Look at ${entry.label}`} title="Look at this posting" tabIndex={-1}>
          <Icon name="open_in_new" size={16} />
        </a>
      </div>
    );
  });
  return role ? <div role="menu" aria-label={label} className="jb-mlist">{list}</div> : <>{list}</>;
}
