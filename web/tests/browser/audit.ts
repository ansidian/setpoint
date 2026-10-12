// The design-conformance audit (SV-33, D69): each board beside the app's approved screenshot of the
// same state (goldens/), with a diff, on one page to read, test-results/audit/index.html. It has no
// pass or fail. Each board is drawn by Chromium at its exact size from design-export/boards/, and
// News's from design-export/news/boards/ (SV decision D7: the export holds board HTML, not PNGs),
// after its listed patches: DESIGN.md's
// Overrides to the export, and where the dev seed (decision D3) or DESIGN.md's own text says
// otherwise than the board. The patches are the differences already decided, so what the diff
// still shows is either a patch nobody wrote yet or a real gap. Every patch must match its board
// exactly once, so a changed board fails loudly. Run it when a decision changes the screen, after
// `npm run goldens`, and before a release:
//
//   npm run audit:boards
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {colour, evtint, lightColour} from '../../src/tokens.ts';
import {closeBrowser, compareImages, GOLDENS, launchBrowser, ROOT} from './harness.ts';

export interface Patch {
  why: string;
  from: string;
  to: string;
  // How many times `from` appears, each replaced: once unless said.
  times?: number;
}

export interface Board {
  name: string;
  file: string;
  width: number;
  height: number;
  patches: Patch[];
  // A board of phones (21): the audit takes this one phone (0, 1, 2 from the left), 390 × 844.
  phone?: number;
  // Its folder under design-export/: round 2's boards/ unless said (News's are news/boards/).
  dir?: string;
}

const NORTHWIND_BODY_BOARD = `<p>Please pick a time that works for you. Slots are open Wednesday through Friday, 10:00 AM – 4:00 PM Pacific.</p>
          <p><a href="#" style="display: inline-flex; align-items: center; height: 36px; padding: 0 16px; border-radius: 8px; background: #1b6f5a; color: #ffffff; text-decoration: none; font-weight: 500">Pick a time</a></p>`;

const CODE_ROW = `
      <div class="row unread">
        <span class="ud"></span>
        <span class="from">Contoso Insurance</span>`;

// Seed (D3): Gym has recurred Mon/Wed/Fri since Aug 31 and the lecture Tue/Thu since Aug 25, so
// the weeks either side of October hold them too; boards 11 and 11b leave Sep 28–30 and Nov 4–6 empty.
const outChip = (day: string, calendar: 'personal' | 'classes', time: string, title: string, past: boolean): Patch => ({
  why: `Seed (D3): ${title} on ${day}`,
  from: `<div class="cell out"><div class="dhead"><span class="dn">${day.split(' ')[1]}</span></div></div>`,
  to: `<div class="cell out"><div class="dhead"><span class="dn">${day.split(' ')[1]}</span></div>
          <div class="ev${past ? ' past' : ''}" style="--c: var(--c-${calendar})"><span class="t">${time}</span>${title}</div>
        </div>`,
});
const CALENDAR_SEED_PATCHES: Patch[] = [
  outChip('Sep 28', 'personal', '7 AM', 'Gym', true),
  outChip('Sep 29', 'classes', '6 PM', 'CS 101 lecture', true),
  outChip('Sep 30', 'personal', '7 AM', 'Gym', true),
  outChip('Nov 4', 'personal', '7 AM', 'Gym', false),
  outChip('Nov 5', 'classes', '6 PM', 'CS 101 lecture', false),
  outChip('Nov 6', 'personal', '7 AM', 'Gym', false),
];

// SV-25 (D54): an open task's ring takes its Todoist project's colour, the seed's School sky_blue
// and Home orange (Todoist's hex, as shared's TODOIST_COLOURS has them).
const SCHOOL = '#319dc0';
const HOME = '#c77100';
const gridRing = (title: string, hex: string): Patch => ({
  why: `SV-25 (D54): ${title}'s ring in its project's colour`, from: `<span class="ring"></span>${title}<`, to: `<span class="ring" style="border-color: ${hex}"></span>${title}<`,
});
const agendaRing = (title: string, hex: string): Patch => ({
  why: `SV-25 (D54): ${title}'s ring in its project's colour (the agenda)`,
  from: `border-color: var(--ink2); margin-left: 2px"></span>\n        <span class="grow" style="color: var(--ink)">${title}</span>`,
  to: `border-color: ${hex}; margin-left: 2px"></span>\n        <span class="grow" style="color: var(--ink)">${title}</span>`,
});
// SV-29: weeks start on Sunday. The boards draw Monday first, Sep 28 – Nov 8; Sunday first, the same
// six rows run Sep 27 – Nov 7 (and the mini-month's five, Sep 27 – Oct 31), every day one column on.
const SUNDAY_FIRST: Patch[] = [
  {why: 'SV-29: the weekday row starts on Sunday',
    from: '<div class="cal-dow"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>',
    to: '<div class="cal-dow"><span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span></div>'},
  {why: '… so the grid starts a day earlier, on Sep 27', from: '<!-- Sep 28 – Oct 4 -->\n        <div class="cell out"><div class="dhead"><span class="dn">28</span></div></div>',
    to: '<!-- Sep 27 – Oct 3 -->\n        <div class="cell out weekend"><div class="dhead"><span class="dn">27</span></div></div>\n        <div class="cell out"><div class="dhead"><span class="dn">28</span></div></div>'},
  {why: '… and ends a day earlier, on Nov 7', from: '\n        <div class="cell out weekend"><div class="dhead"><span class="dn">8</span></div></div>', to: ''},
  {why: '… the mini-month\'s heads too',
    from: '<span class="h">M</span><span class="h">T</span><span class="h">W</span><span class="h">T</span><span class="h">F</span><span class="h">S</span><span class="h">S</span>',
    to: '<span class="h">S</span><span class="h">M</span><span class="h">T</span><span class="h">W</span><span class="h">T</span><span class="h">F</span><span class="h">S</span>'},
  {why: '… its first row from Sep 27', from: '<span class="o">28</span>', to: '<span class="o">27</span><span class="o">28</span>'},
  {why: '… and no Nov 1 after Oct 31', from: '<span>31</span><span class="o">1</span>', to: '<span>31</span>'},
];
const GRID_RINGS: Patch[] = [gridRing('CS 101 lab report', SCHOOL), gridRing('Pay rent', HOME), gridRing('Renew car registration', HOME)];
const AGENDA_OCT_7_RINGS: Patch[] = [agendaRing('CS 101 lab report', SCHOOL), agendaRing('Pay rent', HOME)];

const cellTemps = (tone: string, glyph: string, temps: string): Patch => ({
  why: `Decided while building #15: a day cell shows the forecast's high and low, ${temps}, before its weather icon`,
  from: `<span class="ms wx ${tone}">${glyph}</span>`,
  to: `<span class="wx ${tone}" style="display: inline-flex; align-items: center; gap: 4px"><span class="num" style="font-size: 11.5px; color: var(--ink3); white-space: nowrap">${temps}</span><span class="ms" style="font-size: 16px">${glyph}</span></span>`,
});
// The October grid's Oct 7, 8 and 13 forecasts (seed D3).
const CELL_TEMPS: Patch[] = [cellTemps('sun', 'sunny', '78° / 61°'), cellTemps('cloud', 'cloud', '72° / 59°'), cellTemps('rain', 'rainy', '64° / 55°')];
// Decided while building #16: October's boundary traced along the top of Oct 1 – 7 and the left of
// Oct 1, and November's along the top of Nov 1 – 7, in `cool` (cells 5 – 11 and 36 – 42 of a grid
// from Sep 27).
const MONTH_EDGES: Patch = {
  why: 'Decided while building #16: each month\'s boundary is traced on the grid, a 1.5 px line along the top of its first days and the left of its 1st',
  from: '<div class="cal-grid" style="grid-auto-rows: 176px; flex: none">',
  to: '<style>.sp .cal-grid > .cell:is(:nth-child(n+5):nth-child(-n+11), :nth-child(n+36):nth-child(-n+42))::after { content: ""; position: absolute; inset: 0; pointer-events: none; border-top: 1.5px solid var(--cool); }\n'
    + '.sp .cal-grid > .cell:nth-child(5)::after { border-left: 1.5px solid var(--cool); }</style>\n'
    + '      <div class="cal-grid" style="grid-auto-rows: 176px; flex: none">',
};
// #78 (override 15): the Today block names the seed's three tasks, each ring in its project's
// colour, tomorrow's marked "Tomorrow", where every board with the block counts them. Applied to
// each board that has the block (patchedBoard), so no board lists it.
const todayTask = (title: string, hex: string, label = '') =>
  `<a class="today-row" href="#"><span class="ring" style="margin: 0 3px 0 1px; border-color: ${hex}"></span><span class="ell" style="color: var(--ink)">${title}</span>${label && `<span class="in">${label}</span>`}</a>`;
const TODAY_NAMED: Patch = {
  why: '#78 (override 15): the Today block names its tasks',
  from: `<a class="today-row" href="#"><span class="ring" style="margin: 0 3px 0 1px"></span><span>2 due today</span></a>
    <a class="today-row" href="#"><span class="ring" style="margin: 0 3px 0 1px"></span><span>1 due tomorrow</span></a>`,
  to: [todayTask('CS 101 lab report', SCHOOL), todayTask('Pay rent', HOME), todayTask('Renew car registration', HOME, 'Tomorrow')].join('\n    '),
};
// N4 (DESIGN.md › News › Shell): the sidebar's News item under Calendar, with no count, on every
// board with the sidebar; its icon is drawn from glyphs/icons.json, which the round-2 font lacks.
const NEWSPAPER = JSON.parse(fs.readFileSync(path.join(ROOT, 'design-export', 'glyphs', 'icons.json'), 'utf8')).newspaper.d as string;
const NEWS_NAV = `\n  <a class="nav" href="#"><svg class="ms" width="18" height="18" viewBox="0 -960 960 960" fill="currentColor" style="display: block; flex: none"><path d="${NEWSPAPER}"></path></svg><span class="grow">News</span></a>`;
const newsNav = (calendar: string): Patch => ({why: 'N4: the sidebar\'s News item under Calendar, with no count', from: calendar, to: `${calendar}${NEWS_NAV}`});

// N5 (DESIGN.md › News in Settings): Settings' nav adds News between Mail and AI, with the `caution`
// warning glyph while a feed fails (the seed's FOX 11 does), on every round-2 board with the nav.
const SETTINGS_NEWS_NAV: Patch = {
  why: 'N5 (DESIGN.md › News in Settings): Settings\' nav lists News between Mail and AI, its warning glyph while the seed\'s FOX 11 fails',
  from: '<span class="grow">Mail</span></a>\n    <a class="nav" href="#"><span class="ms">auto_awesome</span>',
  to: `<span class="grow">Mail</span></a>\n    <a class="nav" href="#"><svg class="ms" width="18" height="18" viewBox="0 -960 960 960" fill="currentColor" style="display: block; flex: none"><path d="${NEWSPAPER}"></path></svg><span class="grow">News</span><span class="ms s16" style="color: var(--caution)">warning</span></a>\n    <a class="nav" href="#"><span class="ms">auto_awesome</span>`,
};

// Override 31: the polish audit's token values over the export's, for every board (each links fonts.css once).
const AUDIT_TOKENS: Patch = {
  why: 'Override 31: the polish audit\'s token values (Night ink3, panel and cyan; Light ink2, cardOn, cyan and the calendar tint)',
  from: 'styles/fonts.css">',
  to: `styles/fonts.css">\n<style>.sp{--ink3:${colour.ink3};--panel:${colour.panel};--cyan:${colour.cyan}} .sp.light{--ink2:${lightColour.ink2};--cardOn:${lightColour.cardOn};--cyan:${lightColour.cyan};--evtint:${evtint.light}%}</style>`,
};

/** Patches for every board that draws what they change; a board without it skips them. */
const EVERY_BOARD: Patch[] = [
  AUDIT_TOKENS,
  TODAY_NAMED,
  SETTINGS_NEWS_NAV,
  newsNav('\n  <a class="nav" href="#" style="margin-top: 2px"><span class="ms">calendar_month</span><span class="grow">Calendar</span></a>'),
  newsNav('\n  <a class="nav on" href="#"><span class="ms">calendar_month</span><span class="grow">Calendar</span></a>'),
];

// Decided while building #87: the mark is Day stack (Icon.tsx's Mark), where every board draws the
// placeholder, twice on board 21, so it's replaced wherever it appears rather than as a patch.
const PLACEHOLDER_MARK = '<svg width="18" height="18" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-dasharray="31 10" stroke-linecap="round" transform="rotate(-38 11 11)"></circle><circle cx="15.6" cy="6.4" r="2" fill="currentColor"></circle></svg>';
const DAY_STACK = '<svg width="18" height="18" viewBox="0 0 22 22" aria-hidden="true"><rect x="2" y="2.6" width="13.5" height="4.6" rx="2.3" style="fill: var(--cool)"></rect><rect x="5.5" y="8.7" width="13.5" height="4.6" rx="2.3" style="fill: var(--caution)" transform="rotate(-6 12.25 11)"></rect><rect x="2" y="14.8" width="10" height="4.6" rx="2.3" style="fill: var(--violet)"></rect></svg>';

const BOARDS_DIR = path.join(ROOT, 'design-export', 'boards');
const NEWS_DIR = 'news/boards';
/** A board's markup from the line holding `start` to the end of `end`, for an annotation patched out whole. */
function boardBlock(file: string, start: string, end: string, dir = 'boards'): string {
  const html = fs.readFileSync(path.join(ROOT, 'design-export', dir, file), 'utf8');
  const from = html.indexOf(start);
  const to = html.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`${file}: no block from "${start}" to "${end}".`);
  return html.slice(from, to + end.length);
}

const num = (text: string): Patch => ({
  why: `DESIGN.md › Type: tabular figures on times, as 11b draws the agenda's spans: ${text}`,
  from: `<span class="ink3" style="font-size: 12.5px">${text}</span>`, to: `<span class="ink3 num" style="font-size: 12.5px">${text}</span>`,
});

/**
 * #125 (override 29): an event's line names its calendar, and its place has a line of its own with
 * `location_on` (the boards draw the place where the calendar goes).
 */
const placed = (time: string, calendar: string, place: string): Patch => ({
  why: `#125 (override 29): the line names the calendar, the place on its own line: ${time} · ${calendar}, then ${place}`,
  from: `<span class="ink3" style="font-size: 12.5px">${time} · ${place}</span>`,
  to: `<span class="ink3 num" style="font-size: 12.5px">${time} · ${calendar}</span><span class="ink3" style="font-size: 12.5px; display: flex; align-items: center; gap: 6px; margin-top: 4px"><span class="ms s16">location_on</span>${place}</span>`,
});

