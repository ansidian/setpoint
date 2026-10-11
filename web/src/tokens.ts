// Setpoint's design tokens, defined once for Night and Light. They mirror DESIGN.md › Tokens and
// design-export/styles/setpoint.css (tests/tokens.test.ts compares all three, with DESIGN.md's
// overrides named there), so change them together. applyTokens() publishes the theme-free ones as
// CSS custom properties (`--r-card`, `--dur-fast`, `--sidebar`, `--a-business`…), applyTheme() a
// theme's colours, shadows and tints, under the export's names (`--page`, `--shadow-pop`, `--evtint`).
import type {Colour} from '@setpoint/shared';

export type Theme = 'night' | 'light';

/** Night. Keys are DESIGN.md's token names; `panel`, `ink3` and `cyan` are the polish audit's (override 29). */
export const colour = {
  page: '#050506',
  panel: '#0b0c0e',
  card: '#0c0d0f',
  cardOn: '#131417',
  chip: '#0f1013',
  modal: '#0c0d0f',
  ink: '#ecebe7',
  ink2: '#a3a4a8',
  ink3: '#7d7f84',
  onInk: '#050506',
  onAccent: '#050506',
  onAlert: '#1a0806',
  edge: 'rgba(255,255,255,.055)',
  edgeOn: 'rgba(255,255,255,.12)',
  edgeHover: 'rgba(255,255,255,.14)',
  hair: 'rgba(255,255,255,.07)',
  sub: 'rgba(255,255,255,.055)',
  sub2: 'rgba(255,255,255,.09)',
  sub3: 'rgba(255,255,255,.13)',
  // A ghost button pressed: one step past its hover's `sub3` (polish audit motion-02).
  sub4: 'rgba(255,255,255,.17)',
  stripe: 'rgba(255,255,255,.045)',
  scrim: 'rgba(0,0,0,.72)',
  caution: 'oklch(0.75 0.16 40)',
  alert: 'oklch(0.72 0.17 25)',
  warm: 'oklch(0.8 0.11 55)',
  cool: 'oklch(0.8 0.11 235)',
  comf: 'oklch(0.8 0.11 165)',
  good: 'oklch(0.8 0.13 150)',
  sun: 'oklch(0.86 0.16 92)',
  violet: 'oklch(0.8 0.11 300)',
  cyan: 'oklch(0.86 0.11 182)',
  // "You are here" (#126): cool's values, named for its job so recolouring Personal never moves it.
  accent: 'oklch(0.8 0.11 235)',
  // The month's weekends and the days outside the shown month, and the week's weekend columns (#123).
  dayOff: 'rgba(255,255,255,.02)',
  dayOut: 'rgba(255,255,255,.035)',
} as const;

export type ColourToken = keyof typeof colour;

/**
 * Light: darma's Light tokens (decision 45), with `page` #f6f6f4 (DESIGN.md override 5) and the polish
 * audit's own (override 29): a deeper `ink2`, a white `cardOn`, a greener `cyan` and a stronger calendar tint.
 */
export const lightColour: Record<ColourToken, string> = {
  page: '#f6f6f4',
  panel: '#f1f1ee',
  card: '#ffffff',
  cardOn: '#ffffff',
  chip: '#ffffff',
  modal: '#ffffff',
  ink: '#1d1e21',
  ink2: '#4b4d52',
  ink3: '#6d6f74',
  onInk: '#ffffff',
  onAccent: '#ffffff',
  onAlert: '#ffffff',
  edge: 'rgba(29,30,33,.1)',
  edgeOn: 'rgba(29,30,33,.17)',
  edgeHover: 'rgba(29,30,33,.22)',
  hair: 'rgba(29,30,33,.08)',
  sub: 'rgba(29,30,33,.04)',
  sub2: 'rgba(29,30,33,.07)',
  sub3: 'rgba(29,30,33,.11)',
  sub4: 'rgba(29,30,33,.15)',
  stripe: 'rgba(29,30,33,.05)',
  scrim: 'rgba(20,26,32,.35)',
  caution: 'oklch(0.535 0.16 40)',
  alert: 'oklch(0.535 0.185 25)',
  warm: 'oklch(0.54 0.12 55)',
  cool: 'oklch(0.54 0.12 235)',
  comf: 'oklch(0.54 0.1 165)',
  good: 'oklch(0.53 0.13 150)',
  sun: 'oklch(0.63 0.125 92)',
  violet: 'oklch(0.54 0.14 300)',
  cyan: 'oklch(0.58 0.1 182)',
  accent: 'oklch(0.54 0.12 235)',
  dayOff: 'rgba(29,30,33,.028)',
  dayOut: 'rgba(29,30,33,.048)',
};

