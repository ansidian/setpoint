// Builds RFC 822 messages for the provider fakes, the way a sender's mail server would, with the
// receiving provider's Authentication-Results on top when asked. Invented example domains only.
import {randomBytes} from 'node:crypto';

export interface RawEmailInput {
  from: string;
  to?: string;
  subject: string;
  date: string;
  text?: string;
  html?: string;
  messageId?: string;
  references?: string;
  // Header lines the receiver added above the sender's (Authentication-Results, Received…).
  received?: [string, string][];
  attachments?: {filename: string; contentType: string; content: string; inline?: boolean}[];
}

const base64Lines = (value: string) => Buffer.from(value).toString('base64').replace(/.{1,76}/g, line => `${line}\r\n`);

export function rawEmail(input: RawEmailInput): Buffer {
  const messageId = input.messageId ?? `<${randomBytes(6).toString('hex')}@mail.example.com>`;
  const headers = [
    ...(input.received ?? []).map(([name, value]) => `${name}: ${value}`),
    `From: ${input.from}`,
    `To: ${input.to ?? 'user@example.net'}`,
    `Subject: ${input.subject}`,
    `Date: ${new Date(input.date).toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: ${messageId}`,
    ...(input.references ? [`References: ${input.references}`, `In-Reply-To: ${input.references.split(/\s+/).at(-1)}`] : []),
    'MIME-Version: 1.0',
  ];
  const text = input.text ?? '';
  const alternative = input.html
    ? {type: 'multipart/alternative; boundary="alt"', body: [
      '--alt', 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: quoted-printable', '', text,
      '--alt', 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', base64Lines(input.html), '--alt--',
    ].join('\r\n')}
    : {type: 'text/plain; charset=utf-8', body: text};
  if (!input.attachments?.length) {
    return Buffer.from([...headers, `Content-Type: ${alternative.type}`, '', alternative.body, ''].join('\r\n'));
  }
  const parts = input.attachments.map((file, index) => [
    '--mixed',
    `Content-Type: ${file.contentType}; name="${file.filename}"`,
    `Content-Disposition: ${file.inline ? 'inline' : 'attachment'}; filename="${file.filename}"`,
    ...(file.inline ? [`Content-ID: <inline-${index}@mail.example.com>`] : []),
    'Content-Transfer-Encoding: base64', '', base64Lines(file.content),
  ].join('\r\n'));
  return Buffer.from([
    ...headers, 'Content-Type: multipart/mixed; boundary="mixed"', '',
    '--mixed', `Content-Type: ${alternative.type}`, '', alternative.body,
    ...parts, '--mixed--', '',
  ].join('\r\n'));
}

/** Gmail's verdict for a sender whose DMARC passed (or failed) at mx.google.com. */
export const gmailVerdict = (domain: string, dmarc: 'pass' | 'fail' = 'pass'): [string, string][] => [
  ['Authentication-Results', `mx.google.com; dkim=pass header.i=@${domain} header.s=mail; spf=pass smtp.mailfrom=bounce@${domain}; dmarc=${dmarc} (p=REJECT) header.from=${domain}`],
];
