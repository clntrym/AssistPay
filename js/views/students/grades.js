const RegistrarGradesPage = {
    components: { AppIcon, PageHeader, AppModal },

    setup() {
        const terms         = Vue.ref([]);
        const selectedTerm  = Vue.ref(null);
        const enrollments   = Vue.ref([]);
        const loading       = Vue.ref(false);
        const termsLoading  = Vue.ref(false);
        const selected      = Vue.ref(null);
        const subjects      = Vue.ref([]);
        const subjLoading   = Vue.ref(false);
        const searchQuery   = Vue.ref('');
        const savingId      = Vue.ref(null);

        const fetchTerms = async () => {
            termsLoading.value = true;
            const r = await Model.request('students/grades', 'list_terms', {});
            termsLoading.value = false;
            if (r.success) {
                terms.value = r.terms || [];
                // Auto-select active term
                const activeTerm = terms.value.find(t => t.is_active);
                if (activeTerm) {
                    selectedTerm.value = activeTerm.term_id;
                    loadEnrollments();
                }
            }
        };

        const loadEnrollments = async () => {
            if (!selectedTerm.value) return;
            loading.value = true;
            const r = await Model.request('students/grades', 'list_for_grading', { termId: selectedTerm.value });
            loading.value = false;
            if (r.success) {
                enrollments.value = r.enrollments;
                selected.value = null;
                subjects.value = [];
            }
        };

        const selectEnrollment = async enr => {
            selected.value = enr;
            subjLoading.value = true;
            const r = await Model.request('students/grades', 'get_grades', { enrollmentId: enr.enrollment_id });
            subjLoading.value = false;
            if (r.success) subjects.value = r.subjects || [];
        };

        const calcFinalGrade = (p, m, pf, f) => {
            const vals = [p, m, pf, f].map(v => parseFloat(v) || 0).filter(v => v > 0);
            return vals.length ? (vals.reduce((a,b) => a+b, 0) / vals.length).toFixed(2) : '';
        };

        const calcPoints = fg => {
            const v = parseFloat(fg);
            if (!v || v < 0) return '';
            if (v >= 97) return '1.00'; if (v >= 94) return '1.25'; if (v >= 91) return '1.50';
            if (v >= 88) return '1.75'; if (v >= 85) return '2.00'; if (v >= 82) return '2.25';
            if (v >= 80) return '2.50'; if (v >= 78) return '2.75'; if (v >= 75) return '3.00';
            return '5.00';
        };

        const calcStatus = pts => {
            const p = parseFloat(pts);
            if (!p || p < 0) return '';
            return p <= 3 ? 'Passed' : (p === 5 ? 'Failed' : 'INC');
        };

        const saveGrade = async (s) => {
            savingId.value = s.detail_id;
            const r = await Model.request('students/grades', 'save_grade', {
                detailId: s.detail_id, prelims: s.prelims, midterms: s.midterms,
                prefinals: s.prefinals, finals: s.finals
            });
            savingId.value = null;
            if (r.success) Store.toast('success', 'Grade saved.');
            else Alerts.error('Could not save', r.message);
        };

        const saveAllGrades = async () => {
            savingId.value = 'all';
            for (const s of subjects.value) {
                if (s.prelims || s.midterms || s.prefinals || s.finals) {
                    await Model.request('students/grades', 'save_grade', {
                        detailId: s.detail_id, prelims: s.prelims, midterms: s.midterms,
                        prefinals: s.prefinals, finals: s.finals
                    });
                }
            }
            savingId.value = null;
            Store.toast('success', 'All grades saved.');
        };

        const classificationFilter = Vue.ref('ALL');

        const filteredStudents = Vue.computed(() => {
            const q = searchQuery.value.trim().toLowerCase();
            if (!q) return enrollments.value;
            return enrollments.value.filter(s =>
                s.student_number.toLowerCase().includes(q) ||
                s.student_name.toLowerCase().includes(q)
            );
        });

        const filteredSubjects = Vue.computed(() => {
            const f = classificationFilter.value;
            if (f === 'ALL') return subjects.value;
            if (f === 'MAJOR' || f === 'MINOR') return subjects.value.filter(s => s.classification === f);
            if (f === 'UNCLASSIFIED') return subjects.value.filter(s => !s.classification);
            return subjects.value;
        });

        Vue.onMounted(fetchTerms);

        return {
            terms, selectedTerm, enrollments, loading, termsLoading, selected, subjects, filteredSubjects, classificationFilter, subjLoading, searchQuery, savingId,
            fetchTerms, loadEnrollments, selectEnrollment, calcFinalGrade, calcPoints, calcStatus, saveGrade, saveAllGrades, filteredStudents
        };
    },

    template: `
    <div>
        <page-header title="Grades" subtitle="Record and manage student grades for enrolled subjects." section="Academic Data" />

        <div class="grid gap-6 lg:grid-cols-[340px_1fr]">
            <div class="card flex flex-col">
                <div class="border-b border-line px-4 py-3">
                    <label class="field-label">Select Term</label>
                    <select v-model="selectedTerm" @change="loadEnrollments" class="input mt-1">
                        <option :value="null">— Choose —</option>
                        <option v-for="t in terms" :key="t.term_id" :value="t.term_id">
                            {{ t.school_year }} {{ t.semester }} {{ t.is_active ? '(ACTIVE)' : '' }}
                        </option>
                    </select>
                </div>

                <div v-if="loading" class="flex items-center justify-center py-10 text-muted">
                    <app-icon name="LoaderCircle" :size="20" class="animate-spin" />
                </div>

                <ul v-else-if="filteredStudents.length" class="divide-y divide-line overflow-y-auto" style="max-height:calc(100vh - 280px)">
                    <li v-for="enr in filteredStudents" :key="enr.enrollment_id">
                        <button @click="selectEnrollment(enr)" class="w-full px-4 py-3 text-left transition-colors hover:bg-mist" :class="selected?.enrollment_id === enr.enrollment_id ? 'bg-navy/[0.06]' : ''">
                            <p class="truncate text-[13px] font-semibold text-ink leading-snug">{{ enr.student_name }}</p>
                            <p class="truncate text-caption text-muted">{{ enr.student_number }}</p>
                            <p class="mt-0.5 text-caption text-disabled">{{ enr.subject_count }} subject(s)</p>
                        </button>
                    </li>
                </ul>

                <div v-else class="flex flex-col items-center gap-2 py-12 text-center px-4">
                    <app-icon name="BookOpen" :size="32" class="text-muted opacity-60" />
                    <p class="text-caption text-muted">{{ selectedTerm ? 'No enrollments.' : 'Select a term.' }}</p>
                </div>
            </div>

            <div>
                <div v-if="!selected" class="card flex flex-col items-center justify-center gap-3 py-24 text-center">
                    <span class="grid h-16 w-16 place-items-center rounded-2xl bg-mist text-navy">
                        <app-icon name="BookMarked" :size="28" />
                    </span>
                    <p class="text-body font-semibold text-ink">Select a student</p>
                    <p class="max-w-xs text-caption text-muted">Click a student to enter and manage their grades.</p>
                </div>

                <div v-else-if="subjLoading" class="card flex items-center justify-center py-24 text-muted">
                    <app-icon name="LoaderCircle" :size="24" class="animate-spin" />
                </div>

                <template v-else>
                    <div class="card mb-4 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 flex-1">
                            <div><p class="text-[13px] text-muted">School Year</p><p class="font-semibold text-ink">{{ selected?.school_year }}</p></div>
                            <div><p class="text-[13px] text-muted">Semester</p><p class="font-semibold text-ink">{{ selected?.semester }}</p></div>
                            <div><p class="text-[13px] text-muted">Ref. No.</p><p class="font-semibold text-ink">{{ selected?.reference_no }}</p></div>
                            <div><p class="text-[13px] text-muted">Student</p><p class="font-semibold text-ink text-[12px] truncate">{{ selected?.student_name }}</p></div>
                        </div>
                        <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
                            <button @click="classificationFilter = 'ALL'"
                                    class="px-2.5 py-1 rounded-full font-bold border transition-colors"
                                    :class="classificationFilter === 'ALL' ? 'bg-navy text-white border-navy' : 'bg-white text-ink border-line hover:bg-mist'">
                                All ({{ subjects.length }})
                            </button>
                            <button @click="classificationFilter = 'MAJOR'"
                                    class="px-2.5 py-1 rounded-full font-bold border transition-colors"
                                    :class="classificationFilter === 'MAJOR' ? 'bg-navy text-white border-navy' : 'bg-navy/5 text-navy border-navy/20 hover:bg-navy/10'">
                                MAJOR ({{ subjects.filter(s => s.classification === 'MAJOR').length }})
                            </button>
                            <button @click="classificationFilter = 'MINOR'"
                                    class="px-2.5 py-1 rounded-full font-bold border transition-colors"
                                    :class="classificationFilter === 'MINOR' ? 'bg-teal-700 text-white border-teal-700' : 'bg-teal-50 text-teal-800 border-teal-200 hover:bg-teal-100'">
                                MINOR ({{ subjects.filter(s => s.classification === 'MINOR').length }})
                            </button>
                        </div>
                    </div>

                    <div class="card overflow-hidden">
                        <div class="overflow-x-auto touch-scroll table-scroll">
                            <table class="w-full min-w-[920px] text-[12px]">
                                <thead class="bg-page text-caption font-semibold text-muted">
                                    <tr>
                                        <th class="px-2 py-2 text-left">Code</th>
                                        <th class="px-2 py-2 text-left">Equivalent</th>
                                        <th class="px-2 py-2 text-center w-24">Classification</th>
                                        <th class="px-2 py-2 text-center w-12">Units</th>
                                        <th class="px-2 py-2 text-center w-16">Prelims</th>
                                        <th class="px-2 py-2 text-center w-16">MidTerms</th>
                                        <th class="px-2 py-2 text-center w-16">PreFinals</th>
                                        <th class="px-2 py-2 text-center w-16">Finals</th>
                                        <th class="px-2 py-2 text-center w-20">Final Grade</th>
                                        <th class="px-2 py-2 text-center w-16">Points</th>
                                        <th class="px-2 py-2 text-center w-16">Status</th>
                                        <th class="px-2 py-2 text-center w-16">Action</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-line">
                                    <tr v-for="s in filteredSubjects" :key="s.detail_id">
                                        <td class="px-2 py-2 font-medium text-ink">{{ s.subject_code }}</td>
                                        <td class="px-2 py-2 text-ink text-[11px]">{{ s.description }}</td>
                                        <td class="px-2 py-2 text-center">
                                            <span v-if="s.classification === 'MAJOR'" class="px-2 py-0.5 rounded text-[10px] font-bold bg-navy text-white">MAJOR</span>
                                            <span v-else-if="s.classification === 'MINOR'" class="px-2 py-0.5 rounded text-[10px] font-bold bg-teal-50 text-teal-800 border border-teal-200">MINOR</span>
                                            <span v-else class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-300">UNCLASSIFIED</span>
                                        </td>
                                        <td class="px-2 py-2 text-center text-muted">{{ s.units }}</td>
                                        <td class="px-2 py-1"><input v-model="s.prelims" type="number" min="0" max="100" class="input px-1 py-0.5 w-full text-center text-[11px]" placeholder="—"></td>
                                        <td class="px-2 py-1"><input v-model="s.midterms" type="number" min="0" max="100" class="input px-1 py-0.5 w-full text-center text-[11px]" placeholder="—"></td>
                                        <td class="px-2 py-1"><input v-model="s.prefinals" type="number" min="0" max="100" class="input px-1 py-0.5 w-full text-center text-[11px]" placeholder="—"></td>
                                        <td class="px-2 py-1"><input v-model="s.finals" type="number" min="0" max="100" class="input px-1 py-0.5 w-full text-center text-[11px]" placeholder="—"></td>
                                        <td class="px-2 py-2 text-center font-bold text-navy">{{ calcFinalGrade(s.prelims, s.midterms, s.prefinals, s.finals) || '—' }}</td>
                                        <td class="px-2 py-2 text-center font-bold" :class="parseFloat(calcPoints(calcFinalGrade(s.prelims, s.midterms, s.prefinals, s.finals))) <= 3 ? 'text-success' : 'text-danger'">{{ calcPoints(calcFinalGrade(s.prelims, s.midterms, s.prefinals, s.finals)) || '—' }}</td>
                                        <td class="px-2 py-2 text-center text-[11px] font-bold" :class="calcStatus(calcPoints(calcFinalGrade(s.prelims, s.midterms, s.prefinals, s.finals))) === 'Passed' ? 'text-success' : 'text-danger'">{{ calcStatus(calcPoints(calcFinalGrade(s.prelims, s.midterms, s.prefinals, s.finals))) || '—' }}</td>
                                        <td class="px-2 py-1 text-center">
                                            <button @click="saveGrade(s)" :disabled="savingId === s.detail_id" class="btn btn-sm bg-navy text-white hover:bg-navy/90 px-2 py-0.5 text-[11px] rounded">
                                                <span v-if="savingId === s.detail_id">...</span>
                                                <span v-else>Save</span>
                                            </button>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div class="flex justify-end mt-3">
                        <button @click="saveAllGrades" :disabled="savingId === 'all'" class="btn bg-navy text-white hover:bg-navy/90 px-5 py-2 text-[13px] rounded-lg font-semibold">
                            <span v-if="savingId === 'all'">Saving...</span>
                            <span v-else>Save All Grades</span>
                        </button>
                    </div>

                    <div class="card mt-4 p-4">
                        <p class="mb-3 text-[13px] font-semibold text-ink">Grading Scale</p>
                        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2.5 text-[11px]">
                            <div><span class="font-bold text-navy">1.00</span> 97–100</div>
                            <div><span class="font-bold text-navy">1.25</span> 94–96</div>
                            <div><span class="font-bold text-navy">1.50</span> 91–93</div>
                            <div><span class="font-bold text-navy">1.75</span> 88–90</div>
                            <div><span class="font-bold text-navy">2.00</span> 85–87</div>
                            <div><span class="font-bold text-navy">2.25</span> 82–84</div>
                            <div><span class="font-bold text-navy">2.50</span> 80–81</div>
                            <div><span class="font-bold text-navy">2.75</span> 78–79</div>
                            <div><span class="font-bold text-success">3.00</span> 75–77</div>
                            <div><span class="font-bold text-danger">5.00</span> Below 75</div>
                        </div>
                    </div>
                </template>
            </div>
        </div>
    </div>
    `
};
