// Each page's skeleton (DESIGN.md › Decided while building #170): the rows it will show, in their
// real geometry (loading.css mirrors each row's own rule, its class named beside it), so what loads
// replaces them where they stand. Their own classes, never the rows': nothing that looks for a row
// finds a skeleton. Widths follow a fixed rhythm, so a skeleton looks the same every time.
import {Bar, Dot, Sk} from './Loading.tsx';

// A sender's width, and a subject's share of its column, row after row.
const FROM = [118, 96, 132, 104, 88, 124, 110, 92, 128];
const SUBJECT = [0.46, 0.33, 0.58, 0.41, 0.29, 0.52, 0.37, 0.49, 0.31];
const LABEL = [72, 64, 80, 68, 76];
const at = <T,>(list: readonly T[], index: number) => list[index % list.length]!;
const share = (value: number) => `${Math.round(value * 100)}%`;
/** Each group's rows numbered on from the last group's, so the rhythm runs through the list: [[1, 2], [3, 4, 5]]. */
const numbered = (counts: number[]) => counts.map((count, group) => {
  const from = counts.slice(0, group).reduce((sum, one) => sum + one, 0);
  return Array.from({length: count}, (_, index) => from + index + 1);
});

/** A group header (.gh), its label a bar. */
function Header({index, first, w}: {index: number; first: boolean; w?: number}) {
  return <div className={first ? 'sk-gh first' : 'sk-gh'}><Bar w={w ?? at(LABEL, index)} h={8} /></div>;
}

/** A mail row (.row): the sender, the subject, the account and the age; All's with its kind's column. */
function Row({index, all = false}: {index: number; all?: boolean}) {
  return (
    <div className="sk-row">
      {all && <span className="kd"><Bar w={at([54, 40, 62], index)} h={8} /></span>}
      <span className="ud" />
      <span className="from"><Bar w={at(FROM, index)} /></span>
      <span className="subj"><Bar w={share(at(SUBJECT, index))} /></span>
      <span className="ac"><Dot size={7} /><Bar w={46} /></span>
      <span className="age"><Bar w={all ? 44 : 24} /></span>
    </div>
  );
}

/** Attention's three-line row (.arow). */
function AttentionRow({index}: {index: number}) {
  return (
    <div className="sk-arow">
      <span className="ud" />
      <div className="l1"><Bar w={at(FROM, index + 2)} /></div>
      <div className="r1"><Dot size={7} /><Bar w={44} /><Bar w={22} /></div>
      <div className="l2"><Bar w={index % 2 ? '44%' : '38%'} /></div>
      <div className="l3"><Bar w={index % 2 ? '58%' : '50%'} /></div>
    </div>
  );
}

// Unread's groups: Attention's two rows, then FYI groups, enough to fill the list.
const UNREAD_GROUPS = [{attention: true, rows: 2}, {rows: 3}, {rows: 4}, {rows: 6}, {rows: 6}];

/** Unread's list loading (states-03, inbox-13). */
export function InboxSkeleton() {
  const rows = numbered(UNREAD_GROUPS.map(group => group.rows));
  return (
    <Sk kind="inbox" className="sk-list">
      {UNREAD_GROUPS.map((group, index) => (
        <div className="sk-group" key={index}>
          <Header index={index} first={index === 0} />
          {rows[index]!.map(row => (group.attention ? <AttentionRow key={row} index={row} /> : <Row key={row} index={row} />))}
        </div>
      ))}
    </Sk>
  );
}

/** All's list loading: a day under its heading, its lanes' labels and rows; `more` is the next page's. */
export function AllSkeleton({more = false, first = !more}: {more?: boolean; first?: boolean}) {
  const days = more ? [[3]] : [[2, 5], [6]];
  const rows = numbered(days.flat());
  const laneAt = (day: number, lane: number) => days.slice(0, day).flat().length + lane;
  return (
    <Sk kind={more ? 'all-more' : 'all'} className={more ? 'sk-more' : 'sk-list'}>
      {days.map((counts, day) => (
        <div className="sk-group" key={day}>
          <Header index={day} first={first && day === 0} w={day ? 88 : 104} />
          {counts.map((_, lane) => {
            const numbers = rows[laneAt(day, lane)]!;
            return (
              <div key={lane}>
                <div className="sk-lh"><Bar w={lane ? 30 : 64} h={8} /></div>
                {numbers.map(row => <Row key={row} index={row} all />)}
              </div>
            );
          })}
        </div>
      ))}
    </Sk>
  );
}

