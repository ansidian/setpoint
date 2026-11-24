// Alfred's proposal in his answer: a compact chip that says what, when and where (the calendar, or a
// task's project), with the conflict line the server worked out, and Create (or Save) to approve it as
// it stands. Edit opens the full proposal card in its place on the desktop (ProposalCard.tsx), its
// Cancel coming back to the chip, and the editor sheet on the phone. A change to an existing item
// says what it was and, for a recurring event, which of its events change. Create and Save wait in
// the chip until the provider confirms, then it folds away, as the card does; a failure stays in it
// with the provider's words. The reader's Add to calendar keeps the full card. What Alfred set beyond
// the title, day, times and place shows on one muted line under the place (his repeat, reminders and
// Time to Leave), and a change's was-line under it, struck; the calendar he named is its home. A
// Create or Save that goes through, here or after Edit, is recorded (`onActed`), and a chip acted on
// elsewhere (the phone's sheet) is gone (`done`).
import {TODOIST_COLOURS} from '@setpoint/shared';
import type {CalendarOut, CommandOut, ProposalOut, RecurringScope, Settings, TodoistProjectOut} from '@setpoint/shared';
import {useRef, useState} from 'react';
import type {CSSProperties} from 'react';
import {useResource} from '../../api/client.ts';
import {CALENDARS_PATH, createSettled, SETTINGS_PATH, TODOIST_PROJECTS_PATH, updateSettled} from '../../api/items.ts';
import {detailWhen} from '../../logic/detail.ts';
import {createInput, emptyDraft, fromProposal} from '../../logic/editorDraft.ts';
import {localDate} from '../../logic/format.ts';
import {failedLine, proposalHome, proposalSummary} from '../../logic/search.ts';
import {Icon} from '../../ui/Icon.tsx';
import {colourVar} from '../accounts.ts';
import {foldAway} from '../fold.ts';
import {openEditorSheet, openProposalSheet} from '../phone/EditorSheet.tsx';
import {ProposalCard} from './ProposalCard.tsx';

const SCOPE_WORDS: Record<RecurringScope, string> = {this: 'This event only', following: 'This and following events', all: 'All events in the series'};

