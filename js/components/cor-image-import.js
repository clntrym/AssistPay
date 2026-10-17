// Imports a class schedule from a photo of the Certificate of Registration.
//
// Reading a picture is never exact, so nothing is saved from the reading alone:
// the picture and the rows sit side by side, every field can be corrected, rows
// can be added or dropped, and a day that could not be read has to be chosen
// before the import is allowed.
//
// The COR also says whose it is — a student number and a name — and that is
// checked against the S.A. the Coordinator picked, so one student's schedule
// cannot quietly land on another's record.
//
// <cor-image-import :semester-id="semester.id" :students="students" @imported="load" />
const CorImageImport = {
    components: { AppIcon, AppModal },
    props: {
        semesterId: Number,
        students: { type: Array, default: () => [] }    // active S.A.s
    },
    emits: ["imported"],

    setup(props, { emit }) {
        const fileInput = Vue.ref(null);
        const dragging = Vue.ref(false);
        const busy = Vue.ref(false);
        const progress = Vue.reactive({ status: "", value: 0 });
        const error = Vue.ref("");

        const review = Vue.ref(null);   // { fileName, imageUrl, studentNumber, saId, rows, warnings }
        const dayNames = { MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday", SUN: "Sunday" };

        const pick = () => fileInput.value?.click();

        const handleFile = async file => {
            error.value = "";
            if (!file) return;
            if (!/\.(png|jpe?g|webp)$/i.test(file.name)) {
                error.value = "Choose a photo or screenshot (.jpg, .png or .webp) of the COR.";
                if (fileInput.value) fileInput.value.value = "";
                return;
            }
            if (file.size > 12 * 1024 * 1024) {
                error.value = "That image is larger than 12 MB. Take the photo again at a smaller size.";
                if (fileInput.value) fileInput.value.value = "";
                return;
            }

            busy.value = true;
            progress.status = "starting";
            progress.value = 0;
            try {
                const read = await CorImage.read(file, m => {
                    progress.status = m.status || "";
                    progress.value = Math.round((m.progress || 0) * 100);
                });
                const byNumber = props.students.find(s => s.studentId.replace(/\s/g, "") === read.studentNumber);
                const byName = byNumber || props.students.find(s => sameName(s.name, read.studentName));
                review.value = {
                    fileName: file.name,
                    imageUrl: URL.createObjectURL(file),
                    studentNumber: read.studentNumber,
                    studentName: read.studentName,
                    saId: byName ? String(byName.id) : "",
                    rows: read.rows.map(r => ({ ...r, note: "" })),
                    warnings: read.warnings
                };
            } catch (e) {
                error.value = e.message || "That image could not be read.";
            } finally {
                busy.value = false;
                if (fileInput.value) fileInput.value.value = "";
            }
        };

        const onDrop = e => { dragging.value = false; handleFile(e.dataTransfer?.files?.[0]); };

        const addRow = () => review.value.rows.push({ day: "", startTime: "08:00", endTime: "09:00", subject: "", section: "", note: "" });
        const removeRow = i => review.value.rows.splice(i, 1);

        const chosen = Vue.computed(() => props.students.find(s => String(s.id) === String(review.value?.saId)) || null);

        const tokens = name => String(name || "").toUpperCase().replace(/[^A-Z\u00C0-\u024F ]/g, " ")
            .split(/\s+/).filter(t => t.length > 1);
        /** Same person, whichever way round the COR prints the name. */
        const sameName = (a, b) => {
            const left = tokens(a), right = tokens(b);
            if (!left.length || !right.length) return false;
            return left.every(t => right.includes(t)) || right.every(t => left.includes(t));
        };

        /**
         * Does the COR belong to the S.A. that is about to receive it? The
         * student number decides when it was read; otherwise the name does.
         */
        const identity = Vue.computed(() => {
            const state = review.value;
            const sa = chosen.value;
            if (!state || !sa) return { status: "NONE" };
            const number = state.studentNumber;
            const name = state.studentName;
            if (number && sa.studentId.replace(/\s/g, "") === number) return { status: "MATCH", by: "student number" };
            if (!number && name && sameName(sa.name, name)) return { status: "MATCH", by: "name" };
            if (number || name) {
                return { status: "MISMATCH",
                         says: [number, name].filter(Boolean).join(" \u2014 ") };
            }
            return { status: "UNKNOWN" };
        });
        const incomplete = Vue.computed(() => (review.value?.rows || [])
            .filter(r => !r.day || !r.startTime || !r.endTime || !r.subject.trim() || r.endTime <= r.startTime).length);

        const close = () => {
            if (review.value?.imageUrl) URL.revokeObjectURL(review.value.imageUrl);
            review.value = null;
            error.value = "";
        };

        const save = async () => {
            const state = review.value;
            error.value = "";
            state.rows.forEach(r => { r.note = ""; });

            if (!chosen.value) { error.value = "Choose which S.A. this Certificate of Registration belongs to."; return; }
            let bad = 0;
            state.rows.forEach(r => {
                if (!r.day) { r.note = "Choose the day."; bad++; }
                else if (!r.subject.trim()) { r.note = "Enter the subject."; bad++; }
                else if (!r.startTime || !r.endTime || r.endTime <= r.startTime) { r.note = "Check the time."; bad++; }
            });
            if (bad) {
                error.value = bad === 1 ? "1 row still needs attention." : `${bad} rows still need attention.`;
                return;
            }

            const rows = state.rows.map((r, i) => ({
                _line: i + 1, studentId: chosen.value.studentId, day: r.day,
                startTime: r.startTime, endTime: r.endTime, subject: r.subject.trim(), section: r.section.trim()
            }));

            busy.value = true;
            const preview = await Model.request("scheduling", "class_preview", { rows, semesterId: props.semesterId });
            busy.value = false;
            if (!preview.success) { Alerts.error("Couldn't check the rows", preview.message); return; }

            preview.rows.forEach((row, i) => {
                if (row.status !== "VALID" && state.rows[i]) state.rows[i].note = row.message;
            });
            if (!preview.summary.valid) {
                error.value = "None of these rows can be imported. Fix the notes on the right and try again.";
                return;
            }

            if (identity.value.status === "MISMATCH") {
                const proceed = await Alerts.confirm({
                    title: "This COR belongs to someone else",
                    html: `The Certificate of Registration says <b class="text-ink">${Alerts.esc(identity.value.says)}</b>, `
                        + `but you chose <b class="text-ink">${Alerts.esc(chosen.value.name)}</b> (${Alerts.esc(chosen.value.studentId)}).<br>`
                        + `<span class="text-caption">Saving it here gives that S.A. a schedule that is not theirs, and matching `
                        + `will keep the wrong hours free.</span>`,
                    icon: "warning", danger: true, confirmText: "Save it anyway", cancelText: "Go back"
                });
                if (!proceed) return;
            }

            const ok = await Alerts.confirm({
                title: "Import this class schedule?",
                html: `<b class="text-ink">${Alerts.esc(chosen.value.name)}</b> (${Alerts.esc(chosen.value.studentId)})<br>`
                    + (identity.value.status === "MISMATCH"
                        ? `<span class="text-danger">The COR says ${Alerts.esc(identity.value.says)}.</span><br>` : "")
                    + `${preview.summary.valid} class period(s) will be saved.`
                    + (preview.summary.warnings ? `<br>${preview.summary.warnings} row(s) are already on record and will be skipped.` : "")
                    + (preview.summary.errors ? `<br>${preview.summary.errors} row(s) have a problem and will not be saved.` : "")
                    + `<br><span class="text-caption">Matching will keep these times free of duty.</span>`,
                confirmText: "Import schedule"
            });
            if (!ok) return;

            busy.value = true;
            const r = await Model.request("scheduling", "class_import", { rows, semesterId: props.semesterId });
            busy.value = false;
            if (!r.success) { Alerts.error("Couldn't import the schedule", r.message); return; }

            Store.toast("success", `${r.imported} class period(s) saved for ${chosen.value.name}.`);
            if (r.summary.warnings) Store.toast("warning", `${r.summary.warnings} row(s) were already on record.`, 6000);
            if (r.clashes?.length) {
                Store.toast("warning", `${r.clashes.length} duty period(s) now clash with a class schedule. `
                    + `Open Finalized Schedule to move the duty.`, 9000);
            }
            close();
            emit("imported", r);
        };

        return { fileInput, dragging, busy, progress, error, review, dayNames, chosen, incomplete, identity,
                 pick, handleFile, onDrop, addRow, removeRow, close, save };
    },

    template: `
    <div class="flex flex-wrap gap-2">
        <button @click="pick" :disabled="busy" class="btn btn-primary">
            <app-icon :name="busy ? 'LoaderCircle' : 'Camera'" :size="16" :class="busy ? 'animate-spin' : ''" />
            {{ busy ? 'Reading…' : 'Upload COR photo' }}
        </button>
        <input ref="fileInput" type="file" accept=".png,.jpg,.jpeg,.webp" class="sr-only"
               @change="handleFile($event.target.files[0])" aria-label="Certificate of Registration photo">
    </div>

    <div class="mt-4 rounded-xl border-2 border-dashed p-5 transition-colors duration-150"
         :class="dragging ? 'border-navy bg-mist' : 'border-line bg-white'"
         @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop">
        <div class="flex flex-col items-start gap-3 sm:flex-row sm:items-center">
            <span class="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-mist text-navy"><app-icon name="Camera" :size="20" /></span>
            <div class="flex-1">
                <p class="text-body font-medium text-ink">Drop a photo of the COR here, or use the button above.</p>
                <p class="mt-0.5 text-caption text-muted">
                    Reading a picture is never exact, so you check every row against the photo before it is saved.
                </p>
            </div>
        </div>

        <div v-if="busy" class="mt-3" aria-live="polite">
            <div class="h-1.5 overflow-hidden rounded-full bg-page">
                <div class="h-full rounded-full bg-navy transition-all duration-200" :style="{ width: progress.value + '%' }"></div>
            </div>
            <p class="mt-1.5 text-caption text-muted">{{ progress.status }} — {{ progress.value }}%</p>
        </div>

        <p v-if="error && !review" class="mt-3 flex items-start gap-2 text-body text-danger" role="alert">
            <app-icon name="CircleX" :size="16" class="mt-0.5 shrink-0" /> {{ error }}
        </p>
    </div>

    <!-- Check what was read -->
    <app-modal :open="!!review" size="xl" icon="ScanText" title="Check what was read" @close="close"
               description="Compare each row with the photo. Correct anything that came out wrong, add what is missing, then import.">
        <template v-if="review">
            <div class="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
                <div>
                    <a :href="review.imageUrl" target="_blank" rel="noopener"
                       class="block overflow-hidden rounded-lg border border-line" title="Open the photo in a new tab">
                        <img :src="review.imageUrl" :alt="'Certificate of Registration: ' + review.fileName"
                             class="max-h-[46vh] w-full object-contain bg-page">
                    </a>
                    <p class="mt-1.5 truncate text-caption text-muted">{{ review.fileName }}</p>

                    <label for="cor-sa" class="field-label mt-4">Student assistant <span class="text-danger">*</span></label>
                    <select id="cor-sa" v-model="review.saId" class="input" :class="{ 'input-error': !chosen }">
                        <option value="">Choose the S.A.</option>
                        <option v-for="sa in students" :key="sa.id" :value="String(sa.id)">{{ sa.name }} — {{ sa.studentId }}</option>
                    </select>
                    <p class="mt-1.5 text-caption text-muted">
                        <template v-if="review.studentNumber || review.studentName">
                            The COR says
                            <b class="font-semibold text-ink">{{ [review.studentNumber, review.studentName].filter(Boolean).join(' — ') }}</b>.
                        </template>
                        <template v-else>No student number or name could be read, so choose the S.A. yourself.</template>
                    </p>

                    <p v-if="identity.status === 'MATCH'" class="mt-1.5 flex items-start gap-1.5 text-caption text-success">
                        <app-icon name="CircleCheck" :size="14" class="mt-0.5 shrink-0" />
                        This is the S.A. named on the COR, matched by {{ identity.by }}.
                    </p>
                    <p v-else-if="identity.status === 'MISMATCH'" class="mt-1.5 flex items-start gap-1.5 text-caption text-danger" role="alert">
                        <app-icon name="TriangleAlert" :size="14" class="mt-0.5 shrink-0" />
                        This COR is not for the S.A. you chose. Check before importing — the schedule would land on the wrong record.
                    </p>
                    <p v-else-if="identity.status === 'UNKNOWN' && chosen" class="mt-1.5 flex items-start gap-1.5 text-caption text-warning">
                        <app-icon name="TriangleAlert" :size="14" class="mt-0.5 shrink-0" />
                        Nothing on the photo names a student, so nobody can check this for you.
                    </p>

                    <ul v-if="review.warnings.length" class="mt-3 space-y-1.5">
                        <li v-for="w in review.warnings" :key="w" class="flex items-start gap-2 text-caption text-warning">
                            <app-icon name="TriangleAlert" :size="14" class="mt-0.5 shrink-0" /> {{ w }}
                        </li>
                    </ul>
                </div>

                <div>
                    <div class="max-h-[46vh] overflow-auto rounded-lg border border-line">
                        <table class="w-full min-w-[560px] text-left text-[13px]">
                            <thead class="sticky top-0 z-10 bg-page text-caption font-semibold text-muted">
                                <tr>
                                    <th class="px-2 py-2">Day</th>
                                    <th class="px-2 py-2">Start</th>
                                    <th class="px-2 py-2">End</th>
                                    <th class="px-2 py-2">Subject</th>
                                    <th class="px-2 py-2">Section</th>
                                    <th class="px-2 py-2"><span class="sr-only">Remove</span></th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-line">
                                <tr v-for="(row, i) in review.rows" :key="i" :class="row.note ? 'bg-danger/[0.04]' : ''">
                                    <td class="px-2 py-1.5">
                                        <select v-model="row.day" class="input w-28 px-2 py-1.5"
                                                :class="{ 'input-error': !row.day }" :aria-label="'Day for row ' + (i + 1)">
                                            <option value="">Choose…</option>
                                            <option v-for="(name, code) in dayNames" :key="code" :value="code">{{ name }}</option>
                                        </select>
                                    </td>
                                    <td class="px-2 py-1.5">
                                        <input v-model="row.startTime" type="time" class="input w-28 px-2 py-1.5" :aria-label="'Start time for row ' + (i + 1)">
                                    </td>
                                    <td class="px-2 py-1.5">
                                        <input v-model="row.endTime" type="time" class="input w-28 px-2 py-1.5" :aria-label="'End time for row ' + (i + 1)">
                                    </td>
                                    <td class="px-2 py-1.5">
                                        <input v-model="row.subject" class="input w-28 px-2 py-1.5" maxlength="60" :aria-label="'Subject for row ' + (i + 1)">
                                    </td>
                                    <td class="px-2 py-1.5">
                                        <input v-model="row.section" class="input w-28 px-2 py-1.5" maxlength="40" :aria-label="'Section for row ' + (i + 1)">
                                    </td>
                                    <td class="px-2 py-1.5">
                                        <button @click="removeRow(i)" class="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-danger/5 hover:text-danger"
                                                :aria-label="'Remove row ' + (i + 1)"><app-icon name="Trash2" :size="15" /></button>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <ul v-if="review.rows.some(r => r.note)" class="mt-2 space-y-1">
                        <li v-for="(row, i) in review.rows.filter(r => r.note)" :key="'note' + i"
                            class="flex items-start gap-2 text-caption text-danger">
                            <app-icon name="CircleX" :size="13" class="mt-0.5 shrink-0" />
                            {{ row.subject || 'Row' }} {{ row.startTime }}–{{ row.endTime }}: {{ row.note }}
                        </li>
                    </ul>

                    <div class="mt-3 flex flex-wrap items-center gap-3">
                        <button @click="addRow" class="btn btn-secondary btn-sm">
                            <app-icon name="Plus" :size="15" /> Add row
                        </button>
                        <p class="text-caption" :class="incomplete ? 'text-danger' : 'text-muted'">
                            {{ review.rows.length }} row(s)<span v-if="incomplete">, {{ incomplete }} still to complete</span>
                        </p>
                    </div>

                    <p v-if="error" class="mt-3 flex items-start gap-2 text-body text-danger" role="alert">
                        <app-icon name="CircleX" :size="16" class="mt-0.5 shrink-0" /> {{ error }}
                    </p>
                </div>
            </div>
        </template>

        <template #footer>
            <button @click="close" class="btn btn-secondary">Cancel</button>
            <button @click="save" :disabled="busy || !review || !review.rows.length" class="btn btn-primary">
                <app-icon :name="busy ? 'LoaderCircle' : 'Check'" :size="16" :class="busy ? 'animate-spin' : ''" />
                Check and import
            </button>
        </template>
    </app-modal>
    `
};
