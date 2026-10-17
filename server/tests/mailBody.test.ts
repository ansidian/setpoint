// The reader's two byte routes over the seed: an email's HTML body as its own page with its own
// policy (images by the remote-content rule, or Show), and an attachment through the dev provider.
import {eq} from 'drizzle-orm';
import {describe, expect, test} from 'vitest';
import * as t from '../src/db/schema.ts';
import {FIXTURES} from '../src/dev/fixtures/index.ts';
import {contentDisposition} from '../src/queries/mailBody.ts';
import {devProvider} from '../src/providers/dev/index.ts';
import {SyncEngine} from '../src/sync/engine.ts';
import {Adapters} from '../src/sync/registry.ts';
import {client, signedIn, world} from './helpers.ts';

const idOf = (w: ReturnType<typeof world>, subject: string) => w.store.db.select().from(t.messages).where(eq(t.messages.subject, subject)).get()!.id;

describe('GET /api/mail/messages/:id/body', () => {
  async function coffee() {
    const w = world({seed: true});
    FIXTURES['coffee-html']!.apply({sqlite: w.store.sqlite, db: w.store.db});
    return {w, api: await signedIn(w), id: idOf(w, 'The Contoso Coffee Journal · October')};
  }

  test('Noise, sender not authenticated: placeholders, and a policy that lets no image in', async () => {
    const {api, id} = await coffee();
    const page = await api.send('GET', `/api/mail/messages/${id}/body`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toMatch(/^text\/html/);
    const policy = page.headers.get('content-security-policy')!;
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain('img-src data:;');
    expect(policy).not.toContain('https:');
    expect(policy).toContain('sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox');
    expect(page.headers.get('referrer-policy')).toBe('no-referrer');
    expect(page.body).not.toContain('<img');
    expect(page.body.match(/data-hidden-image/g)).toHaveLength(7);
  });

  test('Show (?images=show) lets https images in, and keeps them', async () => {
    const {api, id} = await coffee();
    const page = await api.send('GET', `/api/mail/messages/${id}/body?images=show`);
    expect(page.headers.get('content-security-policy')).toContain('img-src data: https:;');
    expect(page.body.match(/<img src="https:\/\/cdn\.contosocoffee\.example\//g)).toHaveLength(7);
  });

  test('the iPhone app\'s frame (?frame=app): the same page and placeholders, with no script and a policy that lets none run', async () => {
    const {api, id} = await coffee();
    const web = await api.send('GET', `/api/mail/messages/${id}/body`);
    const app = await api.send('GET', `/api/mail/messages/${id}/body?frame=app`);
    expect(app.status).toBe(200);
    expect(web.body).toContain('<script>');
    expect(app.body).not.toContain('<script');
    expect(app.body).toBe(web.body.replace(/<script>[\s\S]*<\/script>/, ''));
    expect(app.body.match(/data-hidden-image/g)).toHaveLength(7);
    const policy = app.headers.get('content-security-policy')!;
    expect(policy).toContain("script-src 'none';");
    expect(policy).toContain('img-src data:;');
    expect(policy).toContain('sandbox allow-popups allow-popups-to-escape-sandbox');
    expect(policy).not.toContain('allow-scripts');
    expect(app.headers.get('referrer-policy')).toBe('no-referrer');
    const shown = await api.send('GET', `/api/mail/messages/${id}/body?frame=app&images=show`);
    expect(shown.headers.get('content-security-policy')).toContain('img-src data: https:;');
    expect(shown.body.match(/<img src="https:\/\/cdn\.contosocoffee\.example\//g)).toHaveLength(7);
    expect(shown.body).not.toContain('<script');
  });

  test('a trusted domain loads them without Show; so does an authenticated sender that isn\'t Noise', async () => {
    const {w, api, id} = await coffee();
    await api.send('POST', '/api/mail/trusted-domains', {body: {domain: 'contosocoffee.example'}});
    expect((await api.send('GET', `/api/mail/messages/${id}/body`)).headers.get('content-security-policy')).toContain('https:');
    await api.send('DELETE', '/api/mail/trusted-domains/contosocoffee.example');
    w.store.db.update(t.messages).set({lane: 'fyi', kind: 'updates', senderAuthenticated: true}).where(eq(t.messages.id, id)).run();
    expect((await api.send('GET', `/api/mail/messages/${id}/body`)).headers.get('content-security-policy')).toContain('https:');
  });

  test('plain-text email has no body page; signed out is refused', async () => {
    const {w, api, id} = await coffee();
    expect((await api.send('GET', `/api/mail/messages/${idOf(w, 'Interview availability for Software Engineer I')}/body`)).status).toBe(404);
    expect((await client(w).send('GET', `/api/mail/messages/${id}/body`)).status).toBe(401);
  });
});

describe('GET /api/mail/messages/:id/attachments/:attachment through the dev provider', () => {
  test('Parkside\'s agreement: a PDF stand-in, inline, with its name', async () => {
    const w = world({seed: true});
    const engine = new SyncEngine({store: w.store, adapters: new Adapters({}, devProvider())});
    const api = await signedIn(w, {engine});
    const id = idOf(w, 'Lease renewal terms');
    const file = w.store.db.select().from(t.attachments).where(eq(t.attachments.messageId, id)).get()!;
    const response = await api.send('GET', `/api/mail/messages/${id}/attachments/${file.id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toBe(`inline; filename="Renewal agreement.pdf"; filename*=UTF-8''Renewal%20agreement.pdf`);
    expect(response.body).toMatch(/^%PDF-1\.4[\s\S]*\(Renewal agreement\.pdf\) Tj[\s\S]*%%EOF\n$/);
  });

  test('without an engine, nothing serves it', async () => {
    const w = world({seed: true});
    const api = await signedIn(w);
    const id = idOf(w, 'Lease renewal terms');
    const file = w.store.db.select().from(t.attachments).where(eq(t.attachments.messageId, id)).get()!;
    expect((await api.send('GET', `/api/mail/messages/${id}/attachments/${file.id}`)).status).toBe(404);
  });

  test.each([
    ['plain', 'Renewal agreement.pdf', `inline; filename="Renewal agreement.pdf"; filename*=UTF-8''Renewal%20agreement.pdf`],
    ['quotes and accents', 'Résumé "final".pdf', `inline; filename="R_sum_ _final_.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%22final%22.pdf`],
    ['apostrophes and brackets', 'Sam\'s (1).csv', `inline; filename="Sam's (1).csv"; filename*=UTF-8''Sam%27s%20%281%29.csv`],
  ])('Content-Disposition: %s', (_name, filename, header) => {
    expect(contentDisposition('inline', filename)).toBe(header);
  });
});
