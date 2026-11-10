// The part of html-to-text's API Setpoint uses (it ships no types).
declare module 'html-to-text' {
  export interface HtmlToTextElement {
    attribs?: Record<string, string | undefined>;
  }

  export interface HtmlToTextBuilder {
    addInline(text: string, options?: {noWordTransform?: boolean}): void;
  }

  export type HtmlToTextFormatter = (element: HtmlToTextElement, walk: unknown, builder: HtmlToTextBuilder, options: unknown) => void;

  export interface HtmlToTextOptions {
    limits?: {maxDepth?: number};
    formatters?: Record<string, HtmlToTextFormatter>;
    selectors?: Array<{selector: string; format: string}>;
  }

  export function convert(html: string, options?: HtmlToTextOptions): string;
}
