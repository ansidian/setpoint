// Settings › Accounts (board 17): Connect Gmail and Connect iCloud; each mail account with its drag
// handle (order; ↑ ↓ on the handle too), colour from darma's 11 swatches, icon, label, address, how
// it syncs and its state, Reconnect when it needs sign-in; then the sources (Google Calendar,
// Todoist, Weather) the same way; then attention precision with its 30-day sparkline.
import type {AccountOut, CalendarOut, PrecisionOut, Settings, SourceOut, TodoistProjectOut} from '@setpoint/shared';
import {SWATCH_COLOURS} from '@setpoint/shared';
import {useEffect, useState} from 'react';
import type {FormEvent} from 'react';
import {timeZone} from '../../api/auth.ts';
import {refresh, useResource} from '../../api/client.ts';
import {CALENDARS_PATH, SETTINGS_PATH, TODOIST_PROJECTS_PATH} from '../../api/items.ts';
import {ACCOUNTS_PATH} from '../../api/mail.ts';
import {authorizeGmail, checkSource, connectIcloud, PRECISION_PATH, reorderAccounts, SOURCES_PATH, updateAccount} from '../../api/settings.ts';
import {sourceState, syncLine} from '../../logic/health.ts';
import type {SourceState} from '../../logic/health.ts';
import {mergeSources, moved, precisionText, sparkPath, sparkTitle} from '../../logic/settings.ts';
import type {IconName} from '../../ui/glyphs.ts';
import {Icon} from '../../ui/Icon.tsx';
import {dotStyle} from '../accounts.ts';
import {useNow} from '../clock.ts';
import {failureLine, toastFailure} from '../toast.ts';
import {useLiveOrder} from './order.ts';
import type {DragProps} from './order.ts';
import {escapeCancels, HealthGlyph, Line, Menu, Page, Section, useAttempt} from './parts.tsx';

const ACCOUNT_ICONS: IconName[] = ['storefront', 'person', 'work', 'badge', 'cloud', 'mail', 'inbox', 'computer', 'group', 'lock'];
const SOURCE_ICONS: Record<string, IconName> = {google_calendar: 'calendar_month', todoist: 'task_alt', weather: 'partly_cloudy_day'};

