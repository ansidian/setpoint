// Settings › Accounts (board 17): Connect Gmail and Connect iCloud; each mail account with its drag
// handle (order; ↑ ↓ on the handle too), colour from darma's 11 swatches, icon, label, address, how
// it syncs and its state, Reconnect when it needs sign-in; then the sources (Google Calendar,
// Todoist, Weather) the same way. Todoist's row is its only connection (D514): Connect Todoist while
// it isn't connected, Reconnect in its menu once it is.
import type {AccountOut, CalendarOut, Settings, SourceOut, TodoistProjectOut} from '@setpoint/shared';
import {SWATCH_COLOURS} from '@setpoint/shared';
import {useState} from 'react';
import type {FormEvent} from 'react';
import {timeZone} from '../../api/auth.ts';
import {useResource} from '../../api/client.ts';
import {CALENDARS_PATH, SETTINGS_PATH, TODOIST_PROJECTS_PATH} from '../../api/items.ts';
import {ACCOUNTS_PATH} from '../../api/mail.ts';
import {authorizeGmail, connectIcloud, connectTodoist, reorderAccounts, SOURCES_PATH, updateAccount} from '../../api/settings.ts';
import {sourceState, syncLine} from '../../logic/health.ts';
import type {SourceState} from '../../logic/health.ts';
import {mergeSources, moved, stateTip, todoistConnected} from '../../logic/settings.ts';
import type {IconName} from '../../ui/glyphs.ts';
import {Icon} from '../../ui/Icon.tsx';
import {dotStyle} from '../accounts.ts';
import {useNow} from '../clock.ts';
import {useCheckNow} from '../states/checkNow.ts';
import {toastFailure} from '../toast.ts';
import {useLiveOrder} from './order.ts';
import type {DragProps} from './order.ts';
import {escapeCancels, HealthGlyph, Line, Menu, Page, Prov, Section, SkeletonRows, useAttempt} from './parts.tsx';

const ACCOUNT_ICONS: IconName[] = ['storefront', 'person', 'work', 'badge', 'cloud', 'mail', 'inbox', 'computer', 'group', 'lock'];
const SOURCE_ICONS: Record<string, IconName> = {google_calendar: 'calendar_month', todoist: 'task_alt', weather: 'partly_cloudy_day'};