// Wed, Oct 7's agenda as boards 11 and 12a draw it, with Time to Leave from the time-to-leave fixture.
const AGENDA_OCT_7_PATCHES: Patch[] = [num('7:00 – 8:00 AM · Personal'), placed('2:30 – 3:30 PM', 'Personal', 'Smile Dental')];

// Fri, Oct 9 as boards 12b and 12d draw it, Dinner with Sam selected and its card at rest beside it.
const DINNER_PATCHES: Patch[] = [
  {why: 'DESIGN.md › Sidebar on Calendar: the selected day is `sub` in the mini-month (the board draws `sub2` with `ink` text)',
    from: '<span style="background: var(--sub2); color: var(--ink)">9</span>', to: '<span class="vis">9</span>'},
  {why: 'D17: a day with no forecast shows its counts under the date ("In 2 days" isn\'t in DESIGN.md › Right pane)',
    from: '<div class="ink2" style="font-size: 12.5px; margin-top: 2px">In 2 days</div>', to: '<div class="ink3 num" style="font-size: 12.5px; margin-top: 2px">3 events</div>'},
  {why: 'F4\'s agenda draws every upcoming event\'s title at 500, as board 11 does (12b draws only the selected one so)',
    from: '<span style="display: block; color: var(--ink)">Gym</span>', to: '<span style="display: block; color: var(--ink); font-weight: 500">Gym</span>'},
  {why: '… and Study group\'s', from: '<span style="display: block; color: var(--ink)">Study group</span>', to: '<span style="display: block; color: var(--ink); font-weight: 500">Study group</span>'},
  num('7:00 – 8:00 AM · Personal'), num('6:30 – 8:30 PM · Classes'), placed('7:00 – 9:00 PM', 'Personal', 'Blue Door'),
  {why: 'DESIGN.md › The floating detail: Time to Leave comes before attendees (place, Time to Leave, attendees, reminder, calendar)',
    from: `        <div class="fact"><span class="ms">group</span><span>Sam Lee</span></div>
        <div class="fact"><span class="ms">directions_car</span><span class="num"><span class="v">Leave by 6:35 PM</span> · 21 min</span></div>`,
    to: `        <div class="fact"><span class="ms">directions_car</span><span class="num"><span class="v">Leave by 6:35 PM</span> · 21 min</span></div>
        <div class="fact"><span class="ms">group</span><span>Sam Lee</span></div>`},
  {why: 'SV-29: with Sunday first, Friday has only Saturday to its right, too narrow for the card, so it sits below Dinner with Sam, centred on it',
    from: 'aria-label="Dinner with Sam" style="position: absolute; left: 736px; top: 153px;', to: 'aria-label="Dinner with Sam" style="position: absolute; left: 668px; top: 311px;'},
];

// The code row as boards 02, 03, 09 and 10 draw it, last in Security.
const CODE_ROW_LAST = `${CODE_ROW}
        <span class="subj" style="display: flex; align-items: center; gap: 10px"><span class="code">482 913</span><button class="btn ghost sm" style="height: 22px; padding: 0 8px; font-size: 12px"><span class="ms s16" style="font-size: 14px">content_copy</span>Copy</button><span class="sum" style="font-size: 12px">Expires in 11 min</span></span>
        <span class="ac"><span class="dot sm" style="--c: var(--a-personal)"></span>Personal</span>
        <span class="age">4m</span>
      </div>`;
const SIGN_IN_ROW_START = `      <div class="row unread">
        <span class="ud"></span>
        <span class="from">Google</span>
        <span class="subj"><b>New sign-in</b>`;

/** D9: a group's rows are newest first, so Contoso's code (4m) leads Security; the boards follow the brief's table order. */
function codeLeadsSecurity(nextHeader: string): Patch[] {
  return [
    {why: 'Seed (D3) and D9: Security is newest first, so Contoso\'s code (4m) leads it', from: SIGN_IN_ROW_START, to: `${CODE_ROW_LAST.slice(1)}\n${SIGN_IN_ROW_START}`},
    {why: '… and leaves its old place at the end of Security', from: `${CODE_ROW_LAST}\n\n      ${nextHeader}`, to: `\n\n      ${nextHeader}`},
  ];
}

/** Override 2 (decision 48): with a Personal email that was unread open, the sidebar reads Inbox (3) 18 and Personal 7. */
const openedPersonal = (which: string): Patch[] => [
  {why: `Override 2 (decision 48): with ${which} open the sidebar reads Inbox (3) 18`, from: '<span class="apill num">3</span><span class="cnt num">19</span>', to: '<span class="apill num">3</span><span class="cnt num">18</span>'},
  {why: '… and Personal 7', from: 'Personal<span class="cnt num">8</span>', to: 'Personal<span class="cnt num">7</span>'},
];

const DELIVERIES_PREVIEW: Patch = {why: 'Seed (D3) and D9: a collapsed group\'s organisations, newest first (Consolidated Messenger 2h, Wingtip Toys 6h, Southridge Video Mon)', from: 'Wingtip Toys · Consolidated Messenger · Southridge Video', to: 'Consolidated Messenger · Wingtip Toys · Southridge Video'};
const MONEY_PREVIEW: Patch = {why: 'Seed (D3) and D9: newest first (Woodgrove Bank 5h, Proseware 8h, Woodgrove Pay yesterday)', from: 'Woodgrove Bank · Woodgrove Pay · Proseware', to: 'Woodgrove Bank · Proseware · Woodgrove Pay'};
const FABRIKAM: Patch = {why: 'Seed (D3) and DESIGN.md › The list: Fabrikam\'s subject is "Application received", its summary "Data Analyst", then its platform',
  from: '<b>Application received · Data Analyst</b> <span class="sum">· via Workday</span>', to: '<b>Application received</b> <span class="sum">· Data Analyst · via Workday</span>'};

// Decided while building #35 (SV-25): in the Inbox's list a row's summary takes its subject's place,
// the platform still after it. All keeps the subject, so board 05 takes none of these.
const summaryLeads = (subject: string, summary: string, via?: string): Patch => ({
  why: `Decided while building #35: the summary takes the subject's place (${subject})`,
  from: `<b>${subject}</b> <span class="sum">· ${summary}${via ? ` · via ${via}` : ''}</span>`,
  to: `<b>${summary}</b>${via ? ` <span class="sum">· via ${via}</span>` : ''}`,
});
const PARKSIDE_SUMMARY = summaryLeads('Lease renewal terms', 'Renewal offer for the lease ending Nov 30 · sign by Oct 31');
// After FABRIKAM's patch, which gives the row the seed's subject and summary.
const FABRIKAM_SUMMARY = summaryLeads('Application received', 'Data Analyst', 'Workday');
const INBOX_SUMMARIES: Patch[] = [PARKSIDE_SUMMARY, FABRIKAM_SUMMARY];

// Decided while building #36 and #105: U on the Inbox switches Unread and All, its hint on the one it switches to.
const viewHint = (on: 'Unread' | 'All'): Patch => {
  const seg = (hint: string) => (on === 'Unread' ? `<span class="seg"><span class="on">Unread</span><span>All${hint}</span></span>` : `<span class="seg"><span>Unread${hint}</span><span class="on">All</span></span>`);
  return {why: 'Decided while building #36 and #105: U\'s hint on the view it switches to', from: seg(''), to: seg('<span class="kbd">U</span>')};
};
const VIEW_HINT = viewHint('Unread');

// Decided while building #38 (SV-25): every attachment card ends in Download.
const DOWNLOAD = '<span style="color: var(--ink2); font-size: 12.5px; height: 24px; padding: 0 8px; display: inline-flex; align-items: center; flex: none">Download</span>';
const downloadOn = (from: string, end: string): Patch => ({why: 'Decided while building #38: the attachment card ends in Download', from: `${from}\n${end}`, to: `${from}\n          ${DOWNLOAD}\n${end}`});

// Decided while building #48 (SV-26): All groups each day by lane, the kind once where an FYI run
// starts, and each day's Noise folded to one line. Board 05 predates it, so its list is drawn again
// from the seed (D3) in the board's row markup: Override 3's Noise, the seed's subjects and
// summaries, the platform after the summary, and Attention's protected and Northwind rows, down to
// the board's fold (Sun, Oct 4).
const ALL_05_CSS = `.sp .lh { height: 26px; flex: none; display: flex; align-items: flex-end; gap: 8px; padding: 0 16px 3px 24px; font-size: 11.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3); }
.sp .lh .n, .sp .nfold .n { letter-spacing: 0; font-variant-numeric: tabular-nums; color: var(--ink2); }
.sp .lh.att .n { color: var(--caution); }
.sp .nfold { height: 30px; flex: none; display: flex; align-items: center; gap: 8px; padding: 0 16px 0 24px; border-top: 1px solid var(--hair); font-size: 11.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--ink3); }
.sp .nfold .preview { text-transform: none; letter-spacing: 0; font-size: 12px; margin-left: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.sp .nfold .chev { margin-left: auto; }
.sp .row .kd { width: 84px; margin-left: 12px; margin-right: -10px; flex: none; color: var(--ink3); font-size: 11px; letter-spacing: .04em; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`;

interface AllRow05 {
  from: string;
  subject: string;
  account: string;
  time: string;
  kind?: string;
  unread?: boolean;
  cur?: boolean;
  pinned?: boolean;
}
const allRow05 = ({from, subject, account, time, kind = '', unread = false, cur = false, pinned = false}: AllRow05) => `
      <div class="row${unread ? ' unread' : ''}${cur ? ' cur' : ''}">
        <span class="kd">${kind}</span>
        <span class="ud"></span>
        <span class="from">${from}</span>
        <span class="subj">${subject}</span>
        <span class="ac"><span class="dot sm" style="--c: var(--a-${account.toLowerCase()})"></span>${account}</span>
        ${pinned ? '<span class="ms pin" aria-label="Pinned">keep</span>' : '<span class="pin"></span>'}
        <span class="age">${time}</span>
      </div>`;
const lane05 = (label: string, count: number) => `
      <div class="lh${label === 'Attention' ? ' att' : ''}">${label} <span class="n">${count}</span></div>`;
const noise05 = (count: number, preview: string) => `
      <div class="nfold">Noise <span class="n">${count}</span><span class="preview">${preview}</span><span class="ms chev">chevron_right</span></div>`;
const day05 = (label: string, date: string, first = false) => `
      <div class="gh${first ? ' first' : ''}">${label} <span class="date">${date}</span></div>`;
// A security row: its fact, then the fact's details.
const pair = (lead: string, rest?: string) => `<b>${lead}</b>${rest ? ` <span class="sum">· ${rest}</span>` : ''}`;
// Decided while building #74: an email's summary takes its subject's place, as in the Inbox (#35); the platform follows.
const sum = (subject: string, summary?: string) => {
  if (!summary) return pair(subject);
  const [lead, via] = summary.split(/ · (?=via )/);
  return pair(lead!, via);
};

const ALL_05_LIST = `<section class="list" aria-label="All mail">
${day05('Today', 'Wed, Oct 7', true)}${lane05('Attention', 2)}${allRow05({from: 'Google', subject: '<b class="alertsubj">Your recovery email was changed</b> <span class="sum">· Windows · Chrome · Phoenix, AZ</span>', account: 'Personal', time: '8:52 AM', unread: true, cur: true})}${allRow05({from: 'Northwind Talent', subject: sum('Interview availability for Software Engineer I', 'Pick a 30-minute slot this week · via Greenhouse'), account: 'Jobs', time: '7:12 AM', unread: true})}${lane05('FYI', 8)}${allRow05({kind: 'Security', from: 'Contoso Insurance', subject: '<b>Your code is <span class="code">482 913</span></b>', account: 'Personal', time: '9:08 AM', unread: true})}${allRow05({from: 'Google', subject: pair('New sign-in', 'MacBook Pro · Los Angeles'), account: 'Business', time: '8:12 AM', unread: true})}${allRow05({from: 'Google', subject: pair('Access granted', 'Claude'), account: 'Work', time: '6:10 AM', unread: true})}${allRow05({kind: 'Deliveries', from: 'Consolidated Messenger', subject: sum('Out for delivery', 'Arriving by 8 PM'), account: 'Personal', time: '7:02 AM', unread: true})}${allRow05({from: 'Wingtip Toys', subject: sum('Arriving today: USB-C hub', 'By 10 PM'), account: 'Business', time: '3:20 AM', unread: true})}${allRow05({kind: 'Money', from: 'Woodgrove Bank', subject: sum('Statement ready', 'Checking ending in 1234'), account: 'Personal', time: '4:05 AM', unread: true})}${allRow05({from: 'Proseware', subject: sum('Bill is ready', '$89.99 · Autopay on Oct 21'), account: 'iCloud', time: '1:08 AM', unread: true})}${allRow05({kind: 'Career', from: 'Fabrikam', subject: sum('Application received', 'Data Analyst · via Workday'), account: 'Jobs', time: '2:14 AM', unread: true})}${noise05(3, 'Tailspin Toys · Contoso Coffee · Litware')}
${day05('Yesterday', 'Tue, Oct 6')}${lane05('FYI', 4)}${allRow05({kind: 'Deliveries', from: 'Wingtip Toys', subject: sum('Delivered: desk lamp', 'Left at front door'), account: 'Business', time: '6:41 PM', unread: true})}${allRow05({kind: 'Money', from: 'Woodgrove Pay', subject: sum('You sent $42.00 to Sam Lee'), account: 'Business', time: '8:15 PM', unread: true})}${allRow05({kind: 'Updates', from: 'Contoso University', subject: sum('Lab 5 posted', 'CS 101 · Due Wed, Oct 7'), account: 'Personal', time: '9:30 AM'})}${allRow05({kind: 'Other', from: 'Adventure Works', subject: sum('New arrivals for fall'), account: 'Business', time: '7:55 AM'})}${noise05(2, 'Fourth Coffee · Wide World Importers')}
${day05('Mon', 'Oct 5')}${lane05('Attention', 1)}${allRow05({from: 'Contoso University', subject: sum('Final exam schedule · CS 101', 'Fall 2026 finals, rooms and times'), account: 'Personal', time: '10:05 AM'})}${lane05('FYI', 2)}${allRow05({kind: 'Deliveries', from: 'Southridge Video', subject: sum('Your item shipped', 'Mechanical keyboard · USPS'), account: 'Business', time: '4:18 PM', unread: true})}${allRow05({kind: 'People', from: 'Sam Lee', subject: sum('Dinner Friday?', 'Blue Door at 7?'), account: 'Personal', time: '12:40 PM'})}${noise05(1, 'Margie\'s Travel')}
${day05('Sun', 'Oct 4')}${lane05('FYI', 1)}${allRow05({kind: 'Deliveries', from: 'Wingtip Toys', subject: sum('Ordered: USB-C hub', 'Arriving Wed, Oct 7'), account: 'Business', time: '3:47 PM'})}
    </section>`;

