// Jobs in Settings (J8; DESIGN.md › Jobs in Settings; boards 39a, 39b). Settings' shell and its AI page
// draw these through their wiring lines (server/src/jobs/README.md) and know nothing else of Jobs.
//
// - Settings › Jobs (39a): "62 applications" by the title; the one switch, which turns Jobs on (the
//   history pass starts, and Jobs folds into the sidebar under News) or off; Reads, what Jobs reads in
//   each account as a plain value (#273); and History: the pass's progress or when it finished, and
//   From history's waiting items with Show, which opens Jobs with them unfolded.
// - Settings › AI's Jobs group (39b, D315): its three models by name, not selects (override 26), and
//   this month's spend with no meter (no cap, decision 61); Usage this month's Jobs row in its three
//   parts, whose total the label's takes in.
// - Jobs off's Turn on (38c) opens Settings › Jobs with the switch focused, so turning it on is a
//   choice made where the accounts it reads are listed.
import type {CSSProperties} from 'react';
import type {JobsAiOut, JobsSettingsOut} from '@setpoint/shared';
import {timeZone} from '../../api/auth.ts';
import {useResource} from '../../api/client.ts';
import {dollars} from '../../logic/news.ts';
import {usageLine} from '../../logic/settings.ts';
import {Icon} from '../../ui/Icon.tsx';
import {dotStyle, useAccounts} from '../accounts.ts';
import {useNow} from '../clock.ts';
import {navigate} from '../router.ts';
import {HealthGlyph, Line, Page, Row, Section, SkeletonRows, Switch, useAttempt} from '../settings/parts.tsx';
import {closeSettings, openSettings} from '../settings/store.ts';
import {AI_PATH, SETTINGS_PATH, turnJobs} from './api.ts';
import {
  applicationsCount, fromHistorySetting, historyRuns, historySetting, historyShare, jobsModelWith, jobsUsageParts, READS_WORDS,
} from './words.ts';

/** What Settings loads as it opens, so Settings › Jobs and AI's Jobs group show at once. */
export const JOBS_SETTINGS_PATHS = [SETTINGS_PATH, AI_PATH];

// Set by Turn on: Settings › Jobs focuses its switch once it's drawn.
let focusSwitch = false;

/** Jobs off's Turn on (38c): Settings › Jobs, its switch focused. */
export function openJobsSettings() {
  focusSwitch = true;
  openSettings('jobs');
}

/** The switch's place: focused once, when Turn on asked, after Settings has focused its nav. */
function focusOnce(element: HTMLElement | null) {
  if (!element || !focusSwitch) return;
  focusSwitch = false;
  requestAnimationFrame(() => element.querySelector<HTMLElement>('.switch')?.focus());
}

