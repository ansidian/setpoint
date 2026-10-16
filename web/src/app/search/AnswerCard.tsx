// Alfred's Answer card (DESIGN.md › Alfred's Answer card; board 07): one or two lines with their bold
// runs, the sources (rows that open in the reading pane), each follow-up turn below the last, and a
// follow-up field. "Couldn't find that in your mail" says what it searched; a failure shows the
// server's words and puts the question back in the field. With no key, the card says so as it opens,
// and "Settings › AI" in any of its lines opens Settings there. Answers aren't streamed, so while a
// question waits the card shows Alfred's trail: each step done (the search it ran, the email it
// read) above what it's doing now, which shimmers, and the answer's place held by two bars, the
// follow-up field dimmed until the answer is in, when the trail folds away and the answer fades up
// (search-04, #236). A long list of sources shows its first five and Show all. Proposals in an answer show as the
// proposal card.
import type {AccountOut, AiOut} from '@setpoint/shared';
import {Fragment, useEffect, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {motion} from '../../tokens.ts';
import {useResource} from '../../api/client.ts';
import {AI_PATH} from '../../api/settings.ts';
import {age, fullTimestamp} from '../../logic/format.ts';
import {alfredStepDone, alfredStepLine, answerSegments, searchedLine, shownSources, showsQuestion} from '../../logic/search.ts';
import type {AskStep} from '@setpoint/shared';
import {Icon} from '../../ui/Icon.tsx';
import {foldAway} from '../fold.ts';
import {Bar, Sk} from '../states/Loading.tsx';
import {openSettings} from '../settings/store.ts';
import {ProposalCard} from './ProposalCard.tsx';
import {Account} from './Search.tsx';
import type {Alfred} from './state.ts';

export function AnswerCard({alfred, scoped, openId, accounts, now, timeZone, onOpen}: {
  alfred: Alfred;
  // Ask about this email: the card is about one email, and shows every question.
  scoped: boolean;
  openId: number | null;
  accounts: Map<number, AccountOut>;
  now: number;
  timeZone: string;
  onOpen: (id: number) => void;
}) {
  const [draft, setDraft] = useState('');
  // The turns whose every source shows.
  const [allSources, setAllSources] = useState<ReadonlySet<number>>(new Set());
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
    if (waiting === null) field.current?.focus();
  }, [turns.length, waiting]);
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
  const noKey = ai && !ai.keys.anthropic && !ai.keys.openai ? 'Alfred needs an Anthropic or OpenAI key in Settings › AI.' : null;
  const failure = error ?? (turns.length || asking ? null : noKey);
  return (
    <div ref={card} className={asking ? 'card answer asking' : 'card answer'} aria-label="Alfred's answer">
      <div className="card-h">
        <Icon name="auto_awesome" size={16} alfred />
        <span className="card-title">Alfred</span>
        <span className="grow" />
        <button className="ibtn sm" type="button" aria-label="Close answer" onClick={close}><Icon name="close" size={16} /></button>
      </div>
      <div className="card-b">
        {turns.map((turn, index) => (
          <Fragment key={turn.turn_id}>
            {index > 0 && <div className="turn-sep" />}
            {showsQuestion(index, scoped) && <div className="q">{turn.question}</div>}
            {folding && index === turns.length - 1 && <Trail steps={folding} folding />}
            {turn.answer ? <p className="ans"><Bold text={turn} /></p> : (
              <div className="ans-none">
                <p className="ans">Couldn’t find that in your mail</p>
                {searchedLine(turn.searched) && <span className="searched">{searchedLine(turn.searched)}</span>}
              </div>
            )}
            {turn.sources.length > 0 && (
              <div className="srcs">
                {shownSources(turn.sources, allSources.has(turn.turn_id)).shown.map(source => (
                  <button key={source.message_id} type="button" className={source.message_id === openId ? 'src open' : 'src'} data-id={source.message_id} onClick={() => onOpen(source.message_id)}>
                    <span className="line">
                      <span className="who">{source.organisation ?? source.from_name}</span>
                      <span className="grow ell">{source.subject}</span>
                      {source.pinned && <span className="pin" title="Pinned"><Icon name="keep" size={16} /></span>}
                    </span>
                    <span className="ac" title={accounts.get(source.account_id)?.label}><Account account={accounts.get(source.account_id)} /></span>
                    <span className="age num" title={fullTimestamp(source.received_at, timeZone)}>{age(source.received_at, now, timeZone)}</span>
                  </button>
                ))}
                <MoreSources more={shownSources(turn.sources, allSources.has(turn.turn_id)).more} onToggle={() => setAllSources(current => {
                  const next = new Set(current);
                  if (!next.delete(turn.turn_id)) next.add(turn.turn_id);
                  return next;
                })} />
              </div>
            )}
            {turn.proposals.map(proposal => <ProposalCard key={`${proposal.message_id}:${proposal.kind}:${proposal.item.title}`} proposal={proposal} now={now} timeZone={timeZone} inAnswer />)}
          </Fragment>
        ))}
        {waiting !== null && (
          <>
            {turns.length > 0 && <div className="turn-sep" />}
            {showsQuestion(turns.length, scoped) && <div className="q">{waiting}</div>}
            <Trail steps={finished(alfred.trail, alfred.step)}>
              <div className="waiting"><span className="spin"><Icon name="progress_activity" size={16} /></span><span className="now">{alfredStepLine(alfred.step, scoped)}</span></div>
            </Trail>
            {/* The answer's place, held. */}
            <Sk kind="answer" className="sk-answer on-sub"><Bar w="72%" h={10} /><Bar w="46%" h={10} /></Sk>
          </>
        )}
        {failure && <div className="failed-line"><Icon name="error" size={16} /><span><SettingsLink text={failure} /></span></div>}
        {/* Dimmed while Alfred answers: Enter waits until the answer is in, the follow-up kept. */}
        <label className={asking ? 'field asking' : 'field'}>
          <input ref={field} className="grow" aria-label="Ask a follow-up" placeholder={scoped && !turns.length && !asking ? 'Ask about this email…' : 'Ask a follow-up…'}
            value={draft} onChange={event => setDraft(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                close();
              } else if (event.key === 'Enter' && !asking && draft.trim()) {
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

/** Alfred's trail: each step done, its tool's glyph and what it did, then what it's doing now; folding away once answered. */
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
