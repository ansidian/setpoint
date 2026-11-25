// Setpoint's design tokens, defined once for Night and Light. DESIGN.md › Tokens records them, so
// change the two together. Nothing checks they agree. design-export keeps the boards' original values.
// applyTokens() publishes the theme-free ones as CSS custom properties (`--r-card`, `--dur-fast`,
// `--sidebar`, `--a-business`…) and the Night scope's rule, and applyTheme() a theme's colours,
// shadows and tints, under the export's names (`--page`, `--shadow-pop`, `--evtint`).
import type {Colour} from '@setpoint/shared';

export type Theme = 'night' | 'light';

/** Night. Keys are DESIGN.md's token names. `panel`, `ink3` and `cyan` depart from the export's. */
export const colour = {
  page: '#050506',
  // The dark frame around the content cards: the sidebar, each page's header row and the key hints.
  frame: '#050506',
  panel: '#0b0c0e',
  // The content card on the frame (the mail list, the reader, the grids, the right panes), and its
  // ring and 1 px top highlight: hairlines, not shadows.
  card: '#131417',
  cardRing: 'rgba(255,255,255,.07)',
  cardTop: 'rgba(255,255,255,.05)',
  // A surface on a card (the code and facts cards, attachments, Alfred's answer, a focused field): a step up.
  cardOn: '#1a1b1f',
  // The toast: a step above `cardOn`, so it lifts off whatever page it's over.
  toast: '#1b1c20',
  chip: '#0f1013',
  modal: '#0c0d0f',
  ink: '#ecebe7',
  ink2: '#a3a4a8',
  // On the card's cursor and open row (`sub2`, `sub3` over `card`) it still reads 4.5:1.
  ink3: '#999ba0',
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
  // A ghost button pressed: one step past its hover's `sub3`.
  sub4: 'rgba(255,255,255,.17)',
  stripe: 'rgba(255,255,255,.045)',
  scrim: 'rgba(0,0,0,.72)',
  // A header band on a card (days, weekdays, the day pane's and News's sections) and its text.
  band: '#1c1d22',
  bandInk: '#dcdbd7',
  // The line between a card's rows.
  rowLine: 'rgba(255,255,255,.03)',
  caution: 'oklch(0.75 0.16 40)',
  alert: 'oklch(0.72 0.17 25)',
  warm: 'oklch(0.8 0.11 55)',
  cool: 'oklch(0.8 0.11 235)',
  comf: 'oklch(0.8 0.11 165)',
  good: 'oklch(0.8 0.13 150)',
  sun: 'oklch(0.86 0.16 92)',
  violet: 'oklch(0.8 0.11 300)',
  cyan: 'oklch(0.86 0.11 182)',
  // "You are here": cool's values, named for its job so recolouring Personal never moves it.
  accent: 'oklch(0.8 0.11 235)',
  // The current page in a nav, a raised chip with an inset hairline, never mistaken for hover's `sub`.
  navOn: 'rgba(255,255,255,.10)',
  navOnEdge: 'rgba(255,255,255,.07)',
  // The HTML email frame's ring: none in Night, a hairline in Light, where white meets the page.
  mailEdge: 'transparent',
  // Search's match highlight: Night's 26% `sun` mix. Light's own, a real highlighter.
  hl: 'color-mix(in oklch, var(--sun) 26%, transparent)',
  // A focused field's border, at least as strong as hover's `edgeHover`.
  edgeFocus: 'rgba(255,255,255,.2)',
  // The forecast's sun on the grids and in the right pane: Night's `sun`, Light's a deeper amber.
  sunGlyph: 'var(--sun)',
  // A switch that's on: a `good` track and its knob, so on reads as healthy, never as a button.
  switchOn: 'color-mix(in oklch, var(--good) 58%, var(--modal))',
  switchKnobOn: 'var(--ink)',
  // The month's weekends and the days outside the shown month, and the week's weekend columns.
  dayOff: 'rgba(255,255,255,.02)',
  dayOut: '#0e0f11',
  // Today's cell on the month grid: a faint lift.
  dayToday: 'rgba(255,255,255,.035)',
  // The line's reminder phrase: a hue of its own, so it doesn't read as moving the item.
  remind: 'oklch(0.8 0.11 345)',
  // Jobs's In process: a cobalt of its own, deeper than `accent` so it never reads as the open row's bar.
  inProcess: 'oklch(0.7 0.15 258)',
  // FYI's kinds, one hue each at one lightness and chroma, clear of caution, alert and sun.
  kindDeliveries: 'oklch(0.78 0.12 70)',
  kindMoney: 'oklch(0.78 0.12 140)',
  kindUpdates: 'oklch(0.78 0.12 190)',
  kindSecurity: 'oklch(0.78 0.12 250)',
  kindCareer: 'oklch(0.78 0.12 300)',
  kindPeople: 'oklch(0.78 0.12 345)',
  // Other's kind and the Noise fold: low-chroma taupe and slate, coloured but quieter than the six.
  kindOther: 'oklch(0.74 0.05 65)',
  kindNoise: 'oklch(0.74 0.05 250)',
} as const;

