// Tools a removable module registers with Alfred (Jobs' today, from server.ts), so Alfred never imports
// the module. A registration is read on each question: while `enabled` says no, Alfred's prompt and
// tools are as if it weren't there. Its tools only read, and an answer cites what they gave as the
// module's source kind (job applications, the one kind there is).
import type {AnswerApplicationOut, AskStep} from '@setpoint/shared';
import type {ToolSpec} from '../providers/ai/index.ts';
import type {Store} from '../store.ts';
import type {ToolOutcome} from './tools.ts';

/** What a registered tool may touch: the store, and what the answer may then cite. */
export interface RegisteredToolContext {
  store: Store;
  // Emails the tool named (an application's timeline), which the answer may then cite.
  seen: Set<number>;
  // An application the tool gave, which the answer may then cite by its id.
  cite: (application: AnswerApplicationOut) => void;
}

export interface AlfredRegistration {
  // On for this question (Jobs is on). Read on each question, as the module can be turned off.
  enabled: (store: Store) => boolean;
  // The prompt's words for it: what else Alfred answers about ("their job applications"), the last
  // of what a "couldn't find" searched ("jobs"), and how to use its tools.
  about: string;
  place: string;
  guide: string;
  // A thread's first question asked with an application open: the words naming it.
  openApplication: (id: number) => string;
  tools: ToolSpec[];
  // Runs one of its tools.
  run: (context: RegisteredToolContext, name: string, input: Record<string, unknown>) => ToolOutcome;
  // A tool call as the card's step.
  step: (store: Store, name: string, input: Record<string, unknown> | null) => AskStep | null;
}

/** The registrations on for this question. */
export const enabledRegistrations = (store: Store, registered: AlfredRegistration[] = []) => registered.filter(one => one.enabled(store));
