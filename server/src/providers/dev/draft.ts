// The dev provider's help me write: a canned draft for a dev run with no model, so the composer's
// line can be tried end to end. It waits a moment, so the line's working state shows, and answers
// from the ask's own words. Nothing here reads mail or reaches a model. A prompt with "fail" in it
// is refused, for the line's failed state.
import {ProviderError} from '../../sync/errors.ts';
import type {CannedAsk} from '../../alfred/write.ts';

export function devDraftWriter({delayMs = 1200}: {delayMs?: number} = {}) {
  return async (ask: CannedAsk): Promise<string> => {
    await new Promise(resolve => setTimeout(resolve, delayMs));
    if (/\bfail\b/i.test(ask.prompt)) throw new ProviderError('transient', 'Anthropic: Overloaded (529)');
    if (ask.selection) return `${ask.text.trim()} (${ask.prompt.trim()})`;
    const first = ask.to?.split(/[\s@]/)[0] ?? '';
    const sign = ask.from?.split(' ')[0] ?? '';
    return [
      first ? `Hi ${first},` : 'Hi,',
      '',
      `Thanks for your note. ${ask.prompt.trim().replace(/^./, letter => letter.toUpperCase()).replace(/[.!?]?$/, '.')}`,
      ...(ask.text.trim() ? ['', ask.text.trim()] : []),
      '',
      'Best,',
      ...(sign ? [sign] : []),
    ].join('\n');
  };
}
