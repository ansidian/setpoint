// An application's detail (DESIGN.md › The application's detail; boards 32, 32b, 33, 34c, 38b): where
// the reading pane sits, and as wide. Its tools (Back in a narrow window, Open posting `O`, or Open
// email while a JD with no link is looked up; previous and next); its head (the company, "via" its
// platform, the account and Applied; the title; the status and its latest step; "First seen in this
// email"); then the JD first (D307): what they want, the facts, both lists and the full posting one
// step away, or where the JD stands (looking, No JD found with Look it up, candidates in Needs you);
// the timeline, each event opening its email; Applied before at the company, and its other
// applications. At not_found, Paste the posting (SV-140): the main action after a pick Jobs couldn't
// read, beside Look it up otherwise; a JD pasted shows what Haiku has read of it so far. J6's corrections (35a, 35b, #267–#269): More after the tools, the title edited in
// place (and the company, from More), the status chip's Set status, Not this posting's candidates
// offered where the JD was, and each event's ··· (Open email, Move to…, Not about this), also on a
// right-click. An event whose email Gmail no longer has keeps its line and opens nothing.
import type {AccountOut, ApplicationLinkOut, ApplicationOut, ApplicationRowOut, JdCandidateOut, JobEventOut, PostingOut} from '@setpoint/shared';
import {useEffect, useMemo, useRef, useState} from 'react';
import type {CSSProperties, MouseEvent as ReactMouseEvent, RefObject} from 'react';
import type {Entry, FoldRules} from '../../logic/fold.ts';
import {news as arrivals} from '../../tokens.ts';
import {takesContextMenu} from '../ContextMenu.tsx';
import {foldIn, foldOut, useFold} from '../fold.ts';
import {useResource} from '../../api/client.ts';
import {age, fullTimestamp, localDate} from '../../logic/format.ts';
import {Icon} from '../../ui/Icon.tsx';
import {dotStyle} from '../accounts.ts';
import {useReadingPaneWidth} from '../readingPane.ts';
import {PaneEdge} from '../Reader.tsx';
import {LoadFailed, useLoadFailed} from '../states/Loading.tsx';
import {Bar, Sk} from '../states/Loading.tsx';
import {toastFailure} from '../toast.ts';
import {actInPlace} from './act.ts';
import {applicationPath, lookUp, pastePosting} from './api.ts';
import {FullPosting} from './FullPosting.tsx';
import type {FullPostingHandle} from './FullPosting.tsx';
import {JobsMenu} from './Menu.tsx';
import type {MenuAnchor, MenuSpec} from './Menu.tsx';
import {eventMenu, moreMenu, statusMenu} from './menus.ts';
import type {CorrectionActions} from './menus.ts';
import {CandidatePicker} from './CandidatePicker.tsx';
import {EditField} from './EditField.tsx';
import {PastePosting} from './PastePosting.tsx';
import {appliedLine, dayWord, hasReading, latestStep, lookingWhere, markLabel, markOf, notFoundWords, STATUS_LABELS, titleOf} from './words.ts';

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
  // Arrived from mail (Open in Jobs, Full posting), or open as the page mounted: no slide (37b).
  arrived?: boolean;
  // Arrived from the JD popover's Full posting: the posting unfolded, scrolled to (#271).
  unfolded?: boolean;
  canStep: {previous: boolean; next: boolean};
  onStep: (delta: 1 | -1) => void;
  onClose: () => void;
  onOpen: (id: number) => void;
  onEmail: (messageId: number) => void;
  // The page's Esc asks the pane first: an unfolded posting folds back.
  postingRef: RefObject<FullPostingHandle | null>;
  // J6: every application, for the menus; the corrections; the field being edited, from More or a
  // row's right-click; and an event's Move to… and Not about this, and a candidate picked.
  rows: ApplicationRowOut[];
  corrections: (row: ApplicationRowOut) => CorrectionActions;
  editing: 'company' | 'title' | null;
  onEdit: (field: 'company' | 'title' | null) => void;
  onSave: (field: 'company' | 'title', value: string) => void;
  onMove: (event: JobEventOut, to: ApplicationRowOut) => void;
  onNotAboutThis: (event: JobEventOut) => void;
  onPick: (candidate: JdCandidateOut | null) => void;
}

/** One of the pane's menus, open: More, the status chip's, or an event's ···. */
interface OpenMenu {
  owner: string;
  spec: MenuSpec;
  anchor: MenuAnchor;
}

