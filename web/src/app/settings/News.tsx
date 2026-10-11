// Settings › News (board 30a; DESIGN.md › News in Settings): "312 articles today · 41 stories" in the
// head, then one group per section with its count, each source a 44 px row: its icon, its name and
// what's read, how often, and its state as on Accounts. The tile is the icon the source's list names
// (a TV station's `live_tv`), else its adapter's (logic/news.ts). ("Checked 9:10 AM", or "Failing, 404 since
// 6:02 AM" in `caution` on a `caution` 7% row). Read-only until the tuning round: no handles, no
// switches. No key row: AirNow's air quality comes from its keyless file (DESIGN.md #97).
import type {NewsSourceOut, NewsSourcesOut} from '@setpoint/shared';
import {timeZone} from '../../api/auth.ts';
import {useResource} from '../../api/client.ts';
import {NEWS_SOURCES_PATH} from '../../api/news.ts';
import {everyLine, newsSourceState, SECTION_LABELS, sourcesHeader, sourceTile} from '../../logic/news.ts';
import {Icon} from '../../ui/Icon.tsx';
import {useNow} from '../clock.ts';
import {Page, Section} from './parts.tsx';

export function NewsSettingsPage() {
  const {data} = useResource<NewsSourcesOut>(NEWS_SOURCES_PATH);
  return (
    <Page title="News" actions={data && <span className="head-note num">{sourcesHeader(data)}</span>}>
      {data?.sections.map(({section, sources}) => (
        <Section key={section} label={<>{SECTION_LABELS[section]} <span className="n num">{sources.length}</span></>}>
          <div className="set-group">
            {sources.length ? sources.map(source => <SourceRow key={source.id} source={source} />) : <div className="set-row slim"><span className="s">No sources</span></div>}
          </div>
        </Section>
      ))}
    </Page>
  );
}

function SourceRow({source}: {source: NewsSourceOut}) {
  const state = newsSourceState(source.health, useNow(), timeZone());
  return (
    <div className={state.warn ? 'set-row slim news-src warn' : 'set-row slim news-src'} data-news-source={source.id}>
      <span className="aico"><Icon name={sourceTile(source)} size={16} /></span>
      <div className="lines grow"><span className="t ell">{source.name}</span><span className="s ell">{source.reads}</span></div>
      <span className="prov">{everyLine(source.interval_seconds)}</span>
      <span className={state.tone === 'caution' ? 'state caution' : 'state'} title={state.title ?? undefined}>
        {state.warn && <Icon name="warning" size={16} />}
        <span className="num ell">{state.text}</span>
      </span>
    </div>
  );
}
