// The part of mailparser's API Setpoint uses (it ships no types; v1 declared it the same way).
declare module 'mailparser' {
  export interface ParsedMailAddress {
    text?: string;
    value?: Array<{name?: string; address?: string}>;
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
    date?: Date;
    messageId?: string;
    inReplyTo?: string;
    references?: string | string[];
    attachments?: ParsedMailAttachment[];
  }

  export function simpleParser(source: Buffer | string, options?: {skipHtmlToText?: boolean; skipTextToHtml?: boolean}): Promise<ParsedMail>;
}
