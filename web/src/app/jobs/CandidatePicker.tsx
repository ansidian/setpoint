// A JD to confirm's candidates (DESIGN.md › Needs you; board 34a): in Needs you, and in the detail
// where Not this posting offers the other candidates (35b).
import type {JdCandidateOut} from '@setpoint/shared';
import type {KeyboardEvent as ReactKeyboardEvent, ReactNode} from 'react';
import {useEffect, useRef, useState} from 'react';
import {Icon} from '../../ui/Icon.tsx';
import {isTyping} from '../../ui/keys.ts';
import {candidateWhere, CANT_READ} from './menus.ts';
import {pickWords} from './words.ts';

/**
 * A JD's candidates (34a): a group of radios, the last None of these, each candidate's arrow opening
 * its posting without picking it. ↑ ↓ choose and Enter picks, in the group or, while its item has the
 * page's cursor (`active`), from the page. Picked, the group takes `good` and the row reads "JD saved".
 * One Jobs can't read says so after its line, which gives way to it, and picked reads "Link kept" (SV-140).
 */
export function CandidatePicker({candidates, active, picked, onPick, onNone}: {
  candidates: JdCandidateOut[];
  active: boolean;
  picked: number | 'none' | null;
  onPick: (candidate: JdCandidateOut) => void;
  onNone: () => void;
}) {
  const [at, setAt] = useState<number | null>(null);
  const group = useRef<HTMLDivElement>(null);
  const count = candidates.length + 1;
  const choose = (index: number) => (index === candidates.length ? onNone() : onPick(candidates[index]!));
  const key = (event: KeyboardEvent | ReactKeyboardEvent, inGroup: boolean) => {
    if (picked !== null) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const next = at === null ? (event.key === 'ArrowDown' ? 0 : count - 1) : (at + (event.key === 'ArrowDown' ? 1 : count - 1)) % count;
      setAt(next);
      if (inGroup) group.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
    } else if ((event.key === 'Enter' || (inGroup && event.key === ' ')) && at !== null) {
      event.preventDefault();
      choose(at);
    }
  };
  // While its item has the page's cursor, ↑ ↓ and Enter are the group's.
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event) || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (group.current?.contains(event.target as Node)) return;
      key(event, false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });
  const row = (index: number, content: ReactNode, peek?: JdCandidateOut) => {
    const chosen = picked === (index === candidates.length ? 'none' : candidates[index]!.id);
    const classes = ['jb-cand', at === index && 'cur', chosen && 'picked'].filter(Boolean).join(' ');
    return (
      <div key={index} className={classes} onPointerMove={() => picked === null && at !== index && setAt(index)}>
        <button type="button" role="radio" className="pick" aria-checked={chosen} tabIndex={(at ?? 0) === index ? 0 : -1} onClick={() => picked === null && choose(index)}
          onFocus={() => setAt(index)}>
          {content}
        </button>
        {peek && (
          <a className="ibtn sm" href={peek.link} target="_blank" rel="noopener noreferrer" aria-label={`Look at ${peek.title}`} title="Look at this posting">
            <Icon name="open_in_new" size={16} />
          </a>
        )}
      </div>
    );
  };
  return (
    <div ref={group} className={picked === null ? 'jb-cands' : 'jb-cands picked'} role="radiogroup" aria-label="Is this the posting?" onKeyDown={event => {
      event.stopPropagation();
      key(event, true);
    }}>
      {candidates.map((candidate, index) => row(index, picked === candidate.id ? (
        <>
          <Icon name="check_circle" size={16} className="ok" />
          <span className="ell"><span className="t">{candidate.title}</span> <span className="ink3">· {pickWords(candidate, '').what}</span></span>
        </>
      ) : (
        <>
          <Icon name="radio_button_unchecked" size={16} />
          <span className="ell"><span className="t">{candidate.title}</span> <span className="ink3">· {candidateWhere(candidate)}</span></span>
          {candidate.unreadable && <span className="ink3 cant">{CANT_READ}</span>}
        </>
      ), candidate))}
      {row(candidates.length, (
        <>
          <Icon name={picked === 'none' ? 'check_circle' : 'block'} size={16} className={picked === 'none' ? 'ok' : undefined} />
          <span className="ell ink2">None of these</span>
        </>
      ))}
    </div>
  );
}
