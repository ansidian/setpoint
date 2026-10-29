// An application's detail (DESIGN.md › The application's detail; boards 32, 32b, 33, 34c, 38b): where
// the reading pane sits, and as wide. Its tools (Back in a narrow window, Open posting `O`, or Open
// email while a JD with no link is looked up; previous and next); its head (the company, "via" its
// platform, the account and Applied; the title; the status and its latest step; "First seen in this
// email"); then the JD first (D307): what they want, the facts, both lists and the full posting one
// step away, or where the JD stands (looking, No JD found with Look it up, candidates in Needs you);
// the timeline, each event opening its email; Applied before at the company, and its other
// applications. More, the title's pencil and each event's ··· are J6's corrections and not drawn yet.
import type {AccountOut, ApplicationLinkOut, ApplicationOut, ApplicationRowOut, JobEventOut} from '@setpoint/shared';
import {useState} from 'react';
import type {CSSProperties, RefObject} from 'react';
import {useResource} from '../../api/client.ts';
import {age, fullTimestamp, localDate} from '../../logic/format.ts';
import {Icon} from '../../ui/Icon.tsx';
import {dotStyle} from '../accounts.ts';
import {useReadingPaneWidth} from '../readingPane.ts';
import {PaneEdge} from '../Reader.tsx';
import {LoadFailed, useLoadFailed} from '../states/Loading.tsx';
import {Bar, Sk} from '../states/Loading.tsx';
import {toastFailure} from '../toast.ts';
import {applicationPath, lookUp} from './api.ts';
import {FullPosting} from './FullPosting.tsx';
import type {FullPostingHandle} from './FullPosting.tsx';
import {appliedLine, dayWord, latestStep, lookingWhere, markLabel, markOf, notFoundLine, STATUS_LABELS, titleOf} from './words.ts';

const WORKPLACES = {on_site: 'On-site', hybrid: 'Hybrid', remote: 'Remote'} as const;
const EVENT_KINDS: Partial<Record<JobEventOut['kind'], string>> = {applied: 'Applied', assessment: 'Assessment', interview: 'Interview', offer: 'Offer', rejection: 'Rejected'};

export interface DetailProps {
  id: number;
  // Its row in the table, so the head is right before the detail itself has loaded.
  row: ApplicationRowOut | undefined;
  accounts: Map<number, AccountOut>;
  now: number;
  timeZone: string;
  today: string;
  leaving: boolean;
  canStep: {previous: boolean; next: boolean};
  onStep: (delta: 1 | -1) => void;
  onClose: () => void;
  onOpen: (id: number) => void;
  onEmail: (messageId: number) => void;
  // The page's Esc asks the pane first: an unfolded posting folds back.
  postingRef: RefObject<FullPostingHandle | null>;
}

export function Detail({id, row, accounts, now, timeZone, today, leaving, canStep, onStep, onClose, onOpen, onEmail, postingRef}: DetailProps) {
  const width = useReadingPaneWidth();
  const load = {path: applicationPath(id), ...useResource<ApplicationOut>(applicationPath(id))};
  const detail = load.data?.id === id ? load.data : undefined;
  const failed = useLoadFailed([load]);
  const shown: ApplicationRowOut | undefined = detail ?? (row?.id === id ? row : undefined);

  const link = detail?.posting?.link ?? null;
  // With no posting link, Open email while its JD is looked up (34c), and nothing once none was found (38b).
  const firstEmail = detail?.timeline.find(event => event.message_id !== null)?.message_id ?? null;
  const style = {'--readingPane': `${width}px`} as CSSProperties;
  return (
    <section className={leaving ? 'pane jb-pane leaving' : 'pane jb-pane'} aria-label="Application" style={style}>
      <PaneEdge width={width} />
      <div className="rd-tools">
        <button className="ibtn rd-back" type="button" aria-label="Back" title="Back · Esc" onClick={onClose}><Icon name="arrow_back" /></button>
        {link ? (
          <a className="tool" href={link} target="_blank" rel="noopener noreferrer" data-hint="o"><Icon name="open_in_new" />Open posting<span className="kbd">O</span></a>
        ) : detail?.jd.state === 'looking' && firstEmail !== null && (
          <button className="tool" type="button" onClick={() => onEmail(firstEmail)}><Icon name="mail" />Open email</button>
        )}
        <span className="grow" />
        <button className="ibtn" type="button" aria-label="Previous application" disabled={!canStep.previous} onClick={() => onStep(-1)}><Icon name="keyboard_arrow_up" /></button>
        <button className="ibtn" type="button" aria-label="Next application" disabled={!canStep.next} onClick={() => onStep(1)}><Icon name="keyboard_arrow_down" /></button>
      </div>
      <div className="rd-scroll">
        {/* J / K swap what it shows at once: the pane stays, and its content is the next one's. */}
        {shown ? (
          <div key={id}>
            <Head row={shown} detail={detail} account={shown.account_id !== null ? accounts.get(shown.account_id) : undefined} now={now} timeZone={timeZone} today={today} />
            {detail ? (
              <div className="jb-body">
                <Jd detail={detail} timeZone={timeZone} today={today} posting={postingRef} />
                <Timeline events={detail.timeline} timeZone={timeZone} today={today} onEmail={onEmail} />
                {detail.applied_before.length > 0 && <Related label={`Applied before at ${detail.company}`} icon="history" links={detail.applied_before} today={today} onOpen={onOpen} />}
                {detail.also_at.length > 0 && <Related label={`Also at ${detail.company}`} icon="work" links={detail.also_at} today={today} onOpen={onOpen} />}
              </div>
            ) : <div className="jb-body">{failed ? <LoadFailed what="this application" loads={[load]} /> : <BodySkeleton />}</div>}
          </div>
        ) : <div className="jb-body">{failed ? <LoadFailed what="this application" loads={[load]} /> : <BodySkeleton />}</div>}
      </div>
    </section>
  );
}

