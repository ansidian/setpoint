// Jobs in mail (J7; DESIGN.md › Jobs › In mail; boards 37a–37c; D306) through its one route, against
// the seed: the application an email belongs to (the reader's JD chip), Applied before on the Indeed
// match email (the row's and the reader's badge), a correction's alias still matching, nothing while
// Jobs is off, and mail's counts as they were (D313). The company matching itself is reading.test.ts's table.
import {jobsMailSchema} from '@setpoint/shared';
import type {JobsMailOut} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import {signedIn, world} from '../../../tests/helpers.ts';
import * as t from '../../db/schema.ts';
import {mailCounts} from '../../queries/mail.ts';
import {jobsApi} from '../api.ts';

async function seeded() {
  const w = world({seed: true});
  const c = await signedIn(w, {routes: [jobsApi(w.store)]});
  const message = (subject: string) => w.store.db.select({id: t.messages.id}).from(t.messages).where(eq(t.messages.subject, subject)).get()!.id;
  const ask = async (ids: number[]): Promise<JobsMailOut> => {
    const answer = await c.send('GET', `/api/jobs/mail?messages=${ids.join(',')}`);
    expect(answer.status).toBe(200);
    return jobsMailSchema.parse(answer.body);
  };
  return {w, c, message, ask};
}

describe('GET /api/jobs/mail', () => {
  test('a page of rows in one request: only the emails with something, in the order asked', async () => {
    const {w, message, ask} = await seeded();
    const northwind = message('Interview availability for Software Engineer I');
    const confirmation = message('Thanks for applying');
    const indeed = message('Associate Software Engineer @ Contoso Pharmaceuticals');
    const fabrikam = message('Application received');
    // Every email the Inbox holds, at once.
    const all = w.store.db.select({id: t.messages.id}).from(t.messages).all().map(row => row.id).reverse();
    const answer = await ask(all);
    expect(answer.messages.map(each => each.message_id)).toEqual(all.filter(id => [confirmation, northwind, indeed, fabrikam].includes(id)));

    const {messages: [chip]} = await ask([northwind]);
    expect(chip).toMatchObject({
      message_id: northwind, applied_before: null,
      application: {company: 'Northwind Talent', title: 'Software Engineer I', applied_on: '2026-10-01', status: 'in_process', ghosted: false},
    });
    // Its confirmation belongs to it too.
    expect((await ask([confirmation])).messages[0]!.application!.id).toBe(chip!.application!.id);
  });

  test('Applied before on the Indeed match email: Contoso Pharmaceuticals, Applied Sep 16 · Rejected Oct 5', async () => {
    const {message, ask} = await seeded();
    const indeed = message('Associate Software Engineer @ Contoso Pharmaceuticals');
    expect((await ask([indeed])).messages).toEqual([{
      message_id: indeed, application: null,
      applied_before: {
        query: 'contoso pharmaceuticals', count: 1,
        latest: expect.objectContaining({company: 'Contoso Pharmaceuticals', applied_on: '2026-09-16', status: 'rejected', status_on: '2026-10-05'}),
      },
    }]);
    // The Inbox's older Northwind rejections aren't match emails, and belong to nothing: nothing.
    expect((await ask([message('Update on your application'), message('Your application for Data Engineer Intern')])).messages).toEqual([]);
  });

  test('a company edited by hand still answers to the old one (stick.ts), and the badge names the new', async () => {
    const {c, message, ask} = await seeded();
    const indeed = message('Associate Software Engineer @ Contoso Pharmaceuticals');
    const before = (await ask([indeed])).messages[0]!.applied_before!;
    const edited = await c.send('PATCH', `/api/jobs/applications/${before.latest.id}`, {body: {company: 'Contoso Pharma Labs'}});
    expect(edited.status).toBe(200);
    expect((await ask([indeed])).messages[0]!.applied_before).toMatchObject({query: 'contoso pharma labs', count: 1, latest: {id: before.latest.id, company: 'Contoso Pharma Labs'}});
  });

  test('with Jobs off, nothing; and mail\'s counts never change (D313)', async () => {
    const {w, c, message, ask} = await seeded();
    const counts = mailCounts(w.store);
    const ids = [message('Interview availability for Software Engineer I'), message('Associate Software Engineer @ Contoso Pharmaceuticals')];
    expect((await ask(ids)).messages).toHaveLength(2);
    expect(mailCounts(w.store)).toEqual(counts);
    expect((await c.send('PATCH', '/api/jobs/settings', {body: {enabled: false}})).status).toBe(200);
    expect((await ask(ids)).messages).toEqual([]);
  });

  test.each([
    ['none', ''],
    ['not ids', 'abc'],
    ['a zero', '0,4'],
    ['a trailing comma', '4,'],
    ['more than 500', Array.from({length: 501}, (_, index) => index + 1).join(',')],
  ])('refuses %s', async (_, messages) => {
    const {c} = await seeded();
    expect((await c.send('GET', `/api/jobs/mail?messages=${messages}`)).status).toBe(400);
  });
});
