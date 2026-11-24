// Alfred's Answer card (board 07): one or two lines with their bold
// runs, the sources (email rows that open in the reading pane, then the events and tasks it rests
// on, each opening the floating detail's card beside the answer, as a Today line does, so the answer
// stays: Edit and Open in Calendar go there), then the job applications (their rows open them on
// Jobs), each follow-up turn below the last, and a follow-up field.
// "Couldn't find that in your mail or calendar" says what it searched. A failure shows the
// server's words and puts the question back in the field. With no key, the card says so as it opens,
// and "Settings › AI" in any of its lines opens Settings there. Answers aren't streamed, so while a
// question waits the card shows Alfred's trail. Each step done (the search it ran, the email it
// read) sits above what it's doing now, which shimmers. Two bars hold the answer's place, and the
// follow-up field is dimmed until the answer is in. Then the trail folds away and the answer fades up.
// A long list of sources shows its first five and Show all. Proposals in an answer show as the
// proposal card. While the thread is read back after a reload, a skeleton holds its place and the
// field is dimmed. In Alfred's window the header is the window's title: it folds the window to its
// bar and back. On the phone an item's row opens its detail on the Agenda instead, and the follow-up
// field takes the keys only when tapped, so no keyboard rises on its own. In the phone's sheet the
// sheet's top bar is the card's header.
import type {AccountOut, AiOut, AnswerApplicationOut, AnswerItemOut, CalendarOut, ItemOut, ItemsOut} from '@setpoint/shared';
import {Fragment, useEffect, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {motion} from '../../tokens.ts';
import {useResource} from '../../api/client.ts';
import {CALENDARS_PATH, completeItem, itemPath, itemsPath} from '../../api/items.ts';
import {AI_PATH} from '../../api/settings.ts';
import {addDays, age, fullTimestamp} from '../../logic/format.ts';
import type {Route} from '../../logic/route.ts';
import {alfredStepDone, alfredStepLine, answerItemWhen, answerSegments, searchedLine, shownSources, showsQuestion} from '../../logic/search.ts';
import type {AskStep} from '@setpoint/shared';
import {Icon} from '../../ui/Icon.tsx';
import {ItemCard} from '../calendar/detail/ItemCard.tsx';
import {rectIn} from '../calendar/geometry.ts';
import {usePhone} from '../Phone.tsx';
import {navigate} from '../router.ts';
import {showToast, toastFailure} from '../toast.ts';
import {foldAway} from '../fold.ts';
import {Bar, Sk} from '../states/Loading.tsx';
import {ThreadSkeleton} from '../states/Skeletons.tsx';
import {openSettings} from '../settings/store.ts';
import {ProposalChip} from './ProposalChip.tsx';
import {Account} from './Search.tsx';
import type {Alfred} from './state.ts';

export function AnswerCard({alfred, scoped, openId, accounts, now, timeZone, windowed = false, minimized = false, onMinimize, sheet = false, focusField = false, onItem, onOpen}: {
  alfred: Alfred;
  // Ask about this email: the card is about one email, and shows every question.
  scoped: boolean;
  openId: number | null;
  accounts: Map<number, AccountOut>;
  now: number;
  timeZone: string;
  // In Alfred's window, over another page: every question shows (the search field isn't there), and
  // the field takes the keys only while they're already in the card.
  windowed?: boolean;
  // In Alfred's window: folded to its title bar, and the title's click.
  minimized?: boolean;
  onMinimize?: () => void;
  // In the phone's sheet: no header of its own (the sheet's top bar is it), and every question shows.
  sheet?: boolean;
  // The phone's sheet opened on a new thread by a tap: the field takes the keys at once, so the keyboard rises.
  focusField?: boolean;
  // On the phone, an item's row: its detail on the Agenda (by default, there at once).
  onItem?: (item: AnswerItemOut) => void;
  onOpen: (id: number) => void;
}) {
  const phone = usePhone();
  const openOnAgenda = onItem ?? (phone ? (item: AnswerItemOut) => navigate(answerItemRoute(item)) : null);
  const [draft, setDraft] = useState('');
  // The turns whose every source shows.
  const [allSources, setAllSources] = useState<ReadonlySet<number>>(new Set());
  // The item whose card is open, by its turn and key.
  const [openItem, setOpenItem] = useState<{turn: number; item: AnswerItemOut} | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const card = useRef<HTMLDivElement>(null);
  // Closed (× or Esc), it folds away (app/fold.ts).
  const close = () => {
    foldAway(card.current);
    alfred.close();
  };
  const {turns, waiting, error, failed} = alfred;
  const {data: ai} = useResource<AiOut>(AI_PATH);
  // The field takes the keys when the card opens and after each answer.
  useEffect(() => {
    if (waiting !== null || phone || (windowed && !card.current?.contains(document.activeElement))) return;
    field.current?.focus();
  }, [turns.length, waiting, windowed, phone]);
  // A question that failed comes back to the field, to ask again once fixed.
  const [restored, setRestored] = useState<string | null>(null);
  if (failed !== restored) {
    setRestored(failed);
    if (failed && !draft) setDraft(failed);
  }
  const asking = waiting !== null;
  // The trail of the question just answered, folding away over 180 ms as its answer lands.
  const [was, setWas] = useState({asking, turns: turns.length});
  const [folding, setFolding] = useState<AskStep[] | null>(null);
  if (was.asking !== asking || was.turns !== turns.length) {
    setWas({asking, turns: turns.length});
    if (was.asking && !asking && turns.length > was.turns) setFolding(alfred.trail);
  }
  useEffect(() => {
    if (!folding) return;
    const timer = window.setTimeout(() => setFolding(null), motion.medium);
    return () => window.clearTimeout(timer);
  }, [folding]);
  const finished = (trail: AskStep[], current: AskStep | null) => (current ? trail.slice(0, -1) : trail);
  const noKey = ai && !ai.keys.anthropic ? 'Alfred needs an Anthropic key in Settings › AI.' : null;
  const loading = alfred.loading === true;
  const failure = error ?? (turns.length || asking || loading ? null : noKey);
  return (
    <div ref={card} className={asking ? 'card answer asking' : 'card answer'} aria-label="Alfred's answer">
      {sheet ? null : onMinimize ? (
        <div className="card-h alf-title" onMouseDown={event => event.preventDefault()} onClick={onMinimize}>
          <Icon name="auto_awesome" size={16} alfred />
          <button className="card-title alf-title-text" type="button" aria-expanded={!minimized} aria-label={minimized ? 'Open the window' : 'Minimize the window'}>Alfred</button>
          <button className="ibtn sm" type="button" aria-label="Close answer" onClick={event => {
            event.stopPropagation();
            close();
          }}><Icon name="close" size={16} /></button>
        </div>
      ) : (
        <div className="card-h">
          <Icon name="auto_awesome" size={16} alfred />
          <span className="card-title">Alfred</span>
          <span className="grow" />
          <button className="ibtn sm" type="button" aria-label="Close answer" onClick={close}><Icon name="close" size={16} /></button>
        </div>
      )}
      <div className="card-b">
        {turns.map((turn, index) => (
          <Fragment key={turn.turn_id}>
            {index > 0 && <div className="turn-sep" />}
            {showsQuestion(index, scoped || windowed || sheet) && <div className="q">{turn.question}</div>}
            {folding && index === turns.length - 1 && <Trail steps={folding} folding />}
            {turn.answer ? <p className="ans"><Bold text={turn} /></p> : (
              <div className="ans-none">
                <p className="ans">Couldn’t find that in your mail or calendar</p>
                {searchedLine(turn.searched) && <span className="searched">{searchedLine(turn.searched)}</span>}
              </div>
            )}
            {(turn.sources.length > 0 || turn.items.length > 0 || turn.applications.length > 0) && (
              <div className="srcs">
                {shownSources(turn.sources, allSources.has(turn.turn_id)).shown.map(source => (
                  <button key={source.message_id} type="button" className={source.message_id === openId ? 'src open' : 'src'} data-id={source.message_id} onClick={() => onOpen(source.message_id)}>
                    <span className="line">
                      <span className="who">{source.organisation ?? source.from_name}</span>
                      <span className="grow ell">{source.subject}</span>
                      {source.pinned && <span className="pin" role="img" aria-label="Pinned" data-tip="Pinned"><Icon name="keep" size={16} /></span>}
                    </span>
                    <span className="ac" data-tip={accounts.get(source.account_id)?.label}><Account account={accounts.get(source.account_id)} /></span>
                    <span className="age num" data-tip={fullTimestamp(source.received_at, timeZone)}>{age(source.received_at, now, timeZone)}</span>
                  </button>
                ))}
                <MoreSources more={shownSources(turn.sources, allSources.has(turn.turn_id)).more} onToggle={() => setAllSources(current => {
                  const next = new Set(current);
                  if (!next.delete(turn.turn_id)) next.add(turn.turn_id);
                  return next;
                })} />
                {turn.items.map(item => (
                  <button key={item.key} type="button" data-key={item.key} data-turn={turn.turn_id} aria-haspopup={openOnAgenda ? undefined : 'dialog'}
                    className={openItem?.turn === turn.turn_id && openItem.item.key === item.key ? 'src item open' : 'src item'}
                    aria-expanded={openOnAgenda ? undefined : openItem?.turn === turn.turn_id && openItem.item.key === item.key}
                    onClick={() => (openOnAgenda ? openOnAgenda(item) : setOpenItem(open => (open?.turn === turn.turn_id && open.item.key === item.key ? null : {turn: turn.turn_id, item})))}>
                    <span className="line">
                      <Icon name={item.kind === 'task' ? 'task_alt' : 'event'} size={16} />
                      <span className="grow ell">{item.title}</span>
                    </span>
                    <span className="when num">{answerItemWhen(item, now, timeZone)}</span>
                  </button>
                ))}
                {turn.applications.map(application => <ApplicationRow key={application.application_id} application={application} opens={!phone} />)}
              </div>
            )}
            {turn.proposals.map(proposal => {
              const key = `${proposal.message_id}:${proposal.kind}:${proposal.item.title}`;
              // On the phone, a compact card whose Add opens the editor sheet.
              return <ProposalChip key={key} proposal={proposal} now={now} timeZone={timeZone} phone={phone} />;
            })}
          </Fragment>
        ))}
        {waiting !== null && (
          <>
            {turns.length > 0 && <div className="turn-sep" />}
            {showsQuestion(turns.length, scoped || windowed || sheet) && <div className="q">{waiting}</div>}
            <Trail steps={finished(alfred.trail, alfred.step)}>
              <div className="waiting"><span className="spin"><Icon name="progress_activity" size={16} /></span><span className="now">{alfredStepLine(alfred.step, scoped)}</span></div>
            </Trail>
            {/* The answer's place, held. */}
            <Sk kind="answer" className="sk-answer on-sub"><Bar w="72%" h={10} /><Bar w="46%" h={10} /></Sk>
          </>
        )}
        {loading && <ThreadSkeleton />}
        {openItem && <AnswerItemCard key={`${openItem.turn}:${openItem.item.key}`} turn={openItem.turn} cited={openItem.item} timeZone={timeZone} onClose={() => setOpenItem(null)} />}
        {failure && <div className="failed-line"><Icon name="error" size={16} /><span><SettingsLink text={failure} /></span></div>}
        {/* Dimmed while Alfred answers: Enter waits until the answer is in, the follow-up kept. */}
        <label className={asking || loading ? 'field asking' : 'field'}>
          <input ref={field} className="grow" aria-label="Ask a follow-up" autoFocus={focusField}
            placeholder={turns.length || asking || loading ? 'Ask a follow-up…' : scoped ? 'Ask about this email…' : 'Ask about your mail or calendar…'}
            value={draft} onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                close();
              } else if (event.key === 'Enter' && !asking && !loading && draft.trim()) {
                event.preventDefault();
                alfred.ask(draft);
                setDraft('');
              }
            }} />
          <span className="kbd">↵</span>
        </label>
      </div>
    </div>
  );
}

