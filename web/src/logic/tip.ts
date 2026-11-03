// Where the shared tooltip goes (DESIGN.md #299): centred under what it names, 6 px off it; above
// instead when it would run past the window's bottom and fits there; slid along to stay 8 px inside
// the window's sides.
import {tip} from '../tokens.ts';

export interface TipPlace {
  left: number;
  top: number;
  up: boolean;
}

export function placeTip(anchor: {left: number; top: number; width: number; height: number}, size: {width: number; height: number}, viewport: {width: number; height: number}): TipPlace {
  const below = anchor.top + anchor.height + tip.gapPx;
  const above = anchor.top - tip.gapPx - size.height;
  const up = below + size.height > viewport.height - tip.marginPx && above >= tip.marginPx;
  const centred = anchor.left + anchor.width / 2 - size.width / 2;
  return {
    left: Math.max(tip.marginPx, Math.min(centred, viewport.width - size.width - tip.marginPx)),
    top: up ? above : below,
    up,
  };
}

const squeezed = (text: string) => text.replace(/\s+/g, '');

/**
 * Whether a tip only repeats its element's own words (SV-171), there for when they're cut: every one of
 * its words, in order, is in the element's text, spaces aside, as "Interview Tue" in "· Interview Tue".
 */
export const repeats = (text: string, words: string) => squeezed(text).includes(squeezed(words));
