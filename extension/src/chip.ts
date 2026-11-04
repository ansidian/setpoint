// The chip on LinkedIn's page (SV-174, DESIGN.md › Decided while building #301, D434, D435). Each is
// in its own shadow root, so LinkedIn's styles don't reach it. Its colours are Setpoint's (good while
// this role's application is open and alert once it's closed, as Jobs's Offer and Rejected, an amber
// for another role, alert for a failure, violet for focus) mixed with the page's own text colour, so
// it reads in LinkedIn's light and dark themes alike.
import type {Chip, Place} from './words.ts';

export const HOST = 'setpoint-chip';

const VIOLET = 'oklch(0.54 0.14 300)';
const GOOD = 'oklch(0.53 0.13 150)';
const AMBER = 'oklch(0.58 0.14 78)';
const ALERT = 'oklch(0.535 0.185 25)';

const STYLE = `
  :host { display: inline-flex; vertical-align: middle; margin-left: 8px; font-size: 12px; line-height: 1; }
  :host([data-place="card"]) { margin-left: 6px; }
  .chip { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px; height: 22px; padding: 0 9px 0 7px;
    border-radius: 999px; font: 500 12px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; white-space: nowrap;
    color: color-mix(in srgb, currentColor 70%, transparent); background: color-mix(in srgb, currentColor 7%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, currentColor 18%, transparent); }
  :host([data-place="card"]) .chip { height: 19px; padding: 0 7px 0 6px; gap: 5px; font-size: 11px; }
  .chip::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: none; }
  .applied { color: color-mix(in srgb, ${GOOD} 75%, currentColor); background: color-mix(in srgb, ${GOOD} 12%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, ${GOOD} 45%, transparent); }
  .closed { color: color-mix(in srgb, ${ALERT} 75%, currentColor); background: color-mix(in srgb, ${ALERT} 12%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, ${ALERT} 45%, transparent); }
  .other { color: color-mix(in srgb, ${AMBER} 70%, currentColor); background: color-mix(in srgb, ${AMBER} 10%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, ${AMBER} 40%, transparent); }
  .warn { color: color-mix(in srgb, ${ALERT} 75%, currentColor); }
  button.chip, a.chip { cursor: pointer; }
  button.chip:hover, a.chip:hover { background: color-mix(in srgb, currentColor 14%, transparent); }
  .chip:focus-visible { outline: 2px solid color-mix(in srgb, ${VIOLET} 70%, currentColor); outline-offset: 2px; }
`;

/** Draws a chip in its host: a link into Setpoint, a button to the options, or plain words. */
export function draw(host: HTMLElement, chip: Chip, place: Place, openOptions: () => void): void {
  host.dataset.place = place;
  const root = host.shadowRoot ?? host.attachShadow({mode: 'open'});
  let element: HTMLElement;
  if (chip.href) {
    const link = document.createElement('a');
    Object.assign(link, {href: chip.href, target: '_blank', rel: 'noopener'});
    element = link;
  } else if (chip.options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.addEventListener('click', event => {
      event.preventDefault();
      openOptions();
    });
    element = button;
  } else {
    element = document.createElement('span');
  }
  element.className = `chip ${chip.tone}`;
  element.textContent = chip.text;
  element.title = chip.tip;
  // Clicks stay the chip's, never the card's (which opens the job) or the pane's under it.
  element.addEventListener('click', event => event.stopPropagation());
  const style = document.createElement('style');
  style.textContent = STYLE;
  root.replaceChildren(style, element);
}
