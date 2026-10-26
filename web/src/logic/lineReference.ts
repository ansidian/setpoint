// SV-114 (D295): "What the line reads", the backup for phrases that should need no learning. Its words
// live in shared/compose/reference.json, beside the parse table, so the iPhone app (setpoint-ios,
// which copies shared/compose/ in with the contract) shows the same ones; web/tests/lineReference.test.ts
// runs each example through the parser and fails when what a row says it reads isn't so.
import data from '@setpoint/shared/compose/reference.json';

export interface ReferenceRow {
  // As typed into the line.
  example: string;
  // The item it's typed into.
  kind: 'event' | 'task';
  // What it reads, in the editor's own words.
  reads: string;
  // The phrase in the example kept as words (a click, ⌥⌫, or the iPhone's tap).
  plain?: string;
}

export interface ReferenceSection {
  title: string;
  rows: ReferenceRow[];
}

export const LINE_REFERENCE = data.sections as ReferenceSection[];