// The sidebar's rows on a first visit: account labels, and Today's lines (shell-10).
const ACCOUNT_LABELS = [58, 62, 40, 36, 44];

/** The accounts under Inbox (.acct) before they're known: `count` rows, a dot, a label and a count. */
export function AccountsSkeleton({count}: {count: number}) {
  return (
    <Sk kind="accounts" className="sk-accounts">
      {Array.from({length: count}, (_, index) => (
        <div className="sk-acct" key={index}><Dot size={7} /><Bar w={at(ACCOUNT_LABELS, index)} h={8} /><Bar w={10} h={8} style={{marginLeft: 'auto'}} /></div>
      ))}
    </Sk>
  );
}

/** Today's lines (.today-row): the next event's time and title, then tasks behind their rings. */
export function TodaySkeleton({lines}: {lines: number}) {
  return (
    <Sk kind="today" className="sk-today">
      {Array.from({length: lines}, (_, index) => (
        <div className="sk-line" key={index}>
          {index === 0 ? <><Bar w={44} h={8} /><Bar w={62} h={8} style={{marginLeft: 14}} /></> : <><span className="sk-ring" /><Bar w={at([96, 70, 84], index)} h={8} /></>}
        </div>
      ))}
    </Sk>
  );
}

/** An email's head (.rd-head) when no row stands for it (a link to it): the subject and its sender's line. */
export function HeadSkeleton() {
  return (
    <Sk kind="head" className="sk-head">
      <span className="subj"><Bar w="56%" h={12} /></span>
      <span className="meta"><span className="sk-dot sk-avatar" /><Bar w={140} /><Bar w={64} style={{marginLeft: 'auto'}} /></span>
    </Sk>
  );
}

/** An attachment's preview (.preview-body) while its file loads: a page's shape. */
export const PreviewSkeleton = () => <Sk kind="preview" className="sk-preview"><span className="sk-img" /></Sk>;

/**
 * An email's body (.rd-body) while it loads, the head already drawn from its row: lines at the
 * body's rhythm, a paragraph's break, and an attachment's card when it has one.
 */
export function BodySkeleton({attachment = false}: {attachment?: boolean}) {
  return (
    <Sk kind="body" className="sk-body">
      {['100%', '97%', '90%', '94%', '60%'].map(width => <Bar key={width} w={width} h={10} />)}
      <span className="sk-break" />
      {['92%', '86%', '40%'].map(width => <Bar key={width} w={width} h={10} />)}
      {attachment && <span className="sk-attach" />}
    </Sk>
  );
}

const AGENDA_TITLES = ['48%', '40%', '60%'];
const AGENDA_LINES = ['36%', '28%', '44%'];

/** The right pane's day while its items load (calpanes-03): three agenda rows (.ag-item). */
export function AgendaSkeleton() {
  return (
    <Sk kind="agenda" className="sk-agenda">
      {AGENDA_TITLES.map((title, index) => (
        <div className="sk-ag" key={title}>
          <span className="when"><Bar w={52} /></span>
          <span className="rail" />
          <span className="lines"><span className="t"><Bar w={title} h={10} /></span><span className="s"><Bar w={at(AGENDA_LINES, index)} h={8} /></span></span>
        </div>
      ))}
    </Sk>
  );
}

/** The day's line under its date (.rp-sub) while it loads. */
export const DayLineSkeleton = () => <Sk kind="day-line" className="sk-rp-sub"><Bar w={110} /></Sk>;

/** Calendar's sidebar list (.calrow) before the calendars are known. */
export function CalendarsSkeleton() {
  return (
    <Sk kind="calendars" className="sk-calendars">
      {[56, 64, 40, 52].map(width => <div className="sk-calrow" key={width}><span className="sk-box" /><Bar w={width} h={8} /></div>)}
    </Sk>
  );
}

