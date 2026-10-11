// Weather: day forecasts at Home for the grid and the right pane, from Pirate Weather (v1's
// provider, Dark Sky's format), polled every 30 minutes as its own source. Adapted from v1's
// `platform/weather` (see SV-6): the key is read on each check (a new key takes at once), a failed
// check fails rather than passing old forecasts off as fresh (v1 17489089), the provider's
// timezone decides each day, and the key never appears in an error (it's in the URL's path).
// v2 keeps the days only: Dark Sky's daytime high and overnight low, and four conditions.
import type {WeatherCondition} from '@setpoint/shared';
import {and, gte} from 'drizzle-orm';
import * as t from '../../db/schema.ts';
import {localDay} from '../../domain/time.ts';
import {getSettings} from '../../settings.ts';
import {isoNow, noteLive, transaction} from '../../store.ts';
import type {Store} from '../../store.ts';
import type {SourceAdapter} from '../../sync/adapter.ts';
import {ProviderError} from '../../sync/errors.ts';
import {reasonPhrase, requestJson} from '../http.ts';
import type {HttpOptions} from '../http.ts';

export const PIRATE_WEATHER_API = 'https://api.pirateweather.net';
export const WEATHER_TIMEOUT_MS = 10_000;

/** Dark Sky's icons as the four conditions the grid draws; anything unknown is cloud, not sun (v1 said sun). */
export function conditionOf(icon: string | undefined): WeatherCondition {
  switch (icon) {
    case 'clear-day':
    case 'clear-night':
      return 'sun';
    case 'partly-cloudy-day':
    case 'partly-cloudy-night':
      return 'partly_cloudy';
    case 'rain':
    case 'sleet':
    case 'snow':
    case 'hail':
    case 'thunderstorm':
    case 'tornado':
      return 'rain';
    default:
      return 'cloud';
  }
}

interface Forecast {
  timezone?: string;
  daily?: {data?: {time?: number; icon?: string; temperatureHigh?: number; temperatureLow?: number}[]};
}

export interface WeatherDay {
  date: string;
  condition: WeatherCondition;
  highF: number;
  lowF: number;
}

/** The forecast's days, each on its date in the forecast's own zone. */
export function forecastDays(forecast: Forecast, fallbackZone: string): WeatherDay[] {
  const zone = forecast.timezone ?? fallbackZone;
  return (forecast.daily?.data ?? []).flatMap(day => {
    if (typeof day.time !== 'number' || !Number.isFinite(day.time) || typeof day.temperatureHigh !== 'number' || typeof day.temperatureLow !== 'number') return [];
    return [{date: localDay(day.time * 1000, zone), condition: conditionOf(day.icon), highF: Math.round(day.temperatureHigh), lowF: Math.round(day.temperatureLow)}];
  });
}

export interface WeatherOptions extends HttpOptions {
  baseUrl?: string;
}

export function weatherAdapter(options: WeatherOptions = {}): SourceAdapter {
  const check = async (store: Store, key: string | null, signal: AbortSignal) => {
    const settings = getSettings(store).calendar;
    if (!settings.weather) return;
    if (!key) throw new ProviderError('auth', 'Weather needs a Pirate Weather key.');
    if (!settings.home) throw new ProviderError('permanent', 'Set Home in Settings › Calendar for the forecast.');
    const url = `${(options.baseUrl ?? PIRATE_WEATHER_API).replace(/\/+$/, '')}/forecast/${encodeURIComponent(key)}/${encodeURIComponent(`${settings.home.lat},${settings.home.lng}`)}?exclude=minutely,hourly,alerts,flags&units=us`;
    let forecast: Forecast;
    try {
      forecast = await requestJson<Forecast>({timeoutMs: WEATHER_TIMEOUT_MS, ...options}, {url, signal}, status => ({message: `Pirate Weather answered ${status} ${reasonPhrase(status)}.`}), 'Pirate Weather');
    } catch (error) {
      // Never let the key (in the URL) reach a message.
      if (error instanceof ProviderError) throw new ProviderError(error.kind, error.message.replaceAll(key, '…'), {status: error.status, retryAfterMs: error.retryAfterMs});
      throw error;
    }
    const days = forecastDays(forecast ?? {}, store.timeZone);
    if (!days.length) throw new ProviderError('transient', 'Pirate Weather sent no daily forecast.');
    transaction(store, () => {
      const fetchedAt = isoNow(store);
      // Today's and later forecasts are replaced; past days keep their last forecast.
      store.db.delete(t.weatherDays).where(and(gte(t.weatherDays.date, localDay(store.now().getTime(), store.timeZone)))).run();
      for (const day of days) {
        store.db.insert(t.weatherDays).values({...day, fetchedAt}).onConflictDoUpdate({target: t.weatherDays.date, set: {...day, fetchedAt}}).run();
      }
      noteLive(store, {type: 'items', items: [], calendars: [], commands: []});
    });
  };
  const key = (credentials: ReturnType<Parameters<SourceAdapter['sync']>[0]['credentials']>) => (credentials?.kind === 'api_key' ? credentials.key : null);
  return {
    async sync(context) {
      await check(context.store, key(context.credentials()), context.signal);
      return {cursor: null};
    },
    sweep: context => check(context.store, key(context.credentials()), context.signal),
    async execute() {
      throw new ProviderError('permanent', 'Weather has nothing to change.');
    },
  };
}
