// An item's description (SV-264, D547). Each provider keeps its own format, a Google event HTML
// and a Todoist task Markdown, and Setpoint stores what it was given. Here both are read into one
// short list of formats, which is all the screen ever draws (as elements, never as the provider's
// markup, so nothing in a description can run or load anything), and written back in the shapes the
// providers' own editors write (read from a real event and task, 2026-11-10):
//   Google   <b>, <i>, <u>, lines ended by <br> with no paragraphs, <ol><li>, <ul><li>, <a href>
//   Todoist  **bold**, *italic*, "1." and "-" lists with a blank line around them, single newlines
//            between lines, [text](url)
// Pure: no DOM, so the same reader takes the editor's own markup (`literal`).

export type Mark = 'bold' | 'italic' | 'underline' | 'strike' | 'code';
const MARKS: Mark[] = ['bold', 'italic', 'underline', 'strike', 'code'];

/** A stretch of text with one set of formats; `href` makes it a link. */
export interface Run {
  text: string;
  marks: Mark[];
  href: string | null;
}

/** A paragraph is one line; an empty one is a blank line. */
export type Block =
  | {type: 'paragraph'; runs: Run[]}
  | {type: 'heading'; level: number; runs: Run[]}
  | {type: 'quote'; runs: Run[]}
  | {type: 'code'; text: string}
  | {type: 'list'; ordered: boolean; items: Run[][]};

export interface Description {
  blocks: Block[];
  // The source held formatting this list can't (a table, an image, colours): shown as its text, and
  // gone from the provider's copy if the description is saved from here.
  lossy: boolean;
}

export type DescriptionFormat = 'html' | 'markdown';
/** An event's description is Google's HTML, a task's Todoist's Markdown. */
export const formatOf = (kind: 'event' | 'task'): DescriptionFormat => (kind === 'event' ? 'html' : 'markdown');

/** A link the screen may open: the web, mail or a phone number, never a script or a file. */
export function safeHref(url: string | null | undefined): string | null {
  const trimmed = url?.trim() ?? '';
  return /^(https?:\/\/|mailto:|tel:)/i.test(trimmed) ? trimmed : null;
}

const sameMarks = (a: Run, b: Run) => a.href === b.href && a.marks.length === b.marks.length && a.marks.every(mark => b.marks.includes(mark));

function tidyRuns(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const next = {text: run.text, marks: MARKS.filter(mark => run.marks.includes(mark)), href: run.href};
    const last = out.at(-1);
    if (last && sameMarks(last, next)) last.text += next.text;
    else out.push(next);
  }
  return out;
}

const isBlank = (block: Block) => block.type === 'paragraph' && block.runs.length === 0;

/** The same description in one form: runs merged, empty ones dropped, no blank lines at either end. */
export function tidy(blocks: Block[]): Block[] {
  const out: Block[] = [];
  for (const block of blocks) {
    if (block.type === 'list') {
      const items = block.items.map(tidyRuns).filter(item => item.length);
      if (items.length) out.push({type: 'list', ordered: block.ordered, items});
    } else if (block.type === 'code') {
      if (block.text.trim()) out.push(block);
    } else {
      out.push({...block, runs: tidyRuns(block.runs)});
    }
  }
  while (out.length && isBlank(out[0]!)) out.shift();
  while (out.length && isBlank(out.at(-1)!)) out.pop();
  return out;
}

/** Whether two descriptions show the same: what decides if a save sends one (D547). */
export const sameDescription = (a: Block[], b: Block[]) => JSON.stringify(tidy(a)) === JSON.stringify(tidy(b));

export const isEmpty = (blocks: Block[]) => tidy(blocks).length === 0;

/** The description as plain text, a line per line. */
export function plainText(blocks: Block[]): string {
  const text = (runs: Run[]) => runs.map(run => run.text).join('');
  return tidy(blocks).map(block => (block.type === 'list' ? block.items.map(text).join('\n') : block.type === 'code' ? block.text : text(block.runs))).join('\n');
}

// ---- HTML ----

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”',
  bull: '•', middot: '·', copy: '©', reg: '®', trade: '™', deg: '°',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1]!.toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? (code === 0xa0 ? ' ' : String.fromCodePoint(code)) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

