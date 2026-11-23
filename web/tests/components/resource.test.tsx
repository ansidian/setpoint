// The shared cache (api/client.ts) under a view: a refresh whose answer is the one already shown
// draws nothing again, so a change's refetches don't redraw the whole calendar for months it didn't
// touch; an answer that differs draws. A list of paths that grows keeps every answer it had, however
// many it holds (the phone's agenda, a week at a time). The server is faked at `fetch`.
import {useState} from 'react';
import {afterEach, expect, test, vi} from 'vitest';
import {render} from 'vitest-browser-react';
import {clearCache, getCached, KEPT_OFF_SCREEN, refresh, useResource, useResources} from '../../src/api/client.ts';

const PATH = '/things';
let draws = 0;

function Thing() {
  draws += 1;
  const {data} = useResource<{title: string}>(PATH);
  return <p>{data?.title ?? 'Loading'}</p>;
}

/** The server answers `title` from now on. */
const answer = (title: string) => vi.spyOn(window, 'fetch').mockImplementation(async () => new Response(JSON.stringify({title}), {headers: {'Content-Type': 'application/json'}}));

afterEach(() => {
  vi.restoreAllMocks();
  clearCache();
  draws = 0;
});

test('a refresh answering what is shown draws nothing again, and one that differs draws it', async () => {
  answer('Pay rent');
  const shown = await render(<Thing />);
  await expect.element(shown.getByText('Pay rent')).toBeVisible();
  const before = draws;

  await refresh(PATH);
  expect(draws).toBe(before);

  answer('Renew car registration');
  await refresh(PATH);
  await expect.element(shown.getByText('Renew car registration')).toBeVisible();
});

// The fewest answers drawn once the list grew.
let fewest = Infinity;

function Weeks({start}: {start: number}) {
  const [count, setCount] = useState(start);
  const paths = Array.from({length: count}, (_, index) => `/weeks/${index}`);
  const answers = useResources<{title: string}>(paths);
  if (count > start) fewest = Math.min(fewest, answers.filter(Boolean).length);
  return (
    <>
      <p>{answers.filter(Boolean).length} of {count}</p>
      <button type="button" onClick={() => setCount(count + 1)}>More</button>
    </>
  );
}

test('a list of paths that grows past what the cache keeps off screen keeps the answers it shows', async () => {
  answer('A week');
  const count = KEPT_OFF_SCREEN + 5;
  const shown = await render(<Weeks start={count} />);
  await expect.element(shown.getByText(`${count} of ${count}`)).toBeVisible();
  await shown.getByRole('button', {name: 'More'}).click();
  await expect.element(shown.getByText(`${count + 1} of ${count + 1}`)).toBeVisible();
  // None of those it had went missing on the way, the first included.
  expect(fewest).toBe(count);
  expect(getCached('/weeks/0')).toEqual({title: 'A week'});
});
