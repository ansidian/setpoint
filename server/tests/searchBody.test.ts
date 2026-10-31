// What search indexes of a body (SV-135): links become their domain, once; plain boilerplate near
// the end goes; everything else stays as it was written.
import {describe, expect, test} from 'vitest';
import {searchBody, withoutLinks} from '../src/domain/searchBody.ts';

const lines = (count: number, word = 'Line') => Array.from({length: count}, (_, at) => `${word} ${at + 1}.`).join('\n');

describe('links', () => {
  test.each([
    ['a link in a sentence leaves its domain', 'Pay at https://fhwbilling.example/pay/8842?utm_source=mail&token=a1b2 today.', 'Pay at fhwbilling today.'],
    ['punctuation after a link stays', 'See https://contoso.example/a/b.', 'See contoso.'],
    ['a bracket that wraps a link goes with it', 'Pay now [https://contoso.example/pay]', 'Pay now contoso'],
    ['angle brackets', 'Read it <https://contoso.example/read> soon', 'Read it contoso soon'],
    ['round brackets', 'Read it (https://contoso.example/read), soon', 'Read it contoso, soon'],
    ['a bracket that doesn\'t wrap the link stays', '(see https://contoso.example/read and more)', '(see contoso and more)'],
    ['www without a scheme', 'Go to www.contoso.example/deals now', 'Go to contoso now'],
    ['a word ending in www isn\'t a link', 'awww.that is sweet', 'awww.that is sweet'],
    ['the same domain twice is one word', 'One https://contoso.example/1 two https://contoso.example/2 three', 'One contoso two three'],
    ['a subdomain of a domain seen is only its new word', 'https://contoso.example/1 https://pay.contoso.example/2', 'contoso pay'],
    ['a telling subdomain stays', 'https://fhw.paymentportal.example/x', 'fhw paymentportal'],
    ['delivery subdomains go', 'https://click.e.contoso.example/abc', 'contoso'],
    ['a generated subdomain goes', 'https://u1234567.ct.mailvendor.example/abc', 'ct mailvendor'],
    ['the registered name stays, even when it looks like plumbing', 'https://go.example/abc', 'go'],
    ['a country\'s second level goes with its TLD', 'https://www.contoso.co.uk/abc', 'contoso'],
    ['a port and a login don\'t reach the word', 'https://me:secret@contoso.example:8443/abc', 'contoso'],
    ['an IP address leaves nothing', 'Go to http://192.168.1.1/admin now', 'Go to now'],
    ['a host with one label stays', 'http://intranet/page', 'intranet'],
    ['upper case', 'HTTPS://WWW.Contoso.Example/ABC', 'contoso'],
    ['a hyphenated domain stays whole', 'https://fhw-billing.example/x', 'fhw-billing'],
    ['mailto leaves the address', 'Write to <mailto:help@contoso.example>', 'Write to <help@contoso.example>'],
    ['a bare domain is the sender\'s own word', 'Visit contoso.example for more', 'Visit contoso.example for more'],
  ])('%s', (_, body, expected) => {
    expect(searchBody(body)).toBe(expected);
  });
});

test('withoutLinks leaves what the email says itself, and no domain', () => {
  expect(withoutLinks('Pay at https://fhwbilling.example/pay/8842 today.\nContoso (https://contoso.example/a) wrote.')).toBe('Pay at  today.\nContoso  wrote.');
});

