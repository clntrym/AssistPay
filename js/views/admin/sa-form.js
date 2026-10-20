// Register S.A. / Edit S.A. (PDF: S.A. Management — Master S.A. Data).
// The server validates everything again; the rules here only guide the Coordinator.
const SaFormPage = {
    components: { AppIcon, PageHeader, FormField, AppModal, CredentialsPanel },

    setup() {
        const route = VueRouter.useRoute();
        const router = VueRouter.useRouter();
        const editId = Vue.computed(() => route.params.id ? Number(route.params.id) : null);
        const isEdit = Vue.computed(() => !!editId.value);

        const options = Vue.ref(null);
        const loading = Vue.ref(true);
        const loadError = Vue.ref("");
        const saving = Vue.ref(false);
        const original = Vue.ref(null);   // record as loaded (edit mode)
        const savedSnapshot = Vue.ref(""); // for the unsaved-changes check

        const blank = () => ({
            studentId: "", saNumber: "", firstName: "", middleName: "", lastName: "", suffix: "", birthDate: "", sex: "",
            contactNumber: "", schoolEmail: "", personalEmail: "",
            course: "", yearLevel: 1, semesterId: "", academicStatus: "REGULAR", enrollmentStatus: "ENROLLED", expectedGraduation: "",
            saCategory: "", departmentType: "", officeId: "", supervisorId: "", saStatus: "ACTIVE",
            appointmentStart: new Date().toISOString().slice(0, 10), appointmentEnd: "", assignmentStatus: "UNASSIGNED", weeklyTargetHours: 35, isReliever: false,
            hourlyRate: 8, tuitionFee: "", miscFee: "",
            emergencyName: "", emergencyNumber: "", emergencyRelationship: ""
        });
        const form = Vue.reactive(blank());
        const errors = Vue.reactive({});
        const formError = Vue.ref("");
        const errorCount = Vue.computed(() => Object.keys(errors).length);

        const sections = [
            { id: "student", label: "Student information", icon: "User" },
            { id: "academic", label: "Academic information", icon: "GraduationCap" },
            { id: "face", label: "Face recognition", icon: "ScanFace" },
            { id: "assignment", label: "Assignment and supervisor", icon: "Building2" },
            { id: "benefits", label: "Allowance", icon: "Wallet" },
            { id: "emergency", label: "Emergency contact", icon: "Phone" }
        ];

        // ---------- Load ----------
        const fromRecord = sa => ({
            studentId: sa.studentId, saNumber: sa.saNumber || "", firstName: sa.firstName, middleName: sa.middleName || "", lastName: sa.lastName,
            suffix: sa.suffix || "", birthDate: sa.birthDate || "", sex: sa.sex || "", contactNumber: sa.contactNumber,
            schoolEmail: sa.schoolEmail, personalEmail: sa.personalEmail || "",
            course: (options.value?.courses?.find(c => c.code.toUpperCase() === (sa.course || '').toUpperCase())?.code) || sa.course || "",
            yearLevel: sa.yearLevel, semesterId: sa.semester.id, academicStatus: sa.academicStatus,
            enrollmentStatus: sa.enrollmentStatus, expectedGraduation: sa.expectedGraduation || "",
            saCategory: sa.saCategory, departmentType: sa.departmentType || sa.saCategory, officeId: sa.office?.id || "",
            supervisorId: sa.supervisor?.id || "", saStatus: sa.saStatus || "ACTIVE",
            appointmentStart: sa.appointmentStart || new Date().toISOString().slice(0, 10),
            appointmentEnd: sa.appointmentEnd || "", assignmentStatus: sa.assignmentStatus || "UNASSIGNED",
            weeklyTargetHours: sa.weeklyTargetHours || 35, isReliever: false,
            hourlyRate: sa.benefits?.saHourlyRate ? Math.max(8, Number(sa.benefits.saHourlyRate)) : 8,
            tuitionFee: "", miscFee: "",
            emergencyName: sa.emergencyName || "", emergencyNumber: sa.emergencyNumber || "",
            emergencyRelationship: sa.emergencyRelationship || ""
        });

        const load = async () => {
            loading.value = true;
            loadError.value = "";
            const [opt, rec] = await Promise.all([
                Model.request("sa", "options"),
                isEdit.value ? Model.request("sa", "get", { id: editId.value }) : Promise.resolve(null)
            ]);
            if (!opt.success) { loadError.value = opt.message; loading.value = false; return; }
            if (rec && !rec.success) { loadError.value = rec.message; loading.value = false; return; }
            options.value = opt.options;

            if (rec) {
                original.value = rec.sa;
                Object.assign(form, fromRecord(rec.sa));
                const supList = supervisorOptions.value;
                if (form.supervisorId && !supList.some(s => Number(s.id) === Number(form.supervisorId))) {
                    form.supervisorId = "";
                }
                if (rec.sa.studentId) {
                    Model.request("sa", "lookup_student", { studentNumber: rec.sa.studentId }).then(res => {
                        if (res && res.success && res.found) {
                            registrarStudent.value = res.student;
                            studentLookup.value = "found";
                            if (res.student.feeAssessment) {
                                form.tuitionFee = res.student.feeAssessment.tuitionFee;
                                form.miscFee = res.student.feeAssessment.miscFee;
                            }
                        }
                    });
                }
                if (rec.sa.course) {
                    loadCurriculum(rec.sa.course, null, rec.sa.studentId);
                }
                if (rec.sa.biometrics && rec.sa.biometrics.hasFace) {
                    existingBiometrics.value = rec.sa.biometrics;
                } else {
                    existingBiometrics.value = null;
                }
                faceSnapshot.value = "";
                faceDescriptor.value = null;
            } else {
                Object.assign(form, blank());
                existingBiometrics.value = null;
                faceSnapshot.value = "";
                faceDescriptor.value = null;
                form.saNumber = opt.options?.nextSaNumber || "";
                const active = opt.options.semesters.find(s => s.status === "ACTIVE") || opt.options.semesters[0];
                if (active) { form.semesterId = active.id; form.appointmentStart = active.startDate; }
                form.hourlyRate = active?.hourlyRate ? Math.max(8, Number(active.hourlyRate)) : 8;
            }
            await Vue.nextTick();
            savedSnapshot.value = JSON.stringify(form);
            loading.value = false;

            if (route.hash) {
                await Vue.nextTick();
                document.querySelector(route.hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        };
        Vue.onMounted(load);

        // ---------- Auto-fetch student data from registrar DB ----------
        const studentLookup = Vue.ref('');
        const registrarStudent = Vue.ref(null);
        const curriculumData = Vue.ref(null);
        const curriculumLoading = Vue.ref(false);
        const showCurriculum = Vue.ref(false);
        const studentSubjects = Vue.ref([]);
        const studentStatuses = Vue.ref({});

        const enrolledUnits = Vue.computed(() => registrarStudent.value?.enrolledUnits || 0);
        const unitWarning = Vue.computed(() => {
            const u = enrolledUnits.value;
            if (u > 18) return { type: 'over', text: u + ' units enrolled — exceeds 18-unit limit. Needs admin approval.' };
            if (u > 0 && u <= 18) return { type: 'ok', text: u + ' units enrolled (max 18).' };
            return null;
        });

        const passedCodes = Vue.computed(() => {
            const set = new Set();
            studentSubjects.value.forEach(sub => {
                const st = studentStatuses.value[sub.subject_id];
                if (st === 'Passed') set.add(sub.subject_code);
            });
            return set;
        });

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

        const calculatedStudentAnalysis = Vue.computed(() => {
            if (!studentSubjects.value || !studentSubjects.value.length) {
                const yl = registrarStudent.value?.yearLevel || form.yearLevel || 1;
                const nowYear = new Date().getFullYear();
                const remYears = Math.max(0, 4 - yl);
                const fallbackGrad = String(nowYear + remYears + (new Date().getMonth() >= 5 ? 1 : 0));
                return {
                    yearLevel: yl,
                    academicStatus: form.academicStatus || 'REGULAR',
                    expectedGraduation: fallbackGrad
                };
            }

            const subs = computedCurriculumSubjects.value;

            // 1. Calculate Year Level: Lowest year level with unpassed subjects
            let minUnpassedYear = 4;
            let hasUnpassed = false;
            subs.forEach(s => {
                if (s.status !== 'Passed') {
                    hasUnpassed = true;
                    if (s.year < minUnpassedYear) {
                        minUnpassedYear = s.year;
                    }
                }
            });
            const calculatedYearLevel = hasUnpassed ? minUnpassedYear : 4;

            // 2. Calculate Regular vs Irregular Status
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

            let isIrregular = false;
            for (const s of subs) {
                const isPastTerm = (s.year < maxYear) || (s.year === maxYear && s.sem < maxSem);

                if (isPastTerm && s.status !== 'Passed') {
                    isIrregular = true;
                    break;
                }

                if (s.status === 'Failed' || s.status === 'Incomplete' || s.status === 'Dropped') {
                    isIrregular = true;
                    break;
                }

                if (s.prereq && s.prereq !== '—' && s.prereq !== '' && s.prereqStatus === 'Pending' && (s.status === 'Enrolled' || s.status === 'Passed')) {
                    isIrregular = true;
                    break;
                }
            }
            const calculatedAcademicStatus = isIrregular ? 'IRREGULAR' : 'REGULAR';

            // 3. Auto-Calculate Expected Graduation Year by simulating remaining terms
            let startSyYear = 2026;
            let startSem = 1;

            if (registrarStudent.value && registrarStudent.value.schoolYear) {
                const m = registrarStudent.value.schoolYear.match(/^(\d{4})/);
                if (m) startSyYear = parseInt(m[1], 10);
                if (registrarStudent.value.termName && registrarStudent.value.termName.includes('2nd')) {
                    startSem = 2;
                }
            } else {
                const now = new Date();
                startSyYear = now.getFullYear();
                startSem = (now.getMonth() >= 5 && now.getMonth() <= 10) ? 1 : 2;
            }

            const simulatedPassed = new Set(passedCodes.value);
            let remainingSubs = subs.filter(s => s.status !== 'Passed');

            let currentSyYear = startSyYear;
            let currentSemNum = startSem;
            let termCount = 0;
            const maxTermsLimit = 16;

            while (remainingSubs.length > 0 && termCount < maxTermsLimit) {
                termCount++;

                const eligible = remainingSubs.filter(s => {
                    if (!s.prereq || s.prereq === '—' || s.prereq === '') return true;
                    const reqs = s.prereq.split(',').map(r => r.trim());
                    return reqs.every(r => simulatedPassed.has(r));
                });

                if (eligible.length === 0) {
                    eligible.push(remainingSubs[0]);
                }

                eligible.sort((a, b) => {
                    const aIsPrereqForOthers = subs.some(x => x.prereq && x.prereq.includes(a.subject_code));
                    const bIsPrereqForOthers = subs.some(x => x.prereq && x.prereq.includes(b.subject_code));
                    if (aIsPrereqForOthers !== bIsPrereqForOthers) return bIsPrereqForOthers ? -1 : 1;
                    if (a.year !== b.year) return a.year - b.year;
                    return a.sem - b.sem;
                });

                let termUnits = 0;
                const maxTermUnits = 18;
                const scheduledThisTerm = [];

                for (const sub of eligible) {
                    const subUnits = parseFloat(sub.units) || 3;
                    if (scheduledThisTerm.length === 0 || termUnits + subUnits <= maxTermUnits + 1) {
                        scheduledThisTerm.push(sub);
                        termUnits += subUnits;
                    }
                }

                if (scheduledThisTerm.length === 0 && remainingSubs.length > 0) {
                    scheduledThisTerm.push(remainingSubs[0]);
                }

                scheduledThisTerm.forEach(s => {
                    simulatedPassed.add(s.subject_code);
                });

                const scheduledIds = new Set(scheduledThisTerm.map(s => s.subject_id));
                remainingSubs = remainingSubs.filter(s => !scheduledIds.has(s.subject_id));

                if (remainingSubs.length > 0) {
                    if (currentSemNum === 1) {
                        currentSemNum = 2;
                    } else {
                        currentSemNum = 1;
                        currentSyYear += 1;
                    }
                }
            }

            const calculatedGradYear = (currentSemNum === 2) ? (currentSyYear + 1) : currentSyYear;

            return {
                yearLevel: calculatedYearLevel,
                academicStatus: calculatedAcademicStatus,
                expectedGraduation: String(calculatedGradYear)
            };
        });

        const expectedGraduation = Vue.computed(() => {
            return calculatedStudentAnalysis.value.expectedGraduation;
        });

        Vue.watch(calculatedStudentAnalysis, analysis => {
            if (analysis && (registrarStudent.value || studentSubjects.value.length > 0)) {
                form.yearLevel = analysis.yearLevel;
                form.academicStatus = analysis.academicStatus;
                if (!isEdit.value || !form.expectedGraduation) {
                    form.expectedGraduation = analysis.expectedGraduation;
                }
            }
        }, { immediate: true, deep: true });

        const loadCurriculum = async (courseCode, curriculumId, studentId) => {
            const currId = curriculumId || registrarStudent.value?.curriculumId;
            const stId = studentId || registrarStudent.value?.id || registrarStudent.value?.studentNumber || registrarStudent.value?.student_id || form.studentId || original.value?.studentId;
            if (!courseCode && !currId) {
                curriculumData.value = null;
                studentSubjects.value = [];
                studentStatuses.value = {};
                return;
            }
            curriculumLoading.value = true;
            const params = {};
            if (currId) params.curriculum_id = currId;
            else if (courseCode) params.course_code = courseCode;

            const reqs = [Model.request('students/get_curriculum', 'get_structure', params)];
            if (stId) {
                reqs.push(Model.request('students/get_curriculum', 'get_student_statuses', { student_id: stId }));
            }

            const [r, stRes] = await Promise.all(reqs);
            curriculumLoading.value = false;

            if (r && r.success) {
                curriculumData.value = r;
                studentSubjects.value = r.subjects || [];
            } else {
                curriculumData.value = null;
                studentSubjects.value = [];
            }

            if (stRes && stRes.success) {
                studentStatuses.value = stRes.statuses || {};
            } else {
                studentStatuses.value = {};
            }
        };

        let lookupTimer = null;
        Vue.watch(() => form.studentId, val => {
            if (loading.value || isEdit.value) return;
            clearTimeout(lookupTimer);
            if (!/^\d{4}-\d{4,6}$/.test(val)) { studentLookup.value = ''; registrarStudent.value = null; return; }
            lookupTimer = setTimeout(async () => {
                studentLookup.value = 'loading';
                const r = await Model.request('sa', 'lookup_student', { studentNumber: val });
                if (r.success && r.found) {
                    const s = r.student;
                    registrarStudent.value = s;
                    form.firstName = s.firstName || form.firstName;
                    form.middleName = s.middleName || form.middleName;
                    form.lastName = s.lastName || form.lastName;
                    form.suffix = s.suffix || form.suffix;
                    form.sex = s.sex || form.sex;
                    form.birthDate = s.birthDate || form.birthDate;
                    form.contactNumber = s.contactNumber || form.contactNumber;
                    form.schoolEmail = s.schoolEmail || form.schoolEmail;
                    if (s.course) {
                        const match = options.value?.courses?.find(c => c.code.toUpperCase() === s.course.toUpperCase());
                        form.course = match ? match.code : s.course;
                    }
                    if (s.yearLevel) form.yearLevel = s.yearLevel;
                    if (s.enrollmentStatus) form.enrollmentStatus = s.enrollmentStatus;
                    if (s.academicStatus) form.academicStatus = s.academicStatus;
                    if (s.course || s.curriculumId) loadCurriculum(s.course, s.curriculumId, s.id || s.studentNumber || s.student_id);
                    if (s.feeAssessment) {
                        form.tuitionFee = s.feeAssessment.tuitionFee;
                        form.miscFee = s.feeAssessment.miscFee;
                    }
                    studentLookup.value = 'found';
                    if (r.alreadyRegistered || s.alreadyRegistered) {
                        const saNum = r.existingSaNumber || s.existingSaNumber;
                        errors.studentId = `This Student ID (${val}) is already registered as a Student Assistant${saNum ? ' (' + saNum + ')' : ''}. Duplicate registration is not allowed.`;
                        Alerts.warning('Duplicate Registration', errors.studentId);
                        Store.toast('danger', errors.studentId);
                    }
                } else {
                    studentLookup.value = 'not_found';
                    registrarStudent.value = null;
                }
            }, 400);
        });

        // ---------- Category & Supervisor Mapping ----------
        Vue.watch(() => form.saCategory, (cat) => {
            if (loading.value) return;
            if (cat) form.departmentType = cat;
            if (cat !== "OFFICE") form.officeId = "";
        });

        const supervisorOptions = Vue.computed(() => {
            if (!options.value || !form.saCategory) return [];
            const cat = form.saCategory.toUpperCase();
            if (cat === "OFFICE" || cat === "OFFICES") {
                if (!form.officeId) {
                    return options.value.supervisors.filter(s => {
                        const sc = (s.category || '').toUpperCase();
                        return sc === "OFFICE" || sc === "OFFICES" || (Array.isArray(s.officeIds) && s.officeIds.length > 0);
                    });
                }
                const targetOfficeId = Number(form.officeId);
                const targetOffice = options.value.offices.find(o => Number(o.id) === targetOfficeId);
                const targetOfficeName = targetOffice ? targetOffice.name.toUpperCase() : '';

                return options.value.supervisors.filter(s => {
                    const primaryMatch = Number(s.officeId) === targetOfficeId;
                    const multiMatch = Array.isArray(s.officeIds) && s.officeIds.map(Number).includes(targetOfficeId);
                    const nameMatch = targetOfficeName && Array.isArray(s.officeNames) && s.officeNames.some(n => (n || '').toUpperCase() === targetOfficeName);

                    return primaryMatch || multiMatch || nameMatch;
                });
            }
            return options.value.supervisors.filter(s => (s.category || '').toUpperCase() === cat);
        });

        Vue.watch([() => form.saCategory, () => form.officeId], () => {
            if (loading.value) return;
            const list = supervisorOptions.value;
            if (form.supervisorId && !list.some(s => Number(s.id) === Number(form.supervisorId))) {
                form.supervisorId = "";
            }
        });

        Vue.watch(() => form.assignmentStatus, st => {
            if (loading.value) return;
            if (st !== "ASSIGNED") {
                form.supervisorId = "";
                form.officeId = "";
            }
        });

        // Clear a field's error when it changes
        for (const key of Object.keys(blank())) {
            Vue.watch(() => form[key], () => { if (errors[key]) delete errors[key]; });
        }

        // ---------- Office Vacancy / Capacity Helpers ----------
        const isCurrentAssignedOffice = (off) => {
            if (!isEdit.value || !original.value || original.value.assignmentStatus !== 'ASSIGNED') return false;
            const origOffId = Number(original.value.office?.id || original.value.officeId || 0);
            return origOffId > 0 && origOffId === Number(off.id);
        };

        const getOfficeAvailableSlots = (off) => {
            if (!off) return 0;
            const req = off.requiredSa != null ? Number(off.requiredSa) : 0;
            if (req <= 0) return 0;
            const assigned = Number(off.assignedSa || 0);
            const otherAssigned = isCurrentAssignedOffice(off) ? Math.max(0, assigned - 1) : assigned;
            return Math.max(0, req - otherAssigned);
        };

        const isOfficeAvailable = (off) => {
            return getOfficeAvailableSlots(off) > 0;
        };

        // ---------- Validation ----------
        const NAME_RE = /^\p{L}[\p{L}\p{M}'. -]*$/u;
        const NAME_MESSAGE = "Letters, spaces, hyphens and apostrophes only.";
        const EMERGENCY_TEXT_RE = /^[\p{L}\p{M}\d'.\s\-\/\(\),&#]+$/u;
        const EMERGENCY_TEXT_MESSAGE = "Letters, spaces, hyphens, slashes and common punctuation only.";
        const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
        const MOBILE_RE = /^(09|\+639)\d{9}$/;

        const clientErrors = () => {
            const e = {};
            const text = k => String(form[k] ?? "").trim();
            const name = (k, max, required) => {
                const v = text(k);
                if (!v) { if (required) e[k] = "Required."; return; }
                if (v.length > max) e[k] = "Use " + max + " characters or fewer.";
                else if (!NAME_RE.test(v)) e[k] = NAME_MESSAGE;
            };

            // 1. Student information
            if (!/^\d{4}-\d{4,6}$/.test(text("studentId"))) e.studentId = "Use the format 2026-00123.";
            else if (!isEdit.value && studentLookup.value !== "found") e.studentId = "Student record must be found in the registrar.";
            else if (!isEdit.value && registrarStudent.value?.alreadyRegistered) {
                const saNum = registrarStudent.value?.existingSaNumber;
                e.studentId = `This Student ID (${text("studentId")}) is already registered as a Student Assistant${saNum ? ' (' + saNum + ')' : ''}. Duplicate registration is not allowed.`;
            }
            name("firstName", 60, true);
            name("lastName", 60, true);
            name("middleName", 60, false);
            name("suffix", 10, false);
            if (form.birthDate) {
                const limit = new Date();
                limit.setFullYear(limit.getFullYear() - 14);
                if (isNaN(Date.parse(form.birthDate))) e.birthDate = "Enter a valid date.";
                else if (form.birthDate > limit.toISOString().slice(0, 10)) e.birthDate = "Check the date of birth.";
            }
            if (!MOBILE_RE.test(text("contactNumber").replace(/[\s-]/g, ""))) e.contactNumber = "Use a mobile number like 09171234567.";
            if (!EMAIL_RE.test(text("schoolEmail")) || text("schoolEmail").length > 150) e.schoolEmail = "Enter a valid email address.";

            // 2. Academic information
            if (!form.course) e.course = "Choose a course.";

            // 3. Assignment
            if (form.assignmentStatus === "ASSIGNED") {
                if (!form.saCategory) e.saCategory = "Choose a category.";
                if (form.saCategory === "OFFICE") {
                    if (!form.officeId) {
                        e.officeId = "Choose the office/department.";
                    } else {
                        const off = (options.value?.offices || []).find(o => Number(o.id) === Number(form.officeId));
                        if (off && !isOfficeAvailable(off)) {
                            e.officeId = `No vacancy! The office ${off.name} is already full (0 vacant slots). Cannot save.`;
                        }
                    }
                }
            }

            // 4. Allowance
            const rate = Number(form.hourlyRate);
            if (form.hourlyRate === "" || form.hourlyRate === null || isNaN(rate) || rate < 8) {
                e.hourlyRate = "The allowance cannot be below ₱8 an hour.";
            } else if (!Number.isInteger(rate)) {
                e.hourlyRate = "Enter whole pesos, no centavos.";
            } else if (rate > 1000) {
                e.hourlyRate = "Enter ₱1,000 an hour or less.";
            }

            // 5. Emergency contact (Required)
            const emName = text("emergencyName");
            if (!emName) {
                e.emergencyName = "Required.";
            } else if (emName.length > 120) {
                e.emergencyName = "Use 120 characters or fewer.";
            } else if (!EMERGENCY_TEXT_RE.test(emName)) {
                e.emergencyName = EMERGENCY_TEXT_MESSAGE;
            }

            const emRel = text("emergencyRelationship");
            if (!emRel) {
                e.emergencyRelationship = "Required.";
            } else if (emRel.length > 40) {
                e.emergencyRelationship = "Use 40 characters or fewer.";
            } else if (!EMERGENCY_TEXT_RE.test(emRel)) {
                e.emergencyRelationship = EMERGENCY_TEXT_MESSAGE;
            }
            const emNum = text("emergencyNumber").replace(/[\s-]/g, "");
            if (!emNum) {
                e.emergencyNumber = "Enter an emergency contact number.";
            } else if (!MOBILE_RE.test(emNum)) {
                e.emergencyNumber = "Use a mobile number like 09171234567.";
            }
            return e;
        };

        const selectedSemester = Vue.computed(() => options.value?.semesters.find(s => s.id === Number(form.semesterId)));

        // ---------- Save ----------
        const dirty = Vue.computed(() => !loading.value && JSON.stringify(form) !== savedSnapshot.value);
        const assignmentChanges = Vue.computed(() => {
            const o = original.value;
            if (!o || !options.value) return [];
            const officeName = id => options.value.offices.find(x => x.id === Number(id))?.name || "None";
            const supName = id => options.value.supervisors.find(x => x.id === Number(id))?.name || "None";
            const out = [];
            const add = (field, from, to) => { if (from !== to) out.push({ field, from, to }); };
            add("S.A. status", label("saStatus", o.saStatus), label("saStatus", form.saStatus));
            add("Assignment status", label("assignmentStatus", o.assignmentStatus), label("assignmentStatus", form.assignmentStatus));
            if (form.assignmentStatus === "ASSIGNED") {
                add("S.A. category", label("saCategory", o.saCategory), label("saCategory", form.saCategory));
                add("Office", o.office?.name || "None", form.saCategory === "OFFICE" ? officeName(form.officeId) : "None");
                add("Supervisor", o.supervisor?.name || "None", supName(form.supervisorId));
            }
            return out;
        });

        // ---------- Face Recognition Biometrics ----------
        const faceVideoRef = Vue.ref(null);
        const isCameraActive = Vue.ref(false);
        const isModelLoading = Vue.ref(false);
        const isFaceDetecting = Vue.ref(false);
        const faceDetected = Vue.ref(false);
        const faceDetectionScore = Vue.ref(0);
        const faceStatusMessage = Vue.ref("Camera is closed. Click button below to activate webcam.");
        const cameraError = Vue.ref("");
        const faceSnapshot = Vue.ref("");
        const faceDescriptor = Vue.ref(null);
        const existingBiometrics = Vue.ref(null);
        let faceDetectInterval = null;
        let webcamStream = null;
        let modelsLoaded = false;

        const loadFaceModels = async () => {
            if (modelsLoaded) return true;
            isModelLoading.value = true;
            faceStatusMessage.value = "Initializing biometric neural network...";
            try {
                if (typeof faceapi === "undefined") {
                    throw new Error("face-api library is not loaded.");
                }
                const modelsPath = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '') + '/models';
                try {
                    await Promise.all([
                        faceapi.nets.tinyFaceDetector.loadFromUri(modelsPath),
                        faceapi.nets.faceLandmark68Net.loadFromUri(modelsPath),
                        faceapi.nets.faceRecognitionNet.loadFromUri(modelsPath)
                    ]);
                } catch (e1) {
                    console.warn("Retrying models with relative path 'models'...", e1);
                    await Promise.all([
                        faceapi.nets.tinyFaceDetector.loadFromUri('models'),
                        faceapi.nets.faceLandmark68Net.loadFromUri('models'),
                        faceapi.nets.faceRecognitionNet.loadFromUri('models')
                    ]);
                }
                modelsLoaded = true;
                isModelLoading.value = false;
                return true;
            } catch (err) {
                console.error("Failed to load face detection models:", err);
                cameraError.value = "Failed to load facial recognition models. Please check network/models folder.";
                isModelLoading.value = false;
                faceStatusMessage.value = "Failed to load neural models.";
                return false;
            }
        };

        const stopCamera = () => {
            if (faceDetectInterval) {
                clearInterval(faceDetectInterval);
                faceDetectInterval = null;
            }
            if (webcamStream) {
                webcamStream.getTracks().forEach(track => {
                    try { track.stop(); } catch (e) {}
                });
                webcamStream = null;
            }
            if (faceVideoRef.value) {
                faceVideoRef.value.srcObject = null;
            }
            isCameraActive.value = false;
            isFaceDetecting.value = false;
            faceDetected.value = false;
            faceDetectionScore.value = 0;
            faceStatusMessage.value = "Camera is closed. Click button below to activate webcam.";
        };

        const startFaceDetectionLoop = () => {
            if (faceDetectInterval) clearInterval(faceDetectInterval);
            faceDetectInterval = setInterval(async () => {
                if (!isCameraActive.value || !faceVideoRef.value || faceVideoRef.value.paused || faceVideoRef.value.ended) {
                    return;
                }
                if (isFaceDetecting.value) return;

                isFaceDetecting.value = true;
                try {
                    const videoEl = faceVideoRef.value;
                    if (videoEl && videoEl.readyState >= 2) {
                        const opt = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
                        const detection = await faceapi.detectSingleFace(videoEl, opt);
                        if (detection) {
                            faceDetected.value = true;
                            faceDetectionScore.value = Math.round(detection.score * 100);
                            faceStatusMessage.value = `Face detected (${faceDetectionScore.value}% confidence). Ready to capture!`;
                        } else {
                            faceDetected.value = false;
                            faceDetectionScore.value = 0;
                            faceStatusMessage.value = "Looking for face... Please center inside the oval guide.";
                        }
                    }
                } catch (e) {
                    console.debug("Detection loop:", e);
                } finally {
                    isFaceDetecting.value = false;
                }
            }, 350);
        };

        const startCamera = async () => {
            cameraError.value = "";
            isFaceDetecting.value = false;
            faceDetected.value = false;
            faceStatusMessage.value = "Requesting camera access...";

            const ok = await loadFaceModels();
            if (!ok) return;

            try {
                if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                    throw new Error("Your browser or connection does not support webcam access.");
                }

                const stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        width: { ideal: 640 },
                        height: { ideal: 480 },
                        facingMode: "user"
                    },
                    audio: false
                });

                webcamStream = stream;
                isCameraActive.value = true;
                faceStatusMessage.value = "Align your face inside the viewfinder guide.";

                await Vue.nextTick();
                if (faceVideoRef.value) {
                    faceVideoRef.value.srcObject = stream;
                    faceVideoRef.value.play().catch(e => console.warn("Video play error:", e));
                    startFaceDetectionLoop();
                }
            } catch (err) {
                console.error("Webcam access error:", err);
                stopCamera();
                if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                    cameraError.value = "Camera permission was denied. Please allow camera access in browser settings.";
                } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                    cameraError.value = "No camera device found on this system.";
                } else {
                    cameraError.value = "Could not activate webcam: " + (err.message || err.name);
                }
            }
        };

        const captureFace = async () => {
            if (!faceVideoRef.value) return;
            const videoEl = faceVideoRef.value;

            faceStatusMessage.value = "Analyzing facial landmarks and extracting descriptor...";
            isFaceDetecting.value = true;

            try {
                const opt = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 });
                const detection = await faceapi.detectSingleFace(videoEl, opt)
                    .withFaceLandmarks()
                    .withFaceDescriptor();

                if (!detection || !detection.descriptor) {
                    Alerts.toast("warning", "No clear face detected. Please face the camera directly with good lighting.");
                    faceStatusMessage.value = "No clear face detected. Center yourself and try again.";
                    isFaceDetecting.value = false;
                    return;
                }

                const descArray = Array.from(detection.descriptor);
                if (descArray.length !== 128) {
                    Alerts.error("Biometric Error", "Could not generate 128-point biometric descriptor.");
                    isFaceDetecting.value = false;
                    return;
                }

                const canvas = document.createElement("canvas");
                canvas.width = videoEl.videoWidth || 640;
                canvas.height = videoEl.videoHeight || 480;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
                const snapshotDataUrl = canvas.toDataURL("image/jpeg", 0.88);

                faceDescriptor.value = descArray;
                faceSnapshot.value = snapshotDataUrl;
                faceStatusMessage.value = "Face biometric successfully captured!";

                stopCamera();
                await Alerts.success("Face Biometrics Captured", "Face biometric profile captured successfully!");
            } catch (err) {
                console.error("Capture face error:", err);
                Alerts.error("Capture Failed", "An error occurred while capturing face biometrics: " + (err.message || err));
            } finally {
                isFaceDetecting.value = false;
            }
        };

        const retakeFace = () => {
            faceSnapshot.value = "";
            faceDescriptor.value = null;
            startCamera();
        };

        const clearFace = () => {
            stopCamera();
            faceSnapshot.value = "";
            faceDescriptor.value = null;
        };

        Vue.onUnmounted(() => {
            stopCamera();
        });

        const credentials = Vue.ref(null);
        const created = Vue.ref(null);
        const emailNotice = Vue.ref(null);

        /** What is about to be written, shown before anything is saved. */
        const confirmSave = () => {
            const esc = Alerts.esc;
            const fullName = [form.firstName, form.middleName, form.lastName, form.suffix].filter(Boolean).join(" ");
            const officeName = id => options.value.offices.find(x => x.id === Number(id))?.name || "None";
            const rows = [];

            if (isEdit.value && assignmentChanges.value.length) {
                assignmentChanges.value.forEach(c => rows.push([c.field, esc(c.from) + " \u2192 <b class=\"text-ink\">" + esc(c.to) + "</b>"]));
            } else {
                rows.push(["Name", esc(fullName)]);
                const dispSaNum = form.saNumber || options.value?.nextSaNumber || "";
                if (dispSaNum) {
                    rows.push(["S.A. Number", '<span class="font-mono font-bold text-navy bg-navy/10 px-2 py-0.5 rounded text-[13px]">' + esc(dispSaNum) + '</span>']);
                }
                rows.push(["Student ID", esc(form.studentId)]);
                rows.push(["Course", esc(form.course) + " \u00b7 " + esc(label("yearLevel", form.yearLevel))]);
                rows.push(["Assignment", esc(label("saCategory", form.saCategory))
                    + (form.saCategory === "OFFICE" ? " \u00b7 " + esc(officeName(form.officeId)) : "")]);
                rows.push(["Emergency contact", esc(form.emergencyName) + " (" + esc(form.emergencyRelationship) + ") \u00b7 " + esc(form.emergencyNumber)]);
            }
            if (faceDescriptor.value) {
                rows.push(["Face biometric", '<span class="text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">✓ New 128-point face profile captured</span>']);
            } else if (existingBiometrics.value?.hasFace) {
                rows.push(["Face biometric", '<span class="text-slate-600 dark:text-slate-400">Already registered</span>']);
            }
            const html = '<dl class="mt-1 divide-y divide-line text-left text-body">'
                + rows.map(([k, v]) => '<div class="flex gap-3 py-1.5"><dt class="w-36 shrink-0 text-muted">'
                    + k + '</dt><dd class="text-ink">' + v + "</dd></div>").join("")
                + "</dl>"
                + (isEdit.value && assignmentChanges.value.length
                    ? '<p class="mt-3 text-caption text-muted">This changes who supervises the S.A. and whether they enter matching. It is recorded in the audit log.</p>'
                    : "")
                + (!isEdit.value
                    ? '<p class="mt-3 text-caption text-muted">A login account is created and a temporary password is shown once.</p>'
                    : "");

            return Alerts.confirm({
                title: isEdit.value ? "Save these changes?" : "Register this S.A.?",
                html,
                icon: isEdit.value && assignmentChanges.value.length ? "warning" : "question",
                confirmText: isEdit.value ? "Save changes" : "Register S.A.",
                cancelText: "Keep editing"
            });
        };

        const checkOfficeCapacity = async (selectedOfficeId) => {
            if (!selectedOfficeId || form.saCategory !== "OFFICE" || form.assignmentStatus !== "ASSIGNED") return true;
            const off = (options.value?.offices || []).find(o => Number(o.id) === Number(selectedOfficeId));
            if (!off) return true;

            if (!isOfficeAvailable(off)) {
                await Swal.fire({
                    icon: "warning",
                    title: "No Vacancy!",
                    html: `
                        <div class="text-left text-[13px] space-y-2 mt-1">
                            <p>The department/office <b>${off.name}</b> has <b>no vacant slots (No vacancy)</b> for this semester:</p>
                            <ul class="list-disc pl-5 space-y-1 text-slate-700">
                                <li>Requirement: <b>${off.requiredSa != null ? off.requiredSa : 0} S.A. slot(s)</b></li>
                                <li>Currently Assigned: <b>${off.assignedSa || 0} S.A.(s)</b></li>
                                <li>Vacant Slots: <b class="text-danger font-bold">0 vacant</b></li>
                            </ul>
                            <p class="text-xs text-muted mt-2">Over-staffing is prohibited under the Office Staffing policy. Please select another office with available slots or update the office requirements.</p>
                        </div>
                    `,
                    confirmButtonText: "Understand",
                    confirmButtonColor: "#0a143c"
                });
                form.officeId = "";
                return false;
            }
            return true;
        };

        const showErrors = async found => {
            Object.assign(errors, found);
            await Vue.nextTick();
            const first = document.querySelector('[aria-invalid="true"]');
            first?.scrollIntoView({ behavior: "smooth", block: "center" });
            first?.focus?.({ preventScroll: true });
            if (found.officeId && (String(found.officeId).toLowerCase().includes("no vacancy") || String(found.officeId).toLowerCase().includes("capacity full"))) {
                await Swal.fire({
                    icon: "warning",
                    title: "No Vacancy!",
                    html: `
                        <div class="text-left text-[13px] space-y-2 mt-1">
                            <p><b>Cannot Save:</b> ${Alerts.esc(found.officeId)}</p>
                            <p class="text-xs text-muted mt-2">Over-staffing is prohibited under the Office Staffing policy. Please select an office with available slots.</p>
                        </div>
                    `,
                    confirmButtonText: "Understand",
                    confirmButtonColor: "#0a143c"
                });
                return;
            }
            const n = Object.keys(found).length;
            Alerts.error("Check the form", n === 1 ? "1 field needs attention." : n + " fields need attention.");
        };

        const submit = async () => {
            Object.keys(errors).forEach(k => delete errors[k]);
            formError.value = "";

            const found = clientErrors();
            if (Object.keys(found).length) { await showErrors(found); return; }

            if (form.assignmentStatus === "ASSIGNED" && form.saCategory === "OFFICE" && form.officeId) {
                const ok = await checkOfficeCapacity(form.officeId);
                if (!ok) return;
            }

            if (!await confirmSave()) return;

            saving.value = true;
            // On new registration, default status to ACTIVE and assignment status to ASSIGNED/UNASSIGNED
            const targetAssignmentStatus = form.assignmentStatus || (isEdit.value ? form.assignmentStatus : "UNASSIGNED");
            const isAssigned = targetAssignmentStatus === "ASSIGNED";

            const payload = { 
                ...form, 
                saStatus: isEdit.value ? form.saStatus : "ACTIVE",
                assignmentStatus: targetAssignmentStatus,
                saCategory: isAssigned ? form.saCategory : (form.saCategory || "ACADS"),
                departmentType: isAssigned ? form.saCategory : (form.saCategory || "ACADS"),
                officeId: (isAssigned && form.saCategory === "OFFICE") ? (form.officeId || null) : null, 
                supervisorId: isAssigned ? (form.supervisorId || null) : null 
            };
            if (faceDescriptor.value && faceDescriptor.value.length === 128) {
                payload.faceDescriptor = JSON.stringify(faceDescriptor.value);
                payload.facePhoto = faceSnapshot.value;
            }
            const r = isEdit.value
                ? await Model.request("sa", "update", { ...payload, id: editId.value })
                : await Model.request("sa", "create", payload);

            if (!r.success) {
                saving.value = false;
                if (r.errors) await showErrors(r.errors);
                else {
                    formError.value = r.message;
                    Alerts.error(isEdit.value ? "Couldn't save the changes" : "Couldn't register this S.A.", r.message);
                }
                return;
            }

            saving.value = false;
            savedSnapshot.value = JSON.stringify(form);

            if (isEdit.value) {
                await Alerts.success("Changes Saved", "The Student Assistant profile has been updated successfully.");
                router.push("/admin/sa-management/" + editId.value);
            } else {
                created.value = r.sa;
                emailNotice.value = r.emailNotice || null;
                credentials.value = r.credentials;
                await Alerts.success("S.A. Registered Successfully", `${r.sa.name} has been successfully registered.`);
                if (r.emailNotice && !r.emailNotice.sent) {
                    Store.toast("warning", "Account created, but the login email could not be sent. Give the credentials manually.");
                }
            }
        };

        const registerAnother = async () => {
            credentials.value = null;
            created.value = null;
            emailNotice.value = null;
            await load();
            window.scrollTo({ top: 0 });
            document.querySelector("main")?.scrollTo({ top: 0 });
        };

        // ---------- Unsaved-changes guard ----------
        const leaveDialog = Vue.ref(null); // { resolve }
        VueRouter.onBeforeRouteLeave(() => {
            if (!dirty.value || credentials.value) return true;
            return new Promise(resolve => { leaveDialog.value = { resolve }; });
        });
        const answerLeave = ok => { leaveDialog.value?.resolve(ok); leaveDialog.value = null; };

        const cancelTarget = Vue.computed(() => isEdit.value ? "/admin/sa-management/" + editId.value : "/admin/sa-management");

        const activeSection = Vue.ref("student");
        const scrollToSection = (id) => {
            activeSection.value = id;
            const el = document.getElementById(id);
            if (el) {
                const yOffset = -70;
                const y = el.getBoundingClientRect().top + window.pageYOffset + yOffset;
                window.scrollTo({ top: y, behavior: 'smooth' });
            }
        };

        return { isEdit, options, loading, loadError, saving, form, errors, formError, errorCount, sections, load,
                 supervisorOptions, selectedSemester, submit, assignmentChanges, checkOfficeCapacity,
                 credentials, created, emailNotice, registerAnother, leaveDialog, answerLeave, cancelTarget, original, dirty,
                 Format, label, LABELS, studentLookup, registrarStudent, curriculumData, curriculumLoading,
                 showCurriculum, enrolledUnits, unitWarning, expectedGraduation, loadCurriculum, computedCurriculumSubjects, calculatedStudentAnalysis,
                 faceVideoRef, isCameraActive, isModelLoading, isFaceDetecting, faceDetected, faceDetectionScore, faceStatusMessage,
                 cameraError, faceSnapshot, faceDescriptor, existingBiometrics, startCamera, stopCamera, captureFace, retakeFace, clearFace,
                 activeSection, scrollToSection,
                 isCurrentAssignedOffice, getOfficeAvailableSlots, isOfficeAvailable };
    },

    template: `
    <page-header :title="isEdit ? 'Edit S.A.' : 'Register S.A.'" section="S.A. Management"
                 :subtitle="isEdit ? (original ? original.name + ' (' + original.studentId + ')' : '') : 'Fields marked * are required. The login account is created automatically.'" />

    <div v-if="loading" class="card space-y-4 p-6" aria-busy="true">
        <div v-for="n in 5" :key="n" class="h-11 animate-pulse rounded-lg bg-page"></div>
    </div>

    <div v-else-if="loadError" class="card flex flex-col items-center px-6 py-12 text-center">
        <app-icon name="CircleX" :size="28" class="text-danger" />
        <p class="mt-3 text-body font-medium text-ink">Couldn't open this form</p>
        <p class="mt-1 text-caption text-muted">{{ loadError }}</p>
        <button @click="load" class="btn btn-secondary btn-sm mt-4"><app-icon name="RefreshCw" :size="14" /> Try again</button>
    </div>

    <div v-else class="max-w-5xl mx-auto space-y-6 pb-16">
        <!-- Sticky Section Navigation Bar -->
        <nav class="sticky top-0 z-20 -mx-4 bg-page/95 px-4 py-2.5 backdrop-blur-md border-b border-line shadow-xs sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8" aria-label="Form sections">
            <div class="flex items-center justify-between gap-3 overflow-x-auto no-scrollbar">
                <ol class="flex items-center gap-1.5 shrink-0 py-0.5">
                    <li v-for="s in sections" :key="s.id">
                        <button type="button" @click="scrollToSection(s.id)"
                           class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-all cursor-pointer"
                           :class="activeSection === s.id ? 'bg-navy text-white shadow-xs font-bold' : 'text-slate-600 hover:bg-white hover:text-navy border border-transparent hover:border-line'">
                            <app-icon :name="s.icon" :size="14" />
                            <span>{{ s.label }}</span>
                        </button>
                    </li>
                </ol>
                <div class="hidden sm:flex items-center gap-2 shrink-0">
                    <router-link :to="cancelTarget" class="btn btn-secondary btn-sm">Cancel</router-link>
                    <button type="button" @click="submit" :disabled="saving" class="btn btn-primary btn-sm flex items-center gap-1.5 shadow-xs">
                        <app-icon v-if="saving" name="Loader" :size="14" class="animate-spin" />
                        <app-icon v-else :name="isEdit ? 'Check' : 'UserPlus'" :size="14" />
                        <span>{{ isEdit ? 'Save changes' : 'Register S.A.' }}</span>
                    </button>
                </div>
            </div>
        </nav>

        <form @submit.prevent="submit" novalidate class="space-y-6">

            <!-- 1. Student information -->
            <section id="student" class="card scroll-mt-4 p-5 sm:p-6">
                <div class="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <h2 class="flex items-center gap-2 text-section-title text-navy"><app-icon name="User" :size="19" /> Student information</h2>
                    <span class="inline-flex items-center gap-1.5 rounded-full border border-line bg-slate-100/90 px-3 py-1 text-[11px] font-semibold text-slate-600">
                        <app-icon name="Lock" :size="12" class="text-slate-500" /> Registrar record · View-only
                    </span>
                </div>
                <p class="mb-5 text-caption text-muted">
                    Official student records are fetched directly from the registrar database. These details cannot be modified manually.
                </p>
                <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <form-field label="Student ID" required :error="errors.studentId" :hint="isEdit ? 'Student ID cannot be changed.' : 'Becomes the S.A.\\'s username. Auto-fills from registrar records.'" v-slot="f" class="lg:col-span-2">
                        <div class="relative">
                            <input :id="f.id" v-model.trim="form.studentId" class="input" :class="{ 'input-error': f.invalid, 'bg-slate-50 border-line text-slate-700 cursor-not-allowed': isEdit }" :aria-invalid="f.invalid"
                                   :disabled="isEdit"
                                   placeholder="2026-00123" maxlength="12" inputmode="numeric" autocomplete="off">
                            <span v-if="isEdit" class="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted" title="Fixed ID">
                                <app-icon name="Lock" :size="14" />
                            </span>
                            <span v-else-if="studentLookup === 'loading'" class="absolute right-3 top-1/2 -translate-y-1/2">
                                <app-icon name="LoaderCircle" :size="16" class="animate-spin text-muted" />
                            </span>
                            <span v-else-if="studentLookup === 'found'" class="absolute right-3 top-1/2 -translate-y-1/2 text-green-600 text-[11px] font-semibold flex items-center gap-1">
                                <app-icon name="Check" :size="14" /> Found
                            </span>
                            <span v-else-if="studentLookup === 'not_found'" class="absolute right-3 top-1/2 -translate-y-1/2 text-amber-600 text-[11px] font-semibold">
                                Not in registrar
                            </span>
                        </div>
                    </form-field>
                    <form-field label="S.A. Number" hint="Unique, persistent S.A. identifier. Auto-generated and read-only." v-slot="f" class="lg:col-span-2">
                        <div class="relative">
                            <input :id="f.id" :value="form.saNumber || options?.nextSaNumber || 'Auto-generated upon save'"
                                   class="input bg-navy/5 border-navy/20 font-mono font-bold text-navy cursor-not-allowed select-none pr-9 tracking-wide" readonly tabindex="-1">
                            <span class="absolute right-3 top-1/2 -translate-y-1/2 text-navy pointer-events-none" title="Official S.A. Number">
                                <app-icon name="BadgeCheck" :size="16" />
                            </span>
                        </div>
                    </form-field>
                    <form-field label="First name" required :error="errors.firstName" v-slot="f">
                        <div class="relative">
                            <input :id="f.id" v-model="form.firstName" class="input bg-slate-50 border-line text-slate-700 cursor-not-allowed pr-8 font-medium" :class="{ 'input-error': f.invalid }" :aria-invalid="f.invalid" maxlength="60" autocomplete="off" readonly tabindex="-1" placeholder="Auto-fills from registrar">
                            <span class="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted" title="Pulled from registrar (View-only)">
                                <app-icon name="Lock" :size="13" />
                            </span>
                        </div>
                    </form-field>
                    <form-field label="Middle name" :error="errors.middleName" v-slot="f">
                        <div class="relative">
                            <input :id="f.id" v-model="form.middleName" class="input bg-slate-50 border-line text-slate-700 cursor-not-allowed pr-8 font-medium" :class="{ 'input-error': f.invalid }" :aria-invalid="f.invalid" maxlength="60" autocomplete="off" readonly tabindex="-1" placeholder="—">
                            <span class="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted" title="Pulled from registrar (View-only)">
                                <app-icon name="Lock" :size="13" />
                            </span>
                        </div>
                    </form-field>
                    <form-field label="Last name" required :error="errors.lastName" v-slot="f">
                        <div class="relative">
                            <input :id="f.id" v-model="form.lastName" class="input bg-slate-50 border-line text-slate-700 cursor-not-allowed pr-8 font-medium" :class="{ 'input-error': f.invalid }" :aria-invalid="f.invalid" maxlength="60" autocomplete="off" readonly tabindex="-1" placeholder="Auto-fills from registrar">
                            <span class="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted" title="Pulled from registrar (View-only)">
                                <app-icon name="Lock" :size="13" />
                            </span>
                        </div>
                    </form-field>
                    <form-field label="Suffix" :error="errors.suffix" v-slot="f">
                        <div class="relative">
                            <input :id="f.id" v-model="form.suffix" class="input bg-slate-50 border-line text-slate-700 cursor-not-allowed pr-8 font-medium" :class="{ 'input-error': f.invalid }" :aria-invalid="f.invalid" maxlength="10" placeholder="—" autocomplete="off" readonly tabindex="-1">
                            <span class="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted" title="Pulled from registrar (View-only)">
                                <app-icon name="Lock" :size="13" />
                            </span>
                        </div>
                    </form-field>
                    <form-field label="Date of birth" :error="errors.birthDate" v-slot="f">
                        <div class="relative">
                            <input :id="f.id" v-model="form.birthDate" type="date" class="input bg-slate-50 border-line text-slate-700 cursor-not-allowed pr-8 font-medium" :class="{ 'input-error': f.invalid }" :aria-invalid="f.invalid" readonly tabindex="-1">
                            <span class="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted" title="Pulled from registrar (View-only)">
                                <app-icon name="Lock" :size="13" />
                            </span>
                        </div>
                    </form-field>
                    <form-field label="Sex" :error="errors.sex" v-slot="f">
                        <div class="relative">
                            <select :id="f.id" v-model="form.sex" class="input bg-slate-50 border-line text-slate-700 cursor-not-allowed font-medium pr-8 appearance-none" :class="{ 'input-error': f.invalid }" :aria-invalid="f.invalid" disabled tabindex="-1">
                                <option value="">Not specified</option>
                                <option value="MALE">Male</option>
                                <option value="FEMALE">Female</option>
                            </select>
                            <span class="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted" title="Pulled from registrar (View-only)">
                                <app-icon name="Lock" :size="13" />
                            </span>
                        </div>
                    </form-field>
                    <form-field label="Contact number" required :error="errors.contactNumber" v-slot="f" class="lg:col-span-2">
                        <div class="relative">
                            <input :id="f.id" v-model="form.contactNumber" type="tel" class="input bg-slate-50 border-line text-slate-700 cursor-not-allowed pr-8 font-medium" :class="{ 'input-error': f.invalid }" :aria-invalid="f.invalid"
                                   placeholder="Auto-fills from registrar" maxlength="16" autocomplete="off" readonly tabindex="-1">
                            <span class="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted" title="Pulled from registrar (View-only)">
                                <app-icon name="Lock" :size="13" />
                            </span>
                        </div>
                    </form-field>
                    <form-field label="School email" required :error="errors.schoolEmail" hint="Official NCST school email (used to sign in)." v-slot="f" class="lg:col-span-2">
                        <div class="relative">
                            <input :id="f.id" v-model.trim="form.schoolEmail" type="email" class="input bg-slate-50 border-line text-slate-700 cursor-not-allowed pr-8 font-medium" :class="{ 'input-error': f.invalid }" :aria-invalid="f.invalid"
                                   placeholder="name@ncst.edu.ph" maxlength="150" autocomplete="off" readonly tabindex="-1">
                            <span class="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted" title="Pulled from registrar (View-only)">
                                <app-icon name="Lock" :size="13" />
                            </span>
                        </div>
                    </form-field>
                    <form-field label="Personal Gmail / Email" :error="errors.personalEmail" hint="Login credentials (student ID &amp; default password) will also be sent here." v-slot="f" class="lg:col-span-2">
                        <div class="relative">
                            <input :id="f.id" v-model.trim="form.personalEmail" type="email" class="input pr-8" :class="{ 'input-error': f.invalid }" :aria-invalid="f.invalid"
                                   placeholder="student@gmail.com" maxlength="150" autocomplete="off">
                            <span class="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted">
                                <app-icon name="Mail" :size="15" />
                            </span>
                        </div>
                    </form-field>
                </div>
            </section>

            <!-- 2. Academic information -->
            <section id="academic" class="card scroll-mt-4 p-5 sm:p-6">
                <div class="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                    <h2 class="flex items-center gap-2 text-section-title text-navy"><app-icon name="GraduationCap" :size="19" /> Academic information</h2>
                    <span class="inline-flex items-center gap-1.5 rounded-full border border-line bg-slate-100/90 px-3 py-1 text-[11px] font-semibold text-slate-600">
                        <app-icon name="Lock" :size="12" class="text-slate-500" /> Registrar record · View-only
                    </span>
                </div>
                <p class="mb-5 text-caption text-muted">Course, curriculum, and enrollment status are pulled from official registrar records (View-only).</p>
                <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <form-field label="Course / program" required :error="errors.course" v-slot="f">
                        <div class="relative">
                            <select :id="f.id" v-model="form.course" class="input bg-slate-50 border-line text-slate-700 cursor-not-allowed font-medium pr-8 appearance-none" :class="{ 'input-error': f.invalid }" :aria-invalid="f.invalid"
                                    disabled tabindex="-1">
                                <option value="" disabled>Course from registrar</option>
                                <option v-for="c in options.courses" :key="c.code" :value="c.code">{{ c.code }} — {{ c.name }}</option>
                                <option v-if="form.course && !options.courses?.some(c => c.code.toUpperCase() === form.course.toUpperCase())" :value="form.course">{{ form.course }}</option>
                            </select>
                            <span class="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-muted" title="Pulled from registrar (View-only)">
                                <app-icon name="Lock" :size="13" />
                            </span>
                        </div>
                    </form-field>
                    <div class="flex flex-col justify-end gap-1">
                        <span class="text-caption text-muted">Expected graduation</span>
                        <span class="text-body font-bold text-navy text-[16px]">{{ expectedGraduation || '—' }}</span>
                        <span class="text-[11px] text-muted">Auto-calculated from curriculum</span>
                    </div>
                    <div v-if="registrarStudent" class="flex flex-col justify-end gap-1 lg:col-span-1">
                        <span class="text-caption text-muted">Enrollment info (from registrar)</span>
                        <div class="flex flex-wrap gap-2 text-[12px]">
                            <span class="rounded-full border px-2.5 py-0.5 font-bold"
                                  :class="form.enrollmentStatus === 'ENROLLED' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-50 text-gray-600 border-gray-200'">
                                {{ form.enrollmentStatus === 'ENROLLED' ? 'Enrolled' : 'Not enrolled' }}
                            </span>
                            <span v-if="form.yearLevel" class="rounded-full border bg-blue-50 text-blue-700 border-blue-200 px-2.5 py-0.5 font-bold">
                                {{ LABELS.yearLevel[form.yearLevel] || (form.yearLevel + ' Year') }}
                            </span>
                            <span class="rounded-full border px-2.5 py-0.5 font-bold"
                                  :class="form.academicStatus === 'REGULAR' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-800 border-amber-300'">
                                {{ form.academicStatus === 'REGULAR' ? 'Regular' : 'Irregular' }}
                            </span>
                        </div>
                        <span v-if="registrarStudent.schoolYear" class="text-[11px] text-muted mt-0.5">
                            {{ registrarStudent.schoolYear }} · {{ registrarStudent.termName }}
                        </span>
                    </div>
                </div>

                <!-- Unit limit warning -->
                <div v-if="unitWarning" class="mt-4 flex items-start gap-2 rounded-lg border p-3"
                     :class="unitWarning.type === 'over' ? 'border-amber-300 bg-amber-50' : 'border-green-200 bg-green-50'">
                    <app-icon :name="unitWarning.type === 'over' ? 'TriangleAlert' : 'CircleCheck'" :size="16"
                              :class="unitWarning.type === 'over' ? 'text-amber-600 mt-0.5' : 'text-green-600 mt-0.5'" />
                    <div>
                        <p class="text-[13px] font-semibold" :class="unitWarning.type === 'over' ? 'text-amber-800' : 'text-green-800'">{{ unitWarning.text }}</p>
                        <p v-if="unitWarning.type === 'over'" class="text-[11px] text-amber-700 mt-0.5">
                            S.A.s may only take up to 18 units per semester. This registration requires admin approval.
                        </p>
                    </div>
                </div>

                <!-- Curriculum viewer button -->
                <div class="mt-4">
                    <button type="button" @click="showCurriculum = true; loadCurriculum(form.course, registrarStudent?.curriculumId, registrarStudent?.id || registrarStudent?.studentNumber || form.studentId || original?.studentId)"
                            class="btn btn-secondary btn-sm">
                        <app-icon name="BookOpen" :size="15" /> View student curriculum
                    </button>
                </div>

                <!-- Not enrolled notice -->
                <div v-if="registrarStudent && form.enrollmentStatus !== 'ENROLLED'" class="mt-4 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
                    <app-icon name="TriangleAlert" :size="16" class="text-amber-600 mt-0.5" />
                    <div>
                        <p class="text-[13px] font-semibold text-amber-800">Student is not yet enrolled this semester.</p>
                        <p class="text-[11px] text-amber-700 mt-0.5">Class schedule will be pulled automatically from the registrar once the student enrolls.</p>
                    </div>
                </div>
            </section>

            <!-- Face Recognition Biometric ID -->
            <section id="face" class="card scroll-mt-4 p-5 sm:p-6">
                <div class="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <h2 class="flex items-center gap-2 text-section-title text-navy dark:text-cyan-400">
                            <app-icon name="ScanFace" :size="20" class="text-cyan-500" /> Face recognition (Biometric ID)
                        </h2>
                        <p class="mt-0.5 text-caption text-muted">
                            Facial biometric enrollment for automated attendance kiosks and instant identity verification.
                        </p>
                    </div>
                    <div class="flex items-center gap-2">
                        <span v-if="faceDescriptor || (existingBiometrics && !faceSnapshot)" 
                              class="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
                            <span class="h-2 w-2 rounded-full bg-emerald-500"></span>
                            {{ faceDescriptor ? 'New Biometrics Captured' : 'Biometrics Registered' }}
                        </span>
                        <span v-else-if="isCameraActive" 
                              class="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-[11px] font-bold text-cyan-600 dark:text-cyan-400">
                            <span class="h-2 w-2 rounded-full bg-cyan-500 animate-pulse"></span>
                            Camera Active
                        </span>
                        <span v-else 
                              class="inline-flex items-center gap-1.5 rounded-full border border-line bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                            <app-icon name="Camera" :size="12" class="text-slate-400" />
                            Camera Offline
                        </span>
                    </div>
                </div>

                <!-- Camera Error Alert -->
                <div v-if="cameraError" class="mb-4 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-caption text-danger">
                    <app-icon name="CircleAlert" :size="16" class="mt-0.5 shrink-0" />
                    <div>
                        <p class="font-semibold">Camera or Model Notice</p>
                        <p>{{ cameraError }}</p>
                    </div>
                </div>

                <!-- Viewfinder and Biometric Card -->
                <div class="overflow-hidden rounded-xl border border-slate-800 bg-slate-950 text-white shadow-xl">

                    <!-- STATE 1: CAMERA STREAMING (ACTIVE SCANNER) -->
                    <div v-if="isCameraActive" class="relative flex flex-col items-center justify-center min-h-[380px] sm:min-h-[440px] bg-slate-950 p-4">
                        <!-- Video Viewport -->
                        <div class="relative w-full max-w-[500px] aspect-[4/3] rounded-xl overflow-hidden bg-black border border-slate-800 flex items-center justify-center shadow-2xl">
                            <video ref="faceVideoRef" autoplay playsinline muted class="w-full h-full object-cover -scale-x-100"></video>

                            <!-- 4 High-Tech Cyan Corner Reticle Brackets (Image 2 style) -->
                            <div class="pointer-events-none absolute inset-3 z-10">
                                <div class="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)]"></div>
                                <div class="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)]"></div>
                                <div class="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)]"></div>
                                <div class="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)]"></div>
                            </div>

                            <!-- Animated Cyan Scanline -->
                            <div class="pointer-events-none absolute left-3 right-3 h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_14px_rgba(6,182,212,0.9)] animate-scan-line z-10"></div>

                            <!-- Center Oval Reticle Guide -->
                            <div class="pointer-events-none absolute inset-0 m-auto w-44 sm:w-52 h-60 sm:h-72 rounded-full border-2 transition-all duration-300 z-10 flex items-center justify-center"
                                 :class="faceDetected 
                                     ? 'border-emerald-400 shadow-[0_0_30px_rgba(52,211,153,0.5)] bg-emerald-500/5' 
                                     : 'border-dashed border-cyan-400/70 shadow-[0_0_20px_rgba(6,182,212,0.25)] bg-cyan-500/5'">
                                <div class="w-2.5 h-2.5 rounded-full" :class="faceDetected ? 'bg-emerald-400 animate-ping' : 'bg-cyan-400/40'"></div>
                            </div>

                            <!-- Live HUD Feedback Pill -->
                            <div class="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-950/85 backdrop-blur-md border text-[11px] sm:text-[12px] font-mono z-20 shadow-lg transition-colors duration-200"
                                 :class="faceDetected ? 'border-emerald-500/50 text-emerald-300' : 'border-cyan-500/40 text-cyan-200'">
                                <span class="w-2 h-2 rounded-full" :class="faceDetected ? 'bg-emerald-400 animate-pulse' : 'bg-cyan-400 animate-ping'"></span>
                                <span>{{ faceStatusMessage }}</span>
                            </div>
                        </div>

                        <!-- Camera Action Buttons -->
                        <div class="mt-4 flex flex-wrap items-center justify-center gap-3 w-full">
                            <button type="button" @click="captureFace" 
                                    class="btn bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold px-6 py-2.5 rounded-lg shadow-lg shadow-cyan-500/25 transition-all flex items-center gap-2">
                                <app-icon name="Camera" :size="18" />
                                <span>Capture Face Biometric</span>
                            </button>
                            <button type="button" @click="stopCamera" 
                                    class="btn border border-slate-700 bg-slate-900/80 hover:bg-slate-800 text-slate-300 px-4 py-2.5 rounded-lg transition-all flex items-center gap-2">
                                <app-icon name="VideoOff" :size="16" />
                                <span>Close Camera</span>
                            </button>
                        </div>
                    </div>

                    <!-- STATE 2: CAPTURED SNAPSHOT OR EXISTING REGISTERED BIOMETRIC -->
                    <div v-else-if="faceSnapshot || (existingBiometrics && existingBiometrics.hasFace)" 
                         class="flex flex-col sm:flex-row items-center gap-6 p-6 sm:p-8 bg-slate-900/90">
                        <!-- Snapshot Frame -->
                        <div class="relative shrink-0">
                            <div class="w-36 h-48 sm:w-44 sm:h-56 rounded-xl overflow-hidden border-2 border-cyan-400/80 shadow-[0_0_20px_rgba(6,182,212,0.3)] bg-black">
                                <img :src="faceSnapshot || existingBiometrics.photoUrl || 'img/default-avatar.svg'" 
                                     alt="Registered Face" class="w-full h-full object-cover" />
                            </div>
                            <div class="absolute -bottom-2 -right-2 bg-emerald-500 text-slate-950 rounded-full p-1.5 shadow-md border-2 border-slate-900" title="Biometric ID Enrolled">
                                <app-icon name="Check" :size="16" stroke-width="3" />
                            </div>
                        </div>

                        <!-- Biometric Metadata Details -->
                        <div class="flex-1 text-center sm:text-left space-y-3">
                            <div>
                                <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-mono text-[11px] font-semibold">
                                    <app-icon name="ShieldCheck" :size="13" /> 128-POINT BIOMETRIC VECTOR
                                </span>
                                <h3 class="text-[17px] font-bold text-white mt-1.5">
                                    {{ faceSnapshot ? 'Facial Biometric Enrolled' : 'Registered Facial Biometric' }}
                                </h3>
                                <p class="text-[13px] text-slate-300 mt-0.5">
                                    <span v-if="faceSnapshot" class="text-emerald-400 font-medium">Ready to save with this S.A. registration.</span>
                                    <span v-else-if="existingBiometrics && existingBiometrics.capturedAt" class="text-slate-400">Captured on {{ Format.dateTime(existingBiometrics.capturedAt) }}.</span>
                                    <span v-else class="text-slate-400">Active biometric profile linked to this Student Assistant.</span>
                                </p>
                            </div>

                            <div class="p-3 rounded-lg bg-slate-950/70 border border-slate-800 text-[12px] text-slate-300 font-mono space-y-1">
                                <div class="flex items-center justify-between">
                                    <span class="text-slate-400">Biometric status:</span>
                                    <span class="text-emerald-400 font-bold">READY FOR KIOSK ATTENDANCE</span>
                                </div>
                                <div class="flex items-center justify-between">
                                    <span class="text-slate-400">Feature points:</span>
                                    <span class="text-cyan-300 font-bold">68 facial landmarks · 128D descriptor</span>
                                </div>
                            </div>

                            <div class="flex flex-wrap items-center justify-center sm:justify-start gap-3 pt-1">
                                <button type="button" @click="retakeFace" 
                                        class="btn bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 px-4 py-2 rounded-lg text-[13px] font-semibold flex items-center gap-2">
                                    <app-icon name="RefreshCw" :size="14" />
                                    <span>Retake Face Biometric</span>
                                </button>
                                <button v-if="faceSnapshot" type="button" @click="clearFace" 
                                        class="btn border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-300 px-3 py-2 rounded-lg text-[13px]">
                                    <span>Cancel Capture</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- STATE 3: CAMERA CLOSED (DEFAULT INITIAL STATE) -->
                    <div v-else class="flex flex-col items-center justify-center p-8 sm:p-12 text-center bg-slate-900/60">
                        <div class="relative w-20 h-20 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.15)] mb-4">
                            <app-icon name="ScanFace" :size="38" />
                            <div class="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-slate-600 border-2 border-slate-900"></div>
                        </div>
                        
                        <h3 class="text-[17px] font-bold text-white">Camera is currently closed</h3>
                        <p class="mt-1 max-w-md text-[13px] text-slate-300">
                            To register facial biometrics for this Student Assistant, click the button below to turn on the camera and position their face within the alignment guide.
                        </p>

                        <div class="mt-6 flex flex-wrap items-center justify-center gap-3">
                            <button type="button" @click="startCamera" :disabled="isModelLoading"
                                    class="btn bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold px-5 py-2.5 rounded-lg shadow-lg shadow-cyan-500/20 transition-all flex items-center gap-2">
                                <app-icon v-if="isModelLoading" name="Loader" :size="16" class="animate-spin" />
                                <app-icon v-else name="Camera" :size="18" />
                                <span>{{ isModelLoading ? 'Loading AI Model...' : 'Open Camera & Capture Face' }}</span>
                            </button>
                        </div>
                    </div>

                </div>
            </section>

            <!-- 3. Assignment and supervisor -->
            <section id="assignment" class="card scroll-mt-4 p-5 sm:p-6">
                <h2 class="mb-1 flex items-center gap-2 text-section-title text-navy"><app-icon name="Building2" :size="19" /> Assignment and supervisor</h2>
                <p class="mb-5 text-caption text-muted">Select assignment status. When set to Assigned, choose the S.A. category and supervisor.</p>
                <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <!-- Assignment status -->
                    <form-field label="Assignment status" required :error="errors.assignmentStatus" v-slot="f">
                        <select :id="f.id" v-model="form.assignmentStatus" class="input" :class="{ 'input-error': f.invalid }" :aria-invalid="f.invalid">
                            <option value="UNASSIGNED">Unassigned (joins matching pool)</option>
                            <option value="ASSIGNED">Assigned</option>
                        </select>
                    </form-field>

                    <!-- S.A. category and Supervisor: Visible ONLY when Assigned -->
                    <template v-if="form.assignmentStatus === 'ASSIGNED'">
                        <form-field label="S.A. category" required :error="errors.saCategory" v-slot="f">
                            <select :id="f.id" v-model="form.saCategory" class="input" :class="{ 'input-error': f.invalid }" :aria-invalid="f.invalid">
                                <option value="" disabled>Choose a category</option>
                                <option value="ACADS">ACADS</option>
                                <option value="ITO">ITO</option>
                                <option value="OFFICE">Office</option>
                            </select>
                        </form-field>

                        <form-field v-if="form.saCategory === 'OFFICE'" label="Assigned Department / Unit" required :error="errors.officeId" v-slot="f">
                            <select :id="f.id" v-model.number="form.officeId" @change="checkOfficeCapacity(form.officeId)" class="input" :class="{ 'input-error': f.invalid }" :aria-invalid="f.invalid">
                                <option value="" disabled>Choose a department/unit</option>
                                <option v-for="o in options.offices" :key="o.id" :value="o.id"
                                        :disabled="!isOfficeAvailable(o)">
                                    {{ o.name }} ({{ o.assignedSa }}/{{ o.requiredSa != null ? o.requiredSa : '—' }} slots · {{ isOfficeAvailable(o) ? (getOfficeAvailableSlots(o) + ' vacant') : 'NO VACANCY' }})
                                </option>
                            </select>
                        </form-field>

                        <form-field label="Supervisor (Optional)" :error="errors.supervisorId"
                                    :hint="!form.saCategory ? 'Choose category first.' : (form.saCategory === 'OFFICE' && !form.officeId ? 'Choose department first.' : (!supervisorOptions.length ? 'No supervisor account found.' : 'Optional — can be assigned later during duty scheduling.'))" v-slot="f">
                            <select :id="f.id" v-model.number="form.supervisorId" class="input" :class="{ 'input-error': f.invalid }" :aria-invalid="f.invalid"
                                    :disabled="!supervisorOptions.length">
                                <option value="">None yet (Optional)</option>
                                <option v-for="s in supervisorOptions" :key="s.id" :value="s.id">{{ s.name }}</option>
                            </select>
                        </form-field>
                    </template>

                    <div v-else class="col-span-full rounded-xl border border-blue-200/70 bg-blue-50/60 p-3.5 text-xs text-navy flex items-start gap-2.5">
                        <app-icon name="Info" :size="17" class="text-blue-600 shrink-0 mt-0.5" />
                        <div>
                            <p class="font-semibold text-navy">Unassigned Status</p>
                            <p class="text-muted mt-0.5">This Student Assistant joins the matching pool. Category and Supervisor can be selected if you set <strong>Assignment status</strong> to <strong>Assigned</strong>.</p>
                        </div>
                    </div>
                </div>
            </section>

            <!-- 4. Allowance & Tuition Benefits -->
            <section id="benefits" class="card scroll-mt-4 p-5 sm:p-6">
                <h2 class="mb-1 flex items-center gap-2 text-section-title text-navy"><app-icon name="Wallet" :size="19" /> Allowance & Tuition Benefits</h2>
                <p class="mb-5 text-caption text-muted">Set the hourly allowance rate and review official tuition benefits synced from Registrar.</p>

                <!-- Official Tuition Assessment from Registrar -->
                <div v-if="registrarStudent?.feeAssessment" class="mb-5 rounded-xl border border-line bg-mist/50 p-4">
                    <div class="mb-2 flex items-center justify-between">
                        <span class="text-caption font-bold uppercase tracking-wider text-navy">Official Tuition & Fee Assessment (Registrar COR)</span>
                        <span class="rounded bg-navy/10 px-2 py-0.5 text-[11px] font-semibold text-navy">Cash Basis Assessment</span>
                    </div>
                    <div class="grid grid-cols-2 gap-2 text-[12px] sm:grid-cols-3">
                        <div><span class="text-muted">Tuition Fee:</span> <span class="font-semibold text-ink">{{ Format.peso(registrarStudent.feeAssessment.tuitionFee) }}</span></div>
                        <div><span class="text-muted">Laboratory:</span> <span class="font-semibold text-ink">{{ Format.peso(registrarStudent.feeAssessment.labFee) }}</span></div>
                        <div><span class="text-muted">Miscellaneous:</span> <span class="font-semibold text-ink">{{ Format.peso(registrarStudent.feeAssessment.miscFee) }}</span></div>
                        <div><span class="text-muted">LMS Fee:</span> <span class="font-semibold text-ink">{{ Format.peso(registrarStudent.feeAssessment.lmsFee) }}</span></div>
                        <div><span class="text-muted">OMR Fee:</span> <span class="font-semibold text-ink">{{ Format.peso(registrarStudent.feeAssessment.omrFee) }}</span></div>
                        <div><span class="text-muted font-bold">Total Assessment:</span> <span class="font-bold text-navy">{{ Format.peso(registrarStudent.feeAssessment.cashTotal) }}</span></div>
                    </div>
                    <div class="mt-3 border-t border-line/60 pt-2.5 flex flex-wrap items-center justify-between gap-2 text-[12px]">
                        <div>
                            <span class="font-semibold text-emerald-700">S.A. Grant Coverage:</span>
                            <span class="text-muted ml-1">100% Tuition ({{ Format.peso(registrarStudent.feeAssessment.tuitionFee) }}) + 70% Misc ({{ Format.peso(registrarStudent.feeAssessment.miscFee * 0.70) }})</span>
                        </div>
                        <div class="font-bold text-navy">
                            Est. Net Balance: {{ Format.peso(Math.max(0, registrarStudent.feeAssessment.cashTotal - (registrarStudent.feeAssessment.tuitionFee + (registrarStudent.feeAssessment.miscFee * 0.70)))) }}
                        </div>
                    </div>
                </div>

                <div class="grid gap-4 sm:grid-cols-2">
                    <form-field label="Allowance rate (₱ per hour)" required :error="errors.hourlyRate" hint="Minimum ₱8.00 per hour. Can be customized per S.A." v-slot="f">
                        <input :id="f.id" v-model.number="form.hourlyRate" type="number" min="8" max="1000" step="1"
                               class="input" :class="{ 'input-error': f.invalid }" :aria-invalid="f.invalid" placeholder="8">
                    </form-field>
                </div>
            </section>

            <!-- 5. Emergency contact (Required) -->
            <section id="emergency" class="card scroll-mt-4 p-5 sm:p-6">
                <h2 class="mb-1 flex items-center gap-2 text-section-title text-navy"><app-icon name="Phone" :size="19" /> Emergency contact</h2>
                <p class="mb-5 text-caption text-muted"><span class="font-semibold text-danger">* Required</span>. Contact person in case of medical or campus emergency.</p>
                <div class="grid gap-4 sm:grid-cols-3">
                    <form-field label="Contact name" :required="true" :error="errors.emergencyName" v-slot="f">
                        <input :id="f.id" v-model="form.emergencyName" class="input" :class="{ 'input-error': f.invalid }" :aria-invalid="f.invalid" maxlength="120" autocomplete="off" placeholder="Full name">
                    </form-field>
                    <form-field label="Contact number" :required="true" :error="errors.emergencyNumber" v-slot="f">
                        <input :id="f.id" v-model="form.emergencyNumber" type="tel" class="input" :class="{ 'input-error': f.invalid }" :aria-invalid="f.invalid" placeholder="09171234567" maxlength="16" autocomplete="off">
                    </form-field>
                    <form-field label="Relationship" :required="true" :error="errors.emergencyRelationship" v-slot="f">
                        <input :id="f.id" v-model="form.emergencyRelationship" class="input" :class="{ 'input-error': f.invalid }" :aria-invalid="f.invalid" maxlength="40" placeholder="e.g. Mother, Father, Guardian" autocomplete="off">
                    </form-field>
                </div>
            </section>

            <!-- 6. Account (register only) -->
            <section v-if="!isEdit" class="flex items-start gap-3 rounded-xl border border-info/20 bg-info/5 p-5">
                <app-icon name="KeyRound" :size="20" class="mt-0.5 text-info" />
                <div class="text-body text-ink">
                    <p class="font-semibold">A login account is created automatically</p>
                    <p class="mt-1 text-muted">Username: the student ID. A temporary password is generated and shown once after saving. The account stays <b class="font-semibold text-ink">Pending activation</b> until the S.A. signs in and sets their own password.</p>
                </div>
            </section>

            <!-- Actions -->
            <div class="sticky bottom-0 z-30 -mx-4 flex flex-col gap-3 rounded-t-2xl border-t border-line bg-page/95 px-5 py-4 shadow-lg backdrop-blur-md sm:-mx-6 sm:flex-row sm:items-center sm:px-6 lg:-mx-8 lg:px-8">
                <div class="flex flex-wrap items-center gap-2">
                    <span v-if="dirty" class="inline-flex items-center gap-1.5 rounded-full bg-amber-100 border border-amber-300 px-3 py-1 text-xs font-semibold text-amber-900 shadow-xs">
                        <span class="h-2 w-2 rounded-full bg-amber-500 animate-pulse"></span> You have unsaved changes
                    </span>
                    <p v-if="errorCount" class="flex items-center gap-2 text-body font-semibold text-danger" role="alert">
                        <app-icon name="CircleX" :size="16" /> {{ errorCount === 1 ? "1 field needs attention." : errorCount + " fields need attention." }}
                    </p>
                    <p v-else-if="formError" class="flex items-center gap-2 text-body font-semibold text-danger" role="alert">
                        <app-icon name="CircleX" :size="16" /> {{ formError }}
                    </p>
                </div>
                <div class="flex gap-2.5 sm:ml-auto">
                    <router-link :to="cancelTarget" class="btn btn-secondary flex-1 sm:flex-none">Cancel</router-link>
                    <button type="submit" :disabled="saving" class="btn btn-primary flex-1 sm:flex-none flex items-center justify-center gap-2 shadow-md">
                        <app-icon :name="saving ? 'LoaderCircle' : (isEdit ? 'Save' : 'UserPlus')" :size="16" :class="saving ? 'animate-spin' : ''" />
                        <span>{{ saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Register S.A.') }}</span>
                    </button>
                </div>
            </div>
        </form>
    </div>

    <!-- Student Curriculum Modal -->
    <app-modal :open="showCurriculum" title="Student Curriculum" icon="BookOpen" size="xl" @close="showCurriculum = false">
        <div v-if="curriculumLoading" class="flex items-center justify-center gap-2 text-caption text-muted py-8">
            <app-icon name="LoaderCircle" :size="18" class="animate-spin" /> Loading student curriculum...
        </div>
        <div v-else-if="!computedCurriculumSubjects || !computedCurriculumSubjects.length" class="py-8 text-center text-caption text-muted">
            <p>No curriculum found for this student.</p>
        </div>
        <template v-else>
            <div class="mb-4 flex items-center justify-between p-3 bg-mist rounded-lg border border-line">
                <div>
                    <p class="text-sm font-bold text-navy">
                        {{ curriculumData?.curriculum?.course_code }} — {{ curriculumData?.curriculum?.curriculum_code }}
                    </p>
                    <p class="text-xs text-muted">Effective: {{ curriculumData?.curriculum?.effective_sy || 'AY 2024-2025' }}</p>
                </div>
                <span class="px-3 py-1 bg-white font-semibold text-navy rounded-full text-xs border border-line">
                    {{ curriculumData?.curriculum?.total_units }} Total Units
                </span>
            </div>
            <div class="overflow-x-auto touch-scroll table-scroll max-h-[60vh]">
                <table class="w-full text-left border-collapse min-w-[700px]">
                    <thead>
                        <tr class="border-b border-line text-[10px] font-bold text-muted uppercase bg-gray-50 sticky top-0">
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
                        <tr v-for="sub in computedCurriculumSubjects" :key="sub.subject_id" class="border-b border-line/50 hover:bg-mist transition-colors">
                            <td class="px-3 py-2 text-muted whitespace-nowrap">{{ sub.year }} Year</td>
                            <td class="px-3 py-2 text-muted whitespace-nowrap">{{ sub.sem == 1 ? '1st' : '2nd' }} Sem</td>
                            <td class="px-3 py-2 font-bold text-navy whitespace-nowrap">{{ sub.subject_code }}</td>
                            <td class="px-3 py-2 text-ink">{{ sub.description }}</td>
                            <td class="px-3 py-2 text-center font-semibold whitespace-nowrap">{{ sub.units }}</td>
                            <td class="px-3 py-1 text-center whitespace-nowrap">
                                <span class="inline-block text-[10px] px-2 py-0.5 rounded-full border font-bold" :class="sub.statusClass">
                                    {{ sub.status }}
                                </span>
                            </td>
                            <td class="px-3 py-2 text-muted text-[11px] whitespace-nowrap">{{ sub.prereq || '—' }}</td>
                            <td class="px-3 py-2 text-center text-[11px] whitespace-nowrap" :class="sub.prereqStatusClass">
                                {{ sub.prereqStatus }}
                            </td>
                            <td class="px-3 py-2 text-center whitespace-nowrap">
                                <span class="inline-block px-2.5 py-0.5 rounded-full text-[10px]" :class="sub.canEnrollClass">
                                    {{ sub.canEnroll }}
                                </span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </template>
        <template #footer>
            <button type="button" @click="showCurriculum = false" class="btn btn-secondary btn-sm">Close</button>
        </template>
    </app-modal>

    <!-- Registered: show credentials once -->
    <app-modal :open="!!credentials" persistent title="S.A. registered" icon="CircleCheck" tone="success"
               :description="created ? created.name + ' can now sign in with these details.' : ''">
        <credentials-panel v-if="credentials" :credentials="credentials" :name="created && created.firstName" />
        <div v-if="emailNotice && emailNotice.sent" class="mt-3 flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-caption text-success">
            <app-icon name="MailCheck" :size="16" class="mt-0.5 shrink-0" />
            <span>Login details (student number &amp; default password) were emailed to <strong>{{ emailNotice.recipients.join(', ') }}</strong>.</span>
        </div>
        <div v-else-if="emailNotice" class="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-caption text-warning">
            <app-icon name="MailWarning" :size="16" class="mt-0.5 shrink-0" />
            <span>The login email was not sent ({{ emailNotice.error }}). Please give these credentials to the S.A. manually.</span>
        </div>
        <template #footer>
            <button @click="registerAnother" class="btn btn-secondary"><app-icon name="UserPlus" :size="16" /> Register another</button>
            <router-link v-if="created" :to="'/admin/sa-management/' + created.id" class="btn btn-primary">View S.A. record</router-link>
        </template>
    </app-modal>

    <!-- Unsaved changes -->
    <app-modal :open="!!leaveDialog" title="Leave without saving?" icon="TriangleAlert" tone="warning" @close="answerLeave(false)"
               description="Your changes to this form will be lost.">
        <template #footer>
            <button @click="answerLeave(false)" class="btn btn-secondary" autofocus>Stay on this page</button>
            <button @click="answerLeave(true)" class="btn btn-danger">Discard changes</button>
        </template>
    </app-modal>
    `
};

