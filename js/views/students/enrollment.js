const RegistrarEnrollmentPage = {
    components: { AppIcon, PageHeader, AppModal },

    setup() {
        const students    = Vue.ref([]);
        const searchQuery = Vue.ref('');
        const loading     = Vue.ref(false);
        const selected    = Vue.ref(null);   // { student, enrollment }
        const detail      = Vue.ref(null);   // { enrollment, subjects, assessment, corDocs }
        const detailLoading = Vue.ref(false);
        const previewCor  = Vue.ref(null);
        const editing     = Vue.ref(false);
        const availableSchedules = Vue.ref([]);
        const addSearch   = Vue.ref('');
        const dropping    = Vue.ref(null);
        const adding      = Vue.ref(null);
        const editingFees = Vue.ref(false);
        const savingFees  = Vue.ref(false);
        const feeForm     = Vue.reactive({
            tuition_fee: 0,
            lab_fee: 0,
            misc_fee: 0,
            lms_fee: 0,
            nstp_fee: 0,
            omr_fee: 0,
            installment_charge: 0,
        });

        const fetchStudents = async () => {
            loading.value = true;
            const r = await Model.request('students/enrollment', 'list_enrolled');
            loading.value = false;
            if (r.success) students.value = r.students;
        };

        Vue.onMounted(fetchStudents);

        const filteredStudents = Vue.computed(() => {
            const q = searchQuery.value.trim().toLowerCase();
            if (!q) return students.value;
            return students.value.filter(s =>
                (s.student_number || '').toLowerCase().includes(q) ||
                (s.name || '').toLowerCase().includes(q) ||
                (s.reference_no || '').toLowerCase().includes(q)
            );
        });

        const selectStudent = async s => {
            selected.value = s;
            detail.value = null;
            editingFees.value = false;
            if (!s.enrollment_id) return;
            detailLoading.value = true;
            const r = await Model.request('students/enrollment', 'get_enrollment', { enrollmentId: s.enrollment_id });
            detailLoading.value = false;
            if (r.success) detail.value = r;
        };

        const startEditingFees = () => {
            const a = detail.value?.assessment || {};
            feeForm.tuition_fee = Number(parseFloat(a.tuition_fee || 0).toFixed(2));
            feeForm.lab_fee = Number(parseFloat(a.lab_fee || 0).toFixed(2));
            feeForm.misc_fee = Number(parseFloat(a.misc_fee || 0).toFixed(2));
            feeForm.lms_fee = Number(parseFloat(a.lms_fee || 0).toFixed(2));
            feeForm.nstp_fee = Number(parseFloat(a.nstp_fee || 0).toFixed(2));
            feeForm.omr_fee = Number(parseFloat(a.omr_fee || 0).toFixed(2));
            feeForm.installment_charge = Number(parseFloat(a.installment_charge || 0).toFixed(2));
            editingFees.value = true;
        };

        const cancelEditingFees = () => {
            editingFees.value = false;
        };

        const computedCashTotal = Vue.computed(() => {
            return (
                (parseFloat(feeForm.tuition_fee) || 0) +
                (parseFloat(feeForm.lab_fee) || 0) +
                (parseFloat(feeForm.misc_fee) || 0) +
                (parseFloat(feeForm.lms_fee) || 0) +
                (parseFloat(feeForm.nstp_fee) || 0) +
                (parseFloat(feeForm.omr_fee) || 0)
            );
        });

        const computedInstallmentTotal = Vue.computed(() => {
            return computedCashTotal.value + (parseFloat(feeForm.installment_charge) || 0);
        });

        const saveFees = async () => {
            if (!selected.value?.enrollment_id || savingFees.value) return;
            savingFees.value = true;
            const r = await Model.request('students/enrollment', 'update_fee_assessment', {
                enrollmentId: selected.value.enrollment_id,
                tuition_fee: feeForm.tuition_fee,
                lab_fee: feeForm.lab_fee,
                misc_fee: feeForm.misc_fee,
                lms_fee: feeForm.lms_fee,
                nstp_fee: feeForm.nstp_fee,
                omr_fee: feeForm.omr_fee,
                installment_charge: feeForm.installment_charge,
            });
            savingFees.value = false;
            if (r.success) {
                if (detail.value) {
                    detail.value.assessment = r.assessment;
                }
                editingFees.value = false;
                Store.toast('success', r.message || 'Tuition and Assessment of Fees updated.');
            } else {
                Alerts.error('Failed to update fees', r.message || 'Could not save fee assessment.');
            }
        };

        const corUrl = doc => `api/students/cor_doc.php?id=${doc.id}`;

        const fmtSize = bytes => {
            const n = parseInt(bytes) || 0;
            if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
            return (n / (1024 * 1024)).toFixed(1) + ' MB';
        };

        const peso = v => '₱' + parseFloat(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 });

        const statusClass = s => ({
            'Enrolled': 'bg-green-100 text-green-700 border-green-200',
            'Pending':  'bg-yellow-100 text-yellow-700 border-yellow-200',
            'Dropped':  'bg-red-100 text-red-700 border-red-200',
            'Cancelled':'bg-gray-100 text-gray-600 border-gray-200',
        }[s] || 'bg-gray-100 text-gray-600 border-gray-200');

        const startEditing = async () => {
            if (!selected.value?.enrollment_id) return;
            editing.value = true;
            addSearch.value = '';
            const r = await Model.request('students/enrollment', 'list_available_schedules', { enrollmentId: selected.value.enrollment_id });
            if (r.success) availableSchedules.value = r.schedules;
        };

        const stopEditing = () => { editing.value = false; };

        const dropSubject = async (s) => {
            if (!selected.value?.enrollment_id || !s.schedule_id) return;
            dropping.value = s.schedule_id;
            const r = await Model.request('students/enrollment', 'drop_subject', {
                enrollmentId: selected.value.enrollment_id, scheduleId: s.schedule_id
            });
            dropping.value = null;
            if (r.success) {
                Store.toast('success', `Dropped ${s.subject_code} ${s.type}`);
                await selectStudent(selected.value);
                const r2 = await Model.request('students/enrollment', 'list_available_schedules', { enrollmentId: selected.value.enrollment_id });
                if (r2.success) availableSchedules.value = r2.schedules;
            } else {
                Alerts.error('Failed to drop', r.message);
            }
        };

        const addSubject = async (s) => {
            if (!selected.value?.enrollment_id) return;
            adding.value = s.schedule_id;
            const r = await Model.request('students/enrollment', 'add_subject', {
                enrollmentId: selected.value.enrollment_id, scheduleId: s.schedule_id
            });
            adding.value = null;
            if (r.success) {
                Store.toast('success', `Added ${s.subject_code} ${s.type}`);
                await selectStudent(selected.value);
                const r2 = await Model.request('students/enrollment', 'list_available_schedules', { enrollmentId: selected.value.enrollment_id });
                if (r2.success) availableSchedules.value = r2.schedules;
            } else {
                Alerts.error('Failed to add', r.message);
            }
        };

        const filteredAvailable = Vue.computed(() => {
            const q = addSearch.value.trim().toLowerCase();
            if (!q) return availableSchedules.value;
            return availableSchedules.value.filter(s =>
                s.subject_code.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
            );
        });

        return {
            students, searchQuery, loading, selected, detail, detailLoading, previewCor,
            filteredStudents, selectStudent, corUrl, fmtSize, peso, statusClass,
            editing, startEditing, stopEditing, dropSubject, addSubject,
            availableSchedules, addSearch, filteredAvailable, dropping, adding,
            editingFees, savingFees, feeForm, startEditingFees, cancelEditingFees,
            computedCashTotal, computedInstallmentTotal, saveFees
        };
    },

    template: `
    <div>
        <page-header title="Enrollment" subtitle="View student enrollment records and attached Certificates of Registration." section="Academic Data" />

        <div class="grid gap-6 lg:grid-cols-[340px_1fr]">

            <!-- Student / enrollment list -->
            <div class="card flex flex-col">
                <div class="border-b border-line px-4 py-3">
                    <div class="relative">
                        <app-icon name="Search" :size="15" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                        <input v-model="searchQuery" type="search" placeholder="Name, ID, or reference no…"
                               class="input pl-9 py-2 text-[13px]" aria-label="Search">
                    </div>
                </div>

                <div v-if="loading" class="flex items-center justify-center py-10 text-muted">
                    <app-icon name="LoaderCircle" :size="22" class="animate-spin" />
                </div>

                <ul v-else-if="filteredStudents.length" class="divide-y divide-line overflow-y-auto"
                    style="max-height:calc(100vh - 240px)">
                    <li v-for="s in filteredStudents" :key="s.id + '-' + (s.enrollment_id || 0)">
                        <button @click="selectStudent(s)"
                                class="w-full px-4 py-3 text-left transition-colors hover:bg-mist"
                                :class="selected?.enrollment_id === s.enrollment_id && selected?.id === s.id ? 'bg-navy/[0.06]' : ''">
                            <div class="flex items-start justify-between gap-2">
                                <div class="min-w-0">
                                    <p class="truncate text-[13px] font-semibold text-ink leading-snug">{{ s.name }}</p>
                                    <p class="truncate text-caption text-muted">
                                        {{ s.student_number }}
                                        <span v-if="s.section" class="font-semibold text-navy"> · {{ s.section }}</span>
                                    </p>
                                    <p v-if="s.semester" class="mt-0.5 text-caption text-muted">
                                        {{ s.semester }} Sem · {{ s.school_year }}
                                    </p>
                                </div>
                                <div class="shrink-0 text-right">
                                    <span v-if="s.enrollment_status"
                                          class="inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                                          :class="statusClass(s.enrollment_status)">
                                        {{ s.enrollment_status }}
                                    </span>
                                    <p v-if="parseInt(s.cor_count)"
                                       class="mt-1 text-[11px] font-semibold text-navy">
                                        {{ s.cor_count }} COR
                                    </p>
                                </div>
                            </div>
                        </button>
                    </li>
                </ul>

                <p v-else class="py-10 text-center text-caption text-muted">No enrollment records found.</p>
            </div>

            <!-- Detail panel -->
            <div>
                <!-- Nothing selected -->
                <div v-if="!selected" class="card flex flex-col items-center justify-center gap-3 py-24 text-center">
                    <span class="grid h-16 w-16 place-items-center rounded-2xl bg-mist text-navy">
                        <app-icon name="FileSignature" :size="28" />
                    </span>
                    <p class="text-body font-semibold text-ink">Select a student</p>
                    <p class="max-w-xs text-caption text-muted">Click a student to view their enrollment details and Certificate of Registration.</p>
                </div>

                <!-- No enrollment record -->
                <div v-else-if="selected && !selected.enrollment_id" class="card flex flex-col items-center justify-center gap-3 py-24 text-center">
                    <app-icon name="FileX" :size="36" class="text-muted opacity-40" />
                    <p class="text-body font-semibold text-ink">{{ selected.name }}</p>
                    <p class="text-caption text-muted">No enrollment record on file for this student.</p>
                </div>

                <!-- Loading -->
                <div v-else-if="detailLoading" class="card flex items-center justify-center py-24 text-muted">
                    <app-icon name="LoaderCircle" :size="24" class="animate-spin" />
                </div>

                <!-- Enrollment detail -->
                <template v-else-if="detail">
                    <!-- Header card -->
                    <div class="card mb-4 px-4 py-3">
                        <div class="flex flex-wrap items-center justify-between gap-3">
                            <div class="flex items-center gap-3">
                                <span class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-navy/10 text-navy font-bold text-[16px]">
                                    {{ detail.enrollment.student_name.charAt(0).toUpperCase() }}
                                </span>
                                <div>
                                    <p class="font-semibold text-ink text-[15px]">{{ detail.enrollment.student_name }}</p>
                                    <p class="text-caption text-muted flex items-center gap-1.5 flex-wrap">
                                        <span>{{ detail.enrollment.student_number }}</span>
                                        <span>&middot;</span>
                                        <span class="font-semibold text-navy">{{ detail.enrollment.course }}</span>
                                        <span v-if="detail.enrollment.section || (detail.subjects[0] && detail.subjects[0].section_code)" class="inline-flex items-center px-2 py-0.5 rounded bg-navy/10 text-navy font-bold text-[11px]">
                                            Section: {{ detail.enrollment.section || detail.subjects[0].section_code }}
                                        </span>
                                    </p>
                                </div>
                            </div>
                            <div class="text-right">
                                <p class="text-caption text-muted">Ref. No.</p>
                                <p class="font-mono text-[13px] font-semibold text-ink">{{ detail.enrollment.reference_no }}</p>
                            </div>
                        </div>
                        <div class="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-caption text-muted border-t border-line pt-3">
                            <span><strong class="text-ink">Section:</strong>
                                <span class="ml-1 font-bold text-navy">
                                    {{ detail.enrollment.section || (detail.subjects[0] ? detail.subjects[0].section_code : '—') }}
                                </span>
                            </span>
                            <span><strong class="text-ink">Semester:</strong> {{ detail.enrollment.semester }} · {{ detail.enrollment.school_year }}</span>
                            <span><strong class="text-ink">Status:</strong>
                                <span class="ml-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                                      :class="statusClass(detail.enrollment.enrollment_status)">
                                    {{ detail.enrollment.enrollment_status }}
                                </span>
                            </span>
                            <span v-if="detail.enrollment.enrollment_date">
                                <strong class="text-ink">Date:</strong> {{ detail.enrollment.enrollment_date }}
                            </span>
                        </div>
                    </div>

                    <!-- Two columns: left = subjects + fees, right = COR -->
                    <div class="grid gap-4 xl:grid-cols-[1fr_400px]">

                        <!-- Left: subjects + fees -->
                        <div class="space-y-4">
                            <!-- Subjects table -->
                            <div class="card overflow-hidden">
                                <div class="border-b border-line px-4 py-3 flex items-center gap-2">
                                    <app-icon name="BookOpen" :size="16" class="text-navy" />
                                    <h2 class="text-[13px] font-semibold text-ink">Enrolled Subjects</h2>
                                    <span class="rounded-full bg-navy/10 px-2 py-0.5 text-[11px] font-bold text-navy">
                                        {{ detail.subjects.length }}
                                    </span>
                                    <div class="ml-auto flex items-center gap-2">
                                        <button v-if="!editing" @click="startEditing" class="btn btn-sm bg-navy text-white hover:bg-navy/90 px-3 py-1 text-[11px] rounded-lg flex items-center gap-1">
                                            <app-icon name="Pencil" :size="12" /> Edit
                                        </button>
                                        <button v-else @click="stopEditing" class="btn btn-sm bg-gray-200 text-ink hover:bg-gray-300 px-3 py-1 text-[11px] rounded-lg flex items-center gap-1">
                                            <app-icon name="X" :size="12" /> Done
                                        </button>
                                    </div>
                                </div>
                                <div class="overflow-x-auto">
                                    <table v-if="detail.subjects.length" class="w-full min-w-[560px] text-left text-[12px]">
                                        <thead class="bg-page text-caption font-semibold text-muted">
                                            <tr>
                                                <th class="px-3 py-2">Code</th>
                                                <th class="px-3 py-2">Description</th>
                                                <th class="px-3 py-2">Section</th>
                                                <th class="px-3 py-2">Units</th>
                                                <th class="px-3 py-2">Type</th>
                                                <th class="px-3 py-2">Days</th>
                                                <th class="px-3 py-2">Time</th>
                                                <th class="px-3 py-2">Room</th>
                                                <th v-if="editing" class="px-3 py-2 text-center">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody class="divide-y divide-line">
                                            <tr v-for="(s, i) in detail.subjects" :key="i" class="hover:bg-mist/50">
                                                <td class="px-3 py-2 font-mono font-semibold text-ink">{{ s.subject_code }}</td>
                                                <td class="px-3 py-2 text-ink">{{ s.description }}</td>
                                                <td class="px-3 py-2 font-semibold text-navy whitespace-nowrap">{{ s.section_code || detail.enrollment.section || '—' }}</td>
                                                <td class="px-3 py-2 text-center">{{ s.units }}</td>
                                                <td class="px-3 py-2">{{ s.type }}</td>
                                                <td class="px-3 py-2">{{ s.days }}</td>
                                                <td class="px-3 py-2 whitespace-nowrap">{{ s.start_time }} – {{ s.end_time }}</td>
                                                <td class="px-3 py-2">{{ s.room }}</td>
                                                <td v-if="editing" class="px-3 py-1 text-center">
                                                    <button @click="dropSubject(s)" :disabled="dropping === s.schedule_id" class="btn btn-sm bg-red-500 text-white hover:bg-red-600 px-2 py-0.5 text-[10px] rounded flex items-center gap-1 mx-auto">
                                                        <app-icon name="Trash2" :size="11" />
                                                        <span v-if="dropping === s.schedule_id">...</span>
                                                        <span v-else>Drop</span>
                                                    </button>
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                    <p v-else class="px-4 py-6 text-center text-caption text-muted">No subjects on record.</p>
                                </div>
                            </div>

                            <!-- Add Subject (edit mode) -->
                            <div v-if="editing" class="card overflow-hidden">
                                <div class="border-b border-line px-4 py-3 flex items-center gap-2">
                                    <app-icon name="Plus" :size="16" class="text-green-600" />
                                    <h2 class="text-[13px] font-semibold text-ink">Add Subject</h2>
                                    <span class="rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-bold text-green-700">
                                        {{ availableSchedules.length }} available
                                    </span>
                                </div>
                                <div class="px-4 py-2 border-b border-line">
                                    <input v-model="addSearch" type="search" placeholder="Search subject code or description..." class="input py-1.5 text-[12px]" />
                                </div>
                                <div class="overflow-x-auto max-h-[300px] overflow-y-auto">
                                    <table v-if="filteredAvailable.length" class="w-full min-w-[520px] text-left text-[12px]">
                                        <thead class="bg-page text-caption font-semibold text-muted sticky top-0">
                                            <tr>
                                                <th class="px-3 py-2">Code</th>
                                                <th class="px-3 py-2">Description</th>
                                                <th class="px-3 py-2">Section</th>
                                                <th class="px-3 py-2">Units</th>
                                                <th class="px-3 py-2">Type</th>
                                                <th class="px-3 py-2">Days</th>
                                                <th class="px-3 py-2">Time</th>
                                                <th class="px-3 py-2">Room</th>
                                                <th class="px-3 py-2 text-center">Action</th>
                                            </tr>
                                        </thead>
                                        <tbody class="divide-y divide-line">
                                            <tr v-for="s in filteredAvailable" :key="s.schedule_id" class="hover:bg-green-50/50">
                                                <td class="px-3 py-2 font-mono font-semibold text-ink">{{ s.subject_code }}</td>
                                                <td class="px-3 py-2 text-ink">{{ s.description }}</td>
                                                <td class="px-3 py-2 font-semibold text-navy whitespace-nowrap">{{ s.section_code || '—' }}</td>
                                                <td class="px-3 py-2 text-center">{{ s.units }}</td>
                                                <td class="px-3 py-2">{{ s.type }}</td>
                                                <td class="px-3 py-2">{{ s.days }}</td>
                                                <td class="px-3 py-2 whitespace-nowrap">{{ s.start_time }} – {{ s.end_time }}</td>
                                                <td class="px-3 py-2">{{ s.room }}</td>
                                                <td class="px-3 py-1 text-center">
                                                    <button @click="addSubject(s)" :disabled="adding === s.schedule_id" class="btn btn-sm bg-green-500 text-white hover:bg-green-600 px-2 py-0.5 text-[10px] rounded flex items-center gap-1 mx-auto">
                                                        <app-icon name="Plus" :size="11" />
                                                        <span v-if="adding === s.schedule_id">...</span>
                                                        <span v-else>Add</span>
                                                    </button>
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                    <p v-else class="px-4 py-6 text-center text-caption text-muted">No available subjects to add.</p>
                                </div>
                            </div>

                            <!-- Fee assessment -->
                            <div class="card overflow-hidden">
                                <div class="border-b border-line px-4 py-3 flex items-center gap-2">
                                    <app-icon name="Banknote" :size="16" class="text-navy" />
                                    <h2 class="text-[13px] font-semibold text-ink">Assessment of Fees</h2>
                                    <div class="ml-auto flex items-center gap-2">
                                        <button v-if="!editingFees" @click="startEditingFees"
                                                class="btn btn-sm bg-navy text-white hover:bg-navy/90 px-3 py-1 text-[11px] rounded-lg flex items-center gap-1">
                                            <app-icon name="Pencil" :size="12" /> Edit Fees
                                        </button>
                                        <template v-else>
                                            <button @click="saveFees" :disabled="savingFees"
                                                    class="btn btn-sm bg-navy text-white hover:bg-navy/90 px-3 py-1 text-[11px] rounded-lg flex items-center gap-1">
                                                <app-icon :name="savingFees ? 'LoaderCircle' : 'Check'" :size="12" :class="savingFees ? 'animate-spin' : ''" />
                                                {{ savingFees ? 'Saving...' : 'Save Fees' }}
                                            </button>
                                            <button @click="cancelEditingFees" :disabled="savingFees"
                                                    class="btn btn-sm bg-gray-200 text-ink hover:bg-gray-300 px-3 py-1 text-[11px] rounded-lg flex items-center gap-1">
                                                <app-icon name="X" :size="12" /> Cancel
                                            </button>
                                        </template>
                                    </div>
                                </div>

                                <!-- View Mode -->
                                <div v-if="!editingFees && detail.assessment" class="grid gap-0 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-line">
                                    <div class="px-4 py-3">
                                        <p class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Cash</p>
                                        <div class="space-y-1 text-[13px]">
                                            <div class="flex justify-between"><span class="text-muted">Tuition Fee</span><span>{{ peso(detail.assessment.tuition_fee) }}</span></div>
                                            <div class="flex justify-between"><span class="text-muted">Laboratory Fee</span><span>{{ peso(detail.assessment.lab_fee) }}</span></div>
                                            <div class="flex justify-between"><span class="text-muted">Miscellaneous</span><span>{{ peso(detail.assessment.misc_fee) }}</span></div>
                                            <div class="flex justify-between"><span class="text-muted">LMS</span><span>{{ peso(detail.assessment.lms_fee) }}</span></div>
                                            <div class="flex justify-between"><span class="text-muted">NSTP/ROTC</span><span>{{ peso(detail.assessment.nstp_fee) }}</span></div>
                                            <div class="flex justify-between"><span class="text-muted">OMR</span><span>{{ peso(detail.assessment.omr_fee) }}</span></div>
                                            <div class="flex justify-between border-t border-line pt-1 font-semibold text-ink">
                                                <span>Cash Total</span><span>{{ peso(detail.assessment.cash_total) }}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="px-4 py-3">
                                        <p class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Installment</p>
                                        <div class="space-y-1 text-[13px]">
                                            <div class="flex justify-between"><span class="text-muted">Installment Charge</span><span>{{ peso(detail.assessment.installment_charge) }}</span></div>
                                            <div class="flex justify-between border-t border-line pt-1 font-semibold text-ink">
                                                <span>Installment Total</span><span>{{ peso(detail.assessment.installment_total) }}</span>
                                            </div>
                                        </div>
                                        <p class="mt-3 text-caption text-muted">Installment charge does not apply to full-payment transactions.</p>
                                    </div>
                                </div>

                                <!-- Edit Mode -->
                                <form v-else-if="editingFees" @submit.prevent="saveFees" class="grid gap-0 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-line">
                                    <div class="px-4 py-3">
                                        <p class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Cash</p>
                                        <div class="space-y-2 text-[13px]">
                                            <div class="flex items-center justify-between gap-3">
                                                <label class="text-muted font-medium">Tuition Fee (₱)</label>
                                                <input v-model.number="feeForm.tuition_fee" type="number" step="0.01" min="0"
                                                       class="input h-8 w-36 text-right font-mono text-[13px] px-2.5 py-1" required />
                                            </div>
                                            <div class="flex items-center justify-between gap-3">
                                                <label class="text-muted">Laboratory Fee (₱)</label>
                                                <input v-model.number="feeForm.lab_fee" type="number" step="0.01" min="0"
                                                       class="input h-8 w-36 text-right font-mono text-[13px] px-2.5 py-1" />
                                            </div>
                                            <div class="flex items-center justify-between gap-3">
                                                <label class="text-muted">Miscellaneous (₱)</label>
                                                <input v-model.number="feeForm.misc_fee" type="number" step="0.01" min="0"
                                                       class="input h-8 w-36 text-right font-mono text-[13px] px-2.5 py-1" />
                                            </div>
                                            <div class="flex items-center justify-between gap-3">
                                                <label class="text-muted">LMS (₱)</label>
                                                <input v-model.number="feeForm.lms_fee" type="number" step="0.01" min="0"
                                                       class="input h-8 w-36 text-right font-mono text-[13px] px-2.5 py-1" />
                                            </div>
                                            <div class="flex items-center justify-between gap-3">
                                                <label class="text-muted">NSTP/ROTC (₱)</label>
                                                <input v-model.number="feeForm.nstp_fee" type="number" step="0.01" min="0"
                                                       class="input h-8 w-36 text-right font-mono text-[13px] px-2.5 py-1" />
                                            </div>
                                            <div class="flex items-center justify-between gap-3">
                                                <label class="text-muted">OMR (₱)</label>
                                                <input v-model.number="feeForm.omr_fee" type="number" step="0.01" min="0"
                                                       class="input h-8 w-36 text-right font-mono text-[13px] px-2.5 py-1" />
                                            </div>
                                            <div class="flex justify-between border-t border-line pt-2 font-semibold text-navy">
                                                <span>Cash Total</span><span>{{ peso(computedCashTotal) }}</span>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="px-4 py-3 flex flex-col justify-between">
                                        <div>
                                            <p class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted">Installment</p>
                                            <div class="space-y-2 text-[13px]">
                                                <div class="flex items-center justify-between gap-3">
                                                    <label class="text-muted">Installment Charge (₱)</label>
                                                    <input v-model.number="feeForm.installment_charge" type="number" step="0.01" min="0"
                                                           class="input h-8 w-36 text-right font-mono text-[13px] px-2.5 py-1" />
                                                </div>
                                                <div class="flex justify-between border-t border-line pt-2 font-semibold text-navy">
                                                    <span>Installment Total</span><span>{{ peso(computedInstallmentTotal) }}</span>
                                                </div>
                                            </div>
                                            <p class="mt-3 text-caption text-muted">Installment charge does not apply to full-payment transactions.</p>
                                        </div>
                                        <div class="mt-4 flex justify-end gap-2 border-t border-line pt-3">
                                            <button type="button" @click="cancelEditingFees" :disabled="savingFees" class="btn btn-secondary btn-sm">
                                                Cancel
                                            </button>
                                            <button type="submit" :disabled="savingFees" class="btn btn-primary btn-sm">
                                                <app-icon :name="savingFees ? 'LoaderCircle' : 'Check'" :size="14" :class="savingFees ? 'animate-spin' : ''" />
                                                {{ savingFees ? 'Saving...' : 'Save Fees' }}
                                            </button>
                                        </div>
                                    </div>
                                </form>

                                <p v-else class="px-4 py-6 text-center text-caption text-muted">
                                    No fee assessment on file yet. Click <strong>Edit Fees</strong> to set Tuition and Assessment of Fees.
                                </p>
                            </div>
                        </div>

                        <!-- Right: COR images -->
                        <div>
                            <div class="card overflow-hidden">
                                <div class="border-b border-line px-4 py-3 flex items-center gap-2">
                                    <app-icon name="FileImage" :size="16" class="text-navy" />
                                    <h2 class="text-[13px] font-semibold text-ink">Certificate of Registration</h2>
                                    <span v-if="detail.corDocs.length"
                                          class="ml-auto rounded-full bg-navy/10 px-2 py-0.5 text-[11px] font-bold text-navy">
                                        {{ detail.corDocs.length }}
                                    </span>
                                </div>

                                <div v-if="detail.corDocs.length" class="divide-y divide-line">
                                    <div v-for="doc in detail.corDocs" :key="doc.id">
                                        <div class="relative bg-page cursor-zoom-in" @click="previewCor = doc">
                                            <img :src="corUrl(doc)" :alt="doc.file_name"
                                                 class="w-full object-contain max-h-64" loading="lazy">
                                            <span class="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-md bg-white/90 shadow text-muted hover:text-ink">
                                                <app-icon name="Maximize2" :size="13" />
                                            </span>
                                        </div>
                                        <div class="px-3 py-2">
                                            <p class="truncate text-[12px] font-medium text-ink">{{ doc.file_name }}</p>
                                            <p class="text-caption text-muted">{{ fmtSize(doc.file_size) }} &middot; {{ doc.uploaded_at }}</p>
                                        </div>
                                    </div>
                                </div>

                                <div v-else class="flex flex-col items-center gap-2 py-10 text-center px-4">
                                    <app-icon name="FileImage" :size="32" class="text-muted opacity-30" />
                                    <p class="text-caption text-muted">No COR uploaded yet.</p>
                                    <p class="text-caption text-disabled">Go to Documents → Academic Docs to upload.</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </template>
            </div>
        </div>

        <!-- COR full-size preview -->
        <app-modal :open="!!previewCor" size="xl" icon="FileImage"
                   :title="previewCor?.file_name || 'Certificate of Registration'"
                   @close="previewCor = null">
            <template v-if="previewCor">
                <div class="overflow-auto rounded-lg border border-line bg-page">
                    <img :src="corUrl(previewCor)" :alt="previewCor.file_name"
                         class="mx-auto block w-full object-contain">
                </div>
                <p class="mt-2 text-caption text-muted">
                    {{ fmtSize(previewCor.file_size) }} &middot; {{ previewCor.uploaded_at }}
                    <template v-if="previewCor.uploaded_by"> &middot; {{ previewCor.uploaded_by }}</template>
                </p>
            </template>
            <template #footer>
                <a :href="previewCor ? corUrl(previewCor) : '#'" target="_blank" rel="noopener" class="btn btn-secondary">
                    <app-icon name="ExternalLink" :size="14" /> Open in tab
                </a>
                <button @click="previewCor = null" class="btn btn-primary">Close</button>
            </template>
        </app-modal>
    </div>
    `
};
