// Triage's policy as tables (BUILD-PLAN.md › B3 › Done when): the protected class, FYI when unsure,
// codes, escalation, rule matching and the rules-only history reading.
import type {Lane, ProtectedReason, RuleMatch} from '@setpoint/shared';
import {describe, expect, test} from 'vitest';
import {escalation, historyReading, isSure, organisationFromSender, protectedFromText, settle, typeFromText} from '../src/domain/triagePolicy.ts';
import type {Reading, SettleInput} from '../src/domain/triagePolicy.ts';
import {firstMatch, hasHardRisk, matchesRule, ruleDecides} from '../src/domain/triageRules.ts';
import type {Rule, RuleEmail} from '../src/domain/triageRules.ts';
import type {DetectedCode} from '../src/domain/verificationCode.ts';

const reading = (changes: Partial<Reading> = {}): Reading => ({
  lane: 'fyi', kind: 'updates', organisation: 'Northwind', via: null, type: 'newsletter', keyDate: null, summary: 'New posts',
  security: null, protectedClaim: null, confidence: 0.9, ...changes,
});
const CODE: DetectedCode = {code: '482913', kind: 'numeric', expiresAt: '2026-10-07T16:23:00.000Z'};
const settled = (input: Partial<SettleInput>) => settle({lane: null, reading: null, code: null, textProtected: null, ...input});

describe('protectedFromText: the protected class in plain words', () => {
  test.each<[string, string, ProtectedReason | null]>([
    // subject, body, reason
    ['Your password was changed', '', 'password_changed'],
    ['Password updated', 'The password for your account was updated.', 'password_changed'],
    ['Security notice', 'We have reset your password after unusual requests.', 'password_changed'],
    ['Password reset request', 'Use this link to reset your password. If you didn\'t ask, ignore this.', null],
    ['Reset your password', 'Click below to choose a new password.', null],
    ['Your recovery email was changed', '', 'recovery_changed'],
    ['Security alert', 'You updated your recovery phone.', 'recovery_changed'],
    ['2-Step Verification turned off', '', 'two_step_changed'],
    ['Two-factor authentication is now off', '', 'two_step_changed'],
    ['Your account has been deleted', '', 'account_deleted'],
    ['Your account is scheduled for deletion', '', 'account_deleted'],
    ['Your account was locked', 'Too many attempts.', 'account_locked'],
    ['Your account has been suspended', '', 'account_locked'],
    ['Critical security alert', 'Sign-in attempt was blocked.', 'critical_alert'],
    ['Suspicious sign-in prevented', '', 'unfamiliar_sign_in'],
    ['Unusual sign-in activity', 'We detected something unusual.', 'unfamiliar_sign_in'],
    ['Fraud alert', 'An unauthorized charge of $812.00 was made on your card.', 'money_leaving'],
    ['Transfer notice', 'A transfer of $2,500.00 was sent from your checking account.', 'money_leaving'],
    // Routine security mail stays out (BRIEF.md › Security mail: cheap to check, not protected).
    ['Security alert', 'A new sign-in to your Google Account on a MacBook Pro near Los Angeles.', null],
    ['Claude was granted access to your Google Account', '', null],
    ['You sent $42.00 to Sam Lee', 'You sent $42.00 USD to Sam Lee.', null],
    ['Your code is 482913', 'Your verification code is 482913.', null],
    ['Fall sale: 30% off', 'Don\'t miss it.', null],
  ])('%s', (subject, body, reason) => {
    expect(protectedFromText(subject, body)).toBe(reason);
  });
});

