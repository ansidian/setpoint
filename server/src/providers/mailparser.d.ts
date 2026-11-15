// The part of mailparser's API Setpoint uses (it ships no types).
declare module 'mailparser' {
  export interface ParsedMailAddress {
    text?: string;
    value?: ParsedMailAddressEntry[];
  }

  // A group ("Team: a@example.com, b@example.com;") holds its members in `group`.
  export interface ParsedMailAddressEntry {
    name?: string;
    address?: string;
    group?: ParsedMailAddressEntry[];
  }

  export interface ParsedMailAttachment {
    filename?: string;
    contentType?: string;
    contentDisposition?: string;
    cid?: string;
    partId?: string | null;
    size?: number;
    content?: Buffer;
    related?: boolean;
  }

  export interface ParsedMail {
    headerLines?: Array<{key: string; line: string}>;
    html?: string | false;
    text?: string;
    subject?: string;
    from?: ParsedMailAddress;
    to?: ParsedMailAddress | ParsedMailAddress[];
    cc?: ParsedMailAddress | ParsedMailAddress[];
    replyTo?: ParsedMailAddress | ParsedMailAddress[];
    date?: Date;
    messageId?: string;
    inReplyTo?: string;
    references?: string | string[];
    attachments?: ParsedMailAttachment[];
  }

  export function simpleParser(source: Buffer | string, options?: {skipHtmlToText?: boolean; skipTextToHtml?: boolean; keepCidLinks?: boolean}): Promise<ParsedMail>;
}