/** Board 05's whole list, as the board draws it, for ALL_05_LIST to replace. */
function boardList05(): string {
  const html = fs.readFileSync(path.join(BOARDS_DIR, '05-all-grouped-by-day.html'), 'utf8');
  const start = html.indexOf('<section class="list" aria-label="All mail">');
  return html.slice(start, html.indexOf('</section>', start) + '</section>'.length);
}

// Board 09's prompt, which DESIGN.md puts at the end of Attention.
const PROMPT_09 = `
        <span class="ms s20" style="color: var(--ink3)">low_priority</span>
        <span class="grow">You've cleared 4 Northwind newsletters without opening them. Send these to FYI from now on?</span>
        <button class="btn sm">Yes</button>
        <button class="btn ghost sm">No</button>
`;

// Board 01's patches, which 22a (board 01 in Light) and 20 (⌘K over it) share.
// Decided while building #23 (SV-24): More shows only on Security and Noise mail, where it holds Add to calendar and Add as task.
/** Decided while building #77: the HTML frame and the images bar fill the reading pane's width, not the board's 600 px. */
const fullWidthFrame = (from: string): Patch => ({why: 'Decided while building #77: the HTML frame and the images bar fill the reading pane\'s width',
  from, to: `${from}\n.sp .paper, .sp .imgbar { width: auto; align-self: stretch; }`});

const NO_EMPTY_MORE: Patch = {why: 'Decided while building #23: More holds nothing on this email, so it doesn\'t show',
  from: '\n        <button class="ibtn" aria-label="More"><span class="ms">more_horiz</span></button>', to: ''};

// Decided while building #93 (override 18): Done is a tool only on Attention mail not yet Done.
const NO_DONE: Patch = {why: 'Decided while building #93: no Done outside Attention',
  from: '\n        <button class="tool"><span class="ms">check</span>Done<span class="kbd">H</span></button>', to: ''};

// Decided while building #25 (D50): error and status lines join their parts with commas.
const STATUS_COMMAS = (line: string): Patch => ({why: 'Decided while building #25: status lines take commas', from: line, to: line.replaceAll(' · ', ', ')});

// Decided while building #88 (SV-33, D73): the reader dates older mail with its time, as board 10 draws it.
const readerDate = (drawn: string, shown: string): Patch => ({why: 'Decided while building #88: the reader dates older mail with its time',
  from: `<span class="ink3 num" style="font-size: 12.5px">${drawn}</span>`, to: `<span class="ink3 num" style="font-size: 12.5px">${shown}</span>`});

// Decided while building #90 (SV-33, D75): a rule's words are one sentence, not flex items 8 px apart.
const ruleSentence = (words: string): Patch => ({why: 'Decided while building #90: a mail rule\'s words read as one sentence',
  from: `<div class="rule grow">${words}<span class="ms to">`, to: `<div class="rule grow"><span class="ell">${words}</span><span class="ms to">`});

const BOARD_01_PATCHES: Patch[] = [
  NO_EMPTY_MORE,
      {why: 'Override 2 (decision 48): with Northwind open the sidebar reads Inbox (3) 18', from: '<span class="apill num">3</span><span class="cnt num">19</span>', to: '<span class="apill num">3</span><span class="cnt num">18</span>'},
      {why: 'Override 2 (decision 48): with Northwind open, Jobs reads 1', from: 'Jobs<span class="cnt num">2</span>', to: 'Jobs<span class="cnt num">1</span>'},
      {why: 'Seed (D3): a group\'s rows are newest first, so Contoso\'s code (4m) leads Security; the board follows the brief\'s table order',
        from: `      <div class="row unread">
        <span class="ud"></span>
        <span class="from">Google</span>
        <span class="subj"><b>New sign-in</b>`,
        to: `${CODE_ROW.slice(1)}
        <span class="subj" style="display: flex; align-items: center; gap: 10px"><span class="code">482 913</span><button class="btn ghost sm" style="height: 22px; padding: 0 8px; font-size: 12px"><span class="ms s16" style="font-size: 14px">content_copy</span>Copy</button><span class="sum" style="font-size: 12px">Expires in 11 min</span></span>
        <span class="ac"><span class="dot sm" style="--c: var(--a-personal)"></span>Personal</span>
        <span class="age">4m</span>
      </div>
      <div class="row unread">
        <span class="ud"></span>
        <span class="from">Google</span>
        <span class="subj"><b>New sign-in</b>`},
      {why: '… and leaves its old place at the end of Security',
        from: `${CODE_ROW}
        <span class="subj" style="display: flex; align-items: center; gap: 10px"><span class="code">482 913</span><button class="btn ghost sm" style="height: 22px; padding: 0 8px; font-size: 12px"><span class="ms s16" style="font-size: 14px">content_copy</span>Copy</button><span class="sum" style="font-size: 12px">Expires in 11 min</span></span>
        <span class="ac"><span class="dot sm" style="--c: var(--a-personal)"></span>Personal</span>
        <span class="age">4m</span>
      </div>

      <div class="gh collapsed">Deliveries`,
        to: `

      <div class="gh collapsed">Deliveries`},
      {why: 'Seed (D3): a collapsed group\'s organisations, newest first (Consolidated Messenger 2h, Wingtip Toys 6h, Southridge Video Mon)', from: 'Wingtip Toys · Consolidated Messenger · Southridge Video', to: 'Consolidated Messenger · Wingtip Toys · Southridge Video'},
      {why: 'Seed (D3): newest first (Woodgrove Bank 5h, Proseware 8h, Woodgrove Pay yesterday)', from: 'Woodgrove Bank · Woodgrove Pay · Proseware', to: 'Woodgrove Bank · Proseware · Woodgrove Pay'},
      {why: 'Seed (D3) and DESIGN.md › The list: Fabrikam\'s subject is "Application received", its summary "Data Analyst", then its platform',
        from: '<b>Application received · Data Analyst</b> <span class="sum">· via Workday</span>', to: '<b>Application received</b> <span class="sum">· Data Analyst · via Workday</span>'},
      ...INBOX_SUMMARIES,
      VIEW_HINT,
      {why: 'DESIGN.md › The reader: " · organisation · via platform" is ink2 (the board draws ink3)',
        from: '<span class="ink3">· Northwind Talent · via Greenhouse</span>', to: '<span class="ink2">· Northwind Talent · via Greenhouse</span>'},
      {why: 'Seed (D3): Northwind\'s email is plain text, so no "Pick a time" button (the HTML frame is F2\'s)',
        from: NORTHWIND_BODY_BOARD, to: '<p>Please pick a time that works for you. Slots are open Wednesday through Friday, 10:00 AM – 4:00 PM Pacific.</p>'},
      {why: '… and plain text has no styled signature', from: '<p style="color: var(--ink2)">Best,', to: '<p>Best,'},
];

// DESIGN.md › Layout › Shell: a needs-reconnect account's glyph in the sidebar is `sync_problem` (the boards draw `warning` at 15 px).
const SIDEBAR_RECONNECT: Patch = {
  why: 'DESIGN.md › Shell: the needs-reconnect glyph is sync_problem',
  from: '<span class="ms s16" style="margin-left: auto; color: var(--caution); font-size: 15px">warning</span>',
  to: '<span class="ms s16" style="margin-left: auto; color: var(--caution)">sync_problem</span>',
};

// DESIGN.md › The list: every group but Pinned, Attention and Unsorted has its chevron, as board 01
// draws them (boards 17, 18a, 18b and 20 leave Security's and Career's out).
const CHEVRONS: Patch[] = [
  {why: 'DESIGN.md › The list: Security has its chevron', from: '<div class="gh">Security <span class="n">3</span></div>', to: '<div class="gh">Security <span class="n">3</span><span class="ms chev">expand_more</span></div>'},
  {why: '… Career too', from: '<div class="gh">Career <span class="n">1</span></div>', to: '<div class="gh">Career <span class="n">1</span><span class="ms chev">expand_more</span></div>'},
];

// Settings' nav ends in Sign out (DESIGN.md › Settings: darma's, at the foot of the nav; not drawn).
const SIGN_OUT: Patch = {
  why: 'DESIGN.md › Settings: Sign out at the foot of the nav',
  from: '<a class="nav" href="#"><span class="ms">lock</span><span class="grow">Security</span></a>\n  </nav>',
  to: '<a class="nav" href="#"><span class="ms">lock</span><span class="grow">Security</span></a>\n    <a class="nav" href="#" style="margin-top: auto"><span class="ms">door_open</span><span class="grow">Sign out</span></a>\n  </nav>',
};

// The Inbox under Settings, as boards 01 and 19a have it (D9's order, the seed's previews and Fabrikam).
const INBOX_UNDER_SETTINGS: Patch[] = [
  ...codeLeadsSecurity('<div class="gh collapsed">Deliveries'),
  DELIVERIES_PREVIEW,
  MONEY_PREVIEW,
  FABRIKAM,
  ...INBOX_SUMMARIES,
  VIEW_HINT,
  ...CHEVRONS,
];

// DESIGN.md override 5: Light's page is #f6f6f4 (the export's is #f8f8f6).
const LIGHT_PAGE: Patch = {why: 'Override 5: Light page #f6f6f4', from: 'body{margin:0;background:#f8f8f6}', to: 'body{margin:0;background:#f6f6f4} .sp.light{--page:#f6f6f4}'};

// Board 21's three phones (Inbox, reader, agenda), each audited on its own at 390 × 844.
const PHONE_CODE_ROW = `${CODE_ROW}
        <span class="subj" style="display: flex; align-items: center; gap: 6px"><span class="code">482 913</span><button class="btn ghost sm" style="height: 26px; padding: 0 8px; font-size: 12px; gap: 4px"><span class="ms" style="font-size: 14px">content_copy</span>Copy</button></span>
        <span class="ac"><span class="dot sm" style="--c: var(--a-personal)"></span>Personal</span>
        <span class="age">4m</span>
      </div>`;
// The agenda's Oct 7, 8 and 13 forecasts (seed D3), its high and low before the icon as a month cell's.
const dayTemps = (tone: string, glyph: string, temps: string): Patch => ({
  why: `Decided while building #83: a phone agenda day shows the forecast's high and low, ${temps}, before its weather icon`,
  from: `<span class="ms wx ${tone}">${glyph}</span></div>`,
  to: `<span class="wx ${tone}" style="display: inline-flex; align-items: center; gap: 4px"><span class="num" style="font-size: 11.5px; letter-spacing: 0; color: var(--ink3)">${temps}</span><span class="ms" style="font-size: 17px">${glyph}</span></span></div>`,
});
const BOARD_21_PATCHES: Patch[] = [
  {why: 'The phone\'s frame and rounded corners are the device\'s, not the page\'s', from: 'border-radius: 44px; border: 1px solid var(--edgeOn);', to: 'border-radius: 0; border: 0;'},
  {why: '… and so is the status bar: the page keeps clear of it by its inset (#143), none in a browser', from: '.sp .safe { height: 40px; flex: none; }', to: '.sp .safe { display: none; }'},
  {why: 'F8: the phone takes taps only, so no row is swiped; Mark read and Done are the reader\'s',
    from: `      <div class="swipe">
        <div class="swipe-acts">
          <button class="read"><span class="ms">mark_email_read</span>Mark read</button>
          <button class="done"><span class="ms">check</span>Done</button>
        </div>
        <div class="arow unread protected">`,
    to: '      <div class="arow unread protected">'},
  {why: '…', from: `secure your account now</div>
        </div>
      </div>`, to: `secure your account now</div>
        </div>`},
  {why: 'Override 2 (decision 48): Northwind was opened (it shows read), so the Inbox reads (3) 18', from: '<span class="apill num">3</span>\n      <span class="cnt num">19</span>', to: '<span class="apill num">3</span>\n      <span class="cnt num">18</span>'},
  {why: 'Seed (D3) and D9: Security is newest first, so Contoso\'s code (4m) leads it', from: SIGN_IN_ROW_START, to: `${PHONE_CODE_ROW.slice(1)}\n${SIGN_IN_ROW_START}`},
  {why: '… and leaves its old place at the end of Security', from: `${PHONE_CODE_ROW}\n\n      <div class="gh collapsed">Deliveries`, to: '\n\n      <div class="gh collapsed">Deliveries'},
  ...CHEVRONS,
  ...([['CS 101 lab report', SCHOOL], ['Pay rent', HOME], ['Renew car registration', HOME]] as const).map(([title, hex]): Patch => ({
    why: `SV-25 (D54): ${title}'s ring in its project's colour (the agenda)`,
    from: `<span class="ring"></span></span><span class="ell">${title}<`, to: `<span class="ring" style="border-color: ${hex}"></span></span><span class="ell">${title}<`,
  })),
  {why: 'Decided while building #66: two lines a phone row, the sender, account and age, then the subject under the sender',
    from: '.sp .phone .row { height: 44px; padding: 0 16px 0 8px; gap: 8px; }\n.sp .phone .row .from { width: 92px; }\n.sp .phone .row .ac { width: 64px; }',
    to: '.sp .phone .row { display: grid; grid-template-columns: 12px minmax(0, 1fr) auto auto; grid-template-areas: "ud from ac age" ". subj subj subj"; align-items: center; height: auto; min-height: 56px; padding: 8px 16px 8px 8px; column-gap: 8px; row-gap: 2px; }\n'
      + '.sp .phone .row .ud { grid-area: ud; }\n.sp .phone .row .from { grid-area: from; width: auto; }\n.sp .phone .row .subj { grid-area: subj; }\n.sp .phone .row .ac { grid-area: ac; width: auto; }\n.sp .phone .row .age { grid-area: age; }'},
  {why: 'Override 11: phone dates never wrap, so the age takes the room it needs (the Pinned row\'s "Sep 30")',
    from: '.sp .phone .row .age { width: 36px; }', to: '.sp .phone .row .age { width: auto; min-width: 36px; white-space: nowrap; }'},
  dayTemps('sun', 'sunny', '78° / 61°'), dayTemps('cloud', 'cloud', '72° / 59°'), dayTemps('rain', 'rainy', '64° / 55°'),
  {why: 'DESIGN.md › Phone: no calendar editing and no Alfred, so the reader\'s More (Add to calendar, Add as task) has nothing to hold',
    from: '\n      <button class="ibtn" style="width: 40px; height: 40px" aria-label="More"><span class="ms s20">more_horiz</span></button>', to: ''},
  {why: 'Seed (D3) and DESIGN.md › The list: Fabrikam\'s subject is "Application received", its summary "Data Analyst", then its platform',
    from: '<b>Application received · Data Analyst</b></span>', to: '<b>Application received</b> <span class="sum">· Data Analyst · via Workday</span></span>'},
  ...INBOX_SUMMARIES,
  {why: 'DESIGN.md › The reader: "organisation · via platform" is ink2 (the board draws ink3)',
    from: '<span class="ink3 ell" style="font-size: 12.5px">Northwind Talent · via Greenhouse</span>', to: '<span class="ink2 ell" style="font-size: 12.5px">Northwind Talent · via Greenhouse</span>'},
  {why: 'Seed (D3): Northwind\'s email is plain text, so no "Pick a time" button',
    from: '\n        <p><a href="#" style="display: inline-flex; align-items: center; height: 44px; padding: 0 18px; border-radius: 8px; background: #1b6f5a; color: #ffffff; text-decoration: none; font-weight: 500">Pick a time</a></p>', to: ''},
  {why: '… and plain text has no styled signature', from: '<p style="color: var(--ink2)">Best,', to: '<p>Best,'},
];

