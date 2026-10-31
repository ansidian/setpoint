// What Jobs's menus hold (DESIGN.md › Needs you, Corrections; boards 34a, 35a, 35b; #266–#268), built
// from the page's rows and the actions the page passes in, so More, a row's right-click and the
// status chip draw from one list (#248). Pure: the page and the pane decide what each action does.
import type {ApplicationRowOut, JdCandidateOut, JobEventOut, JobStatus, NeedsYouItemOut} from '@setpoint/shared';
import type {MenuEntry, MenuItem, MenuSpec} from './Menu.tsx';
import {appliedWord, markLabel, markOf, STATUS_LABELS, titleOf} from './words.ts';

// Words a company's name may carry or drop without being another company (as the server matches them).
const SUFFIXES = new Set(['the', 'inc', 'incorporated', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'co', 'company', 'plc', 'gmbh']);
const companyWords = (company: string) => company.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word && !SUFFIXES.has(word));

/** Companies match loosely: case, punctuation and "Inc." ignored, one name the start of the other ("Fabrikam Labs" is "Fabrikam"). */
export function sameCompany(a: string, b: string): boolean {
  const [short, long] = [companyWords(a), companyWords(b)].sort((x, y) => x.length - y.length) as [string[], string[]];
  return short.length > 0 && short.every((word, index) => long[index] === word);
}

const newestFirst = (a: ApplicationRowOut, b: ApplicationRowOut) => b.applied_at.localeCompare(a.applied_at) || b.id - a.id;

/** An application as a 44 px item: its role over "Applied Sep 30 · Applied" (or its company first, outside its company's group). */
function applicationItem(row: ApplicationRowOut, today: string, withCompany: boolean, run: () => void): MenuItem {
  return {
    kind: 'item', id: `a${row.id}`, icon: 'work', label: withCompany ? `${row.company} · ${titleOf(row)}` : titleOf(row),
    sub: `Applied ${appliedWord(row.applied_on, today).replace(/^Today$/, 'today')} · ${markLabel(row)}`, run,
  };
}

