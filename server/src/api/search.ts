// Search's routes, Alfred's and the proposals from an email, and Places' suggestions. Mounted under
// /api behind the session (app.ts).
import {
  alfredActedInput, placeInput, placesInput, askInput, proposalInput, searchChipRemovedInput, searchInput, searchOpenedInput, searchSuggestionInput, searchSuggestionLogInput,
} from '@setpoint/shared';
import {eq} from 'drizzle-orm';
import {Hono} from 'hono';
import type {Context} from 'hono';
import {z} from 'zod';
import {alfredStep, askAlfred, conversation, fixActed, proposalActed} from '../alfred/ask.ts';
import type {AlfredOptions} from '../alfred/ask.ts';
import {prefillFromMessage} from '../alfred/prefill.ts';
import type {PrefillOptions} from '../alfred/prefill.ts';
import {inviteOf, proposeFromMessage} from '../alfred/proposals.ts';
import * as t from '../db/schema.ts';
import {invalid, parse, SetpointError} from '../errors.ts';
import {devPlace, devPlaces} from '../providers/dev/index.ts';
import {placeDetails, placeSuggestions} from '../providers/gcal/places.ts';
import {recentPlaceList} from '../queries/items.ts';
import {recordChipRemoved, recordOpened, recordSuggestion} from '../search/log.ts';
import {SearchReader} from '../search/reading.ts';
import type {SearchReaderOptions} from '../search/reading.ts';
import {ProviderError} from '../sync/errors.ts';
import {readSecret} from '../secrets/store.ts';
import {getSettings} from '../settings.ts';
import type {Store} from '../store.ts';
import type {SyncEngine} from '../sync/engine.ts';
import type {AppOptions} from './app.ts';

const id = (value: string) => parse(z.coerce.number().pipe(z.int().positive()), value);

async function body(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw invalid('The body must be JSON.');
  }
}

export interface SearchApiOptions {
  engine: SyncEngine | null;
  alfred: AlfredOptions;
  prefill: PrefillOptions;
  reading: Omit<SearchReaderOptions, 'store'>;
  providers: NonNullable<AppOptions['providers']>;
  production: boolean;
}

export function searchApi(store: Store, {engine, alfred, prefill, reading, providers, production}: SearchApiOptions) {
  const api = new Hono();
  const searchReader = new SearchReader({store, ...reading});

  // ---- Search, Alfred and proposals, and Places ----

  api.post('/search', async c => c.json(await searchReader.search(parse(searchInput, await body(c)))));
  api.post('/search/suggestion', async c => c.json(await searchReader.suggest(parse(searchSuggestionInput, await body(c)))));
  api.post('/search/suggestion-log', async c => {
    recordSuggestion(store, parse(searchSuggestionLogInput, await body(c)));
    return c.body(null, 204);
  });
  api.post('/search/opened', async c => {
    recordOpened(store, parse(searchOpenedInput, await body(c)));
    return c.body(null, 204);
  });
  api.post('/search/chip-removed', async c => {
    recordChipRemoved(store, parse(searchChipRemovedInput, await body(c)));
    return c.body(null, 204);
  });
  api.post('/proposals/from-message', async c => {
    const input = parse(proposalInput, await body(c));
    return c.json(proposeFromMessage(store, input.message_id, input.kind, {}, await inviteOf(store, engine, input.message_id)));
  });
  api.post('/proposals/prefill', async c => {
    const input = parse(proposalInput, await body(c));
    return c.json(await prefillFromMessage(store, engine, input.message_id, input.kind, prefill));
  });
  api.post('/alfred/ask', async c => c.json(await askAlfred(store, parse(askInput, await body(c)), {...alfred, engine})));
  api.get('/alfred/conversations/:id', c => c.json(conversation(store, id(c.req.param('id')))));
  api.get('/alfred/asks/:askId', c => c.json({step: alfredStep(store, c.req.param('askId'))}));
  api.post('/alfred/acted', async c => {
    const {turn_id, index, fix, acted} = parse(alfredActedInput, await body(c));
    if (fix) fixActed(store, turn_id, index, acted);
    else proposalActed(store, turn_id, index);
    return c.body(null, 204);
  });
  // The places events have used, before anything is typed. Before /api/places/:place_id.
  api.get('/places/recent', c => c.json(recentPlaceList(store)));
  api.get('/places', async c => {
    const input = parse(placesInput, c.req.query());
    const key = readSecret(store, 'places_api_key');
    // The seed's dev runs suggest invented places instead (never Google's).
    if (!key && !production && store.db.select({id: t.sources.id}).from(t.sources).where(eq(t.sources.dev, true)).get()) return c.json(devPlaces(input.query));
    if (!key) throw new SetpointError('places_not_configured', 'Add a Google Maps key in Settings › Calendar for place suggestions.', 503);
    try {
      return c.json(await placeSuggestions(providers.places ?? {}, key, input.query, input.session_token, getSettings(store).calendar.home));
    } catch (error) {
      if (error instanceof ProviderError) throw new SetpointError('places_failed', error.message, 502);
      throw error;
    }
  });

  // One place with its coordinates, for Home in Settings › Calendar, and the dev runs'
  // invented places likewise.
  api.get('/places/:place_id', async c => {
    const input = parse(placeInput, c.req.query());
    const placeId = parse(z.string().min(1).max(300), c.req.param('place_id'));
    const key = readSecret(store, 'places_api_key');
    if (!key && !production && store.db.select({id: t.sources.id}).from(t.sources).where(eq(t.sources.dev, true)).get()) {
      const place = devPlace(placeId);
      if (!place) throw new SetpointError('not_found', 'No such place.', 404);
      return c.json(place);
    }
    if (!key) throw new SetpointError('places_not_configured', 'Add a Google Maps key in Settings › Calendar for place suggestions.', 503);
    try {
      return c.json(await placeDetails(providers.places ?? {}, key, placeId, input.session_token ?? null));
    } catch (error) {
      if (error instanceof ProviderError) throw new SetpointError('places_failed', error.message, 502);
      throw error;
    }
  });

  return api;
}
