// SV-85: the rule the iPhone app's contract test applies. A fixture is a recorded response; its shape
// is what an app decoding it by hand relies on: the keys every object at a path has, and the JSON
// kinds each path has taken (merged across an array's elements). A live response breaks an older
// app when a key goes, or a path takes a kind the fixture never showed. A new key never does.

export type Kind = 'null' | 'boolean' | 'integer' | 'number' | 'string' | 'instant' | 'date' | 'array' | 'object';

export interface Shape {
  kinds: Set<Kind>;
  // Each key seen in the objects at this path, and whether every one of them had it.
  keys: Map<string, {shape: Shape; always: boolean}>;
  // The elements of the arrays at this path; null while none had any.
  items: Shape | null;
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function kindOf(value: unknown): Kind {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'boolean': return 'boolean';
    case 'number': return Number.isInteger(value) ? 'integer' : 'number';
    case 'string': return INSTANT.test(value) ? 'instant' : DATE.test(value) ? 'date' : 'string';
    case 'object': return 'object';
    default: throw new Error(`Not JSON: ${typeof value}`);
  }
}

const empty = (): Shape => ({kinds: new Set(), keys: new Map(), items: null});

/** The shape of every value given, as one path: an array's elements are its samples. */
export function shapeOf(samples: unknown[]): Shape {
  const shape = empty();
  const objects: Record<string, unknown>[] = [];
  const elements: unknown[] = [];
  for (const value of samples) {
    const kind = kindOf(value);
    shape.kinds.add(kind);
    if (kind === 'object') objects.push(value as Record<string, unknown>);
    if (kind === 'array') elements.push(...(value as unknown[]));
  }
  const names = new Set(objects.flatMap(object => Object.keys(object)));
  for (const name of names) {
    const having = objects.filter(object => name in object);
    shape.keys.set(name, {shape: shapeOf(having.map(object => object[name])), always: having.length === objects.length});
  }
  if (elements.length) shape.items = shapeOf(elements);
  return shape;
}

// A string field may come back looking like a date; a date field coming back as free text breaks
// a date decoder. A number field may hold a whole number; an integer field holding 0.5 breaks Int.
const ACCEPTS: Partial<Record<Kind, Kind[]>> = {string: ['instant', 'date'], number: ['integer']};
const accepts = (kinds: Set<Kind>, kind: Kind) => kinds.has(kind) || [...kinds].some(known => ACCEPTS[known]?.includes(kind));
const isNullOnly = (shape: Shape) => shape.kinds.size === 1 && shape.kinds.has('null');

/** What an app built against `fixture` can't decode in `live`, one line per path. */
export function breaks(fixture: Shape, live: Shape, path = ''): string[] {
  const at = path || '(the response)';
  const found: string[] = [];
  // A path the fixture only saw as null says nothing about its kind (unseen lists it).
  const unknown = isNullOnly(fixture) ? [] : [...live.kinds].filter(kind => !accepts(fixture.kinds, kind));
  if (unknown.length) found.push(`${at}: was ${[...fixture.kinds].join(' or ')}, now also ${unknown.join(' or ')}`);
  if (fixture.kinds.has('object') && live.kinds.has('object')) {
    for (const [name, key] of fixture.keys) {
      const now = live.keys.get(name);
      const keyPath = path ? `${path}.${name}` : name;
      if (key.always && !now) found.push(`${keyPath}: removed`);
      else if (key.always && !now!.always) found.push(`${keyPath}: missing from some`);
      if (now) found.push(...breaks(key.shape, now.shape, keyPath));
    }
  }
  if (fixture.items && live.items) found.push(...breaks(fixture.items, live.items, `${path}[]`));
  return found;
}

/** The paths a fixture can't speak for: always null, or arrays always empty. Re-recording lists them. */
export function unseen(shape: Shape, path = ''): string[] {
  const at = path || '(the response)';
  const found: string[] = [];
  if (isNullOnly(shape)) found.push(`${at}: always null`);
  if (shape.kinds.has('array') && !shape.items) found.push(`${at}: always empty`);
  for (const [name, key] of shape.keys) found.push(...unseen(key.shape, path ? `${path}.${name}` : name));
  if (shape.items) found.push(...unseen(shape.items, `${path}[]`));
  return found;
}

/** Enum values in `now` that `pinned` lacks: an older app can't decode them. A removed one is fine. */
export function addedValues(pinned: Record<string, readonly string[]>, now: Record<string, readonly string[]>): string[] {
  return Object.entries(now).flatMap(([name, values]) => {
    if (!pinned[name]) return [`${name}: not pinned yet`];
    return values.filter(value => !pinned[name]!.includes(value)).map(value => `${name}: ${value} added`);
  });
}