export type ColourToken = keyof typeof colour;

/**
 * Light, with `page` #f6f6f4, slate inks, a white `cardOn`, a greener `cyan` and a stronger
 * calendar tint than the export's. Its frame is Night's `panel`, and is drawn as Night (nightScope).
 */
export const lightColour: Record<ColourToken, string> = {
  page: '#f6f6f4',
  frame: '#0b0c0e',
  panel: '#f1f1ee',
  card: '#ffffff',
  cardRing: 'transparent',
  cardTop: 'transparent',
  cardOn: '#ffffff',
  toast: '#ffffff',
  chip: '#ffffff',
  modal: '#ffffff',
  ink: '#1b2430',
  ink2: '#465263',
  ink3: '#566271',
  onInk: '#ffffff',
  onAccent: '#ffffff',
  onAlert: '#ffffff',
  edge: 'rgba(20,35,55,.1)',
  edgeOn: 'rgba(20,35,55,.17)',
  edgeHover: 'rgba(20,35,55,.22)',
  hair: 'rgba(20,35,55,.08)',
  sub: 'rgba(20,35,55,.04)',
  sub2: 'rgba(20,35,55,.07)',
  sub3: 'rgba(20,35,55,.11)',
  sub4: 'rgba(20,35,55,.15)',
  stripe: 'rgba(20,35,55,.05)',
  scrim: 'rgba(20,26,32,.35)',
  band: '#eef2f7',
  bandInk: '#24324a',
  rowLine: 'rgba(20,35,55,.05)',
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
  navOn: '#ffffff',
  navOnEdge: 'rgba(20,35,55,.10)',
  mailEdge: 'rgba(20,35,55,.1)',
  hl: 'oklch(0.92 0.12 96)',
  edgeFocus: 'rgba(20,35,55,.3)',
  sunGlyph: 'oklch(0.58 0.14 78)',
  switchOn: 'var(--good)',
  switchKnobOn: 'var(--onInk)',
  dayOff: 'rgba(20,35,55,.022)',
  dayOut: '#f4f6f9',
  dayToday: 'color-mix(in oklch, var(--accent) 5%, transparent)',
  remind: 'oklch(0.55 0.14 345)',
  inProcess: 'oklch(0.5 0.16 258)',
  kindDeliveries: 'oklch(0.55 0.13 70)',
  kindMoney: 'oklch(0.55 0.13 140)',
  kindUpdates: 'oklch(0.55 0.13 190)',
  kindSecurity: 'oklch(0.55 0.13 250)',
  kindCareer: 'oklch(0.55 0.13 300)',
  kindPeople: 'oklch(0.55 0.13 345)',
  kindOther: 'oklch(0.55 0.06 65)',
  kindNoise: 'oklch(0.55 0.06 250)',
};

