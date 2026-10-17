// Settings › Security (not drawn; DESIGN.md › Settings' row pattern): the password, how sign-in
// works (a password or a passkey, or both), passkeys, paired iPhones (#250) and recovery codes (new
// ones shown once); Sign out is the nav's foot. Changes need the password confirmed in the last 10
// minutes, so the page asks for it first; revoking an iPhone doesn't, since it only takes access away.
import type {AuthMode, DeviceOut, PairingOut, SecurityOut} from '@setpoint/shared';
import {MIN_PASSWORD_LENGTH} from '@setpoint/shared';
import {useEffect, useMemo, useRef, useState} from 'react';
import {encode} from 'uqr';
import {timeZone} from '../../api/auth.ts';
import {getCached, refresh, useResource} from '../../api/client.ts';
import {
  addPasskey, cancelPairing, changePassword, confirmPassword, deletePasskey, regenerateRecoveryCodes, revokeDevice, SECURITY_PATH, setAuthMode, startPairing,
} from '../../api/settings.ts';
import {readerTime} from '../../logic/format.ts';
import {Icon} from '../../ui/Icon.tsx';
import {CodeCopy, useCountdown} from '../Code.tsx';
import {useNow} from '../clock.ts';
import {escapeCancels, Line, Page, Row, Section, Select, SkeletonRows, useAttempt} from './parts.tsx';

const MODES: {value: AuthMode; label: string}[] = [
  {value: 'password_or_passkey', label: 'A password or a passkey'},
  {value: 'password_plus_passkey', label: 'A password and a passkey'},
];

