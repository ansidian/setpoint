// SV-264 (D547): a description read from its provider's format into the short list of formats the
// screen draws, and written back as that provider's own editor writes one. The two long fixtures
// are the shapes read from a real Google event and Todoist task (2026-11-10), with invented text.
import {describe, expect, test} from 'vitest';
import {fitting, isEmpty, plainText, readDescription, readHtml, readInline, readMarkdown, safeHref, sameDescription, withLinks, writeDescription, writeHtml, writeMarkdown} from '../src/logic/description.ts';
import type {Block, Item, List, Mark, Run} from '../src/logic/description.ts';

const run = (text: string, marks: Mark[] = [], href: string | null = null): Run => ({text, marks, href});
const p = (...runs: Run[]): Block => ({type: 'paragraph', runs});
const blank = p();
const li = (...runs: Run[]): Item => ({runs});
const under = (item: Item, sub: List): Item => ({...item, sub});

const GOOGLE = '<b>Bring</b> the signed form<br><i>Room 204</i><br><u>Arrive early</u><br><ol><li><i>Check in</i></li><li>Badge</li></ol><ul><li>Laptop</li></ul><br><a href="https://example.com/visit">https://example.com/visit</a><i></i>';
const TODOIST = '**Bring** the signed form\n*Room 204*\nArrive early\n\n1. *Check in*\n2. Badge\n\n- Laptop\n\n\n[https://example.com/visit](https://example.com/visit)';
const SHOWN: Block[] = [
  p(run('Bring', ['bold']), run(' the signed form')),
  p(run('Room 204', ['italic'])),
  p(run('Arrive early', ['underline'])),
  {type: 'list', ordered: true, items: [li(run('Check in', ['italic'])), li(run('Badge'))]},
  {type: 'list', ordered: false, items: [li(run('Laptop'))]},
  blank,
  p(run('https://example.com/visit', [], 'https://example.com/visit')),
];
const withoutUnderline = SHOWN.map(block => (block.type === 'paragraph' ? p(...block.runs.map(one => ({...one, marks: one.marks.filter(mark => mark !== 'underline')}))) : block));

