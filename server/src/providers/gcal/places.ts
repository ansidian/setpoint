// Places autocomplete for the editor's place field, Places API (New), with the editor's session
// token so one editing session is billed as one.
// "a&b auto" becomes "a & b auto" (Google missed the exact business otherwise). US only. With a
// Home, two requests run at once: near, restricted to 12 km around Home and listed first, nearest
// first; and wide, only biased to Home, whose places not already listed follow in Google's order
// (which ranks a well-known far place, such as an airport, high): at least two, or enough to make
// five. Bias alone once pushed a wanted local business off the list, so the near list stays first.
// Without a Home, one request with no area. A business's
// second line leaves out the street number, so each suggestion's address comes from Place Details
// (the address alone, without the session token, which stays open for the pick), kept for a day.
// The key is Settings' Places key (also Time to Leave's routes).
import type {Home, PlaceOut, PlaceSuggestionOut} from '@setpoint/shared';
import {requestJson} from '../http.ts';
import type {HttpOptions} from '../http.ts';
import {ProviderError} from '../../sync/errors.ts';
import {readGoogleRefusal} from './api.ts';

export const PLACES_API = 'https://places.googleapis.com';
export const PLACES_TIMEOUT_MS = 10_000;
export const PLACES_FIELD_MASK = 'suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.distanceMeters';
const NEAR_METERS = 12_000;
const ENOUGH = 5;
const WIDE_AT_LEAST = 2;
const ADDRESS_KEPT_MS = 24 * 60 * 60_000;
const ADDRESSES_KEPT = 500;
// place id → its full address and when it was read.
const addresses = new Map<string, {address: string; at: number}>();

export interface PlacesOptions extends HttpOptions {
  baseUrl?: string;
}

interface Prediction {
  placeId?: string;
  text?: {text?: string};
  structuredFormat?: {mainText?: {text?: string}; secondaryText?: {text?: string}};
  distanceMeters?: number;
}

/** "a&b auto" → "a & b auto", spaces collapsed. */
export const normalisePlaceQuery = (query: string) => query.trim().replace(/\s*&\s*/g, ' & ').replace(/\s+/g, ' ');

type Ranked = PlaceSuggestionOut & {distance: number | null};

function suggestions(answer: {suggestions?: {placePrediction?: Prediction}[]} | null): Ranked[] {
  return (answer?.suggestions ?? []).flatMap(({placePrediction: prediction}) => {
    const name = prediction?.structuredFormat?.mainText?.text ?? prediction?.text?.text;
    if (!prediction?.placeId || !name) return [];
    return [{place_id: prediction.placeId, name, address: prediction.structuredFormat?.secondaryText?.text ?? '', distance: typeof prediction.distanceMeters === 'number' ? prediction.distanceMeters : null}];
  });
}

/** Suggestions for what the user has typed. [] for nothing typed. Throws a ProviderError with Google's words. */
export async function placeSuggestions(options: PlacesOptions, key: string, query: string, sessionToken: string, home: Home | null, signal?: AbortSignal): Promise<PlaceSuggestionOut[]> {
  const input = normalisePlaceQuery(query);
  if (!input) return [];
  const ask = (area: object) => requestJson<{suggestions?: {placePrediction?: Prediction}[]}>({timeoutMs: PLACES_TIMEOUT_MS, ...options}, {
    method: 'POST', url: `${(options.baseUrl ?? PLACES_API).replace(/\/+$/, '')}/v1/places:autocomplete`, signal,
    headers: {'x-goog-api-key': key, 'x-goog-fieldmask': PLACES_FIELD_MASK},
    body: {
      input, languageCode: 'en', regionCode: 'US', includedRegionCodes: ['us'], sessionToken,
      ...(home ? {origin: {latitude: home.lat, longitude: home.lng}} : {}),
      ...area,
    },
  }, readGoogleRefusal, 'Google Places');
  // Nearest first, Google's order otherwise (a stable sort), unknown distances last.
  const nearestFirst = (found: Ranked[]) => found
    .map((place, index) => ({place, index}))
    .sort((a, b) => (a.place.distance ?? Infinity) - (b.place.distance ?? Infinity) || a.index - b.index)
    .map(({place}) => place);
  let found: Ranked[];
  if (home) {
    const circle = {circle: {center: {latitude: home.lat, longitude: home.lng}, radius: NEAR_METERS}};
    const [near, wide] = await Promise.all([ask({locationRestriction: circle}), ask({locationBias: circle})]);
    const listed = nearestFirst(suggestions(near));
    const seen = new Set(listed.map(place => place.place_id));
    const more = suggestions(wide).filter(place => !seen.has(place.place_id));
    found = [...listed, ...more.slice(0, Math.max(WIDE_AT_LEAST, ENOUGH - listed.length))];
  } else {
    found = nearestFirst(suggestions(await ask({})));
  }
  const ranked = found.map(({distance: _distance, ...place}) => place);
  return Promise.all(ranked.map(async place => ({...place, address: await fullAddress(options, key, place.place_id, signal) ?? place.address})));
}

/** A place's address as Place Details has it, or null when Google gives none or refuses. */
async function fullAddress(options: PlacesOptions, key: string, placeId: string, signal?: AbortSignal): Promise<string | null> {
  const kept = addresses.get(placeId);
  if (kept && Date.now() - kept.at < ADDRESS_KEPT_MS) return kept.address;
  try {
    const answer = await requestJson<{formattedAddress?: string}>({timeoutMs: PLACES_TIMEOUT_MS, ...options}, {
      method: 'GET', url: `${(options.baseUrl ?? PLACES_API).replace(/\/+$/, '')}/v1/places/${encodeURIComponent(placeId)}`, signal,
      headers: {'x-goog-api-key': key, 'x-goog-fieldmask': 'formattedAddress'},
    }, readGoogleRefusal, 'Google Places');
    const address = answer?.formattedAddress;
    if (!address) return null;
    addresses.delete(placeId);
    addresses.set(placeId, {address, at: Date.now()});
    if (addresses.size > ADDRESSES_KEPT) addresses.delete(addresses.keys().next().value!);
    return address;
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
}

/**
 * One place's name, address and coordinates (Place Details, Places API (New)), for Home in
 * Settings › Calendar. The session token closes the autocomplete session it came from. Throws a
 * ProviderError with Google's words.
 */
export async function placeDetails(options: PlacesOptions, key: string, placeId: string, sessionToken: string | null, signal?: AbortSignal): Promise<PlaceOut> {
  const query = sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : '';
  const answer = await requestJson<{id?: string; displayName?: {text?: string}; formattedAddress?: string; location?: {latitude?: number; longitude?: number}}>({timeoutMs: PLACES_TIMEOUT_MS, ...options}, {
    method: 'GET', url: `${(options.baseUrl ?? PLACES_API).replace(/\/+$/, '')}/v1/places/${encodeURIComponent(placeId)}${query}`, signal,
    headers: {'x-goog-api-key': key, 'x-goog-fieldmask': 'id,displayName,formattedAddress,location'},
  }, readGoogleRefusal, 'Google Places');
  const {latitude: lat, longitude: lng} = answer?.location ?? {};
  if (typeof lat !== 'number' || typeof lng !== 'number') throw new ProviderError('permanent', 'Google Places gave no location for that place.');
  return {place_id: answer?.id ?? placeId, name: answer?.displayName?.text ?? answer?.formattedAddress ?? placeId, address: answer?.formattedAddress ?? '', lat, lng};
}