// ---- News (N4; design round 3, boards 25–28) ----

// The round-3 boards load the full icon font from Google Fonts for News's icons, which the bundled
// subset lacks. The audit stays off the network: each of those icons is drawn from
// glyphs/icons.json instead, as the app draws it, and the photo placeholders' own `image` icon and
// outlet name stand in for the real image the app shows (design-export/news/README.md).
const NEWS_ICONS = ['newspaper', 'arrow_back', 'arrow_upward', 'info', 'pending', 'live_tv', 'local_police', 'thunderstorm', 'earthquake', 'local_fire_department', 'travel_explore'];
const ICON_FONT_LINK = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,300,0..1,0&amp;display=block">';
function newsIcons(): Patch {
  const glyphs = JSON.parse(fs.readFileSync(path.join(ROOT, 'design-export', 'glyphs', 'icons.json'), 'utf8')) as Record<string, {d: string}>;
  const paths = Object.fromEntries(NEWS_ICONS.map(name => [name, glyphs[name]!.d]));
  return {
    why: 'Off the network: News\'s icons from glyphs/icons.json, not Google Fonts; the placeholders\' icon and outlet name stand in for the real image',
    from: ICON_FONT_LINK,
    to: `<style>.sp .ph > .ms, .sp .nw-lead .ph > .cap, .sp .nw-row .ph > .cap { visibility: hidden; }</style>
<script>
const NEWS_ICONS = ${JSON.stringify(paths)};
addEventListener('DOMContentLoaded', () => {
  for (const icon of document.querySelectorAll('.ms')) {
    const d = NEWS_ICONS[icon.textContent.trim()];
    if (!d) continue;
    const size = getComputedStyle(icon).fontSize;
    icon.innerHTML = '<svg width="' + size + '" height="' + size + '" viewBox="0 -960 960 960" fill="currentColor" style="display: block"><path d="' + d + '"></path></svg>';
  }
});
</script>`,
  };
}

const newsRow = (headline: string, oneLine: string, outlet: string, age: string, image: string | null) => `
      <div class="nw-row">
        <span class="nd"></span>
        <div class="txt"><div class="hl">${headline}</div><div class="sm">${oneLine}</div></div>
        <div class="side"><span class="nw-meta"><span class="src">${outlet}</span></span><span class="nw-meta">${age}</span></div>
        ${image ? `<div class="ph" style="--c: var(--${image})"><span class="ms">image</span></div>` : '<span class="noimg"></span>'}
      </div>`;
const newsToday = (title: string, ring: string, hex: string, when = ''): Patch => ({
  why: '#78: the Today block\'s task in ink, its ring in its project\'s colour (as every round-2 board is patched)',
  from: `<a class="today-row" href="#"><span class="ring" style="${ring}"></span><span class="ell">${title}</span>${when && `<span class="when">${when}</span>`}</a>`,
  to: todayTask(title, hex, when),
});
const NO_STORY_MORE: Patch = {why: 'DESIGN.md › The story pane draws More, which would hold nothing yet (as Decided while building #23): it isn\'t shown',
  from: '\n        <button class="ibtn" aria-label="More"><span class="ms">more_horiz</span></button>', to: ''};

const BOARD_25_PATCHES: Patch[] = [
  newsIcons(),
  newsToday('CS 101 lab report', 'margin: 0 3px 0 1px; --c: var(--cool)', SCHOOL), newsToday('Pay rent', 'margin: 0 3px 0 1px', HOME),
  newsToday('Renew car registration', 'margin: 0 3px 0 1px', HOME, 'Tomorrow'),
  {why: 'Decided while building #95: opening the brush fire story saw it, so its dot and Updated go at once (as 26a draws it); the pane keeps what\'s new since the user\'s last look',
    from: '<div class="nw-lead upd open">', to: '<div class="nw-lead seen open">'},
  {why: '… and its meta loses Updated', from: '<span class="src">KTLA +4</span><span>·</span><span>1h</span><span>·</span><span class="upd">Updated 8:40 AM</span>',
    to: '<span class="src">KTLA +4</span><span>·</span><span>1h</span>'},
  {why: 'Seed (D3): Local\'s block holds five, Council\'s housing project the fifth',
    from: '\n      <a class="nw-more" href="#">12 more in Local', to: `${newsRow('Council approves a 120-unit housing project on a former parking lot', 'Construction could start next spring', 'Streetsblog LA', 'Mon', null)}\n      <a class="nw-more" href="#">12 more in Local`},
  {why: 'Seed (D3): Tech\'s block holds three, Apple\'s invites the third, then "7 more in Tech"',
    from: '\n      <a class="nw-more" href="#">8 more in Tech', to: `${newsRow('Apple sends invites for an Oct 20 event', 'Expected: new iPads and Macs', 'MacRumors +6', 'Yesterday', 'warm')}\n      <a class="nw-more" href="#">7 more in Tech`},
  NO_STORY_MORE,
  {why: 'Seed (D3) and DESIGN.md › Copy: the fire was first reported on Monday, so its time says the day', from: '<span>first reported 6:12 AM</span>', to: '<span>first reported Mon 6:12 AM</span>'},
];

const NBC_TEXT = [
  'A brush fire in the hills above the 210 Freeway grew to about 400 acres overnight, fire officials said Wednesday morning, as crews worked to keep it away from homes in the foothills.',
  'Evacuation warnings went out late Tuesday for neighborhoods north of the freeway. No homes had been damaged as of 7 a.m., and no one had been hurt.',
  'Firefighters held the fire\'s western edge through the night with help from water-dropping helicopters. Containment stood at 10%.',
  'A Red Flag Warning takes effect at noon and runs through Thursday evening, with gusts up to 50 mph and humidity below 10% expected across the valleys.',
  'Two schools inside the warning area closed for the day. Officials asked residents to keep their cars fueled and to sign up for the county\'s emergency alerts.',
];
const BOARD_26A_PATCHES: Patch[] = [
  newsIcons(),
  {why: 'Seed (D3): NBC Los Angeles\'s article is from 7:10 AM', from: '<span class="num">7:48 AM</span>', to: '<span class="num">7:10 AM</span>'},
  {why: 'Seed (D3): NBC Los Angeles\'s article as the seed words it',
    from: boardBlock('26a-an-article-in-the-pane.html', '        <div class="ar-text">', '        </div>', NEWS_DIR),
    to: `        <div class="ar-text">\n${NBC_TEXT.map(text => `          <p>${text}</p>`).join('\n')}\n        </div>`},
];
const BOARD_26B_PATCHES: Patch[] = [
  newsIcons(),
  {why: 'Seed (D3): KTLA\'s feed summary as the seed words it', from: 'conditions expected to arrive by noon Wednesday.', to: 'conditions expected by noon Wednesday.'},
  {why: 'DESIGN.md › The story pane: Also in this story lists every other source, FOX 11 too',
    from: '<span class="a">4h</span><span class="ms chev">chevron_right</span></div>',
    to: '<span class="a">4h</span><span class="ms chev">chevron_right</span></div>\n          <div class="src-row"><span class="fav">11</span><div class="lines"><span class="o">FOX 11</span><span class="h">Brush fire breaks out near the 210</span></div><span class="a">6h</span><span class="ms chev">chevron_right</span></div>'},
];
const BOARD_28_PATCHES: Patch[] = [
  newsIcons(),
  {why: 'DESIGN.md › Copy: Tuesday is "Yesterday" on a Wednesday, as All\'s rows say it', from: '<span class="nw-meta">Tue</span>', to: '<span class="nw-meta">Yesterday</span>', times: 11},
  {why: '… the lead\'s too', from: '<span class="src">NPR +9</span><span>·</span><span>Tue</span>', to: '<span class="src">NPR +9</span><span>·</span><span>Yesterday</span>'},
];

// ---- News's states, Settings and Light (N5; boards 29a, 29b, 30a, 30b, 31) ----

/** A story row as the seed has it: its dot (`new`, `upd` or none once seen), meta and thumbnail. */
const seedRow = (state: 'new' | 'upd' | '', headline: string, oneLine: string, outlet: string, when: string, image: string | null) => `
      <div class="nw-row${state && ` ${state}`}">
        <span class="nd"></span>
        <div class="txt"><div class="hl">${headline}</div><div class="sm">${oneLine}</div></div>
        <div class="side"><span class="nw-meta"><span class="src">${outlet}</span></span><span class="nw-meta">${state === 'upd' ? `<span class="upd">${when}</span>` : when}</span></div>
        ${image ? `<div class="ph" style="--c: var(--${image})"><span class="ms">image</span></div>` : '<span class="noimg"></span>'}
      </div>`;
// Round 3's later boards draw CS 101's ring without the project colour 25 gives it.
const N5_TODAY: Patch[] = [
  newsToday('CS 101 lab report', 'margin: 0 3px 0 1px', SCHOOL), newsToday('Pay rent', 'margin: 0 3px 0 1px', HOME),
  newsToday('Renew car registration', 'margin: 0 3px 0 1px', HOME, 'Tomorrow'),
];
const MAN_ARRESTED = (state: 'new' | 'upd', when: string) => seedRow(state, 'Man arrested after a stabbing outside a Metro station', 'The victim is in stable condition', 'NBC LA +2', when, 'cool');
const COUNCIL = (state: 'new' | '') => seedRow(state, 'Council approves a 120-unit housing project on a former parking lot', 'Construction could start next spring', 'Streetsblog LA', 'Mon', null);
const FIRST_RUN_LINE = 'Sorting the last 48 hours · 186 of 312 articles · showing what';

const BOARD_29A_PATCHES: Patch[] = [
  newsIcons(), ...N5_TODAY,
  {why: 'Seed (D3): Local\'s block holds five, so the stabbing, the car wash and Council\'s housing project follow the Red Flag Warning, then "12 more in Local"',
    from: '\n      <a class="nw-more" href="#">13 more in Local',
    to: `${MAN_ARRESTED('upd', 'Updated 7:55 AM')}${seedRow('', 'Federal agents detain 9 at a car wash', 'Neighbors gathered to film; two were released by evening', 'LAist +3', 'Yesterday', 'comf')}${COUNCIL('')}\n      <a class="nw-more" href="#">12 more in Local`},
  {why: 'Seed (D3): Claude Haiku 5.5\'s story is new, so it has its dot',
    from: '<div class="nw-lead">\n        <span class="nd"></span>\n        <div class="ph" style="--c: var(--warm)"><span class="ms">image</span><span class="cap">Anthropic</span></div>',
    to: '<div class="nw-lead new">\n        <span class="nd"></span>\n        <div class="ph" style="--c: var(--warm)"><span class="ms">image</span><span class="cap">Anthropic</span></div>'},
  {why: 'Seed (D3): AI\'s block holds four, the Gemini app\'s and OpenAI\'s after Fabrikam\'s, then "4 more in AI"',
    from: '\n      <a class="nw-more" href="#">5 more in AI',
    to: `${seedRow('new', 'Gemini app adds scheduled tasks on Android', 'Ask it to do something every morning', 'Google +2', '7h', null)}${seedRow('', 'OpenAI testifies before a Senate committee on AI safety', 'Senators asked about testing before release', 'NPR +5', 'Yesterday', 'cool')}\n      <a class="nw-more" href="#">4 more in AI`},
];

const BOARD_29B_PATCHES: Patch[] = [
  newsIcons(), ...N5_TODAY,
  {why: 'DESIGN.md › Copy, as search\'s indexing line has it: the first run\'s line takes a typographic apostrophe, "what’s"', from: `${FIRST_RUN_LINE}'s sorted so far`, to: `${FIRST_RUN_LINE}’s sorted so far`},
  {why: 'Fixture news-first-run on the seed (D3): the stabbing comes before the car wash in Local\'s block',
    from: '\n      <div class="nw-row new">\n        <span class="nd"></span>\n        <div class="txt"><div class="hl">Federal agents detain 9 at a car wash',
    to: `${MAN_ARRESTED('new', '5h')}\n      <div class="nw-row new">\n        <span class="nd"></span>\n        <div class="txt"><div class="hl">Federal agents detain 9 at a car wash`},
  {why: '… and Council\'s housing project ends it, then "12 more in Local"', from: '\n      <a class="nw-more" href="#">6 more in Local', to: `${COUNCIL('new')}\n      <a class="nw-more" href="#">12 more in Local`},
  {why: 'Seed (D3): the first run has sorted Apple\'s invites, so Tech shows its Upcoming keynote, as board 25 draws it',
    from: '<div class="nw-sec">Tech</div>\n      <div class="nw-lead new">',
    to: `<div class="nw-sec">Tech</div>
      <div class="nw-up">
        <span class="ico"><span class="ms">event</span></span>
        <span class="lab">Upcoming</span>
        <span><span class="what">Apple event</span> <span class="num">· Tue Oct 20 · 10 AM</span></span>
        <span class="grow"></span>
        <span class="nw-meta"><span class="src">MacRumors +6</span></span>
        <button class="btn out sm"><span class="ms s16">event</span>Add to calendar</button>
      </div>
      <div class="nw-lead new">`},
  {why: '… and Tech\'s block holds three, Samsung\'s beta and Apple\'s invites after the Pixel Watch, then "7 more in Tech"',
    from: '\n      <a class="nw-more" href="#">3 more in Tech',
    to: `${seedRow('new', 'Samsung opens the One UI 9 beta to Galaxy S26 owners in the US', 'Sign-ups open in the Members app today', '9to5Google +2', '6h', 'violet')}${seedRow('new', 'Apple sends invites for an Oct 20 event', 'Expected: new iPads and Macs', 'MacRumors +6', 'Yesterday', 'warm')}\n      <a class="nw-more" href="#">7 more in Tech`},
];