interface Tag {
  name: string;
  closing: boolean;
  attributes: string;
  end: number;
}

/** The tag starting at `at` ("<" there), its end found past any quoted attribute; null when it isn't one. */
function tagAt(html: string, at: number): Tag | null {
  // A name, then a space, a slash or the end: "<sam@example.org>" and "<https://…>" are text, as invites write them.
  const open = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)(?=[\s/>])/.exec(html.slice(at, at + 40));
  if (!open) return null;
  let index = at + open[0].length;
  let quote: string | null = null;
  for (; index < html.length; index += 1) {
    const char = html[index]!;
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === '\'') {
      quote = char;
    } else if (char === '>') {
      return {name: open[2]!.toLowerCase(), closing: open[1] === '/', attributes: html.slice(at + open[0].length, index), end: index + 1};
    }
  }
  return null;
}

const attribute = (attributes: string, name: string): string | null => {
  const found = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`, 'i').exec(attributes);
  return found ? decodeEntities(found[1] ?? found[2] ?? found[3] ?? '') : null;
};

const INLINE: Record<string, Mark> = {b: 'bold', strong: 'bold', i: 'italic', em: 'italic', u: 'underline', ins: 'underline', s: 'strike', strike: 'strike', del: 'strike', code: 'code', tt: 'code'};
// Whole elements that are never text.
const SKIPPED = new Set(['script', 'style', 'head', 'title', 'template', 'noscript', 'iframe', 'object', 'svg', 'math', 'select', 'textarea']);
// Wrappers that change nothing on their own.
const PLAIN = new Set(['span', 'html', 'body', 'meta', 'link', 'wbr', 'section', 'article', 'header', 'footer', 'main', 'address', 'label', 'small', 'abbr', 'time', 'nobr']);
const LINE_BREAKING = new Set(['div', 'p', 'section', 'article', 'header', 'footer', 'main', 'address', 'table', 'tr', 'hr', 'dl', 'dt', 'dd', 'center', 'figure', 'figcaption']);
// A <br> alone doesn't count: a line of plain text ended by one still has the others' newlines.
const BLOCKS = /<(p|div|li|ol|ul|table|tr|h[1-6]|blockquote|pre)[\s/>]/i;

/**
 * HTML as a description. `literal` is the editor's own markup, where white space is kept as typed;
 * a provider's keeps its newlines unless it has paragraphs, lists or other blocks of its own (plain
 * text, as an invite's or an .ics file's, with or without a <br>), where white space folds as a
 * browser folds it.
 */
export function readHtml(html: string, {literal = false}: {literal?: boolean} = {}): Description {
  const blocks: Block[] = [];
  let lossy = false;
  let line: Run[] = [];
  const depth: Record<Mark, number> = {bold: 0, italic: 0, underline: 0, strike: 0, code: 0};
  const links: (string | null)[] = [];
  const lists: {ordered: boolean; items: Run[][]}[] = [];
  let nested = 0;
  let context: {type: 'heading'; level: number} | {type: 'quote'} | null = null;
  let pre: string | null = null;
  // A paragraph element just closed: the next line stands apart from it.
  let apart = false;
  const newlines = literal || !BLOCKS.test(html);

  const hasText = () => line.some(run => run.text.trim() !== '');
  const endLine = (force: boolean) => {
    const runs = hasText() ? line : [];
    line = [];
    // White space at a line's end shows as nothing, as a browser drops it; the editor's own stays as typed.
    if (!literal && runs.length) {
      const last = runs.at(-1)!;
      runs[runs.length - 1] = {...last, text: last.text.replace(/\s+$/, '')};
    }
    if (!runs.length && !force) return;
    const list = lists.at(-1);
    if (list) {
      if (runs.length) list.items.push(runs);
      return;
    }
    if (runs.length && apart && blocks.length && !isBlank(blocks.at(-1)!)) blocks.push({type: 'paragraph', runs: []});
    apart = false;
    if (context?.type === 'heading') blocks.push({type: 'heading', level: context.level, runs});
    else if (context?.type === 'quote') blocks.push({type: 'quote', runs});
    else blocks.push({type: 'paragraph', runs});
  };
  const addText = (raw: string) => {
    let text = decodeEntities(raw);
    if (!newlines) {
      text = text.replace(/\s+/g, ' ');
      if (!line.length) text = text.replace(/^ /, '');
    } else if (!literal) {
      text = text.replace(/\r\n?/g, '\n');
    }
    if (!text) return;
    const marks = MARKS.filter(mark => depth[mark] > 0);
    const href = links.findLast(link => link !== null) ?? null;
    const parts = newlines ? text.split('\n') : [text];
    parts.forEach((part, index) => {
      if (index > 0) endLine(true);
      if (part) line.push({text: part, marks, href});
    });
  };

  let at = 0;
  let textFrom = 0;
  const flushText = (to: number) => {
    if (to > textFrom) {
      if (pre !== null) pre += decodeEntities(html.slice(textFrom, to));
      else addText(html.slice(textFrom, to));
    }
  };
  while (at < html.length) {
    if (html[at] !== '<') {
      at += 1;
      continue;
    }
    if (html.startsWith('<!--', at)) {
      flushText(at);
      const close = html.indexOf('-->', at + 4);
      at = close < 0 ? html.length : close + 3;
      textFrom = at;
      continue;
    }
    const tag = tagAt(html, at);
    if (!tag) {
      at += 1;
      continue;
    }
    flushText(at);
    at = tag.end;
    textFrom = at;
    const {name, closing} = tag;
    if (pre !== null) {
      if (name === 'pre' && closing) {
        const text = pre.replace(/^\n/, '').replace(/\n$/, '');
        if (text.trim()) blocks.push({type: 'code', text});
        pre = null;
      } else if (name === 'br') {
        pre += '\n';
      }
      continue;
    }
    if (SKIPPED.has(name)) {
      if (!closing) {
        const close = new RegExp(`</${name}\\s*>`, 'i').exec(html.slice(at));
        at = close ? at + close.index + close[0].length : html.length;
        textFrom = at;
        if (name !== 'head' && name !== 'title' && name !== 'script' && name !== 'style') lossy = true;
      }
      continue;
    }
    if (!closing && /(?:^|\s)(style|color|face|bgcolor|size)\s*=/i.test(tag.attributes)) lossy = true;
    if (name in INLINE) {
      const mark = INLINE[name]!;
      depth[mark] = Math.max(0, depth[mark] + (closing ? -1 : 1));
    } else if (name === 'a') {
      if (closing) links.pop();
      else links.push(safeHref(attribute(tag.attributes, 'href')));
    } else if (name === 'br') {
      endLine(true);
    } else if (name === 'ol' || name === 'ul') {
      endLine(false);
      if (!closing) {
        if (lists.length) {
          nested += 1;
          lossy = true;
        } else {
          lists.push({ordered: name === 'ol', items: []});
        }
      } else if (nested) {
        nested -= 1;
      } else {
        const list = lists.pop();
        if (list?.items.length) blocks.push({type: 'list', ordered: list.ordered, items: list.items});
        apart = false;
      }
    } else if (name === 'li') {
      endLine(false);
    } else if (/^h[1-6]$/.test(name)) {
      endLine(false);
      context = closing ? null : {type: 'heading', level: Number(name[1])};
    } else if (name === 'blockquote') {
      endLine(false);
      context = closing ? null : {type: 'quote'};
    } else if (name === 'pre') {
      endLine(false);
      if (!closing) pre = '';
    } else if (name === 'td' || name === 'th') {
      lossy = true;
      if (closing && hasText()) line.push({text: ' ', marks: [], href: null});
    } else {
      if (LINE_BREAKING.has(name)) {
        endLine(false);
        if (name === 'p' && closing) apart = true;
      }
      if (!PLAIN.has(name) && name !== 'div' && name !== 'p') lossy = true;
    }
  }
  flushText(html.length);
  if (pre !== null && pre.trim()) blocks.push({type: 'code', text: pre});
  endLine(false);
  for (const list of lists) if (list.items.length) blocks.push({type: 'list', ordered: list.ordered, items: list.items});
  return {blocks: tidy(blocks), lossy};
}

const escapeHtml = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const HTML_TAGS: Record<Mark, string> = {bold: 'b', italic: 'i', underline: 'u', strike: 's', code: 'code'};

function runsHtml(runs: Run[]): string {
  return runs.map(run => {
    let html = escapeHtml(run.text);
    for (const mark of [...MARKS].reverse()) if (run.marks.includes(mark)) html = `<${HTML_TAGS[mark]}>${html}</${HTML_TAGS[mark]}>`;
    const href = safeHref(run.href);
    return href ? `<a href="${escapeHtml(href).replace(/"/g, '&quot;')}">${html}</a>` : html;
  }).join('');
}

