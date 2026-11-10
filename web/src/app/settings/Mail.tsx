// Settings › Mail (board 18a): written rules in their order (drag, or ↑ ↓ on the handle) with Add
// rule (open and filled in when an email's Add to rule asked for a New rule from its sender, SV-160;
// Mark read and Trash under Send to, DESIGN.md #347; Turn off and Delete ask about a rule's waiting
// trashes, SV-238), the note that protected mail can't be moved,
// marked read or trashed by any rule, learned rules (from pattern
// prompts) with Undo on the day they were learned and × after, the trusted remote-content domains
// with a filter, and Verification codes' expiry presets.
import type {Kind, Lane, RuleOut, RuleTrash, RuleWaiting, Settings, TrustedDomainOut} from '@setpoint/shared';
import {CODE_EXPIRY_PRESETS, KINDS, RULE_TRASH} from '@setpoint/shared';
import {Fragment, useState} from 'react';
import {timeZone} from '../../api/auth.ts';
import {useResource} from '../../api/client.ts';
import {SETTINGS_PATH} from '../../api/items.ts';
import {createRule, deleteRule, patchSettings, reorderRules, RULES_PATH, setRuleEnabled, TRUSTED_PATH, untrustDomain} from '../../api/settings.ts';
import {localDate} from '../../logic/format.ts';
import {expiryLabel, laneTag, matchesThisMonth, moved, ruleActionWords, ruleWords, senderMatch, splitRules, TRASH_LABELS, waitingChoices, waitingTitle, wordsMatch} from '../../logic/settings.ts';
import {placeMenu} from '../../ui/popover.ts';
import {ScopePrompt} from '../calendar/ScopePrompt.tsx';
import {Icon} from '../../ui/Icon.tsx';
import {Segmented} from '../../ui/Segmented.tsx';
import {useNow} from '../clock.ts';
import {toastFailure} from '../toast.ts';
import {useLiveOrder} from './order.ts';
import {clearRuleDraft, useRuleDraft} from './store.ts';
import type {RuleDraft} from './store.ts';
import type {RuleFilter} from '../../logic/settings.ts';
import type {DragProps} from './order.ts';
import {escapeCancels, Line, Menu, Page, Section, Select, SkeletonRows, Switch, useAttempt} from './parts.tsx';

// The domains shown before Show all.
const DOMAINS_SHOWN = 11;

const DESTINATIONS: {value: string; label: string}[] = [
  {value: 'attention', label: 'Attention'},
  ...KINDS.map(kind => ({value: `fyi:${kind}`, label: laneTag('fyi', kind)})),
  {value: 'noise', label: 'Noise'},
];

// Add rule's filters, in the menu's order: each field's words it contains or doesn't (D487).
const RULE_FILTERS: {key: RuleFilter; label: string}[] = [
  {key: 'subject', label: 'Subject contains'}, {key: 'subjectNot', label: 'Subject doesn’t contain'},
  {key: 'name', label: 'Sender name contains'}, {key: 'nameNot', label: 'Sender name doesn’t contain'},
  {key: 'body', label: 'Body contains'}, {key: 'bodyNot', label: 'Body doesn’t contain'},
];

