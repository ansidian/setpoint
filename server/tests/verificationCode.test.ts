// The verification-code detector (harvested from v1, SV-4): one exact code or none, from the
// families v1's production sampling found, and none from the look-alikes it learned to refuse.
import {describe, expect, test} from 'vitest';
import {detectVerificationCode, normalizeCodeText} from '../src/domain/verificationCode.ts';

const RECEIVED = '2026-10-07T16:08:00.000Z';
const detect = (subject: string, body = '', snippet = body.slice(0, 120), receivedAt: string | null = RECEIVED, expiryMinutes = 15) =>
  detectVerificationCode({subject, snippet, bodyText: body, receivedAt, expiryMinutes});

describe('detectVerificationCode finds one exact code', () => {
  test.each<[string, string, string, string, string]>([
    // name, subject, body, code, kind
    ['numeric code leading the subject', '482913 is your verification code', '', '482913', 'numeric'],
    ['numeric code after the subject\'s marker', 'Your login code: 771204', '', '771204', 'numeric'],
    ['a printer-style body with the code below its marker', 'Verify your email', 'Your verification code is below: 5521. It expires in 5 minutes.', '5521', 'numeric'],
    ['a streaming-style body: code then marker', 'Your Twitch code', 'Hi! 908172 is your one-time code for signing in.', '908172', 'numeric'],
    ['a bank-style body with a sign-in code', 'Sign in to Mercury', 'Here is your sign-in code: 31840277', '31840277', 'numeric'],
    ['leading zeroes kept as written', 'Your security code', 'Your security code is 004719.', '004719', 'numeric'],
    ['mixed letters and digits', 'Your authentication code', 'Use authentication code 4F7K2Q to finish signing in.', '4F7K2Q', 'alphanumeric'],
    ['the bare word "code" counts once the subject says it\'s a code email', 'Your verification code', 'Enter this code - 66XY21 - on the sign-in page.', '66XY21', 'alphanumeric'],
    ['hyphenated with digits', 'Your confirmation code', 'Confirmation code: X4T-9QZ', 'X4T-9QZ', 'hyphenated'],
    ['letters-only hyphenated, only from the subject\'s strong marker', 'Slack confirmation code: kmq-wrt', 'Enter it in the app.', 'kmq-wrt', 'hyphenated'],
    ['OTP as the marker', 'Your OTP', 'OTP: 290811 (valid 10 minutes)', '290811', 'numeric'],
    ['the same code in subject and body is one code', '512334 is your login code', 'Your login code is 512334.', '512334', 'numeric'],
    ['HTML entities and zero-width characters are read through', 'Your verification code', 'Your verification code&nbsp;is&#58; 6\u200B6\u200B1\u200B2\u200B0\u200B9', '661209', 'numeric'],
  ])('%s', (_, subject, body, code, kind) => {
    expect(detect(subject, body)).toEqual({code, kind, expiresAt: '2026-10-07T16:23:00.000Z'});
  });

  test('the row expires after the setting, counted from arrival', () => {
    expect(detect('Your login code: 771204', '', '', RECEIVED, 60)?.expiresAt).toBe('2026-10-07T17:08:00.000Z');
    expect(detect('Your login code: 771204', '', '', RECEIVED, 5)?.expiresAt).toBe('2026-10-07T16:13:00.000Z');
  });
});

describe('detectVerificationCode refuses look-alikes', () => {
  test.each<[string, string, string]>([
    // name, subject, body
    ['programming talk about code', 'Code review for PR 4821', 'Please review the code in branch fix-4821 before Friday.'],
    ['news that mentions a code', 'The new tax code explained', 'Section 1031 of the code changes in 2027.'],
    ['an order number near a confirmation word', 'Order confirmation', 'Order number: 112-4471923-0042211. Your confirmation will follow.'],
    ['a tracking number', 'Your security deposit', 'Tracking number 1Z999AA10123456784 for your deposit refund.'],
    ['a phone number near "PIN"', 'Reset your PIN', 'Call us at +1 (415) 555-0134 to reset your PIN.'],
    ['a price near "passcode"', 'Passcode plan', 'Your passcode plan costs $1299 a year.'],
    ['a date near "verification code"', 'Verification code', 'Codes sent before 10/07/2026 no longer work.'],
    ['a clock time near "login code"', 'Login code', 'Login code requests are paused until 9:30 pm.'],
    ['a UUID near "authentication code"', 'Authentication code', 'Request id 3f1c2a9e-5b7d-4e21-9a3c-1b2d3e4f5a6b had no authentication code.'],
    ['a link holding digits', 'Verification code', 'Open https://example.com/verify/839201 instead.'],
    ['an email address holding digits', 'Security code', 'Write to support4410@example.com for a new security code.'],
    ['a marker with no token', 'Your verification code', 'Your verification code is on its way.'],
    ['ordinary words of code length', 'Your login code', 'Your login code is HELLO.'],
    ['letters-only hyphenated after the bare word "code" is a word, not a code', 'Your verification code', 'Enter the code: plan-this-week'],
    ['two different codes tie: ambiguous', 'Codes', 'Your verification code: 111222. Your verification code: 333444.'],
    ['a candidate too far from its marker', 'Security update', `Your verification code ${'is described in our help pages and arrives separately '.repeat(2)}884410`],
  ])('%s', (_, subject, body) => {
    expect(detect(subject, body)).toBeNull();
  });

  test.each<[string, string | null]>([
    ['missing', null],
    ['not UTC', '2026-10-07T09:08:00-07:00'],
    ['impossible', '2026-02-31T10:00:00.000Z'],
  ])('a code without a valid arrival time (%s) is no code: freshness can\'t be known', (_, receivedAt) => {
    expect(detect('482913 is your verification code', '', '', receivedAt)).toBeNull();
  });
});

test('normalizeCodeText decodes entities, drops invisible formatting and collapses whitespace', () => {
  expect(normalizeCodeText('a&amp;b&#x41;&#66;\u200C\uFEFF  c\n\td &unknown;')).toBe('a&bAB c d &unknown;');
  expect(normalizeCodeText(null)).toBe('');
});