/** A Settings › News row as the seed has it (30a): the icon its list names, else its adapter's (N5). */
const sourceRow = (name: string, reads: string, every: string, state: string, icon = 'newspaper') => `
        <div class="set-row slim">
          <span class="aico"><span class="ms s16">${icon}</span></span>
          <div class="lines grow"><span class="t">${name}</span><span class="s">${reads}</span></div>
          <span class="prov">${every}</span>
          <span class="state"><span class="num">${state}</span></span>
        </div>`;
const FOX_11 = `
        <div class="set-row slim warn">
          <span class="aico"><span class="ms s16">live_tv</span></span>
          <div class="lines grow"><span class="t">FOX 11 · Local news</span><span class="s">Feed</span></div>
          <span class="prov">Every 15 min</span>
          <span class="state caution"><span class="ms s16">warning</span><span class="num">Failing, 404 since 6:02 AM</span></span>
        </div>`;
const BOARD_30A_PATCHES: Patch[] = [
  newsIcons(), ...N5_TODAY,
  {why: 'Seed (D3): 89 articles fetched since midnight, 46 stories on the page', from: '312 articles today · 41 stories', to: '89 articles today · 46 stories'},
  {why: 'Seed (D3): Local\'s 16 sources, the local list\'s stand-ins first (the TV stations `live_tv`, the crime wire `local_police`, the rest a paper, as their list names them)',
    from: boardBlock('30a-settings-news.html', '      <div class="set-label">Local <span class="n">9</span></div>', '    </div>\n\n    <div class="set-sec">', NEWS_DIR),
    to: `      <div class="set-label">Local <span class="n">16</span></div>
      <div class="set-group">${[
    sourceRow('KTLA · Local news', 'Feed, summary only', 'Every 15 min', 'Checked 9:10 AM', 'live_tv'),
    sourceRow('NBC Los Angeles · Local', 'Feed and two area tags', 'Every 15 min', 'Checked 9:10 AM', 'live_tv'),
    sourceRow('CBS Los Angeles', 'Feed, Local News only', 'Every 15 min', 'Checked 9:08 AM', 'live_tv'),
    FOX_11,
    sourceRow('ABC7 · Local', 'Feed', 'Every 15 min', 'Checked 9:10 AM', 'live_tv'),
    sourceRow('LAist', 'Feed', 'Every 15 min', 'Checked 9:10 AM'),
    sourceRow('Streetsblog LA', 'Feed', 'Every 15 min', 'Checked 9:10 AM'),
    sourceRow('County crime wire', 'Feed', 'Every 15 min', 'Checked 9:11 AM', 'local_police'),
    sourceRow('LA County newsroom', 'Feed', 'Every 15 min', 'Checked 9:10 AM'),
    sourceRow('South Coast AQMD advisories', 'Feed, advisories', 'Every 15 min', 'Checked 9:10 AM'),
    sourceRow('Los Angeles Times', 'Feed; counts toward stories, never shown', 'Every 15 min', 'Checked 9:10 AM'),
    sourceRow('National Weather Service', 'Alerts for the home location\'s zone', 'Every 5 min', 'Checked 9:11 AM', 'thunderstorm'),
  ].join('')}
      </div>
    </div>

    <div class="set-sec">`},
];

const modelText = (model: string) => `<span class="num" style="color: var(--ink2); font-size: 12.5px">${model}</span>`;
const mailModel = (title: string, sub: string) => `
        <div class="set-row slim">
          <div class="lines grow"><span class="t">${title}</span><span class="s">${sub} · needs a key</span></div>
          <span class="dd">Default<span class="ms">expand_more</span></span>
        </div>`;
const BOARD_30B_PATCHES: Patch[] = [
  newsIcons(), ...N5_TODAY,
  {why: 'DESIGN.md › Settings: rows are 52 px at least, a row with a control 48 (the app\'s `ctl`); only Settings › News\'s rows are 44',
    from: '</style>\n</head>', to: '.sp .set-row.slim { min-height: 48px; padding: 7px 16px; }\n.sp .set-sec:last-child .set-row.slim { min-height: 52px; padding: 10px 16px; }\n</style>\n</head>'},
  {why: 'Seed (D3): no AI key is set, so each key row says what it holds and offers Set key (UX #14, #82)',
    from: '<span class="t">Anthropic</span><span class="s">Saved · ends in 4f2a</span></div>\n          <button class="btn out sm">Replace</button>',
    to: '<span class="t">Anthropic</span><span class="s">Claude models · Not set</span></div>\n          <button class="btn out sm">Set key</button>'},
  {why: '…', from: '<span class="t">OpenAI</span><span class="s">Saved · ends in 9c1e</span></div>\n          <button class="btn out sm">Replace</button>',
    to: '<span class="t">OpenAI</span><span class="s">GPT models · Not set</span></div>\n          <button class="btn out sm">Set key</button>'},
  {why: 'D25 and D26: Mail\'s four models, each Default until chosen, and saying a key is needed (UX #14)',
    from: boardBlock('30b-settings-ai.html', '        <div class="set-row slim">\n          <div class="lines grow"><span class="t">Triage</span><span class="s">Escalates', '<span class="dd">Claude Sonnet 5.5<span class="ms">expand_more</span></span>\n        </div>', NEWS_DIR),
    to: [mailModel('Triage', 'Reads each new email'), mailModel('Triage, when unsure', 'Checks every Attention answer'), mailModel('History', 'Reads backfilled mail once'), mailModel('Alfred', 'Answers questions about your mail')].join('').slice(1)},
  {why: 'D90 and N5: News\'s models are fixed (no setting chooses them), so each shows as its name, not a select; without a key it says one is needed',
    from: '<span class="s">Section, noise filter, key facts, same event or not</span></div>\n          <span class="dd">Claude Haiku 5.5<span class="ms">expand_more</span></span>',
    to: `<span class="s">Section, noise filter, key facts, same event or not · needs a key</span></div>\n          ${modelText('Claude Haiku 5.5')}`},
  {why: '…', from: '<span class="s">Headlines and summaries, the hourly ranking</span></div>\n          <span class="dd">Claude Sonnet 5.5<span class="ms">expand_more</span></span>',
    to: `<span class="s">Headlines and summaries, the hourly ranking · needs a key</span></div>\n          ${modelText('Claude Sonnet 5.5')}`},
  {why: 'Decided while building #73: usage says what it counts, calls and tokens', from: '<span class="s num">1,214 emails</span>', to: '<span class="s num">1,214 calls · 2.4M tokens in · 49k out</span>'},
  {why: '…', from: '<span class="s num">18 questions</span>', to: '<span class="s num">18 calls · 112k tokens in · 8k out</span>'},
];

// Board 31 is board 25 in Light, so it takes 25's patches, with CS 101's ring as the later boards draw it.
const BOARD_31_PATCHES: Patch[] = [...BOARD_25_PATCHES.filter(patch => !patch.from.includes('today-row')), ...N5_TODAY];

/**
 * News's boards (design round 3). The app's rows keep their arrival dots for the visit once seen
 * (#95), as the boards draw them. Board 27's list is the board's own order; the seed ranks Local
 * differently, so its diff shows it until the tuning round settles ranking. N5's: 29a on fixtures
 * news-ai-down, news-stale-ai and news-quiet-tech, 29b on news-first-run, 30a and 30b on the seed
 * (FOX 11 failing, this month's usage), 31 on the seed in Light; the boards draw only some of each
 * block, so the patches add the seed's rows down to the fold.
 */
const NEWS_BOARDS: Board[] = [
  {name: '25-news-a-typical-morning', file: '25-news-a-typical-morning.html', dir: NEWS_DIR, width: 1677, height: 1050, patches: BOARD_25_PATCHES},
  {name: '26a-an-article-in-the-pane', file: '26a-an-article-in-the-pane.html', dir: NEWS_DIR, width: 1677, height: 1050, patches: BOARD_26A_PATCHES},
  {name: '26b-an-article-that-cant-be-read-in-app', file: '26b-an-article-that-cant-be-read-in-app.html', dir: NEWS_DIR, width: 1677, height: 1050, patches: BOARD_26B_PATCHES},
  {name: '27-a-section-local', file: '27-a-section-local.html', dir: NEWS_DIR, width: 1677, height: 1050, patches: [newsIcons()]},
  {name: '28-missed', file: '28-missed.html', dir: NEWS_DIR, width: 1677, height: 1050, patches: BOARD_28_PATCHES},
  {name: '29a-states-unsorted-stale-nothing-new', file: '29a-states-unsorted-stale-nothing-new.html', dir: NEWS_DIR, width: 1677, height: 1050, patches: BOARD_29A_PATCHES},
  {name: '29b-states-first-run', file: '29b-states-first-run.html', dir: NEWS_DIR, width: 1677, height: 1050, patches: BOARD_29B_PATCHES},
  {name: '30a-settings-news', file: '30a-settings-news.html', dir: NEWS_DIR, width: 1677, height: 1050, patches: BOARD_30A_PATCHES},
  {name: '30b-settings-ai', file: '30b-settings-ai.html', dir: NEWS_DIR, width: 1677, height: 1050, patches: BOARD_30B_PATCHES},
  {name: '31-light-news', file: '31-light-news.html', dir: NEWS_DIR, width: 1677, height: 1050, patches: BOARD_31_PATCHES},
];

