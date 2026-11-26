// Where an HTML email's quoted history starts (src/domain/quotedHistory.ts), as a table over
// invented emails from each client: what's left above the fold, or null when the email shows in full.
import {describe, expect, test} from 'vitest';
import {withoutQuotedHistory} from '../src/domain/quotedHistory.ts';

/** What the reader would read above the fold: the body's text, its blocks on lines of their own. */
function shown(html: string | null): string | null {
  if (html === null) return null;
  const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] ?? html;
  return body.replace(/<(br|\/p|\/div|hr)[^>]*>/g, '\n').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;|\u00a0/g, ' ')
    .split('\n').map(line => line.trim()).filter(Boolean).join(' / ');
}

const gmailQuote = (inner: string) => `<div class="gmail_quote gmail_quote_container"><div dir="ltr" class="gmail_attr">On Tue, Nov 24, 2026 at 3:04 PM Sam Ortiz &lt;sam@example.com&gt; wrote:<br></div>`
  + `<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">${inner}</blockquote></div>`;

const appleQuote = (inner: string) => `<div><br><blockquote type="cite"><div>On Nov 24, 2026, at 3:04 PM, Sam Ortiz &lt;sam@example.com&gt; wrote:</div><br></blockquote></div>`
  + `<blockquote type="cite"><div dir="ltr">${inner}</div></blockquote>`;

const outlookWeb = (subject: string) => `<div id="appendonsend"></div><hr style="display:inline-block;width:98%" tabindex="-1">`
  + `<div id="divRplyFwdMsg" dir="ltr"><font face="Calibri, sans-serif" style="font-size:11pt" color="#000000"><b>From:</b> Sam Ortiz &lt;sam@example.com&gt;<br><b>Sent:</b> Tuesday, November 24, 2026 3:04 PM<br><b>To:</b> Jo Park &lt;jo@example.com&gt;<br><b>Subject:</b> ${subject}</font><div>&nbsp;</div></div>`
  + `<div><p>Could you send the plan by Friday?</p></div>`;

const outlookDesktop = `<div class="WordSection1"><p class="MsoNormal">Sending it over now.<o:p></o:p></p><p class="MsoNormal"><o:p>&nbsp;</o:p></p>`
  + `<div><div style="border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt 0in 0in 0in"><p class="MsoNormal"><b>From:</b> Sam Ortiz &lt;sam@example.com&gt;<br><b>Sent:</b> Tuesday, November 24, 2026 3:04 PM<br><b>Subject:</b> RE: The plan<o:p></o:p></p></div></div>`
  + `<p class="MsoNormal">Could you send the plan by Friday?<o:p></o:p></p></div>`;

describe('the history folds from where its client starts it', () => {
  test.each([
    ['Gmail, the reply above its quote', `<div dir="ltr">Friday works.</div><br>${gmailQuote('<div dir="ltr">Could you send the plan by Friday?</div>')}`, 'Friday works.'],
    ['Gmail, with a signature above the quote', `<div dir="ltr">Friday works.<br clear="all"><br><span class="gmail_signature_prefix">-- </span><div class="gmail_signature">Jo</div></div><br>${gmailQuote('Could you send the plan?')}`, 'Friday works. / -- Jo'],
    ['Gmail, a quote inside a quote, from the outermost', `<div>Done.</div>${gmailQuote(`<div>Which plan?</div>${gmailQuote('Could you send the plan?')}`)}`, 'Done.'],
    ['Setpoint\'s own reply', '<p>Friday works.</p><br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">On Nov 24, 2026, Sam Ortiz wrote:<br></div><blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex"><div dir="ltr"><p>Could you send the plan?</p></div></blockquote></div>', 'Friday works.'],
    ['Apple Mail, from its "On … wrote:" line', `<html><head><meta http-equiv="content-type" content="text/html; charset=utf-8"></head><body dir="auto"><div dir="ltr">Friday works.</div>${appleQuote('Could you send the plan by Friday?')}</body></html>`, 'Friday works.'],
    ['Apple Mail, its line beside the quote', '<div>Friday works.</div><div><br></div><div>On Nov 24, 2026, at 3:04 PM, Sam Ortiz &lt;sam@example.com&gt; wrote:</div><br><blockquote type="cite"><div>Could you send the plan?</div></blockquote>', 'Friday works.'],
    ['Apple Mail, a cited block with no line above it', '<div>Friday works.</div><blockquote type="cite">Could you send the plan?</blockquote>', 'Friday works.'],
    ['Outlook on the web, from the rule above its header', `<div style="font-family:Aptos">Sending it over now.</div><div><br></div>${outlookWeb('RE: The plan')}`, 'Sending it over now.'],
    ['Outlook for the desktop, from its bordered header', outlookDesktop, 'Sending it over now.'],
  ])('%s', (_name, html, fresh) => {
    expect(shown(withoutQuotedHistory(html))).toBe(fresh);
  });

  test('the head and its styles stay, so what\'s left looks as it did', () => {
    const html = `<html><head><style>p { color: #333; }</style></head><body><p>Friday works.</p>${gmailQuote('Could you send the plan?')}</body></html>`;
    expect(withoutQuotedHistory(html)).toBe('<html><head><style>p { color: #333; }</style></head><body><p>Friday works.</p></body></html>');
  });
});

describe('an email shows in full when folding would lose something', () => {
  test.each([
    ['no quote at all', '<div>Lunch on Thursday?</div><blockquote>A quote the sender typed themself</blockquote><div>Sam</div>'],
    ['Gmail, an answer under the quote', `${gmailQuote('Could you send the plan?')}<div>Friday works, sent below.</div>`],
    ['Gmail, inline replies between quoted lines', `<div>See below.</div>${gmailQuote('Could you send the plan?')}<div>Yes, Friday.</div>${gmailQuote('And the budget?')}<div>Monday.</div>`],
    ['Apple Mail, an answer under the quote', '<div>Hi Sam,</div><blockquote type="cite">Could you send the plan?</blockquote><div>Here it is.</div>'],
    ['Gmail, a forward', '<div dir="ltr">For you.<br><br><div class="gmail_quote"><div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>From: <b>Sam Ortiz</b> &lt;sam@example.com&gt;<br>Subject: The plan<br></div><br><div>Could you send the plan?</div></div></div>'],
    ['Apple Mail, a forward', '<div>For you.</div><div><br><blockquote type="cite"><div>Begin forwarded message:</div></blockquote></div><blockquote type="cite"><div><b>From: </b>Sam Ortiz</div><div>Could you send the plan?</div></blockquote>'],
    ['Outlook, a forward', `<div>For you.</div>${outlookWeb('FW: The plan')}`],
    ['nothing above the quote', `<div><br></div>${gmailQuote('Could you send the plan?')}`],
  ])('%s', (_name, html) => {
    expect(withoutQuotedHistory(html)).toBeNull();
  });

  test('a quote mid-body is kept while a trailing one after the sender\'s answer folds', () => {
    const html = `<div>Answers inline.</div>${gmailQuote('Could you send the plan?')}<div>Friday.</div><br>${gmailQuote('Earlier thread')}`;
    expect(shown(withoutQuotedHistory(html))).toBe('Answers inline. / On Tue, Nov 24, 2026 at 3:04 PM Sam Ortiz <sam@example.com> wrote: / Could you send the plan? / Friday.');
  });
});