/** The description as Google Calendar's editor writes one: lines ended by <br>, lists as they are. */
export function writeHtml(blocks: Block[]): string {
  const tidied = tidy(blocks);
  return tidied.map((block, index) => {
    switch (block.type) {
      case 'paragraph': return runsHtml(block.runs) + (index < tidied.length - 1 ? '<br>' : '');
      case 'heading': return `<h${block.level}>${runsHtml(block.runs)}</h${block.level}>`;
      case 'quote': return `<blockquote>${runsHtml(block.runs)}</blockquote>`;
      case 'code': return `<pre>${escapeHtml(block.text)}</pre>`;
      case 'list': {
        const tag = block.ordered ? 'ol' : 'ul';
        return `<${tag}>${block.items.map(item => `<li>${runsHtml(item)}</li>`).join('')}</${tag}>`;
      }
    }
  }).join('');
}

// ---- Markdown ----

const PUNCTUATION = /[!-/:-@[-`{-~]/;
const isWord = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}]/u.test(char);

/** One line's Markdown as runs: bold, italic, strikethrough, code, links; anything unclosed is text. */
export function readInline(text: string, marks: Mark[] = [], href: string | null = null): Run[] {
  const runs: Run[] = [];
  let plain = '';
  const flush = () => {
    if (plain) runs.push({text: plain, marks, href});
    plain = '';
  };
  const adding = (mark: Mark) => MARKS.filter(one => one === mark || marks.includes(one));
  const within = (inner: string, mark: Mark) => readInline(inner, adding(mark), href);
  let at = 0;
  while (at < text.length) {
    const char = text[at]!;
    const rest = text.slice(at);
    if (char === '\\' && at + 1 < text.length && PUNCTUATION.test(text[at + 1]!)) {
      plain += text[at + 1];
      at += 2;
      continue;
    }
    if (char === '`') {
      const close = text.indexOf('`', at + 1);
      if (close > at + 1) {
        flush();
        runs.push({text: text.slice(at + 1, close), marks: adding('code'), href});
        at = close + 1;
        continue;
      }
    }
    const pair = /^(\*\*|__|~~)/.exec(rest)?.[1];
    if (pair && text[at + 2] !== undefined && text[at + 2] !== ' ') {
      let close = text.indexOf(pair, at + 2);
      // Three in a row close an inner italic first: the pair is the last two.
      if (close > 0 && pair !== '~~' && text[close + 2] === pair[0]) close += 1;
      if (close > at + 2 && text[close - 1] !== ' ') {
        flush();
        runs.push(...within(text.slice(at + 2, close), pair === '~~' ? 'strike' : 'bold'));
        at = close + 2;
        continue;
      }
    }
    if ((char === '*' || char === '_') && text[at + 1] !== undefined && text[at + 1] !== ' ' && text[at + 1] !== char && !(char === '_' && isWord(text[at - 1]))) {
      let close = at + 1;
      for (;;) {
        close = text.indexOf(char, close + 1);
        if (close < 0) break;
        // A pair inside ("*a **b** c*") belongs to the inner bold.
        if (text[close + 1] === char) {
          const inner = text.indexOf(char + char, close + 2);
          if (inner < 0) break;
          close = inner + 1;
          continue;
        }
        if (text[close - 1] !== ' ' && text[close - 1] !== '\\' && !(char === '_' && isWord(text[close + 1]))) break;
      }
      if (close > at + 1) {
        flush();
        runs.push(...within(text.slice(at + 1, close), 'italic'));
        at = close + 1;
        continue;
      }
    }
    if (char === '[') {
      const link = linkAt(text, at);
      if (link) {
        flush();
        const target = safeHref(link.url);
        runs.push(...readInline(link.label, marks, target ?? href));
        at = link.end;
        continue;
      }
    }
    if (char === '<') {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]+)>/.exec(rest);
      if (auto) {
        flush();
        runs.push({text: auto[1]!, marks, href: safeHref(auto[1]!) ?? href});
        at += auto[0].length;
        continue;
      }
    }
    plain += char;
    at += 1;
  }
  flush();
  return runs;
}

