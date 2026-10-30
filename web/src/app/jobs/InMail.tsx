// Jobs in mail (J7; DESIGN.md › Jobs › In mail; boards 37a–37c; D306): what Jobs draws in mail's
// slots (app/slots.tsx), filled from App.tsx, a wiring point, so mail never imports Jobs.
//
// - The reader's head: the JD chip on an email that belongs to an application ("Software Engineer I
//   · Applied Oct 1 · In process"), opening its JD in a popover that grows from the chip: the head,
//   What they want, the facts and both lists, and a foot with how it was found, Full posting and Open
//   in Jobs. Esc, a click away or the chip closes it at once. Open in Jobs arrives with the
//   application open, the pane simply there; Full posting arrives scrolled to it, unfolded (#271).
//   Or, on a job board's match email whose company matches applications, Applied before at 26 px
//   where the chip sits.
// - Each of the Inbox's rows: Applied before at 20 px after the subject, a Noise row's too.
// Both badges open Jobs searched for the company, showing every application there.
//
// One request answers the rows the list shows, and one the email open (GET /api/jobs/mail); being
// under /jobs, a `jobs` event refreshes both (logic/live.ts). Nothing here touches mail's counts
// (D313). Desktop only (decision 49): on the phone neither slot draws, and nothing is asked.
import type {ApplicationOut, JobsMailApplicationOut, JobsMailMessageOut, JobsMailOut, JobsNavOut, MessageRowOut} from '@setpoint/shared';
import {JOBS_MAIL_MAX} from '@setpoint/shared';
import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {timeZone as userZone} from '../../api/auth.ts';
import {useResource, useResources} from '../../api/client.ts';
import {fullTimestamp, localDate} from '../../logic/format.ts';
import {Icon} from '../../ui/Icon.tsx';
import {useMenuRef} from '../../ui/popover.ts';
import {useNow} from '../clock.ts';
import {usePhone} from '../Phone.tsx';
import {navigate} from '../router.ts';
import {Bar, Sk} from '../states/Loading.tsx';
import type {MailSlots} from '../slots.tsx';
import {applicationPath, mailPath, NAV_PATH} from './api.ts';
import {JdFacts, JdLists} from './Detail.tsx';
import {appliedLine, appliedStanding, chipRole, foundLine, foundShort, lookingWhere, markLabel, markOf, notFoundLine, titleOf} from './words.ts';

/** What the list last knew of each email, so the reader's chip draws with its head. */
const known = new Map<number, JobsMailMessageOut | null>();

/** Whether mail's slots show anything: on the desktop, while Jobs isn't known to be off. */
function useShown(): boolean {
  const phone = usePhone();
  const {data: nav} = useResource<JobsNavOut>(phone ? null : NAV_PATH);
  return !phone && nav?.enabled !== false;
}

function useToday() {
  const now = useNow();
  const zone = userZone();
  return {today: localDate(now, zone), zone};
}

/** Ids newest first, in requests of up to 500. */
function split(ids: number[]): number[][] {
  const sorted = [...ids].sort((a, b) => b - a);
  const out: number[][] = [];
  for (let at = 0; at < sorted.length; at += JOBS_MAIL_MAX) out.push(sorted.slice(at, at + JOBS_MAIL_MAX));
  return out;
}

// Past this many requests the list's rows are asked about afresh in as few as they fit, so a `jobs`
// event refreshes a handful, however long the Inbox has been open.
const MOST_REQUESTS = 4;

/**
 * The requests the list's rows are asked about in: one for the rows it first draws, then one for
 * each set it adds (a page loaded, a day's Noise opened, mail arriving), never one per row. A request
 * none of whose rows are shown any more goes.
 */
function useChunks(rows: readonly MessageRowOut[], shown: boolean): number[][] {
  const [chunks, setChunks] = useState<number[][]>([]);
  if (!shown) {
    if (chunks.length) setChunks([]);
    return [];
  }
  const ids = new Set(rows.map(row => row.id));
  const asked = new Set(chunks.flat());
  const fresh = [...ids].filter(id => !asked.has(id));
  if (!fresh.length) return chunks;
  const kept = chunks.filter(chunk => chunk.some(id => ids.has(id)));
  const next = kept.length + 1 > MOST_REQUESTS ? split([...ids]) : [...kept, ...split(fresh)];
  setChunks(next);
  return next;
}