describe('footers', () => {
  test.each([
    ['a lone unsubscribe link', 'Hello.\nUnsubscribe [https://contoso.example/u/1]'],
    ['a row of footer links', 'Hello.\nPrivacy Policy | Terms of Service | Unsubscribe'],
    ['a row with a weak link beside a strong one', 'Hello.\nContact us · Manage your preferences'],
    ['a row split by bullets', 'Hello.\n• Email preferences • Help Center'],
    ['"to unsubscribe"', 'Hello.\nTo unsubscribe, click here.'],
    ['"click here to unsubscribe"', 'Hello.\nClick here to unsubscribe https://contoso.example/u'],
    ['"you can update your preferences"', 'Hello.\nYou can update your email preferences at any time.'],
    ['"if you no longer wish"', 'Hello.\nIf you no longer wish to receive these emails, unsubscribe here.'],
    ['opting out of mail', 'Hello.\nTo opt out of future marketing emails, reply STOP.'],
    ['a mailing\'s reason', 'Hello.\nYou are receiving this email because you signed up for our newsletter.'],
    ['a list\'s reason', 'Hello.\nYou received this message because you are subscribed to the Contoso group.'],
    ['who it was sent to', 'Hello.\nThis email was sent to user@example.com.'],
    ['a copyright line', 'Hello.\n© 2026 Contoso Ltd.'],
    ['a copyright line in words', 'Hello.\nCopyright 2026 Contoso Ltd.'],
    ['all rights reserved', 'Hello.\nContoso Ltd. All rights reserved.'],
    ['view in browser', 'Hello.\nView this email in your browser'],
  ])('%s goes', (_, body) => {
    expect(searchBody(body).split('\n')[0]).toBe('Hello.');
    expect(searchBody(body).toLowerCase()).not.toMatch(/unsubscribe|preferences|privacy|receiving|received|rights|sent to|copyright|©|browser|opt out/);
  });

  test.each([
    ['a person asking', 'Please unsubscribe me from your list, I asked last week.'],
    ['a sentence about unsubscribing', 'I tried to find the unsubscribe link but the page was broken.'],
    ['a reason about the reader\'s own business', 'You are receiving this email because your card on file expired.'],
    ['an application\'s reason', 'You\'re receiving this because you applied to Northwind.'],
    ['an arbitration notice', 'To opt out of this arbitration provision, mail a letter by December 1.'],
    ['a copyright claim', 'Copyright notice: your video was removed from the channel.'],
    ['a preferences sentence', 'Your seating preferences are saved for the flight.'],
    ['help on its own', 'Help'],
    ['contact us on its own', 'Contact us'],
    ['a footer row with a real part', 'Contoso Ltd, 1 Main St | Unsubscribe'],
    ['a signature', 'Dana Whitfield\nProperty Manager\n(555) 010-0199'],
    ['a street address', '1 Main St, Springfield'],
    ['a quoted footer', '> To unsubscribe, click here.'],
  ])('%s stays', (_, line) => {
    expect(searchBody(`Hello.\n${line}`)).toBe(`Hello.\n${line}`);
  });

  test('a line that says more than boilerplate does stays', () => {
    const long = `To unsubscribe, ${'write to the office and say which of the lists you want to leave, '.repeat(6)}`.trim();
    expect(searchBody(`Hello.\n${long}`)).toBe(`Hello.\n${long}`);
  });

  test('only the end of an email can be a footer', () => {
    const body = `To unsubscribe, click here.\n${lines(15)}`;
    expect(searchBody(body)).toBe(body);
    const near = `${lines(3)}\nTo unsubscribe, click here.\n${lines(14, 'More')}`;
    expect(searchBody(near)).not.toContain('unsubscribe');
  });

  test('a footer line\'s link still leaves its domain, at the end', () => {
    expect(searchBody('Your invoice is ready.\n\nUnsubscribe [https://fhwbilling.example/u/1]')).toBe('Your invoice is ready.\n\nfhwbilling');
    expect(searchBody('Pay at https://contoso.example/a\nUnsubscribe [https://contoso.example/u/1]')).toBe('Pay at contoso');
  });
});

describe('the rest of the body', () => {
  test.each([
    ['nothing', '', ''],
    ['plain text', 'Your lease ends Nov 30.\n\nOnce it\'s signed, your new term starts.', 'Your lease ends Nov 30.\n\nOnce it\'s signed, your new term starts.'],
    ['Windows line ends and gaps', 'One\r\n\r\n\r\n\r\nTwo', 'One\n\nTwo'],
    ['a line left empty by its link', 'One\n\nhttps://contoso.example/a\nhttps://contoso.example/b\n\nTwo', 'One\n\ncontoso\n\nTwo'],
    ['quoted replies stay', 'Yes.\n\n> On Monday you wrote:\n> Can you come?', 'Yes.\n\n> On Monday you wrote:\n> Can you come?'],
  ])('%s', (_, body, expected) => {
    expect(searchBody(body)).toBe(expected);
  });

  test('the words stay the words of the email', () => {
    const body = 'Rent is $2,140 (currently $2,060). Café on Élan St, 8–10 pm.';
    expect(searchBody(body)).toBe(body);
  });

  test('the largest body a mirror stores reads in a moment, whatever it holds', () => {
    const bodies = ['https://'.repeat(3000), '['.repeat(20_000), `https://a.example/${'a'.repeat(20_000)}`, ' '.repeat(20_000), 'a.'.repeat(10_000), '\n'.repeat(20_000)];
    const started = performance.now();
    for (const body of bodies) searchBody(body);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
