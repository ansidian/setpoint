// Settings › Mail (board 18a): written rules in their order (drag, or ↑ ↓ on the handle) with Add
// rule, the note that protected mail can't be moved by any rule, learned rules (from pattern
// prompts) with Undo on the day they were learned and × after, the trusted remote-content domains
// with a filter, and the code expiry's presets.
import type {Kind, Lane, RuleOut, Settings, TrustedDomainOut} from '@setpoint/shared';
import {CODE_EXPIRY_PRESETS, KINDS} from '@setpoint/shared';
import {useState} from 'react';
import {timeZone} from '../../api/auth.ts';
import {useResource} from '../../api/client.ts';
import {SETTINGS_PATH} from '../../api/items.ts';
import {createRule, deleteRule, patchSettings, reorderRules, RULES_PATH, setRuleEnabled, TRUSTED_PATH, untrustDomain} from '../../api/settings.ts';
import {localDate} from '../../logic/format.ts';
import {expiryLabel, laneTag, matchesThisMonth, moved, ruleWords, senderMatch, splitRules} from '../../logic/settings.ts';
import {Icon} from '../../ui/Icon.tsx';
import {segThumb} from '../../ui/seg.ts';
import {useNow} from '../clock.ts';
import {toastFailure} from '../toast.ts';
import {useLiveOrder} from './order.ts';
import type {DragProps} from './order.ts';
import {escapeCancels, Line, Menu, Page, Section, Select, SkeletonRows, useAttempt} from './parts.tsx';

// The domains shown before Show all.
const DOMAINS_SHOWN = 11;

const DESTINATIONS: {value: string; label: string}[] = [
  {value: 'attention', label: 'Attention'},
  ...KINDS.map(kind => ({value: `fyi:${kind}`, label: laneTag('fyi', kind)})),
  {value: 'noise', label: 'Noise'},
];

export function MailPage() {
  const rulesLoad = {path: RULES_PATH, ...useResource<RuleOut[]>(RULES_PATH)};
  const rules = rulesLoad.data;
  const domainsLoad = {path: TRUSTED_PATH, ...useResource<TrustedDomainOut[]>(TRUSTED_PATH)};
  const domains = domainsLoad.data;
  const settingsLoad = {path: SETTINGS_PATH, ...useResource<Settings>(SETTINGS_PATH)};
  const settings = settingsLoad.data;
  const [adding, setAdding] = useState(false);
  const save = useAttempt();
  const {written, learned} = splitRules(rules ?? []);
  const order = useLiveOrder(written, 'text/x-setpoint-rule', ids => void reorderRules(ids).catch(toastFailure('Couldn\'t reorder rules')));

  return (
    <Page title="Mail" loads={[rulesLoad, domainsLoad, settingsLoad]}>
      <Section label="Rules" right={<button className="btn quiet sm" type="button" onClick={() => setAdding(!adding)}><Icon name="add" size={17} />Add rule</button>}>
        {/* "No rules yet" only once the rules are known (states-01). */}
        {!rules && !adding ? <SkeletonRows count={3} one /> : <div {...order.groupProps}>
          {adding && <AddRule onDone={() => setAdding(false)} />}
          {written.map((rule, index) => (
            <WrittenRule key={rule.id} rule={rule} drag={order.rowProps(rule, index)} onMove={delta => {
              const next = moved(written, index, delta);
              if (next !== written) void reorderRules(next.map(one => one.id)).catch(toastFailure('Couldn\'t reorder rules'));
            }} />
          ))}
          {!written.length && !adding && <div className="set-row one"><span className="set-empty-icon"><Icon name="rule" size={20} /></span><span className="s set-empty">No rules yet · <button type="button" onClick={() => setAdding(true)}>Add rule</button></span></div>}
        </div>}
        <div className="note"><Icon name="shield" size={16} />Protected security mail always goes to Attention · no rule can move it</div>
      </Section>

      {learned.length > 0 && (
        <Section label="Learned rules" style={{marginTop: 6}}>
          <div className="set-group">
            {learned.map(rule => <LearnedRule key={rule.id} rule={rule} />)}
          </div>
        </Section>
      )}

      <TrustedDomains domains={domains} />

      <Section>
        {!settings ? <SkeletonRows count={1} /> : <div className="set-group">
          <div className="set-row">
            <div className="lines grow"><span className="t">Code expiry</span><span className="s">Verification codes leave the Inbox after</span></div>
            <span className="seg" ref={segThumb} role="radiogroup" aria-label="Code expiry">
              {CODE_EXPIRY_PRESETS.map(minutes => (
                <button key={minutes} type="button" role="radio" aria-checked={settings.mail.code_expiry_minutes === minutes}
                  className={settings.mail.code_expiry_minutes === minutes ? 'on' : undefined}
                  onClick={() => void save.attempt(() => patchSettings({mail: {code_expiry_minutes: minutes}}))}>{expiryLabel(minutes)}</button>
              ))}
            </span>
          </div>
        </div>}
        <Line text={save.line?.text ?? null} tone={save.line?.tone} />
      </Section>
    </Page>
  );
}

