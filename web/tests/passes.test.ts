import {describe, expect, it} from 'vitest';
import type {Check, Pass} from './passes.ts';
import {missing, reads, specName} from './passes.ts';

const pass = (specs?: Record<string, string>): Pass => ({check: 'browser', specs, env: 'e', dir: '/x', at: '2026-10-16T18:00:00Z'});
const NOW = {calendar: 'c1', mail: 'm1', search: 's1', selection: 'l1'};

describe('missing', () => {
  it.each([
    ['nothing recorded', [], ['calendar', 'mail', 'search', 'selection']],
    ['a whole run', [pass(NOW)], []],
    ['a smaller run', [pass({selection: 'l1'})], ['calendar', 'mail', 'search']],
    ['smaller runs together', [pass({mail: 'm1', selection: 'l1'}), pass({calendar: 'c1', search: 's1'})], []],
    ['a spec file changed since it ran', [pass({...NOW, mail: 'm0'})], ['mail']],
    ['a pass with no spec files (npm test)', [pass()], ['calendar', 'mail', 'search', 'selection']],
    ['a spec file since removed', [pass({old: 'o1', mail: 'm1'})], ['calendar', 'search', 'selection']],
  ] as const)('%s', (_, passes, left) => {
    expect(missing(NOW, [...passes])).toEqual(left);
  });
});

// Which checks read a file, so which a commit changing only it runs again (SV-193).
describe('reads', () => {
  const CHECKS: Check[] = ['unit', 'image', 'browser'];
  it.each([
    ['AGENTS.md', []],
    ['docs/media/board.png', []],
    ['reviews/2026-10-15-single-value-checks.md', []],
    ['server/src/jobs/README.md', ['unit', 'image', 'browser']],
    ['design-export/boards/11-calendar.html', []],
    ['design-export/styles/setpoint.css', ['unit', 'browser']],
    ['design-export/glyphs/icons.json', ['unit', 'browser']],
    ['Dockerfile', ['image']],
    ['.dockerignore', ['image']],
    ['package-lock.json', ['unit', 'image', 'browser']],
    ['shared/contract/mail-inbox.json', ['unit', 'image']],
    ['server/tests/fakeGoogle.ts', ['unit', 'image']],
    ['web/tests/inbox.test.ts', ['unit', 'image']],
    ['web/tests/components/select.test.tsx', ['unit', 'image']],
    ['extension/src/words.ts', ['unit', 'image']],
    ['eslint.config.js', ['unit']],
    ['server/src/server.ts', ['unit', 'image', 'browser']],
    ['server/src/domain/new-module.ts', ['unit', 'image', 'browser']],
    ['web/src/tokens.ts', ['unit', 'image', 'browser']],
    ['web/tests/browser/harness.ts', ['unit', 'image', 'browser']],
    // Each spec file counts on its own for the browser checks (missing, above).
    ['web/tests/browser/mail.spec.ts', ['unit', 'image']],
  ] as const)('%s', (file, checks) => {
    expect(CHECKS.filter(check => reads(check, file))).toEqual(checks);
  });
});

describe('specName', () => {
  it.each([
    ['mail.spec.ts', 'mail'],
    ['/a/web/tests/browser/calendarFeel.spec.ts', 'calendarFeel'],
  ])('%s', (file, name) => {
    expect(specName(file)).toBe(name);
  });
});