export const BOARDS: Board[] = [
  {
    name: '01-inbox-a-typical-morning', file: '01-inbox-a-typical-morning.html', width: 1677, height: 1050,
    patches: BOARD_01_PATCHES,
  },
  {name: '04-all-caught-up', file: '04-all-caught-up.html', width: 1677, height: 1050, patches: [PARKSIDE_SUMMARY, VIEW_HINT]},
  {
    name: '11-calendar-october-2026', file: '11-calendar-october-2026.html', width: 1677, height: 1050,
    patches: [
      ...SUNDAY_FIRST,
      ...CALENDAR_SEED_PATCHES,
      ...AGENDA_OCT_7_PATCHES,
      ...GRID_RINGS,
      ...AGENDA_OCT_7_RINGS,
    ],
  },
  {
    // The time-to-leave fixture (D3) gives Dentist its "Leave by 2:05 PM · 18 min"; the check clicks Dentist.
    name: '12a-floating-detail-dentist', file: '12a-floating-detail-dentist.html', width: 1677, height: 1050,
    patches: [
      ...SUNDAY_FIRST,
      ...CALENDAR_SEED_PATCHES,
      ...AGENDA_OCT_7_PATCHES,
      ...GRID_RINGS,
      ...AGENDA_OCT_7_RINGS,
      {why: 'Placement centres the card on its chip (270): the card as drawn is 254 tall, not the 252 its comment assumes, so it sits at 143; with Sunday first (SV-29) Wednesday is a column on, so the card left of it is too',
        from: 'aria-label="Dentist" style="position: absolute; left: 12px; top: 144px;', to: 'aria-label="Dentist" style="position: absolute; left: 159px; top: 143px;'},
    ],
  },
  {
    // Dentist, then Dinner with Sam: the card has glided and is at rest.
    name: '12b-floating-detail-glided-to-dinner-with-sam', file: '12b-floating-detail-glided-to-dinner-with-sam.html', width: 1677, height: 1050,
    patches: [
      ...SUNDAY_FIRST,
      ...CALENDAR_SEED_PATCHES,
      ...DINNER_PATCHES,
      ...GRID_RINGS,
      {why: 'At rest: the board\'s motion trace from 12a\'s card (724 px · 352 ms) is an annotation',
        from: boardBlock('12b-floating-detail-glided-to-dinner-with-sam.html', '    <!-- Motion trace:', '</svg>\n'), to: ''},
    ],
  },
  {
    // Dentist's card dragged to 742, 607, low over Friday and Saturday, then Dinner with Sam clicked: at rest it is 12b.
    name: '12d-dragged-aside-then-glides-to-dinner-with-sam', file: '12d-dragged-aside-then-glides-to-dinner-with-sam.html', width: 1677, height: 1050,
    patches: [
      ...SUNDAY_FIRST,
      ...CALENDAR_SEED_PATCHES,
      ...DINNER_PATCHES,
      ...GRID_RINGS,
      {why: 'At rest: where the card was dropped ("Dropped here · no anchor") and the 454 px · 325 ms trace are annotations of the motion',
        from: boardBlock('12d-dragged-aside-then-glides-to-dinner-with-sam.html', '    <!-- Where the user dropped', '</svg>\n'), to: ''},
    ],
  },
  {
    name: '11b-a-busy-day-plus-3-and-its-popover', file: '11b-a-busy-day-plus-3-and-its-popover.html', width: 1677, height: 1050,
    patches: [
      ...SUNDAY_FIRST,
      ...CALENDAR_SEED_PATCHES,
      {why: 'DESIGN.md › Sidebar on Calendar: the selected day is `sub` in the mini-month (the board draws `sub2` with `ink` text)',
        from: '<span style="background: var(--sub2); color: var(--ink)">17</span>', to: '<span class="vis">17</span>'},
      {why: 'Fixture (D3) through the items API: a day\'s tasks come by title, so Grocery run before Laundry (the popover)',
        from: `<a class="tk" href="#"><span class="ring"></span>Laundry</a>
          <a class="tk" href="#"><span class="ring"></span>Grocery run</a>`,
        to: `<a class="tk" href="#"><span class="ring"></span>Grocery run</a>
          <a class="tk" href="#"><span class="ring"></span>Laundry</a>`},
      {why: '… and the agenda', from: '<span class="grow" style="color: var(--ink)">Laundry</span>', to: '<span class="grow" style="color: var(--ink)">Grocery run</span>'},
      {why: '… (the second task)', from: '<span class="grow" style="color: var(--ink)">Grocery run</span>\n        <span class="ink3" style="font-size: 12px">Home</span>\n      </a>\n\n      <div style="margin-top: auto',
        to: '<span class="grow" style="color: var(--ink)">Laundry</span>\n        <span class="ink3" style="font-size: 12px">Home</span>\n      </a>\n\n      <div style="margin-top: auto'},
      ...GRID_RINGS,
      gridRing('Laundry', HOME), gridRing('Grocery run', HOME), agendaRing('Laundry', HOME), agendaRing('Grocery run', HOME),
    ],
  },
  {
    // Fixture coffee-html gives Contoso Coffee's email the board's HTML; the check expands Deliveries and
    // Noise and opens it.
    name: '02-deliveries-expanded-images-hidden', file: '02-deliveries-expanded-images-hidden.html', width: 1677, height: 1050,
    // Contoso Coffee is Noise, so its More holds Add to calendar and Add as task (#23), as drawn.
    patches: [
      NO_DONE,
      ...openedPersonal('Contoso Coffee'),
      ...codeLeadsSecurity('<div class="gh">Deliveries'),
      MONEY_PREVIEW,
      FABRIKAM,
      ...INBOX_SUMMARIES,
      VIEW_HINT,
      summaryLeads('Out for delivery', 'Arriving by 8 PM'),
      summaryLeads('Arriving today: USB-C hub', 'By 10 PM'),
      summaryLeads('Delivered: desk lamp', 'Left at front door'),
      summaryLeads('Your item shipped', 'Mechanical keyboard · USPS'),
      summaryLeads('Fall sale: 30% off building sets', 'Ends Sunday'),
      summaryLeads('The Contoso Coffee Journal · October', 'A new harvest from Huila, brewing notes'),
      summaryLeads('Webinar: what\'s new in Litware 12', 'Register for the Oct 15 session'),
      summaryLeads('Office coffee, 20% off your first box', 'For teams of 5 to 50'),
      summaryLeads('Just landed: hand-thrown ceramics', 'New from Oaxaca and Kyoto'),
      summaryLeads('Fall getaways from $199', 'Three nights, flights included'),
      fullWidthFrame('.sp .imgbar .sep { color: var(--ink3); }'),
      {why: 'The HTML frame is sandboxed with no origin of its own, so it can\'t load the app\'s Geist: hidden images\' placeholders draw in the paper\'s Helvetica',
        from: '.sp .paper p { margin: 0; }', to: '.sp .paper p { margin: 0; }\n.sp .imgph { font: 12px Helvetica, Arial, sans-serif; }'},
    ],
  },
  {
    // Fixture recovery-html gives Google's recovery alert the board's HTML; the check opens it.
    name: '03-security', file: '03-security.html', width: 1677, height: 1050,
    patches: [
      ...openedPersonal('the Google recovery email'),
      ...codeLeadsSecurity('<div class="gh collapsed">Deliveries'),
      DELIVERIES_PREVIEW,
      MONEY_PREVIEW,
      FABRIKAM,
      ...INBOX_SUMMARIES,
      VIEW_HINT,
      {why: 'Decided while building #60: a fact\'s label holds one line ("What happened" wrapped in 112 px)',
        from: '.sp .facts dt { color: var(--ink3); font-size: 12.5px; display: flex; align-items: center; gap: 8px; }', to: '.sp .facts dt { color: var(--ink3); font-size: 12.5px; display: flex; align-items: center; gap: 8px; white-space: nowrap; }'},
      fullWidthFrame('.sp .paper p { margin: 0; }'),
    ],
  },
  {
    // The seed as it is; the check switches to All and puts the cursor on the first row (J), Attention's first.
    name: '05-all-grouped-by-day', file: '05-all-grouped-by-day.html', width: 1677, height: 1050,
    patches: [
      {why: 'DESIGN.md › The list: a protected subject is alert 500; the board\'s `.alertsubj` means that but loses to `.row.unread .subj b` on specificity',
        from: '.sp .row .subj .alertsubj { color: var(--alert); font-weight: 500; }', to: '.sp .row .subj .alertsubj, .sp .row.unread .subj .alertsubj { color: var(--alert); font-weight: 500; }'},
      {why: 'Decided while building #48: lane labels, the kind column on the left, a day\'s folded Noise', from: '.sp .row .kind { width: 84px; flex: none; color: var(--ink3); font-size: 12px; }\n', to: `${ALL_05_CSS}\n`},
      {why: 'Decided while building #48: each day grouped by lane, drawn from the seed (D3) with Override 3\'s Noise folded', from: boardList05(), to: ALL_05_LIST},
      viewHint('All'),
    ],
  },
  {
    // Fixture new-digest adds four digests cleared unopened and one that arrived now; B3's real
    // GET /api/mail/prompts raises the prompt from them, and the check puts the cursor on the new
    // digest (J J).
    name: '09-pattern-prompt', file: '09-pattern-prompt.html', width: 1677, height: 1050,
    patches: [
      {why: 'DESIGN.md › Pattern prompt: the prompt is one line at the end of Attention (the board draws it at the top)',
        from: `      <div class="prompt" style="flex: none">${PROMPT_09}      </div>\n`, to: ''},
      {why: '… after Contoso University, Attention\'s last row, naming the digests\' organisation as the real prompt does (B3: "Northwind Engineering", the rows\' organisation)',
        from: '<div class="l3">Fall 2026 finals, rooms and times</div>\n      </div>\n',
        to: `<div class="l3">Fall 2026 finals, rooms and times</div>\n      </div>\n      <div class="prompt" style="flex: none">${PROMPT_09.replace('4 Northwind newsletters', '4 Northwind Engineering newsletters')}      </div>\n`},
      {why: 'Boards 01, 02, 03 and 10: Security and Career, expandable, draw their chevron', from: '<div class="gh">Security <span class="n">3</span></div>',
        to: '<div class="gh">Security <span class="n">3</span><span class="ms chev">expand_more</span></div>'},
      {why: '… Career too', from: '<div class="gh">Career <span class="n">1</span></div>', to: '<div class="gh">Career <span class="n">1</span><span class="ms chev">expand_more</span></div>'},
      ...codeLeadsSecurity('<div class="gh collapsed">Deliveries'),
      DELIVERIES_PREVIEW,
      MONEY_PREVIEW,
      FABRIKAM,
      ...INBOX_SUMMARIES,
      VIEW_HINT,
    ],
  },
  {
    // Fixture second-pin pins the DMV's notice; the check opens Parkside's lease and points at the DMV row.
    name: '10-pinned-shelf', file: '10-pinned-shelf.html', width: 1677, height: 1050,
    patches: [
      NO_DONE,
      NO_EMPTY_MORE,
      {why: 'D10: the row under the pointer is the keyboard cursor, a sub2 fill (the board draws a sub hover)', from: '<div class="row hov">', to: '<div class="row cur">'},
      downloadOn('          <span class="ms s16 ink3">visibility</span>', '        </a>'),
      {why: 'Decided while building #61: an attachment card widens past 280 to show the whole name',
        from: '<a class="attach" href="#">', to: '<a class="attach" href="#" style="width: max-content; min-width: 280px; max-width: 100%">'},
      ...codeLeadsSecurity('<div class="gh collapsed">Deliveries'),
      DELIVERIES_PREVIEW,
      MONEY_PREVIEW,
      FABRIKAM,
      ...INBOX_SUMMARIES,
      VIEW_HINT,
      summaryLeads('Car registration renewal notice', 'Renewal notice for your vehicle · online or by mail'),
      {why: 'DESIGN.md › The reader: " · organisation" is ink2 (the board draws ink3), as in 01',
        from: '<span class="ink3">· Parkside Apartments</span>', to: '<span class="ink2">· Parkside Apartments</span>'},
      {why: 'Seed (D3): the lease email is plain text, so its terms are lines, not a list',
        from: `<ul>
            <li>Term: 12 months, Dec 1, 2026 – Nov 30, 2027</li>
            <li>New monthly rent: $2,140 (currently $2,060)</li>
            <li>Sign by: Oct 31, 2026</li>
          </ul>`,
        to: '<p>Term: 12 months, Dec 1, 2026 – Nov 30, 2027<br>New monthly rent: $2,140 (currently $2,060)<br>Sign by: Oct 31, 2026</p>'},
      {why: '… and plain text has no styled signature, as in 01', from: '<p style="color: var(--ink2)">Thanks,', to: '<p>Thanks,'},
    ],
  },
  // F3: boards 06, 07 and 08. 06 types `northwind rejection march`, takes the chips (Enter), opens
  // the first result and focuses the field again (/). 07 asks the lease question with ⌘Enter against
  // a fake Anthropic (fakeAlfred.ts), opens the source and asks the follow-up. 08 opens the Contoso University
  // email and Add to calendar.
  {
    name: '06-search-with-chips', file: '06-search-with-chips.html', width: 1677, height: 1050,
    patches: [
      NO_DONE,
      NO_EMPTY_MORE,
      readerDate('Mar 14', 'Mar 14, 3:22 PM'),
      {why: 'A real field\'s caret blinks, and the screenshot leaves it out', from: '      <span class="caret"></span>\n', to: ''},
      {why: 'Ask Alfred names the query as the field holds it, the chips\' labels (the board paraphrases it)',
        from: '<span class="ink3">· Northwind rejections in March</span>', to: '<span class="ink3">· Northwind · Rejection · Mar 2026</span>'},
      {why: 'Override 12 and B4\'s reasons: one case style, and the date reason names itself ("Type Rejection · Date Mar 3")',
        from: '<span>type <b>Rejection</b></span><span>·</span><span class="num">Mar 3</span>', to: '<span>Type <b>Rejection</b></span><span>·</span><span>Date <b>Mar 3</b></span>'},
      {why: 'Override 12 and B4\'s reasons: one case style, and the date reason names itself ("Type Rejection · Date Mar 14")',
        from: '<span>type <b>Rejection</b></span><span>·</span><span class="num">Mar 14</span>', to: '<span>Type <b>Rejection</b></span><span>·</span><span>Date <b>Mar 14</b></span>'},
      {why: 'Seed (D3) and B4: the excerpt is the body around the first match, from the start here',
        from: '…we\'ve decided to move forward with other candidates for the Software Engineer Intern role at <mark class="hl">Northwind</mark></div>',
        to: 'Hi there, Thank you for your interest in the Software Engineer Intern role at <mark class="hl">Northwind</mark>, and for the time you put into the take-home exercise. After careful…</div>'},
      {why: '… and the second\'s is its whole body', from: 'Unfortunately, we won\'t be moving forward with your application…</div>',
        to: 'Unfortunately, we won\'t be moving forward with your application for the Data Engineer Intern role.</div>'},
      {why: 'DESIGN.md › The reader: " · organisation · via platform" is ink2, as in 01',
        from: '<span class="ink3">· Northwind Talent · via Greenhouse</span>', to: '<span class="ink2">· Northwind Talent · via Greenhouse</span>'},
      {why: 'Seed (D3): plain text has no styled signature, and the reader highlights every match in it',
        from: '<p style="color: var(--ink2)">Best,<br>The Northwind Recruiting Team</p>', to: '<p>Best,<br>The <mark class="hl">Northwind</mark> Recruiting Team</p>'},
    ],
  },
  {
    name: '07-alfred-s-answer-card', file: '07-alfred-s-answer-card.html', width: 1677, height: 1050,
    patches: [
      NO_DONE,
      NO_EMPTY_MORE,
      readerDate('Sep 30', 'Sep 30, 2:15 PM'),
      downloadOn('            <span class="ink3 num" style="font-size: 12px">PDF · 184 KB</span>\n          </div>', '        </div>'),
      {why: 'A real field\'s caret blinks, and the screenshot leaves it out', from: '            <span class="caret"></span>\n', to: ''},
      {why: 'Both sources are the open email, so both are drawn open (the board marks only the first)', from: '<a class="src" href="#">', to: '<a class="src open" href="#">'},
      {why: 'Seed (D3) and B4: the question also finds the DMV\'s renewal notice by its subject, so 4 results',
        from: '<span class="num">3 results</span>', to: '<span class="num">4 results</span>'},
      {why: '… newest first after the lease (Sep 28)',
        from: '        <div class="why"><span>Subject <b>lease renewal</b></span><span>·</span><span>body <b>signed</b></span></div>\n      </div>\n',
        to: `        <div class="why"><span>Subject <b>lease renewal</b></span><span>·</span><span>Body <b>signed</b></span></div>
      </div>
      <div class="arow">
        <span class="ud"></span>
        <div class="l1"><span class="from">DMV</span></div>
        <div class="r1"><span class="dot sm" style="--c: var(--a-personal)"></span><span>Personal</span><span class="num" style="width: 44px; text-align: right">Sep 28</span></div>
        <div class="l2">Car registration <mark class="hl">renewal</mark> notice</div>
        <div class="l3">Your registration for your vehicle expires soon. Renew online or by mail.</div>
        <div class="why"><span>Subject <b>renewal</b></span></div>
      </div>
`},
      {why: 'Override 12 (one case style, "Body signed" above) and B4: the lease\'s excerpt runs on to the row\'s end',
        from: 'your new term starts Dec 1…</div>', to: 'your new term starts Dec 1. If we haven\'t heard from you by Oct 31, we\'ll treat your unit as available from…</div>'},
      {why: 'The pinned email\'s Unpin is held, as board 10 draws it',
        from: '<button class="tool" style="color: var(--ink)"><span class="ms f">keep</span>Unpin', to: '<button class="tool active" aria-pressed="true"><span class="ms f">keep</span>Unpin'},
      {why: 'DESIGN.md › The reader: " · organisation" is ink2, as in 01 and 10',
        from: '<span class="ink3">· Parkside Apartments</span>', to: '<span class="ink2">· Parkside Apartments</span>'},
      {why: 'Seed (D3): the lease email is plain text, as in 10; the reader highlights the answers\' bold phrases ($2,140 and Oct 31, 2026; $2,060 isn\'t one)',
        from: `<ul>
            <li>Term: 12 months, Dec 1, 2026 – Nov 30, 2027</li>
            <li>New monthly rent: <mark class="hl">$2,140</mark> (currently <mark class="hl">$2,060</mark>)</li>
            <li>Sign by: <mark class="hl">Oct 31, 2026</mark></li>
          </ul>`,
        to: '<p>Term: 12 months, Dec 1, 2026 – Nov 30, 2027<br>New monthly rent: <mark class="hl">$2,140</mark> (currently $2,060)<br>Sign by: <mark class="hl">Oct 31, 2026</mark></p>'},
      {why: '… with the seed\'s office hours, and no styled signature, as in 10',
        from: '<p style="color: var(--ink2)">Thanks,', to: '<p>Questions? Stop by the leasing office, Monday – Friday, 9 AM – 6 PM.</p>\n          <p>Thanks,'},
    ],
  },
  {
    name: '08-proposal-add-to-calendar', file: '08-proposal-add-to-calendar.html', width: 1677, height: 1050,
    patches: [
      NO_EMPTY_MORE,
      readerDate('Mon', 'Oct 5, 10:05 AM'),
      {why: 'Override 8: a new event takes Settings\' reminder default, 10 min before', from: '<span class="grow" style="text-align: left">1 day before</span>', to: '<span class="grow" style="text-align: left">10 min before</span>'},
      {why: 'Decided while building #45: an × after the times sets the event back to all day',
        from: 'aria-label="End" value="9:00 PM"></label>', to: 'aria-label="End" value="9:00 PM"></label><button type="button" class="ibtn sm" aria-label="All day"><span class="ms s16">close</span></button>'},
      {why: 'DESIGN.md › The reader: " · organisation" is ink2, as in 01', from: '<span class="ink3">· Contoso University</span>', to: '<span class="ink2">· Contoso University</span>'},
      {why: 'Seed (D3): the Contoso University email is plain text, its exams one per line',
        from: boardBlock('08-proposal-add-to-calendar.html', '          <table class="fin">', '</table>'),
        to: `          <p>CS 2010 · Intro to programming — Mon, Dec 7 · 5:00 – 7:00 PM · Room 108<br>CS 3310 · Data structures — Tue, Dec 8 · 7:00 – 9:00 PM · Room 214<br>CS 101 · Software engineering — Wed, Dec 9 · 7:00 – 9:00 PM · Room 214<br>CS 4410 · Operating systems — Thu, Dec 10 · 5:00 – 7:00 PM · Room 120<br>CS 4660 · Databases — Fri, Dec 11 · 7:00 – 9:00 PM · Room 108</p>`},
      {why: '… and its sign-off', from: '<p>If two of your exams overlap, contact the department office by Nov 13.</p>',
        to: '<p>If two of your exams overlap, contact the department office by Nov 13.</p>\n          <p>Office of the Registrar, Contoso University</p>'},
      {why: 'Boards 01, 02, 03 and 10: Security and Career, expandable, draw their chevron', from: '<div class="gh">Security <span class="n">3</span></div>',
        to: '<div class="gh">Security <span class="n">3</span><span class="ms chev">expand_more</span></div>'},
      {why: '… Career too', from: '<div class="gh">Career <span class="n">1</span></div>', to: '<div class="gh">Career <span class="n">1</span><span class="ms chev">expand_more</span></div>'},
      ...codeLeadsSecurity('<div class="gh collapsed">Deliveries'),
      DELIVERIES_PREVIEW,
      MONEY_PREVIEW,
      FABRIKAM,
      ...INBOX_SUMMARIES,
      VIEW_HINT,
    ],
  },
  // F6: the editor, recurring scope, drag and a change that failed.
  {
    // Fixture no-dinner (Dinner with Sam isn't on Friday yet); the check types the board's two drafts,
    // gives the first Time to Leave as the board draws it (SV-31) and goes back to it, the line focused.
    name: '13-editor-new-event', file: '13-editor-new-event.html', width: 1677, height: 1050,
    patches: [
      ...SUNDAY_FIRST,
      ...CALENDAR_SEED_PATCHES,
      ...GRID_RINGS,
      {why: 'DESIGN.md › Sidebar on Calendar: the selected day is `sub` in the mini-month (the board draws `sub2` with `ink` text)',
        from: '<span style="background: var(--sub2); color: var(--ink)">9</span>', to: '<span class="vis">9</span>'},
      {why: 'The line\'s marks draw 2 px either side of their text without moving it, so the caret stays on its letter (the board pads them)',
        from: '.sp .tok-d { background: color-mix(in oklch, var(--cool) 18%, transparent); box-shadow: inset 0 -1.5px 0 color-mix(in oklch, var(--cool) 60%, transparent); border-radius: 4px; padding: 0 2px; }',
        to: '.sp .tok-d { background: color-mix(in oklch, var(--cool) 18%, transparent); box-shadow: inset 0 -1.5px 0 color-mix(in oklch, var(--cool) 60%, transparent); border-radius: 4px; padding: 0 2px; margin: 0 -2px; }'},
      {why: '… the place\'s mark too',
        from: '.sp .tok-p { background: color-mix(in oklch, var(--comf) 18%, transparent); box-shadow: inset 0 -1.5px 0 color-mix(in oklch, var(--comf) 60%, transparent); border-radius: 4px; padding: 0 2px; }',
        to: '.sp .tok-p { background: color-mix(in oklch, var(--comf) 18%, transparent); box-shadow: inset 0 -1.5px 0 color-mix(in oklch, var(--comf) 60%, transparent); border-radius: 4px; padding: 0 2px; margin: 0 -2px; }'},
      {why: 'The caret is the field\'s own, which screenshots leave out (the board draws one)', from: '<span class="tok-p">@Blue Door</span><span class="caret"></span>', to: '<span class="tok-p">@Blue Door</span>'},
      {why: 'Contract: a Places suggestion is a name and an address (PlaceSuggestionOut), so the first row reads as the others do',
        from: '<span class="ell"><b style="font-weight: 600">Blue Door</b><span class="ink3"> · 2118 Sunset Blvd</span></span><span class="ell ink3" style="font-size: 12px">Restaurant · Los Angeles</span>',
        to: '<span class="ell"><b style="font-weight: 600">Blue Door</b></span><span class="ell ink3" style="font-size: 12px">2118 Sunset Blvd</span>'},
      {why: 'Override 8: a new event takes Settings › Notifications\' default, 10 min (the board shows 30)', from: '<span class="num">30 min before</span>', to: '<span class="num">10 min before</span>'},
      {why: 'Decided while building #45: an × after the times sets the event back to all day',
        from: 'aria-label="End" value="9:00 PM"></label>', to: 'aria-label="End" value="9:00 PM"></label><button type="button" class="ibtn sm" aria-label="All day"><span class="ms s16">close</span></button>'},
      {why: 'Decided while building #45: the date and times shrink so the row and its × fit the column',
        from: '<label class="field" style="width: 118px"><input class="grow" aria-label="Date"', to: '<label class="field" style="width: 118px; min-width: 0"><input class="grow" aria-label="Date"'},
      {why: 'Decided while building #45: the date and times shrink so the row and its × fit the column',
        from: '<label class="field" style="width: 84px"><input class="grow num" aria-label="Start"', to: '<label class="field" style="width: 84px; min-width: 0"><input class="grow num" aria-label="Start"'},
      {why: 'Decided while building #45: the date and times shrink so the row and its × fit the column',
        from: '<label class="field" style="width: 84px"><input class="grow num" aria-label="End"', to: '<label class="field" style="width: 84px; min-width: 0"><input class="grow num" aria-label="End"'},
      {why: 'Decided while building #49: a folded draft has an × that removes it, beside its row',
        from: `        <button type="button" class="field" style="height: 40px" aria-label="Expand draft: Gym sat 9am">
          <span class="dot sm" style="--c: var(--c-personal)"></span>
          <span class="grow ell" style="text-align: left">Gym <span class="tok-d">sat 9am</span></span>
          <span class="ink3 num" style="font-size: 12px">Sat, Oct 10 · 9:00 AM</span>
          <span class="ms s16 ink3">expand_more</span>
        </button>`,
        to: `        <div style="display: flex; align-items: center; gap: 4px">
        <button type="button" class="field" style="height: 40px; flex: 1; min-width: 0" aria-label="Expand draft: Gym sat 9am">
          <span class="dot sm" style="--c: var(--c-personal)"></span>
          <span class="grow ell" style="text-align: left">Gym <span class="tok-d">sat 9am</span></span>
          <span class="ink3 num" style="font-size: 12px">Sat, Oct 10 · 9:00 AM</span>
          <span class="ms s16 ink3">expand_more</span>
        </button>
        <button type="button" class="ibtn sm" aria-label="Remove draft: Gym sat 9am"><span class="ms s16">close</span></button>
        </div>`},
    ],
  },
  {
    // Gym on Wed, Oct 7 edited to 6:30 – 7:30 AM, then ⌘Enter: the chooser in place of the footer.
    name: '14-editing-a-recurring-event', file: '14-editing-a-recurring-event.html', width: 1677, height: 1050,
    patches: [
      ...SUNDAY_FIRST,
      ...CALENDAR_SEED_PATCHES,
      ...GRID_RINGS,
      {why: 'Override 6: the recurring scope defaults to "This event" in the editor too (the board defaults to "This and following")',
        from: '<button type="button" class="ropt" role="radio" aria-checked="false"><span class="rad"></span><span class="grow"><span style="display: block">This event</span>',
        to: '<button type="button" class="ropt on" role="radio" aria-checked="true"><span class="rad"></span><span class="grow"><span style="display: block">This event</span>'},
      {why: '… so This and following isn\'t chosen',
        from: '<button type="button" class="ropt on" role="radio" aria-checked="true"><span class="rad"></span><span class="grow"><span style="display: block">This and following</span>',
        to: '<button type="button" class="ropt" role="radio" aria-checked="false"><span class="rad"></span><span class="grow"><span style="display: block">This and following</span>'},
      {why: 'Decided while building #45: an × after the times sets the event back to all day',
        from: 'aria-label="End" value="7:30 AM"></label>', to: 'aria-label="End" value="7:30 AM"></label><button type="button" class="ibtn sm" aria-label="All day"><span class="ms s16">close</span></button>'},
      {why: 'Decided while building #45: the date and times shrink so the row and its × fit the column',
        from: '<label class="field" style="width: 118px"><input class="grow" aria-label="Date"', to: '<label class="field" style="width: 118px; min-width: 0"><input class="grow" aria-label="Date"'},
      {why: 'Decided while building #45: the date and times shrink so the row and its × fit the column',
        from: '<label class="field" style="width: 84px; box-shadow: inset 0 0 0 1px var(--edgeOn)"><input class="grow num" aria-label="Start"', to: '<label class="field" style="width: 84px; min-width: 0; box-shadow: inset 0 0 0 1px var(--edgeOn)"><input class="grow num" aria-label="Start"'},
      {why: 'Decided while building #45: the date and times shrink so the row and its × fit the column',
        from: '<label class="field" style="width: 84px; box-shadow: inset 0 0 0 1px var(--edgeOn)"><input class="grow num" aria-label="End"', to: '<label class="field" style="width: 84px; min-width: 0; box-shadow: inset 0 0 0 1px var(--edgeOn)"><input class="grow num" aria-label="End"'},
    ],
  },
  {
    // Wednesday's Gym pressed at its 72, 8 and held over Thursday at 524, 296 (the section's pixels).
    name: '15-drag-in-progress', file: '15-drag-in-progress.html', width: 1677, height: 1050,
    patches: [
      ...SUNDAY_FIRST,
      ...CALENDAR_SEED_PATCHES,
      ...AGENDA_OCT_7_PATCHES,
      ...GRID_RINGS,
      ...AGENDA_OCT_7_RINGS,
      {why: 'The pointer is the system\'s own, which screenshots leave out (the board draws one)',
        from: boardBlock('15-drag-in-progress.html', '      <svg width="16" height="20"', '</svg>'), to: ''},
      {why: 'SV-29: with Sunday first, Thursday is a column (147 px) on, so the lifted chip held over it is too',
        from: 'position: absolute; left: 452px; top: 288px;', to: 'position: absolute; left: 599px; top: 288px;'},
      {why: '… and its tip', from: 'position: absolute; left: 470px; top: 318px;', to: 'position: absolute; left: 617px; top: 318px;'},
    ],
  },
  {
    // The same drag let go over Thursday: the drop waits on This event, This and following or All events.
    name: '15b-dropped-this-following-or-all', file: '15b-dropped-this-following-or-all.html', width: 1677, height: 1050,
    patches: [
      ...SUNDAY_FIRST,
      ...CALENDAR_SEED_PATCHES,
      ...GRID_RINGS,
      ...AGENDA_OCT_7_RINGS,
      placed('2:30 – 3:30 PM', 'Personal', 'Smile Dental'),
      num('7:00 – 8:00 AM · Moving to Thu, Oct 8'),
      {why: 'Override 7: the drop prompt takes the side covering the fewest items, centred on the dropped chip; with Sunday first (SV-29) Thursday has too little room to its right, so it\'s left of it',
        from: 'aria-label="Move recurring event" style="position: absolute; left: 447px; top: 263px;', to: 'aria-label="Move recurring event" style="position: absolute; left: 286px; top: 115px;'},
    ],
  },
  {
    // Fixture failed-change: Dinner with Sam's move to Saturday refused with Google's 409, and Pay
    // rent's completion waiting for Todoist; time-to-leave gives Dentist its Leave by; stale-todoist
    // (SV-20) draws the right pane's "Todoist · as of 8:40 AM".
    name: '19b-states-a-change-that-failed', file: '19b-states-a-change-that-failed.html', width: 1677, height: 1050,
    patches: [
      ...SUNDAY_FIRST,
      ...CALENDAR_SEED_PATCHES,
      ...AGENDA_OCT_7_PATCHES,
      gridRing('CS 101 lab report', SCHOOL), gridRing('Renew car registration', HOME), agendaRing('CS 101 lab report', SCHOOL),
      STATUS_COMMAS('Todoist · as of 8:40 AM'),
      {why: 'Override 7: the failed card takes the side covering the fewest items, below the chip (2 there), centred on it and slid left to stay 8 px inside the grid, as the app places it (the board draws it 3 px further right)',
        from: 'aria-label="Dinner with Sam" style="position: absolute; left: 712px; top: 263px;', to: 'aria-label="Dinner with Sam" style="position: absolute; left: 709px; top: 265px;'},
      ...CELL_TEMPS,
      MONTH_EDGES,
      {why: 'DESIGN.md › Health and states: a change waiting for its provider shows at .5 opacity with its spinner (the grid)',
        from: '<div class="tk done"><span class="ring"></span>Pay rent<span class="ms"', to: '<div class="tk done" style="opacity: .5"><span class="ring"></span>Pay rent<span class="ms"'},
      {why: '… and the agenda',
        from: '<a class="ag-item" href="#" style="align-items: center">\n        <span class="ring done" style="width: 15px; height: 15px; margin-left: 2px"></span>',
        to: '<a class="ag-item" href="#" style="align-items: center; opacity: .5">\n        <span class="ring done" style="width: 15px; height: 15px; margin-left: 2px"></span>'},
    ],
  },
  // F7: ⌘K, Settings, every health state, and Light. 22a and 22b are boards 01 and 11 in Light, so
  // they take the same patches, plus Light's page.
  {name: '22a-light-inbox', file: '22a-light-inbox.html', width: 1677, height: 1050, patches: [...BOARD_01_PATCHES, LIGHT_PAGE]},
  {name: '22b-light-calendar', file: '22b-light-calendar.html', width: 1677, height: 1050, patches: [...SUNDAY_FIRST, ...CALENDAR_SEED_PATCHES, ...AGENDA_OCT_7_PATCHES, ...GRID_RINGS, ...AGENDA_OCT_7_RINGS, LIGHT_PAGE]},
  {
    // Fixtures needs-reconnect, stale-icloud and triage-down; the check cuts the live stream at the
    // seed's moment.
    name: '19a-states-reconnect-offline-unsorted', file: '19a-states-reconnect-offline-unsorted.html', width: 1677, height: 1050,
    patches: [
      SIDEBAR_RECONNECT,
      {why: 'The stream was cut at the seed\'s moment, 9:12 AM, with the clock held', from: 'Offline · as of 9:11 AM · retrying', to: 'Offline, as of 9:12 AM, retrying'},
      STATUS_COMMAS('Triage is down · as of 9:09 AM'),
      STATUS_COMMAS('iCloud · as of 8:40 AM'),
      ...codeLeadsSecurity('<div class="gh collapsed">Deliveries'),
      DELIVERIES_PREVIEW,
      MONEY_PREVIEW,
      FABRIKAM,
      ...INBOX_SUMMARIES,
      VIEW_HINT,
    ],
  },
  {
    // Board 01's state (Northwind open), then ⌘K.
    name: '20-cmd-k-on-an-open-email', file: '20-cmd-k-on-an-open-email.html', width: 1677, height: 1050,
    patches: [
      ...BOARD_01_PATCHES,
      ...CHEVRONS,
      {why: 'Decided while building #67: ⌘K runs commands, not search, so it asks for a command',
        from: 'placeholder="Type a command or search…" aria-label="Type a command or search"', to: 'placeholder="Type a command…" aria-label="Type a command"'},
      {why: 'DESIGN.md › ⌘K and N4: Go to lists News 3',
        from: '\n    <button class="menu-i"><span class="ms">settings</span><span>Settings</span><span class="kbd">⌘,</span></button>',
        to: `\n    <button class="menu-i"><svg class="ms" width="18" height="18" viewBox="0 -960 960 960" fill="currentColor" style="display: block; flex: none"><path d="${NEWSPAPER}"></path></svg><span>News</span><span class="kbd">3</span></button>
    <button class="menu-i"><span class="ms">settings</span><span>Settings</span><span class="kbd">⌘,</span></button>`},
    ],
  },
  {
    // Fixtures needs-reconnect, stale-personal, checked, precision and ntfy (Home); Settings › Accounts over the Inbox.
    name: '17-settings-accounts', file: '17-settings-accounts.html', width: 1677, height: 1050,
    patches: [
      SIDEBAR_RECONNECT,
      {why: 'Board 19a\'s reconnect bar (DESIGN.md › Health and states: "Business needs sign-in · Reconnect"), as the states board draws it',
        from: '<div class="bar caution"><span class="ms s16">warning</span><span>Business needs sign-in</span><a href="#" style="color: var(--caution); font-weight: 500">Reconnect</a></div>',
        to: '<div class="bar caution"><span class="ms f s16">warning</span><span>Business needs sign-in</span><span>·</span><button style="color: var(--ink); height: 26px; padding: 0 10px; border-radius: 999px; display: inline-flex; align-items: center; margin-left: -10px">Reconnect</button></div>'},
      {why: '… and its stale line, with the schedule glyph', from: '<div class="bar muted"><span class="dot sm" style="--c: var(--a-personal)"></span><span>Personal · as of 9:14 PM</span></div>',
        to: '<div class="bar muted"><span class="ms s16">schedule</span><span>Personal, as of 9:14 PM</span></div>'},
      STATUS_COMMAS('Checks stopped · as of 9:14 PM'),
      ...INBOX_UNDER_SETTINGS,
      SIGN_OUT,
      {why: 'Seed (D3): iCloud last checked a minute before the seed\'s moment, like the other accounts',
        from: '<span class="prov">iCloud · IMAP every 2 min</span>\n          <span class="state"><span class="num">Checked 9:10 AM</span></span>',
        to: '<span class="prov">iCloud · IMAP every 2 min</span>\n          <span class="state"><span class="num">Checked 9:11 AM</span></span>'},
      {why: 'Seed (D3): Todoist has three projects (Inbox, School, Home), Inbox the default', from: 'Inbox · 2 projects', to: 'Inbox · 3 projects'},
    ],
  },
  {
    // Fixture mail-rules; consolidatedmessenger.example under the pointer, as drawn.
    name: '18a-settings-mail', file: '18a-settings-mail.html', width: 1677, height: 1050,
    patches: [
      ...INBOX_UNDER_SETTINGS,
      SIGN_OUT,
      ruleSentence('From <b>university.edu</b> with “Registrar” in the subject'),
      ruleSentence('From <b>woodgrovebank.example</b>'),
      ruleSentence('From <b>news.fabrikam.com</b>'),
      {why: 'Fixture: the rules have sorted nothing this month', from: '<span class="when num">2 this month</span>', to: '<span class="when num">None this month</span>'},
      {why: '…', from: '<span class="when num">9 this month</span>', to: '<span class="when num">None this month</span>'},
      {why: '…', from: '<span class="when num">31 this month</span>', to: '<span class="when num">None this month</span>'},
      {why: 'Contract: a learned rule is an organisation and a type, so Proseware\'s reads "Proseware alerts"', from: '<b>Proseware service notices</b>', to: '<b>Proseware alerts</b>'},
      {why: 'Contract: the code expiry presets are 5, 10, 15, 30 and 60 minutes (CODE_EXPIRY_PRESETS)', from: '<span>5 min</span><span class="on">15 min</span>', to: '<span>5 min</span><span>10 min</span><span class="on">15 min</span>'},
    ],
  },
  {
    // Fixture ntfy: the server, last sent 8:02 AM, and Home.
    name: '18b-settings-notifications', file: '18b-settings-notifications.html', width: 1677, height: 1050,
    patches: [
      ...INBOX_UNDER_SETTINGS, SIGN_OUT,
      {why: 'Decided while building #82: ntfy\'s Token, write-only like the AI keys, under the Server',
        from: `          <label class="field url"><input class="grow" value="https://ntfy.example.net" aria-label="ntfy server"></label>
        </div>`,
        to: `          <label class="field url"><input class="grow" value="https://ntfy.example.net" aria-label="ntfy server"></label>
        </div>
        <div class="set-row one"><div class="lines grow"><span class="t">Token</span><span class="s">If the server asks for one · Not set</span></div><button class="btn out sm" type="button">Set token</button></div>`},
    ],
  },
  {name: '21a-phone-inbox', file: '21-phone-inbox-reader-agenda.html', width: 1394, height: 1020, phone: 0, patches: BOARD_21_PATCHES},
  {name: '21b-phone-reader', file: '21-phone-inbox-reader-agenda.html', width: 1394, height: 1020, phone: 1, patches: BOARD_21_PATCHES},
  {name: '21c-phone-agenda', file: '21-phone-inbox-reader-agenda.html', width: 1394, height: 1020, phone: 2, patches: BOARD_21_PATCHES},
  ...NEWS_BOARDS,
];

