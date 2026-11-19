// The shared cache (api/client.ts) under a view: a refresh whose answer is the one already shown
// draws nothing again, so a change's refetches don't redraw the whole calendar for months it didn't
// touch; an answer that differs draws. The server is faked at `fetch`.
import {afterEach, expect, test, vi} from 'vitest';
import {render} from 'vitest-browser-react';
import {clearCache, refresh, useResource} from '../../src/api/client.ts';

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
