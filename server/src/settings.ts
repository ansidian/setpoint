// Typed settings over one row per section, with `@setpoint/shared`'s defaults for anything unset.
import {allSavedPlaces, DEFAULT_SETTINGS, savedPlaceFor, SETTINGS_SECTIONS, settingsSchema} from '@setpoint/shared';
import type {SavedPlace, Settings, SettingsPatch} from '@setpoint/shared';
import * as t from './db/schema.ts';
import {parse} from './errors.ts';
import {isoNow, transaction} from './store.ts';
import type {Store} from './store.ts';

export function getSettings(store: Store): Settings {
  const stored = new Map(store.db.select().from(t.settings).all().map(row => [row.section, row.value]));
  const merged = Object.fromEntries(SETTINGS_SECTIONS.map(section => [
    section, {...DEFAULT_SETTINGS[section], ...(stored.get(section) as object | undefined)},
  ]));
  // A stored value that no longer fits (a setting renamed or narrowed) falls back to the defaults.
  const result = settingsSchema.safeParse(merged);
  if (result.success) return result.data;
  return Object.fromEntries(SETTINGS_SECTIONS.map(section => {
    const one = settingsSchema.shape[section].safeParse(merged[section]);
    return [section, one.success ? one.data : DEFAULT_SETTINGS[section]];
  })) as Settings;
}

/** Home, then the other saved places (Settings › Places). */
export function savedPlaces(store: Store): SavedPlace[] {
  const settings = getSettings(store);
  return allSavedPlaces(settings.calendar.home, settings.places.saved);
}

/** A place's text, or the address alone of the saved place it names (any case). */
export function placeOrSaved(store: Store, place: string): string {
  return savedPlaceFor(place, savedPlaces(store))?.address ?? place;
}

export function updateSettings(store: Store, patch: SettingsPatch): Settings {
  return transaction(store, () => {
    const current = getSettings(store);
    const next = parse(settingsSchema, Object.fromEntries(SETTINGS_SECTIONS.map(section => [section, {...current[section], ...patch[section]}])));
    const updatedAt = isoNow(store);
    for (const section of SETTINGS_SECTIONS) {
      if (!patch[section]) continue;
      store.db.insert(t.settings).values({section, value: next[section], updatedAt})
        .onConflictDoUpdate({target: t.settings.section, set: {value: next[section], updatedAt}}).run();
    }
    return next;
  });
}
