// Which model Alfred asks (bring your own key, Settings › AI's `ai.alfred_model`). A chosen model
// needs the Anthropic key. With no choice, Alfred takes the default. That's the most capable general
// model on offer, Claude Opus 5.5 (the claude-api skill's default). Alfred answers a question or two
// at a time, so cost per answer is small next to triage's every email. The user can choose a cheaper
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

/**
 * Help me write's model: Claude Opus 5.5, whatever Alfred is set to, since a draft goes out in the
 * user's name (the owner's choice; about $0.035 a simple draft, $0.07 with two lookups). It needs
 * the Anthropic key.
 */
export const DRAFT_MODEL = 'claude-opus-5-5';

export function chooseDraftModel(keys: Record<AiProvider, boolean>): {choice: AiModelChoiceOut | null; missing: string | null} {
  if (!keys.anthropic) return {choice: null, missing: 'Help me write needs an Anthropic key in Settings › AI.'};
  return {choice: {provider: 'anthropic', model: DRAFT_MODEL}, missing: null};
}
