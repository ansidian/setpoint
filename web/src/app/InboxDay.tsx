// The Inbox's pane with nothing open (SV-218, D465, DESIGN.md #331): how the mail day is going, as one
// block centred in the pane. Trouble first, only when there is some, each with its fix; the mark; what
// needs the user ("3 need you, 1 overdue", or All caught up); today's strip (Done, and what triage
// sorted to FYI and to Noise); and, in the foot over the keys, the quiet facts in `ink3` (EmptyPane).
import type {MailDayOut, TriageStatusOut} from '@setpoint/shared';
import {timeZone} from '../api/auth.ts';
import {useResource} from '../api/client.ts';
import {DAY_PATH, TRIAGE_PATH} from '../api/mail.ts';
import {reconnectLine, triageNote} from '../logic/health.ts';
import {keptLine, needLine, todayTiles} from '../logic/mailDay.ts';
import {Icon, Mark} from '../ui/Icon.tsx';
import {useAccounts} from './accounts.ts';
import {useNow} from './clock.ts';
import {EmptyPane} from './EmptyPane.tsx';
import type {PaneKey} from './EmptyPane.tsx';
import {openSettings} from './settings/store.ts';
import {reconnectFrom} from './states/States.tsx';

const KEYS: PaneKey[] = [
  {keys: ['J', 'K'], does: 'Move'},
  {keys: ['Enter'], does: 'Open'},
  {keys: ['U'], does: 'Next unread'},
  {keys: ['H'], does: 'Done'},
  {keys: ['E'], does: 'Trash'},
  {keys: ['P'], does: 'Pin'},
];

export function InboxDay() {
  const {data: day} = useResource<MailDayOut>(DAY_PATH);
  const {data: triage} = useResource<TriageStatusOut>(TRIAGE_PATH);
  const {list} = useAccounts();
  const now = useNow();
  const zone = timeZone();
  const reconnect = reconnectLine(list);
  const triageDown = triageNote(triage, now, zone);
  const need = day ? needLine(day) : null;
  return (
    <EmptyPane label="Inbox pane" keys={KEYS} foot={day && <p className="md-kept num">{keptLine(day, zone)}</p>}>
      <div className="mail-day">
        {(reconnect || triageDown) && (
          <div className="md-trouble">
            {reconnect && (
              <p className="md-fix" role="alert">
                <Icon name="sync_problem" size={16} /><span>{reconnect}</span><span className="sep">·</span>
                <button className="act" type="button" onClick={() => reconnectFrom(list)}>Reconnect</button>
              </p>
            )}
            {triageDown && (
              <p className="md-fix" role="alert">
                <Icon name="warning" size={16} /><span className="num">{triageDown}</span><span className="sep">·</span>
                <button className="act" type="button" onClick={() => openSettings('ai')}>Settings › AI</button>
              </p>
            )}
          </div>
        )}
        <Mark size={40} settle />
        {day && (
          <>
            {need
              ? <p className="md-need num"><Icon name="flag" size={18} /><span>{need.need}{need.overdue && <span className="md-overdue">, {need.overdue}</span>}</span></p>
              : <p className="md-need caught"><Icon name="task_alt" size={18} />All caught up</p>}
            <dl className="md-today" aria-label="Today">
              {todayTiles(day).map(tile => (
                <div key={tile.label} className={tile.lit ? `md-tile ${tile.tone} lit` : `md-tile ${tile.tone}`}>
                  <dt><Icon name={tile.glyph} size={14} />{tile.label}</dt>
                  <dd className="num">{tile.value}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
    </EmptyPane>
  );
}