/** "[label](url)" at `at`, its brackets and parentheses balanced. */
function linkAt(text: string, at: number): {label: string; url: string; end: number} | null {
  let level = 0;
  let close = -1;
  for (let index = at; index < text.length; index += 1) {
    if (text[index] === '\\') index += 1;
    else if (text[index] === '[') level += 1;
    else if (text[index] === ']' && (level -= 1) === 0) {
      close = index;
      break;
    }
  }
  if (close < 0 || text[close + 1] !== '(') return null;
  level = 0;
  for (let index = close + 1; index < text.length; index += 1) {
    if (text[index] === '(') level += 1;
    else if (text[index] === ')' && (level -= 1) === 0) {
      const url = text.slice(close + 2, index).trim().replace(/\s+"[^"]*"$/, '').replace(/^<(.*)>$/, '$1');
      return {label: text.slice(at + 1, close), url, end: index + 1};
    }
  }
  return null;
}

const LIST_ITEM = /^(\s*)(?:([-*+])|(\d{1,9})[.)])\s+(.*)$/;

/** Todoist's Markdown as a description: a line is a line, and the blank line around a list or a code block is only its edge. */
export function readMarkdown(source: string): Description {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let lossy = false;
  const standsAlone = (block: Block | undefined) => block?.type === 'list' || block?.type === 'code';
  let edgeTaken = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (/^\s*```/.test(line)) {
      const body: string[] = [];
      for (index += 1; index < lines.length && !/^\s*```\s*$/.test(lines[index]!); index += 1) body.push(lines[index]!);
      blocks.push({type: 'code', text: body.join('\n')});
      edgeTaken = false;
      continue;
    }
    if (!line.trim()) {
      const next = lines[index + 1];
      const beforeOne = next !== undefined && (LIST_ITEM.test(next) || /^\s*```/.test(next));
      if (standsAlone(blocks.at(-1)) && !edgeTaken) edgeTaken = true;
      else if (!beforeOne) blocks.push({type: 'paragraph', runs: []});
      continue;
    }
    edgeTaken = false;
    const item = LIST_ITEM.exec(line);
    if (item) {
      if (item[1]!.length >= 2) lossy = true;
      const ordered = item[3] !== undefined;
      const last = blocks.at(-1);
      const runs = readInline(item[4]!);
      if (last?.type === 'list' && last.ordered === ordered) last.items.push(runs);
      else blocks.push({type: 'list', ordered, items: [runs]});
      continue;
    }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      blocks.push({type: 'heading', level: heading[1]!.length, runs: readInline(heading[2]!)});
      continue;
    }
    const quote = /^>\s?(.*)$/.exec(line);
    if (quote) {
      blocks.push({type: 'quote', runs: readInline(quote[1]!)});
      continue;
    }
    blocks.push({type: 'paragraph', runs: readInline(line)});
  }
  return {blocks: tidy(blocks), lossy};
}

/** Text with the characters Markdown would read as formatting escaped. An underscore inside a word (a URL's) is left: it formats nothing. */
function escapeMarkdown(text: string): string {
  return text.replace(/[\\*`[\]]|~~|_/g, (found, offset: number) => {
    if (found === '_' && isWord(text[offset - 1]) && isWord(text[offset + 1])) return found;
    return found === '~~' ? '\\~~' : `\\${found}`;
  });
}

