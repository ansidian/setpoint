// Settings › Notifications (board 18b): ntfy's state with Send test, its Server and Token, the topics in
// mono with their switches, the reminder defaults, Time to Leave (leaving from Home, set in
// Calendar, with a buffer) and Reconnect alerts (once per source).
import type {NotifyStatusOut, SecretOut, Settings} from '@setpoint/shared';
import {useState} from 'react';
import {timeZone} from '../../api/auth.ts';
import {useResource} from '../../api/client.ts';
import {SETTINGS_PATH} from '../../api/items.ts';
import {NOTIFY_STATUS_PATH, patchSettings, SECRETS_PATH, sendTestNotification} from '../../api/settings.ts';
import {asOf} from '../../logic/health.ts';
import {EVENT_REMINDERS, minutesBefore, TASK_TIMES, taskTime} from '../../logic/settings.ts';
import {Icon} from '../../ui/Icon.tsx';
import {useNow} from '../clock.ts';
import {SecretRow} from './Ai.tsx';
import {Line, Page, Row, Section, Select, Stepper, Switch, useAttempt} from './parts.tsx';
import {openSettings} from './store.ts';

const BUFFER_STEP = 5;
// A reminder default's None in its menu (D49).
const NONE = '';

export function NotificationsPage() {
  const {data: settings} = useResource<Settings>(SETTINGS_PATH);
  const {data: status} = useResource<NotifyStatusOut>(NOTIFY_STATUS_PATH);
  const {data: secrets} = useResource<SecretOut[]>(SECRETS_PATH);
  const now = useNow();
  const save = useAttempt();
  const test = useAttempt();
  if (!settings) return <Page title="Notifications">{null}</Page>;
  const {notifications: ntfy, reminders, time_to_leave: leave} = settings;
  const change = (patch: Parameters<typeof patchSettings>[0]) => void save.attempt(() => patchSettings(patch));

  // What the switches need before they can do anything: a server for ntfy's topics, Home for Time to
  // Leave. Without it a switch shows off and can't be turned on, and says what's missing (UX #13).
  const noServer = !ntfy.ntfy_server;
  const noHome = !settings.calendar.home;
  const state = !status?.configured ? {dot: 'okdot off', text: 'Not set up'}
    : status.last_error ? {dot: 'okdot bad', text: `Failing, ${status.last_error}`}
      : {dot: 'okdot', text: status.last_sent_at ? `Connected · last sent ${asOf(status.last_sent_at, now, timeZone())}` : 'Connected · nothing sent yet'};

  return (
    <Page title="Notifications">
      <Section label="ntfy" right={(
        <>
          <span className="ink2 num" style={{display: 'inline-flex', alignItems: 'center', gap: 7}}><span className={state.dot} />{state.text}</span>
          {!noServer && (
            <button className="btn out sm" type="button" disabled={test.busy} onClick={() => void test.attempt(sendTestNotification, sent => (
              sent.state === 'sent' ? `Sent to ${ntfy.topics.reminders}` : `Not sent, ${sent.error ?? sent.state}`
            ))}><Icon name="send" size={17} />Send test</button>
          )}
        </>
      )} style={{marginTop: 0}}>
        <div className="set-group">
          <Row title="Server" kind="ctl">
            <ServerField key={ntfy.ntfy_server ?? ''} value={ntfy.ntfy_server} onSave={server => change({notifications: {ntfy_server: server}})} />
          </Row>
          <SecretRow name="ntfy_token" title="Token" noun="token" sub="If the server asks for one" secrets={secrets} />
          <Row title={ntfy.topics.reminders} sub={noServer ? 'Set a server first' : 'Reminders · Time to Leave · Reconnect alerts'} mono>
            <Switch on={ntfy.reminders && !noServer} disabled={noServer} label={ntfy.topics.reminders} onChange={on => change({notifications: {reminders: on}})} />
          </Row>
          <Row title={ntfy.topics.mail} sub={noServer ? 'Set a server first' : ntfy.attention_mail ? 'Attention mail' : 'Attention mail · Off for now'} mono>
            <Switch on={ntfy.attention_mail && !noServer} disabled={noServer} label={ntfy.topics.mail} onChange={on => change({notifications: {attention_mail: on}})} />
          </Row>
        </div>
        <Line text={test.line?.text ?? null} tone={test.line?.tone} />
      </Section>

      <Section label="Reminder defaults">
        <div className="set-group">
          <Row title="Events" kind="ctl">
            <Select value={reminders.event_minutes_before ?? NONE} label="Event reminders" onChange={minutes => change({reminders: {event_minutes_before: minutes === NONE ? null : minutes}})}
              options={[{value: NONE, label: 'None'}, ...[...new Set([...EVENT_REMINDERS, reminders.event_minutes_before ?? 0])].sort((a, b) => a - b).map(minutes => ({value: minutes, label: minutesBefore(minutes)}))]} />
          </Row>
          <Row title="Tasks" kind="ctl">
            <Select value={reminders.task_time ?? NONE} label="Task reminders" onChange={time => change({reminders: {task_time: time || null}})}
              options={[{value: NONE, label: 'None'}, ...[...new Set([...TASK_TIMES, reminders.task_time ?? TASK_TIMES[0]!])].sort().map(time => ({value: time, label: taskTime(time)}))]} />
          </Row>
        </div>
      </Section>

      <Section style={{marginTop: 22}}>
        <div className="set-group">
          <Row title="Time to Leave" sub={noHome ? 'Set Home first' : `Live routes from ${settings.calendar.home!.label}`}>
            <Switch on={leave.enabled && !noHome} disabled={noHome} label="Time to Leave" onChange={on => change({time_to_leave: {enabled: on}})} />
          </Row>
          <Row title="Leave from" kind="ctl">
            <button className="btn quiet sm" type="button" style={{paddingRight: 4}} onClick={() => openSettings('calendar')}>
              {settings.calendar.home ? `${settings.calendar.home.label} · set in Calendar` : 'Not set · set in Calendar'}<Icon name="chevron_right" size={16} />
            </button>
          </Row>
          <Row title="Buffer" kind="ctl">
            <Stepper value={`${leave.buffer_minutes} min`} label="Buffer" onStep={delta => {
              const next = Math.min(120, Math.max(0, leave.buffer_minutes + delta * BUFFER_STEP));
              if (next !== leave.buffer_minutes) change({time_to_leave: {buffer_minutes: next}});
            }} />
          </Row>
        </div>
      </Section>

      <Section>
        <div className="set-group">
          <Row title="Reconnect alerts" sub={noServer ? 'Set a server first' : 'Once per source'}>
            <Switch on={ntfy.reconnect_alerts && !noServer} disabled={noServer} label="Reconnect alerts" onChange={on => change({notifications: {reconnect_alerts: on}})} />
          </Row>
        </div>
        <Line text={save.line?.text ?? null} tone={save.line?.tone} />
      </Section>
    </Page>
  );
}

/** ntfy's server: saved on Enter or leaving the field; empty turns ntfy off. */
function ServerField({value, onSave}: {value: string | null; onSave: (server: string | null) => void}) {
  const [text, setText] = useState(value ?? '');
  const save = () => {
    const next = text.trim() || null;
    if (next !== value) onSave(next);
  };
  return (
    <input className="fld url" value={text} placeholder="https://ntfy.example.net" aria-label="ntfy server" spellCheck={false}
      onChange={event => setText(event.target.value)} onBlur={save} onKeyDown={event => event.key === 'Enter' && save()} />
  );
}