/** Shadows: on overlays, and `lift` on the selected item (the open or selected email, a selected day-pane item). */
export const shadow = {
  pop: '0 18px 50px rgba(0,0,0,.4)',
  modal: '0 30px 80px rgba(0,0,0,.35)',
  pill: '0 10px 30px rgba(0,0,0,.3)',
  lift: '0 1px 2px rgba(0,0,0,.75), 0 2px 5px -1px rgba(0,0,0,.5)',
  // `lift`'s lower half drawn inside the top of what follows, where that covers it (a band).
  liftUnder: 'inset 0 2px 2px -1px rgba(0,0,0,.75), inset 0 3px 5px -2px rgba(0,0,0,.5)',
} as const;

export const lightShadow: Record<keyof typeof shadow, string> = {
  pop: '0 18px 50px rgba(15,20,28,.14)',
  modal: '0 30px 80px rgba(15,20,28,.18)',
  pill: '0 10px 30px rgba(15,20,28,.14)',
  lift: '0 1px 2px rgba(20,35,55,.28), 0 2px 5px -1px rgba(20,35,55,.14)',
  liftUnder: 'inset 0 2px 2px -1px rgba(20,35,55,.28), inset 0 3px 5px -2px rgba(20,35,55,.14)',
};

/** The selected item's tint: `accent` mixed into the card (`--liftTint`). */
export const liftTint = {night: 14, light: 12} as const;

/** The sample's accounts (`--a-*`) and calendars (`--c-*`). Settings lets each pick a swatch. */
export const accountColour = {business: 'warm', personal: 'cool', work: 'comf', jobs: 'violet', icloud: 'ink2'} as const satisfies Record<string, Colour>;
export const calendarColour = {personal: 'cool', classes: 'cyan', jobs: 'violet'} as const satisfies Record<string, Colour>;

/** Calendar chips' tint (`--evtint`). */
export const evtint = {night: 16, light: 14} as const;
/** What a calendar chip lays over itself under the pointer, in its own colour (`--evhover`). */
export const evhover = {night: 18, light: 14} as const;
/** Where a chip's tint starts as its change lands, settling back to `--evtint` (`--evland`). */
export const evland = {night: 34, light: 26} as const;
/**
 * Coloured text on its own tint (calendar chips, week blocks, the editor's timeline) caps its
 * lightness at `--tintL`. Light's hues are tuned for text on the page and wash out on a tint.
 * Night's aren't capped.
 */
export const tintL = {night: 1, light: 0.43} as const;
/**
 * The bands on a card: Attention's is `caution`, today's `accent` and FYI's `accent`, mixed into the
 * card at these shares (`--attBand`, `--fyiBand`). FYI's band text is `--fyiBandInk`.
 */
export const attBand = {night: 12, light: 10} as const;
export const fyiBand = {night: 6, light: 7} as const;
export const fyiBandInk = {night: 'var(--accent)', light: 'oklch(0.47 0.12 235)'} as const;
/** The Inbox's empty pane's glow: the mark's colours mixed in at this share at its heart. Light's darker colours need more to show on its page. */
export const paneGlow = {night: 10, light: 18} as const;
/** FYI's cell in that pane's strip: `cool` mixed into `cardOn` at this share, faint enough not to read as `accent`. */
export const fyiWash = {night: 4, light: 9} as const;
/**
 * Small coloured text keeps this share of its colour, the rest `ink`: Light's green, blue,
 * orange, red and yellow sit near 4.5:1 on its page and fall under it on a hovered, cursor or open row, so
 * there they lean toward `ink`. Night keeps all of it. `washTint` is for text on its own colour's wash (Copied).
 */