function runsMarkdown(runs: Run[]): string {
  const text = runs.map(run => {
    const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(run.text)!;
    if (!core) return run.text;
    let body = run.marks.includes('code') ? `\`${core!.replace(/`/g, '\'')}\`` : escapeMarkdown(core!);
    if (run.marks.includes('strike')) body = `~~${body}~~`;
    if (run.marks.includes('italic')) body = `*${body}*`;
    if (run.marks.includes('bold')) body = `**${body}**`;
    const href = safeHref(run.href);
    if (href) body = `[${body}](${href.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\s/g, '%20')})`;
    return `${lead}${body}${trail}`;
  }).join('');
  // A line that would read as a heading, a quote or a list item says it isn't one.
  return text.replace(/^(\s*)(#{1,6}\s|>|[-+]\s)/, '$1\\$2').replace(/^(\s*\d{1,9})([.)]\s)/, '$1\\$2');
}

/** The description as Todoist's editor writes one. Markdown has no underline: it goes as plain text. */
export function writeMarkdown(blocks: Block[]): string {
  const tidied = tidy(blocks);
  const standsAlone = (block: Block) => block.type === 'list' || block.type === 'code';
  let out = '';
  tidied.forEach((block, index) => {
    if (index > 0) out += standsAlone(block) || standsAlone(tidied[index - 1]!) ? '\n\n' : '\n';
    switch (block.type) {
      case 'paragraph': out += runsMarkdown(block.runs); break;
      case 'heading': out += `${'#'.repeat(block.level)} ${runsMarkdown(block.runs)}`; break;
      case 'quote': out += `> ${runsMarkdown(block.runs)}`; break;
      case 'code': out += `\`\`\`\n${block.text}\n\`\`\``; break;
      case 'list': out += block.items.map((item, at) => `${block.ordered ? `${at + 1}.` : '-'} ${runsMarkdown(item)}`).join('\n'); break;
    }
  });
  return out;
}

// ---- Either ----

/**
 * A description as its provider's own editor would write it, for what's pasted in: an event keeps
 * Google's set (bold, italic, underline, lists, links), the rest as plain lines; a task keeps
 * everything but underline, which Markdown doesn't have.
 */
export function fitting(kind: 'event' | 'task', blocks: Block[]): Block[] {
  const kept: Mark[] = kind === 'event' ? ['bold', 'italic', 'underline'] : ['bold', 'italic', 'strike', 'code'];
  const runs = (list: Run[]) => list.map(one => ({...one, marks: one.marks.filter(mark => kept.includes(mark))}));
  return blocks.flatMap((block): Block[] => {
    if (block.type === 'list') return [{...block, items: block.items.map(runs)}];
    if (block.type === 'code') return kind === 'task' ? [block] : block.text.split('\n').map(line => ({type: 'paragraph', runs: line ? [{text: line, marks: [], href: null}] : []}));
    if (block.type === 'paragraph' || kind === 'task') return [{...block, runs: runs(block.runs)}];
    return [{type: 'paragraph', runs: runs(block.runs)}];
  });
}

const NONE: Description = {blocks: [], lossy: false};

/** A provider's description as the screen draws it. */
export function readDescription(format: DescriptionFormat, source: string | null | undefined): Description {
  if (!source) return NONE;
  return format === 'html' ? readHtml(source) : readMarkdown(source);
}

/** A description for its provider; null when there's nothing in it, which clears it there. */
export function writeDescription(format: DescriptionFormat, blocks: Block[]): string | null {
  if (isEmpty(blocks)) return null;
  return format === 'html' ? writeHtml(blocks) : writeMarkdown(blocks);
}

/** A run's text with its bare web addresses as links, for the screen only: the stored text stays as it was. */
export function withLinks(run: Run): Run[] {
  if (run.href || run.marks.includes('code')) return [run];
  const out: Run[] = [];
  let from = 0;
  for (const found of run.text.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    const url = found[0].replace(/[.,;:!?)\]}'"]+$/, '');
    if (found.index > from) out.push({...run, text: run.text.slice(from, found.index)});
    out.push({...run, text: url, href: safeHref(url)});
    from = found.index + url.length;
  }
  if (from < run.text.length) out.push({...run, text: run.text.slice(from)});
  return out.length ? out : [run];
}
