// Student Assistant > My Requests (#/sa/requests)
// Full-page form layouts matching the NCST AssistPay Excuse Slip, Overtime Authorization Form, and Undertime Form designs.
const SaRequestsPage = {
    components: { AppIcon, PageHeader, AppModal, StatusBadge },

    setup() {
        const loading = Vue.ref(true);
        const loadError = Vue.ref("");
        const requests = Vue.ref([]);
        const summary = Vue.ref({
            total: 0,
            draft: 0,
            pendingSupervisorReview: 0,
            returnedToSa: 0,
            pendingCoordinatorRecording: 0,
            recorded: 0,
            rejected: 0
        });
        const saContext = Vue.ref({
            saProfileId: null,
            saNumber: "",
            studentId: "",
            fullName: "",
            course: "",
            yearLevel: "",
            department: "",
            location: "",
            assignedSupervisorId: null,
            supervisorName: "",
            coordinatorName: "Ansherina A Sudario",
            semesterId: null,
            semesterLabel: "",
            scheduleSlots: []
        });

        const saCanvasRef = Vue.ref(null);

        // View state: 'list' (My Requests dashboard) or 'form' (Full-page form matching reference designs)
        const activeView = Vue.ref("list");
        const showTypePickerModal = Vue.ref(false);
        const showDetailModal = Vue.ref(false);

        const searchQuery = Vue.ref("");
        const filterType = Vue.ref("");
        const filterStatus = Vue.ref("");

        const detailLoading = Vue.ref(false);
        const selectedRequest = Vue.ref(null);
        const selectedHistory = Vue.ref([]);

        const submitting = Vue.ref(false);
        const formError = Vue.ref("");
        const fileInputRef = Vue.ref(null);

        const serverDate = Vue.ref(new Date().toISOString().slice(0, 10));
        const serverTime = Vue.ref("");
        const cutoffs = Vue.ref([]);
        const excuseSlipGraceDays = Vue.ref(2);
        const overtimeGraceDays = Vue.ref(2);

        const todayIso = () => serverDate.value || new Date().toISOString().slice(0, 10);

        const getScheduleSlotForDate = dateStr => {
            if (!dateStr || !Array.isArray(saContext.value?.scheduleSlots)) return null;
            const dt = new Date(dateStr + "T00:00:00");
            if (isNaN(dt.getTime())) return null;
            const shortDays = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
            const dayCode = shortDays[dt.getDay()];
            return saContext.value.scheduleSlots.find(s =>
                String(s.dayOfWeek || "").toUpperCase() === dayCode
            ) || null;
        };

        const addHoursToTime = (timeStr, hours) => {
            if (!timeStr) return "19:00";
            const parts = timeStr.split(":").map(Number);
            const newH = Math.min(23, (parts[0] || 0) + hours);
            return `${String(newH).padStart(2, "0")}:${String(parts[1] || 0).padStart(2, "0")}`;
        };

        const createDefaultOtRow = (dateStr = "") => {
            const d = dateStr || todayIso();
            const slot = getScheduleSlotForDate(d);
            const regS = slot ? (slot.startTime || "").slice(0, 5) : "08:00";
            const regE = slot ? (slot.endTime || "").slice(0, 5) : "17:00";
            return {
                date: d,
                task: "",
                regularStart: regS,
                regularEnd: regE,
                otStart: regE,
                otEnd: addHoursToTime(regE, 2),
                hasSchedule: Boolean(slot)
            };
        };

        const onOtRowDateChange = row => {
            if (!row.date) return;
            const slot = getScheduleSlotForDate(row.date);
            if (slot) {
                row.regularStart = (slot.startTime || "").slice(0, 5);
                row.regularEnd = (slot.endTime || "").slice(0, 5);
                row.hasSchedule = true;
                if (!row.otStart || row.otStart < row.regularEnd) {
                    row.otStart = row.regularEnd;
                    row.otEnd = addHoursToTime(row.regularEnd, 2);
                }
            } else {
                row.hasSchedule = false;
                row.regularStart = "";
                row.regularEnd = "";
            }
        };

        const eligibleOtCutoffs = Vue.computed(() => {
            if (!cutoffs.value || !cutoffs.value.length) return [];
            const today = serverDate.value || todayIso();
            const nowTime = serverTime.value || `${today} 00:00:00`;
            const nowMs = new Date(nowTime.replace(" ", "T")).getTime();
            const gDays = typeof overtimeGraceDays.value === "number" ? overtimeGraceDays.value : 2;

            return cutoffs.value.filter(c => {
                const deadlineDt = new Date(`${c.end_date}T23:59:59`);
                deadlineDt.setDate(deadlineDt.getDate() + gDays);
                return nowMs <= deadlineDt.getTime() && c.start_date <= today;
            });
        });

        const earliestOtDate = Vue.computed(() => {
            const list = eligibleOtCutoffs.value;
            if (!list.length) return todayIso();
            const dates = list.map(c => c.start_date).sort();
            return dates[0];
        });

        const isMeaninglessPlaceholder = text => {
            if (!text) return true;
            const clean = String(text).trim();
            if (clean.length < 4) return true;
            const lower = clean.toLowerCase();
            const bad = [
                "ot work", "ot", "overtime", "none", "n/a", "na", "asdf", "test",
                "testing", "work", "sample", "xxx", "duty", "duty work", "none.",
                "n / a", "not applicable", "no reason", "n.a.", "n.a", "whatever",
                "something", "nothing", "regular duty", "extra work", "etc", "etc."
            ];
            if (bad.includes(lower)) return true;
            if (/^(.)\1{3,}$/.test(lower)) return true;
            return false;
        };

        const todayFutureWarningDismissed = Vue.ref(false);

        const hasTodayFutureHoursWarning = Vue.computed(() => {
            if (form.value.requestType !== "OVERTIME") return false;
            const today = serverDate.value || todayIso();
            if (!serverTime.value) return false;
            const curTime = serverTime.value.slice(11, 16);
            const rows = Array.isArray(form.value.overtimeRows) ? form.value.overtimeRows : [];
            return rows.some(r => r.date === today && r.otEnd && r.otEnd > curTime);
        });

        const getOtRowError = (row, idx, isValidation = false) => {
            if (!row.date) return "Date is required.";
            const today = serverDate.value || todayIso();
            if (row.date > today) return "Cannot file for a future date.";
            if (cutoffs.value && cutoffs.value.length) {
                const c = cutoffs.value.find(item => row.date >= item.start_date && row.date <= item.end_date);
                if (!c) return "Date does not fall within any configured cutoff period.";
                const gDays = typeof overtimeGraceDays.value === "number" ? overtimeGraceDays.value : 2;
                const deadlineDt = new Date(`${c.end_date}T23:59:59`);
                deadlineDt.setDate(deadlineDt.getDate() + gDays);
                const nowMs = new Date((serverTime.value || `${today} 12:00:00`).replace(" ", "T")).getTime();
                if (nowMs > deadlineDt.getTime()) {
                    return `Submission deadline for cutoff ${c.cutoff_name || c.cutoff_code} has passed.`;
                }
            }
            if (row.hasSchedule === false || (!row.regularStart && !row.regularEnd)) {
                return "No published regular duty schedule found for this day.";
            }
            if (row.otStart && row.otEnd) {
                const [sH, sM] = row.otStart.split(":").map(Number);
                const [eH, eM] = row.otEnd.split(":").map(Number);
                const diff = (eH * 60 + eM) - (sH * 60 + sM);
                if (diff <= 0) return "O.T. end time must be after start time.";
                if (diff % 60 !== 0) return "Overtime must be filed in whole-hour increments only.";
                if (row.regularStart && row.regularEnd) {
                    const [rSH, rSM] = row.regularStart.split(":").map(Number);
                    const [rEH, rEM] = row.regularEnd.split(":").map(Number);
                    const rS = rSH * 60 + rSM;
                    const rE = rEH * 60 + rEM;
                    const oS = sH * 60 + sM;
                    const oE = eH * 60 + eM;
                    if (oS < rE && oE > rS) {
                        return "Overtime overlaps with regular duty hours.";
                    }
                }
                if (row.date === today && serverTime.value) {
                    const curTime = serverTime.value.slice(11, 16);
                    if (row.otEnd > curTime) {
                        // Suppress per-row inline error to avoid visual clutter and redundancy across multiple rows.
                        // A unified single banner handles this one-time warning in the UI.
                        if (!isValidation) {
                            return null;
                        }
                        return "Overtime cannot be filed for future hours on today's date.";
                    }
                }
            }
            return null;
        };

        const emptyForm = () => ({
            id: null,
            requestCode: "",
            status: "DRAFT",
            mode: "new", // 'new' | 'draft' | 'resubmit'
            requestType: "EXCUSE_SLIP",
            department: "",
            dateFiled: todayIso(),
            requestDate: todayIso(),
            requestEndDate: todayIso(),
            scheduledStart: "",
            scheduledEnd: "",
            requestedStart: "",
            requestedEnd: "",
            undertimeType: "Early Departure",
            actualTime: "",
            hoursAffected: null,
            minutesAffected: null,
            excuseCodes: [],
            otherExcuseSpecify: "",
            reasonCategory: "",
            explanation: "",
            notes: "",
            overtimeRows: [createDefaultOtRow(todayIso())],
            confirmAccurate: false,
            resubmitNote: "",
            saSignature: "",
            saSignDate: "",
            supervisorSignature: "",
            supervisorSignDate: "",
            supervisorDecision: "",
            supervisorRemarks: "",
            supervisorName: "",
            supervisorActedAt: "",
            coordinatorSignature: "",
            coordinatorSignDate: "",
            coordinatorDecision: "",
            coordinatorRemarks: "",
            coordinatorName: "",
            coordinatorActedAt: "",
            proofData: "",
            proofFileName: "",
            proofSizeBytes: 0,
            hasExistingProof: false
        });

        const form = Vue.ref(emptyForm());

        const displayDepartment = Vue.computed(() => {
            return form.value.department || saContext.value.location || saContext.value.department || saContext.value.officeName || "Assigned Department";
        });

        const departmentOptions = Vue.computed(() => {
            const defaults = [
                "Computer Laboratory",
                "IT Office (ITO)",
                "Registrar's Office",
                "Accounting Office",
                "Admissions Office",
                "Guidance & Counseling Office",
                "Library",
                "Academic Affairs (ACADS)",
                "Student Affairs Office (SAO)",
                "General Administrative Office"
            ];
            const cur = saContext.value.location || saContext.value.department || "";
            if (cur && !defaults.includes(cur)) {
                return [cur, ...defaults];
            }
            return defaults;
        });

        const excuseCodeOptions = [
            "Absence due to Vacation",
            "Absence due to Health",
            "Academic Purposes",
            "Under Time",
            "Other (pls. specify)"
        ];

        const undertimeReasons = [
            "Medical / Health Concern",
            "Urgent Academic / Class Requirement",
            "Family / Personal Emergency",
            "Transportation / Weather Disruption",
            "Official School Activity",
            "Other Valid Reason"
        ];

        const displaySaesNo = Vue.computed(() => {
            if (form.value.requestCode) return form.value.requestCode;
            const year = new Date().getFullYear();
            const seq = String((requests.value.length || 0) + 1).padStart(3, "0");
            return `SAES-${year}-${seq}`;
        });

        // Calculate hours between two HH:MM strings
        const calcHoursBetween = (startStr, endStr) => {
            if (!startStr || !endStr) return 0;
            const p1 = String(startStr).split(":").map(Number);
            const p2 = String(endStr).split(":").map(Number);
            if (p1.length < 2 || p2.length < 2) return 0;
            const diff = (p2[0] * 60 + p2[1]) - (p1[0] * 60 + p1[1]);
            return diff > 0 ? +(diff / 60).toFixed(2) : 0;
        };

        const rowOtHours = row => {
            const h = calcHoursBetween(row.otStart, row.otEnd);
            return h.toFixed(2);
        };

        const rowRegHours = row => {
            const h = calcHoursBetween(row.regularStart, row.regularEnd);
            // Subtract 1 hr lunch break if regular shift is >= 8 hours (08:00 - 17:00 = 8.00 regular hours)
            if (h >= 9) return h - 1;
            return h;
        };

        const otTotals = Vue.computed(() => {
            const rows = Array.isArray(form.value.overtimeRows) ? form.value.overtimeRows : [];
            let regSum = 0;
            let otSum = 0;
            rows.forEach((r, idx) => {
                if (idx === 0) {
                    regSum = rowRegHours(r);
                }
                otSum += calcHoursBetween(r.otStart, r.otEnd);
            });
            const tot = regSum + otSum;
            return {
                regularHours: regSum.toFixed(2),
                overtimeHours: otSum.toFixed(2),
                totalHours: tot.toFixed(2),
                overtimeMinutes: Math.round(otSum * 60)
            };
        });

        const addOvertimeRow = () => {
            const lastRow = form.value.overtimeRows[form.value.overtimeRows.length - 1];
            const nextDate = lastRow ? lastRow.date : todayIso();
            form.value.overtimeRows.push(createDefaultOtRow(nextDate));
        };

        const removeOvertimeRow = idx => {
            if (form.value.overtimeRows.length <= 1) return;
            form.value.overtimeRows.splice(idx, 1);
        };

        const toggleExcuseCode = code => {
            const idx = form.value.excuseCodes.indexOf(code);
            if (idx >= 0) {
                form.value.excuseCodes.splice(idx, 1);
            } else {
                form.value.excuseCodes.push(code);
            }
            form.value.reasonCategory = form.value.excuseCodes.join(", ");
        };

        const copySaesNo = () => {
            if (navigator.clipboard && displaySaesNo.value) {
                navigator.clipboard.writeText(displaySaesNo.value);
                Store.toast("info", `Copied ${displaySaesNo.value} to clipboard.`);
            }
        };

        const excuseDateStatus = Vue.computed(() => {
            if (form.value.requestType !== "EXCUSE_SLIP") return null;
            const from = form.value.requestDate;
            const to = form.value.requestEndDate || from;
            if (!from) return null;

            if (to < from) {
                return {
                    toneClass: "bg-danger/10 border border-danger/30 text-danger",
                    icon: "AlertCircle",
                    title: "Invalid Date Range",
                    message: "To (Date) cannot be earlier than From (Date)."
                };
            }

            const today = serverDate.value || todayIso();

            // Same-day or ongoing absence check
            if (from === today || (from < today && to >= today)) {
                return {
                    toneClass: "bg-amber-50 border border-amber-300 text-amber-900",
                    icon: "AlertTriangle",
                    title: "Same-Day Filing Not Permitted",
                    message: "Excuse slips cannot be filed on the same day as the absence. Advance excuse requests require at least 3 calendar days advance notice, while retrospective excuse slips may be submitted for past dates after the absence has concluded."
                };
            }

            // Advance request check
            if (from > today) {
                const diffMs = new Date(from + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime();
                const daysAhead = Math.round(diffMs / 86400000);
                if (daysAhead < 3) {
                    return {
                        toneClass: "bg-warning/15 border border-warning/40 text-amber-900",
                        icon: "AlertTriangle",
                        title: `Advance Notice Required (${daysAhead} calendar day(s) notice)`,
                        message: "Advance excuse requests must be filed at least three (3) calendar days prior to the absence date."
                    };
                }
                return {
                    toneClass: "bg-blue-50 border border-blue-200 text-blue-900",
                    icon: "CalendarCheck",
                    title: `Advance Excuse Request (${daysAhead} calendar days in advance)`,
                    message: "Valid advance notice. This request will be routed to your Immediate Supervisor for review upon submission."
                };
            }

            // Retrospective / sudden absence check
            if (cutoffs.value && cutoffs.value.length) {
                const cFrom = cutoffs.value.find(c => from >= c.start_date && from <= c.end_date);
                const cTo = cutoffs.value.find(c => to >= c.start_date && to <= c.end_date);

                if (!cFrom || !cTo) {
                    return {
                        toneClass: "bg-danger/10 border border-danger/30 text-danger",
                        icon: "AlertCircle",
                        title: "Cutoff Period Not Found",
                        message: "The requested absence dates do not fall within any configured cutoff period for this semester."
                    };
                }

                if (cFrom.id !== cTo.id) {
                    return {
                        toneClass: "bg-warning/15 border border-warning/40 text-amber-900",
                        icon: "AlertTriangle",
                        title: "Cross-Cutoff Absence Range",
                        message: `The absence range crosses multiple cutoffs (${cFrom.cutoff_name || cFrom.cutoff_code} and ${cTo.cutoff_name || cTo.cutoff_code}). Please submit separate excuse slips for each cutoff period.`
                    };
                }

                // Check expired cutoff with configurable grace period
                const gDays = typeof excuseSlipGraceDays.value === "number" ? excuseSlipGraceDays.value : 2;
                const deadlineDt = new Date(`${cFrom.end_date}T23:59:59`);
                deadlineDt.setDate(deadlineDt.getDate() + gDays);
                const nowTime = serverTime.value || `${today} 12:00:00`;
                const nowMs = new Date(nowTime.replace(" ", "T")).getTime();

                if (nowMs > deadlineDt.getTime()) {
                    return {
                        toneClass: "bg-red-50 border border-red-200 text-red-900",
                        icon: "XCircle",
                        title: "Submission Deadline Passed",
                        message: "The submission deadline for this absence has passed. This excuse slip can no longer be submitted through the normal approval process."
                    };
                }

                const deadlineFormatted = `${formatDate(deadlineDt.toISOString().slice(0, 10))} at 11:59:59 PM Manila Time`;
                const isGracePeriod = today > cFrom.end_date;

                return {
                    toneClass: isGracePeriod ? "bg-amber-50 border border-amber-200 text-amber-900" : "bg-emerald-50 border border-emerald-200 text-emerald-900",
                    icon: isGracePeriod ? "Clock" : "CheckCircle",
                    title: `Retrospective Absence (${cFrom.cutoff_name || cFrom.cutoff_code})`,
                    message: isGracePeriod
                        ? `Eligible for submission under the ${gDays}-calendar-day grace period. Applicable filing deadline is ${deadlineFormatted}.`
                        : `Eligible for submission. Applicable cutoff deadline is ${deadlineFormatted}.`
                };
            }

            return null;
        });

        const formStep = Vue.ref(1);

        const validateStep = (targetStep) => {
            if (formStep.value === 1 && targetStep > 1) {
                formError.value = "";
                const f = form.value;
                if (f.requestType === "EXCUSE_SLIP") {
                    if (!f.requestDate) {
                        formError.value = "Please select the start date (From Date).";
                        return false;
                    }
                    if (excuseDateStatus.value && excuseDateStatus.value.toneClass && excuseDateStatus.value.toneClass.includes("danger")) {
                        formError.value = excuseDateStatus.value.message || "Invalid absence date under current cutoff and filing rules.";
                        return false;
                    }
                    if (excuseDateStatus.value && excuseDateStatus.value.toneClass && excuseDateStatus.value.toneClass.includes("red")) {
                        formError.value = excuseDateStatus.value.message || "The submission deadline for this absence has passed.";
                        return false;
                    }
                    if (!f.excuseCodes || !f.excuseCodes.length) {
                        formError.value = "Please select at least one Excuse Code.";
                        return false;
                    }
                    if (!f.explanation || !f.explanation.trim() || f.explanation.trim().length < 5) {
                        formError.value = "Please provide a brief reason or explanation for your absence.";
                        return false;
                    }
                } else if (f.requestType === "OVERTIME") {
                    const rows = Array.isArray(f.overtimeRows) ? f.overtimeRows : [];
                    if (!rows.length) {
                        formError.value = "Please add at least one Overtime Details row.";
                        return false;
                    }
                    for (let i = 0; i < rows.length; i++) {
                        const r = rows[i];
                        if (!r.date || !r.task || !r.otStart || !r.otEnd) {
                            formError.value = `Please complete Date, Task to Accomplish, and O.T. Time in row #${i + 1}.`;
                            return false;
                        }
                        const err = getOtRowError(r, i, true);
                        if (err) {
                            formError.value = `Row #${i + 1}: ${err}`;
                            return false;
                        }
                        if (isMeaninglessPlaceholder(r.task)) {
                            formError.value = `Row #${i + 1}: Please provide a meaningful Task to Accomplish, not placeholder text.`;
                            return false;
                        }
                    }
                    if (!f.explanation || !f.explanation.trim() || f.explanation.trim().length < 10 || isMeaninglessPlaceholder(f.explanation)) {
                        formError.value = "Please provide a detailed Reason / Justification for rendering overtime (at least 10 characters).";
                        return false;
                    }
                } else if (f.requestType === "UNDERTIME") {
                    if (!f.requestDate) {
                        formError.value = "Please select the Date of Undertime.";
                        return false;
                    }
                    if (!f.actualTime) {
                        formError.value = "Please enter your Actual Time Out / Arrival Time.";
                        return false;
                    }
                    if (!f.reasonCategory) {
                        formError.value = "Please select a Reason for your undertime.";
                        return false;
                    }
                    if (!f.undertimeType) {
                        formError.value = "Please select the Type of Undertime.";
                        return false;
                    }
                }
            }
            return true;
        };

        const goToStep = (step) => {
            if (step === formStep.value) return;
            if (step > formStep.value) {
                if (!validateStep(step)) return;
            }
            formError.value = "";
            formStep.value = step;
            window.scrollTo({ top: 0, behavior: "smooth" });
            if (step === 3) {
                Vue.nextTick(() => {
                    refreshSignatureCanvases();
                });
            }
        };

        const filteredRequests = Vue.computed(() => {
            return requests.value.filter(req => {
                if (filterType.value && req.requestType !== filterType.value) return false;
                if (filterStatus.value && req.status !== filterStatus.value) return false;
                if (searchQuery.value) {
                    const q = searchQuery.value.toLowerCase();
                    const hay = [
                        req.requestCode,
                        req.reasonCategory,
                        req.undertimeType,
                        req.explanation,
                        req.requestDate,
                        label("requestType", req.requestType),
                        label("requestStatus", req.status)
                    ].filter(Boolean).join(" ").toLowerCase();
                    if (!hay.includes(q)) return false;
                }
                return true;
            });
        });

        const matchDutyShiftForDate = dateStr => {
            if (!dateStr || !Array.isArray(saContext.value.scheduleSlots)) return;
            const dt = new Date(dateStr + "T00:00:00");
            if (isNaN(dt.getTime())) return;
            const shortDays = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
            const dayCode = shortDays[dt.getDay()];
            const slot = saContext.value.scheduleSlots.find(s =>
                String(s.dayOfWeek || "").toUpperCase() === dayCode
            );
            if (slot) {
                form.value.scheduledStart = (slot.startTime || "").slice(0, 5);
                form.value.scheduledEnd = (slot.endTime || "").slice(0, 5);
                if (form.value.requestType === "EXCUSE_SLIP") {
                    form.value.requestedStart = form.value.scheduledStart;
                    form.value.requestedEnd = form.value.scheduledEnd;
                }
            }
        };

        const loadData = async () => {
            loading.value = true;
            loadError.value = "";
            const res = await Model.request("requests", "my_requests");
            loading.value = false;
            if (!res.success) {
                loadError.value = res.message || "Could not load your requests.";
                return;
            }
            requests.value = Array.isArray(res.requests) ? res.requests : [];
            if (res.summary) summary.value = res.summary;
            if (res.saContext) {
                saContext.value = { ...saContext.value, ...res.saContext };
                if (!form.value.id) {
                    const resolvedDept = saContext.value.location || saContext.value.department || "";
                    if (resolvedDept) {
                        form.value.department = resolvedDept;
                    }
                    if (saContext.value.supervisorName) {
                        form.value.supervisorName = saContext.value.supervisorName;
                    }
                    if (saContext.value.coordinatorName) {
                        form.value.coordinatorName = saContext.value.coordinatorName;
                    }
                }
            }
            if (res.serverDate) {
                serverDate.value = res.serverDate;
                if (!form.value.id) form.value.dateFiled = res.serverDate;
            }
            if (res.serverTime) serverTime.value = res.serverTime;
            if (Array.isArray(res.cutoffs)) cutoffs.value = res.cutoffs;
            if (typeof res.excuseSlipGraceDays === "number") {
                excuseSlipGraceDays.value = res.excuseSlipGraceDays;
            }
            if (typeof res.overtimeGraceDays === "number") {
                overtimeGraceDays.value = res.overtimeGraceDays;
            }
            checkDeepLink();
        };

        const route = VueRouter.useRoute ? VueRouter.useRoute() : null;

        const checkDeepLink = () => {
            if (!route) return;
            const targetRef = String(route.query.ref || route.query.requestCode || "").trim().toLowerCase();
            const targetId = Number(route.query.id || route.query.requestId || 0);
            if (!targetRef && !targetId) return;

            const match = requests.value.find(r => 
                (targetId && Number(r.id) === targetId) ||
                (targetRef && (
                    String(r.requestCode || "").trim().toLowerCase() === targetRef ||
                    String(r.referenceNumber || "").trim().toLowerCase() === targetRef ||
                    String(r.ref || "").trim().toLowerCase() === targetRef
                ))
            );
            if (match) {
                openDetails(match);
            } else if (targetId) {
                openDetails({ id: targetId });
            }
        };

        if (route) {
            Vue.watch(() => [route.query.ref, route.query.requestCode, route.query.id], () => {
                checkDeepLink();
            });
        }

        const resetFilters = () => {
            searchQuery.value = "";
            filterType.value = "";
            filterStatus.value = "";
        };

        const openNewRequestPicker = () => {
            formError.value = "";
            showTypePickerModal.value = true;
        };

        const startNewRequest = type => {
            showTypePickerModal.value = false;
            formError.value = "";
            const f = emptyForm();
            f.requestType = type;
            f.department = saContext.value.location || saContext.value.department || "";
            f.supervisorName = saContext.value.supervisorName || "";
            f.coordinatorName = saContext.value.coordinatorName || "Ansherina A Sudario";
            if (type === "EXCUSE_SLIP") {
                f.requestDate = "";
                f.requestEndDate = "";
                f.excuseCodes = ["Absence due to Health"];
                f.reasonCategory = "Absence due to Health";
            } else if (type === "OVERTIME") {
                f.reasonCategory = "Authorized Overtime Duty";
                f.overtimeRows = [createDefaultOtRow(todayIso())];
                todayFutureWarningDismissed.value = false;
            } else if (type === "UNDERTIME") {
                f.undertimeType = "Early Departure";
                f.reasonCategory = "";
            }
            form.value = f;
            matchDutyShiftForDate(f.requestDate);
            formStep.value = 1;
            activeView.value = "form";
            window.scrollTo({ top: 0, behavior: "smooth" });
            refreshSignatureCanvases();
        };

        const openEditRequest = (req, mode = "draft") => {
            formError.value = "";
            todayFutureWarningDismissed.value = false;
            formStep.value = 1;
            const codes = req.requestType === "EXCUSE_SLIP" && req.reasonCategory
                ? req.reasonCategory.split(",").map(s => s.trim()).filter(Boolean)
                : [];
            const otRows = (Array.isArray(req.overtimeRows) && req.overtimeRows.length)
                ? req.overtimeRows.map(r => {
                    const rowDate = r.date || req.requestDate || todayIso();
                    const slot = getScheduleSlotForDate(rowDate);
                    return {
                        date: rowDate,
                        task: r.task || "",
                        regularStart: slot ? (slot.startTime || "").slice(0, 5) : (r.regularStart || "08:00"),
                        regularEnd: slot ? (slot.endTime || "").slice(0, 5) : (r.regularEnd || "17:00"),
                        otStart: r.otStart || (req.requestedStart || "17:00").slice(0, 5),
                        otEnd: r.otEnd || (req.requestedEnd || "19:00").slice(0, 5),
                        hasSchedule: Boolean(slot)
                    };
                })
                : [
                    (() => {
                        const rowDate = req.requestDate || todayIso();
                        const slot = getScheduleSlotForDate(rowDate);
                        return {
                            date: rowDate,
                            task: req.reasonCategory || "",
                            regularStart: slot ? (slot.startTime || "").slice(0, 5) : ((req.scheduledStart || "08:00").slice(0, 5)),
                            regularEnd: slot ? (slot.endTime || "").slice(0, 5) : ((req.scheduledEnd || "17:00").slice(0, 5)),
                            otStart: (req.requestedStart || "17:00").slice(0, 5),
                            otEnd: (req.requestedEnd || "19:00").slice(0, 5),
                            hasSchedule: Boolean(slot)
                        };
                    })()
                ];

            form.value = {
                id: req.id,
                requestCode: req.requestCode || req.requestRefNo || "",
                status: req.status || "DRAFT",
                mode,
                requestType: req.requestType,
                department: req.location || req.department || saContext.value.location || saContext.value.department || "Computer Laboratory",
                dateFiled: req.dateFiled || todayIso(),
                requestDate: req.requestDate || todayIso(),
                requestEndDate: req.requestEndDate || req.requestDate || todayIso(),
                scheduledStart: (req.scheduledStart || "").slice(0, 5),
                scheduledEnd: (req.scheduledEnd || "").slice(0, 5),
                requestedStart: (req.requestedStart || "").slice(0, 5),
                requestedEnd: (req.requestedEnd || "").slice(0, 5),
                undertimeType: req.undertimeType || "Early Departure",
                actualTime: (req.actualTime || "").slice(0, 5),
                hoursAffected: req.hoursAffected,
                minutesAffected: req.minutesAffected,
                excuseCodes: codes.length ? codes : ["Absence due to Health"],
                otherExcuseSpecify: "",
                reasonCategory: req.reasonCategory || "",
                explanation: req.explanation || "",
                notes: req.notes || "",
                overtimeRows: otRows,
                confirmAccurate: true,
                resubmitNote: "",
                saSignature: req.saSignature || "",
                saSignDate: req.saSignDate || "",
                supervisorSignature: req.supervisorSignature || "",
                supervisorSignDate: req.supervisorSignDate || "",
                supervisorDecision: req.supervisorDecision || (req.status === 'REJECTED_SUPERVISOR' || req.status === 'REJECTED_BY_SUPERVISOR' ? 'NOT_APPROVED' : (['PENDING_COORDINATOR', 'PENDING_COORDINATOR_RECORDING', 'APPROVED', 'RECORDED'].includes(req.status) ? 'APPROVED' : '')),
                supervisorRemarks: req.supervisorRemarks || "",
                supervisorName: req.supervisorName || saContext.value.supervisorName || "",
                supervisorActedAt: req.supervisorActedAt || "",
                coordinatorSignature: req.coordinatorSignature || "",
                coordinatorSignDate: req.coordinatorSignDate || "",
                coordinatorDecision: req.coordinatorDecision || (['REJECTED_COORDINATOR', 'RETURNED_FOR_CLARIFICATION'].includes(req.status) ? 'NOT_APPROVED' : (['APPROVED', 'RECORDED'].includes(req.status) ? 'APPROVED' : '')),
                coordinatorRemarks: req.coordinatorRemarks || "",
                coordinatorName: req.coordinatorName || saContext.value.coordinatorName || "Ansherina A Sudario",
                coordinatorActedAt: req.coordinatorActedAt || "",
                proofData: "",
                proofFileName: req.proofFileName || "",
                proofSizeBytes: req.proofSizeBytes || req.proofFileSize || 0,
                hasExistingProof: Boolean(req.hasProof)
            };
            showDetailModal.value = false;
            activeView.value = "form";
            window.scrollTo({ top: 0, behavior: "smooth" });
            refreshSignatureCanvases();
        };

        const backToList = () => {
            activeView.value = "list";
            formError.value = "";
            formStep.value = 1;
        };

        const triggerFileInput = () => {
            if (fileInputRef.value) {
                fileInputRef.value.click();
            }
        };

        const processSelectedFile = file => {
            if (!file) return;
            const allowed = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
            if (!allowed.includes(file.type)) {
                formError.value = "Invalid file format. Please upload a PDF, JPG, PNG, or WEBP file.";
                return;
            }
            if (file.size > 5 * 1024 * 1024) {
                formError.value = "Supporting document exceeds the 5 MB limit.";
                return;
            }
            formError.value = "";
            const reader = new FileReader();
            reader.onload = () => {
                form.value.proofData = String(reader.result || "");
                form.value.proofFileName = file.name;
                form.value.proofSizeBytes = file.size;
            };
            reader.readAsDataURL(file);
        };

        const handleProofUpload = event => {
            const file = event.target.files && event.target.files[0];
            processSelectedFile(file);
            event.target.value = "";
        };

        const handleDropFile = event => {
            event.preventDefault();
            const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
            processSelectedFile(file);
        };

        const clearUploadedProof = () => {
            form.value.proofData = "";
            form.value.proofFileName = "";
            form.value.proofSizeBytes = 0;
            form.value.hasExistingProof = false;
        };

        const initSignatureCanvas = (canvas, fieldKey, isInteractive) => {
            if (!canvas) return;
            const ctx = canvas.getContext("2d");
            const existingSig = form.value[fieldKey];

            if (existingSig && existingSig.startsWith("data:image")) {
                const img = new Image();
                img.onload = () => {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                };
                img.src = existingSig;
            } else {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
            }

            if (canvas._initialized) return;
            canvas._initialized = true;

            if (!isInteractive) return;

            let isDrawing = false;
            const getPos = (e) => {
                const rect = canvas.getBoundingClientRect();
                const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                const clientY = e.touches ? e.touches[0].clientY : e.clientY;
                return {
                    x: (clientX - rect.left) * (canvas.width / (rect.width || canvas.width)),
                    y: (clientY - rect.top) * (canvas.height / (rect.height || canvas.height))
                };
            };

            const startDraw = (e) => {
                isDrawing = true;
                const pos = getPos(e);
                ctx.beginPath();
                ctx.moveTo(pos.x, pos.y);
                e.preventDefault();
            };

            const moveDraw = (e) => {
                if (!isDrawing) return;
                const pos = getPos(e);
                ctx.lineTo(pos.x, pos.y);
                ctx.strokeStyle = "#0F2C59";
                ctx.lineWidth = 2.5;
                ctx.lineCap = "round";
                ctx.stroke();
                e.preventDefault();
            };

            const stopDraw = () => {
                if (!isDrawing) return;
                isDrawing = false;
                try {
                    form.value[fieldKey] = canvas.toDataURL("image/png");
                    if (fieldKey === "saSignature") {
                        form.value.saSignDate = serverDate.value || todayIso();
                    }
                } catch (_) {}
            };

            canvas.addEventListener("mousedown", startDraw);
            canvas.addEventListener("mousemove", moveDraw);
            canvas.addEventListener("mouseup", stopDraw);
            canvas.addEventListener("mouseleave", stopDraw);
            canvas.addEventListener("touchstart", startDraw, { passive: false });
            canvas.addEventListener("touchmove", moveDraw, { passive: false });
            canvas.addEventListener("touchend", stopDraw);
        };

        const refreshSignatureCanvases = () => {
            Vue.nextTick(() => {
                if (saCanvasRef.value) {
                    initSignatureCanvas(saCanvasRef.value, "saSignature", true);
                }
            });
        };

        const clearSaSignature = () => {
            if (saCanvasRef.value) {
                const ctx = saCanvasRef.value.getContext("2d");
                ctx.clearRect(0, 0, saCanvasRef.value.width, saCanvasRef.value.height);
            }
            form.value.saSignature = "";
            form.value.saSignDate = "";
        };

        const adoptSaElectronicSignature = () => {
            const canvas = saCanvasRef.value || document.createElement("canvas");
            if (!saCanvasRef.value) {
                canvas.width = 380;
                canvas.height = 110;
            }
            const ctx = canvas.getContext("2d");
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = "#0F2C59";
            ctx.font = "italic bold 22px Georgia, serif";
            ctx.textAlign = "center";
            const name = saContext.value?.fullName || Store.user?.name || form.value.saName || "Student Assistant";
            ctx.fillText(name, canvas.width / 2, 54);
            ctx.font = "bold 10px sans-serif";
            ctx.fillStyle = "#64748B";
            const sDate = serverDate.value || todayIso();
            ctx.fillText(`Electronic Signature • ${sDate}`, canvas.width / 2, 82);
            const dataUrl = canvas.toDataURL("image/png");
            form.value.saSignature = dataUrl;
            form.value.saSignDate = sDate;
        };

        const buildPayload = () => {
            const f = form.value;
            let reasonCat = f.reasonCategory;
            if (f.requestType === "EXCUSE_SLIP") {
                const list = [...f.excuseCodes];
                if (list.includes("Other (pls. specify)") && f.otherExcuseSpecify) {
                    reasonCat = list.map(c => c === "Other (pls. specify)" ? `Other: ${f.otherExcuseSpecify}` : c).join(", ");
                } else {
                    reasonCat = list.join(", ");
                }
            } else if (f.requestType === "OVERTIME") {
                const tasks = f.overtimeRows.map(r => r.task).filter(Boolean);
                reasonCat = tasks.length ? tasks.join("; ").slice(0, 115) : "Overtime Authorization";
            }

            const firstOt = f.overtimeRows && f.overtimeRows[0] ? f.overtimeRows[0] : null;
            const payload = {
                id: f.id,
                requestType: f.requestType,
                department: f.department || displayDepartment.value,
                dateFiled: f.dateFiled || todayIso(),
                requestDate: f.requestType === "OVERTIME" && firstOt ? (firstOt.date || f.requestDate) : f.requestDate,
                requestEndDate: f.requestType === "EXCUSE_SLIP" ? (f.requestEndDate || f.requestDate) : null,
                scheduledStart: f.requestType === "OVERTIME" && firstOt ? firstOt.regularStart : (f.scheduledStart || null),
                scheduledEnd: f.requestType === "OVERTIME" && firstOt ? firstOt.regularEnd : (f.scheduledEnd || null),
                requestedStart: f.requestType === "OVERTIME" && firstOt ? firstOt.otStart : (f.requestedStart || null),
                requestedEnd: f.requestType === "OVERTIME" && firstOt ? firstOt.otEnd : (f.requestedEnd || null),
                undertimeType: f.requestType === "UNDERTIME" ? f.undertimeType : null,
                actualTime: f.requestType === "UNDERTIME" ? (f.actualTime || null) : null,
                reasonCategory: reasonCat,
                explanation: f.requestType === "UNDERTIME"
                    ? (f.notes || f.reasonCategory || f.undertimeType)
                    : f.explanation,
                notes: f.notes || null,
                resubmitNote: f.resubmitNote || null
            };

            if (f.requestType === "OVERTIME") {
                payload.overtimeRows = f.overtimeRows;
                payload.hoursAffected = Number(otTotals.value.overtimeHours);
                payload.minutesAffected = otTotals.value.overtimeMinutes;
            }
            if (f.proofData) {
                payload.proofData = f.proofData;
                payload.proofFileName = f.proofFileName;
            }
            if (f.saSignature) {
                payload.saSignature = f.saSignature;
                payload.saSignDate = f.saSignDate || serverDate.value || todayIso();
            }
            return payload;
        };

        const saveRequest = async submitNow => {
            formError.value = "";
            const f = form.value;

            if (submitNow && !f.saSignature) {
                adoptSaElectronicSignature();
            }

            if (f.requestType === "EXCUSE_SLIP") {
                if (!f.requestDate) {
                    formError.value = "Please select the From (Date) for your Excuse Slip.";
                    formStep.value = 1;
                    Alerts.warning("Validation Required", formError.value);
                    return;
                }
                if (f.requestEndDate && f.requestEndDate < f.requestDate) {
                    formError.value = "To (Date) cannot be earlier than From (Date).";
                    formStep.value = 1;
                    Alerts.warning("Validation Required", formError.value);
                    return;
                }
                if (submitNow) {
                    const today = serverDate.value || todayIso();
                    if (f.requestDate === today || (f.requestDate < today && f.requestEndDate && f.requestEndDate >= today)) {
                        formError.value = "Excuse slips cannot be filed on the same day as the absence. Advance requests require at least 3 calendar days prior notice, while retrospective requests may only be filed starting the day after the absence has concluded.";
                        formStep.value = 1;
                        Alerts.warning("Same-Day Filing Not Permitted", formError.value);
                        return;
                    }
                    if (f.requestDate > today) {
                        const diffMs = new Date(f.requestDate + "T00:00:00").getTime() - new Date(today + "T00:00:00").getTime();
                        const daysAhead = Math.round(diffMs / 86400000);
                        if (daysAhead < 3) {
                            formError.value = `Advance excuse requests must be filed at least three (3) calendar days prior to the start of the absence period (${f.requestDate}).`;
                            formStep.value = 1;
                            Alerts.warning("Advance Notice Required", formError.value);
                            return;
                        }
                    } else if (cutoffs.value && cutoffs.value.length) {
                        const c = cutoffs.value.find(item => f.requestDate >= item.start_date && f.requestDate <= item.end_date);
                        if (c) {
                            const gDays = typeof excuseSlipGraceDays.value === "number" ? excuseSlipGraceDays.value : 2;
                            const deadlineDt = new Date(`${c.end_date}T23:59:59`);
                            deadlineDt.setDate(deadlineDt.getDate() + gDays);
                            const nowTime = serverTime.value || `${today} 12:00:00`;
                            const nowMs = new Date(nowTime.replace(" ", "T")).getTime();
                            if (nowMs > deadlineDt.getTime()) {
                                formError.value = "The submission deadline for this absence has passed. This excuse slip can no longer be submitted through the normal approval process.";
                                formStep.value = 1;
                                Alerts.error("Cutoff Expired", formError.value);
                                return;
                            }
                        }
                    }

                    if (!f.excuseCodes.length) {
                        formError.value = "Please check at least one Excuse Code.";
                        formStep.value = 1;
                        Alerts.warning("Validation Required", formError.value);
                        return;
                    }
                    if (!f.explanation || f.explanation.trim().length < 5) {
                        formError.value = "Please provide a brief reason or explanation for your absence.";
                        formStep.value = 1;
                        Alerts.warning("Validation Required", formError.value);
                        return;
                    }
                    if (!f.confirmAccurate) {
                        formError.value = "Please check 'I confirm that the details provided are accurate.' before submitting.";
                        formStep.value = 3;
                        Alerts.warning("Confirmation Required", formError.value);
                        return;
                    }
                }
            } else if (f.requestType === "OVERTIME") {
                if (!f.overtimeRows.length) {
                    formError.value = "Please add at least one Overtime Details row.";
                    formStep.value = 1;
                    Alerts.warning("Validation Required", formError.value);
                    return;
                }
                if (submitNow) {
                    let firstCutoffId = null;
                    const parsedRowTimes = [];

                    for (let i = 0; i < f.overtimeRows.length; i++) {
                        const r = f.overtimeRows[i];
                        const rowNum = i + 1;

                        if (!r.date || !r.task || !r.otStart || !r.otEnd) {
                            formError.value = `Please complete Date, Task to Accomplish, and O.T. Time in row #${rowNum}.`;
                            formStep.value = 1;
                            Alerts.warning("Validation Required", formError.value);
                            return;
                        }

                        // Check row error using getOtRowError (schedule matching, whole hours, completed date, cutoff)
                        const rowErr = getOtRowError(r, i, true);
                        if (rowErr) {
                            formError.value = `Row #${rowNum}: ${rowErr}`;
                            formStep.value = 1;
                            Alerts.warning("Overtime Policy Violation", formError.value);
                            return;
                        }

                        // Task placeholder check
                        if (isMeaninglessPlaceholder(r.task)) {
                            formError.value = `Row #${rowNum}: Please provide a meaningful Task to Accomplish (e.g. 'Assisted with peak enrollment encoding'), not placeholder text.`;
                            formStep.value = 1;
                            Alerts.warning("Meaningful Task Required", formError.value);
                            return;
                        }

                        // Cutoff single-period check
                        if (cutoffs.value && cutoffs.value.length) {
                            const c = cutoffs.value.find(item => r.date >= item.start_date && r.date <= item.end_date);
                            if (c) {
                                if (firstCutoffId === null) {
                                    firstCutoffId = c.id;
                                } else if (firstCutoffId !== c.id) {
                                    formError.value = "All overtime dates in a submission must belong to the same cutoff period. Please file separate requests for different cutoffs.";
                                    formStep.value = 1;
                                    Alerts.warning("Cross-Cutoff Overtime", formError.value);
                                    return;
                                }
                            }
                        }

                        const [sH, sM] = r.otStart.split(":").map(Number);
                        const [eH, eM] = r.otEnd.split(":").map(Number);
                        parsedRowTimes.push({
                            date: r.date,
                            start: sH * 60 + sM,
                            end: eH * 60 + eM,
                            rowNum
                        });
                    }

                    // Intra-request overlap check
                    for (let i = 0; i < parsedRowTimes.length; i++) {
                        for (let j = i + 1; j < parsedRowTimes.length; j++) {
                            const r1 = parsedRowTimes[i];
                            const r2 = parsedRowTimes[j];
                            if (r1.date === r2.date) {
                                if (r1.start < r2.end && r1.end > r2.start) {
                                    formError.value = `Row #${r1.rowNum} and Row #${r2.rowNum} have overlapping overtime hours on ${r1.date}.`;
                                    formStep.value = 1;
                                    Alerts.warning("Overlapping Overtime Rows", formError.value);
                                    return;
                                }
                            }
                        }
                    }

                    // Request-level Reason / Justification check
                    if (!f.explanation || f.explanation.trim().length < 10 || isMeaninglessPlaceholder(f.explanation)) {
                        formError.value = "Please provide a detailed Reason / Justification for rendering overtime (at least 10 characters, not placeholder text).";
                        formStep.value = 1;
                        Alerts.warning("Validation Required", formError.value);
                        return;
                    }

                    if (!f.confirmAccurate) {
                        formError.value = "Please check 'I confirm that the details provided are accurate.' before submitting.";
                        formStep.value = 3;
                        Alerts.warning("Confirmation Required", formError.value);
                        return;
                    }
                }
            } else if (f.requestType === "UNDERTIME") {
                if (!f.requestDate) {
                    formError.value = "Please select the Date of Undertime.";
                    formStep.value = 1;
                    Alerts.warning("Validation Required", formError.value);
                    return;
                }
                if (submitNow) {
                    if (!f.actualTime) {
                        formError.value = "Please enter the Actual Time Out / Arrival Time.";
                        formStep.value = 1;
                        Alerts.warning("Validation Required", formError.value);
                        return;
                    }
                    if (!f.reasonCategory) {
                        formError.value = "Please select a Reason for your undertime.";
                        formStep.value = 1;
                        Alerts.warning("Validation Required", formError.value);
                        return;
                    }
                    if (!f.undertimeType) {
                        formError.value = "Please select the Type of Undertime.";
                        formStep.value = 1;
                        Alerts.warning("Validation Required", formError.value);
                        return;
                    }
                    if (!f.confirmAccurate) {
                        formError.value = "Please check 'I confirm that the details provided are accurate.' before submitting.";
                        formStep.value = 3;
                        Alerts.warning("Confirmation Required", formError.value);
                        return;
                    }
                }
            }

            if (submitNow) {
                const ok = await Alerts.confirm({
                    title: f.mode === "resubmit" ? "Resubmit Request?" : "Submit Request?",
                    text: "Are you sure you want to submit this request to your Immediate Supervisor for review?",
                    icon: "question",
                    confirmText: f.mode === "resubmit" ? "Yes, Resubmit" : "Yes, Submit Request",
                    requireReason: false
                });
                if (!ok) return;
            }

            let action = "submit";
            if (!submitNow) {
                action = "save_draft";
            } else if (f.mode === "resubmit") {
                action = "resubmit";
            }

            const payload = buildPayload();
            submitting.value = true;
            const res = await Model.request("requests", action, payload);
            submitting.value = false;

            if (!res.success) {
                formError.value = res.message || "Could not process your request.";
                Alerts.error("Submission Failed", formError.value);
                return;
            }

            await Alerts.success(submitNow ? "Request Submitted" : "Draft Saved", res.message || (submitNow ? "Request submitted for review." : "Draft saved."));
            if (Store.loadNotifications) Store.loadNotifications();
            await loadData();
            activeView.value = "list";
        };

        const deleteDraft = async req => {
            if (!req || !req.id) return;
            if (req.status !== 'DRAFT') {
                Alerts.warning("Action Not Allowed", "Only unsubmitted draft requests can be deleted.");
                return;
            }

            const refCode = req.referenceCode || req.reference_no || req.request_ref_no || `#${req.id}`;
            const typeLabel = label('requestType', req.requestType || req.request_type);

            const ok = await Alerts.confirm({
                title: "Delete Draft Request?",
                html: `Are you sure you want to permanently delete draft <b>${refCode}</b> (${typeLabel})?<br><span class="text-xs text-muted">This draft and any uploaded documents will be permanently removed and cannot be restored.</span>`,
                confirmText: "Yes, Delete Draft",
                cancelText: "Keep Draft",
                icon: "warning",
                danger: true,
                requireReason: false
            });

            if (!ok) return;

            try {
                const res = await Model.request("requests", "delete_draft", { id: req.id });
                if (!res.success) {
                    Alerts.error("Delete Failed", res.message || "Could not delete draft request.");
                    return;
                }

                await Alerts.success("Draft Deleted", res.message || "Draft request deleted successfully.");
                if (showDetailModal.value && selectedRequest.value && selectedRequest.value.id === req.id) {
                    showDetailModal.value = false;
                    selectedRequest.value = null;
                }
                if (activeView.value === 'form' && form.id === req.id) {
                    activeView.value = 'list';
                }
                await loadData();
            } catch (err) {
                Alerts.error("Error", err.message || "An unexpected error occurred while deleting the draft.");
            }
        };

        const openDetails = async req => {
            selectedRequest.value = req;
            selectedHistory.value = [];
            showDetailModal.value = true;
            detailLoading.value = true;
            const res = await Model.request("requests", "get", { id: req.id });
            detailLoading.value = false;
            if (res.success) {
                if (res.request) selectedRequest.value = res.request;
                selectedHistory.value = Array.isArray(res.history) ? res.history : [];
            }
        };

        const formatRelevantDate = req => {
            if (!req) return "—";
            const start = formatDate(req.requestDate);
            if (req.requestEndDate && req.requestEndDate !== req.requestDate) {
                return `${start} – ${formatDate(req.requestEndDate)}`;
            }
            return start;
        };

        const formatDate = d => {
            if (!d) return "—";
            const dt = new Date(d + "T00:00:00");
            if (isNaN(dt.getTime())) return d;
            return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        };

        const formatShortDate = d => {
            if (!d) return "—";
            const parts = String(d).split("-");
            if (parts.length === 3) return `${parts[1]}-${parts[2]}-${parts[0]}`;
            return d;
        };

        const formatDateTime = dtStr => {
            if (!dtStr) return "—";
            const normalized = dtStr.includes("T") ? dtStr : dtStr.replace(" ", "T");
            const dt = new Date(normalized);
            if (isNaN(dt.getTime())) return dtStr;
            return dt.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
        };

        const formatTime = t => {
            if (!t) return "";
            const parts = String(t).split(":");
            if (parts.length < 2) return t;
            let h = parseInt(parts[0], 10);
            const m = parts[1];
            const ampm = h >= 12 ? "PM" : "AM";
            h = h % 12 || 12;
            return `${h}:${m} ${ampm}`;
        };

        const formatBytes = bytes => {
            const b = Number(bytes || 0);
            if (b < 1024) return b + " B";
            if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
            return (b / (1024 * 1024)).toFixed(2) + " MB";
        };

        const formatAction = action => {
            const map = {
                SA_SAVE_DRAFT: "Saved as Draft",
                CREATE_DRAFT: "Saved as Draft",
                UPDATE_DRAFT: "Updated Draft",
                SA_SUBMIT: "Submitted to Immediate Supervisor",
                SUBMIT: "Submitted to Immediate Supervisor",
                SA_RESUBMIT: "Corrected & Resubmitted",
                RESUBMIT: "Corrected & Resubmitted",
                SUPERVISOR_APPROVE: "Approved by Immediate Supervisor",
                SUPERVISOR_RETURN: "Returned by Supervisor for Correction",
                SUPERVISOR_REJECT: "Rejected by Immediate Supervisor",
                SUPERVISOR_RESUBMIT_CLARIFICATION: "Supervisor Submitted Clarification to Coordinator",
                COORDINATOR_RECORD: "Verified & Recorded by S.A. Coordinator",
                COORDINATOR_RETURN_CLARIFICATION: "Returned by Coordinator for Clarification"
            };
            return map[action] || action;
        };

        const formatRole = role => {
            const r = String(role || "").toUpperCase();
            if (r === "SA") return "Student Assistant";
            if (r === "SUPERVISOR") return "Immediate Supervisor";
            if (r === "ADMIN") return "S.A. Coordinator";
            return role;
        };

        const typeIcon = type => {
            if (type === "EXCUSE_SLIP") return "FileText";
            if (type === "OVERTIME") return "Clock";
            return "Hourglass";
        };

        const typeBadgeTone = type => {
            if (type === "EXCUSE_SLIP") return "bg-info/10 text-info";
            if (type === "OVERTIME") return "bg-navy/10 text-navy";
            return "bg-warning/15 text-warning";
        };

        Vue.watch(() => form.value.requestType, () => {
            refreshSignatureCanvases();
        });

        Vue.watch(activeView, val => {
            if (val === "form") {
                refreshSignatureCanvases();
            }
        });

        Vue.onMounted(loadData);

        return {
            Store,
            loading,
            loadError,
            requests,
            summary,
            saContext,
            activeView,
            showTypePickerModal,
            showDetailModal,
            searchQuery,
            filterType,
            filterStatus,
            filteredRequests,
            resetFilters,
            detailLoading,
            selectedRequest,
            selectedHistory,
            submitting,
            formError,
            fileInputRef,
            form,
            serverDate,
            serverTime,
            cutoffs,
            excuseSlipGraceDays,
            overtimeGraceDays,
            todayIso,
            eligibleOtCutoffs,
            earliestOtDate,
            onOtRowDateChange,
            getOtRowError,
            todayFutureWarningDismissed,
            hasTodayFutureHoursWarning,
            excuseDateStatus,
            displayDepartment,
            departmentOptions,
            excuseCodeOptions,
            undertimeReasons,
            displaySaesNo,
            rowOtHours,
            otTotals,
            addOvertimeRow,
            removeOvertimeRow,
            toggleExcuseCode,
            copySaesNo,
            matchDutyShiftForDate,
            loadData,
            openNewRequestPicker,
            startNewRequest,
            openEditRequest,
            backToList,
            triggerFileInput,
            handleProofUpload,
            handleDropFile,
            clearUploadedProof,
            saCanvasRef,
            clearSaSignature,
            adoptSaElectronicSignature,
            refreshSignatureCanvases,
            formStep,
            validateStep,
            goToStep,
            saveRequest,
            deleteDraft,
            openDetails,
            formatRelevantDate,
            formatDate,
            formatShortDate,
            formatDateTime,
            formatTime,
            formatBytes,
            formatAction,
            formatRole,
            typeIcon,
            typeBadgeTone,
            label
        };
    },

    template: `
    <div>
        <!-- Hidden shared file input -->
        <input ref="fileInputRef" type="file" accept=".pdf,image/jpeg,image/png,image/webp"
               class="hidden" @change="handleProofUpload" />

        <!-- ========================================================================= -->
        <!-- VIEW 1: FULL-PAGE FORM VIEW (EXCUSE SLIP / OVERTIME / UNDERTIME)          -->
        <!-- ========================================================================= -->
        <div v-if="activeView === 'form'" class="space-y-5">
            <!-- Top Breadcrumb -->
            <div class="flex items-center gap-2 text-xs text-muted">
                <button type="button" @click="backToList"
                        class="inline-flex items-center gap-1.5 font-semibold text-blue-700 hover:text-navy transition-colors">
                    <app-icon name="ArrowLeft" :size="14" />
                    <span>{{ form.requestType === 'UNDERTIME' ? 'Back to Request Management' : 'Request Management' }}</span>
                </button>
                <span>&gt;</span>
                <span class="text-muted font-medium">
                    {{ form.requestType === 'EXCUSE_SLIP' ? 'New Excuse Slip' : (form.requestType === 'OVERTIME' ? 'New Overtime Request' : 'New Undertime Form') }}
                </span>
            </div>

            <!-- Returned for Correction Banner (if resubmitting) -->
            <div v-if="form.mode === 'resubmit' && (form.supervisorRemarks || form.coordinatorRemarks)"
                 class="rounded-xl border border-warning/40 bg-warning/10 p-4 text-xs text-ink">
                <div class="flex items-center gap-2 font-bold text-warning">
                    <app-icon name="RotateCcw" :size="16" />
                    <span>Returned for Correction — Please update your form and resubmit</span>
                </div>
                <p class="mt-1 text-ink whitespace-pre-line">{{ form.supervisorRemarks || form.coordinatorRemarks }}</p>
            </div>

            <!-- Page Title + Right Status Pill -->
            <div class="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <h1 class="text-2xl font-bold text-[#0f2557]">
                        {{ form.requestType === 'EXCUSE_SLIP'
                            ? 'Student Assistant Excuse Slip'
                            : (form.requestType === 'OVERTIME'
                                ? 'Student Assistant Overtime Authorization Form'
                                : 'Student Assistant Undertime Form') }}
                    </h1>
                    <p class="mt-1 text-xs text-slate-500">
                        {{ form.requestType === 'EXCUSE_SLIP'
                            ? 'Submit your excuse slip with details and optional supporting proof.'
                            : (form.requestType === 'OVERTIME'
                                ? 'Fill out the form below. Attach supporting documents (optional) and submit for approval.'
                                : 'Fill out the form below. Provide details and submit for approval.') }}
                    </p>
                </div>
                <div class="flex items-center gap-2">
                    <button v-if="form.id && form.status === 'DRAFT'" type="button"
                            @click="deleteDraft(form)"
                            class="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 px-3 py-1.5 text-xs font-semibold text-rose-700 transition-colors shadow-2xs">
                        <app-icon name="Trash2" :size="13" /> Delete Draft
                    </button>
                    <span class="inline-flex items-center rounded-full bg-amber-100 px-3.5 py-1 text-xs font-semibold text-amber-800 border border-amber-200">
                        {{ form.status === 'DRAFT' ? 'Draft' : label('requestStatus', form.status) }}
                    </span>
                </div>
            </div>

            <!-- Horizontal Stepper Bar -->
            <div class="flex items-center gap-3 py-2 overflow-x-auto">
                <button type="button" @click="goToStep(1)" class="flex items-center gap-2.5 shrink-0 group focus:outline-none text-left">
                    <span class="grid h-7 w-7 place-items-center rounded-full text-xs font-bold transition-all"
                          :class="formStep === 1 ? 'bg-[#0f2557] text-white shadow-xs' : (formStep > 1 ? 'bg-emerald-600 text-white' : 'border border-slate-300 bg-white text-slate-500')">
                        <app-icon v-if="formStep > 1" name="Check" :size="14" />
                        <span v-else>1</span>
                    </span>
                    <span class="text-xs transition-colors"
                          :class="formStep === 1 ? 'font-bold text-[#0f2557]' : (formStep > 1 ? 'font-semibold text-emerald-700' : 'font-medium text-slate-500 group-hover:text-slate-700')">
                        Student Info &amp; Details
                    </span>
                </button>
                <div class="h-px flex-1 min-w-[30px]" :class="formStep > 1 ? 'bg-emerald-500' : 'bg-slate-200'"></div>

                <button type="button" @click="goToStep(2)" class="flex items-center gap-2.5 shrink-0 group focus:outline-none text-left">
                    <span class="grid h-7 w-7 place-items-center rounded-full text-xs font-bold transition-all"
                          :class="formStep === 2 ? 'bg-[#0f2557] text-white shadow-xs' : (formStep > 2 ? 'bg-emerald-600 text-white' : 'border border-slate-300 bg-white text-slate-500')">
                        <app-icon v-if="formStep > 2" name="Check" :size="14" />
                        <span v-else>2</span>
                    </span>
                    <span class="text-xs transition-colors"
                          :class="formStep === 2 ? 'font-bold text-[#0f2557]' : (formStep > 2 ? 'font-semibold text-emerald-700' : 'font-medium text-slate-500 group-hover:text-slate-700')">
                        Supporting Proof (Optional)
                    </span>
                </button>
                <div class="h-px flex-1 min-w-[30px]" :class="formStep > 2 ? 'bg-emerald-500' : 'bg-slate-200'"></div>

                <button type="button" @click="goToStep(3)" class="flex items-center gap-2.5 shrink-0 group focus:outline-none text-left">
                    <span class="grid h-7 w-7 place-items-center rounded-full text-xs font-bold transition-all"
                          :class="formStep === 3 ? 'bg-[#0f2557] text-white shadow-xs' : 'border border-slate-300 bg-white text-slate-500'">
                        3
                    </span>
                    <span class="text-xs transition-colors"
                          :class="formStep === 3 ? 'font-bold text-[#0f2557]' : 'font-medium text-slate-500 group-hover:text-slate-700'">
                        Approval &amp; Signatures
                    </span>
                </button>
            </div>

            <!-- Validation Error Banner -->
            <div v-if="formError" class="rounded-xl border border-danger/30 bg-danger/10 p-3.5 text-xs font-semibold text-danger flex items-center gap-2">
                <app-icon name="AlertCircle" :size="16" />
                <span>{{ formError }}</span>
            </div>

            <!-- ===================================================================== -->
            <!-- TWO-COLUMN GRID: LEFT (8 COLS) MAIN FORM + RIGHT (4 COLS) SIDEBAR     -->
            <!-- ===================================================================== -->
            <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

                <!-- ================================================================= -->
                <!-- FORM 1: EXCUSE SLIP                                               -->
                <!-- ================================================================= -->
                <template v-if="form.requestType === 'EXCUSE_SLIP'">
                    <!-- Left Column (Single Multi-Step Card) -->
                    <div class="lg:col-span-8 card p-6 space-y-6">

                        <!-- STEP 1: Student Information & Absence Details -->
                        <div v-show="formStep === 1" class="space-y-6">
                            <!-- Top Policy & 2-Day Grace Period Reminder Banner -->
                            <div class="rounded-xl border border-blue-200 bg-blue-50/70 p-4 text-xs text-blue-900 flex items-start gap-3 shadow-xs">
                                <app-icon name="CalendarClock" :size="20" class="text-blue-600 shrink-0 mt-0.5" />
                                <div class="min-w-0 flex-1 space-y-1">
                                    <div class="flex items-center justify-between flex-wrap gap-2">
                                        <p class="font-bold text-[#0f2557] text-[13px]">Excuse Slip Filing Rules &amp; Cutoff Grace Period</p>
                                        <span class="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-[11px] font-semibold text-blue-800 border border-blue-200">
                                            {{ excuseSlipGraceDays || 2 }}-Day Grace Period Active
                                        </span>
                                    </div>
                                    <p class="text-[11px] text-slate-600 leading-relaxed">
                                        • <strong>Retrospective Absences (Past Dates):</strong> Submissions are permitted for past dates within the covered cutoff, with a <strong>{{ excuseSlipGraceDays || 2 }}-calendar-day grace period</strong> after the cutoff concludes.<br>
                                        • <strong>Same-Day Restriction:</strong> Submissions on the exact day of absence are strictly not permitted.<br>
                                        • <strong>Advance Notice:</strong> For advance requests, submissions must be made at least <strong>three (3) calendar days prior</strong> to the absence date.
                                    </p>
                                </div>
                            </div>

                            <!-- Top Dynamic Cutoff & Date Guidance Status Banner (Pic No. 2) -->
                            <div v-if="excuseDateStatus" class="rounded-xl p-4 text-xs transition-all shadow-sm"
                                 :class="excuseDateStatus.toneClass">
                                <div class="flex items-start gap-3">
                                    <app-icon :name="excuseDateStatus.icon" :size="20" class="mt-0.5 shrink-0" />
                                    <div class="min-w-0 flex-1">
                                        <p class="font-bold text-[13px]">{{ excuseDateStatus.title }}</p>
                                        <p class="text-[11px] opacity-90 mt-0.5 leading-relaxed">{{ excuseDateStatus.message }}</p>
                                    </div>
                                </div>
                            </div>

                            <!-- Student Information -->
                            <div>
                                <div class="flex items-center gap-2 text-sm font-bold text-[#0f2557] mb-4">
                                    <app-icon name="Contact" :size="18" class="text-blue-600" />
                                    <span>Student Information</span>
                                </div>

                                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label class="block text-xs font-semibold text-slate-700 mb-1.5">
                                            Student Assistant Name <span class="text-danger">*</span>
                                        </label>
                                        <div class="relative">
                                            <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                                                <app-icon name="User" :size="15" />
                                            </span>
                                            <input type="text" :value="saContext.fullName || Store.user?.name || ''" disabled
                                                   class="w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 py-2.5 text-xs font-medium text-slate-700" />
                                        </div>
                                    </div>

                                    <div>
                                        <label class="block text-xs font-semibold text-slate-700 mb-1.5">
                                            SAES No. <span class="text-danger">*</span>
                                        </label>
                                        <div class="relative">
                                            <input type="text" :value="displaySaesNo" disabled
                                                   class="w-full rounded-lg border border-slate-200 bg-slate-50 pl-3.5 pr-9 py-2.5 text-xs font-medium text-slate-600" />
                                            <button type="button" @click="copySaesNo" title="Copy SAES No."
                                                    class="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-navy">
                                                <app-icon name="Copy" :size="14" />
                                            </button>
                                        </div>
                                    </div>

                                    <div>
                                        <label class="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center justify-between">
                                            <span>Department <span class="text-danger">*</span></span>
                                            <span class="text-[10px] text-slate-400 font-normal">Auto-assigned</span>
                                        </label>
                                        <div class="relative">
                                            <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                                                <app-icon name="Building2" :size="15" />
                                            </span>
                                            <input type="text" :value="displayDepartment" disabled
                                                   class="w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 py-2.5 text-xs font-medium text-slate-700 cursor-not-allowed" />
                                        </div>
                                    </div>

                                    <div>
                                        <label class="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center justify-between">
                                            <span>Date Filed <span class="text-danger">*</span></span>
                                            <span class="text-[10px] text-slate-400 font-normal">Auto (Asia/Manila)</span>
                                        </label>
                                        <div class="relative">
                                            <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                                                <app-icon name="Calendar" :size="15" />
                                            </span>
                                            <input type="text" :value="formatDate(form.dateFiled)" disabled
                                                   class="w-full rounded-lg border border-slate-200 bg-slate-100/90 pl-9 pr-3 py-2.5 text-xs font-semibold text-slate-700 cursor-not-allowed" />
                                        </div>
                                    </div>

                                    <div>
                                        <label class="block text-xs font-semibold text-slate-700 mb-1.5">
                                            From (Date) <span class="text-danger">*</span>
                                        </label>
                                        <input v-model="form.requestDate" @change="matchDutyShiftForDate(form.requestDate)" type="date"
                                               class="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none" />
                                    </div>

                                    <div>
                                        <label class="block text-xs font-semibold text-slate-700 mb-1.5">
                                            To (Date) <span class="text-danger">*</span>
                                        </label>
                                        <input v-model="form.requestEndDate" :min="form.requestDate" type="date"
                                               class="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none" />
                                    </div>
                                </div>
                            </div>

                            <!-- Excuse Code (Please Check) + Reason / Explanation -->
                            <div class="rounded-xl border border-slate-200 p-5">
                                <div class="flex items-center gap-2 text-sm font-bold text-[#0f2557] mb-4">
                                    <app-icon name="FileCheck2" :size="18" class="text-blue-600" />
                                    <span>Excuse Code <span class="text-xs font-semibold text-slate-500">(Please Check)</span></span>
                                </div>

                                <div class="grid grid-cols-1 md:grid-cols-12 gap-5">
                                    <!-- Checkboxes -->
                                    <div class="md:col-span-5 space-y-2.5">
                                        <label v-for="code in excuseCodeOptions" :key="code"
                                               class="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer select-none">
                                            <input type="checkbox"
                                                   :checked="form.excuseCodes.includes(code)"
                                                   @change="toggleExcuseCode(code)"
                                                   class="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                                            <span>{{ code }}</span>
                                        </label>
                                        <input v-if="form.excuseCodes.includes('Other (pls. specify)')"
                                               v-model.trim="form.otherExcuseSpecify"
                                               type="text" placeholder="Please specify other reason..."
                                               class="mt-1 w-full rounded-lg border border-slate-200 px-3 py-1.5 text-xs focus:border-blue-600 focus:outline-none" />
                                    </div>

                                    <!-- Reason / Explanation -->
                                    <div class="md:col-span-7">
                                        <label class="block text-xs font-semibold text-slate-700 mb-1.5">
                                            Reason / Explanation <span class="text-danger">*</span>
                                        </label>
                                        <textarea v-model="form.explanation" rows="4" maxlength="500"
                                                  placeholder="Please provide a brief reason or explanation for your absence."
                                                  class="w-full rounded-lg border border-slate-200 p-3 text-xs text-slate-700 focus:border-blue-600 focus:outline-none"></textarea>
                                        <div class="mt-1 text-right text-[11px] text-slate-400">
                                            {{ (form.explanation || '').length }}/500
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Step 1 Footer Buttons -->
                            <div class="flex items-center justify-between gap-3 pt-4 border-t border-slate-100">
                                <button v-if="form.mode !== 'resubmit'" type="button"
                                        @click="saveRequest(false)" :disabled="submitting"
                                        class="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-5 py-2.5 text-xs font-semibold text-slate-700 transition-colors">
                                    Save Draft
                                </button>
                                <div v-else></div>
                                <button type="button" @click="goToStep(2)"
                                        class="inline-flex items-center gap-2 rounded-lg bg-[#0f2557] hover:bg-navy-700 px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors">
                                    <span>Next: Supporting Proof</span>
                                    <app-icon name="ArrowRight" :size="14" />
                                </button>
                            </div>
                        </div>

                        <!-- STEP 2: Supporting Proof (Optional) -->
                        <div v-show="formStep === 2" class="space-y-6">
                            <!-- Supporting Proof (Optional) -->
                            <div class="rounded-xl border border-slate-200 p-5">
                                <div class="flex items-center gap-2 text-sm font-bold text-[#0f2557]">
                                    <app-icon name="Paperclip" :size="18" class="text-blue-600" />
                                    <span>Supporting Proof (Optional)</span>
                                </div>
                                <p class="mt-0.5 text-xs text-slate-500 mb-4">
                                    Attach a letter or proof explaining your absence for the selected date(s) (optional).
                                </p>

                                <div class="grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch">
                                    <!-- Drag and drop box -->
                                    <div class="md:col-span-6 rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/30 p-6 flex flex-col items-center justify-center text-center"
                                         @dragover.prevent @drop="handleDropFile">
                                        <div class="grid h-11 w-11 place-items-center rounded-full bg-blue-100/80 text-blue-600 mb-2.5">
                                            <app-icon name="UploadCloud" :size="24" />
                                        </div>
                                        <p class="text-xs font-medium text-slate-600">Drag and drop your file here</p>
                                        <span class="text-[11px] text-slate-400 my-1">or</span>
                                        <button type="button" @click="triggerFileInput"
                                                class="mt-1 rounded-lg bg-[#0f2557] hover:bg-navy-700 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors">
                                            Upload Letter / Proof
                                        </button>
                                        <p class="mt-2.5 text-[10px] text-slate-400">
                                            Accepted formats: PDF, JPG, PNG, WEBP (Max 5MB)
                                        </p>
                                    </div>

                                    <!-- Uploaded File & Examples -->
                                    <div class="md:col-span-6 flex flex-col justify-between space-y-3">
                                        <div>
                                            <span class="block text-xs font-semibold text-slate-700 mb-1.5">Uploaded File</span>
                                            <div v-if="form.proofFileName"
                                                 class="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                                                <div class="flex items-center gap-3 min-w-0">
                                                    <div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-red-50 text-red-600 font-bold text-[10px] border border-red-100">
                                                        PDF
                                                    </div>
                                                    <div class="min-w-0">
                                                        <p class="truncate text-xs font-semibold text-[#0f2557]">{{ form.proofFileName }}</p>
                                                        <p class="text-[11px] text-slate-400">{{ form.proofSizeBytes ? formatBytes(form.proofSizeBytes) : 'Attached file' }}</p>
                                                    </div>
                                                </div>
                                                <button type="button" @click="clearUploadedProof"
                                                        class="ml-2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-danger">
                                                    <app-icon name="X" :size="15" />
                                                </button>
                                            </div>
                                            <div v-else class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-400 italic">
                                                No file attached yet (optional).
                                            </div>
                                        </div>

                                        <div class="rounded-xl bg-blue-50/70 border border-blue-100 p-3 text-[11px] text-blue-900">
                                            <div class="flex items-center gap-1.5 font-semibold text-blue-800 mb-1">
                                                <app-icon name="Info" :size="13" />
                                                <span>Examples of acceptable proof:</span>
                                            </div>
                                            <ul class="list-disc list-inside space-y-0.5 text-blue-700 pl-1">
                                                <li>Medical certificate</li>
                                                <li>Appointment slip</li>
                                                <li>School/academic letter</li>
                                                <li>Other relevant proof</li>
                                            </ul>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Step 2 Footer Buttons -->
                            <div class="flex items-center justify-between gap-3 pt-4 border-t border-slate-100">
                                <button type="button" @click="goToStep(1)"
                                        class="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-5 py-2.5 text-xs font-semibold text-slate-700 transition-colors">
                                    <app-icon name="ArrowLeft" :size="14" />
                                    <span>Back to Details</span>
                                </button>
                                <div class="flex items-center gap-2">
                                    <button v-if="form.mode !== 'resubmit'" type="button"
                                            @click="saveRequest(false)" :disabled="submitting"
                                            class="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-700 transition-colors">
                                        Save Draft
                                    </button>
                                    <button type="button" @click="goToStep(3)"
                                            class="inline-flex items-center gap-2 rounded-lg bg-[#0f2557] hover:bg-navy-700 px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors">
                                        <span>Next: Approval &amp; Signatures</span>
                                        <app-icon name="ArrowRight" :size="14" />
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- STEP 3: Approval & Signature Area -->
                        <div v-show="formStep === 3" class="space-y-6">
                            <!-- Approval & Signature Area (E-Signature Pads & Role Restrictions) -->
                            <div class="rounded-xl border border-slate-200 p-5 space-y-4">
                                <div class="flex items-center justify-between flex-wrap gap-2">
                                    <div class="flex items-center gap-2 text-sm font-bold text-[#0f2557]">
                                        <app-icon name="ShieldCheck" :size="18" class="text-blue-600" />
                                        <span>Approval &amp; Signature Area</span>
                                    </div>
                                    <span class="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 bg-slate-100 rounded-md px-2 py-0.5 border border-slate-200">
                                        <app-icon name="Shield" :size="12" class="text-blue-600" /> Multi-Stage Role Gated
                                    </span>
                                </div>

                                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                                    <!-- Col 1: Student Assistant Signature -->
                                    <div class="rounded-xl border border-slate-200 bg-white p-3.5 flex flex-col justify-between space-y-3 shadow-xs">
                                        <div class="flex items-center justify-between">
                                            <span class="font-bold text-slate-800 uppercase tracking-wider text-[11px]">1. Student Assistant</span>
                                            <div class="flex items-center gap-1.5">
                                                <button type="button" @click="adoptSaElectronicSignature"
                                                        class="text-[10px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded px-1.5 py-0.5 transition-colors">
                                                    Adopt E-Sig
                                                </button>
                                                <button type="button" @click="clearSaSignature"
                                                        class="text-[10px] font-bold text-rose-600 hover:text-rose-800 hover:underline">
                                                    Clear
                                                </button>
                                            </div>
                                        </div>

                                        <!-- Drawing Canvas -->
                                        <div class="relative overflow-hidden rounded-lg border border-slate-300 bg-white shadow-inner">
                                            <canvas ref="saCanvasRef" width="380" height="100" class="h-24 w-full cursor-crosshair" style="touch-action: none;"></canvas>
                                            <div v-if="!form.saSignature" class="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] text-slate-400 font-medium">
                                                Draw signature with mouse or touch
                                            </div>
                                        </div>

                                        <!-- Sub-Fields: Name & Date -->
                                        <div class="space-y-1.5 pt-1 border-t border-slate-100">
                                            <div>
                                                <label class="block text-[10px] font-bold uppercase text-slate-500">Student Assistant Name</label>
                                                <input type="text" :value="saContext.fullName || Store.user?.name || form.saName || 'Student Assistant'" disabled
                                                       class="w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700 cursor-not-allowed" />
                                            </div>
                                            <div class="flex items-center justify-between text-[11px]">
                                                <span class="text-slate-500">Date Signed:</span>
                                                <span class="font-semibold text-slate-700">{{ formatShortDate(form.saSignDate || form.dateFiled || todayIso()) }}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <!-- Col 2: Immediate Supervisor Signature -->
                                    <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 flex flex-col justify-between space-y-3">
                                        <div class="flex items-center justify-between">
                                            <span class="font-bold text-slate-800 uppercase tracking-wider text-[11px]">2. Immediate Supervisor</span>
                                            <span class="rounded bg-amber-100 border border-amber-200 px-1.5 py-0.2 text-[9px] font-bold text-amber-800">Stage 1</span>
                                        </div>

                                        <!-- Locked E-Signature Pad / Rendered Signature -->
                                        <div class="relative overflow-hidden rounded-lg border border-slate-200 bg-white h-24 flex items-center justify-center p-2">
                                            <img v-if="form.supervisorSignature" :src="form.supervisorSignature" class="max-h-full max-w-full object-contain" alt="Supervisor Signature" />
                                            <div v-else class="flex flex-col items-center justify-center text-center p-2 text-slate-400 select-none">
                                                <app-icon name="Lock" :size="16" class="text-slate-400 mb-0.5" />
                                                <span class="text-[11px] font-semibold text-slate-600">Restricted to Supervisor</span>
                                                <span class="text-[9px] text-slate-400 leading-tight">Anti-falsification restricted for S.A.</span>
                                            </div>
                                        </div>

                                        <!-- Decision Checkboxes & Reason/Remarks -->
                                        <div class="space-y-1.5 pt-1 border-t border-slate-200/80">
                                            <div class="flex items-center justify-between text-[11px]">
                                                <label class="inline-flex items-center gap-1 cursor-not-allowed">
                                                    <input type="checkbox" :checked="form.supervisorDecision === 'APPROVED'" disabled
                                                           class="rounded border-slate-300 text-emerald-600 h-3.5 w-3.5" />
                                                    <span :class="form.supervisorDecision === 'APPROVED' ? 'font-bold text-emerald-700' : 'text-slate-600'">Approved</span>
                                                </label>
                                                <label class="inline-flex items-center gap-1 cursor-not-allowed">
                                                    <input type="checkbox" :checked="form.supervisorDecision === 'NOT_APPROVED'" disabled
                                                           class="rounded border-slate-300 text-rose-600 h-3.5 w-3.5" />
                                                    <span :class="form.supervisorDecision === 'NOT_APPROVED' ? 'font-bold text-rose-700' : 'text-slate-600'">Not Approved</span>
                                                </label>
                                            </div>
                                            <div v-if="form.supervisorDecision === 'NOT_APPROVED' || form.supervisorRemarks"
                                                 class="rounded bg-rose-50 border border-rose-200 p-1.5 text-[10px] text-rose-900">
                                                <span class="font-bold block">Disapproval Reason / Remarks:</span>
                                                {{ form.supervisorRemarks || 'No reason provided.' }}
                                            </div>
                                            <div>
                                                <label class="block text-[10px] font-bold uppercase text-slate-500">Supervisor Name</label>
                                                <input type="text" :value="form.supervisorName || saContext.supervisorName || 'Assigned Immediate Supervisor'" disabled
                                                       class="w-full rounded border border-slate-200 bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700 cursor-not-allowed" />
                                            </div>
                                            <div class="flex items-center justify-between text-[11px]">
                                                <span class="text-slate-500">Date Signed:</span>
                                                <span class="font-semibold text-slate-700">{{ form.supervisorSignDate ? formatShortDate(form.supervisorSignDate) : 'Pending Review' }}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <!-- Col 3: S.A Coordinator Signature -->
                                    <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 flex flex-col justify-between space-y-3">
                                        <div class="flex items-center justify-between">
                                            <span class="font-bold text-slate-800 uppercase tracking-wider text-[11px]">3. S.A. Coordinator</span>
                                            <span class="rounded bg-blue-100 border border-blue-200 px-1.5 py-0.2 text-[9px] font-bold text-blue-800">Final Stage</span>
                                        </div>

                                        <!-- Locked E-Signature Pad / Rendered Signature -->
                                        <div class="relative overflow-hidden rounded-lg border border-slate-200 bg-white h-24 flex items-center justify-center p-2">
                                            <img v-if="form.coordinatorSignature" :src="form.coordinatorSignature" class="max-h-full max-w-full object-contain" alt="Coordinator Signature" />
                                            <div v-else class="flex flex-col items-center justify-center text-center p-2 text-slate-400 select-none">
                                                <app-icon name="Lock" :size="16" class="text-slate-400 mb-0.5" />
                                                <span class="text-[11px] font-semibold text-slate-600">Restricted to Coordinator</span>
                                                <span class="text-[9px] text-slate-400 leading-tight">Anti-falsification restricted for S.A.</span>
                                            </div>
                                        </div>

                                        <!-- Decision Checkboxes & Reason/Remarks -->
                                        <div class="space-y-1.5 pt-1 border-t border-slate-200/80">
                                            <div class="flex items-center justify-between text-[11px]">
                                                <label class="inline-flex items-center gap-1 cursor-not-allowed">
                                                    <input type="checkbox" :checked="form.coordinatorDecision === 'APPROVED'" disabled
                                                           class="rounded border-slate-300 text-emerald-600 h-3.5 w-3.5" />
                                                    <span :class="form.coordinatorDecision === 'APPROVED' ? 'font-bold text-emerald-700' : 'text-slate-600'">Approved</span>
                                                </label>
                                                <label class="inline-flex items-center gap-1 cursor-not-allowed">
                                                    <input type="checkbox" :checked="form.coordinatorDecision === 'NOT_APPROVED'" disabled
                                                           class="rounded border-slate-300 text-rose-600 h-3.5 w-3.5" />
                                                    <span :class="form.coordinatorDecision === 'NOT_APPROVED' ? 'font-bold text-rose-700' : 'text-slate-600'">Not Approved</span>
                                                </label>
                                            </div>
                                            <div v-if="form.coordinatorDecision === 'NOT_APPROVED' || form.coordinatorRemarks"
                                                 class="rounded bg-rose-50 border border-rose-200 p-1.5 text-[10px] text-rose-900">
                                                <span class="font-bold block">Disapproval Reason / Remarks:</span>
                                                {{ form.coordinatorRemarks || 'No reason provided.' }}
                                            </div>
                                            <div>
                                                <label class="block text-[10px] font-bold uppercase text-slate-500">Coordinator Name</label>
                                                <input type="text" :value="form.coordinatorName || saContext.coordinatorName || 'Ansherina A Sudario'" disabled
                                                       class="w-full rounded border border-slate-200 bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700 cursor-not-allowed" />
                                            </div>
                                            <div class="flex items-center justify-between text-[11px]">
                                                <span class="text-slate-500">Date Signed:</span>
                                                <span class="font-semibold text-slate-700">{{ form.coordinatorSignDate ? formatShortDate(form.coordinatorSignDate) : 'Pending Recording' }}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Accuracy Checkbox & Footer Buttons -->
                            <div class="pt-2 space-y-4">
                                <label class="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer select-none">
                                    <input type="checkbox" v-model="form.confirmAccurate"
                                           class="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                                    <span>I confirm that the details provided are accurate. <span class="text-danger">*</span></span>
                                </label>

                                <div class="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
                                    <button type="button" @click="goToStep(2)"
                                            class="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-5 py-2.5 text-xs font-semibold text-slate-700 transition-colors">
                                        <app-icon name="ArrowLeft" :size="14" />
                                        <span>Back to Supporting Proof</span>
                                    </button>
                                    <div class="flex items-center gap-2">
                                        <button v-if="form.mode !== 'resubmit'" type="button"
                                                @click="saveRequest(false)" :disabled="submitting"
                                                class="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-700 transition-colors">
                                            Save Draft
                                        </button>
                                        <button type="button"
                                                @click="saveRequest(true)" :disabled="submitting"
                                                class="inline-flex items-center gap-2 rounded-lg bg-[#0f2557] hover:bg-navy-700 px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors">
                                            <span>{{ form.mode === 'resubmit' ? 'Resubmit Excuse Slip' : 'Submit Excuse Slip' }}</span>
                                            <app-icon name="ArrowRight" :size="14" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Right Column Sidebar (Excuse Slip) -->
                    <div class="lg:col-span-4 space-y-5">
                        <div class="card p-5">
                            <div class="flex items-center gap-2 text-sm font-bold text-[#0f2557] mb-4">
                                <app-icon name="CheckCircle2" :size="18" class="text-blue-600" />
                                <span>Approval Flow</span>
                            </div>

                            <div class="relative pl-3 space-y-5 before:absolute before:left-[19px] before:top-3 before:bottom-3 before:w-0.5 before:bg-blue-100">
                                <div class="relative flex items-start gap-3">
                                    <span class="relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#0f2557] text-xs font-bold text-white shadow-xs">1</span>
                                    <div>
                                        <p class="text-xs font-bold text-[#0f2557]">1. S.A. Filing</p>
                                        <p class="text-[11px] text-slate-500 mt-0.5">S.A. submits request with details &amp; e-signature.</p>
                                    </div>
                                </div>
                                <div class="relative flex items-start gap-3">
                                    <span class="relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#0f2557] text-xs font-bold text-white shadow-xs">2</span>
                                    <div>
                                        <p class="text-xs font-bold text-[#0f2557]">2. Supervisor Review &amp; Approval</p>
                                        <p class="text-[11px] text-slate-500 mt-0.5">Immediate Supervisor reviews, verifies schedule, and signs decision.</p>
                                    </div>
                                </div>
                                <div class="relative flex items-start gap-3">
                                    <span class="relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#0f2557] text-xs font-bold text-white shadow-xs">3</span>
                                    <div>
                                        <p class="text-xs font-bold text-[#0f2557]">3. Coordinator Review &amp; Final Approval</p>
                                        <p class="text-[11px] text-slate-500 mt-0.5">S.A. Coordinator performs final validation and signs approval.</p>
                                    </div>
                                </div>
                            </div>

                            <div class="mt-5 rounded-xl bg-blue-50/80 border border-blue-100 p-3 flex items-start gap-2.5 text-[11px] text-blue-800">
                                <app-icon name="Info" :size="15" class="text-blue-600 shrink-0 mt-0.5" />
                                <span>Submission does not mean automatic approval. Request must complete all review stages.</span>
                            </div>
                        </div>

                        <div class="card p-5 space-y-4">
                            <div class="flex items-center gap-2 text-sm font-bold text-[#0f2557]">
                                <app-icon name="CheckSquare" :size="18" class="text-blue-600" />
                                <span>Before you submit</span>
                            </div>

                            <ul class="space-y-2.5 text-xs text-slate-600">
                                <li class="flex items-start gap-2">
                                    <app-icon name="Check" :size="14" class="text-blue-600 shrink-0 mt-0.5" />
                                    <span>Make sure you selected the <strong>correct excuse code</strong>.</span>
                                </li>
                                <li class="flex items-start gap-2">
                                    <app-icon name="Check" :size="14" class="text-blue-600 shrink-0 mt-0.5" />
                                    <span>Attach a <strong>valid letter or proof</strong> of your absence.</span>
                                </li>
                                <li class="flex items-start gap-2">
                                    <app-icon name="Check" :size="14" class="text-blue-600 shrink-0 mt-0.5" />
                                    <span>Check the date range (<strong>From and To dates</strong>).</span>
                                </li>
                                <li class="flex items-start gap-2">
                                    <app-icon name="Check" :size="14" class="text-blue-600 shrink-0 mt-0.5" />
                                    <span>Ensure all information is <strong>accurate and complete</strong>.</span>
                                </li>
                            </ul>

                            <div class="pt-3 border-t border-slate-100 flex items-start gap-3">
                                <div class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#0f2557] text-white">
                                    <app-icon name="Lock" :size="15" />
                                </div>
                                <div>
                                    <p class="text-xs font-bold text-[#0f2557]">Your information is secure.</p>
                                    <p class="text-[11px] text-slate-500 mt-0.5">
                                        Documents and personal data are kept confidential and accessible only to authorized personnel.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </template>

                <!-- ================================================================= -->
                <!-- FORM 2: OVERTIME AUTHORIZATION FORM                               -->
                <!-- ================================================================= -->
                <template v-else-if="form.requestType === 'OVERTIME'">
                    <!-- Left Column (Single Multi-Step Card) -->
                    <div class="lg:col-span-8 card p-6 space-y-6">

                        <!-- STEP 1: Student Information, Overtime Table, & Reason -->
                        <div v-show="formStep === 1" class="space-y-6">
                            <!-- Student Information -->
                            <div>
                                <div class="flex items-center gap-2 text-sm font-bold text-[#0f2557] mb-4">
                                    <app-icon name="Contact" :size="18" class="text-blue-600" />
                                    <span>Student Information</span>
                                </div>

                                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label class="block text-xs font-semibold text-slate-700 mb-1.5">
                                            Student Assistant Name <span class="text-danger">*</span>
                                        </label>
                                        <div class="relative">
                                            <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                                                <app-icon name="User" :size="15" />
                                            </span>
                                            <input type="text" :value="saContext.fullName || Store.user?.name || ''" disabled
                                                   class="w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 py-2.5 text-xs font-medium text-slate-700" />
                                        </div>
                                    </div>

                                    <div>
                                        <label class="block text-xs font-semibold text-slate-700 mb-1.5">
                                            SAES No. <span class="text-danger">*</span>
                                        </label>
                                        <div class="relative">
                                            <input type="text" :value="displaySaesNo" disabled
                                                   class="w-full rounded-lg border border-slate-200 bg-slate-50 pl-3.5 pr-9 py-2.5 text-xs font-medium text-slate-600" />
                                            <button type="button" @click="copySaesNo" title="Copy SAES No."
                                                    class="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-navy">
                                                <app-icon name="Copy" :size="14" />
                                            </button>
                                        </div>
                                    </div>

                                    <div>
                                        <label class="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center justify-between">
                                            <span>Department <span class="text-danger">*</span></span>
                                            <span class="text-[10px] text-slate-400 font-normal">Auto-assigned</span>
                                        </label>
                                        <div class="relative">
                                            <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                                                <app-icon name="Building2" :size="15" />
                                            </span>
                                            <input type="text" :value="displayDepartment" disabled
                                                   class="w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 py-2.5 text-xs font-medium text-slate-700 cursor-not-allowed" />
                                        </div>
                                    </div>

                                    <div>
                                        <label class="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center justify-between">
                                            <span>Date Filed <span class="text-danger">*</span></span>
                                            <span class="text-[10px] text-slate-400 font-normal">Auto (Asia/Manila)</span>
                                        </label>
                                        <div class="relative">
                                            <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                                                <app-icon name="Calendar" :size="15" />
                                            </span>
                                            <input type="text" :value="formatDate(form.dateFiled)" disabled
                                                   class="w-full rounded-lg border border-slate-200 bg-slate-100/90 pl-9 pr-3 py-2.5 text-xs font-semibold text-slate-700 cursor-not-allowed" />
                                        </div>
                                    </div>
                                </div>
                            </div>


                            <!-- Overtime Details Multi-Row Table -->
                            <div class="rounded-xl border border-slate-200 p-5 space-y-4">
                                <div class="flex items-center gap-2 text-sm font-bold text-[#0f2557]">
                                    <app-icon name="Clock" :size="18" class="text-blue-600" />
                                    <span>Overtime Details</span>
                                </div>

                                <!-- One-Time Appearance Notice: Future Hours on Today's Date -->
                                <div v-if="hasTodayFutureHoursWarning && !todayFutureWarningDismissed"
                                     class="rounded-xl border border-amber-300 bg-amber-50/90 p-3.5 text-xs text-amber-950 flex items-start justify-between gap-3 shadow-xs">
                                    <div class="flex items-start gap-2.5">
                                        <app-icon name="AlertTriangle" :size="16" class="text-amber-600 shrink-0 mt-0.5" />
                                        <div class="min-w-0">
                                            <p class="font-bold text-amber-950 text-[12px]">Notice: Overtime cannot be filed for future hours on today's date ({{ formatDate(serverDate || todayIso()) }})</p>
                                            <p class="text-[11px] text-amber-800 mt-0.5 leading-relaxed">
                                                Overtime duty hours must have already been completed before submitting an OT request. If you are rendering overtime today, please file after completing your overtime duty, or select an eligible completed past work date.
                                            </p>
                                        </div>
                                    </div>
                                    <button type="button" @click="todayFutureWarningDismissed = true" title="Dismiss notice"
                                            class="text-amber-500 hover:text-amber-800 shrink-0 p-1 rounded-md hover:bg-amber-100/60 transition-colors">
                                        <app-icon name="X" :size="14" />
                                    </button>
                                </div>

                                <div class="overflow-x-auto">
                                    <table class="w-full text-left text-xs">
                                        <thead>
                                            <tr class="border-b border-slate-200 bg-slate-50/80 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                                                <th class="px-2.5 py-2.5">Date <span class="text-danger">*</span></th>
                                                <th class="px-2.5 py-2.5">Task to Accomplish <span class="text-danger">*</span></th>
                                                <th class="px-2.5 py-2.5">Regular Time <span class="text-slate-400 font-normal">(Authoritative)</span></th>
                                                <th class="px-2.5 py-2.5">O.T. Time <span class="text-danger">*</span></th>
                                                <th class="px-2.5 py-2.5 w-24">Total Hours</th>
                                                <th class="px-1.5 py-2.5 w-8"></th>
                                            </tr>
                                        </thead>
                                        <tbody class="divide-y divide-slate-100">
                                            <template v-for="(row, idx) in form.overtimeRows" :key="idx">
                                                <tr>
                                                    <td class="px-2 py-2">
                                                        <input v-model="row.date" @change="onOtRowDateChange(row)" type="date"
                                                               :min="earliestOtDate" :max="serverDate || todayIso()"
                                                               class="w-32 rounded-lg border border-slate-200 px-2 py-1.5 text-xs focus:border-blue-600 focus:outline-none" />
                                                    </td>
                                                    <td class="px-2 py-2">
                                                        <input v-model.trim="row.task" type="text"
                                                               placeholder="e.g. System maintenance and monitoring"
                                                               class="w-full min-w-[180px] rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs focus:border-blue-600 focus:outline-none" />
                                                    </td>
                                                    <td class="px-2 py-2">
                                                        <div class="flex items-center gap-1">
                                                            <input :value="row.regularStart" type="time" disabled title="Authoritative regular duty start time (locked)"
                                                                   class="w-24 rounded-lg border border-slate-200 bg-slate-100/90 px-1.5 py-1.5 text-[11px] font-medium text-slate-600 cursor-not-allowed" />
                                                            <span class="text-slate-400">–</span>
                                                            <input :value="row.regularEnd" type="time" disabled title="Authoritative regular duty end time (locked)"
                                                                   class="w-24 rounded-lg border border-slate-200 bg-slate-100/90 px-1.5 py-1.5 text-[11px] font-medium text-slate-600 cursor-not-allowed" />
                                                        </div>
                                                    </td>
                                                    <td class="px-2 py-2">
                                                        <div class="flex items-center gap-1">
                                                            <input v-model="row.otStart" type="time"
                                                                   class="w-24 rounded-lg border border-slate-200 px-1.5 py-1.5 text-[11px] focus:border-blue-600 focus:outline-none" />
                                                            <span class="text-slate-400">–</span>
                                                            <input v-model="row.otEnd" type="time"
                                                                   class="w-24 rounded-lg border border-slate-200 px-1.5 py-1.5 text-[11px] focus:border-blue-600 focus:outline-none" />
                                                        </div>
                                                    </td>
                                                    <td class="px-2 py-2">
                                                        <input type="text" :value="rowOtHours(row)" disabled
                                                               class="w-20 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-semibold text-slate-700 text-center" />
                                                    </td>
                                                    <td class="px-1 py-2 text-center">
                                                        <button type="button" @click="removeOvertimeRow(idx)"
                                                                :disabled="form.overtimeRows.length <= 1"
                                                                class="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-danger disabled:opacity-30">
                                                            <app-icon name="Trash2" :size="14" />
                                                        </button>
                                                    </td>
                                                </tr>
                                                <tr v-if="getOtRowError(row, idx)" class="bg-red-50/60">
                                                    <td colspan="6" class="px-3 py-1.5 text-[11px] text-red-700 font-medium border-b border-red-100">
                                                        <div class="flex items-center gap-1.5">
                                                            <app-icon name="AlertTriangle" :size="13" class="text-red-500 shrink-0" />
                                                            <span>Row #{{ idx + 1 }}: {{ getOtRowError(row, idx) }}</span>
                                                        </div>
                                                    </td>
                                                </tr>
                                            </template>
                                        </tbody>
                                    </table>
                                </div>

                                <div>
                                    <button type="button" @click="addOvertimeRow"
                                            class="inline-flex items-center gap-1.5 rounded-lg border border-blue-300 bg-white hover:bg-blue-50 px-3.5 py-1.5 text-xs font-semibold text-blue-700 transition-colors">
                                        <app-icon name="Plus" :size="14" /> Add Row
                                    </button>
                                </div>

                                <!-- Summary Hours Row -->
                                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
                                    <div class="rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
                                        <span class="block text-[11px] text-slate-500">Regular Hours</span>
                                        <span class="text-sm font-bold text-[#0f2557]">{{ otTotals.regularHours }}</span>
                                    </div>
                                    <div class="rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
                                        <span class="block text-[11px] text-slate-500">Overtime Hours</span>
                                        <span class="text-sm font-bold text-[#0f2557]">{{ otTotals.overtimeHours }}</span>
                                    </div>
                                    <div class="rounded-lg border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
                                        <span class="block text-[11px] text-slate-500">Total Hours</span>
                                        <span class="text-sm font-bold text-[#0f2557]">{{ otTotals.totalHours }}</span>
                                    </div>
                                </div>
                            </div>

                            <!-- Reason / Justification -->
                            <div class="rounded-xl border border-slate-200 p-5 space-y-3">
                                <div>
                                    <div class="flex items-center gap-2 text-xs font-bold text-[#0f2557] mb-2">
                                        <app-icon name="FileText" :size="16" class="text-blue-600" />
                                        <span>Reason / Justification <span class="text-danger">*</span></span>
                                    </div>
                                    <textarea v-model="form.explanation" rows="4" maxlength="500"
                                              placeholder="Explain why the work must be done beyond regular hours."
                                              class="w-full rounded-lg border border-slate-200 p-3 text-xs text-slate-700 focus:border-blue-600 focus:outline-none"></textarea>
                                    <div class="mt-1 text-right text-[11px] text-slate-400">
                                        {{ (form.explanation || '').length }}/500
                                    </div>
                                </div>
                                <div class="rounded-lg bg-blue-50/80 border border-blue-100 px-3 py-2 flex items-center gap-2 text-[11px] text-blue-800">
                                    <app-icon name="Info" :size="14" class="text-blue-600 shrink-0" />
                                    <span>Submit for approval before rendering overtime, according to school policy.</span>
                                </div>
                            </div>

                            <!-- Step 1 Footer Buttons -->
                            <div class="flex items-center justify-between gap-3 pt-4 border-t border-slate-100">
                                <button v-if="form.mode !== 'resubmit'" type="button"
                                        @click="saveRequest(false)" :disabled="submitting"
                                        class="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-5 py-2.5 text-xs font-semibold text-slate-700 transition-colors">
                                    Save Draft
                                </button>
                                <div v-else></div>
                                <button type="button" @click="goToStep(2)"
                                        class="inline-flex items-center gap-2 rounded-lg bg-[#0f2557] hover:bg-navy-700 px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors">
                                    <span>Next: Supporting Proof</span>
                                    <app-icon name="ArrowRight" :size="14" />
                                </button>
                            </div>
                        </div>

                        <!-- STEP 2: Supporting Attachment (Optional) -->
                        <div v-show="formStep === 2" class="space-y-6">
                            <div class="rounded-xl border border-slate-200 p-5">
                                <div class="flex items-center gap-2 text-sm font-bold text-[#0f2557] mb-1">
                                    <app-icon name="Paperclip" :size="18" class="text-blue-600" />
                                    <span>Supporting Attachment (Optional)</span>
                                </div>
                                <p class="text-xs text-slate-500 mb-4">
                                    Attach supporting documentation, task assignment, or authorization proof (optional).
                                </p>

                                <div class="grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch">
                                    <div class="md:col-span-6 rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/30 p-6 flex flex-col items-center justify-center text-center"
                                         @dragover.prevent @drop="handleDropFile">
                                        <div class="grid h-11 w-11 place-items-center rounded-full bg-blue-100/80 text-blue-600 mb-2.5">
                                            <app-icon name="UploadCloud" :size="24" />
                                        </div>
                                        <p class="text-xs font-medium text-slate-600">Drag and drop your file here</p>
                                        <span class="text-[11px] text-slate-400 my-1">or</span>
                                        <button type="button" @click="triggerFileInput"
                                                class="mt-1 rounded-lg bg-[#0f2557] hover:bg-navy-700 px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors">
                                            Upload Supporting Attachment
                                        </button>
                                        <p class="mt-2.5 text-[10px] text-slate-400">
                                            Accepted formats: PDF, JPG, PNG, WEBP (Max 5MB)
                                        </p>
                                    </div>

                                    <div class="md:col-span-6 flex flex-col justify-between space-y-3">
                                        <div>
                                            <span class="block text-xs font-semibold text-slate-700 mb-1.5">Uploaded File</span>
                                            <div v-if="form.proofFileName"
                                                 class="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                                                <div class="flex items-center gap-3 min-w-0">
                                                    <div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600 font-bold text-[10px] border border-blue-100">
                                                        FILE
                                                    </div>
                                                    <div class="min-w-0">
                                                        <p class="truncate text-xs font-semibold text-[#0f2557]">{{ form.proofFileName }}</p>
                                                        <p class="text-[11px] text-slate-400">{{ form.proofSizeBytes ? formatBytes(form.proofSizeBytes) : 'Attached file' }}</p>
                                                    </div>
                                                </div>
                                                <button type="button" @click="clearUploadedProof"
                                                        class="ml-2 rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-danger">
                                                    <app-icon name="X" :size="15" />
                                                </button>
                                            </div>
                                            <div v-else class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-400 italic">
                                                No file attached yet (optional).
                                            </div>
                                        </div>

                                        <div class="rounded-xl bg-blue-50/70 border border-blue-100 p-3 text-[11px] text-blue-900">
                                            <div class="flex items-center gap-1.5 font-semibold text-blue-800 mb-1">
                                                <app-icon name="Info" :size="13" />
                                                <span>Overtime documentation note:</span>
                                            </div>
                                            <p class="text-blue-700 leading-relaxed">
                                                Supporting attachments are optional. You may attach supervisor directives, project task tickets, or attendance logs if available.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Step 2 Footer Buttons -->
                            <div class="flex items-center justify-between gap-3 pt-4 border-t border-slate-100">
                                <button type="button" @click="goToStep(1)"
                                        class="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-5 py-2.5 text-xs font-semibold text-slate-700 transition-colors">
                                    <app-icon name="ArrowLeft" :size="14" />
                                    <span>Back to Details</span>
                                </button>
                                <div class="flex items-center gap-2">
                                    <button v-if="form.mode !== 'resubmit'" type="button"
                                            @click="saveRequest(false)" :disabled="submitting"
                                            class="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-700 transition-colors">
                                        Save Draft
                                    </button>
                                    <button type="button" @click="goToStep(3)"
                                            class="inline-flex items-center gap-2 rounded-lg bg-[#0f2557] hover:bg-navy-700 px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors">
                                        <span>Next: Approval &amp; Signatures</span>
                                        <app-icon name="ArrowRight" :size="14" />
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- STEP 3: Approval & Signature Area -->
                        <div v-show="formStep === 3" class="space-y-6">
                            <!-- Approval & Signature Area (E-Signature Pads & Role Restrictions) -->
                            <div class="rounded-xl border border-slate-200 p-5 space-y-4">
                                <div class="flex items-center justify-between flex-wrap gap-2">
                                    <div class="flex items-center gap-2 text-sm font-bold text-[#0f2557]">
                                        <app-icon name="ShieldCheck" :size="18" class="text-blue-600" />
                                        <span>Approval &amp; Signature Area</span>
                                    </div>
                                    <span class="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 bg-slate-100 rounded-md px-2 py-0.5 border border-slate-200">
                                        <app-icon name="Shield" :size="12" class="text-blue-600" /> Multi-Stage Role Gated
                                    </span>
                                </div>

                                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                                    <!-- Col 1: Student Assistant Signature -->
                                    <div class="rounded-xl border border-slate-200 bg-white p-3.5 flex flex-col justify-between space-y-3 shadow-xs">
                                        <div class="flex items-center justify-between">
                                            <span class="font-bold text-slate-800 uppercase tracking-wider text-[11px]">1. Student Assistant</span>
                                            <div class="flex items-center gap-1.5">
                                                <button type="button" @click="adoptSaElectronicSignature"
                                                        class="text-[10px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded px-1.5 py-0.5 transition-colors">
                                                    Adopt E-Sig
                                                </button>
                                                <button type="button" @click="clearSaSignature"
                                                        class="text-[10px] font-bold text-rose-600 hover:text-rose-800 hover:underline">
                                                    Clear
                                                </button>
                                            </div>
                                        </div>

                                        <!-- Drawing Canvas -->
                                        <div class="relative overflow-hidden rounded-lg border border-slate-300 bg-white shadow-inner">
                                            <canvas ref="saCanvasRef" width="380" height="100" class="h-24 w-full cursor-crosshair" style="touch-action: none;"></canvas>
                                            <div v-if="!form.saSignature" class="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] text-slate-400 font-medium">
                                                Draw signature with mouse or touch
                                            </div>
                                        </div>

                                        <!-- Sub-Fields: Name & Date -->
                                        <div class="space-y-1.5 pt-1 border-t border-slate-100">
                                            <div>
                                                <label class="block text-[10px] font-bold uppercase text-slate-500">Student Assistant Name</label>
                                                <input type="text" :value="saContext.fullName || Store.user?.name || form.saName || 'Student Assistant'" disabled
                                                       class="w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700 cursor-not-allowed" />
                                            </div>
                                            <div class="flex items-center justify-between text-[11px]">
                                                <span class="text-slate-500">Date Signed:</span>
                                                <span class="font-semibold text-slate-700">{{ formatShortDate(form.saSignDate || form.dateFiled || todayIso()) }}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <!-- Col 2: Immediate Supervisor Signature -->
                                    <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 flex flex-col justify-between space-y-3">
                                        <div class="flex items-center justify-between">
                                            <span class="font-bold text-slate-800 uppercase tracking-wider text-[11px]">2. Immediate Supervisor</span>
                                            <span class="rounded bg-amber-100 border border-amber-200 px-1.5 py-0.2 text-[9px] font-bold text-amber-800">Stage 1</span>
                                        </div>

                                        <!-- Locked E-Signature Pad / Rendered Signature -->
                                        <div class="relative overflow-hidden rounded-lg border border-slate-200 bg-white h-24 flex items-center justify-center p-2">
                                            <img v-if="form.supervisorSignature" :src="form.supervisorSignature" class="max-h-full max-w-full object-contain" alt="Supervisor Signature" />
                                            <div v-else class="flex flex-col items-center justify-center text-center p-2 text-slate-400 select-none">
                                                <app-icon name="Lock" :size="16" class="text-slate-400 mb-0.5" />
                                                <span class="text-[11px] font-semibold text-slate-600">Restricted to Supervisor</span>
                                                <span class="text-[9px] text-slate-400 leading-tight">Anti-falsification restricted for S.A.</span>
                                            </div>
                                        </div>

                                        <!-- Decision Checkboxes & Reason/Remarks -->
                                        <div class="space-y-1.5 pt-1 border-t border-slate-200/80">
                                            <div class="flex items-center justify-between text-[11px]">
                                                <label class="inline-flex items-center gap-1 cursor-not-allowed">
                                                    <input type="checkbox" :checked="form.supervisorDecision === 'APPROVED'" disabled
                                                           class="rounded border-slate-300 text-emerald-600 h-3.5 w-3.5" />
                                                    <span :class="form.supervisorDecision === 'APPROVED' ? 'font-bold text-emerald-700' : 'text-slate-600'">Approved</span>
                                                </label>
                                                <label class="inline-flex items-center gap-1 cursor-not-allowed">
                                                    <input type="checkbox" :checked="form.supervisorDecision === 'NOT_APPROVED'" disabled
                                                           class="rounded border-slate-300 text-rose-600 h-3.5 w-3.5" />
                                                    <span :class="form.supervisorDecision === 'NOT_APPROVED' ? 'font-bold text-rose-700' : 'text-slate-600'">Not Approved</span>
                                                </label>
                                            </div>
                                            <div v-if="form.supervisorDecision === 'NOT_APPROVED' || form.supervisorRemarks"
                                                 class="rounded bg-rose-50 border border-rose-200 p-1.5 text-[10px] text-rose-900">
                                                <span class="font-bold block">Disapproval Reason / Remarks:</span>
                                                {{ form.supervisorRemarks || 'No reason provided.' }}
                                            </div>
                                            <div>
                                                <label class="block text-[10px] font-bold uppercase text-slate-500">Supervisor Name</label>
                                                <input type="text" :value="form.supervisorName || saContext.supervisorName || 'Assigned Immediate Supervisor'" disabled
                                                       class="w-full rounded border border-slate-200 bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700 cursor-not-allowed" />
                                            </div>
                                            <div class="flex items-center justify-between text-[11px]">
                                                <span class="text-slate-500">Date Signed:</span>
                                                <span class="font-semibold text-slate-700">{{ form.supervisorSignDate ? formatShortDate(form.supervisorSignDate) : 'Pending Review' }}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <!-- Col 3: S.A Coordinator Signature -->
                                    <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 flex flex-col justify-between space-y-3">
                                        <div class="flex items-center justify-between">
                                            <span class="font-bold text-slate-800 uppercase tracking-wider text-[11px]">3. S.A. Coordinator</span>
                                            <span class="rounded bg-blue-100 border border-blue-200 px-1.5 py-0.2 text-[9px] font-bold text-blue-800">Final Stage</span>
                                        </div>

                                        <!-- Locked E-Signature Pad / Rendered Signature -->
                                        <div class="relative overflow-hidden rounded-lg border border-slate-200 bg-white h-24 flex items-center justify-center p-2">
                                            <img v-if="form.coordinatorSignature" :src="form.coordinatorSignature" class="max-h-full max-w-full object-contain" alt="Coordinator Signature" />
                                            <div v-else class="flex flex-col items-center justify-center text-center p-2 text-slate-400 select-none">
                                                <app-icon name="Lock" :size="16" class="text-slate-400 mb-0.5" />
                                                <span class="text-[11px] font-semibold text-slate-600">Restricted to Coordinator</span>
                                                <span class="text-[9px] text-slate-400 leading-tight">Anti-falsification restricted for S.A.</span>
                                            </div>
                                        </div>

                                        <!-- Decision Checkboxes & Reason/Remarks -->
                                        <div class="space-y-1.5 pt-1 border-t border-slate-200/80">
                                            <div class="flex items-center justify-between text-[11px]">
                                                <label class="inline-flex items-center gap-1 cursor-not-allowed">
                                                    <input type="checkbox" :checked="form.coordinatorDecision === 'APPROVED'" disabled
                                                           class="rounded border-slate-300 text-emerald-600 h-3.5 w-3.5" />
                                                    <span :class="form.coordinatorDecision === 'APPROVED' ? 'font-bold text-emerald-700' : 'text-slate-600'">Approved</span>
                                                </label>
                                                <label class="inline-flex items-center gap-1 cursor-not-allowed">
                                                    <input type="checkbox" :checked="form.coordinatorDecision === 'NOT_APPROVED'" disabled
                                                           class="rounded border-slate-300 text-rose-600 h-3.5 w-3.5" />
                                                    <span :class="form.coordinatorDecision === 'NOT_APPROVED' ? 'font-bold text-rose-700' : 'text-slate-600'">Not Approved</span>
                                                </label>
                                            </div>
                                            <div v-if="form.coordinatorDecision === 'NOT_APPROVED' || form.coordinatorRemarks"
                                                 class="rounded bg-rose-50 border border-rose-200 p-1.5 text-[10px] text-rose-900">
                                                <span class="font-bold block">Disapproval Reason / Remarks:</span>
                                                {{ form.coordinatorRemarks || 'No reason provided.' }}
                                            </div>
                                            <div>
                                                <label class="block text-[10px] font-bold uppercase text-slate-500">Coordinator Name</label>
                                                <input type="text" :value="form.coordinatorName || saContext.coordinatorName || 'Ansherina A Sudario'" disabled
                                                       class="w-full rounded border border-slate-200 bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700 cursor-not-allowed" />
                                            </div>
                                            <div class="flex items-center justify-between text-[11px]">
                                                <span class="text-slate-500">Date Signed:</span>
                                                <span class="font-semibold text-slate-700">{{ form.coordinatorSignDate ? formatShortDate(form.coordinatorSignDate) : 'Pending Recording' }}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Accuracy Checkbox & Footer Buttons -->
                            <div class="pt-2 space-y-4">
                                <label class="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer select-none">
                                    <input type="checkbox" v-model="form.confirmAccurate"
                                           class="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                                    <span>I confirm that the details provided are accurate. <span class="text-danger">*</span></span>
                                </label>

                                <div class="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
                                    <button type="button" @click="goToStep(2)"
                                            class="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-5 py-2.5 text-xs font-semibold text-slate-700 transition-colors">
                                        <app-icon name="ArrowLeft" :size="14" />
                                        <span>Back to Supporting Attachment</span>
                                    </button>
                                    <div class="flex items-center gap-2">
                                        <button v-if="form.mode !== 'resubmit'" type="button"
                                                @click="saveRequest(false)" :disabled="submitting"
                                                class="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-700 transition-colors">
                                            Save Draft
                                        </button>
                                        <button type="button"
                                                @click="saveRequest(true)" :disabled="submitting"
                                                class="inline-flex items-center gap-2 rounded-lg bg-[#0f2557] hover:bg-navy-700 px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors">
                                            <span>{{ form.mode === 'resubmit' ? 'Resubmit OT Request' : 'Submit OT Request' }}</span>
                                            <app-icon name="ArrowRight" :size="14" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Right Column Sidebar (Overtime Form) -->
                    <div class="lg:col-span-4 space-y-5">
                        <div class="card p-5">
                            <div class="flex items-center gap-2 text-sm font-bold text-[#0f2557] mb-4">
                                <app-icon name="CheckCircle2" :size="18" class="text-blue-600" />
                                <span>Approval Flow</span>
                            </div>

                            <div class="relative pl-3 space-y-5 before:absolute before:left-[19px] before:top-3 before:bottom-3 before:w-0.5 before:bg-blue-100">
                                <div class="relative flex items-start gap-3">
                                    <span class="relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#0f2557] text-xs font-bold text-white shadow-xs">1</span>
                                    <div>
                                        <p class="text-xs font-bold text-[#0f2557]">1. S.A. Filing</p>
                                        <p class="text-[11px] text-slate-500 mt-0.5">S.A. submits request with details &amp; e-signature.</p>
                                    </div>
                                </div>
                                <div class="relative flex items-start gap-3">
                                    <span class="relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#0f2557] text-xs font-bold text-white shadow-xs">2</span>
                                    <div>
                                        <p class="text-xs font-bold text-[#0f2557]">2. Supervisor Review &amp; Approval</p>
                                        <p class="text-[11px] text-slate-500 mt-0.5">Immediate Supervisor reviews, verifies schedule, and signs decision.</p>
                                    </div>
                                </div>
                                <div class="relative flex items-start gap-3">
                                    <span class="relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#0f2557] text-xs font-bold text-white shadow-xs">3</span>
                                    <div>
                                        <p class="text-xs font-bold text-[#0f2557]">3. Coordinator Review &amp; Final Approval</p>
                                        <p class="text-[11px] text-slate-500 mt-0.5">S.A. Coordinator performs final validation and signs approval.</p>
                                    </div>
                                </div>
                            </div>

                            <div class="mt-5 rounded-xl bg-blue-50/80 border border-blue-100 p-3 flex items-start gap-2.5 text-[11px] text-blue-800">
                                <app-icon name="Info" :size="15" class="text-blue-600 shrink-0 mt-0.5" />
                                <span>Submission does not mean automatic approval. Request must complete all review stages.</span>
                            </div>
                        </div>

                        <div class="card p-5 space-y-4">
                            <div class="flex items-center gap-2 text-sm font-bold text-[#0f2557]">
                                <app-icon name="CheckSquare" :size="18" class="text-blue-600" />
                                <span>Before You Submit</span>
                            </div>

                            <ul class="space-y-2.5 text-xs text-slate-600">
                                <li class="flex items-start gap-2">
                                    <app-icon name="Check" :size="14" class="text-blue-600 shrink-0 mt-0.5" />
                                    <span>Make sure you filled out all required fields.</span>
                                </li>
                                <li class="flex items-start gap-2">
                                    <app-icon name="Check" :size="14" class="text-blue-600 shrink-0 mt-0.5" />
                                    <span>Attach supporting documents (if any).</span>
                                </li>
                                <li class="flex items-start gap-2">
                                    <app-icon name="Check" :size="14" class="text-blue-600 shrink-0 mt-0.5" />
                                    <span>Check the total hours and time range.</span>
                                </li>
                                <li class="flex items-start gap-2">
                                    <app-icon name="Check" :size="14" class="text-blue-600 shrink-0 mt-0.5" />
                                    <span>Ensure all information is accurate and complete.</span>
                                </li>
                            </ul>
                        </div>

                        <div class="card p-5 flex items-start gap-3">
                            <div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-[#0f2557] text-white">
                                <app-icon name="Lock" :size="16" />
                            </div>
                            <div>
                                <p class="text-xs font-bold text-[#0f2557]">Your information is secure.</p>
                                <p class="text-[11px] text-slate-500 mt-0.5">
                                    Documents and personal data are kept confidential and accessible only to authorized personnel.
                                </p>
                            </div>
                        </div>
                    </div>
                </template>

                <!-- ================================================================= -->
                <!-- FORM 3: UNDERTIME FORM                                            -->
                <!-- ================================================================= -->
                <template v-else-if="form.requestType === 'UNDERTIME'">
                    <!-- Left Column (Single Multi-Step Card) -->
                    <div class="lg:col-span-8 card p-6 space-y-6">

                        <!-- STEP 1: Student Information & Undertime Details -->
                        <div v-show="formStep === 1" class="space-y-6">
                            <!-- Top Info Banner -->
                            <div class="rounded-xl bg-blue-50/80 border border-blue-100 p-3.5 flex items-start gap-2.5 text-xs text-blue-900">
                                <app-icon name="Info" :size="16" class="text-blue-600 shrink-0 mt-0.5" />
                                <span>This form is for reporting an undertime incident. It will be reviewed by your Immediate Supervisor and/or S.A. Coordinator based on the institution's policy.</span>
                            </div>

                            <!-- Student Information -->
                            <div class="rounded-xl border border-slate-200 p-5">
                                <div class="flex items-center gap-2 text-sm font-bold text-[#0f2557] mb-4">
                                    <app-icon name="Users" :size="18" class="text-blue-600" />
                                    <span>Student Information</span>
                                </div>

                                <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label class="block text-xs font-semibold text-slate-700 mb-1.5">
                                            Student Assistant Name <span class="text-danger">*</span>
                                        </label>
                                        <div class="relative">
                                            <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                                                <app-icon name="User" :size="15" />
                                            </span>
                                            <input type="text" :value="saContext.fullName || Store.user?.name || ''" disabled
                                                   class="w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 py-2.5 text-xs font-medium text-slate-700" />
                                        </div>
                                    </div>

                                    <div>
                                        <label class="block text-xs font-semibold text-slate-700 mb-1.5">
                                            SAES No. <span class="text-danger">*</span>
                                        </label>
                                        <input type="text" :value="displaySaesNo" disabled
                                               class="w-full rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs font-medium text-slate-600" />
                                    </div>

                                    <div>
                                        <label class="block text-xs font-semibold text-slate-700 mb-1.5 flex items-center justify-between">
                                            <span>Department <span class="text-danger">*</span></span>
                                            <span class="text-[10px] text-slate-400 font-normal">Auto-assigned</span>
                                        </label>
                                        <div class="relative">
                                            <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                                                <app-icon name="Building2" :size="15" />
                                            </span>
                                            <input type="text" :value="displayDepartment" disabled
                                                   class="w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 py-2.5 text-xs font-medium text-slate-700 cursor-not-allowed" />
                                        </div>
                                    </div>

                                    <div>
                                        <label class="block text-xs font-semibold text-slate-700 mb-1.5">
                                            Date Filed <span class="text-danger">*</span>
                                        </label>
                                        <input v-model="form.dateFiled" type="date"
                                               class="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none" />
                                    </div>
                                </div>
                            </div>

                            <!-- Undertime Details -->
                            <div class="rounded-xl border border-slate-200 p-5 space-y-4">
                                <div class="flex items-center gap-2 text-sm font-bold text-[#0f2557]">
                                    <app-icon name="Clock" :size="18" class="text-blue-600" />
                                    <span>Undertime Details</span>
                                </div>

                                <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                    <div>
                                        <label class="block text-xs font-semibold text-slate-700 mb-1.5">
                                            Date of Undertime <span class="text-danger">*</span>
                                        </label>
                                        <input v-model="form.requestDate" @change="matchDutyShiftForDate(form.requestDate)" type="date"
                                               class="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none" />
                                    </div>

                                    <div>
                                        <label class="block text-xs font-semibold text-slate-700 mb-1.5">
                                            {{ form.undertimeType === 'Late Arrival' ? 'Actual Time In' : 'Actual Time Out' }} <span class="text-danger">*</span>
                                        </label>
                                        <input v-model="form.actualTime" type="time"
                                               class="w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none" />
                                    </div>

                                    <div>
                                        <label class="block text-xs font-semibold text-slate-700 mb-1.5">
                                            Reason <span class="text-danger">*</span>
                                        </label>
                                        <select v-model="form.reasonCategory"
                                                class="w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-medium text-slate-700 focus:border-blue-600 focus:outline-none">
                                            <option value="" disabled>Select reason</option>
                                            <option v-for="r in undertimeReasons" :key="r" :value="r">{{ r }}</option>
                                        </select>
                                    </div>
                                </div>

                                <!-- Type of Undertime Radio Buttons -->
                                <div>
                                    <label class="block text-xs font-semibold text-slate-700 mb-2">
                                        Type of Undertime <span class="text-danger">*</span>
                                    </label>
                                    <div class="flex flex-wrap items-center gap-6">
                                        <label class="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                                            <input type="radio" v-model="form.undertimeType" value="Early Departure"
                                                   class="h-4 w-4 text-blue-600 focus:ring-blue-500" />
                                            <span>Early departure</span>
                                        </label>
                                        <label class="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                                            <input type="radio" v-model="form.undertimeType" value="Late Arrival"
                                                   class="h-4 w-4 text-blue-600 focus:ring-blue-500" />
                                            <span>Late arrival</span>
                                        </label>
                                        <label class="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                                            <input type="radio" v-model="form.undertimeType" value="Other"
                                                   class="h-4 w-4 text-blue-600 focus:ring-blue-500" />
                                            <span>Other (please specify)</span>
                                        </label>
                                    </div>
                                </div>

                                <!-- Additional details (optional) -->
                                <div>
                                    <label class="block text-xs font-semibold text-slate-700 mb-1.5">
                                        Additional details (optional)
                                    </label>
                                    <textarea v-model="form.notes" rows="3" maxlength="300"
                                              placeholder="e.g., reason, destination, etc."
                                              class="w-full rounded-lg border border-slate-200 p-3 text-xs text-slate-700 focus:border-blue-600 focus:outline-none"></textarea>
                                    <div class="mt-1 text-right text-[11px] text-slate-400">
                                        {{ (form.notes || '').length }}/300
                                    </div>
                                </div>
                            </div>

                            <!-- Step 1 Footer Buttons -->
                            <div class="flex items-center justify-between gap-3 pt-4 border-t border-slate-100">
                                <button v-if="form.mode !== 'resubmit'" type="button"
                                        @click="saveRequest(false)" :disabled="submitting"
                                        class="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-5 py-2.5 text-xs font-semibold text-slate-700 transition-colors">
                                    Save Draft
                                </button>
                                <div v-else></div>
                                <button type="button" @click="goToStep(2)"
                                        class="inline-flex items-center gap-2 rounded-lg bg-[#0f2557] hover:bg-navy-700 px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors">
                                    <span>Next: Supporting Proof</span>
                                    <app-icon name="ArrowRight" :size="14" />
                                </button>
                            </div>
                        </div>

                        <!-- STEP 2: Supporting Document (Optional) -->
                        <div v-show="formStep === 2" class="space-y-6">
                            <div class="rounded-xl border border-slate-200 p-5">
                                <div class="flex items-center gap-2 text-sm font-bold text-[#0f2557] mb-1">
                                    <app-icon name="Paperclip" :size="18" class="text-blue-600" />
                                    <span>Supporting Document <span class="font-normal text-slate-400 text-xs">(Optional)</span></span>
                                </div>
                                <p class="text-xs text-slate-500 mb-4">
                                    Attach supporting documentation or permission slip explaining your undertime (optional).
                                </p>

                                <div class="grid grid-cols-1 md:grid-cols-12 gap-4 items-stretch">
                                    <div class="md:col-span-6 rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/30 p-6 flex flex-col items-center justify-center text-center"
                                         @dragover.prevent @drop="handleDropFile">
                                        <app-icon name="UploadCloud" :size="26" class="text-blue-600 mb-2" />
                                        <p class="text-xs font-bold text-[#0f2557]">Upload Letter / Proof</p>
                                        <p class="text-[11px] text-slate-500 mt-0.5">(Optional: e.g. permission slip, medical certificate, etc.)</p>
                                        <button type="button" @click="triggerFileInput"
                                                class="mt-3 rounded-lg bg-[#0f2557] hover:bg-navy-700 px-5 py-2 text-xs font-semibold text-white shadow-sm">
                                            Choose File
                                        </button>
                                        <p class="mt-2.5 text-[10px] text-slate-400">
                                            Accepted formats: PDF, JPG, PNG, WEBP (Max 5MB)
                                        </p>
                                    </div>

                                    <div class="md:col-span-6 flex flex-col justify-between space-y-3">
                                        <div>
                                            <span class="block text-xs font-semibold text-slate-700 mb-1.5">Uploaded File</span>
                                            <div v-if="form.proofFileName"
                                                 class="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                                                <div class="flex items-center gap-2.5 min-w-0">
                                                    <app-icon name="FileText" :size="16" class="text-blue-600 shrink-0" />
                                                    <span class="truncate text-xs font-semibold text-[#0f2557]">{{ form.proofFileName }}</span>
                                                    <span v-if="form.proofSizeBytes" class="text-[11px] text-slate-400">({{ formatBytes(form.proofSizeBytes) }})</span>
                                                </div>
                                                <button type="button" @click="clearUploadedProof" class="text-xs text-danger hover:underline ml-2">Remove</button>
                                            </div>
                                            <div v-else class="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-400 italic">
                                                No file attached yet (optional).
                                            </div>
                                        </div>

                                        <div class="rounded-xl bg-blue-50/70 border border-blue-100 p-3 text-[11px] text-blue-900">
                                            <div class="flex items-center gap-1.5 font-semibold text-blue-800 mb-1">
                                                <app-icon name="Info" :size="13" />
                                                <span>Undertime document guidance:</span>
                                            </div>
                                            <p class="text-blue-700 leading-relaxed">
                                                Supporting proof is optional. You may attach medical certificates, academic appointment slips, or written authorization if available.
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Step 2 Footer Buttons -->
                            <div class="flex items-center justify-between gap-3 pt-4 border-t border-slate-100">
                                <button type="button" @click="goToStep(1)"
                                        class="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-5 py-2.5 text-xs font-semibold text-slate-700 transition-colors">
                                    <app-icon name="ArrowLeft" :size="14" />
                                    <span>Back to Details</span>
                                </button>
                                <div class="flex items-center gap-2">
                                    <button v-if="form.mode !== 'resubmit'" type="button"
                                            @click="saveRequest(false)" :disabled="submitting"
                                            class="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-700 transition-colors">
                                        Save Draft
                                    </button>
                                    <button type="button" @click="goToStep(3)"
                                            class="inline-flex items-center gap-2 rounded-lg bg-[#0f2557] hover:bg-navy-700 px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors">
                                        <span>Next: Approval &amp; Signatures</span>
                                        <app-icon name="ArrowRight" :size="14" />
                                    </button>
                                </div>
                            </div>
                        </div>

                        <!-- STEP 3: Approval & Signature Area -->
                        <div v-show="formStep === 3" class="space-y-6">
                            <!-- Approval & Signature Area (E-Signature Pads & Role Restrictions) -->
                            <div class="rounded-xl border border-slate-200 p-5 space-y-4">
                                <div class="flex items-center justify-between flex-wrap gap-2">
                                    <div class="flex items-center gap-2 text-sm font-bold text-[#0f2557]">
                                        <app-icon name="ShieldCheck" :size="18" class="text-blue-600" />
                                        <span>Approval &amp; Signature Area</span>
                                    </div>
                                    <span class="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 bg-slate-100 rounded-md px-2 py-0.5 border border-slate-200">
                                        <app-icon name="Shield" :size="12" class="text-blue-600" /> Multi-Stage Role Gated
                                    </span>
                                </div>

                                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                                    <!-- Col 1: Student Assistant Signature -->
                                    <div class="rounded-xl border border-slate-200 bg-white p-3.5 flex flex-col justify-between space-y-3 shadow-xs">
                                        <div class="flex items-center justify-between">
                                            <span class="font-bold text-slate-800 uppercase tracking-wider text-[11px]">1. Student Assistant</span>
                                            <div class="flex items-center gap-1.5">
                                                <button type="button" @click="adoptSaElectronicSignature"
                                                        class="text-[10px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded px-1.5 py-0.5 transition-colors">
                                                    Adopt E-Sig
                                                </button>
                                                <button type="button" @click="clearSaSignature"
                                                        class="text-[10px] font-bold text-rose-600 hover:text-rose-800 hover:underline">
                                                    Clear
                                                </button>
                                            </div>
                                        </div>

                                        <!-- Drawing Canvas -->
                                        <div class="relative overflow-hidden rounded-lg border border-slate-300 bg-white shadow-inner">
                                            <canvas ref="saCanvasRef" width="380" height="100" class="h-24 w-full cursor-crosshair" style="touch-action: none;"></canvas>
                                            <div v-if="!form.saSignature" class="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] text-slate-400 font-medium">
                                                Draw signature with mouse or touch
                                            </div>
                                        </div>

                                        <!-- Sub-Fields: Name & Date -->
                                        <div class="space-y-1.5 pt-1 border-t border-slate-100">
                                            <div>
                                                <label class="block text-[10px] font-bold uppercase text-slate-500">Student Assistant Name</label>
                                                <input type="text" :value="saContext.fullName || Store.user?.name || form.saName || 'Student Assistant'" disabled
                                                       class="w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700 cursor-not-allowed" />
                                            </div>
                                            <div class="flex items-center justify-between text-[11px]">
                                                <span class="text-slate-500">Date Signed:</span>
                                                <span class="font-semibold text-slate-700">{{ formatShortDate(form.saSignDate || form.dateFiled || todayIso()) }}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <!-- Col 2: Immediate Supervisor Signature -->
                                    <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 flex flex-col justify-between space-y-3">
                                        <div class="flex items-center justify-between">
                                            <span class="font-bold text-slate-800 uppercase tracking-wider text-[11px]">2. Immediate Supervisor</span>
                                            <span class="rounded bg-amber-100 border border-amber-200 px-1.5 py-0.2 text-[9px] font-bold text-amber-800">Stage 1</span>
                                        </div>

                                        <!-- Locked E-Signature Pad / Rendered Signature -->
                                        <div class="relative overflow-hidden rounded-lg border border-slate-200 bg-white h-24 flex items-center justify-center p-2">
                                            <img v-if="form.supervisorSignature" :src="form.supervisorSignature" class="max-h-full max-w-full object-contain" alt="Supervisor Signature" />
                                            <div v-else class="flex flex-col items-center justify-center text-center p-2 text-slate-400 select-none">
                                                <app-icon name="Lock" :size="16" class="text-slate-400 mb-0.5" />
                                                <span class="text-[11px] font-semibold text-slate-600">Restricted to Supervisor</span>
                                                <span class="text-[9px] text-slate-400 leading-tight">Anti-falsification restricted for S.A.</span>
                                            </div>
                                        </div>

                                        <!-- Decision Checkboxes & Reason/Remarks -->
                                        <div class="space-y-1.5 pt-1 border-t border-slate-200/80">
                                            <div class="flex items-center justify-between text-[11px]">
                                                <label class="inline-flex items-center gap-1 cursor-not-allowed">
                                                    <input type="checkbox" :checked="form.supervisorDecision === 'APPROVED'" disabled
                                                           class="rounded border-slate-300 text-emerald-600 h-3.5 w-3.5" />
                                                    <span :class="form.supervisorDecision === 'APPROVED' ? 'font-bold text-emerald-700' : 'text-slate-600'">Approved</span>
                                                </label>
                                                <label class="inline-flex items-center gap-1 cursor-not-allowed">
                                                    <input type="checkbox" :checked="form.supervisorDecision === 'NOT_APPROVED'" disabled
                                                           class="rounded border-slate-300 text-rose-600 h-3.5 w-3.5" />
                                                    <span :class="form.supervisorDecision === 'NOT_APPROVED' ? 'font-bold text-rose-700' : 'text-slate-600'">Not Approved</span>
                                                </label>
                                            </div>
                                            <div v-if="form.supervisorDecision === 'NOT_APPROVED' || form.supervisorRemarks"
                                                 class="rounded bg-rose-50 border border-rose-200 p-1.5 text-[10px] text-rose-900">
                                                <span class="font-bold block">Disapproval Reason / Remarks:</span>
                                                {{ form.supervisorRemarks || 'No reason provided.' }}
                                            </div>
                                            <div>
                                                <label class="block text-[10px] font-bold uppercase text-slate-500">Supervisor Name</label>
                                                <input type="text" :value="form.supervisorName || saContext.supervisorName || 'Assigned Immediate Supervisor'" disabled
                                                       class="w-full rounded border border-slate-200 bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700 cursor-not-allowed" />
                                            </div>
                                            <div class="flex items-center justify-between text-[11px]">
                                                <span class="text-slate-500">Date Signed:</span>
                                                <span class="font-semibold text-slate-700">{{ form.supervisorSignDate ? formatShortDate(form.supervisorSignDate) : 'Pending Review' }}</span>
                                            </div>
                                        </div>
                                    </div>

                                    <!-- Col 3: S.A Coordinator Signature -->
                                    <div class="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 flex flex-col justify-between space-y-3">
                                        <div class="flex items-center justify-between">
                                            <span class="font-bold text-slate-800 uppercase tracking-wider text-[11px]">3. S.A. Coordinator</span>
                                            <span class="rounded bg-blue-100 border border-blue-200 px-1.5 py-0.2 text-[9px] font-bold text-blue-800">Final Stage</span>
                                        </div>

                                        <!-- Locked E-Signature Pad / Rendered Signature -->
                                        <div class="relative overflow-hidden rounded-lg border border-slate-200 bg-white h-24 flex items-center justify-center p-2">
                                            <img v-if="form.coordinatorSignature" :src="form.coordinatorSignature" class="max-h-full max-w-full object-contain" alt="Coordinator Signature" />
                                            <div v-else class="flex flex-col items-center justify-center text-center p-2 text-slate-400 select-none">
                                                <app-icon name="Lock" :size="16" class="text-slate-400 mb-0.5" />
                                                <span class="text-[11px] font-semibold text-slate-600">Restricted to Coordinator</span>
                                                <span class="text-[9px] text-slate-400 leading-tight">Anti-falsification restricted for S.A.</span>
                                            </div>
                                        </div>

                                        <!-- Decision Checkboxes & Reason/Remarks -->
                                        <div class="space-y-1.5 pt-1 border-t border-slate-200/80">
                                            <div class="flex items-center justify-between text-[11px]">
                                                <label class="inline-flex items-center gap-1 cursor-not-allowed">
                                                    <input type="checkbox" :checked="form.coordinatorDecision === 'APPROVED'" disabled
                                                           class="rounded border-slate-300 text-emerald-600 h-3.5 w-3.5" />
                                                    <span :class="form.coordinatorDecision === 'APPROVED' ? 'font-bold text-emerald-700' : 'text-slate-600'">Approved</span>
                                                </label>
                                                <label class="inline-flex items-center gap-1 cursor-not-allowed">
                                                    <input type="checkbox" :checked="form.coordinatorDecision === 'NOT_APPROVED'" disabled
                                                           class="rounded border-slate-300 text-rose-600 h-3.5 w-3.5" />
                                                    <span :class="form.coordinatorDecision === 'NOT_APPROVED' ? 'font-bold text-rose-700' : 'text-slate-600'">Not Approved</span>
                                                </label>
                                            </div>
                                            <div v-if="form.coordinatorDecision === 'NOT_APPROVED' || form.coordinatorRemarks"
                                                 class="rounded bg-rose-50 border border-rose-200 p-1.5 text-[10px] text-rose-900">
                                                <span class="font-bold block">Disapproval Reason / Remarks:</span>
                                                {{ form.coordinatorRemarks || 'No reason provided.' }}
                                            </div>
                                            <div>
                                                <label class="block text-[10px] font-bold uppercase text-slate-500">Coordinator Name</label>
                                                <input type="text" :value="form.coordinatorName || saContext.coordinatorName || 'Ansherina A Sudario'" disabled
                                                       class="w-full rounded border border-slate-200 bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-700 cursor-not-allowed" />
                                            </div>
                                            <div class="flex items-center justify-between text-[11px]">
                                                <span class="text-slate-500">Date Signed:</span>
                                                <span class="font-semibold text-slate-700">{{ form.coordinatorSignDate ? formatShortDate(form.coordinatorSignDate) : 'Pending Recording' }}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Accuracy Checkbox & Footer Buttons -->
                            <div class="pt-2 space-y-4">
                                <label class="flex items-center gap-2.5 text-xs text-slate-700 cursor-pointer select-none">
                                    <input type="checkbox" v-model="form.confirmAccurate"
                                           class="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500" />
                                    <span>I confirm that the details provided are accurate. <span class="text-danger">*</span></span>
                                </label>

                                <div class="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-100">
                                    <button type="button" @click="goToStep(2)"
                                            class="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-5 py-2.5 text-xs font-semibold text-slate-700 transition-colors">
                                        <app-icon name="ArrowLeft" :size="14" />
                                        <span>Back to Supporting Document</span>
                                    </button>
                                    <div class="flex items-center gap-2">
                                        <button v-if="form.mode !== 'resubmit'" type="button"
                                                @click="saveRequest(false)" :disabled="submitting"
                                                class="rounded-lg border border-slate-300 bg-white hover:bg-slate-50 px-4 py-2.5 text-xs font-semibold text-slate-700 transition-colors">
                                            Save Draft
                                        </button>
                                        <button type="button"
                                                @click="saveRequest(true)" :disabled="submitting"
                                                class="inline-flex items-center gap-2 rounded-lg bg-[#0f2557] hover:bg-navy-700 px-5 py-2.5 text-xs font-semibold text-white shadow-sm transition-colors">
                                            <app-icon name="Send" :size="14" />
                                            <span>{{ form.mode === 'resubmit' ? 'Resubmit Undertime Request' : 'Submit Undertime Request' }}</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Right Column Sidebar (Undertime Form) -->
                    <div class="lg:col-span-4 space-y-5">
                        <!-- Approval Flow Card -->
                        <div class="card p-5">
                            <div class="flex items-center gap-2 text-sm font-bold text-[#0f2557] mb-4">
                                <app-icon name="CheckCircle2" :size="18" class="text-blue-600" />
                                <span>Approval Flow</span>
                            </div>

                            <div class="relative pl-3 space-y-5 before:absolute before:left-[19px] before:top-3 before:bottom-3 before:w-0.5 before:bg-blue-100">
                                <div class="relative flex items-start gap-3">
                                    <span class="relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#0f2557] text-xs font-bold text-white shadow-xs">1</span>
                                    <div>
                                        <p class="text-xs font-bold text-[#0f2557]">1. S.A. Filing</p>
                                        <p class="text-[11px] text-slate-500 mt-0.5">S.A. submits request with details &amp; e-signature.</p>
                                    </div>
                                </div>
                                <div class="relative flex items-start gap-3">
                                    <span class="relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#0f2557] text-xs font-bold text-white shadow-xs">2</span>
                                    <div>
                                        <p class="text-xs font-bold text-[#0f2557]">2. Supervisor Review &amp; Approval</p>
                                        <p class="text-[11px] text-slate-500 mt-0.5">Immediate Supervisor reviews, verifies schedule, and signs decision.</p>
                                    </div>
                                </div>
                                <div class="relative flex items-start gap-3">
                                    <span class="relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#0f2557] text-xs font-bold text-white shadow-xs">3</span>
                                    <div>
                                        <p class="text-xs font-bold text-[#0f2557]">3. Coordinator Review &amp; Final Approval</p>
                                        <p class="text-[11px] text-slate-500 mt-0.5">S.A. Coordinator performs final validation and signs approval.</p>
                                    </div>
                                </div>
                            </div>

                            <div class="mt-5 rounded-xl bg-blue-50/80 border border-blue-100 p-3 flex items-start gap-2.5 text-[11px] text-blue-800">
                                <app-icon name="Info" :size="15" class="text-blue-600 shrink-0 mt-0.5" />
                                <span>Submission does not mean automatic approval. Request must complete all review stages.</span>
                            </div>
                        </div>

                        <!-- Before you submit Card -->
                        <div class="card p-5 space-y-4">
                            <div class="flex items-center gap-2 text-sm font-bold text-[#0f2557]">
                                <app-icon name="CheckSquare" :size="18" class="text-blue-600" />
                                <span>Before you submit</span>
                            </div>

                            <ul class="space-y-2.5 text-xs text-slate-600">
                                <li class="flex items-start gap-2">
                                    <app-icon name="Check" :size="14" class="text-blue-600 shrink-0 mt-0.5" />
                                    <span>Verify the <strong>date of undertime</strong> and shift.</span>
                                </li>
                                <li class="flex items-start gap-2">
                                    <app-icon name="Check" :size="14" class="text-blue-600 shrink-0 mt-0.5" />
                                    <span>Select the appropriate <strong>reason and undertime type</strong>.</span>
                                </li>
                                <li class="flex items-start gap-2">
                                    <app-icon name="Check" :size="14" class="text-blue-600 shrink-0 mt-0.5" />
                                    <span>Attach supporting documents if available (optional).</span>
                                </li>
                                <li class="flex items-start gap-2">
                                    <app-icon name="Check" :size="14" class="text-blue-600 shrink-0 mt-0.5" />
                                    <span>Ensure all information is accurate and complete.</span>
                                </li>
                            </ul>

                            <div class="pt-3 border-t border-slate-100 flex items-start gap-3">
                                <div class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#0f2557] text-white">
                                    <app-icon name="Lock" :size="15" />
                                </div>
                                <div>
                                    <p class="text-xs font-bold text-[#0f2557]">Your information is secure.</p>
                                    <p class="text-[11px] text-slate-500 mt-0.5">
                                        Documents and personal data are kept confidential and accessible only to authorized personnel.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </template>
            </div>
        </div>

        <!-- ========================================================================= -->
        <!-- VIEW 2: MY REQUESTS DASHBOARD & HISTORY TABLE                             -->
        <!-- ========================================================================= -->
        <div v-else>
            <page-header title="My Requests"
                         subtitle="Submit Excuse Slips, Overtime Authorization Forms, and Undertime Forms to your Immediate Supervisor and track Coordinator verification.">
                <template #actions>
                    <button @click="loadData" :disabled="loading" class="btn btn-secondary btn-sm">
                        <app-icon name="RefreshCw" :size="15" /> Refresh
                    </button>
                    <button @click="openNewRequestPicker" class="btn btn-primary btn-sm">
                        <app-icon name="Plus" :size="16" /> New Request
                    </button>
                </template>
            </page-header>

            <!-- Summary Cards -->
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
                <button @click="filterStatus = ''"
                        class="card p-4 text-left transition-all"
                        :class="filterStatus === '' ? 'ring-2 ring-navy border-navy' : 'hover:border-navy/40'">
                    <div class="flex items-center justify-between">
                        <span class="text-caption font-medium text-muted">Total Requests</span>
                        <span class="grid h-8 w-8 place-items-center rounded-lg bg-mist text-navy">
                            <app-icon name="Inbox" :size="16" />
                        </span>
                    </div>
                    <p class="mt-2 text-2xl font-bold text-ink">{{ summary.total || 0 }}</p>
                    <p class="mt-0.5 text-[11px] text-muted">All submitted &amp; draft forms</p>
                </button>

                <button @click="filterStatus = 'PENDING_SUPERVISOR_REVIEW'"
                        class="card p-4 text-left transition-all"
                        :class="filterStatus === 'PENDING_SUPERVISOR_REVIEW' ? 'ring-2 ring-warning border-warning' : 'hover:border-warning/40'">
                    <div class="flex items-center justify-between">
                        <span class="text-caption font-medium text-muted">Pending Review</span>
                        <span class="grid h-8 w-8 place-items-center rounded-lg bg-warning/10 text-warning">
                            <app-icon name="Clock" :size="16" />
                        </span>
                    </div>
                    <p class="mt-2 text-2xl font-bold text-warning">{{ (summary.pendingSupervisorReview || 0) + (summary.pendingCoordinatorRecording || 0) }}</p>
                    <p class="mt-0.5 text-[11px] text-muted">{{ summary.pendingSupervisorReview || 0 }} Supervisor · {{ summary.pendingCoordinatorRecording || 0 }} Coordinator</p>
                </button>

                <button @click="filterStatus = 'RETURNED_TO_SA'"
                        class="card p-4 text-left transition-all"
                        :class="filterStatus === 'RETURNED_TO_SA' ? 'ring-2 ring-warning border-warning' : 'hover:border-warning/40'">
                    <div class="flex items-center justify-between">
                        <span class="text-caption font-medium text-muted">Needs Correction</span>
                        <span class="grid h-8 w-8 place-items-center rounded-lg bg-warning/15 text-warning">
                            <app-icon name="RotateCcw" :size="16" />
                        </span>
                    </div>
                    <p class="mt-2 text-2xl font-bold text-warning">{{ summary.returnedToSa || 0 }}</p>
                    <p class="mt-0.5 text-[11px] text-muted">Returned by Immediate Supervisor</p>
                </button>

                <button @click="filterStatus = 'RECORDED'"
                        class="card p-4 text-left transition-all"
                        :class="filterStatus === 'RECORDED' ? 'ring-2 ring-success border-success' : 'hover:border-success/40'">
                    <div class="flex items-center justify-between">
                        <span class="text-caption font-medium text-muted">Verified &amp; Recorded</span>
                        <span class="grid h-8 w-8 place-items-center rounded-lg bg-success/10 text-success">
                            <app-icon name="CheckCircle2" :size="16" />
                        </span>
                    </div>
                    <p class="mt-2 text-2xl font-bold text-success">{{ summary.recorded || 0 }}</p>
                    <p class="mt-0.5 text-[11px] text-muted">Officially recorded by Coordinator</p>
                </button>
            </div>

            <!-- Quick Request Type Launcher Cards -->
            <div class="grid grid-cols-1 gap-4 md:grid-cols-3 mb-6">
                <div class="card p-4 flex flex-col justify-between">
                    <div>
                        <div class="flex items-center gap-2.5">
                            <span class="grid h-9 w-9 place-items-center rounded-lg bg-info/10 text-info">
                                <app-icon name="FileText" :size="18" />
                            </span>
                            <div>
                                <h3 class="text-[14px] font-semibold text-ink">Student Assistant Excuse Slip</h3>
                                <p class="text-[11px] text-muted">Single-day or multi-day duty absence</p>
                            </div>
                        </div>
                        <p class="mt-2.5 text-caption text-muted">
                            Submit your excuse slip with From/To dates, Excuse Code checklist, explanation, and optional supporting proof.
                        </p>
                    </div>
                    <div class="mt-3 pt-3 border-t border-line flex items-center justify-between">
                        <span class="text-[11px] font-medium text-muted">Proof Optional</span>
                        <button @click="startNewRequest('EXCUSE_SLIP')" class="btn btn-primary btn-sm">
                            <app-icon name="Plus" :size="14" /> Open Excuse Slip
                        </button>
                    </div>
                </div>

                <div class="card p-4 flex flex-col justify-between">
                    <div>
                        <div class="flex items-center gap-2.5">
                            <span class="grid h-9 w-9 place-items-center rounded-lg bg-navy/10 text-navy">
                                <app-icon name="Clock" :size="18" />
                            </span>
                            <div>
                                <h3 class="text-[14px] font-semibold text-ink">Overtime Authorization Form</h3>
                                <p class="text-[11px] text-muted">Extended duty hours schedule</p>
                            </div>
                        </div>
                        <p class="mt-2.5 text-caption text-muted">
                            Multi-row overtime schedule with task to accomplish, regular time, O.T. time, auto-computed hours, and justification.
                        </p>
                    </div>
                    <div class="mt-3 pt-3 border-t border-line flex items-center justify-between">
                        <span class="text-[11px] font-medium text-muted">Proof Optional</span>
                        <button @click="startNewRequest('OVERTIME')" class="btn btn-primary btn-sm">
                            <app-icon name="Plus" :size="14" /> Open OT Form
                        </button>
                    </div>
                </div>

                <div class="card p-4 flex flex-col justify-between">
                    <div>
                        <div class="flex items-center gap-2.5">
                            <span class="grid h-9 w-9 place-items-center rounded-lg bg-warning/15 text-warning">
                                <app-icon name="Hourglass" :size="18" />
                            </span>
                            <div>
                                <h3 class="text-[14px] font-semibold text-ink">Student Assistant Undertime Form</h3>
                                <p class="text-[11px] text-muted">Early departure or late arrival</p>
                            </div>
                        </div>
                        <p class="mt-2.5 text-caption text-muted">
                            Report an undertime incident (Early departure, Late arrival, or Other) with actual time, reason, and optional supporting document.
                        </p>
                    </div>
                    <div class="mt-3 pt-3 border-t border-line flex items-center justify-between">
                        <span class="text-[11px] font-medium text-muted">Proof Optional</span>
                        <button @click="startNewRequest('UNDERTIME')" class="btn btn-primary btn-sm">
                            <app-icon name="Plus" :size="14" /> Open Undertime Form
                        </button>
                    </div>
                </div>
            </div>

            <!-- Search and Filters -->
            <div class="card p-4 mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div class="relative flex-1 max-w-md">
                    <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
                        <app-icon name="Search" :size="15" />
                    </span>
                    <input v-model.trim="searchQuery" type="text"
                           placeholder="Search by Request ID, type, date, or reason..."
                           class="input pl-9 py-2 text-caption" />
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <select v-model="filterType" class="input w-auto py-2 text-caption">
                        <option value="">All Request Types</option>
                        <option value="EXCUSE_SLIP">Excuse Slip</option>
                        <option value="OVERTIME">Overtime (OT) Form</option>
                        <option value="UNDERTIME">Undertime Form</option>
                    </select>
                    <select v-model="filterStatus" class="input w-auto py-2 text-caption">
                        <option value="">All Statuses</option>
                        <option value="DRAFT">Draft</option>
                        <option value="PENDING_SUPERVISOR_REVIEW">Pending Supervisor Review</option>
                        <option value="RETURNED_TO_SA">Returned for Correction</option>
                        <option value="PENDING_COORDINATOR_RECORDING">Pending Coordinator Recording</option>
                        <option value="RETURNED_FOR_CLARIFICATION">Returned for Clarification</option>
                        <option value="RECORDED">Recorded</option>
                        <option value="REJECTED_BY_SUPERVISOR">Rejected by Supervisor</option>
                    </select>
                    <button v-if="searchQuery || filterType || filterStatus"
                            @click="resetFilters"
                            class="btn btn-ghost btn-sm">
                        Reset
                    </button>
                </div>
            </div>

            <!-- Request History Table -->
            <div class="card overflow-hidden">
                <div v-if="loading" class="p-10 text-center text-muted text-body">
                    Loading your requests...
                </div>

                <div v-else-if="loadError" class="p-10 text-center">
                    <app-icon name="CircleX" :size="28" class="mx-auto text-danger" />
                    <p class="mt-2 text-body font-semibold text-ink">Unable to load requests</p>
                    <p class="mt-1 text-caption text-muted">{{ loadError }}</p>
                </div>

                <div v-else-if="!filteredRequests.length" class="p-12 text-center">
                    <div class="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-mist text-navy">
                        <app-icon name="Inbox" :size="22" />
                    </div>
                    <p class="text-body font-semibold text-ink">No requests found</p>
                    <p class="mt-1 text-caption text-muted max-w-md mx-auto">
                        {{ requests.length ? 'No requests match your current search or status filters.' : 'You have not submitted any Excuse Slip, Overtime Authorization Form, or Undertime Form yet.' }}
                    </p>
                    <button v-if="!requests.length" @click="openNewRequestPicker" class="btn btn-primary btn-sm mt-4">
                        <app-icon name="Plus" :size="15" /> Create Your First Request
                    </button>
                </div>

                <div v-else class="overflow-x-auto">
                    <table class="w-full text-left text-caption">
                        <thead>
                            <tr class="border-b border-line bg-page/60 text-[11px] font-semibold uppercase tracking-wider text-muted">
                                <th class="px-4 py-3">Request ID</th>
                                <th class="px-4 py-3">Request Type</th>
                                <th class="px-4 py-3">Relevant Date</th>
                                <th class="px-4 py-3">Submission Date</th>
                                <th class="px-4 py-3">Status</th>
                                <th class="px-4 py-3 text-right whitespace-nowrap">Available Actions</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-line">
                            <tr v-for="req in filteredRequests" :key="req.id" class="hover:bg-page/50 transition-colors">
                                <td class="px-4 py-3.5 font-mono text-xs font-semibold text-navy">
                                    {{ req.requestCode }}
                                </td>
                                <td class="px-4 py-3.5">
                                    <div class="flex items-center gap-2.5">
                                        <span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg" :class="typeBadgeTone(req.requestType)">
                                            <app-icon :name="typeIcon(req.requestType)" :size="15" />
                                        </span>
                                        <div>
                                            <div class="font-semibold text-ink">{{ label('requestType', req.requestType) }}</div>
                                            <div class="text-[11px] text-muted truncate max-w-[220px]">
                                                <span v-if="req.requestType === 'UNDERTIME' && req.undertimeType">{{ req.undertimeType }} · </span>{{ req.reasonCategory }}
                                            </div>
                                        </div>
                                    </div>
                                </td>
                                <td class="px-4 py-3.5">
                                    <div class="font-medium text-ink">{{ formatRelevantDate(req) }}</div>
                                    <div v-if="req.requestType === 'UNDERTIME' && req.actualTime" class="text-[11px] text-muted">
                                        Actual: {{ formatTime(req.actualTime) }}
                                    </div>
                                    <div v-else-if="req.requestedStart && req.requestedEnd" class="text-[11px] text-muted">
                                        {{ formatTime(req.requestedStart) }} – {{ formatTime(req.requestedEnd) }}
                                        <span v-if="req.hoursAffected">({{ req.hoursAffected }}h)</span>
                                    </div>
                                </td>
                                <td class="px-4 py-3.5 text-muted">
                                    <div>{{ req.submittedAt ? formatDateTime(req.submittedAt) : 'Draft (not submitted)' }}</div>
                                    <div v-if="req.supervisorName" class="text-[11px] text-muted">
                                        Supervisor: {{ req.supervisorName }}
                                    </div>
                                </td>
                                <td class="px-4 py-3.5">
                                    <status-badge group="requestStatus" :value="req.status" />
                                </td>
                                <td class="px-4 py-3.5 text-right whitespace-nowrap">
                                    <div class="inline-flex items-center justify-end gap-1.5 whitespace-nowrap">
                                        <button v-if="req.status === 'DRAFT'"
                                                @click="openEditRequest(req, 'draft')"
                                                class="grid h-8 w-8 place-items-center rounded-lg bg-navy hover:bg-navy-700 text-white shadow-2xs transition-all hover:scale-105 active:scale-95"
                                                title="Edit &amp; Submit Request"
                                                aria-label="Edit &amp; Submit Request">
                                            <app-icon name="FileEdit" :size="15" />
                                        </button>
                                        <button v-if="req.status === 'RETURNED_TO_SA' || req.status === 'RETURNED_FOR_CLARIFICATION'"
                                                @click="openEditRequest(req, 'resubmit')"
                                                class="grid h-8 w-8 place-items-center rounded-lg bg-amber-500 hover:bg-amber-600 text-white shadow-2xs transition-all hover:scale-105 active:scale-95"
                                                title="Correct &amp; Resubmit Request"
                                                aria-label="Correct &amp; Resubmit Request">
                                            <app-icon name="RotateCcw" :size="15" />
                                        </button>
                                        <button @click="openDetails(req)"
                                                class="grid h-8 w-8 place-items-center rounded-lg border border-line bg-white hover:bg-mist/60 text-slate-600 hover:text-navy hover:border-navy/30 transition-all shadow-2xs hover:scale-105 active:scale-95"
                                                title="View Request Details"
                                                aria-label="View Request Details">
                                            <app-icon name="Eye" :size="15" />
                                        </button>
                                        <button v-if="req.status === 'DRAFT'"
                                                @click="deleteDraft(req)"
                                                class="grid h-8 w-8 place-items-center rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-600 hover:text-rose-700 transition-all shadow-2xs hover:scale-105 active:scale-95"
                                                title="Delete Draft Request"
                                                aria-label="Delete Draft Request">
                                            <app-icon name="Trash2" :size="15" />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <!-- Modal: Select Request Type -->
        <app-modal :open="showTypePickerModal" title="Select Request Type"
                   description="Choose the form you want to open and submit to your Immediate Supervisor."
                   icon="Inbox" size="md" @close="showTypePickerModal = false">
            <div class="space-y-3">
                <button @click="startNewRequest('EXCUSE_SLIP')"
                        class="w-full text-left p-4 rounded-xl border border-line hover:border-navy hover:bg-mist/40 transition-all flex items-start gap-3">
                    <span class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-info/10 text-info">
                        <app-icon name="FileText" :size="20" />
                    </span>
                    <div class="flex-1">
                        <div class="flex items-center justify-between">
                            <span class="font-semibold text-ink">1. Student Assistant Excuse Slip</span>
                            <span class="text-[11px] font-medium text-muted">Proof Optional</span>
                        </div>
                        <p class="mt-1 text-caption text-muted">
                            Submit your excuse slip with From/To dates, Excuse Code checklist, explanation, and optional supporting proof.
                        </p>
                    </div>
                </button>

                <button @click="startNewRequest('OVERTIME')"
                        class="w-full text-left p-4 rounded-xl border border-line hover:border-navy hover:bg-mist/40 transition-all flex items-start gap-3">
                    <span class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-navy/10 text-navy">
                        <app-icon name="Clock" :size="20" />
                    </span>
                    <div class="flex-1">
                        <div class="flex items-center justify-between">
                            <span class="font-semibold text-ink">2. Student Assistant Overtime Authorization Form</span>
                            <span class="text-[11px] font-medium text-muted">Proof Optional</span>
                        </div>
                        <p class="mt-1 text-caption text-muted">
                            Multi-row overtime schedule with task to accomplish, regular time, O.T. time, auto-computed hours, and signature area.
                        </p>
                    </div>
                </button>

                <button @click="startNewRequest('UNDERTIME')"
                        class="w-full text-left p-4 rounded-xl border border-line hover:border-navy hover:bg-mist/40 transition-all flex items-start gap-3">
                    <span class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-warning/15 text-warning">
                        <app-icon name="Hourglass" :size="20" />
                    </span>
                    <div class="flex-1">
                        <div class="flex items-center justify-between">
                            <span class="font-semibold text-ink">3. Student Assistant Undertime Form</span>
                            <span class="text-[11px] font-medium text-muted">Proof Optional</span>
                        </div>
                        <p class="mt-1 text-caption text-muted">
                            Report an undertime incident (Early departure, Late arrival, or Other) with actual time, reason, and optional supporting document.
                        </p>
                    </div>
                </button>
            </div>
        </app-modal>

        <!-- Modal: View Request Details & Timeline -->
        <app-modal :open="showDetailModal"
                   :title="selectedRequest ? ('Request Details — ' + selectedRequest.requestCode) : 'Request Details'"
                   icon="FileText" size="lg" @close="showDetailModal = false">
            <div v-if="detailLoading" class="py-10 text-center text-muted text-body">
                Loading request details...
            </div>
            <div v-else-if="selectedRequest" class="space-y-4 text-caption">
                <div class="flex flex-wrap items-center justify-between gap-2 p-3.5 rounded-xl bg-page border border-line">
                    <div>
                        <span class="text-[11px] font-semibold uppercase text-muted">Request Type</span>
                        <div class="text-body font-bold text-ink mt-0.5">
                            {{ label('requestType', selectedRequest.requestType) }}
                            <span v-if="selectedRequest.requestType === 'UNDERTIME' && selectedRequest.undertimeType"
                                  class="ml-1.5 text-caption font-semibold text-warning">
                                ({{ selectedRequest.undertimeType }})
                            </span>
                        </div>
                    </div>
                    <div class="text-right">
                        <span class="text-[11px] font-semibold uppercase text-muted block mb-1">Current Status</span>
                        <status-badge group="requestStatus" :value="selectedRequest.status" />
                    </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-mist/40 border border-line">
                    <div>
                        <span class="text-[11px] text-muted block">Student Assistant</span>
                        <span class="font-semibold text-ink">{{ selectedRequest.saName }}</span>
                        <span class="text-[11px] text-muted block">{{ selectedRequest.studentId }} {{ selectedRequest.saNumber ? '· ' + selectedRequest.saNumber : '' }}</span>
                    </div>
                    <div>
                        <span class="text-[11px] text-muted block">Assigned Department</span>
                        <span class="font-semibold text-ink">{{ selectedRequest.location || selectedRequest.department || 'Unassigned' }}</span>
                    </div>
                    <div>
                        <span class="text-[11px] text-muted block">Immediate Supervisor</span>
                        <span class="font-semibold text-ink">{{ selectedRequest.supervisorName || 'Department Supervisor' }}</span>
                    </div>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl border border-line">
                    <div>
                        <span class="text-[11px] text-muted block">Relevant Date</span>
                        <span class="font-semibold text-ink">{{ formatRelevantDate(selectedRequest) }}</span>
                    </div>
                    <div>
                        <span class="text-[11px] text-muted block">Reason / Category</span>
                        <span class="font-semibold text-ink">{{ selectedRequest.reasonCategory }}</span>
                    </div>

                    <div v-if="selectedRequest.requestType === 'UNDERTIME'">
                        <span class="text-[11px] text-muted block">Type of Undertime</span>
                        <span class="font-semibold text-ink">{{ selectedRequest.undertimeType || '—' }}</span>
                    </div>
                    <div v-if="selectedRequest.requestType === 'UNDERTIME'">
                        <span class="text-[11px] text-muted block">Actual Time</span>
                        <span class="font-semibold text-ink">{{ selectedRequest.actualTime ? formatTime(selectedRequest.actualTime) : '—' }}</span>
                    </div>

                    <div class="sm:col-span-2" v-if="selectedRequest.overtimeRows && selectedRequest.overtimeRows.length">
                        <span class="text-[11px] font-semibold uppercase text-muted block mb-1.5">Overtime Schedule</span>
                        <div class="overflow-x-auto rounded-lg border border-line">
                            <table class="w-full text-left text-xs">
                                <thead class="bg-page border-b border-line text-[10px] uppercase text-muted">
                                    <tr>
                                        <th class="px-2.5 py-1.5">Date</th>
                                        <th class="px-2.5 py-1.5">Task to Accomplish</th>
                                        <th class="px-2.5 py-1.5">Regular Time</th>
                                        <th class="px-2.5 py-1.5">O.T. Time</th>
                                        <th class="px-2.5 py-1.5">O.T. Hours</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-line">
                                    <tr v-for="(r, i) in selectedRequest.overtimeRows" :key="i">
                                        <td class="px-2.5 py-1.5">{{ formatDate(r.date) }}</td>
                                        <td class="px-2.5 py-1.5 font-medium text-ink">{{ r.task }}</td>
                                        <td class="px-2.5 py-1.5">{{ formatTime(r.regularStart) }} – {{ formatTime(r.regularEnd) }}</td>
                                        <td class="px-2.5 py-1.5">{{ formatTime(r.otStart) }} – {{ formatTime(r.otEnd) }}</td>
                                        <td class="px-2.5 py-1.5 font-semibold text-navy">{{ r.otHours }} hrs</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div class="sm:col-span-2" v-if="selectedRequest.explanation">
                        <span class="text-[11px] text-muted block">Reason / Explanation</span>
                        <p class="mt-1 p-2.5 rounded-lg bg-page border border-line text-ink whitespace-pre-line">{{ selectedRequest.explanation }}</p>
                    </div>

                    <div class="sm:col-span-2" v-if="selectedRequest.notes">
                        <span class="text-[11px] text-muted block">Additional Details / Notes</span>
                        <p class="mt-0.5 text-ink whitespace-pre-line">{{ selectedRequest.notes }}</p>
                    </div>
                </div>

                <!-- Supporting Proof -->
                <div class="p-3.5 rounded-xl border border-line flex items-center justify-between gap-3">
                    <div>
                        <span class="text-[11px] font-semibold uppercase text-muted block">Supporting Proof / Letter</span>
                        <p v-if="selectedRequest.hasProof" class="font-medium text-ink mt-0.5">
                            {{ selectedRequest.proofFileName || 'Attached Supporting Document' }}
                            <span v-if="selectedRequest.proofSizeBytes" class="text-[11px] text-muted ml-1">({{ formatBytes(selectedRequest.proofSizeBytes) }})</span>
                        </p>
                        <p v-else class="text-muted mt-0.5">No supporting document attached.</p>
                    </div>
                    <a v-if="selectedRequest.hasProof"
                       :href="selectedRequest.proofViewUrl || ('api/document.php?type=request&id=' + selectedRequest.id)"
                       target="_blank" rel="noopener"
                       class="btn btn-secondary btn-sm">
                        <app-icon name="Eye" :size="14" /> View Proof
                    </a>
                </div>

                <!-- Supervisor & Coordinator Remarks -->
                <div v-if="selectedRequest.supervisorRemarks || selectedRequest.coordinatorRemarks" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div v-if="selectedRequest.supervisorRemarks" class="p-3 rounded-xl bg-warning/10 border border-warning/30">
                        <span class="text-[11px] font-semibold uppercase text-warning block">Immediate Supervisor Remarks</span>
                        <p class="mt-1 text-ink whitespace-pre-line">{{ selectedRequest.supervisorRemarks }}</p>
                        <span v-if="selectedRequest.supervisorName" class="mt-1 block text-[11px] text-muted">— {{ selectedRequest.supervisorName }}</span>
                    </div>
                    <div v-if="selectedRequest.coordinatorRemarks" class="p-3 rounded-xl bg-info/10 border border-info/30">
                        <span class="text-[11px] font-semibold uppercase text-info block">S.A. Coordinator Remarks</span>
                        <p class="mt-1 text-ink whitespace-pre-line">{{ selectedRequest.coordinatorRemarks }}</p>
                        <span v-if="selectedRequest.coordinatorName" class="mt-1 block text-[11px] text-muted">— {{ selectedRequest.coordinatorName }}</span>
                    </div>
                </div>

                <!-- Approval & Signatures (3-Column Role Layout) -->
                <div class="p-3.5 rounded-xl border border-line space-y-3 bg-mist/30">
                    <div class="flex items-center justify-between">
                        <h4 class="text-[11px] font-semibold uppercase tracking-wider text-muted flex items-center gap-1.5">
                            <app-icon name="ShieldCheck" :size="14" class="text-blue-600" />
                            <span>Approval &amp; Signatures</span>
                        </h4>
                        <span class="text-[10px] text-muted">Role-Gated Verifications</span>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                        <!-- Col 1: Student Assistant -->
                        <div class="rounded-lg border border-line bg-white p-2.5 space-y-2">
                            <div class="flex items-center justify-between">
                                <span class="font-bold text-slate-800 uppercase text-[10px]">Student Assistant</span>
                                <span class="text-[9px] text-slate-500">Applicant</span>
                            </div>
                            <div class="h-16 rounded border border-slate-200 bg-slate-50/50 flex items-center justify-center p-1 overflow-hidden">
                                <img v-if="selectedRequest.saSignature" :src="selectedRequest.saSignature" class="max-h-full max-w-full object-contain" alt="SA Signature" />
                                <span v-else class="text-[10px] text-slate-400 italic">No signature recorded</span>
                            </div>
                            <div class="text-[11px] border-t border-slate-100 pt-1">
                                <div class="font-semibold text-slate-700 truncate">{{ saContext.fullName || Store.user?.name || 'Student Assistant' }}</div>
                                <div class="text-[10px] text-slate-400">Signed: {{ selectedRequest.saSignDate ? formatDate(selectedRequest.saSignDate) : '—' }}</div>
                            </div>
                        </div>

                        <!-- Col 2: Immediate Supervisor -->
                        <div class="rounded-lg border border-line bg-white p-2.5 space-y-2">
                            <div class="flex items-center justify-between">
                                <span class="font-bold text-slate-800 uppercase text-[10px]">Immediate Supervisor</span>
                                <span class="rounded bg-amber-100 px-1 py-0.2 text-[9px] font-bold text-amber-800">Stage 1</span>
                            </div>
                            <div class="flex items-center gap-3 text-[10px]">
                                <span :class="selectedRequest.supervisorDecision === 'APPROVED' ? 'text-emerald-700 font-bold' : 'text-slate-400'">
                                    {{ selectedRequest.supervisorDecision === 'APPROVED' ? '☑ Approved' : '☐ Approved' }}
                                </span>
                                <span :class="(selectedRequest.status === 'REJECTED_BY_SUPERVISOR' || selectedRequest.supervisorDecision === 'REJECTED' || selectedRequest.supervisorDecision === 'NOT_APPROVED') ? 'text-rose-700 font-bold' : 'text-slate-400'">
                                    {{ (selectedRequest.status === 'REJECTED_BY_SUPERVISOR' || selectedRequest.supervisorDecision === 'REJECTED' || selectedRequest.supervisorDecision === 'NOT_APPROVED') ? '☑ Not Approved' : '☐ Not Approved' }}
                                </span>
                            </div>
                            <div class="h-16 rounded border border-slate-200 bg-slate-50/50 flex items-center justify-center p-1 overflow-hidden">
                                <img v-if="selectedRequest.supervisorSignature" :src="selectedRequest.supervisorSignature" class="max-h-full max-w-full object-contain" alt="Supervisor Signature" />
                                <span v-else class="text-[10px] text-slate-400 italic">{{ selectedRequest.supervisorActedAt ? 'Signed by Supervisor' : 'Pending Review' }}</span>
                            </div>
                            <div class="text-[11px] border-t border-slate-100 pt-1">
                                <div class="font-semibold text-slate-700 truncate">{{ selectedRequest.supervisorName || saContext.supervisorName || 'Immediate Supervisor' }}</div>
                                <div class="text-[10px] text-slate-400">Date: {{ selectedRequest.supervisorSignDate ? formatDate(selectedRequest.supervisorSignDate) : (selectedRequest.supervisorActedAt ? formatDate(selectedRequest.supervisorActedAt.slice(0, 10)) : 'Pending') }}</div>
                            </div>
                        </div>

                        <!-- Col 3: S.A. Coordinator -->
                        <div class="rounded-lg border border-line bg-white p-2.5 space-y-2">
                            <div class="flex items-center justify-between">
                                <span class="font-bold text-slate-800 uppercase text-[10px]">S.A. Coordinator</span>
                                <span class="rounded bg-blue-100 px-1 py-0.2 text-[9px] font-bold text-blue-800">Final Stage</span>
                            </div>
                            <div class="flex items-center gap-3 text-[10px]">
                                <span :class="selectedRequest.status === 'RECORDED' ? 'text-emerald-700 font-bold' : 'text-slate-400'">
                                    {{ selectedRequest.status === 'RECORDED' ? '☑ Approved' : '☐ Approved' }}
                                </span>
                                <span :class="(selectedRequest.status === 'RETURNED_FOR_CLARIFICATION' || selectedRequest.coordinatorDecision === 'NOT_APPROVED') ? 'text-rose-700 font-bold' : 'text-slate-400'">
                                    {{ (selectedRequest.status === 'RETURNED_FOR_CLARIFICATION' || selectedRequest.coordinatorDecision === 'NOT_APPROVED') ? '☑ Not Approved' : '☐ Not Approved' }}
                                </span>
                            </div>
                            <div class="h-16 rounded border border-slate-200 bg-slate-50/50 flex items-center justify-center p-1 overflow-hidden">
                                <img v-if="selectedRequest.coordinatorSignature" :src="selectedRequest.coordinatorSignature" class="max-h-full max-w-full object-contain" alt="Coordinator Signature" />
                                <span v-else class="text-[10px] text-slate-400 italic">{{ selectedRequest.status === 'RECORDED' ? 'Verified & Recorded' : 'Pending Final Recording' }}</span>
                            </div>
                            <div class="text-[11px] border-t border-slate-100 pt-1">
                                <div class="font-semibold text-slate-700 truncate">{{ selectedRequest.coordinatorName || 'Ansherina A Sudario' }}</div>
                                <div class="text-[10px] text-slate-400">Date: {{ selectedRequest.coordinatorSignDate ? formatDate(selectedRequest.coordinatorSignDate) : (selectedRequest.recordedAt ? formatDate(selectedRequest.recordedAt.slice(0, 10)) : 'Pending') }}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Request Timeline -->
                <div class="p-3.5 rounded-xl border border-line">
                    <h4 class="text-[11px] font-semibold uppercase tracking-wider text-muted mb-3">Request Timeline</h4>
                    <div v-if="!selectedHistory.length" class="text-muted">No workflow history entries yet.</div>
                    <ol v-else class="relative border-l border-line ml-2 space-y-3">
                        <li v-for="h in selectedHistory" :key="h.id" class="ml-4">
                            <span class="absolute -left-1.5 mt-1 h-3 w-3 rounded-full bg-navy border-2 border-white"></span>
                            <div class="flex flex-wrap items-center justify-between gap-1">
                                <span class="font-semibold text-ink">{{ formatAction(h.action) }}</span>
                                <span class="text-[11px] text-muted">{{ formatDateTime(h.createdAt) }}</span>
                            </div>
                            <div class="text-[11px] text-muted">
                                By {{ h.actorName }} ({{ formatRole(h.actorRole) }}) · Status: <span class="font-medium text-ink">{{ label('requestStatus', h.toStatus) }}</span>
                            </div>
                            <p v-if="h.remarks" class="mt-1 p-2 rounded bg-page border border-line text-ink whitespace-pre-line">{{ h.remarks }}</p>
                        </li>
                    </ol>
                </div>
            </div>

            <template #footer>
                <button v-if="selectedRequest && selectedRequest.status === 'DRAFT'"
                        @click="deleteDraft(selectedRequest)"
                        class="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 px-3 py-2 text-xs font-semibold text-rose-700 transition-colors shadow-2xs mr-auto">
                    <app-icon name="Trash2" :size="14" /> Delete Draft
                </button>
                <button v-if="selectedRequest && selectedRequest.status === 'DRAFT'"
                        @click="openEditRequest(selectedRequest, 'draft')"
                        class="btn btn-primary btn-sm">
                    <app-icon name="FileEdit" :size="14" /> Edit &amp; Submit
                </button>
                <button v-if="selectedRequest && (selectedRequest.status === 'RETURNED_TO_SA' || selectedRequest.status === 'RETURNED_FOR_CLARIFICATION')"
                        @click="openEditRequest(selectedRequest, 'resubmit')"
                        class="btn btn-primary btn-sm">
                    <app-icon name="RotateCcw" :size="14" /> Correct &amp; Resubmit
                </button>
                <button @click="showDetailModal = false" class="btn btn-secondary btn-sm">
                    Close
                </button>
            </template>
        </app-modal>
    </div>
    `
};
window.SaRequestsPage = SaRequestsPage;