export const textTint = {night: 100, light: 80} as const;
export const washTint = {night: 100, light: 65} as const;
/** The HTML email frame's brightness: Night takes the glare off its white, Light leaves it. */
export const mailDim = {night: 0.95, light: 1} as const;
/**
 * Todoist's colours, which aren't theme-tuned, clamped to the calendar tokens' lightness band:
 * a task's ring (and its project's mark in the editor's line) keeps Todoist's hue and chroma at a
 * lightness of at least `ringMin` and at most `ringMax`.
 */
export const ringL = {night: {min: 0.72, max: 1}, light: {min: 0, max: 0.55}} as const;

/** The thin dark scrollbar (mantel's). */
export const scrollbar = {size: 10, thumb: 'rgba(255,255,255,.16)', lightThumb: 'rgba(20,35,55,.22)', inset: 3} as const;

export const font = {
  sans: "'Geist Variable', system-ui, sans-serif",
  mono: "'Geist Mono Variable', ui-monospace, monospace",
  features: '"ss01"',
} as const;

/** DESIGN.md › Shape, in the table's order. Settings' row groups are 16. */
export const radius = {pill: 999, modal: 26, popover: 18, card: 14, bar: 12, row: 10, segment: 8, chip: 6, hint: 5} as const;

/**
 * mantel's timings, a press going in (its release takes `fast`), and a lifted
 * calendar chip's tilt and scale.
 */
export const motion = {fast: 120, medium: 180, slow: 260, press: 80, ease: 'cubic-bezier(.2,0,0,1)', liftTilt: -1.5, liftScale: 1.04} as const;

/**
 * A segmented control's thumb: a damped spring (ratio .8) over `ms`, 95% of the way there by
 * about 125 ms and 1.5% past it before it settles. The label it lands on takes `ink` over `inkMs`
 * after `inkDelayMs`, as the thumb arrives. The one it leaves lets go at once.
 */
export const thumb = {
  ms: 380,
  spring: 'linear(0, 0.07 4%, 0.223 8%, 0.399 12%, 0.565 16%, 0.705 20%, 0.813 24%, 0.893 28%, 0.947 32%, 0.992 38%, 1.012 45%, 1.014 55%, 1.004 70%, 1 85%, 1)',
  inkMs: 90,
  inkDelayMs: 60,
} as const;

/**
 * Loading (DESIGN.md › Motion): a skeleton's bars are `sub2` on the page and `sub3` inside a `sub`
 * group (Settings, cards). A skeleton appears only after `delayMs`, so a fast answer never flashes
 * one. It fades in over motion.medium, then breathes, every bar in phase, its opacity down to
 * `breatheLow` and back over `breatheMs`. What replaces it fades in over motion.fast. The one loop
 * beside the spinner's 900 ms turn.
 */
export const skeleton = {fill: 'sub2', fillOnSub: 'sub3', delayMs: 200, breatheMs: 1600, breatheLow: 0.45, breatheEase: 'cubic-bezier(.4,0,.6,1)'} as const;

/** The floating detail's glide (design-export/motion/glide.json). */
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
  // The contents crossfade, overlapping by 50 ms, so the card never travels blank.
  // glide.json still says 0–90 out and 90–220 in.
  oldContentOutMs: 120,
  newContentInFromMs: 70,
  newContentInToMs: 220,
  newContentSlidePx: 6,
  selectionSolidAtMs: 60,
  openMs: 180,
  openScale: 0.96,
  closeMs: 120,
  closeScale: 0.98,
  editMs: 220,
  editorSlidePx: 12,
  // The build's, where glide.json gives no figure (reviewed by eye): how far the card
  // shrinks as it hands over to the editor, and how long a retarget's carried velocity lasts
  // (its time constant) before the new glide alone moves the card.
  editScale: 0.9,
  retargetMomentumMs: 24,
} as const;

/** Where the floating detail and every overlay anchored to a calendar item go. */
export const placement = {gapPx: 8, sides: ['right', 'left', 'above', 'below']} as const;

/**
 * Dragging a chip (board 15): how far a press moves before it lifts, and where the
 * tooltip naming the day and time sits from the lifted chip's top left (board 15: 18 right, 30 down).
 */