export function SecurityPage() {
  const securityLoad = {path: SECURITY_PATH, ...useResource<SecurityOut>(SECURITY_PATH)};
  const security = securityLoad.data;
  const now = useNow();
  const zone = timeZone();
  const change = useAttempt();
  const [editing, setEditing] = useState<'password' | 'passkey' | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const when = (at: string) => readerTime(at, now, zone);
  const locked = !security?.recent_password;

  return (
    <Page title="Security" loads={[securityLoad]}>
      {security && locked && <ConfirmPassword />}

      <Section label="Sign-in">
        {/* How sign-in works, the passkeys and the codes left, only once they're known (states-01). */}
        {!security ? <SkeletonRows count={2} /> : <div className="set-group">
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
        </div>}
      </Section>

      <Section label="Passkeys" right={<button className="btn quiet sm" type="button" disabled={locked} onClick={() => setEditing('passkey')}><Icon name="add" size={17} />Add passkey</button>}>
        {!security && editing !== 'passkey' ? <SkeletonRows count={1} /> : <div className="set-group">
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
        </div>}
      </Section>

      <Iphones security={security} locked={locked} change={change} when={when} />

      <Section label="Recovery codes">
        {!security ? <SkeletonRows count={1} /> : <div className="set-group">
          <Row title="Recovery codes" sub={security.recovery.generated_at ? `Made ${when(security.recovery.generated_at)} · each works once` : 'Each works once'}>
            <span className="val num">{security.recovery.remaining} left</span>
            <button className="btn out sm" type="button" disabled={locked} onClick={() => void change.attempt(regenerateRecoveryCodes).then(made => made && setCodes(made))}>Make new codes</button>
          </Row>
          {codes && (
            <div className="set-row" style={{flexDirection: 'column', alignItems: 'stretch'}}>
              <span className="s">Your new codes, shown once. The old ones no longer work.</span>
              <pre className="codes" aria-label="Recovery codes">{codes.join('\n')}</pre>
            </div>
          )}
        </div>}
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

// How often the page asks whether the phone has paired while the QR shows.
const PAIRED_POLL_MS = 2000;

/**
 * Paired iPhones (#250, D276): + Add iPhone opens the QR inside the group, with its link to copy and
 * how long it lasts; once the phone pairs, the panel closes and its row is there. A code doesn't
 * outlive its panel: Cancel, or leaving the page, withdraws it.
 */
function Iphones({security, locked, change, when}: {
  security: SecurityOut | undefined; locked: boolean; change: ReturnType<typeof useAttempt>; when: (at: string) => string;
}) {
  const [pairing, setPairing] = useState<{code: PairingOut; known: Set<number>} | null>(null);
  const live = useRef(false);
  const devices = security?.devices;
  const {say} = change;

  useEffect(() => {
    live.current = pairing !== null;
  }, [pairing]);
  useEffect(() => () => {
    if (live.current) void cancelPairing().catch(() => {});
  }, []);
  // Until a device the list didn't have when the code was made comes back.
  useEffect(() => {
    if (!pairing) return;
    const timer = window.setInterval(() => void refresh(SECURITY_PATH).then(() => {
      const paired = getCached<SecurityOut>(SECURITY_PATH)?.devices.find(device => !pairing.known.has(device.id));
      if (!paired) return;
      setPairing(null);
      say(`Paired ${paired.name}`);
    }), PAIRED_POLL_MS);
    return () => window.clearInterval(timer);
  }, [pairing, say]);

  const add = () => void change.attempt(startPairing).then(code => code && setPairing({code, known: new Set(devices?.map(device => device.id))}));
  const cancel = () => {
    setPairing(null);
    void change.attempt(cancelPairing);
  };

  return (
    <Section label="iPhones" right={<button className="btn quiet sm" type="button" disabled={locked || pairing !== null} onClick={add}><Icon name="add" size={17} />Add iPhone</button>}>
      {!devices && !pairing ? <SkeletonRows count={1} /> : <div className="set-group">
        {pairing && <PairingPanel code={pairing.code} onCancel={cancel} onAgain={add} />}
        {devices?.map((device: DeviceOut) => (
          <Row key={device.id} title={device.name} sub={`Paired ${when(device.paired_at)}${device.last_used_at ? ` · last used ${when(device.last_used_at)}` : ''}`}>
            <button className="btn quiet sm" type="button" onClick={() => void change.attempt(() => revokeDevice(device.id), () => `Revoked ${device.name}`)}>Revoke</button>
          </Row>
        ))}
        {devices && !devices.length && !pairing && (
          <div className="set-row one">
            <span className="set-empty-icon"><Icon name="smartphone" size={20} /></span>
            <span className="s set-empty">None yet · <button type="button" disabled={locked} onClick={add}>Add iPhone</button></span>
          </div>
        )}
      </div>}
    </Section>
  );
}

/** The QR for the iPhone's camera, the same link to copy (the Simulator opens it), and its countdown. */
function PairingPanel({code, onCancel, onAgain}: {code: PairingOut; onCancel: () => void; onAgain: () => void}) {
  const countdown = useCountdown(code.expires_at);
  return (
    <div className="set-row pairing" onKeyDown={escapeCancels(onCancel)}>
      <Qr value={code.link} label="Pairing QR code" expired={countdown.expired} />
      <div className="lines grow">
        <span className="t">Scan with Setpoint on your iPhone</span>
        <span className="pair-link"><code className="topic" title={code.link}>{code.link}</code><CodeCopy value={code.link} /></span>
        {countdown.expired
          ? <span className="s">Expired · <button className="again" type="button" onClick={onAgain}>New code</button></span>
          : <span className={countdown.soon ? 's soon' : 's'}>Works once · {countdown.text}</span>}
      </div>
      <button className="btn quiet sm" type="button" autoFocus onClick={onCancel}>Cancel</button>
    </div>
  );
}

/** A QR code as one SVG path, a module per unit with a four-module quiet zone, on its tile. */
function Qr({value, label, expired}: {value: string; label: string; expired: boolean}) {
  const {path, size} = useMemo(() => {
    const {data, size} = encode(value, {ecc: 'M', border: 4});
    const cells = data.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${x} ${y}h1v1h-1z`] : [])));
    return {path: cells.join(''), size};
  }, [value]);
  return (
    <svg className={expired ? 'qr expired' : 'qr'} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <path d={path} fill="currentColor" />
    </svg>
  );
}
