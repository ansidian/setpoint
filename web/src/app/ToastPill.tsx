// The app's one toast (toast.ts holds it), drawn once by App.tsx over every page and above Settings.
import type {CSSProperties} from 'react';
import {Icon} from '../ui/Icon.tsx';
import {dismissToast, holdToast, useToast} from './toast.ts';

const TONE_GLYPHS = {done: 'check', gone: 'delete', failed: 'error', pinned: 'keep'} as const;

/**
 * The one toast, over every page and above Settings; its action runs once, then it goes. Keyed by
 * its id, so one replacing another drops in afresh. It leads with its tone's glyph, and a line with
 * an action shows its time draining as a hairline, both waiting while the pointer rests on it.
 */
export function ToastPill() {
  const toast = useToast();
  if (!toast) return null;
  const {action, tone} = toast;
  const className = ['toast', tone, action && 'timed', toast.held && 'held', toast.leaving && 'leaving'].filter(Boolean).join(' ');
  return (
    <div key={toast.id} className={className} role="status" style={{'--toast-ms': `${toast.ms}ms`} as CSSProperties}
      onPointerEnter={() => holdToast(toast.id, true)} onPointerLeave={() => holdToast(toast.id, false)}>
      {tone && <span className="tone"><Icon name={TONE_GLYPHS[tone]} size={16} /></span>}
      <span>{toast.text}</span>
      {action && <button className="btn ghost sm" type="button" onClick={() => {
        action.run();
        dismissToast(toast.id);
      }}>{action.label}</button>}
    </div>
  );
}
