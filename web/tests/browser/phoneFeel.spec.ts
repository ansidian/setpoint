// The phone feeling native (darma SV-66; DESIGN.md › Phone and Decided while building #255–#264), at
// 390 × 844 with touch: the reader's actions sharing the bar, the unread dot on an email marked
// unread, the slide over the list and back, search's way out, the tab bar, the safe-area insets and
// the theme colour, the list's type a step up, the agenda's today, now and chips, and the sign-in
// card clear of the keyboard. phone.spec.ts has board 21 and the phone's flows.
import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import type {InboxOut} from '@setpoint/shared';
import {deepLinkPath} from '@setpoint/shared';
import type {Page} from 'playwright-core';
import {ICONS} from '../../src/ui/glyphs.ts';
import {cleanUp, startSetpoint, until} from './harness.ts';
import type {Setpoint} from './harness.ts';

after(cleanUp);

/** The seed's emails by the start of their subject. */
async function email(setpoint: Setpoint, subject: string): Promise<number> {
  const inbox = await setpoint.api<InboxOut>('GET', '/mail/inbox');
  return inbox.groups.flatMap(group => group.rows).find(row => row.subject.startsWith(subject))!.id;
}

async function inbox(setpoint: Setpoint): Promise<Page> {
  const page = await setpoint.page('iphone');
  await page.goto(`${setpoint.base}/inbox`);
  await page.locator('.arow').first().waitFor();
  return page;
}

/** A token's colour as the page computes it, to compare with an element's. */
const tokenColour = (page: Page, token: string) => page.evaluate(name => {
  const probe = document.body.appendChild(document.createElement('span'));
  probe.style.color = `var(--${name})`;
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
}, token);

/** The reader's bottom bar: each action's label, width, label colour and weight, and icon colour. */
const actionBar = (page: Page) => page.locator('.ph-acts button').evaluateAll(buttons => buttons.map(button => ({
  label: button.textContent,
  width: Math.round(button.getBoundingClientRect().width),
  colour: getComputedStyle(button).color,
  weight: getComputedStyle(button).fontWeight,
  icon: getComputedStyle(button.querySelector('.icon')!).color,
})));

/** Computed styles of the first match. */
const styles = (page: Page, selector: string, names: string[]) => page.locator(selector).first().evaluate((element, keys) => {
  const style = getComputedStyle(element);
  return keys.map(key => style.getPropertyValue(key));
}, names);

