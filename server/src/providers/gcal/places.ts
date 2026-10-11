// Places autocomplete for the editor's place field, Places API (New), with the editor's session
// token so one editing session is billed as one. Harvested from v1's `google-places` (see SV-6):
// "a&b auto" becomes "a & b auto" (Google missed the exact business otherwise), results
// are restricted to 12 km around Home, widened to 24 km (still a restriction, merged, first pass
// first: v1 291f8e8c) when that finds fewer than five, ranked by distance, US only. The key is
// Settings' Places key (also Time to Leave's routes).
import type {Home, PlaceOut, PlaceSuggestionOut} from '@setpoint/shared';
import {requestJson} from '../http.ts';
import type {HttpOptions} from '../http.ts';
import {ProviderError} from '../../sync/errors.ts';
import {readGoogleRefusal} from './api.ts';

export const PLACES_API = 'https://places.googleapis.com';
export const PLACES_TIMEOUT_MS = 10_000;
export const PLACES_FIELD_MASK = 'suggestions.placePrediction.placeId,suggestions.placePrediction.text,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.distanceMeters';
const NEAR_METERS = 12_000;
const WIDER_METERS = 24_000;
const ENOUGH = 5;

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

/** Suggestions for what the user has typed; [] for nothing typed. Throws a ProviderError with Google's words. */
export async function placeSuggestions(options: PlacesOptions, key: string, query: string, sessionToken: string, home: Home | null, signal?: AbortSignal): Promise<PlaceSuggestionOut[]> {
  const input = normalisePlaceQuery(query);
  if (!input) return [];
  const ask = (radius: number | null) => requestJson<{suggestions?: {placePrediction?: Prediction}[]}>({timeoutMs: PLACES_TIMEOUT_MS, ...options}, {
    method: 'POST', url: `${(options.baseUrl ?? PLACES_API).replace(/\/+$/, '')}/v1/places:autocomplete`, signal,
    headers: {'x-goog-api-key': key, 'x-goog-fieldmask': PLACES_FIELD_MASK},
    body: {
      input, languageCode: 'en', regionCode: 'US', includedRegionCodes: ['us'], sessionToken,
      ...(home ? {origin: {latitude: home.lat, longitude: home.lng}} : {}),
      ...(home && radius ? {locationRestriction: {circle: {center: {latitude: home.lat, longitude: home.lng}, radius}}} : {}),
    },
  }, readGoogleRefusal, 'Google Places');
  let found = suggestions(await ask(home ? NEAR_METERS : null));
  if (home && found.length < ENOUGH) {
    const seen = new Set(found.map(place => place.place_id));
    found = [...found, ...suggestions(await ask(WIDER_METERS)).filter(place => !seen.has(place.place_id))];
  }
  // Nearest first; Google's order otherwise (a stable sort), unknown distances last.
  return found
    .map((place, index) => ({place, index}))
    .sort((a, b) => (a.place.distance ?? Infinity) - (b.place.distance ?? Infinity) || a.index - b.index)
    .map(({place: {distance: _distance, ...place}}) => place);
}

/**
 * F7: one place's name, address and coordinates (Place Details, Places API (New)), for Home in
 * Settings › Calendar; the session token closes the autocomplete session it came from. Throws a
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