export const drag = {thresholdPx: 4, tipOffset: {left: 18, top: 30}} as const;

/**
 * The shared tooltip: how long the pointer rests before it shows, quick on what it
 * reveals where you've stopped to read (`data-tip-quick`) and patient elsewhere, on controls and on what
 * the mouse passes over. It also sets how far it sits from what it names, and how close it may
 * come to the window's edges.
 */
export const tip = {quickMs: 80, patientMs: 500, gapPx: 6, marginPx: 8} as const;

/**
 * The week view (board 16): the hour grid's measures, the all-day row's lines,
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

/**
 * The month grid's paging: P, N and Today
 * glide the grid over `slow`. More than `farRows` away, it first jumps to `leadRows` short of the
 * month, on the side it comes from, and glides those. The header's title swaps as it goes, rising
 * (or falling, or sliding with the week) `titleShiftPx` over `fast`.
 */
export const monthPaging = {glideMs: motion.slow, farRows: 10, leadRows: 5, titleShiftPx: 6, titleMs: motion.fast} as const;

/**
 * News: how long a row stays fully on screen before its story
 * is seen, and how long a story N brings onto the list takes to settle in (DESIGN.md › Motion).
 */
export const news = {seenAfterMs: 1000, landedMs: 900} as const;

/**
 * The overdue banner's two arrival motions (DESIGN.md › Motion), in ms on `motion.ease` unless an
 * easing is given. Reveal: the veil fades in over `veilIn` and the label over `labelIn`; the title
 * slides up from `titleFromPct`% of its height, behind a mask `maskPx` taller above and below, from
 * `titleDelay` over `title` on `titleEase`; then the due line or the list rises `dueRisePx` and
 * fades in from `dueDelay` over `due`. The press goes in to `pressScale`. The hint fades in over
 * `hint`, `hintDelay` after the banner enters. Return to its row: what doesn't return fades over
 * `rest`; each title due today flies to its Today line over `fly` on `flyEase`, `flyStagger`
 * apart, opaque until `flyHoldPct`% of the way; the veil fades from `veilOutDelay` over `veilOut`;
 * the line takes `caution` at `landTintPct`% fading to none over `land`, a calendar change's
 * landing. Where no line is on screen, the titles shrink to `iconScale` of a line's size, opaque
 * to `iconHoldPct`%, on the overdue-task icon, which scales in from `iconFrom` over `iconIn`, 18 px
 * under the sidebar's nav, and on their arrival takes `caution` at `iconTintPct`%, settling to
 * `iconSettlePct`% by `iconSettleAt`%, held to `iconHoldAt`%, then goes, over `iconLand`.
 * The snooze buttons fade in over `snoozeIn` once the title is up. A snoozed title fades where it is
 * over `snoozeOut`, then its row closes up over `closeUp`, and a task taking its place fades in
 * over `closeUp`.
 */
export const overdue = {
  veilIn: 320, labelIn: 240, titleDelay: 80, title: 560, titleEase: 'cubic-bezier(.16,1,.3,1)', titleFromPct: 112, maskPx: 7,
  dueDelay: 320, due: 320, dueRisePx: 6, pressScale: 0.985, hintDelay: 1400, hint: 260,
  rest: motion.fast, fly: 420, flyEase: 'cubic-bezier(.5,0,.2,1)', flyStagger: 50, flyHoldPct: 80, veilOutDelay: 60, veilOut: 360,
  land: 420, landTintPct: 30,
  iconScale: 0.3, iconHoldPct: 55, iconFrom: 0.8, iconIn: 180, iconGapPx: 18, iconLand: 1200, iconTintPct: 34, iconSettlePct: 12, iconSettleAt: 45, iconHoldAt: 75,
  snoozeIn: motion.medium, snoozeOut: motion.medium, closeUp: motion.medium,
} as const;

