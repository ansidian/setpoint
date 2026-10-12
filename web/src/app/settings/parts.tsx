// Settings' row pattern (DESIGN.md › Settings): a page's head, sections with their uppercase label,
// `sub` groups of rows 52 px or more, 34 × 20 switches, selects, steppers and small menus. Every
// page is built from these, the drawn ones (boards 17, 18a, 18b) and the rest alike.
import {useEffect, useRef, useState} from 'react';
import type {CSSProperties, KeyboardEvent, ReactNode} from 'react';
import {Icon} from '../../ui/Icon.tsx';
import {placeMenu} from '../../ui/popover.ts';
import {closeSettings} from './store.ts';

export function Page({title, actions, children}: {title: string; actions?: ReactNode; children: ReactNode}) {
  return (
    <section className="set-main" aria-label={title}>
      <button className="ibtn set-x" type="button" aria-label="Close settings" onClick={closeSettings}><Icon name="close" /></button>
      <div className="set-head">
        <h2 className="set-title">{title}</h2>
        {actions && <><span className="grow" />{actions}</>}
      </div>
      {children}
    </section>
  );
}

export function Section({label, right, style, children}: {label?: ReactNode; right?: ReactNode; style?: CSSProperties; children: ReactNode}) {
  return (
    <div className="set-sec" style={style}>
      {label && <div className="set-label">{label}{right && <span className="r">{right}</span>}</div>}
      {children}
    </div>
  );
}

/** A row with a title, an optional second line, and its control at the end. */
export function Row({title, sub, mono, kind, children}: {title: ReactNode; sub?: ReactNode; mono?: boolean; kind?: 'ctl' | 'one'; children?: ReactNode}) {
  return (
    <div className={kind ? `set-row ${kind}` : 'set-row'}>
      {sub === undefined ? <span className={mono ? 'topic grow' : 't grow'}>{title}</span> : (
        <div className="lines grow"><span className={mono ? 'topic' : 't'}>{title}</span><span className="s">{sub}</span></div>
      )}
      {children}
    </div>
  );
}

export function Switch({on, label, disabled, onChange}: {on: boolean; label: string; disabled?: boolean; onChange: (on: boolean) => void}) {
  return <button className={on ? 'switch on' : 'switch'} type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} onClick={() => onChange(!on)} />;
}

/**
 * The board's select (a 30 px chip with a chevron): it opens the same small menu as a row's options,
 * its choices as items with a check on the current one, never the browser's own list.
 */
export function Select<T extends string | number>({value, options, label, onChange}: {value: T; options: {value: T; label: string; disabled?: boolean}[]; label: string; onChange: (value: T) => void}) {
  const shown = options.find(option => option.value === value)?.label ?? String(value);
  return (
    <Menu label={label} className="pick" button={(
      <button className="select" type="button" aria-label={label} aria-haspopup="menu"><span className="num">{shown}</span><Icon name="expand_more" size={16} /></button>
    )}>
      {close => options.map(option => (
        <button key={String(option.value)} className="mi" type="button" role="menuitemradio" aria-checked={option.value === value} disabled={option.disabled} onClick={() => {
          close();
          if (option.value !== value) onChange(option.value);
        }}>{option.label}{option.value === value && <Icon name="check" size={16} />}</button>
      ))}
    </Menu>
  );
}

export function Stepper({value, label, onStep}: {value: string; label: string; onStep: (delta: 1 | -1) => void}) {
  return (
    <span className="stepper" role="group" aria-label={label}>
      <button className="ibtn sm" type="button" aria-label="Less" onClick={() => onStep(-1)}><Icon name="remove" size={16} /></button>
      <span className="v num">{value}</span>
      <button className="ibtn sm" type="button" aria-label="More" onClick={() => onStep(1)}><Icon name="add" size={16} /></button>
    </span>
  );
}

/**
 * A small menu anchored to its button: opens on a click, closes on another, a click elsewhere or
 * Esc (which then goes no further, so Settings stays open, and hands focus back to the button).
 * Opened from the keyboard it focuses its checked item, or its first; ↑ ↓ move between items.
 */
export function Menu({button, label, align = 'right', className, children}: {button: ReactNode; label: string; align?: 'left' | 'right'; className?: string; children: (close: () => void) => ReactNode}) {
  const [open, setOpen] = useState<false | 'pointer' | 'keys'>(false);
  const anchor = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => !anchor.current?.contains(event.target as Node) && setOpen(false);
    document.addEventListener('pointerdown', away);
    return () => document.removeEventListener('pointerdown', away);
  }, [open]);
  useEffect(() => {
    if (open !== 'keys') return;
    const all = menuItems(anchor.current);
    (all.find(item => item.getAttribute('aria-checked') === 'true') ?? all[0])?.focus();
  }, [open]);
  // Closing from inside the menu (a pick, Esc) hands focus back to the button, not to the page. It finds
  // the menu from focus, not the anchor ref, since `children(close)` runs during render.
  const close = () => {
    const menu = document.activeElement?.closest('[role="menu"]');
    setOpen(false);
    menu?.parentElement?.querySelector<HTMLElement>(':scope > span > button')?.focus();
  };
  return (
    <span className="anchor" ref={anchor} onKeyDown={event => {
      if (!open) return;
      if (event.key === 'Escape') {
        event.stopPropagation();
        close();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const all = menuItems(anchor.current);
        const at = all.indexOf(document.activeElement as HTMLElement);
        const step = event.key === 'ArrowDown' ? 1 : -1;
        all[at < 0 ? (step > 0 ? 0 : all.length - 1) : (at + step + all.length) % all.length]?.focus();
      }
    }}>
      <span onClick={event => setOpen(open ? false : event.detail === 0 ? 'keys' : 'pointer')} aria-label={label} aria-expanded={!!open} role="presentation">{button}</span>
      {open && <div ref={placeMenu} className={['pop menu', align === 'left' && 'left', className].filter(Boolean).join(' ')} role="menu" aria-label={label}>{children(close)}</div>}
    </span>
  );
}

const menuItems = (anchor: HTMLElement | null) => [...anchor?.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]:enabled') ?? []];

/** An inline form's Esc (Add rule, Connect iCloud, …): it cancels the form, as Rename's does, and goes no further, so Settings stays open. */
export const escapeCancels = (cancel: () => void) => (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return;
  event.stopPropagation();
  cancel();
};

/** A line under a section saying how a change went: its refusal, or what happened. */
export function Line({text, tone}: {text: string | null; tone?: 'failed' | 'caution'}) {
  return text ? <p className={tone ? `line ${tone}` : 'line'} role={tone ? 'alert' : 'status'}>{text}</p> : null;
}

/** A change's state for its line: runs `send`, keeping its refusal's words. */
export function useAttempt() {
  const [line, setLine] = useState<{text: string; tone?: 'failed'} | null>(null);
  const [busy, setBusy] = useState(false);
  async function attempt<T>(send: () => Promise<T>, done?: (value: T) => string | null): Promise<T | undefined> {
    setBusy(true);
    setLine(null);
    try {
      const value = await send();
      const text = done?.(value) ?? null;
      setLine(text ? {text} : null);
      return value;
    } catch (error) {
      setLine({text: error instanceof Error ? error.message : 'Something went wrong.', tone: 'failed'});
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  return {line, busy, attempt, clear: () => setLine(null)};
}
