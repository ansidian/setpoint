// The options page (SV-174): Setpoint's address and the Jobs token, kept in chrome.storage.local
// (never synced). Saving asks Chrome for access to that address, which is how the service worker
// reaches Setpoint, then tries a check so a wrong address or token shows here rather than on a job board.
import type {CheckReply, Message} from './reply.ts';

const form = document.querySelector<HTMLFormElement>('#form')!;
const originField = document.querySelector<HTMLInputElement>('#origin')!;
const tokenField = document.querySelector<HTMLInputElement>('#token')!;
const statusLine = document.querySelector<HTMLElement>('#status')!;

const say = (text: string, bad = false) => {
  statusLine.textContent = text;
  statusLine.className = bad ? 'bad' : '';
};

void chrome.storage.local.get(['origin', 'token']).then(({origin, token}) => {
  if (typeof origin === 'string') originField.value = origin;
  if (typeof token === 'string') tokenField.value = token;
});

form.addEventListener('submit', event => {
  event.preventDefault();
  let url: URL;
  try {
    url = new URL(originField.value.trim());
  } catch {
    say('That isn\'t an address, like https://setpoint.example', true);
    return;
  }
  const token = tokenField.value.trim();
  // Asked straight away, while the click still counts as the user's: Chrome refuses it after an await.
  // The manifest offers https addresses and localhost's, so another http one is refused.
  chrome.permissions.request({origins: [`${url.protocol}//${url.hostname}/*`]}).then(async granted => {
    if (!granted) {
      say('Chrome wasn\'t given access to Setpoint\'s address, so the extension can\'t reach it', true);
      return;
    }
    await chrome.storage.local.set({origin: url.origin, token});
    say('Saved, testing…');
    const test: Message = {type: 'check', postings: [{company: 'Setpoint options test', title: 'Test'}]};
    const answer = await (chrome.runtime.sendMessage(test) as Promise<CheckReply | undefined>).catch(() => undefined);
    if (answer?.ok) say(answer.data.enabled ? 'Saved, Setpoint answered' : 'Saved, Setpoint answered, but Jobs is off there (Settings › Jobs)');
    else if (answer?.reason === 'token') say('Saved, but Setpoint refused the token', true);
    else if (answer?.reason === 'answer') say(['Saved, but Setpoint\'s answer isn\'t the shape this build reads', answer.detail].filter(Boolean).join(', '), true);
    else say(['Saved, but Setpoint didn\'t answer', answer?.detail].filter(Boolean).join(', '), true);
  }, (error: unknown) => {
    say(['Chrome can\'t be given that address, as only https ones and localhost are offered', error instanceof Error ? error.message : null].filter(Boolean).join(', '), true);
  });
});