export function ProposalChip({proposal, now, timeZone, phone = false, done = false, onActed}: {
  proposal: ProposalOut;
  now: number;
  timeZone: string;
  phone?: boolean;
  done?: boolean;
  onActed?: () => void;
}) {
  const task = proposal.kind === 'task';
  const {change} = proposal;
  const {data: calendars} = useResource<CalendarOut[]>(CALENDARS_PATH);
  const {data: settings} = useResource<Settings>(task ? SETTINGS_PATH : null);
  const {data: projects} = useResource<TodoistProjectOut[]>(task ? TODOIST_PROJECTS_PATH : null);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [closed, setClosed] = useState(false);
  const host = useRef<HTMLElement>(null);
  const today = localDate(now, timeZone);
  if (closed || done) return null;
  if (editing && !phone) return <ProposalCard proposal={proposal} now={now} timeZone={timeZone} inAnswer onCancel={() => setEditing(false)} onActed={onActed} />;

  const defaultProject = projects?.find(one => one.name === settings?.todoist.default_project)?.name ?? projects?.find(one => one.inbox)?.name ?? null;
  const home = proposalHome(proposal.item, calendars, defaultProject);
  // An event's calendar colour, a task's Todoist project's (its dot clamped as a ring's is).
  const projectColour = task && home ? projects?.find(one => one.name === home.name)?.colour : undefined;
  const dot = {'--c': projectColour ? TODOIST_COLOURS[projectColour] : colourVar(home?.colour ?? undefined)} as CSSProperties;
  // What Create sends: the card's own draft of the proposal, untouched. An event with no day yet has none, so it's Edit only.
  const todoist = calendars?.find(one => one.provider === 'todoist')?.id ?? null;
  const input = change ? null : createInput(fromProposal(emptyDraft(proposal.kind, today), {proposal, reminders: null, newProject: false}, timeZone), timeZone, todoist);
  const canApprove = Boolean(change) || (input !== null && (!task || todoist !== null));

  async function approve() {
    if (pending || !canApprove) return;
    setPending(true);
    setFailed(null);
    let settled: CommandOut | null = null;
    try {
      settled = change
        ? await updateSettled(change.item.id, {changes: change.changes, scope: change.scope, occurrence_start: change.item.occurrence_start})
        : await createSettled(input!);
    } catch (error) {
      setFailed((error as Error).message);
    }
    setPending(false);
    if (!settled) return;
    if (settled.state === 'failed') setFailed(failedLine(settled.provider, settled.provider_message));
    else {
      // The chip folding away is the answer: an approval says nothing.
      foldAway(host.current);
      setClosed(true);
      onActed?.();
    }
  }
  const edit = () => {
    if (!phone) setEditing(true);
    else if (change) openEditorSheet({kind: proposal.kind, date: today, item: change.item, change, onActed});
    else openProposalSheet(proposal, today, timeZone, onActed);
  };

  const wasTitle = change && change.changes.title !== undefined ? change.item.title : null;
  const wasWhen = change && detailWhen(change.item, timeZone) !== detailWhen(proposal.item, timeZone) ? detailWhen(change.item, timeZone) : null;
  const {conflict} = proposal;
  const summary = proposalSummary(proposal, timeZone);
  // A change of calendar says where it was, struck.
  const wasHome = change && change.changes.calendar_id !== undefined ? proposalHome(change.item, calendars, null)?.name ?? null : null;
  const label = change ? `Proposal: change ${task ? 'task' : 'event'}` : task ? 'Proposal: add as task' : 'Proposal: add to calendar';
  const action = change ? 'Save' : task ? 'Create task' : 'Create event';
  return (
    <section ref={host} className={`prop in-answer chip-prop${phone ? ' ph-prop' : ''}${pending ? ' pending' : ''}`} aria-label={label}>
      <div className="card-h">
        <span style={{color: colourVar(home?.colour ?? undefined)}}><Icon name={task ? 'task_alt' : 'event'} size={16} /></span>
        <span className="card-title">Proposal</span>
        {proposal.from_email.length > 0 && <span className="card-sub">· from this email</span>}
        {change && <span className="card-sub">· a change</span>}
      </div>
      <div className="card-b">
        {/* What it becomes leads; what it was sits under each changed line, quieter and struck. */}
        <div className="chip-what">{proposal.item.title}</div>
        {wasTitle && <div className="chip-was">{wasTitle}</div>}
        <div className="chip-when num">{detailWhen(proposal.item, timeZone)}</div>
        {wasWhen && <div className="chip-was num">{wasWhen}</div>}
        <div className="chip-meta">
          {change && change.item.kind === 'event' && change.item.recurring && <div>{SCOPE_WORDS[change.scope]}</div>}
          {(home || proposal.item.place) && (
            <div className="chip-home">
              {home && <><span className={task ? 'dot todoist' : 'dot'} style={dot} /><span>{home.name}</span></>}
              {proposal.item.place && <span className="chip-place">{home ? '· ' : ''}{proposal.item.place}</span>}
            </div>
          )}
          {wasHome && <div className="chip-was">{wasHome}</div>}
          {summary && <div className="chip-sum">{summary.now}</div>}
          {summary?.was && <div className="chip-was">{summary.was}</div>}
          {conflict && (
            <div className={conflict.free ? 'conflict free' : 'conflict'}>
              <Icon name={conflict.free ? 'check_circle' : 'layers'} size={16} />{conflict.label}
            </div>
          )}
        </div>
        {failed && <div className="failed-line"><Icon name="error" size={16} />{failed}</div>}
        <div className="chip-acts">
          {canApprove && (
            <button type="button" className="btn" disabled={pending} onClick={() => void approve()}>
              {pending && <span className="spin"><Icon name="progress_activity" size={16} /></span>}{action}
            </button>
          )}
          <button type="button" className={canApprove ? 'btn quiet' : 'btn'} disabled={pending} onClick={edit}>Edit</button>
        </div>
      </div>
    </section>
  );
}
