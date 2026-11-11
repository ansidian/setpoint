// An item's description on screen (DESIGN.md › The floating detail; SV-264, D546, D547): drawn from
// the short list of formats logic/description.ts reads, as elements, never as the provider's own
// markup. Links open in a new tab; a bare web address in the text is one too.
import {useLayoutEffect, useRef, useState} from 'react';
import type {ReactNode} from 'react';
import {withLinks} from '../../logic/description.ts';
import type {Block, Run} from '../../logic/description.ts';
import './description.css';

function Runs({runs}: {runs: Run[]}) {
  return <>{runs.flatMap(withLinks).map((run, index) => {
    let node: ReactNode = run.text;
    if (run.marks.includes('code')) node = <code>{node}</code>;
    if (run.marks.includes('strike')) node = <s>{node}</s>;
    if (run.marks.includes('underline')) node = <u>{node}</u>;
    if (run.marks.includes('italic')) node = <i>{node}</i>;
    if (run.marks.includes('bold')) node = <b>{node}</b>;
    if (run.href) node = <a href={run.href} target="_blank" rel="noopener noreferrer">{node}</a>;
    return <span key={index}>{node}</span>;
  })}</>;
}

/** The description's lines, lists and the rest, formatted. */
export function DescriptionText({blocks}: {blocks: Block[]}) {
  return <>{blocks.map((block, index) => {
    switch (block.type) {
      case 'paragraph': return block.runs.length ? <p key={index}><Runs runs={block.runs} /></p> : <p key={index} className="gap" />;
      case 'heading': return <p key={index} className="head" role="heading" aria-level={block.level}><Runs runs={block.runs} /></p>;
      case 'quote': return <blockquote key={index}><Runs runs={block.runs} /></blockquote>;
      case 'code': return <pre key={index}>{block.text}</pre>;
      case 'list': {
        const items = block.items.map((item, at) => <li key={at}><Runs runs={item} /></li>);
        return block.ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
      }
    }
  })}</>;
}

/**
 * The description in the floating detail (D546): up to 6 lines, then it fades under More, which
 * opens it in place to 320 px and lets it scroll inside from there; Less folds it again.
 *
 * Whether it runs past 6 lines is written to the row itself (`data-long`, which description.css
 * reads to draw the fade and More), not kept as state: a state would draw More one render after the
 * text, after the floating detail's motion has measured the card to place and glide it (SV-267).
 */
export function DescriptionFold({blocks}: {blocks: Block[]}) {
  const row = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const element = text.current;
    if (row.current && element && !open) row.current.toggleAttribute('data-long', element.scrollHeight > element.clientHeight + 1);
  }, [blocks, open]);
  return (
    <div ref={row} className="grow fd-desc-wrap">
      <div ref={text} className={`desc fd-desc${open ? ' open' : ''}`} tabIndex={open ? 0 : undefined} aria-label={open ? 'Description' : undefined}><DescriptionText blocks={blocks} /></div>
      <button type="button" className="btn quiet sm fd-more" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? 'Less' : 'More'}</button>
    </div>
  );
}
