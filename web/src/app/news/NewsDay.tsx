// News's pane with nothing open (SV-219, D466, DESIGN.md #332), in the Inbox's shape (InboxDay.tsx):
// one block centred across the pane, a third of the way down. The mark; While you were away (#298), moved
// here from the top of All, its stories opening in the recap's modal and showing in `ink2` once
// opened; the freshness line, with feeds failing every attempt for 6 hours; today's strip; and in the
// foot over the keys, the quiet facts, led by any trouble's chip (sorting stopped, a whole section
// stale; EmptyPane, #335). No count of new stories (D87).
import type {NewsDayOut, StoryRowOut} from '@setpoint/shared';
import {Fragment} from 'react';
import {useResource} from '../../api/client.ts';
import {NEWS_DAY_PATH} from '../../api/news.ts';
import {recapSince, rowMeta} from '../../logic/news.ts';
import type {HeldRecap} from '../../logic/news.ts';
import {failingLine, freshnessLine, newsKeptLine, newsTiles} from '../../logic/newsDay.ts';
import {Icon, Mark} from '../../ui/Icon.tsx';
import {EmptyPane} from '../EmptyPane.tsx';
import type {PaneKey, PaneTrouble} from '../EmptyPane.tsx';
import {openSettings} from '../settings/store.ts';

const KEYS: PaneKey[] = [
  {keys: ['J', 'K'], does: 'Move'},
  {keys: ['Enter'], does: 'Open'},
  {keys: ['O'], does: 'Original'},
  {keys: ['Tab'], does: 'Section'},
];

export function NewsDay({recap, rows, trouble, now, zone, openAt, onRecap}: {
  // The recap held for the visit, as it's drawn (only on All); null without one.
  recap: HeldRecap | null;
  rows: ReadonlyMap<number, StoryRowOut>;
  trouble: PaneTrouble[];
  now: number;
  zone: string;
  // The recap's story open in its panel, by its place, which its row marks.
  openAt: number | null;
  onRecap: (index: number) => void;
}) {
  const {data: day} = useResource<NewsDayOut>(NEWS_DAY_PATH);
  const since = recap ? recapSince(recap.since, now, zone) : null;
  const stories = recap ? recap.ids.flatMap(id => rows.get(id) ?? []) : [];
  const failing = day ? failingLine(day) : null;
  return (
    <EmptyPane label="News pane" keys={KEYS} trouble={trouble} foot={day && <p className="md-kept num">{newsKeptLine(day)}</p>}>
      <div className="mail-day news-day">
        <Mark size={40} settle />
        {stories.length > 0 && (
          <section className="nd-recap" aria-label="While you were away">
            <p className="md-need nd-away"><Icon name="history" size={18} /><span>While you were away</span>{since && <span className="nd-since num">{since}</span>}</p>
            <ol className="nd-list">
              {stories.map((row, index) => {
                const meta = rowMeta(row, now, zone, recap!.named[row.id] ?? row.sections[0]!);
                return (
                  <li key={row.id}>
                    <button type="button" className={['nd-row', row.state === 'seen' && 'seen', openAt === index && 'on'].filter(Boolean).join(' ')} aria-current={openAt === index || undefined} data-story={row.id} onClick={() => onRecap(index)}>
                      <span className="hl">{row.headline}</span>
                      <span className="nw-meta">
                        {[meta.section, meta.outlet, meta.age].filter(Boolean).map((part, at) => <Fragment key={at}>{at > 0 && <span>·</span>}<span className={at === 1 ? 'outlet' : undefined}>{part}</span></Fragment>)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </section>
        )}
        {day && (
          <>
            <p className="nd-fresh num">
              <Icon name="schedule" size={14} /><span>{freshnessLine(day, zone)}</span>
              {failing && <><span className="sep">·</span><button className="nd-failing" type="button" onClick={() => openSettings('news')}>{failing}</button></>}
            </p>
            <dl className="md-today" aria-label="Today">
              {newsTiles(day).map(tile => (
                <div key={tile.label} className={tile.value === '0' ? 'md-tile' : 'md-tile lit'} data-tip={tile.tip}>
                  <dt><Icon name={tile.glyph} size={14} />{tile.label}</dt>
                  <dd className="num">{tile.value}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </div>
    </EmptyPane>
  );
}
