// Writes a real .xlsx in the browser — no build step, no library.
//
// The reader (js/lib/xlsx-reader.js) unpacks a workbook by hand; this is the
// other direction. A workbook is a ZIP of small XML parts, so the whole job is:
// build the XML, compute a CRC for each part, and lay the ZIP out by hand.
// Files are deflated when the browser offers CompressionStream and stored
// as-is otherwise — Excel opens both.
const XlsxWriter = (() => {

    // ---------------------------------------------------------------- ZIP
    const CRC_TABLE = (() => {
        const t = new Uint32Array(256);
        for (let i = 0; i < 256; i++) {
            let c = i;
            for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
            t[i] = c >>> 0;
        }
        return t;
    })();

    const crc32 = bytes => {
        let c = 0xFFFFFFFF;
        for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
        return (c ^ 0xFFFFFFFF) >>> 0;
    };

    const deflate = async bytes => {
        if (typeof CompressionStream !== "function") return null;
        try {
            const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
            return new Uint8Array(await new Response(stream).arrayBuffer());
        } catch { return null; }
    };

    /** MS-DOS date and time, which is what a ZIP entry carries. */
    const dosStamp = d => ({
        time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF,
        date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF
    });

    const zip = async files => {
        const stamp = dosStamp(new Date());
        const parts = [];
        const central = [];
        let offset = 0;

        for (const f of files) {
            const raw = new TextEncoder().encode(f.data);
            const packed = await deflate(raw);
            const body = packed && packed.length < raw.length ? packed : raw;
            const method = body === raw ? 0 : 8;
            const name = new TextEncoder().encode(f.name);
            const crc = crc32(raw);

            const head = new DataView(new ArrayBuffer(30));
            head.setUint32(0, 0x04034b50, true);
            head.setUint16(4, 20, true);
            head.setUint16(6, 0, true);
            head.setUint16(8, method, true);
            head.setUint16(10, stamp.time, true);
            head.setUint16(12, stamp.date, true);
            head.setUint32(14, crc, true);
            head.setUint32(18, body.length, true);
            head.setUint32(22, raw.length, true);
            head.setUint16(26, name.length, true);
            head.setUint16(28, 0, true);
            parts.push(new Uint8Array(head.buffer), name, body);

            const dir = new DataView(new ArrayBuffer(46));
            dir.setUint32(0, 0x02014b50, true);
            dir.setUint16(4, 20, true);
            dir.setUint16(6, 20, true);
            dir.setUint16(8, 0, true);
            dir.setUint16(10, method, true);
            dir.setUint16(12, stamp.time, true);
            dir.setUint16(14, stamp.date, true);
            dir.setUint32(16, crc, true);
            dir.setUint32(20, body.length, true);
            dir.setUint32(24, raw.length, true);
            dir.setUint16(28, name.length, true);
            dir.setUint32(42, offset, true);
            central.push(new Uint8Array(dir.buffer), name);

            offset += 30 + name.length + body.length;
        }

        const dirBytes = central.reduce((n, p) => n + p.length, 0);
        const end = new DataView(new ArrayBuffer(22));
        end.setUint32(0, 0x06054b50, true);
        end.setUint16(8, files.length, true);
        end.setUint16(10, files.length, true);
        end.setUint32(12, dirBytes, true);
        end.setUint32(16, offset, true);

        return new Blob([...parts, ...central, new Uint8Array(end.buffer)],
                        { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    };

    // ---------------------------------------------------------------- XML
    const esc = s => String(s).replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]));

    const colLetter = n => {
        let s = "";
        while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = (n - 1 - r) / 26; }
        return s;
    };

    // Style slots, in the order they go into styles.xml. A sheet asks for one
    // of these by name and gets the number Excel expects.
    const STYLES = ["default", "cell", "duty", "class", "name", "head", "text", "bold", "boldUnderline", "title"];
    const styleIndex = name => Math.max(0, STYLES.indexOf(name));

    const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="5">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><u/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="12"/><name val="Calibri"/></font>
<font><sz val="9"/><name val="Calibri"/></font>
</fonts>
<fills count="5">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF0070C0"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF92D050"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color indexed="64"/></left><right style="thin"><color indexed="64"/></right><top style="thin"><color indexed="64"/></top><bottom style="thin"><color indexed="64"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
</cellXfs>
</styleSheet>`;

    // ------------------------------------------------------------- a sheet
    class Sheet {
        constructor(name) {
            this.name = String(name).replace(/[\[\]:*?\/\\]/g, " ").slice(0, 31);
            this.rows = new Map();      // rowNumber -> Map(col -> cell)
            this.merges = [];
            this.widths = new Map();
            this.heights = new Map();
        }
        /** value null keeps the cell empty but still paints the style. */
        set(row, col, value, style = "cell") {
            if (!this.rows.has(row)) this.rows.set(row, new Map());
            this.rows.get(row).set(col, { value, style });
            return this;
        }
        merge(row1, col1, row2, col2) {
            this.merges.push(colLetter(col1) + row1 + ":" + colLetter(col2) + row2);
            return this;
        }
        width(col, chars) { this.widths.set(col, chars); return this; }
        height(row, points) { this.heights.set(row, points); return this; }

        xml() {
            const cols = [...this.widths.entries()].sort((a, b) => a[0] - b[0])
                .map(([c, w]) => `<col min="${c}" max="${c}" width="${w}" customWidth="1"/>`).join("");

            const body = [...this.rows.keys()].sort((a, b) => a - b).map(r => {
                const cells = [...this.rows.get(r).entries()].sort((a, b) => a[0] - b[0]).map(([c, cell]) => {
                    const ref = colLetter(c) + r;
                    const s = styleIndex(cell.style);
                    if (cell.value === null || cell.value === undefined || cell.value === "") {
                        return `<c r="${ref}" s="${s}"/>`;
                    }
                    if (typeof cell.value === "number") return `<c r="${ref}" s="${s}"><v>${cell.value}</v></c>`;
                    return `<c r="${ref}" s="${s}" t="inlineStr"><is><t xml:space="preserve">${esc(cell.value)}</t></is></c>`;
                }).join("");
                const h = this.heights.has(r) ? ` ht="${this.heights.get(r)}" customHeight="1"` : "";
                return `<row r="${r}"${h}>${cells}</row>`;
            }).join("");

            const merges = this.merges.length
                ? `<mergeCells count="${this.merges.length}">${this.merges.map(m => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`
                : "";

            return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<sheetFormatPr defaultRowHeight="14"/>
${cols ? `<cols>${cols}</cols>` : ""}
<sheetData>${body}</sheetData>
${merges}
<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/>
<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0" paperSize="9"/>
</worksheet>`;
        }
    }

    // ---------------------------------------------------------- the workbook
    const build = async sheets => {
        const list = sheets.filter(Boolean);
        if (!list.length) throw new Error("A workbook needs at least one sheet.");

        const files = [
            { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
${list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>` },
            { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>` },
            { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${list.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
</workbook>` },
            { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}
<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` },
            { name: "xl/styles.xml", data: STYLES_XML },
            ...list.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: s.xml() }))
        ];

        return zip(files);
    };

    /** Build the workbook and hand it to the browser as a download. */
    const download = async (filename, sheets) => {
        const blob = await build(sheets);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        return blob.size;
    };

    return { Sheet, build, download, colLetter };
})();
