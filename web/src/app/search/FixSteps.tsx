// The fixes Alfred proposes to a registered module's records (Jobs' merge, a Needs you item
// assigned), one at a time: an answer's fixes are steps, and one chip shows the step you're on, "Fix
// · 2 of 4", with ‹ and › to look back and forward through them and a dot for each (applied in
// `good`, skipped dim, the one shown ringed). The chip holds the fix's line, the emails it rests on
// (rows that open in the reading pane, as the answer's sources do), and Apply and Skip. Apply posts
// the module's own route as the proposal names it and says what it did in the usual toast with
// Undo. Either moves on to the next step not yet applied or skipped; with none left it stays. An
// applied step, looked back at, says Applied with its Undo, which puts it back to Apply and takes
// its toast away, so no stale Undo stays; a skipped one keeps Apply. A refusal (the item answered
// already, an application merged away by an earlier fix) stays in the chip with the module's words.
// The chip keeps one height, its tallest step's, so ‹ › don't move as the steps change.
// Applied and undone are recorded (`onActed`), and the step shown is told (`onShown`), so a
// follow-up says which fix "this" is. Read back after a reload, an applied step says so without
// Undo, whose token was this page's, and skips aren't kept. It works the same on the phone.
import type {FixProposalOut} from '@setpoint/shared';
import {useEffect, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {applyFix, undoFix} from '../../api/search.ts';
import type {FixApplied} from '../../api/search.ts';
import {Icon} from '../../ui/Icon.tsx';
import {usePhone} from '../Phone.tsx';
import {dismissToast, failureLine, showToast, toastFailure} from '../toast.ts';

// A step: still to do, skipped, or applied (here, with its route's answer for Undo; before a reload, true).
type Step = {state: 'open'} | {state: 'skipped'} | {state: 'applied'; answer: FixApplied | true};

const STATE_WORDS = {open: '', skipped: ', skipped', applied: ', applied'} as const;

/** The step after `from` still to do, wrapping round, or `from` itself with none. */
function nextOpen(steps: Step[], from: number): number {
  for (let step = 1; step < steps.length; step += 1) {
    const at = (from + step) % steps.length;
    if (steps[at]!.state === 'open') return at;
  }
  return from;
}

export function FixSteps({fixes, evidence, onActed, onShown}: {
  fixes: FixProposalOut[];
  // A fix's evidence rows, drawn as the answer draws its sources.
  evidence: (fix: FixProposalOut) => ReactNode;
  onActed?: (index: number, acted: boolean) => void;
  // The step shown, whenever it changes (and as it first shows).
  onShown?: (index: number) => void;
}) {
  const phone = usePhone();
  const [steps, setSteps] = useState<Step[]>(() => fixes.map(fix => (fix.acted ? {state: 'applied', answer: true} : {state: 'open'})));
  // The step shown: at first the first still to do.
  const [at, setAt] = useState(() => Math.max(0, fixes.findIndex(fix => !fix.acted)));
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // The toasts Apply showed, by step, taken away when that step's Undo runs.
  const toasts = useRef(new Map<number, number>());
  const shownRef = useRef(onShown);
  useEffect(() => {
    shownRef.current = onShown;
  });
  useEffect(() => shownRef.current?.(at), [at]);

  const go = (index: number) => {
    setAt(index);
    setFailed(null);
  };
  const withStep = (index: number, step: Step) => steps.map((one, place) => (place === index ? step : one));

  async function undo(index: number, answer: FixApplied) {
    const toast = toasts.current.get(index);
    if (toast !== undefined) dismissToast(toast);
    toasts.current.delete(index);
    try {
      await undoFix(fixes[index]!, answer);
    } catch (error) {
      toastFailure('Failed to undo')(error);
      return;
    }
    setSteps(current => current.map((one, place) => (place === index ? {state: 'open'} : one)));
    go(index);
    onActed?.(index, false);
  }

  async function apply(index: number) {
    if (pending) return;
    const fix = fixes[index]!;
    setPending(true);
    setFailed(null);
    try {
      const answer = await applyFix(fix);
      const next = withStep(index, {state: 'applied', answer});
      setSteps(next);
      go(nextOpen(next, index));
      onActed?.(index, true);
      const canUndo = fix.undo !== null && answer.undo !== undefined;
      toasts.current.set(index, showToast(fix.done, canUndo ? {label: 'Undo', run: () => void undo(index, answer)} : null));
    } catch (error) {
      setFailed(failureLine(fix.failed, error));
    }
    setPending(false);
  }

  const skip = (index: number) => {
    const next = withStep(index, {state: 'skipped'});
    setSteps(next);
    go(nextOpen(next, index));
  };

  const step = steps[at]!;
  const several = fixes.length > 1;
  return (
    <section className={`prop in-answer chip-prop fix-prop${phone ? ' ph-prop' : ''}${pending ? ' pending' : ''}${step.state === 'applied' ? ' applied' : ''}`}
      aria-label={`Proposal: fix ${at + 1} of ${fixes.length}${STATE_WORDS[step.state]}`} data-step={at}>
      <div className="card-h">
        <Icon name="edit_note" size={16} />
        <span className="card-title">Fix</span>
        {several && <span className="card-sub num">· {at + 1} of {fixes.length}</span>}
        <span className="grow" />
        {several && (
          <>
            <span className="fix-dots" aria-hidden="true">
              {steps.map((one, index) => <span key={index} className={`dot ${one.state}${index === at ? ' here' : ''}`} />)}
            </span>
            <button type="button" className="ibtn sm" aria-label="Previous fix" disabled={at === 0 || pending} onClick={() => go(at - 1)}><Icon name="chevron_left" size={16} /></button>
            <button type="button" className="ibtn sm" aria-label="Next fix" disabled={at === fixes.length - 1 || pending} onClick={() => go(at + 1)}><Icon name="chevron_right" size={16} /></button>
          </>
        )}
      </div>
      {/* Every step is laid out in one cell, only the one shown visible, so the chip is as tall as its
          tallest step and ‹ › stay where they are while looking through them. */}
      <div className="card-b fix-stack">
        {fixes.map((one, index) => {
          const here = index === at;
          const state = steps[index]!;
          const rows = evidence(one);
          return (
            <div key={index} className={here ? 'fix-page' : 'fix-page off'} inert={!here} aria-hidden={!here}>
              <div className="chip-what">{one.line}</div>
              {rows && <div className="srcs fix-evidence">{rows}</div>}
              {here && failed && <div className="failed-line"><Icon name="error" size={16} />{failed}</div>}
              <div className="chip-acts">
                {state.state === 'applied' ? (
                  <>
                    <span className="fix-done"><Icon name="check" size={16} />Applied</span>
                    {state.answer !== true && one.undo !== null && state.answer.undo !== undefined && (
                      <button type="button" className="btn quiet" onClick={() => void undo(index, state.answer as FixApplied)}>Undo</button>
                    )}
                  </>
                ) : (
                  <>
                    <button type="button" className="btn" disabled={pending} onClick={() => void apply(index)}>
                      {here && pending && <span className="spin"><Icon name="progress_activity" size={16} /></span>}Apply
                    </button>
                    {state.state === 'open' && <button type="button" className="btn quiet" disabled={pending} onClick={() => skip(index)}>Skip</button>}
                    {state.state === 'skipped' && <span className="fix-done">Skipped</span>}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
