// What search indexes of an email's body (SV-135): `body_text` without its links and footers. Most of
// what's in a marketing email's text is tracking links, so a word in a URL's path or query matched
// as if the email had said it. A link leaves its domain behind as a word, once per email: a sender
// can be findable only through the site its links go to. `body_text` itself stays as it is, since
// the reader, triage, Alfred and Jobs read it.
//
// A footer here is a line that's plainly the mailing's own boilerplate, near the end of the email:
// an unsubscribe or preferences line, why you're getting this, a copyright line. Losing a footer
// line only keeps noise, and losing a real line loses a search, so anything unsure stays: an address,
// a signature, a line that says more than the boilerplate does, and quoted replies.
// The links of a footer line still leave their domains, at the end. Pure: a string in, a string out.

// Only this many lines from the end can be a footer, so a mention earlier in the email is never one.
const FOOTER_LINES = 15;
// A longer line says more than boilerplate does.
const FOOTER_LINE_MAX = 300;

// A link, with a bracket that wraps it: "Pay now [https://…]", "<https://…>", "(https://…)".
const LINK = /([[<(]?)((?:https?:\/\/|\bwww\.)[^\s<>"\]]+)([\]>]?)/gi;
// Punctuation after a link belongs to the sentence around it.
const AFTER_LINK = /[.,;:!?'")}*_]+$/;
const HOST = /^(?:[a-z]+:\/\/)?(?:[^/?#@]*@)?([^/?#:]+)/i;

// A host's subdomains that say how mail is delivered rather than who it's from.
const PLUMBING = new Set([
  'click', 'clicks', 'e', 'em', 'email', 'emails', 'go', 'l', 'link', 'links', 'lnk', 'm', 'mail', 'mailer', 'news', 'newsletter',
  'r', 'redirect', 't', 'tr', 'track', 'tracking', 'trk', 'u', 'url', 'www',
]);
// A generated subdomain ("u1234567").
const NUMBERED = /\d{4}/;

/** The words a link's host leaves: its name and telling subdomains, without the TLD ("pay.contoso.co.uk" gives pay contoso). */
function hostWords(url: string): string[] {
  const labels = (HOST.exec(url)?.[1] ?? '').toLowerCase().split('.').filter(Boolean);
  if (labels[0] === 'www') labels.shift();
  if (labels.length < 2) return labels;
  if (labels.every(label => /^\d+$/.test(label))) return [];
  const countryPair = labels.length > 2 && labels.at(-1)!.length === 2 && labels.at(-2)!.length <= 3;
  const named = labels.slice(0, countryPair ? -2 : -1);
  const name = named.at(-1)!;
  return [...named.slice(0, -1).filter(label => !PLUMBING.has(label) && !NUMBERED.test(label)), name];
}

/** The line with each link replaced by what `wordsFor` gives, its wrapping bracket gone with it. */
function replaceLinks(line: string, wordsFor: (url: string) => string): string {
  return line.replace(LINK, (_, open: string, found: string, close: string) => {
    const after = AFTER_LINK.exec(found)?.[0] ?? '';
    const url = found.slice(0, found.length - after.length);
    const wrapped = (open === '[' && close === ']') || (open === '<' && close === '>');
    const roundWrapped = open === '(' && after.startsWith(')');
    return `${wrapped || roundWrapped ? '' : open}${wordsFor(url)}${roundWrapped ? after.slice(1) : after}${wrapped ? '' : close}`;
  });
}

// A line of nothing but these, split at | · •: at least one a strong one, since "Contact us" alone
// could be anyone's.
const FOOTER_STRONG_LINK = /^(?:unsubscribe(?: here)?|(?:manage|update|change)(?: your)?(?: (?:email|mail|communication|notification))? (?:preferences|subscriptions?)|(?:email|mail|communication|notification|subscription) preferences|preferences|privacy(?: policy| notice| statement)?|terms(?: of (?:service|use)| (?:and|&) conditions)?)$/;
const FOOTER_LINK = /^(?:contact us|help|help cent(?:er|re)|support|about us|faqs?|view (?:in|on)(?: your)? (?:browser|web)|view online)$/;

const FOOTER_SENTENCES = [
  // "If you no longer wish to receive these emails, unsubscribe here."
  /^if you (?:no longer|do not|don'?t|would (?:no longer )?like|wish|want|prefer)\b.*\b(?:unsubscribe|opt[- ]?out|(?:email|mailing) preferences|manage your (?:subscription|preferences))\b/,
  // "To unsubscribe, click here." "You can update your preferences at any time."
  /^(?:please )?(?:click here to |you (?:can|may)(?: always| also)? |to )(?:unsubscribe\b|(?:update|manage|change) your (?:email |mail )?(?:preferences|subscriptions?)\b|opt[- ]?out of (?:(?:these|this|future|our|all|marketing|promotional) )+(?:e-?mails?|messages?|communications?|mailings?|marketing)\b)/,
  /^unsubscribe (?:here|at any time|from (?:this (?:list|mailing list)|these e-?mails|our (?:e-?mails|mailing list)|(?:future|all) e-?mails))\b/,
  // Why it came, only for a mailing: a reason about the reader's own business is content.
  /^you(?:'re| are)? (?:receiving|received|getting) this\b.*\bbecause you(?:'ve| have| are|'re)? (?:signed up|subscribed|opted in|registered|joined|a (?:subscriber|member))\b/,
  /^this (?:e-?mail|message) was sent to\b/,
  /^(?:copyright )?(?:©|\(c\)|copyright)\s*(?:19|20)\d{2}\b/,
  /\ball rights reserved\.?$/,
  /^view (?:this )?(?:e-?mail|message|newsletter) (?:in|on) (?:your |a |the )?(?:browser|web)\b/,
];

function isFooterLine(line: string): boolean {
  const text = line.replace(/^[\s|·•*_-]+|[\s|·•*_-]+$/g, '').replace(/\s+/g, ' ').toLowerCase();
  if (!text || text.length > FOOTER_LINE_MAX) return false;
  const links = text.split(/\s*[|·•]\s*/).filter(Boolean);
  if (links.some(link => FOOTER_STRONG_LINK.test(link)) && links.every(link => FOOTER_STRONG_LINK.test(link) || FOOTER_LINK.test(link))) return true;
  return FOOTER_SENTENCES.some(sentence => sentence.test(text));
}

/** The indexes of the footer lines. */
function footerLines(lines: string[]): Set<number> {
  const footer = new Set<number>();
  let left = FOOTER_LINES;
  for (let at = lines.length - 1; at >= 0 && left > 0; at -= 1) {
    const text = replaceLinks(lines[at]!, () => '');
    if (!text.trim() && !lines[at]!.trim()) continue;
    left -= 1;
    if (isFooterLine(text)) footer.add(at);
  }
  return footer;
}

/** The body as search indexes it: no links or footers, each link's domain kept once as a word. */
export function searchBody(body: string): string {
  const lines = body.replace(/\bmailto:/gi, '').split(/\r?\n/);
  const footer = footerLines(lines);
  const seen = new Set<string>();
  const newWords = (url: string) => {
    const words = hostWords(url).filter(word => !seen.has(word));
    words.forEach(word => seen.add(word));
    return words.join(' ');
  };
  const kept = lines.flatMap((line, at) => (footer.has(at) ? [] : [replaceLinks(line, newWords)]));
  // Their words come last, so a domain the body links to stays where the body has it.
  const fromFooter: string[] = [];
  for (const at of footer) replaceLinks(lines[at]!, url => {
    fromFooter.push(newWords(url));
    return '';
  });
  return [...kept, fromFooter.filter(Boolean).join(' ')]
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
