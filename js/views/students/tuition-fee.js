



const RegistrarTuitionFeePage = {
    components: { AppIcon, PageHeader },

    setup() {
        const activeTerm = Vue.ref(null);
        const students = Vue.ref([]);
        const enrollments = Vue.ref([]);
        const loading = Vue.ref(false);
        const selected = Vue.ref(null);
        const assessment = Vue.ref(null);
        const assLoading = Vue.ref(false);
        const searchQuery = Vue.ref('');

        const fetchStudents = async () => {
            if (!activeTerm.value) return;
            loading.value = true;
            const r = await Model.request('students/tuition_fee', 'list_students', { termId: activeTerm.value });
            loading.value = false;
            if (r.success) {
                students.value = r.students;
                selected.value = null;
                assessment.value = null;
            }
        };

        const filteredStudents = Vue.computed(() => {
            const q = searchQuery.value.trim().toLowerCase();
            if (!q) return students.value;
            return students.value.filter(s =>
                s.student_number.toLowerCase().includes(q) ||
                s.name.toLowerCase().includes(q) ||
                s.course_code.toLowerCase().includes(q)
            );
        });

        const selectStudent = async s => {
            if (!s.has_enrollment) {
                Alerts.error('No enrollment', 'This student has no enrollment for this term.');
                return;
            }
            selected.value = s;
            assLoading.value = true;
            // Fetch the enrollment for this student in the active term
            const r = await Model.request('students/enrollment', 'list_enrolled', { termId: activeTerm.value });
            assLoading.value = false;

            if (r.success && r.enrollments) {
                const enr = r.enrollments.find(e => e.student_id === s.student_id);
                if (enr) {
                    const r2 = await Model.request('students/tuition_fee', 'get_assessment', { enrollmentId: enr.enrollment_id });
                    if (r2.success) assessment.value = r2.enrollment;
                }
            }
        };

        const peso = v => {
            const n = parseFloat(v) || 0;
            return '₱' + n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        };

        // Load active term on mount
        Vue.onMounted(() => {
            activeTerm.value = 1; // 1st Semester AY 2026-2027 (ACTIVE)
            fetchStudents();
        });

        return {
            activeTerm, students, enrollments, loading, selected, assessment, assLoading, searchQuery,
            fetchStudents, filteredStudents, selectStudent, peso
        };
    },

    template: `
    <div>
        <page-header title="Tuition Fee Assessment" subtitle="View student assessment of fees (View-Only)." section="Academic Data" />

        <div class="card mb-6 p-4">
            <div class="flex items-center gap-2">
                <span class="text-[13px] font-semibold text-ink">SY 2026-2027 / 1st Sem</span>
                <span class="ml-auto text-caption text-muted">View-only assessment based on approved enrollments</span>
            </div>
        </div>

        <div class="grid gap-6 lg:grid-cols-[400px_1fr]">

            <!-- Student list -->
            <div class="card flex flex-col">
                <div class="border-b border-line px-4 py-3">
                    <div class="relative">
                        <app-icon name="Search" :size="15" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                        <input v-model="searchQuery" type="search" placeholder="Search by ID, name, or course…"
                               class="input pl-9 py-2 text-[13px]" aria-label="Search students">
                    </div>
                </div>

                <div v-if="loading" class="flex items-center justify-center py-10 text-muted">
                    <app-icon name="LoaderCircle" :size="20" class="animate-spin" />
                </div>

                <ul v-else-if="filteredStudents.length" class="divide-y divide-line overflow-y-auto" style="max-height:calc(100vh - 280px)">
                    <li v-for="s in filteredStudents" :key="s.student_id">
                        <button @click="selectStudent(s)"
                                class="w-full px-4 py-3 text-left transition-colors hover:bg-mist"
                                :class="selected?.student_id === s.student_id ? 'bg-navy/[0.06]' : ''"
                                :disabled="!s.has_enrollment">
                            <p class="truncate text-[13px] font-semibold text-ink leading-snug">{{ s.name }}</p>
                            <p class="truncate text-caption text-muted">{{ s.student_number }} · {{ s.course_code }}</p>
                        </button>
                    </li>
                </ul>

                <p v-else class="py-10 text-center text-caption text-muted">No students found.</p>
            </div>

            <!-- Assessment panel -->
            <div>
                <div v-if="!selected" class="card flex flex-col items-center justify-center gap-3 py-24 text-center">
                    <span class="grid h-16 w-16 place-items-center rounded-2xl bg-mist text-navy">
                        <app-icon name="Banknote" :size="28" />
                    </span>
                    <p class="text-body font-semibold text-ink">Select a student</p>
                    <p class="max-w-xs text-caption text-muted">Click a student with an enrollment to view their tuition fee assessment.</p>
                </div>

                <div v-else-if="assLoading" class="card flex items-center justify-center py-24 text-muted">
                    <app-icon name="LoaderCircle" :size="24" class="animate-spin" />
                </div>

                <template v-else-if="assessment">
                    <!-- Header -->
                    <div class="card mb-4 p-4">
                        <div class="flex items-start justify-between">
                            <div>
                                <p class="text-[13px] text-muted">Student</p>
                                <p class="font-semibold text-ink">{{ assessment.student_name }}</p>
                                <p class="text-caption text-muted">{{ assessment.student_number }} · {{ assessment.course_code }}</p>
                            </div>
                            <div class="text-right">
                                <p class="text-[13px] text-muted">Status</p>
                                <span class="inline-block rounded-full bg-success/20 px-2.5 py-0.5 text-[11px] font-bold text-success">Enrolled</span>
                                <p class="mt-1 text-caption text-muted">{{ assessment.school_year }} / {{ assessment.semester }}</p>
                            </div>
                        </div>
                    </div>

                    <!-- Assessment table -->
                    <div class="card">
                        <div class="border-b border-line px-4 py-3">
                            <h3 class="text-[13px] font-semibold text-ink">ASSESSMENT OF FEES</h3>
                        </div>
                        <div class="p-4">
                            <div class="space-y-2">
                                <div class="flex justify-between">
                                    <span class="text-ink">Tuition Fee</span>
                                    <span class="font-semibold text-ink">{{ peso(assessment.tuition_fee) }}</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="text-ink">Laboratory Fee</span>
                                    <span class="font-semibold text-ink">{{ peso(assessment.lab_fee) }}</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="text-ink">Miscellaneous</span>
                                    <span class="font-semibold text-ink">{{ peso(assessment.misc_fee) }}</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="text-ink">LMS</span>
                                    <span class="font-semibold text-ink">{{ peso(assessment.lms_fee) }}</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="text-ink">NSTP/ROTC</span>
                                    <span class="font-semibold text-ink">{{ peso(assessment.nstp_fee) }}</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="text-ink">OMR</span>
                                    <span class="font-semibold text-ink">{{ peso(assessment.omr_fee) }}</span>
                                </div>
                                <div class="border-t border-line pt-2 mt-2 flex justify-between">
                                    <span class="font-semibold text-ink">Cash Total</span>
                                    <span class="font-bold text-navy">{{ peso(assessment.cash_total) }}</span>
                                </div>
                            </div>
                        </div>

                        <div class="border-t border-line p-4 bg-page">
                            <div class="space-y-2">
                                <div class="flex justify-between">
                                    <span class="text-ink">Installment Charge</span>
                                    <span class="font-semibold text-ink">{{ peso(assessment.installment_charge) }}</span>
                                </div>
                                <div class="border-t border-line pt-2 mt-2 flex justify-between">
                                    <span class="font-semibold text-ink">Installment Total</span>
                                    <span class="font-bold text-lg text-success">{{ peso(assessment.installment_total) }}</span>
                                </div>
                            </div>
                            <p class="mt-3 text-caption text-muted">Note: Installment charge does not apply to full-payment transaction(s).</p>
                        </div>
                    </div>
                </template>
            </div>
        </div>
    </div>
    `
};