/** Overlay shadows; shadows only on overlays. */
export const shadow = {
  pop: '0 18px 50px rgba(0,0,0,.4)',
  modal: '0 30px 80px rgba(0,0,0,.35)',
  pill: '0 10px 30px rgba(0,0,0,.3)',
} as const;

export const lightShadow: Record<keyof typeof shadow, string> = {
  pop: '0 18px 50px rgba(15,20,28,.14)',
  modal: '0 30px 80px rgba(15,20,28,.18)',
  pill: '0 10px 30px rgba(15,20,28,.14)',
};

/** The sample's accounts (`--a-*`) and calendars (`--c-*`); Settings lets each pick a swatch. */
export const accountColour = {business: 'warm', personal: 'cool', work: 'comf', jobs: 'violet', icloud: 'ink2'} as const satisfies Record<string, Colour>;
export const calendarColour = {personal: 'cool', classes: 'cyan', jobs: 'violet'} as const satisfies Record<string, Colour>;

/**
 * Mixes, as `color-mix(in oklch, <colour> N%, <on>)`: the tags, the needs-reconnect bar, the
 * search highlight and calendar chips' tint (`--evtint`).
 */
export const mix = {
  tagAlert: {colour: 'alert', fill: 10, on: 'chip', edge: 40},
  tagCaution: {colour: 'caution', fill: 12, on: 'chip', edge: 35},
  reconnectBar: {colour: 'caution', fill: 9, on: 'page', edge: 22},
  searchHighlight: {colour: 'sun', fill: 26, on: 'transparent'},
} as const;
export const evtint = {night: 16, light: 14} as const;
/** What a calendar chip lays over itself under the pointer, in its own colour (`--evhover`, polish audit grids-05). */
export const evhover = {night: 18, light: 14} as const;
/**
 * Coloured text on its own tint (calendar chips, week blocks, the editor's timeline) caps its
 * lightness at `--tintL` (#122): Light's hues are tuned for text on the page and wash out on a tint;
 * Night's aren't capped.
 */
export const tintL = {night: 1, light: 0.43} as const;

/** Glyph colours: the Todoist rings (done is `good`, DESIGN.md override 4) and the weather. */
export const glyphColour = {
  taskOpen: 'ink3',
  taskOpenOnGrid: 'ink2',
  taskDone: 'good',
  sun: 'sun',
  cloud: 'ink2',
  rain: 'cool',
} as const satisfies Record<string, Colour>;

/** darma's scrollbar (mantel's thin dark one). */
export const scrollbar = {size: 10, thumb: 'rgba(255,255,255,.16)', lightThumb: 'rgba(29,30,33,.22)', inset: 3} as const;

export const font = {
  sans: "'Geist Variable', system-ui, sans-serif",
  mono: "'Geist Mono Variable', ui-monospace, monospace",
  features: '"ss01"',
} as const;

export const base = {size: 13, lineHeight: 1.35} as const;

/** DESIGN.md › Type. Sizes in px. */
export const type = {
  readerSubject: {size: 20, weight: 500, tracking: '-.01em', lineHeight: 1.25},
  headerTitle: {size: 15, weight: 500, tracking: '-.005em'},
  name: {size: 14, weight: 600, tracking: '-.01em'},
  emailBody: {size: 14, lineHeight: 1.55, maxWidth: 600},
  row: {size: 13, unreadWeight: 500},
  control: {size: 12.5},
  small: {size: 12, chipWeight: 500},
  label: {size: 11.5, tracking: '.08em'},
  hint: {size: 11, weight: 500},
  code: {size: 13, weight: 500, tracking: '.06em'},
} as const;

/** DESIGN.md › Shape, in the table's order. Settings' row groups are 16. */
export const radius = {pill: 999, modal: 26, popover: 18, card: 14, bar: 12, row: 10, segment: 8, chip: 6, hint: 5} as const;

/**
 * mantel's timings; a press going in (its release takes `fast`, polish audit motion-02); a lifted
 * calendar chip's tilt and scale; the theme fade.
 */
