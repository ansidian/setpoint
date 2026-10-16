// The story pane (DESIGN.md › The story pane; boards 25, 26a, 26b): where the reading pane sits, and
// as wide. A story shows Open at its leading outlet `O`, previous and next; its sections as tags
// (and Updated when it changed since the user last looked); the headline and meta; its image with the
// outlet's caption; "New since you looked" on an updated story; the summary; then its Sources, each
// opening its article in the same pane. An article shows Back to story `Esc` and Open at its outlet
// `O`, its head, image and extracted text; one whose page can't be read here (board 26b) shows its
// feed summary under a note with Read at, then Also in this story.
import type {ArticleOut, StoryOut, StoryRowOut, StorySourceOut} from '@setpoint/shared';
import {Fragment, useState} from 'react';
import type {CSSProperties} from 'react';
import {useResource} from '../../api/client.ts';
import {articlePath, storyPath} from '../../api/news.ts';
import {paragraphs} from '../../logic/body.ts';
import {age, fullTimestamp, readerTime} from '../../logic/format.ts';
import {articleNote, dayWord, factsSince, foldFacts, foldLine, initials, SECTION_GLYPHS, SECTION_LABELS, stamp, storyMeta} from '../../logic/news.ts';
import {Icon} from '../../ui/Icon.tsx';
import {copyText, openContextMenu} from '../ContextMenu.tsx';
import {useReadingPaneWidth} from '../readingPane.ts';
import {PaneEdge} from '../Reader.tsx';
import {LoadFailed, useArrival, useLoadFailed} from '../states/Loading.tsx';
import type {Load} from '../states/Loading.tsx';
import {BodySkeleton, StoryBodySkeleton} from '../states/Skeletons.tsx';
import {NewsImage} from './NewsImage.tsx';