describe('Google\'s HTML', () => {
  test('a description from Google Calendar\'s own editor reads as its lines, lists and link', () => {
    expect(readHtml(GOOGLE)).toEqual({blocks: SHOWN, lossy: false});
  });

  test('and is written back as that editor writes it, the empty tag it left behind aside', () => {
    expect(writeHtml(SHOWN)).toBe(GOOGLE.replace('<i></i>', ''));
    expect(readHtml(writeHtml(SHOWN)).blocks).toEqual(SHOWN);
  });

  test.each<[string, string, Block[]]>([
    ['plain text keeps its line breaks, as an invite\'s or an .ics file\'s', 'Your interview is confirmed.\nJoin: the lobby\n\nBring ID', [p(run('Your interview is confirmed.')), p(run('Join: the lobby')), blank, p(run('Bring ID'))]],
    ['plain text with a link in it still keeps them', 'Agenda\n<a href="https://example.com/a">here</a>', [p(run('Agenda')), p(run('here', [], 'https://example.com/a'))]],
    ['markup with its own lines folds the source\'s white space', '<p>\n  First\n  line\n</p>\n<p>Second</p>', [p(run('First line')), blank, p(run('Second'))]],
    ['strong and em are bold and italic, nested formats add up', '<strong>a <em>b</em></strong>', [p(run('a ', ['bold']), run('b', ['bold', 'italic']))]],
    ['entities are their characters', 'Tom &amp; Jo &lt;3 &#39;quoted&#39; &nbsp;&mdash; done', [p(run('Tom & Jo <3 \'quoted\'  — done'))]],
    ['a lone < is text', 'a < b and c<d', [p(run('a < b and c<d'))]],
    ['an address or a link in angle brackets is text, as invites write them', 'Sam Lee <sam@example.org>\nJoin the meeting<https://example.com/j/1>', [p(run('Sam Lee <sam@example.org>')), p(run('Join the meeting<https://example.com/j/1>'))]],
    ['a <br> among plain lines leaves their line breaks', 'Line one\nLine two<br>Line three', [p(run('Line one')), p(run('Line two')), p(run('Line three'))]],
    ['a blank line is two breaks', 'One<br><br>Two', [p(run('One')), blank, p(run('Two'))]],
    ['headings, quotes and preformatted text', '<h2>Plan</h2><blockquote>Said so</blockquote><pre>a\n  b</pre>', [{type: 'heading', level: 2, runs: [run('Plan')]}, {type: 'quote', runs: [run('Said so')]}, {type: 'code', text: 'a\n  b'}]],
    ['a div is a line, as the browser\'s editable field writes them', 'One<div>Two</div><div><br></div><div><b>Three</b></div>', [p(run('One')), p(run('Two')), blank, p(run('Three', ['bold']))]],
  ])('%s', (_, html, blocks) => {
    expect(readHtml(html)).toEqual({blocks, lossy: false});
  });

  test.each<[string, string, string]>([
    ['a script', 'Hello<script>alert(1)</script> there', 'Hello there'],
    ['a script that never closes', 'Hello<script>alert(1)', 'Hello'],
    ['a style sheet', '<style>p{color:red}</style>Hello', 'Hello'],
    ['an event handler and an image', '<b onclick="alert(1)">Hi</b><img src="https://example.com/t.gif" onerror="alert(1)">', 'Hi'],
    ['a frame', 'A<iframe src="https://example.com"></iframe>B', 'AB'],
    ['a comment', 'A<!-- <b>hidden</b> -->B', 'AB'],
    ['a tag with > inside a quoted attribute', '<a title="a>b" href="https://example.com">x</a>', 'x'],
  ])('nothing runs or loads: %s is only its text', (_, html, text) => {
    const read = readHtml(html);
    expect(plainText(read.blocks)).toBe(text);
    expect(writeHtml(read.blocks)).not.toMatch(/script|style|onclick|onerror|img|iframe|<!--/);
  });

  test.each<[string, string | null]>([
    ['https://example.com/a', 'https://example.com/a'], ['http://example.com', 'http://example.com'], ['mailto:sam@example.org', 'mailto:sam@example.org'], ['tel:+15550100', 'tel:+15550100'],
    ['javascript:alert(1)', null], [' JavaScript:alert(1)', null], ['data:text/html,<b>x</b>', null], ['file:///etc/passwd', null], ['/relative', null], ['', null],
  ])('a link to %s opens %s', (url, href) => {
    expect(safeHref(url)).toBe(href);
    expect(readHtml(`<a href="${url}">here</a>`).blocks).toEqual([p(run('here', [], href))]);
  });

  test.each<[string, string, string]>([
    ['a table', '<table><tr><td>Mon</td><td>9 AM</td></tr><tr><td>Tue</td><td>10 AM</td></tr></table>', 'Mon 9 AM\nTue 10 AM'],
    ['an image', 'Logo <img src="https://example.com/logo.png" alt="x">', 'Logo'],
    ['colours and fonts', '<span style="color:red">Urgent</span> <font face="Arial">now</font>', 'Urgent now'],
  ])('formatting the list can\'t hold is marked, and shown as its text: %s', (_, html, text) => {
    const read = readHtml(html);
    expect(read.lossy).toBe(true);
    expect(plainText(read.blocks)).toBe(text);
  });

  test('text is escaped on the way out, so what was typed can\'t become markup', () => {
    expect(writeHtml([p(run('<script>alert(1)</script> & "quotes"', ['bold'], 'https://example.com/?a="b"&c=<d>'))]))
      .toBe('<a href="https://example.com/?a=&quot;b&quot;&amp;c=&lt;d&gt;"><b>&lt;script&gt;alert(1)&lt;/script&gt; &amp; "quotes"</b></a>');
  });

  test('the editable field\'s own markup keeps white space as typed', () => {
    expect(readHtml('<div>a  b</div><div> c</div>', {literal: true}).blocks).toEqual([p(run('a  b')), p(run(' c'))]);
  });
});

