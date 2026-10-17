// Reads the NCST room assignment workbook (.xlsx) in the browser.
//
// Each room block is a header row (ROOM | TIME | MON..SUN) followed by
// 30-minute slot rows, with class entries merged across the slots they occupy.
// XlsxReader does the unzipping and grid building.
//
// Returns { rooms: [...], periods: [...], warnings: [...] }.
const XlsxRooms = (() => {
    const DAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
    const SKIP_SHEETS = ["heritage"];

    const parseTime = t => {
        const m = String(t).trim().toUpperCase().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
        if (!m) return null;
        let h = Number(m[1]);
        if (m[3] === "PM" && h < 12) h += 12;
        if (m[3] === "AM" && h === 12) h = 0;
        return h * 60 + Number(m[2]);
    };
    const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

    function roomType(description) {
        const d = (description || "").toUpperCase();
        if (d.includes("COMPUTER")) return "COMPUTER_LAB";
        if (d.includes("LABORATORY") || d.includes("LAB")) return "LABORATORY";
        if (d.includes("LECTURE")) return "LECTURE";
        return "OTHER";
    }
    const capacityOf = d => Number((d || "").match(/(\d+)\s*CAPACITY/i)?.[1]) || null;

    async function parse(file) {
        const book = await XlsxReader.open(file);

        const rooms = [];
        const periods = [];
        const warnings = [];

        for (let s = 0; s < book.sheets.length; s++) {
            const sheetName = book.sheets[s].trim();
            if (SKIP_SHEETS.some(k => sheetName.toLowerCase().includes(k))) continue;
            const sheet = await book.sheet(s);
            if (!sheet) continue;
            const { cells, merges, mergeAt } = sheet;

            const headers = [];
            let inSlotBlock = false;

            cells.forEach((row, i) => {
                if (!row) {
                    inSlotBlock = false;
                    return;
                }
                const strRow = row.map(cell => String(cell || "").toUpperCase().trim());
                const c0 = String(row[0] || "").trim();
                const c1 = String(row[1] || "").trim();
                const c2 = String(row[2] || "").trim();

                const timeStr = c1 || c2 || c0;
                const isTimeSlot = /^\s*\d{1,2}:\d{2}\s*[AP]M\s*[-–—]\s*\d{1,2}:\d{2}\s*[AP]M\s*$/i.test(timeStr);

                const hasRoom = strRow.some(cell => cell.includes("ROOM"));
                const hasTime = strRow.some(cell => cell.includes("TIME"));

                if (hasRoom && hasTime) {
                    headers.push(i);
                    inSlotBlock = true;
                } else if (isTimeSlot && !inSlotBlock) {
                    headers.push(i);
                    inSlotBlock = true;
                } else if (!isTimeSlot) {
                    inSlotBlock = false;
                }
            });

            if (!headers.length) { warnings.push(`Sheet "${sheetName}" has no room schedule blocks, so it was skipped.`); continue; }

            headers.forEach((headerRow, idx) => {
                const endRow = (headers[idx + 1] ?? cells.length) - 1;
                
                let code = "";
                const candidateCells = [
                    cells[headerRow + 1]?.[0], cells[headerRow]?.[0], cells[headerRow]?.[1],
                    cells[headerRow + 1]?.[1],
                    cells[headerRow - 1]?.[0], cells[headerRow - 1]?.[1],
                    cells[headerRow - 2]?.[0], cells[headerRow - 2]?.[1]
                ];

                const isValidCode = (val, strict = true) => {
                    if (!val || /^\s*\d{1,2}:\d{2}/.test(val) || /^ROOM$/i.test(val) || /^TIME$/i.test(val) || /^MON/i.test(val) || /^M$/i.test(val)) return false;
                    if (strict) {
                        if (val.includes("\n") || /CAPACITY|UNITS/i.test(val)) return false;
                        if (/^(COMPUTER|INTERNET|NETWORK|MICRO|ELEC|LECTURE)\s+LAB/i.test(val)) return false;
                    }
                    return true;
                };

                for (const strict of [true, false]) {
                    if (code) break;
                    for (const raw of candidateCells) {
                        const val = String(raw || "").trim();
                        if (!isValidCode(val, strict)) continue;
                        const m = val.match(/(?:ROOM\s*:?\s*)?([A-Z0-9-&\s]{2,20})/i);
                        if (m && m[1]) {
                            const clean = m[1].replace(/^ROOM\s+/i, "").trim();
                            if (clean && !/^TIME/i.test(clean) && !/^ROOM/i.test(clean) && !/^\d{1,2}:\d{2}/.test(clean)) {
                                code = clean;
                                break;
                            }
                        }
                    }
                }

                if (!code) { warnings.push(`A block in "${sheetName}" around row ${headerRow + 1} has no room number and was skipped.`); return; }

                const descParts = [];
                for (let r = headerRow; r <= endRow; r++) {
                    const cellVal = String(cells[r]?.[0] || "").replace(/\s+/g, " ").trim();
                    if (cellVal && cellVal.toUpperCase() !== code.toUpperCase() && !/^ROOM$/i.test(cellVal) && !/^\d{1,2}:\d{2}/.test(cellVal)) {
                        if (!descParts.includes(cellVal)) descParts.push(cellVal);
                    }
                }
                const description = descParts.join(" ").trim();

                rooms.push({ code, building: sheetName, description,
                             roomType: roomType(description), capacity: capacityOf(description) });

                const slots = [];
                for (let r = headerRow; r <= endRow; r++) {
                    const timeStr = String(cells[r]?.[1] || cells[r]?.[0] || cells[r]?.[2] || "");
                    const m = timeStr.match(/^\s*(\d{1,2}:\d{2}\s*[AP]M)\s*[-–—]\s*(\d{1,2}:\d{2}\s*[AP]M)\s*$/i);
                    slots[r] = m ? { start: parseTime(m[1]), end: parseTime(m[2]) } : null;
                }

                DAYS.forEach((day, d) => {
                    const col = 2 + d;
                    let r = headerRow;
                    while (r <= endRow) {
                        const value = String(cells[r]?.[col] || "").trim();
                        if (!value || !slots[r]) { r++; continue; }
                        const merge = mergeAt.get(r + ":" + col);
                        const last = merge ? Math.min(merge.r2, endRow) : r;
                        const start = slots[r].start;
                        let end = null;
                        for (let k = last; k >= r; k--) if (slots[k]) { end = slots[k].end; break; }
                        if (start !== null && end !== null && end > start) {
                            const parts = value.split("\n").map(x => x.trim()).filter(Boolean);
                            periods.push({ room: code, day, startTime: hhmm(start), endTime: hhmm(end),
                                           subject: (parts[0] || "").slice(0, 60), section: (parts[1] || "").slice(0, 60) });
                        }
                        r = last + 1;
                    }
                });
            });
        }

        if (!rooms.length) throw new Error("No room blocks were found. Expected a ROOM / TIME header with MON–SUN columns.");

        // The same room can appear in two sheets; keep the first and say so
        const seen = new Map();
        const unique = [];
        for (const room of rooms) {
            const key = room.code.toUpperCase();
            if (seen.has(key)) {
                warnings.push(`Room ${room.code} appears in both "${seen.get(key)}" and "${room.building}". `
                    + `It is stored once, under "${seen.get(key)}", and keeps the periods from both sheets.`);
                continue;
            }
            seen.set(key, room.building);
            unique.push(room);
        }
        return { rooms: unique, periods, warnings };
    }

    return { parse };
})();
