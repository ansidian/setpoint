// A small in-process IMAP server on 127.0.0.1 standing in for iCloud Mail: plain TCP (the adapter
// uses TLS against imap.mail.me.com), LOGIN with an app password, INBOX and "Deleted Messages"
// (special-use \Trash), and the commands Setpoint's IMAP client sends: CAPABILITY, LOGIN,
// NAMESPACE, LIST/LSUB, SELECT/EXAMINE, UID SEARCH (ALL, SINCE, UID, HEADER), UID FETCH (UID,
// FLAGS, INTERNALDATE, BODY[]), UID STORE ±FLAGS, UID MOVE with COPYUID, NOOP and LOGOUT. It answers
// as an IMAP server does, including NO [AUTHENTICATIONFAILED] for a revoked app password, and lets
// tests inject a NO, a dropped connection or a hang. Hand-written rather than a library: the
// maintained IMAP test servers are gone, and this keeps exactly the surface Setpoint relies on.
import net from 'node:net';
import type {AddressInfo} from 'node:net';
import {onTestFinished} from 'vitest';

interface Message {
  uid: number;
  flags: Set<string>;
  internalDate: Date;
  raw: Buffer;
}

interface Folder {
  name: string;
  specialUse: string | null;
  uidValidity: number;
  uidNext: number;
  messages: Message[];
}

type Token = string | Buffer | Token[];

