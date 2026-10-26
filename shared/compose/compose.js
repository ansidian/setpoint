// Setpoint's title parser (web/src/logic/compose.ts), built by web/tests/composeBundle.test.ts
// (npm run compose:record) for the iPhone app's JavaScriptCore: one script, no module loader, no DOM.
// Generated; don't edit. It defines the global SetpointCompose with:
//   parseTitle({text, kind: "event"|"task", today: "YYYY-MM-DD", calendars: [name], projects: [name],
//     pickedPlace?: string|null, pickedHash?: string|null, edit?: {before, day: "YYYY-MM-DD"}|null})
//     → {title, marks: [{start, end, kind: "when"|"place"|"calendar"|"project"}], date, start, end,
//        place, calendar, recurrence, project, days, length}
//     (edit: an item's title before it was edited, and its day; only what the edit typed is read)
//     (days: an event's all-day span of days, first and last counting, else null; length: minutes a
//      "for" length read, else null, the end already counting it when a start was read, and with
//      none the event starts at the default start, the slot's else 9:00 AM; SV-111)
//   bareToken({text, trigger: "#"|"@"}) → {start, query} | null
//   completeToken({text, start, end, name}) → {text, caret}
//   lineWithTitle({text, marks, title}) → string
//   typedSpan({before, after}) → {start, end}, what an edit typed
//   editedWhen({item: {date, start, end, days}, read: {date, start, end, days?, length?}, kind}) → {date, start, end, days}
//   call(name, inputJSON) → resultJSON, the same with JSON text
// Offsets are UTF-16 code units; start and end are minutes after midnight (an end past midnight is
// over 1440, an end at the start No end). shared/compose/cases.json records what each returns.
var SetpointCompose = (function(exports) {
	Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
	//#region web/src/logic/format.ts
	var DAY = 864e5;
	/** A local day `days` after `date` ("2026-10-07" + 1 → "2026-10-08"). */
	function addDays(date, days) {
		return new Date(Date.parse(`${date}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
	}
	/** Whole days from `from` to `to`, both local days. */
	function daysBetween(from, to) {
		return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / DAY);
	}
	//#endregion
	//#region web/src/logic/compose.ts
	var RRULE_DAYS = [
		"MO",
		"TU",
		"WE",
		"TH",
		"FR",
		"SA",
		"SU"
	];
	var WEEKDAY = "mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday|s)?|thu(?:r(?:s(?:day)?)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?";
	var MONTH = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
	var MONTHS = [
		"jan",
		"feb",
		"mar",
		"apr",
		"may",
		"jun",
		"jul",
		"aug",
		"sep",
		"oct",
		"nov",
		"dec"
	];
	var END = "(?=$|[\\s,.;!?])";
	var TIME = "(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm|a|p)?";
	var ORDINALS = {
		first: 1,
		"1st": 1,
		second: 2,
		"2nd": 2,
		third: 3,
		"3rd": 3,
		fourth: 4,
		"4th": 4,
		last: -1
	};
	/** Monday 0 … Sunday 6 for a weekday word. */
	var weekdayIndex = (word) => [
		"mon",
		"tue",
		"wed",
		"thu",
		"fri",
		"sat",
		"sun"
	].indexOf(word.slice(0, 3).toLowerCase());
	var weekdayOf = (date) => ((/* @__PURE__ */ new Date(`${date}T12:00:00Z`)).getUTCDay() + 6) % 7;
	/** A real day ("2026-02-30" isn't), or null. */
	function day(year, month, date) {
		const text = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
		const back = /* @__PURE__ */ new Date(`${text}T12:00:00Z`);
		return back.getUTCMonth() + 1 === month && back.getUTCDate() === date ? text : null;
	}
	/** A month and day with no year: this year's, or next year's once it's past. */
	function upcoming(month, date, today, year) {
		if (year) return day(Number(year.length === 2 ? `20${year}` : year), month, date);
		const thisYear = Number(today.slice(0, 4));
		const found = day(thisYear, month, date);
		return found && found < today ? day(thisYear + 1, month, date) : found;
	}
	/** Hours, minutes and am/pm as minutes after midnight; null for an impossible time. */
	function clock(hour, minute, meridiem) {
		if (minute > 59) return null;
		if (meridiem) {
			if (hour < 1 || hour > 12) return null;
			return (hour % 12 + (meridiem === "p" ? 12 : 0)) * 60 + minute;
		}
		return hour > 23 ? null : hour * 60 + minute;
	}
	var meridiemOf = (text) => text ? text[0].toLowerCase() : null;
	/**
	* A range's two ends. An end missing its am/pm takes the first reading after the start ("9am-5" is
	* 5 PM); a start missing its own takes the last reading before the end ("7-9pm" is 7 PM, "11-1pm"
	* 11 AM). With am/pm on neither, both need minutes or a 24-hour hour ("9:00-10:30", "13-15"). The
	* same time twice ("2-2pm", "14:00–14:00") is No end, the end at the start (SV-78, SV-108).
	*/
	function range(match) {
		const [, h1, m1, a1, h2, m2, a2] = match;
		const [startHour, startMinute, endHour, endMinute] = [
			Number(h1),
			Number(m1 ?? 0),
			Number(h2),
			Number(m2 ?? 0)
		];
		const startMer = meridiemOf(a1);
		const endMer = meridiemOf(a2);
		if (!startMer && !endMer && !(m1 || m2 || startHour > 12 || endHour > 12)) return null;
		const readings = (hour, minute) => [clock(hour, minute, "a"), clock(hour, minute, "p")].filter((value) => value !== null);
		let start = startMer ? clock(startHour, startMinute, startMer) : null;
		let end = endMer ? clock(endHour, endMinute, endMer) : null;
		if (!startMer && !endMer) {
			start = clock(startHour, startMinute, null);
			end = clock(endHour, endMinute, null);
		} else if (!startMer && end !== null) start = readings(startHour, startMinute).filter((value) => value <= end).at(-1) ?? clock(startHour, startMinute, endMer);
		else if (!endMer && start !== null) end = readings(endHour, endMinute).find((value) => value >= start) ?? clock(endHour, endMinute, startMer);
		if (start === null || end === null) return null;
		return {
			start,
			end: end < start ? end + 1440 : end
		};
	}
	/** "every mon, wed and fri" → MO,WE,FR in the week's order. */
	var byDays = (text) => [...new Set([...text.matchAll(new RegExp(WEEKDAY, "gi"))].map((found) => weekdayIndex(found[0])))].sort((a, b) => a - b).map((index) => RRULE_DAYS[index]).join(",");
	var fresh = (event) => ({
		date: null,
		start: null,
		end: null,
		place: null,
		calendar: null,
		recurrence: null,
		project: null,
		weeklyNeedsDay: false,
		repeatDays: [],
		event,
		length: null,
		last: null
	});
	var sticky = (source) => new RegExp(source, "iy");
	function rule(state, body, weeklyNeedsDay = false) {
		if (state.recurrence) return false;
		state.recurrence = `RRULE:${body}`;
		state.weeklyNeedsDay = weeklyNeedsDay;
		state.repeatDays = (/BYDAY=([A-Z,]+)/.exec(body)?.[1] ?? "").split(",").filter(Boolean).map((code) => RRULE_DAYS.indexOf(code));
		return true;
	}
	var setDate = (state, date) => {
		if (!date || state.date) return false;
		state.date = date;
		return true;
	};
	var REPEATS = [
		{
			kind: "when",
			pattern: sticky(`every\\s+other\\s+(${WEEKDAY})${END}`),
			apply: (m, s) => rule(s, `FREQ=WEEKLY;INTERVAL=2;BYDAY=${byDays(m[1])}`)
		},
		{
			kind: "when",
			pattern: sticky(`(first|1st|second|2nd|third|3rd|fourth|4th|last)\\s+(${WEEKDAY})\\s+(?:of\\s+)?every\\s+month${END}`),
			apply: (m, s) => rule(s, `FREQ=MONTHLY;BYDAY=${ORDINALS[m[1].toLowerCase()]}${RRULE_DAYS[weekdayIndex(m[2])]}`)
		},
		{
			kind: "when",
			pattern: sticky(`every\\s+(\\d{1,2})\\s+(day|week|month|year)s?${END}`),
			apply: (m, s) => {
				const interval = Number(m[1]);
				if (interval < 1) return false;
				const freq = {
					day: "DAILY",
					week: "WEEKLY",
					month: "MONTHLY",
					year: "YEARLY"
				}[m[2].toLowerCase()];
				return rule(s, `FREQ=${freq}${interval > 1 ? `;INTERVAL=${interval}` : ""}`, freq === "WEEKLY");
			}
		},
		{
			kind: "when",
			pattern: sticky(`every\\s+(weekday|weekend)s?${END}`),
			apply: (m, s) => rule(s, m[1].toLowerCase() === "weekday" ? "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" : "FREQ=WEEKLY;BYDAY=SA,SU")
		},
		{
			kind: "when",
			pattern: sticky(`every\\s+((?:${WEEKDAY})(?:(?:\\s*,\\s*(?:and\\s+)?|\\s+and\\s+|\\s+)(?:${WEEKDAY}))*)${END}`),
			apply: (m, s) => rule(s, `FREQ=WEEKLY;BYDAY=${byDays(m[1])}`)
		},
		{
			kind: "when",
			pattern: sticky(`(?:every\\s+(day|week|month|year)|(daily|weekly|monthly|yearly|annually|biweekly))${END}`),
			apply: (m, s) => {
				const word = (m[1] ?? m[2]).toLowerCase();
				if (word === "biweekly") return rule(s, "FREQ=WEEKLY;INTERVAL=2", true);
				const freq = {
					day: "DAILY",
					daily: "DAILY",
					week: "WEEKLY",
					weekly: "WEEKLY",
					month: "MONTHLY",
					monthly: "MONTHLY",
					year: "YEARLY",
					yearly: "YEARLY",
					annually: "YEARLY"
				}[word];
				return rule(s, `FREQ=${freq}`, freq === "WEEKLY");
			}
		}
	];
	/** A time on its own; "no end" by it is No end (SV-108), unless a length came first (SV-111). */
	function single(m, s) {
		if (s.start !== null) return false;
		const noEnd = /no\s+end/i.test(m[0]);
		if (noEnd && s.length !== null) return false;
		let found;
		if (m[1]) found = m[1].toLowerCase() === "noon" ? 720 : 0;
		else if (!m[3] && !m[4]) return false;
		else found = clock(Number(m[2]), Number(m[3] ?? 0), meridiemOf(m[4]));
		if (found === null) return false;
		s.start = found;
		if (noEnd) s.end = found;
		return true;
	}
	var TIMES = [
		{
			kind: "when",
			pattern: sticky(`(?:(?:at|from)\\s+)?${TIME}\\s*(?:-|–|to|until)\\s*${TIME}${END}`),
			apply: (m, s) => {
				const found = range(m);
				if (!found || s.start !== null || s.length !== null) return false;
				[s.start, s.end] = [found.start, found.end];
				return true;
			}
		},
		{
			kind: "when",
			pattern: sticky(`(?:no\\s+end\\s+)?(?:at\\s+)?(?:(noon|midnight)|${TIME})(?:\\s+no\\s+end)?${END}`),
			apply: single
		},
		{
			kind: "when",
			pattern: sticky(`(?:at\\s+)?(?:(noon|midnight)|${TIME})${END}`),
			apply: single
		}
	];
	var UNIT = "(?:minutes?|mins?|hours?|hrs?|h|days?|d|weeks?)(?![a-z])";
	var NUMBER = "\\d+(?:\\.\\d+)?";
	var UNIT_MINUTES = {
		m: 1,
		h: 60,
		d: 1440,
		w: 10080
	};
	var LENGTH = {
		kind: "when",
		pattern: sticky(`for\\s+(${NUMBER}\\s*${UNIT}(?:\\s*${NUMBER}\\s*${UNIT})*(?:\\d{1,2})?)${END}`),
		apply: (m, s) => {
			if (!s.event || s.length !== null || s.end !== null) return false;
			let minutes = 0;
			let last = "";
			for (const [, value, word] of m[1].matchAll(/(\d+(?:\.\d+)?)\s*([a-z]*)/gi)) {
				if (!word && (last !== "h" || Number(value) > 59)) return false;
				last = word ? word[0].toLowerCase() : "m";
				minutes += Number(value) * UNIT_MINUTES[last];
			}
			if (Math.round(minutes) < 1) return false;
			s.length = Math.round(minutes);
			return true;
		}
	};
	var DAY_TEXT = `(?:today|tonight|tomorrow|tmrw|tmr|(?:(?:next|this)\\s+)?(?:${WEEKDAY})|(?:${MONTH})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{4})?|\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTH})(?:\\s+\\d{4})?|\\d{1,2}/\\d{1,2}(?:/(?:\\d{4}|\\d{2}))?|\\d{4}-\\d{2}-\\d{2})`;
	var LAST_DAY = `(?:${DAY_TEXT}|\\d{1,2}(?:st|nd|rd|th)?(?!\\s*(?::|(?:am|pm|a|p)(?![a-z]))))`;
	var SPAN_TIME = `(?:noon|midnight|\\d{1,2}(?::\\d{2})?\\s*(?:am|pm|a|p)(?![a-z])|\\d{1,2}:\\d{2})`;
	/**
	* A span's last day, read from its first (D292): a weekday the next on or after it, a bare day in its
	* month, a month and day past it next year's when its month is earlier ("dec 30 – jan 2"). Null
	* when it's backwards: before the first, or a month and day earlier in the first's own month.
	*/
	function lastDay(text, from) {
		const bare = /^(\d{1,2})(?:st|nd|rd|th)?$/i.exec(text);
		const to = bare ? day(Number(from.slice(0, 4)), Number(from.slice(5, 7)), Number(bare[1])) : parseDay(text, from);
		if (to === null || to < from) return null;
		return to.slice(0, 4) > from.slice(0, 4) && to.slice(5, 7) >= from.slice(5, 7) && !/\d{4}|\/\d{1,2}\/\d{2}$/.test(text) ? null : to;
	}
	var SPAN = {
		kind: "when",
		pattern: sticky(`(?:(?:on|from)\\s+)?(${DAY_TEXT})(?:\\s+(?:at\\s+)?(${SPAN_TIME}))?(?:\\s*[-–—]\\s*|\\s+(?:to|through|thru)\\s+)(${LAST_DAY})(?:\\s+(?:at\\s+)?(${SPAN_TIME}))?${END}`),
		apply: (m, s, today) => {
			if (!s.event) return "words";
			if (s.date) return false;
			const from = parseDay(m[1], today);
			if (from === null) return false;
			const to = lastDay(m[3], from);
			if (to === null) return "words";
			const [first, second] = [m[2] ? parseClock(m[2]) : null, m[4] ? parseClock(m[4]) : null];
			if (m[2] && first === null || m[4] && second === null) return false;
			if (first !== null && second !== null) {
				const end = daysBetween(from, to) * 1440 + second;
				if (s.start !== null || s.length !== null) return false;
				if (end <= first) return "words";
				[s.date, s.start, s.end] = [
					from,
					first,
					end
				];
				return true;
			}
			const time = first ?? second;
			if (time !== null && s.start !== null) return false;
			[s.date, s.last] = [from, to];
			if (time !== null) s.start = time;
			return true;
		}
	};
	var DATES = [
		{
			kind: "when",
			pattern: sticky(`(?:on\\s+)?(today|tonight|tomorrow|tmrw|tmr)${END}`),
			apply: (m, s, today) => setDate(s, m[1].toLowerCase().startsWith("to") && m[1].toLowerCase() !== "tomorrow" ? today : addDays(today, 1))
		},
		{
			kind: "when",
			pattern: sticky(`(?:on\\s+)?(?:(next|this)\\s+)?(${WEEKDAY})${END}`),
			apply: (m, s, today) => {
				return setDate(s, addDays(today, (weekdayIndex(m[2]) - weekdayOf(today) + 7) % 7 + (m[1]?.toLowerCase() === "next" ? 7 : 0)));
			}
		},
		{
			kind: "when",
			pattern: sticky(`(?:on\\s+)?(${MONTH})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?${END}`),
			apply: (m, s, today) => setDate(s, upcoming(MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, Number(m[2]), today, m[3]))
		},
		{
			kind: "when",
			pattern: sticky(`(?:on\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH})(?:\\s+(\\d{4}))?${END}`),
			apply: (m, s, today) => setDate(s, upcoming(MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, Number(m[1]), today, m[3]))
		},
		{
			kind: "when",
			pattern: sticky(`(?:on\\s+)?(\\d{1,2})/(\\d{1,2})(?:/(\\d{2}|\\d{4}))?${END}`),
			apply: (m, s, today) => setDate(s, upcoming(Number(m[1]), Number(m[2]), today, m[3]))
		},
		{
			kind: "when",
			pattern: sticky(`(?:on\\s+)?(\\d{4})-(\\d{2})-(\\d{2})${END}`),
			apply: (m, s) => setDate(s, day(Number(m[1]), Number(m[2]), Number(m[3])))
		}
	];
	var escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	function calendarMatchers(calendars) {
		return [...calendars].sort((a, b) => b.length - a.length).map((name) => ({
			kind: "calendar",
			pattern: sticky(`cal\\s+${escape(name)}${END}`),
			apply: (_m, s) => {
				if (s.calendar) return false;
				s.calendar = name;
				return true;
			}
		}));
	}
	/** Tries each matcher at `index`; the first that matches and applies wins. */
	function matchAt(text, index, matchers, state, today) {
		for (const matcher of matchers) {
			matcher.pattern.lastIndex = index;
			const match = matcher.pattern.exec(text);
			const applied = match && match[0].length ? matcher.apply(match, state, today) : false;
			if (applied === "words") return {
				length: match[0].length,
				kind: matcher.kind,
				words: true
			};
			if (applied) return {
				length: match[0].length,
				kind: matcher.kind
			};
		}
		return null;
	}
	var BOUNDARY_WORDS = /^(?:at|on|from|to)$/i;
	/** Whether a phrase other than a place starts at `index` (a place stops there); `#` too while projects or calendars are read. */
	function phraseStarts(text, index, matchers, today, hash, event) {
		if (BOUNDARY_WORDS.test(/^\S+/.exec(text.slice(index))[0])) return true;
		const probe = fresh(event);
		return text[index] === "@" || hash && text[index] === "#" || matchAt(text, index, matchers, probe, today) !== null;
	}
	/** A link as a place ("https://zoom.us/j/1"), without punctuation after it. */
	var PLACE_URL = /^(?:https?:\/\/|www\.)\S+?(?=[.,;!?]*(?:\s|$))/i;
	/**
	* The line once a suggestion is picked for its "@place" or "#name" (from `start`, its "@" or "#", to
	* `end`, a comma after it included): the name in full, then a space to go on typing (SV-29). A comma
	* typed after it stays; the caret goes past the space.
	*/
	function completeToken$1(text, start, end, name) {
		const valueEnd = end - (/\s*,$/.exec(text.slice(start, end))?.[0].length ?? 0);
		const head = `${text.slice(0, start + 1)}${name}`;
		let rest = text.slice(valueEnd);
		if (!/^[\s,]/.test(rest)) rest = ` ${rest}`;
		return {
			text: `${head}${rest}`,
			caret: head.length + /^[\s,]*/.exec(rest)[0].length
		};
	}
	/**
	* A "#" or "@" just typed at the line's end, before the line reads it as a mark (SV-71): a lone "#",
	* or "@" with at most one letter (Places searches from two). Its field's menu opens on it, showing
	* every choice before anything is typed, as darma's does. `start` is the trigger's place; `query`
	* is what follows it.
	*/
	function bareToken$1(text, trigger) {
		const found = (trigger === "#" ? /(?:^|\s)#$/ : /(?:^|\s)@(\S?)$/).exec(text);
		if (!found) return null;
		const query = found[1] ?? "";
		return {
			start: text.length - query.length - 1,
			query
		};
	}
	var TRAILING_CONNECTOR = /(?:\s+(?:on|at|from|to|for))+\s*$/i;
	/**
	* What an edit typed into a title (SV-90): `after` from where it first differs from `before` to
	* where the two agree again. A word the edit changed is typed whole ("Standup 9am" made "Standup
	* 10am" typed "10am"); a word it only typed beside isn't ("Call fri" made "Call fri 3pm" typed
	* " 3pm"). Empty when nothing changed, or when only spaces or whole words went.
	*/
	function typedSpan$1(before, after) {
		let start = 0;
		while (start < before.length && start < after.length && before[start] === after[start]) start += 1;
		let tail = 0;
		while (tail < before.length - start && tail < after.length - start && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail += 1;
		let end = after.length - tail;
		const word = (at) => at >= 0 && at < after.length && /\S/.test(after[at]);
		while (word(start - 1) && word(start)) start -= 1;
		while (word(end - 1) && word(end)) end += 1;
		return {
			start,
			end
		};
	}
	/**
	* Reads the title as typed; `today` places weekdays and bare dates, `calendars` are the names "cal …"
	* knows, and `picked` is the place text a suggestion was picked for, where the place stops. `hash`
	* is what "#…" reads (a task's projects or an event's calendars): their names, in the list's order,
	* with the text a menu pick was made for.
	*
	* `edit` is an item's title as it was and its day, when the text is that title edited (SV-90): only
	* phrases wholly inside what the edit typed are read (`typedSpan`), and a repeat with no day of its
	* own counts from the item's day rather than today. With no phrase read the title is the text as
	* typed, spaces and all; phrases that leave no words keep the title as it was.
	*
	* A task's line (`hash` its projects) reads no lengths or spans of days; any other, an event's, does.
	*/
	function parseTitle$1(text, today, calendars = [], picked = null, hash = null, edit = null) {
		const state = fresh(hash?.kind !== "project");
		const phrases = [
			...calendarMatchers(calendars),
			...REPEATS,
			...TIMES,
			LENGTH,
			SPAN,
			...DATES
		];
		const marks = [];
		const typed = edit ? typedSpan$1(edit.before, text) : {
			start: 0,
			end: text.length
		};
		const line = text.slice(0, typed.end);
		const words = [...line.matchAll(/\S+/g)].map((word) => word.index).filter((index) => index >= typed.start);
		for (let w = 0; w < words.length; w += 1) {
			const index = words[w];
			let found = null;
			const place = line[index] === "@" && state.place === null;
			if (place || line[index] === "#" && hash && state[hash.kind] === null) {
				const from = index + 1;
				const pick = place ? picked : hash.picked;
				const lower = (name) => name.toLowerCase();
				const ends = (at) => new RegExp(`^${END}`).test(line.slice(at));
				let next = w + 1;
				while (next < words.length && !phraseStarts(line, words[next], phrases, today, !!hash, state.event)) next += 1;
				const stopsAtPick = pick !== null && line.startsWith(pick, from) && ends(from + pick.length);
				const url = place ? PLACE_URL.exec(line.slice(from)) : null;
				const known = hash?.kind !== "project" ? void 0 : hash.names.filter((name) => lower(line.slice(from, from + name.length)) === lower(name) && ends(from + name.length)).sort((a, b) => b.length - a.length)[0];
				let prefix = from;
				for (let at = from + 1; !place && hash.kind === "calendar" && at <= line.length; at += 1) {
					if (!hash.names.some((name) => lower(name).startsWith(lower(line.slice(from, at))))) break;
					if (ends(at)) prefix = at;
				}
				let end = stopsAtPick ? from + pick.length : url ? from + url[0].length : known ? from + known.length : hash?.kind === "calendar" && !place ? prefix : next < words.length ? words[next] : line.length;
				const comma = stopsAtPick ? -1 : line.slice(from, end).indexOf(",");
				if (comma >= 0) end = from + comma;
				const value = line.slice(from, end).trim();
				if (value.length >= (place ? 2 : 1)) {
					if (place) state.place = value;
					else if (hash.kind === "project") state.project = known && !stopsAtPick && end === from + known.length ? known : value;
					else state.calendar = stopsAtPick ? value : hash.names.find((name) => lower(name) === lower(value)) ?? hash.names.find((name) => lower(name).startsWith(lower(value)));
					const after = /^\s*,/.exec(line.slice(end));
					found = {
						length: after ? end + after[0].length - index : line.slice(index, end).trimEnd().length,
						kind: place ? "place" : hash.kind
					};
				}
			} else found = matchAt(line, index, phrases, state, today);
			if (!found) continue;
			if (!found.words) marks.push({
				start: index,
				end: index + found.length,
				kind: found.kind
			});
			while (w + 1 < words.length && words[w + 1] < index + found.length) w += 1;
		}
		const merged = [];
		for (const mark of marks) {
			const last = merged.at(-1);
			if (last && last.kind === "when" && mark.kind === "when" && /^\s*$/.test(text.slice(last.end, mark.start))) last.end = mark.end;
			else merged.push({ ...mark });
		}
		const first = edit?.day ?? today;
		if (!state.date && state.repeatDays.length) state.date = addDays(first, Math.min(...state.repeatDays.map((index) => (index - weekdayOf(first) + 7) % 7)));
		if (state.recurrence && state.weeklyNeedsDay) state.recurrence += `;BYDAY=${RRULE_DAYS[weekdayOf(state.date ?? first)]}`;
		let days = null;
		if (state.last && state.start === null && state.length === null) days = daysBetween(state.date, state.last) + 1;
		else if (state.last) state.recurrence = `${state.recurrence ?? "RRULE:FREQ=DAILY"};UNTIL=${state.last.replace(/-/g, "")}`;
		if (state.length !== null && state.start !== null && state.end === null) state.end = state.start + state.length;
		let title = "";
		let from = 0;
		for (const mark of merged) {
			title += `${text.slice(from, mark.start)} `;
			from = mark.end;
		}
		title += text.slice(from);
		title = title.replace(/\s+/g, " ").trim().replace(TRAILING_CONNECTOR, "");
		if (edit) title = !merged.length ? text : title || edit.before;
		return {
			title,
			marks: merged,
			date: state.date,
			start: state.start,
			end: state.end,
			place: state.place,
			calendar: state.calendar,
			recurrence: state.recurrence,
			project: state.project,
			days,
			length: state.length
		};
	}
	/**
	* The line with its title words replaced by a Title typed by hand, its phrases kept in order after
	* it ("Coffee fri" titled "Coffee with Ana" reads "Coffee with Ana fri"), so the line and the Title
	* never disagree (UX #8).
	*/
	function lineWithTitle$1(text, marks, title) {
		const rest = marks.map((mark) => text.slice(mark.start, mark.end)).join(" ");
		if (!title.trim()) return rest;
		if (!rest) return title;
		return /\s$/.test(title) ? `${title}${rest}` : `${title} ${rest}`;
	}
	/** A typed day for the date field ("fri", "oct 12", "10/12"), or null. */
	function parseDay(text, today) {
		const parsed = parseTitle$1(text.trim().replace(new RegExp(`^(?:${WEEKDAY}),?\\s+(?=\\S)`, "i"), ""), today);
		return parsed.title === "" && parsed.start === null && parsed.days === null && parsed.date ? parsed.date : null;
	}
	/**
	* A typed time for a time field ("7pm", "7:30 PM", "19:00", and SV-25's shorthand "3p", "330p",
	* "2130"; "7" or "930" keep `meridiemFrom`'s half), or null.
	*/
	function parseClock(text, meridiemFrom = null) {
		const typed = /^\s*(\d{1,2})(?::?(\d{2}))?\s*(?:([ap])\.?m?\.?)?\s*$/i.exec(text);
		if (typed) {
			const [hour, minute, meridiem] = [
				Number(typed[1]),
				Number(typed[2] ?? 0),
				typed[3]?.toLowerCase()
			];
			if (meridiem) return clock(hour, minute, meridiem);
			if (meridiemFrom !== null && hour <= 12) return clock(hour, minute, meridiemFrom >= 720 ? "p" : "a");
			return typed[2] ? clock(hour, minute, null) : null;
		}
		const parsed = parseTitle$1(text.trim(), "2000-01-01");
		return parsed.title === "" && parsed.start !== null && parsed.end === null ? parsed.start : null;
	}
	/**
	* An edited item's when, once its title's typed day and time are read (SV-90): a day moves it,
	* keeping its time and length (an all-day event its days); a time moves its start on its own day,
	* the end keeping the length ("Work" 3:00 – 8:00 AM at 3:45a ends 8:45 AM); a range sets both ends.
	* An all-day event given a time ends an hour later on its last day, as Add a time makes it. A
	* task's time is its due time, with no end. With neither, it's as it was.
	*
	* An event's span of days (`days`) makes it all day over them, and a length with no time lasts that
	* long from its own start, an all-day one's 9:00 AM (SV-111).
	*/
	function editedWhen$1(item, read, kind) {
		const date = read.date ?? item.date;
		if (kind === "event" && read.days != null) return {
			date,
			start: null,
			end: null,
			days: read.days
		};
		if (kind === "event" && read.start === null && read.length != null) {
			const start = item.start ?? 540;
			return {
				date,
				start,
				end: start + read.length,
				days: 1
			};
		}
		if (read.start === null) return {
			...item,
			date
		};
		if (kind === "task") return {
			date,
			start: read.start,
			end: null,
			days: 1
		};
		const length = item.start === null || item.end === null ? (item.days - 1) * 1440 + 60 : item.end - item.start;
		return {
			date,
			start: read.start,
			end: read.end ?? read.start + length,
			days: 1
		};
	}
	//#endregion
	//#region web/src/logic/composeApp.ts
	/** The line as the web's editor reads it: "#…" is a task's project or an event's calendar. */
	function parseTitle(input) {
		const names = input.kind === "task" ? input.projects : input.calendars;
		return parseTitle$1(input.text, input.today, input.calendars, input.pickedPlace ?? null, {
			kind: input.kind === "task" ? "project" : "calendar",
			names,
			picked: input.pickedHash ?? null
		}, input.edit ?? null);
	}
	/** What an edit typed into a title: the text from `start` to `end` of `after`. */
	function typedSpan(input) {
		return typedSpan$1(input.before, input.after);
	}
	/**
	* An edited item's when once its typed day and time are read (its `date`, `start`, `end`, and an
	* event's `days` and `length` from parseTitle, SV-111; without the last two, as before).
	*/
	function editedWhen(input) {
		return editedWhen$1(input.item, input.read, input.kind);
	}
	/** A "#" or "@" just typed at the line's end, which opens its menu; null when there's none. */
	function bareToken(input) {
		return bareToken$1(input.text, input.trigger);
	}
	/** The line once a menu pick is made for the "@" or "#" mark from `start` to `end`. */
	function completeToken(input) {
		return completeToken$1(input.text, input.start, input.end, input.name);
	}
	/** The line with its title words replaced by a Title typed by hand, its marked phrases after it. */
	function lineWithTitle(input) {
		return lineWithTitle$1(input.text, input.marks, input.title);
	}
	var FUNCTIONS = {
		parseTitle,
		bareToken,
		completeToken,
		lineWithTitle,
		typedSpan,
		editedWhen
	};
	/** `call("parseTitle", '{"text":…}')` → the result as JSON text. */
	function call(name, json) {
		const run = FUNCTIONS[name];
		if (!run) throw new Error(`No such function: ${name}`);
		return JSON.stringify(run(JSON.parse(json)));
	}
	//#endregion
	exports.bareToken = bareToken;
	exports.call = call;
	exports.completeToken = completeToken;
	exports.editedWhen = editedWhen;
	exports.lineWithTitle = lineWithTitle;
	exports.parseTitle = parseTitle;
	exports.typedSpan = typedSpan;
	return exports;
})({});
