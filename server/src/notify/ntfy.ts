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

/** Publishes, or throws with ntfy's own words. */
export async function publishToNtfy(fetcher: typeof fetch, server: string, token: string | null, message: NtfyMessage): Promise<void> {
  const body = {topic: message.topic, title: message.title, message: message.message, tags: message.tags, priority: message.priority, ...(message.click ? {click: message.click} : {})};
  const response = await fetcher(server.replace(/\/+$/, '/'), {
    method: 'POST',
    headers: {'content-type': 'application/json', ...(token ? {authorization: `Bearer ${token}`} : {})},
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(NTFY_TIMEOUT_MS),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let reason = text.trim();
    try {
      const parsed = JSON.parse(text) as {error?: string};
      if (parsed.error) reason = parsed.error;
    } catch {
      // Not JSON: ntfy's words as they are.
    }
    throw new Error(`ntfy answered ${response.status}${reason ? `: ${reason}` : ''}`);
  }
}
