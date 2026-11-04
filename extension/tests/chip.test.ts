// The chip's colour by its application's state (SV-176, DESIGN.md › Decided while building #301):
// green while it's open, red once it's closed, in the pane and on a card, over LinkedIn's light and
// dark text alike, its words and its fill both.
import {afterEach, describe, expect, test} from 'vitest';
import {draw, HOST} from '../src/chip.ts';
import type {Place, Tone} from '../src/words.ts';

/** LinkedIn's text colour in its light and dark themes, which the chip mixes over. */
const THEMES = {light: 'rgba(0, 0, 0, 0.9)', dark: 'rgba(255, 255, 255, 0.9)'};

/** Which of red, green and blue clearly leads a computed colour ("color(srgb 0.2 0.5 0.3 / 0.12)" or "rgb(…)"), else none. */
function leading(color: string): 'red' | 'green' | 'blue' | 'none' {
  const match = /^(?:rgba?\(|color\(srgb\s)([^)]*)\)$/.exec(color);
  if (!match?.[1]) throw new Error(`Not an sRGB colour: ${color}`);
  const channels = match[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3).map(Number);
  const scale = channels.some(channel => channel > 1) ? 255 : 1;
  const [red = 0, green = 0, blue = 0] = channels.map(channel => channel / scale);
  const ranked = [{name: 'red', value: red}, {name: 'green', value: green}, {name: 'blue', value: blue}] as const;
  const [first, second] = [...ranked].sort((a, b) => b.value - a.value);
  return first && second && first.value - second.value > 0.1 ? first.name : 'none';
}

function drawn(tone: Tone, place: Place, text: string): CSSStyleDeclaration {
  const line = document.createElement('p');
  line.style.color = text;
  const host = document.createElement(HOST);
  line.append(host);
  document.body.append(line);
  draw(host, {tone, text: 'Applied Oct 28', tip: 'Open in Setpoint', href: 'https://setpoint.example/jobs/12'}, place, () => {});
  const chip = host.shadowRoot?.querySelector('.chip');
  if (!chip) throw new Error('No chip drawn');
  return getComputedStyle(chip);
}

afterEach(() => document.body.replaceChildren());

describe('the chip\'s colour', () => {
  const cases = (['applied', 'closed'] as const).flatMap(tone => (['pane', 'card'] as const).flatMap(place =>
    (Object.keys(THEMES) as (keyof typeof THEMES)[]).map(theme => ({tone, place, theme, hue: tone === 'applied' ? 'green' : 'red'}))));

  test.each(cases)('$tone is $hue in the $place over $theme text', ({tone, place, theme, hue}) => {
    const style = drawn(tone, place, THEMES[theme]);
    expect({words: leading(style.color), fill: leading(style.backgroundColor)}).toEqual({words: hue, fill: hue});
  });
});