const CAPABILITIES = 'IMAP4rev1 LITERAL+ UIDPLUS MOVE NAMESPACE';
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function imapDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getUTCDate())}-${MONTHS[date.getUTCMonth()]}-${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} +0000`;
}

function parseImapDay(value: string): Date {
  const [day, month, year] = value.split('-');
  return new Date(Date.UTC(Number(year), MONTHS.indexOf(month!), Number(day)));
}

/** Tokenises an IMAP command's arguments: atoms, quoted strings, literals (already read) and lists. */
function tokenize(input: Buffer[]): Token[] {
  // `input` alternates text and literal buffers.
  const out: Token[][] = [[]];
  for (const [at, part] of input.entries()) {
    if (at % 2 === 1) {
      out.at(-1)!.push(part);
      continue;
    }
    const text = part.toString('utf8');
    let i = 0;
    while (i < text.length) {
      const char = text[i]!;
      if (char === ' ') i += 1;
      else if (char === '(') {
        out.push([]);
        i += 1;
      } else if (char === ')') {
        const list = out.pop()!;
        out.at(-1)!.push(list);
        i += 1;
      } else if (char === '"') {
        let value = '';
        i += 1;
        while (i < text.length && text[i] !== '"') {
          if (text[i] === '\\') i += 1;
          value += text[i];
          i += 1;
        }
        i += 1;
        out.at(-1)!.push(value);
      } else if (char === '{') {
        // A literal marker: the literal itself is the next buffer.
        i = text.indexOf('}', i) + 1;
      } else {
        let end = i;
        // Atoms may carry brackets (BODY.PEEK[]); stop at a space or a closing paren.
        let depth = 0;
        while (end < text.length && (depth > 0 || (text[end] !== ' ' && text[end] !== ')' && text[end] !== '('))) {
          if (text[end] === '[') depth += 1;
          if (text[end] === ']') depth -= 1;
          end += 1;
        }
        out.at(-1)!.push(text.slice(i, end));
        i = end;
      }
    }
  }
  return out[0]!;
}

const str = (token: Token | undefined) => (Buffer.isBuffer(token) ? token.toString('utf8') : typeof token === 'string' ? token : '');

function uidSet(set: string, folder: Folder): Set<number> {
  const max = folder.messages.at(-1)?.uid ?? 0;
  const uids = new Set<number>();
  for (const part of set.split(',')) {
    const [a, b = a] = part.split(':').map(value => (value === '*' ? max : Number(value))) as [number, number?];
    const [low, high] = [Math.min(a, b!), Math.max(a, b!)];
    for (const message of folder.messages) if (message.uid >= low && message.uid <= high) uids.add(message.uid);
  }
  return uids;
}

export interface FakeImapUser {
  password: string;
  folders: Map<string, Folder>;
}

export async function fakeImap() {
  const users = new Map<string, FakeImapUser>();
  const sockets = new Set<net.Socket>();
  const commands: string[] = [];
  const injected: {pattern: RegExp; response: 'drop' | 'hang' | string; times: number}[] = [];
  let logins = 0;

  const user = (name: string) => {
    const found = users.get(name);
    if (!found) throw new Error(`No fake IMAP user ${name}`);
    return found;
  };

  function serve(socket: net.Socket) {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let account: FakeImapUser | null = null;
    let selected: Folder | null = null;
    let buffer = Buffer.alloc(0);
    // The command being read: its text parts and literals so far, and a literal still owed.
    let parts: Buffer[] = [];
    let owed = 0;
    const send = (line: string | Buffer) => socket.write(line);
    send(`* OK [CAPABILITY ${CAPABILITIES}] Fake iCloud IMAP ready\r\n`);

    const fetchLine = (folder: Folder, message: Message, items: string[]): Buffer[] => {
      const seq = folder.messages.indexOf(message) + 1;
      const fields: string[] = [`UID ${message.uid}`];
      if (items.includes('FLAGS')) fields.push(`FLAGS (${[...message.flags].join(' ')})`);
      if (items.includes('INTERNALDATE')) fields.push(`INTERNALDATE "${imapDate(message.internalDate)}"`);
      if (items.includes('RFC822.SIZE')) fields.push(`RFC822.SIZE ${message.raw.length}`);
      const body = items.some(item => /^BODY(\.PEEK)?\[\]$/.test(item));
      if (!body) return [Buffer.from(`* ${seq} FETCH (${fields.join(' ')})\r\n`)];
      return [Buffer.from(`* ${seq} FETCH (${fields.join(' ')} BODY[] {${message.raw.length}}\r\n`), message.raw, Buffer.from(')\r\n')];
    };

    function search(folder: Folder, criteria: Token[]): number[] {
      let matches = [...folder.messages];
      for (let i = 0; i < criteria.length; i += 1) {
        const key = str(criteria[i]).toUpperCase();
        if (key === 'ALL') continue;
        if (key === 'SINCE') {
          const day = parseImapDay(str(criteria[++i]));
          matches = matches.filter(message => message.internalDate >= day);
        } else if (key === 'BEFORE') {
          const day = parseImapDay(str(criteria[++i]));
          matches = matches.filter(message => message.internalDate < day);
        } else if (key === 'UID') {
          const set = uidSet(str(criteria[++i]), folder);
          matches = matches.filter(message => set.has(message.uid));
        } else if (key === 'HEADER') {
          const name = str(criteria[++i]).toLowerCase();
          const value = str(criteria[++i]).toLowerCase();
          matches = matches.filter(message => {
            const headers = message.raw.toString('utf8').split(/\r\n\r\n/)[0]!.split(/\r\n/);
            return headers.some(line => line.toLowerCase().startsWith(`${name}:`) && line.toLowerCase().includes(value));
          });
        } else if (/^[\d:*,]+$/.test(key)) {
          // A bare sequence set.
          continue;
        }
      }
      return matches.map(message => message.uid);
    }

    function run(tag: string, command: string, args: Token[]) {
      const line = `${command} ${args.map(arg => (Array.isArray(arg) ? '(…)' : str(arg))).join(' ')}`.trim();
      commands.push(line);
      const rule = injected.find(candidate => candidate.times > 0 && candidate.pattern.test(line));
      if (rule) {
        rule.times -= 1;
        if (rule.response === 'drop') return socket.destroy();
        if (rule.response === 'hang') return;
        return send(`${tag} ${rule.response}\r\n`);
      }
      const ok = (text = `${command} completed`) => send(`${tag} OK ${text}\r\n`);
      switch (command) {
        case 'CAPABILITY':
          send(`* CAPABILITY ${CAPABILITIES}\r\n`);
          return ok();
        case 'LOGIN': {
          const found = users.get(str(args[0]));
          if (!found || found.password !== str(args[1])) return send(`${tag} NO [AUTHENTICATIONFAILED] Authentication failed.\r\n`);
          account = found;
          logins += 1;
          return ok(`[CAPABILITY ${CAPABILITIES}] Logged in`);
        }
        case 'NAMESPACE':
          send('* NAMESPACE (("" "/")) NIL NIL\r\n');
          return ok();
        case 'LIST':
        case 'LSUB':
          for (const folder of account!.folders.values()) {
            send(`* ${command} (\\HasNoChildren${folder.specialUse ? ` ${folder.specialUse}` : ''}) "/" "${folder.name}"\r\n`);
          }
          return ok();
        case 'SELECT':
        case 'EXAMINE': {
          const folder = account?.folders.get(str(args[0]));
          if (!folder) return send(`${tag} NO [NONEXISTENT] Mailbox doesn't exist\r\n`);
          selected = folder;
          send(`* FLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft)\r\n* ${folder.messages.length} EXISTS\r\n* 0 RECENT\r\n`);
          send(`* OK [PERMANENTFLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft \\*)] Flags permitted\r\n`);
          send(`* OK [UIDVALIDITY ${folder.uidValidity}] UIDs valid\r\n* OK [UIDNEXT ${folder.uidNext}] Predicted next UID\r\n`);
          return ok(`[${command === 'SELECT' ? 'READ-WRITE' : 'READ-ONLY'}] ${command} completed`);
        }
        case 'CLOSE':
        case 'UNSELECT':
          selected = null;
          return ok();
        case 'NOOP':
          if (selected) send(`* ${selected.messages.length} EXISTS\r\n`);
          return ok();
        case 'LOGOUT':
          send('* BYE Logging out\r\n');
          ok();
          return socket.end();
        case 'UID':
          return uid(tag, str(args[0]).toUpperCase(), args.slice(1));
        default:
          return send(`${tag} BAD Unknown command ${command}\r\n`);
      }
    }

    function uid(tag: string, command: string, args: Token[]) {
      const folder = selected;
      if (!folder) return send(`${tag} BAD No mailbox selected\r\n`);
      if (command === 'SEARCH') {
        send(`* SEARCH ${search(folder, args).join(' ')}\r\n`.replace(' \r\n', '\r\n'));
        return send(`${tag} OK SEARCH completed\r\n`);
      }
      const set = uidSet(str(args[0]), folder);
      const targets = folder.messages.filter(message => set.has(message.uid));
      if (command === 'FETCH') {
        const requested = Array.isArray(args[1]) ? args[1].map(item => str(item).toUpperCase()) : [str(args[1]).toUpperCase()];
        for (const message of targets) for (const chunk of fetchLine(folder, message, requested)) send(chunk);
        return send(`${tag} OK FETCH completed\r\n`);
      }
      if (command === 'STORE') {
        const action = str(args[1]).toUpperCase();
        const flags = (Array.isArray(args[2]) ? args[2] : [args[2]!]).map(str);
        for (const message of targets) {
          for (const flag of flags) {
            if (action.startsWith('+')) message.flags.add(flag);
            else if (action.startsWith('-')) message.flags.delete(flag);
          }
          if (!action.endsWith('.SILENT')) send(fetchLine(folder, message, ['FLAGS'])[0]!);
        }
        return send(`${tag} OK STORE completed\r\n`);
      }
      if (command === 'MOVE') {
        const destination = account!.folders.get(str(args[1]));
        if (!destination) return send(`${tag} NO [TRYCREATE] Mailbox doesn't exist\r\n`);
        const moved: [number, number][] = [];
        for (const message of targets) {
          const copy = {...message, flags: new Set(message.flags), uid: destination.uidNext++};
          destination.messages.push(copy);
          moved.push([message.uid, copy.uid]);
        }
        if (moved.length) send(`* OK [COPYUID ${destination.uidValidity} ${moved.map(([from]) => from).join(',')} ${moved.map(([, to]) => to).join(',')}] Moved\r\n`);
        for (const message of [...targets].reverse()) {
          send(`* ${folder.messages.indexOf(message) + 1} EXPUNGE\r\n`);
          folder.messages.splice(folder.messages.indexOf(message), 1);
        }
        return send(`${tag} OK MOVE completed\r\n`);
      }
      return send(`${tag} BAD Unknown UID command\r\n`);
    }

    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (owed > 0) {
          if (buffer.length < owed) return;
          parts.push(buffer.subarray(0, owed));
          buffer = buffer.subarray(owed);
          owed = 0;
          continue;
        }
        const end = buffer.indexOf('\r\n');
        if (end < 0) return;
        const text = buffer.subarray(0, end);
        buffer = buffer.subarray(end + 2);
        const literal = /\{(\d+)(\+)?\}$/.exec(text.toString('utf8'));
        parts.push(text);
        if (literal) {
          owed = Number(literal[1]);
          if (!literal[2]) send('+ Ready for literal\r\n');
          continue;
        }
        const tokens = tokenize(parts);
        parts = [];
        const [tag, command, ...args] = tokens;
        run(str(tag), str(command).toUpperCase(), args);
      }
    });
  }

  const server = net.createServer(serve);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  onTestFinished(() => new Promise<void>(resolve => {
    for (const socket of sockets) socket.destroy();
    server.close(() => resolve());
  }));

  const fake = {
    host: '127.0.0.1',
    port: (server.address() as AddressInfo).port,
    commands,
    get logins() {
      return logins;
    },
    get connections() {
      return sockets.size;
    },
    addUser(name: string, password: string) {
      users.set(name, {password, folders: new Map([
        ['INBOX', {name: 'INBOX', specialUse: null, uidValidity: 1700000001, uidNext: 1, messages: []}],
        ['Deleted Messages', {name: 'Deleted Messages', specialUse: '\\Trash', uidValidity: 1700000002, uidNext: 1, messages: []}],
        ['Archive', {name: 'Archive', specialUse: '\\Archive', uidValidity: 1700000003, uidNext: 1, messages: []}],
      ])});
    },
    folder: (name: string, folder = 'INBOX') => user(name).folders.get(folder)!,
    /** New mail lands in the INBOX with the next UID. */
    deliver(name: string, raw: Buffer, date: string, flags: string[] = []): number {
      const inbox = fake.folder(name);
      const uid = inbox.uidNext++;
      inbox.messages.push({uid, flags: new Set(flags), internalDate: new Date(date), raw});
      return uid;
    },
    flags: (name: string, uid: number, folder = 'INBOX') => [...fake.folder(name, folder).messages.find(message => message.uid === uid)!.flags],
    /** Read (or unread) in Apple Mail. */
    setSeen(name: string, uid: number, seen: boolean) {
      const message = fake.folder(name).messages.find(item => item.uid === uid)!;
      if (seen) message.flags.add('\\Seen');
      else message.flags.delete('\\Seen');
    },
    /** Moved elsewhere in Apple Mail (Archive, or Deleted Messages). */
    move(name: string, uid: number, to: string) {
      const from = fake.folder(name);
      const message = from.messages.find(item => item.uid === uid)!;
      from.messages.splice(from.messages.indexOf(message), 1);
      const destination = fake.folder(name, to);
      destination.messages.push({...message, uid: destination.uidNext++});
    },
    /** The app password was revoked at appleid.apple.com: logins fail and open sessions end. */
    revoke(name: string) {
      user(name).password = `revoked-${Math.random()}`;
      for (const socket of sockets) {
        socket.write('* BYE Session invalidated\r\n');
        socket.destroy();
      }
    },
    /** The next `times` commands matching (e.g. /^UID FETCH/) get this tagged answer, a dropped connection or no answer. */
    inject(pattern: RegExp, response: 'drop' | 'hang' | string, times = 1) {
      injected.push({pattern, response, times});
    },
  };
  return fake;
}

export type FakeImap = Awaited<ReturnType<typeof fakeImap>>;
