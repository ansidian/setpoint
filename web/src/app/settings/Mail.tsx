// Settings › Mail (board 18a): written rules in their order (drag, or ↑ ↓ on the handle) with Add
// rule. Add rule is open and filled in when an email's Add to rule asked for a New rule from its
// sender. A written rule's Edit turns its row into the same form, filled in; one form is open at a
// time. Mark read and Trash are under Send to. Turn off and Delete ask about a rule's waiting
// trashes. Then the note that protected mail can't be moved, marked read or trashed by any rule.
// Then learned rules (from pattern prompts), with Undo on the day they were learned and × after.
// Then the trusted remote-content domains (their count and a filter once there are more than Show
// all's 11), and Verification codes' expiry presets.
import type {Kind, Lane, RuleOut, RuleTrash, RuleWaiting, Settings, TrustedDomainOut} from '@setpoint/shared';
import {CODE_EXPIRY_PRESETS, KINDS, RULE_TRASH} from '@setpoint/shared';
import {Fragment, useEffect, useRef, useState} from 'react';
import {timeZone} from '../../api/auth.ts';
import {useResource} from '../../api/client.ts';
import {SETTINGS_PATH} from '../../api/items.ts';
import type {RuleFields} from '../../api/settings.ts';
import {createRule, deleteRule, editRule, patchSettings, reorderRules, RULES_PATH, setRuleEnabled, TRUSTED_PATH, untrustDomain} from '../../api/settings.ts';
import {localDate} from '../../logic/format.ts';
import {DOMAINS_SHOWN, domainTools, expiryLabel, fixedLines, laneTag, matchesThisMonth, moved, ruleActionWords, ruleDestination, ruleFormStart, ruleWords, RULE_PHRASES_MAX, RULE_SENDERS_MAX, sendersMatch, splitRules, TRASH_LABELS, waitingChoices, waitingTitle, wordsMatch} from '../../logic/settings.ts';
import {placeMenu} from '../../ui/popover.ts';
import {ScopePrompt} from '../calendar/ScopePrompt.tsx';
import {Icon} from '../../ui/Icon.tsx';
import {Segmented} from '../../ui/Segmented.tsx';
import {useNow} from '../clock.ts';
import {toastFailure} from '../toast.ts';
import {useLiveOrder} from './order.ts';
import {clearRuleDraft, useRuleDraft} from './store.ts';
import type {RuleDraft} from './store.ts';
import type {RuleFilter, RuleWordsInput} from '../../logic/settings.ts';
import type {DragProps} from './order.ts';
import {escapeCancels, Line, Menu, Page, Section, Select, SkeletonRows, Switch, useAttempt} from './parts.tsx';

const DESTINATIONS: {value: string; label: string}[] = [
  {value: 'attention', label: 'Attention'},
  ...KINDS.map(kind => ({value: `fyi:${kind}`, label: laneTag('fyi', kind)})),
  {value: 'noise', label: 'Noise'},
];

