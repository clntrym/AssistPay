const RegistrarPendingReviewPage = {
    components: { AppIcon, PageHeader, AppModal },

    setup() {
        const pending       = Vue.ref([]);
        const loading       = Vue.ref(false);
        const selected      = Vue.ref(null);
        const detail        = Vue.ref(null);
        const detailLoading = Vue.ref(false);
        const saving        = Vue.ref(false);
        const previewOpen   = Vue.ref(false);

        // OCR state
        const ocr = Vue.reactive({
            running:  false,
            progress: 0,       // 0-1
            status:   '',
            error:    '',
            filled:   false    // true after a successful read that pre-filled the form
        });

        // Curriculum lookup
        const curriculumSubjects = Vue.ref([]);
        const subjectByCode = Vue.computed(() => {
            const map = {};
            curriculumSubjects.value.forEach(s => {
                map[s.subject_code.toUpperCase()] = s;
            });
            return map;
        });

        // Form state
        const form = Vue.reactive({
            referenceNo: '',
            schoolYear:  '',
            semester:    '1st Semester',
            subjects:    [],
            fees: {
                tuition_fee: '', lab_fee: '', misc_fee: '',
                lms_fee: '', nstp_fee: '', omr_fee: '',
                installment_charge: ''
            }
        });

        const cashTotal = Vue.computed(() => {
            const f = form.fees;
            return ['tuition_fee','lab_fee','misc_fee','lms_fee','nstp_fee','omr_fee']
                .reduce((s, k) => s + (parseFloat(f[k]) || 0), 0);
        });
        const installmentTotal = Vue.computed(() =>
            cashTotal.value + (parseFloat(form.fees.installment_charge) || 0)
        );

        const peso = v => '₱' + parseFloat(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 });

        const fetchPending = async () => {
            loading.value = true;
            const r = await Model.request('students/pending_review', 'list_pending');
            loading.value = false;
            if (r.success) pending.value = r.docs;
        };

        Vue.onMounted(fetchPending);

        const blankSubject = () => ({
            code: '', description: '', units: '3', type: 'Lec',
            days: '', start_time: '08:00', end_time: '09:00',
            section: '', room: '', instructor: ''
        });

        // Fill subject details from curriculum when code is entered
        const fillFromCurriculum = (subject) => {
            const key = (subject.code || '').toUpperCase().trim();
            const found = subjectByCode.value[key];
            if (found && key.length >= 5) {  // Only fill if code looks complete (e.g., "IT 301")
                // Replace description — curriculum is the source of truth
                subject.description = found.description;
                // Replace units if not manually edited (default is '3')
                if (!subject.units || subject.units === '3') {
                    subject.units = String(found.units);
                }
            }
        };

        const corUrl = () => selected.value ? `api/students/cor_doc.php?id=${selected.value.id}` : '';

        // ── OCR ───────────────────────────────────────────────────────────────
        const runOcr = async () => {
            if (!selected.value) return;
            ocr.running  = true;
            ocr.progress = 0;
            ocr.status   = 'Fetching image…';
            ocr.error    = '';
            ocr.filled   = false;

            try {
                // Fetch the image through the auth-gated PHP endpoint
                const resp = await fetch(corUrl(), { credentials: 'same-origin' });
                if (!resp.ok) throw new Error(`Could not load image (HTTP ${resp.status}).`);
                const blob = await resp.blob();
                const file = new File([blob], selected.value.file_name || 'cor.jpg', { type: blob.type });

                ocr.status = 'Starting text reader…';

                const data = await CorEnrollment.read(file, m => {
                    ocr.status   = m.status || '';
                    ocr.progress = m.progress || 0;
                });

                // ── Pre-fill form ────────────────────────────────────────────
                if (data.referenceNo) form.referenceNo = data.referenceNo;
                if (data.schoolYear)  form.schoolYear  = data.schoolYear;
                if (data.semester)    form.semester    = data.semester;

                if (data.subjects && data.subjects.length) {
                    form.subjects = data.subjects.map(s => ({ ...blankSubject(), ...s }));
                }

                const feeKeys = ['tuition_fee','lab_fee','misc_fee','lms_fee','nstp_fee','omr_fee','installment_charge'];
                feeKeys.forEach(k => {
                    if (data.fees && data.fees[k]) form.fees[k] = data.fees[k];
                });

                ocr.filled   = true;
                ocr.progress = 1;
                ocr.status   = 'Done';
            } catch (e) {
                ocr.error  = e.message || 'The image could not be read. Fill in the form manually.';
                ocr.status = '';
            } finally {
                ocr.running = false;
            }
        };

        // ── Select a pending doc ─────────────────────────────────────────────
        const selectDoc = async doc => {
            selected.value  = doc;
            detail.value    = null;
            previewOpen.value = false;

            // Reset form & OCR state
            form.referenceNo = '';
            form.schoolYear  = '';
            form.semester    = '1st Semester';
            form.subjects    = [blankSubject()];
            Object.keys(form.fees).forEach(k => { form.fees[k] = ''; });
            ocr.running = false; ocr.progress = 0;
            ocr.status  = ''; ocr.error = ''; ocr.filled = false;

            detailLoading.value = true;
            const r = await Model.request('students/pending_review', 'get_detail', { id: doc.id });
            detailLoading.value = false;

            if (r.success) {
                detail.value = r;
                // Load curriculum subjects for code lookups
                curriculumSubjects.value = r.subjects || [];
                // Seed school year from active term while OCR runs in parallel
                const activeTerm = r.terms.find(t => t.is_active);
                if (activeTerm) {
                    form.schoolYear = activeTerm.school_year;
                    form.semester   = activeTerm.semester;
                }
                // Auto-start OCR (no await — runs alongside the visible form)
                runOcr();
            }
        };

        const addSubject    = ()  => form.subjects.push(blankSubject());
        const removeSubject = i  => form.subjects.splice(i, 1);

        const approve = async () => {
            if (!detail.value) return;
            if (!form.referenceNo.trim()) { await Alerts.error('Missing field', 'Reference number is required.'); return; }
            if (!form.schoolYear.trim())  { await Alerts.error('Missing field', 'School year is required.'); return; }

            const validSubs = form.subjects.filter(s => s.code.trim() || s.description.trim());
            const ok = await Alerts.confirm({
                title: 'Approve this COR?',
                html: `Enrollment record will be created for <b class="text-ink">${Alerts.esc(detail.value.doc.student_name)}</b>
                       (${Alerts.esc(form.semester)} ${Alerts.esc(form.schoolYear)})
                       with <b class="text-ink">${validSubs.length}</b> subject(s).`,
                confirmText: 'Approve', icon: 'question'
            });
            if (!ok) return;

            saving.value = true;
            const r = await Model.request('students/pending_review', 'approve', {
                corId:       selected.value.id,
                studentId:   detail.value.doc.student_id,
                referenceNo: form.referenceNo.trim(),
                schoolYear:  form.schoolYear.trim(),
                semester:    form.semester,
                subjects:    validSubs,
                fees:        form.fees
            });
            saving.value = false;

            if (r.success) {
                Store.toast('success', 'COR approved — enrollment record saved.');
                pending.value = pending.value.filter(d => d.id !== selected.value.id);
                selected.value = null;
                detail.value   = null;
            } else {
                Alerts.error('Could not approve', r.message);
            }
        };

        const reject = async () => {
            const ok = await Alerts.confirm({
                title: 'Reject this COR?',
                html: 'The document will be marked as rejected and removed from the review queue.',
                icon: 'warning', danger: true, confirmText: 'Reject', cancelText: 'Cancel'
            });
            if (!ok) return;

            saving.value = true;
            const r = await Model.request('students/pending_review', 'reject', { corId: selected.value.id });
            saving.value = false;

            if (r.success) {
                Store.toast('warning', 'COR rejected.');
                pending.value = pending.value.filter(d => d.id !== selected.value.id);
                selected.value = null;
                detail.value   = null;
            } else {
                Alerts.error('Could not reject', r.message);
            }
        };

        const fmtSize = bytes => {
            const n = parseInt(bytes) || 0;
            return n < 1024 * 1024 ? (n / 1024).toFixed(1) + ' KB' : (n / (1024 * 1024)).toFixed(1) + ' MB';
        };

        const SEMESTERS = ['1st Semester', '2nd Semester', 'Summer'];
        const TYPES     = ['Lec', 'Lab', 'Lec/Lab'];

        return {
            pending, loading, selected, detail, detailLoading, saving, previewOpen,
            ocr, form, cashTotal, installmentTotal,
            fetchPending, selectDoc, addSubject, removeSubject, runOcr, fillFromCurriculum,
            corUrl, approve, reject, fmtSize, peso, SEMESTERS, TYPES
        };
    },

    template: `
    <div>
        <page-header title="Pending Review" subtitle="Review uploaded CORs and confirm enrollment details before saving to student records." section="Documents" />

        <div class="grid gap-6 lg:grid-cols-[300px_1fr]">

            <!-- Pending list -->
            <div class="card flex flex-col">
                <div class="border-b border-line px-4 py-3 flex items-center gap-2">
                    <app-icon name="Clock" :size="16" class="text-warning" />
                    <h2 class="text-[13px] font-semibold text-ink">For Review</h2>
                    <span class="ml-auto rounded-full bg-warning/20 px-2 py-0.5 text-[11px] font-bold text-warning">
                        {{ pending.length }}
                    </span>
                </div>

                <div v-if="loading" class="flex items-center justify-center py-10 text-muted">
                    <app-icon name="LoaderCircle" :size="20" class="animate-spin" />
                </div>

                <ul v-else-if="pending.length" class="divide-y divide-line overflow-y-auto" style="max-height:calc(100vh - 220px)">
                    <li v-for="doc in pending" :key="doc.id">
                        <button @click="selectDoc(doc)"
                                class="w-full px-4 py-3 text-left transition-colors hover:bg-mist"
                                :class="selected?.id === doc.id ? 'bg-navy/[0.06]' : ''">
                            <p class="truncate text-[13px] font-semibold text-ink leading-snug">{{ doc.student_name }}</p>
                            <p class="truncate text-caption text-muted">{{ doc.student_number }}</p>
                            <p class="mt-0.5 text-caption text-disabled">{{ doc.uploaded_at }}</p>
                        </button>
                    </li>
                </ul>

                <div v-else class="flex flex-col items-center gap-2 py-12 text-center px-4">
                    <app-icon name="CircleCheck" :size="32" class="text-success opacity-60" />
                    <p class="text-caption text-muted">No CORs pending review.</p>
                </div>
            </div>

            <!-- Review panel -->
            <div>
                <div v-if="!selected" class="card flex flex-col items-center justify-center gap-3 py-24 text-center">
                    <span class="grid h-16 w-16 place-items-center rounded-2xl bg-mist text-navy">
                        <app-icon name="ClipboardCheck" :size="28" />
                    </span>
                    <p class="text-body font-semibold text-ink">Select a COR to review</p>
                    <p class="max-w-xs text-caption text-muted">Click a document on the left to see the COR image and fill in the enrollment details.</p>
                </div>

                <div v-else-if="detailLoading" class="card flex items-center justify-center py-24 text-muted">
                    <app-icon name="LoaderCircle" :size="24" class="animate-spin" />
                </div>

                <template v-else-if="detail">
                    <!-- Two-column: COR image | form -->
                    <div class="grid gap-4 xl:grid-cols-2">

                        <!-- COR image -->
                        <div class="card overflow-hidden flex flex-col">
                            <div class="border-b border-line px-4 py-2.5 flex items-center justify-between">
                                <div class="flex items-center gap-2">
                                    <app-icon name="FileImage" :size="15" class="text-navy" />
                                    <span class="text-[13px] font-semibold text-ink truncate max-w-[180px]">{{ selected.file_name }}</span>
                                </div>
                                <button @click="previewOpen = true"
                                        class="grid h-7 w-7 place-items-center rounded-md text-muted hover:text-ink hover:bg-mist transition-colors"
                                        title="Full screen">
                                    <app-icon name="Maximize2" :size="14" />
                                </button>
                            </div>

                            <div class="overflow-y-auto bg-page flex-1" style="max-height:calc(100vh - 260px)">
                                <img :src="corUrl()" :alt="selected.file_name" class="w-full object-contain">
                            </div>

                            <!-- OCR status bar -->
                            <div class="border-t border-line px-4 py-2.5">
                                <!-- Running -->
                                <template v-if="ocr.running">
                                    <div class="flex items-center gap-2 mb-1.5">
                                        <app-icon name="ScanText" :size="13" class="text-navy shrink-0" />
                                        <span class="text-caption text-navy font-medium truncate flex-1">{{ ocr.status || 'Reading COR…' }}</span>
                                        <span class="text-caption text-muted shrink-0">{{ Math.round(ocr.progress * 100) }}%</span>
                                    </div>
                                    <div class="h-1.5 rounded-full bg-mist overflow-hidden">
                                        <div class="h-full rounded-full bg-navy transition-all duration-200"
                                             :style="{ width: (ocr.progress * 100) + '%' }"></div>
                                    </div>
                                </template>

                                <!-- Error -->
                                <template v-else-if="ocr.error">
                                    <div class="flex items-start gap-2">
                                        <app-icon name="AlertCircle" :size="13" class="text-danger mt-0.5 shrink-0" />
                                        <span class="text-caption text-danger flex-1">{{ ocr.error }}</span>
                                        <button @click="runOcr"
                                                class="shrink-0 text-caption text-navy underline hover:no-underline">
                                            Try again
                                        </button>
                                    </div>
                                </template>

                                <!-- Success -->
                                <template v-else-if="ocr.filled">
                                    <div class="flex items-center gap-2">
                                        <app-icon name="CircleCheck" :size="13" class="text-success shrink-0" />
                                        <span class="text-caption text-success font-medium flex-1">Form auto-filled from COR image.</span>
                                        <button @click="runOcr"
                                                class="shrink-0 flex items-center gap-1 text-caption text-navy hover:underline">
                                            <app-icon name="RefreshCw" :size="11" /> Re-read
                                        </button>
                                    </div>
                                </template>

                                <!-- Idle (not yet run or user navigated away mid-ocr) -->
                                <template v-else>
                                    <button @click="runOcr"
                                            class="flex items-center gap-1.5 text-caption text-navy hover:underline">
                                        <app-icon name="ScanText" :size="13" /> Read details from image
                                    </button>
                                </template>
                            </div>
                        </div>

                        <!-- Review form -->
                        <div class="space-y-4 overflow-y-auto" style="max-height:calc(100vh - 160px)">

                            <!-- Overlay while OCR is running the first time -->
                            <div v-if="ocr.running && !ocr.filled"
                                 class="rounded-xl border border-navy/20 bg-navy/[0.03] px-4 py-3 flex items-center gap-3">
                                <app-icon name="ScanText" :size="18" class="text-navy shrink-0 animate-pulse" />
                                <div class="flex-1 min-w-0">
                                    <p class="text-[13px] font-semibold text-navy">Reading COR image…</p>
                                    <p class="text-caption text-muted truncate">{{ ocr.status }}</p>
                                </div>
                                <span class="text-[13px] font-bold text-navy">{{ Math.round(ocr.progress * 100) }}%</span>
                            </div>

                            <!-- Student & term info -->
                            <div class="card px-4 py-4 space-y-3">
                                <h3 class="text-[13px] font-semibold text-ink flex items-center gap-2">
                                    <app-icon name="User" :size="14" class="text-navy" /> Student &amp; Enrollment Info
                                </h3>
                                <div class="grid grid-cols-2 gap-3">
                                    <div class="col-span-2">
                                        <p class="field-label">Student</p>
                                        <p class="input bg-page text-muted cursor-default">{{ detail.doc.student_name }} — {{ detail.doc.student_number }}</p>
                                    </div>
                                    <div class="col-span-2">
                                        <label class="field-label">Reference No. <span class="text-danger">*</span></label>
                                        <input v-model="form.referenceNo" class="input" placeholder="e.g. 237551">
                                    </div>
                                    <div>
                                        <label class="field-label">School Year <span class="text-danger">*</span></label>
                                        <input v-model="form.schoolYear" class="input" placeholder="e.g. 2026-2027">
                                    </div>
                                    <div>
                                        <label class="field-label">Semester <span class="text-danger">*</span></label>
                                        <select v-model="form.semester" class="input">
                                            <option v-for="s in SEMESTERS" :key="s" :value="s">{{ s }}</option>
                                        </select>
                                    </div>
                                </div>
                            </div>

                            <!-- Subjects table -->
                            <div class="card overflow-hidden">
                                <div class="border-b border-line px-4 py-2.5 flex items-center justify-between">
                                    <h3 class="text-[13px] font-semibold text-ink flex items-center gap-2">
                                        <app-icon name="BookOpen" :size="14" class="text-navy" /> Subjects
                                        <span v-if="form.subjects.length" class="rounded-full bg-navy/10 px-1.5 py-0.5 text-[11px] font-bold text-navy">
                                            {{ form.subjects.length }}
                                        </span>
                                    </h3>
                                    <button @click="addSubject" class="btn btn-secondary btn-sm">
                                        <app-icon name="Plus" :size="13" /> Add Row
                                    </button>
                                </div>
                                <div class="overflow-x-auto">
                                    <table class="w-full min-w-[700px] text-[12px]">
                                        <thead class="bg-page text-caption font-semibold text-muted">
                                            <tr>
                                                <th class="px-2 py-2 text-left">Code</th>
                                                <th class="px-2 py-2 text-left">Description</th>
                                                <th class="px-2 py-2 text-left">Units</th>
                                                <th class="px-2 py-2 text-left">Type</th>
                                                <th class="px-2 py-2 text-left">Days</th>
                                                <th class="px-2 py-2 text-left">Start</th>
                                                <th class="px-2 py-2 text-left">End</th>
                                                <th class="px-2 py-2 text-left">Section</th>
                                                <th class="px-2 py-2 text-left">Room</th>
                                                <th class="px-2 py-2 text-left">Instructor</th>
                                                <th class="px-2 py-2"></th>
                                            </tr>
                                        </thead>
                                        <tbody class="divide-y divide-line">
                                            <tr v-for="(row, i) in form.subjects" :key="i">
                                                <td class="px-1 py-1"><input v-model="row.code" @input="fillFromCurriculum(row)" class="input px-2 py-1.5 w-20 uppercase" placeholder="IT 302" style="text-transform: uppercase;"></td>
                                                <td class="px-1 py-1"><input v-model="row.description" class="input px-2 py-1.5 w-36" placeholder="Subject name"></td>
                                                <td class="px-1 py-1"><input v-model="row.units" type="number" min="0.5" max="6" step="0.5" class="input px-2 py-1.5 w-14"></td>
                                                <td class="px-1 py-1">
                                                    <select v-model="row.type" class="input px-2 py-1.5 w-20">
                                                        <option v-for="t in TYPES" :key="t" :value="t">{{ t }}</option>
                                                    </select>
                                                </td>
                                                <td class="px-1 py-1"><input v-model="row.days" @input="row.days = row.days.toUpperCase()" class="input px-2 py-1.5 w-16 uppercase" placeholder="MWF"></td>
                                                <td class="px-1 py-1"><input v-model="row.start_time" type="time" class="input px-2 py-1.5 w-24"></td>
                                                <td class="px-1 py-1"><input v-model="row.end_time" type="time" class="input px-2 py-1.5 w-24"></td>
                                                <td class="px-1 py-1"><input v-model="row.section" class="input px-2 py-1.5 w-24" placeholder="BSIT-31E1"></td>
                                                <td class="px-1 py-1"><input v-model="row.room" class="input px-2 py-1.5 w-16" placeholder="1108"></td>
                                                <td class="px-1 py-1"><input v-model="row.instructor" class="input px-2 py-1.5 w-32" placeholder="Last, First"></td>
                                                <td class="px-1 py-1">
                                                    <button @click="removeSubject(i)"
                                                            class="grid h-7 w-7 place-items-center rounded text-muted hover:text-danger hover:bg-danger/5"
                                                            :aria-label="'Remove row ' + (i+1)">
                                                        <app-icon name="Trash2" :size="13" />
                                                    </button>
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <!-- Fee assessment -->
                            <div class="card px-4 py-4">
                                <h3 class="mb-3 text-[13px] font-semibold text-ink flex items-center gap-2">
                                    <app-icon name="Banknote" :size="14" class="text-navy" /> Fee Assessment
                                </h3>
                                <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
                                    <div v-for="[key, label] in [['tuition_fee','Tuition Fee'],['lab_fee','Laboratory Fee'],['misc_fee','Miscellaneous'],['lms_fee','LMS'],['nstp_fee','NSTP/ROTC'],['omr_fee','OMR']]" :key="key">
                                        <label class="field-label">{{ label }}</label>
                                        <input v-model="form.fees[key]" type="number" min="0" step="0.01" class="input" placeholder="0.00">
                                    </div>
                                    <div class="col-span-2 sm:col-span-3 border-t border-line pt-3 mt-1 grid grid-cols-2 gap-3 sm:grid-cols-3">
                                        <div>
                                            <p class="field-label">Cash Total</p>
                                            <p class="input bg-page text-muted cursor-default font-semibold">{{ peso(cashTotal) }}</p>
                                        </div>
                                        <div>
                                            <label class="field-label">Installment Charge</label>
                                            <input v-model="form.fees.installment_charge" type="number" min="0" step="0.01" class="input" placeholder="0.00">
                                        </div>
                                        <div>
                                            <p class="field-label">Installment Total</p>
                                            <p class="input bg-page text-muted cursor-default font-semibold">{{ peso(installmentTotal) }}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Action buttons -->
                            <div class="flex flex-wrap gap-3 pb-4">
                                <button @click="reject" :disabled="saving" class="btn btn-danger">
                                    <app-icon :name="saving ? 'LoaderCircle' : 'X'" :size="15" :class="saving ? 'animate-spin' : ''" />
                                    Reject
                                </button>
                                <button @click="approve" :disabled="saving || ocr.running" class="btn btn-primary ml-auto">
                                    <app-icon :name="saving ? 'LoaderCircle' : 'CircleCheck'" :size="15" :class="saving ? 'animate-spin' : ''" />
                                    {{ saving ? 'Saving…' : 'Approve & Save to Records' }}
                                </button>
                            </div>
                        </div>
                    </div>
                </template>
            </div>
        </div>

        <!-- Full-screen COR preview -->
        <app-modal :open="previewOpen" size="xl" icon="FileImage"
                   :title="selected?.file_name || 'Certificate of Registration'"
                   @close="previewOpen = false">
            <div class="overflow-auto rounded-lg border border-line bg-page">
                <img v-if="selected" :src="corUrl()" :alt="selected.file_name" class="mx-auto block w-full object-contain">
            </div>
            <template #footer>
                <a v-if="selected" :href="corUrl()" target="_blank" rel="noopener" class="btn btn-secondary">
                    <app-icon name="ExternalLink" :size="14" /> Open in tab
                </a>
                <button @click="previewOpen = false" class="btn btn-primary">Close</button>
            </template>
        </app-modal>
    </div>
    `
};
