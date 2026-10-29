// Per week (DESIGN.md › Jobs › Shell; D314, D318): the last 12 weeks oldest first as bars, the busiest
// 20 px and the rest in proportion, a week with none a stub; this week's an outline, since it isn't
// over; then "3 this week". A bar under the pointer turns ink and names its week in a tip. It has no
// press: it's information.
import type {JobWeekOut} from '@setpoint/shared';
import {useState} from 'react';
import {barHeights, weekTip} from './words.ts';

export function PerWeek({weeks, today}: {weeks: JobWeekOut[]; today: string}) {
  const [pointed, setPointed] = useState<{index: number; left: number} | null>(null);
  const heights = barHeights(weeks);
  const current = weeks.find(week => week.current)?.count ?? 0;
  const tip = pointed ? weekTip(weeks[pointed.index]!, today) : null;
  const summary = weeks.map(week => weekTip(week, today)).map(each => `${each.when}: ${each.count}`).join('; ');
  return (
    <span className="jb-week" role="img" aria-label={`Applications per week, the last ${weeks.length}: ${summary}. ${current} this week`} onMouseLeave={() => setPointed(null)}>
      <span className="lbl">Per week</span>
      <span className="bars">
        {weeks.map((week, index) => (
          <i key={week.start} data-week={week.start} style={{height: heights[index]}}
            className={[week.current && 'now', week.count === 0 && !week.current && 'none', pointed?.index === index && 'hov'].filter(Boolean).join(' ') || undefined}
            onMouseEnter={event => {
              // The chart is the bar's offset parent, so the tip centres under it.
              const bar = event.currentTarget;
              setPointed({index, left: bar.offsetLeft + bar.offsetWidth / 2});
            }} />
        ))}
      </span>
      <span><span className="v">{current}</span><span className="words"> this week</span></span>
      {tip && <span className="jb-tip" role="tooltip" style={{left: pointed!.left}}>{tip.when} <span className="ink3">· {tip.count}</span></span>}
    </span>
  );
}
