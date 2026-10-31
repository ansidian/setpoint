// An answer or a correction, said in the toast with its Undo (DESIGN.md › Corrections: "each says what
// it did in the toast, with Undo for 6 seconds and #147's glyph", override 36): `check` in `good` for a
// thing done ("JD saved for Lucerne Publishing", "Merged"), `delete` in `ink3` for one taken away
// (Dismiss all, Not an application, Delete). A refusal says what failed and why, its parts joined by
// a comma. Undo puts back exactly what was there (server/src/jobs/undo.ts).
import type {JobsChangeOut} from '@setpoint/shared';
import type {ToastTone} from '../../logic/toast.ts';
import {showToast, toastFailure} from '../toast.ts';
import {undoChange} from './api.ts';

export interface Said {
  // What it did: "Set to Rejected".
  done: string;
  tone?: Extract<ToastTone, 'done' | 'gone'>;
  // What failed, should it: "Couldn't set the status".
  failed: string;
  // After Undo has put things back (an item folding back in, a row coming back).
  undone?: () => void;
}

/** Sends it and says what it did with Undo. A refusal is thrown, for a widget that shows it in place. */
export async function actInPlace(send: () => Promise<JobsChangeOut>, said: Omit<Said, 'failed'>): Promise<JobsChangeOut> {
  const change = await send();
  showToast(said.done, {
    label: 'Undo',
    run: () => void undoChange(change).then(said.undone, toastFailure('Couldn\'t undo it')),
  }, said.tone ?? 'done');
  return change;
}

/** Sends it; says what it did with Undo, or what failed. Answers the change, or null when it was refused. */
export async function act(send: () => Promise<JobsChangeOut>, said: Said): Promise<JobsChangeOut | null> {
  try {
    return await actInPlace(send, said);
  } catch (error) {
    toastFailure(said.failed)(error);
    return null;
  }
}