export function StoryPane({storyId, articleId, row, lookedAt, now, timeZone, canStep, onStep, onOriginal, onArticle, onBack, onClose}: {
  storyId: number;
  articleId: number | null;
  // Its row in the list, so the tools are right before the story itself has loaded.
  row: StoryRowOut | undefined;
  // When the user last looked at it before this visit, if it's been updated since (logic/news.ts).
  lookedAt: string | null;
  now: number;
  timeZone: string;
  canStep: {previous: boolean; next: boolean};
  onStep: (delta: 1 | -1) => void;
  onOriginal: () => void;
  onArticle: (id: number) => void;
  onBack: () => void;
  // Closes the pane: the compact tier's Back, where the pane covers the list (#140).
  onClose: () => void;
}) {
  const width = useReadingPaneWidth();
  const storyLoad = {path: storyPath(storyId), ...useResource<StoryOut>(storyPath(storyId))};
  const story = storyLoad.data?.id === storyId ? storyLoad.data : undefined;
  const articleLoad = {path: articleId ? articlePath(articleId) : null, ...useResource<ArticleOut>(articleId ? articlePath(articleId) : null)};
  const articleData = articleLoad.data;
  const article = articleId !== null && articleData?.id === articleId ? articleData : undefined;
  const style = {'--readingPane': `${width}px`} as CSSProperties;
  const failed = useLoadFailed([storyLoad]);
  const arrived = useArrival(story !== undefined, storyId);

  if (articleId !== null) {
    return (
      <section className="pane" aria-label="Article" style={style}>
        <PaneEdge width={width} />
        <div className="rd-tools">
          <button className="tool" type="button" onClick={onBack}><Icon name="arrow_back" />Back to story<span className="kbd">Esc</span></button>
          <span className="grow" />
          {article && <button className="tool" type="button" data-hint="o" onClick={onOriginal}><Icon name="open_in_new" />Open at {article.outlet}<span className="kbd">O</span></button>}
        </div>
        <div className="rd-scroll">
          {article ? <Article key={article.id} article={article} story={story} now={now} timeZone={timeZone} onArticle={onArticle} onOriginal={onOriginal} /> : (
            // Its head from the story's own line for it while the article loads (news-05, #232).
            <ArticleLoading key={articleId} source={story?.sources.find(source => source.article_id === articleId)} load={articleLoad} now={now} timeZone={timeZone} />
          )}
        </div>
      </section>
    );
  }

  const lead = story?.lead ?? row?.lead;
  // What the pane draws its head from: the story, else its row from the list.
  const shown: StoryRowOut | undefined = story ?? (row?.id === storyId ? row : undefined);
  const fresh = story && lookedAt ? factsSince(story.facts, lookedAt) : [];
  return (
    <section className="pane" aria-label="Story" style={style}>
      <PaneEdge width={width} />
      <div className="rd-tools">
        <button className="ibtn rd-back" type="button" aria-label="Back to the list" title="Back · Esc" onClick={onClose}><Icon name="arrow_back" /></button>
        {lead && <button className="tool" type="button" data-hint="o" onClick={onOriginal}><Icon name="open_in_new" />Open at {lead.outlet}<span className="kbd">O</span></button>}
        <span className="grow" />
        <button className="ibtn" type="button" aria-label="Previous story" disabled={!canStep.previous} onClick={() => onStep(-1)}><Icon name="keyboard_arrow_up" /></button>
        <button className="ibtn" type="button" aria-label="Next story" disabled={!canStep.next} onClick={() => onStep(1)}><Icon name="keyboard_arrow_down" /></button>
      </div>
      <div className="rd-scroll">
        {/* The head from the story's row at once; its summary and sources wait for the story (news-05, #232). */}
        {shown && (
          <div className="st-swap" key={storyId}>
            <div className="st-head">
              <div className="st-secs">
                {shown.sections.map(section => <span key={section} className="tag"><Icon name={SECTION_GLYPHS[section]} size={14} />{SECTION_LABELS[section]}</span>)}
                {fresh.length > 0 && <span className="tag accent">Updated</span>}
              </div>
              <h1 className="rd-subj">{shown.headline}</h1>
              <div className="st-meta">{storyMeta(story ?? {...shown, outlets: shown.lead.more + 1}, now, timeZone).map((part, index) => <Fragment key={part}>{index > 0 && <span>·</span>}<span>{part}</span></Fragment>)}</div>
            </div>
            {shown.image?.large && (
              <div className="st-img">
                <NewsImage key={shown.image.large.url} src={shown.image.large.url} blurred={row?.image?.thumb.url} />
                <span className="cap">{shown.image.outlet}</span>
              </div>
            )}
            {!story ? <div className="st-body">{failed ? <LoadFailed what="this story" loads={[storyLoad]} /> : <StoryBodySkeleton />}</div> : (
            <div className={arrived ? 'st-body sk-arrive' : 'st-body'}>
              {lookedAt && fresh.length > 0 && <NewSince key={story.id} facts={fresh} lookedAt={lookedAt} now={now} timeZone={timeZone} />}
              {story.summary && <p className="st-sum">{story.summary}</p>}
              {story.sources.length > 0 && (
                <>
                  <div className="st-label">Sources <span className="n">{story.sources.length}</span></div>
                  <Sources sources={story.sources} now={now} timeZone={timeZone} onArticle={onArticle} />
                </>
              )}
            </div>
            )}
          </div>
        )}
        {!shown && <div className="st-body">{failed ? <LoadFailed what="this story" loads={[storyLoad]} /> : <StoryBodySkeleton />}</div>}
      </div>
    </section>
  );
}

/**
 * New since you looked: the newest four facts, then "6 more" folding the rest away, so the story's
 * summary stays in view (the polish audit's news-12); a click opens the fold, the card growing over
 * 180 ms, and its chevron turns. Five facts or fewer all show.
 */
function NewSince({facts, lookedAt, now, timeZone}: {facts: StoryOut['facts']; lookedAt: string; now: number; timeZone: string}) {
  const [open, setOpen] = useState(false);
  const {shown, folded} = foldFacts(facts);
  const line = (fact: StoryOut['facts'][number]) => (
    <div className="it" key={`${fact.at}:${fact.text}`}><span className="t" title={fullTimestamp(fact.at, timeZone)}>{dayWord(fact.at, now, timeZone)}</span><span>{fact.text}</span></div>
  );
  return (
    <div className="st-new">
      <div className="lab">New since you looked · {stamp(lookedAt, now, timeZone)}</div>
      {shown.map(line)}
      {folded.length > 0 && (
        <>
          <div className={open ? 'st-more open' : 'st-more'} inert={!open}><div className="in">{folded.map(line)}</div></div>
          <button className="st-fold" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
            {foldLine(folded.length, open)}<Icon name={open ? 'expand_less' : 'expand_more'} size={16} />
          </button>
        </>
      )}
    </div>
  );
}

