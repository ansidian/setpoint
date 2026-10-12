// ntfy, notify()'s delivery: one JSON publish to the server's root (ntfy's "publish as JSON"),
// with the topic, a title, the body and a click link. The user's server may want a token.
export interface NtfyMessage {
  topic: string;
  title: string;
  message: string;
  click: string | null;
  tags: string[];
  priority: 1 | 2 | 3 | 4 | 5;
}

export const NTFY_TIMEOUT_MS = 10_000;

/** The server as the user knows it, by its host: "ntfy.example.net". */
function hostOf(server: string): string {
  try {
    return new URL(server).host;
  } catch {
    return server;
  }
}

/**
 * Publishes, or throws in words the user can act on (the polish audit's states-11): "Can’t reach
 * ntfy.example.net", "ntfy.example.net didn’t answer in time", or "ntfy answered 401, unauthorized"
 * with ntfy's own words, never the network library's "fetch failed".
 */
export async function publishToNtfy(fetcher: typeof fetch, server: string, token: string | null, message: NtfyMessage): Promise<void> {
  const body = {topic: message.topic, title: message.title, message: message.message, tags: message.tags, priority: message.priority, ...(message.click ? {click: message.click} : {})};
  let response: Response;
  try {
    response = await fetcher(server.replace(/\/+$/, '/'), {
      method: 'POST',
      headers: {'content-type': 'application/json', ...(token ? {authorization: `Bearer ${token}`} : {})},
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(NTFY_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) throw new Error(`${hostOf(server)} didn’t answer in time`, {cause: error});
    throw new Error(`Can’t reach ${hostOf(server)}`, {cause: error});
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let reason = text.trim();
    try {
      const parsed = JSON.parse(text) as {error?: string};
      if (parsed.error) reason = parsed.error;
    } catch {
      // Not JSON: ntfy's words as they are.
    }
    throw new Error(`ntfy answered ${response.status}${reason ? `, ${reason}` : ''}`);
  }
}