export function MailPage() {
  const rulesLoad = {path: RULES_PATH, ...useResource<RuleOut[]>(RULES_PATH)};
  const rules = rulesLoad.data;
  const domainsLoad = {path: TRUSTED_PATH, ...useResource<TrustedDomainOut[]>(TRUSTED_PATH)};
  const domains = domainsLoad.data;
  const settingsLoad = {path: SETTINGS_PATH, ...useResource<Settings>(SETTINGS_PATH)};
  const settings = settingsLoad.data;
  const [adding, setAdding] = useState(false);
  const draft = useRuleDraft();
  const showForm = adding || draft !== null;
  const closeForm = () => {
    setAdding(false);
    clearRuleDraft();
  };
  const save = useAttempt();
  const {written, learned} = splitRules(rules ?? []);
  const order = useLiveOrder(written, 'text/x-setpoint-rule', ids => void reorderRules(ids).catch(toastFailure('Couldn\'t reorder rules')));

  return (
    <Page title="Mail" loads={[rulesLoad, domainsLoad, settingsLoad]}>
      <Section label="Rules" right={<button className="btn quiet sm" type="button" onClick={() => (showForm ? closeForm() : setAdding(true))}><Icon name="add" size={17} />Add rule</button>}>
        {/* "No rules yet" only once the rules are known (states-01). */}
        {!rules && !showForm ? <SkeletonRows count={3} one /> : <div {...order.groupProps}>
          {showForm && <AddRule key={draft?.from} draft={draft} onDone={closeForm} />}
          {written.map((rule, index) => (
            <WrittenRule key={rule.id} rule={rule} drag={order.rowProps(rule, index)} onMove={delta => {
              const next = moved(written, index, delta);
              if (next !== written) void reorderRules(next.map(one => one.id)).catch(toastFailure('Couldn\'t reorder rules'));
            }} />
          ))}
          {!written.length && !showForm && <div className="set-row one"><span className="set-empty-icon"><Icon name="rule" size={20} /></span><span className="s set-empty">No rules yet · <button type="button" onClick={() => setAdding(true)}>Add rule</button></span></div>}
        </div>}
        <div className="note"><Icon name="shield" size={16} />Protected security mail always goes to Attention · it can’t be moved, marked read or trashed by any rule</div>
      </Section>

      {learned.length > 0 && (
        <Section label="Learned rules" style={{marginTop: 6}}>
          <div className="set-group">
            {learned.map(rule => <LearnedRule key={rule.id} rule={rule} />)}
          </div>
        </Section>
      )}

      <TrustedDomains domains={domains} />

      <Section label="Verification codes">
        {!settings ? <SkeletonRows count={1} /> : <div className="set-group">
          <div className="set-row">
            <div className="lines grow"><span className="t">Code expiry</span><span className="s">Codes leave the Inbox after</span></div>
            <Segmented role="radio" label="Code expiry" value={settings.mail.code_expiry_minutes}
              segments={CODE_EXPIRY_PRESETS.map(minutes => ({value: minutes, label: expiryLabel(minutes)}))}
              onChange={minutes => void save.attempt(() => patchSettings({mail: {code_expiry_minutes: minutes}}))} />
          </div>
        </div>}
        <Line text={save.line?.text ?? null} tone={save.line?.tone} />
      </Section>
    </Page>
  );
}

function RuleText({rule}: {rule: Pick<RuleOut, 'match' | 'lane' | 'kind' | 'enabled' | 'mark_read' | 'trash'>}) {
  return (
    <div className={rule.enabled ? 'rule grow' : 'rule grow off'}>
      <span className="ell">{ruleWords(rule.match).map((run, index) => (run.bold ? <b key={index}>{run.text}</b> : <span key={index}>{run.text}</span>))}</span>
      <span className="to"><Icon name="arrow_forward" size={16} /></span>
      {/* The actions go on after the lane tag, as the sentence does: "→ Noise, mark read, trash now". */}
      <span className="lane"><span className="tag">{laneTag(rule.lane, rule.kind)}</span>{ruleActionWords(rule)}</span>
    </div>
  );
}

