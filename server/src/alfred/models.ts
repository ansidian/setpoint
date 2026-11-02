// Which model Alfred asks (bring your own key; Settings › AI's `ai.alfred_model`). A chosen model
// needs the Anthropic key; with no choice, Alfred takes the default. That's the most capable general
// model on offer, Claude Opus 5.5 (the claude-api skill's default). Alfred answers a question or two
// at a time, so cost per answer is small next to triage's every email; the user can choose a cheaper
// model in Settings › AI.
import type {AiModelChoiceOut, AiProvider, Settings} from '@setpoint/shared';
import {providerOf, savedModel} from '../triage/models.ts';

export const DEFAULT_ALFRED_MODEL = 'claude-opus-5-5';

/** Alfred's model, or why there isn't one. */
export function chooseAlfredModel(ai: Settings['ai'], keys: Record<AiProvider, boolean>): {choice: AiModelChoiceOut | null; missing: string | null} {
  const model = savedModel(ai.alfred_model);
  if (model) {
    const provider = providerOf(model);
    if (!provider) return {choice: null, missing: `Setpoint can't tell which provider runs ${model}; choose another model in Settings › AI.`};
    if (!keys.anthropic) return {choice: null, missing: `${model} needs an Anthropic key in Settings › AI.`};
    return {choice: {provider, model}, missing: null};
  }
  if (!keys.anthropic) return {choice: null, missing: 'Alfred needs an Anthropic key in Settings › AI.'};
  return {choice: {provider: 'anthropic', model: DEFAULT_ALFRED_MODEL}, missing: null};
}