export function AccountsPage() {
  const {data: accounts} = useResource<AccountOut[]>(ACCOUNTS_PATH);
  const {data: sources} = useResource<SourceOut[]>(SOURCES_PATH);
  const {data: precision} = useResource<PrecisionOut>(PRECISION_PATH);
  const {data: calendars} = useResource<CalendarOut[]>(CALENDARS_PATH);
  const {data: projects} = useResource<TodoistProjectOut[]>(TODOIST_PROJECTS_PATH);
  const {data: settings} = useResource<Settings>(SETTINGS_PATH);
  const now = useNow();
  const connect = useAttempt();
  // The iCloud form: a new account, or an account's new app password (Reconnect).
  const [icloud, setIcloud] = useState<{address: string} | null>(null);

  const list = [...accounts ?? []].sort((a, b) => a.position - b.position);
  const mailSource = (account: AccountOut) => sources?.find(source => source.id === account.source_id);
  const gmail = (accountId?: number) => void connect.attempt(() => authorizeGmail(accountId), ({url}) => {
    window.location.assign(url);
    return null;
  });
  const reconnect = (account: AccountOut) => (account.provider === 'gmail' ? gmail(account.id) : setIcloud({address: account.address}));

  const google = mergeSources(sources?.filter(source => source.provider === 'google_calendar') ?? []);
  const todoist = sources?.find(source => source.provider === 'todoist');
  const weather = sources?.find(source => source.provider === 'weather');
  const defaultProject = projects?.find(project => project.name === settings?.todoist.default_project) ?? projects?.find(project => project.inbox);
  const shownPrecision = precisionText(precision);
  const order = useLiveOrder(list, 'text/x-setpoint-account', ids => void reorderAccounts(ids).catch(toastFailure('Couldn\'t reorder accounts')));

  return (
    <Page title="Accounts" actions={(
      <>
        <button className="btn out sm" type="button" disabled={connect.busy} onClick={() => gmail()}><Icon name="add" size={17} />Connect Gmail</button>
        <button className="btn out sm" type="button" onClick={() => setIcloud(icloud ? null : {address: ''})}><Icon name="add" size={17} />Connect iCloud</button>
      </>
    )}>
      {icloud && <IcloudForm address={icloud.address} onDone={() => setIcloud(null)} />}
      <Section label="Mail">
        <div {...order.groupProps}>
          {list.map((account, index) => (
            <AccountRow key={account.id} account={account} source={mailSource(account)} now={now} drag={order.rowProps(account, index)}
              onMove={delta => {
                const next = moved(list, index, delta);
                if (next !== list) void reorderAccounts(next.map(one => one.id)).catch(toastFailure('Couldn\'t reorder accounts'));
              }}
              onReconnect={() => reconnect(account)} />
          ))}
        </div>
        <Line text={connect.line?.text ?? null} tone={connect.line?.tone} />
      </Section>
      {(google || todoist || weather) && (
        <Section label="Sources" style={{marginTop: 18}}>
          <div className="set-group">
            {google && <SourceRow source={google} name="Google Calendar" sub={calendars?.filter(calendar => calendar.provider === 'google').map(calendar => calendar.name).join(' · ') ?? ''} now={now} />}
            {todoist && <SourceRow source={todoist} name="Todoist" sub={projects ? `${defaultProject?.name ?? 'No default project'} · ${projects.length} project${projects.length === 1 ? '' : 's'}` : ''} now={now} />}
            {weather && <SourceRow source={weather} name="Weather" sub={settings?.calendar.home?.label ?? 'No home set'} now={now} />}
          </div>
        </Section>
      )}
      <Section style={{marginTop: 18}}>
        <div className="set-group precision">
          <span className="big num">{shownPrecision.value}</span>
          <div className="lines grow">
            <span className="t">Attention precision</span>
            <span className="s">{shownPrecision.line}</span>
          </div>
          {precision?.precision != null && <Sparkline days={precision.days} />}
        </div>
      </Section>
    </Page>
  );
}

const SPARK = {width: 180, height: 32, low: 0.5};

/**
 * The 30 days as a line in `good` on a fixed 50–100% scale, the area under it at 14%, the latest
 * day's point ringed in the modal's colour, and a dashed reference at 80%; a day with nothing Done
 * breaks the line. Each day's column names it on hover: "Tue, Oct 6 · 9 of 11 opened first".
 */
function Sparkline({days}: {days: PrecisionOut['days']}) {
  const spark = sparkPath(days, SPARK);
  return (
    <svg className="spark" width={SPARK.width} height={SPARK.height} viewBox={`0 0 ${SPARK.width} ${SPARK.height}`} role="img" aria-label="Attention precision, last 30 days">
      <line className="ref" x1={0} x2={SPARK.width} y1={spark.reference} y2={spark.reference} />
      {spark.area && <path className="area" d={spark.area} />}
      {spark.line && <path className="line" d={spark.line} />}
      {spark.end && <circle className="end" cx={spark.end.x} cy={spark.end.y} r={3} />}
      {days.map((day, index) => (
        <rect key={day.date} className="day" x={spark.columns[index]!.x} y={0} width={spark.columns[index]!.width} height={SPARK.height}><title>{sparkTitle(day)}</title></rect>
      ))}
    </svg>
  );
}

