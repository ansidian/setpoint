// A posting's text cleaned to readable markdown (J3, decision 53), as a table: headings (a bold-only
// paragraph too), paragraphs, lists and nested lists, Greenhouse's escaped HTML, the page's own
// furniture and lines dropped, whitespace and entities, and plain text's bullets and headings.
import {describe, expect, test} from 'vitest';
import {htmlToMarkdown, MAX_POSTING_CHARS, plainToMarkdown} from '../markdown.ts';

describe('htmlToMarkdown', () => {
  test.each<[string, string, string]>([
    ['a heading and a paragraph', '<h2>About us</h2><p>We make reading apps.</p>', '## About us\n\nWe make reading apps.'],
    ['every heading level is one', '<h1>Role</h1><h4>Team</h4><p>Five engineers.</p>', '## Role\n\n## Team\n\nFive engineers.'],
    ['a bold-only paragraph is a heading, its colon dropped', '<p><strong>What you\'ll need:</strong></p><ul><li>SQL</li></ul>', '## What you\'ll need\n\n- SQL'],
    ['a bold lead-in inside a sentence stays prose', '<p><strong>Note:</strong> this role is hybrid.</p>', 'Note: this role is hybrid.'],
    ['a long bold sentence stays prose', '<p><b>We are an equal opportunity employer and value diversity at our company in every way.</b></p>', 'We are an equal opportunity employer and value diversity at our company in every way.'],
    ['a list', '<ul><li>Java</li><li>REST APIs</li></ul>', '- Java\n- REST APIs'],
    ['a numbered list', '<ol><li>Send your work</li><li>Phone screen</li></ol>', '1. Send your work\n2. Phone screen'],
    ['a nested list is indented', '<ul><li>Tools<ul><li>Git</li><li>Docker</li></ul></li><li>SQL</li></ul>', '- Tools\n  - Git\n  - Docker\n- SQL'],
    ['a paragraph after a list has its blank line', '<ul><li>SQL</li></ul><p>Remote in the US.</p>', '- SQL\n\nRemote in the US.'],
    ['inline emphasis and links keep their text only', '<p>Work in <em>TypeScript</em> on <a href="https://x.example">our API</a>.</p>', 'Work in TypeScript on our API.'],
    ['a line break splits a paragraph', '<p>Irvine, CA<br>Hybrid</p>', 'Irvine, CA\n\nHybrid'],
    ['divs as paragraphs', '<div>One.</div><div>Two.</div>', 'One.\n\nTwo.'],
    ['Greenhouse\'s escaped HTML is unescaped first', '&lt;h2&gt;About&lt;/h2&gt;&lt;p&gt;Pay is $80,000&amp;ndash;$95,000.&lt;/p&gt;', '## About\n\nPay is $80,000–$95,000.'],
    ['entities, non-breaking and zero-width spaces', '<p>R&amp;D&nbsp;team​,  in   Boston</p>', 'R&D team, in Boston'],
    ['scripts, styles, forms, buttons and hidden parts go', '<script>var a = 1;</script><style>p {}</style><form><input></form><p hidden>Cookies</p><p>The role.</p><button>Apply</button>', 'The role.'],
    ['navigation, header and footer go', '<header><nav>Home Jobs</nav></header><p>The role.</p><footer>© Fabrikam</footer>', 'The role.'],
    ['the page\'s own lines go', '<p>The role.</p><p>Apply now</p><p>Back to jobs</p>', 'The role.'],
    ['empty paragraphs and items go', '<p> </p><ul><li></li><li>SQL</li></ul><p></p>', '- SQL'],
    ['a heading left with nothing under it at the end goes', '<p>The role.</p><h3>Apply</h3>', 'The role.'],
    ['nothing at all', '', ''],
  ])('%s', (_, html, markdown) => {
    expect(htmlToMarkdown(html)).toBe(markdown);
  });

  test('a posting longer than the limit is cut at a line', () => {
    const html = Array.from({length: 2000}, (_, index) => `<p>Paragraph ${index} of a very long posting that goes on and on.</p>`).join('');
    const markdown = htmlToMarkdown(html);
    expect(markdown.length).toBeLessThanOrEqual(MAX_POSTING_CHARS);
    expect(markdown.endsWith('on and on.')).toBe(true);
  });
});

describe('plainToMarkdown', () => {
  test.each<[string, string, string]>([
    ['paragraphs a blank line apart', 'We make reading apps.\n\nThe team is five engineers.', 'We make reading apps.\n\nThe team is five engineers.'],
    ['a paragraph\'s wrapped lines join', 'We make reading apps for schools\nand libraries.', 'We make reading apps for schools and libraries.'],
    ['bullets of any kind are items', '• SQL\n- Java\n* Go\n· Rust', '- SQL\n- Java\n- Go\n- Rust'],
    ['an indented bullet is nested', '- Tools\n  - Git', '- Tools\n  - Git'],
    ['numbers are a numbered list', '1. Send your work\n2) Interview', '1. Send your work\n2. Interview'],
    ['a short line before a list is a heading', 'Requirements\n- SQL\n- Java', '## Requirements\n\n- SQL\n- Java'],
    ['a line with a colon alone is a heading', 'Responsibilities:\n\nBuild things.', '## Responsibilities\n\nBuild things.'],
    ['Windows line ends and tabs', 'One.\r\n\r\nTwo\tthree.', 'One.\n\nTwo three.'],
  ])('%s', (_, text, markdown) => {
    expect(plainToMarkdown(text)).toBe(markdown);
  });
});