function WrittenRule({rule, drag: {dragging, ...drag}, onMove}: {rule: RuleOut; drag: DragProps; onMove: (delta: 1 | -1) => void}) {
  // Turn off or Delete on a rule with trashes waiting asks first (D495); with none it just happens.
  const [ask, setAsk] = useState<'off' | 'delete' | null>(null);
  const [waiting, setWaiting] = useState<RuleWaiting>('cancel');
  const turnOff = (answer?: RuleWaiting) => void setRuleEnabled(rule.id, false, answer).catch(toastFailure('Couldn\'t turn the rule off'));
  const remove = (answer?: RuleWaiting) => void deleteRule(rule.id, answer).catch(toastFailure('Couldn\'t delete the rule'));
  const asking = (what: 'off' | 'delete', now: () => void) => {
    if (!rule.trashes_waiting) return now();
    setWaiting('cancel');
    setAsk(what);
  };
  return (
    <div className={dragging ? 'set-row one dragging' : 'set-row one'} data-rule={rule.id} draggable {...drag}>
      <button className="handle" type="button" aria-label="Move rule" onKeyDown={event => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        onMove(event.key === 'ArrowUp' ? -1 : 1);
      }}><Icon name="drag_indicator" /></button>
      <RuleText rule={rule} />
      <span className="when num">{rule.enabled ? matchesThisMonth(rule.matches_this_month) : 'Off'}</span>
      <span className="anchor">
        <Menu label="Rule options" button={<button className="ibtn" type="button" aria-label="Rule options"><Icon name="more_horiz" /></button>}>
          {close => (
            <>
              <button className="menu-i" type="button" role="menuitem" onClick={() => {
                close();
                if (rule.enabled) asking('off', () => turnOff());
                else void setRuleEnabled(rule.id, true).catch(toastFailure('Couldn\'t turn the rule on'));
              }}><Icon name={rule.enabled ? 'toggle_off' : 'toggle_on'} size={16} />{rule.enabled ? 'Turn off' : 'Turn on'}</button>
              <button className="menu-i" type="button" role="menuitem" onClick={() => {
                close();
                asking('delete', () => remove());
              }}><Icon name="delete" size={16} />Delete</button>
            </>
          )}
        </Menu>
        {ask && <div ref={placeMenu} className="pop rule-ask" role="dialog" aria-label={waitingTitle(rule.trashes_waiting)}>
          <ScopePrompt small title={waitingTitle(rule.trashes_waiting)} group="What becomes of them" choices={waitingChoices(rule.trashes_waiting)} value={waiting}
            action={ask === 'off' ? 'Turn off' : 'Delete'} onChange={setWaiting} onCancel={() => setAsk(null)} onConfirm={() => {
              setAsk(null);
              if (ask === 'off') turnOff(waiting);
              else remove(waiting);
            }} />
        </div>}
      </span>
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

/**
 * Add rule, read as a sentence (D487): "If from" a domain or address, "and" each filter added from
 * the menu (a field's words it contains or doesn't, each at most once), "then send to" a lane and
 * kind. From an email's draft, its sender and where it is now.
 */
function AddRule({draft, onDone}: {draft: RuleDraft | null; onDone: () => void}) {
  const [destination, setDestination] = useState(draft?.destination ?? 'fyi:other');
  const [filters, setFilters] = useState<RuleFilter[]>([]);
  const [markRead, setMarkRead] = useState(false);
  const [trash, setTrash] = useState<RuleTrash>('never');
  const send = useAttempt();
  const left = RULE_FILTERS.filter(filter => !filters.includes(filter.key));
  return (
    <form className="set-row ctl form rule-form" onKeyDown={escapeCancels(onDone)} onSubmit={event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const sender = senderMatch(form.get('from')?.toString() ?? '');
      if (!sender) return void send.attempt(() => Promise.reject(new Error('From needs a domain such as woodgrovebank.example, or an address.')));
      const words = wordsMatch(Object.fromEntries(filters.map(key => [key, form.get(key)?.toString()])));
      const [lane, kind] = destination.split(':') as [Lane, Kind | undefined];
      void send.attempt(() => createRule({match: {...sender, ...words}, lane, kind: kind ?? null, enabled: true, mark_read: markRead, trash}))
        .then(rule => rule && onDone());
    }}>
      <span className="lead">If from</span>
      <span className="rule-line"><input className="fld" name="from" placeholder="woodgrovebank.example" aria-label="From" defaultValue={draft?.from} autoFocus style={{width: 200}} /></span>
      {filters.map(key => {
        const label = RULE_FILTERS.find(filter => filter.key === key)!.label;
        return (
          <Fragment key={key}>
            <span className="lead">and</span>
            <span className="rule-line">
              <span className="s filter">{label}</span>
              <input className="fld" name={key} aria-label={label} autoFocus style={{width: 200}} />
              <button className="ibtn sm" type="button" aria-label={`Remove ${label}`} onClick={() => setFilters(filters.filter(one => one !== key))}><Icon name="close" size={16} /></button>
            </span>
          </Fragment>
        );
      })}
      {left.length > 0 && (
        <span className="rule-line add">
          <Menu label="Add a filter" align="left" button={<button className="btn quiet sm" type="button"><Icon name="add" size={16} />and…</button>}>
            {close => left.map(filter => (
              <button key={filter.key} className="menu-i" type="button" role="menuitem" onClick={() => {
                close();
                setFilters([...filters, filter.key]);
              }}>{filter.label}</button>
            ))}
          </Menu>
        </span>
      )}
      <span className="lead">then send to</span>
      <span className="rule-line">
        <Select value={destination} options={DESTINATIONS} label="Send to" onChange={setDestination} />
        <span className="grow" />
        <button className="btn sm" type="submit" disabled={send.busy}>Add</button>
        <button className="btn quiet sm" type="button" onClick={onDone}>Cancel</button>
      </span>
      <span className="rule-line add">
        <span className="s">Mark read</span>
        <Switch on={markRead} label="Mark read" onChange={setMarkRead} />
        <span className="s gap">Trash</span>
        <Segmented role="radio" label="Trash" value={trash} segments={RULE_TRASH.map(value => ({value, label: TRASH_LABELS[value]}))} onChange={setTrash} />
      </span>
      {send.line && <span className="s rule-line add" style={{color: 'var(--alert)'}} role="alert">{send.line.text}</span>}
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
