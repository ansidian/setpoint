// Settings › AI (board 30b; DESIGN.md › Settings' row pattern and News in Settings, decisions D25
// and D26): the Anthropic and OpenAI keys, write-only (set or replace, or remove); Mail's four models,
// each changeable at will (triage's cheap and strong, the history pass, and Alfred; Default is the
// built-in choice for the keys that are set); News's group (N5): its two models, fixed (D90), the
// monthly cap, and this month's spend on its meter, saying so at the cap; then this month's usage,
// Triage, Alfred and News in its parts.
import type {AiModelChoiceOut, AiOut, SecretName, SecretOut, Settings} from '@setpoint/shared';
import {useState} from 'react';
import {timeZone} from '../../api/auth.ts';
import {useResource} from '../../api/client.ts';
import {SETTINGS_PATH} from '../../api/items.ts';
import {AI_PATH, patchSettings, SECRETS_PATH, setSecret} from '../../api/settings.ts';
import {readerTime} from '../../logic/format.ts';
import {CAP_CHOICES, capMeter, cappedLine, dollars, newsUsageParts} from '../../logic/news.ts';
import {usageLine} from '../../logic/settings.ts';
import {useNow} from '../clock.ts';
import {Line, Page, Row, Section, Select, useAttempt} from './parts.tsx';

type ModelSetting = keyof Settings['ai'];

const MODELS: {setting: ModelSetting; title: string; sub: string; current: (ai: AiOut) => AiModelChoiceOut | null}[] = [
  {setting: 'triage_model', title: 'Triage', sub: 'Reads each new email', current: ai => ai.triage.cheap},
  {setting: 'triage_strong_model', title: 'Triage, when unsure', sub: 'Checks every Attention answer', current: ai => ai.triage.strong},
  {setting: 'history_model', title: 'History', sub: 'Reads backfilled mail once', current: ai => ai.triage.history},
  {setting: 'alfred_model', title: 'Alfred', sub: 'Answers questions about your mail', current: ai => ai.alfred},
];

const DEFAULT = '';

export function AiPage() {
  const {data: ai} = useResource<AiOut>(AI_PATH);
  const {data: settings} = useResource<Settings>(SETTINGS_PATH);
  const {data: secrets} = useResource<SecretOut[]>(SECRETS_PATH);
  const save = useAttempt();
  const cap = useAttempt();
  const label = (id: string) => ai?.models.find(model => model.id === id)?.label ?? id;
  const news = ai?.news;
  const meter = news ? capMeter(news) : null;
  const capped = news && ai ? cappedLine(news, ai.usage_this_month.since, timeZone(), label) : null;
  const capValue = settings?.news.monthly_cap_usd ?? news?.monthly_cap_usd ?? 40;
  const needsKey = news?.missing ? ' · needs a key' : '';
  const usage = ai?.usage_this_month;

  return (
    <Page title="AI">
      <Section label="Keys">
        <div className="set-group">
          <SecretRow name="anthropic_api_key" title="Anthropic" sub="Claude models" secrets={secrets} />
          <SecretRow name="openai_api_key" title="OpenAI" sub="GPT models" secrets={secrets} />
        </div>
      </Section>

      <Section label="Mail">
        <div className="set-group">
          {MODELS.map(({setting, title, sub, current}) => {
            const chosen = settings?.ai[setting] ?? null;
            const inUse = ai ? current(ai) : null;
            // Default names its model, chosen or not; a model whose key isn't set can't be picked (UX #14).
            const builtIn = ai?.defaults[setting] ?? null;
            const defaultLabel = builtIn ? `Default (${label(builtIn)})` : 'Default';
            const options = [
              {value: DEFAULT, label: defaultLabel},
              ...(ai?.models ?? []).map(model => ({value: model.id, label: `${model.label}${ai?.keys[model.provider] ? '' : ' · no key'}`, disabled: !ai?.keys[model.provider]})),
              ...(chosen && !ai?.models.some(model => model.id === chosen) ? [{value: chosen, label: chosen}] : []),
            ];
            return (
              <Row key={setting} title={title} sub={inUse ? `${sub} · now ${label(inUse.model)}` : `${sub} · needs a key`} kind="ctl">
                <Select value={chosen ?? DEFAULT} options={options} label={`${title} model`}
                  onChange={value => void save.attempt(() => patchSettings({ai: {[setting]: value || null}}))} />
              </Row>
            );
          })}
        </div>
        <Line text={save.line?.text ?? null} tone={save.line?.tone} />
      </Section>

      <Section label="News">
        <div className="set-group">
          <Row title="Articles and grouping" sub={`Section, noise filter, key facts, same event or not${needsKey}`} kind="ctl">
            {news && <span className="val">{label(news.articles_model)}</span>}
          </Row>
          <Row title="Stories and ranking" sub={`Headlines and summaries, the hourly ranking${needsKey}`} kind="ctl">
            {news && <span className="val">{label(news.stories_model)}</span>}
          </Row>
          <Row title="Monthly cap" sub="At the cap, summaries switch to Haiku until the 1st" kind="ctl">
            <Select value={capValue} label="Monthly cap"
              options={[...new Set([...CAP_CHOICES, capValue])].sort((a, b) => a - b).map(value => ({value, label: dollars(value)}))}
              onChange={value => void cap.attempt(() => patchSettings({news: {monthly_cap_usd: value}}))} />
          </Row>
          <Row title="This month" sub={capped ? <span className="caution">{capped}</span> : undefined} kind="ctl">
            {meter && <span className={capped ? 'meter capped' : 'meter'} role="meter" aria-label="This month" aria-valuemin={0} aria-valuemax={1} aria-valuenow={meter.fill}><span style={{width: `${meter.fill * 100}%`}} /></span>}
            {meter && <span className="amount num">{meter.text}</span>}
          </Row>
        </div>
        <Line text={cap.line?.text ?? null} tone={cap.line?.tone} />
      </Section>

      <Section label="Usage this month">
        <div className="set-group">
          <Row title="Triage" sub={usage ? usageLine(usage.triage) : ''}>{usage && <span className="cost num">{dollars(usage.triage.cost_usd, true)}</span>}</Row>
          <Row title="Alfred" sub={usage ? usageLine(usage.alfred) : ''}>{usage && <span className="cost num">{dollars(usage.alfred.cost_usd, true)}</span>}</Row>
          <Row title="News" sub={usage ? newsUsageParts(usage.news) : ''}>{usage && <span className="cost num">{dollars(usage.news.cost_usd, true)}</span>}</Row>
        </div>
      </Section>
    </Page>
  );
}