function RuleText({rule}: {rule: Pick<RuleOut, 'match' | 'lane' | 'kind' | 'enabled'>}) {
  return (
    <div className={rule.enabled ? 'rule grow' : 'rule grow off'}>
      <span className="ell">{ruleWords(rule.match).map((run, index) => (run.bold ? <b key={index}>{run.text}</b> : <span key={index}>{run.text}</span>))}</span>
      <span className="to"><Icon name="arrow_forward" size={16} /></span>
      <span className="tag">{laneTag(rule.lane, rule.kind)}</span>
    </div>
  );
}

function WrittenRule({rule, drag: {dragging, ...drag}, onMove}: {rule: RuleOut; drag: DragProps; onMove: (delta: 1 | -1) => void}) {
  return (
    <div className={dragging ? 'set-row one dragging' : 'set-row one'} data-rule={rule.id} draggable {...drag}>
      <button className="handle" type="button" aria-label="Move rule" onKeyDown={event => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        onMove(event.key === 'ArrowUp' ? -1 : 1);
      }}><Icon name="drag_indicator" /></button>
      <RuleText rule={rule} />
      <span className="when num">{rule.enabled ? matchesThisMonth(rule.matches_this_month) : 'Off'}</span>
      <Menu label="Rule options" button={<button className="ibtn sm" type="button" aria-label="Rule options"><Icon name="more_horiz" /></button>}>
        {close => (
          <>
            <button className="menu-i" type="button" role="menuitem" onClick={() => {
              close();
              void setRuleEnabled(rule.id, !rule.enabled).catch(toastFailure(rule.enabled ? 'Couldn\'t turn the rule off' : 'Couldn\'t turn the rule on'));
            }}><Icon name={rule.enabled ? 'toggle_off' : 'toggle_on'} size={16} />{rule.enabled ? 'Turn off' : 'Turn on'}</button>
            <button className="menu-i" type="button" role="menuitem" onClick={() => {
              close();
              void deleteRule(rule.id).catch(toastFailure('Couldn\'t delete the rule'));
            }}><Icon name="delete" size={16} />Delete</button>
          </>
        )}
      </Menu>
    </div>
  );
}

function LearnedRule({rule}: {rule: RuleOut}) {
  const now = useNow();
  const zone = timeZone();
  const today = localDate(rule.created_at, zone) === localDate(now, zone);
  const learnedOn = new Date(rule.created_at).toLocaleDateString('en-US', {timeZone: zone, month: 'short', day: 'numeric'});
  const remove = () => void deleteRule(rule.id).catch(toastFailure('Couldn\'t remove the learned rule'));
  return (
    <div className="set-row one" data-rule={rule.id}>
      <RuleText rule={rule} />
      <span className="when">Learned {learnedOn}</span>
      {today ? <button className="btn ghost sm" type="button" onClick={remove}>Undo</button>
        : <button className="ibtn sm" type="button" aria-label="Remove learned rule" onClick={remove}><Icon name="close" size={16} /></button>}
    </div>
  );
}