describe('settle: the policy, in order', () => {
  test.each<[string, Partial<SettleInput>, {lane: Lane; protected?: boolean; code?: string | null; kind?: string | null; type?: string | null}]>([
    // Unsure defaults to FYI, never Attention (decision 30).
    ['nothing sure: FYI', {lane: null}, {lane: 'fyi', kind: 'other'}],
    ['nothing sure, with a reading: FYI with what was read', {lane: null, reading: reading({lane: 'attention', kind: 'career', confidence: 0.4})}, {lane: 'fyi', kind: 'career'}],
    ['a decided lane stands', {lane: 'attention', reading: reading({lane: 'attention', kind: 'career', type: null})}, {lane: 'attention', kind: 'career'}],
    // Protected: always Attention, whatever a rule decided (decision 29).
    ['a protected email a rule sent to Noise is Attention', {lane: 'noise', textProtected: 'password_changed'}, {lane: 'attention', protected: true, kind: 'security', type: 'alert'}],
    ['a protected email a rule sent to FYI is Attention', {lane: 'fyi', kind: 'updates', textProtected: 'recovery_changed'}, {lane: 'attention', protected: true, kind: 'security'}],
    ['unsure but protected: Attention', {lane: null, textProtected: 'account_locked'}, {lane: 'attention', protected: true}],
    ['the model\'s claim counts too', {lane: 'fyi', reading: reading({kind: 'security', type: 'alert', protectedClaim: 'unfamiliar_sign_in'})}, {lane: 'attention', protected: true}],
    ['money leaving is Money', {lane: 'fyi', textProtected: 'money_leaving'}, {lane: 'attention', protected: true, kind: 'money'}],
    // Codes: Security with the code, never Attention.
    ['a code is FYI · Security', {lane: 'fyi', code: CODE}, {lane: 'fyi', code: '482913', kind: 'security', type: 'verification_code'}],
    ['a code a rule sent to Noise is still in Security', {lane: 'noise', code: CODE}, {lane: 'fyi', code: '482913', kind: 'security'}],
    ['a code the model calls Attention is not Attention', {lane: 'attention', reading: reading({lane: 'attention'}), code: CODE}, {lane: 'fyi', code: '482913'}],
    ['a code email\'s model claim of protection doesn\'t count', {lane: 'fyi', code: CODE, reading: reading({protectedClaim: 'unfamiliar_sign_in'})}, {lane: 'fyi', protected: false, code: '482913'}],
    ['protected words beat a code: no code row that could expire out of Attention', {lane: 'fyi', code: CODE, textProtected: 'password_changed'}, {lane: 'attention', protected: true, code: null, type: 'alert'}],
    // Noise has no kind.
    ['Noise loses its kind', {lane: 'noise', reading: reading({kind: 'updates'})}, {lane: 'noise', kind: null}],
    ['incomplete evidence can\'t make it Noise', {lane: 'noise', incomplete: true}, {lane: 'fyi', kind: 'other'}],
    ['a rule\'s kind and type win', {lane: 'fyi', kind: 'money', type: 'statement', reading: reading()}, {lane: 'fyi', kind: 'money', type: 'statement'}],
    // Backfilled history never enters Attention, protected or not (SV-4 D19).
    ['history: protected stays protected, in FYI', {lane: null, history: true, textProtected: 'password_changed'}, {lane: 'fyi', protected: true, kind: 'security', type: 'alert'}],
    ['history: a rule sending protected mail to Noise can\'t move it either', {lane: 'noise', history: true, textProtected: 'account_locked'}, {lane: 'fyi', protected: true, kind: 'security'}],
    ['history: money leaving is FYI · Money', {lane: 'fyi', history: true, textProtected: 'money_leaving'}, {lane: 'fyi', protected: true, kind: 'money'}],
    ['history: a rule\'s Attention is FYI', {lane: 'attention', kind: 'career', history: true}, {lane: 'fyi', kind: 'career'}],
    ['history: Noise stays Noise', {lane: 'noise', history: true}, {lane: 'noise', kind: null}],
    ['history: a code is a Security code row', {lane: 'fyi', history: true, code: CODE}, {lane: 'fyi', code: '482913', kind: 'security'}],
  ])('%s', (_, input, expected) => {
    const result = settled(input);
    expect(result.lane).toBe(expected.lane);
    expect(result.protected).toBe(expected.protected ?? false);
    if ('code' in expected) expect(result.code).toBe(expected.code);
    if ('kind' in expected) expect(result.kind).toBe(expected.kind);
    if ('type' in expected) expect(result.type).toBe(expected.type);
    // The invariants every result keeps.
    if (result.protected) expect([result.lane, result.code]).toEqual([input.history ? 'fyi' : 'attention', null]);
    if (input.history) expect(result.lane).not.toBe('attention');
    if (result.code) expect(result.lane).not.toBe('attention');
    expect((result.code === null) === (result.codeExpiresAt === null)).toBe(true);
    expect(result.lane === 'noise' ? result.kind === null : result.kind !== null).toBe(true);
  });

  test('protected mail gets a security fact, and an unfamiliar sign-in says so', () => {
    expect(settled({textProtected: 'password_changed'}).securityFacts).toEqual({what: 'Password changed'});
    const facts = {what: 'Sign-in', device: 'Windows · Chrome', location: 'Phoenix, AZ'};
    expect(settled({lane: 'fyi', reading: reading({kind: 'security', security: facts, protectedClaim: 'unfamiliar_sign_in'})}).securityFacts)
      .toEqual({...facts, unfamiliar: true});
    // Facts only belong to security mail.
    expect(settled({lane: 'fyi', reading: reading({kind: 'money', security: facts})}).securityFacts).toBeNull();
  });
});

