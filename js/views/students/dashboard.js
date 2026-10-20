const RegistrarDashboardPage = {
    components: { AppIcon, AppModal },
    setup() {
        const students = Vue.ref([]);
        const loading = Vue.ref(false);
        const stats = Vue.reactive({
            total: 0,
            active: 0,
            enrolled: 0,
            documents: 0
        });

        // View Student Modal State
        const viewingStudent = Vue.ref(null);
        const activeTab = Vue.ref('info');
        const studentSubjects = Vue.ref([]);
        const loadingStudentSubjects = Vue.ref(false);

        const selectedSy = Vue.ref('');
        const selectedSem = Vue.ref('');

        const studentSchoolYears = Vue.computed(() => {
            if (!viewingStudent.value?.student_number) return [];
            const match = viewingStudent.value.student_number.match(/^(\d{4})/);
            const startYear = match ? parseInt(match[1]) : 2024;
            return [
                { label: `${startYear}-${startYear + 1} (1st Year)`, value: `${startYear}-${startYear + 1}` },
                { label: `${startYear + 1}-${startYear + 2} (2nd Year)`, value: `${startYear + 1}-${startYear + 2}` },
                { label: `${startYear + 2}-${startYear + 3} (3rd Year)`, value: `${startYear + 2}-${startYear + 3}` },
                { label: `${startYear + 3}-${startYear + 4} (4th Year)`, value: `${startYear + 3}-${startYear + 4}` }
            ];
        });

        const sampleGrades = {
            "2024-2025": {
                "1st Semester": [
                    { code: "GE 003C", description: "Mathematics in the Modern World", units: 3, prelims: 91, midterms: 97, prefinals: 99, finals: 99, finalGrade: "97.00", points: "1.00", status: "Passed" },
                    { code: "GE 005", description: "Science, Technology & Society", units: 3, prelims: 86, midterms: 87, prefinals: 95, finals: 95, finalGrade: "91.60", points: "1.50", status: "Passed" },
                    { code: "GE 007", description: "Contemporary World", units: 3, prelims: 87, midterms: 91, prefinals: 99, finals: 99, finalGrade: "95.00", points: "1.25", status: "Passed" },
                    { code: "GELEC 004-IT", description: "Living in the IT Era", units: 3, prelims: 91, midterms: 91, prefinals: 88, finals: 88, finalGrade: "89.20", points: "1.75", status: "Passed" },
                    { code: "IT 101", description: "Introduction to Computing", units: 3, prelims: 91, midterms: 94, prefinals: 95, finals: 95, finalGrade: "94.00", points: "1.25", status: "Passed" },
                    { code: "IT 102", description: "Computer Programming 1", units: 3, prelims: 91, midterms: 89, prefinals: 93, finals: 93, finalGrade: "91.80", points: "1.50", status: "Passed" },
                    { code: "NCST 001", description: "Nation Builders (NCST Culture 1)", units: 3, prelims: 99, midterms: 99, prefinals: 99, finals: 99, finalGrade: "99.00", points: "1.00", status: "Passed" },
                    { code: "NSTP 001", description: "National Service Training Program 1", units: 0, prelims: 86, midterms: 96, prefinals: 99, finals: 99, finalGrade: "95.80", points: "1.25", status: "Passed" },
                    { code: "PATHFIT 1", description: "Physical Activities Towards Health & Fitness 1", units: 2, prelims: 84, midterms: 96, prefinals: 99, finals: 99, finalGrade: "95.40", points: "1.25", status: "Passed" }
                ],
                "2nd Semester": [
                    { code: "GE 004", description: "Understanding the Self", units: 3, prelims: 92, midterms: 87, prefinals: 92, finals: 92, finalGrade: "91.00", points: "1.50", status: "Passed" },
                    { code: "GE 008", description: "Art Appreciation", units: 3, prelims: 88, midterms: 89, prefinals: 91, finals: 91, finalGrade: "90.00", points: "1.75", status: "Passed" },
                    { code: "GELEC 012-IT", description: "Reading Visual Art", units: 3, prelims: 87, midterms: 95, prefinals: 100, finals: 100, finalGrade: "96.40", points: "1.25", status: "Passed" },
                    { code: "IT 103", description: "Computer Programming 2", units: 3, prelims: 94, midterms: 92, prefinals: 96, finals: 96, finalGrade: "94.80", points: "1.25", status: "Passed" },
                    { code: "IT 104", description: "Web System Technologies 1", units: 3, prelims: 89, midterms: 96, prefinals: 96, finals: 96, finalGrade: "94.60", points: "1.25", status: "Passed" },
                    { code: "IT 105", description: "Discrete Structures 1", units: 3, prelims: 95, midterms: 93, prefinals: 92, finals: 92, finalGrade: "92.80", points: "1.50", status: "Passed" },
                    { code: "IT 106", description: "Networking 1", units: 3, prelims: 88, midterms: 94, prefinals: 93, finals: 93, finalGrade: "92.20", points: "1.50", status: "Passed" },
                    { code: "NSTP 002", description: "National Service Training Program 2", units: 0, prelims: 86, midterms: 97, prefinals: 91, finals: 91, finalGrade: "91.20", points: "1.50", status: "Passed" },
                    { code: "PATHFIT 2", description: "Physical Activities Towards Health & Fitness 2", units: 2, prelims: 91, midterms: 96, prefinals: 98, finals: 98, finalGrade: "96.20", points: "1.25", status: "Passed" }
                ]
            },
            "2025-2026": {
                "1st Semester": [
                    { code: "IT 201", description: "Information Management 1", units: 3, prelims: 94, midterms: 87, prefinals: 88, finals: 95, finalGrade: "91.10", points: "1.50", status: "Passed" },
                    { code: "IT 202", description: "Interactive Media Design", units: 3, prelims: 92, midterms: 92, prefinals: 94, finals: 98, finalGrade: "94.40", points: "1.25", status: "Passed" },
                    { code: "IT 203", description: "Integrative Programming Technologies 1", units: 3, prelims: 85, midterms: 89, prefinals: 97, finals: 98, finalGrade: "93.30", points: "1.50", status: "Passed" },
                    { code: "IT 204", description: "Discrete Structures 2", units: 3, prelims: 96, midterms: 91, prefinals: 92, finals: 95, finalGrade: "93.50", points: "1.25", status: "Passed" },
                    { code: "IT 205", description: "Data Structures and Algorithms", units: 3, prelims: 98, midterms: 95, prefinals: 94, finals: 95, finalGrade: "95.30", points: "1.25", status: "Passed" },
                    { code: "IT 206", description: "Web System Technologies 2", units: 3, prelims: 92, midterms: 92, prefinals: 97, finals: 96, finalGrade: "94.70", points: "1.25", status: "Passed" }
                ],
                "2nd Semester": [
                    { code: "IT 207", description: "Application Development and Emerging Technologies 1", units: 3, prelims: 97, midterms: 99, prefinals: 99, finals: 98, finalGrade: "98.30", points: "1.00", status: "Passed" },
                    { code: "IT 208", description: "Object Oriented Programming", units: 3, prelims: 97, midterms: 99, prefinals: 96, finals: 97, finalGrade: "97.10", points: "1.00", status: "Passed" },
                    { code: "IT 209", description: "Platform Technologies", units: 3, prelims: 95, midterms: 95, prefinals: 99, finals: 98, finalGrade: "97.10", points: "1.00", status: "Passed" },
                    { code: "IT 210", description: "Human Computer Interaction 1", units: 3, prelims: 92, midterms: 93, prefinals: 90, finals: 98, finalGrade: "93.40", points: "1.50", status: "Passed" },
                    { code: "IT 211", description: "Information Management 2", units: 3, prelims: 93, midterms: 96, prefinals: 98, finals: 90, finalGrade: "94.20", points: "1.25", status: "Passed" },
                    { code: "NCST 002", description: "Nation Builders (NCST Culture 2)", units: 3, prelims: 98, midterms: 98, prefinals: 98, finals: 98, finalGrade: "98.00", points: "1.00", status: "Passed" }
                ]
            }
        };

        const passedCodes = Vue.computed(() => {
            const set = new Set();
            Object.values(sampleGrades).forEach(sy => {
                Object.values(sy).forEach(semList => {
                    semList.forEach(g => {
                        if (g.status === 'Passed') set.add(g.code);
                    });
                });
            });
            return set;
        });

        const filteredGrades = Vue.computed(() => {
            const sy = selectedSy.value;
            const sem = selectedSem.value;
            if (!sy || !sem) return [];
            return sampleGrades[sy]?.[sem] || [];
        });

        const computedCurriculumSubjects = Vue.computed(() => {
            return studentSubjects.value.map(sub => {
                const code = sub.subject_code;
                const prereq = sub.prereq || '—';
                let status = 'Not Taken';
                let statusClass = 'bg-gray-100 text-gray-600 border-gray-200';
                
                if (passedCodes.value.has(code)) {
                    status = 'Passed';
                    statusClass = 'bg-green-100 text-green-700 border-green-200 font-bold';
                } else if (sub.year == 3 && sub.sem == 1) {
                    status = 'Enrolled';
                    statusClass = 'bg-amber-100 text-amber-700 border-amber-200 font-bold';
                }

                let prereqStatus = 'N/A';
                let prereqStatusClass = 'text-gray-400';
                if (prereq !== '—' && prereq !== '') {
                    const reqs = prereq.split(',').map(s => s.trim());
                    const allPassed = reqs.every(r => passedCodes.value.has(r));
                    if (allPassed) {
                        prereqStatus = 'Passed';
                        prereqStatusClass = 'text-green-700 font-semibold';
                    } else {
                        prereqStatus = 'Pending';
                        prereqStatusClass = 'text-amber-600 font-semibold';
                    }
                }

                let canEnroll = 'No';
                let canEnrollClass = 'bg-gray-100 text-gray-400';
                if (status === 'Not Taken' && (prereq === '—' || prereq === '' || prereqStatus === 'Passed')) {
                    canEnroll = 'Yes';
                    canEnrollClass = 'bg-green-100 text-green-700 border border-green-200 font-bold';
                }

                return {
                    ...sub,
                    status,
                    statusClass,
                    prereq,
                    prereqStatus,
                    prereqStatusClass,
                    canEnroll,
                    canEnrollClass
                };
            });
        });

        const studentClassification = Vue.computed(() => {
            const subs = computedCurriculumSubjects.value;
            if (!subs || !subs.length) {
                return { isRegular: true, label: 'REGULAR', badgeClass: 'bg-green-100 text-green-700 border-green-200 font-bold', reason: 'No curriculum issues detected' };
            }

            let maxYear = 1;
            let maxSem = 1;
            subs.forEach(s => {
                if (s.status === 'Passed' || s.status === 'Enrolled') {
                    if (s.year > maxYear || (s.year === maxYear && s.sem > maxSem)) {
                        maxYear = s.year;
                        maxSem = s.sem;
                    }
                }
            });

            let hasLakdaw = false;
            let lakdawReason = '';

            for (const s of subs) {
                const isPastTerm = (s.year < maxYear) || (s.year === maxYear && s.sem < maxSem);

                if (isPastTerm && s.status !== 'Passed') {
                    hasLakdaw = true;
                    lakdawReason = `Unpassed subject (${s.subject_code} - Year ${s.year} Sem ${s.sem == 1 ? '1st' : '2nd'}) in curriculum order`;
                    break;
                }

                if (s.status === 'Failed' || s.status === 'Incomplete' || s.status === 'Dropped') {
                    hasLakdaw = true;
                    lakdawReason = `${s.subject_code} has ${s.status} status`;
                    break;
                }

                if (s.prereq && s.prereq !== '—' && s.prereq !== '' && s.prereqStatus === 'Pending' && (s.status === 'Enrolled' || s.status === 'Passed')) {
                    hasLakdaw = true;
                    lakdawReason = `Prerequisite (${s.prereq}) for ${s.subject_code} not passed`;
                    break;
                }
            }

            if (hasLakdaw) {
                return {
                    isRegular: false,
                    label: 'IRREGULAR',
                    badgeClass: 'bg-amber-100 text-amber-800 border-amber-300 font-bold',
                    reason: lakdawReason
                };
            }

            return {
                isRegular: true,
                label: 'REGULAR',
                badgeClass: 'bg-green-100 text-green-700 border-green-200 font-bold',
                reason: 'All previous & current curriculum subjects continuously passed (no skipped subjects)'
            };
        });

        const fetchDashboardData = async () => {
            loading.value = true;
            const res = await Model.request('students/manage', 'list');
            loading.value = false;
            if (res.success) {
                students.value = res.students || [];
                stats.total = students.value.length;
                stats.active = students.value.filter(s => s.status !== 'Inactive' && s.status !== 'Dropped').length;
                stats.enrolled = students.value.filter(s => s.status === 'Enrolled').length;
                stats.documents = 0;
            }
        };

        Vue.onMounted(fetchDashboardData);

        const openViewModal = async (st) => {
            viewingStudent.value = st;
            activeTab.value = 'info';
            studentSubjects.value = [];

            const match = (st.student_number || '').match(/^(\d{4})/);
            const startYear = match ? parseInt(match[1]) : 2024;
            selectedSy.value = `${startYear}-${startYear + 1}`;
            selectedSem.value = '1st Semester';

            if (st.curriculum_id) {
                loadingStudentSubjects.value = true;
                const res = await Model.request('students/get_curriculum', 'get_structure', { curriculum_id: st.curriculum_id });
                loadingStudentSubjects.value = false;
                if (res.success) {
                    studentSubjects.value = res.subjects || [];
                }
            }
        };

        const recentStudents = Vue.computed(() => students.value.slice(0, 5));

        return {
            students, loading, stats, recentStudents,
            viewingStudent, activeTab, studentSubjects, loadingStudentSubjects,
            openViewModal, selectedSy, selectedSem, studentSchoolYears, filteredGrades, computedCurriculumSubjects, studentClassification
        };
    },
    template: `
        <div>
            <!-- Main Page Content -->
            <div class="mb-6">
                <h2 class="text-[24px] font-bold text-navy leading-tight mb-1">Dashboard</h2>
                <p class="text-muted text-sm">Overview of stored student academic information and database activities.</p>
            </div>

            <!-- Stats Cards -->
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
                <!-- Total Students -->
                <div class="card bg-white rounded-xl p-5 border border-line flex items-center justify-between">
                    <div>
                        <p class="text-xs font-bold text-muted uppercase tracking-wide mb-1">Total Students</p>
                        <h3 class="text-3xl font-bold text-navy mb-1">{{ stats.total }}</h3>
                        <p class="text-xs text-muted">Registered in database</p>
                    </div>
                    <div class="w-12 h-12 rounded-xl bg-blue-50 text-blue-500 flex items-center justify-center">
                        <app-icon name="Users" :size="24" />
                    </div>
                </div>

                <!-- Active Students -->
                <div class="card bg-white rounded-xl p-5 border border-line flex items-center justify-between">
                    <div>
                        <p class="text-xs font-bold text-muted uppercase tracking-wide mb-1">Active Students</p>
                        <h3 class="text-3xl font-bold text-navy mb-1">{{ stats.active }}</h3>
                        <p class="text-xs font-semibold text-green-600">
                            {{ stats.total > 0 ? ((stats.active / stats.total) * 100).toFixed(1) : '0' }}% Active rate
                        </p>
                    </div>
                    <div class="w-12 h-12 rounded-xl bg-green-50 text-green-500 flex items-center justify-center">
                        <app-icon name="UserCheck" :size="24" />
                    </div>
                </div>

                <!-- Currently Enrolled -->
                <div class="card bg-white rounded-xl p-5 border border-line flex items-center justify-between">
                    <div>
                        <p class="text-xs font-bold text-muted uppercase tracking-wide mb-1">Currently Enrolled</p>
                        <h3 class="text-3xl font-bold text-navy mb-1">{{ stats.enrolled }}</h3>
                        <p class="text-xs text-muted">SY 2026-2027 1st Sem</p>
                    </div>
                    <div class="w-12 h-12 rounded-xl bg-orange-50 text-orange-500 flex items-center justify-center">
                        <app-icon name="GraduationCap" :size="24" />
                    </div>
                </div>

                <!-- Academic Documents -->
                <div class="card bg-white rounded-xl p-5 border border-line flex items-center justify-between">
                    <div>
                        <p class="text-xs font-bold text-muted uppercase tracking-wide mb-1">Academic Documents</p>
                        <h3 class="text-3xl font-bold text-navy mb-1">{{ stats.documents }}</h3>
                        <p class="text-xs text-muted">Verified files archived</p>
                    </div>
                    <div class="w-12 h-12 rounded-xl bg-purple-50 text-purple-500 flex items-center justify-center">
                        <app-icon name="FileText" :size="24" />
                    </div>
                </div>
            </div>

            <!-- Recently Added Students Table -->
            <div class="card bg-white rounded-xl shadow-sm border border-line">
                <div class="p-5 border-b border-line flex items-center justify-between">
                    <div>
                        <h3 class="font-bold text-navy text-lg">Recently Added Students</h3>
                        <p class="text-xs text-muted mt-0.5">Most recent student profile entries in the system</p>
                    </div>
                    <a href="#/registrar/students/records" class="text-sm font-semibold text-navy hover:text-blue-600 flex items-center gap-1">
                        View All Students <app-icon name="ChevronRight" :size="16" />
                    </a>
                </div>

                <div class="overflow-x-auto touch-scroll table-scroll">
                    <table class="w-full text-left border-collapse min-w-[700px]">
                        <thead>
                            <tr class="border-b border-line text-[11px] font-bold text-muted uppercase bg-gray-50/30">
                                <th class="px-5 py-4 whitespace-nowrap">Student ID</th>
                                <th class="px-5 py-4 whitespace-nowrap">Student Name</th>
                                <th class="px-5 py-4 whitespace-nowrap">Course</th>
                                <th class="px-5 py-4 whitespace-nowrap">Year Level</th>
                                <th class="px-5 py-4 whitespace-nowrap">Enrollment Status</th>
                                <th class="px-5 py-4 whitespace-nowrap">Last Updated</th>
                            </tr>
                        </thead>
                        <tbody class="text-[13px]">
                            <tr v-if="recentStudents.length === 0">
                                <td colspan="7" class="text-center py-10 text-muted font-medium">
                                    No student records found in the database.
                                </td>
                            </tr>
                            <tr v-for="student in recentStudents" :key="student.id" class="border-b border-line hover:bg-mist transition-colors">
                                <td class="px-5 py-4 font-bold text-navy whitespace-nowrap">{{ student.student_number }}</td>
                                <td class="px-5 py-4 font-semibold text-ink whitespace-nowrap">{{ student.name }}</td>
                                <td class="px-5 py-4 whitespace-nowrap">
                                    <span class="px-2.5 py-1 bg-mist text-navy font-bold rounded text-[11px]">{{ student.course }}</span>
                                </td>
                                <td class="px-5 py-4 text-muted whitespace-nowrap">{{ student.year }}</td>
                                <td class="px-5 py-4 whitespace-nowrap">
                                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border" :class="student.statusColor">
                                        <span class="w-1.5 h-1.5 rounded-full" :class="student.dotColor"></span>
                                        {{ student.status }}
                                    </span>
                                </td>
                                <td class="px-5 py-4 text-muted whitespace-nowrap">{{ student.updated }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- ================= VIEW STUDENT DETAILS MODAL WITH TABS ================= -->
            <app-modal :open="!!viewingStudent" :title="viewingStudent ? (viewingStudent.name + ' - Student Record') : 'Student Record'" icon="User" size="xl" @close="viewingStudent = null">
                <div v-if="viewingStudent" class="space-y-4 text-xs text-ink">
                    <!-- Top Student Banner -->
                    <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 bg-[#f5f8fc] border border-[#d2dfef] rounded-lg">
                        <div class="flex items-center gap-3 min-w-0">
                            <div class="w-12 h-12 rounded-full bg-navy text-white font-bold flex items-center justify-center text-lg shadow-sm shrink-0">
                                {{ (viewingStudent.first_name || viewingStudent.name || 'S').charAt(0) }}
                            </div>
                            <div class="min-w-0">
                                <h3 class="text-base font-bold text-navy truncate">{{ viewingStudent.name }}</h3>
                                <p class="text-[11px] text-muted flex flex-wrap gap-1">
                                    <span>Student ID: <strong class="font-semibold text-ink">{{ viewingStudent.student_number }}</strong></span>
                                    <span>| Course: <strong class="font-semibold text-navy">{{ viewingStudent.course || viewingStudent.course_code }}</strong></span>
                                    <span>| Curriculum: <strong class="font-semibold text-navy">{{ viewingStudent.curriculum_code || 'BSIT-2024' }}</strong></span>
                                </p>
                            </div>
                        </div>
                        <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border shrink-0" :class="viewingStudent.statusColor || 'text-green-700 bg-green-100 border-green-200'">
                            <span class="w-2 h-2 rounded-full bg-green-500"></span>
                            {{ viewingStudent.status || 'Enrolled' }}
                        </span>
                    </div>

                    <!-- Navigation Tabs -->
                    <div class="flex items-center gap-1 border-b border-line pb-2 overflow-x-auto touch-scroll table-scroll text-xs whitespace-nowrap">
                        <button type="button" @click="activeTab = 'info'" 
                            class="px-3 py-1.5 rounded-lg font-semibold transition-colors whitespace-nowrap flex items-center gap-1.5"
                            :class="activeTab === 'info' ? 'bg-navy text-white' : 'text-muted hover:text-navy hover:bg-mist'">
                            <app-icon name="User" :size="14" /> Student Information
                        </button>
                        <button type="button" @click="activeTab = 'curriculum'" 
                            class="px-3 py-1.5 rounded-lg font-semibold transition-colors whitespace-nowrap flex items-center gap-1.5"
                            :class="activeTab === 'curriculum' ? 'bg-navy text-white' : 'text-muted hover:text-navy hover:bg-mist'">
                            <app-icon name="BookOpen" :size="14" /> Curriculum
                        </button>
                        <button type="button" @click="activeTab = 'grades'" 
                            class="px-3 py-1.5 rounded-lg font-semibold transition-colors whitespace-nowrap flex items-center gap-1.5"
                            :class="activeTab === 'grades' ? 'bg-navy text-white' : 'text-muted hover:text-navy hover:bg-mist'">
                            <app-icon name="Award" :size="14" /> Grades
                        </button>
                        <button type="button" @click="activeTab = 'enrollment'" 
                            class="px-3 py-1.5 rounded-lg font-semibold transition-colors whitespace-nowrap flex items-center gap-1.5"
                            :class="activeTab === 'enrollment' ? 'bg-navy text-white' : 'text-muted hover:text-navy hover:bg-mist'">
                            <app-icon name="FileSignature" :size="14" /> Enrollment
                        </button>
                        <button type="button" @click="activeTab = 'tuition'" 
                            class="px-3 py-1.5 rounded-lg font-semibold transition-colors whitespace-nowrap flex items-center gap-1.5"
                            :class="activeTab === 'tuition' ? 'bg-navy text-white' : 'text-muted hover:text-navy hover:bg-mist'">
                            <app-icon name="Banknote" :size="14" /> Tuition Fee
                        </button>
                    </div>

                    <!-- TAB 1: STUDENT INFORMATION -->
                    <div v-if="activeTab === 'info'" class="space-y-4">
                        <div class="grid grid-cols-1 md:grid-cols-4 gap-4 items-start bg-white p-3 border border-line rounded-lg">
                            <div class="flex flex-col items-center justify-center p-3 border border-dashed border-line rounded-lg bg-gray-50/70 text-center">
                                <div class="w-20 h-20 bg-mist/60 rounded-lg flex flex-col items-center justify-center text-muted border border-line mb-2">
                                    <app-icon name="Camera" :size="24" class="text-disabled mb-1" />
                                    <span class="text-[9px] leading-tight text-center px-1">No photo available</span>
                                </div>
                                <button type="button" class="btn btn-secondary btn-sm text-[10px] py-1 px-2 w-full">
                                    <app-icon name="Upload" :size="12" /> Upload Photo
                                </button>
                            </div>

                            <div class="md:col-span-3 space-y-3">
                                <div>
                                    <label class="field-label font-semibold">Student ID No :</label>
                                    <input type="text" :value="viewingStudent.student_number" class="input text-xs bg-gray-50" readonly />
                                </div>

                                <div class="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                                    <div>
                                        <label class="field-label font-semibold">First Name :</label>
                                        <input type="text" :value="viewingStudent.first_name || 'N/A'" class="input text-xs bg-gray-50" readonly />
                                    </div>
                                    <div>
                                        <label class="field-label font-semibold">Middle Name :</label>
                                        <input type="text" :value="viewingStudent.middle_name || 'N/A'" class="input text-xs bg-gray-50" readonly />
                                    </div>
                                    <div>
                                        <label class="field-label font-semibold">Last Name :</label>
                                        <input type="text" :value="viewingStudent.last_name || 'N/A'" class="input text-xs bg-gray-50" readonly />
                                    </div>
                                    <div>
                                        <label class="field-label font-semibold">Suffix :</label>
                                        <input type="text" :value="viewingStudent.suffix || 'N/A'" class="input text-xs bg-gray-50" readonly />
                                    </div>
                                </div>

                                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <div>
                                        <label class="field-label font-semibold">Course Title :</label>
                                        <input type="text" :value="viewingStudent.course_name || viewingStudent.course || 'BS-Information Technology'" class="input text-xs bg-gray-50" readonly />
                                    </div>
                                    <div>
                                        <label class="field-label font-semibold">Curriculum :</label>
                                        <input type="text" :value="viewingStudent.curriculum_code || 'SY 2024-2025 Curriculum'" class="input text-xs bg-gray-50" readonly />
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Address -->
                        <div class="p-3 bg-white rounded-lg border border-line space-y-2.5">
                            <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
                                <div class="md:col-span-3">
                                    <label class="field-label font-semibold">Complete Address :</label>
                                    <input type="text" :value="viewingStudent.address || 'N/A'" class="input text-xs bg-gray-50" readonly />
                                </div>
                                <div>
                                    <label class="field-label font-semibold">Zip Code :</label>
                                    <input type="text" :value="viewingStudent.zip_code || '1447'" class="input text-xs bg-gray-50" readonly />
                                </div>
                            </div>

                            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                                <div>
                                    <label class="field-label font-semibold">Region :</label>
                                    <input type="text" :value="viewingStudent.region || 'N/A'" class="input text-xs bg-gray-50" readonly />
                                </div>
                                <div>
                                    <label class="field-label font-semibold">Province :</label>
                                    <input type="text" :value="viewingStudent.province || 'N/A'" class="input text-xs bg-gray-50" readonly />
                                </div>
                                <div>
                                    <label class="field-label font-semibold">Town/Municipality/City :</label>
                                    <input type="text" :value="viewingStudent.city || 'N/A'" class="input text-xs bg-gray-50" readonly />
                                </div>
                                <div>
                                    <label class="field-label font-semibold">Barangay :</label>
                                    <input type="text" :value="viewingStudent.barangay || 'N/A'" class="input text-xs bg-gray-50" readonly />
                                </div>
                            </div>
                        </div>

                        <!-- Contacts & Demographics -->
                        <div class="p-3 bg-white rounded-lg border border-line space-y-2.5">
                            <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                                <div>
                                    <label class="field-label font-semibold">Home Land Line :</label>
                                    <input type="text" :value="viewingStudent.landline || 'N/A'" class="input text-xs bg-gray-50" readonly />
                                </div>
                                <div>
                                    <label class="field-label font-semibold">Mobile No :</label>
                                    <input type="text" :value="viewingStudent.contact_no || 'N/A'" class="input text-xs bg-gray-50" readonly />
                                </div>
                                <div>
                                    <label class="field-label font-semibold">Mobile Provider :</label>
                                    <input type="text" :value="viewingStudent.mobile_provider || 'Globe'" class="input text-xs bg-gray-50" readonly />
                                </div>
                            </div>

                            <div class="grid grid-cols-2 sm:grid-cols-6 gap-2.5">
                                <div>
                                    <label class="field-label font-semibold">Gender :</label>
                                    <input type="text" :value="viewingStudent.gender || 'Female'" class="input text-xs bg-gray-50" readonly />
                                </div>
                                <div>
                                    <label class="field-label font-semibold">Civil Status :</label>
                                    <input type="text" :value="viewingStudent.civil_status || 'Single'" class="input text-xs bg-gray-50" readonly />
                                </div>
                                <div>
                                    <label class="field-label font-semibold">Nationality :</label>
                                    <input type="text" :value="viewingStudent.nationality || 'Filipino'" class="input text-xs bg-gray-50" readonly />
                                </div>
                                <div>
                                    <label class="field-label font-semibold">Date of Birth :</label>
                                    <input type="text" :value="viewingStudent.birth_date || 'N/A'" class="input text-xs bg-gray-50" readonly />
                                </div>
                                <div>
                                    <label class="field-label font-semibold">Age :</label>
                                    <input type="text" :value="viewingStudent.age || 'N/A'" class="input text-xs bg-gray-50" readonly />
                                </div>
                                <div>
                                    <label class="field-label font-semibold">Place of Birth :</label>
                                    <input type="text" :value="viewingStudent.birth_place || 'N/A'" class="input text-xs bg-gray-50" readonly />
                                </div>
                            </div>

                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                <div>
                                    <label class="field-label font-semibold">Email Address :</label>
                                    <input type="text" :value="viewingStudent.email || 'N/A'" class="input text-xs bg-gray-50" readonly />
                                </div>
                                <div>
                                    <label class="field-label font-semibold">Religion :</label>
                                    <input type="text" :value="viewingStudent.religion || 'N/A'" class="input text-xs bg-gray-50" readonly />
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- TAB 2: CURRICULUM -->
                    <div v-if="activeTab === 'curriculum'" class="space-y-3">
                        <!-- Registrar Curriculum Evaluation Banner -->
                        <div class="p-3 rounded-lg border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                             :class="studentClassification.isRegular ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'">
                            <div class="flex items-center gap-2.5">
                                <span class="px-3 py-1 rounded-full text-xs font-bold border shadow-xs whitespace-nowrap" :class="studentClassification.badgeClass">
                                    {{ studentClassification.label }} STUDENT
                                </span>
                                <span class="text-xs font-semibold text-ink">
                                    {{ studentClassification.reason }}
                                </span>
                            </div>
                            <div class="text-[11px] text-muted font-bold whitespace-nowrap uppercase tracking-wider">
                                Registrar Curriculum Evaluation
                            </div>
                        </div>

                        <div v-if="loadingStudentSubjects" class="text-center py-8 text-muted">
                            Loading student curriculum...
                        </div>
                        <div v-else-if="computedCurriculumSubjects.length === 0" class="text-center py-8 text-muted">
                            No curriculum subjects found for this student.
                        </div>
                        <div v-else class="overflow-x-auto rounded-lg border border-line bg-white">
                            <table class="w-full text-left border-collapse">
                                <thead>
                                    <tr class="border-b border-line text-[10px] font-bold text-muted uppercase bg-gray-50">
                                        <th class="px-3 py-2.5">Year</th>
                                        <th class="px-3 py-2.5">Semester</th>
                                        <th class="px-3 py-2.5">Code</th>
                                        <th class="px-3 py-2.5">Description</th>
                                        <th class="px-3 py-2.5 text-center">Units</th>
                                        <th class="px-3 py-2.5 text-center">Status</th>
                                        <th class="px-3 py-2.5">PreReq</th>
                                        <th class="px-3 py-2.5 text-center">PreReq Status</th>
                                        <th class="px-3 py-2.5 text-center">Can Enroll</th>
                                    </tr>
                                </thead>
                                <tbody class="text-[12px]">
                                    <tr v-for="sub in computedCurriculumSubjects" :key="sub.subject_id" class="border-b border-line hover:bg-mist transition-colors">
                                        <td class="px-3 py-2 text-muted whitespace-nowrap">{{ sub.year }} Year</td>
                                        <td class="px-3 py-2 text-muted whitespace-nowrap">{{ sub.sem == 1 ? '1st' : '2nd' }} Sem</td>
                                        <td class="px-3 py-2 font-bold text-navy whitespace-nowrap">{{ sub.subject_code }}</td>
                                        <td class="px-3 py-2 text-ink">{{ sub.description }}</td>
                                        <td class="px-3 py-2 text-center font-semibold whitespace-nowrap">{{ sub.units }}</td>
                                        <td class="px-3 py-2 text-center whitespace-nowrap">
                                            <span class="px-2 py-0.5 rounded-full text-[10px]" :class="sub.statusClass">
                                                {{ sub.status }}
                                            </span>
                                        </td>
                                        <td class="px-3 py-2 text-muted text-[11px] whitespace-nowrap">{{ sub.prereq }}</td>
                                        <td class="px-3 py-2 text-center text-[11px] whitespace-nowrap" :class="sub.prereqStatusClass">
                                            {{ sub.prereqStatus }}
                                        </td>
                                        <td class="px-3 py-2 text-center whitespace-nowrap">
                                            <span class="px-2.5 py-0.5 rounded-full text-[10px]" :class="sub.canEnrollClass">
                                                {{ sub.canEnroll }}
                                            </span>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <!-- TAB 3: GRADES -->
                    <div v-if="activeTab === 'grades'" class="space-y-3">
                        <!-- Dropdown Filter Bar -->
                        <div class="p-3 bg-white rounded-lg border border-line flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                            <div class="flex flex-wrap items-center gap-4 text-xs">
                                <div class="flex items-center gap-2">
                                    <label class="font-semibold text-navy">School Year :</label>
                                    <select v-model="selectedSy" class="input text-xs py-1 px-2.5 rounded border-line bg-gray-50 font-medium text-navy">
                                        <option value="">Select School Year</option>
                                        <option v-for="sy in studentSchoolYears" :key="sy.value" :value="sy.value">
                                            {{ sy.label }}
                                        </option>
                                    </select>
                                </div>
                                <div class="flex items-center gap-2">
                                    <label class="font-semibold text-navy">Semester :</label>
                                    <select v-model="selectedSem" class="input text-xs py-1 px-2.5 rounded border-line bg-gray-50 font-medium text-navy">
                                        <option value="">Select Semester</option>
                                        <option value="1st Semester">1st Semester</option>
                                        <option value="2nd Semester">2nd Semester</option>
                                        <option value="Summer">Summer</option>
                                    </select>
                                </div>
                            </div>
                            <span class="text-xs font-bold text-green-700 bg-green-50 px-3 py-1 rounded-full border border-green-200">GWA: 1.25 (Good Standing)</span>
                        </div>

                        <div class="overflow-x-auto rounded-lg border border-line bg-white">
                            <table class="w-full text-left border-collapse text-[12px]">
                                <thead>
                                    <tr class="border-b border-line text-[10px] font-bold text-muted uppercase bg-gray-50">
                                        <th class="px-3 py-2.5">Code</th>
                                        <th class="px-3 py-2.5">Description</th>
                                        <th class="px-3 py-2.5 text-center">Units</th>
                                        <th class="px-3 py-2.5 text-center">Prelims</th>
                                        <th class="px-3 py-2.5 text-center">MidTerms</th>
                                        <th class="px-3 py-2.5 text-center">PreFinals</th>
                                        <th class="px-3 py-2.5 text-center">Finals</th>
                                        <th class="px-3 py-2.5 text-center">FinalGrade</th>
                                        <th class="px-3 py-2.5 text-center">Points</th>
                                        <th class="px-3 py-2.5 text-center">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-if="filteredGrades.length === 0">
                                        <td colspan="10" class="text-center py-8 text-muted">
                                            No grade records available for {{ selectedSy || 'selected year' }} - {{ selectedSem || 'selected semester' }}.
                                        </td>
                                    </tr>
                                    <tr v-for="g in filteredGrades" :key="g.code" class="border-b border-line hover:bg-mist transition-colors">
                                        <td class="px-3 py-2 font-bold text-navy whitespace-nowrap">{{ g.code }}</td>
                                        <td class="px-3 py-2 text-ink">{{ g.description }}</td>
                                        <td class="px-3 py-2 text-center font-semibold">{{ g.units }}</td>
                                        <td class="px-3 py-2 text-center">{{ g.prelims }}</td>
                                        <td class="px-3 py-2 text-center">{{ g.midterms }}</td>
                                        <td class="px-3 py-2 text-center">{{ g.prefinals }}</td>
                                        <td class="px-3 py-2 text-center">{{ g.finals }}</td>
                                        <td class="px-3 py-2 text-center font-bold text-navy">{{ g.finalGrade }}</td>
                                        <td class="px-3 py-2 text-center font-semibold text-navy">{{ g.points }}</td>
                                        <td class="px-3 py-2 text-center">
                                            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-700 border border-green-200">
                                                {{ g.status }}
                                            </span>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <!-- TAB 4: ENROLLMENT -->
                    <div v-if="activeTab === 'enrollment'" class="space-y-3">
                        <!-- Dropdown Filter Bar -->
                        <div class="p-3 bg-white rounded-lg border border-line flex flex-wrap items-center gap-4 text-xs">
                            <div class="flex items-center gap-2">
                                <label class="font-semibold text-navy">School Year :</label>
                                <select v-model="selectedSy" class="input text-xs py-1 px-2.5 rounded border-line bg-gray-50 font-medium text-navy">
                                    <option value="">Select School Year</option>
                                    <option v-for="sy in studentSchoolYears" :key="sy.value" :value="sy.value">
                                        {{ sy.label }}
                                    </option>
                                </select>
                            </div>
                            <div class="flex items-center gap-2">
                                <label class="font-semibold text-navy">Semester :</label>
                                <select v-model="selectedSem" class="input text-xs py-1 px-2.5 rounded border-line bg-gray-50 font-medium text-navy">
                                    <option value="">Select Semester</option>
                                    <option value="1st Semester">1st Semester</option>
                                    <option value="2nd Semester">2nd Semester</option>
                                    <option value="Summer">Summer</option>
                                </select>
                            </div>
                        </div>

                        <div class="p-3 bg-white rounded-lg border border-line grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                            <div>
                                <span class="text-muted block text-[10px]">Enrollment Status</span>
                                <span class="font-bold text-green-700">Enrolled (AY {{ selectedSy }} {{ selectedSem }})</span>
                            </div>
                            <div>
                                <span class="text-muted block text-[10px]">Reference No.</span>
                                <span class="font-bold text-navy">REF-{{ selectedSy ? selectedSy.split('-')[0] : '2026' }}-00891</span>
                            </div>
                            <div>
                                <span class="text-muted block text-[10px]">Total Enrolled Units</span>
                                <span class="font-bold text-navy">23.00 Units</span>
                            </div>
                            <div>
                                <span class="text-muted block text-[10px]">Date Enrolled</span>
                                <span class="font-bold text-navy">August 12, 2024</span>
                            </div>
                        </div>

                        <div class="overflow-x-auto rounded-lg border border-line bg-white">
                            <table class="w-full text-left border-collapse text-[12px]">
                                <thead>
                                    <tr class="border-b border-line text-[10px] font-bold text-muted uppercase bg-gray-50">
                                        <th class="px-4 py-2.5">Code</th>
                                        <th class="px-4 py-2.5">Description</th>
                                        <th class="px-4 py-2.5">Section</th>
                                        <th class="px-4 py-2.5">Schedule</th>
                                        <th class="px-4 py-2.5 text-center">Units</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-if="filteredGrades.length === 0">
                                        <td colspan="5" class="text-center py-6 text-muted">No enrolled subjects for {{ selectedSy }} - {{ selectedSem }}.</td>
                                    </tr>
                                    <tr v-for="g in filteredGrades" :key="g.code" class="border-b border-line hover:bg-mist">
                                        <td class="px-4 py-2 font-bold text-navy">{{ g.code }}</td>
                                        <td class="px-4 py-2 text-ink">{{ g.description }}</td>
                                        <td class="px-4 py-2 text-muted">BSIT-31E1</td>
                                        <td class="px-4 py-2 text-muted">MON/WED 08:00 AM - 10:00 AM</td>
                                        <td class="px-4 py-2 text-center font-semibold">{{ g.units }}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <!-- TAB 5: TUITION FEE -->
                    <div v-if="activeTab === 'tuition'" class="space-y-3">
                        <!-- Dropdown Filter Bar -->
                        <div class="p-3 bg-white rounded-lg border border-line flex flex-wrap items-center gap-4 text-xs">
                            <div class="flex items-center gap-2">
                                <label class="font-semibold text-navy">School Year :</label>
                                <select v-model="selectedSy" class="input text-xs py-1 px-2.5 rounded border-line bg-gray-50 font-medium text-navy">
                                    <option value="">Select School Year</option>
                                    <option v-for="sy in studentSchoolYears" :key="sy.value" :value="sy.value">
                                        {{ sy.label }}
                                    </option>
                                </select>
                            </div>
                            <div class="flex items-center gap-2">
                                <label class="font-semibold text-navy">Semester :</label>
                                <select v-model="selectedSem" class="input text-xs py-1 px-2.5 rounded border-line bg-gray-50 font-medium text-navy">
                                    <option value="">Select Semester</option>
                                    <option value="1st Semester">1st Semester</option>
                                    <option value="2nd Semester">2nd Semester</option>
                                    <option value="Summer">Summer</option>
                                </select>
                            </div>
                        </div>

                        <div class="p-4 bg-white rounded-lg border border-line space-y-3">
                            <div class="flex items-center justify-between border-b border-line pb-2">
                                <h4 class="font-bold text-navy text-sm">Tuition & Fee Assessment Summary ({{ selectedSy }} {{ selectedSem }})</h4>
                                <span class="px-2.5 py-1 bg-amber-50 text-amber-800 border border-amber-200 font-bold rounded-full text-xs flex items-center gap-1">
                                    <app-icon name="FileText" :size="12" /> Assessment Record · Registrar
                                </span>
                            </div>

                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                                <div class="p-3 bg-gray-50 rounded-lg border border-line">
                                    <span class="text-muted block text-[10px] font-medium">Total Assessment (Cash Basis)</span>
                                    <span class="text-lg font-bold text-navy">₱ 22,806.19</span>
                                </div>
                                <div class="p-3 bg-blue-50/50 rounded-lg border border-blue-100">
                                    <span class="text-muted block text-[10px] font-medium">Total Assessment (Installment Basis)</span>
                                    <span class="text-lg font-bold text-navy">₱ 24,632.14</span>
                                </div>
                            </div>

                            <div class="flex items-start gap-2 p-2.5 bg-slate-50 border border-line rounded-lg text-[11px] text-muted">
                                <app-icon name="Info" :size="14" class="mt-0.5 shrink-0 text-navy" />
                                <span>This is an official assessment preview from the COR. Payment status, official receipts, and account balances are processed and confirmed at the <strong>Finance / Cashier Office</strong>.</span>
                            </div>

                            <div class="border-t border-line pt-3">
                                <h5 class="font-bold text-xs text-navy mb-2">Fee Breakdown</h5>
                                <div class="space-y-1.5 text-xs text-muted">
                                    <div class="flex justify-between"><span>Tuition Fee (23 Units x ₱ 750.00)</span><span class="font-semibold text-ink">₱ 17,250.00</span></div>
                                    <div class="flex justify-between"><span>Miscellaneous Fees</span><span class="font-semibold text-ink">₱ 4,250.00</span></div>
                                    <div class="flex justify-between"><span>Computer Laboratory Fee</span><span class="font-semibold text-ink">₱ 3,000.00</span></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <template #footer>
                    <div class="flex items-center justify-end w-full">
                        <button type="button" @click="viewingStudent = null" class="btn btn-secondary btn-sm text-[11px]">Close</button>
                    </div>
                </template>
            </app-modal>
        </div>
    `
};
