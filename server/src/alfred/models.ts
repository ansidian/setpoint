// Which model Alfred asks (bring your own key; Settings › AI's `ai.alfred_model`). A chosen model
// needs its provider's key; with no choice, Alfred takes the default of whichever provider has a key,
// Anthropic first. The defaults are the most capable general models the providers offer: Claude
// Opus 5.5 (the claude-api skill's default) and OpenAI's GPT-5.5 (v1's catalogue). Alfred answers a
// question or two at a time, so cost per answer is small next to triage's every email; the user can
// choose a cheaper model in Settings › AI.
import type {AiModelChoiceOut, AiProvider, Settings} from '@setpoint/shared';
import {providerOf} from '../triage/models.ts';

export const DEFAULT_ALFRED_MODELS: Record<AiProvider, string> = {anthropic: 'claude-opus-5-5', openai: 'gpt-5.5'};

const NAMES: Record<AiProvider, string> = {anthropic: 'Anthropic', openai: 'OpenAI'};

/** Alfred's model, or why there isn't one. */
export function chooseAlfredModel(ai: Settings['ai'], keys: Record<AiProvider, boolean>): {choice: AiModelChoiceOut | null; missing: string | null} {
  if (ai.alfred_model) {
    const provider = providerOf(ai.alfred_model);
    if (!provider) return {choice: null, missing: `Setpoint can't tell which provider runs ${ai.alfred_model}; choose another model in Settings › AI.`};
    if (!keys[provider]) return {choice: null, missing: `${ai.alfred_model} needs an ${NAMES[provider]} key in Settings › AI.`};
    return {choice: {provider, model: ai.alfred_model}, missing: null};
  }
  const provider = keys.anthropic ? 'anthropic' : keys.openai ? 'openai' : null;
  if (!provider) return {choice: null, missing: 'Alfred needs an Anthropic or OpenAI key in Settings › AI.'};
  return {choice: {provider, model: DEFAULT_ALFRED_MODELS[provider]}, missing: null};
}