test('the reader\'s actions share the bar evenly, Done leads in `good`, and none moves in as the email arrives', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    // The deep links' emails, while they're in the Inbox: an FYI one read below leaves it.
    const links = [[await email(setpoint, 'Interview availability'), 'Interview availability', ['Done', 'Trash', 'Mark unread', 'Open in Gmail']], [await email(setpoint, 'Bill is ready'), 'Bill is ready', ['Trash', 'Mark unread']]] as const;
    const page = await inbox(setpoint);
    const colours = {ink: await tokenColour(page, 'ink'), ink2: await tokenColour(page, 'ink2'), good: await tokenColour(page, 'good')};
    // Attention mail: four, a quarter each of the bar's 374 px; Done's label `ink` 500 and its check `good`, the rest `ink2` under `ink` icons.
    await page.locator('.arow', {hasText: 'Contoso University'}).tap();
    await page.locator('.rd-subj', {hasText: 'Final exam schedule'}).waitFor();
    const four = await actionBar(page);
    assert.deepEqual(four.map(action => action.label), ['Done', 'Trash', 'Mark unread', 'Open in Gmail']);
    assert.deepEqual(four.map(action => action.width), [94, 94, 94, 94]);
    assert.deepEqual(four.map(action => [action.colour, action.weight, action.icon]), [
      [colours.ink, '500', colours.good], [colours.ink2, '400', colours.ink], [colours.ink2, '400', colours.ink], [colours.ink2, '400', colours.ink],
    ]);
    await page.locator('.ph-back').tap();

    // Gmail mail that isn't Attention: three, a third each, Trash leading (#93).
    await page.locator('.row', {hasText: 'Woodgrove Bank'}).tap();
    await page.locator('.rd-subj', {hasText: 'Statement ready'}).waitFor();
    assert.deepEqual((await actionBar(page)).map(action => [action.label, action.width]), [['Trash', 125], ['Mark unread', 125], ['Open in Gmail', 125]]);
    await page.locator('.ph-back').tap();

    // iCloud mail: two, a half each, no Open in Gmail.
    await page.locator('.row', {hasText: 'Proseware'}).tap();
    await page.locator('.rd-subj', {hasText: 'Bill is ready'}).waitFor();
    assert.deepEqual((await actionBar(page)).map(action => [action.label, action.width]), [['Trash', 187], ['Mark unread', 187]]);

    // A deep link while the email is on its way: the bar holds what it will show, or nothing, and
    // nothing moves along when the email arrives (Done once drew late and pushed the rest right).
    for (const [id, subject, labels] of links) {
      let release!: () => void;
      const held = new Promise<void>(resolve => (release = resolve));
      await page.route(`**/api/mail/messages/${id}`, async route => {
        await held;
        await route.continue();
      });
      const going = page.goto(`${setpoint.base}${deepLinkPath({to: 'message', id})}`);
      await page.locator('.pane .ph-acts').waitFor();
      await page.locator('.list .arow').first().waitFor();
      const before = (await actionBar(page)).map(action => action.label);
      assert.ok(before.length === 0 || JSON.stringify(before) === JSON.stringify(labels), `before the email: ${JSON.stringify(before)}`);
      release();
      await going;
      await page.locator('.rd-subj', {hasText: subject}).waitFor();
      assert.deepEqual((await actionBar(page)).map(action => action.label), labels);
      await page.unroute(`**/api/mail/messages/${id}`);
    }
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('Mark unread on the phone puts the unread dot before the subject, popping in with the swapped icon; Mark read takes it away', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    await page.locator('.arow', {hasText: 'Contoso University'}).tap();
    await page.locator('.rd-subj', {hasText: 'Final exam schedule'}).waitFor();
    assert.equal(await page.locator('.rd-subj .rd-unread').count(), 0);
    // The first draw doesn't pop.
    assert.equal(await page.locator('.ph-acts .ph-swap').count(), 0);
    await page.locator('.ph-acts button', {hasText: 'Mark unread'}).tap();
    await page.locator('.ph-acts button', {hasText: 'Mark read'}).waitFor();
    const dot = page.locator('.rd-subj .rd-unread');
    // It and the icon scale in from .4 over 120 ms: read from the animation, then measured once it's over.
    assert.deepEqual(await page.locator('.ph-acts .ph-swap').evaluate(element => [getComputedStyle(element).animationName, getComputedStyle(element).animationDuration]), ['ph-pop', '0.12s']);
    await until('the dot has popped in', () => dot.evaluate(element => element.getAnimations().length), running => running === 0);
    // The list's dot: 6 px `ink`, 10 px before the subject, in its line's middle.
    const look = await dot.evaluate(element => {
      const style = getComputedStyle(element);
      const line = element.parentElement!.getBoundingClientRect();
      const box = element.getBoundingClientRect();
      const words = document.createRange();
      words.setStart(element.parentElement!.lastChild!, 0);
      words.setEnd(element.parentElement!.lastChild!, 1);
      const first = words.getClientRects()[0]!;
      return {size: [box.width, box.height], colour: style.backgroundColor, gap: Math.round(first.left - box.right), middle: Math.abs((box.top + box.bottom) / 2 - (first.top + first.bottom) / 2) <= 2,
        inLine: box.top >= line.top, animation: [style.animationName, style.animationDuration]};
    });
    assert.deepEqual(look, {size: [6, 6], colour: await tokenColour(page, 'ink'), gap: 10, middle: true, inLine: true, animation: ['ph-pop', '0.12s']});
    await page.locator('.ph-acts button', {hasText: 'Mark read'}).tap();
    await page.locator('.ph-acts button', {hasText: 'Mark unread'}).waitFor();
    assert.equal(await dot.count(), 0);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});


interface Slide {
  direction: string;
  animations: string[];
  taps: string;
}

/**
 * Records each view transition the page starts from now on: the direction on the root as it starts,
 * and, once its pseudo-elements are built, each of the slide's animations with the pseudo-element it
 * runs on, its duration and direction, and whether the overlay lets taps through.
 */
