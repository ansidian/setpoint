// Which models triage asks (bring your own key; Settings › AI). A chosen model id needs the Anthropic
// key; with no choice, triage takes the built-in models. They're Claude Sonnet 5.5 cheap and Claude
// Opus 5.5 strong (2026-10-08, D25; ids from the claude-api skill). The one-time history pass (D20) has
// its own choice, Claude Haiku 5.5 by default (D26): a year of mail on Sonnet would cost about 20× as
// much. A chosen strong model that can't be asked falls back to the cheap model, so escalation still
// asks again rather than not at all.
import type {AiModelChoiceOut, AiProvider, Settings} from '@setpoint/shared';
import {listSecrets, readSecret} from '../secrets/store.ts';
import type {Store} from '../store.ts';

export const DEFAULT_TRIAGE_MODELS = {cheap: 'claude-sonnet-5-5', strong: 'claude-opus-5-5', history: 'claude-haiku-5-5'};

const KEY_SECRET = 'anthropic_api_key';

/** A model id's provider: Claude models are Anthropic's. */
export function providerOf(model: string): 'anthropic' | null {
  return /^claude-/i.test(model) ? 'anthropic' : null;
}

/**
 * A saved model choice, or null for the default. A GPT or o-series id saved while OpenAI was a provider
 * stays in the setting, unasked, and reads as no choice, so that model's work carries on with Claude.
 */
export const savedModel = (model: string | null) => (model && /^(gpt-|o\d|chatgpt-)/i.test(model) ? null : model);

export interface TriageModels {
  cheap: AiModelChoiceOut | null;
  strong: AiModelChoiceOut | null;
  history: AiModelChoiceOut | null;
  // Why there's no cheap model, for "Triage is down".
  missing: string | null;
}

/** The models to use, from the AI settings and whether the key is set. */
export function chooseTriageModels(ai: Settings['ai'], keys: Record<AiProvider, boolean>): TriageModels {
  const pick = (saved: string | null, tier: 'cheap' | 'strong' | 'history'): {choice: AiModelChoiceOut | null; missing: string | null} => {
    const model = savedModel(saved);
    if (model) {
      const provider = providerOf(model);
      if (!provider) return {choice: null, missing: `Setpoint can't tell which provider runs ${model}; choose another model in Settings › AI.`};
      if (!keys.anthropic) return {choice: null, missing: `${model} needs an Anthropic key in Settings › AI.`};
      return {choice: {provider, model}, missing: null};
    }
    if (!keys.anthropic) return {choice: null, missing: 'Triage has no model to ask: add an Anthropic key in Settings › AI.'};
    return {choice: {provider: 'anthropic', model: DEFAULT_TRIAGE_MODELS[tier]}, missing: null};
  };
  const cheap = pick(ai.triage_model, 'cheap');
  const strong = pick(ai.triage_strong_model, 'strong').choice;
  return {cheap: cheap.choice, strong: strong ?? cheap.choice, history: pick(ai.history_model, 'history').choice, missing: cheap.missing};
}

/** Which AI keys can be used (their values never leave the server). A stored OpenAI key stays in the database and counts for nothing. */
export function aiKeys(store: Store): Record<AiProvider, boolean> {
  return {anthropic: listSecrets(store).some(secret => secret.name === KEY_SECRET && secret.set), openai: false};
}

/** The Anthropic key, decrypted for its client; null when unset or no encryption key is loaded. */
export function anthropicKey(store: Store): string | null {
  if (!store.keyring) return null;
  return readSecret(store, KEY_SECRET);
}

export const isAiKeySecret = (name: string) => name === KEY_SECRET;
