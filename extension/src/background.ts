// Setpoint on LinkedIn's service worker (SV-174). It asks Setpoint's POST /api/jobs/check about
// postings (the job pane's, or a page of the list's cards at once) with the extension's own token,
// kept in chrome.storage.local beside Setpoint's address. The request is made here rather than on
// LinkedIn's page, so the page never sees the token, and the host permission the options page asks
// for lets it reach Setpoint without CORS. It also keeps each tab's toolbar badge, which says when
// the page couldn't be read (watch.ts).
import {JOBS_CHECK_MAX} from '@setpoint/shared';
import type {JobsCheckOut} from '@setpoint/shared';
import {replyOf} from './reply.ts';
import type {Asked, CheckReply, Message} from './reply.ts';
import {badgeOf} from './watch.ts';

// Setpoint's caution (DESIGN.md › Colour, Light), as the badge takes a hex colour.
const CAUTION = '#b6420f';

chrome.runtime.onMessage.addListener((message: Message, sender, reply) => {
  if (message?.type === 'check') {
    check(message.postings).then(reply);
    // The reply comes after an await.
    return true;
  }
  if (message?.type === 'options') chrome.runtime.openOptionsPage();
  if (message?.type === 'page' && sender.tab?.id !== undefined) {
    const tabId = sender.tab.id;
    const badge = badgeOf(message.unread);
    chrome.action.setBadgeText({tabId, text: badge.text});
    chrome.action.setBadgeBackgroundColor({tabId, color: CAUTION});
    chrome.action.setTitle({tabId, title: badge.title});
  }
  return false;
});

/**
 * Postings' applications, in the order asked, or why there are none to show. The page sends every
 * posting it hasn't asked about in one message, and they go to Setpoint as many at a time as the
 * route takes: a page of 25 cards and the pane is one request.
 */
async function check(postings: Asked[]): Promise<CheckReply> {
  const {origin, token} = await chrome.storage.local.get(['origin', 'token']);
  if (typeof origin !== 'string' || typeof token !== 'string' || !origin || !token) return {ok: false, reason: 'setup'};
  let enabled = true;
  const answers: JobsCheckOut['postings'] = [];
  for (let start = 0; start < postings.length; start += JOBS_CHECK_MAX) {
    const reply = await askSetpoint(origin, token, postings.slice(start, start + JOBS_CHECK_MAX));
    if (!reply.ok) return reply;
    enabled = reply.data.enabled;
    answers.push(...reply.data.postings);
  }
  return {ok: true, origin, data: {enabled, postings: answers}};
}

/** One request's answer, at most JOBS_CHECK_MAX postings. */
async function askSetpoint(origin: string, token: string, postings: Asked[]): Promise<CheckReply> {
  let response: Response;
  try {
    response = await fetch(new URL('/api/jobs/check', origin), {
      method: 'POST', headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'},
      body: JSON.stringify({postings}), credentials: 'omit', cache: 'no-store',
    });
  } catch (error) {
    // Unreachable, or the host permission was never granted (the fetch fails the same way).
    return {ok: false, reason: 'unreachable', detail: error instanceof Error ? error.message : String(error)};
  }
  const body: unknown = await response.json().catch(() => undefined);
  return replyOf(response.status, body, postings.length, origin);
}