// SV-268: a list nests as Google Calendar's editor writes it (read from a real event, 2026-11-10,
// with invented text), and as the browser's own indent leaves it in the editor's field.
describe('nested lists', () => {
  const NESTED = '<ul><li><b>Length</b>: one hour</li><li><b>Parking</b>:<ul><li>On the street</li><li>The lot behind</li></ul></li><li>Bring a pen</li></ul>';
  const SHOWN_NESTED: Block[] = [{type: 'list', ordered: false, items: [
    li(run('Length', ['bold']), run(': one hour')),
    under(li(run('Parking', ['bold']), run(':')), {ordered: false, items: [li(run('On the street')), li(run('The lot behind'))]}),
    li(run('Bring a pen')),
  ]}];

  test('Google\'s nested list reads as one, nothing lost, and is written back exactly as Google wrote it', () => {
    expect(readHtml(NESTED)).toEqual({blocks: SHOWN_NESTED, lossy: false});
    expect(writeHtml(SHOWN_NESTED)).toBe(NESTED);
    expect(plainText(SHOWN_NESTED)).toBe('Length: one hour\nParking:\nOn the street\nThe lot behind\nBring a pen');
  });

  test.each<[string, string, Block[]]>([
    ['the browser\'s indent puts the inner list after its item, not inside it', '<ul><li>a</li><ul><li>b</li></ul><li>c</li></ul>',
      [{type: 'list', ordered: false, items: [under(li(run('a')), {ordered: false, items: [li(run('b'))]}), li(run('c'))]}]],
    ['a numbered list inside a bulleted one keeps its own kind, three levels down', '<ul><li>a<ol><li>b<ul><li>c</li></ul></li></ol></li></ul>',
      [{type: 'list', ordered: false, items: [under(li(run('a')), {ordered: true, items: [under(li(run('b')), {ordered: false, items: [li(run('c'))]})]})]}]],
    ['an inner list with no item above it hangs from an empty one', '<ol><li><ul><li>b</li></ul></li></ol>',
      [{type: 'list', ordered: true, items: [under(li(), {ordered: false, items: [li(run('b'))]})]}]],
  ])('%s', (_, html, blocks) => {
    expect(readHtml(html, {literal: true})).toEqual({blocks, lossy: false});
  });

  test('text after an inner list in the same item can\'t be held: it shows as an item of its own, and is marked', () => {
    const read = readHtml('<ul><li>a<ul><li>b</li></ul>tail</li></ul>');
    expect(read.lossy).toBe(true);
    expect(plainText(read.blocks)).toBe('a\nb\ntail');
  });

  test('a task\'s list nests by indent, written to its item\'s text as CommonMark reads it', () => {
    const markdown = '- **Length**: one hour\n- **Parking**:\n  - On the street\n  - The lot behind\n- Bring a pen';
    expect(writeMarkdown(SHOWN_NESTED)).toBe(markdown);
    expect(readMarkdown(markdown)).toEqual({blocks: SHOWN_NESTED, lossy: false});
    const numbered: Block[] = [{type: 'list', ordered: true, items: [under(li(run('a')), {ordered: true, items: [li(run('b'))]}), li(run('c'))]}];
    expect(writeMarkdown(numbered)).toBe('1. a\n   1. b\n2. c');
    expect(readMarkdown('1. a\n    - b\n        - c\n2. d').blocks).toEqual([{type: 'list', ordered: true, items: [
      under(li(run('a')), {ordered: false, items: [under(li(run('b')), {ordered: false, items: [li(run('c'))]})]}), li(run('d')),
    ]}]);
  });
});