function AccountRow({account, source, now, drag: {dragging, ...drag}, onMove, onReconnect}: {
  account: AccountOut;
  source: SourceOut | undefined;
  now: number;
  drag: DragProps;
  onMove: (delta: 1 | -1) => void;
  onReconnect: () => void;
}) {
  const state = sourceState(account.health, now, timeZone());
  const [renaming, setRenaming] = useState(false);
  const rename = useAttempt();
  const check = useCheckNow(source);
  return (
    <div className={['set-row', warnRow(state) && 'warn', dragging && 'dragging'].filter(Boolean).join(' ')} data-account={account.id}
      draggable={!renaming} {...drag}>
      <button className="handle" type="button" aria-label={`Move ${account.label}`} onKeyDown={event => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        onMove(event.key === 'ArrowUp' ? -1 : 1);
      }}><Icon name="drag_indicator" /></button>
      <Menu label={`${account.label} colour`} align="left" button={<button className="sw" type="button" style={dotStyle(account.colour)} aria-label={`${account.label} colour`} />}>
        {close => (
          <div className="swatches">
            {SWATCH_COLOURS.map(colour => (
              <button key={colour} type="button" className={colour === account.colour ? 'sw on' : 'sw'} style={dotStyle(colour)} aria-label={colour} onClick={() => {
                close();
                void updateAccount(account.id, {colour}).catch(toastFailure(`Couldn't change ${account.label}'s colour`));
              }} />
            ))}
          </div>
        )}
      </Menu>
      <span className="aico"><Icon name={account.icon as IconName} size={16} /></span>
      {renaming ? (
        <form className="lines grow" onSubmit={(event: FormEvent) => {
          event.preventDefault();
          const label = new FormData(event.currentTarget as HTMLFormElement).get('label')?.toString().trim() ?? '';
          if (!label || label === account.label) return setRenaming(false);
          void rename.attempt(() => updateAccount(account.id, {label})).then(done => done && setRenaming(false));
        }}>
          <input className="fld" name="label" defaultValue={account.label} aria-label="Label" autoFocus maxLength={40} onKeyDown={event => {
            if (event.key !== 'Escape') return;
            event.stopPropagation();
            setRenaming(false);
          }} />
          {rename.line && <span className="s" style={{color: 'var(--alert)'}}>{rename.line.text}</span>}
        </form>
      ) : (
        <div className="lines grow"><span className="t">{account.label}</span><span className="s selectable ell">{account.address}</span></div>
      )}
      <span className="prov">{source ? syncLine(source, timeZone()) : account.provider === 'gmail' ? 'Gmail' : 'iCloud'}</span>
      <span className={stateClass(state, check.failed)} title={check.text ?? account.health.reason ?? undefined}>
        <HealthGlyph kind={check.failed ? 'failing' : state.kind} checking={check.checking} />
        <span className="num ell">{check.text ?? state.text}</span>
        {state.reconnect && <button className="btn sm" type="button" style={{marginLeft: 4}} onClick={onReconnect}>Reconnect</button>}
      </span>
      <Menu label={`${account.label} options`} button={<button className="ibtn sm" type="button" aria-label={`${account.label} options`}><Icon name="more_horiz" /></button>}>
        {close => (
          <>
            <button className="menu-i" type="button" role="menuitem" onClick={() => {
              close();
              setRenaming(true);
            }}><Icon name="edit" size={16} />Rename</button>
            {source && <button className="menu-i" type="button" role="menuitem" onClick={() => {
              close();
              check.run();
            }}><Icon name="refresh" size={16} />Check now</button>}
            <button className="menu-i" type="button" role="menuitem" onClick={() => {
              close();
              onReconnect();
            }}><Icon name="sync_problem" size={16} />Reconnect</button>
            <div className="icons" role="group" aria-label="Icon">
              {ACCOUNT_ICONS.map(icon => (
                <button key={icon} type="button" className={icon === account.icon ? 'on' : undefined} aria-label={`Icon ${icon}`} onClick={() => {
                  close();
                  void updateAccount(account.id, {icon}).catch(toastFailure(`Couldn't change ${account.label}'s icon`));
                }}><Icon name={icon} size={16} /></button>
              ))}
            </div>
          </>
        )}
      </Menu>
    </div>
  );
}

/**
 * Check now on a row (SV-25, D54): its state reads "Checking…" from the click until the source's
 * health moves on, asking again each second for up to 15 s, or why the check couldn't start.
 */