const recordSlides = (page: Page) => page.evaluate(() => {
  const scope = window as unknown as {slides: Slide[]};
  scope.slides = [];
  const start = document.startViewTransition.bind(document);
  document.startViewTransition = ((update: ViewTransitionUpdateCallback) => {
    const slide: Slide = {direction: document.documentElement.dataset.slide ?? '', animations: [], taps: ''};
    scope.slides.push(slide);
    const transition = start(update);
    void transition.ready.then(() => {
      slide.taps = getComputedStyle(document.documentElement, '::view-transition').pointerEvents;
      slide.animations = document.getAnimations().flatMap(animation => {
        const effect = animation.effect as KeyframeEffect;
        const name = (animation as CSSAnimation).animationName;
        if (!effect.pseudoElement?.startsWith('::view-transition-') || !name?.startsWith('ph-')) return [];
        return [`${effect.pseudoElement} ${name} ${String(effect.getTiming().duration)} ${effect.getTiming().direction ?? ''}`];
      }).sort();
    });
    return transition;
  }) as typeof document.startViewTransition;
});
const slides = (page: Page) => page.evaluate(() => (window as unknown as {slides: Slide[]}).slides);

test('the reader slides in over the list and back off it, Done too; the browser\'s Back doesn\'t, nor the desktop\'s reader', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    await recordSlides(page);
    assert.deepEqual(await styles(page, '.content > .list', ['view-transition-name']), ['ph-list']);
    await page.locator('.arow', {hasText: 'Contoso University'}).tap();
    await page.locator('.rd-subj', {hasText: 'Final exam schedule'}).waitFor();
    assert.deepEqual(await styles(page, '.pane', ['view-transition-name']), ['ph-reader']);
    // In: the reader from the right over 260 ms, the list a fifth left and dimmed under it, taps
    // going through to the page meanwhile.
    const opened = await until('the slide in has started', () => slides(page), seen => seen.length === 1 && seen[0]!.animations.length > 0);
    assert.deepEqual(opened, [{direction: 'in', taps: 'none', animations: [
      '::view-transition-new(ph-reader) ph-in 260 normal', '::view-transition-old(ph-list) ph-under 260 normal',
    ]}]);
    // Back: the reader off to the right, the list back from the left.
    await page.locator('.ph-back').tap();
    await until('the reader closes', () => page.locator('.pane').count(), count => count === 0);
    const back = await until('the slide back has started', () => slides(page), seen => seen.length === 2 && seen[1]!.animations.length > 0);
    assert.deepEqual(back[1], {direction: 'back', taps: 'none', animations: [
      '::view-transition-new(ph-list) ph-under 260 reverse', '::view-transition-old(ph-reader) ph-in 260 reverse',
    ]});
    await until('the slide is over', () => page.evaluate(() => document.documentElement.dataset.slide ?? null), direction => direction === null);
    // Done goes back the same way, to the list where its row folds away.
    await page.locator('.arow', {hasText: 'Contoso University'}).tap();
    await page.locator('.ph-acts .ph-done').tap();
    await page.locator('.toast', {hasText: 'Marked Done'}).waitFor();
    await until('a third and fourth slide', () => slides(page), seen => seen.length === 4 && seen[3]!.animations.length > 0);
    assert.deepEqual((await slides(page)).map(slide => slide.direction), ['in', 'back', 'in', 'back']);
    // The browser's Back (Safari's edge swipe) animates itself: no slide.
    await page.locator('.arow', {hasText: 'Northwind Talent'}).tap();
    await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
    await until('the fifth slide', () => slides(page), seen => seen.length === 5);
    await page.goBack();
    await until('the reader closes', () => page.locator('.pane').count(), count => count === 0);
    // Nothing more happens to wait for: a slide would have started with the close.
    await page.waitForTimeout(300);
    await setpoint.idle();
    assert.equal((await slides(page)).length, 5);

    // The desktop's reader sits beside the list: no slide.
    const desk = await setpoint.page('target');
    await desk.goto(`${setpoint.base}/inbox`);
    await desk.locator('.arow').first().waitFor();
    await recordSlides(desk);
    await desk.locator('.arow', {hasText: 'Your recovery email'}).click();
    await desk.locator('.rd-subj', {hasText: 'Your recovery email'}).waitFor();
    await desk.keyboard.press('Escape');
    await until('the reader closes', () => desk.locator('.pane').count(), count => count === 0);
    assert.deepEqual(await slides(desk), []);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the agenda\'s detail rises into place over its fading scrim, and the toast rises from the tab bar', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.pitem', {hasText: 'Dentist'}).tap();
    await page.locator('.ph-detail .fd-title', {hasText: 'Dentist'}).waitFor();
    // Each entrance: its animation, timing, and where its first keyframe starts.
    const entrance = (selector: string) => page.locator(selector).evaluate(element => {
      const style = getComputedStyle(element);
      const rules = [...document.styleSheets].flatMap(sheet => [...sheet.cssRules]);
      const find = (list: CSSRule[]): CSSKeyframesRule | undefined => {
        for (const rule of list) {
          if (rule instanceof CSSKeyframesRule && rule.name === style.animationName) return rule;
          if (rule instanceof CSSMediaRule && window.matchMedia(rule.conditionText).matches) {
            const inner = find([...rule.cssRules]);
            if (inner) return inner;
          }
        }
        return undefined;
      };
      const from = find(rules)?.findRule('from') ?? find(rules)?.findRule('0%');
      return [style.animationName, style.animationDuration, style.animationTimingFunction, from ? [from.style.transform, from.style.opacity] : null];
    });
    assert.deepEqual(await entrance('.fd.ph-detail'), ['ph-rise', '0.18s', 'cubic-bezier(0.2, 0, 0, 1)', ['translateY(24px)', '0']]);
    assert.deepEqual(await entrance('.ph-scrim'), ['ph-fade', '0.18s', 'cubic-bezier(0.2, 0, 0, 1)', ['', '0']]);
    await page.goto(`${setpoint.base}/inbox`);
    await page.locator('.hd button[aria-label="Mark all as read"]').tap();
    await page.locator('.toast').waitFor();
    assert.deepEqual(await entrance('.toast'), ['ph-toast-in', '0.18s', 'cubic-bezier(0.2, 0, 0, 1)', ['translate(-50%, 8px)', '0']]);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('phone search: a clear button where the hint was, no Mark all as read meanwhile, and Back to Search from a result', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    const markAll = page.locator('.hd button[aria-label="Mark all as read"]');
    await page.locator('.arow', {hasText: 'Northwind Talent'}).tap();
    assert.equal(await page.locator('.ph-back').textContent(), 'Inbox');
    await page.locator('.ph-back').tap();
    await until('the reader closes', () => page.locator('.pane').count(), count => count === 0);

    await page.locator('.search input').tap();
    await page.keyboard.type('northwind');
    await page.locator('.search-list .result').first().waitFor();
    // The way out, where the desktop's Esc hint is: 32 px round, an 18 px `close` in `ink3`, 4 px in
    // from the field's border (8 px into its 12 px padding).
    const clear = page.locator('.search .search-clear');
    const [field, button, icon] = [await page.locator('.hd > .search').boundingBox(), await clear.boundingBox(), await clear.locator('svg').boundingBox()];
    assert.deepEqual([button!.width, button!.height, icon!.width, Math.round(field!.x + field!.width - 1 - (button!.x + button!.width))], [32, 32, 18, 4]);
    assert.deepEqual(await styles(page, '.search .search-clear', ['color', 'border-radius']), [await tokenColour(page, 'ink3'), '999px']);
    assert.equal(await page.locator('.search .kbd').count(), 0);
    // Mark all as read would read the hidden Inbox's mail, not the results: it's gone while searching.
    assert.equal(await markAll.count(), 0);
    // An email from the results goes back to them.
    await page.locator('.search-list .result', {hasText: 'Interview availability'}).tap();
    await page.locator('.rd-subj', {hasText: 'Interview availability'}).waitFor();
    assert.equal(await page.locator('.ph-back').textContent(), 'Search');
    await page.locator('.ph-back').tap();
    await until('back at the results', () => page.locator('.pane').count(), count => count === 0);
    assert.equal(await page.locator('.hd-title').textContent(), 'Search');
    assert.ok(await page.locator('.search-list .result').first().isVisible());
    // One tap leaves search: the field empties and lets go, and the Inbox and Mark all as read come back.
    await clear.tap();
    await page.locator('.content > .list .gh').first().waitFor();
    assert.equal(await page.locator('.search input').inputValue(), '');
    assert.equal(await page.locator('.hd-title').textContent(), 'Inbox');
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), 'BODY');
    assert.equal(await clear.count(), 0);
    await markAll.waitFor();
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the tab bar: the current tab filled, Inbox badged while Attention waits on another page, and a tap on the current tab back to the top', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    const glyph = (label: string) => page.locator('.ph-tab', {hasText: label}).locator('svg path').getAttribute('d');
    const badge = page.locator('.ph-tab', {hasText: 'Inbox'}).locator('.ph-badge');
    assert.deepEqual([await glyph('Inbox'), await glyph('Agenda')], [ICONS['inbox-fill'], ICONS.calendar_today]);
    // The Inbox's header has the pill: no badge there.
    assert.equal(await badge.count(), 0);
    // A tap on the current tab scrolls its list back to the top, smoothly (in more than one step).
    const list = page.locator('.content > .list');
    await list.evaluate(element => element.scrollTo(0, 900));
    await until('scrolled down', () => list.evaluate(element => element.scrollTop), top => top > 500);
    await list.evaluate(element => {
      const scope = window as unknown as {steps: number};
      scope.steps = 0;
      element.addEventListener('scroll', () => (scope.steps += 1));
    });
    await page.locator('.ph-tab', {hasText: 'Inbox'}).tap();
    await until('back at the top', () => list.evaluate(element => element.scrollTop), top => top === 0);
    assert.ok(await page.evaluate(() => (window as unknown as {steps: number}).steps) > 1, 'it scrolls smoothly, not in one jump');

    await page.locator('.ph-tab', {hasText: 'Agenda'}).tap();
    await page.locator('.ph-agenda .pitem').first().waitFor();
    assert.deepEqual([await glyph('Inbox'), await glyph('Agenda')], [ICONS.inbox, ICONS['calendar_today-fill']]);
    // The header's pill, shrunk: the attention count, a 16 px `caution` pill with `onInk` 10.5 / 600
    // figures, 8 px from the top and 6 px right of the tab's middle, in a 2 px `panel` ring.
    assert.equal(await badge.textContent(), '3');
    const [tab, pill] = [await page.locator('.ph-tab', {hasText: 'Inbox'}).boundingBox(), await badge.boundingBox()];
    assert.deepEqual([pill!.height, pill!.y - tab!.y, pill!.x - (tab!.x + tab!.width / 2)], [16, 8, 6]);
    assert.deepEqual(await styles(page, '.ph-badge', ['background-color', 'color', 'font-size', 'font-weight', 'font-variant-numeric', 'box-shadow']),
      [await tokenColour(page, 'caution'), await tokenColour(page, 'onInk'), '10.5px', '600', 'tabular-nums', `${await tokenColour(page, 'panel')} 0px 0px 0px 2px`]);
    // It follows the count.
    await setpoint.api('POST', `/mail/messages/${await email(setpoint, 'Final exam')}/done`, {done: true});
    await until('the badge follows', () => badge.textContent(), text => text === '2');
    // A later week's agenda: its tab goes back to today's.
    await page.goto(`${setpoint.base}${deepLinkPath({to: 'day', date: '2026-10-20'})}`);
    await until('the agenda starts on the day', () => page.locator('.hd .ph-range').textContent(), text => text === 'Oct 20 – 27');
    await page.locator('.ph-tab', {hasText: 'Agenda'}).tap();
    await until('today\'s agenda', () => page.locator('.hd .ph-range').textContent(), text => text === 'Oct 7 – 14');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the phone reaches the screen\'s edges by its insets, and Safari\'s bars take the drawn theme\'s page colour', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    assert.match((await page.locator('meta[name="viewport"]').getAttribute('content'))!, /viewport-fit=cover/);
    const tint = page.locator('meta[name="theme-color"]');
    assert.deepEqual([await tint.count(), await tint.getAttribute('content')], [1, '#050506']);
    // In a browser tab there's no inset: 6 px under the labels, the bars 54 and 58 px.
    const bars = async () => [await styles(page, '.app', ['padding-top']), await styles(page, '.ph-tabs', ['min-height', 'padding-bottom', 'height'])];
    assert.deepEqual(await bars(), [['0px'], ['54px', '6px', '54px']]);
    await page.locator('.arow', {hasText: 'Contoso University'}).tap();
    await page.locator('.rd-subj').waitFor();
    assert.deepEqual(await styles(page, '.ph-acts', ['min-height', 'padding-bottom', 'height']), ['58px', '6px', '58px']);
    // As a Home Screen app on an iPhone: 47 px for the status bar, 34 for the home indicator.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', {insets: {top: 47, bottom: 34}});
    await until('the reader keeps clear of both', () => Promise.all([styles(page, '.pane', ['padding-top']), styles(page, '.ph-acts', ['padding-bottom'])]),
      value => JSON.stringify(value) === '[["47px"],["34px"]]');
    await page.locator('.ph-back').tap();
    await until('the reader closes', () => page.locator('.pane').count(), count => count === 0);
    assert.deepEqual((await bars()).map(values => values.slice(0, 2)), [['47px'], ['54px', '34px']]);
    // The theme drawn, not the system's: Light's page once the browser prefers light (System).
    await page.emulateMedia({colorScheme: 'light'});
    await until('Light\'s page colour', () => tint.getAttribute('content'), value => value === '#f6f6f4');
    assert.equal(await tint.count(), 1);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the phone\'s list reads a step up: rows 15, ages and accounts 13, summaries 13.5, group headers 12, search\'s rows too', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await inbox(setpoint);
    const ink3 = await tokenColour(page, 'ink3');
    assert.deepEqual(await styles(page, '.row .from', ['font-size']), ['15px']);
    assert.deepEqual(await styles(page, '.row', ['min-height', 'row-gap']), ['62px', '3px']);
    assert.deepEqual(await styles(page, '.row .age', ['font-size', 'color']), ['13px', ink3]);
    assert.deepEqual(await styles(page, '.row .ac', ['font-size', 'color']), ['13px', ink3]);
    assert.deepEqual(await styles(page, '.arow .r1', ['font-size', 'height']), ['13px', '20px']);
    assert.deepEqual(await styles(page, '.arow .l1', ['height']), ['20px']);
    assert.deepEqual(await styles(page, '.arow .l2', ['font-size']), ['15px']);
    assert.deepEqual(await styles(page, '.arow .l3', ['font-size', 'color']), ['13.5px', ink3]);
    assert.deepEqual(await styles(page, '.gh', ['font-size', 'height']), ['12px', '30px']);
    assert.deepEqual(await styles(page, '.code-line .copy', ['height', 'font-size', 'padding-left', 'padding-right']), ['30px', '13px', '10px', '10px']);
    // The unread dot stays level with the larger first line.
    const [dot, from] = await page.locator('.arow.unread').first().evaluate(row => [row.querySelector('.ud')!, row.querySelector('.from')!].map(part => {
      const box = part.getBoundingClientRect();
      return box.top + box.height / 2;
    }));
    assert.ok(Math.abs(dot! - from!) <= 1, 'the dot is level with the sender');
    await page.locator('.search input').tap();
    await page.keyboard.type('northwind');
    await page.locator('.search-list .result').first().waitFor();
    assert.deepEqual(await styles(page, '.search-list .result .r1 .age', ['font-size']), ['13px']);
    assert.deepEqual(await styles(page, '.search-list .result .why', ['font-size']), ['13px']);
    assert.deepEqual(await styles(page, '.search-list .result .l2', ['font-size']), ['15px']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('the agenda marks today and now, draws events as their calendar\'s chips, and keeps each day\'s head in view', async () => {
  const setpoint = await startSetpoint({clock: 'frozen'});
  try {
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/calendar`);
    await page.locator('.ph-agenda .pitem').first().waitFor();
    const [ink, ink3, alert] = [await tokenColour(page, 'ink'), await tokenColour(page, 'ink3'), await tokenColour(page, 'alert')];
    // "Today" in `ink` 500, then its date as every day's, `ink3` 400.
    assert.deepEqual(await styles(page, '.pday.today .pd-today', ['color', 'font-weight']), [ink, '500']);
    assert.deepEqual(await styles(page, '.pday.today', ['color', 'font-weight']), [ink3, '400']);
    assert.equal(await page.locator('.pday .pd-today').count(), 1);
    // Now, at the seed's 9:12 AM, between the past Gym and the Dentist.
    const today = page.locator('.ph-agenda [data-days="2026-10-07"]');
    assert.deepEqual(await today.locator(':scope > :not(.pday)').evaluateAll(lines => lines.map(line => (line.classList.contains('ph-now') ? `now ${line.textContent}` : line.querySelector('.ell')!.firstChild!.textContent))),
      ['Gym', 'now 9:12 AM', 'Dentist', 'CS 101 lab report', 'Pay rent']);
    assert.equal(await page.locator('.ph-now').count(), 1);
    // The right pane's now-line: 16 px; the time `alert` 12 / 500 in the 96 px time column; a 7 px
    // `alert` dot on the marks' column, centred on the tasks' rings; a 1 px `alert` line at .7 from
    // the titles' column.
    const now = await page.locator('.ph-now').evaluate(row => {
      const [time, dot, line] = [row.querySelector('.t')!, row.querySelector('.dot')!, row.querySelector('.line')!];
      const box = (element: Element) => element.getBoundingClientRect();
      const style = (element: Element) => getComputedStyle(element);
      return {
        height: box(row).height,
        time: [box(time).width, style(time).color, style(time).fontSize, style(time).fontWeight, style(time).fontVariantNumeric],
        dot: [box(dot).width, box(dot).height, style(dot).backgroundColor, box(dot).left + box(dot).width / 2],
        line: [box(line).height, style(line).backgroundColor, style(line).opacity, box(line).left],
      };
    });
    const task = page.locator('.pitem', {hasText: 'Pay rent'});
    const [ring, title] = [(await task.locator('.mk').boundingBox())!, (await task.locator('.ell').boundingBox())!];
    assert.deepEqual(now, {
      height: 16, time: [96, alert, '12px', '500', 'tabular-nums'],
      dot: [7, 7, alert, ring.x + ring.width / 2], line: [1, alert, '0.7', title.x],
    });
    // Events are their calendar's chips, as on the grids: its tint and 3 px bar, radius 6, 34 px in a
    // 42 px line, the title level with a task's; past ones at .55; tasks keep their ring.
    const chip = page.locator('.pitem.chip', {hasText: 'Dentist'}).locator('.ell');
    assert.equal(await page.locator('.ph-agenda .cbar').count(), 0);
    assert.deepEqual(await chip.evaluate(element => {
      const style = getComputedStyle(element);
      return [element.getBoundingClientRect().height, style.borderRadius, style.paddingLeft, style.boxShadow.endsWith('3px 0px 0px 0px inset'), style.backgroundColor !== 'rgba(0, 0, 0, 0)', style.opacity];
    }), [34, '6px', '25px', true, true, '1']);
    assert.deepEqual(await styles(page, '.pitem.chip.past .ell', ['opacity']), ['0.55']);
    const words = (cell: typeof chip) => cell.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element.firstChild!);
      return range.getBoundingClientRect().left;
    });
    assert.equal(await words(chip), await words(task.locator('.ell')));
    assert.ok(await task.locator('.ring').isVisible());
    assert.deepEqual(await styles(page, '.ph-agenda .pday', ['position', 'top', 'z-index']), ['sticky', '0px', '1']);
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('a busy day\'s head stays in view as its items scroll under it', async () => {
  const setpoint = await startSetpoint({clock: 'frozen', fixtures: ['busy-saturday']});
  try {
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}${deepLinkPath({to: 'day', date: '2026-10-17'})}`);
    await until('the agenda starts on the day', () => page.locator('.hd .ph-range').textContent(), text => text === 'Oct 17 – 24');
    const agenda = page.locator('.ph-agenda');
    await agenda.evaluate(element => element.scrollTo(0, 40));
    await until('scrolled', () => agenda.evaluate(element => element.scrollTop), top => top === 40);
    const [box, head] = [await agenda.boundingBox(), await page.locator('.ph-agenda [data-days="2026-10-17"] .pday').boundingBox()];
    assert.equal(head!.y, box!.y, 'Saturday\'s head stays at the top');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});

test('on the phone the sign-in card sits 18% from the top, clear of the keyboard, and so does the mark when Setpoint can\'t be reached', async () => {
  const setpoint = await startSetpoint({claim: false});
  try {
    const page = await setpoint.page('iphone');
    await page.goto(`${setpoint.base}/inbox`);
    await page.getByLabel('Setup token').waitFor();
    // 18vh, to the 1/64 px layout rounds to.
    const near = (y: number) => Math.abs(y - 844 * 0.18) < 0.05;
    assert.ok(near((await page.locator('.sign-in').boundingBox())!.y), 'the card');
    const boot = await setpoint.page('iphone');
    await boot.route('**/api/me', route => route.fulfill({status: 502, contentType: 'text/html', body: '<html><body>Bad Gateway</body></html>'}));
    await boot.goto(`${setpoint.base}/inbox`);
    await boot.locator('.boot .offline-pill').waitFor();
    assert.ok(near((await boot.locator('.boot svg.mark').boundingBox())!.y), 'the mark');
    assert.deepEqual(setpoint.pageErrors, []);
  } finally {
    await setpoint.stop();
  }
});