function Sources({sources, now, timeZone, onArticle}: {sources: StorySourceOut[]; now: number; timeZone: string; onArticle: (id: number) => void}) {
  return (
    <div className="src-list">
      {sources.map(source => (
        <button key={source.article_id} className="src-row" type="button" data-article={source.article_id} onClick={() => onArticle(source.article_id)}
          onContextMenu={event => openContextMenu(event, event.currentTarget, [
            {id: 'open', label: 'Open here', icon: 'newspaper', run: () => onArticle(source.article_id)},
            {id: 'original', label: `Open at ${source.outlet}`, icon: 'open_in_new', run: () => window.open(source.url, '_blank', 'noopener')},
            {id: 'copy-link', group: 'copy', label: 'Copy link', icon: 'content_copy', run: () => copyText(source.url, `${source.outlet}'s link`)},
          ])}>
          <span className="fav">{initials(source.outlet)}</span>
          <span className="lines">
            <span className="o">{source.outlet}{source.summary_only && <span className="tag">Summary only</span>}</span>
            <span className="h">{source.headline}</span>
          </span>
          <span className="a" title={fullTimestamp(source.published_at, timeZone)}>{age(source.published_at, now, timeZone)}</span>
          <span className="chev"><Icon name="chevron_right" /></span>
        </button>
      ))}
    </div>
  );
}

function Article({article, story, now, timeZone, onArticle, onOriginal}: {
  article: ArticleOut;
  story: StoryOut | undefined;
  now: number;
  timeZone: string;
  onArticle: (id: number) => void;
  onOriginal: () => void;
}) {
  const note = articleNote(article);
  const others = story?.sources.filter(source => source.article_id !== article.id) ?? [];
  return (
    <div className="st-swap">
      <div className="ar-head">
        <div className="ar-out">
          <span className="fav">{initials(article.outlet)}</span>
          <span className="name">{article.outlet}</span>
          <span className="ink3">·</span>
          <span className="num" title={fullTimestamp(article.published_at, timeZone)}>{readerTime(article.published_at, now, timeZone)}</span>
          {article.byline && <><span className="ink3">·</span><span>{article.byline}</span></>}
        </div>
        <h1 className="ar-title">{article.headline}</h1>
      </div>
      {article.image && !note && (
        <div className="st-img article">
          <NewsImage key={article.image.url} src={article.image.url} />
          <span className="cap">{article.outlet}</span>
        </div>
      )}
      <div className="ar-body">
        {note && (
          <div className="ar-note">
            <Icon name="info" size={16} />
            <span className="grow">{note}</span>
            <button className="btn sm" type="button" onClick={onOriginal}><Icon name="open_in_new" size={16} />Read at {article.outlet}</button>
          </div>
        )}
        {(article.text ?? article.feed_summary) && (
          <div className="ar-text">
            {paragraphs(article.text ?? article.feed_summary ?? '').map((lines, index) => <p key={index}>{lines.join(' ')}</p>)}
          </div>
        )}
        {note && others.length > 0 && (
          <>
            <div className="st-label">Also in this story</div>
            <Sources sources={others} now={now} timeZone={timeZone} onArticle={onArticle} />
          </>
        )}
      </div>
    </div>
  );
}

/** An article on its way: its outlet, time and headline from the story's sources, then its text's skeleton, or why it didn't load. */
function ArticleLoading({source, load, now, timeZone}: {source: StorySourceOut | undefined; load: Load; now: number; timeZone: string}) {
  const failed = useLoadFailed([load]);
  return (
    <div className="st-swap">
      {source && (
        <div className="ar-head">
          <div className="ar-out">
            <span className="fav">{initials(source.outlet)}</span>
            <span className="name">{source.outlet}</span>
            <span className="ink3">·</span>
            <span className="num" title={fullTimestamp(source.published_at, timeZone)}>{readerTime(source.published_at, now, timeZone)}</span>
          </div>
          <h1 className="ar-title">{source.headline}</h1>
        </div>
      )}
      <div className="ar-body">{failed ? <LoadFailed what="this article" loads={[load]} /> : <BodySkeleton />}</div>
    </div>
  );
}
