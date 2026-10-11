// No test reaches past 127.0.0.1 (AGENTS.md › Tests own behaviour): providers are faked at the HTTP
// boundary, so a request anywhere else is a test pointed at a real provider by mistake.
const realFetch = globalThis.fetch;

globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost' && url.hostname !== '[::1]') {
    return Promise.reject(new Error(`A test tried to reach ${url.origin}; fake it on 127.0.0.1.`));
  }
  return realFetch(input, init);
};
