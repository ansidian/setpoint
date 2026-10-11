// The dev provider's attachment bytes: the seed and its fixtures record attachments by name, type
// and size only, so `npm run dev` and the browser checks preview a small stand-in of the same type
// (a one-page PDF naming the file, a grey PNG, a two-line CSV, else the name as text).
import {crc32, deflateSync} from 'node:zlib';
import type {AttachmentBytes} from '../sync/adapter.ts';

/** A small grey PNG, `size` pixels square. */
export function stubPng(size = 2): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 0, 0, 0, 0], 8);
  // Each row: filter byte 0, then grey pixels.
  const rows = Buffer.concat(Array.from({length: size}, () => Buffer.from([0, ...new Array<number>(size).fill(0xa0)])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

const PNG = stubPng();

/** A minimal, valid one-page PDF with one line of text. */
export function stubPdf(line: string): Buffer {
  const text = line.replace(/[\\()]/g, char => `\\${char}`).replace(/[^\x20-\x7e]/g, '?');
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}

export function devAttachment(filename: string, mimeType: string): AttachmentBytes {
  const type = mimeType.toLowerCase();
  let content: Buffer;
  if (type === 'application/pdf') content = stubPdf(filename);
  else if (type.startsWith('image/')) content = PNG;
  else if (type === 'text/csv') content = Buffer.from('Name,Value\r\nSample,1\r\n');
  else content = Buffer.from(`${filename}\n`);
  return {content, mimeType: type.startsWith('image/') ? 'image/png' : type, filename};
}
