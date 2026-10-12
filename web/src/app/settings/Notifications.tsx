// Settings › Notifications (board 18b): ntfy's state with Send test, its Server and Token, the topics in
// mono with their switches, the reminder defaults, Time to Leave (leaving from Home, set in
// Calendar, with a buffer) and Alerts (Reconnect alerts, once per source), every group labelled.
import type {NotifyStatusOut, SecretOut, Settings} from '@setpoint/shared';
import {useState} from 'react';
import {timeZone} from '../../api/auth.ts';
import {useResource} from '../../api/client.ts';
import {SETTINGS_PATH} from '../../api/items.ts';
import {NOTIFY_STATUS_PATH, patchSettings, SECRETS_PATH, sendTestNotification} from '../../api/settings.ts';
import {asOf} from '../../logic/health.ts';
import {EVENT_REMINDERS, minutesBefore, TASK_TIMES, taskTime} from '../../logic/settings.ts';
import {motion} from '../../tokens.ts';
import {Icon} from '../../ui/Icon.tsx';
import {useNow} from '../clock.ts';
import {SecretRow} from './Ai.tsx';
import {Line, Page, Row, Section, Select, SkeletonRows, Stepper, Switch, useAttempt, useFlash} from './parts.tsx';
import {openSettings} from './store.ts';

const BUFFER_STEP = 5;
// How long Send test's check stays after a test went, and the Server field's after a save (settings-07).
const SENT_MS = 2000;
const SAVED_MS = 1500;
// A reminder default's None in its menu (D49).
const NONE = '';

export function NotificationsPage() {
  const settingsLoad = {path: SETTINGS_PATH, ...useResource<Settings>(SETTINGS_PATH)};
  const settings = settingsLoad.data;
  const statusLoad = {path: NOTIFY_STATUS_PATH, ...useResource<NotifyStatusOut>(NOTIFY_STATUS_PATH)};
  const status = statusLoad.data;
  const secretsLoad = {path: SECRETS_PATH, ...useResource<SecretOut[]>(SECRETS_PATH)};
  const secrets = secretsLoad.data;
  const now = useNow();
  const save = useAttempt();
  const test = useAttempt();
  // A test that went: Send test's glyph is `check` in `good` for 2 s (settings-07).
  const [sent, flashSent] = useFlash(SENT_MS);
  // The server saved: a `check` at the field's end, fading in, then out after 1.5 s.
  const [serverSaved, flashServerSaved] = useFlash(SAVED_MS + motion.medium);
  // Until its answers come, its groups' skeleton: nothing said about ntfy that isn't known (states-01).
  if (!settings || !secrets) {
    return (
      <Page title="Notifications" loads={[settingsLoad, statusLoad, secretsLoad]}>
        <Section label="ntfy" style={{marginTop: 0}}><SkeletonRows count={4} /></Section>
        <Section label="Reminder defaults"><SkeletonRows count={2} one /></Section>
        <Section style={{marginTop: 22}}><SkeletonRows count={3} /></Section>
        <Section><SkeletonRows count={1} /></Section>
      </Page>
    );
  }
  const {notifications: ntfy, reminders, time_to_leave: leave} = settings;
  const change = (patch: Parameters<typeof patchSettings>[0]) => void save.attempt(() => patchSettings(patch));

  // What the switches need before they can do anything: a server for ntfy's topics, Home for Time to
  // Leave. Without it a switch shows off and can't be turned on, and says what's missing (UX #13).
  const noServer = !ntfy.ntfy_server;
  const noHome = !settings.calendar.home;
  // ntfy failing is a source struggling: `caution`, as every failing source is (states-04).
  const state = !status ? null : !status.configured ? {dot: 'okdot off', text: 'Not set up'}
    : status.last_error ? {dot: 'okdot warn', text: `Failing, ${status.last_error}`}
      : {dot: 'okdot', text: status.last_sent_at ? `Connected · last sent ${asOf(status.last_sent_at, now, timeZone())}` : 'Connected · nothing sent yet'};
  // Send test answers clearly (states-11, settings-07): anything but sent is a failure, in `alert`.
  const sendTest = () => void test.attempt(sendTestNotification, out => {
    if (out.state !== 'sent') throw new Error(`Not sent, ${out.error ?? out.state}`);
    flashSent();
    return {text: `Sent to ${ntfy.topics.reminders}`, tone: 'done'};
  });

  return (
    <Page title="Notifications" loads={[settingsLoad, statusLoad, secretsLoad]}>
      <Section label="ntfy" right={(
        <>
          {state && <span className="ink2 num" style={{display: 'inline-flex', alignItems: 'center', gap: 7}}><span className={state.dot} />{state.text}</span>}
          {!noServer && (
            <button className="btn out sm send-test" type="button" disabled={test.busy} onClick={sendTest}>
              {/* While it sends, the shared spinner takes the glyph's place, so the button keeps its width. */}
              {test.busy ? <span className="spin"><Icon name="progress_activity" size={17} /></span> : <Icon name={sent ? 'check' : 'send'} size={17} className={sent ? 'sent' : undefined} />}
              Send test
            </button>
          )}
        </>
      )} style={{marginTop: 0}}>
        <div className="set-group">
          <Row title="Server" kind="ctl">
            <span className="fld-at">
              <ServerField key={ntfy.ntfy_server ?? ''} value={ntfy.ntfy_server} onSave={server => void save.attempt(() => patchSettings({notifications: {ntfy_server: server}})).then(saved => saved && flashServerSaved())} />
              {serverSaved && <span className="saved" aria-label="Saved"><Icon name="check" size={16} /></span>}
            </span>
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

      <Section label="Time to Leave">
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

      <Section label="Alerts">
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

/**
 * ntfy's server: saved on Enter or leaving the field; empty turns ntfy off. The field is keyed by the
 * saved server, so the page, not the field a save replaces, shows that it saved.
 */
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
