// Settings › Security (not drawn; DESIGN.md › Settings' row pattern): the password, how sign-in
// works (a password or a passkey, or both), passkeys and recovery codes (new ones shown once); Sign
// out is the nav's foot. Changes need the password confirmed in the last 10 minutes, so the page
// asks for it first.
import type {AuthMode, SecurityOut} from '@setpoint/shared';
import {MIN_PASSWORD_LENGTH} from '@setpoint/shared';
import {useState} from 'react';
import {timeZone} from '../../api/auth.ts';
import {useResource} from '../../api/client.ts';
import {addPasskey, changePassword, confirmPassword, deletePasskey, regenerateRecoveryCodes, SECURITY_PATH, setAuthMode} from '../../api/settings.ts';
import {readerTime} from '../../logic/format.ts';
import {Icon} from '../../ui/Icon.tsx';
import {useNow} from '../clock.ts';
import {escapeCancels, Line, Page, Row, Section, Select, useAttempt} from './parts.tsx';

const MODES: {value: AuthMode; label: string}[] = [
  {value: 'password_or_passkey', label: 'A password or a passkey'},
  {value: 'password_plus_passkey', label: 'A password and a passkey'},
];

export function SecurityPage() {
  const {data: security} = useResource<SecurityOut>(SECURITY_PATH);
  const now = useNow();
  const zone = timeZone();
  const change = useAttempt();
  const [editing, setEditing] = useState<'password' | 'passkey' | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const when = (at: string) => readerTime(at, now, zone);
  const locked = !security?.recent_password;

  return (
    <Page title="Security">
      {security && locked && <ConfirmPassword />}

      <Section label="Sign-in">
        <div className="set-group">
          {editing === 'password' ? (
            <form className="set-row ctl form" onKeyDown={escapeCancels(() => setEditing(null))} onSubmit={event => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const next = form.get('new')?.toString() ?? '';
              if (next !== form.get('again')?.toString()) return void change.attempt(() => Promise.reject(new Error('The two passwords differ.')));
              void change.attempt(async () => {
                await changePassword(next);
                return true;
              }, () => 'Password changed').then(done => done && setEditing(null));
            }}>
              <span className="t grow">New password</span>
              <input className="fld" name="new" type="password" minLength={MIN_PASSWORD_LENGTH} required autoFocus autoComplete="new-password" placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`} aria-label="New password" />
              <input className="fld" name="again" type="password" required autoComplete="new-password" placeholder="Again" aria-label="New password again" />
              <button className="btn sm" type="submit" disabled={change.busy}>Save</button>
              <button className="btn quiet sm" type="button" onClick={() => setEditing(null)}>Cancel</button>
            </form>
          ) : (
            <Row title="Password" sub={`At least ${MIN_PASSWORD_LENGTH} characters`}>
              <button className="btn out sm" type="button" disabled={locked} onClick={() => setEditing('password')}>Change</button>
            </Row>
          )}
          <Row title="Sign in with" sub={security?.passkeys.length ? 'Both asks for the passkey after the password' : 'Add a passkey to ask for both'} kind="ctl">
            {security && (
              <Select value={security.auth_mode} label="Sign in with" options={MODES}
                onChange={mode => void change.attempt(() => setAuthMode(mode), () => 'Sign-in changed')} />
            )}
          </Row>
        </div>
      </Section>

      <Section label="Passkeys" right={<button className="btn quiet sm" type="button" disabled={locked} onClick={() => setEditing('passkey')}><Icon name="add" size={17} />Add passkey</button>}>
        <div className="set-group">
          {editing === 'passkey' && (
            <form className="set-row ctl form" onKeyDown={escapeCancels(() => setEditing(null))} onSubmit={event => {
              event.preventDefault();
              const label = new FormData(event.currentTarget).get('label')?.toString().trim() ?? '';
              if (!label) return;
              void change.attempt(() => addPasskey(label), () => `Added ${label}`).then(done => done && setEditing(null));
            }}>
              <span className="t grow">Name it</span>
              <input className="fld" name="label" required maxLength={80} autoFocus placeholder="MacBook" aria-label="Passkey name" />
              <button className="btn sm" type="submit" disabled={change.busy}>Add</button>
              <button className="btn quiet sm" type="button" onClick={() => setEditing(null)}>Cancel</button>
            </form>
          )}
          {security?.passkeys.map(passkey => (
            <Row key={passkey.id} title={passkey.label}
              sub={`Added ${when(passkey.created_at)}${passkey.last_used_at ? ` · last used ${when(passkey.last_used_at)}` : ''}${passkey.backed_up ? ' · synced' : ''}`}>
              <button className="btn quiet sm" type="button" disabled={locked} onClick={() => void change.attempt(() => deletePasskey(passkey.id), () => `Removed ${passkey.label}`)}>Remove</button>
            </Row>
          ))}
          {security && !security.passkeys.length && editing !== 'passkey' && (
            <div className="set-row one">
              <span className="set-empty-icon"><Icon name="passkey" size={20} /></span>
              <span className="s set-empty">None yet · <button type="button" disabled={locked} onClick={() => setEditing('passkey')}>Add passkey</button></span>
            </div>
          )}
        </div>
      </Section>

      <Section label="Recovery codes">
        <div className="set-group">
          <Row title="Recovery codes" sub={security?.recovery.generated_at ? `Made ${when(security.recovery.generated_at)} · each works once` : 'Each works once'}>
            <span className="val num">{security ? `${security.recovery.remaining} left` : '—'}</span>
            <button className="btn out sm" type="button" disabled={locked} onClick={() => void change.attempt(regenerateRecoveryCodes).then(made => made && setCodes(made))}>Make new codes</button>
          </Row>
          {codes && (
            <div className="set-row" style={{flexDirection: 'column', alignItems: 'stretch'}}>
              <span className="s">Your new codes, shown once. The old ones no longer work.</span>
              <pre className="codes" aria-label="Recovery codes">{codes.join('\n')}</pre>
            </div>
          )}
        </div>
        <Line text={change.line?.text ?? null} tone={change.line?.tone} />
      </Section>

    </Page>
  );
}

function ConfirmPassword() {
  const send = useAttempt();
  return (
    <Section label="Confirm it's you">
      <form className="set-group" onSubmit={event => {
        event.preventDefault();
        const password = new FormData(event.currentTarget).get('password')?.toString() ?? '';
        if (password) void send.attempt(() => confirmPassword(password));
      }}>
        <div className="set-row ctl form">
          <span className="t grow">Your password, to change these</span>
          <input className="fld" name="password" type="password" required autoFocus autoComplete="current-password" placeholder="Password" aria-label="Password" />
          <button className="btn sm" type="submit" disabled={send.busy}>Confirm</button>
        </div>
      </form>
      <Line text={send.line?.text ?? null} tone={send.line?.tone} />
    </Section>
  );
}