/** The list's slot: Applied before after a row's subject, all of the list's rows asked about at once. */
function useRows(rows: readonly MessageRowOut[]): (row: MessageRowOut) => ReactNode {
  const shown = useShown();
  const {today} = useToday();
  const chunks = useChunks(rows, shown);
  const paths = useMemo(() => chunks.map(mailPath), [chunks]);
  const answers = useResources<JobsMailOut>(paths);
  // What each answer said, kept while a list that changed is asked again, so a badge never blinks.
  const [kept, setKept] = useState<{answers: (JobsMailOut | undefined)[]; byId: ReadonlyMap<number, JobsMailMessageOut | null>}>({answers: [], byId: new Map()});
  let byId = kept.byId;
  if (answers !== kept.answers) {
    const next = new Map(kept.byId);
    answers.forEach((answer, index) => {
      if (!answer) return;
      for (const id of chunks[index] ?? []) next.set(id, null);
      for (const message of answer.messages) next.set(message.message_id, message);
    });
    byId = next;
    setKept({answers, byId: next});
  }
  useEffect(() => {
    for (const [id, message] of byId) known.set(id, message);
  }, [byId]);
  return row => {
    const before = shown ? byId.get(row.id)?.applied_before : null;
    return before ? <AppliedBefore before={before} today={today} /> : null;
  };
}

/** The reader's slot: the JD chip, or Applied before where it sits; nothing otherwise. */
function Reader({row}: {row: MessageRowOut}) {
  const shown = useShown();
  const {data} = useResource<JobsMailOut>(shown ? mailPath([row.id]) : null);
  const {today, zone} = useToday();
  const message = !shown ? null : data ? data.messages.find(each => each.message_id === row.id) ?? null : known.get(row.id) ?? null;
  const application = message?.application ?? null;
  // The application's detail is asked for as the chip draws, so its popover has it when it opens.
  const {data: detail} = useResource<ApplicationOut>(application ? applicationPath(application.id) : null);
  if (application) return <JdChip key={application.id} application={application} detail={detail?.id === application.id ? detail : undefined} today={today} timeZone={zone} />;
  if (message?.applied_before) return <AppliedBefore before={message.applied_before} today={today} large />;
  return null;
}

/** What App.tsx fills mail's slots with. */
export const jobsMailSlots: MailSlots = {useRows, Reader};

/**
 * Applied before (37c): "Applied Sep 16 · Rejected Oct 5", the most recent application at the
 * company; 20 px on the row, 26 px in the reader. It opens Jobs searched for the company.
 */
export function AppliedBefore({before, today, large = false}: {before: NonNullable<JobsMailMessageOut['applied_before']>; today: string; large?: boolean}) {
  const company = before.latest.company;
  return (
    <button type="button" className={large ? 'jb-badge lg' : 'jb-badge'} data-jobs="applied-before"
      title={large ? `Open in Jobs · every application at ${company}` : `Open Jobs searched for ${company}`}
      onMouseDown={event => event.stopPropagation()}
      onClick={event => {
        // On a row, the badge opens Jobs, not the email.
        event.stopPropagation();
        navigate({page: 'jobs', open: null, q: before.query});
      }}>
      <Icon name="history" size={large ? 16 : 14} /><span className="ell">{appliedStanding(before.latest, today)}</span>
    </button>
  );
}

// The popover's width, and what it keeps clear of the reader's right edge (its head's padding).
const POPOVER_WIDTH = 460;
const PANE_PADDING = 28;

/** The popover as wide as it's drawn, or as the reader leaves room for from the chip to its right padding. */
function fit(element: HTMLElement | null) {
  const anchor = element?.parentElement;
  if (!element || !anchor) return;
  const zoom = (document.documentElement as HTMLElement & {currentCSSZoom?: number}).currentCSSZoom || 1;
  const right = (element.closest('.rd-scroll') ?? document.documentElement).getBoundingClientRect().right;
  const room = (right - anchor.getBoundingClientRect().left) / zoom - PANE_PADDING;
  element.style.width = `${Math.max(0, Math.min(POPOVER_WIDTH, room))}px`;
}