function BodySkeleton() {
  return (
    <Sk kind="jobs-detail" className="jb-skel">
      <Bar w="92%" h={10} /><Bar w="86%" h={10} /><Bar w="54%" h={10} /><Bar w="38%" h={10} />
    </Sk>
  );
}

function Head({row, detail, account, now, timeZone, today}: {
  row: ApplicationRowOut;
  detail: ApplicationOut | undefined;
  account: AccountOut | undefined;
  now: number;
  timeZone: string;
  today: string;
}) {
  const step = detail ? latestStep(detail) : row.status === 'in_process' && row.step ? {text: row.step, at: row.step_at} : null;
  const mark = markOf(row);
  return (
    <div className="jb-head">
      <div className="jb-co">
        <span className="name">{row.company}</span>
        {row.platform && <span>· via {row.platform}</span>}
        <span className="right">
          {account && <><span className="dot sm" style={dotStyle(account.colour)} /><span className="ink2">{account.label}</span></>}
          <span>· {appliedLine(row.applied_on, today)}</span>
        </span>
      </div>
      <div className="jb-title"><h1 className={row.title.trim() ? 'rd-subj' : 'rd-subj none'}>{titleOf(row)}</h1></div>
      <div className="jb-stat">
        {/* The status as its chip; one click on it setting the status by hand is J6's (D309). */}
        <span className="jb-stchip" title={markLabel(row)}>
          <i className={`sd ${mark}`} />{STATUS_LABELS[row.status]}<Icon name="expand_more" size={16} />
        </span>
        {step && <span className={step.at ? 'step' : 'step quiet'} title={step.text}>{step.text}</span>}
        {step?.at && <span className="age" title={fullTimestamp(step.at, timeZone)}>· {age(step.at, now, timeZone)}</span>}
      </div>
      {row.first_seen_in_email && <div className="jb-first"><Icon name="info" size={16} />First seen in this email, so Applied is its date</div>}
    </div>
  );
}