export function JobsSettingsPage() {
  const load = {path: SETTINGS_PATH, ...useResource<JobsSettingsOut>(SETTINGS_PATH)};
  const settings = load.data;
  const {list: accounts} = useAccounts();
  const now = useNow();
  const turn = useAttempt();
  const reads = new Map(settings?.accounts.map(account => [account.account_id, account.reads]));
  // What it reads first, as it lists them, then the rest in the sidebar's order (39a).
  const listed = settings?.accounts.flatMap(({account_id: id}) => accounts.filter(account => account.id === id)) ?? [];
  const ordered = [...listed, ...accounts.filter(account => !reads.has(account.id))];
  const history = settings?.history;
  const show = () => {
    closeSettings();
    navigate({page: 'jobs', open: null, history: true});
  };
  return (
    <Page title="Jobs" note={settings && applicationsCount(settings.applications)} loads={[load]}>
      <Section>
        {!settings ? <SkeletonRows count={1} /> : (
          <div className="set-group" ref={focusOnce}>
            <Row title="Jobs" sub="Builds applications from their confirmation emails and keeps each JD as it was">
              <Switch on={settings.enabled} label="Jobs" disabled={turn.busy} onChange={on => void turn.attempt(() => turnJobs(on))} />
            </Row>
          </div>
        )}
        <Line text={turn.line?.text ?? null} tone={turn.line?.tone} />
      </Section>

      <Section label="Reads">
        {!settings || !accounts.length ? <SkeletonRows count={5} one /> : (
          <div className="set-group jb-reads">
            {ordered.map(account => (
              <div key={account.id} className="set-row ctl" data-account={account.id}>
                <span className="acc grow"><span className="dot" style={dotStyle(account.colour)} />{account.label}</span>
                <span className="reads">{READS_WORDS[reads.get(account.id) ?? 'off']}</span>
              </div>
            ))}
          </div>
        )}
        <p className="note jb-note">Career mail is what triage sorts as Career. Jobs never changes how mail itself is sorted.</p>
      </Section>

      <Section label="History">
        {!settings || !history ? <SkeletonRows count={2} /> : (
          <div className="set-group">
            <div className={historyRuns(history) ? 'set-row progress' : 'set-row'} style={historyRuns(history) ? {'--done': `${historyShare(history) * 100}%`} as CSSProperties : undefined}>
              <div className="lines grow"><span className="t">History pass</span><span className="s num">{historySetting(history, now, timeZone())}</span></div>
              {history.state === 'done' && <span className="state"><HealthGlyph kind="healthy" /><span>Done</span></span>}
              {history.state === 'running' && <span className="state"><HealthGlyph kind={null} checking /><span>Reading</span></span>}
              {history.state === 'waiting' && <span className="state"><Icon name="history" size={16} className="hg stale" /><span>Waiting for the AI</span></span>}
            </div>
            <Row title="From history" sub={<span className="num">{fromHistorySetting(settings.from_history)}</span>}>
              {settings.from_history > 0 && <button className="btn out sm" type="button" onClick={show}>Show</button>}
            </Row>
          </div>
        )}
      </Section>
    </Page>
  );
}

/**
 * Settings › AI's Jobs group (39b): the models by name, and this month with no meter. `label` names a
 * model from Settings › AI's own answer; until that has come (null), the group is its skeleton.
 */
export function JobsAiGroup({label}: {label: ((model: string) => string) | null}) {
  const {data: ai} = useResource<JobsAiOut>(AI_PATH);
  const needsKey = ai?.missing ? ' · needs a key' : '';
  return (
    <Section label="Jobs">
      {!ai || !label ? <SkeletonRows count={4} /> : (
        <div className="set-group">
          <Row title="Each email" sub={`Role title, requisition ID, the event, the match${needsKey}`} kind="ctl"><span className="val">{label(ai.models.emails)}</span></Row>
          <Row title="Finding the JD" sub={`When the email's link and the platforms miss${needsKey}`} kind="ctl"><span className="val">{jobsModelWith(label(ai.models.finding), true)}</span></Row>
          <Row title="Reading the JD" sub={`Summary, must-haves and nice-to-haves, salary and setting${needsKey}`} kind="ctl"><span className="val">{label(ai.models.reading)}</span></Row>
          <Row title="This month" sub="No cap: a JD is worth finding while the posting is up" kind="ctl"><span className="jb-spent num">{dollars(ai.this_month.cost_usd, true)}</span></Row>
        </div>
      )}
    </Section>
  );
}

/** Usage this month's Jobs row (39b), in its three parts; nothing until it's answered. */
export function JobsUsageRow() {
  const {data: ai} = useResource<JobsAiOut>(AI_PATH);
  if (!ai) return null;
  const month = ai.this_month;
  return (
    <Row title="Jobs" sub={<span className="num" title={usageLine(month)}>{jobsUsageParts(month)}</span>}>
      <span className="cost num">{dollars(month.cost_usd, true)}</span>
    </Row>
  );
}

/** What Jobs has cost this month, for Usage this month's total; undefined until it's answered. */
export const useJobsSpend = () => useResource<JobsAiOut>(AI_PATH).data?.this_month.cost_usd;
