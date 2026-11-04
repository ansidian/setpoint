// The top-level domains a bare domain in a place may end in to count as a link ("example.tv/live",
// SV-179, Andy 2026-11-04): the common generic ones and every country code. A typo or a name with a
// dot in it ("St.Louis", "v2.0", "Room 3.14") ends in none of them.
//
// Left out on purpose, as they read as file names more often than as sites: .zip and .mov (generic),
// and .md, .py and .sh (Moldova, Paraguay, Saint Helena).

const GENERIC = [
  'com', 'net', 'org', 'edu', 'gov', 'mil', 'int', 'info', 'biz', 'name', 'pro', 'mobi', 'aero', 'coop', 'museum', 'jobs', 'travel', 'tel', 'asia', 'cat', 'post',
  'academy', 'agency', 'app', 'art', 'blog', 'business', 'cafe', 'camp', 'center', 'church', 'city', 'click', 'cloud', 'club', 'college', 'community',
  'company', 'consulting', 'design', 'dev', 'digital', 'email', 'events', 'expert', 'fun', 'gallery', 'games', 'global', 'group', 'guide', 'health', 'host',
  'house', 'inc', 'institute', 'law', 'life', 'link', 'live', 'llc', 'ltd', 'media', 'meet', 'menu', 'network', 'news', 'ninja', 'one', 'online', 'page',
  'photo', 'photos', 'plus', 'press', 'school', 'services', 'shop', 'site', 'social', 'software', 'solutions', 'space', 'store', 'stream', 'studio',
  'support', 'systems', 'team', 'tech', 'today', 'tools', 'top', 'university', 'video', 'website', 'wiki', 'work', 'works', 'world', 'xyz', 'zone', 'zoom',
];

const COUNTRY = [
  'ac', 'ad', 'ae', 'af', 'ag', 'ai', 'al', 'am', 'ao', 'aq', 'ar', 'as', 'at', 'au', 'aw', 'ax', 'az', 'ba', 'bb', 'bd', 'be', 'bf', 'bg', 'bh', 'bi', 'bj',
  'bm', 'bn', 'bo', 'br', 'bs', 'bt', 'bw', 'by', 'bz', 'ca', 'cc', 'cd', 'cf', 'cg', 'ch', 'ci', 'ck', 'cl', 'cm', 'cn', 'co', 'cr', 'cu', 'cv', 'cw', 'cx',
  'cy', 'cz', 'de', 'dj', 'dk', 'dm', 'do', 'dz', 'ec', 'ee', 'eg', 'er', 'es', 'et', 'eu', 'fi', 'fj', 'fk', 'fm', 'fo', 'fr', 'ga', 'gb', 'gd', 'ge', 'gf',
  'gg', 'gh', 'gi', 'gl', 'gm', 'gn', 'gp', 'gq', 'gr', 'gs', 'gt', 'gu', 'gw', 'gy', 'hk', 'hm', 'hn', 'hr', 'ht', 'hu', 'id', 'ie', 'il', 'im', 'in', 'io',
  'iq', 'ir', 'is', 'it', 'je', 'jm', 'jo', 'jp', 'ke', 'kg', 'kh', 'ki', 'km', 'kn', 'kp', 'kr', 'kw', 'ky', 'kz', 'la', 'lb', 'lc', 'li', 'lk', 'lr', 'ls',
  'lt', 'lu', 'lv', 'ly', 'ma', 'mc', 'me', 'mg', 'mh', 'mk', 'ml', 'mm', 'mn', 'mo', 'mp', 'mq', 'mr', 'ms', 'mt', 'mu', 'mv', 'mw', 'mx', 'my', 'mz', 'na',
  'nc', 'ne', 'nf', 'ng', 'ni', 'nl', 'no', 'np', 'nr', 'nu', 'nz', 'om', 'pa', 'pe', 'pf', 'pg', 'ph', 'pk', 'pl', 'pm', 'pn', 'pr', 'ps', 'pt', 'pw', 'qa',
  're', 'ro', 'rs', 'ru', 'rw', 'sa', 'sb', 'sc', 'sd', 'se', 'sg', 'si', 'sk', 'sl', 'sm', 'sn', 'so', 'sr', 'ss', 'st', 'su', 'sv', 'sx', 'sy', 'sz', 'tc',
  'td', 'tf', 'tg', 'th', 'tj', 'tk', 'tl', 'tm', 'tn', 'to', 'tr', 'tt', 'tv', 'tw', 'tz', 'ua', 'ug', 'uk', 'us', 'uy', 'uz', 'va', 'vc', 've', 'vg', 'vi',
  'vn', 'vu', 'wf', 'ws', 'ye', 'yt', 'za', 'zm', 'zw',
];

const TLDS: ReadonlySet<string> = new Set([...GENERIC, ...COUNTRY]);

/** Whether a bare domain ending in `tld` ("tv", "com") counts as a link; any case. */
export const isLinkTld = (tld: string): boolean => TLDS.has(tld.toLowerCase());
