// Reads .xlsx workbooks in the browser, so Excel files can be imported without
// a spreadsheet library or a server-side zip extension.
//
// An .xlsx is a ZIP of XML parts. This unzips the parts we need
// (DecompressionStream handles the deflate) and hands back a plain grid:
//
//   const book = await XlsxReader.open(file);
//   const sheet = await book.sheet(0);       // { cells, colours, merges, mergeAt }
//   sheet.cells[0][2]                        // row 1, column C as text
//   sheet.colours[0][2]                      // "92D050" when that cell is filled
//
// Merged ranges are expanded: every cell in the range carries the anchor's
// value, and its colour when Excel left the other cells unfilled.
const XlsxReader = (() => {
    const CR = String.fromCharCode(13);

    // ---------- minimal ZIP reader ----------
    async function unzip(buffer) {
        const view = new DataView(buffer);
        const bytes = new Uint8Array(buffer);

        // End of central directory, searched from the back
        let eocd = -1;
        for (let i = bytes.length - 22; i >= 0 && i > bytes.length - 66000; i--) {
            if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
        }
        if (eocd === -1) throw new Error("This file is not a valid .xlsx workbook.");

        const count = view.getUint16(eocd + 10, true);
        let offset = view.getUint32(eocd + 16, true);
        const files = {};

        for (let i = 0; i < count; i++) {
            if (view.getUint32(offset, true) !== 0x02014b50) break;
            const method = view.getUint16(offset + 10, true);
            const compressedSize = view.getUint32(offset + 20, true);
            const nameLength = view.getUint16(offset + 28, true);
            const extraLength = view.getUint16(offset + 30, true);
            const commentLength = view.getUint16(offset + 32, true);
            const localOffset = view.getUint32(offset + 42, true);
            const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
            offset += 46 + nameLength + extraLength + commentLength;

            // Local header tells us where the data really starts
            const localNameLength = view.getUint16(localOffset + 26, true);
            const localExtraLength = view.getUint16(localOffset + 28, true);
            const dataStart = localOffset + 30 + localNameLength + localExtraLength;
            files[name] = { method, data: bytes.subarray(dataStart, dataStart + compressedSize) };
        }
        return files;
    }

    async function readPart(files, name) {
        const entry = files[name];
        if (!entry) return null;
        if (entry.method === 0) return new TextDecoder().decode(entry.data);
        const stream = new Blob([entry.data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return new TextDecoder().decode(await new Response(stream).arrayBuffer());
    }

    // ---------- XML helpers ----------
    const decode = s => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
    const colIndex = ref => [...ref.match(/^[A-Z]+/)[0]].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1;

    // Excel's indexed palette, for the few files that still use it
    const INDEXED = ["000000", "FFFFFF", "FF0000", "00FF00", "0000FF", "FFFF00", "FF00FF", "00FFFF"];

    /** styles.xml -> (styleIndex) => "RRGGBB" for the cell's fill, "" when unfilled. */
    function fillReader(stylesXml) {
        const fillsBlock = (stylesXml || "").match(/<fills[^>]*>(.*?)<\/fills>/s)?.[1] ?? "";
        const fills = [...fillsBlock.matchAll(/<fill>(.*?)<\/fill>/gs)].map(f => {
            const fg = f[1].match(/<fgColor([^>]*)\/?>/)?.[1] ?? "";
            const rgb = fg.match(/rgb="([0-9A-Fa-f]{6,8})"/)?.[1];
            const indexed = fg.match(/indexed="(\d+)"/)?.[1];
            const solid = /patternType="solid"/.test(f[1]);
            if (!solid) return "";
            if (rgb) return rgb.slice(-6).toUpperCase();
            if (indexed !== undefined) return INDEXED[Number(indexed)] ?? "";
            return "";                                   // theme colours: treated as unfilled
        });
        const xfsBlock = (stylesXml || "").match(/<cellXfs[^>]*>(.*?)<\/cellXfs>/s)?.[1] ?? "";
        const xfs = [...xfsBlock.matchAll(/<xf[^>]*?fillId="(\d+)"[^>]*?\/?>/g)].map(m => Number(m[1]));
        return styleIndex => fills[xfs[styleIndex] ?? 0] ?? "";
    }

    function buildGrid(xml, shared, colourOf) {
        const cells = [];
        const colours = [];
        for (const rowMatch of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>(.*?)<\/row>/gs)) {
            const r = Number(rowMatch[1]) - 1;
            cells[r] ||= [];
            colours[r] ||= [];
            // Cells can be self-closing (<c r="A1" s="5"/>): both forms must match
            for (const c of rowMatch[2].matchAll(/<c r="([A-Z]+\d+)"([^>]*?)(?:\/>|>(.*?)<\/c>)/gs)) {
                const body = c[3] ?? "";
                const v = body.match(/<v>(.*?)<\/v>/s)?.[1];
                const inline = [...body.matchAll(/<t[^>]*>(.*?)<\/t>/gs)].map(t => t[1]).join("");
                let value = "";
                if (/t="s"/.test(c[2]) && v !== undefined) value = shared[Number(v)] ?? "";
                else if (inline) value = decode(inline);
                else if (v !== undefined) value = v;
                const col = colIndex(c[1]);
                cells[r][col] = String(value ?? "").split(CR).join("").trim();
                colours[r][col] = colourOf(Number(c[2].match(/s="(\d+)"/)?.[1] ?? 0));
            }
        }

        const merges = [];
        const mergeAt = new Map();
        for (const m of xml.matchAll(/<mergeCell ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g)) {
            const c1 = colIndex(m[1] + m[2]), r1 = Number(m[2]) - 1;
            const c2 = colIndex(m[3] + m[4]), r2 = Number(m[4]) - 1;
            const merge = { r1, c1, r2, c2, value: cells[r1]?.[c1] ?? "" };
            const colour = colours[r1]?.[c1] ?? "";
            merges.push(merge);
            for (let r = r1; r <= r2; r++) {
                cells[r] ||= [];
                colours[r] ||= [];
                for (let c = c1; c <= c2; c++) {
                    cells[r][c] = merge.value;
                    if (!colours[r][c]) colours[r][c] = colour;
                    mergeAt.set(r + ":" + c, merge);
                }
            }
        }
        return { cells, colours, merges, mergeAt };
    }

    /** Opens a File/Blob and returns { sheets: [names], sheet(indexOrName) }. */
    async function open(file) {
        const files = await unzip(await file.arrayBuffer());

        const sharedXml = await readPart(files, "xl/sharedStrings.xml");
        const shared = [];
        if (sharedXml) {
            for (const m of sharedXml.matchAll(/<si>(.*?)<\/si>/gs)) {
                shared.push(decode([...m[1].matchAll(/<t[^>]*>(.*?)<\/t>/gs)].map(t => t[1]).join("")));
            }
        }

        const workbook = await readPart(files, "xl/workbook.xml");
        if (!workbook) throw new Error("This file is not a valid .xlsx workbook.");
        const relsXml = await readPart(files, "xl/_rels/workbook.xml.rels") || "";
        const rels = Object.fromEntries([...relsXml.matchAll(/Id="([^"]+)"[^>]*Target="([^"]+)"/g)]
            .map(m => [m[1], m[2].replace(/^\/?xl\//, "")]));
        const parts = [...workbook.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)]
            .map(m => ({ name: decode(m[1]), file: rels[m[2]] }));
        const colourOf = fillReader(await readPart(files, "xl/styles.xml"));

        return {
            sheets: parts.map(p => p.name),
            async sheet(which) {
                const part = typeof which === "number" ? parts[which] : parts.find(p => p.name === which);
                if (!part || !part.file) return null;
                const xml = await readPart(files, "xl/" + part.file);
                return xml ? buildGrid(xml, shared, colourOf) : null;
            }
        };
    }

    return { open, decode, colIndex };
})();
