// ⌘K's list (DESIGN.md › ⌘K; board 20): commands, not search. With nothing typed it shows This
// email (on an open email), Go to and Appearance; typing finds every command, the ones that only
// have a key too (New event, New task, Mark all as read, Sign out), in the same section order.

export const PALETTE_SECTIONS = ['email', 'goto', 'appearance', 'more'] as const;
export type PaletteSection = (typeof PALETTE_SECTIONS)[number];

export const SECTION_LABELS: Record<PaletteSection, string> = {email: 'This email', goto: 'Go to', appearance: 'Appearance', more: 'Commands'};

export interface Matchable {
  section: PaletteSection;
  label: string;
  // More words it answers to ("dark" for Night).
  keywords?: string;
}

const words = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Every typed word starts one of the command's words: "new ev" finds New event, "dark" Night. */
export function matches(command: Matchable, query: string): boolean {
  const own = words(`${command.label} ${command.keywords ?? ''}`);
  return words(query).every(typed => own.some(word => word.startsWith(typed)));
}

/**
 * Where what's typed matched a command's label (polish audit shell-13): the start of each of its words
 * that a typed word begins, as long as that typed word, so ⌘K can mark it. A match in its keywords
 * only ("dark" for Night) marks nothing.
 */
export function matchedRuns(label: string, query: string): {start: number; end: number}[] {
  const typed = words(query);
  const runs: {start: number; end: number}[] = [];
  for (const word of label.matchAll(/[\p{L}\p{N}]+/gu)) {
    const longest = Math.max(0, ...typed.filter(one => word[0].toLowerCase().startsWith(one)).map(one => one.length));
    if (longest) runs.push({start: word.index, end: word.index + longest});
  }
  return runs;
}

/** The sections to show for what's typed, each with its commands in their order; empty sections left out. */
export function paletteList<T extends Matchable>(commands: T[], query: string): {section: PaletteSection; items: T[]}[] {
  const typed = query.trim() !== '';
  return PALETTE_SECTIONS
    .filter(section => typed || section !== 'more')
    .map(section => ({section, items: commands.filter(command => command.section === section && (!typed || matches(command, query)))}))
    .filter(group => group.items.length > 0);
}

/** The keyboard cursor moved by `delta` through `count` items, wrapping at the ends. */
export const stepCursor = (cursor: number, delta: 1 | -1, count: number) => (count ? (cursor + delta + count) % count : 0);
