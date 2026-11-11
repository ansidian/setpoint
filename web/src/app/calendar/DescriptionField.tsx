// The editor's Description field (DESIGN.md › Editor; SV-264, D546, D547): the browser's editable
// field under a small bar of formats, with no library. What's in it is only ever read through
// logic/description.ts's reader, so whatever is typed, pasted or dropped comes out as the short list
// of formats and nothing else; a paste goes in already read that way. An event has underline, a
// task doesn't (Markdown has none).
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import type {ClipboardEvent, KeyboardEvent} from 'react';
import {fitting, isEmpty, readHtml, safeHref, writeHtml} from '../../logic/description.ts';
import type {Block, List, Run} from '../../logic/description.ts';
import {Icon} from '../../ui/Icon.tsx';
import type {IconName} from '../../ui/glyphs.ts';
import './description.css';

const TAGS = {code: 'code', strike: 's', underline: 'u', italic: 'i', bold: 'b'} as const;

function runNodes(runs: Run[]): Node[] {
  return runs.map(run => {
    let node: Node = document.createTextNode(run.text);
    for (const mark of ['code', 'strike', 'underline', 'italic', 'bold'] as const) {
      if (!run.marks.includes(mark)) continue;
      const element = document.createElement(TAGS[mark]);
      element.append(node);
      node = element;
    }
    const href = safeHref(run.href);
    if (href) {
      const link = document.createElement('a');
      link.href = href;
      link.append(node);
      node = link;
    }
    return node;
  });
}

/** The description as the field's own nodes: a line a <div>, as the browser makes them while typing. */
function mount(field: HTMLElement, blocks: Block[]) {
  const element = (tag: string, children: Node[]) => {
    const made = document.createElement(tag);
    made.append(...children);
    return made;
  };
  // A nested list inside its item, as Google writes one.
  const list = (of: List): Node => element(of.ordered ? 'ol' : 'ul', of.items.map(item => element('li', [...runNodes(item.runs), ...(item.sub ? [list(item.sub)] : [])])));
  field.replaceChildren(...blocks.map(block => {
    switch (block.type) {
      case 'paragraph': return element('div', block.runs.length ? runNodes(block.runs) : [document.createElement('br')]);
      case 'heading': return element(`h${Math.min(6, Math.max(1, block.level))}`, runNodes(block.runs));
      case 'quote': return element('blockquote', runNodes(block.runs));
      case 'code': return element('pre', [document.createTextNode(block.text)]);
      case 'list': return list(block);
    }
  }));
}

type Format = 'bold' | 'italic' | 'underline' | 'insertOrderedList' | 'insertUnorderedList';
const FORMATS: {command: Format; label: string; icon: IconName; keys?: string}[] = [
  {command: 'bold', label: 'Bold', icon: 'format_bold', keys: '⌘B'},
  {command: 'italic', label: 'Italic', icon: 'format_italic', keys: '⌘I'},
  {command: 'underline', label: 'Underline', icon: 'format_underlined', keys: '⌘U'},
  {command: 'insertOrderedList', label: 'Numbered list', icon: 'format_list_numbered'},
  {command: 'insertUnorderedList', label: 'Bulleted list', icon: 'format_list_bulleted'},
];

/** A typed address as a link: its own scheme when it's one Setpoint opens, else https. */
export function linkTarget(typed: string): string | null {
  const text = typed.trim();
  if (!text) return null;
  return safeHref(text) ?? (/^[^\s:/]+\.[^\s:/]{2,}(\/\S*)?$/.test(text) ? safeHref(`https://${text}`) : null);
}

export interface DescriptionFieldProps {
  // What it opens with; after that the field holds its own text and says what it reads as.
  blocks: Block[];
  kind: 'event' | 'task';
  // Under the field once it's changed, when its source held formatting the list can't (D547).
  note: string | null;
  onChange: (blocks: Block[]) => void;
}

