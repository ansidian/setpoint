// A plain-text email body as the reader draws it (DESIGN.md › The reader: 14 / 1.55, max 600 px):
// paragraphs at blank lines, and each paragraph's own line breaks kept.

/** The paragraphs of `text`, each a list of its lines. */
export function paragraphs(text: string): string[][] {
  return text.replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/)
    .map(paragraph => paragraph.split('\n').map(line => line.trimEnd()))
    .map(lines => {
      while (lines.length && !lines[0]!.trim()) lines.shift();
      while (lines.length && !lines.at(-1)!.trim()) lines.pop();
      return lines;
    })
    .filter(lines => lines.length > 0);
}
