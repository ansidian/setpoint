// Jobs's pane with nothing open (SV-220, D467, DESIGN.md #336), in the Inbox's and News's shape
// (InboxDay.tsx, NewsDay.tsx): one block centred across the pane, a third of the way down. The mark;
// Recent movement as a neutral band over one row per application, its latest status change newest first
// ("Applied → Rejected": an email that set it, turning Ghosted, a status set by hand; D470), each opening
// its detail, its right-click the table's menu condensed; and in the
// foot over the keys, the quiet line naming what Jobs reads, led by any trouble's chip (EmptyPane, #335).
// No counts (D314), and nothing asks anything of the user (D313).
import type {JobMoveOut, JobsMovementOut} from '@setpoint/shared';
import type {MouseEvent as ReactMouseEvent} from 'react';
import {useResource} from '../../api/client.ts';
import {Icon, Mark} from '../../ui/Icon.tsx';
import {useAccounts} from '../accounts.ts';
import {EmptyPane} from '../EmptyPane.tsx';
import type {PaneKey, PaneTrouble} from '../EmptyPane.tsx';
import {MOVEMENT_PATH} from './api.ts';
import {moveDay, moveSide, movementFoot, titleOf} from './words.ts';

const KEYS: PaneKey[] = [
  {keys: ['J', 'K'], does: 'Move'},
  {keys: ['Enter'], does: 'Open'},
  {keys: ['/'], does: 'Search'},
];

export function JobsDay({trouble, timeZone, today, onOpen, onMenu}: {
  trouble: PaneTrouble[];
  timeZone: string;
  today: string;
  onOpen: (id: number) => void;
  // A row's right-click: the table's row menu, condensed (no JD's two).
  onMenu: (id: number, event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const {data: movement} = useResource<JobsMovementOut>(MOVEMENT_PATH);
  const {byId} = useAccounts();
  const names = movement ? movement.accounts.flatMap(id => byId.get(id)?.label ?? []) : [];
  return (
    <EmptyPane label="Jobs pane" keys={KEYS} trouble={trouble} foot={movement && <p className="md-kept num">{movementFoot(names, movement.since, timeZone)}</p>}>
      <div className="mail-day jobs-day">
        <Mark size={40} settle />
        {movement && movement.moves.length > 0 && (
          <section className="nd-recap" aria-label="Recent movement">
            <p className="md-need nd-away"><Icon name="history" size={18} /><span>Recent movement</span></p>
            <ol className="nd-list">
              {movement.moves.map(move => (
                <li key={move.application_id}>
                  <MoveRow move={move} timeZone={timeZone} today={today} onOpen={() => onOpen(move.application_id)} onMenu={event => onMenu(move.application_id, event)} />
                </li>
              ))}
            </ol>
          </section>
        )}
        {movement && movement.moves.length === 0 && <p className="jd-none"><Icon name="history" size={14} /><span>Nothing has moved yet</span></p>}
      </div>
    </EmptyPane>
  );
}

/** A row: the dot for where it went, the company, "Applied → Rejected" (each in its dot's colour), the day, and the role under them. */
export function MoveRow({move, timeZone, today, onOpen, onMenu}: {
  move: JobMoveOut;
  timeZone: string;
  today: string;
  onOpen: () => void;
  onMenu: (event: ReactMouseEvent<HTMLElement>) => void;
}) {
  const to = moveSide(move.to);
  const from = move.from && moveSide(move.from);
  return (
    <button type="button" className="jd-move" data-application={move.application_id} onClick={onOpen} onContextMenu={onMenu}>
      <i className={`sd ${to.mark}`} />
      <span className="jd-what">
        <span className="co">{move.company}</span>
        <span className="jd-change">
          {from && <><span className={`sl ${from.mark}`}>{from.label}</span><span className="jd-arrow" aria-label="to">→</span></>}
          <span className={`sl ${to.mark}`}>{to.label}</span>
          {move.by_hand && <span className="by" role="img" aria-label="Set by you" data-tip="Set by you"><Icon name="edit" size={14} /></span>}
        </span>
      </span>
      <span className="jd-when num">{moveDay(move.at, timeZone, today)}</span>
      <span className="jd-role">{titleOf(move)}</span>
    </button>
  );
}
