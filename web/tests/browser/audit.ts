// The design-conformance audit (SV-33, D69): each board beside the app's page screenshot of the
// same state (goldens/, the ten pages.ts keeps, D281), with a diff, on one page to read,
// test-results/audit/index.html; a board without one is drawn alone. It has no
// pass or fail. Each board is drawn by Chromium at its exact size from design-export/boards/, News's
// from design-export/news/boards/ and Jobs's from design-export/jobs/boards/ (SV decision D7: the
// export holds board HTML, not PNGs),
// after its listed patches: DESIGN.md's
// Overrides to the export, and where the dev seed (decision D3) or DESIGN.md's own text says
// otherwise than the board. The patches are the differences already decided, so what the diff
// still shows is either a patch nobody wrote yet or a real gap. Every patch must match its board
// exactly once, so a changed board fails loudly. release:check runs it before a release, only when
// its inputs have changed since it last ran (passes.ts); it can also be run by hand:
//
//   npm run audit:boards
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {colour, evtint, lightColour} from '../../src/tokens.ts';
import {record, treeOf, unchanged} from '../passes.ts';
import {closeBrowser, compareImages, GOLDENS, launchBrowser, ROOT} from './harness.ts';

export interface Patch {
  why: string;
  from: string;
  to: string;
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

// J8 (override 37, DESIGN.md › Jobs › Shell and Jobs in Settings): the sidebar's Jobs item under News,
// its Needs you count in ink2 (the seed's 3), and Settings' nav listing Jobs between News and AI, on
// every board from before Jobs (01–31); its `work` glyph is drawn from glyphs/icons.json.
const WORK = JSON.parse(fs.readFileSync(path.join(ROOT, 'design-export', 'glyphs', 'icons.json'), 'utf8')).work.d as string;
const WORK_GLYPH = `<svg class="ms" width="18" height="18" viewBox="0 -960 960 960" fill="currentColor" style="display: block; flex: none"><path d="${WORK}"></path></svg>`;
const JOBS_NAV = `\n  <a class="nav" href="#">${WORK_GLYPH}<span class="grow">Jobs</span><span class="cnt num" style="color: var(--ink2)">3</span></a>`;
const JOBS_SIDEBAR = 'Override 37 (J8): the sidebar\'s Jobs item under News, its Needs you count in ink2';
const JOBS_SETTINGS_NAV = 'Override 37 (J8): Settings\' nav lists Jobs between News and AI';
const SETTINGS_JOBS = `\n    <a class="nav" href="#">${WORK_GLYPH}<span class="grow">Jobs</span></a>`;
const JOBS_EVERYWHERE: Patch[] = [
  // Round 2, after N4's News item; round 3, after its own.
  {why: JOBS_SIDEBAR, from: NEWS_NAV, to: `${NEWS_NAV}${JOBS_NAV}`},
  {why: JOBS_SIDEBAR, from: '<span class="ms">newspaper</span><span class="grow">News</span></a>\n  <div class="sb-sec">', to: `<span class="ms">newspaper</span><span class="grow">News</span></a>${JOBS_NAV}\n  <div class="sb-sec">`},
  {why: JOBS_SIDEBAR, from: '<span class="ms">newspaper</span><span class="grow">News</span></a>\n\n  <div class="sb-sec">', to: `<span class="ms">newspaper</span><span class="grow">News</span></a>${JOBS_NAV}\n\n  <div class="sb-sec">`},
  // Round 2, after N5's News item.
  {why: JOBS_SETTINGS_NAV, from: '<span class="grow">News</span><span class="ms s16" style="color: var(--caution)">warning</span></a>\n    <a class="nav" href="#"><span class="ms">auto_awesome</span>',
    to: `<span class="grow">News</span><span class="ms s16" style="color: var(--caution)">warning</span></a>${SETTINGS_JOBS}\n    <a class="nav" href="#"><span class="ms">auto_awesome</span>`},
];

// Decided while building #304 (SV-181): Calendar's header has Import .ics… before Search; its
// `download` glyph is drawn from glyphs/icons.json, which the round-2 font lacks.
const DOWNLOAD = JSON.parse(fs.readFileSync(path.join(ROOT, 'design-export', 'glyphs', 'icons.json'), 'utf8')).download.d as string;
const IMPORT_ICS: Patch = {
  why: 'Decided while building #304: Import .ics…, the header\'s download button before Search',
  from: '<button class="ibtn" aria-label="Search calendar"><span class="ms">search</span></button>',
  to: `<button class="ibtn" aria-label="Import .ics…"><svg class="ms" width="18" height="18" viewBox="0 -960 960 960" fill="currentColor" style="display: block; flex: none"><path d="${DOWNLOAD}"></path></svg></button>\n    <button class="ibtn" aria-label="Search calendar"><span class="ms">search</span></button>`,
};

/** Patches for every board that draws what they change; a board without it skips them. */
const EVERY_BOARD: Patch[] = [AUDIT_TOKENS, TODAY_NAMED];
/** And for every board from before Jobs (01–31): Jobs's boards draw News and Jobs themselves. */
const BEFORE_JOBS: Patch[] = [
  SETTINGS_NEWS_NAV,
  newsNav('\n  <a class="nav" href="#" style="margin-top: 2px"><span class="ms">calendar_month</span><span class="grow">Calendar</span></a>'),
  newsNav('\n  <a class="nav on" href="#"><span class="ms">calendar_month</span><span class="grow">Calendar</span></a>'),
  ...JOBS_EVERYWHERE,
];

// Decided while building #87: the mark is Day stack (Icon.tsx's Mark), where every board draws the
// placeholder, twice on board 21, so it's replaced wherever it appears rather than as a patch.
const PLACEHOLDER_MARK = '<svg width="18" height="18" viewBox="0 0 22 22" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-dasharray="31 10" stroke-linecap="round" transform="rotate(-38 11 11)"></circle><circle cx="15.6" cy="6.4" r="2" fill="currentColor"></circle></svg>';
const DAY_STACK = '<svg width="18" height="18" viewBox="0 0 22 22" aria-hidden="true"><rect x="2" y="2.6" width="13.5" height="4.6" rx="2.3" style="fill: var(--cool)"></rect><rect x="5.5" y="8.7" width="13.5" height="4.6" rx="2.3" style="fill: var(--caution)" transform="rotate(-6 12.25 11)"></rect><rect x="2" y="14.8" width="10" height="4.6" rx="2.3" style="fill: var(--violet)"></rect></svg>';

const NEWS_DIR = 'news/boards';
const JOBS_DIR = 'jobs/boards';
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

// Wed, Oct 7's agenda as board 11 draws it, with Time to Leave from the time-to-leave fixture.
const AGENDA_OCT_7_PATCHES: Patch[] = [num('7:00 – 8:00 AM · Personal'), placed('2:30 – 3:30 PM', 'Personal', 'Smile Dental')];

// The code row as board 17 draws it, last in Security.
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

const DELIVERIES_PREVIEW: Patch = {why: 'Seed (D3) and D9: a collapsed group\'s organisations, newest first (Consolidated Messenger 2h, Wingtip Toys 6h, Southridge Video Mon)', from: 'Wingtip Toys · Consolidated Messenger · Southridge Video', to: 'Consolidated Messenger · Wingtip Toys · Southridge Video'};
const MONEY_PREVIEW: Patch = {why: 'Seed (D3) and D9: newest first (Woodgrove Bank 5h, Proseware 8h, Woodgrove Pay yesterday)', from: 'Woodgrove Bank · Woodgrove Pay · Proseware', to: 'Woodgrove Bank · Proseware · Woodgrove Pay'};
const FABRIKAM: Patch = {why: 'Seed (D3) and DESIGN.md › The list: Fabrikam\'s subject is "Application received", its summary "Data Analyst", then its platform',
  from: '<b>Application received · Data Analyst</b> <span class="sum">· via Workday</span>', to: '<b>Application received</b> <span class="sum">· Data Analyst · via Workday</span>'};

// Decided while building #35 (SV-25): in the Inbox's list a row's summary takes its subject's place,
// the platform still after it.
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
const VIEW_HINT: Patch = {why: 'Decided while building #36 and #105: U\'s hint on the view it switches to',
  from: '<span class="seg"><span class="on">Unread</span><span>All</span></span>', to: '<span class="seg"><span class="on">Unread</span><span>All<span class="kbd">U</span></span></span>'};

// Board 01's patches, which 22a (board 01 in Light) shares.
// Decided while building #23 (SV-24): More shows only on Security and Noise mail, where it holds Add to calendar and Add as task.

const NO_EMPTY_MORE: Patch = {why: 'Decided while building #23: More holds nothing on this email, so it doesn\'t show',
  from: '\n        <button class="ibtn" aria-label="More"><span class="ms">more_horiz</span></button>', to: ''};

// Decided while building #25 (D50): error and status lines join their parts with commas.
const STATUS_COMMAS = (line: string): Patch => ({why: 'Decided while building #25: status lines take commas', from: line, to: line.replaceAll(' · ', ', ')});

// Decided while building #238 (SV-67): the reader shows the email's summary under its subject.
const readerSummary = (subject: string, summary: string, phone = false): Patch => {
  const h1 = `<h1 class="rd-subj"${phone ? ' style="font-size: 21px"' : ''}>${subject}</h1>`;
  return {why: 'Decided while building #238: the reader shows the summary under its subject', from: h1,
    to: `${h1}<p style="margin: ${phone ? -10 : -6}px 0 0; color: var(--ink2); font-size: ${phone ? 15 : 14}px; line-height: 1.45; max-width: 680px">${summary}</p>`};
};
const NORTHWIND_SUMMARY = 'Pick a 30-minute slot this week';

const BOARD_01_PATCHES: Patch[] = [
  readerSummary('Interview availability for Software Engineer I', NORTHWIND_SUMMARY),
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
// draws them (board 17 leaves Security's and Career's out).
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

// The Inbox under Settings, as board 01 has it (D9's order, the seed's previews and Fabrikam).
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

// Board 21's three phones (Inbox, reader, agenda); the audit takes the Inbox, at 390 × 844.
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
  readerSummary('Interview availability for Software Engineer I', NORTHWIND_SUMMARY, true),
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
function newsIcons(names: string[] = NEWS_ICONS, why = 'Off the network: News\'s icons from glyphs/icons.json, not Google Fonts; the placeholders\' icon and outlet name stand in for the real image'): Patch {
  const glyphs = JSON.parse(fs.readFileSync(path.join(ROOT, 'design-export', 'glyphs', 'icons.json'), 'utf8')) as Record<string, {d: string}>;
  const paths = Object.fromEntries(names.map(name => [name, glyphs[name]!.d]));
  return {
    why,
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

// ---- News in Light (N5; board 31) ----

// Round 3's later boards draw CS 101's ring without the project colour 25 gives it.
const N5_TODAY: Patch[] = [
  newsToday('CS 101 lab report', 'margin: 0 3px 0 1px', SCHOOL), newsToday('Pay rent', 'margin: 0 3px 0 1px', HOME),
  newsToday('Renew car registration', 'margin: 0 3px 0 1px', HOME, 'Tomorrow'),
];
// Board 31 is board 25 in Light, so it takes 25's patches, with CS 101's ring as the later boards draw it.
const BOARD_31_PATCHES: Patch[] = [...BOARD_25_PATCHES.filter(patch => !patch.from.includes('today-row')), ...N5_TODAY];

/**
 * News's boards (design round 3). The app's rows keep their arrival dots for the visit once seen
 * (#95), as the boards draw them. 31 is on the seed in Light; the boards draw only some of each
 * block, so the patches add the seed's rows down to the fold.
 */
const NEWS_BOARDS: Board[] = [
  {name: '25-news-a-typical-morning', file: '25-news-a-typical-morning.html', dir: NEWS_DIR, width: 1677, height: 1050, patches: BOARD_25_PATCHES},
  {name: '31-light-news', file: '31-light-news.html', dir: NEWS_DIR, width: 1677, height: 1050, patches: BOARD_31_PATCHES},
];

// Jobs's boards (design round 4) load the full icon font for their icons, as round 3 does; the audit
// draws every one from glyphs/icons.json instead, as the app does (override 34).
const JOBS_ICONS = [
  'add', 'alt_route', 'alternate_email', 'arrow_back', 'arrow_downward', 'arrow_forward', 'arrow_upward', 'article', 'auto_awesome', 'block', 'bookmark_add', 'business',
  'calendar_month', 'campaign', 'check', 'check_circle', 'chevron_right', 'close', 'content_copy', 'contrast', 'delete', 'description', 'edit', 'edit_note', 'event',
  'expand_less', 'expand_more', 'flag', 'hide_image', 'history', 'home_work', 'inbox', 'info', 'keep', 'keyboard_arrow_down', 'keyboard_arrow_up', 'link', 'link_off',
  'local_shipping', 'location_on', 'lock', 'lock_clock', 'mail', 'manage_search', 'mark_email_read', 'mark_email_unread', 'merge', 'more_horiz', 'move_item', 'newspaper',
  'notifications', 'open_in_new', 'payments', 'pending', 'pending_actions', 'person', 'progress_activity', 'radio_button_checked', 'radio_button_unchecked', 'remove',
  'search', 'search_off', 'settings', 'shield', 'task_alt', 'travel_explore', 'undo', 'visibility_off', 'warning', 'work',
];
const JOBS_ICONS_PATCH = newsIcons(JOBS_ICONS, 'Override 34: Jobs\'s icons from glyphs/icons.json, not Google Fonts');
// #264 and #265: In process in its own cobalt (its mark, label and an In process event's node), Rejected's
// disc `alert` and Ghosted's dashed ring `sunGlyph`, where the boards draw them ink and ink3. Override 35:
// Glyphs' sizes per role, 16 where the boards draw 15 (the JD glyph, From history's, the chip's, the
// reader's badge) and 17 (a small button's, by the stylesheet's cascade), 14 where they draw 13.
const JOBS_COLOURS: Patch = {
  why: '#264, #265 and override 35: In process cobalt, Rejected\'s disc alert, Ghosted\'s ring sunGlyph; Jobs\'s glyphs at Glyphs\' sizes',
  from: '</style>\n</head>',
  to: `.sp{--inProcess:${colour.inProcess};--sunGlyph:${colour.sunGlyph}} .sp.light{--inProcess:${lightColour.inProcess};--sunGlyph:${lightColour.sunGlyph}}
.sp .sd.proc, .sp .jb-ev.proc .node i { background: var(--inProcess); } .sp .sl.proc { color: var(--inProcess); }
.sp .sd.rej { background: var(--alert); } .sp .sd.ghost { border-color: var(--sunGlyph); }
.sp .jb-need .btn .ms, .sp .jb-tr .jd .ms, .sp .jb-hist > .ms, .sp .jb-chip > .ms, .sp .jb-badge.lg .ms { font-size: 16px; }
.sp .st .by, .sp .jb-badge .ms { font-size: 14px; }
</style>\n</head>`,
};
/** A Jobs board at 1677 × 1050 with Jobs's icons and colours, and the Today block's tasks where it has them. */
const jobsBoard = (file: string, patches: Patch[] = [], today = true): Board =>
  ({name: file.replace(/\.html$/, ''), file, dir: JOBS_DIR, width: 1677, height: 1050, patches: [JOBS_ICONS_PATCH, JOBS_COLOURS, ...today ? N5_TODAY : [], ...patches]});

/** A row of the table beside the detail (32): Platform dropped, JD its glyph. */
const jobsRow = (company: string, role: string, applied: string, status: 'applied' | 'proc' | 'rej', step = '', jd = 'description') => {
  const label = {applied: 'Applied', proc: 'In process', rej: 'Rejected'}[status];
  return `      <div class="jb-tr${status === 'rej' ? ' closed' : ''}"><span></span><span class="co">${company}</span><span class="ro">${role}</span><span class="pl c-plat"></span>`
    + `<span class="ap">${applied}</span><span class="st${status === 'proc' ? ' proc' : ''}"><i class="sd ${status}"></i><span class="sl ${status}">${label}</span>${step && `<span class="step">· ${step}</span>`}</span>`
    + `<span class="jd"><span class="ms">${jd}</span></span></div>\n`;
};

const BOARD_32_PATCHES: Patch[] = [
  {why: 'Seed (D3): the table holds every application, newest first, so Sep 27\'s three, Sep 26\'s, Sep 25\'s, Sep 24\'s, Sep 23\'s and Sep 22\'s come before Litware, down to the fold',
    from: boardBlock('32-jobs-a-typical-morning.html', '      <div class="jb-tr"><span></span><span class="co">Litware</span>', '<span class="co">Northwind Talent</span><span class="ro">Junior Developer</span>', JOBS_DIR),
    to: [
      jobsRow('Coho Winery', 'Software Developer', 'Sep 27', 'applied'), jobsRow('Southridge Video', 'Web Developer', 'Sep 27', 'applied'),
      jobsRow('Lamna Healthcare', 'Junior Developer', 'Sep 27', 'applied'), jobsRow('A. Datum Corporation', 'Support Engineer', 'Sep 26', 'applied'),
      jobsRow('School of Fine Art', 'Developer', 'Sep 25', 'rej', 'Oct 5'), jobsRow('Munson\'s Pickles and Preserves Farm', 'Software Engineer', 'Sep 24', 'rej', 'Oct 1'),
      jobsRow('VanArsdel', 'Application Developer', 'Sep 23', 'applied'), jobsRow('Fincher Architects', 'Software Developer', 'Sep 22', 'rej', 'Oct 6'),
      jobsRow('Litware', 'QA Engineer', 'Sep 21', 'proc', 'Case study due Oct 12'),
    ].join('') + '      <div class="jb-tr closed"><span></span><span class="co">Northwind Talent</span><span class="ro">Junior Developer</span>'},
  {why: '#265: how the posting was found follows "Full posting" with no dot', from: '<span class="how grow">· Found on Greenhouse', to: '<span class="how grow">Found on Greenhouse'},
  {why: '#269: the verification email Gmail no longer has says so on its line (the seed keeps no message for it)',
    from: '<span class="t"><span class="s">Verify your email</span></span>', to: '<span class="t"><span class="s">Verify your email</span><span class="s">· No longer in Gmail</span></span>'},
];

const NEWS_FAILING_NAV = (on: string): Patch => ({
  why: 'N5 (override 24): Settings\' News item carries its warning glyph while the seed\'s FOX 11 fails',
  from: `<span class="grow">News</span></a>\n    <a class="nav${on}" href="#"><span class="ms">work</span>`,
  to: `<span class="grow">News</span><span class="ms s16" style="color: var(--caution)">warning</span></a>\n    <a class="nav${on}" href="#"><span class="ms">work</span>`,
});
const needsKey = (sub: string): Patch => ({
  why: 'D315, as News\'s rows: with no Anthropic key (the seed sets none), each model\'s row says one is needed',
  from: `<span class="s">${sub}</span>`, to: `<span class="s">${sub} · needs a key</span>`,
});
const BOARD_34B_PATCHES: Patch[] = [
  {why: '#287: an answered item shows no outcome line, so the leaving item keeps its candidate\'s words',
    from: `<span class="jb-done"><span class="ms f">check_circle</span>JD saved</span>
          <span class="ink3">· Junior Developer · New York, NY · Greenhouse</span>`,
    to: '<span class="ink3">Junior Developer · New York, NY · Greenhouse</span>'},
];
const BOARD_38A_PATCHES: Patch[] = [
  {why: '#292: the history pass draws no skeleton rows over the table',
    from: boardBlock('38a-states-the-history-pass.html', '      <div class="jb-tr sk">', '\n\n', JOBS_DIR), to: ''},
];
const BOARD_38C_PATCHES: Patch[] = [
  {why: 'DESIGN.md › Jobs › States: while Jobs is off it has no item in the sidebar (38c draws it, current)',
    from: '\n  <a class="nav on" href="#"><span class="ms">work</span><span class="grow">Jobs</span></a>', to: ''},
];
const BOARD_39A_PATCHES: Patch[] = [
  NEWS_FAILING_NAV(' on'),
];
const BOARD_39B_PATCHES: Patch[] = [
  NEWS_FAILING_NAV(''),
  needsKey('Role title, requisition ID, the event, the match'), needsKey('When the email\'s link and the platforms miss'),
  needsKey('Summary, must-haves and nice-to-haves, salary and setting'),
];

/**
 * Jobs's boards (design round 4, J8). Board 32 is set beside its page screenshot (pages.ts); the rest are
 * drawn alone, their states held by jobs.spec.ts, jobsMail.spec.ts and jobsStates.spec.ts. Where the
 * app differs by a decision, DESIGN.md lists it (overrides 34–37, Decided while building #261–#274).
 */
const JOBS_BOARDS: Board[] = [
  jobsBoard('32-jobs-a-typical-morning.html', BOARD_32_PATCHES),
  {...jobsBoard('32b-a-narrow-window.html', [], false), width: 1024, height: 768},
  jobsBoard('33-the-jds-full-text.html'),
  jobsBoard('34a-needs-you-each-kind.html'),
  jobsBoard('34b-an-item-resolving-from-history.html', BOARD_34B_PATCHES),
  jobsBoard('34c-track-this-resolved.html'),
  jobsBoard('35a-corrections-edit-in-place-move-to.html'),
  jobsBoard('35b-corrections-more-merge-with.html'),
  jobsBoard('36a-search-humongous.html'),
  jobsBoard('36b-search-kubernetes.html'),
  jobsBoard('37a-in-mail-the-jd-chip.html'),
  jobsBoard('37b-in-mail-the-chip-opens-its-jd.html'),
  jobsBoard('37c-in-mail-applied-before.html'),
  jobsBoard('38a-states-the-history-pass.html', BOARD_38A_PATCHES),
  jobsBoard('38b-states-not-read-no-jd-ghosted-set-by-hand.html'),
  jobsBoard('38c-states-jobs-off.html', BOARD_38C_PATCHES),
  jobsBoard('39a-settings-jobs.html', BOARD_39A_PATCHES, false),
  jobsBoard('39b-settings-ai.html', BOARD_39B_PATCHES, false),
  jobsBoard('40-light-jobs.html'),
  {...jobsBoard('states-hover-and-state.html', [], false), height: 1180},
];

export const BOARDS: Board[] = [
  {
    name: '01-inbox-a-typical-morning', file: '01-inbox-a-typical-morning.html', width: 1677, height: 1050,
    patches: BOARD_01_PATCHES,
  },
  {
    name: '11-calendar-october-2026', file: '11-calendar-october-2026.html', width: 1677, height: 1050,
    patches: [
      ...SUNDAY_FIRST,
      ...CALENDAR_SEED_PATCHES,
      ...AGENDA_OCT_7_PATCHES,
      ...GRID_RINGS,
      ...AGENDA_OCT_7_RINGS,
      IMPORT_ICS,
    ],
  },
  // F6: the editor.
  {
    // Fixture no-dinner (Dinner with Sam isn't on Friday yet); the check types the board's two drafts,
    // gives the first Time to Leave as the board draws it (SV-31) and goes back to it, the line focused.
    name: '13-editor-new-event', file: '13-editor-new-event.html', width: 1677, height: 1050,
    patches: [
      ...SUNDAY_FIRST,
      ...CALENDAR_SEED_PATCHES,
      ...GRID_RINGS,
      IMPORT_ICS,
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
  // F7: Settings and Light. 22a and 22b are boards 01 and 11 in Light, so
  // they take the same patches, plus Light's page.
  {name: '22a-light-inbox', file: '22a-light-inbox.html', width: 1677, height: 1050, patches: [...BOARD_01_PATCHES, LIGHT_PAGE]},
  {name: '22b-light-calendar', file: '22b-light-calendar.html', width: 1677, height: 1050, patches: [...SUNDAY_FIRST, ...CALENDAR_SEED_PATCHES, ...AGENDA_OCT_7_PATCHES, ...GRID_RINGS, ...AGENDA_OCT_7_RINGS, IMPORT_ICS, LIGHT_PAGE]},
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
  {name: '21a-phone-inbox', file: '21-phone-inbox-reader-agenda.html', width: 1394, height: 1020, phone: 0, patches: BOARD_21_PATCHES},
  ...NEWS_BOARDS,
  ...JOBS_BOARDS,
];

/** A board's HTML with every board's patches and its own applied; one of its own that doesn't match exactly once throws. */
export function patchedBoard(board: Board): string {
  let html = fs.readFileSync(path.join(ROOT, 'design-export', board.dir ?? 'boards', board.file), 'utf8');
  // Round 3 (News) draws Day stack already.
  if (!board.dir && !html.includes(PLACEHOLDER_MARK)) throw new Error(`${board.name}: the placeholder mark isn't drawn as expected.`);
  html = html.replaceAll(PLACEHOLDER_MARK, DAY_STACK);
  for (const patch of board.dir === JOBS_DIR ? EVERY_BOARD : [...EVERY_BOARD, ...BEFORE_JOBS]) {
    const count = html.split(patch.from).length - 1;
    if (count > 1) throw new Error(`${board.name}: the patch "${patch.why}" matches ${count} times, not once or none.`);
    html = html.replace(patch.from, () => patch.to);
  }
  for (const patch of board.patches) {
    const count = html.split(patch.from).length - 1;
    if (count !== 1) throw new Error(`${board.name}: the patch "${patch.why}" matches ${count} times, not once.`);
    html = html.replace(patch.from, () => patch.to);
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
<p>Each board as drawn, after the patches DESIGN.md has decided, beside the app's page screenshot of the same state (web/tests/browser/goldens/, the ten the release keeps, D281) and their diff; a board without one is drawn alone. Every board also draws the mark as Day stack (#87) and the Today block's named tasks (#78). Anything the diff shows that no listed difference explains is a gap: a patch nobody wrote yet, or the app departing from the board.</p></header>
${sections.join('\n')}
</body></html>
`;
}

/** A board's page screenshot, if pages.ts keeps one for it. */
function goldenOf(board: Board): string | null {
  return fs.existsSync(path.join(GOLDENS, `${board.name}.png`)) ? board.name : null;
}

/** Draws every board, sets each page screenshot beside its board with a diff, and writes the audit's page. */
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
      const draw = () => (board.phone === undefined ? page.screenshot() : page.locator('.phone').nth(board.phone).screenshot());
      const parts: Part[] = [];
      const name = goldenOf(board);
      if (!name) {
        fs.writeFileSync(path.join(AUDIT, `${board.name}.board.png`), await draw());
        console.log(`${board.name}: no page screenshot`);
        parts.push({name: board.name, summary: 'No page screenshot (D281)', compared: false});
      } else {
        const app = fs.readFileSync(path.join(GOLDENS, `${name}.png`));
        const drawn = await draw();
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
    const tree = treeOf();
    console.log(`Wrote ${path.relative(ROOT, await audit())}`);
    if (unchanged(tree, treeOf(), 'audit')) record(tree, 'audit');
  } finally {
    await closeBrowser();
  }
}