/** A board's HTML with every board's patches and its own applied; one of its own that doesn't match exactly once throws. */
export function patchedBoard(board: Board): string {
  let html = fs.readFileSync(path.join(ROOT, 'design-export', board.dir ?? 'boards', board.file), 'utf8');
  // Round 3 (News) draws Day stack already.
  if (!board.dir && !html.includes(PLACEHOLDER_MARK)) throw new Error(`${board.name}: the placeholder mark isn't drawn as expected.`);
  html = html.replaceAll(PLACEHOLDER_MARK, DAY_STACK);
  for (const patch of EVERY_BOARD) {
    const count = html.split(patch.from).length - 1;
    if (count > 1) throw new Error(`${board.name}: the patch "${patch.why}" matches ${count} times, not once or none.`);
    html = html.replace(patch.from, () => patch.to);
  }
  for (const patch of board.patches) {
    const count = html.split(patch.from).length - 1;
    const times = patch.times ?? 1;
    if (count !== times) throw new Error(`${board.name}: the patch "${patch.why}" matches ${count} times, not ${times === 1 ? 'once' : times}.`);
    html = html.replaceAll(patch.from, () => patch.to);
  }
  return html;
}

const TYPES: Record<string, string> = {'.html': 'text/html', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json'};

/** Serves design-export/ on a local port, with each board's patched HTML in place of its own. */
function serveExport(): Promise<{base: string; close: () => void}> {
  const root = path.join(ROOT, 'design-export');
  const patched = new Map(BOARDS.map(board => [`/${board.dir ?? 'boards'}/${board.file}`, patchedBoard(board)]));
  const server = http.createServer((request, response) => {
    const url = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    const body = patched.get(url);
    if (body !== undefined) {
      response.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'}).end(body);
      return;
    }
    const file = path.join(root, path.normalize(url));
    if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream'}).end(fs.readFileSync(file));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const {port} = server.address() as {port: number};
    resolve({base: `http://127.0.0.1:${port}`, close: () => server.close()});
  }));
}

