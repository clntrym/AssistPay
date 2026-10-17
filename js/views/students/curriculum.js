const RegistrarCurriculumPage = {
    components: { PageHeader, AppIcon, AppModal },
    setup() {
        const programs = Vue.ref([]);
        const courses = Vue.ref([]);
        const globalSummary = Vue.ref({
            total_subjects: 0,
            major_subjects: 0,
            minor_subjects: 0,
            unclassified_subjects: 0
        });
        const programFilter = Vue.ref('ALL'); // ALL | UNCLASSIFIED | CLASSIFIED
        const programSearch = Vue.ref('');

        const isCurriculumModalOpen = Vue.ref(false);
        const loading = Vue.ref(false);
        const newCurriculum = Vue.reactive({
            course_id: '',
            curriculum_code: '',
            total_units: '',
            effective_sy: ''
        });

        const canManageClassification = Vue.computed(() => {
            const role = Store.user?.role;
            return role === 'REGISTRAR' || role === 'ADMIN';
        });

        // View Curriculum Table state
        const isViewModalOpen = Vue.ref(false);
        const viewingProgram = Vue.ref(null);
        const viewCurriculum = Vue.ref(null);
        const viewSubjects = Vue.ref([]);
        const loadingSubjects = Vue.ref(false);
        const subjectClassificationFilter = Vue.ref('ALL'); // ALL | MAJOR | MINOR | UNCLASSIFIED
        const subjectSearchQuery = Vue.ref('');
        const selectedSubjectIds = Vue.ref([]);
        const updatingSubjectId = Vue.ref(null);
        const bulkUpdating = Vue.ref(false);

        // Global Unclassified / Subject Classification Review Modal state
        const isReviewModalOpen = Vue.ref(false);
        const reviewLoading = Vue.ref(false);
        const reviewSubjects = Vue.ref([]);
        const reviewCurriculumFilter = Vue.ref(0);
        const reviewClassificationFilter = Vue.ref('UNCLASSIFIED');
        const reviewSearchQuery = Vue.ref('');
        const reviewSelectedIds = Vue.ref([]);

        // Add/Edit Subject state
        const isSubjectModalOpen = Vue.ref(false);
        const savingSubject = Vue.ref(false);
        const newSubject = Vue.reactive({
            subject_id: null,
            curriculum_id: '',
            subject_code: '',
            description: '',
            units: 3,
            classification: '',
            year_level: 1,
            semester: 1,
            prereq_code: ''
        });

        const filteredPrograms = Vue.computed(() => {
            const q = programSearch.value.trim().toLowerCase();
            return programs.value.filter(p => {
                if (programFilter.value === 'UNCLASSIFIED' && p.unclassifiedSubjects === 0) return false;
                if (programFilter.value === 'CLASSIFIED' && (p.totalSubjects === 0 || p.unclassifiedSubjects > 0)) return false;
                if (!q) return true;
                return (
                    (p.code || '').toLowerCase().includes(q) ||
                    (p.title || '').toLowerCase().includes(q) ||
                    (p.curriculumCode || '').toLowerCase().includes(q)
                );
            });
        });

        // Counts for the currently opened curriculum (unfiltered across all subjects in viewSubjects)
        const curriculumCounts = Vue.computed(() => {
            let major = 0;
            let minor = 0;
            let unclassified = 0;
            viewSubjects.value.forEach(s => {
                if (s.classification === 'MAJOR') major++;
                else if (s.classification === 'MINOR') minor++;
                else unclassified++;
            });
            const total = viewSubjects.value.length;
            return {
                total,
                major,
                minor,
                unclassified,
                allClassified: total > 0 && unclassified === 0
            };
        });

        // Filtered subjects inside the Curriculum Table Modal
        const filteredViewSubjects = Vue.computed(() => {
            const filter = subjectClassificationFilter.value;
            const q = subjectSearchQuery.value.trim().toLowerCase();
            return viewSubjects.value.filter(sub => {
                if (filter === 'MAJOR' && sub.classification !== 'MAJOR') return false;
                if (filter === 'MINOR' && sub.classification !== 'MINOR') return false;
                if (filter === 'UNCLASSIFIED' && (sub.classification === 'MAJOR' || sub.classification === 'MINOR')) return false;
                if (!q) return true;
                return (
                    (sub.subject_code || '').toLowerCase().includes(q) ||
                    (sub.description || '').toLowerCase().includes(q)
                );
            });
        });

        // Computed: group filtered subjects by year+semester
        const groupedSubjects = Vue.computed(() => {
            const groups = {};
            filteredViewSubjects.value.forEach(sub => {
                const semLabel = sub.sem == 1 ? '1st Semester' : (sub.sem == 2 ? '2nd Semester' : (sub.sem == 3 ? 'Summer / Mid-Year' : `Semester ${sub.sem}`));
                const key = `Year ${sub.year} - ${semLabel}`;
                if (!groups[key]) groups[key] = [];
                groups[key].push(sub);
            });
            return groups;
        });

        const fetchData = async () => {
            const res = await Model.request('students/get_curriculum', 'list');
            if (res.success) {
                programs.value = (res.curriculums || []).map(c => ({
                    curriculum_id: c.curriculum_id,
                    code: c.course_code,
                    title: c.course_name,
                    curriculumCode: c.curriculum_code,
                    totalUnits: parseFloat(c.total_units || 0).toFixed(2),
                    effectiveSy: c.effective_sy,
                    totalSubjects: parseInt(c.total_subjects || 0, 10),
                    majorSubjects: parseInt(c.major_subjects || 0, 10),
                    minorSubjects: parseInt(c.minor_subjects || 0, 10),
                    unclassifiedSubjects: parseInt(c.unclassified_subjects || 0, 10),
                    badgeColor: c.style?.badgeColor || 'bg-navy',
                    badgeText: c.style?.badgeText || 'text-white',
                    iconColor: c.style?.iconColor || 'bg-blue-50 text-blue-500'
                }));
                courses.value = res.courses || [];
                if (res.summary) {
                    globalSummary.value = res.summary;
                }
            }
        };

        Vue.onMounted(fetchData);

        const openAddCurriculum = () => {
            newCurriculum.course_id = '';
            newCurriculum.curriculum_code = '';
            newCurriculum.total_units = '';
            newCurriculum.effective_sy = '';
            isCurriculumModalOpen.value = true;
        };

        const saveCurriculum = async () => {
            loading.value = true;
            const res = await Model.request('students/get_curriculum', 'add_curriculum', {
                course_id: newCurriculum.course_id,
                curriculum_code: newCurriculum.curriculum_code,
                effective_sy: newCurriculum.effective_sy,
                total_units: newCurriculum.total_units
            });
            loading.value = false;
            if (res.success) {
                Store.toast('success', res.message);
                isCurriculumModalOpen.value = false;
                await fetchData();
            } else {
                Store.toast('danger', res.message);
            }
        };

        // View Curriculum Table
        const openViewModal = async (prog, initialFilter = 'ALL') => {
            viewingProgram.value = prog;
            loadingSubjects.value = true;
            isViewModalOpen.value = true;
            viewSubjects.value = [];
            viewCurriculum.value = null;
            subjectClassificationFilter.value = initialFilter;
            subjectSearchQuery.value = '';
            selectedSubjectIds.value = [];

            const res = await Model.request('students/get_curriculum', 'get_structure', {
                curriculum_id: prog.curriculum_id
            });
            loadingSubjects.value = false;
            if (res.success) {
                viewCurriculum.value = res.curriculum;
                viewSubjects.value = res.subjects || [];
            } else {
                Store.toast('danger', res.message || 'Failed to load curriculum');
            }
        };

        // Inline / Quick Classification Update
        const quickClassifySubject = async (sub, classification) => {
            if (!canManageClassification.value) return;
            if (classification !== 'MAJOR' && classification !== 'MINOR') {
                Store.toast('danger', 'Classification must be MAJOR or MINOR.');
                return;
            }
            updatingSubjectId.value = sub.subject_id;
            const res = await Model.request('students/get_curriculum', 'update_classification', {
                subject_id: sub.subject_id,
                classification
            });
            updatingSubjectId.value = null;
            if (res.success) {
                sub.classification = classification;
                Store.toast('success', res.message);
                await fetchData();
                if (viewingProgram.value) {
                    const updatedProg = programs.value.find(p => p.curriculum_id == viewingProgram.value.curriculum_id);
                    if (updatedProg) viewingProgram.value = updatedProg;
                }
            } else {
                Store.toast('danger', res.message || 'Failed to update classification');
            }
        };

        const toggleSelectGroup = (subjectsInGroup, checked) => {
            const ids = subjectsInGroup.map(s => s.subject_id);
            if (checked) {
                const merged = new Set([...selectedSubjectIds.value, ...ids]);
                selectedSubjectIds.value = Array.from(merged);
            } else {
                selectedSubjectIds.value = selectedSubjectIds.value.filter(id => !ids.includes(id));
            }
        };

        const isGroupAllSelected = (subjectsInGroup) => {
            if (!subjectsInGroup || !subjectsInGroup.length) return false;
            return subjectsInGroup.every(s => selectedSubjectIds.value.includes(s.subject_id));
        };

        const bulkClassifyInCurriculum = async (classification) => {
            if (!selectedSubjectIds.value.length) return;
            if (classification !== 'MAJOR' && classification !== 'MINOR') return;

            bulkUpdating.value = true;
            const res = await Model.request('students/get_curriculum', 'bulk_update_classification', {
                subject_ids: selectedSubjectIds.value,
                classification
            });
            bulkUpdating.value = false;
            if (res.success) {
                const idSet = new Set(selectedSubjectIds.value);
                viewSubjects.value.forEach(s => {
                    if (idSet.has(s.subject_id)) s.classification = classification;
                });
                selectedSubjectIds.value = [];
                Store.toast('success', res.message);
                await fetchData();
            } else {
                Store.toast('danger', res.message || 'Bulk classification failed');
            }
        };

        // Global Review Unclassified / All Subjects Modal
        const fetchReviewSubjects = async () => {
            reviewLoading.value = true;
            reviewSelectedIds.value = [];
            const res = await Model.request('students/get_curriculum', 'list_subjects_review', {
                curriculum_id: reviewCurriculumFilter.value || 0,
                classification: reviewClassificationFilter.value,
                search: reviewSearchQuery.value
            });
            reviewLoading.value = false;
            if (res.success) {
                reviewSubjects.value = res.subjects || [];
            } else {
                Store.toast('danger', res.message || 'Failed to load subjects for review');
            }
        };

        const openReviewModal = async (initialClassification = 'UNCLASSIFIED', curriculumId = 0) => {
            reviewClassificationFilter.value = initialClassification;
            reviewCurriculumFilter.value = curriculumId;
            reviewSearchQuery.value = '';
            isReviewModalOpen.value = true;
            await fetchReviewSubjects();
        };

        const classifyFromReview = async (sub, classification) => {
            updatingSubjectId.value = sub.subject_id;
            const res = await Model.request('students/get_curriculum', 'update_classification', {
                subject_id: sub.subject_id,
                classification
            });
            updatingSubjectId.value = null;
            if (res.success) {
                sub.classification = classification;
                Store.toast('success', res.message);
                await fetchData();
                if (reviewClassificationFilter.value === 'UNCLASSIFIED') {
                    reviewSubjects.value = reviewSubjects.value.filter(r => r.subject_id !== sub.subject_id);
                }
            } else {
                Store.toast('danger', res.message || 'Failed to classify subject');
            }
        };

        const bulkClassifyInReview = async (classification) => {
            if (!reviewSelectedIds.value.length) return;
            bulkUpdating.value = true;
            const res = await Model.request('students/get_curriculum', 'bulk_update_classification', {
                subject_ids: reviewSelectedIds.value,
                classification
            });
            bulkUpdating.value = false;
            if (res.success) {
                Store.toast('success', res.message);
                reviewSelectedIds.value = [];
                await fetchData();
                await fetchReviewSubjects();
            } else {
                Store.toast('danger', res.message || 'Bulk classification failed');
            }
        };

        const toggleSelectAllReview = (checked) => {
            if (checked) {
                reviewSelectedIds.value = reviewSubjects.value.map(s => s.subject_id);
            } else {
                reviewSelectedIds.value = [];
            }
        };

        // Add / Edit / Archive Subject
        const openAddSubject = () => {
            newSubject.subject_id = null;
            newSubject.curriculum_id = viewingProgram.value?.curriculum_id || '';
            newSubject.subject_code = '';
            newSubject.description = '';
            newSubject.units = 3;
            newSubject.classification = '';
            newSubject.year_level = 1;
            newSubject.semester = 1;
            newSubject.prereq_code = '';
            isSubjectModalOpen.value = true;
        };

        const openEditSubject = (sub) => {
            newSubject.subject_id = sub.subject_id;
            newSubject.curriculum_id = sub.curriculum_id;
            newSubject.subject_code = sub.subject_code;
            newSubject.description = sub.description;
            newSubject.units = parseFloat(sub.units || 3);
            newSubject.classification = sub.classification || '';
            newSubject.year_level = sub.year;
            newSubject.semester = sub.sem;
            newSubject.prereq_code = sub.prereq === '—' ? '' : sub.prereq;
            isSubjectModalOpen.value = true;
        };

        const archiveSubject = async (sub) => {
            const ok = await Alerts.confirm({
                title: "Archive Subject?",
                html: `Are you sure you want to archive <b>${Alerts.esc(sub.subject_code)}</b> (${Alerts.esc(sub.description)})?`,
                icon: "warning",
                danger: true,
                confirmText: "Archive"
            });
            if (!ok) return;

            const res = await Model.request('students/get_curriculum', 'delete_subject', {
                subject_id: sub.subject_id
            });
            if (res.success) {
                Store.toast('success', res.message);
                await openViewModal(viewingProgram.value, subjectClassificationFilter.value);
                await fetchData();
            } else {
                Store.toast('danger', res.message || 'Failed to archive subject');
            }
        };

        const saveSubject = async () => {
            if (newSubject.classification !== 'MAJOR' && newSubject.classification !== 'MINOR') {
                Store.toast('danger', 'Please select a valid Subject Classification (MAJOR or MINOR).');
                return;
            }
            savingSubject.value = true;
            const action = newSubject.subject_id ? 'edit_subject' : 'add_subject';
            const payload = {
                subject_id: newSubject.subject_id,
                curriculum_id: newSubject.curriculum_id,
                subject_code: newSubject.subject_code,
                description: newSubject.description,
                units: newSubject.units,
                classification: newSubject.classification,
                year_level: newSubject.year_level,
                semester: newSubject.semester,
                prereq_code: newSubject.prereq_code
            };
            const res = await Model.request('students/get_curriculum', action, payload);
            savingSubject.value = false;
            if (res.success) {
                Store.toast('success', res.message);
                isSubjectModalOpen.value = false;
                // Refresh subjects table
                await openViewModal(viewingProgram.value, subjectClassificationFilter.value);
                await fetchData();
            } else {
                Store.toast('danger', res.message);
            }
        };

        const classificationBadgeClass = (classification) => {
            if (classification === 'MAJOR') return 'bg-navy text-white border-navy';
            if (classification === 'MINOR') return 'bg-teal-50 text-teal-800 border-teal-200';
            return 'bg-amber-50 text-amber-800 border-amber-300';
        };

        return {
            programs, filteredPrograms, courses, globalSummary,
            programFilter, programSearch,
            newCurriculum, isCurriculumModalOpen, loading,
            canManageClassification,
            openAddCurriculum, saveCurriculum,
            // View modal
            isViewModalOpen, viewingProgram, viewCurriculum, viewSubjects, filteredViewSubjects,
            loadingSubjects, groupedSubjects, curriculumCounts,
            subjectClassificationFilter, subjectSearchQuery,
            selectedSubjectIds, updatingSubjectId, bulkUpdating,
            openViewModal, quickClassifySubject, toggleSelectGroup, isGroupAllSelected, bulkClassifyInCurriculum,
            // Global Review modal
            isReviewModalOpen, reviewLoading, reviewSubjects,
            reviewCurriculumFilter, reviewClassificationFilter, reviewSearchQuery, reviewSelectedIds,
            openReviewModal, fetchReviewSubjects, classifyFromReview, bulkClassifyInReview, toggleSelectAllReview,
            // Add / Edit / Archive subject
            isSubjectModalOpen, savingSubject, newSubject,
            openAddSubject, openEditSubject, archiveSubject, saveSubject,
            classificationBadgeClass
        };
    },
    template: `
        <div>
            <div>
                <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                    <div>
                        <h2 class="text-2xl font-bold text-navy mb-1">Academic Curriculum & Subject Classification</h2>
                        <p class="text-muted text-sm">Manage degree program curriculums, prerequisite maps, and official <strong>MAJOR / MINOR</strong> subject classifications for Grades Monitoring.</p>
                    </div>
                    <div class="flex flex-wrap items-center gap-2.5">
                        <button v-if="canManageClassification" @click="openReviewModal('UNCLASSIFIED', 0)" class="btn btn-secondary rounded-lg font-semibold px-4 py-2 flex items-center gap-2 border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100">
                            <app-icon name="CheckSquare" :size="16" />
                            <span>Review Unclassified Subjects</span>
                            <span v-if="globalSummary.unclassified_subjects > 0" class="px-2 py-0.5 text-[11px] font-bold rounded-full bg-amber-200 text-amber-950">
                                {{ globalSummary.unclassified_subjects }}
                            </span>
                        </button>
                        <button v-if="canManageClassification" @click="openAddCurriculum" class="btn btn-primary bg-navy text-white hover:bg-navy-700 rounded-lg font-semibold px-4 py-2 flex items-center gap-2">
                            <app-icon name="Plus" :size="16" /> Add Curriculum
                        </button>
                    </div>
                </div>

                <!-- Global Subject Classification Summary Banner -->
                <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                    <div class="bg-white rounded-xl border border-line p-4 flex items-center justify-between">
                        <div>
                            <p class="text-xs font-semibold text-muted uppercase tracking-wider">Total Subjects</p>
                            <p class="text-2xl font-bold text-navy mt-1">{{ globalSummary.total_subjects }}</p>
                            <p class="text-[11px] text-muted mt-0.5">Across {{ programs.length }} curriculum(s)</p>
                        </div>
                        <div class="w-10 h-10 rounded-lg bg-mist text-navy flex items-center justify-center">
                            <app-icon name="BookOpen" :size="20" />
                        </div>
                    </div>
                    <div class="bg-white rounded-xl border border-line p-4 flex items-center justify-between cursor-pointer hover:border-navy/40 transition-colors" @click="openReviewModal('MAJOR', 0)">
                        <div>
                            <p class="text-xs font-semibold text-navy uppercase tracking-wider">Major Subjects</p>
                            <p class="text-2xl font-bold text-navy mt-1">{{ globalSummary.major_subjects }}</p>
                            <p class="text-[11px] text-muted mt-0.5">Official MAJOR classification</p>
                        </div>
                        <span class="px-2.5 py-1 text-[11px] font-bold rounded bg-navy text-white">MAJOR</span>
                    </div>
                    <div class="bg-white rounded-xl border border-line p-4 flex items-center justify-between cursor-pointer hover:border-teal-400 transition-colors" @click="openReviewModal('MINOR', 0)">
                        <div>
                            <p class="text-xs font-semibold text-teal-800 uppercase tracking-wider">Minor Subjects</p>
                            <p class="text-2xl font-bold text-teal-800 mt-1">{{ globalSummary.minor_subjects }}</p>
                            <p class="text-[11px] text-muted mt-0.5">Official MINOR classification</p>
                        </div>
                        <span class="px-2.5 py-1 text-[11px] font-bold rounded bg-teal-50 text-teal-800 border border-teal-200">MINOR</span>
                    </div>
                    <div class="rounded-xl border p-4 flex items-center justify-between cursor-pointer transition-colors"
                         :class="globalSummary.unclassified_subjects > 0 ? 'bg-amber-50/70 border-amber-300 hover:bg-amber-50' : 'bg-green-50/70 border-green-200'"
                         @click="openReviewModal('UNCLASSIFIED', 0)">
                        <div>
                            <p class="text-xs font-semibold uppercase tracking-wider" :class="globalSummary.unclassified_subjects > 0 ? 'text-amber-900' : 'text-green-800'">
                                {{ globalSummary.unclassified_subjects > 0 ? 'Unclassified Subjects' : 'Classification Status' }}
                            </p>
                            <p class="text-2xl font-bold mt-1" :class="globalSummary.unclassified_subjects > 0 ? 'text-amber-900' : 'text-green-800'">
                                {{ globalSummary.unclassified_subjects }}
                            </p>
                            <p class="text-[11px] mt-0.5" :class="globalSummary.unclassified_subjects > 0 ? 'text-amber-800 font-medium' : 'text-green-700'">
                                {{ globalSummary.unclassified_subjects > 0 ? 'Click to review & classify' : 'All subjects classified' }}
                            </p>
                        </div>
                        <div class="w-10 h-10 rounded-lg flex items-center justify-center" :class="globalSummary.unclassified_subjects > 0 ? 'bg-amber-200/70 text-amber-900' : 'bg-green-200/70 text-green-800'">
                            <app-icon :name="globalSummary.unclassified_subjects > 0 ? 'AlertTriangle' : 'CheckCircle2'" :size="20" />
                        </div>
                    </div>
                </div>

                <!-- Program Filter & Search Bar -->
                <div class="bg-white rounded-xl border border-line p-3.5 mb-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                    <div class="flex flex-wrap items-center gap-1.5">
                        <button @click="programFilter = 'ALL'"
                                class="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                                :class="programFilter === 'ALL' ? 'bg-navy text-white' : 'bg-mist/60 text-ink hover:bg-mist'">
                            All Programs ({{ programs.length }})
                        </button>
                        <button @click="programFilter = 'UNCLASSIFIED'"
                                class="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5"
                                :class="programFilter === 'UNCLASSIFIED' ? 'bg-amber-600 text-white' : 'bg-amber-50 text-amber-900 border border-amber-200 hover:bg-amber-100'">
                            <span>Needs Classification</span>
                            <span class="px-1.5 py-0.2 rounded-full text-[10px]" :class="programFilter === 'UNCLASSIFIED' ? 'bg-white/20 text-white' : 'bg-amber-200 text-amber-950'">
                                {{ programs.filter(p => p.unclassifiedSubjects > 0).length }}
                            </span>
                        </button>
                        <button @click="programFilter = 'CLASSIFIED'"
                                class="px-3 py-1.5 rounded-lg text-xs font-bold transition-colors"
                                :class="programFilter === 'CLASSIFIED' ? 'bg-green-700 text-white' : 'bg-green-50 text-green-800 border border-green-200 hover:bg-green-100'">
                            Fully Classified ({{ programs.filter(p => p.totalSubjects > 0 && p.unclassifiedSubjects === 0).length }})
                        </button>
                    </div>
                    <div class="relative w-full sm:w-72">
                        <app-icon name="Search" :size="15" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                        <input v-model="programSearch" type="search" placeholder="Search program or curriculum code..." class="input pl-9 py-1.5 text-xs" />
                    </div>
                </div>
                
                <!-- Empty State -->
                <div v-if="filteredPrograms.length === 0" class="text-center py-16 text-muted bg-white rounded-xl border border-line">
                    <app-icon name="BookOpen" :size="48" class="mx-auto mb-4 text-disabled" />
                    <p class="text-lg font-semibold text-navy mb-1">No Matching Curriculums Found</p>
                    <p class="text-sm">Try adjusting your filter or click "Add Curriculum" to create a new program curriculum.</p>
                </div>

                <!-- Program Cards Grid -->
                <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
                    <div v-for="prog in filteredPrograms" :key="prog.curriculum_id" 
                        class="bg-white rounded-xl border border-line p-5 hover:shadow-card hover:border-mist transition-all flex flex-col cursor-pointer"
                        @click="openViewModal(prog)">
                        
                        <div class="flex items-start justify-between gap-2 mb-4">
                            <div class="w-12 h-12 rounded-lg flex items-center justify-center" :class="prog.iconColor">
                                <app-icon name="BookOpen" :size="22" />
                            </div>
                            <span v-if="prog.unclassifiedSubjects > 0"
                                  @click.stop="openViewModal(prog, 'UNCLASSIFIED')"
                                  title="Click to review unclassified subjects in this curriculum"
                                  class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200">
                                {{ prog.unclassifiedSubjects }} Unclassified
                            </span>
                            <span v-else-if="prog.totalSubjects > 0"
                                  class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-green-100 text-green-800 border border-green-200">
                                All Classified
                            </span>
                        </div>
                        
                        <div class="mb-2">
                            <span class="text-xs font-bold px-2 py-1 rounded" :class="[prog.badgeColor, prog.badgeText]">
                                {{ prog.code }}
                            </span>
                        </div>
                        
                        <h3 class="text-lg font-bold text-navy leading-tight mb-3 flex-1">
                            {{ prog.title }}
                        </h3>
                        
                        <div class="text-[12px] text-muted space-y-1 mb-4">
                            <p>Curriculum Code: <span class="font-semibold text-ink">{{ prog.curriculumCode }}</span></p>
                            <p>Total Units: <span class="font-semibold text-ink">{{ prog.totalUnits }}</span> | SY {{ prog.effectiveSy }}</p>
                        </div>

                        <!-- Classification Breakdown Pills -->
                        <div class="flex flex-wrap items-center gap-1.5 mb-4 pt-3 border-t border-line/60 text-[11px]">
                            <span class="px-2 py-0.5 rounded bg-navy/10 text-navy font-bold">
                                Major: {{ prog.majorSubjects }}
                            </span>
                            <span class="px-2 py-0.5 rounded bg-teal-50 text-teal-800 border border-teal-200 font-bold">
                                Minor: {{ prog.minorSubjects }}
                            </span>
                            <span class="px-2 py-0.5 rounded bg-gray-100 text-muted font-semibold ml-auto">
                                {{ prog.totalSubjects }} subj
                            </span>
                        </div>
                        
                        <div class="mt-auto border-t border-line pt-3.5 flex items-center justify-between">
                            <a href="#" @click.stop.prevent="openViewModal(prog)" class="text-[13px] font-bold text-navy hover:text-gold flex items-center gap-1 transition-colors">
                                <app-icon name="Table" :size="14" /> View Curriculum Table
                            </a>
                            <button v-if="prog.unclassifiedSubjects > 0"
                                    @click.stop="openViewModal(prog, 'UNCLASSIFIED')"
                                    class="text-[11px] font-bold text-amber-800 hover:underline">
                                Classify Now →
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- ================= ADD CURRICULUM MODAL ================= -->
            <app-modal :open="isCurriculumModalOpen" title="Add New Curriculum" icon="BookOpen" size="md" @close="isCurriculumModalOpen = false">
                <form id="addCurriculumForm" @submit.prevent="saveCurriculum" class="space-y-4 text-xs text-ink">
                    <div class="p-3 bg-white rounded-lg border border-line space-y-3">
                        <div>
                            <label class="field-label font-semibold">Course Program :</label>
                            <select v-model="newCurriculum.course_id" class="input text-xs" required>
                                <option value="">Select Course</option>
                                <option v-for="c in courses" :key="c.course_id" :value="c.course_id">
                                    {{ c.course_code }} - {{ c.course_name }}
                                </option>
                            </select>
                        </div>
                        <div>
                            <label class="field-label font-semibold">Curriculum Code :</label>
                            <input type="text" v-model="newCurriculum.curriculum_code" placeholder="e.g. BSIT-2024" class="input text-xs" required />
                        </div>
                        <div>
                            <label class="field-label font-semibold">Effective School Year :</label>
                            <input type="text" v-model="newCurriculum.effective_sy" placeholder="e.g. 2024-2025" class="input text-xs" required />
                        </div>
                    </div>
                </form>

                <template #footer>
                    <div class="flex items-center justify-end w-full gap-2 text-xs">
                        <button type="button" @click="isCurriculumModalOpen = false" class="btn btn-secondary btn-sm text-[11px]">
                            Cancel
                        </button>
                        <button type="submit" form="addCurriculumForm" class="btn btn-primary btn-sm text-[11px] bg-navy" :disabled="loading">
                            <app-icon name="Save" :size="13" /> {{ loading ? 'Saving...' : 'Save Curriculum' }}
                        </button>
                    </div>
                </template>
            </app-modal>

            <!-- ================= VIEW CURRICULUM TABLE MODAL ================= -->
            <app-modal :open="isViewModalOpen" :title="viewingProgram ? (viewingProgram.code + ' - Curriculum & Subject Classification') : 'Curriculum Table'" icon="Table" size="full" @close="isViewModalOpen = false">
                <div v-if="viewingProgram" class="space-y-4">
                    <!-- Curriculum Info Banner -->
                    <div class="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3 p-3.5 bg-[#f5f8fc] border border-[#d2dfef] rounded-lg">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-lg flex items-center justify-center" :class="viewingProgram.iconColor">
                                <app-icon name="BookOpen" :size="20" />
                            </div>
                            <div>
                                <h3 class="text-sm font-bold text-navy">{{ viewingProgram.title }}</h3>
                                <p class="text-[11px] text-muted">
                                    Curriculum: <span class="font-semibold text-ink">{{ viewingProgram.curriculumCode }}</span> |
                                    Total Units: <span class="font-semibold text-ink">{{ viewingProgram.totalUnits }}</span> |
                                    Effective SY: <span class="font-semibold text-ink">{{ viewingProgram.effectiveSy }}</span>
                                </p>
                            </div>
                        </div>
                        <div class="flex flex-wrap items-center gap-2">
                            <!-- Validation Status Pill -->
                            <div v-if="curriculumCounts.unclassified > 0"
                                 class="px-3 py-1 rounded-full bg-amber-100 border border-amber-300 text-amber-900 text-[11px] font-bold flex items-center gap-1.5">
                                <app-icon name="AlertTriangle" :size="13" />
                                <span>{{ curriculumCounts.unclassified }} subject(s) require official MAJOR / MINOR classification</span>
                            </div>
                            <div v-else-if="curriculumCounts.total > 0"
                                 class="px-3 py-1 rounded-full bg-green-100 border border-green-200 text-green-800 text-[11px] font-bold flex items-center gap-1.5">
                                <app-icon name="CheckCircle2" :size="13" />
                                <span>All {{ curriculumCounts.total }} subjects have valid classification</span>
                            </div>

                            <button v-if="canManageClassification" @click="openAddSubject" class="btn btn-sm bg-gold text-navy hover:bg-yellow-500 rounded-full font-bold px-4 text-[11px]">
                                <app-icon name="Plus" :size="14" /> Add Subject
                            </button>
                        </div>
                    </div>

                    <!-- Filter by Major / Minor / Unclassified + Search Bar -->
                    <div class="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 bg-white p-3 rounded-lg border border-line">
                        <div class="flex flex-wrap items-center gap-1.5">
                            <span class="text-[11px] font-bold text-muted uppercase mr-1">Filter Classification:</span>
                            <button @click="subjectClassificationFilter = 'ALL'"
                                    class="px-3 py-1 rounded-full text-xs font-bold border transition-colors"
                                    :class="subjectClassificationFilter === 'ALL' ? 'bg-navy text-white border-navy' : 'bg-white text-ink border-line hover:bg-mist'">
                                All ({{ curriculumCounts.total }})
                            </button>
                            <button @click="subjectClassificationFilter = 'MAJOR'"
                                    class="px-3 py-1 rounded-full text-xs font-bold border transition-colors"
                                    :class="subjectClassificationFilter === 'MAJOR' ? 'bg-navy text-white border-navy' : 'bg-navy/5 text-navy border-navy/20 hover:bg-navy/10'">
                                MAJOR ({{ curriculumCounts.major }})
                            </button>
                            <button @click="subjectClassificationFilter = 'MINOR'"
                                    class="px-3 py-1 rounded-full text-xs font-bold border transition-colors"
                                    :class="subjectClassificationFilter === 'MINOR' ? 'bg-teal-700 text-white border-teal-700' : 'bg-teal-50 text-teal-800 border-teal-200 hover:bg-teal-100'">
                                MINOR ({{ curriculumCounts.minor }})
                            </button>
                            <button @click="subjectClassificationFilter = 'UNCLASSIFIED'"
                                    class="px-3 py-1 rounded-full text-xs font-bold border transition-colors"
                                    :class="subjectClassificationFilter === 'UNCLASSIFIED' ? 'bg-amber-600 text-white border-amber-600' : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'">
                                Unclassified ({{ curriculumCounts.unclassified }})
                            </button>
                        </div>

                        <div class="flex items-center gap-2">
                            <div class="relative w-full md:w-64">
                                <app-icon name="Search" :size="14" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                                <input v-model="subjectSearchQuery" type="search" placeholder="Filter by code or description..." class="input pl-8 py-1 text-xs" />
                            </div>
                        </div>
                    </div>

                    <!-- Bulk Classification Bar (when subjects are checked) -->
                    <div v-if="canManageClassification && selectedSubjectIds.length > 0"
                         class="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-navy text-white text-xs shadow-sm">
                        <div class="flex items-center gap-2 font-semibold">
                            <app-icon name="CheckSquare" :size="15" />
                            <span>{{ selectedSubjectIds.length }} subject(s) selected for official classification</span>
                        </div>
                        <div class="flex items-center gap-2">
                            <button @click="bulkClassifyInCurriculum('MAJOR')" :disabled="bulkUpdating"
                                    class="px-3 py-1 rounded bg-gold text-navy font-bold hover:bg-yellow-400 transition-colors">
                                Classify Selected as MAJOR
                            </button>
                            <button @click="bulkClassifyInCurriculum('MINOR')" :disabled="bulkUpdating"
                                    class="px-3 py-1 rounded bg-teal-500 text-white font-bold hover:bg-teal-400 transition-colors">
                                Classify Selected as MINOR
                            </button>
                            <button @click="selectedSubjectIds = []" class="px-2.5 py-1 rounded bg-white/10 text-white hover:bg-white/20">
                                Clear
                            </button>
                        </div>
                    </div>

                    <!-- Loading -->
                    <div v-if="loadingSubjects" class="text-center py-12 text-muted">
                        <p class="text-sm">Loading subjects...</p>
                    </div>

                    <!-- Empty State -->
                    <div v-else-if="filteredViewSubjects.length === 0" class="text-center py-12 text-muted bg-white rounded-lg border border-line">
                        <app-icon name="FileText" :size="40" class="mx-auto mb-3 text-disabled" />
                        <p class="text-sm font-semibold text-navy mb-1">No Matching Subjects Found</p>
                        <p class="text-xs" v-if="viewSubjects.length === 0">Click "Add Subject" to start building this curriculum.</p>
                        <p class="text-xs" v-else>No subjects match the selected classification filter ({{ subjectClassificationFilter }}).</p>
                    </div>

                    <!-- Subjects Table grouped by Year/Semester -->
                    <div v-else class="space-y-5">
                        <div v-for="(subjects, groupLabel) in groupedSubjects" :key="groupLabel">
                            <div class="flex items-center justify-between gap-2 mb-2">
                                <div class="flex items-center gap-2">
                                    <span class="text-xs font-bold text-navy bg-mist px-3 py-1 rounded-full">{{ groupLabel }}</span>
                                    <span class="text-[11px] text-muted">({{ subjects.length }} subject{{ subjects.length > 1 ? 's' : '' }})</span>
                                </div>
                            </div>
                            <div class="overflow-x-auto touch-scroll table-scroll rounded-lg border border-line bg-white">
                                <table class="w-full min-w-[780px] text-left border-collapse">
                                    <thead>
                                        <tr class="border-b border-line text-[10px] font-bold text-muted uppercase bg-gray-50/80">
                                            <th v-if="canManageClassification" class="px-3 py-3 w-10 text-center">
                                                <input type="checkbox"
                                                       :checked="isGroupAllSelected(subjects)"
                                                       @change="toggleSelectGroup(subjects, $event.target.checked)"
                                                       class="rounded border-line cursor-pointer"
                                                       title="Select all subjects in this semester" />
                                            </th>
                                            <th class="px-3 py-3 whitespace-nowrap w-14">Year</th>
                                            <th class="px-3 py-3 whitespace-nowrap w-16">Sem</th>
                                            <th class="px-4 py-3 whitespace-nowrap w-28">Code</th>
                                            <th class="px-4 py-3">Description</th>
                                            <th class="px-3 py-3 whitespace-nowrap w-16 text-center">Units</th>
                                            <th class="px-4 py-3 whitespace-nowrap w-44 text-center">Classification</th>
                                            <th class="px-4 py-3 whitespace-nowrap w-28">PreReq</th>
                                            <th v-if="canManageClassification" class="px-3 py-3 whitespace-nowrap w-20 text-center">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody class="text-[12px]">
                                        <tr v-for="sub in subjects" :key="sub.subject_id"
                                            class="border-b border-line last:border-b-0 hover:bg-mist/50 transition-colors"
                                            :class="!sub.classification ? 'bg-amber-50/20' : ''">
                                            <td v-if="canManageClassification" class="px-3 py-2.5 text-center">
                                                <input type="checkbox"
                                                       :value="sub.subject_id"
                                                       v-model="selectedSubjectIds"
                                                       class="rounded border-line cursor-pointer" />
                                            </td>
                                            <td class="px-3 py-2.5 text-muted">{{ sub.year }}</td>
                                            <td class="px-3 py-2.5 text-muted">{{ sub.sem == 1 ? '1st' : (sub.sem == 2 ? '2nd' : (sub.sem == 3 ? 'Summer' : sub.sem)) }}</td>
                                            <td class="px-4 py-2.5 font-bold text-navy whitespace-nowrap">{{ sub.subject_code }}</td>
                                            <td class="px-4 py-2.5 text-ink">{{ sub.description }}</td>
                                            <td class="px-3 py-2.5 text-center font-semibold">{{ sub.units }}</td>
                                            <td class="px-4 py-2 text-center whitespace-nowrap">
                                                <div class="inline-flex items-center justify-center gap-1.5">
                                                    <span class="px-2 py-0.5 rounded text-[10px] font-bold border"
                                                          :class="classificationBadgeClass(sub.classification)">
                                                        {{ sub.classification || 'UNCLASSIFIED' }}
                                                    </span>
                                                    <select v-if="canManageClassification"
                                                            :value="sub.classification || ''"
                                                            :disabled="updatingSubjectId === sub.subject_id"
                                                            @change="quickClassifySubject(sub, $event.target.value)"
                                                            class="text-[11px] border border-line rounded px-1.5 py-0.5 bg-white text-ink font-semibold cursor-pointer focus:border-navy">
                                                        <option value="" disabled>Set...</option>
                                                        <option value="MAJOR">MAJOR</option>
                                                        <option value="MINOR">MINOR</option>
                                                    </select>
                                                </div>
                                            </td>
                                            <td class="px-4 py-2.5 text-muted text-[11px]">{{ sub.prereq }}</td>
                                            <td v-if="canManageClassification" class="px-3 py-2.5 text-center whitespace-nowrap">
                                                <div class="flex items-center justify-center gap-1">
                                                    <button @click.stop="openEditSubject(sub)" title="Edit Subject & Classification" class="p-1 text-muted hover:text-navy hover:bg-mist rounded transition-colors">
                                                        <app-icon name="Pencil" :size="14" />
                                                    </button>
                                                    <button @click.stop="archiveSubject(sub)" title="Archive Subject" class="p-1 text-muted hover:text-red-600 hover:bg-red-50 rounded transition-colors">
                                                        <app-icon name="Archive" :size="14" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </div>

                <template #footer>
                    <div class="flex flex-wrap items-center justify-between w-full gap-2 text-xs">
                        <span class="text-muted" v-if="viewSubjects.length > 0">
                            Showing {{ filteredViewSubjects.length }} of {{ viewSubjects.length }} subjects |
                            MAJOR: <strong>{{ curriculumCounts.major }}</strong> ·
                            MINOR: <strong>{{ curriculumCounts.minor }}</strong> ·
                            Unclassified: <strong :class="curriculumCounts.unclassified > 0 ? 'text-amber-700' : 'text-green-700'">{{ curriculumCounts.unclassified }}</strong> |
                            Total Units: {{ viewingProgram?.totalUnits }}
                        </span>
                        <span v-else></span>
                        <button type="button" @click="isViewModalOpen = false" class="btn btn-secondary btn-sm text-[11px]">Close</button>
                    </div>
                </template>
            </app-modal>

            <!-- ================= ADD / EDIT SUBJECT MODAL ================= -->
            <app-modal :open="isSubjectModalOpen" :title="newSubject.subject_id ? 'Edit Subject & Classification' : 'Add New Subject'" icon="FileText" size="md" @close="isSubjectModalOpen = false">
                <form id="addSubjectForm" @submit.prevent="saveSubject" class="space-y-4 text-xs text-ink">
                    <div class="p-3 bg-white rounded-lg border border-line space-y-3">
                        <div class="grid grid-cols-2 gap-3">
                            <div>
                                <label class="field-label font-semibold">Subject Code : <span class="text-red-600">*</span></label>
                                <input type="text" v-model="newSubject.subject_code" placeholder="e.g. IT 101" class="input text-xs" required />
                            </div>
                            <div>
                                <label class="field-label font-semibold">Units : <span class="text-red-600">*</span></label>
                                <input type="number" step="0.5" v-model="newSubject.units" placeholder="3" class="input text-xs" required />
                            </div>
                        </div>
                        <div>
                            <label class="field-label font-semibold">Description : <span class="text-red-600">*</span></label>
                            <input type="text" v-model="newSubject.description" placeholder="e.g. Introduction to Computing" class="input text-xs" required />
                        </div>
                        <div>
                            <label class="field-label font-semibold">Subject Classification (Official Curriculum) : <span class="text-red-600">*</span></label>
                            <select v-model="newSubject.classification" class="input text-xs font-semibold" required>
                                <option value="" disabled>— Select Official Classification (MAJOR or MINOR) —</option>
                                <option value="MAJOR">MAJOR — Major / Professional Course</option>
                                <option value="MINOR">MINOR — Minor / General Education Course</option>
                            </select>
                            <p class="text-[10px] text-muted mt-1">
                                Assign classification strictly according to the institution's approved curriculum. Used by the Grades Monitoring module.
                            </p>
                        </div>
                        <div class="grid grid-cols-3 gap-3">
                            <div>
                                <label class="field-label font-semibold">Year Level :</label>
                                <select v-model="newSubject.year_level" class="input text-xs" required>
                                    <option :value="1">1st Year</option>
                                    <option :value="2">2nd Year</option>
                                    <option :value="3">3rd Year</option>
                                    <option :value="4">4th Year</option>
                                    <option :value="5">5th Year</option>
                                </select>
                            </div>
                            <div>
                                <label class="field-label font-semibold">Semester :</label>
                                <select v-model="newSubject.semester" class="input text-xs" required>
                                    <option :value="1">1st Semester</option>
                                    <option :value="2">2nd Semester</option>
                                    <option :value="3">Summer / Mid-Year</option>
                                </select>
                            </div>
                            <div>
                                <label class="field-label font-semibold">Prerequisite :</label>
                                <input type="text" v-model="newSubject.prereq_code" placeholder="e.g. IT 101" class="input text-xs" />
                            </div>
                        </div>
                    </div>
                </form>

                <template #footer>
                    <div class="flex items-center justify-end w-full gap-2 text-xs">
                        <button type="button" @click="isSubjectModalOpen = false" class="btn btn-secondary btn-sm text-[11px]">
                            Cancel
                        </button>
                        <button type="submit" form="addSubjectForm" class="btn btn-primary btn-sm text-[11px] bg-navy" :disabled="savingSubject">
                            <app-icon name="Save" :size="13" /> {{ savingSubject ? 'Saving...' : 'Save Subject' }}
                        </button>
                    </div>
                </template>
            </app-modal>

            <!-- ================= GLOBAL REVIEW & CLASSIFY SUBJECTS MODAL ================= -->
            <app-modal :open="isReviewModalOpen" title="Review & Classify Curriculum Subjects" icon="CheckSquare" size="full" @close="isReviewModalOpen = false">
                <div class="space-y-4">
                    <div class="p-3.5 rounded-lg bg-[#f5f8fc] border border-[#d2dfef] flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
                        <div>
                            <h4 class="font-bold text-navy text-sm">Official Subject Classification Review</h4>
                            <p class="text-muted text-[11px] mt-0.5">
                                Identify subjects that have not yet been classified and assign their official <strong>MAJOR</strong> or <strong>MINOR</strong> classification per curriculum. Classification is never guessed from subject codes.
                            </p>
                        </div>
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="px-2.5 py-1 rounded bg-navy text-white font-bold text-[11px]">MAJOR: {{ globalSummary.major_subjects }}</span>
                            <span class="px-2.5 py-1 rounded bg-teal-50 text-teal-800 border border-teal-200 font-bold text-[11px]">MINOR: {{ globalSummary.minor_subjects }}</span>
                            <span class="px-2.5 py-1 rounded bg-amber-100 text-amber-900 border border-amber-300 font-bold text-[11px]">Unclassified: {{ globalSummary.unclassified_subjects }}</span>
                        </div>
                    </div>

                    <!-- Filters Row -->
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-3 bg-white p-3 rounded-lg border border-line text-xs">
                        <div>
                            <label class="field-label font-semibold">Curriculum Program :</label>
                            <select v-model="reviewCurriculumFilter" @change="fetchReviewSubjects" class="input text-xs">
                                <option :value="0">All Curriculums ({{ programs.length }})</option>
                                <option v-for="p in programs" :key="p.curriculum_id" :value="p.curriculum_id">
                                    {{ p.code }} ({{ p.curriculumCode }}) — {{ p.unclassifiedSubjects }} unclassified
                                </option>
                            </select>
                        </div>
                        <div>
                            <label class="field-label font-semibold">Classification Status :</label>
                            <select v-model="reviewClassificationFilter" @change="fetchReviewSubjects" class="input text-xs">
                                <option value="UNCLASSIFIED">Unclassified Only (Needs Classification)</option>
                                <option value="MAJOR">MAJOR Subjects Only</option>
                                <option value="MINOR">MINOR Subjects Only</option>
                                <option value="ALL">All Subjects</option>
                            </select>
                        </div>
                        <div>
                            <label class="field-label font-semibold">Search Subject :</label>
                            <div class="flex gap-2">
                                <input v-model="reviewSearchQuery" @keyup.enter="fetchReviewSubjects" type="search" placeholder="Code or description..." class="input text-xs flex-1" />
                                <button @click="fetchReviewSubjects" class="btn btn-secondary btn-sm text-xs px-3">Filter</button>
                            </div>
                        </div>
                    </div>

                    <!-- Bulk Action Bar -->
                    <div v-if="reviewSelectedIds.length > 0"
                         class="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-navy text-white text-xs">
                        <span class="font-semibold">{{ reviewSelectedIds.length }} subject(s) selected</span>
                        <div class="flex items-center gap-2">
                            <button @click="bulkClassifyInReview('MAJOR')" :disabled="bulkUpdating"
                                    class="px-3 py-1 rounded bg-gold text-navy font-bold hover:bg-yellow-400">
                                Classify Selected as MAJOR
                            </button>
                            <button @click="bulkClassifyInReview('MINOR')" :disabled="bulkUpdating"
                                    class="px-3 py-1 rounded bg-teal-500 text-white font-bold hover:bg-teal-400">
                                Classify Selected as MINOR
                            </button>
                            <button @click="reviewSelectedIds = []" class="px-2.5 py-1 rounded bg-white/10 text-white hover:bg-white/20">
                                Clear
                            </button>
                        </div>
                    </div>

                    <!-- Review Table -->
                    <div v-if="reviewLoading" class="text-center py-12 text-muted text-sm">
                        Loading subjects...
                    </div>
                    <div v-else-if="reviewSubjects.length === 0" class="text-center py-12 text-muted bg-white rounded-lg border border-line">
                        <app-icon name="CheckCircle2" :size="36" class="mx-auto mb-2 text-green-600" />
                        <p class="font-bold text-navy text-sm">No Subjects Match This Filter</p>
                        <p class="text-xs mt-1">All matching subjects have already been classified or no records match your search.</p>
                    </div>
                    <div v-else class="overflow-x-auto rounded-lg border border-line bg-white max-h-[55vh]">
                        <table class="w-full min-w-[780px] text-left border-collapse text-xs">
                            <thead class="sticky top-0 bg-gray-50 border-b border-line text-[10px] font-bold text-muted uppercase z-10">
                                <tr>
                                    <th class="px-3 py-2.5 w-10 text-center">
                                        <input type="checkbox"
                                               :checked="reviewSubjects.length > 0 && reviewSelectedIds.length === reviewSubjects.length"
                                               @change="toggleSelectAllReview($event.target.checked)"
                                               class="rounded border-line cursor-pointer" />
                                    </th>
                                    <th class="px-3 py-2.5">Curriculum</th>
                                    <th class="px-3 py-2.5">Yr / Sem</th>
                                    <th class="px-3 py-2.5">Subject Code</th>
                                    <th class="px-3 py-2.5">Description</th>
                                    <th class="px-3 py-2.5 text-center">Units</th>
                                    <th class="px-3 py-2.5 text-center">Current</th>
                                    <th class="px-3 py-2.5 text-center">Assign Classification</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-line">
                                <tr v-for="s in reviewSubjects" :key="s.subject_id" class="hover:bg-mist/50">
                                    <td class="px-3 py-2 text-center">
                                        <input type="checkbox" :value="s.subject_id" v-model="reviewSelectedIds" class="rounded border-line cursor-pointer" />
                                    </td>
                                    <td class="px-3 py-2 whitespace-nowrap">
                                        <span class="font-bold text-navy">{{ s.course_code }}</span>
                                        <span class="text-muted text-[11px] ml-1">({{ s.curriculum_code }})</span>
                                    </td>
                                    <td class="px-3 py-2 text-muted whitespace-nowrap">Y{{ s.year }} · S{{ s.sem }}</td>
                                    <td class="px-3 py-2 font-bold text-navy whitespace-nowrap">{{ s.subject_code }}</td>
                                    <td class="px-3 py-2 text-ink">{{ s.description }}</td>
                                    <td class="px-3 py-2 text-center font-semibold">{{ s.units }}</td>
                                    <td class="px-3 py-2 text-center whitespace-nowrap">
                                        <span class="px-2 py-0.5 rounded text-[10px] font-bold border"
                                              :class="classificationBadgeClass(s.classification)">
                                            {{ s.classification || 'UNCLASSIFIED' }}
                                        </span>
                                    </td>
                                    <td class="px-3 py-2 text-center whitespace-nowrap">
                                        <div class="inline-flex items-center gap-1">
                                            <button @click="classifyFromReview(s, 'MAJOR')"
                                                    :disabled="updatingSubjectId === s.subject_id"
                                                    class="px-2.5 py-1 rounded text-[11px] font-bold border transition-colors"
                                                    :class="s.classification === 'MAJOR' ? 'bg-navy text-white border-navy' : 'bg-white text-navy border-navy/30 hover:bg-navy hover:text-white'">
                                                MAJOR
                                            </button>
                                            <button @click="classifyFromReview(s, 'MINOR')"
                                                    :disabled="updatingSubjectId === s.subject_id"
                                                    class="px-2.5 py-1 rounded text-[11px] font-bold border transition-colors"
                                                    :class="s.classification === 'MINOR' ? 'bg-teal-700 text-white border-teal-700' : 'bg-white text-teal-800 border-teal-300 hover:bg-teal-700 hover:text-white'">
                                                MINOR
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <template #footer>
                    <div class="flex items-center justify-between w-full text-xs">
                        <span class="text-muted">Showing {{ reviewSubjects.length }} subject(s) (up to 500 per view)</span>
                        <button type="button" @click="isReviewModalOpen = false" class="btn btn-secondary btn-sm text-[11px]">Close</button>
                    </div>
                </template>
            </app-modal>
        </div>
    `
};
