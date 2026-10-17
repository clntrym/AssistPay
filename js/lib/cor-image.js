// Reads a photo or screenshot of the NCST Certificate of Registration (the COR
// or "SAS") and pulls out the student's class periods.
//
// The engine is Tesseract, kept in js/vendor/tesseract so it runs offline.
//
// OCR on a bordered table is never perfect: depending on how the picture was
// taken, a pass reads some rows cleanly and drops others, and the narrow Days
// cell is the first thing to go. So the image is read three times — the plain
// enlargement, a hard black-and-white copy, and a sparse-text pass that hunts
// for the single-letter day cells — and the rows found are pooled. Whatever is
// still missing comes back flagged (needsDay) for the Coordinator to fill in,
// because a guessed day would put an S.A. on duty during a class.
//
//   const read = await CorImage.read(file, p => console.log(p.status, p.progress));
//   read.studentNumber   "2024-58030"
//   read.studentName     "Daizy Magpantay"   (whose schedule this is)
//   read.rows            [{ day, startTime, endTime, subject, section, needsDay }]
const CorImage = (() => {
    const VENDOR = "js/vendor/tesseract/";
    const DAY_CODES = {
        M: ["MON"], MON: ["MON"], T: ["TUE"], TU: ["TUE"], TUE: ["TUE"],
        W: ["WED"], WED: ["WED"], TH: ["THU"], THU: ["THU"], H: ["THU"],
        F: ["FRI"], FRI: ["FRI"], S: ["SAT"], SA: ["SAT"], SAT: ["SAT"], SU: ["SUN"],
        MW: ["MON", "WED"], MF: ["MON", "FRI"], WF: ["WED", "FRI"],
        MWF: ["MON", "WED", "FRI"], TTH: ["TUE", "THU"], TTHS: ["TUE", "THU", "SAT"],
        MTWTHF: ["MON", "TUE", "WED", "THU", "FRI"]
    };

    let scriptLoaded = null;
    const loadEngine = () => scriptLoaded ??= new Promise((resolve, reject) => {
        if (window.Tesseract) return resolve();
        const tag = document.createElement("script");
        tag.src = VENDOR + "tesseract.min.js";
        tag.onload = resolve;
        tag.onerror = () => reject(new Error("The text-reading engine could not be loaded."));
        document.head.appendChild(tag);
    });

    /** The image as a canvas, enlarged — small table text reads far better big. */
    async function draw(file) {
        const url = URL.createObjectURL(file);
        try {
            const img = await new Promise((resolve, reject) => {
                const i = new Image();
                i.onload = () => resolve(i);
                i.onerror = () => reject(new Error("That image could not be opened."));
                i.src = url;
            });
            const scale = Math.min(3, Math.max(1.5, 1900 / img.width));
            const canvas = document.createElement("canvas");
            canvas.width = Math.round(img.width * scale);
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

    /** The same picture in hard black and white: thin single letters survive. */
    function sharpen(source) {
        const canvas = document.createElement("canvas");
        canvas.width = source.width;
        canvas.height = source.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(source, 0, 0);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const d = pixels.data;
        for (let i = 0; i < d.length; i += 4) {
            const grey = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
            const v = grey < 150 ? 0 : 255;
            d[i] = d[i + 1] = d[i + 2] = v;
        }
        ctx.putImageData(pixels, 0, 0);
        return canvas;
    }

    /** One OCR pass, returning every word it saw and where the word sat. */
    async function scan(canvas, pageSegMode, onProgress) {
        const worker = await Tesseract.createWorker("eng", 1, {
            workerPath: VENDOR + "worker.min.js",
            corePath: VENDOR,
            langPath: VENDOR,
            gzip: true,
            logger: m => onProgress?.(m)
        });
        try {
            await worker.setParameters({ tessedit_pageseg_mode: String(pageSegMode) });
            const { data } = await worker.recognize(canvas, {}, { blocks: true, text: true });
            const words = [];
            for (const block of data.blocks || []) {
                for (const para of block.paragraphs || []) {
                    for (const line of para.lines || []) {
                        for (const w of line.words || []) {
                            const text = String(w.text || "").trim();
                            if (text) words.push({ text, x: w.bbox.x0, x1: w.bbox.x1,
                                                   y: (w.bbox.y0 + w.bbox.y1) / 2, height: w.bbox.y1 - w.bbox.y0 });
                        }
                    }
                }
            }
            return { words, text: String(data.text || "") };
        } finally {
            await worker.terminate();
        }
    }

    const clean = t => String(t).replace(/[|\[\]{}]/g, "").trim();

    /** "7-00PM", "2:00 pm", "|12:00PM|" -> "14:00"; null when it isn't a time. */
    function toTime(token) {
        const m = clean(token).toUpperCase().match(/^(\d{1,2})[:.\-](\d{2})\s*([AP])\.?M\.?$/);
        if (!m) return null;
        let h = Number(m[1]) % 12;
        if (m[3] === "P") h += 12;
        const min = Number(m[2]);
        if (h > 23 || min > 59) return null;
        return String(h).padStart(2, "0") + ":" + String(min).padStart(2, "0");
    }

    /** "MWF" -> [MON, WED, FRI]; tolerates the case and stray marks OCR adds. */
    function toDays(token) {
        const key = clean(token).toUpperCase().replace(/[^A-Z]/g, "");
        return DAY_CODES[key] || null;
    }

    const isCode = t => /^[A-Z]{2,4}\s?\d{3}[A-Z]?$/.test(clean(t).toUpperCase());

    /**
     * One line of the table -> one class entry. The times anchor everything: the
     * day sits just left of the start time, the section just right of the end.
     */
    function parseTokens(raw) {
        const tokens = raw.map(t => ({ clean: clean(t) })).filter(t => t.clean);
        const times = [];
        tokens.forEach((t, i) => { const v = toTime(t.clean); if (v) times.push({ value: v, index: i }); });
        if (times.length < 2) return null;

        // the subject code, e.g. IT 302 — OCR often splits it into "IT" and "302"
        let subject = "";
        for (let i = 0; i < times[0].index; i++) {
            const t = tokens[i].clean;
            if (isCode(t)) { subject = t.toUpperCase().replace(/\s+/g, " "); break; }
            const next = tokens[i + 1]?.clean || "";
            if (/^[A-Z]{2,4}$/i.test(t) && /^\d{3}[A-Z]?$/.test(next)) { subject = (t + " " + next).toUpperCase(); break; }
        }
        if (!subject) return null;
        if (!/\s/.test(subject)) subject = subject.replace(/^([A-Z]{2,4})(\d{3}[A-Z]?)$/, "$1 $2");

        // the day cell: the last day-looking token before the start time
        let days = null;
        for (let i = times[0].index - 1; i >= 0 && i >= times[0].index - 4; i--) {
            const found = toDays(tokens[i].clean);
            if (found) { days = found; break; }
        }

        // section: "BSIT - 31E1", often split across two or three tokens
        let section = "";
        const after = tokens.slice(times[1].index + 1).map(t => t.clean).join(" ");
        const match = after.match(/\b([A-Z]{2,6})\s*-\s*([A-Z0-9]{2,8})\b/i);
        if (match) section = (match[1] + " - " + match[2]).toUpperCase();

        return { subject, days, startTime: times[0].value, endTime: times[1].value, section };
    }

    /** Splits an OCR line into tokens, dropping the table's cell separators. */
    const lineTokens = line => line.split(/[\s|]+/).filter(Boolean);

    /**
     * The COR names the student right after the student number:
     *   2024-58030  Magpantay  Daizy  Salva  BSIT  N/A
     * That name is what tells the Coordinator whether the right schedule is
     * about to be saved against the right S.A.
     */
    function readName(text, studentNumber) {
        if (!studentNumber) return "";
        const loose = studentNumber.replace(/(\d{4})-(\d+)/, "$1\\s?-\\s?$2");
        for (const line of text.split("\n")) {
            const match = line.match(new RegExp(loose + "\\s+(.+)$"));
            if (!match) continue;
            const words = match[1].split(/[\s|]+/)
                .map(w => w.replace(/[^A-Za-z\u00C0-\u024F.-]/g, "").trim())
                .filter(w => w.length > 1 && /^[A-Za-z]/.test(w));
            if (words.length < 2) continue;
            const last = words[0];
            const first = words[1];
            if (!/^[A-Za-z][A-Za-z\u00C0-\u024F.-]+$/.test(last)) continue;
            return (first + " " + last).replace(/\s+/g, " ").trim();
        }
        return "";
    }

    async function read(file, onProgress) {
        await loadEngine();
        onProgress?.({ status: "preparing the image", progress: 0.04 });
        const plain = await draw(file);
        const sharp = sharpen(plain);

        const report = (step, from, to) => m => onProgress?.({
            status: m.status === "recognizing text" ? `reading the image (${step} of 3)` : m.status,
            progress: from + (m.progress || 0) * (to - from)
        });

        // The same table read three ways. Which rows a pass gets right depends on
        // the picture, so what they find is pooled rather than trusted one by one.
        const passes = [
            await scan(plain, 6, report(1, 0.05, 0.36)),
            await scan(sharp, 6, report(2, 0.36, 0.67)),
            await scan(plain, 3, report(3, 0.67, 0.98))
        ];
        onProgress?.({ status: "checking what was read", progress: 1 });

        const text = passes.map(p => p.text).join("\n");
        const studentNumber = (text.match(/\b(20\d{2}\s?-\s?\d{4,6})\b/) || [])[1]?.replace(/\s+/g, "") || "";
        const studentName = readName(text, studentNumber);

        // Pool what every pass read, keeping the fullest version of each entry
        const entries = new Map();
        for (const pass of passes) {
            for (const line of pass.text.split("\n")) {
                const entry = parseTokens(lineTokens(line));
                if (!entry) continue;
                const key = entry.subject + "|" + entry.startTime + "|" + entry.endTime;
                const kept = entries.get(key);
                if (!kept) { entries.set(key, entry); continue; }
                if (!kept.days && entry.days) kept.days = entry.days;
                if (!kept.section && entry.section) kept.section = entry.section;
            }
        }

        const periods = [];
        const warnings = [];
        for (const entry of entries.values()) {
            if (entry.endTime <= entry.startTime) {
                warnings.push(`${entry.subject}: the time ${entry.startTime}\u2013${entry.endTime} was not read properly. Check it before importing.`);
            }
            for (const day of entry.days || [""]) {
                periods.push({ day, startTime: entry.startTime, endTime: entry.endTime,
                               subject: entry.subject, section: entry.section, needsDay: !day });
            }
        }
        periods.sort((a, b) => a.subject.localeCompare(b.subject) || a.startTime.localeCompare(b.startTime));

        if (!periods.length) {
            throw new Error("No class period could be read from this image. Use a straight, sharp photo of the whole table, "
                + "or type the periods in with Edit schedule.");
        }
        return { studentNumber, studentName, rows: periods, warnings, text };
    }

    return { read };
})();
