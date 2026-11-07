// The recap's story panel (SV-219, D466 as amended, DESIGN.md #332): a story of While you were away
// opened from News's pane, over the list's column, so the pane and its recap stay in view beside it.
// It grows out of the row clicked, from that row's box to the column's over 260 ms, and shrinks back
// into it as it closes. Its head says where it is in the recap ("3 of 8"), with Open at its outlet
// `O`, previous and next, and ×; the pane marks the open story's row. J / K or ← → step through the
// recap, and a click on another of its rows switches to that story in place. A source opens its article
// in the panel. Esc goes from an article back to its story, then closes it, as × and a click anywhere
// else do. No scrim: the pane stays live. While it's open the page's own keys are held.
//
// In a narrow window the pane covers the list, so the panel has no column: it opens as a modal in
// Settings's frame instead, over a scrim.
//
// Opening a story sees it (D87), so its row in the pane turns `ink2`. Not in the address bar, as
// Settings isn't.
import type {ArticleOut, StoryOut, StoryRowOut} from '@setpoint/shared';
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {CSSProperties} from 'react';
import {getCached, useResource} from '../../api/client.ts';
import {articlePath, openStory, storyPath} from '../../api/news.ts';
import {lookedAt} from '../../logic/news.ts';
import {motion} from '../../tokens.ts';
import {Icon} from '../../ui/Icon.tsx';
import {echoKey} from '../../ui/keys.ts';
import {useFocusReturn} from '../../ui/focusReturn.ts';
import {useCompact} from '../Phone.tsx';
import {toastFailure} from '../toast.ts';
import {ArticleContent, StoryContent} from './StoryPane.tsx';

/** The page's CSS zoom: a box is read zoomed, and placed in unzoomed pixels. */
const zoom = () => (document.documentElement as HTMLElement & {currentCSSZoom?: number}).currentCSSZoom || 1;

/** The pane's recap row a story opened from, which the panel grows out of and shrinks back into. */
const rowOf = (id: number) => document.querySelector<HTMLElement>(`.news-day .nd-row[data-story="${id}"]`);

/** The transform that puts the panel over a row's box, read with nothing playing on the panel (an animation moves its box). */
function overRow(panel: HTMLElement, id: number): string | null {
  panel.getAnimations().forEach(animation => animation.cancel());
  const row = rowOf(id)?.getBoundingClientRect();
  const box = panel.getBoundingClientRect();
  if (!row || !box.width || !box.height) return null;
  const z = zoom();
  return `translate(${(row.left - box.left) / z}px, ${(row.top - box.top) / z}px) scale(${row.width / box.width}, ${row.height / box.height})`;
}

const PANEL_INSET = 8;

/** The list's column, which the panel covers on a desktop. */
function listBox(): CSSProperties | undefined {
  const box = document.querySelector('.nw-list')?.getBoundingClientRect();
  // A little inside it, so its corners and shadow read as a panel over the list.
  const z = zoom();
  return box && {left: box.left / z + PANEL_INSET, top: box.top / z + PANEL_INSET, width: box.width / z - 2 * PANEL_INSET, height: box.height / z - 2 * PANEL_INSET};
}

/** The list's column as it stands, following the window and the pane's edge. */
function useListBox(on: boolean): CSSProperties | undefined {
  const [box, setBox] = useState(() => (on ? listBox() : undefined));
  useEffect(() => {
    const list = document.querySelector('.nw-list');
    if (!on || !list) return;
    const observer = new ResizeObserver(() => setBox(listBox()));
    observer.observe(list);
    return () => observer.disconnect();
  }, [on]);
  return on ? box : undefined;
}

