// Where the shared tooltip goes, as a table (DESIGN.md #299): centred 6 px under what it names, above
// it near the window's bottom, and 8 px inside the window's sides; and which tips only repeat their
// element's own words, shown only when those are cut (SV-171).
import {describe, expect, test} from 'vitest';
import {placeTip, repeats} from '../src/logic/tip.ts';

const WINDOW = {width: 1677, height: 1050};
const TIP = {width: 180, height: 24};

describe('placeTip', () => {
  test.each([
    ['room all round: centred underneath', {left: 400, top: 300, width: 100, height: 20}, {left: 360, top: 326, up: false}],
    ['near the bottom: above', {left: 400, top: 1010, width: 100, height: 20}, {left: 360, top: 980, up: true}],
    ['at the left edge: slid 8 px in', {left: 0, top: 300, width: 40, height: 40}, {left: 8, top: 346, up: false}],
    ['at the right edge: slid 8 px in', {left: 1650, top: 300, width: 27, height: 20}, {left: 1489, top: 326, up: false}],
  ])('%s', (_, anchor, place) => {
    expect(placeTip(anchor, TIP, WINDOW)).toEqual(place);
  });

  test('no room above either: underneath, as it fits best there', () => {
    expect(placeTip({left: 400, top: 10, width: 100, height: 1030}, TIP, WINDOW)).toEqual({left: 360, top: 1046, up: false});
  });
});

describe('repeats', () => {
  test.each([
    ['the same words', 'No reply yet', 'No reply yet', true],
    ['inside more, as a step after its dot', '· Interview Tue Oct 13, 2:00 PM', 'Interview Tue Oct 13, 2:00 PM', true],
    ['across spans that drop a space, as the suggestion and its count', 'from:Northwind· 4 emailsTab', 'from:Northwind · 4 emails', true],
    ['an address behind a name', 'Megan Bowen', 'megan@example.com', false],
    ['the subject behind a summary', 'Contoso Mail· Your order shipped', 'Order 4411 confirmation', false],
    ['a title and its time, in a block that shows the title alone', 'Standup', 'Standup · 9:00–9:15 AM', false],
  ])('%s', (_, text, words, repeated) => {
    expect(repeats(text, words)).toBe(repeated);
  });
});