const itemRoute = (item: ItemOut, edit = false): Route => ({page: 'calendar', date: null, item: item.id, at: item.occurrence_start, ...(edit ? {edit: true} as const : {})});
/** An item an answer rests on, where the calendar (the phone's Agenda) opens its detail. */
export const answerItemRoute = (item: AnswerItemOut): Route => ({page: 'calendar', date: null, item: item.id, at: item.occurrence_start});

/**
 * The floating detail's card for an item the answer rests on, beside the answer with its title level
 * with the row, as a Today line's sits beside the sidebar (under the row where there's no room). It shows the item as the calendar has it now, read from its
 * day. A task completes here, and Edit and Open in Calendar go there. One that's gone says so.
 */
function AnswerItemCard({turn, cited, timeZone, onClose}: {turn: number; cited: AnswerItemOut; timeZone: string; onClose: () => void}) {
  // A task with no date is read by its id, as it has no day.
  const {data: day, error} = useResource<ItemsOut>(cited.date ? itemsPath(cited.date, addDays(cited.date, 1)) : null);
  const {data: undated, error: undatedError} = useResource<ItemOut>(cited.date ? null : itemPath(cited.id));
  const {data: calendars} = useResource<CalendarOut[]>(CALENDARS_PATH);
  const item = cited.date ? day?.items.find(one => one.key === cited.key) ?? null : undated ?? null;
  const missing = Boolean(error ?? undatedError) || (cited.date ? day !== undefined && !item : false);
  useEffect(() => {
    if (!missing) return;
    showToast(`${cited.title} is no longer on your calendar`);
    onClose();
  }, [missing, cited.title, onClose]);
  if (!item) return null;
  return (
    <ItemCard item={item} calendar={calendars?.find(calendar => calendar.id === item.calendar_id)} timeZone={timeZone}
      line={`.answer .src.item[data-turn="${turn}"][data-key="${CSS.escape(cited.key)}"]`} lines=".answer .src.item"
      at={(line, host, size) => {
        // Beside the answer, its title level with the row: to its right, else (Alfred's window, at
        // the right end) to its left; where there's no room either side, under the row.
        const answer = rectIn(host.querySelector('.card.answer')!, host);
        const beside = answer.left + answer.width + 8;
        if (beside + size.width <= host.offsetWidth - 12) return {left: beside, top: line.top - 12};
        if (answer.left - 8 - size.width >= 12) return {left: answer.left - 8 - size.width, top: line.top - 12};
        return {left: line.left + line.width - size.width, top: line.top + line.height + 6};
      }}
      actions={{
        complete: task => void completeItem(task.id, !task.done, task.recurring && !task.done ? task.due_date : null)
          .then(() => showToast(`${task.done ? 'Reopened' : 'Completed'} ${task.title}`))
          .catch(toastFailure(task.done ? 'Failed to reopen' : 'Failed to complete')),
        open: one => navigate(itemRoute(one)),
      }}
      onClose={onClose} onEdit={() => navigate(itemRoute(item, true))} />
  );
}