const still = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function RecapPanel({ids, at, closing, rows, now, zone, onAt, onSeen, onClose}: {
  ids: readonly number[];
  at: number;
  // Shrinking back into its row (app/hold.ts holds it drawn meanwhile).
  closing: boolean;
  rows: ReadonlyMap<number, StoryRowOut>;
  now: number;
  zone: string;
  onAt: (index: number) => void;
  // A story opened here, as it stood before it was seen, for the visit's dots.
  onSeen: (before: StoryOut) => void;
  onClose: () => void;
}) {
  const compact = useCompact();
  const panel = useRef<HTMLDivElement>(null);
  const box = useListBox(!compact);
  const storyId = ids[at]!;
  const row = rows.get(storyId);
  // An article opened from the story's Sources, kept with its story so a step leaves it.
  const [opened, setOpened] = useState<{story: number; article: number} | null>(null);
  const article = opened?.story === storyId ? opened.article : null;
  const setArticle = (id: number | null) => setOpened(id === null ? null : {story: storyId, article: id});
  // The story as it stood before it was seen, for "New since you looked".
  const [before, setBefore] = useState<StoryOut | null>(null);
  const {data: story} = useResource<StoryOut>(storyPath(storyId));
  const lead = (story?.id === storyId ? story.lead : null) ?? row?.lead;

  useFocusReturn();
  // It grows out of its row as it opens; a step or a switch swaps its content in place.
  useLayoutEffect(() => {
    const element = panel.current;
    if (!element) return;
    element.focus({preventScroll: true});
    const from = compact || still() ? null : overRow(element, storyId);
    if (from) element.animate([{transform: from, opacity: 0.4}, {transform: 'none', opacity: 1}], {duration: motion.slow, easing: motion.ease});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // And shrinks back into the row it shows as it closes.
  useLayoutEffect(() => {
    const element = panel.current;
    if (!closing || !element) return;
    const to = compact || still() ? null : overRow(element, storyId);
    element.animate(to ? [{transform: 'none', opacity: 1}, {transform: to, opacity: 0}] : [{opacity: 1}, {opacity: 0}], {duration: motion.slow, easing: motion.ease, fill: 'forwards'});
  }, [closing, compact, storyId]);

  useEffect(() => {
    let live = true;
    void openStory(storyId, toastFailure('Couldn\'t mark it seen')).then(seen => {
      if (!live || !seen) return;
      setBefore(seen);
      onSeen(seen);
    });
    return () => {
      live = false;
    };
    // onSeen is the page's, new each render; the story is what opens it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyId]);

  const step = (delta: 1 | -1) => {
    const next = at + delta;
    if (next >= 0 && next < ids.length) onAt(next);
  };
  function openOriginal() {
    const url = article !== null ? getCached<ArticleOut>(articlePath(article))?.url : lead?.url;
    if (url) window.open(url, '_blank', 'noopener');
  }

  // Its keys, wherever focus is (a click on a recap row leaves it there); the page's own wait meanwhile.
  const keys = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keys.current = event => {
      if ((event.metaKey || event.ctrlKey) && ['k', ','].includes(event.key.toLowerCase())) return;
      const target = event.target as HTMLElement;
      if (event.defaultPrevented || target.closest?.('input, textarea, [contenteditable], .settings')) return;
      event.stopPropagation();
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const run = (action: () => void) => {
        event.preventDefault();
        action();
      };
      const key = event.key.toLowerCase();
      if (key === 'escape') run(() => (article !== null ? setArticle(null) : onClose()));
      else if (key === 'j' || key === 'arrowright') run(() => step(1));
      else if (key === 'k' || key === 'arrowleft') run(() => step(-1));
      else if (key === 'o') {
        echoKey('o');
        run(openOriginal);
      }
    };
  });
  // A click outside it closes it, but on another recap row, which switches the story, or on what floats over the page.
  useEffect(() => {
    if (closing) return;
    const onKey = (event: KeyboardEvent) => keys.current(event);
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Element;
      if (panel.current?.contains(target) || target.closest('.news-day .nd-row, .pop, .toast, .settings, .settings-scrim')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointer, true);
    };
  }, [closing, onClose]);

  const looked = before?.id === storyId ? lookedAt(before) : null;
  return (
    <>
      {compact && <div className="nw-modal-scrim" />}
      <div className={compact ? 'nw-modal' : 'nw-modal nw-panel'} ref={panel} role="dialog" aria-modal={compact} aria-label="While you were away" tabIndex={-1} inert={closing} style={box}>
        <div className="rd-tools">
          {article !== null
            ? <button className="tool" type="button" onClick={() => setArticle(null)}><Icon name="arrow_back" />Back to story<span className="kbd">Esc</span></button>
            : <span className="nw-modal-at num">{at + 1} of {ids.length}</span>}
          {lead && <button className="tool" type="button" data-hint="o" onClick={openOriginal}><Icon name="open_in_new" />Open at {lead.outlet}<span className="kbd">O</span></button>}
          <span className="grow" />
          <button className="ibtn" type="button" aria-label="Previous story" data-tip="Previous · K" disabled={at === 0} onClick={() => step(-1)}><Icon name="chevron_left" /></button>
          <button className="ibtn" type="button" aria-label="Next story" data-tip="Next · J" disabled={at === ids.length - 1} onClick={() => step(1)}><Icon name="chevron_right" /></button>
          <button className="ibtn" type="button" aria-label="Close" data-tip="Close · Esc" onClick={onClose}><Icon name="close" /></button>
        </div>
        <div className="rd-scroll">
          {article !== null
            ? <ArticleContent storyId={storyId} articleId={article} now={now} timeZone={zone} onArticle={setArticle} onOriginal={openOriginal} />
            : <StoryContent storyId={storyId} row={row} lookedAt={looked} now={now} timeZone={zone} onArticle={setArticle} />}
        </div>
      </div>
    </>
  );
}
