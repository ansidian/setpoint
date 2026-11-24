// Tools a removable module registers with Alfred (Jobs' today, from server.ts), so Alfred never imports
// the module. A registration is read on each question: while `enabled` says no, Alfred's prompt and
// tools are as if it weren't there. Its tools read, and an answer cites what they gave as the
// module's source kind (job applications, the one kind there is). The tools it names in `proposing`
// propose fixes to its records: each is a chip in the answer that the user applies through the
// module's own route. Alfred never applies one. A proposing call is refused unless it quotes the
// user's own message in `owner_instruction`, and past MAX_FIXES a question.
import type {AnswerApplicationOut, AskStep} from '@setpoint/shared';
import type {StoredFix} from '../db/schema.ts';
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
  // A fix a proposing tool offers. Its evidence keeps only emails this conversation has seen.
  propose: (fix: StoredFix) => void;
}

/** The most fixes one answer proposes. */
export const MAX_FIXES = 5;

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
  // Its tools that propose a fix rather than read (each call one fix).
  proposing?: string[];
  // Runs one of its tools.
  run: (context: RegisteredToolContext, name: string, input: Record<string, unknown>) => ToolOutcome;
  // A tool call as the card's step.
  step: (store: Store, name: string, input: Record<string, unknown> | null) => AskStep | null;
}

/** The registrations on for this question. */
export const enabledRegistrations = (store: Store, registered: AlfredRegistration[] = []) => registered.filter(one => one.enabled(store));
