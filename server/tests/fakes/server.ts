// A fake provider on 127.0.0.1: a small router over node:http that records every request and
// answers as the provider does, including its errors. Faults are queued per route ("the next
// PATCH of this event answers 409") or made to hang, so tests take adapters through 401, 409,
// 410, 429 and timeouts without reaching any real provider.
import http from 'node:http';
import type {AddressInfo} from 'node:net';
import {onTestFinished} from 'vitest';

export interface FakeRequest {
  method: string;
  path: string;
  query: URLSearchParams;
  headers: http.IncomingHttpHeaders;
  // Parsed JSON, a form's fields, or the raw text.
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  text: string;
}

export interface FakeResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type Route = {method: string; pattern: RegExp; handle: (request: FakeRequest, match: RegExpExecArray) => FakeResponse};

export interface Fault {
  method?: string;
  // Matches the path (and its query string).
  path: RegExp;
  // An answer, or 'hang' to never answer (a timeout).
  response: FakeResponse | 'hang';
  // How many requests it answers; Infinity until cleared.
  times: number;
}

export interface FakeServer {
  url: string;
  requests: FakeRequest[];
  fault(fault: Omit<Fault, 'times'> & {times?: number}): void;
  clearFaults(): void;
}

function parseBody(text: string, type: string | undefined): unknown {
  if (!text) return null;
  if (type?.includes('application/json')) return JSON.parse(text);
  if (type?.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(text));
  return text;
}

export async function fakeServer(routes: Route[]): Promise<FakeServer> {
  const requests: FakeRequest[] = [];
  let faults: Fault[] = [];
  const hanging = new Set<http.ServerResponse>();
  const server = http.createServer((incoming, response) => {
    let text = '';
    incoming.on('data', chunk => (text += chunk));
    incoming.on('end', () => {
      const url = new URL(incoming.url ?? '/', 'http://127.0.0.1');
      const request: FakeRequest = {
        method: incoming.method ?? 'GET', path: url.pathname, query: url.searchParams, headers: incoming.headers,
        body: parseBody(text, incoming.headers['content-type']), text,
      };
      requests.push(request);
      const send = (answer: FakeResponse) => {
        // Bytes (an image) go as they are.
        const bytes = Buffer.isBuffer(answer.body);
        const json = answer.body !== undefined && typeof answer.body !== 'string' && !bytes;
        response.writeHead(answer.status, {...(json ? {'content-type': 'application/json; charset=UTF-8'} : {}), ...answer.headers});
        response.end(answer.body === undefined ? undefined : bytes ? answer.body as Buffer : json ? JSON.stringify(answer.body) : String(answer.body));
      };
      const fault = faults.find(candidate => (!candidate.method || candidate.method === request.method) && candidate.path.test(`${url.pathname}${url.search}`));
      if (fault) {
        fault.times -= 1;
        if (fault.times <= 0) faults = faults.filter(candidate => candidate !== fault);
        if (fault.response === 'hang') {
          hanging.add(response);
          return;
        }
        return send(fault.response);
      }
      for (const route of routes) {
        if (route.method !== request.method) continue;
        const match = route.pattern.exec(url.pathname);
        if (!match) continue;
        try {
          return send(route.handle(request, match));
        } catch (error) {
          return send({status: 500, body: {error: {code: 500, message: error instanceof Error ? error.message : String(error)}}});
        }
      }
      send({status: 404, body: {error: {code: 404, message: `No fake route for ${request.method} ${url.pathname}`}}});
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  onTestFinished(() => new Promise<void>(resolve => {
    for (const response of hanging) response.destroy();
    server.closeAllConnections();
    server.close(() => resolve());
  }));
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    fault: fault => faults.push({times: 1, ...fault}),
    clearFaults: () => (faults = []),
  };
}

/** A route: `on('PATCH', /^\/calendars\/([^/]+)\/events\/([^/]+)$/, handle)`. */
export const on = (method: string, pattern: RegExp, handle: Route['handle']): Route => ({method, pattern, handle});
