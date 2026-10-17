// Imports the NCST S.A. duty form (.xlsx) — the colour-coded weekly grid kept
// per room or office. Blue becomes the class schedule; yellow is kept as the
// duty hours that S.A. asked for, which matching weighs but does not have to
// follow.
//
// The form names S.A.s ("MAGPANTAY, DAIZY") but carries no student ID, so the
// Coordinator confirms who each name is before anything is saved. A choice that
// does not match the name in the file is flagged, because the schedule would
// otherwise land on the wrong S.A.:
//   1. read the file in the browser (XlsxClasses)
//   2. match each name to a registered S.A. — the closest name is pre-selected
//   3. the usual import preview, then save
//
// <xlsx-class-import :semester-id="semester.id" @imported="load" />
const XlsxClassImport = {
    components: { AppIcon, AppModal },
    props: { semesterId: Number },
    emits: ["imported"],

    setup(props, { emit }) {
        const fileInput = Vue.ref(null);
        const dragging = Vue.ref(false);
        const busy = Vue.ref(false);
        const error = Vue.ref("");
        const fileName = Vue.ref("");
        const showHelp = Vue.ref(false);

        const people = Vue.ref([]);          // parsed from the file
        const warnings = Vue.ref([]);
        const saList = Vue.ref([]);          // registered S.A.s
        const mapping = Vue.reactive({});    // file name -> sa profile id ("" = skip)
        const stage = Vue.ref("");           // "" | map | preview
        const preview = Vue.ref(null);
        const rows = Vue.ref([]);

        const dayNames = { MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday", SUN: "Sunday" };
        const statusStyles = {
            VALID: ["text-success", "CircleCheck", "Valid"],
            WARNING: ["text-warning", "TriangleAlert", "Skipped"],
            ERROR: ["text-danger", "CircleX", "Error"]
        };

        const tokens = name => String(name || "").toUpperCase().replace(/[^A-ZÀ-ɏ ]/g, " ")
            .split(/\s+/).filter(t => t.length > 1);

        /** Same person, whichever way round the file prints the name. */
        const sameName = (a, b) => {
            const left = tokens(a), right = tokens(b);
            if (!left.length || !right.length) return false;
            return left.every(t => right.includes(t)) || right.every(t => left.includes(t));
        };

        /** The one S.A. whose name covers the file's name (or is covered by it). */
        const bestMatch = fileName => {
            const hits = saList.value.filter(sa => sameName(sa.name, fileName));
            return hits.length === 1 ? String(hits[0].id) : "";
        };

        /** True when the chosen S.A. is not the one written in the file. */
        const isMismatch = person => {
            const sa = saList.value.find(s => String(s.id) === String(mapping[person.name]));
            return !!sa && !sameName(sa.name, person.name);
        };

        const pick = () => fileInput.value?.click();

        const handleFile = async file => {
            error.value = "";
            if (!file) return;
            if (!/\.(xlsx|xlsm)$/i.test(file.name)) {
                error.value = "Only .xlsx and .xlsm files are accepted. In Excel, use File > Save As and choose Excel Workbook (.xlsx) or Macro-Enabled Workbook (.xlsm).";
                return;
            }
            if (file.size > 8 * 1024 * 1024) {
                error.value = "That file is larger than 8 MB. Split it into smaller files.";
                return;
            }
            fileName.value = file.name;
            busy.value = true;
            try {
                const parsed = await XlsxClasses.parse(file);
                const list = await Model.request("sa", "list");
                if (!list.success) throw new Error(list.message);
                saList.value = list.items.filter(sa => sa.saStatus === "ACTIVE");
                people.value = parsed.people;
                warnings.value = parsed.warnings;
                Object.keys(mapping).forEach(k => delete mapping[k]);
                parsed.people.forEach(p => { mapping[p.name] = bestMatch(p.name); });
                stage.value = "map";
            } catch (e) {
                error.value = e.message || "That file couldn't be read.";
            } finally {
                busy.value = false;
                if (fileInput.value) fileInput.value.value = "";
            }
        };

        const onDrop = e => { dragging.value = false; handleFile(e.dataTransfer?.files?.[0]); };

        const matched = Vue.computed(() => people.value.filter(p => mapping[p.name]));
        const duplicateIds = Vue.computed(() => {
            const seen = {}, dupes = new Set();
            people.value.forEach(p => {
                const id = mapping[p.name];
                if (!id) return;
                if (seen[id]) dupes.add(id);
                seen[id] = true;
            });
            return dupes;
        });
        const saName = id => saList.value.find(sa => String(sa.id) === String(id))?.name || "";
        const mismatched = Vue.computed(() => people.value.filter(p => mapping[p.name] && isMismatch(p)));

        const toRows = () => {
            const out = [];
            people.value.forEach(p => {
                const sa = saList.value.find(s => String(s.id) === String(mapping[p.name]));
                if (!sa) return;
                p.blocks.forEach(b => {
                    out.push({ _line: out.length + 1, studentId: sa.studentId, day: b.day,
                               startTime: b.startTime, endTime: b.endTime, subject: "Class", section: "",
                               fileName: p.name, saName: sa.name });
                });
            });
            return out;
        };

        const toPreview = async () => {
            error.value = "";
            rows.value = toRows();
            if (!rows.value.length) { error.value = "Choose at least one S.A. before continuing."; return; }

            if (mismatched.value.length) {
                const list = mismatched.value
                    .map(p => `<br>\u2022 <b class="text-ink">${Alerts.esc(p.name)}</b> in the file \u2192 ${Alerts.esc(saName(mapping[p.name]))}`)
                    .join("");
                const proceed = await Alerts.confirm({
                    title: "A name does not match",
                    html: `${mismatched.value.length} chosen S.A.(s) are not the ones written in the file:${list}`
                        + `<br><span class="text-caption">Saving it this way gives them a schedule that is not theirs, and `
                        + `matching will keep the wrong hours free.</span>`,
                    icon: "warning", danger: true, confirmText: "Use my choice anyway", cancelText: "Go back"
                });
                if (!proceed) return;
            }
            busy.value = true;
            const r = await Model.request("scheduling", "class_preview", { rows: rows.value, semesterId: props.semesterId });
            busy.value = false;
            if (!r.success) { error.value = r.message; return; }
            // Keep the file's name beside each checked row
            preview.value = { summary: r.summary, rows: r.rows.map((row, i) => ({ ...row, saName: rows.value[i]?.saName || row.name })) };
            stage.value = "preview";
        };

        const confirmImport = async () => {
            busy.value = true;
            const r = await Model.request("scheduling", "class_import", { rows: rows.value, semesterId: props.semesterId });
            busy.value = false;
            if (!r.success) { error.value = r.message; return; }

            // The yellow blocks travel with the import as a preference. This has
            // to happen before close(), which forgets what the file held.
            const wishes = [];
            people.value.forEach(p => {
                const sa = saList.value.find(s => String(s.id) === String(mapping[p.name]));
                if (!sa) return;
                (p.wishes || []).forEach(w => wishes.push({ studentId: sa.studentId, day: w.day,
                                                            startTime: w.startTime, endTime: w.endTime }));
            });
            if (wishes.length) {
                const pref = await Model.request("scheduling", "duty_preferences_save",
                    { preferences: wishes, semesterId: props.semesterId });
                if (pref.success) Store.toast("success", `${pref.saved} preferred duty block(s) recorded for matching.`);
                else Store.toast("warning", "The class hours were saved, but the preferred duty hours were not: " + pref.message, 6000);
            }

            close();
            Store.toast("success", r.imported === 1 ? "1 class row imported." : `${r.imported} class rows imported.`);
            if (r.summary.warnings) Store.toast("warning", `${r.summary.warnings} row(s) skipped as duplicates or overlaps.`, 6000);
            if (r.summary.errors) Store.toast("danger", `${r.summary.errors} row(s) had errors and were not imported.`, 6000);
            if (r.clashes?.length) {
                Store.toast("warning", `${r.clashes.length} duty period(s) now clash with a class schedule. `
                    + `Open Finalized Schedule to move the duty.`, 9000);
            }
            emit("imported", r);
        };

        const close = () => {
            stage.value = "";
            preview.value = null;
            people.value = [];
            warnings.value = [];
            rows.value = [];
            error.value = "";
        };

        return { fileInput, dragging, busy, error, fileName, showHelp, people, warnings, saList, mapping,
                 stage, preview, rows, dayNames, statusStyles, matched, duplicateIds, saName,
                 isMismatch, mismatched,
                 pick, handleFile, onDrop, toPreview, confirmImport, close };
    },

    template: `
    <div class="flex flex-wrap gap-2">
        <button @click="pick" :disabled="busy" class="btn btn-primary">
            <app-icon :name="busy ? 'LoaderCircle' : 'Upload'" :size="16" :class="busy ? 'animate-spin' : ''" />
            {{ busy ? 'Reading…' : 'Upload duty form (.xlsx / .xlsm)' }}
        </button>
        <input ref="fileInput" type="file" accept=".xlsx,.xlsm" class="sr-only"
               @change="handleFile($event.target.files[0])" aria-label="Upload duty form">
    </div>

    <div class="mt-4 rounded-xl border-2 border-dashed p-5 transition-colors duration-150"
         :class="dragging ? 'border-navy bg-mist' : 'border-line bg-white'"
         @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop">
        <div class="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <span class="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-mist text-navy"><app-icon name="Table2" :size="20" /></span>
            <div class="flex-1">
                <p class="text-body font-medium text-ink">Drop the duty form (.xlsx / .xlsm) here, or use the button above.</p>
                <p class="mt-0.5 text-caption text-muted">
                    Blue cells become class hours. Yellow cells are kept as the duty hours that S.A. asked for.
                    <button @click="showHelp = true" class="font-medium text-info underline-offset-2 hover:underline">How the file is read</button>
                </p>
            </div>
        </div>
        <p v-if="error && !stage" class="mt-3 flex items-start gap-2 text-body text-danger" role="alert">
            <app-icon name="CircleX" :size="16" class="mt-0.5 shrink-0" /> {{ error }}
        </p>
    </div>

    <app-modal :open="showHelp" title="How the duty form is read" icon="Table2" @close="showHelp = false"
               description="The colour-coded weekly grid kept per room or office.">
        <ul class="space-y-3 text-body">
            <li class="flex items-start gap-3">
                <span class="mt-1 h-4 w-4 shrink-0 rounded border border-line" style="background:#00B0F0"></span>
                <span><span class="font-semibold text-ink">Blue</span> — the S.A.'s class hours. These are imported, so matching
                      never puts duty on top of a class.</span>
            </li>
            <li class="flex items-start gap-3">
                <span class="mt-1 h-4 w-4 shrink-0 rounded border border-line" style="background:#FFFF00"></span>
                <span><span class="font-semibold text-ink">Yellow</span> — the duty hours the S.A. asked for. Saved as a
                      preference: matching ranks those hours higher for them, but the duty is only final once you approve
                      the schedule.</span>
            </li>
            <li class="flex items-start gap-3">
                <span class="mt-1 h-4 w-4 shrink-0 rounded border border-line" style="background:#92D050"></span>
                <span><span class="font-semibold text-ink">Green</span> — the S.A. name row. Two names separated by "/" means
                      the left column of each day is the first S.A. and the right column the second.</span>
            </li>
            <li class="flex items-start gap-3">
                <app-icon name="Clock" :size="16" class="mt-1 shrink-0 text-muted" />
                <span>Slots run down the sheet in 30-minute steps from the first time in column A (7:00 AM),
                      with the room or office in column A of the name row.</span>
            </li>
            <li class="flex items-start gap-3">
                <app-icon name="UserCheck" :size="16" class="mt-1 shrink-0 text-muted" />
                <span>The form has no student ID, so you confirm which registered S.A. each name is before anything is saved.</span>
            </li>
        </ul>
        <template #footer>
            <button @click="showHelp = false" class="btn btn-secondary">Close</button>
        </template>
    </app-modal>

    <!-- 1. match the names in the file to registered S.A.s -->
    <app-modal :open="stage === 'map'" title="Who is in this file?" icon="UserCheck" size="lg" @close="close" :description="fileName">
        <p class="text-body text-muted">
            {{ people.length }} S.A.(s) with class hours were found. Choose the matching record for each name —
            the closest match is already selected. Anything left on <span class="font-medium text-ink">Skip</span> is not imported.
        </p>

        <div v-if="!saList.length" class="mt-4 flex items-start gap-2 rounded-lg bg-danger/5 px-3.5 py-3 text-body text-danger">
            <app-icon name="CircleX" :size="18" class="mt-0.5 shrink-0" />
            No active S.A. is registered yet. Register them in S.A. Management first.
        </div>

        <ul v-else class="mt-4 max-h-[46vh] divide-y divide-line overflow-auto rounded-lg border border-line">
            <li v-for="p in people" :key="p.name" class="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:gap-4">
                <div class="min-w-0 flex-1">
                    <p class="truncate text-body font-semibold text-ink">{{ p.name }}</p>
                    <p class="text-caption text-muted">
                        <span v-if="p.locations.length">{{ p.locations.join(', ') }} · </span>
                        {{ p.blocks.length }} class block(s), {{ p.classHours }} h
                        <span v-if="p.dutyHours"> · {{ p.dutyHours }} h of duty asked for</span>
                    </p>
                </div>
                <div class="sm:w-72">
                    <label class="sr-only" :for="'map-' + p.name">Registered S.A. for {{ p.name }}</label>
                    <select :id="'map-' + p.name" v-model="mapping[p.name]" class="input"
                            :class="mapping[p.name] && (duplicateIds.has(mapping[p.name]) || isMismatch(p)) ? 'input-error' : ''">
                        <option value="">Skip this name</option>
                        <option v-for="sa in saList" :key="sa.id" :value="String(sa.id)">{{ sa.name }} — {{ sa.studentId }}</option>
                    </select>
                    <p v-if="mapping[p.name] && isMismatch(p)" class="mt-1 flex items-start gap-1.5 text-caption text-danger">
                        <app-icon name="TriangleAlert" :size="13" class="mt-0.5 shrink-0" />
                        This is not the name written in the file.
                    </p>
                </div>
            </li>
        </ul>

        <p v-if="duplicateIds.size" class="mt-3 flex items-start gap-2 text-body text-danger" role="alert">
            <app-icon name="CircleX" :size="16" class="mt-0.5 shrink-0" />
            The same S.A. is chosen for more than one name. Each record can be picked once.
        </p>
        <ul v-if="warnings.length" class="mt-3 space-y-1.5">
            <li v-for="w in warnings" :key="w" class="flex items-start gap-2 text-caption text-warning">
                <app-icon name="TriangleAlert" :size="14" class="mt-0.5 shrink-0" /> {{ w }}
            </li>
        </ul>
        <p v-if="error" class="mt-3 flex items-start gap-2 text-body text-danger" role="alert">
            <app-icon name="CircleX" :size="16" class="mt-0.5 shrink-0" /> {{ error }}
        </p>

        <template #footer>
            <button @click="close" class="btn btn-secondary">Cancel</button>
            <button @click="toPreview" :disabled="busy || !matched.length || duplicateIds.size > 0" class="btn btn-primary">
                <app-icon :name="busy ? 'LoaderCircle' : 'ArrowRight'" :size="16" :class="busy ? 'animate-spin' : ''" />
                Check {{ matched.length }} S.A.(s)
            </button>
        </template>
    </app-modal>

    <!-- 2. the usual import preview -->
    <app-modal :open="stage === 'preview'" title="Import class hours" icon="FileSpreadsheet" size="lg" @close="close" :description="fileName">
        <template v-if="preview">
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div v-for="tile in [
                        { label: 'Rows found', value: preview.summary.found, tone: 'text-ink' },
                        { label: 'Valid', value: preview.summary.valid, tone: 'text-success' },
                        { label: 'Warnings', value: preview.summary.warnings, tone: 'text-warning' },
                        { label: 'Errors', value: preview.summary.errors, tone: 'text-danger' }]"
                     :key="tile.label" class="rounded-lg border border-line px-3 py-2.5">
                    <p class="text-caption text-muted">{{ tile.label }}</p>
                    <p class="text-[20px] font-bold" :class="tile.tone">{{ tile.value }}</p>
                </div>
            </div>

            <p v-if="!preview.summary.valid" class="mt-4 flex items-start gap-2 rounded-lg bg-danger/5 px-3.5 py-3 text-body text-danger">
                <app-icon name="CircleX" :size="18" class="mt-0.5 shrink-0" />
                Nothing new can be imported from this file. Clear the existing rows first if you are re-importing a corrected form.
            </p>

            <div class="mt-4 max-h-[42vh] overflow-auto rounded-lg border border-line">
                <table class="w-full min-w-[720px] text-left text-[13px]">
                    <thead class="sticky top-0 bg-page text-caption font-semibold text-muted">
                        <tr>
                            <th class="px-3 py-2">Status</th>
                            <th class="px-3 py-2">S.A.</th>
                            <th class="px-3 py-2">Class hours</th>
                            <th class="px-3 py-2">Notes</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-line">
                        <tr v-for="row in preview.rows" :key="row._line">
                            <td class="whitespace-nowrap px-3 py-2">
                                <span class="inline-flex items-center gap-1 font-semibold" :class="statusStyles[row.status][0]">
                                    <app-icon :name="statusStyles[row.status][1]" :size="13" /> {{ statusStyles[row.status][2] }}
                                </span>
                            </td>
                            <td class="px-3 py-2 text-ink">
                                <span class="font-medium">{{ row.name || row.saName }}</span>
                                <span class="block text-caption text-muted">{{ row.studentId }}</span>
                            </td>
                            <td class="whitespace-nowrap px-3 py-2 text-ink">
                                {{ dayNames[row.day] || row.day }} {{ row.startLabel }}–{{ row.endLabel }}
                            </td>
                            <td class="px-3 py-2 text-muted">{{ row.message || '—' }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <p v-if="error" class="mt-3 flex items-start gap-2 text-body text-danger" role="alert">
                <app-icon name="CircleX" :size="16" class="mt-0.5 shrink-0" /> {{ error }}
            </p>
        </template>

        <template #footer>
            <button @click="stage = 'map'" class="btn btn-secondary">Back</button>
            <button @click="confirmImport" :disabled="busy || !preview || !preview.summary.valid" class="btn btn-primary">
                <app-icon :name="busy ? 'LoaderCircle' : 'Check'" :size="16" :class="busy ? 'animate-spin' : ''" />
                {{ preview ? 'Import ' + preview.summary.valid + ' class row(s)' : 'Import' }}
            </button>
        </template>
    </app-modal>
    `
};