/** Add rule: from a domain or address, optionally with words in the subject, to a lane and kind. */
function AddRule({onDone}: {onDone: () => void}) {
  const [destination, setDestination] = useState('fyi:other');
  const send = useAttempt();
  return (
    <form className="set-row ctl form" onKeyDown={escapeCancels(onDone)} onSubmit={event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const sender = senderMatch(form.get('from')?.toString() ?? '');
      const subject = form.get('subject')?.toString().trim();
      if (!sender) return void send.attempt(() => Promise.reject(new Error('From needs a domain such as woodgrovebank.example, or an address.')));
      const [lane, kind] = destination.split(':') as [Lane, Kind | undefined];
      void send.attempt(() => createRule({match: {...sender, ...(subject ? {subject_includes: [subject]} : {})}, lane, kind: kind ?? null, enabled: true}))
        .then(rule => rule && onDone());
    }}>
      <span className="s">From</span>
      <input className="fld" name="from" placeholder="woodgrovebank.example" aria-label="From" autoFocus style={{width: 170}} />
      <input className="fld" name="subject" placeholder="Subject has (optional)" aria-label="Subject has" style={{width: 170}} />
      <Icon name="arrow_forward" size={16} />
      <Select value={destination} options={DESTINATIONS} label="Send to" onChange={setDestination} />
      <span className="grow" />
      <button className="btn sm" type="submit" disabled={send.busy}>Add</button>
      <button className="btn quiet sm" type="button" onClick={onDone}>Cancel</button>
      {send.line && <span className="s" style={{color: 'var(--alert)', flexBasis: '100%'}} role="alert">{send.line.text}</span>}
    </form>
  );
}

function TrustedDomains({domains}: {domains: TrustedDomainOut[] | undefined}) {
  const [filter, setFilter] = useState('');
  const [all, setAll] = useState(false);
  // Newest first: the domain just trusted is the one most likely to be taken back.
  const sorted = [...domains ?? []].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const matching = filter.trim() ? sorted.filter(row => row.domain.includes(filter.trim().toLowerCase())) : sorted;
  const shown = all || filter.trim() || matching.length <= DOMAINS_SHOWN + 1 ? matching : matching.slice(0, DOMAINS_SHOWN);
  return (
    <Section label="Trusted remote-content domains" right={(
      <>
        {domains && <span className="num">{domains.length} domain{domains.length === 1 ? '' : 's'}</span>}
        <label className="mini-field"><Icon name="search" size={16} /><input value={filter} placeholder="Filter" aria-label="Filter domains" onChange={event => setFilter(event.target.value)} /></label>
      </>
    )}>
      {!domains ? <SkeletonRows count={2} one /> : <div className="set-group">
        {/* Nothing to list is one plain line across the group, not a cell of the domains' grid. */}
        {!matching.length ? <div className="set-row one"><span className="s">{filter ? 'No domain matches' : 'None yet · the reader’s “Always show from …” adds one'}</span></div> : (
          <div className="doms">
            {shown.map(row => (
              <div key={row.domain} className="dom" data-domain={row.domain}>
                <span className="ell selectable">{row.domain}</span>
                <button className="x" type="button" aria-label={`Remove ${row.domain}`} onClick={() => void untrustDomain(row.domain).catch(toastFailure(`Couldn't remove ${row.domain}`))}><Icon name="close" size={16} /></button>
              </div>
            ))}
            {shown.length < matching.length && (
              <button className="dom more" type="button" onClick={() => setAll(true)}>Show all {matching.length}<Icon name="chevron_right" size={16} /></button>
            )}
          </div>
        )}
      </div>}
    </Section>
  );
}