/** The search's words each start a word of the company or the role, loosely, as Jobs's search does. */
function matchesQuery(row: ApplicationRowOut, query: string): boolean {
  const words = query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const text = `${row.company} ${row.title}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return words.every(word => text.some(each => each.startsWith(word)));
}

/**
 * Another application… (and Merge with…): a search over every application but these, by company or
 * role; before a word is typed, the company's own first (when there's a company), then the six newest.
 */
export function searchApplications(label: string, rows: ApplicationRowOut[], {except, company, today, placeholder, run}: {
  except: number[];
  company: string | null;
  today: string;
  placeholder: string;
  run: (row: ApplicationRowOut) => void;
}): MenuSpec {
  const others = rows.filter(row => !except.includes(row.id)).sort(newestFirst);
  return {
    label, width: 330, entries: [],
    search: {
      placeholder,
      entries: query => {
        if (query.trim()) {
          const found = others.filter(row => matchesQuery(row, query)).slice(0, 8);
          return found.length ? found.map(row => applicationItem(row, today, true, () => run(row))) : [{kind: 'label', label: 'No application matches'}];
        }
        const own = company ? others.filter(row => sameCompany(row.company, company)) : [];
        const recent = others.filter(row => !own.includes(row)).slice(0, 6);
        return [
          ...(own.length ? [{kind: 'label', label: company!} as const, ...own.map(row => applicationItem(row, today, false, () => run(row)))] : []),
          ...(recent.length ? [{kind: 'label', label: 'Recent'} as const, ...recent.map(row => applicationItem(row, today, true, () => run(row)))] : []),
        ];
      },
    },
  };
}

/**
 * Assign to… (34a, 312 wide): the company's applications first under its name, then Another
 * application… and Not about a job.
 */
export function assignMenu(item: NeedsYouItemOut, rows: ApplicationRowOut[], today: string, on: {assign: (row: ApplicationRowOut) => void; notAJob: () => void}): MenuSpec {
  const own = rows.filter(row => sameCompany(row.company, item.company)).sort(newestFirst);
  return {
    label: 'Assign to', width: 312,
    entries: [
      ...(own.length ? [{kind: 'label', label: item.company} as const, ...own.map(row => applicationItem(row, today, false, () => on.assign(row)))] : []),
      ...(own.length ? [{kind: 'sep'} as const] : []),
      {kind: 'item', id: 'another', icon: 'search', label: 'Another application…',
        submenu: () => searchApplications('Another application', rows, {except: own.map(row => row.id), company: null, today, placeholder: 'Search applications', run: on.assign})},
      {kind: 'item', id: 'not-a-job', icon: 'block', label: 'Not about a job', run: on.notAJob},
    ],
  };
}

/** A candidate's second line: "New York, NY · Greenhouse". */
export const candidateWhere = (candidate: JdCandidateOut) => [candidate.location, candidate.platform].filter(Boolean).join(' · ');

/** What a candidate's line adds when opening it came back as nothing Jobs can read (SV-140). */
export const CANT_READ = 'Jobs can\'t read this one';

/** From history's Choose… (#266): each candidate with its open_in_new, then None of these. */
export function chooseMenu(candidates: JdCandidateOut[], on: {pick: (candidate: JdCandidateOut) => void; none: () => void}): MenuSpec {
  return {
    label: 'Choose the posting', width: 330,
    entries: [
      ...candidates.map((candidate): MenuEntry => ({
        kind: 'item', id: `c${candidate.id}`, icon: 'description', label: candidate.title, sub: [candidateWhere(candidate), candidate.unreadable && CANT_READ].filter(Boolean).join(' · '), peek: candidate.link, run: () => on.pick(candidate),
      })),
      {kind: 'sep'},
      {kind: 'item', id: 'none', icon: 'block', label: 'None of these', run: on.none},
    ],
  };
}

const STATUSES: JobStatus[] = ['applied', 'in_process', 'offer', 'rejected', 'withdrawn'];

/**
 * Set status (#267, D365): the five in their colours, the current one checked; while it's set by
 * hand, Let emails decide ends it. Ghosted isn't one: it's a flag.
 */
export function statusMenu(row: Pick<ApplicationRowOut, 'status' | 'status_set_by'>, on: {set: (status: JobStatus | null) => void}): MenuSpec {
  return {
    label: 'Set status', width: 220,
    entries: [
      ...STATUSES.map((status): MenuEntry => ({
        kind: 'item', id: status, mark: markOf({status, ghosted: false}), label: STATUS_LABELS[status], checked: row.status === status, run: () => on.set(status),
      })),
      ...(row.status_set_by === 'user' ? [{kind: 'sep'} as const, {kind: 'item', id: 'emails', icon: 'mail', label: 'Let emails decide', run: () => on.set(null)} as const] : []),
    ],
  };
}

export interface CorrectionActions {
  editCompany: () => void;
  editTitle: () => void;
  setStatus: (status: JobStatus | null) => void;
  merge: (other: ApplicationRowOut) => void;
  notThisPosting: () => void;
  lookUpAgain: () => void;
  notAnApplication: () => void;
  remove: () => void;
}

/**
 * More's list (35b, 300 wide), which a row's right-click shares: the two edits, Set status ›, Merge
 * with… ›; Not this posting and Look up the JD again; then the two that remove it, each saying how
 * it differs (D321).
 */
export function moreEntries(row: ApplicationRowOut, rows: ApplicationRowOut[], today: string, on: CorrectionActions): MenuEntry[] {
  const saved = row.jd.state === 'found';
  return [
    {kind: 'item', id: 'company', icon: 'edit', label: 'Edit company', run: on.editCompany},
    {kind: 'item', id: 'title', icon: 'edit_note', label: 'Edit title', run: on.editTitle},
    {kind: 'item', id: 'status', icon: 'radio_button_checked', label: 'Set status', submenu: () => statusMenu(row, {set: on.setStatus})},
    {kind: 'item', id: 'merge', icon: 'merge', label: 'Merge with…',
      submenu: () => searchApplications('Merge with', rows, {except: [row.id], company: row.company, today, placeholder: 'Search applications', run: on.merge})},
    {kind: 'sep'},
    {kind: 'item', id: 'not-this-posting', icon: 'link_off', label: 'Not this posting', disabled: !saved, title: saved ? undefined : 'No JD saved to take away', run: on.notThisPosting},
    {kind: 'item', id: 'look-up', icon: 'manage_search', label: 'Look up the JD again', disabled: saved || row.jd.state === 'looking',
      title: saved ? 'Not this posting first: a saved JD is never replaced' : row.jd.state === 'looking' ? 'Looking for the posting' : undefined, run: on.lookUpAgain},
    {kind: 'sep'},
    {kind: 'item', id: 'not-an-application', icon: 'visibility_off', label: 'Not an application', sub: 'Hides it · its emails never make one again', run: on.notAnApplication},
    {kind: 'item', id: 'delete', icon: 'delete', label: 'Delete', sub: 'Forgets it · a later email can make it again', danger: true, run: on.remove},
  ];
}

export const moreMenu = (row: ApplicationRowOut, rows: ApplicationRowOut[], today: string, on: CorrectionActions): MenuSpec => ({label: 'More', width: 300, entries: moreEntries(row, rows, today, on)});

/**
 * A row's right-click (#268, D366): Open ↵, Open posting O with a link, More's list, then Copy
 * company and role and Copy posting link.
 */
export function rowMenu(row: ApplicationRowOut, rows: ApplicationRowOut[], today: string, on: CorrectionActions & {open: () => void; openPosting: () => void; copy: (text: string) => void}): MenuSpec {
  const link = row.jd.link;
  return {
    label: `${row.company} · ${titleOf(row)}`, width: 300,
    entries: [
      {kind: 'item', id: 'open', icon: 'open_in_full', label: 'Open', hint: '↵', run: on.open},
      ...(link ? [{kind: 'item', id: 'posting', icon: 'open_in_new', label: 'Open posting', hint: 'O', run: on.openPosting} as const] : []),
      {kind: 'sep'},
      ...moreEntries(row, rows, today, on),
      {kind: 'sep'},
      {kind: 'item', id: 'copy', icon: 'content_copy', label: 'Copy company and role', run: () => on.copy(`${row.company} · ${titleOf(row)}`)},
      ...(link ? [{kind: 'item', id: 'copy-link', icon: 'content_copy', label: 'Copy posting link', run: () => on.copy(link)} as const] : []),
    ],
  };
}

/**
 * An event's ··· (35a, 220 wide): Open email while Gmail has it (#269), Move to… (the company's other
 * applications, then Another application…) and Not about this.
 */
export function eventMenu(event: JobEventOut, application: ApplicationRowOut, rows: ApplicationRowOut[], today: string, on: {
  openEmail: (messageId: number) => void;
  move: (row: ApplicationRowOut) => void;
  notAboutThis: () => void;
}): MenuSpec {
  const own = rows.filter(row => row.id !== application.id && sameCompany(row.company, application.company)).sort(newestFirst);
  const messageId = event.message_id;
  return {
    label: 'Event', width: 220,
    entries: [
      ...(messageId !== null ? [{kind: 'item', id: 'open', icon: 'mail', label: 'Open email', run: () => on.openEmail(messageId)} as const] : []),
      {kind: 'item', id: 'move', icon: 'move_item', label: 'Move to…', submenu: () => ({
        label: 'Move to', width: 300,
        entries: [
          ...(own.length ? [{kind: 'label', label: application.company} as const, ...own.map(row => applicationItem(row, today, false, () => on.move(row)))] : []),
          ...(own.length ? [{kind: 'sep'} as const] : []),
          {kind: 'item', id: 'another', icon: 'search', label: 'Another application…',
            submenu: () => searchApplications('Another application', rows, {except: [application.id, ...own.map(row => row.id)], company: null, today, placeholder: 'Search applications', run: on.move})},
        ],
      })},
      {kind: 'item', id: 'not-about-this', icon: 'undo', label: 'Not about this', run: on.notAboutThis},
    ],
  };
}
