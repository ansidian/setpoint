// Needs you (DESIGN.md › Needs you; boards 32, 34a, 34b; D308, D311, D313), drawn read-only in J5:
// the band above the table under its group header, today's items as the boards draw each kind, and
// From history folded under them, unfolding on a click. Their actions (pick a candidate, None of these,
// Assign to…, Track this, Not about a job, Dismiss all) are drawn as the boards draw them but don't
// answer yet: J6 wires them. A candidate's arrow opens its posting in a new tab, as it will then.
import type {AccountOut, NeedsYouItemOut} from '@setpoint/shared';
import {useState} from 'react';
import {age, fullTimestamp, localDate} from '../../logic/format.ts';
import {Icon} from '../../ui/Icon.tsx';
import type {IconName} from '../../ui/glyphs.ts';
import {dotStyle} from '../accounts.ts';
import {dayWord, historyWhy, itemFrom, itemWhat, needsLine} from './words.ts';

const KIND_GLYPHS: Record<NeedsYouItemOut['kind'], IconName> = {jd_to_confirm: 'description', update_to_assign: 'alt_route', email_to_track: 'bookmark_add'};

export const needKey = (id: number) => `n:${id}`;

/** Inert until J6: drawn as the boards draw it, taking no pointer and no focus. */
const inert = {type: 'button', 'aria-disabled': true, tabIndex: -1} as const;

export function NeedsYou({items, history, accounts, cursor, folded, now, timeZone, onPoint}: {
  items: NeedsYouItemOut[];
  history: NeedsYouItemOut[];
  accounts: Map<number, AccountOut>;
  cursor: string | null;
  // While a search holds a query, it folds away (180 ms).
  folded: boolean;
  now: number;
  timeZone: string;
  onPoint: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const today = localDate(now, timeZone);
  if (!items.length && !history.length) return null;
  return (
    <div className={folded ? 'jb-band folded' : 'jb-band'} inert={folded}>
      <div>
        {items.length > 0 && <div className="gh first"><Icon name="pending_actions" size={14} />Needs you <span className="n">{items.length}</span></div>}
        {items.map(item => (
          <Item key={item.id} item={item} account={item.account_id !== null ? accounts.get(item.account_id) : undefined} cur={cursor === needKey(item.id)}
            now={now} timeZone={timeZone} today={today} onPoint={onPoint} />
        ))}
        {history.length > 0 && (
          <>
            <div className="jb-fold" onClick={() => setOpen(!open)}>
              <button className="jb-fold-t" type="button" aria-expanded={open} onClick={event => {
                event.stopPropagation();
                setOpen(!open);
              }}>
                <Icon name="chevron_right" size={16} />
                <span>From history <span className="n">{history.length}</span></span>
                <span className="why ink3">· what the history pass wasn&rsquo;t sure of</span>
              </button>
              {open && <button {...inert} className="btn quiet sm jb-inert" title="The same as ignoring each one: those emails make nothing">Dismiss all</button>}
            </div>
            <div className={open ? 'jb-hist-wrap open' : 'jb-hist-wrap'} inert={!open}>
              <div>
                {history.map(item => <HistoryRow key={item.id} item={item} today={today} timeZone={timeZone} />)}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Item({item, account, cur, now, timeZone, today, onPoint}: {
  item: NeedsYouItemOut;
  account: AccountOut | undefined;
  cur: boolean;
  now: number;
  timeZone: string;
  today: string;
  onPoint: (key: string) => void;
}) {
  const key = needKey(item.id);
  const jd = item.kind === 'jd_to_confirm';
  return (
    <div className={cur ? 'jb-need cur' : 'jb-need'} data-key={key} data-need={item.id} onMouseMove={() => !cur && onPoint(key)}>
      <span className="g"><Icon name={KIND_GLYPHS[item.kind]} size={16} /></span>
      <div className="l1">
        <span className="what">{itemWhat(item)}</span>
        <span className="from">· {jd ? 'Is this the posting?' : itemFrom(item)}</span>
      </div>
      <div className="r1">
        {jd ? <span>Applied {dayWord(localDate(item.at, timeZone), today)}</span> : (
          <>
            {account && <span className="dot sm" style={dotStyle(account.colour)} title={account.label} />}
            <span title={fullTimestamp(item.at, timeZone)}>{age(item.at, now, timeZone)}</span>
          </>
        )}
      </div>
      {jd ? (
        <div className="acts cands">
          <div className="jb-cands">
            {item.candidates.map(candidate => (
              <div key={candidate.id} className="jb-cand">
                <Icon name="radio_button_unchecked" size={16} />
                <span className="ell"><span className="t">{candidate.title}</span> <span className="ink3">· {[candidate.location, candidate.platform].filter(Boolean).join(' · ')}</span></span>
                <a className="ibtn sm" href={candidate.link} target="_blank" rel="noopener noreferrer" aria-label="Look at this posting" title="Look at this posting"><Icon name="open_in_new" size={16} /></a>
              </div>
            ))}
            <div className="jb-cand"><Icon name="block" size={16} /><span className="ell ink2">None of these</span></div>
          </div>
        </div>
      ) : (
        <div className="acts">
          <span className="line">{needsLine(item)}</span>
          {item.kind === 'update_to_assign' ? (
            <button {...inert} className="btn out sm jb-inert"><Icon name="move_item" size={16} />Assign to…<Icon name="expand_more" size={16} className="after" /></button>
          ) : <button {...inert} className="btn sm jb-inert"><Icon name="add" size={16} />Track this</button>}
          <button {...inert} className="btn quiet sm jb-inert">Not about a job</button>
        </div>
      )}
    </div>
  );
}

function HistoryRow({item, today, timeZone}: {item: NeedsYouItemOut; today: string; timeZone: string}) {
  const jd = item.kind === 'jd_to_confirm';
  const day = dayWord(localDate(item.at, timeZone), today);
  return (
    <div className="jb-hist" data-need={item.id}>
      <Icon name={KIND_GLYPHS[item.kind]} size={15} />
      <span className="what"><b>{itemWhat(item)}</b> · {historyWhy(item)}</span>
      <span className="when">{jd ? `Applied ${day}` : day}</span>
      <span className="acts">
        <button {...inert} className="btn out sm jb-inert">{jd ? 'Choose…' : item.kind === 'update_to_assign' ? 'Assign to…' : 'Track this'}</button>
        <button {...inert} className="btn quiet sm jb-inert">{jd ? 'None of these' : 'Not about a job'}</button>
      </span>
    </div>
  );
}