/** A lead story (.nw-lead): its image, headline, summary and meta at the foot. */
function Lead({index}: {index: number}) {
  return (
    <div className="sk-nw-lead">
      <span />
      <span className="sk-img" />
      <div className="txt">
        <Bar w={index ? '56%' : '62%'} h={12} />
        <Bar w={index ? '38%' : '44%'} h={12} />
        <Bar w={index ? '48%' : '52%'} />
        <span className="foot"><Bar w={90} /></span>
      </div>
    </div>
  );
}

const STORY_TITLES = [0.58, 0.46, 0.64, 0.4, 0.52, 0.44];

/** A story's row (.nw-row): headline over summary, the outlet and age, and its thumbnail. */
function StoryRow({index}: {index: number}) {
  const title = at(STORY_TITLES, index);
  return (
    <div className="sk-nw-row">
      <span />
      <div className="txt"><Bar w={share(title)} h={10} /><Bar w={share(title - 0.14)} h={8} /></div>
      <div className="side"><Bar w={56} h={8} /><Bar w={28} h={8} /></div>
      <span className="sk-thumb" />
    </div>
  );
}

/** News's list on its first answer (news-03): All's blocks under their headers, or a section's list. */
export function NewsSkeleton({blocks}: {blocks: boolean}) {
  const shelves = blocks ? [3, 3] : [6];
  const rows = numbered(shelves);
  return (
    <Sk kind="news" className="sk-list">
      {shelves.map((_, index) => (
        <div className="sk-group" key={index}>
          {blocks && <div className={index === 0 ? 'sk-nw-sec first' : 'sk-nw-sec'}><Bar w={46} h={8} /></div>}
          <Lead index={index} />
          {rows[index]!.map(row => <StoryRow key={row} index={row} />)}
        </div>
      ))}
    </Sk>
  );
}

/** The story pane's summary and sources while the story loads (news-05), its head drawn from its row. */
export function StoryBodySkeleton() {
  return (
    <Sk kind="story" className="sk-story">
      <div className="sk-sum">{['100%', '96%', '98%', '60%'].map(width => <Bar key={width} w={width} h={11} />)}</div>
      <div className="st-label">Sources</div>
      <div className="sk-srcs">
        {[0, 1, 2].map(index => (
          <div className="sk-src" key={index}><span className="sk-fav" /><span className="lines"><Bar w={90} /><Bar w={at(['70%', '62%', '74%'], index)} /></span></div>
        ))}
      </div>
    </Sk>
  );
}

/** Search's results before the first answer (search-03): rows shaped as results (.arow). */
export function SearchSkeleton() {
  return (
    <Sk kind="search" className="sk-list sk-results">
      {Array.from({length: 6}, (_, index) => (
        <div className="sk-result" key={index}>
          <span />
          <div className="l1"><Bar w={at([150, 120, 170, 136, 158, 124], index)} /></div>
          <div className="r1"><Bar w={70} /></div>
          <div className="l2"><Bar w={at(['46%', '40%', '52%', '43%', '49%', '38%'], index)} /></div>
          <div className="l3"><Bar w={at(['64%', '70%', '58%', '66%', '61%', '68%'], index)} style={{opacity: 0.6}} /></div>
        </div>
      ))}
    </Sk>
  );
}

/** The phone's agenda (.pday, .pitem) while it loads. */
export function PhoneAgendaSkeleton() {
  return (
    <Sk kind="agenda" className="sk-list">
      {[3, 2].map((count, day) => (
        <div className="sk-group" key={day}>
          <div className={day ? 'sk-pday' : 'sk-pday first'}><Bar w={day ? 84 : 112} h={8} /></div>
          {Array.from({length: count}, (_, index) => (
            <div className="sk-pitem" key={index}><span className="when"><Bar w={at([64, 56, 70], index)} /></span><span className="rail" /><Bar w={at(['52%', '40%', '46%'], index + day)} /></div>
          ))}
        </div>
      ))}
    </Sk>
  );
}