export function DescriptionField({blocks, kind, note, onChange}: DescriptionFieldProps) {
  const field = useRef<HTMLDivElement>(null);
  const address = useRef<HTMLInputElement>(null);
  const [empty, setEmpty] = useState(() => isEmpty(blocks));
  const [focused, setFocused] = useState(false);
  const [on, setOn] = useState<Format[]>([]);
  // The link being set: the selection it's for, kept while the address is typed.
  const [linking, setLinking] = useState<{range: Range | null; url: string} | null>(null);
  const formats = FORMATS.filter(format => kind === 'event' || format.command !== 'underline');

  useLayoutEffect(() => {
    if (field.current) mount(field.current, blocks);
    // Mounted once: from then on the field's text is the user's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const read = () => {
    const now = readHtml(field.current!.innerHTML, {literal: true}).blocks;
    setEmpty(isEmpty(now));
    onChange(now);
  };
  const inField = (node: Node | null | undefined) => !!node && !!field.current?.contains(node);
  const mark = () => {
    const selection = document.getSelection();
    if (!inField(selection?.anchorNode)) return;
    setOn(FORMATS.filter(format => document.queryCommandState(format.command)).map(format => format.command));
  };
  useEffect(() => {
    document.addEventListener('selectionchange', mark);
    return () => document.removeEventListener('selectionchange', mark);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The browser's own editing commands: old, and the one way every browser formats a selection in
  // an editable field without a library.
  const run = (command: string, value?: string) => {
    field.current!.focus();
    document.execCommand('styleWithCSS', false, 'false');
    document.execCommand(command, false, value);
    read();
    mark();
  };
  const linkAround = (node: Node | null | undefined): HTMLAnchorElement | null => {
    for (let at = node ?? null; at && at !== field.current; at = at.parentNode) if (at instanceof HTMLAnchorElement) return at;
    return null;
  };
  const startLink = () => {
    const selection = document.getSelection();
    const range = selection && selection.rangeCount && inField(selection.anchorNode) ? selection.getRangeAt(0).cloneRange() : null;
    setLinking({range, url: linkAround(selection?.anchorNode)?.getAttribute('href') ?? ''});
  };
  useEffect(() => {
    if (linking) address.current?.focus();
    // Focused when it opens, not on each letter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linking !== null]);
  const endLink = (apply: boolean) => {
    const {range, url} = linking!;
    setLinking(null);
    field.current!.focus();
    const selection = document.getSelection();
    if (range && selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
    if (!apply) return;
    const target = linkTarget(url);
    if (!url.trim()) run('unlink');
    else if (!target) return;
    else if (selection?.isCollapsed && !linkAround(selection.anchorNode)) run('insertHTML', writeHtml([{type: 'paragraph', runs: [{text: url.trim(), marks: [], href: target}]}]));
    else run('createLink', target);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const command = event.metaKey || event.ctrlKey;
    // A task has no underline to keep.
    if (command && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'u' && kind === 'task') event.preventDefault();
  };
  // A paste goes in as the reader takes it and as this item's provider writes: nothing else of the page it came from.
  const onPaste = (event: ClipboardEvent) => {
    event.preventDefault();
    const html = event.clipboardData.getData('text/html');
    if (!html) {
      run('insertText', event.clipboardData.getData('text/plain'));
      return;
    }
    run('insertHTML', writeHtml(fitting(kind, readHtml(html).blocks)));
  };

  return (
    <div className={`desc-field${focused ? ' focus' : ''}`}
      onFocus={() => setFocused(true)}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}>
      <div ref={field} className="desc desc-edit" contentEditable role="textbox" aria-multiline="true" aria-label="Description" data-placeholder="Add description" data-empty={empty || undefined}
        suppressContentEditableWarning spellCheck onInput={read} onKeyDown={onKeyDown} onPaste={onPaste} onDrop={event => event.preventDefault()} />
      {(focused || linking) && (linking ? (
        <div className="desc-bar linking">
          <Icon name="link" size={16} />
          <input ref={address} className="grow" aria-label="Link address" placeholder="Paste or type a link" value={linking.url} onChange={event => setLinking({...linking, url: event.target.value})}
            onKeyDown={event => {
              if (event.key !== 'Enter' && event.key !== 'Escape') return;
              // The editor's own Enter and Esc are for the item, not this address.
              event.preventDefault();
              event.stopPropagation();
              endLink(event.key === 'Enter');
            }} />
          <button type="button" className="btn quiet sm" disabled={linking.url.trim() !== '' && !linkTarget(linking.url)} onClick={() => endLink(true)}>{linking.url.trim() ? 'Link' : 'Remove'}</button>
        </div>
      ) : (
        <div className="desc-bar" role="toolbar" aria-label="Formatting">
          {formats.map(format => (
            <button key={format.command} type="button" className="ibtn sm" aria-label={format.label} aria-pressed={on.includes(format.command)} data-tip={format.keys ? `${format.label} · ${format.keys}` : format.label}
              onMouseDown={event => event.preventDefault()} onClick={() => run(format.command)}><Icon name={format.icon} size={17} /></button>
          ))}
          <button type="button" className="ibtn sm" aria-label="Link" data-tip="Link" onMouseDown={event => event.preventDefault()} onClick={startLink}><Icon name="link" size={17} /></button>
        </div>
      ))}
      {note && <div className="desc-note ink3">{note}</div>}
    </div>
  );
}
