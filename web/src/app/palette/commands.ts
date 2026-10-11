// What the page under ⌘K offers: a view registers its commands while it's on screen (the reader
// its This email commands), and the palette reads them when it opens. The palette's own (Go to,
// Appearance and the rest) live in Palette.tsx.
import type {Colour} from '@setpoint/shared';
import {useEffect, useRef} from 'react';
import type {PaletteSection} from '../../logic/palette.ts';
import type {IconName} from '../../ui/glyphs.ts';

export interface Command {
  id: string;
  section: PaletteSection;
  label: string;
  icon: IconName;
  // Its key, shown as a hint ("H", "⌘,").
  hint?: string;
  keywords?: string;
  ticked?: boolean;
  run: () => void;
}

export interface Offer {
  // What the commands are about, shown above the field (board 20: the open email's subject).
  context?: {label: string; colour: Colour};
  commands: Command[];
}

const offers = new Map<symbol, () => Offer>();

/** Offers `offer()`'s commands to ⌘K while the calling component is on screen. */
export function useCommands(offer: () => Offer) {
  const latest = useRef(offer);
  useEffect(() => {
    latest.current = offer;
  });
  useEffect(() => {
    const key = Symbol('commands');
    offers.set(key, () => latest.current());
    return () => {
      offers.delete(key);
    };
  }, []);
}

/** Everything on offer now. */
export function offered(): Offer {
  const all = [...offers.values()].map(offer => offer());
  return {context: all.find(offer => offer.context)?.context, commands: all.flatMap(offer => offer.commands)};
}