/**
 * A job application the answer rests on: its company and status, then its role. It opens the
 * application on Jobs; on the phone, which has no Jobs, it shows but doesn't open.
 */
function ApplicationRow({application, opens}: {application: AnswerApplicationOut; opens: boolean}) {
  const content = (
    <>
      <span className="line">
        <span className="who ell">{application.company}</span>
        <span className="st">· {application.status}</span>
      </span>
      <span className="role">{application.title}</span>
    </>
  );
  if (!opens) return <div className="src app" data-application={application.application_id}>{content}</div>;
  return (
    <button type="button" className="src app" data-application={application.application_id}
      onClick={() => navigate({page: 'jobs', open: application.application_id})}>{content}</button>
  );
}

/** Alfred's trail: each step done, its tool's glyph and what it did, then what it's doing now. It folds away once answered. */
function Trail({steps, folding = false, children}: {steps: AskStep[]; folding?: boolean; children?: ReactNode}) {
  if (!steps.length && !children) return null;
  return (
    <div className={folding ? 'trail folding' : 'trail'}>
      <div className="trail-in">
        {steps.map((step, index) => {
          const done = alfredStepDone(step);
          return <div className="done-step" key={`${index}:${done.text}`}><Icon name={done.icon} size={14} />{done.text}</div>;
        })}
        {children}
      </div>
    </div>
  );
}

function Bold({text}: {text: Parameters<typeof answerSegments>[0]}) {
  return <>{answerSegments(text).map((part, index) => (part.mark ? <b key={index}>{part.text}</b> : <Fragment key={index}>{part.text}</Fragment>))}</>;
}

/** A line with "Settings › AI" in it, that part a link to Settings › AI. */
export function SettingsLink({text}: {text: string}) {
  const [before, ...after] = text.split('Settings › AI');
  if (!after.length) return <>{text}</>;
  return <>{before}<button type="button" className="lnk" onClick={() => openSettings('ai')}>Settings › AI</button>{after.join('Settings › AI')}</>;
}

/** Under a long list of sources: "Show all 26", then "Show fewer". */
function MoreSources({more, onToggle}: {more: string | null; onToggle: () => void}) {
  if (!more) return null;
  return (
    <button type="button" className="more" onClick={onToggle}>
      <Icon name={more === 'Show fewer' ? 'keyboard_arrow_up' : 'keyboard_arrow_down'} size={16} />{more}
    </button>
  );
}
