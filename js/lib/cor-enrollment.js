// Reads a photo or screenshot of the NCST Certificate of Registration and
// extracts all enrollment details: reference number, academic term, subject
// rows (code, description, units, type, days, times, section, room, instructor)
// and the fee assessment. Two OCR passes are run — a plain enlargement and a
// black-and-white copy — and the combined text is parsed with pattern rules.
//
//   const data = await CorEnrollment.read(file, p => console.log(p.status, p.progress));
//   data.referenceNo       "237551"
//   data.schoolYear        "2026-2027"
//   data.semester          "1st Semester"
//   data.subjects          [{ code, description, units, type, days, start_time, end_time, section, room, instructor }]
//   data.fees              { tuition_fee, lab_fee, misc_fee, lms_fee, nstp_fee, omr_fee, installment_charge }
const CorEnrollment = (() => {
    const VENDOR = "js/vendor/tesseract/";

    let scriptLoaded = null;
    const loadEngine = () => scriptLoaded ??= new Promise((resolve, reject) => {
        if (window.Tesseract) return resolve();
        const tag = document.createElement("script");
        tag.src = VENDOR + "tesseract.min.js";
        tag.onload = resolve;
        tag.onerror = () => reject(new Error("The text-reading engine could not be loaded."));
        document.head.appendChild(tag);
    });

    async function draw(file) {
        const url = URL.createObjectURL(file);
        try {
            const img = await new Promise((resolve, reject) => {
                const i = new Image();
                i.onload  = () => resolve(i);
                i.onerror = () => reject(new Error("Could not open the image."));
                i.src = url;
            });
            const scale  = Math.min(3, Math.max(1.5, 1900 / img.width));
            const canvas = document.createElement("canvas");
            canvas.width  = Math.round(img.width  * scale);
            canvas.height = Math.round(img.height * scale);
            const ctx = canvas.getContext("2d");
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = "high";
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            return canvas;
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    function sharpen(src) {
        const canvas = document.createElement("canvas");
        canvas.width = src.width; canvas.height = src.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(src, 0, 0);
        const px = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = px.data;
        for (let i = 0; i < d.length; i += 4) {
            const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            const v = g < 150 ? 0 : 255;
            d[i] = d[i + 1] = d[i + 2] = v;
        }
        ctx.putImageData(px, 0, 0);
        return canvas;
    }

    async function runOcr(canvas, psm, onProgress) {
        const worker = await Tesseract.createWorker("eng", 1, {
            workerPath: VENDOR + "worker.min.js",
            corePath: VENDOR, langPath: VENDOR, gzip: true,
            logger: m => onProgress?.(m)
        });
        try {
            await worker.setParameters({ tessedit_pageseg_mode: String(psm) });
            const { data } = await worker.recognize(canvas, {}, { text: true });
            return String(data.text || "");
        } finally {
            await worker.terminate();
        }
    }

    // "2:00PM" / "14:00" / "2.00PM" -> "14:00" or null
    function parseTime(t) {
        const m = String(t).trim().toUpperCase()
            .match(/^(\d{1,2})[:.\-](\d{2})\s*([AP])\.?M\.?$/);
        if (!m) return null;
        let h = Number(m[1]) % 12;
        if (m[3] === "P") h += 12;
        const min = Number(m[2]);
        if (h > 23 || min > 59) return null;
        return String(h).padStart(2, "0") + ":" + String(min).padStart(2, "0");
    }

    // Parse day abbreviations: M T W TH F S → "MTWTHFS" or combinations like "MWF" → "MWF"
    // Handles both single letters and "TH" as a pair
    function parseDays(raw) {
        const s = String(raw).toUpperCase().replace(/[^MTWTHFS]/g, "");
        if (!s) return "";
        // Replace "TH" → "§" (placeholder), extract, then restore
        const withPlaceholder = s.replace(/TH/g, "§");
        const days = withPlaceholder.split("").filter(c => "MTWFS§".includes(c)).join("");
        return days.replace(/§/g, "TH");  // restore TH
    }

    // "₱11,627.10" / "P11,627.10" / "11627.10" -> 11627.10
    function parsePeso(s) {
        const clean = String(s).replace(/[₱P\s,]/g, "").trim();
        const n = parseFloat(clean);
        return isNaN(n) ? 0 : n;
    }

    // Normalise a raw OCR line before tokenising it.
    // Key fix: Tesseract often splits "2:00 PM" into two tokens; glue them back.
    function normalizeLine(raw) {
        return raw
            .replace(/[|{}[\]]/g, " ")           // strip table-border characters
            // merge "H:MM PM" / "H:MM AM" (with optional dot notation) into one token
            .replace(/(\d{1,2}[:.]\d{2})\s+([AaPp])\.?[Mm]\.?/g,
                     (_, t, ap) => t + ap.toUpperCase() + "M")
            .replace(/\s{2,}/g, " ")
            .trim();
    }

    // Find the peso amount on the same line as a label
    function extractFee(text, ...labels) {
        for (const label of labels) {
            const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            // Same line: "Tuition Fee P11,627.10"
            const m = text.match(new RegExp(escaped + "[^\\n]*?([\\d,]+\\.\\d{2})", "i"));
            if (m) return parsePeso(m[1]);
        }
        return 0;
    }

    function parseSubjectLine(line) {
        const norm = normalizeLine(line);

        // ── 1. Extract subject code (IT 302, CS 101, etc.) ──────────────────
        const codeMatch = norm.match(/\b([A-Z]{2,4})\s*(\d{3}[A-Z]?)\b/);
        if (!codeMatch) return null;
        const code = (codeMatch[1] + " " + codeMatch[2]).toUpperCase();

        // ── 2. Find time tokens anywhere in the line ──────────────────────
        const times = [];
        const timeRegex = /\d{1,2}[:.]\d{2}\s*[AP]\.?M\.?/gi;
        let m;
        while ((m = timeRegex.exec(norm)) !== null) {
            const v = parseTime(m[0]);
            if (v) times.push(v);
        }
        if (times.length < 2) return null;
        const [start_time, end_time] = times.slice(0, 2);

        // ── 3. Find type (Lec/Lab) near the times ───────────────────────────
        let type = "Lec";
        if (/\blab/i.test(norm)) type = "Lab";
        else if (/lec\s*\/\s*lab/i.test(norm)) type = "Lec/Lab";

        // ── 4. Find units (number 0.5-6 before or after type) ───────────────
        let units = "3";
        const unitsMatch = norm.match(/\b([0-6](?:\.\d+)?)\s*(?:unit|lec|lab)/i);
        if (unitsMatch) units = unitsMatch[1];

        // ── 5. Days: extract ONLY between type and first time ────────────────
        let days = "";
        // Find positions to constrain search
        const codePos = norm.indexOf(code);
        const firstTimePos = norm.search(/\d{1,2}[:.]\d{2}\s*[AP]\.?M\.?/i);

        // Look for days ONLY in the segment between code and times
        const segment = norm.slice(codePos, firstTimePos);
        const dayMatch = segment.match(/\b([MTWTHFS]{1,6})\b/);
        if (dayMatch) days = parseDays(dayMatch[1]);

        // ── 6. Description: text between code and first time ────────────────
        let description = "";
        if (codePos >= 0 && firstTimePos > codePos + code.length) {
            description = norm.substring(codePos + code.length, firstTimePos)
                .replace(/\d+(?:\.\d+)?/g, "")  // strip numbers (units, etc)
                .replace(/\b(?:lec|lab|lecture|laboratory)\b/gi, "")
                .replace(/[MTWTHFSU]{2,}/i, "")  // strip days
                .trim()
                .slice(0, 100);
        }

        // ── 7. Section: pattern like "BSIT-31E1" ───────────────────────────
        let section = "";
        const secMatch = norm.match(/\b([A-Z]{2,6})\s*[-–]\s*(\d{2}[A-Z]\d)\b/);
        if (secMatch) section = (secMatch[1] + " - " + secMatch[2]).toUpperCase();

        // ── 8. Room: 3-4 digit number ──────────────────────────────────────
        let room = "";
        const roomMatch = norm.match(/\b(\d{3,4}[A-Z]?)\b/);
        if (roomMatch) room = roomMatch[1];

        // ── 9. Instructor: ALL CAPS name with optional comma ────────────────
        let instructor = "";
        const instrMatch = norm.match(/\b([A-Z]{3,}(?:\s+[A-Z]{3,})*)\b/);
        if (instrMatch && instrMatch[1].length > 4) instructor = instrMatch[1];

        return { code, description, units, type, days,
                 start_time, end_time, section, room, instructor };
    }

    function parseAllSubjects(text) {
        const rows = [];
        const seen = new Set();
        // Normalize each line before parsing so split-time tokens are fixed
        for (const raw of text.split("\n")) {
            const row = parseSubjectLine(raw);
            if (!row) continue;
            const key = `${row.code}|${row.start_time}|${row.end_time}|${row.type}`;
            if (seen.has(key)) continue;
            seen.add(key);
            rows.push(row);
        }
        rows.sort((a, b) => a.code.localeCompare(b.code) || a.start_time.localeCompare(b.start_time));
        return rows;
    }

    async function read(file, onProgress) {
        await loadEngine();
        onProgress?.({ status: "preparing image", progress: 0.03 });
        const plain = await draw(file);
        const sharp = sharpen(plain);

        const prog = (step, lo, hi) => m => onProgress?.({
            status: m.status === "recognizing text"
                ? `reading COR (pass ${step} of 3)` : m.status,
            progress: lo + (m.progress || 0) * (hi - lo)
        });

        // Pass 1: plain image, PSM 6 (uniform text block) — good for headers/fees
        // Pass 2: B&W sharpened, PSM 6 — boosts contrast for small text
        // Pass 3: plain image, PSM 3 (auto) — handles mixed table/paragraph layouts
        const text1 = await runOcr(plain, 6, prog(1, 0.05, 0.36));
        const text2 = await runOcr(sharp, 6, prog(2, 0.36, 0.67));
        const text3 = await runOcr(plain, 3, prog(3, 0.67, 0.97));
        onProgress?.({ status: "extracting details", progress: 0.98 });

        const full = text1 + "\n" + text2 + "\n" + text3;

        // ── Reference number ───────────────────────────────────────────────
        const refMatch = full.match(/Reference[^:]*:\s*(\d{4,10})/i);
        const referenceNo = refMatch ? refMatch[1] : "";

        // ── School year ────────────────────────────────────────────────────
        const syMatch = full.match(/\b(20\d{2})\s*[-–]\s*(20\d{2})\b/);
        const schoolYear = syMatch ? `${syMatch[1]}-${syMatch[2]}` : "";

        // ── Semester ───────────────────────────────────────────────────────
        const semMatch = full.match(/\b(1st|2nd|First|Second|Summer)\s+Semester\b/i);
        let semester = "1st Semester";
        if (semMatch) {
            const s = semMatch[1].toLowerCase();
            if (s === "2nd" || s === "second") semester = "2nd Semester";
            else if (s === "summer") semester = "Summer";
        }

        // ── Subject rows ───────────────────────────────────────────────────
        const subjects = parseAllSubjects(full);

        // ── Fee amounts ────────────────────────────────────────────────────
        const fees = {
            tuition_fee:        extractFee(full, "Tuition Fee", "Tuition"),
            lab_fee:            extractFee(full, "Laboratory Fee", "Lab Fee", "Laboratory"),
            misc_fee:           extractFee(full, "Miscellaneous", "Misc Fee"),
            lms_fee:            extractFee(full, "LMS"),
            nstp_fee:           extractFee(full, "NSTP/ROTC", "NSTP", "ROTC"),
            omr_fee:            extractFee(full, "OMR"),
            installment_charge: extractFee(full, "Installment Charge", "Installment Ch")
        };

        // Convert to strings for the form (skip 0 → leave blank so user can see it's unread)
        const feesStr = {};
        Object.entries(fees).forEach(([k, v]) => { feesStr[k] = v ? v.toFixed(2) : ""; });

        return { referenceNo, schoolYear, semester, subjects, fees: feesStr, rawText: full };
    }

    return { read };
})();