// Add rule's filters, in the menu's order: each field's words it contains or doesn't.
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
  const [editing, setEditing] = useState<number | null>(null);
  const draft = useRuleDraft();
  const showForm = adding || draft !== null;
  const closeForm = () => {
    setAdding(false);
    clearRuleDraft();
  };
  // One form at a time: Add rule (or an email's draft) closes an Edit, and Edit closes Add rule.
  const openAdd = () => {
    setEditing(null);
    setAdding(true);
  };
  const openEdit = (id: number) => {
    closeForm();
    setEditing(id);
  };
  const editingId = showForm ? null : editing;
  const save = useAttempt();
  const {written, learned} = splitRules(rules ?? []);
  const order = useLiveOrder(written, 'text/x-setpoint-rule', ids => void reorderRules(ids).catch(toastFailure('Failed to reorder rules')));

  return (
    <Page title="Mail" loads={[rulesLoad, domainsLoad, settingsLoad]}>
      <Section label="Rules" right={<button className="btn quiet sm" type="button" onClick={() => (showForm ? closeForm() : openAdd())}><Icon name="add" size={17} />Add rule</button>}>
        {/* "No rules yet" only once the rules are known. */}
        {!rules && !showForm ? <SkeletonRows count={3} one /> : <div {...order.groupProps}>
          {showForm && <RuleForm key={draft?.from} draft={draft} save={fields => createRule({...fields, enabled: true})} onDone={closeForm} />}
          {written.map((rule, index) => (rule.id === editingId ? <RuleForm key={rule.id} rule={rule} save={fields => editRule(rule.id, fields)} onDone={() => setEditing(null)} /> : (
            <WrittenRule key={rule.id} rule={rule} drag={order.rowProps(rule, index)} onEdit={() => openEdit(rule.id)} onMove={delta => {
              const next = moved(written, index, delta);
              if (next !== written) void reorderRules(next.map(one => one.id)).catch(toastFailure('Failed to reorder rules'));
            }} />
          )))}
          {!written.length && !showForm && <div className="set-row one"><span className="set-empty-icon"><Icon name="rule" size={20} /></span><span className="s set-empty">No rules yet · <button type="button" onClick={openAdd}>Add rule</button></span></div>}
        </div>}
        <div className="note"><Icon name="shield" size={16} />Protected security mail always goes to Attention. It can’t be moved, marked read or trashed by any rule</div>
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
            <div className="lines grow"><span className="t">Code expiry</span><span className="s">Codes are trashed after</span></div>
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
  const words = ruleWords(rule.match);
  const actions = ruleActionWords(rule);
  return (
    <div className={rule.enabled ? 'rule grow' : 'rule grow off'}>
      {/* Where the modal is narrow the sender is cut ("From wingtip…"); resting on it shows the whole of it. */}
      <span className="ell" data-tip={words.map(run => run.text).join('')} data-tip-quick>{words.map((run, index) => (run.bold ? <b key={index}>{run.text}</b> : <span key={index}>{run.text}</span>))}</span>
      {/* The actions go on after the lane tag, as the sentence does: "→ Noise, mark read, trash now". Where
          the modal is narrow this half is the row's second line, under the sender. */}
      <span className="send" data-tip={`${laneTag(rule.lane, rule.kind)}${actions}`} data-tip-quick>
        <span className="to"><Icon name="arrow_forward" size={16} /></span>
        <span className="lane"><span className="tag">{laneTag(rule.lane, rule.kind)}</span>{actions && <span className="ell">{actions}</span>}</span>
      </span>
    </div>
  );
}

