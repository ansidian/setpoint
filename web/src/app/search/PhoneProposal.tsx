// Alfred's proposal on the phone, in his answer inline in search and in his sheet: a compact card in
// place of the desktop's inline editor (ProposalCard.tsx), which doesn't fit the phone. It says what,
// when and where (the calendar, or a task's project), with the conflict line the server worked out,
// and its Add opens the phone's editor sheet filled from the proposal, where Create makes it with the
// toast and Undo, as everywhere on the phone. The card stays in the answer, as the answer does.
import {TODOIST_COLOURS} from '@setpoint/shared';
import type {CalendarOut, ProposalOut, Settings, TodoistProjectOut} from '@setpoint/shared';
import type {CSSProperties} from 'react';
import {timeZone} from '../../api/auth.ts';
import {useResource} from '../../api/client.ts';
import {CALENDARS_PATH, SETTINGS_PATH, TODOIST_PROJECTS_PATH} from '../../api/items.ts';
import {detailWhen} from '../../logic/detail.ts';
import {localDate} from '../../logic/format.ts';
import {proposalHome} from '../../logic/search.ts';
import {Icon} from '../../ui/Icon.tsx';
import {colourVar} from '../accounts.ts';
import {openProposalSheet} from '../phone/EditorSheet.tsx';

export function PhoneProposal({proposal, now}: {proposal: ProposalOut; now: number}) {
  const zone = timeZone();
  const task = proposal.kind === 'task';
  const {data: calendars} = useResource<CalendarOut[]>(CALENDARS_PATH);
  const {data: settings} = useResource<Settings>(task ? SETTINGS_PATH : null);
  const {data: projects} = useResource<TodoistProjectOut[]>(task ? TODOIST_PROJECTS_PATH : null);
  const defaultProject = projects?.find(one => one.name === settings?.todoist.default_project)?.name ?? projects?.find(one => one.inbox)?.name ?? null;
  const home = proposalHome(proposal.item, calendars, defaultProject);
  // An event's calendar colour, a task's Todoist project's (its dot clamped as a ring's is).
  const projectColour = task && home ? projects?.find(one => one.name === home.name)?.colour : undefined;
  const dot = {'--c': projectColour ? TODOIST_COLOURS[projectColour] : colourVar(home?.colour ?? undefined)} as CSSProperties;
  const {conflict} = proposal;
  return (
    <section className="prop in-answer ph-prop" aria-label={task ? 'Proposal: add as task' : 'Proposal: add to calendar'}>
      <div className="card-h">
        <span style={{color: colourVar(home?.colour ?? undefined)}}><Icon name={task ? 'task_alt' : 'event'} size={16} /></span>
        <span className="card-title">Proposal</span>
        {proposal.from_email.length > 0 && <span className="card-sub">· from this email</span>}
      </div>
      <div className="card-b">
        <div className="ph-prop-what">{proposal.item.title}</div>
        <div className="ph-prop-when ink2 num">{detailWhen(proposal.item, zone)}</div>
        {home && (
          <div className="ph-prop-home ink2">
            <span className={task ? 'dot todoist' : 'dot'} style={dot} />
            <span>{home.name}</span>
          </div>
        )}
        {conflict && (
          <div className={conflict.free ? 'conflict free' : 'conflict'}>
            <Icon name={conflict.free ? 'check_circle' : 'layers'} size={16} />{conflict.label}
          </div>
        )}
        <button type="button" className="btn ph-prop-add" onClick={() => openProposalSheet(proposal, localDate(now, zone), zone)}>
          {task ? 'Add as task' : 'Add to calendar'}
        </button>
      </div>
    </section>
  );
}