export const motion = {fast: 120, medium: 180, slow: 260, press: 80, ease: 'cubic-bezier(.2,0,0,1)', liftTilt: -1.5, liftScale: 1.04, themeFade: 180} as const;

/** The floating detail's glide (design-export/motion/glide.json; DESIGN.md › The glide). */
export const glide = {
  easing: 'cubic-bezier(.22,1.3,.36,1)',
  // About 3% of travel, on position only.
  overshoot: 0.03,
  // Duration: min(capMs, baseMs + perStepMs × distance / stepPx).
  baseMs: 280,
  perStepMs: 40,
  stepPx: 400,
  capMs: 380,
  heightMs: 220,
  // The contents crossfade, overlapping by 50 ms, so the card never travels blank (DESIGN.md override
  // 30, polish audit calflows-12); glide.json still says 0–90 out and 90–220 in.
  oldContentOutMs: 120,
  newContentInFromMs: 70,
  newContentInToMs: 220,
  newContentSlidePx: 6,
  selectionSolidAtMs: 60,
  selectionOldAtMs: 0,
  // The overshoot never crosses the grid's edge (decision 47, DESIGN.md override 1); glide.json
  // still says it may pass by about 9 px.
  clampOvershootAtEdges: true,
  openMs: 180,
  openScale: 0.96,
  closeMs: 120,
  closeScale: 0.98,
  editMs: 220,
  editorSlidePx: 12,
  // The build's, where glide.json gives no figure (F5, reviewed by eye): how far the card
  // shrinks as it hands over to the editor, and how long a retarget's carried velocity lasts
  // (its time constant) before the new glide alone moves the card.
  editScale: 0.9,
  retargetMomentumMs: 24,
} as const;

/** Where the floating detail and every overlay anchored to a calendar item go. */
export const placement = {gapPx: 8, sides: ['right', 'left', 'above', 'below']} as const;

/**
 * Dragging a chip (DESIGN.md › Drag; board 15): how far a press moves before it lifts, and where the
 * tooltip naming the day and time sits from the lifted chip's top left (board 15: 18 right, 30 down).
 */
export const drag = {thresholdPx: 4, tipOffset: {left: 18, top: 30}} as const;

/**
 * The week view (DESIGN.md › Week view; board 16): the hour grid's measures, the all-day row's lines,
 * the steps a drag snaps to, and the paging slide.
 */
export const week = {
  hourPx: 44,
  gutterPx: 56,
  headPx: 48,
  // The all-day row: 20 px lines 2 px apart inside 5 px of padding, two lines at least, three at most.
  linePx: 20,
  lineGapPx: 2,
  allDayPadPx: 5,
  minLines: 2,
  maxLines: 3,
  // Overlapping events share a column in up to this many lanes, then "+N".
  lanes: 3,
  snapMinutes: 15,
  minMinutes: 15,
  minBlockPx: 20,
  // Under this, a block has no room for a second line: its time follows its title on one line.
  shortMinutes: 50,
  // A block's resizing edge, and the shortest block that offers its top edge too.
  edgePx: 5,
  topEdgeFromMinutes: 30,
  openingMinutes: 7 * 60,
  pageMs: 180,
  pageSlidePx: 24,
  fadeMs: 120,
  // A two-finger horizontal swipe this far pages a week, then waits this long before another.
  swipePx: 80,
  swipeRestMs: 400,
  // A drag held at the grid's left or right edge this long pages a week.
  edgePageMs: 600,
} as const;

/** News (DESIGN.md › News › Keys and behaviour): how long a row stays fully on screen before its story is seen. */
export const news = {seenAfterMs: 1000} as const;

/** Fixed sizes in px (DESIGN.md › Layout and the export's Key measurements). */
export const layout = {
  sidebar: 248,
  // The sidebar in the compact tier (DESIGN.md › Layout › Compact).
  rail: 56,
  header: 56,
  readingPane: 680,
  rightPane: 400,
  floatingDetail: 280,
  monthColumn: 147,
  monthRow: 176,
  weekdayRow: 30,
  dayHead: 22,
  calendarChip: 20,
  settingsWidth: 1040,
  settingsHeight: 720,
  settingsNav: 220,
  settingsRow: 52,
  settingsGroupRadius: 16,
  row: 38,
  groupHeader: 30,
  sidebarItem: 32,
  accountRow: 28,
  todayRow: 28,
  calendarRow: 30,
  miniDay: 26,
  mailSearch: 380,
  search: 32,
  segmented: 28,
  readerTools: 48,
  attachment: 280,
  // The board's .cmdk (DESIGN.md: about 637).
  palette: 640,
} as const;

