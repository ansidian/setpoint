// Which models triage asks (bring your own key; Settings › AI). A chosen model id needs its
// provider's key; with no choice, triage takes the built-in pair of whichever provider has a key,
// Anthropic first. Anthropic's defaults are Claude Sonnet 5.5 cheap and Claude Opus 5.5 strong
// (2026-10-08, D25; ids from the claude-api skill). The one-time history pass (D20) has its own choice,
// Claude Haiku 5.5 by default (D26): a year of mail on Sonnet would cost about 20× as much. OpenAI's come from
// v1's curated catalogue (server/ai-model-catalog.ts) and AI_PRICING.md: v1 used GPT-5.5 for both,
// here GPT-5.4 mini is the cheap one. A chosen strong model whose key is missing
// falls back to the cheap model, so escalation still asks again rather than not at all.
import type {AiModelChoiceOut, AiProvider, Settings} from '@setpoint/shared';
import {listSecrets, readSecret} from '../secrets/store.ts';
import type {Store} from '../store.ts';

export const DEFAULT_TRIAGE_MODELS: Record<AiProvider, {cheap: string; strong: string; history: string}> = {
  anthropic: {cheap: 'claude-sonnet-5-5', strong: 'claude-opus-5-5', history: 'claude-haiku-5-5'},
  openai: {cheap: 'gpt-5.4-mini', strong: 'gpt-5.5', history: 'gpt-5.4-mini'},
};

const KEY_SECRETS = {anthropic: 'anthropic_api_key', openai: 'openai_api_key'} as const;
const NAMES: Record<AiProvider, string> = {anthropic: 'Anthropic', openai: 'OpenAI'};

/** A model id's provider: Claude models are Anthropic's; GPT and o-series models OpenAI's. */
export function providerOf(model: string): AiProvider | null {
  if (/^claude-/i.test(model)) return 'anthropic';
  if (/^(gpt-|o\d|chatgpt-)/i.test(model)) return 'openai';
  return null;
}

export interface TriageModels {
  cheap: AiModelChoiceOut | null;
  strong: AiModelChoiceOut | null;
  history: AiModelChoiceOut | null;
  // Why there's no cheap model, for "Triage is down".
  missing: string | null;
}

/** The models to use, from the AI settings and which keys are set. */
export function chooseTriageModels(ai: Settings['ai'], keys: Record<AiProvider, boolean>): TriageModels {
  const pick = (model: string | null, tier: 'cheap' | 'strong' | 'history'): {choice: AiModelChoiceOut | null; missing: string | null} => {
    if (model) {
      const provider = providerOf(model);
      if (!provider) return {choice: null, missing: `Setpoint can't tell which provider runs ${model}; choose another model in Settings › AI.`};
      if (!keys[provider]) return {choice: null, missing: `${model} needs an ${NAMES[provider]} key in Settings › AI.`};
      return {choice: {provider, model}, missing: null};
    }
    const provider = keys.anthropic ? 'anthropic' : keys.openai ? 'openai' : null;
    if (!provider) return {choice: null, missing: 'Triage has no model to ask: add an Anthropic or OpenAI key in Settings › AI.'};
    return {choice: {provider, model: DEFAULT_TRIAGE_MODELS[provider][tier]}, missing: null};
  };
  const cheap = pick(ai.triage_model, 'cheap');
  let strong = pick(ai.triage_strong_model, 'strong').choice;
  // No strong choice of its own: the stronger sibling of the cheap model's provider.
  if (!ai.triage_strong_model && cheap.choice) strong = {provider: cheap.choice.provider, model: DEFAULT_TRIAGE_MODELS[cheap.choice.provider].strong};
  return {cheap: cheap.choice, strong: strong ?? cheap.choice, history: pick(ai.history_model, 'history').choice, missing: cheap.missing};
}

/** Which AI keys are set (their values never leave the server). */
export function aiKeys(store: Store): Record<AiProvider, boolean> {
  const set = new Set(listSecrets(store).filter(secret => secret.set).map(secret => secret.name));
  return {anthropic: set.has(KEY_SECRETS.anthropic), openai: set.has(KEY_SECRETS.openai)};
}

/** A provider's key, decrypted for its client; null when unset or no encryption key is loaded. */
export function keyOf(store: Store, provider: AiProvider): string | null {
  if (!store.keyring) return null;
  return readSecret(store, KEY_SECRETS[provider]);
}

export const isAiKeySecret = (name: string) => (Object.values(KEY_SECRETS) as string[]).includes(name);
