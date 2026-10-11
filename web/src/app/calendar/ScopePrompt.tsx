// Which occurrences of a recurring event a change applies to (DESIGN.md › Recurring events; boards
// 14 and 15b): This event (the default), This and following, All events, each with its consequence,
// then Move, Save or Delete ↵ and Cancel Esc. ↑ ↓ choose while it's open. The editor draws it in
// place of its footer; a drop, a delete or a colour on the grid anchors it to the item (AnchoredCard).
import type {RecurringScope} from '@setpoint/shared';
import {useEffect, useRef} from 'react';
import type {ScopeChoice} from '../../logic/scope.ts';

interface ScopePromptProps {
  title: string;
  // "Gym · Wed, Oct 7 → Thu, Oct 8 · 7:00 AM" on a drop.
  line?: string;
  choices: ScopeChoice[];
  value: RecurringScope;
  action: string;
  small?: boolean;
  onChange: (scope: RecurringScope) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ScopePrompt({title, line, choices, value, action, small = false, onChange, onConfirm, onCancel}: ScopePromptProps) {
  // The latest handlers, for the one key listener.
  const latest = useRef({value, choices, onChange, onConfirm, onCancel});
  useEffect(() => {
    latest.current = {value, choices, onChange, onConfirm, onCancel};
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const {value: now, choices: all, onChange: change, onConfirm: confirm, onCancel: cancel} = latest.current;
      const index = all.findIndex(choice => choice.scope === now);
      let handled = true;
      if (event.key === 'Enter' && !event.isComposing) confirm();
      else if (event.key === 'Escape') cancel();
      else if (event.key === 'ArrowDown') change(all[Math.min(all.length - 1, index + 1)]!.scope);
      else if (event.key === 'ArrowUp') change(all[Math.max(0, index - 1)]!.scope);
      else handled = false;
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    // Capture: the prompt is the topmost thing while it's open.
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <>
      <div className={`scope-title${line ? ' with-line' : ''}`}>{title}</div>
      {line && <div className="ink3 num scope-line">{line}</div>}
      <div role="radiogroup" aria-label="Which events" className="scope-choices">
        {choices.map(choice => (
          <button key={choice.scope} type="button" role="radio" aria-checked={choice.scope === value} className={`ropt${choice.scope === value ? ' on' : ''}`}
            onClick={() => onChange(choice.scope)}>
            <span className="rad" />
            <span className="grow"><span className="ropt-label">{choice.label}</span><span className="ink3 ropt-line">{choice.line}</span></span>
          </button>
        ))}
      </div>
      <div className="scope-acts">
        <button type="button" className={`btn${small ? ' sm' : ''}`} onClick={onConfirm}>{action}<span className="kbd">↵</span></button>
        <button type="button" className={`btn quiet${small ? ' sm' : ''}`} onClick={onCancel}>Cancel<span className="kbd">Esc</span></button>
      </div>
    </>
  );
}