describe('isSure and escalation: unsure never decides', () => {
  test.each<[string, Reading | null, boolean, string | null]>([
    // name, cheap reading, sure, escalation
    ['a sure FYI is accepted', reading({confidence: 0.9}), true, null],
    ['at the floor is sure', reading({confidence: 0.72}), true, null],
    ['below the floor goes to the strong model', reading({confidence: 0.71}), false, 'unsure'],
    ['no confidence is unsure', reading({confidence: null}), false, 'unsure'],
    ['malformed output goes to the strong model', null, false, 'malformed'],
    ['Attention is always checked by the strong model', reading({lane: 'attention', confidence: 0.95}), true, 'attention'],
    ['a protected claim is checked too', reading({protectedClaim: 'account_locked'}), true, 'protected'],
    ['Noise, sure: accepted', reading({lane: 'noise', kind: null, confidence: 0.88}), true, null],
  ])('%s', (_, cheap, sure, why) => {
    expect(isSure(cheap)).toBe(sure);
    expect(escalation(cheap)).toBe(why);
  });
});

const email = (changes: Partial<RuleEmail> = {}): RuleEmail => ({
  fromName: 'Woodgrove Bank', fromAddress: 'no-reply@alerts.woodgrovebank.example', subject: 'Your statement is ready', snippet: '', bodyText: 'Your statement is ready to view.', ...changes,
});

describe('matchesRule: v1\'s match shape', () => {
  test.each<[string, RuleMatch, Partial<RuleEmail>, {organisation: string | null; type: null | 'newsletter'} | null, boolean]>([
    ['a domain matches its subdomains', {from_domains: ['woodgrovebank.example']}, {}, null, true],
    ['but not a lookalike', {from_domains: ['woodgrovebank.example']}, {fromAddress: 'x@notwoodgrovebank.example'}, null, false],
    ['an exact address', {from_addresses: ['no-reply@alerts.woodgrovebank.example']}, {}, null, true],
    ['sender keys are alternatives', {from_addresses: ['other@example.com'], from_name_includes: ['woodgrove']}, {}, null, true],
    ['every other key must match too', {from_domains: ['woodgrovebank.example'], subject_includes: ['payment due']}, {}, null, false],
    ['subject text ignores case', {subject_includes: ['STATEMENT']}, {}, null, true],
    ['a subject pattern', {subject_regex: '^your (statement|bill)'}, {}, null, true],
    ['body text, snippet included', {body_includes: ['ready to view']}, {}, null, true],
    ['none_includes vetoes', {from_domains: ['woodgrovebank.example'], none_includes: ['statement']}, {}, null, false],
    ['organisation needs a reading first', {organisation: 'Northwind'}, {}, null, false],
    ['organisation and type match what was read, ignoring case', {organisation: 'northwind  engineering', type: 'newsletter'}, {}, {organisation: 'Northwind Engineering', type: 'newsletter'}, true],
    ['another type doesn\'t', {organisation: 'Northwind', type: 'newsletter'}, {}, {organisation: 'Northwind', type: null}, false],
  ])('%s', (_, match, changes, extracted, expected) => {
    expect(matchesRule(email(changes), match, extracted)).toBe(expected);
  });

  test('firstMatch takes rules in order', () => {
    const rules: Rule[] = [
      {id: 1, key: 'a', source: 'written', match: {subject_includes: ['nothing like this']}, lane: 'attention', kind: null, type: null},
      {id: 2, key: 'b', source: 'written', match: {from_domains: ['woodgrovebank.example']}, lane: 'fyi', kind: 'money', type: null},
      {id: 3, key: 'c', source: 'default', match: {subject_includes: ['statement']}, lane: 'noise', kind: null, type: null},
    ];
    expect(firstMatch(rules, email(), null)?.id).toBe(2);
  });
});