/** The JD chip (37a) and its popover (37b), which shows the application's detail once it's in. */
export function JdChip({application, detail, today, timeZone}: {application: JobsMailApplicationOut; detail: ApplicationOut | undefined; today: string; timeZone: string}) {
  const [open, setOpen] = useState(false);
  const menuRef = useMenuRef(open, () => setOpen(false));
  // 460 wide, or as wide as the reader leaves it beside a narrower pane (the sweep caught it at 1100).
  const popover = useRef<HTMLElement | null>(null);
  // Stable, so it's placed (and grows in) once as it opens, not again with each draw.
  const pop = useCallback((element: HTMLElement | null) => {
    popover.current = element;
    fit(element);
    menuRef(element);
  }, [menuRef]);
  useEffect(() => {
    if (!open) return;
    const refit = () => fit(popover.current);
    window.addEventListener('resize', refit);
    return () => window.removeEventListener('resize', refit);
  }, [open]);
  // Esc puts the popover away before the page's own Esc (it closes the reader) sees it.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open]);
  const stand = appliedStanding(application, today);
  return (
    <div className="jb-chipwrap">
      <button type="button" className="jb-chip" data-jobs="jd-chip" title="The job description you applied to" aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen(!open)}>
        <Icon name="work" size={16} />
        <span className="t">{chipRole(application)}</span>
        <span className="num ell">· {stand}</span>
        <Icon name="expand_more" size={16} className="chev" />
      </button>
      {open && (
        <div ref={pop} className="pop jb-pop" role="dialog" aria-label="Job description">
          <JdPopover application={application} detail={detail} today={today} timeZone={timeZone} onLeave={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}

function JdPopover({application, detail, today, timeZone, onLeave}: {
  application: JobsMailApplicationOut;
  detail: ApplicationOut | undefined;
  today: string;
  timeZone: string;
  onLeave: () => void;
}) {
  const mark = markOf(application);
  const posting = detail?.posting ?? null;
  const go = (to: 'top' | 'posting') => {
    onLeave();
    navigate({page: 'jobs', open: application.id, ...(to === 'posting' ? {posting: true} as const : {})});
  };
  return (
    <>
      <div className="ph-head">
        <div className="co"><span className="name">{application.company}</span>{detail?.platform && <span>· via {detail.platform}</span>}</div>
        <div className="ti">{titleOf(application)}</div>
        <div className="st"><i className={`sd ${mark}`} /><span className={`sl ${mark}`}>{markLabel(application)}</span><span className="num">· {appliedLine(application.applied_on, today)}</span></div>
      </div>
      <div className="bd">
        {!detail ? (
          <Sk kind="jobs-pop" className="jb-skel"><Bar w="92%" h={10} /><Bar w="86%" h={10} /><Bar w="54%" h={10} /></Sk>
        ) : posting ? (
          <>
            <div>
              <h2 className="jb-label">What they want</h2>
              <p className="want">{posting.summary}</p>
            </div>
            <JdFacts posting={posting} />
            <JdLists posting={posting} />
          </>
        ) : <NoJd detail={detail} timeZone={timeZone} today={today} />}
      </div>
      <div className="ft">
        <span className="grow ell" title={posting ? foundLine(posting, timeZone, today) : undefined}>{posting ? foundShort(posting, timeZone, today) : ''}</span>
        {posting && <button className="btn quiet sm" type="button" onClick={() => go('posting')}><Icon name="article" size={16} />Full posting</button>}
        <button className="btn quiet sm" type="button" onClick={() => go('top')}>Open in Jobs<Icon name="arrow_forward" size={16} /></button>
      </div>
    </>
  );
}

/** Where the JD stands without one, in the page's words: No JD found, Looking for the posting…, and the rest. */
function NoJd({detail, timeZone, today}: {detail: ApplicationOut; timeZone: string; today: string}) {
  const {jd} = detail;
  if (jd.state === 'looking') {
    return (
      <div className="jb-popnojd" role="status">
        <span className="spin"><Icon name="progress_activity" size={16} /></span>
        <span className="ell"><span className="ink2">Looking for the posting…</span> <span className="num">· {lookingWhere(detail.platform)}</span></span>
      </div>
    );
  }
  const line = jd.state === 'not_found'
    ? {icon: 'search_off' as const, lead: 'No JD found', rest: notFoundLine(detail.platform, jd.looked_at, timeZone, today)}
    : jd.state === 'candidates'
      ? {icon: 'pending' as const, lead: 'Is this the posting?', rest: `${jd.candidates} ${jd.candidates === 1 ? 'candidate' : 'candidates'} in Needs you`}
      : {icon: 'remove' as const, lead: 'Not looked up', rest: detail.status === 'rejected' || detail.status === 'withdrawn' ? 'it was closed before Jobs read it' : 'Jobs hasn\'t looked for it yet'};
  return (
    <div className="jb-popnojd" title={jd.looked_at ? fullTimestamp(jd.looked_at, timeZone) : undefined}>
      <Icon name={line.icon} size={16} />
      <span className="ell"><span className="ink2">{line.lead}</span> <span className="num">· {line.rest}</span></span>
    </div>
  );
}