/** Where the audit's page and images go (git ignores it). */
const AUDIT = path.join(ROOT, 'test-results', 'audit');

const escape = (text: string) => text.replace(/[&<>"]/g, char => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'})[char]!);

const figure = (label: string, file: string) => `<figure><figcaption>${label}</figcaption><a href="${file}"><img src="${file}" alt="${label}" loading="lazy"></a></figure>`;

interface Part {
  name: string;
  summary: string;
  compared: boolean;
}

function section(board: Board, parts: Part[]): string {
  const decided = board.patches.length
    ? `<details><summary>${board.patches.length} decided differences</summary><ul>${board.patches.map(patch => `<li>${escape(patch.why)}</li>`).join('')}</ul></details>`
    : '';
  const shown = parts.map(({name, summary, compared}) => {
    const images = compared
      ? [figure('Board', `${name}.board.png`), figure('App (approved)', `${name}.app.png`), figure('Diff (red differs)', `${name}.diff.png`)]
      : [figure('Board', `${name}.board.png`)];
    return `<h3>${name} <span>${summary}</span></h3><div class="row">${images.join('')}</div>`;
  });
  return `<section id="${board.name}"><h2>${board.name}</h2>${decided}${shown.join('')}</section>`;
}

function report(sections: string[]): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Board audit</title>
<style>
:root { color-scheme: light dark; --page: #f6f6f4; --ink: #1d1d1b; --ink3: #77776f; --hair: #00000018; }
@media (prefers-color-scheme: dark) { :root { --page: #161615; --ink: #ecece8; --ink3: #8d8d86; --hair: #ffffff18; } }
body { margin: 0; padding: 24px 16px 64px; background: var(--page); color: var(--ink); font: 14px/1.5 system-ui, sans-serif; }
h1 { font-size: 20px; margin: 0 0 4px; }
header p, details, h3 span, figcaption { color: var(--ink3); }
section { border-top: 1px solid var(--hair); padding: 16px 0; }
h2 { font-size: 15px; margin: 0 0 6px; }
h3 { font-size: 13px; font-weight: 500; margin: 12px 0 6px; }
h3 span { font-weight: 400; margin-left: 8px; }
details { margin-bottom: 10px; font-size: 13px; }
.row { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
figure { margin: 0; }
figcaption { font-size: 12px; margin-bottom: 4px; }
img { width: 100%; height: auto; display: block; border: 1px solid var(--hair); }
</style></head><body>
<header><h1>Board audit</h1>
<p>Each board as drawn, after the patches DESIGN.md has decided, beside the app's approved screenshots of the same state (web/tests/browser/goldens/), each cropped to the region its check covers, and their diff. Every board also draws the mark as Day stack (#87) and the Today block's named tasks (#78). The app's screenshots leave the mark out, except 01's sidebar, 22a and 21a, which check it. Anything the diff shows that no listed difference explains is a gap: a patch nobody wrote yet, or the app departing from the board.</p></header>
${sections.join('\n')}
</body></html>
`;
}

/** A board's approved screenshots: the whole state (<name>.png), or regions of it (<name>.<part>.png). */
function goldensOf(board: Board): string[] {
  if (!fs.existsSync(GOLDENS)) return [];
  return fs.readdirSync(GOLDENS).filter(file => file === `${board.name}.png` || (file.startsWith(`${board.name}.`) && file.endsWith('.png')))
    .map(file => file.slice(0, -'.png'.length)).sort();
}

/** Where a region's screenshot sits on the page (matchGolden keeps it beside it), sized as the screenshot is. */
function regionOf(name: string, png: Buffer): {x: number; y: number; width: number; height: number} | null {
  const box = path.join(GOLDENS, `${name}.json`);
  if (!fs.existsSync(box)) return null;
  const {x, y} = JSON.parse(fs.readFileSync(box, 'utf8')) as {x: number; y: number};
  return {x, y, width: png.readUInt32BE(16), height: png.readUInt32BE(20)};
}

/** Draws every board, sets each approved screenshot beside the same region of its board with a diff, and writes the audit's page. */
export async function audit(): Promise<string> {
  const {base, close} = await serveExport();
  const browser = await launchBrowser();
  const sections: string[] = [];
  try {
    fs.mkdirSync(AUDIT, {recursive: true});
    for (const board of BOARDS) {
      const page = await browser.newPage({viewport: {width: board.width, height: board.height}, deviceScaleFactor: 1});
      await page.goto(`${base}/${board.dir ?? 'boards'}/${board.file}`);
      await page.evaluate(() => document.fonts.ready);
      const draw = (clip?: {x: number; y: number; width: number; height: number}) =>
        (board.phone === undefined ? page.screenshot({clip}) : page.locator('.phone').nth(board.phone).screenshot());
      const parts: Part[] = [];
      const names = goldensOf(board);
      if (!names.length) {
        fs.writeFileSync(path.join(AUDIT, `${board.name}.board.png`), await draw());
        console.log(`${board.name}: no approved screenshot yet`);
        parts.push({name: board.name, summary: 'No approved screenshot yet', compared: false});
      }
      for (const name of names) {
        const app = fs.readFileSync(path.join(GOLDENS, `${name}.png`));
        const drawn = await draw(regionOf(name, app) ?? undefined);
        fs.writeFileSync(path.join(AUDIT, `${name}.board.png`), drawn);
        fs.writeFileSync(path.join(AUDIT, `${name}.app.png`), app);
        const result = await compareImages(drawn, app);
        fs.writeFileSync(path.join(AUDIT, `${name}.diff.png`), result.diff);
        const summary = `${(result.ratio * 100).toFixed(2)}% of pixels differ (${result.differing})`;
        console.log(`${name}: ${summary}`);
        parts.push({name, summary, compared: true});
      }
      await page.close();
      sections.push(section(board, parts));
    }
  } finally {
    close();
  }
  const file = path.join(AUDIT, 'index.html');
  fs.writeFileSync(file, report(sections));
  return file;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  try {
    console.log(`Wrote ${path.relative(ROOT, await audit())}`);
  } finally {
    await closeBrowser();
  }
}
