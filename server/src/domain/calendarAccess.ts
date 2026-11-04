// SV-191: whether Setpoint may write to a calendar, from the accessRole Google gives the user on it
// (calendarList). Holiday and other subscribed calendars are `reader`; `writerWithoutPrivateAccess`
// writes everything but private events, so it counts as writable. Null is a calendar Google hasn't
// said of yet (Todoist's, or one not listed since the column came) and stays writable as before; a
// role Google adds later isn't known to write, so it doesn't.
const WRITING_ROLES = new Set(['owner', 'writer', 'writerWithoutPrivateAccess']);

export const calendarWritable = (accessRole: string | null): boolean => accessRole === null || WRITING_ROLES.has(accessRole);