/**
 * The design target, the phone layout's breakpoint, the compact tier's (the rail, panes over what
 * they'd squeeze), and darma's wide-screen zoom. CSS media queries spell them out; Phone.tsx's hooks
 * read them from here.
 */
export const viewport = {target: {width: 1677, height: 1050}, phoneBelow: 640, compactBelow: 1100, wideFrom: 2200, wideZoom: 1.25} as const;

const accountVariables = () => Object.fromEntries(Object.entries(accountColour).map(([name, token]) => [`--a-${name}`, `var(--${token})`]));
const calendarVariables = () => Object.fromEntries(Object.entries(calendarColour).map(([name, token]) => [`--c-${name}`, `var(--${token})`]));

/** The tokens that don't change with the theme, as CSS custom properties. */
export function cssVariables(): Record<string, string> {
  const vars: Record<string, string> = {...accountVariables(), ...calendarVariables()};
  vars['--ease'] = motion.ease;
  vars['--glide-ease'] = glide.easing;
  // design-export/motion/glide.css's names, for what the floating detail draws in CSS.
  vars['--glide-height-dur'] = `${glide.heightMs}ms`;
  vars['--glide-content-slide'] = `${glide.newContentSlidePx}px`;
  vars['--detail-open'] = `${glide.openMs}ms`;
  vars['--detail-close'] = `${glide.closeMs}ms`;
  vars['--detail-edit'] = `${glide.editMs}ms`;
  vars['--detail-editor-slide'] = `${glide.editorSlidePx}px`;
  vars['--lift'] = `rotate(${motion.liftTilt}deg) scale(${motion.liftScale})`;
  vars['--dur-fast'] = `${motion.fast}ms`;
  vars['--dur-medium'] = `${motion.medium}ms`;
  vars['--dur-slow'] = `${motion.slow}ms`;
  vars['--dur-press'] = `${motion.press}ms`;
  vars['--theme-fade'] = `${motion.themeFade}ms`;
  vars['--sans'] = font.sans;
  vars['--mono'] = font.mono;
  for (const [name, value] of Object.entries(radius)) vars[`--r-${name}`] = `${value}px`;
  for (const [name, value] of Object.entries(layout)) vars[`--${name}`] = `${value}px`;
  vars['--scrollbar'] = `${scrollbar.size}px`;
  vars['--weekHour'] = `${week.hourPx}px`;
  vars['--weekGutter'] = `${week.gutterPx}px`;
  vars['--weekHead'] = `${week.headPx}px`;
  vars['--weekLine'] = `${week.linePx}px`;
  vars['--weekLineGap'] = `${week.lineGapPx}px`;
  vars['--weekAllDayPad'] = `${week.allDayPadPx}px`;
  vars['--weekPage'] = `${week.pageMs}ms`;
  vars['--weekSlide'] = `${week.pageSlidePx}px`;
  vars['--weekFade'] = `${week.fadeMs}ms`;
  return vars;
}

/** A theme's colours, shadows, chip tint, scrollbar thumb and the cap on coloured text on a tint. */
export function themeVariables(theme: Theme): Record<string, string> {
  const light = theme === 'light';
  const vars: Record<string, string> = {};
  for (const [name, value] of Object.entries(light ? lightColour : colour)) vars[`--${name}`] = value;
  for (const [name, value] of Object.entries(light ? lightShadow : shadow)) vars[`--shadow-${name}`] = value;
  vars['--evtint'] = `${light ? evtint.light : evtint.night}%`;
  vars['--evhover'] = `${light ? evhover.light : evhover.night}%`;
  vars['--scrollbar-thumb'] = light ? scrollbar.lightThumb : scrollbar.thumb;
  vars['--tintL'] = String(light ? tintL.light : tintL.night);
  return vars;
}

export function applyTokens(root: HTMLElement) {
  for (const [name, value] of Object.entries(cssVariables())) root.style.setProperty(name, value);
}

/** Draws the page in a theme: its tokens, and the browser's own controls to match. */
export function applyTheme(root: HTMLElement, theme: Theme) {
  for (const [name, value] of Object.entries(themeVariables(theme))) root.style.setProperty(name, value);
  root.style.colorScheme = theme === 'light' ? 'light' : 'dark';
  root.dataset.theme = theme;
}
