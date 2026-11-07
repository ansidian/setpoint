// Contrast for the component tests (SV-220's audit): WCAG's ratio between a text's colour and everything
// behind it, composited from the outside in, as the page paints it.

/** Colours read as they are, not part way through a transition from the other theme; returns what puts transitions back. */
export function still(): () => void {
  const style = document.head.appendChild(document.createElement('style'));
  style.textContent = '* { transition: none !important; }';
  return () => style.remove();
}

/** An sRGB pixel for a computed colour, painted over what's under it (canvas blends the alpha). */
function paint(layers: string[]): [number, number, number] {
  const context = document.createElement('canvas').getContext('2d')!;
  for (const layer of layers) {
    context.fillStyle = layer;
    context.fillRect(0, 0, 1, 1);
  }
  const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
  return [r!, g!, b!];
}

const luminance = (rgb: [number, number, number]) => {
  const [r, g, b] = rgb.map(channel => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};

/** The text's contrast with everything behind it, its own box and its ancestors' composited from the outside in. */
export function contrastOf(text: HTMLElement): number {
  const backgrounds: string[] = [];
  for (let at: HTMLElement | null = text; at; at = at.parentElement) backgrounds.unshift(getComputedStyle(at).backgroundColor);
  const behind = paint(['#000', ...backgrounds]);
  const ink = paint([`rgb(${behind.join(',')})`, getComputedStyle(text).color]);
  const [high, low] = [luminance(behind), luminance(ink)].sort((a, b) => b - a);
  return (high! + 0.05) / (low! + 0.05);
}

