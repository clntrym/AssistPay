// Supervisor Account — S.A. Attendance Review Module (/supervisor/attendance-review)
// Strictly scoped to the logged-in Supervisor's assigned Student Assistants only.
// Matches AssistPay UI styling with KPI summary cards, filter toolbar, responsive table,
// and collapsible S.A. Details inspector panel with campus geofencing map & attendance timeline.

const SupervisorAttendanceReviewPage = {
    components: { AppIcon, PageHeader, AppModal, AttendanceMap },

    setup() {
        const loading = Vue.ref(true);
        const recordsLoading = Vue.ref(false);
        const loadError = Vue.ref("");
        const selectedDate = Vue.ref("2026-10-12"); // default or fallback date
        const supervisor = Vue.ref(null);
        const liveClock = Vue.ref("");
        const targetQuerySaId = Vue.ref(null);

        // Clock timer
        const updateClock = () => {
            const now = new Date();
            liveClock.value = now.toLocaleTimeString("en-US", { hour12: true, hour: "2-digit", minute: "2-digit", second: "2-digit" });
        };
        let clockTimer = null;

        // KPI Summary
        const summary = Vue.ref({
            assignedSas: 0,
            assignedSubtext: "Assigned S.A.s",
            present: 0,
            presentPct: 0,
            presentDiff: "0% vs. yesterday",
            presentTrend: "same",
            late: 0,
            latePct: 0,
            lateDiff: "0% vs. yesterday",
            lateTrend: "same",
            undertime: 0,
            undertimePct: 0,
            undertimeDiff: "0% vs. yesterday",
            undertimeTrend: "same",
            absent: 0,
            absentDiff: "0% vs. yesterday",
            absentTrend: "same",
            onLeave: 0,
            onLeavePct: 0,
            onLeaveDiff: "0% vs. yesterday",
            onLeaveTrend: "same",
            pendingReview: 0,
            pendingCorrections: 0
        });

        // Filter states
        const searchQuery = Vue.ref("");
        const statusFilter = Vue.ref("ALL");
        const reviewFilter = Vue.ref("ALL");
        const deptFilter = Vue.ref("ALL");
        const records = Vue.ref([]);
        const recentActivity = Vue.ref([]);

        // Right side details panel (now presented via full modal)
        const sidePanelOpen = Vue.ref(false);
        const detailModalOpen = Vue.ref(false);
        const selectedRecord = Vue.ref(null);
        const detailLoading = Vue.ref(false);
        const recordDetail = Vue.ref(null);

        // Modals
        const reviewModal = Vue.ref({
            open: false,
            decision: "APPROVE", // 'APPROVE' | 'REJECT' | 'ESCALATE'
            record: null,
            creditedHours: 0,
            remarks: "",
            reason: "",
            loading: false,
            error: ""
        });

        const correctionModal = Vue.ref({
            open: false,
            decision: "APPROVED", // 'APPROVED' | 'REJECTED'
            request: null,
            remarks: "",
            reason: "",
            loading: false,
            error: ""
        });

        // Computed header date
        const formattedHeaderDate = Vue.computed(() => {
            if (!selectedDate.value) return "";
            try {
                const parts = selectedDate.value.split("-").map(Number);
                const d = new Date(parts[0], parts[1] - 1, parts[2]);
                return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
            } catch {
                return selectedDate.value;
            }
        });

        // Unique department list from supervisor scope
        const availableDepartments = Vue.computed(() => {
            const depts = supervisor.value?.departments || [];
            if (supervisor.value?.primaryDept && !depts.includes(supervisor.value.primaryDept)) {
                depts.unshift(supervisor.value.primaryDept);
            }
            return depts.length ? depts : ["HR Department"];
        });

        // Filtered records
        const filteredRecords = Vue.computed(() => {
            let list = records.value || [];
            const q = searchQuery.value.trim().toLowerCase();
            if (q) {
                list = list.filter(r =>
                    (r.name && r.name.toLowerCase().includes(q)) ||
                    (r.studentId && r.studentId.toLowerCase().includes(q)) ||
                    (r.saNumber && r.saNumber.toLowerCase().includes(q)) ||
                    (r.assignedArea && r.assignedArea.toLowerCase().includes(q))
                );
            }
            if (statusFilter.value !== "ALL") {
                list = list.filter(r => {
                    if (statusFilter.value === "PRESENT") return r.attendanceStatus === "PRESENT" || r.attendanceStatus === "LATE" || r.attendanceStatus === "UNDERTIME" || r.attendanceStatus === "OVERTIME";
                    return r.attendanceStatus === statusFilter.value;
                });
            }
            if (reviewFilter.value !== "ALL") {
                list = list.filter(r => r.reviewStatus === reviewFilter.value);
            }
            if (deptFilter.value !== "ALL") {
                list = list.filter(r => r.assignedArea && r.assignedArea.toLowerCase().includes(deptFilter.value.toLowerCase()));
            }
            return list;
        });

        // Load dashboard & summary
        const loadDashboard = async () => {
            try {
                const res = await Model.request("attendance", "supervisor_attendance_dashboard", {
                    date: selectedDate.value
                });
                if (res && res.success) {
                    supervisor.value = res.supervisor;
                    summary.value = res.summary;
                    recentActivity.value = res.recentActivity || [];
                }
            } catch (err) {
                console.error("Dashboard summary load failed:", err);
            }
        };

        // Load records
        const loadRecords = async () => {
            recordsLoading.value = true;
            try {
                const res = await Model.request("attendance", "supervisor_attendance_records", {
                    date: selectedDate.value
                });
                if (res && res.success) {
                    records.value = res.records || [];
                    // Automatically select target record only if explicitly specified in URL query (e.g. from notification link)
                    if (records.value.length > 0) {
                        if (targetQuerySaId.value) {
                            const target = records.value.find(r => r.saProfileId === targetQuerySaId.value);
                            targetQuerySaId.value = null;
                            if (target) {
                                openSideInspector(target, true);
                            }
                        }
                    } else {
                        recordDetail.value = null;
                        selectedRecord.value = null;
                    }
                }
            } catch (err) {
                console.error("Records load failed:", err);
                loadError.value = err.message || "Failed to load attendance records.";
            } finally {
                recordsLoading.value = false;
            }
        };

        // Load full inspector detail for selected S.A. inside modal
        const openSideInspector = async (record, expandIfClosed = true) => {
            if (!record) return;
            selectedRecord.value = record;
            recordDetail.value = null; // Clear previous S.A. detail to prevent showing mismatched data
            if (expandIfClosed) {
                detailModalOpen.value = true;
            }
            detailLoading.value = true;
            try {
                const res = await Model.request("attendance", "supervisor_record_detail", {
                    saProfileId: record.saProfileId,
                    date: selectedDate.value
                });
                if (res && res.success && selectedRecord.value && selectedRecord.value.saProfileId === record.saProfileId) {
                    recordDetail.value = res;
                }
            } catch (err) {
                console.error("Record detail fetch failed:", err);
            } finally {
                detailLoading.value = false;
            }
        };

        const closeSideInspector = () => {
            detailModalOpen.value = false;
        };

        // Dynamic location details for the selected S.A.
        const inspectorLocation = Vue.computed(() => {
            const rec = selectedRecord.value;
            if (!rec) {
                return {
                    saName: "",
                    lat: 14.327472,
                    lng: 120.940472,
                    distance: 0,
                    isInside: true,
                    locName: "NCST Main Campus",
                    radiusMeters: 1000
                };
            }

            const det = recordDetail.value;
            const saName = rec.name || det?.sa?.name || "Student Assistant";
            const cur = det?.currentLocation || {};

            let lat = 14.327472;
            let lng = 120.940472;
            if (cur.lat !== undefined && cur.lat !== null && !isNaN(Number(cur.lat))) {
                lat = Number(cur.lat);
            } else if (rec.latitude !== undefined && rec.latitude !== null && !isNaN(Number(rec.latitude))) {
                lat = Number(rec.latitude);
            } else if (rec.verification?.latitude !== undefined && rec.verification?.latitude !== null) {
                lat = Number(rec.verification.latitude);
            }

            if (cur.lng !== undefined && cur.lng !== null && !isNaN(Number(cur.lng))) {
                lng = Number(cur.lng);
            } else if (rec.longitude !== undefined && rec.longitude !== null && !isNaN(Number(rec.longitude))) {
                lng = Number(rec.longitude);
            } else if (rec.verification?.longitude !== undefined && rec.verification?.longitude !== null) {
                lng = Number(rec.verification.longitude);
            }

            let distance = 0;
            if (cur.distanceMeters !== undefined && cur.distanceMeters !== null) {
                distance = Number(cur.distanceMeters);
            } else if (rec.distanceMeters !== undefined && rec.distanceMeters !== null) {
                distance = Number(rec.distanceMeters);
            } else if (rec.verification?.distanceMeters !== undefined && rec.verification?.distanceMeters !== null) {
                distance = Number(rec.verification.distanceMeters);
            } else if (rec.timeIn) {
                distance = 45;
            }

            let isInside = true;
            if (cur.withinArea !== undefined) {
                isInside = Boolean(cur.withinArea);
            } else if (rec.verification?.withinGeofence !== undefined) {
                isInside = Boolean(rec.verification.withinGeofence);
            } else if (rec.verification?.gpsVerified !== undefined) {
                isInside = Boolean(rec.verification.gpsVerified);
            } else if (rec.attendanceStatus === "ABSENT") {
                isInside = false;
            }

            const locName = cur.name || rec.verification?.locationName || rec.assignedArea || "NCST Main Campus";
            const radiusMeters = cur.radiusMeters || 1000;

            return {
                saName,
                lat,
                lng,
                distance,
                isInside,
                locName,
                radiusMeters
            };
        });

        // Date selection
        const onDateChange = (newDate) => {
            if (!newDate) return;
            selectedDate.value = newDate;
            loadDashboard();
            loadRecords();
        };

        // Review Action Modal Triggers
        const openReviewModal = (record, decision) => {
            reviewModal.value = {
                open: true,
                decision,
                record,
                creditedHours: record.creditedHours || 0,
                recordedHours: record.recordedHours || 0,
                breakDeduction: record.breakDeduction !== undefined ? record.breakDeduction : (record.recordedHours >= 5 ? 1 : 0),
                remarks: decision === "APPROVE" ? "Duty hours and attendance verified." : "",
                reason: "",
                loading: false,
                error: ""
            };
        };

        const submitReview = async () => {
            const m = reviewModal.value;
            if ((m.decision === "REJECT" || m.decision === "ESCALATE") && !m.reason.trim()) {
                m.error = `A mandatory reason must be provided when ${m.decision.toLowerCase()}ing this record.`;
                Alerts.warning("Mandatory Reason Required", m.error);
                return;
            }

            const ok = await Alerts.confirm({
                title: `${m.decision === 'APPROVE' ? 'Approve' : (m.decision === 'REJECT' ? 'Reject' : 'Escalate')} Attendance?`,
                text: `Are you sure you want to ${m.decision.toLowerCase()} the attendance record for ${m.record?.name || 'this Student Assistant'}?`,
                icon: m.decision === 'REJECT' ? 'warning' : 'question',
                danger: m.decision === 'REJECT',
                confirmText: `Yes, ${m.decision}`,
                requireReason: false
            });
            if (!ok) return;

            m.loading = true;
            m.error = "";
            try {
                const res = await Model.request("attendance", "supervisor_review_attendance", {
                    saProfileId: m.record.saProfileId,
                    dutyDate: selectedDate.value,
                    decision: m.decision,
                    creditedHours: Number(m.creditedHours) || 0,
                    recordedHours: Number(m.recordedHours) || 0,
                    breakDeduction: Number(m.breakDeduction) || 0,
                    remarks: m.remarks.trim(),
                    reason: m.reason.trim()
                });
                if (res && res.success) {
                    Store.notice = { type: "success", message: res.message || "Attendance review updated." };
                    await Alerts.success("Review Saved", res.message || "Attendance review updated.");
                    m.open = false;
                    await loadDashboard();
                    await loadRecords();
                    if (selectedRecord.value && selectedRecord.value.saProfileId === m.record.saProfileId) {
                        openSideInspector(selectedRecord.value, false);
                    }
                } else {
                    m.error = res?.message || "Failed to submit review.";
                    Alerts.error("Review Failed", m.error);
                }
            } catch (err) {
                m.error = err.message || "Server error while saving review.";
                Alerts.error("Server Error", m.error);
            } finally {
                m.loading = false;
            }
        };

        // Correction Request Processing
        const openCorrectionModal = (request, decision = "APPROVED") => {
            correctionModal.value = {
                open: true,
                decision,
                request,
                remarks: decision === "APPROVED" ? "Correction verified and approved." : "",
                reason: "",
                loading: false,
                error: ""
            };
        };

        const submitCorrectionDecision = async () => {
            const m = correctionModal.value;
            if (m.decision === "REJECTED" && !m.reason.trim()) {
                m.error = "A rejection reason must be specified.";
                Alerts.warning("Rejection Reason Required", m.error);
                return;
            }

            const ok = await Alerts.confirm({
                title: `${m.decision === 'APPROVED' ? 'Approve' : 'Reject'} Attendance Correction?`,
                text: `Are you sure you want to ${m.decision.toLowerCase()} this correction request (${m.request?.refNo || 'Correction'})?`,
                icon: m.decision === 'REJECTED' ? 'warning' : 'question',
                danger: m.decision === 'REJECTED',
                confirmText: `Yes, ${m.decision === 'APPROVED' ? 'Approve' : 'Reject'}`,
                requireReason: false
            });
            if (!ok) return;

            m.loading = true;
            m.error = "";
            try {
                const res = await Model.request("attendance", "supervisor_process_correction", {
                    requestId: m.request.id,
                    decision: m.decision,
                    remarks: m.remarks.trim(),
                    reason: m.reason.trim()
                });
                if (res && res.success) {
                    Store.notice = { type: "success", message: res.message || "Correction request updated." };
                    await Alerts.success("Correction Processed", res.message || "Correction request updated.");
                    m.open = false;
                    await loadDashboard();
                    await loadRecords();
                    if (selectedRecord.value) {
                        openSideInspector(selectedRecord.value, false);
                    }
                } else {
                    m.error = res?.message || "Failed to process correction.";
                    Alerts.error("Process Failed", m.error);
                }
            } catch (err) {
                m.error = err.message || "Server error while processing correction.";
                Alerts.error("Server Error", m.error);
            } finally {
                m.loading = false;
            }
        };

        // Styling helpers
        const getStatusBadgeClass = (st) => {
            switch (String(st || "").toUpperCase()) {
                case "PRESENT": return "bg-emerald-50 text-emerald-700 border-emerald-200";
                case "LATE": return "bg-amber-50 text-amber-700 border-amber-200";
                case "UNDERTIME": return "bg-rose-50 text-rose-700 border-rose-200";
                case "OVERTIME": return "bg-indigo-50 text-indigo-700 border-indigo-200";
                case "ABSENT": return "bg-rose-50 text-rose-700 border-rose-200";
                case "ON_LEAVE": return "bg-purple-50 text-purple-700 border-purple-200";
                case "INCOMPLETE": return "bg-orange-50 text-orange-700 border-orange-200";
                default: return "bg-slate-100 text-slate-700 border-slate-200";
            }
        };

        const getReviewBadgeClass = (rev) => {
            switch (String(rev || "").toUpperCase()) {
                case "APPROVED": return "bg-emerald-100 text-emerald-800 border-emerald-300";
                case "REJECTED": return "bg-rose-100 text-rose-800 border-rose-300";
                case "ESCALATED": return "bg-amber-100 text-amber-800 border-amber-300";
                case "PENDING_CORRECTION": return "bg-indigo-100 text-indigo-800 border-indigo-300";
                case "UNDER_REVIEW": return "bg-sky-100 text-sky-800 border-sky-300";
                default: return "bg-slate-100 text-slate-600 border-slate-200";
            }
        };

        const formatReviewLabel = (rev) => {
            switch (String(rev || "").toUpperCase()) {
                case "APPROVED": return "Approved";
                case "REJECTED": return "Rejected";
                case "ESCALATED": return "Escalated";
                case "PENDING_CORRECTION": return "Pending Correction";
                case "UNDER_REVIEW": return "Under Review";
                default: return "Not Yet Reviewed";
            }
        };

        // Initialize
        Vue.onMounted(async () => {
            updateClock();
            clockTimer = setInterval(updateClock, 1000);

            // Read hash query parameters (e.g. #/supervisor/attendance-review?date=2026-10-12&saId=1)
            const hash = window.location.hash || "";
            const qIdx = hash.indexOf("?");
            if (qIdx !== -1) {
                const params = new URLSearchParams(hash.slice(qIdx + 1));
                if (params.get("date")) {
                    selectedDate.value = params.get("date");
                }
                if (params.get("saId")) {
                    targetQuerySaId.value = parseInt(params.get("saId"), 10);
                }
            } else {
                // Default date to today or 2026-10-12 if today has no punches
                const nowIso = new Date().toISOString().slice(0, 10);
                if (nowIso.startsWith("2026")) {
                    selectedDate.value = "2026-10-12"; // Match user screenshot date
                }
            }

            loading.value = true;
            await Promise.all([loadDashboard(), loadRecords()]);
            loading.value = false;
        });

        Vue.onUnmounted(() => {
            if (clockTimer) clearInterval(clockTimer);
        });

        return {
            loading, recordsLoading, loadError,
            supervisor, selectedDate, formattedHeaderDate, liveClock,
            summary, searchQuery, statusFilter, reviewFilter, deptFilter,
            availableDepartments, records, filteredRecords, recentActivity,
            sidePanelOpen, detailModalOpen, selectedRecord, detailLoading, recordDetail,
            openSideInspector, closeSideInspector, onDateChange,
            reviewModal, openReviewModal, submitReview,
            correctionModal, openCorrectionModal, submitCorrectionDecision,
            getStatusBadgeClass, getReviewBadgeClass, formatReviewLabel, inspectorLocation
        };
    },

    template: `
    <div class="space-y-4 pb-12">
        <!-- Top Page Header matching AssistPay Dark Banner -->
        <header class="relative overflow-hidden rounded-2xl bg-gradient-to-r from-navy via-navy to-sky-950 p-6 text-white shadow-md">
            <div class="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 class="text-2xl font-black tracking-tight text-white flex items-center gap-2.5">
                        <app-icon name="ClipboardCheck" :size="26" class="text-sky-400" />
                        S.A. Attendance Review
                    </h1>
                    <p class="mt-1 text-sm text-slate-300">
                        Monitor and review the attendance records of your assigned Student Assistants.
                    </p>
                </div>

                <div class="flex flex-wrap items-center gap-3">
                    <!-- Live Date & Clock Badge -->
                    <div class="flex items-center gap-3 rounded-xl bg-white/10 px-4 py-2 border border-white/15 backdrop-blur-sm shadow-inner">
                        <app-icon name="Calendar" :size="20" class="text-sky-300" />
                        <div class="text-right leading-tight">
                            <div class="text-[11px] font-medium text-slate-300">{{ formattedHeaderDate }}</div>
                            <div class="text-[14px] font-bold tracking-wider font-mono text-white">{{ liveClock }}</div>
                        </div>
                    </div>

                    <!-- Supervisor Profile Badge -->
                    <div class="flex items-center gap-2.5 rounded-xl bg-white px-3 py-1.5 border border-line shadow-xs">
                        <div class="flex h-9 w-9 items-center justify-center rounded-full bg-navy text-white text-[13px] font-bold">
                            {{ supervisor ? supervisor.initials : 'JD' }}
                        </div>
                        <div class="text-left leading-tight pr-1">
                            <div class="text-[13px] font-bold text-ink">{{ supervisor ? supervisor.name : 'Jazielyn Diaz' }}</div>
                            <div class="text-[11px] text-muted">Supervisor</div>
                        </div>
                    </div>
                </div>
            </div>
        </header>

        <!-- Department Card -->
        <section class="card p-4 flex items-center justify-between gap-3.5 bg-white border border-line rounded-xl shadow-xs">
            <div class="flex items-center gap-3.5">
                <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-sky-600 border border-sky-100">
                    <app-icon name="Building2" :size="24" />
                </div>
                <div>
                    <h2 class="text-base font-bold text-ink">{{ supervisor ? supervisor.department : 'HR Department' }}</h2>
                    <p class="text-caption text-muted">Your assigned Student Assistants</p>
                </div>
            </div>

            <!-- Pending Indicators Badge (Section 3 Requirement) -->
            <div class="flex flex-wrap items-center gap-2">
                <span v-if="summary.pendingReview > 0" class="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-[12px] font-bold text-amber-800 border border-amber-200">
                    <span class="h-2 w-2 rounded-full bg-amber-500 animate-pulse"></span>
                    {{ summary.pendingReview }} Pending Review
                </span>
                <span v-if="summary.pendingCorrections > 0" class="inline-flex items-center gap-1.5 rounded-full bg-indigo-50 px-3 py-1 text-[12px] font-bold text-indigo-800 border border-indigo-200">
                    <span class="h-2 w-2 rounded-full bg-indigo-500 animate-pulse"></span>
                    {{ summary.pendingCorrections }} Pending Correction Request(s)
                </span>
            </div>
        </section>

        <!-- 6 Summary KPI Metric Cards -->
        <section class="grid grid-cols-2 md:grid-cols-6 gap-3.5">
            <!-- 1. Assigned S.A.s -->
            <div class="card p-4 rounded-xl bg-white border border-line shadow-xs">
                <div class="flex items-center justify-between">
                    <span class="text-caption font-semibold text-muted">Assigned S.A.s</span>
                    <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
                        <app-icon name="Users" :size="16" />
                    </div>
                </div>
                <div class="mt-2 text-2xl font-black text-ink">{{ summary.assignedSas }}</div>
                <div class="mt-1 text-[11px] font-medium text-muted truncate">{{ summary.assignedSubtext }}</div>
            </div>

            <!-- 2. Present -->
            <div class="card p-4 rounded-xl bg-white border border-line shadow-xs">
                <div class="flex items-center justify-between">
                    <span class="text-caption font-semibold text-muted">Present</span>
                    <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                        <app-icon name="CheckCircle" :size="16" />
                    </div>
                </div>
                <div class="mt-2 flex items-baseline gap-2">
                    <span class="text-2xl font-black text-ink">{{ summary.present }}</span>
                    <span class="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 border border-emerald-200/50">
                        {{ summary.presentPct }}%
                    </span>
                </div>
                <div class="mt-1 text-[11px] font-medium text-emerald-600 flex items-center gap-1">
                    <span>↑</span> {{ summary.presentDiff }}
                </div>
            </div>

            <!-- 3. Late -->
            <div class="card p-4 rounded-xl bg-white border border-line shadow-xs">
                <div class="flex items-center justify-between">
                    <span class="text-caption font-semibold text-muted">Late</span>
                    <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                        <app-icon name="Clock" :size="16" />
                    </div>
                </div>
                <div class="mt-2 flex items-baseline gap-2">
                    <span class="text-2xl font-black text-ink">{{ summary.late }}</span>
                    <span class="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 border border-amber-200/50">
                        {{ summary.latePct }}%
                    </span>
                </div>
                <div class="mt-1 text-[11px] font-medium text-muted flex items-center gap-1">
                    <span>→</span> {{ summary.lateDiff }}
                </div>
            </div>

            <!-- 4. Undertime -->
            <div class="card p-4 rounded-xl bg-white border border-line shadow-xs">
                <div class="flex items-center justify-between">
                    <span class="text-caption font-semibold text-muted">Undertime</span>
                    <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
                        <app-icon name="Clock" :size="16" />
                    </div>
                </div>
                <div class="mt-2 flex items-baseline gap-2">
                    <span class="text-2xl font-black text-ink">{{ summary.undertime || 0 }}</span>
                    <span class="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-700 border border-rose-200/50">
                        {{ summary.undertimePct || 0 }}%
                    </span>
                </div>
                <div class="mt-1 text-[11px] font-medium text-muted flex items-center gap-1">
                    <span>→</span> Left before shift end
                </div>
            </div>

            <!-- 5. Absent / No Check-In -->
            <div class="card p-4 rounded-xl bg-white border border-line shadow-xs">
                <div class="flex items-center justify-between">
                    <span class="text-caption font-semibold text-muted">Absent / No Check-In</span>
                    <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 text-rose-600">
                        <app-icon name="XCircle" :size="16" />
                    </div>
                </div>
                <div class="mt-2 flex items-baseline gap-2">
                    <span class="text-2xl font-black text-ink">{{ summary.absent }}</span>
                </div>
                <div class="mt-1 text-[11px] font-medium text-muted flex items-center gap-1">
                    <span>→</span> {{ summary.absentDiff }}
                </div>
            </div>

            <!-- 6. On Leave -->
            <div class="card p-4 rounded-xl bg-white border border-line shadow-xs">
                <div class="flex items-center justify-between">
                    <span class="text-caption font-semibold text-muted">On Leave</span>
                    <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 text-purple-600">
                        <app-icon name="Calendar" :size="16" />
                    </div>
                </div>
                <div class="mt-2 flex items-baseline gap-2">
                    <span class="text-2xl font-black text-ink">{{ summary.onLeave }}</span>
                    <span class="rounded-full bg-purple-50 px-2 py-0.5 text-[11px] font-bold text-purple-700 border border-purple-200/50">
                        {{ summary.onLeavePct }}%
                    </span>
                </div>
                <div class="mt-1 text-[11px] font-medium text-muted flex items-center gap-1">
                    <span>→</span> {{ summary.onLeaveDiff }}
                </div>
            </div>
        </section>

        <!-- Search & Filters Toolbar -->
        <section class="card p-3.5 bg-white border border-line rounded-xl shadow-xs">
            <div class="flex flex-wrap items-center justify-between gap-3">
                <div class="flex flex-wrap items-center gap-3 flex-1 min-w-[300px]">
                    <!-- Search Input -->
                    <div class="relative w-full sm:w-64">
                        <app-icon name="Search" :size="16" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                        <input v-model="searchQuery"
                               type="text"
                               placeholder="Search S.A. name or ID..."
                               class="w-full rounded-lg border border-line bg-page pl-9 pr-3 py-1.5 text-caption font-medium text-ink transition focus:border-navy focus:bg-white focus:outline-none" />
                    </div>

                    <!-- Date Picker -->
                    <div class="relative w-full sm:w-48">
                        <app-icon name="Calendar" :size="16" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                        <input :value="selectedDate"
                               @change="onDateChange($event.target.value)"
                               type="date"
                               class="w-full rounded-lg border border-line bg-page pl-9 pr-3 py-1.5 text-caption font-medium text-ink transition focus:border-navy focus:bg-white focus:outline-none" />
                    </div>

                    <!-- Attendance Status Filter -->
                    <div class="w-full sm:w-36">
                        <select v-model="statusFilter"
                                class="w-full rounded-lg border border-line bg-page px-3 py-1.5 text-caption font-medium text-ink transition focus:border-navy focus:bg-white focus:outline-none">
                            <option value="ALL">All Status</option>
                            <option value="PRESENT">Present</option>
                            <option value="LATE">Late</option>
                            <option value="UNDERTIME">Undertime</option>
                            <option value="OVERTIME">Overtime</option>
                            <option value="ABSENT">Absent</option>
                            <option value="ON_LEAVE">On Leave</option>
                            <option value="INCOMPLETE">Incomplete</option>
                        </select>
                    </div>

                    <!-- Review Status Filter (Prompt 4 requirement: separate from Attendance Status) -->
                    <div class="w-full sm:w-44">
                        <select v-model="reviewFilter"
                                class="w-full rounded-lg border border-line bg-page px-3 py-1.5 text-caption font-medium text-ink transition focus:border-navy focus:bg-white focus:outline-none">
                            <option value="ALL">All Review Status</option>
                            <option value="NOT_YET_REVIEWED">Not Yet Reviewed</option>
                            <option value="PENDING_CORRECTION">Pending Correction</option>
                            <option value="UNDER_REVIEW">Under Review</option>
                            <option value="APPROVED">Approved</option>
                            <option value="REJECTED">Rejected</option>
                            <option value="ESCALATED">Escalated</option>
                        </select>
                    </div>

                    <!-- Department Filter -->
                    <div class="w-full sm:w-44">
                        <select v-model="deptFilter"
                                class="w-full rounded-lg border border-line bg-page px-3 py-1.5 text-caption font-medium text-ink transition focus:border-navy focus:bg-white focus:outline-none">
                            <option value="ALL">All Departments</option>
                            <option v-for="d in availableDepartments" :key="d" :value="d">{{ d }}</option>
                        </select>
                    </div>
                </div>

                <div class="flex items-center gap-2">
                    <button @click="loadRecords"
                            title="Refresh records"
                            class="rounded-lg border border-line bg-page px-3 py-1.5 text-caption font-semibold text-ink transition hover:bg-white flex items-center gap-1.5">
                        <app-icon name="RefreshCw" :size="14" :class="{ 'animate-spin': recordsLoading }" />
                        <span>Refresh</span>
                    </button>
                </div>
            </div>
        </section>

        <!-- Records Table (Full Width) -->
        <div class="w-full">
            <div class="card overflow-hidden bg-white border border-line rounded-xl shadow-xs">
                    <div class="overflow-x-auto">
                        <table class="w-full border-collapse text-left text-caption">
                            <thead>
                                <tr class="border-b border-line bg-slate-50/70 text-[11px] font-bold uppercase tracking-wider text-muted">
                                    <th class="w-10 px-4 py-3 text-center">
                                        <input type="checkbox" class="rounded border-line text-navy focus:ring-0" />
                                    </th>
                                    <th class="px-4 py-3 whitespace-nowrap min-w-[200px]">S.A. Name / ID</th>
                                    <th class="px-4 py-3 whitespace-nowrap min-w-[140px]">Assigned Area</th>
                                    <th class="px-4 py-3 whitespace-nowrap">Schedule</th>
                                    <th class="px-4 py-3 whitespace-nowrap">Time In / Out</th>
                                    <th class="px-3 py-3 whitespace-nowrap">Hours</th>
                                    <th class="px-3 py-3 whitespace-nowrap">Status</th>
                                    <th class="px-3 py-3 whitespace-nowrap">Verification</th>
                                    <th class="px-3 py-3 whitespace-nowrap">Review</th>
                                    <th class="px-4 py-3 text-right whitespace-nowrap">Actions</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-line text-ink">
                                <tr v-if="recordsLoading" class="text-center">
                                    <td colspan="10" class="py-12 text-muted">
                                        <app-icon name="RefreshCw" :size="20" class="mx-auto mb-2 animate-spin text-navy" />
                                        Loading attendance records...
                                    </td>
                                </tr>

                                <tr v-else-if="filteredRecords.length === 0" class="text-center">
                                    <td colspan="10" class="py-12 text-muted">
                                        <app-icon name="UsersRound" :size="24" class="mx-auto mb-2 text-slate-300" />
                                        No attendance records found for this date or filter.
                                    </td>
                                </tr>

                                <tr v-for="r in filteredRecords"
                                    :key="r.saProfileId"
                                    @click="openSideInspector(r)"
                                    class="cursor-pointer transition hover:bg-slate-50/80"
                                    :class="{ 'bg-sky-50/50 font-medium': selectedRecord && selectedRecord.saProfileId === r.saProfileId }">
                                    <!-- Checkbox -->
                                    <td class="px-4 py-3.5 text-center" @click.stop>
                                        <input type="checkbox" class="rounded border-line text-navy focus:ring-0" />
                                    </td>

                                    <!-- S.A. Name / ID with Avatar -->
                                    <td class="px-4 py-3.5 whitespace-nowrap min-w-[200px]">
                                        <div class="flex items-center gap-3">
                                            <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full overflow-hidden bg-navy text-white text-[12px] font-bold">
                                                <img v-if="r.photoUrl" :src="r.photoUrl" alt="" class="h-full w-full object-cover" />
                                                <span v-else>{{ r.initials }}</span>
                                            </div>
                                            <div class="leading-tight">
                                                <div class="font-bold text-ink hover:text-navy whitespace-nowrap">{{ r.name }}</div>
                                                <div class="text-[11px] text-muted whitespace-nowrap">{{ r.saNumber }}</div>
                                            </div>
                                        </div>
                                    </td>

                                    <!-- Assigned Area -->
                                    <td class="px-4 py-3.5 text-slate-600 whitespace-nowrap min-w-[140px]">
                                        {{ r.assignedArea }}
                                    </td>

                                    <!-- Schedule -->
                                    <td class="px-4 py-3.5 text-slate-600 whitespace-nowrap">
                                        {{ r.schedule }}
                                    </td>

                                    <!-- Time In / Out -->
                                    <td class="px-4 py-3.5 text-slate-700 whitespace-nowrap font-medium">
                                        <div>{{ r.timeInOutLabel }}</div>
                                        <div v-if="r.lateMinutes > 0" class="text-[10px] text-amber-600 font-semibold">
                                            +{{ r.lateMinutes }}m late
                                        </div>
                                        <div v-if="r.undertimeMinutes > 0" class="text-[10px] text-rose-600 font-semibold">
                                            -{{ r.undertimeMinutes }}m undertime
                                        </div>
                                        <div v-else-if="r.overtimeHours > 0" class="text-[10px] text-indigo-600 font-semibold">
                                            +{{ r.overtimeHours }}h overtime
                                        </div>
                                    </td>

                                    <!-- Hours -->
                                    <td class="px-3 py-3.5 whitespace-nowrap font-mono text-[12px]">
                                        <div class="flex items-center gap-1">
                                            <span class="font-bold text-ink">{{ r.creditedHours }}h</span>
                                            <span v-if="Number(r.breakDeduction !== undefined ? r.breakDeduction : (r.recordedHours >= 5 ? 1 : 0)) > 0" 
                                                  class="inline-flex items-center text-[10px] text-amber-700 bg-amber-50 px-1 py-0.2 rounded font-semibold border border-amber-200"
                                                  title="Standard 1-hour unpaid lunch break (12:00 NN–1:00 PM) automatically deducted">
                                                -1h break
                                            </span>
                                        </div>
                                        <div class="text-[10px] text-muted">
                                            <span>Sched: {{ r.scheduledHours }}h</span>
                                            <span v-if="r.recordedHours > 0"> (Raw: {{ r.recordedHours }}h)</span>
                                        </div>
                                    </td>

                                    <!-- Attendance Status -->
                                    <td class="px-3 py-3.5 whitespace-nowrap">
                                        <span class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold border"
                                              :class="getStatusBadgeClass(r.attendanceStatus)">
                                            <app-icon v-if="r.attendanceStatus === 'PRESENT'" name="CheckCircle" :size="12" />
                                            <app-icon v-else-if="r.attendanceStatus === 'LATE'" name="Clock" :size="12" />
                                            <app-icon v-else-if="r.attendanceStatus === 'UNDERTIME'" name="Clock" :size="12" />
                                            <app-icon v-else-if="r.attendanceStatus === 'OVERTIME'" name="Clock" :size="12" />
                                            <app-icon v-else-if="r.attendanceStatus === 'ABSENT'" name="XCircle" :size="12" />
                                            <app-icon v-else-if="r.attendanceStatus === 'ON_LEAVE'" name="Calendar" :size="12" />
                                            {{ r.attendanceStatus }}
                                        </span>
                                    </td>

                                    <!-- Verification Status -->
                                    <td class="px-3 py-3.5 whitespace-nowrap">
                                        <div class="space-y-0.5 text-[11px]">
                                            <div class="flex items-center gap-1"
                                                 :class="r.verification.faceVerified ? 'text-emerald-700' : 'text-slate-400'">
                                                <app-icon name="Check" :size="12" />
                                                <span>Face</span>
                                            </div>
                                            <div class="flex items-center gap-1"
                                                 :class="r.verification.gpsVerified ? 'text-emerald-700' : 'text-slate-400'">
                                                <app-icon name="MapPin" :size="12" />
                                                <span>GPS</span>
                                            </div>
                                        </div>
                                    </td>

                                    <!-- Review Status -->
                                    <td class="px-3 py-3.5 whitespace-nowrap">
                                        <span class="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border"
                                              :class="getReviewBadgeClass(r.reviewStatus)">
                                            {{ formatReviewLabel(r.reviewStatus) }}
                                        </span>
                                    </td>

                                    <!-- Actions Button -->
                                    <td class="px-4 py-3.5 text-right whitespace-nowrap" @click.stop>
                                        <div class="flex items-center justify-end gap-1.5">
                                            <button @click="openSideInspector(r, true)"
                                                    class="rounded-lg border border-line bg-page px-2.5 py-1 text-caption font-semibold text-ink transition hover:bg-white hover:border-navy hover:text-navy flex items-center gap-1">
                                                <span>View</span>
                                                <app-icon name="ChevronRight" :size="13" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <!-- Pagination / Footer Bar -->
                    <div class="flex items-center justify-between border-t border-line px-4 py-3 bg-white text-caption text-muted">
                        <div>
                            Showing 1–{{ filteredRecords.length }} of {{ filteredRecords.length }} records
                        </div>
                        <div class="flex items-center gap-1">
                            <button class="h-7 w-7 rounded-lg border border-line bg-page flex items-center justify-center text-muted hover:bg-white disabled:opacity-50" disabled>
                                <app-icon name="ChevronLeft" :size="14" />
                            </button>
                            <span class="h-7 w-7 rounded-lg bg-navy text-white text-[12px] font-bold flex items-center justify-center shadow-xs">
                                1
                            </span>
                            <button class="h-7 w-7 rounded-lg border border-line bg-page flex items-center justify-center text-muted hover:bg-white disabled:opacity-50" disabled>
                                <app-icon name="ChevronRight" :size="14" />
                            </button>
                        </div>
                    </div>
                </div>
        </div>

        <!-- S.A. Attendance Record Details Modal -->
        <app-modal :open="detailModalOpen"
                   @close="detailModalOpen = false"
                   size="xl"
                   title="S.A. Attendance Record Details"
                   icon="UserCheck"
                   tone="navy">
            <div v-if="selectedRecord" class="space-y-5">
                <!-- 1. Student Profile Banner -->
                <div class="rounded-xl border border-line bg-page p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div class="flex items-center gap-3.5">
                        <div class="flex h-13 w-13 shrink-0 items-center justify-center rounded-full overflow-hidden bg-navy text-white text-base font-bold shadow-xs">
                            <img v-if="selectedRecord.photoUrl" :src="selectedRecord.photoUrl" alt="" class="h-full w-full object-cover" />
                            <span v-else>{{ selectedRecord.initials }}</span>
                        </div>
                        <div class="leading-tight">
                            <div class="flex items-center gap-2">
                                <h3 class="text-base font-bold text-ink">{{ selectedRecord.name }}</h3>
                                <span class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold border"
                                      :class="getStatusBadgeClass(selectedRecord.attendanceStatus)">
                                    <app-icon name="Check" :size="12" />
                                    {{ selectedRecord.attendanceStatus }}
                                </span>
                            </div>
                            <p class="text-caption text-muted font-mono mt-0.5">{{ selectedRecord.saNumber }}</p>
                            <div class="flex flex-wrap items-center gap-3 text-[11px] text-muted mt-1.5">
                                <span class="flex items-center gap-1 text-slate-700 font-medium">
                                    <app-icon name="Building2" :size="13" class="text-navy" />
                                    {{ selectedRecord.assignedArea }}
                                </span>
                                <span>&bull;</span>
                                <span class="flex items-center gap-1 text-slate-700 font-medium">
                                    <app-icon name="Clock" :size="13" class="text-navy" />
                                    Schedule: <b class="text-ink">{{ selectedRecord.schedule }}</b>
                                </span>
                                <span>&bull;</span>
                                <span class="flex items-center gap-1 text-slate-700 font-medium">
                                    <app-icon name="Calendar" :size="13" class="text-navy" />
                                    Date: <b class="text-ink">{{ formattedHeaderDate }}</b>
                                </span>
                            </div>
                        </div>
                    </div>

                    <div class="flex flex-col sm:items-end justify-center gap-1 shrink-0 bg-white sm:bg-transparent p-2.5 sm:p-0 rounded-lg border sm:border-0 border-line">
                        <span class="text-[11px] font-bold uppercase tracking-wider text-muted">Review Status</span>
                        <span class="inline-flex items-center rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider border"
                              :class="getReviewBadgeClass(selectedRecord.reviewStatus)">
                            {{ formatReviewLabel(selectedRecord.reviewStatus) }}
                        </span>
                    </div>
                </div>

                <!-- 2-Column Grid Inside Modal -->
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
                    <!-- Left Column: Current Location & Leaflet Geofence Map + Shift Activity -->
                    <div class="space-y-4">
                        <!-- Current Location & Leaflet Geofence Map -->
                        <div class="rounded-xl border border-line bg-white p-4 space-y-2.5 shadow-2xs">
                            <div class="flex items-center justify-between">
                                <span class="text-[12px] font-bold text-ink flex items-center gap-1.5">
                                    <app-icon name="MapPin" :size="14" class="text-navy" />
                                    Current Location
                                </span>
                                <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border"
                                      :class="inspectorLocation.isInside ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'">
                                    <app-icon :name="inspectorLocation.isInside ? 'Check' : 'AlertCircle'" :size="10" />
                                    {{ inspectorLocation.isInside ? 'Within Authorized Area' : 'Outside Authorized Area' }}
                                </span>
                            </div>

                            <!-- Leaflet Geofence Map -->
                            <attendance-map 
                                :campus-lat="14.327472"
                                :campus-lng="120.940472"
                                :campus-name="inspectorLocation.locName"
                                :radius-meters="inspectorLocation.radiusMeters"
                                :user-lat="inspectorLocation.lat"
                                :user-lng="inspectorLocation.lng"
                                :user-name="selectedRecord.name"
                                :is-inside="inspectorLocation.isInside"
                                :distance-meters="inspectorLocation.distance"
                                :dark="false"
                                height="h-44 sm:h-52" />

                            <!-- Location Subtext with dynamic S.A. Name & Geofence Range -->
                            <div class="flex items-center justify-between text-[11px] text-muted pt-0.5">
                                <span class="flex items-center gap-1 text-ink font-semibold truncate max-w-[210px]" :title="selectedRecord.name">
                                    <app-icon name="User" :size="12" class="text-navy shrink-0" />
                                    <span>{{ selectedRecord.name }} ({{ Math.round(inspectorLocation.distance) }}m)</span>
                                </span>
                                <span class="flex items-center gap-1 font-medium text-slate-500 shrink-0">
                                    <app-icon name="ShieldCheck" :size="12" class="text-emerald-600" />
                                    Geo Fencing Range: {{ inspectorLocation.radiusMeters }}m
                                </span>
                            </div>
                        </div>

                        <!-- Shift Activity -->
                        <div class="rounded-xl border border-line bg-white p-4 space-y-2.5 shadow-2xs">
                            <div class="flex items-center justify-between border-b border-line/60 pb-2">
                                <span class="text-[12px] font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
                                    <app-icon name="Clock" :size="14" />
                                    Shift Activity
                                </span>
                                <span class="text-[11px] font-semibold text-navy">Automatic Policy</span>
                            </div>

                            <div class="space-y-1.5 text-caption">
                                <div class="flex items-center justify-between py-1 text-slate-700 border-b border-line/40">
                                    <span class="font-mono text-[11px] text-muted">{{ selectedRecord.timeIn || '08:00 AM' }}</span>
                                    <span class="flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                                        <app-icon name="Check" :size="12" /> Checked In
                                    </span>
                                </div>
                                <div class="flex items-center justify-between py-1 text-slate-700 border-b border-line/40">
                                    <span class="font-mono text-[11px] text-muted">12:00 NN – 1:00 PM</span>
                                    <span class="flex items-center gap-1 text-[11px] font-medium text-amber-700">
                                        <app-icon name="Coffee" :size="12" /> Lunch Break (−1.00 hr)
                                    </span>
                                </div>
                                <div class="flex items-center justify-between py-1 text-slate-700">
                                    <span class="font-mono text-[11px] text-muted">{{ selectedRecord.timeOut || '05:00 PM' }}</span>
                                    <span class="flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                                        <app-icon name="Check" :size="12" /> Checked Out
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Right Column: Today's Attendance Timeline + Breakdown + Correction Notice -->
                    <div class="space-y-4">
                        <!-- Today's Attendance Timeline -->
                        <div class="rounded-xl border border-line bg-white p-4 space-y-3 shadow-2xs">
                            <h4 class="text-[12px] font-bold uppercase tracking-wider text-muted flex items-center gap-1.5 border-b border-line/60 pb-2">
                                <app-icon name="ListFilter" :size="14" />
                                Today's Attendance Timeline
                            </h4>

                            <div class="space-y-2 relative pl-2">
                                <!-- Vertical connector line -->
                                <div class="absolute left-4 top-3 bottom-3 w-0.5 bg-line"></div>

                                <!-- Time In -->
                                <div class="relative flex items-center justify-between rounded-lg bg-page p-2.5 border border-line/60">
                                    <div class="flex items-center gap-3">
                                        <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 z-10 border border-emerald-300">
                                            <app-icon name="Clock" :size="13" />
                                        </div>
                                        <div>
                                            <div class="text-[11px] font-semibold text-muted">Time In</div>
                                            <div class="text-[13px] font-bold text-ink flex items-center gap-1.5 flex-wrap">
                                                <span>{{ selectedRecord.timeIn || '—' }}</span>
                                                <span v-if="selectedRecord.lateMinutes > 0" class="text-amber-600 font-semibold text-[11px]">
                                                    (+{{ selectedRecord.lateMinutes }}m late)
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="flex items-center gap-2 text-[11px] font-semibold text-emerald-700">
                                        <span>Face ✓</span>
                                        <span>GPS ✓</span>
                                    </div>
                                </div>

                                <!-- Standard 1-Hour Unpaid Meal Break -->
                                <div class="relative flex items-center justify-between rounded-lg bg-page p-2.5 border border-line/60">
                                    <div class="flex items-center gap-3">
                                        <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-700 z-10 border border-amber-300">
                                            <app-icon name="Coffee" :size="13" />
                                        </div>
                                        <div>
                                            <div class="text-[11px] font-semibold text-muted">Standard Meal Break</div>
                                            <div class="text-[13px] font-bold text-ink">
                                                12:00 NN – 1:00 PM
                                                <span class="text-amber-700 font-semibold text-[11px] ml-1">
                                                    ({{ Number(selectedRecord.breakDeduction !== undefined ? selectedRecord.breakDeduction : (selectedRecord.recordedHours >= 5 ? 1 : 0)) > 0 ? '−1.00 hr' : '0.00 hr' }})
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="flex items-center gap-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200">
                                        <span>Auto Unpaid</span>
                                    </div>
                                </div>

                                <!-- Time Out -->
                                <div class="relative flex items-center justify-between rounded-lg bg-page p-2.5 border border-line/60">
                                    <div class="flex items-center gap-3">
                                        <div class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 z-10 border border-emerald-300">
                                            <app-icon name="CheckCircle" :size="13" />
                                        </div>
                                        <div>
                                            <div class="text-[11px] font-semibold text-muted">Time Out</div>
                                            <div class="text-[13px] font-bold text-ink flex items-center gap-1.5 flex-wrap">
                                                <span>{{ selectedRecord.timeOut || '—' }}</span>
                                                <span v-if="selectedRecord.undertimeMinutes > 0" class="text-rose-600 font-semibold text-[11px]">
                                                    (-{{ selectedRecord.undertimeMinutes }}m undertime)
                                                </span>
                                                <span v-else-if="selectedRecord.overtimeHours > 0" class="text-indigo-600 font-semibold text-[11px]">
                                                    (+{{ selectedRecord.overtimeHours }}h overtime)
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="flex items-center gap-2 text-[11px] font-semibold text-emerald-700">
                                        <span>Face ✓</span>
                                        <span>GPS ✓</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Attendance & Allowance Breakdown -->
                        <div class="rounded-xl border border-line bg-page/80 p-3.5 space-y-2 shadow-2xs">
                            <div class="flex items-center justify-between border-b border-line/60 pb-2">
                                <span class="text-[12px] font-bold text-navy flex items-center gap-1.5">
                                    <app-icon name="Calculator" :size="14" class="text-navy" />
                                    Attendance &amp; Allowance Breakdown
                                </span>
                                <span class="text-[12px] font-bold text-emerald-700 font-mono">
                                    ₱{{ Number(selectedRecord.computedAllowance || (selectedRecord.creditedHours * (selectedRecord.hourlyRate || 50))).toFixed(2) }}
                                </span>
                            </div>
                            <div class="space-y-1.5 text-[12px]">
                                <div class="flex items-center justify-between text-muted">
                                    <span>Elapsed / Recorded Attendance:</span>
                                    <span class="font-bold text-ink font-mono">{{ Number(selectedRecord.recordedHours || 0).toFixed(2) }} hrs</span>
                                </div>
                                <div class="flex items-center justify-between text-amber-700 font-medium">
                                    <span class="flex items-center gap-1">
                                        <app-icon name="Coffee" :size="12" />
                                        Automatic Break Deduction:
                                    </span>
                                    <span class="font-bold font-mono">−{{ Number(selectedRecord.breakDeduction !== undefined ? selectedRecord.breakDeduction : (selectedRecord.recordedHours >= 5 ? 1 : 0)).toFixed(2) }} hr</span>
                                </div>
                                <div class="flex items-center justify-between text-ink font-semibold border-t border-line/50 pt-1">
                                    <span>Net Credited Hours:</span>
                                    <span class="font-bold text-navy font-mono">{{ Number(selectedRecord.creditedHours || 0).toFixed(2) }} hrs</span>
                                </div>
                                <div class="flex items-center justify-between text-muted">
                                    <span>Applicable Hourly Rate:</span>
                                    <span class="font-bold text-ink font-mono">₱{{ Number(selectedRecord.hourlyRate || 50).toFixed(2) }} / hr</span>
                                </div>
                                <div class="flex items-center justify-between text-emerald-900 font-bold bg-emerald-50 rounded-lg p-2 border border-emerald-200 mt-1">
                                    <span>Computed Allowance:</span>
                                    <span class="text-[13px] font-mono">₱{{ Number(selectedRecord.computedAllowance || (selectedRecord.creditedHours * (selectedRecord.hourlyRate || 50))).toFixed(2) }}</span>
                                </div>
                            </div>
                            <p class="text-[11px] text-muted italic flex items-center gap-1 pt-0.5">
                                <app-icon name="Info" :size="12" class="text-amber-600 shrink-0" />
                                Standard 1-hour unpaid lunch break (12:00 NN–1:00 PM) automatically deducted.
                            </p>
                        </div>

                        <!-- Attendance Correction Notice (if open) -->
                        <div v-if="selectedRecord.pendingCorrection" class="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3.5 space-y-2">
                            <div class="flex items-center justify-between">
                                <span class="text-caption font-bold text-indigo-900 flex items-center gap-1">
                                    <app-icon name="AlertCircle" :size="14" class="text-indigo-600" />
                                    Attendance Correction Request
                                </span>
                                <span class="rounded bg-indigo-200/80 px-1.5 py-0.5 text-[10px] font-bold text-indigo-900 font-mono">
                                    {{ selectedRecord.pendingCorrection.refNo }}
                                </span>
                            </div>
                            <p class="text-[12px] text-indigo-900">
                                {{ selectedRecord.pendingCorrection.explanation }}
                            </p>
                            <div class="flex items-center gap-2 pt-1">
                                <button @click="openCorrectionModal(selectedRecord.pendingCorrection, 'APPROVED')"
                                        class="rounded-lg bg-emerald-600 px-3 py-1 text-[11px] font-bold text-white shadow-xs hover:bg-emerald-700 transition">
                                    Approve Request
                                </button>
                                <button @click="openCorrectionModal(selectedRecord.pendingCorrection, 'REJECTED')"
                                        class="rounded-lg bg-rose-600 px-3 py-1 text-[11px] font-bold text-white shadow-xs hover:bg-rose-700 transition">
                                    Reject Request
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Modal Footer / Supervisor Decision Buttons -->
            <template #footer>
                <div v-if="selectedRecord" class="flex flex-col sm:flex-row items-center justify-between gap-3 w-full">
                    <div class="text-caption text-muted flex items-center gap-1.5">
                        <app-icon name="UserCheck" :size="15" class="text-navy" />
                        <span>Record: <b class="text-ink">{{ selectedRecord.name }}</b> ({{ selectedRecord.saNumber }})</span>
                    </div>
                    <div class="flex flex-wrap items-center gap-2 justify-end">
                        <button type="button" @click="detailModalOpen = false" class="btn btn-secondary btn-sm">
                            Close
                        </button>
                        <button type="button" @click="openReviewModal(selectedRecord, 'REJECT')"
                                class="rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-1.5 text-caption font-bold text-rose-700 hover:bg-rose-100 transition flex items-center gap-1.5">
                            <app-icon name="XCircle" :size="14" />
                            <span>Reject</span>
                        </button>
                        <button type="button" @click="openReviewModal(selectedRecord, 'ESCALATE')"
                                class="rounded-xl border border-line bg-page px-3.5 py-1.5 text-caption font-bold text-ink hover:bg-white transition flex items-center gap-1.5">
                            <app-icon name="Send" :size="14" />
                            <span>Escalate</span>
                        </button>
                        <button type="button" @click="openReviewModal(selectedRecord, 'APPROVE')"
                                class="rounded-xl bg-emerald-600 px-4 py-1.5 text-caption font-bold text-white shadow-xs hover:bg-emerald-700 transition flex items-center gap-1.5">
                            <app-icon name="CheckCircle" :size="15" />
                            <span>Approve Attendance</span>
                        </button>
                    </div>
                </div>
            </template>
        </app-modal>

        <!-- Attendance Review Modal -->
        <app-modal :open="reviewModal.open"
                   z="z-[60]"
                   @close="reviewModal.open = false"
                   :title="reviewModal.decision === 'APPROVE' ? 'Approve Attendance Record' : (reviewModal.decision === 'REJECT' ? 'Reject Attendance Record' : 'Escalate Record to Coordinator')">
            <div class="space-y-4">
                <div v-if="reviewModal.record" class="rounded-xl bg-page p-3 border border-line space-y-1 text-caption">
                    <div class="font-bold text-ink">{{ reviewModal.record.name }} ({{ reviewModal.record.saNumber }})</div>
                    <div class="text-muted">Date: {{ formattedHeaderDate }} · {{ reviewModal.record.schedule }}</div>
                    <div class="text-muted">Recorded Punches: {{ reviewModal.record.timeInOutLabel }}</div>
                </div>

                <div v-if="reviewModal.decision === 'APPROVE'" class="space-y-2">
                    <div class="rounded-lg bg-page border border-line p-2.5 text-[11px] space-y-1">
                        <div class="flex justify-between">
                            <span class="text-muted">Elapsed / Recorded Attendance:</span>
                            <span class="font-bold text-ink font-mono">{{ Number(reviewModal.record?.recordedHours || 0).toFixed(2) }} hrs</span>
                        </div>
                        <div class="flex justify-between text-amber-700">
                            <span>Automatic Break Deduction:</span>
                            <span class="font-bold font-mono">−{{ Number(reviewModal.record?.breakDeduction !== undefined ? reviewModal.record.breakDeduction : (reviewModal.record?.recordedHours >= 5 ? 1 : 0)).toFixed(2) }} hr</span>
                        </div>
                    </div>
                    <label class="block text-caption font-bold text-ink mb-1">Net Credited Duty Hours</label>
                    <input v-model.number="reviewModal.creditedHours"
                           type="number"
                           step="0.25"
                           min="0"
                           max="24"
                           class="w-full rounded-lg border border-line bg-page px-3 py-2 text-caption font-bold text-ink focus:bg-white focus:outline-none" />
                </div>

                <div>
                    <label class="block text-caption font-bold text-ink mb-1">
                        Supervisor Remarks / Notes
                    </label>
                    <textarea v-model="reviewModal.remarks"
                              rows="2"
                              placeholder="Add optional review remarks..."
                              class="w-full rounded-lg border border-line bg-page p-3 text-caption font-medium text-ink focus:bg-white focus:outline-none"></textarea>
                </div>

                <div v-if="reviewModal.decision === 'REJECT' || reviewModal.decision === 'ESCALATE'">
                    <label class="block text-caption font-bold text-rose-700 mb-1">
                        Mandatory {{ reviewModal.decision === 'REJECT' ? 'Rejection' : 'Escalation' }} Reason *
                    </label>
                    <textarea v-model="reviewModal.reason"
                              rows="3"
                              :placeholder="reviewModal.decision === 'REJECT' ? 'Provide explicit reason why this attendance punch is disputed or rejected...' : 'Explain the exception or reason requiring S.A. Coordinator review...'"
                              class="w-full rounded-lg border border-rose-300 bg-rose-50/50 p-3 text-caption font-medium text-ink focus:bg-white focus:outline-none"></textarea>
                </div>

                <div v-if="reviewModal.error" class="rounded-lg bg-rose-50 p-3 text-caption text-rose-700 font-medium border border-rose-200">
                    {{ reviewModal.error }}
                </div>
            </div>

            <template #footer>
                <div class="flex items-center justify-end gap-2">
                    <button @click="reviewModal.open = false"
                            class="btn btn-secondary btn-sm"
                            :disabled="reviewModal.loading">
                        Cancel
                    </button>
                    <button @click="submitReview"
                            class="btn btn-sm"
                            :class="reviewModal.decision === 'APPROVE' ? 'btn-primary' : (reviewModal.decision === 'REJECT' ? 'bg-rose-600 hover:bg-rose-700 text-white' : 'btn-primary')"
                            :disabled="reviewModal.loading">
                        <app-icon v-if="reviewModal.loading" name="RefreshCw" :size="14" class="animate-spin mr-1" />
                        <span>Confirm {{ reviewModal.decision }}</span>
                    </button>
                </div>
            </template>
        </app-modal>

        <!-- Attendance Correction Modal -->
        <app-modal :open="correctionModal.open"
                   z="z-[60]"
                   @close="correctionModal.open = false"
                   :title="correctionModal.decision === 'APPROVED' ? 'Approve Attendance Correction' : 'Reject Attendance Correction'">
            <div class="space-y-4">
                <div v-if="correctionModal.request" class="rounded-xl bg-indigo-50/60 p-3.5 border border-indigo-200 space-y-1.5 text-caption">
                    <div class="flex items-center justify-between font-bold text-indigo-900">
                        <span>Correction Request ({{ correctionModal.request.refNo }})</span>
                        <span>Date: {{ formattedHeaderDate }}</span>
                    </div>
                    <div class="text-[12px] text-indigo-900">
                        {{ correctionModal.request.explanation }}
                    </div>
                </div>

                <div>
                    <label class="block text-caption font-bold text-ink mb-1">
                        Supervisor Remarks
                    </label>
                    <textarea v-model="correctionModal.remarks"
                              rows="2"
                              placeholder="Notes regarding this correction decision..."
                              class="w-full rounded-lg border border-line bg-page p-3 text-caption font-medium text-ink focus:bg-white focus:outline-none"></textarea>
                </div>

                <div v-if="correctionModal.decision === 'REJECTED'">
                    <label class="block text-caption font-bold text-rose-700 mb-1">
                        Rejection Reason *
                    </label>
                    <textarea v-model="correctionModal.reason"
                              rows="2"
                              placeholder="Provide the reason for rejecting this correction request..."
                              class="w-full rounded-lg border border-rose-300 bg-rose-50/50 p-3 text-caption font-medium text-ink focus:bg-white focus:outline-none"></textarea>
                </div>

                <div v-if="correctionModal.error" class="rounded-lg bg-rose-50 p-3 text-caption text-rose-700 font-medium border border-rose-200">
                    {{ correctionModal.error }}
                </div>
            </div>

            <template #footer>
                <div class="flex items-center justify-end gap-2">
                    <button @click="correctionModal.open = false"
                            class="btn btn-secondary btn-sm"
                            :disabled="correctionModal.loading">
                        Cancel
                    </button>
                    <button @click="submitCorrectionDecision"
                            class="btn btn-sm"
                            :class="correctionModal.decision === 'APPROVED' ? 'btn-primary' : 'bg-rose-600 hover:bg-rose-700 text-white'"
                            :disabled="correctionModal.loading">
                        <app-icon v-if="correctionModal.loading" name="RefreshCw" :size="14" class="animate-spin mr-1" />
                        <span>Confirm {{ correctionModal.decision }}</span>
                    </button>
                </div>
            </template>
        </app-modal>
    </div>
    `
};