describe('Todoist\'s Markdown', () => {
  test('a description from Todoist\'s own editor reads as its lines, lists and link', () => {
    expect(readMarkdown(TODOIST)).toEqual({blocks: withoutUnderline, lossy: false});
  });

  test('and is written back as that editor writes it', () => {
    expect(writeMarkdown(withoutUnderline)).toBe(TODOIST);
  });

  test('underline, which Markdown doesn\'t have, goes as plain text', () => {
    expect(writeMarkdown(SHOWN)).toBe(TODOIST);
  });

  test.each<[string, string, Run[]]>([
    ['bold', '**a** and __b__', [run('a', ['bold']), run(' and '), run('b', ['bold'])]],
    ['italic', '*a* and _b_', [run('a', ['italic']), run(' and '), run('b', ['italic'])]],
    ['bold inside italic and the other way', '*a **b** c* **d *e***', [run('a ', ['italic']), run('b', ['bold', 'italic']), run(' c', ['italic']), run(' '), run('d ', ['bold']), run('e', ['bold', 'italic'])]],
    ['strikethrough and code', '~~gone~~ `x * y`', [run('gone', ['strike']), run(' '), run('x * y', ['code'])]],
    ['a link, its label formatted', '[**here**](https://example.com/a_(b))', [run('here', ['bold'], 'https://example.com/a_(b)')]],
    ['a link Setpoint won\'t open is its label', '[here](javascript:alert(1))', [run('here')]],
    ['an address in angle brackets', '<https://example.com/a>', [run('https://example.com/a', [], 'https://example.com/a')]],
    ['an underscore inside a word formats nothing', 'snake_case_name and https://example.com/a_b_c', [run('snake_case_name and https://example.com/a_b_c')]],
    ['unclosed marks are text', '2 * 3 and **open and _', [run('2 * 3 and **open and _')]],
    ['an escaped mark is its character', '\\*not italic\\* \\[x\\]', [run('*not italic* [x]')]],
    ['raw HTML is text, never markup', '<b>x</b><script>alert(1)</script>', [run('<b>x</b><script>alert(1)</script>')]],
  ])('a line with %s', (_, markdown, runs) => {
    expect(readInline(markdown)).toEqual(runs.map(one => ({...one, marks: one.marks})).flatMap(one => [one]));
  });

  test.each<[string, string, Block[]]>([
    ['headings, quotes and a code block', '# Plan\n> Said so\n\n```\na\n  b\n```', [{type: 'heading', level: 1, runs: [run('Plan')]}, {type: 'quote', runs: [run('Said so')]}, {type: 'code', text: 'a\n  b'}]],
    ['a blank line between lines is a blank line', 'One\n\nTwo', [p(run('One')), blank, p(run('Two'))]],
    ['the blank line around a list is only its edge', 'One\n\n- a\n- b\n\nTwo', [p(run('One')), {type: 'list', ordered: false, items: [li(run('a')), li(run('b'))]}, p(run('Two'))]],
    ['star and plus lists, and numbers with a bracket', '* a\n+ b\n1) c', [{type: 'list', ordered: false, items: [li(run('a')), li(run('b'))]}, {type: 'list', ordered: true, items: [li(run('c'))]}]],
  ])('%s', (_, markdown, blocks) => {
    expect(readMarkdown(markdown).blocks).toEqual(blocks);
    expect(readMarkdown(writeMarkdown(blocks)).blocks).toEqual(blocks);
  });

  test.each<[string, Block[], string]>([
    ['marks in text are escaped', [p(run('2 * 3 [x] `y` a_b _c'))], '2 \\* 3 \\[x\\] \\`y\\` a_b \\_c'],
    ['a line that would read as a list, a heading or a quote says it isn\'t', [p(run('1. not a list')), p(run('- nor this')), p(run('# nor a heading')), p(run('> nor a quote'))], '1\\. not a list\n\\- nor this\n\\# nor a heading\n\\> nor a quote'],
    ['spaces at a format\'s edge sit outside it', [p(run('a'), run(' bold ', ['bold']), run('b'))], 'a **bold** b'],
    ['a link\'s brackets are encoded', [p(run('here', [], 'https://example.com/a (b)'))], '[here](https://example.com/a%20%28b%29)'],
  ])('written: %s', (_, blocks, markdown) => {
    expect(writeMarkdown(blocks)).toBe(markdown);
    expect(plainText(readMarkdown(markdown).blocks)).toBe(plainText(blocks));
  });
});