describe('ruleDecides: hard-risk mail is the strong model\'s unless the user named the sender', () => {
  const rule = (changes: Partial<Rule>): Rule => ({id: 1, key: 'r', source: 'written', match: {subject_includes: ['bill']}, lane: 'noise', kind: null, type: null, ...changes});
  test.each<[string, Partial<Rule>, boolean, boolean]>([
    ['no hard risk: the rule decides', {}, false, true],
    ['hard risk: a text rule to Noise doesn\'t decide', {}, true, false],
    ['hard risk: a shipped default doesn\'t decide', {source: 'default', match: {from_domains: ['woodgrovebank.example']}}, true, false],
    ['hard risk: the user\'s rule naming the sender decides', {match: {from_domains: ['woodgrovebank.example']}}, true, true],
    ['hard risk: a rule keeping it in Attention decides', {lane: 'attention'}, true, true],
    ['a routing-only default never decides', {source: 'default', lane: null}, false, false],
  ])('%s', (_, changes, hardRisk, decides) => {
    expect(ruleDecides(rule(changes), hardRisk)).toBe(decides);
  });

  test('hasHardRisk reads v1\'s words', () => {
    expect(hasHardRisk(email({subject: 'Payment due Oct 21'}))).toBe(true);
    expect(hasHardRisk(email({bodyText: 'Your account is past due.'}))).toBe(true);
    expect(hasHardRisk(email())).toBe(false);
  });
});

describe('the history pass reads without a model', () => {
  test.each<[string, string, string | null, string | null]>([
    // from name, address, organisation, via
    ['Woodgrove Bank', 'no-reply@woodgrovebank.example', 'Woodgrove Bank', null],
    ['Woodgrove Bank Alerts', 'alerts@woodgrovebank.example', 'Woodgrove Bank', null],
    ['Northwind Recruiting via Greenhouse', 'no-reply@greenhouse.example', 'Northwind Recruiting', 'Greenhouse'],
    ['Priya Raman', 'no-reply@northwind.example', 'Northwind', null],
    ['Sam Lee', 'sam.lee@example.com', 'Sam Lee', null],
    ['', 'digest@eng.northwind.example', 'Northwind', null],
  ])('organisationFromSender(%s, %s)', (name, address, organisation, via) => {
    expect(organisationFromSender(name, address)).toEqual({organisation, via});
  });

  test.each<[string, string, string | null]>([
    ['Update on your application', 'Unfortunately, we won\'t be moving forward.', 'rejection'],
    ['Delivered: desk lamp', '', 'shipping'],
    ['Statement ready', '', 'statement'],
    ['You sent $42.00 to Sam Lee', '', 'receipt'],
    ['Application received', '', 'confirmation'],
    ['Security alert', 'A new sign-in on a MacBook Pro.', 'alert'],
    ['Lab 5 posted', 'It\'s due on Wednesday.', 'deadline'],
    ['Northwind Engineering Digest', '', 'newsletter'],
    ['Dinner Friday?', 'Blue Door at 7?', null],
  ])('typeFromText(%s)', (subject, body, type) => {
    expect(typeFromText(subject, body)).toBe(type);
  });

  test('bulk mail with an unsubscribe footer is Noise; anything important or personal stays FYI', () => {
    const bulk = {fromName: 'Tailspin Toys', fromAddress: 'news@tailspintoys.example', subject: 'New arrivals', bodyText: 'Shop now. Unsubscribe'};
    expect(historyReading(bulk)).toMatchObject({lane: 'noise', kind: null, organisation: 'Tailspin Toys'});
    expect(historyReading({...bulk, subject: 'Your payment is due'}).lane).toBe('fyi');
    expect(historyReading({...bulk, fromAddress: 'sam@tailspintoys.example'}).lane).toBe('fyi');
    expect(historyReading({fromName: 'Consolidated Messenger', fromAddress: 'mcinfo@consolidatedmessenger.example', subject: 'Out for delivery', bodyText: ''}))
      .toMatchObject({lane: 'fyi', kind: 'deliveries', type: 'shipping'});
  });
});