/** "1.2M", "48k", "312". */
/** An instance secret (an AI key, the Maps key, ntfy's token), write-only: whether it's set and when, Set or Replace, and Remove. */
export function SecretRow({name, title, sub, noun, secrets}: {name: SecretName; title: string; sub: string; noun?: string; secrets: SecretOut[] | undefined}) {
  const now = useNow();
  const secret = secrets?.find(one => one.name === name);
  const state = secret?.set ? `Set${secret.updated_at ? ` · ${readerTime(secret.updated_at, now, timeZone())}` : ''}` : 'Not set';
  return <KeyRow id={name} title={title} sub={`${sub} · ${state}`} noun={noun} set={secret?.set ?? false} save={value => setSecret(name, value)} remove={() => setSecret(name, null)} />;
}

/** A write-only key's row: a field to set or replace it, and Remove where it can be. */
export function KeyRow({id, title, sub, noun = 'key', set, disabled, save, remove}: {
  id: string;
  title: string;
  sub: string;
  // What it holds, for its button and field: "Set key", or "Set token" for ntfy's.
  noun?: string;
  set: boolean;
  disabled?: boolean;
  save: (value: string) => Promise<void>;
  remove?: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const send = useAttempt();
  const field = title.toLowerCase().endsWith(noun) ? title : `${title} ${noun}`;
  return (
    <div className="set-row ctl" data-secret={id}>
      <div className="lines grow"><span className="t">{title}</span><span className="s">{send.line ? <span style={{color: send.line.tone ? 'var(--alert)' : undefined}}>{send.line.text}</span> : sub}</span></div>
      {editing ? (
        <form className="form" onSubmit={event => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get('value')?.toString().trim() ?? '';
          if (!value) return;
          void send.attempt(async () => {
            await save(value);
            return true;
          }).then(saved => saved && setEditing(false));
        }}>
          <input className="fld mono" name="value" type="password" placeholder={field} aria-label={field} autoFocus autoComplete="off" style={{width: 260}}
            onKeyDown={event => {
              if (event.key !== 'Escape') return;
              event.stopPropagation();
              setEditing(false);
            }} />
          <button className="btn sm" type="submit" disabled={send.busy}>Save</button>
          <button className="btn quiet sm" type="button" onClick={() => setEditing(false)}>Cancel</button>
        </form>
      ) : (
        <>
          {set && remove && <button className="btn quiet sm" type="button" onClick={() => void send.attempt(remove)}>Remove</button>}
          <button className="btn out sm" type="button" disabled={disabled} onClick={() => setEditing(true)}>{set ? 'Replace' : `Set ${noun}`}</button>
        </>
      )}
    </div>
  );
}