/**
 * The completion moment (DESIGN.md › Motion), in ms on `motion.ease` unless an easing is given. Six
 * `dotPx` dots in the ring's colour fly `dotFromPx` to `dotToPx` from its centre, 60° apart, fading over
 * `dots`; the done check pops from `popFrom` through `popPeak` to 1 over `pop` on `popEase`. A `good`
 * highlight at `sweepTintPct`% sweeps across the title over the first `sweepInPct`% of `moment`, then
 * fades; the strike draws over `strike`, the title goes `ink3` over `ink` and moves `nudgePx` right and
 * back over `nudge`. The Today block's line folds once `moment` is over.
 */
export const completion = {
  moment: 640, dots: 420, dotPx: 3, dotFromPx: 4, dotToPx: 14, pop: 280, popEase: 'cubic-bezier(.3,0,.2,1)', popFrom: 0.5, popPeak: 1.18,
  sweepInPct: 40, sweepTintPct: 24, strike: motion.slow, ink: motion.medium, nudge: 300, nudgePx: 3,
} as const;

/**
 * A proposal's prefill landing (DESIGN.md › Motion): each field it filled fades in under the completion
 * moment's sweep, the fields top to bottom `staggerMs` apart.
 */
export const prefill = {staggerMs: 60} as const;

/** Fixed sizes in px. */
export const layout = {
  sidebar: 248,
  // The sidebar in the compact tier.
  rail: 56,
  header: 56,
  readingPane: 680,
  rightPane: 400,
  // The gap between the content cards and between them and the frame's edges.
  cardGap: 8,
  // 360, wider than board 12a's 280, so a long title wraps to fewer lines.
  floatingDetail: 360,
  monthRow: 176,
  weekdayRow: 30,
  dayHead: 22,
  calendarChip: 20,
  settingsWidth: 1040,
  settingsHeight: 720,
  settingsNav: 220,
  settingsRow: 52,
  settingsGroupRadius: 16,
  calendarRow: 30,
  miniDay: 26,
  mailSearch: 380,
  attachment: 280,
  // The board's .cmdk (about 637).
  palette: 640,
} as const;

/**
 * The design target, the phone layout's breakpoint, the compact tier's (the rail always, panes over
 * what they'd squeeze), the width below which the sidebar starts as the rail, and the page's
 * zoom steps (1.075 from 1440 px for a MacBook, 1.25 from 2200). CSS media queries spell
 * them out. Phone.tsx's hooks and sidebarRail.ts read the breakpoints from here.
 */
