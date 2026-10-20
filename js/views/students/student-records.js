const RegistrarStudentRecordsPage = {
    components: { AppIcon, AppModal },
    setup() {
        const students = Vue.ref([]);
        const courses = Vue.ref([]);
        const curriculums = Vue.ref([]);
        const schoolYearsOptions = Vue.ref([]);

        const searchQuery = Vue.ref('');
        const courseFilter = Vue.ref('All Courses');
        const yearFilter = Vue.ref('All Year Levels');
        const statusFilter = Vue.ref('All Statuses');

        const isModalOpen = Vue.ref(false);
        const loading = Vue.ref(false);

        const initFormData = () => ({
            student_number: '',
            first_name: '',
            middle_name: '',
            last_name: '',
            suffix: '',
            course_id: '',
            curriculum_id: '',
            year_level: '1st Year',
            address: '',
            zip_code: '1447',
            region: 'Region IV-A (Calabarzon)',
            province: 'Cavite',
            city: 'Gen. Mariano Alvarez',
            barangay: 'San Gabriel (Area K)',
            landline: '',
            contact_no: '',
            mobile_provider: 'Globe',
            gender: 'Female',
            civil_status: 'Single',
            nationality: 'Filipino',
            birth_date: '2006-03-18',
            age: 19,
            birth_place: 'Gen. Mariano Alvarez, Cavite',
            email: '',
            religion: 'Roman Catholic'
        });

        const form = Vue.reactive(initFormData());

        const fetchSchoolYears = async () => {
            const res = await Model.request('students/tuition-fee', 'get_school_years');
            if (res.success) {
                schoolYearsOptions.value = res.school_years || [];
            }
        };

        const fetchStudents = async () => {
            const res = await Model.request('students/manage', 'list');
            if (res.success) {
                students.value = res.students;
                courses.value = res.courses;
                curriculums.value = res.curriculums;
            }
        };

        Vue.onMounted(async () => {
            await fetchSchoolYears();
            await fetchStudents();
        });

        const filteredStudents = Vue.computed(() => {
            return students.value.filter(st => {
                const searchMatch = !searchQuery.value || 
                    (st.student_number && st.student_number.toLowerCase().includes(searchQuery.value.toLowerCase())) || 
                    (st.name && st.name.toLowerCase().includes(searchQuery.value.toLowerCase())) ||
                    (st.course && st.course.toLowerCase().includes(searchQuery.value.toLowerCase()));
                
                const courseMatch = courseFilter.value === 'All Courses' || st.course === courseFilter.value;
                const yearMatch = yearFilter.value === 'All Year Levels' || st.year === yearFilter.value;
                const statusMatch = statusFilter.value === 'All Statuses' || st.status === statusFilter.value;
                
                return searchMatch && courseMatch && yearMatch && statusMatch;
            });
        });

        const availableCurriculums = Vue.computed(() => {
            if (!form.course_id) return [];
            return curriculums.value.filter(c => c.course_id == form.course_id);
        });

        const openAddModal = () => {
            Object.assign(form, initFormData());
            if (courses.value.length > 0) {
                form.course_id = courses.value[0].course_id;
                const currs = curriculums.value.filter(c => c.course_id == form.course_id);
                if (currs.length > 0) form.curriculum_id = currs[0].curriculum_id;
            }
            isModalOpen.value = true;
        };

        const onCourseChange = () => {
            const currs = curriculums.value.filter(c => c.course_id == form.course_id);
            form.curriculum_id = currs.length > 0 ? currs[0].curriculum_id : '';
        };

        const saveStudent = async () => {
            const confirmed = await Alerts.confirm({
                title: 'Register Student?',
                html: `Are you sure you want to save student record for <b>${Alerts.esc(form.first_name)} ${Alerts.esc(form.last_name)}</b> (${Alerts.esc(form.student_number)})?`,
                icon: 'question',
                confirmText: 'Save Student',
                cancelText: 'Cancel'
            });
            if (!confirmed) return;

            loading.value = true;
            const res = await Model.request('students/manage', 'add', form);
            loading.value = false;
            
            if (res.success) {
                Store.toast('success', res.message);
                isModalOpen.value = false;
                fetchStudents();
            } else {
                Alerts.error('Could not save student', res.message);
            }
        };

        // ===== EDIT STUDENT MODAL =====
        const isEditModalOpen = Vue.ref(false);
        const editLoading = Vue.ref(false);

        const initEditFormData = () => ({
            student_id: '',
            student_number: '',
            first_name: '',
            middle_name: '',
            last_name: '',
            suffix: '',
            course_id: '',
            curriculum_id: '',
            year_level: '1st Year',
            status: 'Active',
            address: '',
            zip_code: '',
            region: 'Region IV-A (Calabarzon)',
            province: 'Cavite',
            city: 'Gen. Mariano Alvarez',
            barangay: 'San Gabriel (Area K)',
            landline: '',
            contact_no: '',
            mobile_provider: 'Globe',
            gender: 'Female',
            civil_status: 'Single',
            nationality: 'Filipino',
            birth_date: '',
            age: '',
            birth_place: 'Gen. Mariano Alvarez, Cavite',
            email: '',
            religion: 'Roman Catholic'
        });

        const editForm = Vue.reactive(initEditFormData());

        const editAvailableCurriculums = Vue.computed(() => {
            if (!editForm.course_id) return [];
            return curriculums.value.filter(c => c.course_id == editForm.course_id);
        });

        const editCourseChange = () => {
            const currs = curriculums.value.filter(c => c.course_id == editForm.course_id);
            editForm.curriculum_id = currs.length > 0 ? currs[0].curriculum_id : '';
        };

        const openEditModal = (st) => {
            Object.assign(editForm, {
                student_id: st.student_id || st.id,
                student_number: st.student_number || '',
                first_name: st.first_name || '',
                middle_name: st.middle_name || '',
                last_name: st.last_name || '',
                suffix: st.suffix || '',
                course_id: st.course_id || '',
                curriculum_id: st.curriculum_id || '',
                year_level: st.year || st.year_level || '1st Year',
                status: st.status || 'Active',
                address: st.address || '',
                zip_code: st.zip_code || '1447',
                region: st.region || 'Region IV-A (Calabarzon)',
                province: st.province || 'Cavite',
                city: st.city || 'Gen. Mariano Alvarez',
                barangay: st.barangay || 'San Gabriel (Area K)',
                landline: st.landline || '',
                contact_no: st.contact_no || '',
                mobile_provider: st.mobile_provider || 'Globe',
                gender: st.gender || 'Female',
                civil_status: st.civil_status || 'Single',
                nationality: st.nationality || 'Filipino',
                birth_date: st.birth_date || '',
                age: st.age || '',
                birth_place: st.birth_place || 'Gen. Mariano Alvarez, Cavite',
                email: st.email || '',
                religion: st.religion || 'Roman Catholic'
            });
            isEditModalOpen.value = true;
        };

        const updateStudent = async () => {
            const confirmed = await Alerts.confirm({
                title: 'Save Changes?',
                html: `Are you sure you want to update student information for <b>${Alerts.esc(editForm.first_name)} ${Alerts.esc(editForm.last_name)}</b> (${Alerts.esc(editForm.student_number)})?`,
                icon: 'question',
                confirmText: 'Save Changes',
                cancelText: 'Cancel'
            });
            if (!confirmed) return;

            editLoading.value = true;
            const res = await Model.request('students/manage', 'update', editForm);
            editLoading.value = false;

            if (res.success) {
                Store.toast('success', res.message || 'Student information updated successfully.');
                isEditModalOpen.value = false;
                if (viewingStudent.value) {
                    Object.assign(viewingStudent.value, {
                        ...editForm,
                        name: [editForm.first_name, editForm.middle_name, editForm.last_name].filter(Boolean).join(' ')
                    });
                }
                fetchStudents();
            } else {
                Alerts.error('Could not update student', res.message);
            }
        };

        const viewingStudent = Vue.ref(null);
        const activeTab = Vue.ref('info');
        const studentSubjects = Vue.ref([]);
        const loadingStudentSubjects = Vue.ref(false);

        const selectedSy = Vue.ref('');
        const selectedSem = Vue.ref('');
        const allEnrollments = Vue.ref([]);
        const allTuitionFees = Vue.ref([]);
        const currentFeeAssessment = Vue.ref(null);
        const currentGrades = Vue.ref([]);

        const studentSchoolYears = Vue.computed(() => {
            if (!allEnrollments.value.length) return [];
            const uniqueYears = [...new Set(allEnrollments.value.map(e => e.school_year))];
            return uniqueYears.sort().reverse().map(year => ({
                label: year,
                value: year
            }));
        });

        const availableSemesters = Vue.computed(() => {
            if (!selectedSy.value || !allEnrollments.value.length) return [];
            const semesters = allEnrollments.value
                .filter(e => e.school_year === selectedSy.value)
                .map(e => e.semester);
            const uniqueSemesters = [...new Set(semesters)];
            const semesterOrder = ['1st Semester', '2nd Semester', 'Summer'];
            return uniqueSemesters.sort((a, b) => semesterOrder.indexOf(a) - semesterOrder.indexOf(b))
                .map(sem => ({ label: sem, value: sem }));
        });

        const studentStatuses = Vue.ref({});

        const passedCodes = Vue.computed(() => {
            const set = new Set();
            studentSubjects.value.forEach(sub => {
                const st = studentStatuses.value[sub.subject_id];
                if (st === 'Passed') set.add(sub.subject_code);
            });
            return set;
        });

        const filteredGrades = Vue.computed(() => {
            return currentGrades.value;
        });

        const computedGWA = Vue.computed(() => {
            const grades = currentGrades.value.filter(g => g.points && parseFloat(g.points) > 0);
            if (!grades.length) return '';
            const total = grades.reduce((sum, g) => sum + parseFloat(g.points), 0);
            return (total / grades.length).toFixed(2);
        });

        const statusOptions = ['Not Taken', 'Enrolled', 'Passed', 'Failed', 'Incomplete', 'Dropped'];

        const computedCurriculumSubjects = Vue.computed(() => {
            return studentSubjects.value.map(sub => {
                const prereq = sub.prereq || '—';
                const status = studentStatuses.value[sub.subject_id] || 'Not Taken';

                const statusClassMap = {
                    'Passed': 'bg-green-100 text-green-700 border-green-200 font-bold',
                    'Failed': 'bg-red-100 text-red-700 border-red-200 font-bold',
                    'Enrolled': 'bg-amber-100 text-amber-700 border-amber-200 font-bold',
                    'Incomplete': 'bg-orange-100 text-orange-700 border-orange-200 font-bold',
                    'Dropped': 'bg-red-100 text-red-500 border-red-200',
                    'Not Taken': 'bg-gray-100 text-gray-600 border-gray-200'
                };
                const statusClass = statusClassMap[status] || statusClassMap['Not Taken'];

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

            // Find max year and sem student has progressed to
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

        const saveSubjectStatus = async (sub, newStatus) => {
            if (!viewingStudent.value) return;
            studentStatuses.value[sub.subject_id] = newStatus;
            const r = await Model.request('students/get_curriculum', 'save_subject_status', {
                student_id: viewingStudent.value.student_id,
                subject_id: sub.subject_id,
                status: newStatus
            });
            if (r.success) Store.toast('success', `${sub.subject_code} → ${newStatus}`);
            else Alerts.error('Could not save status', r.message);
        };

        const enrollmentStatus = Vue.ref('');

        const loadEnrollmentForYearSem = async () => {
            if (!selectedSy.value || !selectedSem.value || !viewingStudent.value) {
                viewingStudent.value.enrollment_data = null;
                currentFeeAssessment.value = null;
                currentGrades.value = [];
                return;
            }
            const match = allEnrollments.value.find(e =>
                e.school_year === selectedSy.value && e.semester === selectedSem.value
            );
            if (match && match.enrollment_id) {
                const detailRes = await Model.request('students/enrollment', 'get_enrollment', { enrollmentId: match.enrollment_id });
                if (detailRes.success) {
                    viewingStudent.value.enrollment_data = {
                        ...detailRes.enrollment,
                        subjects: detailRes.subjects || []
                    };
                    currentFeeAssessment.value = detailRes.assessment || null;
                } else {
                    viewingStudent.value.enrollment_data = null;
                    currentFeeAssessment.value = null;
                }

                const gradeRes = await Model.request('students/grades', 'get_grades', { enrollmentId: match.enrollment_id });
                if (gradeRes.success) {
                    currentGrades.value = (gradeRes.subjects || []).map(s => {
                        const fg = s.final_grade || '';
                        const pts = s.points || '';
                        let status = '';
                        if (pts) {
                            const p = parseFloat(pts);
                            status = p <= 3 ? 'Passed' : (p === 5 ? 'Failed' : 'INC');
                        }
                        return { ...s, finalGrade: fg, status };
                    });
                } else {
                    currentGrades.value = [];
                }
            } else {
                viewingStudent.value.enrollment_data = null;
                currentFeeAssessment.value = null;
                currentGrades.value = [];
            }
        };

        const openViewModal = async (st) => {
            viewingStudent.value = st;
            activeTab.value = 'info';
            studentSubjects.value = [];
            allEnrollments.value = [];
            allTuitionFees.value = [];

            // Fetch enrollment status
            const r = await Model.request('students/records', 'get_detail', { studentId: st.id || st.student_id });
            if (r.success) {
                viewingStudent.value.enrollment_count = r.student.enrollment_count;
                enrollmentStatus.value = r.student.current_enrollment_status || (r.student.current_term_enrolled > 0 ? 'Enrolled' : 'Not Enrolled');
            }

            const studentId = st.id || st.student_id;

            // Fetch all enrollments for this student
            const enrollRes = await Model.request('students/enrollment', 'list_enrolled', {});
            if (enrollRes.success && enrollRes.students) {
                allEnrollments.value = enrollRes.students.filter(e => e.id == studentId && e.enrollment_id);
            }

            // Auto-select first enrollment's year and semester
            if (allEnrollments.value.length > 0) {
                selectedSy.value = allEnrollments.value[0].school_year;
                selectedSem.value = allEnrollments.value[0].semester;
            } else {
                selectedSy.value = '';
                selectedSem.value = '';
            }

            // Load enrollment data after setting both values
            setTimeout(() => loadEnrollmentForYearSem(), 0);

            if (st.curriculum_id) {
                loadingStudentSubjects.value = true;
                const [res, statusRes] = await Promise.all([
                    Model.request('students/get_curriculum', 'get_structure', { curriculum_id: st.curriculum_id }),
                    Model.request('students/get_curriculum', 'get_student_statuses', { student_id: studentId })
                ]);
                loadingStudentSubjects.value = false;
                if (res.success) {
                    studentSubjects.value = res.subjects || [];
                }
                if (statusRes.success) {
                    studentStatuses.value = statusRes.statuses || {};
                }
            }
        };

        // ===== REGISTRAR OFFICIAL SCHEDULE EDITOR =====
        const scheduleEditor = Vue.ref(null);

        const openEditScheduleModal = (s) => {
            const toInputTime = (tStr) => {
                if (!tStr) return "07:00";
                const m = String(tStr).trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
                if (!m) return tStr;
                let h = parseInt(m[1], 10);
                const min = m[2];
                const ampm = (m[3] || "").toUpperCase();
                if (ampm === "PM" && h < 12) h += 12;
                if (ampm === "AM" && h === 12) h = 0;
                return String(h).padStart(2, "0") + ":" + min;
            };

            scheduleEditor.value = {
                enrollmentId: viewingStudent.value?.enrollment_data?.enrollment_id,
                detailId: s.detail_id,
                scheduleId: s.schedule_id,
                subjectCode: s.subject_code,
                description: s.description,
                section: s.section_code || viewingStudent.value?.enrollment_data?.section || "",
                type: s.type || "Lec",
                days: s.days || "MON",
                startTime: toInputTime(s.start_time),
                endTime: toInputTime(s.end_time),
                room: s.room || "",
                reason: "",
                saving: false,
                error: ""
            };
        };

        const saveScheduleEdit = async () => {
            const se = scheduleEditor.value;
            if (!se) return;
            se.error = "";
            if (!se.days.trim()) { se.error = "Please enter or select schedule day(s)."; return; }
            if (!se.startTime || !se.endTime) { se.error = "Please set valid start and end times."; return; }
            if (se.startTime >= se.endTime) { se.error = "End time must be after start time."; return; }
            if (!se.reason.trim() || se.reason.trim().length < 3) {
                se.error = "Please state the official reason for this schedule update (at least 3 characters).";
                return;
            }

            const confirmed = await Alerts.confirm({
                title: "Save Schedule Change?",
                html: `Update schedule for <b>${Alerts.esc(se.subjectCode)}</b>?<br>`
                    + `<span class="text-caption text-ink/80">`
                    + `${Alerts.esc(se.days)} ${Alerts.esc(se.startTime)} - ${Alerts.esc(se.endTime)} (${Alerts.esc(se.room || "No Room")})<br>`
                    + `If this student is a Student Assistant, duty clashes will be evaluated and the S.A. Coordinator will be automatically notified.`
                    + `</span>`,
                icon: "question",
                confirmText: "Save Schedule"
            });
            if (!confirmed) return;

            se.saving = true;
            const res = await Model.request("students/enrollment", "update_subject_schedule", {
                enrollmentId: se.enrollmentId,
                detailId: se.detailId,
                scheduleId: se.scheduleId,
                days: se.days.trim(),
                startTime: se.startTime,
                endTime: se.endTime,
                room: se.room.trim(),
                section: se.section.trim(),
                type: se.type,
                reason: se.reason.trim()
            });
            se.saving = false;

            if (res.success) {
                Store.toast("success", res.message || "Schedule updated successfully.");
                if (res.clashes && res.clashes.length > 0) {
                    Alerts.warning(
                        "Duty Conflict Detected",
                        `Schedule change caused ${res.clashes.length} clash(es) with scheduled duty! S.A. Coordinator has been notified to re-align duty recommendations.`
                    );
                }
                scheduleEditor.value = null;
                await loadEnrollmentForYearSem();
            } else {
                se.error = res.message || "Failed to update schedule.";
            }
        };

        const dropEnrolledSubject = async () => {
            const se = scheduleEditor.value;
            if (!se) return;
            const confirmed = await Alerts.confirm({
                title: `Drop ${se.subjectCode}?`,
                html: `Are you sure you want to drop <b>${Alerts.esc(se.subjectCode)} - ${Alerts.esc(se.description)}</b> from this enrollment?<br>`
                    + `<span class="text-caption text-danger">This will remove the enrolled subject and notify the S.A. Coordinator if this student is an S.A.</span>`,
                icon: "warning",
                danger: true,
                confirmText: "Drop Subject"
            });
            if (!confirmed) return;

            se.saving = true;
            const res = await Model.request("students/enrollment", "drop_subject", {
                enrollmentId: se.enrollmentId,
                scheduleId: se.scheduleId
            });
            se.saving = false;

            if (res.success) {
                Store.toast("success", `${se.subjectCode} dropped successfully.`);
                scheduleEditor.value = null;
                await loadEnrollmentForYearSem();
            } else {
                Alerts.error("Could not drop subject", res.message);
            }
        };

        const curriculumClassFilter = Vue.ref('ALL');

        const filteredStudentCurriculumSubjects = Vue.computed(() => {
            const f = curriculumClassFilter.value;
            if (f === 'ALL') return computedCurriculumSubjects.value;
            if (f === 'MAJOR' || f === 'MINOR') return computedCurriculumSubjects.value.filter(s => s.classification === f);
            if (f === 'UNCLASSIFIED') return computedCurriculumSubjects.value.filter(s => !s.classification);
            return computedCurriculumSubjects.value;
        });

        Vue.watch([selectedSy, selectedSem], loadEnrollmentForYearSem, { deep: true });

        return {
            students, courses, curriculums, filteredStudents, schoolYearsOptions,
            searchQuery, courseFilter, yearFilter, statusFilter,
            isModalOpen, form, availableCurriculums, loading,
            openAddModal, onCourseChange, saveStudent,
            isEditModalOpen, editForm, editAvailableCurriculums, editLoading,
            openEditModal, editCourseChange, updateStudent,
            viewingStudent, activeTab, studentSubjects, loadingStudentSubjects, openViewModal, enrollmentStatus,
            selectedSy, selectedSem, studentSchoolYears, availableSemesters, filteredGrades, computedCurriculumSubjects,
            curriculumClassFilter, filteredStudentCurriculumSubjects,
            currentFeeAssessment, currentGrades, computedGWA,
            studentStatuses, statusOptions, saveSubjectStatus, studentClassification,
            scheduleEditor, openEditScheduleModal, saveScheduleEdit, dropEnrolledSubject
        };
    },
    template: `
        <div>


            <!-- Header -->
            <div class="mb-6 flex items-start justify-between">
                <div>
                    <h2 class="text-[22px] font-bold text-navy mb-1">Student Records</h2>
                    <p class="text-muted text-sm">Search, filter, and access stored student academic profiles in the database.</p>
                </div>
                <button @click="openAddModal" class="btn btn-primary bg-navy text-white hover:bg-navy-700 rounded-lg font-semibold px-4 py-2 flex items-center gap-2">
                    <app-icon name="Plus" :size="16" /> Add Student
                </button>
            </div>

            <!-- Table Card -->
            <div class="card bg-white rounded-xl shadow-sm border border-line">
                <!-- Filters -->
                <div class="p-4 border-b border-line flex flex-col md:flex-row gap-4 items-center justify-between">
                    <div class="relative w-full md:w-[320px]">
                        <input type="text" v-model="searchQuery" placeholder="Search by Student ID, Name, or Course..." 
                            class="input w-full bg-gray-50 border-transparent focus:border-line focus:bg-white" />
                    </div>
                    
                    <div class="flex items-center gap-3 w-full md:w-auto">
                        <select v-model="courseFilter" class="input bg-white w-full md:w-auto text-sm">
                            <option>All Courses</option>
                            <option v-for="c in courses" :key="c.course_code">{{ c.course_code }}</option>
                        </select>
                        <select v-model="yearFilter" class="input bg-white w-full md:w-auto text-sm">
                            <option>All Year Levels</option>
                            <option>1st Year</option>
                            <option>2nd Year</option>
                            <option>3rd Year</option>
                            <option>4th Year</option>
                        </select>
                        <select v-model="statusFilter" class="input bg-white w-full md:w-auto text-sm">
                            <option>All Statuses</option>
                            <option>Enrolled</option>
                            <option>Not Enrolled</option>
                            <option>Pending Review</option>
                        </select>
                    </div>
                </div>

                <!-- Table -->
                <div class="overflow-x-auto touch-scroll table-scroll">
                    <table class="w-full text-left border-collapse min-w-[750px]">
                        <thead>
                            <tr class="border-b border-line text-[11px] font-bold text-muted uppercase bg-gray-50/50">
                                <th class="px-5 py-4 whitespace-nowrap">Student ID</th>
                                <th class="px-5 py-4 whitespace-nowrap">Student Name</th>
                                <th class="px-5 py-4 whitespace-nowrap">Course</th>
                                <th class="px-5 py-4 whitespace-nowrap">Year Level</th>
                                <th class="px-5 py-4 whitespace-nowrap">Section</th>
                                <th class="px-5 py-4 whitespace-nowrap">Enrollment Status</th>
                                <th class="px-5 py-4 whitespace-nowrap">Last Updated</th>
                                <th class="px-5 py-4 whitespace-nowrap text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody class="text-[13px]">
                            <tr v-if="filteredStudents.length === 0">
                                <td colspan="8" class="text-center py-8 text-muted">No students found matching your criteria.</td>
                            </tr>
                            <tr v-for="student in filteredStudents" :key="student.id" class="border-b border-line hover:bg-mist transition-colors">
                                <td class="px-5 py-4 font-bold text-navy whitespace-nowrap">{{ student.student_number }}</td>
                                <td class="px-5 py-4 font-semibold text-ink whitespace-nowrap">{{ student.name }}</td>
                                <td class="px-5 py-4 whitespace-nowrap">
                                    <span class="px-2.5 py-1 bg-mist text-navy font-bold rounded text-[11px]">{{ student.course }}</span>
                                </td>
                                <td class="px-5 py-4 text-muted whitespace-nowrap">{{ student.year }}</td>
                                <td class="px-5 py-4 text-muted whitespace-nowrap">{{ student.section }}</td>
                                <td class="px-5 py-4 whitespace-nowrap">
                                    <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border" :class="student.statusColor">
                                        <span class="w-1.5 h-1.5 rounded-full" :class="student.dotColor"></span>
                                        {{ student.status }}
                                    </span>
                                </td>
                                <td class="px-5 py-4 text-muted whitespace-nowrap">{{ student.updated }}</td>
                                <td class="px-5 py-4 text-center whitespace-nowrap">
                                    <button @click="openViewModal(student)" class="btn btn-primary btn-sm rounded-md px-4 py-1.5 text-xs">View</button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- ================= ADD STUDENT MODAL ================= -->
            <app-modal :open="isModalOpen" title="Student Record" icon="UserPlus" size="xl" @close="isModalOpen = false">
                <!-- Header Name Preview Banner -->
                <div class="mb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 bg-[#f5f8fc] border border-[#d2dfef] rounded-lg">
                    <div class="flex items-center gap-2">
                        <span class="text-base font-bold text-[#1b365d]">Student Information</span>
                    </div>
                    <div class="flex-1 text-right">
                        <span class="text-lg font-bold tracking-wide text-[#1b365d]">
                            {{ [form.first_name, form.middle_name, form.last_name].filter(Boolean).join(' ') || 'New Student Record' }}
                        </span>
                    </div>
                </div>

                <form id="addStudentModalForm" @submit.prevent="saveStudent" class="space-y-4 text-xs text-ink">
                    <!-- Top ID & Admission Row + Photo -->
                    <div class="grid grid-cols-1 md:grid-cols-4 gap-4 items-start bg-white p-3 border border-line rounded-lg">
                        <!-- Photo Box -->
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
                                <input type="text" v-model="form.student_number" placeholder="e.g. 2024-58030" class="input text-xs" required />
                            </div>

                            <!-- Name Fields -->
                            <div class="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                                <div>
                                    <label class="field-label font-semibold">First Name :</label>
                                    <input type="text" v-model="form.first_name" placeholder="First Name" class="input text-xs" required />
                                </div>
                                <div>
                                    <label class="field-label font-semibold">Middle Name :</label>
                                    <input type="text" v-model="form.middle_name" placeholder="Middle Name" class="input text-xs" />
                                </div>
                                <div>
                                    <label class="field-label font-semibold">Last Name :</label>
                                    <input type="text" v-model="form.last_name" placeholder="Last Name" class="input text-xs" required />
                                </div>
                                <div>
                                    <label class="field-label font-semibold">Suffix :</label>
                                    <input type="text" v-model="form.suffix" placeholder="Jr., III" class="input text-xs" />
                                </div>
                            </div>

                            <!-- Course, Curriculum & Year Level -->
                            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div>
                                    <label class="field-label font-semibold">Course Title :</label>
                                    <select v-model="form.course_id" @change="onCourseChange" class="input text-xs" required>
                                        <option value="">Select Course</option>
                                        <option v-for="c in courses" :key="c.course_id" :value="c.course_id">{{ c.course_code }} - {{ c.course_name }}</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="field-label font-semibold">Curriculum :</label>
                                    <select v-model="form.curriculum_id" class="input text-xs" :disabled="!form.course_id" required>
                                        <option value="">Select Curriculum</option>
                                        <option v-for="c in availableCurriculums" :key="c.curriculum_id" :value="c.curriculum_id">{{ c.curriculum_code }}</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="field-label font-semibold">Year Level :</label>
                                    <select v-model="form.year_level" class="input text-xs" required>
                                        <option>1st Year</option>
                                        <option>2nd Year</option>
                                        <option>3rd Year</option>
                                        <option>4th Year</option>
                                    </select>
                                </div>
                            </div>

                        </div>
                    </div>

                    <!-- Complete Address Section -->
                    <div class="p-3 bg-white rounded-lg border border-line space-y-2.5">
                        <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
                            <div class="md:col-span-3">
                                <label class="field-label font-semibold">Complete Address :</label>
                                <input type="text" v-model="form.address" placeholder="Blk / Lot / Street / Subdivision" class="input text-xs" />
                            </div>
                            <div>
                                <label class="field-label font-semibold">Zip Code :</label>
                                <input type="text" v-model="form.zip_code" placeholder="1447" class="input text-xs" />
                            </div>
                        </div>

                        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                            <div>
                                <label class="field-label font-semibold">Region :</label>
                                <input type="text" v-model="form.region" class="input text-xs" />
                            </div>
                            <div>
                                <label class="field-label font-semibold">Province :</label>
                                <input type="text" v-model="form.province" class="input text-xs" />
                            </div>
                            <div>
                                <label class="field-label font-semibold">Town/Municipality/City :</label>
                                <input type="text" v-model="form.city" class="input text-xs" />
                            </div>
                            <div>
                                <label class="field-label font-semibold">Barangay :</label>
                                <input type="text" v-model="form.barangay" class="input text-xs" />
                            </div>
                        </div>
                    </div>

                    <!-- Contact & Demographics -->
                    <div class="p-3 bg-white rounded-lg border border-line space-y-2.5">
                        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                            <div>
                                <label class="field-label font-semibold">Home Land Line :</label>
                                <input type="text" v-model="form.landline" placeholder="Landline No." class="input text-xs" />
                            </div>
                            <div>
                                <label class="field-label font-semibold">Mobile No :</label>
                                <input type="text" v-model="form.contact_no" placeholder="09XX-XXX-XXXX" class="input text-xs" />
                            </div>
                            <div>
                                <label class="field-label font-semibold">Mobile Provider :</label>
                                <select v-model="form.mobile_provider" class="input text-xs">
                                    <option value="Globe">Globe</option>
                                    <option value="Smart">Smart</option>
                                    <option value="DITO">DITO</option>
                                    <option value="TM">TM</option>
                                    <option value="TNT">TNT</option>
                                </select>
                            </div>
                        </div>

                        <div class="grid grid-cols-2 sm:grid-cols-6 gap-2.5">
                            <div>
                                <label class="field-label font-semibold">Gender :</label>
                                <select v-model="form.gender" class="input text-xs">
                                    <option value="Female">Female</option>
                                    <option value="Male">Male</option>
                                    <option value="Other">Other</option>
                                </select>
                            </div>
                            <div>
                                <label class="field-label font-semibold">Civil Status :</label>
                                <select v-model="form.civil_status" class="input text-xs">
                                    <option value="Single">Single</option>
                                    <option value="Married">Married</option>
                                    <option value="Widowed">Widowed</option>
                                </select>
                            </div>
                            <div>
                                <label class="field-label font-semibold">Nationality :</label>
                                <input type="text" v-model="form.nationality" class="input text-xs" />
                            </div>
                            <div>
                                <label class="field-label font-semibold">Date of Birth :</label>
                                <input type="date" v-model="form.birth_date" class="input text-xs" />
                            </div>
                            <div>
                                <label class="field-label font-semibold">Age :</label>
                                <input type="number" v-model="form.age" class="input text-xs" />
                            </div>
                            <div>
                                <label class="field-label font-semibold">Place of Birth :</label>
                                <input type="text" v-model="form.birth_place" class="input text-xs" />
                            </div>
                        </div>

                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            <div>
                                <label class="field-label font-semibold">Email Address :</label>
                                <input type="email" v-model="form.email" placeholder="example@gmail.com" class="input text-xs" />
                            </div>
                            <div>
                                <label class="field-label font-semibold">Religion :</label>
                                <input type="text" v-model="form.religion" class="input text-xs" />
                            </div>
                        </div>
                    </div>
                </form>

                <!-- Actions Footer -->
                <template #footer>
                    <div class="flex items-center justify-end w-full gap-2 text-xs">
                        <button type="button" @click="isModalOpen = false" class="btn btn-secondary btn-sm text-[11px]">
                            Cancel
                        </button>
                        <button type="submit" form="addStudentModalForm" class="btn btn-primary btn-sm text-[11px] bg-navy" :disabled="loading">
                            <app-icon name="Save" :size="13" /> {{ loading ? 'Saving...' : 'Save Student' }}
                        </button>
                    </div>
                </template>
            </app-modal>

            <!-- ================= VIEW STUDENT DETAILS MODAL WITH TABS ================= -->
            <app-modal :open="!!viewingStudent" :title="viewingStudent ? (viewingStudent.name + ' - Student Record') : 'Student Record'" icon="User" size="xl" @close="viewingStudent = null">
                <div v-if="viewingStudent" class="space-y-4 text-xs text-ink">
                    <!-- Top Student Banner -->
                    <div class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 bg-[#f5f8fc] border border-[#d2dfef] rounded-lg">
                        <div class="flex items-center gap-3">
                            <div class="w-12 h-12 rounded-full bg-navy text-white font-bold flex items-center justify-center text-lg shadow-sm">
                                {{ (viewingStudent.first_name || viewingStudent.name || 'S').charAt(0) }}
                            </div>
                            <div>
                                <div class="flex items-center gap-2">
                                    <h3 class="text-base font-bold text-navy">{{ viewingStudent.name }}</h3>
                                    <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold border shadow-xs" :class="studentClassification.badgeClass">
                                        {{ studentClassification.label }}
                                    </span>
                                </div>
                                <p class="text-[11px] text-muted mt-0.5">
                                    Student ID: <span class="font-semibold text-ink">{{ viewingStudent.student_number }}</span> |
                                    Course: <span class="font-semibold text-navy">{{ viewingStudent.course || viewingStudent.course_code }}</span> |
                                    Curriculum: <span class="font-semibold text-navy">{{ viewingStudent.curriculum_code || 'BSIT-2024' }}</span> |
                                    Year Level: <span class="font-semibold text-navy">{{ viewingStudent.year || viewingStudent.year_level || '1st Year' }}</span> |
                                    Standing: <span class="font-bold" :class="studentClassification.isRegular ? 'text-green-700' : 'text-amber-700'">{{ studentClassification.label }}</span>
                                </p>
                            </div>
                        </div>
                        <div class="flex flex-col items-end gap-1">
                            <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border" :class="viewingStudent.statusColor || 'text-gray-600 bg-gray-100 border-gray-200'">
                                <span class="w-2 h-2 rounded-full" :class="viewingStudent.dotColor || 'bg-gray-400'"></span>
                                {{ viewingStudent.status || 'Not Enrolled' }}
                            </span>
                        </div>
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
                        <!-- Header with status & edit button -->
                        <div class="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg">
                            <div class="flex items-center gap-2">
                                <span class="text-[13px] font-semibold text-navy">{{ viewingStudent.first_name }} {{ viewingStudent.last_name }}</span>
                                <span v-if="enrollmentStatus" class="inline-block rounded-full px-2.5 py-0.5 text-[11px] font-bold border"
                                      :class="enrollmentStatus === 'Enrolled' ? 'bg-success/20 text-success border-success/30' : (enrollmentStatus === 'Pending Review' ? 'bg-warning/20 text-warning border-warning/30' : 'bg-gray-100 text-gray-600 border-gray-200')">
                                    {{ enrollmentStatus }}
                                </span>
                            </div>
                            <button @click="openEditModal(viewingStudent)" class="btn btn-secondary btn-sm">
                                <app-icon name="Edit2" :size="14" /> Edit Info
                            </button>
                        </div>

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

                                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    <div>
                                        <label class="field-label font-semibold">Course Title :</label>
                                        <input type="text" :value="viewingStudent.course_name || viewingStudent.course || 'BS-Information Technology'" class="input text-xs bg-gray-50" readonly />
                                    </div>
                                    <div>
                                        <label class="field-label font-semibold">Curriculum :</label>
                                        <input type="text" :value="viewingStudent.curriculum_code || 'SY 2024-2025 Curriculum'" class="input text-xs bg-gray-50" readonly />
                                    </div>
                                    <div>
                                        <label class="field-label font-semibold">Year Level :</label>
                                        <input type="text" :value="viewingStudent.year || viewingStudent.year_level || '1st Year'" class="input text-xs bg-gray-50 font-semibold text-navy" readonly />
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
                            <div class="flex flex-wrap items-center gap-1.5 text-[11px]">
                                <button @click="curriculumClassFilter = 'ALL'"
                                        class="px-2.5 py-0.5 rounded-full font-bold border transition-colors"
                                        :class="curriculumClassFilter === 'ALL' ? 'bg-navy text-white border-navy' : 'bg-white text-ink border-line hover:bg-mist'">
                                    All ({{ computedCurriculumSubjects.length }})
                                </button>
                                <button @click="curriculumClassFilter = 'MAJOR'"
                                        class="px-2.5 py-0.5 rounded-full font-bold border transition-colors"
                                        :class="curriculumClassFilter === 'MAJOR' ? 'bg-navy text-white border-navy' : 'bg-white text-navy border-navy/20 hover:bg-navy/10'">
                                    MAJOR ({{ computedCurriculumSubjects.filter(s => s.classification === 'MAJOR').length }})
                                </button>
                                <button @click="curriculumClassFilter = 'MINOR'"
                                        class="px-2.5 py-0.5 rounded-full font-bold border transition-colors"
                                        :class="curriculumClassFilter === 'MINOR' ? 'bg-teal-700 text-white border-teal-700' : 'bg-white text-teal-800 border-teal-200 hover:bg-teal-50'">
                                    MINOR ({{ computedCurriculumSubjects.filter(s => s.classification === 'MINOR').length }})
                                </button>
                                <button @click="curriculumClassFilter = 'UNCLASSIFIED'"
                                        class="px-2.5 py-0.5 rounded-full font-bold border transition-colors"
                                        :class="curriculumClassFilter === 'UNCLASSIFIED' ? 'bg-amber-600 text-white border-amber-600' : 'bg-white text-amber-800 border-amber-300 hover:bg-amber-50'">
                                    Unclassified ({{ computedCurriculumSubjects.filter(s => !s.classification).length }})
                                </button>
                            </div>
                        </div>

                        <div v-if="loadingStudentSubjects" class="text-center py-8 text-muted">
                            Loading student curriculum...
                        </div>
                        <div v-else-if="filteredStudentCurriculumSubjects.length === 0" class="text-center py-8 text-muted">
                            No curriculum subjects match the selected filter.
                        </div>
                        <div v-else class="overflow-x-auto rounded-lg border border-line bg-white">
                            <table class="w-full text-left border-collapse">
                                <thead>
                                    <tr class="border-b border-line text-[10px] font-bold text-muted uppercase bg-gray-50">
                                        <th class="px-3 py-2.5">Year</th>
                                        <th class="px-3 py-2.5">Semester</th>
                                        <th class="px-3 py-2.5">Code</th>
                                        <th class="px-3 py-2.5">Description</th>
                                        <th class="px-3 py-2.5 text-center">Classification</th>
                                        <th class="px-3 py-2.5 text-center">Units</th>
                                        <th class="px-3 py-2.5 text-center">Status</th>
                                        <th class="px-3 py-2.5">PreReq</th>
                                        <th class="px-3 py-2.5 text-center">PreReq Status</th>
                                        <th class="px-3 py-2.5 text-center">Can Enroll</th>
                                    </tr>
                                </thead>
                                <tbody class="text-[12px]">
                                    <tr v-for="sub in filteredStudentCurriculumSubjects" :key="sub.subject_id" class="border-b border-line hover:bg-mist transition-colors">
                                        <td class="px-3 py-2 text-muted whitespace-nowrap">{{ sub.year }} Year</td>
                                        <td class="px-3 py-2 text-muted whitespace-nowrap">{{ sub.sem == 1 ? '1st' : '2nd' }} Sem</td>
                                        <td class="px-3 py-2 font-bold text-navy whitespace-nowrap">{{ sub.subject_code }}</td>
                                        <td class="px-3 py-2 text-ink">{{ sub.description }}</td>
                                        <td class="px-3 py-2 text-center whitespace-nowrap">
                                            <span v-if="sub.classification === 'MAJOR'" class="px-2 py-0.5 rounded text-[10px] font-bold bg-navy text-white">MAJOR</span>
                                            <span v-else-if="sub.classification === 'MINOR'" class="px-2 py-0.5 rounded text-[10px] font-bold bg-teal-50 text-teal-800 border border-teal-200">MINOR</span>
                                            <span v-else class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-300">UNCLASSIFIED</span>
                                        </td>
                                        <td class="px-3 py-2 text-center font-semibold whitespace-nowrap">{{ sub.units }}</td>
                                        <td class="px-3 py-1 text-center whitespace-nowrap">
                                            <select :value="sub.status" @change="saveSubjectStatus(sub, $event.target.value)" class="text-[10px] px-1.5 py-0.5 rounded-full border font-bold cursor-pointer" :class="sub.statusClass">
                                                <option v-for="opt in statusOptions" :key="opt" :value="opt">{{ opt }}</option>
                                            </select>
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
                                        <option v-for="sem in availableSemesters" :key="sem.value" :value="sem.value">
                                            {{ sem.label }}
                                        </option>
                                    </select>
                                </div>
                            </div>
                            <span v-if="computedGWA" class="text-xs font-bold px-3 py-1 rounded-full border" :class="parseFloat(computedGWA) <= 3 ? 'text-green-700 bg-green-50 border-green-200' : 'text-red-700 bg-red-50 border-red-200'">GWA: {{ computedGWA }} {{ parseFloat(computedGWA) <= 1.75 ? '(Good Standing)' : parseFloat(computedGWA) <= 3 ? '(Passed)' : '(Failed)' }}</span>
                        </div>

                        <div class="overflow-x-auto rounded-lg border border-line bg-white">
                            <table class="w-full text-left border-collapse text-[12px]">
                                <thead>
                                    <tr class="border-b border-line text-[10px] font-bold text-muted uppercase bg-gray-50">
                                        <th class="px-3 py-2.5">Code</th>
                                        <th class="px-3 py-2.5">Description</th>
                                        <th class="px-3 py-2.5 text-center">Classification</th>
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
                                        <td colspan="11" class="text-center py-8 text-muted">
                                            No grade records available for {{ selectedSy || 'selected year' }} - {{ selectedSem || 'selected semester' }}.
                                        </td>
                                    </tr>
                                    <tr v-for="g in filteredGrades" :key="g.subject_code + g.detail_id" class="border-b border-line hover:bg-mist transition-colors">
                                        <td class="px-3 py-2 font-bold text-navy whitespace-nowrap">{{ g.subject_code }}</td>
                                        <td class="px-3 py-2 text-ink">{{ g.description }}</td>
                                        <td class="px-3 py-2 text-center whitespace-nowrap">
                                            <span v-if="g.classification === 'MAJOR'" class="px-2 py-0.5 rounded text-[10px] font-bold bg-navy text-white">MAJOR</span>
                                            <span v-else-if="g.classification === 'MINOR'" class="px-2 py-0.5 rounded text-[10px] font-bold bg-teal-50 text-teal-800 border border-teal-200">MINOR</span>
                                            <span v-else class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-300">UNCLASSIFIED</span>
                                        </td>
                                        <td class="px-3 py-2 text-center font-semibold">{{ g.units }}</td>
                                        <td class="px-3 py-2 text-center">{{ g.prelims || '—' }}</td>
                                        <td class="px-3 py-2 text-center">{{ g.midterms || '—' }}</td>
                                        <td class="px-3 py-2 text-center">{{ g.prefinals || '—' }}</td>
                                        <td class="px-3 py-2 text-center">{{ g.finals || '—' }}</td>
                                        <td class="px-3 py-2 text-center font-bold text-navy">{{ g.final_grade || '—' }}</td>
                                        <td class="px-3 py-2 text-center font-semibold text-navy">{{ g.points || '—' }}</td>
                                        <td class="px-3 py-2 text-center">
                                            <span v-if="g.status" class="px-2.5 py-0.5 rounded-full text-[10px] font-bold border" :class="g.status === 'Passed' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-red-100 text-red-700 border-red-200'">
                                                {{ g.status }}
                                            </span>
                                            <span v-else class="text-muted">—</span>
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
                                    <option v-for="sem in availableSemesters" :key="sem.value" :value="sem.value">
                                        {{ sem.label }}
                                    </option>
                                </select>
                            </div>
                        </div>

                        <div v-if="viewingStudent.enrollment_data" class="p-3 bg-white rounded-lg border border-line grid grid-cols-2 sm:grid-cols-5 gap-3 text-xs">
                            <div>
                                <span class="text-muted block text-[10px]">Enrollment Status</span>
                                <span class="font-bold text-green-700">Enrolled (AY {{ viewingStudent.enrollment_data.school_year }} {{ viewingStudent.enrollment_data.semester }})</span>
                            </div>
                            <div>
                                <span class="text-muted block text-[10px]">Section</span>
                                <span class="font-bold text-navy">{{ viewingStudent.enrollment_data.section || (viewingStudent.enrollment_data.subjects && viewingStudent.enrollment_data.subjects[0] ? viewingStudent.enrollment_data.subjects[0].section_code : '—') }}</span>
                            </div>
                            <div>
                                <span class="text-muted block text-[10px]">Reference No.</span>
                                <span class="font-bold text-navy">{{ viewingStudent.enrollment_data.reference_no }}</span>
                            </div>
                            <div>
                                <span class="text-muted block text-[10px]">Total Enrolled Units</span>
                                <span class="font-bold text-navy">{{ viewingStudent.enrollment_data.subjects ? viewingStudent.enrollment_data.subjects.length : 0 }} Unit(s)</span>
                            </div>
                            <div>
                                <span class="text-muted block text-[10px]">Date Enrolled</span>
                                <span class="font-bold text-navy">{{ viewingStudent.enrollment_data.enrollment_date || 'N/A' }}</span>
                            </div>
                        </div>

                        <div v-if="viewingStudent.enrollment_data && viewingStudent.enrollment_data.subjects" class="overflow-x-auto rounded-lg border border-line bg-white">
                            <table class="w-full text-left border-collapse text-[12px]">
                                <thead>
                                    <tr class="border-b border-line text-[10px] font-bold text-muted uppercase bg-gray-50">
                                        <th class="px-4 py-2.5">Code</th>
                                        <th class="px-4 py-2.5">Description</th>
                                        <th class="px-4 py-2.5">Section</th>
                                        <th class="px-4 py-2.5">Type</th>
                                        <th class="px-4 py-2.5">Days</th>
                                        <th class="px-4 py-2.5">Schedule</th>
                                        <th class="px-4 py-2.5 text-center">Units</th>
                                        <th class="px-4 py-2.5">Room</th>
                                        <th class="px-4 py-2.5 text-center">Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-if="viewingStudent.enrollment_data.subjects.length === 0">
                                        <td colspan="9" class="text-center py-6 text-muted">No enrolled subjects.</td>
                                    </tr>
                                    <tr v-for="s in viewingStudent.enrollment_data.subjects" :key="s.subject_code + s.days" class="border-b border-line hover:bg-mist">
                                        <td class="px-4 py-2 font-bold text-navy">{{ s.subject_code }}</td>
                                        <td class="px-4 py-2 text-ink">{{ s.description }}</td>
                                        <td class="px-4 py-2 font-semibold text-navy">{{ s.section_code || viewingStudent.enrollment_data.section || '—' }}</td>
                                        <td class="px-4 py-2 text-muted">{{ s.type }}</td>
                                        <td class="px-4 py-2 text-muted">{{ s.days }}</td>
                                        <td class="px-4 py-2 text-muted">{{ s.start_time }} - {{ s.end_time }}</td>
                                        <td class="px-4 py-2 text-center font-semibold">{{ s.units }}</td>
                                        <td class="px-4 py-2 text-muted">{{ s.room }}</td>
                                        <td class="px-4 py-2 text-center whitespace-nowrap">
                                            <button type="button" @click="openEditScheduleModal(s)" class="inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold rounded-md border border-navy/30 text-navy bg-navy/5 hover:bg-navy hover:text-white transition-colors">
                                                <app-icon name="CalendarClock" :size="12" /> Edit Schedule
                                            </button>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                        <div v-else class="p-8 text-center text-muted bg-white rounded-lg border border-line">
                            <div class="mx-auto mb-2 grid h-12 w-12 place-items-center rounded-full bg-mist text-muted">
                                <app-icon name="FileText" :size="22" />
                            </div>
                            <p class="font-semibold text-ink text-sm">No Enrollment Record / COR on File</p>
                            <p class="text-caption text-muted mt-1 max-w-sm mx-auto">This student does not have an approved Certificate of Registration (COR) or enrolled subjects for this academic term.</p>
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
                                    <option v-for="sem in availableSemesters" :key="sem.value" :value="sem.value">
                                        {{ sem.label }}
                                    </option>
                                </select>
                            </div>
                        </div>

                        <div v-if="currentFeeAssessment" class="p-4 bg-white rounded-lg border border-line space-y-3">
                            <div class="flex items-center justify-between border-b border-line pb-2">
                                <h4 class="font-bold text-navy text-sm">Tuition & Fee Assessment Summary ({{ selectedSy }} {{ selectedSem }})</h4>
                                <span class="px-2.5 py-1 bg-amber-50 text-amber-800 border border-amber-200 font-bold rounded-full text-xs flex items-center gap-1">
                                    <app-icon name="FileText" :size="12" /> Assessment Record · Registrar
                                </span>
                            </div>

                            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                                <div class="p-3 bg-gray-50 rounded-lg border border-line">
                                    <span class="text-muted block text-[10px] font-medium">Total Assessment (Cash Basis)</span>
                                    <span class="text-lg font-bold text-navy">₱ {{ (parseFloat(currentFeeAssessment.cash_total) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 }) }}</span>
                                </div>
                                <div class="p-3 bg-blue-50/50 rounded-lg border border-blue-100">
                                    <span class="text-muted block text-[10px] font-medium">Total Assessment (Installment Basis)</span>
                                    <span class="text-lg font-bold text-navy">₱ {{ (parseFloat(currentFeeAssessment.installment_total) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 }) }}</span>
                                    <span v-if="parseFloat(currentFeeAssessment.installment_charge) > 0" class="block text-[10px] text-muted mt-0.5">
                                        Includes ₱ {{ (parseFloat(currentFeeAssessment.installment_charge) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 }) }} installment charge
                                    </span>
                                </div>
                            </div>

                            <div class="flex items-start gap-2 p-2.5 bg-slate-50 border border-line rounded-lg text-[11px] text-muted">
                                <app-icon name="Info" :size="14" class="mt-0.5 shrink-0 text-navy" />
                                <span>This is an official assessment preview from the COR. Payment status, official receipts, and account balances are processed and confirmed at the <strong>Finance / Cashier Office</strong>.</span>
                            </div>

                            <div class="border-t border-line pt-3">
                                <h5 class="font-bold text-xs text-navy mb-2">Fee Breakdown</h5>
                                <div class="space-y-1.5 text-xs text-muted">
                                    <div class="flex justify-between"><span>Tuition Fee</span><span class="font-semibold text-ink">₱ {{ (parseFloat(currentFeeAssessment.tuition_fee) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 }) }}</span></div>
                                    <div class="flex justify-between"><span>Laboratory Fee</span><span class="font-semibold text-ink">₱ {{ (parseFloat(currentFeeAssessment.lab_fee) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 }) }}</span></div>
                                    <div class="flex justify-between"><span>Miscellaneous Fees</span><span class="font-semibold text-ink">₱ {{ (parseFloat(currentFeeAssessment.misc_fee) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 }) }}</span></div>
                                    <div class="flex justify-between"><span>LMS Fee</span><span class="font-semibold text-ink">₱ {{ (parseFloat(currentFeeAssessment.lms_fee) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 }) }}</span></div>
                                    <div class="flex justify-between"><span>NSTP/ROTC Fee</span><span class="font-semibold text-ink">₱ {{ (parseFloat(currentFeeAssessment.nstp_fee) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 }) }}</span></div>
                                    <div class="flex justify-between"><span>OMR Fee</span><span class="font-semibold text-ink">₱ {{ (parseFloat(currentFeeAssessment.omr_fee) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2 }) }}</span></div>
                                </div>
                            </div>
                        </div>
                        <div v-else class="p-4 bg-white rounded-lg border border-line text-center text-muted">
                            No fee assessment for the selected year and semester.
                        </div>
                    </div>
                </div>

                <template #footer>
                    <div class="flex items-center justify-end w-full">
                        <button type="button" @click="viewingStudent = null" class="btn btn-secondary btn-sm text-[11px]">Close</button>
                    </div>
                </template>
            </app-modal>

            <!-- ================= EDIT STUDENT MODAL ================= -->
            <app-modal :open="isEditModalOpen" title="Edit Student Information" icon="Edit2" size="xl" @close="isEditModalOpen = false">
                <!-- Header Name Preview Banner -->
                <div class="mb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3.5 bg-[#f5f8fc] border border-[#d2dfef] rounded-lg">
                    <div class="flex items-center gap-2">
                        <span class="text-base font-bold text-[#1b365d]">Edit Student Information</span>
                    </div>
                    <div class="flex-1 text-right">
                        <span class="text-lg font-bold tracking-wide text-[#1b365d]">
                            {{ [editForm.first_name, editForm.middle_name, editForm.last_name].filter(Boolean).join(' ') || 'Edit Student Record' }}
                        </span>
                    </div>
                </div>

                <form id="editStudentModalForm" @submit.prevent="updateStudent" class="space-y-4 text-xs text-ink">
                    <!-- Top ID & Admission Row + Photo -->
                    <div class="grid grid-cols-1 md:grid-cols-4 gap-4 items-start bg-white p-3 border border-line rounded-lg">
                        <!-- Photo Box -->
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
                                <input type="text" v-model="editForm.student_number" placeholder="e.g. 2024-58030" class="input text-xs" required />
                            </div>

                            <!-- Name Fields -->
                            <div class="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                                <div>
                                    <label class="field-label font-semibold">First Name :</label>
                                    <input type="text" v-model="editForm.first_name" placeholder="First Name" class="input text-xs" required />
                                </div>
                                <div>
                                    <label class="field-label font-semibold">Middle Name :</label>
                                    <input type="text" v-model="editForm.middle_name" placeholder="Middle Name" class="input text-xs" />
                                </div>
                                <div>
                                    <label class="field-label font-semibold">Last Name :</label>
                                    <input type="text" v-model="editForm.last_name" placeholder="Last Name" class="input text-xs" required />
                                </div>
                                <div>
                                    <label class="field-label font-semibold">Suffix :</label>
                                    <input type="text" v-model="editForm.suffix" placeholder="Jr., III" class="input text-xs" />
                                </div>
                            </div>

                            <!-- Course, Curriculum, Year Level & Status -->
                            <div class="grid grid-cols-1 sm:grid-cols-4 gap-3">
                                <div>
                                    <label class="field-label font-semibold">Course Title :</label>
                                    <select v-model="editForm.course_id" @change="editCourseChange" class="input text-xs" required>
                                        <option value="">Select Course</option>
                                        <option v-for="c in courses" :key="c.course_id" :value="c.course_id">{{ c.course_code }} - {{ c.course_name }}</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="field-label font-semibold">Curriculum :</label>
                                    <select v-model="editForm.curriculum_id" class="input text-xs" :disabled="!editForm.course_id" required>
                                        <option value="">Select Curriculum</option>
                                        <option v-for="c in editAvailableCurriculums" :key="c.curriculum_id" :value="c.curriculum_id">{{ c.curriculum_code }}</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="field-label font-semibold">Year Level :</label>
                                    <select v-model="editForm.year_level" class="input text-xs" required>
                                        <option>1st Year</option>
                                        <option>2nd Year</option>
                                        <option>3rd Year</option>
                                        <option>4th Year</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="field-label font-semibold">Student Status :</label>
                                    <select v-model="editForm.status" class="input text-xs" required>
                                        <option value="Active">Active</option>
                                        <option value="Enrolled">Enrolled</option>
                                        <option value="Inactive">Inactive</option>
                                        <option value="Transfer">Transfer</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Complete Address Section -->
                    <div class="p-3 bg-white rounded-lg border border-line space-y-2.5">
                        <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
                            <div class="md:col-span-3">
                                <label class="field-label font-semibold">Complete Address :</label>
                                <input type="text" v-model="editForm.address" placeholder="Blk / Lot / Street / Subdivision" class="input text-xs" />
                            </div>
                            <div>
                                <label class="field-label font-semibold">Zip Code :</label>
                                <input type="text" v-model="editForm.zip_code" placeholder="1447" class="input text-xs" />
                            </div>
                        </div>

                        <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                            <div>
                                <label class="field-label font-semibold">Region :</label>
                                <input type="text" v-model="editForm.region" class="input text-xs" />
                            </div>
                            <div>
                                <label class="field-label font-semibold">Province :</label>
                                <input type="text" v-model="editForm.province" class="input text-xs" />
                            </div>
                            <div>
                                <label class="field-label font-semibold">Town/Municipality/City :</label>
                                <input type="text" v-model="editForm.city" class="input text-xs" />
                            </div>
                            <div>
                                <label class="field-label font-semibold">Barangay :</label>
                                <input type="text" v-model="editForm.barangay" class="input text-xs" />
                            </div>
                        </div>
                    </div>

                    <!-- Contact & Demographics -->
                    <div class="p-3 bg-white rounded-lg border border-line space-y-2.5">
                        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                            <div>
                                <label class="field-label font-semibold">Home Land Line :</label>
                                <input type="text" v-model="editForm.landline" placeholder="Landline No." class="input text-xs" />
                            </div>
                            <div>
                                <label class="field-label font-semibold">Mobile No :</label>
                                <input type="text" v-model="editForm.contact_no" placeholder="09XX-XXX-XXXX" class="input text-xs" />
                            </div>
                            <div>
                                <label class="field-label font-semibold">Mobile Provider :</label>
                                <select v-model="editForm.mobile_provider" class="input text-xs">
                                    <option value="Globe">Globe</option>
                                    <option value="Smart">Smart</option>
                                    <option value="DITO">DITO</option>
                                    <option value="TM">TM</option>
                                    <option value="TNT">TNT</option>
                                </select>
                            </div>
                        </div>

                        <div class="grid grid-cols-2 sm:grid-cols-6 gap-2.5">
                            <div>
                                <label class="field-label font-semibold">Gender :</label>
                                <select v-model="editForm.gender" class="input text-xs">
                                    <option value="Female">Female</option>
                                    <option value="Male">Male</option>
                                    <option value="Other">Other</option>
                                </select>
                            </div>
                            <div>
                                <label class="field-label font-semibold">Civil Status :</label>
                                <select v-model="editForm.civil_status" class="input text-xs">
                                    <option value="Single">Single</option>
                                    <option value="Married">Married</option>
                                    <option value="Widowed">Widowed</option>
                                </select>
                            </div>
                            <div>
                                <label class="field-label font-semibold">Nationality :</label>
                                <input type="text" v-model="editForm.nationality" class="input text-xs" />
                            </div>
                            <div>
                                <label class="field-label font-semibold">Date of Birth :</label>
                                <input type="date" v-model="editForm.birth_date" class="input text-xs" />
                            </div>
                            <div>
                                <label class="field-label font-semibold">Age :</label>
                                <input type="number" v-model="editForm.age" class="input text-xs" />
                            </div>
                            <div>
                                <label class="field-label font-semibold">Place of Birth :</label>
                                <input type="text" v-model="editForm.birth_place" class="input text-xs" />
                            </div>
                        </div>

                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            <div>
                                <label class="field-label font-semibold">Email Address :</label>
                                <input type="email" v-model="editForm.email" placeholder="example@gmail.com" class="input text-xs" />
                            </div>
                            <div>
                                <label class="field-label font-semibold">Religion :</label>
                                <input type="text" v-model="editForm.religion" class="input text-xs" />
                            </div>
                        </div>
                    </div>
                </form>

                <!-- Actions Footer -->
                <template #footer>
                    <div class="flex items-center justify-end w-full gap-2 text-xs">
                        <button type="button" @click="isEditModalOpen = false" class="btn btn-secondary btn-sm text-[11px]" :disabled="editLoading">
                            Cancel
                        </button>
                        <button type="submit" form="editStudentModalForm" class="btn btn-primary btn-sm text-[11px] bg-navy" :disabled="editLoading">
                            <app-icon :name="editLoading ? 'LoaderCircle' : 'Save'" :size="13" :class="editLoading ? 'animate-spin' : ''" />
                            {{ editLoading ? 'Saving...' : 'Save Changes' }}
                        </button>
                    </div>
                </template>
            </app-modal>

            <!-- EDIT CLASS SCHEDULE MODAL (Registrar Official Action) -->
            <app-modal :open="!!scheduleEditor" title="Official Class Schedule Editor" icon="CalendarClock" @close="scheduleEditor = null">
                <template v-if="scheduleEditor">
                    <div class="space-y-3.5 text-xs">
                        <div class="p-3 rounded-lg bg-blue-50 border border-blue-200 flex items-start gap-2.5 text-navy">
                            <app-icon name="Info" :size="16" class="mt-0.5 shrink-0 text-blue-600" />
                            <div>
                                <span class="font-bold">Official Registrar Record Update</span>
                                <p class="text-muted text-[11px] mt-0.5 leading-relaxed">
                                    Modifying this subject schedule will update the student's enrollment record. If this student is an active Student Assistant, their duty schedule will be evaluated and their S.A. Coordinator will be automatically notified.
                                </p>
                            </div>
                        </div>

                        <div class="grid grid-cols-2 gap-3 bg-gray-50/70 p-3 rounded-lg border border-line">
                            <div>
                                <span class="text-muted block text-[10px] uppercase font-bold">Subject Code</span>
                                <span class="font-bold text-navy text-sm">{{ scheduleEditor.subjectCode }}</span>
                            </div>
                            <div>
                                <span class="text-muted block text-[10px] uppercase font-bold">Description</span>
                                <span class="font-medium text-ink">{{ scheduleEditor.description }}</span>
                            </div>
                        </div>

                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                                <label class="field-label font-semibold">Days *</label>
                                <select v-model="scheduleEditor.days" class="input text-xs">
                                    <option value="MON">MON - Monday</option>
                                    <option value="TUE">TUE - Tuesday</option>
                                    <option value="WED">WED - Wednesday</option>
                                    <option value="THU">THU - Thursday</option>
                                    <option value="FRI">FRI - Friday</option>
                                    <option value="SAT">SAT - Saturday</option>
                                    <option value="SUN">SUN - Sunday</option>
                                    <option value="MWF">MWF - Mon / Wed / Fri</option>
                                    <option value="TTh">TTh - Tue / Thu</option>
                                    <option value="FS">FS - Fri / Sat</option>
                                </select>
                            </div>
                            <div>
                                <label class="field-label font-semibold">Section</label>
                                <input type="text" v-model="scheduleEditor.section" placeholder="e.g. BSIT - 21M4" class="input text-xs" />
                            </div>
                            <div>
                                <label class="field-label font-semibold">Start Time *</label>
                                <input type="time" v-model="scheduleEditor.startTime" class="input text-xs" />
                            </div>
                            <div>
                                <label class="field-label font-semibold">End Time *</label>
                                <input type="time" v-model="scheduleEditor.endTime" class="input text-xs" />
                            </div>
                            <div>
                                <label class="field-label font-semibold">Room</label>
                                <input type="text" v-model="scheduleEditor.room" placeholder="e.g. 5401 or LAB 1" class="input text-xs" />
                            </div>
                            <div>
                                <label class="field-label font-semibold">Type</label>
                                <select v-model="scheduleEditor.type" class="input text-xs">
                                    <option value="Lec">Lecture (Lec)</option>
                                    <option value="Lab">Laboratory (Lab)</option>
                                    <option value="Lec/Lab">Lec/Lab</option>
                                </select>
                            </div>
                        </div>

                        <div>
                            <label class="field-label font-semibold">Reason for Schedule Change *</label>
                            <textarea v-model="scheduleEditor.reason" rows="2" maxlength="250"
                                      placeholder="State the official reason (e.g. Class transferred to new room, Section schedule adjustment)"
                                      class="input text-xs"></textarea>
                        </div>

                        <div v-if="scheduleEditor.error" class="p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-700 flex items-center gap-2 text-xs">
                            <app-icon name="TriangleAlert" :size="15" class="shrink-0" />
                            <span>{{ scheduleEditor.error }}</span>
                        </div>
                    </div>
                </template>
                <template #footer v-if="scheduleEditor">
                    <div class="flex items-center justify-between w-full text-xs">
                        <button type="button" @click="dropEnrolledSubject" :disabled="scheduleEditor.saving" class="btn btn-secondary text-red-600 hover:bg-red-50 hover:border-red-200">
                            <app-icon name="Trash2" :size="14" /> Drop / Remove Period
                        </button>
                        <div class="flex items-center gap-2">
                            <button type="button" @click="scheduleEditor = null" class="btn btn-secondary" :disabled="scheduleEditor.saving">Cancel</button>
                            <button type="button" @click="saveScheduleEdit" :disabled="scheduleEditor.saving" class="btn btn-primary bg-navy">
                                <app-icon :name="scheduleEditor.saving ? 'LoaderCircle' : 'Check'" :size="14" :class="scheduleEditor.saving ? 'animate-spin' : ''" />
                                {{ scheduleEditor.saving ? 'Saving...' : 'Save Schedule Change' }}
                            </button>
                        </div>
                    </div>
                </template>
            </app-modal>
        </div>
    `
};

