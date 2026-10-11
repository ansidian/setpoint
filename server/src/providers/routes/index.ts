// Live drive times for Time to Leave: Google's Routes API from Home's coordinates to the event's
// place, traffic-aware. Harvested from v1's `platform/google-routes` (see SV-6): the two-field mask
// (billed by what's asked), DRIVE with TRAFFIC_AWARE_OPTIMAL, a duration like "901.25s" rounded up,
// no route is a refusal, nothing of Google's body echoed. Added: the departure time (v1 asked about
// traffic now, for an event hours away), and the key is Settings' Google Maps key (Places').
import {ProviderError} from '../../sync/errors.ts';
import {requestJson} from '../http.ts';
import type {HttpOptions} from '../http.ts';
import {readGoogleRefusal} from '../gcal/api.ts';

export const ROUTES_API = 'https://routes.googleapis.com';
export const ROUTES_TIMEOUT_MS = 10_000;
export const ROUTES_FIELD_MASK = 'routes.duration,routes.distanceMeters';

export interface RoutesOptions extends HttpOptions {
  baseUrl?: string;
}

export interface Route {
  durationSeconds: number;
  distanceMeters: number;
}

export interface RouteRequest {
  origin: {lat: number; lng: number};
  destination: string;
  // When the user would leave; sent only while it's still ahead (Google refuses a past one).
  departAt: string | null;
  now: string;
}

/** A drive time, or a ProviderError in Google's words. */
export async function computeRoute(options: RoutesOptions, key: string, request: RouteRequest, signal?: AbortSignal): Promise<Route> {
  const departure = request.departAt && Date.parse(request.departAt) > Date.parse(request.now) + 60_000 ? request.departAt : null;
  const answer = await requestJson<{routes?: {duration?: string; distanceMeters?: number}[]}>({timeoutMs: ROUTES_TIMEOUT_MS, ...options}, {
    method: 'POST', url: `${(options.baseUrl ?? ROUTES_API).replace(/\/+$/, '')}/directions/v2:computeRoutes`, signal,
    headers: {'x-goog-api-key': key, 'x-goog-fieldmask': ROUTES_FIELD_MASK},
    body: {
      origin: {location: {latLng: {latitude: request.origin.lat, longitude: request.origin.lng}}},
      destination: {address: request.destination},
      travelMode: 'DRIVE', routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
      ...(departure ? {departureTime: departure} : {}),
    },
  }, readGoogleRefusal, 'Google Routes');
  if (!Array.isArray(answer?.routes)) throw new ProviderError('transient', 'Google Routes answered with something unexpected.');
  const [route] = answer.routes;
  if (!route) throw new ProviderError('permanent', `Google Routes found no drive to ${request.destination}.`);
  const duration = /^(\d+)(?:\.(\d{1,9}))?s$/.exec(route.duration ?? '');
  if (!duration || !Number.isSafeInteger(route.distanceMeters) || route.distanceMeters! < 0) throw new ProviderError('transient', 'Google Routes answered with something unexpected.');
  return {durationSeconds: Math.ceil(Number(`${duration[1]}.${duration[2] ?? '0'}`)), distanceMeters: route.distanceMeters!};
}