export function AccountsPage() {
  const accountsLoad = {path: ACCOUNTS_PATH, ...useResource<AccountOut[]>(ACCOUNTS_PATH)};
  const accounts = accountsLoad.data;
  const sourcesLoad = {path: SOURCES_PATH, ...useResource<SourceOut[]>(SOURCES_PATH)};
  const sources = sourcesLoad.data;
  const calendarsLoad = {path: CALENDARS_PATH, ...useResource<CalendarOut[]>(CALENDARS_PATH)};
  const calendars = calendarsLoad.data;
  const projectsLoad = {path: TODOIST_PROJECTS_PATH, ...useResource<TodoistProjectOut[]>(TODOIST_PROJECTS_PATH)};
  const projects = projectsLoad.data;
  const settingsLoad = {path: SETTINGS_PATH, ...useResource<Settings>(SETTINGS_PATH)};
  const settings = settingsLoad.data;
  const now = useNow();
  const connect = useAttempt();
  const todoistConnect = useAttempt();
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
  // Todoist's consent, a new connection or a new token for the one there.
  const authorizeTodoist = () => void todoistConnect.attempt(connectTodoist, ({url}) => {
    window.location.assign(url);
    return null;
  });
  const order = useLiveOrder(list, 'text/x-setpoint-account', ids => void reorderAccounts(ids).catch(toastFailure('Couldn\'t reorder accounts')));

  return (
    <Page title="Accounts" loads={[accountsLoad, sourcesLoad, calendarsLoad, projectsLoad, settingsLoad]} actions={(
      <>
        <button className="btn out sm" type="button" disabled={connect.busy} onClick={() => gmail()}><Icon name="add" size={17} />Connect Gmail</button>
        <button className="btn out sm" type="button" onClick={() => setIcloud(icloud ? null : {address: ''})}><Icon name="add" size={17} />Connect iCloud</button>
      </>
    )}>
      {icloud && <IcloudForm address={icloud.address} onDone={() => setIcloud(null)} />}
      <Section label="Mail">
        {/* Each account's state is said only once it's known (states-01). */}
        {!accounts || !sources ? <SkeletonRows count={5} tile /> : <div {...order.groupProps}>
          {list.map((account, index) => (
            <AccountRow key={account.id} account={account} source={mailSource(account)} now={now} drag={order.rowProps(account, index)}
              onMove={delta => {
                const next = moved(list, index, delta);
                if (next !== list) void reorderAccounts(next.map(one => one.id)).catch(toastFailure('Couldn\'t reorder accounts'));
              }}
              onReconnect={() => reconnect(account)} />
          ))}
        </div>}
        <Line text={connect.line?.text ?? null} tone={connect.line?.tone} />
      </Section>
      {!sources ? (
        <Section label="Sources" style={{marginTop: 18}}><SkeletonRows count={3} tile /></Section>
      ) : (
        <Section label="Sources" style={{marginTop: 18}}>
          <div className="set-group">
            {google && <SourceRow source={google} name="Google Calendar" sub={calendars?.filter(calendar => calendar.provider === 'google').map(calendar => calendar.name).join(' · ') ?? ''} now={now} />}
            {todoist && todoistConnected(sources)
              ? <SourceRow source={todoist} name="Todoist" sub={projects ? `${defaultProject?.name ?? 'No default project'} · ${projects.length} project${projects.length === 1 ? '' : 's'}` : ''} now={now}
                onReconnect={authorizeTodoist} busy={todoistConnect.busy} />
              : <TodoistConnectRow onConnect={authorizeTodoist} busy={todoistConnect.busy} />}
            {weather && <SourceRow source={weather} name="Weather" sub={settings ? settings.calendar.home?.label ?? 'No home set' : ''} now={now} />}
          </div>
          <Line text={todoistConnect.line?.text ?? null} tone={todoistConnect.line?.tone} />
        </Section>
      )}
    </Page>
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
  const check = useCheckNow(source, SOURCES_PATH);
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
        <form className="lines grow cols" onSubmit={(event: FormEvent) => {
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
        <div className="lines grow cols"><span className="t ell" data-tip={account.label} data-tip-quick>{account.label}</span><span className="s selectable ell" data-tip={account.address} data-tip-quick>{account.address}</span></div>
      )}
      <Prov text={source ? syncLine(source, timeZone()) : account.provider === 'gmail' ? 'Gmail' : 'iCloud'} />
      <span className={stateClass(state, check.failed)} data-tip={check.text ?? stateTip(state.text, account.health.reason)} data-tip-quick>
        <HealthGlyph kind={check.failed ? 'failing' : state.kind} checking={check.checking} />
        <span className="num ell">{check.text ?? state.text}</span>
        {state.reconnect && <button className="btn sm" type="button" style={{marginLeft: 4}} onClick={onReconnect}>Reconnect</button>}
      </span>
      <Menu label={`${account.label} options`} button={<button className="ibtn" type="button" aria-label={`${account.label} options`}><Icon name="more_horiz" /></button>}>
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

/** A row in trouble, failing or needing sign-in, takes `caution` at 7%, as Settings › News's failing rows do (states-04). */
const warnRow = (state: SourceState) => state.kind === 'failing' || state.kind === 'needs_reconnect';
/** Its state's words: `caution` in trouble, `ink2` once checks stopped, under an `ink3` glyph (settings-01). */
const stateClass = (state: SourceState, checkFailed: boolean) => (state.tone === 'caution' || checkFailed ? 'state caution' : state.kind === 'stale' ? 'state stale' : 'state');

/** A source's row; one with `onReconnect` (Todoist) offers it in its menu, and by its state when it needs sign-in. */
function SourceRow({source, name, sub, now, onReconnect, busy}: {source: SourceOut; name: string; sub: string; now: number; onReconnect?: () => void; busy?: boolean}) {
  const state = sourceState(source.health, now, timeZone());
  const check = useCheckNow(source, SOURCES_PATH);
  return (
    <div className={warnRow(state) ? 'set-row warn' : 'set-row'} data-source={source.provider}>
      <span className="aico"><Icon name={SOURCE_ICONS[source.provider] ?? 'sync_problem'} size={16} /></span>
      <div className="lines grow cols"><span className="t ell" data-tip={name} data-tip-quick>{name}</span><span className="s ell" data-tip={sub || undefined} data-tip-quick>{sub}</span></div>
      <Prov text={syncLine(source, timeZone())} />
      <span className={stateClass(state, check.failed)} data-tip={check.text ?? stateTip(state.text, source.health.reason)} data-tip-quick>
        <HealthGlyph kind={check.failed ? 'failing' : state.kind} checking={check.checking} />
        <span className="num ell">{check.text ?? state.text}</span>
        {state.reconnect && onReconnect && <button className="btn sm" type="button" style={{marginLeft: 4}} disabled={busy} onClick={onReconnect}>Reconnect</button>}
      </span>
      <Menu label={`${name} options`} button={<button className="ibtn" type="button" aria-label={`${name} options`}><Icon name="more_horiz" /></button>}>
        {close => (
          <>
            <button className="menu-i" type="button" role="menuitem" onClick={() => {
              close();
              check.run();
            }}><Icon name="refresh" size={16} />Check now</button>
            {onReconnect && <button className="menu-i" type="button" role="menuitem" disabled={busy} onClick={() => {
              close();
              onReconnect();
            }}><Icon name="sync_problem" size={16} />Reconnect</button>}
          </>
        )}
      </Menu>
    </div>
  );
}

/**
 * Todoist's row while it isn't connected (D514): what it brings, "Not connected" where the state
 * goes, and Connect Todoist, by the state as an account's Reconnect is and in its menu.
 */
function TodoistConnectRow({onConnect, busy}: {onConnect: () => void; busy: boolean}) {
  return (
    <div className="set-row" data-source="todoist">
      <span className="aico"><Icon name={SOURCE_ICONS.todoist!} size={16} /></span>
      <div className="lines grow cols"><span className="t ell" data-tip="Todoist" data-tip-quick>Todoist</span><span className="s ell" data-tip="Tasks on the calendar" data-tip-quick>Tasks on the calendar</span></div>
      <span className="prov" />
      <span className="state" data-tip="Not connected" data-tip-quick>
        <span className="num ell">Not connected</span>
        <button className="btn sm" type="button" style={{marginLeft: 4}} disabled={busy} onClick={onConnect}>Connect Todoist</button>
      </span>
      <Menu label="Todoist options" button={<button className="ibtn" type="button" aria-label="Todoist options"><Icon name="more_horiz" /></button>}>
        {close => (
          <button className="menu-i" type="button" role="menuitem" disabled={busy} onClick={() => {
            close();
            onConnect();
          }}><Icon name="add" size={16} />Connect Todoist</button>
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