/** The JD first (D307): its summary, facts, lists and the full posting; or where it stands without one. */
function Jd({detail, timeZone, today, posting}: {
  detail: ApplicationOut;
  timeZone: string;
  today: string;
  posting: RefObject<FullPostingHandle | null>;
}) {
  const [asking, setAsking] = useState(false);
  const lookItUp = () => {
    setAsking(true);
    void lookUp(detail.id).catch(toastFailure('Couldn\'t look it up')).finally(() => setAsking(false));
  };
  const saved = detail.posting;
  if (saved) {
    const place = saved.workplace ? `${WORKPLACES[saved.workplace]}${saved.workplace_detail ? `, ${saved.workplace_detail}` : ''}` : null;
    return (
      <>
        <div>
          <h2 className="jb-label">What they want</h2>
          <p className="jb-want">{saved.summary}</p>
        </div>
        <div className="jb-facts">
          {saved.location && <span><Icon name="location_on" size={16} />{saved.location}</span>}
          {place && <span><Icon name="home_work" size={16} />{place}</span>}
          <span><Icon name="payments" size={16} />{saved.salary ?? <span className="quiet">Salary not stated</span>}</span>
        </div>
        {(saved.must_haves.length > 0 || saved.nice_to_haves.length > 0) && (
          <div className="jb-lists">
            <div>
              <h2 className="jb-label">Must-haves <span className="n">{saved.must_haves.length}</span></h2>
              <ul>{saved.must_haves.map(item => <li key={item}>{item}</li>)}</ul>
            </div>
            <div className="nice">
              <h2 className="jb-label">Nice-to-haves <span className="n">{saved.nice_to_haves.length}</span></h2>
              <ul>{saved.nice_to_haves.map(item => <li key={item}>{item}</li>)}</ul>
            </div>
          </div>
        )}
        <FullPosting ref={posting} posting={saved} title={titleOf(detail)} company={detail.company} timeZone={timeZone} today={today} />
      </>
    );
  }
  if (detail.jd.state === 'looking') {
    return (
      <>
        <div className="jb-src looking" role="status">
          <span className="spin"><Icon name="progress_activity" size={16} /></span>
          <span className="t">Looking for the posting…</span>
          <span className="how">· {lookingWhere(detail.platform)}</span>
        </div>
        <Sk kind="jobs-jd" className="jb-skel" immediate><Bar w="92%" h={10} /><Bar w="86%" h={10} /><Bar w="54%" h={10} /><Bar w="38%" h={10} /></Sk>
      </>
    );
  }
  // No JD found (D320), candidates waiting in Needs you, or never looked up (a closed application from
  // history, D311): each says so under the section's label, with Look it up where it can run.
  const line = detail.jd.state === 'not_found'
    ? {icon: 'search_off' as const, lead: 'No JD found', rest: notFoundLine(detail.platform, detail.jd.looked_at, timeZone, today)}
    : detail.jd.state === 'candidates'
      ? {icon: 'pending' as const, lead: 'Is this the posting?', rest: `${detail.jd.candidates} ${detail.jd.candidates === 1 ? 'candidate' : 'candidates'} in Needs you`}
      : {icon: 'remove' as const, lead: 'Not looked up', rest: detail.status === 'rejected' || detail.status === 'withdrawn' ? 'it was closed before Jobs read it' : 'Jobs hasn\'t looked for it yet'};
  return (
    <div>
      <h2 className="jb-label">Job description</h2>
      <div className="jb-nojd">
        <Icon name={line.icon} size={16} />
        <span className="grow"><span className="ink2">{line.lead}</span><span className="num"> · {line.rest}</span></span>
        {detail.jd.state !== 'candidates' && (
          <button className="btn quiet sm" type="button" disabled={asking} onClick={lookItUp}><Icon name="search" size={16} />Look it up</button>
        )}
      </div>
    </div>
  );
}

/** The timeline (D317), oldest first: each event opens its email, and one whose email is gone keeps its line and opens nothing. */
function Timeline({events, timeZone, today, onEmail}: {events: JobEventOut[]; timeZone: string; today: string; onEmail: (messageId: number) => void}) {
  return (
    <div>
      <h2 className="jb-label">Timeline <span className="n">{events.length}</span></h2>
      <div className="jb-tl">
        {events.map((event, index) => {
          const day = localDate(event.at, timeZone);
          const classes = ['jb-ev', index === 0 && 'first', index === events.length - 1 && 'last', event.quiet && 'quiet', !event.quiet && (event.kind === 'interview' || event.kind === 'assessment') && 'proc']
            .filter(Boolean).join(' ');
          const content = (
            <>
              <span className={day === today ? 'd now' : 'd'} title={fullTimestamp(event.at, timeZone)}>{day === today ? 'Today' : dayWord(day, today)}</span>
              <span className="node"><i /></span>
              <span className="t">
                {!event.quiet && EVENT_KINDS[event.kind] && <span className="k">{EVENT_KINDS[event.kind]}</span>}
                <span className="s">{event.subject}</span>
                {event.first_seen && <span className="tag">First seen</span>}
              </span>
            </>
          );
          const messageId = event.message_id;
          return messageId !== null
            ? <button key={event.id} className={classes} type="button" data-event={event.id} onClick={() => onEmail(messageId)}>{content}</button>
            : <div key={event.id} className={classes} data-event={event.id} title="Its email is gone; the event keeps its line">{content}</div>;
        })}
      </div>
    </div>
  );
}

/** Applied before at the company (D306), or its other applications: one card each, opening it. */
function Related({label, icon, links, today, onOpen}: {label: string; icon: 'history' | 'work'; links: ApplicationLinkOut[]; today: string; onOpen: (id: number) => void}) {
  return (
    <div>
      <h2 className="jb-label">{label}</h2>
      {links.map(link => {
        const mark = markOf({status: link.status, ghosted: false});
        return (
          <button key={link.id} className="jb-before" type="button" data-application={link.id} onClick={() => onOpen(link.id)}>
            <Icon name={icon} size={17} />
            <span className="t">{titleOf(link)}</span>
            <span className="ink3 num">· Applied {dayWord(link.applied_on, today)}</span>
            <span className="st"><i className={`sd ${mark}`} /><span className={`sl ${mark} num`}>{STATUS_LABELS[link.status]}{link.status === 'applied' ? '' : ` ${dayWord(link.status_on, today)}`}</span></span>
            <Icon name="chevron_right" className="chev" />
          </button>
        );
      })}
    </div>
  );
}
