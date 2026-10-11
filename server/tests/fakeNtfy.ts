// A fake ntfy on 127.0.0.1: it records each publish and answers as ntfy does, including its errors.
// No test reaches a real ntfy server.
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {onTestFinished} from 'vitest';

export interface Published {
  path: string;
  authorization: string | null;
  body: {topic: string; title: string; message: string; click?: string; tags: string[]; priority: number};
}

export async function fakeNtfy() {
  const published: Published[] = [];
  let refuse: {status: number; body: string} | null = null;
  const server = http.createServer((request, response) => {
    let text = '';
    request.on('data', chunk => (text += chunk));
    request.on('end', () => {
      if (refuse) {
        response.writeHead(refuse.status, {'content-type': 'application/json'}).end(refuse.body);
        return;
      }
      published.push({path: request.url ?? '', authorization: request.headers.authorization ?? null, body: JSON.parse(text)});
      response.writeHead(200, {'content-type': 'application/json'}).end(JSON.stringify({id: `msg${published.length}`, event: 'message'}));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  onTestFinished(() => new Promise<void>(resolve => {
    server.closeAllConnections();
    server.close(() => resolve());
  }));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    published,
    // Answers every publish with this until cleared, as ntfy does for a bad token or a full quota.
    refuseWith(status: number, error: string) {
      refuse = {status, body: JSON.stringify({code: status * 100 + 1, http: status, error})};
    },
    accept() {
      refuse = null;
    },
  };
}
