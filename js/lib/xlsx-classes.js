// Reads the NCST S.A. duty form (.xlsx) — the colour-coded weekly grid that
// each room or office keeps — and pulls out every S.A.'s class hours.
//
// One block per room/office, repeated down the sheet:
//
//   row n     A = room or office (1106, REGISTRAR)   C = S.A. name(s), green
//   row n+1   day headers: M | T | W | TH | F | Sat, two columns each
//   row n+2…  one row per 30-minute slot, starting 7:00 AM
//
// Colours carry the meaning: blue = the S.A. is in class, yellow = duty hours,
// green = the name row. When a block names two S.A.s, the left column of each
// day belongs to the first and the right column to the second; with one name,
// both columns are that S.A.
//
// Blue blocks are the class hours. Yellow blocks are the duty hours the S.A.
// asked for — kept separately as a wish, because the final duty comes out of
// Schedule Matching and the Coordinator's approval.
//
// Returns { people: [{ name, locations, classHours, dutyHours, blocks, wishes }], warnings }.
const XlsxClasses = (() => {
    const SLOT_MINUTES = 30;
    const DEFAULT_START = 7 * 60;      // 7:00 AM, the first slot row
    const MAX_SLOTS = 34;              // 7:00 AM – midnight, a generous ceiling

    const DAY_LABELS = {
        M: "MON", MON: "MON", MONDAY: "MON",
        T: "TUE", TU: "TUE", TUE: "TUE", TUES: "TUE", TUESDAY: "TUE",
        W: "WED", WED: "WED", WEDNESDAY: "WED",
        TH: "THU", THU: "THU", THUR: "THU", THURS: "THU", THURSDAY: "THU", R: "THU",
        F: "FRI", FRI: "FRI", FRIDAY: "FRI",
        S: "SAT", SA: "SAT", SAT: "SAT", SATURDAY: "SAT",
        SU: "SUN", SUN: "SUN", SUNDAY: "SUN"
    };
    const DAY_ORDER = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

    const dayCode = raw => DAY_LABELS[String(raw || "").toUpperCase().replace(/[^A-Z]/g, "")] || null;
    const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const label = m => {
        const h = Math.floor(m / 60) % 24, min = m % 60;
        const h12 = h % 12 === 0 ? 12 : h % 12;
        return `${h12}:${String(min).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
    };

    /** CLASS for blue fills, DUTY for yellow, NAME for green, "" for anything else. */
    function meaning(hex) {
        if (!hex || hex.length !== 6) return "";
        const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
        if (r > 190 && g > 190 && b < 140) return "DUTY";        // FFFF00 and friends
        if (b > 140 && b > r + 40 && b >= g - 40) return "CLASS"; // 00B0F0
        if (g > 140 && g > r + 30 && g > b + 30) return "NAME";   // 92D050
        return "";
    }

    /** Excel stores 7:00 AM as 0.291666…; returns minutes past midnight. */
    const fractionMinutes = value => {
        const n = Number(value);
        if (!Number.isFinite(n) || n < 0 || n >= 1) return null;
        return Math.round(n * 24 * 60 / 5) * 5;
    };

    /** "ALELEI JHOY MENDOZA/SHEENA COMEDIA" -> two names. */
    const splitNames = raw => String(raw || "")
        .split(/\s*[\/&]\s*|\s+AND\s+/i)
        .map(n => n.replace(/\s+/g, " ").trim())
        .filter(n => n.length > 1 && /[A-Za-z]/.test(n));

    /** Day header row -> [{ day, columns: [c, c+1] }]; groups the merged pair. */
    function dayGroups(cells, colours, row) {
        const groups = [];
        const width = Math.max(cells[row]?.length || 0, colours[row]?.length || 0);
        for (let c = 2; c < width; c++) {
            const day = dayCode(cells[row]?.[c]);
            if (!day) continue;
            const last = groups[groups.length - 1];
            if (last && last.day === day && last.columns[last.columns.length - 1] === c - 1) last.columns.push(c);
            else groups.push({ day, columns: [c] });
        }
        return groups;
    }

    /** Rows that start a block: a name row followed by a row of day headers. */
    function blockRows(cells, colours) {
        const starts = [];
        for (let r = 0; r + 1 < cells.length; r++) {
            if (dayGroups(cells, colours, r + 1).length >= 3) starts.push(r);
        }
        return starts;
    }

    async function parse(file) {
        const book = await XlsxReader.open(file);
        const found = new Map();      // upper-case name -> person
        const warnings = [];
        let blocks = 0;

        for (let s = 0; s < book.sheets.length; s++) {
            const sheetName = book.sheets[s].trim();
            const sheet = await book.sheet(s);
            if (!sheet) continue;
            const { cells, colours } = sheet;
            const starts = blockRows(cells, colours);
            if (!starts.length) { warnings.push(`Sheet "${sheetName}" has no day headers (M, T, W…), so it was skipped.`); continue; }

            starts.forEach((nameRow, idx) => {
                blocks++;
                const headerRow = nameRow + 1;
                const firstSlot = headerRow + 1;
                const lastSlot = Math.min((starts[idx + 1] ?? cells.length) - 1, firstSlot + MAX_SLOTS - 1);
                const location = String(cells[nameRow]?.[0] || "").replace(/\s+/g, " ").trim();

                // The green cell holds one or two names
                let nameCell = "";
                for (let c = 2; c < 14 && !nameCell; c++) {
                    if (meaning(colours[nameRow]?.[c]) === "NAME") nameCell = String(cells[nameRow]?.[c] || "").trim();
                }
                if (!nameCell) nameCell = String(cells[nameRow]?.[2] || "").trim();
                const names = splitNames(nameCell);
                if (!names.length) {
                    warnings.push(`The block for "${location || sheetName}" has no S.A. name in the green row, so it was skipped.`);
                    return;
                }
                if (names.length > 2) {
                    warnings.push(`"${location || sheetName}" names ${names.length} S.A.s but each day has only two columns. `
                        + `The extra names were ignored.`);
                }

                // The time ladder: read the first slot row, then count 30-minute steps
                const start = fractionMinutes(cells[firstSlot]?.[0]) ?? DEFAULT_START;
                const next = fractionMinutes(cells[firstSlot]?.[1]);
                const step = next !== null && next > start && next - start <= 60 ? next - start : SLOT_MINUTES;
                const slotStart = r => start + (r - firstSlot) * step;

                for (const group of dayGroups(cells, colours, headerRow)) {
                    group.columns.forEach((col, position) => {
                        const owner = names.length === 1 ? names[0] : names[Math.min(position, names.length - 1)];
                        const person = personFor(found, owner);
                        if (location && !person.locations.includes(location)) person.locations.push(location);

                        let r = firstSlot;
                        while (r <= lastSlot) {
                            const kind = meaning(colours[r]?.[col]);
                            if (!kind) { r++; continue; }
                            let end = r;
                            while (end + 1 <= lastSlot && meaning(colours[end + 1]?.[col]) === kind) end++;
                            person.raw.push({ kind, day: group.day, from: slotStart(r), to: slotStart(end) + step });
                            r = end + 1;
                        }
                    });
                }
            });
        }

        if (!blocks) throw new Error("No duty-form blocks were found. Expected a name row, then M / T / W / TH / F / Sat headers.");

        // Both columns of a day can belong to the same S.A., so the same block is
        // read twice: merge overlapping spans per day before counting anything.
        const merge = (list, kind) => {
            const out = [];
            for (const day of DAY_ORDER) {
                const spans = list.filter(b => b.kind === kind && b.day === day).sort((a, b) => a.from - b.from);
                let current = null;
                for (const span of spans) {
                    if (current && span.from <= current.to) { current.to = Math.max(current.to, span.to); continue; }
                    current = { day, from: span.from, to: span.to };
                    out.push(current);
                }
            }
            return out;
        };
        const hours = spans => Math.round(spans.reduce((n, s) => n + (s.to - s.from), 0) / 6) / 10;

        const shape = s => ({ day: s.day, startTime: hhmm(s.from), endTime: hhmm(s.to),
                              startLabel: label(s.from), endLabel: label(s.to) });

        const people = [...found.values()].map(person => {
            const classes = merge(person.raw, "CLASS");
            const duty = merge(person.raw, "DUTY");
            return {
                name: person.name,
                locations: person.locations,
                classHours: hours(classes),
                dutyHours: hours(duty),
                blocks: classes.map(shape),
                wishes: duty.map(shape)          // the yellow hours they asked for
            };
        }).sort((a, b) => a.name.localeCompare(b.name));

        const withClasses = people.filter(p => p.blocks.length);
        if (!withClasses.length) {
            throw new Error("No blue class hours were found in this file. Blue cells mark the S.A.'s class hours.");
        }
        for (const p of people) {
            if (!p.blocks.length) warnings.push(`${p.name} has no blue class hours in this file, so there is nothing to import.`);
        }
        return { people: withClasses, warnings };
    }

    function personFor(found, name) {
        const key = name.toUpperCase().replace(/[^A-Z]/g, "");
        if (!found.has(key)) found.set(key, { name, locations: [], raw: [], dutyMinutes: 0 });
        return found.get(key);
    }

    return { parse };
})();