export const viewport = {target: {width: 1677, height: 1050}, phoneBelow: 640, compactBelow: 1100, railBelow: 1600, zoom: [{from: 1440, zoom: 1.075}, {from: 2200, zoom: 1.25}]} as const;

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
  vars['--thumb-dur'] = `${thumb.ms}ms`;
  vars['--thumb-spring'] = thumb.spring;
  vars['--thumb-ink'] = `${thumb.inkMs}ms`;
  vars['--thumb-ink-delay'] = `${thumb.inkDelayMs}ms`;
  vars['--news-landed'] = `${news.landedMs}ms`;
  // The overdue banner's: `--ov-<name>`, a time in ms, a percentage or a plain number.
  for (const [name, value] of Object.entries(overdue)) {
    vars[`--ov-${name}`] = typeof value === 'string' ? value : /(Pct|At)$/.test(name) ? `${value}%` : name.endsWith('Px') ? `${value}px` : /Scale|From$/.test(name) ? String(value) : `${value}ms`;
  }
  // The completion moment's: `--done-<name>`, and the sweep's two parts, in and out.
  for (const [name, value] of Object.entries(completion)) {
    vars[`--done-${name}`] = typeof value === 'string' ? value : name.endsWith('Pct') ? `${value}%` : name.endsWith('Px') ? `${value}px` : /^pop[A-Z]/.test(name) ? String(value) : `${value}ms`;
  }
  vars['--done-sweepIn'] = `${completion.moment * completion.sweepInPct / 100}ms`;
  vars['--done-sweepOut'] = `${completion.moment * (100 - completion.sweepInPct) / 100}ms`;
  vars['--prefill-stagger'] = `${prefill.staggerMs}ms`;
  vars['--skel'] = `var(--${skeleton.fill})`;
  vars['--skel-on-sub'] = `var(--${skeleton.fillOnSub})`;
  vars['--skel-delay'] = `${skeleton.delayMs}ms`;
  vars['--skel-breathe'] = `${skeleton.breatheMs}ms`;
  vars['--skel-low'] = String(skeleton.breatheLow);
  vars['--skel-ease'] = skeleton.breatheEase;
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
  vars['--titleShift'] = `${monthPaging.titleShiftPx}px`;
  vars['--titleSwap'] = `${monthPaging.titleMs}ms`;
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
  vars['--evland'] = `${light ? evland.light : evland.night}%`;
  vars['--scrollbar-thumb'] = light ? scrollbar.lightThumb : scrollbar.thumb;
  vars['--tintL'] = String(light ? tintL.light : tintL.night);
  vars['--paneGlow'] = `${light ? paneGlow.light : paneGlow.night}%`;
  vars['--fyiWash'] = `${light ? fyiWash.light : fyiWash.night}%`;
  vars['--attBand'] = `${light ? attBand.light : attBand.night}%`;
  vars['--liftTint'] = `${light ? liftTint.light : liftTint.night}%`;
  vars['--fyiBand'] = `${light ? fyiBand.light : fyiBand.night}%`;
  vars['--fyiBandInk'] = light ? fyiBandInk.light : fyiBandInk.night;
  vars['--textTint'] = `${light ? textTint.light : textTint.night}%`;
  vars['--washTint'] = `${light ? washTint.light : washTint.night}%`;
  vars['--mailDim'] = String(light ? mailDim.light : mailDim.night);
  vars['--ringMin'] = String((light ? ringL.light : ringL.night).min);
  vars['--ringMax'] = String((light ? ringL.light : ringL.night).max);
  return vars;
}

/**
 * The Night scope: an element marked `data-theme="night"` draws its subtree as Night in full, inks,
 * hues, fills and fields, whatever the page's theme (Light's frame). `--frame` is left out, so the
 * frame keeps its own theme's colour. The theme-free variables that point at theme ones (accounts,
 * calendars, skeletons) are declared again, since root's resolve to its own theme's. A rule keyed
 * on the page's theme matches inside the scope too, so one meant for Light alone says
 * `[data-theme="light"] .x:not([data-theme="night"] *)`, and one for Night `[data-theme="night"] .x`.
 */
export function nightScope(): string {
  const all = cssVariables();
  const pointing = Object.entries(all).filter(([, value]) => value.startsWith('var(--'));
  const vars = [...Object.entries(themeVariables('night')).filter(([name]) => name !== '--frame'), ...pointing];
  const body = vars.map(([name, value]) => `${name}: ${value};`).join(' ');
  return `[data-theme="night"]:not(:root) { ${body} color: var(--ink); color-scheme: dark; }`;
}

export function applyTokens(root: HTMLElement) {
  for (const [name, value] of Object.entries(cssVariables())) root.style.setProperty(name, value);
  const doc = root.ownerDocument;
  let rule = doc.head.querySelector<HTMLStyleElement>('style[data-night-scope]');
  if (!rule) {
    rule = doc.createElement('style');
    rule.dataset.nightScope = '';
    doc.head.append(rule);
  }
  rule.textContent = nightScope();
}

/** Draws the page in a theme: its tokens, and the browser's own controls to match. */
export function applyTheme(root: HTMLElement, theme: Theme) {
  for (const [name, value] of Object.entries(themeVariables(theme))) root.style.setProperty(name, value);
  root.style.colorScheme = theme === 'light' ? 'light' : 'dark';
  root.dataset.theme = theme;
}
