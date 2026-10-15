// Not a board: the floating detail's place line with a link in it (SV-76, SV-77). Study group's
// location is a room and a long call link, which has to wrap inside the card rather than run out of
// it; Career fair's is a link alone, drawn as its host with Open.
import {eq} from 'drizzle-orm';
import type {OpenDatabase} from '../../db/open.ts';
import * as t from '../../db/schema.ts';

export const LINK_PLACES: [title: string, place: string][] = [
  ['Study group', 'Room 204 or https://meet.example.com/j/81234567890?pwd=Q2xhc3NSb29tTGlua0ZvclN0dWR5R3JvdXA'],
  ['Career fair', 'https://www.careers.example.edu/fair/fall-2026'],
];

export function linkPlaces({db}: OpenDatabase) {
  db.transaction(tx => {
    for (const [title, place] of LINK_PLACES) {
      const moved = tx.update(t.items).set({place, address: null}).where(eq(t.items.title, title)).run();
      if (!moved.changes) throw new Error(`The link-places fixture needs the seed's ${title}: run \`npm run seed\` first.`);
    }
  });
}
