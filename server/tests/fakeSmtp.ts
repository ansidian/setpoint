// A small SMTP server on 127.0.0.1 standing in for iCloud's smtp.mail.me.com: plain TCP (the adapter
// requires STARTTLS against iCloud), EHLO, AUTH PLAIN and LOGIN with an app password, MAIL FROM,
// RCPT TO, DATA, RSET, NOOP and QUIT. It keeps what it accepted and lets tests refuse a recipient,
// refuse the message after DATA, refuse the login, or drop the connection after DATA. No test
// reaches a real SMTP server.
import net from 'node:net';
import type {AddressInfo} from 'node:net';
import {onTestFinished} from 'vitest';

export interface Accepted {
  user: string;
  from: string;
  to: string[];
  data: Buffer;
}

export async function fakeSmtp() {
  const passwords = new Map<string, string>();
  const accepted: Accepted[] = [];
  const sockets = new Set<net.Socket>();
  // Refusals for the next sends: a recipient's, the message's (after DATA), or a dropped connection after DATA.
  const refusedRecipients = new Map<string, string>();
  let dataAnswer: {reply: string; times: number} | null = null;
  let drops = 0;
  // Called for each message taken: a test files it as iCloud might file its own copy.
  let onAccept: ((message: Accepted) => void) | null = null;

  function serve(socket: net.Socket) {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    const send = (line: string) => socket.write(`${line}\r\n`);
    let user: string | null = null;
    let from: string | null = null;
    let to: string[] = [];
    let reading: Buffer[] | null = null;
    let login: {step: 'user' | 'pass'; name?: string} | null = null;
    let buffer = Buffer.alloc(0);

    const authenticate = (name: string, password: string) => {
      if (passwords.get(name) !== password) return send('535 5.7.8 Authentication credentials invalid');
      user = name;
      send('235 2.7.0 Authentication successful');
    };

    const finishData = (data: Buffer) => {
      if (drops > 0) {
        // The worst case: the server took it, and the answer never came.
        drops -= 1;
        accepted.push({user: user!, from: from!, to, data});
        socket.destroy();
        return;
      }
      if (dataAnswer && dataAnswer.times > 0) {
        dataAnswer.times -= 1;
        return send(dataAnswer.reply);
      }
      const message = {user: user!, from: from!, to, data};
      accepted.push(message);
      onAccept?.(message);
      from = null;
      to = [];
      send('250 2.0.0 Ok: queued');
    };

    const line = (text: string) => {
      if (login) {
        const value = Buffer.from(text, 'base64').toString('utf8');
        if (login.step === 'user') {
          login = {step: 'pass', name: value};
          return send(`334 ${Buffer.from('Password:').toString('base64')}`);
        }
        const name = login.name!;
        login = null;
        return authenticate(name, value);
      }
      const [verb = '', ...rest] = text.split(' ');
      const argument = rest.join(' ');
      switch (verb.toUpperCase()) {
        case 'EHLO':
        case 'HELO':
          return send('250-smtp.fake.example\r\n250-AUTH PLAIN LOGIN\r\n250-8BITMIME\r\n250 SIZE 20971520');
        case 'AUTH': {
          const [mechanism, initial] = argument.split(' ');
          if (mechanism?.toUpperCase() === 'PLAIN') {
            const [, name = '', password = ''] = Buffer.from(initial ?? '', 'base64').toString('utf8').split('\0');
            return authenticate(name, password);
          }
          login = {step: 'user'};
          return send(`334 ${Buffer.from('Username:').toString('base64')}`);
        }
        case 'MAIL':
          if (!user) return send('530 5.7.0 Authentication required');
          from = /<([^>]*)>/.exec(argument)?.[1] ?? '';
          to = [];
          return send('250 2.1.0 Ok');
        case 'RCPT': {
          const address = /<([^>]*)>/.exec(argument)?.[1] ?? '';
          const refusal = refusedRecipients.get(address);
          if (refusal) return send(refusal);
          to.push(address);
          return send('250 2.1.5 Ok');
        }
        case 'DATA':
          if (!to.length) return send('554 5.5.1 No valid recipients');
          reading = [];
          return send('354 End data with <CR><LF>.<CR><LF>');
        case 'RSET':
          from = null;
          to = [];
          return send('250 2.0.0 Ok');
        case 'NOOP':
          return send('250 2.0.0 Ok');
        case 'QUIT':
          send('221 2.0.0 Bye');
          return socket.end();
        default:
          return send('502 5.5.2 Command not recognized');
      }
    };

    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        const end = buffer.indexOf('\r\n');
        if (end < 0) return;
        const text = buffer.subarray(0, end);
        buffer = buffer.subarray(end + 2);
        if (reading) {
          if (text.toString('latin1') === '.') {
            const data = Buffer.concat(reading.flatMap(part => [part, Buffer.from('\r\n')]));
            reading = null;
            finishData(data);
            continue;
          }
          // Dot-stuffing undone.
          reading.push(text[0] === 0x2e ? text.subarray(1) : text);
          continue;
        }
        line(text.toString('utf8'));
      }
    });
    send('220 smtp.fake.example ESMTP');
  }

  const server = net.createServer(serve);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  onTestFinished(() => new Promise<void>(resolve => {
    for (const socket of sockets) socket.destroy();
    server.close(() => resolve());
  }));

  return {
    host: '127.0.0.1',
    port: (server.address() as AddressInfo).port,
    accepted,
    addUser(name: string, password: string) {
      passwords.set(name, password);
    },
    /** Runs for each message taken, as iCloud filing its own copy in Sent would. */
    onAccept(handler: (message: Accepted) => void) {
      onAccept = handler;
    },
    /** RCPT TO this address answers `reply` ("550 5.1.1 <x>: Recipient address rejected"). */
    refuseRecipient(address: string, reply: string) {
      refusedRecipients.set(address, reply);
    },
    /** The next `times` messages are refused after DATA with `reply`. */
    refuseData(reply: string, times = 1) {
      dataAnswer = {reply, times};
    },
    /** The next `times` messages are taken but the connection drops before the answer: did it go? */
    dropAfterData(times = 1) {
      drops = times;
    },
  };
}

export type FakeSmtp = Awaited<ReturnType<typeof fakeSmtp>>;
