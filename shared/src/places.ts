// Saved places (Settings › Places): Home, then the named addresses the user keeps. "@Work" in an
// event's line, Work in its Place field or a place Alfred proposes that names one takes its address.
// Home is kept in the calendar section, where it always was (Time to Leave, the forecast and News start
// from it); the others are the `places` section's list. Names are unique in any case, "Home" is
// Home's, and they may have spaces.
import {z} from 'zod';

export const HOME_NAME = 'Home';
export const PLACE_NAME_MAX = 80;
export const PLACE_ADDRESS_MAX = 300;
export const SAVED_PLACES_MAX = 100;

export const savedPlaceSchema = z.strictObject({
  name: z.string().trim().min(1).max(PLACE_NAME_MAX),
  address: z.string().trim().min(1).max(PLACE_ADDRESS_MAX),
});
export type SavedPlace = z.infer<typeof savedPlaceSchema>;

const fold = (name: string) => name.trim().toLowerCase();

/**
 * Why a name can't be a saved place's, as the line under its field says it, or null when it can.
 * `others` are the other saved places' names (not the one being renamed); Home's is always taken.
 */
export function placeNameProblem(name: string, others: readonly string[]): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Give it a name';
  if (trimmed.length > PLACE_NAME_MAX) return `Up to ${PLACE_NAME_MAX} characters`;
  const taken = [HOME_NAME, ...others].find(other => fold(other) === fold(trimmed));
  return taken ? `${taken} is already a saved place` : null;
}

/** The list as Settings keeps it: each name its own, none of them Home's. */
export const savedPlacesSchema = z.array(savedPlaceSchema).max(SAVED_PLACES_MAX).superRefine((list, context) => {
  list.forEach((place, index) => {
    const problem = placeNameProblem(place.name, list.slice(0, index).map(one => one.name));
    if (problem) context.addIssue({code: 'custom', path: [index, 'name'], message: problem});
  });
});

/** The saved places after Home, by name in any case. */
export const byName = (saved: readonly SavedPlace[]): SavedPlace[] => [...saved].sort((a, b) => a.name.localeCompare(b.name, undefined, {sensitivity: 'base'}));

/** Every saved place, Home first while it's set, then the others by name. */
export function allSavedPlaces(home: {address: string} | null, saved: readonly SavedPlace[]): SavedPlace[] {
  return [...(home ? [{name: HOME_NAME, address: home.address}] : []), ...byName(saved)];
}

/** The saved place a place's text names, in any case, or null. */
export function savedPlaceFor(text: string | null | undefined, places: readonly SavedPlace[]): SavedPlace | null {
  const wanted = fold(text ?? '');
  if (!wanted) return null;
  return places.find(place => fold(place.name) === wanted) ?? null;
}