describe('what each provider\'s own editor writes', () => {
  const pasted: Block[] = [
    {type: 'heading', level: 2, runs: [run('Plan', ['bold'])]},
    {type: 'quote', runs: [run('Said so', ['underline', 'strike'])]},
    {type: 'code', text: 'a\n\nb'},
    {type: 'list', ordered: false, items: [li(run('x', ['code', 'italic'], 'https://example.com'))]},
  ];
  test('an event keeps Google\'s set: bold, italic, underline, lists and links, the rest as plain lines', () => {
    expect(fitting('event', pasted)).toEqual([
      p(run('Plan', ['bold'])), p(run('Said so', ['underline'])), p(run('a')), blank, p(run('b')),
      {type: 'list', ordered: false, items: [li(run('x', ['italic'], 'https://example.com'))]},
    ]);
  });
  test('a task keeps everything but underline', () => {
    expect(fitting('task', pasted)).toEqual([pasted[0], {type: 'quote', runs: [run('Said so', ['strike'])]}, pasted[2], pasted[3]]);
  });
});

describe('either format', () => {
  test('an event reads as HTML and a task as Markdown; none is nothing', () => {
    expect(readDescription('html', '<b>x</b>').blocks).toEqual([p(run('x', ['bold']))]);
    expect(readDescription('markdown', '<b>x</b>').blocks).toEqual([p(run('<b>x</b>'))]);
    expect(readDescription('html', null)).toEqual({blocks: [], lossy: false});
    expect(readDescription('markdown', '')).toEqual({blocks: [], lossy: false});
  });

  test('nothing left in it writes as null, which clears it at the provider', () => {
    expect(writeDescription('html', [blank, p(run('')), {type: 'list', ordered: true, items: [li()]}])).toBeNull();
    expect(writeDescription('markdown', [])).toBeNull();
    expect(isEmpty([blank])).toBe(true);
    expect(writeDescription('html', [p(run('x'))])).toBe('x');
  });

  test('the same on screen is the same: split runs, mark order and blank ends don\'t count; a word or a format does', () => {
    const one = [p(run('Bring', ['bold', 'italic']), run(' it'))];
    expect(sameDescription(one, [blank, p(run('Br', ['italic', 'bold']), run('ing', ['bold', 'italic']), run(''), run(' it')), blank])).toBe(true);
    expect(sameDescription(one, [p(run('Bring', ['bold']), run(' it'))])).toBe(false);
    expect(sameDescription(one, [p(run('Bring', ['bold', 'italic']), run(' them'))])).toBe(false);
    expect(sameDescription(readHtml(GOOGLE).blocks, readHtml(writeHtml(readHtml(GOOGLE).blocks)).blocks)).toBe(true);
  });

  test.each<[string, Run, Run[]]>([
    ['a bare address', run('See https://example.com/a?b=1, then reply.'), [run('See '), run('https://example.com/a?b=1', [], 'https://example.com/a?b=1'), run(', then reply.')]],
    ['two of them, formats kept', run('https://example.com (and http://example.org/x)', ['bold']), [run('https://example.com', ['bold'], 'https://example.com'), run(' (and ', ['bold']), run('http://example.org/x', ['bold'], 'http://example.org/x'), run(')', ['bold'])]],
    ['a link already', run('https://example.com', [], 'https://example.org'), [run('https://example.com', [], 'https://example.org')]],
    ['code', run('curl https://example.com', ['code']), [run('curl https://example.com', ['code'])]],
    ['none', run('No address here'), [run('No address here')]],
  ])('on screen only, %s in the text is a link', (_, from, to) => {
    expect(withLinks(from)).toEqual(to);
  });
});