function useCheckNow(source: SourceOut | undefined) {
  const [check, setCheck] = useState<{from: string} | {failed: string} | null>(null);
  const health = JSON.stringify(source?.health ?? null);
  const checking = check !== null && 'from' in check && check.from === health;
  useEffect(() => {
    if (!checking) return;
    // The server sends a health event only when a state changes, so a check that stays healthy is asked after.
    const poll = window.setInterval(() => void refresh(SOURCES_PATH), 1000);
    const stop = window.setTimeout(() => setCheck(null), 15_000);
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(stop);
    };
  }, [checking]);
  const failed = check !== null && 'failed' in check ? check.failed : null;
  return {
    text: checking ? 'Checking…' : failed,
    checking,
    failed: failed !== null,
    run: () => {
      if (!source) return;
      setCheck({from: health});
      void checkSource(source.id).catch((error: unknown) => setCheck({failed: failureLine('Couldn\'t check', error)}));
    },
  };
}

/** A row in trouble, failing or needing sign-in, takes `caution` at 7%, as Settings › News's failing rows do (states-04). */
const warnRow = (state: SourceState) => state.kind === 'failing' || state.kind === 'needs_reconnect';
/** Its state's words: `caution` in trouble, `ink2` once checks stopped, under an `ink3` glyph (settings-01). */
const stateClass = (state: SourceState, checkFailed: boolean) => (state.tone === 'caution' || checkFailed ? 'state caution' : state.kind === 'stale' ? 'state stale' : 'state');

function SourceRow({source, name, sub, now}: {source: SourceOut; name: string; sub: string; now: number}) {
  const state = sourceState(source.health, now, timeZone());
  const check = useCheckNow(source);
  return (
    <div className={warnRow(state) ? 'set-row warn' : 'set-row'} data-source={source.provider}>
      <span className="aico"><Icon name={SOURCE_ICONS[source.provider] ?? 'sync_problem'} size={16} /></span>
      <div className="lines grow"><span className="t">{name}</span><span className="s ell">{sub}</span></div>
      <span className="prov">{syncLine(source, timeZone())}</span>
      <span className={stateClass(state, check.failed)} title={check.text ?? source.health.reason ?? undefined}>
        <HealthGlyph kind={check.failed ? 'failing' : state.kind} checking={check.checking} />
        <span className="num ell">{check.text ?? state.text}</span>
      </span>
      <Menu label={`${name} options`} button={<button className="ibtn sm" type="button" aria-label={`${name} options`}><Icon name="more_horiz" /></button>}>
        {close => (
          <button className="menu-i" type="button" role="menuitem" onClick={() => {
            close();
            check.run();
          }}><Icon name="refresh" size={16} />Check now</button>
        )}
      </Menu>
    </div>
  );
}

/** Connect iCloud with an app-specific password (appleid.apple.com › App-Specific Passwords). */
function IcloudForm({address, onDone}: {address: string; onDone: () => void}) {
  const send = useAttempt();
  return (
    <Section label="Connect iCloud">
      <form className="set-group" onKeyDown={escapeCancels(onDone)} onSubmit={event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const label = form.get('label')?.toString().trim();
        void send.attempt(() => connectIcloud({
          address: form.get('address')?.toString().trim() ?? '', app_password: form.get('password')?.toString() ?? '', ...(label ? {label} : {}),
        })).then(account => account && onDone());
      }}>
        <div className="set-row form">
          <input className="fld grow" name="address" type="email" required defaultValue={address} placeholder="iCloud address" aria-label="iCloud address" autoFocus={!address} />
          <input className="fld" name="password" type="password" required placeholder="App-specific password" aria-label="App-specific password" autoComplete="off" autoFocus={!!address} />
          {!address && <input className="fld" name="label" placeholder="Label" aria-label="Label" maxLength={40} style={{width: 120}} />}
          <button className="btn sm" type="submit" disabled={send.busy}>Connect</button>
          <button className="btn quiet sm" type="button" onClick={onDone}>Cancel</button>
        </div>
      </form>
      <Line text={send.line?.text ?? 'From appleid.apple.com › Sign-In and Security › App-Specific Passwords.'} tone={send.line?.tone} />
    </Section>
  );
}