function WrittenRule({rule, drag: {dragging, ...drag}, onEdit, onMove}: {rule: RuleOut; drag: DragProps; onEdit: () => void; onMove: (delta: 1 | -1) => void}) {
  // Turn off or Delete on a rule with trashes waiting asks first. With none it just happens.
  const [ask, setAsk] = useState<'off' | 'delete' | null>(null);
  const [waiting, setWaiting] = useState<RuleWaiting>('cancel');
  const turnOff = (answer?: RuleWaiting) => void setRuleEnabled(rule.id, false, answer).catch(toastFailure('Failed to turn the rule off'));
  const remove = (answer?: RuleWaiting) => void deleteRule(rule.id, answer).catch(toastFailure('Failed to delete the rule'));
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
                onEdit();
              }}><Icon name="edit" size={16} />Edit</button>
              <button className="menu-i" type="button" role="menuitem" onClick={() => {
                close();
                if (rule.enabled) asking('off', () => turnOff());
                else void setRuleEnabled(rule.id, true).catch(toastFailure('Failed to turn the rule on'));
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
  const remove = () => void deleteRule(rule.id).catch(toastFailure('Failed to remove the learned rule'));
  return (
    <div className="set-row one" data-rule={rule.id}>
      <RuleText rule={rule} />
      <span className="when">Learned {learnedOn}</span>
      {today ? <button className="btn ghost sm" type="button" onClick={remove}>Undo</button>
        : <button className="ibtn sm" type="button" aria-label="Remove learned rule" onClick={remove}><Icon name="close" size={16} /></button>}
    </div>
  );
}

// A fixed part's tip: why it can't be changed here.
const FIXED_TIP = 'The form can’t change this part, a save keeps it as it is';

// One of the form's text lines: its words, and a key that stays with it as lines come and go.
interface FormLine {
  id: number;
  text: string;
}
let lastLineId = 0;
const formLine = (text = ''): FormLine => ({id: ++lastLineId, text});

/**
 * The rule form, read as a sentence: "If from" a domain or address, "and" each filter added from
 * the menu (a field's words it contains or doesn't, each at most once), "then send to" a lane and
 * kind. A sender or a filter takes alternatives as "or" lines under it, any one matching (for
 * "doesn't contain", none of them), up to the server's limit; a blank one is left out. Add rule's
 * starts empty, or from an email's draft (its sender and where it is now). Edit's starts from the
 * rule, and shows the parts it can't draw as fixed lines that a save puts back as they were.
 */
export function RuleForm({draft = null, rule, save, onDone}: {draft?: RuleDraft | null; rule?: RuleOut; save: (fields: RuleFields) => Promise<unknown>; onDone: () => void}) {
  const [start] = useState(() => (rule ? ruleFormStart(rule.match) : {from: [draft?.from ?? ''], words: {} as RuleWordsInput, fixed: {}}));
  const [destination, setDestination] = useState(() => (rule ? ruleDestination(rule.lane, rule.kind) : draft?.destination ?? 'fyi:other'));
  const [from, setFrom] = useState(() => start.from.map(text => formLine(text)));
  // The filters shown with their lines, in the menu's order as they were added.
  const [filters, setFilters] = useState<{key: RuleFilter; lines: FormLine[]}[]>(() => RULE_FILTERS.filter(filter => start.words[filter.key]).map(filter => ({key: filter.key, lines: start.words[filter.key]!.map(text => formLine(text))})));
  // The lines added since the form opened, which take the focus.
  const [added, setAdded] = useState<number[]>([]);
  const [markRead, setMarkRead] = useState(rule?.mark_read ?? false);
  const [trash, setTrash] = useState<RuleTrash>(rule?.trash ?? 'never');
  const send = useAttempt();
  const left = RULE_FILTERS.filter(filter => !filters.some(one => one.key === filter.key));
  const lines = fixedLines(start.fixed);
  const hadSender = start.from.some(text => text.trim());
  const newLine = (): FormLine => {
    const line = formLine();
    setAdded([...added, line.id]);
    return line;
  };
  const setFilterLines = (key: RuleFilter, next: FormLine[]) => setFilters(filters.flatMap(one => (one.key !== key ? [one] : next.length ? [{key, lines: next}] : [])));
  // The form holds the focus from the start, so Esc reaches it.
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    const form = formRef.current;
    if (form && !form.contains(document.activeElement)) form.querySelector<HTMLElement>('input, button')?.focus();
  }, []);
  const orButton = (label: string, onClick: () => void) => <button className="btn quiet sm" type="button" aria-label={`Or ${label.toLowerCase()}`} onClick={onClick}>or…</button>;
  return (
    <form ref={formRef} className="set-row ctl form rule-form" data-editing={rule?.id} onKeyDown={escapeCancels(onDone)} onSubmit={event => {
      event.preventDefault();
      // A rule with no sender keeps none when From is left blank; Add rule always needs one.
      const senders = sendersMatch(from.map(line => line.text));
      const blank = senders !== null && !senders.from_domains && !senders.from_addresses;
      if (!senders || (blank && (!rule || hadSender))) return void send.attempt(() => Promise.reject(new Error('From needs a domain such as woodgrovebank.example, or an address.')));
      const words = wordsMatch(Object.fromEntries(filters.map(one => [one.key, one.lines.map(line => line.text)])));
      const [lane, kind] = destination.split(':') as [Lane, Kind | undefined];
      const fields = {match: {...start.fixed, ...senders, ...words}, lane, kind: kind ?? null, mark_read: markRead, trash};
      void send.attempt(() => save(fields)).then(saved => saved && onDone());
    }}>
      {from.map((line, index) => (
        <Fragment key={line.id}>
          <span className="lead">{index ? 'or' : 'If from'}</span>
          <span className="rule-line">
            <input className="fld" name={index ? undefined : 'from'} placeholder={index ? undefined : 'woodgrovebank.example'} aria-label={index ? `From ${index + 1}` : 'From'} value={line.text} autoFocus={index ? added.includes(line.id) : true} style={{width: 200}}
              onChange={event => setFrom(from.map(one => (one.id === line.id ? {...one, text: event.target.value} : one)))} />
            {from.length > 1 && <button className="ibtn sm" type="button" aria-label={index ? `Remove From ${index + 1}` : 'Remove From'} onClick={() => setFrom(from.filter(one => one.id !== line.id))}><Icon name="close" size={16} /></button>}
            {index === from.length - 1 && from.length < RULE_SENDERS_MAX && orButton('From', () => setFrom([...from, newLine()]))}
          </span>
        </Fragment>
      ))}
      {lines.map(line => (
        <Fragment key={line}>
          <span className="lead">and</span>
          <span className="rule-line"><span className="fixed ell" data-tip={FIXED_TIP}><Icon name="lock" size={16} />{line}</span></span>
        </Fragment>
      ))}
      {filters.map(({key, lines: phrases}) => {
        const label = RULE_FILTERS.find(filter => filter.key === key)!.label;
        return phrases.map((line, index) => {
          const name = index ? `${label} ${index + 1}` : label;
          return (
            <Fragment key={line.id}>
              {index ? <span className="lead" /> : <span className="lead">and</span>}
              <span className="rule-line">
                <span className={index ? 's filter or' : 's filter'}>{index ? 'or' : label}</span>
                <input className="fld" aria-label={name} value={line.text} autoFocus={added.includes(line.id)} style={{width: 200}}
                  onChange={event => setFilterLines(key, phrases.map(one => (one.id === line.id ? {...one, text: event.target.value} : one)))} />
                <button className="ibtn sm" type="button" aria-label={`Remove ${name}`} onClick={() => setFilterLines(key, phrases.filter(one => one.id !== line.id))}><Icon name="close" size={16} /></button>
                {index === phrases.length - 1 && phrases.length < RULE_PHRASES_MAX && orButton(label, () => setFilterLines(key, [...phrases, newLine()]))}
              </span>
            </Fragment>
          );
        });
      })}
      {left.length > 0 && (
        <span className="rule-line add">
          <Menu label="Add a filter" align="left" button={<button className="btn quiet sm" type="button"><Icon name="add" size={16} />and…</button>}>
            {close => left.map(filter => (
              <button key={filter.key} className="menu-i" type="button" role="menuitem" onClick={() => {
                close();
                setFilters([...filters, {key: filter.key, lines: [newLine()]}]);
              }}>{filter.label}</button>
            ))}
          </Menu>
        </span>
      )}
      <span className="lead">then send to</span>
      <span className="rule-line"><Select value={destination} options={DESTINATIONS} label="Send to" onChange={setDestination} /></span>
      {/* The last line: each label wraps with its control, and Add (Save) and Cancel keep its right end. */}
      <span className="rule-line add last">
        <span className="pair">
          <span className="s">Mark read</span>
          <Switch on={markRead} label="Mark read" onChange={setMarkRead} />
        </span>
        <span className="pair">
          <span className="s">Trash</span>
          <Segmented role="radio" label="Trash" value={trash} segments={RULE_TRASH.map(value => ({value, label: TRASH_LABELS[value]}))} onChange={setTrash} />
        </span>
        <span className="pair ends">
          <button className="btn sm" type="submit" disabled={send.busy}>{rule ? 'Save' : 'Add'}</button>
          <button className="btn quiet sm" type="button" onClick={onDone}>Cancel</button>
        </span>
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
    <Section label="Trusted remote-content domains" right={domains && domainTools(domains.length, filter) ? (
      <>
        <span className="num">{domains.length} domain{domains.length === 1 ? '' : 's'}</span>
        <label className="mini-field"><Icon name="search" size={16} /><input value={filter} placeholder="Filter" aria-label="Filter domains" onChange={event => setFilter(event.target.value)} /></label>
      </>
    ) : undefined}>
      {!domains ? <SkeletonRows count={2} one /> : <div className="set-group">
        {/* Nothing to list is one plain line across the group, not a cell of the domains' grid. */}
        {!matching.length ? <div className="set-row one">{filter ? <span className="s">No domain matches</span> : <><span className="set-empty-icon"><Icon name="image" size={20} /></span><span className="s">None yet, the reader’s “Always show from …” adds one</span></>}</div> : (
          <div className="doms">
            {shown.map(row => (
              <div key={row.domain} className="dom" data-domain={row.domain}>
                <span className="ell selectable">{row.domain}</span>
                <button className="x" type="button" aria-label={`Remove ${row.domain}`} onClick={() => void untrustDomain(row.domain).catch(toastFailure('Failed to remove'))}><Icon name="close" size={16} /></button>
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