export function Detail({id, row, accounts, now, timeZone, today, leaving, arrived = false, unfolded = false, canStep, onStep, onClose, onOpen, onEmail, postingRef, rows, corrections, editing, onEdit, onSave, onMove, onNotAboutThis, onPick}: DetailProps) {
  const width = useReadingPaneWidth();
  const load = {path: applicationPath(id), ...useResource<ApplicationOut>(applicationPath(id))};
  const detail = load.data?.id === id ? load.data : undefined;
  const failed = useLoadFailed([load]);
  const shown: ApplicationRowOut | undefined = detail ?? (row?.id === id ? row : undefined);

  const link = detail?.jd.link ?? null;
  // With no posting link, Open email while its JD is looked up (34c), and nothing once none was found (38b).
  const firstEmail = detail?.timeline.find(event => event.message_id !== null)?.message_id ?? null;
  const style = {'--readingPane': `${width}px`} as CSSProperties;
  // A menu belongs to the application it opened on: J / K to another closes it.
  const [opened, setMenu] = useState<(OpenMenu & {id: number}) | null>(null);
  const menu = opened?.id === id ? opened : null;
  const toggle = (owner: string, spec: () => MenuSpec, anchor: MenuAnchor) => setMenu(current => (current?.owner === owner && current.id === id ? null : {owner, spec: spec(), anchor, id}));
  const actions = shown ? corrections(shown) : null;
  const more = (element: HTMLElement) => shown && actions && toggle('more', () => moreMenu(shown, rows, today, actions), {element, corner: 'right'});
  const chip = (element: HTMLElement) => shown && actions && toggle('status', () => statusMenu(shown, {set: actions.setStatus}), {element, corner: 'left'});
  const eventActions = (event: JobEventOut, element: HTMLElement) => shown && toggle(`event:${event.id}`, () => eventMenu(event, shown, rows, today, {
    openEmail: onEmail, move: to => onMove(event, to), notAboutThis: () => onNotAboutThis(event),
  }), {element, corner: 'right'});
  return (
    <section className={['pane', 'jb-pane', leaving && 'leaving', arrived && 'arrived'].filter(Boolean).join(' ')} aria-label="Application" style={style}>
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
        <button className="ibtn" type="button" aria-label="More" title="More" aria-haspopup="menu" aria-expanded={menu?.owner === 'more'} disabled={!shown}
          onClick={event => more(event.currentTarget)}><Icon name="more_horiz" /></button>
      </div>
      <div className="rd-scroll">
        {/* J / K swap what it shows at once: the pane stays, and its content is the next one's. */}
        {shown ? (
          <div key={id}>
            <Head row={shown} detail={detail} account={shown.account_id !== null ? accounts.get(shown.account_id) : undefined} now={now} timeZone={timeZone} today={today}
              editing={editing} onEdit={onEdit} onSave={onSave} chipOpen={menu?.owner === 'status'} onChip={chip} />
            {detail ? (
              <div className="jb-body">
                <Jd detail={detail} timeZone={timeZone} today={today} posting={postingRef} unfolded={unfolded} onPick={onPick} />
                <Timeline events={detail.timeline} timeZone={timeZone} today={today} onEmail={onEmail} menuOpen={menu?.owner ?? null} onMenu={eventActions} />
                {detail.applied_before.length > 0 && <Related label={`Applied before at ${detail.company}`} icon="history" links={detail.applied_before} today={today} onOpen={onOpen} />}
                {detail.also_at.length > 0 && <Related label={`Also at ${detail.company}`} icon="work" links={detail.also_at} today={today} onOpen={onOpen} />}
              </div>
            ) : <div className="jb-body">{failed ? <LoadFailed what="this application" loads={[load]} /> : <BodySkeleton />}</div>}
          </div>
        ) : <div className="jb-body">{failed ? <LoadFailed what="this application" loads={[load]} /> : <BodySkeleton />}</div>}
      </div>
      {menu && <JobsMenu spec={menu.spec} anchor={menu.anchor} onClose={() => setMenu(null)} />}
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

function Head({row, detail, account, now, timeZone, today, editing, onEdit, onSave, chipOpen, onChip}: {
  row: ApplicationRowOut;
  detail: ApplicationOut | undefined;
  account: AccountOut | undefined;
  now: number;
  timeZone: string;
  today: string;
  editing: 'company' | 'title' | null;
  onEdit: (field: 'company' | 'title' | null) => void;
  onSave: (field: 'company' | 'title', value: string) => void;
  chipOpen: boolean;
  onChip: (element: HTMLElement) => void;
}) {
  const step = detail ? latestStep(detail) : row.status === 'in_process' && row.step ? {text: row.step, at: row.step_at} : null;
  const mark = markOf(row);
  // The chip crossfades when the status changes while it's shown, never as it's first drawn.
  const [chip, setChip] = useState({mark, changed: false});
  if (chip.mark !== mark) setChip({mark, changed: true});
  const field = (which: 'company' | 'title', value: string) => (
    <EditField key={which} label={which === 'company' ? 'Company' : 'Title'} value={value} small={which === 'company'}
      onSave={next => onSave(which, next)} onCancel={() => onEdit(null)} />
  );
  return (
    <div className="jb-head">
      <div className="jb-co">
        {editing === 'company' ? field('company', row.company) : <span className="name">{row.company}</span>}
        {row.platform && <span>· via {row.platform}</span>}
        <span className="right">
          {account && <><span className="dot sm" style={dotStyle(account.colour)} /><span className="ink2">{account.label}</span></>}
          <span>· {appliedLine(row.applied_on, today)}</span>
        </span>
      </div>
      {editing === 'title' ? field('title', row.title) : (
        <div className="jb-title">
          <h1 className={row.title.trim() ? 'rd-subj' : 'rd-subj none'}>
            {/* A click puts the title in a field on the same baseline (35a). */}
            <button type="button" className="jb-tbtn" title="Edit title" onClick={() => onEdit('title')}>
              <span>{titleOf(row)}</span><Icon name="edit" size={16} className="pen" />
            </button>
          </h1>
        </div>
      )}
      {editing && <div className="jb-hint">Enter to save · Esc</div>}
      <div className="jb-stat">
        {/* One click on the chip sets the status by hand (D309, #267). */}
        <button type="button" className="jb-stchip" title={markLabel(row)} aria-haspopup="menu" aria-expanded={chipOpen} onClick={event => onChip(event.currentTarget)}>
          <span key={mark} className={chip.changed ? 'swap changed' : 'swap'}><i className={`sd ${mark}`} />{STATUS_LABELS[row.status]}</span>
          <Icon name={chipOpen ? 'expand_less' : 'expand_more'} size={16} />
        </button>
        {step && <span className={step.at ? 'step' : 'step quiet'} title={step.text}>{step.text}</span>}
        {step?.at && <span className="age" title={fullTimestamp(step.at, timeZone)}>· {age(step.at, now, timeZone)}</span>}
      </div>
      {row.first_seen_in_email && <div className="jb-first"><Icon name="info" size={16} />First seen in this email, so Applied is its date</div>}
    </div>
  );
}

/** The JD first (D307): its summary, facts, lists and the full posting; or where it stands without one. */
function Jd({detail, timeZone, today, posting, unfolded, onPick}: {
  detail: ApplicationOut;
  timeZone: string;
  today: string;
  posting: RefObject<FullPostingHandle | null>;
  unfolded: boolean;
  onPick: (candidate: JdCandidateOut | null) => void;
}) {
  const [asking, setAsking] = useState(false);
  const [pasting, setPasting] = useState(false);
  const paste = (text: string) => actInPlace(() => pastePosting(detail.id, text), {done: `JD saved for ${detail.company}`});
  const lookItUp = () => {
    setAsking(true);
    void lookUp(detail.id).catch(toastFailure('Couldn\'t look it up')).finally(() => setAsking(false));
  };
  const saved = detail.posting;
  // The area stays until the JD has come, and doesn't come back with Undo.
  if (saved && pasting) setPasting(false);
  if (saved) {
    return (
      <>
        {saved.summary && (
          <div className="jb-arrive">
            <h2 className="jb-label">What they want</h2>
            <p className="jb-want">{saved.summary}</p>
          </div>
        )}
        {hasReading(saved) && <JdFacts posting={saved} />}
        <JdLists posting={saved} />
        <FullPosting ref={posting} posting={saved} title={titleOf(detail)} company={detail.company} timeZone={timeZone} today={today} arrived={unfolded} />
      </>
    );
  }
  if (detail.jd.state === 'looking') {
    return (
      <>
        <div className="jb-src looking" role="status">
          <span className="spin"><Icon name="progress_activity" size={16} /></span>
          <span className="t">Looking for the posting…</span>
          <span className="how">{lookingWhere(detail.platform)}</span>
        </div>
        <Sk kind="jobs-jd" className="jb-skel" immediate><Bar w="92%" h={10} /><Bar w="86%" h={10} /><Bar w="54%" h={10} /><Bar w="38%" h={10} /></Sk>
      </>
    );
  }
  // Not this posting's other candidates (35b), as Needs you shows them: Is this the posting?
  if (detail.jd.state === 'candidates' && detail.candidates.length) {
    return (
      <div className="jb-arrive" key="candidates">
        <h2 className="jb-label">Is this the posting?</h2>
        <div className="jb-jdcands">
          <CandidatePicker candidates={detail.candidates} active={false} picked={null} onPick={onPick} onNone={() => onPick(null)} />
        </div>
      </div>
    );
  }
  // No JD found (D320), or never looked up (a closed application from history, D311): each says so
  // under the section's label, with Look it up where it can run.
  const line = detail.jd.state === 'not_found'
    ? {icon: 'search_off' as const, ...notFoundWords(detail.jd, detail.platform, timeZone, today)}
    : detail.jd.state === 'candidates'
      ? {icon: 'pending' as const, lead: 'Is this the posting?', rest: `${detail.jd.candidates} ${detail.jd.candidates === 1 ? 'candidate' : 'candidates'} in Needs you`}
      : {icon: 'remove' as const, lead: 'Not looked up', rest: detail.status === 'rejected' || detail.status === 'withdrawn' ? 'it was closed before Jobs read it' : 'Jobs hasn\'t looked for it yet'};
  const notFound = detail.jd.state === 'not_found';
  // After a pick Jobs couldn't read, the text is what's left, so Paste leads and Look it up steps back;
  // with nothing found, another look still costs the user less (SV-140).
  const pasteFirst = notFound && detail.jd.link !== null;
  const lookUpButton = (
    <button className={`btn ${notFound && !pasteFirst ? 'out' : 'quiet'} sm`} type="button" disabled={asking} onClick={lookItUp}><Icon name="search" size={16} />Look it up</button>
  );
  const pasteButton = (
    <button className={`btn ${pasteFirst ? '' : 'quiet '}sm`} type="button" onClick={() => setPasting(true)}><Icon name="edit_note" size={16} />Paste the posting</button>
  );
  return (
    <div className="jb-arrive" key={detail.jd.state}>
      <h2 className="jb-label">Job description</h2>
      <div className={notFound ? 'jb-nojd stacked' : 'jb-nojd'}>
        <span className="grow line">
          <Icon name={line.icon} size={16} />
          <span className="words"><span className="ink2">{line.lead}</span><span className="num"><span className="sep"> · </span>{line.rest}</span></span>
        </span>
        {!(notFound && pasting) && detail.jd.state !== 'candidates' && (
          <span className="acts">
            {pasteFirst && pasteButton}
            {lookUpButton}
            {notFound && !pasteFirst && pasteButton}
          </span>
        )}
      </div>
      {notFound && pasting && <PastePosting onSave={paste} onCancel={() => setPasting(false)} />}
    </div>
  );
}

const WORKPLACES = {on_site: 'On-site', hybrid: 'Hybrid', remote: 'Remote'} as const;

/** The JD's facts (D307): where, the setting, the salary or "Salary not stated". Mail's popover shows them too. */
export function JdFacts({posting}: {posting: PostingOut}) {
  const place = posting.workplace ? `${WORKPLACES[posting.workplace]}${posting.workplace_detail ? `, ${posting.workplace_detail}` : ''}` : null;
  return (
    <div className="jb-facts">
      {posting.location && <span><Icon name="location_on" size={16} />{posting.location}</span>}
      {place && <span><Icon name="home_work" size={16} />{place}</span>}
      <span><Icon name="payments" size={16} />{posting.salary ?? <span className="quiet">Salary not stated</span>}</span>
    </div>
  );
}

/** Must-haves and nice-to-haves in two columns, each with its count; none when both are empty. */
export function JdLists({posting}: {posting: PostingOut}) {
  if (!posting.must_haves.length && !posting.nice_to_haves.length) return null;
  return (
    <div className="jb-lists">
      <div>
        <h2 className="jb-label">Must-haves <span className="n">{posting.must_haves.length}</span></h2>
        <ul>{posting.must_haves.map(item => <li key={item}>{item}</li>)}</ul>
      </div>
      <div className="nice">
        <h2 className="jb-label">Nice-to-haves <span className="n">{posting.nice_to_haves.length}</span></h2>
        <ul>{posting.nice_to_haves.map(item => <li key={item}>{item}</li>)}</ul>
      </div>
    </div>
  );
}

const EVENT_FOLDS: FoldRules<JobEventOut> = {folds: () => true, arrives: () => true};

/** Whose email Gmail no longer has (D317, #269): its line stays, and it opens nothing. */
const GONE_TIP = 'Gmail no longer has this email, so Jobs keeps only its line';

/**
 * The timeline (D317), oldest first: each event opens its email, and one whose email is gone keeps
 * its line and says so (#269). Its ··· (on hover, or a right-click) holds Open email, Move to… and Not
 * about this; one moved or taken off folds out (180 ms), one a merge brings settles from sub2 (900 ms).
 */
function Timeline({events, timeZone, today, onEmail, menuOpen, onMenu}: {
  events: JobEventOut[];
  timeZone: string;
  today: string;
  onEmail: (messageId: number) => void;
  menuOpen: string | null;
  onMenu: (event: JobEventOut, element: HTMLElement) => void;
}) {
  const entries = useMemo(() => events.map((event): Entry<JobEventOut> => ({key: `e:${event.id}`, id: event.id, item: event})), [events]);
  const shown = useFold(entries, EVENT_FOLDS);
  // Those a merge or Undo brought since it was drawn settle in.
  const seen = useRef<Set<number> | null>(null);
  const [landed, setLanded] = useState<ReadonlySet<number>>(new Set());
  useEffect(() => {
    if (seen.current === null) {
      seen.current = new Set(events.map(event => event.id));
      return;
    }
    const fresh = events.filter(event => !seen.current!.has(event.id)).map(event => event.id);
    fresh.forEach(id => seen.current!.add(id));
    if (!fresh.length) return;
    setLanded(new Set(fresh));
    const timer = window.setTimeout(() => setLanded(new Set()), arrivals.landedMs);
    return () => window.clearTimeout(timer);
  }, [events]);
  const live = shown.filter(entry => entry.fold !== 'out');
  const rightClick = (event: JobEventOut) => (mouse: ReactMouseEvent<HTMLElement>) => {
    if (!takesContextMenu(mouse, mouse.currentTarget)) return;
    mouse.preventDefault();
    const button = mouse.currentTarget.querySelector<HTMLElement>('.go .ibtn');
    if (button && menuOpen !== `event:${event.id}`) onMenu(event, button);
  };
  return (
    <div>
      <h2 className="jb-label">Timeline <span className="n">{live.length}</span></h2>
      <div className="jb-tl">
        {shown.map(({key, item: event, fold}) => {
          const day = localDate(event.at, timeZone);
          const leaving = fold === 'out';
          const index = live.findIndex(entry => entry.item.id === event.id);
          const messageId = event.message_id;
          const open = menuOpen === `event:${event.id}`;
          const classes = [
            'jb-ev', index === 0 && 'first', index === live.length - 1 && 'last', event.quiet && 'quiet',
            !event.quiet && (event.kind === 'interview' || event.kind === 'assessment') && 'proc', messageId === null && 'gone', open && 'menu',
            landed.has(event.id) && 'landed',
          ].filter(Boolean).join(' ');
          return (
            <div key={key} ref={leaving ? foldOut : fold === 'in' ? foldIn : undefined} className={classes} data-event={event.id} aria-hidden={leaving || undefined}
              title={messageId === null ? GONE_TIP : undefined} onContextMenu={leaving ? undefined : rightClick(event)}>
              <span className={day === today ? 'd now' : 'd'} title={fullTimestamp(event.at, timeZone)}>{day === today ? 'Today' : dayWord(day, today)}</span>
              <span className="node"><i /></span>
              <span className="t">
                {!event.quiet && EVENT_KINDS[event.kind] && <span className="k">{EVENT_KINDS[event.kind]}</span>}
                {messageId !== null ? (
                  // The whole line opens its email; the ··· sits above it.
                  <button type="button" className="s open" onClick={() => onEmail(messageId)}>{event.subject}</button>
                ) : <span className="s">{event.subject}</span>}
                {event.first_seen && <span className="tag">First seen</span>}
                {messageId === null && <span className="gonetxt">· No longer in Gmail</span>}
              </span>
              <span className="go">
                <button type="button" className="ibtn sm" aria-label="Event actions" title="More" aria-haspopup="menu" aria-expanded={open}
                  onClick={click => onMenu(event, click.currentTarget)}><Icon name="more_horiz" size={16} /></button>
              </span>
            </div>
          );
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
