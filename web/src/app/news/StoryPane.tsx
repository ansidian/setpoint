// The story pane (DESIGN.md › The story pane; boards 25, 26a, 26b): where the reading pane sits, and
// as wide. A story shows Open at its leading outlet `O`, previous and next; its sections as tags
// (and Updated when it changed since the user last looked); the headline and meta; its image with the
// outlet's caption; "New since you looked" on an updated story; the summary; then its Sources, each
// opening its article in the same pane. An article shows Back to story `Esc` and Open at its outlet
// `O`, its head, image and extracted text; one whose page can't be read here (board 26b) shows its
// feed summary under a note with Read at, then Also in this story.
import type {ArticleOut, StoryOut, StoryRowOut, StorySourceOut} from '@setpoint/shared';
import {Fragment} from 'react';
import type {CSSProperties} from 'react';
import {useResource} from '../../api/client.ts';
import {articlePath, storyPath} from '../../api/news.ts';
import {paragraphs} from '../../logic/body.ts';
import {age, fullTimestamp, readerTime} from '../../logic/format.ts';
import {articleNote, dayWord, factsSince, initials, SECTION_GLYPHS, SECTION_LABELS, stamp, storyMeta} from '../../logic/news.ts';
import {Icon} from '../../ui/Icon.tsx';
import {useReadingPaneWidth} from '../readingPane.ts';
import {PaneEdge} from '../Reader.tsx';

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
  // Closes the pane: the compact tier's Back, where the pane covers the list (#258).
  onClose: () => void;
}) {
  const width = useReadingPaneWidth();
  const {data} = useResource<StoryOut>(storyPath(storyId));
  const story = data?.id === storyId ? data : undefined;
  const {data: articleData} = useResource<ArticleOut>(articleId ? articlePath(articleId) : null);
  const article = articleId !== null && articleData?.id === articleId ? articleData : undefined;
  const style = {'--readingPane': `${width}px`} as CSSProperties;

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
          {article && <Article key={article.id} article={article} story={story} now={now} timeZone={timeZone} onArticle={onArticle} onOriginal={onOriginal} />}
        </div>
      </section>
    );
  }

  const lead = story?.lead ?? row?.lead;
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
        {story && (
          <>
            <div className="st-head">
              <div className="st-secs">
                {story.sections.map(section => <span key={section} className="tag"><Icon name={SECTION_GLYPHS[section]} size={14} />{SECTION_LABELS[section]}</span>)}
                {fresh.length > 0 && <span className="tag accent">Updated</span>}
              </div>
              <h1 className="rd-subj">{story.headline}</h1>
              <div className="st-meta">{storyMeta(story, now, timeZone).map((part, index) => <Fragment key={part}>{index > 0 && <span>·</span>}<span>{part}</span></Fragment>)}</div>
            </div>
            {story.image?.large && (
              <div className="st-img">
                <img className="nw-img" src={story.image.large.url} alt="" />
                <span className="cap">{story.image.outlet}</span>
              </div>
            )}
            <div className="st-body">
              {lookedAt && fresh.length > 0 && (
                <div className="st-new">
                  <div className="lab">New since you looked · {stamp(lookedAt, now, timeZone)}</div>
                  {fresh.map(fact => (
                    <div className="it" key={`${fact.at}:${fact.text}`}><span className="t" title={fullTimestamp(fact.at, timeZone)}>{dayWord(fact.at, now, timeZone)}</span><span>{fact.text}</span></div>
                  ))}
                </div>
              )}
              {story.summary && <p className="st-sum">{story.summary}</p>}
              {story.sources.length > 0 && (
                <>
                  <div className="st-label">Sources <span className="n">{story.sources.length}</span></div>
                  <Sources sources={story.sources} now={now} timeZone={timeZone} onArticle={onArticle} />
                </>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Sources({sources, now, timeZone, onArticle}: {sources: StorySourceOut[]; now: number; timeZone: string; onArticle: (id: number) => void}) {
  return (
    <div className="src-list">
      {sources.map(source => (
        <button key={source.article_id} className="src-row" type="button" data-article={source.article_id} onClick={() => onArticle(source.article_id)}>
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
    <>
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
          <img className="nw-img" src={article.image.url} alt="" />
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
    </>
  );
}
