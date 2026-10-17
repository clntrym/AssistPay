// The Coordinator's duty form, written back out as an .xlsx.
//
// This is the paper form the school already uses, cell for cell: the room on
// the left, the S.A.s who watch it across the top in green, the week in
// half-hour rows with a column each, duty hours in yellow with the length of
// the block written on them, class hours in blue, and the signature column on
// the right carrying the relievers and the duty-hour totals. One sheet per
// department — OFFICES, ITO, ACADS — one block per room, so the whole semester
// downloads as a single file.
const DutyForm = (() => {

    const SLOT = 30;                       // minutes per row
    const DAY_ORDER = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
    const DAY_HEAD = { MON: "M", TUE: "T", WED: "W", THU: "TH", FRI: "F", SAT: "Sat", SUN: "Sun" };
    const DAY_START = 7 * 60;              // the form always opens at 7:00
    const DAY_END = 22 * 60;               // and runs to 10:00 in the evening
    const GAP_ROWS = 3;                    // blank rows between two S.A. blocks

    /** 07:00, 12:30, 01:00 — the form writes the hour without AM or PM. */
    const clock = m => String(((Math.floor(m / 60) + 11) % 12) + 1).padStart(2, "0")
                     + ":" + String(m % 60).padStart(2, "0");

    /** The window every sheet shares, widened if any duty or class falls outside it. */
    const windowOf = sheets => {
        let from = DAY_START, to = DAY_END;
        sheets.forEach(s => s.blocks.forEach(b => {
            const times = [
                ...b.staff.flatMap(p => [...(p.duty || []), ...(p.classes || [])]),
                ...(b.relievers || [])
            ];
            times.forEach(x => {
                from = Math.min(from, Math.floor(x.start / SLOT) * SLOT);
                to = Math.max(to, Math.ceil(x.end / SLOT) * SLOT);
            });
        }));
        return { from, to };
    };

    /** Which days get a column: always Monday to Saturday, Sunday only if used. */
    const daysOf = sheets => {
        const used = new Set();
        sheets.forEach(s => s.blocks.forEach(b => {
            b.staff.forEach(p => [...(p.duty || []), ...(p.classes || [])].forEach(x => used.add(x.day)));
            (b.relievers || []).forEach(x => used.add(x.day));
        }));
        return DAY_ORDER.filter(d => d !== "SUN" || used.has("SUN"));
    };

    /**
     * One place's form, drawn from row `top` down.
     *
     * The room goes on the left, the S.A.s who watch it across the top, and each
     * of them gets their own column under every day - so two S.A.s on one room
     * read side by side, their duty in yellow and their classes in blue. The
     * relievers are listed in the signature column, with the hours they cover.
     */
    const drawBlock = (sheet, block, top, layout, meta) => {
        const { days, from, to } = layout;
        const slots = (to - from) / SLOT;
        const staff = block.staff.length ? block.staff : [{ name: "", lastName: "", duty: [], classes: [], creditedHours: 0 }];
        const perDay = Math.max(2, staff.length);          // the form always has two columns a day
        const lastCol = 2 + days.length * perDay;
        const signCol = lastCol + 2;
        const headRow = top;
        const dayRow = top + 1;
        const firstSlotRow = top + 2;

        // ---- room on the left, the S.A.s across the top
        sheet.set(headRow, 1, block.location || "", "head");
        sheet.set(headRow, 2, null, "head");
        sheet.merge(headRow, 1, headRow, 2);
        sheet.set(headRow, 3, staff.map(s => s.name).filter(Boolean).join(" / "), "name");
        for (let c = 4; c <= lastCol; c++) sheet.set(headRow, c, null, "name");
        sheet.merge(headRow, 3, headRow, lastCol);

        // ---- the days
        sheet.set(dayRow, 1, null, "head");
        sheet.set(dayRow, 2, null, "head");
        days.forEach((d, i) => {
            const col = 3 + i * perDay;
            sheet.set(dayRow, col, DAY_HEAD[d], "head");
            for (let k = 1; k < perDay; k++) sheet.set(dayRow, col + k, null, "head");
            sheet.merge(dayRow, col, dayRow, col + perDay - 1);
        });

        // ---- the half-hour rows, empty to start with
        for (let i = 0; i < slots; i++) {
            const row = firstSlotRow + i;
            const start = from + i * SLOT;
            sheet.set(row, 1, clock(start), "cell");
            sheet.set(row, 2, clock(start + SLOT), "cell");
            for (let c = 3; c <= lastCol; c++) sheet.set(row, c, null, "cell");
        }

        // ---- each S.A. gets their own column under every day
        staff.forEach((person, n) => {
            const width = staff.length === 1 ? perDay : 1;   // one S.A. spreads across the day
            const offset = staff.length === 1 ? 0 : n;

            (person.classes || []).forEach(c => {
                const i = days.indexOf(c.day);
                if (i === -1) return;
                const col = 3 + i * perDay + offset;
                for (let m = Math.max(c.start, from); m < Math.min(c.end, to); m += SLOT) {
                    const row = firstSlotRow + (m - from) / SLOT;
                    for (let k = 0; k < width; k++) sheet.set(row, col + k, null, "class");
                }
            });

            (person.duty || []).forEach(d => {
                const i = days.indexOf(d.day);
                if (i === -1) return;
                const col = 3 + i * perDay + offset;
                const startRow = firstSlotRow + (Math.max(d.start, from) - from) / SLOT;
                const endRow = firstSlotRow + (Math.min(d.end, to) - from) / SLOT - 1;
                if (endRow < startRow) return;
                for (let row = startRow; row <= endRow; row++) {
                    for (let k = 0; k < width; k++) sheet.set(row, col + k, null, "duty");
                }
                sheet.set(startRow, col, d.hours, "duty");
                sheet.merge(startRow, col, endRow, col + width - 1);
            });
        });

        // ---- the signature column
        const line = "______________________________";
        const say = (offset, text, style) => sheet.set(headRow + offset, signCol, text, style);
        let r = 0;
        say(r++, "RELIEVER:", "bold");
        (block.relievers || []).slice(0, 8).forEach(x => {
            say(r++, `${DAY_HEAD[x.day].toUpperCase()}- ${x.startLabel}-${x.endLabel}- ${x.name}`, "text");
        });
        if (!block.relievers?.length) r++;

        r = Math.max(r + 1, 7);
        say(r++, line, "text");
        say(r++, "Student Assistant", "bold");
        r++;
        say(r++, block.supervisor || line, "boldUnderline");
        say(r++, "Immediate Supervisor", "bold");
        r++;
        say(r++, line, "text");
        say(r++, "Student Assistant Supervisor", "bold");
        r++;
        say(r++, meta.coordinator || line, "boldUnderline");
        say(r++, "Student Assistant Coordinator", "bold");
        r++;
        say(r++, "DUTY HOURS:", "bold");
        staff.filter(x => x.lastName).forEach(x => say(r++, `${x.lastName}= ${x.creditedHours}`, "bold"));

        return Math.max(firstSlotRow + slots, headRow + r);   // the row after this block
    };

    /** Build the workbook from what api scheduling/schedule_export returned. */
    const buildSheets = data => {
        const { from, to } = windowOf(data.sheets);
        const days = daysOf(data.sheets);
        const layout = { days, from, to };
        const meta = { coordinator: data.coordinator };

        return data.sheets.map(s => {
            const sheet = new XlsxWriter.Sheet(s.title);
            const perDay = Math.max(2, ...s.blocks.map(b => Math.max(2, b.staff.length)));
            const signCol = 2 + days.length * perDay + 2;
            sheet.width(1, 7).width(2, 7);
            for (let c = 3; c <= 2 + days.length * perDay; c++) sheet.width(c, 6);
            sheet.width(signCol - 1, 2);
            sheet.width(signCol, 34);

            let row = 1;
            s.blocks.forEach(b => { row = drawBlock(sheet, b, row, layout, meta) + GAP_ROWS; });
            return sheet;
        });
    };

    /**
     * Download the whole finalized schedule as one workbook.
     * Returns { file, sheets, blocks, bytes } so the page can say what it sent.
     */
    const download = async data => {
        if (!data.sheets?.length) throw new Error("There is nothing on the finalized schedule yet.");
        const sheets = buildSheets(data);
        const term = data.semester ? `${data.semester.term}-${data.semester.academicYear}` : "semester";
        const file = `S.A. DUTY FORM ${term}.xlsx`;
        const bytes = await XlsxWriter.download(file, sheets);
        return {
            file,
            sheets: data.sheets.map(s => s.title),
            blocks: data.sheets.reduce((n, s) => n + s.blocks.length, 0),
            people: data.saCount,
            bytes
        };
    };

    return { download, buildSheets, clock };
})();
