// Jobs's states (J8; DESIGN.md › Jobs › States; boards 38a–38c):
// - The AI down (38b, #218): "5 emails not read yet, Anthropic unreachable since 8:52 AM, retrying" in
//   `caution`, led by `warning`, at the top of the column. It folds in as it comes and, once the AI is
//   back, shows a `good` check for 1.2 s and folds out, as mail's health lines do (states-13).
// - The history pass (38a, D311, D326): the shared spinner and "Reading history · 140 of 330 emails ·
//   showing what’s read so far", muted, its progress along its foot easing over 260 ms; three skeleton
//   rows hold the table's top while it runs (#225), and each application lands at its date's place
//   (JobsPage). Done, it shows its check and "Read 330 emails" for 1.2 s, then folds away (180 ms).
// - Jobs off (38c): the one-line empty state, the 20 px `work` over "Jobs is off · Turn on"; Turn on
//   opens Settings › Jobs with its switch focused.
// No JD found, Ghosted and a status set by hand are the table's and the detail's, never animated.
import type {JobsHistoryOut, JobsPageOut} from '@setpoint/shared';
import type {CSSProperties} from 'react';
import type {LinePhase} from '../../logic/stateLines.ts';
import {Icon} from '../../ui/Icon.tsx';
import {SettingsLink} from '../search/AnswerCard.tsx';
import {Bar, Sk} from '../states/Loading.tsx';
import {useLinePhase, useShownLines} from '../states/States.tsx';
import {openJobsSettings} from './JobsSettings.tsx';
import {historyLine, historyRead, historyRuns, historyShare, readingLine} from './words.ts';

type JobsLine = {kind: 'down'; text: string} | {kind: 'history'; history: Pick<JobsHistoryOut, 'read' | 'total'>};

/** The column's lines: the AI down, then the history pass; null while there are none. */
export function JobsLines({page, now, timeZone}: {page: JobsPageOut; now: number; timeZone: string}) {
  const down = readingLine(page.reading, page.history, now, timeZone);
  const lines: {key: string; line: JobsLine}[] = [
    ...(down ? [{key: 'down', line: {kind: 'down' as const, text: down}}] : []),
    ...(historyRuns(page.history) ? [{key: 'history', line: {kind: 'history' as const, history: {read: page.history.read, total: page.history.total}}}] : []),
  ];
  // Either one going is a recovery: the AI back, or the pass done.
  const {shown, moveOn} = useShownLines(lines, () => true);
  if (!shown.length) return null;
  return (
    <>
      {shown.map(({key, line, phase}) => (line.kind === 'down'
        ? <DownLine key={key} text={line.text} phase={phase} onMoveOn={from => moveOn(key, from)} />
        : <HistoryLine key={key} history={line.history} done={page.history} phase={phase} onMoveOn={from => moveOn(key, from)} />))}
    </>
  );
}

const cleared = (phase: LinePhase) => phase === 'cleared' || phase === 'out';

function DownLine({text, phase, onMoveOn}: {text: string; phase: LinePhase; onMoveOn: (from: 'cleared' | 'out') => void}) {
  const ref = useLinePhase(phase, onMoveOn);
  const back = cleared(phase);
  return (
    <div ref={ref} className={back ? 'jb-state muted cleared' : 'jb-state failing'} role={back ? 'status' : 'alert'}>
      {back ? <Icon name="check" size={16} className="ok" /> : <Icon name="warning" size={16} />}
      <span className="grow num ell" title={text}>{text.endsWith('Settings › AI') && !back ? <SettingsLink text={text} /> : text}</span>
    </div>
  );
}

/** The pass's line; `done` is the page's latest, whose count the last words say. */
function HistoryLine({history, done, phase, onMoveOn}: {history: Pick<JobsHistoryOut, 'read' | 'total'>; done: JobsHistoryOut; phase: LinePhase; onMoveOn: (from: 'cleared' | 'out') => void}) {
  const ref = useLinePhase(phase, onMoveOn);
  if (cleared(phase)) {
    return (
      <div ref={ref} className="jb-state muted cleared" role="status">
        <Icon name="check" size={16} className="ok" />
        <span className="grow num ell">{historyRead(done.state === 'done' ? done : history)}</span>
      </div>
    );
  }
  const text = historyLine(history);
  return (
    <div ref={ref} className="jb-state muted progress" role="status" style={{'--done': `${historyShare(history) * 100}%`} as CSSProperties}>
      <span className="spin"><Icon name="progress_activity" size={16} /></span>
      <span className="grow num ell" title={text}>{text}</span>
    </div>
  );
}

/** While the pass runs, three skeleton rows hold the table's top: the newest applications are still to come (#225). */
export function HistorySkeleton() {
  const widths: [number, number, number, number][] = [[132, 196, 64, 72], [104, 238, 56, 64], [150, 170, 72, 56]];
  return (
    <Sk kind="jobs-history" className="jb-sk" immediate>
      {widths.map(([company, role, platform, jd], index) => (
        <div key={index} className="jb-tr">
          <span /><span><Bar w={company} /></span><span><Bar w={role} /></span><span className="c-plat"><Bar w={platform} /></span>
          <span><Bar w={40} /></span><span><Bar w={88} /></span><span><Bar w={jd} /></span>
        </div>
      ))}
    </Sk>
  );
}

/** Jobs off (38c): "Jobs is off · Turn on". */
export function JobsOff() {
  return (
    <div className="jb-empty">
      <Icon name="work" size={20} />
      <div className="line"><span>Jobs is off</span><span className="sep">·</span><button className="lnk" type="button" onClick={openJobsSettings}>Turn on</button></div>
    </div>
  );
}
