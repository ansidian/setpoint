// Settings' row pattern (DESIGN.md › Settings): a page's head, sections with their uppercase label,
// `sub` groups of rows 52 px or more, 34 × 20 switches, selects, steppers and small menus. Every
// page is built from these, the drawn ones (boards 17, 18a, 18b) and the rest alike.
import {cloneElement, useCallback, useEffect, useRef, useState} from 'react';
import type {CSSProperties, KeyboardEvent, ReactElement, ReactNode} from 'react';
import type {HealthKind} from '../../logic/health.ts';
import {Icon} from '../../ui/Icon.tsx';
import {placeMenu} from '../../ui/popover.ts';
import {Bar, LoadFailed, Sk, useLoadFailed} from '../states/Loading.tsx';
import type {Load} from '../states/Loading.tsx';
import {closeSettings} from './store.ts';

/**
 * A Settings page: its head, then its sections, or, when one of its `loads` failed with nothing to
 * show, why, with Try again (states-06, #228).
 */
export function Page({title, actions, loads = [], children}: {title: string; actions?: ReactNode; loads?: Load[]; children: ReactNode}) {
  const failed = useLoadFailed(loads);
  return (
    <section className="set-main" aria-label={title}>
      <button className="ibtn set-x" type="button" aria-label="Close settings" onClick={closeSettings}><Icon name="close" /></button>
      <div className="set-head">
        <h2 className="set-title">{title}</h2>
        {actions && <><span className="grow" />{actions}</>}
      </div>
      {failed ? <LoadFailed what={`Settings › ${title}`} loads={loads} /> : children}
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
        <button key={String(option.value)} className="menu-i" type="button" role="menuitemradio" aria-checked={option.value === value} disabled={option.disabled} onClick={() => {
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
export function Menu({button, label, align = 'right', className, children}: {button: ReactElement<{'aria-expanded'?: boolean; 'aria-haspopup'?: 'menu'}>; label: string; align?: 'left' | 'right'; className?: string; children: (close: () => void) => ReactNode}) {
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
      {/* The button, already named, says whether its menu is open (axe's aria-allowed-attr, SV-99). */}
      <span onClick={event => setOpen(open ? false : event.detail === 0 ? 'keys' : 'pointer')} role="presentation">{cloneElement(button, {'aria-expanded': !!open, 'aria-haspopup': 'menu'})}</span>
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

/**
 * What a source's state leads with (the polish audit's settings-01, under states-04's tones): a 7 px
 * `good` dot when checked, `history` in `ink3` when checks stopped, `warning` in `caution` when
 * failing, `sync_problem` when it needs sign-in; the shared spinner while Check now runs.
 */
export function HealthGlyph({kind, checking = false}: {kind: HealthKind; checking?: boolean}) {
  if (checking) return <span className="spin hg"><Icon name="progress_activity" size={16} /></span>;
  switch (kind) {
    case 'healthy':
      return <span className="okdot hg" />;
    case 'stale':
      return <Icon name="history" size={16} className="hg stale" />;
    case 'failing':
      return <Icon name="warning" size={16} className="hg caution" />;
    case 'needs_reconnect':
      return <Icon name="sync_problem" size={16} className="hg caution" />;
    case null:
      return null;
  }
}

/**
 * A line under a section saying how a change went: its refusal, or what happened. A failure leads
 * with `error` in `alert`, and a test that worked with `check` in `good` (the polish audit's states-11).
 */
export function Line({text, tone}: {text: string | null; tone?: LineTone}) {
  if (!text) return null;
  return (
    <p className={tone ? `line ${tone}` : 'line'} role={tone === 'failed' || tone === 'caution' ? 'alert' : 'status'}>
      {tone === 'failed' && <Icon name="error" size={16} />}
      {tone === 'done' && <Icon name="check" size={16} />}
      {text}
    </p>
  );
}

export type LineTone = 'failed' | 'caution' | 'done';

/** A moment that shows for `ms`, then goes (a test sent, a field saved); `flash` starts it again. */
export function useFlash(ms: number): [boolean, () => void] {
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => {
    if (at === null) return;
    const timer = window.setTimeout(() => setAt(null), ms);
    return () => window.clearTimeout(timer);
  }, [at, ms]);
  return [at !== null, () => setAt(Date.now())];
}

/** A change's state for its line: runs `send`, keeping its refusal's words; `done` words what happened. */
export function useAttempt() {
  const [line, setLine] = useState<{text: string; tone?: 'failed' | 'done'} | null>(null);
  const [busy, setBusy] = useState(false);
  async function attempt<T>(send: () => Promise<T>, done?: (value: T) => string | {text: string; tone: 'done'} | null): Promise<T | undefined> {
    setBusy(true);
    setLine(null);
    try {
      const value = await send();
      const said = done?.(value) ?? null;
      setLine(typeof said === 'string' ? {text: said} : said);
      return value;
    } catch (error) {
      setLine({text: error instanceof Error ? error.message : 'Something went wrong.', tone: 'failed'});
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  // Stable, for an effect's answer to say what happened ("Paired iPhone 17 Pro").
  const say = useCallback((text: string) => setLine({text}), []);
  return {line, busy, attempt, clear: () => setLine(null), say};
}

const TITLES = [150, 186, 132, 210, 168, 120];
const TOPS = [110, 140, 96, 128, 150, 118];
const LINES = [230, 190, 214, 170, 250, 204];

/**
 * A group's rows while its answers load (states-01, settings-05), in place of what the page would
 * otherwise say for nothing ("Not connected", "No rules yet"): `count` rows of `sub3` bars, a title
 * over its line (one line with `one`), and the control's place at the end; `tile` leads each with
 * the 30 px icon tile (Accounts, News).
 */
export function SkeletonRows({count, tile = false, one = false}: {count: number; tile?: boolean; one?: boolean}) {
  return (
    <Sk kind="settings" className="sk-set-group on-sub">
      {Array.from({length: count}, (_, index) => (
        <div className={one ? 'sk-set one' : 'sk-set'} key={index}>
          {tile && <span className="sk-tile" />}
          {one ? <><Bar w={TITLES[index % TITLES.length]!} /><Bar w={70} style={{opacity: 0.6}} /></> : (
            <span className="lines"><Bar w={TOPS[index % TOPS.length]!} /><Bar w={LINES[index % LINES.length]!} h={8} style={{opacity: 0.6}} /></span>
          )}
          <Bar w={84} h={8} style={{marginLeft: 'auto'}} />
        </div>
      ))}
    </Sk>
  );
}

/** A section whose label comes with its answer (News's sections) while it loads. */
export const SkeletonLabel = () => <Sk kind="settings-label" className="sk-label"><Bar w={44} h={8} /></Sk>;
