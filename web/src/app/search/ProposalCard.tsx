// The proposal card (DESIGN.md › Proposal; board 08): an event or task pre-filled from the email, as
// Calendar's editor draws it (SV-208): the parsed line with the email's title in it as words, the
// date and times, place, calendar or project, labels, reminders and repeat, each field the email
// gave marked "from the email", and the conflict line, worked out again as the day and time change.
// Nothing is created until the user presses Create, which sends the draft through the command layer:
// the card waits at .5 until the provider confirms, and a failure stays in the card with the
// provider's words.
import type {CalendarOut, CommandOut, ItemCreateInput, ProposalOut} from '@setpoint/shared';
import {useRef, useState} from 'react';
import {refresh, useResource} from '../../api/client.ts';
import {CALENDARS_PATH, createSettled, TODOIST_PROJECTS_PATH} from '../../api/items.ts';
import {localDate} from '../../logic/format.ts';
import {failedLine} from '../../logic/search.ts';
import {Editor} from '../calendar/Editor.tsx';
import {foldAway} from '../fold.ts';

const NO_ITEMS = () => [];
const nothing = () => {};

export function ProposalCard({proposal, now, timeZone, onClose, inAnswer = false}: {
  proposal: ProposalOut;
  now: number;
  timeZone: string;
  // The reader's card closes through the reader; one in an answer closes itself.
  onClose?: () => void;
  inAnswer?: boolean;
}) {
  const {data: calendars} = useResource<CalendarOut[]>(CALENDARS_PATH);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  if (closed) return null;
  // Closed (Cancel, Esc, Create), it folds away (app/fold.ts).
  const close = () => {
    foldAway(form.current);
    if (onClose) onClose();
    else setClosed(true);
  };

  async function create([input]: ItemCreateInput[]) {
    if (!input || pending) return;
    setPending(true);
    setFailed(null);
    let command: CommandOut | null = null;
    try {
      command = await createSettled(input);
    } catch (error) {
      setFailed((error as Error).message);
    }
    setPending(false);
    if (!command) return;
    if (command.state === 'failed') setFailed(failedLine(command.provider, command.provider_message));
    else {
      if (input.create_project) void refresh(TODOIST_PROJECTS_PATH);
      // The card closing is the answer: a create says nothing (DESIGN #247).
      close();
    }
  }

  return (
    <Editor open={{kind: proposal.kind, date: localDate(now, timeZone)}} calendars={calendars} today={localDate(now, timeZone)} timeZone={timeZone}
      dayItems={NO_ITEMS} handed={false} onPreview={nothing} onCreate={inputs => void create(inputs)} onSave={nothing} onDelete={nothing} onClose={close}
      card={{proposal, pending, failed, quiet: inAnswer, form}} />
  );
}
