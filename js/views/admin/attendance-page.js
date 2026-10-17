// Admin Attendance Management View for S.A. Coordinator Account
// Fully functional Daily Attendance Monitoring, Real-time Dashboard,
// Geofence & Facial Verification Tracking, Attendance Reconciliation,
// and XLSX / CSV / PDF-ready Report Exports.

const AdminAttendancePage = {
    components: { AppIcon, PageHeader, AppModal, FormField, StatusBadge, AttendanceMap },

    setup() {
        const loading = Vue.ref(true);
        const loadError = Vue.ref("");
        const selectedDate = Vue.ref(new Date().toISOString().slice(0, 10));
        const dayLabel = Vue.ref("");
        const currentTime = Vue.ref("");

        // Clock timer for real-time live clock at top-right
        let clockTimer = null;
        const updateClock = () => {
            const now = new Date();
            currentTime.value = now.toLocaleTimeString('en-US', { hour12: true });
        };

        // Summary Cards
        const summary = Vue.reactive({
            totalScheduled: 0,
            totalActiveSas: 0,
            presentToday: 0,
            lateToday: 0,
            undertimeToday: 0,
            absentToday: 0,
            forReviewCount: 0,
            pendingCorrections: 0,
            pendingReconciliation: 0,
            presentPct: 0,
            latePct: 0,
            undertimePct: 0,
            absentPct: 0,
            reviewPct: 0
        });

        // Records & Active selection
        const records = Vue.ref([]);
        const selectedRecord = Vue.ref(null);
        const detailLoading = Vue.ref(false);
        const detailData = Vue.ref(null);
        const detailModalOpen = Vue.ref(false);
        const recentActivity = Vue.ref([]);

        // Search & Filters
        const searchQuery = Vue.ref("");
        const areaFilter = Vue.ref("ALL");
        const statusFilter = Vue.ref("ALL");
        const verificationFilter = Vue.ref("ALL");
        const activeTab = Vue.ref("ALL"); // 'ALL' | 'EXCEPTIONS' | 'INCOMPLETE'

        // Pagination
        const page = Vue.ref(1);
        const pageSize = Vue.ref(10);
        const selectedIds = Vue.ref([]);

        // Modals
        const reconcileModal = Vue.ref(false);
        const manualEntryModal = Vue.ref(false);
        const exportModal = Vue.ref(false);
        const savingAction = Vue.ref(false);

        // Reconciliation Form
        const reconcileForm = Vue.reactive({
            saProfileId: null,
            saName: '',
            date: '',
            status: 'PRESENT',
            creditedHours: 0,
            overtimeHours: 0,
            remarks: ''
        });

        // Manual Entry Form
        const manualForm = Vue.reactive({
            saProfileId: '',
            date: '',
            timeIn: '08:00',
            timeOut: '17:00',
            reason: ''
        });

        // Unique Areas / Departments list for filter dropdown
        const availableAreas = Vue.computed(() => {
            const set = new Set();
            for (const r of records.value) {
                if (r.department) set.add(r.department);
                if (r.location && r.location !== 'Campus') set.add(r.location);
            }
            return Array.from(set).sort();
        });

        // Filtered records
        const filteredRecords = Vue.computed(() => {
            let list = records.value;

            // Tab Filter
            if (activeTab.value === 'EXCEPTIONS') {
                list = list.filter(r => r.status === 'LATE' || r.status === 'UNDERTIME' || r.status === 'FOR_REVIEW' || r.status === 'ABSENT' || !r.faceVerified || !r.gpsVerified);
            } else if (activeTab.value === 'INCOMPLETE') {
                list = list.filter(r => r.status === 'INCOMPLETE');
            }

            // Search query (Student ID or Name)
            if (searchQuery.value.trim()) {
                const q = searchQuery.value.toLowerCase().trim();
                list = list.filter(r =>
                    (r.name && r.name.toLowerCase().includes(q)) ||
                    (r.studentId && r.studentId.toLowerCase().includes(q)) ||
                    (r.saNumber && r.saNumber.toLowerCase().includes(q))
                );
            }

            // Area filter
            if (areaFilter.value !== 'ALL') {
                list = list.filter(r => r.department === areaFilter.value || r.location === areaFilter.value);
            }

            // Status filter
            if (statusFilter.value !== 'ALL') {
                list = list.filter(r => r.status === statusFilter.value);
            }

            // Verification filter
            if (verificationFilter.value === 'VERIFIED') {
                list = list.filter(r => r.faceVerified && r.gpsVerified);
            } else if (verificationFilter.value === 'PENDING') {
                list = list.filter(r => !r.faceVerified || !r.gpsVerified || r.status === 'FOR_REVIEW');
            }

            return list;
        });

        // DataTable Sorting & Pagination
        const sortKey = Vue.ref("name");
        const sortDir = Vue.ref("asc");

        const sortBy = (key) => {
            if (sortKey.value === key) {
                sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
            } else {
                sortKey.value = key;
                sortDir.value = "asc";
            }
            page.value = 1;
        };

        const getSortIcon = (key) => {
            if (sortKey.value !== key) return "ChevronsUpDown";
            return sortDir.value === "asc" ? "ChevronUp" : "ChevronDown";
        };

        const sortedRecords = Vue.computed(() => {
            const list = [...filteredRecords.value];
            const key = sortKey.value;
            const dir = sortDir.value === "asc" ? 1 : -1;

            list.sort((a, b) => {
                let res = 0;
                if (key === "name") {
                    res = (a.name || "").localeCompare(b.name || "");
                } else if (key === "studentId") {
                    res = (a.studentId || "").localeCompare(b.studentId || "");
                } else if (key === "department") {
                    res = (a.department || "").localeCompare(b.department || "");
                } else if (key === "schedule") {
                    res = (a.schedule || "").localeCompare(b.schedule || "");
                } else if (key === "timeIn") {
                    res = (a.timeInRaw || a.timeIn || "").localeCompare(b.timeInRaw || b.timeIn || "");
                } else if (key === "timeOut") {
                    res = (a.timeOutRaw || a.timeOut || "").localeCompare(b.timeOutRaw || b.timeOut || "");
                } else if (key === "creditedHours") {
                    res = (Number(a.creditedHours) || 0) - (Number(b.creditedHours) || 0);
                } else if (key === "status") {
                    res = (a.status || "").localeCompare(b.status || "");
                }
                return res * dir;
            });
            return list;
        });

        const totalPages = Vue.computed(() => {
            if (pageSize.value <= 0) return 1;
            return Math.max(1, Math.ceil(sortedRecords.value.length / pageSize.value));
        });

        const paginatedRecords = Vue.computed(() => {
            if (pageSize.value <= 0) return sortedRecords.value;
            const start = (page.value - 1) * pageSize.value;
            return sortedRecords.value.slice(start, start + pageSize.value);
        });

        const rangeText = Vue.computed(() => {
            const total = sortedRecords.value.length;
            if (!total) return "Showing 0 to 0 of 0 entries";
            if (pageSize.value <= 0) return `Showing 1 to ${total} of ${total} entries`;
            const from = (page.value - 1) * pageSize.value + 1;
            const to = Math.min(total, from + pageSize.value - 1);
            return `Showing ${from} to ${to} of ${total} entries`;
        });

        const visiblePages = Vue.computed(() => {
            const total = totalPages.value;
            const current = page.value;
            if (total <= 7) {
                return Array.from({ length: total }, (_, i) => i + 1);
            }
            const pages = [];
            if (current <= 4) {
                for (let i = 1; i <= 5; i++) pages.push(i);
                pages.push("...");
                pages.push(total);
            } else if (current >= total - 3) {
                pages.push(1);
                pages.push("...");
                for (let i = total - 4; i <= total; i++) pages.push(i);
            } else {
                pages.push(1);
                pages.push("...");
                for (let i = current - 1; i <= current + 1; i++) pages.push(i);
                pages.push("...");
                pages.push(total);
            }
            return pages;
        });

        Vue.watch([searchQuery, areaFilter, statusFilter, pageSize], () => {
            page.value = 1;
        });
        Vue.watch(totalPages, n => {
            if (page.value > n) page.value = n;
        });

        const countExceptions = Vue.computed(() => {
            return records.value.filter(r => r.status === 'LATE' || r.status === 'UNDERTIME' || r.status === 'FOR_REVIEW' || r.status === 'ABSENT' || !r.faceVerified || !r.gpsVerified).length;
        });

        const countIncomplete = Vue.computed(() => {
            return records.value.filter(r => r.status === 'INCOMPLETE').length;
        });

        // Load dashboard & daily records from backend API
        const load = async () => {
            loading.value = true;
            loadError.value = "";
            try {
                // 1. Fetch dashboard metrics
                const dashRes = await Model.request('attendance', 'coordinator_dashboard', { date: selectedDate.value });
                if (dashRes && dashRes.success) {
                    Object.assign(summary, dashRes.summaryCards);
                    dayLabel.value = dashRes.dayLabel || selectedDate.value;
                    recentActivity.value = dashRes.recentActivity || [];
                }

                // 2. Fetch daily table records
                const recRes = await Model.request('attendance', 'coordinator_daily_records', { date: selectedDate.value });
                if (recRes && recRes.success) {
                    records.value = recRes.records || [];
                    // Default select the first record or the previously selected one
                    if (records.value.length > 0) {
                        const prevId = selectedRecord.value ? selectedRecord.value.saProfileId : null;
                        const match = records.value.find(r => r.saProfileId === prevId);
                        selectedRecord.value = match || records.value[0];
                    } else {
                        selectedRecord.value = null;
                    }
                } else {
                    loadError.value = recRes?.message || "Failed to load attendance records.";
                }
            } catch (err) {
                loadError.value = err?.message || "An unexpected error occurred while communicating with the server.";
            } finally {
                loading.value = false;
            }
        };

        // Open Detail Modal
        const openRecordDetail = async (rec) => {
            if (!rec) return;
            selectedRecord.value = rec;
            detailModalOpen.value = true;
            detailLoading.value = true;
            try {
                const res = await Model.request('attendance', 'coordinator_record_detail', {
                    saProfileId: rec.saProfileId,
                    date: selectedDate.value
                });
                if (res && res.success && selectedRecord.value && selectedRecord.value.saProfileId === rec.saProfileId) {
                    detailData.value = res;
                }
            } catch (e) {
                console.error("Could not fetch detail:", e);
            } finally {
                detailLoading.value = false;
            }
        };

        const closeDetailModal = () => {
            detailModalOpen.value = false;
            detailData.value = null;
        };

        // Select record for inspector modal
        const selectRecordForInspector = (rec) => {
            openRecordDetail(rec);
        };

        // Open Reconcile Modal
        const openReconcileModal = (rec) => {
            const target = rec || selectedRecord.value;
            if (!target) return;
            reconcileForm.saProfileId = target.saProfileId;
            reconcileForm.saName = target.name;
            reconcileForm.date = selectedDate.value;
            reconcileForm.status = target.status === 'OFF' ? 'PRESENT' : target.status;
            reconcileForm.creditedHours = Number(target.creditedHours) || Number(target.schedHours) || 0;
            reconcileForm.overtimeHours = 0;
            reconcileForm.remarks = '';
            reconcileModal.value = true;
        };

        // Save Reconciliation
        const saveReconciliation = async () => {
            if (!reconcileForm.saProfileId) return;

            const ok = await Alerts.confirm({
                title: "Save Attendance Reconciliation?",
                html: `Reconcile attendance for <b>${Alerts.esc(reconcileForm.saName)}</b> on ${reconcileForm.date}?<br><br>Status: <b>${reconcileForm.status}</b> | Credited Hours: <b>${Number(reconcileForm.creditedHours || 0).toFixed(2)} hrs</b>`,
                confirmText: "Yes, Save Reconciliation",
                requireReason: false
            });
            if (!ok) return;

            savingAction.value = true;
            try {
                const res = await Model.request('attendance', 'coordinator_reconcile_record', {
                    saProfileId: reconcileForm.saProfileId,
                    date: reconcileForm.date,
                    status: reconcileForm.status,
                    creditedHours: reconcileForm.creditedHours,
                    overtimeHours: reconcileForm.overtimeHours,
                    remarks: reconcileForm.remarks
                });
                savingAction.value = false;
                if (res && res.success) {
                    reconcileModal.value = false;
                    await Alerts.success("Reconciliation Saved", res.message || "Attendance reconciled successfully.");
                    load();
                } else {
                    Alerts.error('Reconciliation Failed', res?.message || 'Could not reconcile record.');
                }
            } catch (err) {
                savingAction.value = false;
                Alerts.error('Server Error', err?.message || 'Could not save reconciliation.');
            }
        };

        // Open Manual Attendance Modal
        const openManualModal = (rec) => {
            manualForm.saProfileId = rec ? rec.saProfileId : (records.value[0]?.saProfileId || '');
            manualForm.date = selectedDate.value;
            manualForm.timeIn = '08:00';
            manualForm.timeOut = '17:00';
            manualForm.reason = '';
            manualEntryModal.value = true;
        };

        // Save Manual Attendance
        const saveManualEntry = async () => {
            if (!manualForm.saProfileId) {
                Alerts.warning('Validation Required', 'Please select a Student Assistant.');
                return;
            }
            if (!manualForm.timeIn) {
                Alerts.warning('Validation Required', 'Time In is required.');
                return;
            }

            const ok = await Alerts.confirm({
                title: "Record Manual Attendance?",
                text: `Are you sure you want to manually record attendance on ${manualForm.date}?`,
                confirmText: "Yes, Record Attendance",
                requireReason: false
            });
            if (!ok) return;
            savingAction.value = true;
            try {
                const res = await Model.request('attendance', 'coordinator_manual_entry', {
                    saProfileId: manualForm.saProfileId,
                    date: manualForm.date,
                    timeIn: manualForm.timeIn,
                    timeOut: manualForm.timeOut,
                    reason: manualForm.reason
                });
                savingAction.value = false;
                if (res && res.success) {
                    manualEntryModal.value = false;
                    await Alerts.success("Attendance Recorded", "Attendance record added successfully.");
                    load();
                } else {
                    Alerts.error('Save Failed', res?.message || 'Could not record manual attendance.');
                }
            } catch (err) {
                savingAction.value = false;
                Alerts.error('Server Error', err?.message || 'Could not record manual attendance.');
            }
        };

        // Export Report to CSV / XLSX
        const exportReport = (format = 'CSV') => {
            if (!records.value.length) {
                Alerts.error('Empty Records', 'There are no attendance records to export for this date.');
                return;
            }

            const rows = [
                ['Student ID', 'S.A. Name', 'Department / Area', 'Duty Schedule', 'Time In', 'Time Out', 'Break Deduction (Hours)', 'Recorded Hours', 'Credited Hours', 'Attendance Status', 'Face Verified', 'GPS Verified', 'Location']
            ];

            for (const r of filteredRecords.value) {
                rows.push([
                    `"${r.studentId}"`,
                    `"${r.name}"`,
                    `"${r.department}"`,
                    `"${r.schedule}"`,
                    `"${r.timeIn}"`,
                    `"${r.timeOut}"`,
                    r.breakDeduction !== undefined ? r.breakDeduction : (r.recordedHours >= 5 ? 1.0 : 0.0),
                    r.recordedHours,
                    r.creditedHours,
                    `"${r.status}"`,
                    r.faceVerified ? 'VERIFIED' : 'FAILED / UNVERIFIED',
                    r.gpsVerified ? 'WITHIN GEOFENCE' : 'OUT OF RANGE',
                    `"${r.locationName || r.location}"`
                ]);
            }

            const csvContent = rows.map(e => e.join(',')).join('\n');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `AssistPay_Attendance_${selectedDate.value}.csv`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            Store.toast('success', `Exported ${filteredRecords.value.length} attendance records.`);
        };

        // Date navigation helpers
        const todayDate = new Date().toISOString().slice(0, 10);
        const isHistoricalDate = Vue.computed(() => {
            return selectedDate.value !== todayDate;
        });

        const setToday = () => {
            selectedDate.value = todayDate;
            load();
        };

        const setYesterday = () => {
            const d = new Date();
            d.setDate(d.getDate() - 1);
            selectedDate.value = d.toISOString().slice(0, 10);
            load();
        };

        const prevDay = () => {
            const d = new Date(selectedDate.value);
            d.setDate(d.getDate() - 1);
            selectedDate.value = d.toISOString().slice(0, 10);
            load();
        };

        const nextDay = () => {
            const d = new Date(selectedDate.value);
            d.setDate(d.getDate() + 1);
            selectedDate.value = d.toISOString().slice(0, 10);
            load();
        };

        // Live recent activity silent refresh
        const isRefreshing = Vue.ref(false);
        const refreshActivity = async () => {
            isRefreshing.value = true;
            try {
                const dashRes = await Model.request('attendance', 'coordinator_dashboard', { date: selectedDate.value });
                if (dashRes && dashRes.success) {
                    Object.assign(summary, dashRes.summaryCards);
                    recentActivity.value = dashRes.recentActivity || [];
                }
            } catch (e) {
                console.error("Failed to refresh activity stream:", e);
            } finally {
                setTimeout(() => { isRefreshing.value = false; }, 350);
            }
        };

        // Past recorded dates modal & navigation
        const pastDatesModal = Vue.ref(false);
        const pastDatesLoading = Vue.ref(false);
        const pastDatesList = Vue.ref([]);

        const openPastDatesModal = async () => {
            pastDatesModal.value = true;
            pastDatesLoading.value = true;
            try {
                const res = await Model.request('attendance', 'coordinator_past_dates');
                if (res && res.success) {
                    pastDatesList.value = res.dates || [];
                }
            } catch (e) {
                console.error("Could not fetch past dates:", e);
            } finally {
                pastDatesLoading.value = false;
            }
        };

        const selectPastDate = (dateStr) => {
            selectedDate.value = dateStr;
            pastDatesModal.value = false;
            load();
        };

        // Select S.A. from live activity feed item
        const selectActivitySa = (act) => {
            if (!act) return;
            if (act.date && act.date !== selectedDate.value) {
                selectedDate.value = act.date;
                load().then(() => {
                    const match = records.value.find(r => r.saProfileId === act.saId);
                    if (match) selectRecordForInspector(match);
                });
            } else {
                const match = records.value.find(r => r.saProfileId === act.saId);
                if (match) selectRecordForInspector(match);
            }
        };

        // Lifecycle & Live polling timer
        let liveTimer = null;
        Vue.onMounted(() => {
            updateClock();
            clockTimer = setInterval(updateClock, 1000);
            load();

            // Auto-refresh live attendance feed every 15 seconds when on today's date
            liveTimer = setInterval(() => {
                if (selectedDate.value === todayDate) {
                    refreshActivity();
                }
            }, 15000);
        });

        Vue.onUnmounted(() => {
            if (clockTimer) clearInterval(clockTimer);
            if (liveTimer) clearInterval(liveTimer);
        });

        // Watchers
        Vue.watch(selectedDate, () => {
            page.value = 1;
            load();
        });

        return {
            Store, Format,
            loading, loadError, selectedDate, dayLabel, currentTime,
            todayDate, isHistoricalDate, isRefreshing,
            summary, records, selectedRecord, detailLoading, detailData, detailModalOpen, recentActivity,
            searchQuery, areaFilter, statusFilter, verificationFilter, availableAreas,
            activeTab, countExceptions, countIncomplete,
            filteredRecords, sortedRecords, paginatedRecords, page, pageSize, totalPages, selectedIds,
            sortKey, sortDir, sortBy, getSortIcon, rangeText, visiblePages,
            reconcileModal, manualEntryModal, exportModal, savingAction,
            reconcileForm, manualForm,
            pastDatesModal, pastDatesLoading, pastDatesList,
            load, openRecordDetail, closeDetailModal, selectRecordForInspector,
            openReconcileModal, saveReconciliation,
            openManualModal, saveManualEntry,
            exportReport, setToday, setYesterday, prevDay, nextDay,
            refreshActivity, openPastDatesModal, selectPastDate, selectActivitySa
        };
    },

    template: `
    <div class="space-y-6">

        <!-- 1. Top Section Header with Live Date/Clock & User Pill -->
        <div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between border-b border-line pb-4">
            <div>
                <h1 class="text-2xl font-extrabold tracking-tight text-navy sm:text-3xl">S.A. Attendance Management</h1>
                <p class="mt-1 text-caption text-muted">
                    Monitor attendance records, review exceptions, enforce geofencing, and reconcile hours for payroll allowance.
                </p>
            </div>

            <div class="flex flex-wrap items-center gap-3">
                <!-- Live Date & Clock Pill -->
                <div class="flex items-center gap-2.5 rounded-xl border border-line bg-page px-3.5 py-2 shadow-xs">
                    <app-icon name="Calendar" :size="18" class="text-navy" />
                    <div class="text-right leading-tight">
                        <div class="text-[11px] font-bold uppercase text-muted">{{ dayLabel || selectedDate }}</div>
                        <div class="font-mono text-[14px] font-extrabold text-navy">{{ currentTime }}</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- 2. Summary Dashboard Metric Cards (Top Section as requested) -->
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            <!-- Scheduled S.A.s -->
            <div class="card p-4 flex flex-col justify-between">
                <div class="flex items-center justify-between">
                    <span class="text-[11px] font-bold uppercase text-muted">Scheduled S.A.s</span>
                    <div class="grid h-8 w-8 place-items-center rounded-lg bg-sky-100 text-sky-700">
                        <app-icon name="Users" :size="16" />
                    </div>
                </div>
                <div class="mt-3">
                    <span class="text-2xl font-extrabold text-navy">{{ summary.totalScheduled }}</span>
                    <span class="block text-[10px] text-muted mt-0.5">Total assigned for duty</span>
                </div>
            </div>

            <!-- Present Today -->
            <div class="card p-4 flex flex-col justify-between">
                <div class="flex items-center justify-between">
                    <span class="text-[11px] font-bold uppercase text-muted">Present</span>
                    <div class="grid h-8 w-8 place-items-center rounded-lg bg-emerald-100 text-emerald-700">
                        <app-icon name="CheckCircle2" :size="16" />
                    </div>
                </div>
                <div class="mt-3 flex items-baseline justify-between">
                    <span class="text-2xl font-extrabold text-emerald-600">{{ summary.presentToday }}</span>
                    <span class="text-xs font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">{{ summary.presentPct }}%</span>
                </div>
                <span class="text-[10px] text-muted mt-0.5">Logged attendance</span>
            </div>

            <!-- Late Today -->
            <div class="card p-4 flex flex-col justify-between">
                <div class="flex items-center justify-between">
                    <span class="text-[11px] font-bold uppercase text-muted">Late</span>
                    <div class="grid h-8 w-8 place-items-center rounded-lg bg-amber-100 text-amber-700">
                        <app-icon name="Clock" :size="16" />
                    </div>
                </div>
                <div class="mt-3 flex items-baseline justify-between">
                    <span class="text-2xl font-extrabold text-amber-600">{{ summary.lateToday }}</span>
                    <span class="text-xs font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded">{{ summary.latePct }}%</span>
                </div>
                <span class="text-[10px] text-muted mt-0.5">Beyond grace period</span>
            </div>

            <!-- Undertime Today -->
            <div class="card p-4 flex flex-col justify-between">
                <div class="flex items-center justify-between">
                    <span class="text-[11px] font-bold uppercase text-muted">Undertime</span>
                    <div class="grid h-8 w-8 place-items-center rounded-lg bg-orange-100 text-orange-700">
                        <app-icon name="Clock" :size="16" />
                    </div>
                </div>
                <div class="mt-3 flex items-baseline justify-between">
                    <span class="text-2xl font-extrabold text-orange-600">{{ summary.undertimeToday || 0 }}</span>
                    <span class="text-xs font-bold text-orange-700 bg-orange-50 px-1.5 py-0.5 rounded">{{ summary.undertimePct || 0 }}%</span>
                </div>
                <span class="text-[10px] text-muted mt-0.5">Left before shift end</span>
            </div>

            <!-- Absent / Off -->
            <div class="card p-4 flex flex-col justify-between">
                <div class="flex items-center justify-between">
                    <span class="text-[11px] font-bold uppercase text-muted">Absent / Off</span>
                    <div class="grid h-8 w-8 place-items-center rounded-lg bg-rose-100 text-rose-700">
                        <app-icon name="UserX" :size="16" />
                    </div>
                </div>
                <div class="mt-3 flex items-baseline justify-between">
                    <span class="text-2xl font-extrabold text-rose-600">{{ summary.absentToday }}</span>
                    <span class="text-xs font-bold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded">{{ summary.absentPct }}%</span>
                </div>
                <span class="text-[10px] text-muted mt-0.5">No time-in logged</span>
            </div>

            <!-- For Review / Exceptions -->
            <div class="card p-4 flex flex-col justify-between">
                <div class="flex items-center justify-between">
                    <span class="text-[11px] font-bold uppercase text-muted">For Review</span>
                    <div class="grid h-8 w-8 place-items-center rounded-lg bg-purple-100 text-purple-700">
                        <app-icon name="AlertTriangle" :size="16" />
                    </div>
                </div>
                <div class="mt-3 flex items-baseline justify-between">
                    <span class="text-2xl font-extrabold text-purple-600">{{ summary.forReviewCount }}</span>
                    <span class="text-xs font-bold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded">{{ summary.reviewPct }}%</span>
                </div>
                <span class="text-[10px] text-muted mt-0.5">Biometric/GPS flag</span>
            </div>

            <!-- Pending Corrections -->
            <div class="card p-4 flex flex-col justify-between bg-page/30">
                <div class="flex items-center justify-between">
                    <span class="text-[11px] font-bold uppercase text-muted">Corrections</span>
                    <div class="grid h-8 w-8 place-items-center rounded-lg bg-indigo-100 text-indigo-700">
                        <app-icon name="FileEdit" :size="16" />
                    </div>
                </div>
                <div class="mt-3 flex items-baseline justify-between">
                    <span class="text-2xl font-extrabold text-indigo-600">{{ summary.pendingCorrections }}</span>
                    <router-link to="/admin/requests" class="text-[11px] font-semibold text-indigo-700 hover:underline">
                        View &rarr;
                    </router-link>
                </div>
                <span class="text-[10px] text-muted mt-0.5">Excuse/OT requests</span>
            </div>
        </div>

        <!-- 3. Search, Date Picker, Department Filter & Action Toolbar -->
        <div class="card p-4">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <!-- Search S.A. Name or ID -->
                <div class="relative min-w-[260px] flex-1">
                    <app-icon name="Search" :size="16" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input v-model="searchQuery" type="text" class="input pl-9 text-xs" placeholder="Search S.A. name or Student ID (e.g. 2024-58013)..." />
                </div>

                <div class="flex flex-wrap items-center gap-2">
                    <!-- Date Selector with Prev / Next Quick Step -->
                    <div class="inline-flex items-center rounded-lg border border-line bg-page p-1">
                        <button type="button" @click="prevDay" class="rounded p-1 text-muted hover:bg-white hover:text-ink" title="Previous Day">
                            <app-icon name="ChevronLeft" :size="15" />
                        </button>
                        <input v-model="selectedDate" type="date" class="bg-transparent px-2 py-0.5 text-xs font-bold text-navy focus:outline-none" />
                        <button type="button" @click="nextDay" :disabled="selectedDate >= todayDate" class="rounded p-1 text-muted hover:bg-white hover:text-ink disabled:opacity-30 disabled:cursor-not-allowed" title="Next Day">
                            <app-icon name="ChevronRight" :size="15" />
                        </button>
                        <button type="button" @click="setToday" class="ml-1 rounded px-2 py-0.5 text-[11px] font-bold shadow-xs transition-colors"
                                :class="selectedDate === todayDate ? 'bg-navy text-white' : 'bg-white text-navy hover:bg-mist'">
                            Today
                        </button>
                        <button type="button" @click="setYesterday" class="ml-1 rounded px-2 py-0.5 text-[11px] font-semibold transition-colors"
                                :class="selectedDate !== todayDate ? 'bg-navy/10 text-navy' : 'bg-white text-muted hover:bg-mist'">
                            Yesterday
                        </button>
                    </div>

                    <!-- Past Dates / Attendance History Modal Button -->
                    <button type="button" @click="openPastDatesModal" class="btn btn-secondary btn-sm" title="Browse Past Recorded Attendance Dates">
                        <app-icon name="History" :size="14" /> Previous Records
                    </button>

                    <!-- Area / Department Filter -->
                    <select v-model="areaFilter" class="input py-1.5 text-xs w-auto">
                        <option value="ALL">All Areas / Departments</option>
                        <option v-for="area in availableAreas" :key="area" :value="area">{{ area }}</option>
                    </select>

                    <!-- Status Filter -->
                    <select v-model="statusFilter" class="input py-1.5 text-xs w-auto">
                        <option value="ALL">All Status</option>
                        <option value="PRESENT">Present</option>
                        <option value="LATE">Late</option>
                        <option value="UNDERTIME">Undertime</option>
                        <option value="OVERTIME">Overtime</option>
                        <option value="ABSENT">Absent</option>
                        <option value="INCOMPLETE">Incomplete</option>
                        <option value="FOR_REVIEW">For Review</option>
                    </select>

                    <!-- Export Report Button -->
                    <button type="button" @click="exportReport('CSV')" class="btn btn-primary btn-sm">
                        <app-icon name="Download" :size="14" /> Export Report
                    </button>
                </div>
            </div>
        </div>

        <!-- Historical Date Notice Banner -->
        <div v-if="isHistoricalDate" class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-900 shadow-2xs">
            <div class="flex items-center gap-2.5">
                <div class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-200 text-amber-800">
                    <app-icon name="History" :size="18" />
                </div>
                <div>
                    <span class="font-bold text-[13px]">Viewing Historical Attendance Records:</span>
                    <span class="ml-1.5 font-bold text-navy">{{ dayLabel || selectedDate }}</span>
                    <span class="block text-[11px] text-amber-800 mt-0.5">You are currently reviewing previous S.A. attendance records and logged hours.</span>
                </div>
            </div>
            <div class="flex items-center gap-2">
                <button type="button" @click="openPastDatesModal" class="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-amber-900 shadow-2xs hover:bg-amber-100 transition-colors">
                    <app-icon name="Calendar" :size="12" /> Other Dates
                </button>
                <button type="button" @click="setToday" class="inline-flex items-center gap-1.5 rounded-lg bg-navy px-3 py-1.5 text-[11px] font-bold text-white shadow-2xs hover:bg-navy-700 transition-colors">
                    <app-icon name="ArrowLeft" :size="12" /> Back to Today's Live Attendance
                </button>
            </div>
        </div>

        <!-- 4. Daily Attendance Monitoring Table (Full Width) -->
        <div class="card overflow-hidden w-full">
            <div v-if="loading" class="space-y-3 p-6" aria-busy="true">
                <div v-for="n in 6" :key="n" class="h-10 animate-pulse rounded-lg bg-page"></div>
            </div>

            <div v-else-if="loadError" class="p-8 text-center text-danger">
                <app-icon name="CircleAlert" :size="32" class="mx-auto" />
                <p class="mt-2 text-sm font-semibold">{{ loadError }}</p>
                <button type="button" @click="load" class="btn btn-secondary btn-sm mt-3">Try again</button>
            </div>

            <div v-else>
                <!-- DataTable Top Toolbar: Page Size Selector & Count Badge -->
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line px-4 py-3 bg-mist/30">
                    <div class="flex items-center gap-2 text-caption text-muted">
                        <span class="font-medium text-ink">Show</span>
                        <select v-model.number="pageSize" class="rounded-md border border-line bg-white px-2.5 py-1 text-[12px] font-semibold text-ink shadow-2xs focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy">
                            <option :value="10">10</option>
                            <option :value="25">25</option>
                            <option :value="50">50</option>
                            <option :value="100">100</option>
                            <option :value="0">All</option>
                        </select>
                        <span>entries per page</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1 text-[11px] font-medium text-muted shadow-2xs">
                            <span class="h-2 w-2 rounded-full bg-navy"></span>
                            <b class="text-ink">{{ sortedRecords.length }}</b> total records
                        </span>
                    </div>
                </div>

                <div class="overflow-x-auto">
                    <table class="w-full text-left text-xs">
                        <thead class="border-b border-line bg-page text-[11px] font-bold uppercase text-muted select-none">
                            <tr>
                                <th class="py-3 px-3 whitespace-nowrap min-w-[180px]">
                                    <button type="button" @click="sortBy('name')" class="inline-flex items-center gap-1 text-left font-bold uppercase hover:text-navy transition-colors">
                                        S.A. Name / ID
                                        <app-icon :name="getSortIcon('name')" :size="13" :class="sortKey === 'name' ? 'text-navy font-bold' : 'text-disabled'" />
                                    </button>
                                </th>
                                <th class="py-3 px-3 whitespace-nowrap min-w-[140px]">
                                    <button type="button" @click="sortBy('department')" class="inline-flex items-center gap-1 text-left font-bold uppercase hover:text-navy transition-colors">
                                        Area / Dept
                                        <app-icon :name="getSortIcon('department')" :size="13" :class="sortKey === 'department' ? 'text-navy font-bold' : 'text-disabled'" />
                                    </button>
                                </th>
                                <th class="py-3 px-3 whitespace-nowrap">
                                    <button type="button" @click="sortBy('schedule')" class="inline-flex items-center gap-1 text-left font-bold uppercase hover:text-navy transition-colors">
                                        Schedule
                                        <app-icon :name="getSortIcon('schedule')" :size="13" :class="sortKey === 'schedule' ? 'text-navy font-bold' : 'text-disabled'" />
                                    </button>
                                </th>
                                <th class="py-3 px-2 text-center whitespace-nowrap">
                                    <button type="button" @click="sortBy('timeIn')" class="inline-flex items-center justify-center gap-1 font-bold uppercase hover:text-navy transition-colors">
                                        Time In
                                        <app-icon :name="getSortIcon('timeIn')" :size="13" :class="sortKey === 'timeIn' ? 'text-navy font-bold' : 'text-disabled'" />
                                    </button>
                                </th>
                                <th class="py-3 px-2 text-center whitespace-nowrap">
                                    <button type="button" @click="sortBy('timeOut')" class="inline-flex items-center justify-center gap-1 font-bold uppercase hover:text-navy transition-colors">
                                        Time Out
                                        <app-icon :name="getSortIcon('timeOut')" :size="13" :class="sortKey === 'timeOut' ? 'text-navy font-bold' : 'text-disabled'" />
                                    </button>
                                </th>
                                <th class="py-3 px-2 text-center whitespace-nowrap">Meal Break</th>
                                <th class="py-3 px-2 text-center whitespace-nowrap">
                                    <button type="button" @click="sortBy('creditedHours')" class="inline-flex items-center justify-center gap-1 font-bold uppercase hover:text-navy transition-colors">
                                        Hours
                                        <app-icon :name="getSortIcon('creditedHours')" :size="13" :class="sortKey === 'creditedHours' ? 'text-navy font-bold' : 'text-disabled'" />
                                    </button>
                                </th>
                                <th class="py-3 px-2 text-center whitespace-nowrap">
                                    <button type="button" @click="sortBy('status')" class="inline-flex items-center justify-center gap-1 font-bold uppercase hover:text-navy transition-colors">
                                        Status
                                        <app-icon :name="getSortIcon('status')" :size="13" :class="sortKey === 'status' ? 'text-navy font-bold' : 'text-disabled'" />
                                    </button>
                                </th>
                                <th class="py-3 px-2 text-center whitespace-nowrap">Verification</th>
                                <th class="py-3 px-3 text-right whitespace-nowrap">Actions</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-line">
                            <tr v-if="!paginatedRecords.length">
                                <td colspan="10" class="py-12 text-center text-muted">
                                    No attendance records found matching the current date and filters.
                                </td>
                            </tr>

                            <tr v-for="rec in paginatedRecords" :key="rec.saProfileId"
                                @click="openRecordDetail(rec)"
                                class="cursor-pointer transition-colors hover:bg-page/50"
                                :class="selectedRecord && selectedRecord.saProfileId === rec.saProfileId ? 'bg-navy/5 font-medium' : ''">

                                <!-- Name & ID -->
                                <td class="py-2.5 px-3 whitespace-nowrap min-w-[180px]">
                                    <div class="font-bold text-ink whitespace-nowrap">{{ rec.name }}</div>
                                    <div class="text-[11px] font-mono text-muted whitespace-nowrap">{{ rec.studentId }}</div>
                                </td>

                                <!-- Area / Dept -->
                                <td class="py-2.5 px-3 whitespace-nowrap min-w-[140px]">
                                    <div class="font-medium text-ink whitespace-nowrap">{{ rec.department }}</div>
                                    <div class="text-[10px] text-muted whitespace-nowrap">{{ rec.location }}</div>
                                </td>

                                <!-- Schedule -->
                                <td class="py-2.5 px-3">
                                    <span class="inline-flex items-center rounded-md bg-page px-2 py-0.5 text-[11px] font-semibold text-navy">
                                        {{ rec.schedule }}
                                    </span>
                                </td>

                                <!-- Time In -->
                                <td class="py-2.5 px-2 text-center font-mono font-semibold"
                                    :class="rec.timeIn !== '—' ? 'text-emerald-700' : 'text-muted'">
                                    <div>{{ rec.timeIn }}</div>
                                    <div v-if="rec.lateMinutes > 0" class="text-[10px] text-amber-600 font-semibold" title="Arrived after grace period">
                                        (+{{ rec.lateMinutes }}m late)
                                    </div>
                                </td>

                                <!-- Time Out -->
                                <td class="py-2.5 px-2 text-center font-mono font-semibold"
                                    :class="rec.timeOut !== '—' ? 'text-navy' : 'text-muted'">
                                    <div>{{ rec.timeOut }}</div>
                                    <div v-if="rec.undertimeMinutes > 0" class="text-[10px] text-rose-600 font-semibold" title="Left before scheduled end time">
                                        (-{{ rec.undertimeMinutes }}m early)
                                    </div>
                                    <div v-else-if="rec.overtimeHours > 0" class="text-[10px] text-indigo-600 font-semibold" title="Overtime duty beyond scheduled hours">
                                        (+{{ rec.overtimeHours }}h OT)
                                    </div>
                                </td>

                                <!-- Meal Break Deduction -->
                                <td class="py-2.5 px-2 text-center font-mono">
                                    <span v-if="Number(rec.breakDeduction !== undefined ? rec.breakDeduction : (rec.recordedHours >= 5 ? 1 : 0)) > 0"
                                          class="inline-flex items-center text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full"
                                          title="Standard 1-hour unpaid lunch break (12:00 NN–1:00 PM) automatically deducted">
                                        −1.0h
                                    </span>
                                    <span v-else class="text-muted text-[11px]">—</span>
                                </td>

                                <!-- Recorded / Credited Hours -->
                                <td class="py-2.5 px-2 text-center">
                                    <div class="font-bold text-ink">{{ rec.creditedHours.toFixed(1) }}h</div>
                                    <div class="text-[10px] text-muted" title="Raw recorded hours">({{ rec.recordedHours.toFixed(1) }}h)</div>
                                </td>

                                <!-- Status Badge -->
                                <td class="py-2.5 px-2 text-center">
                                    <span v-if="rec.status === 'PRESENT'" class="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
                                        ● Present
                                    </span>
                                    <span v-else-if="rec.status === 'LATE'" class="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-800">
                                        ● Late ({{ rec.lateMinutes }}m)
                                    </span>
                                    <span v-else-if="rec.status === 'UNDERTIME'" class="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-[10px] font-bold text-rose-800">
                                        ● Undertime ({{ rec.undertimeMinutes }}m)
                                    </span>
                                    <span v-else-if="rec.status === 'OVERTIME'" class="inline-flex items-center rounded-full bg-indigo-100 px-2.5 py-0.5 text-[10px] font-bold text-indigo-800">
                                        ● Overtime (+{{ rec.overtimeHours }}h)
                                    </span>
                                    <span v-else-if="rec.status === 'INCOMPLETE'" class="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-bold text-amber-800">
                                        ● Incomplete
                                    </span>
                                    <span v-else-if="rec.status === 'FOR_REVIEW'" class="inline-flex items-center rounded-full bg-purple-100 px-2.5 py-0.5 text-[10px] font-bold text-purple-800">
                                        ● For Review
                                    </span>
                                    <span v-else-if="rec.status === 'ABSENT'" class="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-[10px] font-bold text-rose-800">
                                        ● Absent
                                    </span>
                                    <span v-else class="inline-flex items-center rounded-full bg-gray-100 px-2.5 py-0.5 text-[10px] font-medium text-muted">
                                        Off
                                    </span>
                                </td>

                                <!-- Verification Status (Face + GPS) -->
                                <td class="py-2.5 px-2 text-center">
                                    <div class="inline-flex flex-col items-start text-[10px] leading-tight">
                                        <span class="flex items-center gap-1 font-semibold"
                                              :class="rec.faceVerified ? 'text-emerald-700' : 'text-rose-600'">
                                            <app-icon name="ScanFace" :size="12" /> Face {{ rec.faceVerified ? '✓' : '✗' }}
                                        </span>
                                        <span class="flex items-center gap-1 font-semibold"
                                              :class="rec.gpsVerified ? 'text-emerald-700' : 'text-rose-600'">
                                            <app-icon name="MapPin" :size="12" /> GPS {{ rec.gpsVerified ? '✓' : '✗' }}
                                        </span>
                                    </div>
                                </td>

                                <!-- Actions -->
                                <td class="py-2.5 px-3 text-right">
                                    <div class="flex items-center justify-end gap-1.5" @click.stop>
                                        <button type="button" @click="openRecordDetail(rec)" class="btn btn-secondary btn-sm py-1 px-2.5 text-[11px] font-semibold flex items-center gap-1" title="View Record Details">
                                            <span>View</span>
                                            <app-icon name="ChevronRight" :size="12" />
                                        </button>
                                        <button type="button" @click="openReconcileModal(rec)" class="btn btn-ghost btn-sm py-1 px-1.5 text-navy hover:bg-mist" title="Reconcile Attendance">
                                            <app-icon name="Scale" :size="14" />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <!-- DataTable Footer: Showing X to Y of Z & Pagination controls -->
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-line px-4 py-3 bg-white text-xs text-muted">
                    <p class="text-caption text-muted" aria-live="polite">
                        {{ rangeText }}
                    </p>

                    <nav v-if="totalPages > 1" class="flex items-center gap-1" aria-label="Pagination Navigation">
                        <button type="button" @click="page--" :disabled="page <= 1"
                                class="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-[11px] font-semibold text-ink shadow-2xs hover:bg-page disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                aria-label="Previous page">
                            <app-icon name="ChevronLeft" :size="13" /> Prev
                        </button>

                        <template v-for="(p, idx) in visiblePages" :key="idx">
                            <span v-if="p === '...'" class="px-1.5 text-caption text-muted select-none">…</span>
                            <button v-else type="button" @click="page = p"
                                    :aria-current="page === p ? 'page' : null"
                                    class="h-7 min-w-7 rounded-md px-1.5 text-[11px] font-semibold transition-colors"
                                    :class="page === p ? 'bg-navy text-white shadow-2xs' : 'border border-line bg-white text-ink hover:bg-page'">
                                {{ p }}
                            </button>
                        </template>

                        <button type="button" @click="page++" :disabled="page >= totalPages"
                                class="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-[11px] font-semibold text-ink shadow-2xs hover:bg-page disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                aria-label="Next page">
                            Next <app-icon name="ChevronRight" :size="13" />
                        </button>
                    </nav>
                </div>
            </div>
        </div>

        <!-- 5. Recent Attendance Activity Stream Card (Live Feed) -->
        <div class="card p-5">
            <div class="flex items-center justify-between border-b border-line pb-3 mb-3">
                <div class="flex items-center gap-2 text-xs font-bold text-navy">
                    <span class="relative flex h-2 w-2">
                        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    <app-icon name="Activity" :size="16" /> Recent Attendance Activity Feed
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" @click="refreshActivity" class="text-[11px] font-semibold text-navy hover:text-navy/70 flex items-center gap-1" title="Refresh Live Activity Feed">
                        <app-icon name="RefreshCw" :size="12" :class="isRefreshing ? 'animate-spin' : ''" />
                    </button>
                    <span class="text-[10px] font-semibold text-muted bg-page px-2 py-0.5 rounded-full border border-line">
                        {{ recentActivity.length }} logged events
                    </span>
                </div>
            </div>

            <div v-if="!recentActivity.length" class="py-6 text-center text-xs text-muted">
                No recent attendance activity stream recorded yet.
            </div>

            <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-[360px] overflow-y-auto pr-1">
                <div v-for="act in recentActivity" :key="act.id"
                     @click="selectActivitySa(act)"
                     class="flex items-start justify-between rounded-lg border border-line bg-page/40 p-2.5 text-xs transition-colors hover:bg-page cursor-pointer hover:border-navy/40"
                     :class="selectedRecord && selectedRecord.saProfileId === act.saId ? 'bg-navy/10 border-navy/50 font-medium' : ''"
                     title="Click to view details for this Student Assistant">
                    <div class="flex items-start gap-2.5">
                        <div class="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-white text-[11px] font-bold shadow-2xs"
                             :class="act.status === 'VERIFIED' ? 'bg-emerald-600' : 'bg-rose-600'">
                            {{ act.name.charAt(0) }}
                        </div>
                        <div>
                            <div class="font-bold text-ink leading-tight flex items-center gap-1.5">
                                <span>{{ act.name }}</span>
                                <span class="text-[10px] font-mono text-muted">({{ act.studentId }})</span>
                            </div>
                            <div class="text-[11px] text-muted flex flex-wrap items-center gap-1.5 mt-1">
                                <span class="rounded px-1.5 py-0.2 font-semibold text-[10px]"
                                      :class="{
                                          'bg-emerald-100 text-emerald-800': act.logType === 'CHECK_IN',
                                          'bg-amber-100 text-amber-800': act.logType === 'BREAK_OUT' || act.logType === 'BREAK_IN',
                                          'bg-sky-100 text-sky-800': act.logType === 'CHECK_OUT'
                                      }">
                                    {{ act.label }}
                                </span>
                                <span>&bull;</span>
                                <span class="truncate max-w-[140px]">{{ act.locationName }}</span>
                            </div>
                        </div>
                    </div>
                    <div class="text-right shrink-0">
                        <span class="font-mono text-[11px] font-bold text-navy block">{{ act.displayTime || act.time }}</span>
                        <span class="text-[10px] font-semibold" :class="act.status === 'VERIFIED' ? 'text-emerald-700' : 'text-rose-600'">
                            {{ act.status === 'VERIFIED' ? '✓ Verified' : '⚠ Flagged' }}
                        </span>
                    </div>
                </div>
            </div>
        </div>

        <!-- 6. Modal: S.A. Attendance Record Details & Geofencing / Verification Inspector -->
        <app-modal :open="detailModalOpen"
                   @close="closeDetailModal"
                   size="xl"
                   title="S.A. Attendance Record Details"
                   icon="ClipboardCheck"
                   tone="navy"
                   :description="selectedRecord ? (selectedRecord.name + ' (' + selectedRecord.studentId + ') — ' + (dayLabel || selectedDate)) : ''">
            <div v-if="selectedRecord" class="space-y-5 text-xs">
                <!-- 1. S.A. Summary Header Banner -->
                <div class="rounded-xl border border-line bg-page p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div class="flex items-center gap-3.5">
                        <span class="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-navy text-white text-base font-bold shadow-xs overflow-hidden">
                            <img v-if="selectedRecord.photoUrl || (detailData && detailData.sa && detailData.sa.biometricPhoto)" :src="selectedRecord.photoUrl || (detailData && detailData.sa && detailData.sa.biometricPhoto)" class="h-full w-full object-cover" />
                            <span v-else>{{ selectedRecord.name.charAt(0).toUpperCase() }}</span>
                        </span>
                        <div>
                            <div class="flex items-center gap-2">
                                <h3 class="font-bold text-ink text-[16px]">{{ selectedRecord.name }}</h3>
                                <span v-if="selectedRecord.status === 'PRESENT'" class="inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-bold text-emerald-800">
                                    Present
                                </span>
                                <span v-else-if="selectedRecord.status === 'LATE'" class="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800">
                                    Late
                                </span>
                                <span v-else-if="selectedRecord.status === 'INCOMPLETE'" class="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800">
                                    Incomplete
                                </span>
                                <span v-else class="inline-flex items-center rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-800">
                                    {{ selectedRecord.status }}
                                </span>
                            </div>
                            <div class="text-[12px] text-muted flex flex-wrap items-center gap-2 mt-0.5">
                                <span class="font-mono font-semibold">{{ selectedRecord.studentId }}</span>
                                <span>&bull;</span>
                                <span>{{ selectedRecord.department }}</span>
                                <template v-if="detailData && detailData.sa">
                                    <span>&bull;</span>
                                    <span>{{ detailData.sa.course }} (Yr {{ detailData.sa.yearLevel }})</span>
                                    <span>&bull;</span>
                                    <span class="text-navy font-semibold">Supervisor: {{ detailData.sa.supervisor }}</span>
                                </template>
                            </div>
                        </div>
                    </div>
                    <div class="text-left sm:text-right">
                        <div class="text-[11px] font-semibold text-muted">Official Duty Schedule</div>
                        <div class="font-bold text-navy text-[13px]">{{ selectedRecord.schedule }}</div>
                        <div v-if="detailData && detailData.sa" class="text-[11px] text-muted mt-0.5">
                            Hourly Rate: <b class="text-navy font-mono">₱{{ Number(detailData.sa.hourlyRate || 50).toFixed(2) }}/hr</b>
                        </div>
                    </div>
                </div>

                <!-- 2-Column Responsive Grid Inside Modal -->
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
                    <!-- Left Column: Current Location & Geofence Map + Biometric Snapshot + Shifts -->
                    <div class="space-y-4">
                        <!-- Current Location & Leaflet Geofence Map Card -->
                        <div class="rounded-xl border border-line bg-white p-4 space-y-2.5 shadow-2xs">
                            <div class="flex items-center justify-between">
                                <div class="flex items-center gap-1.5 text-xs font-bold text-navy">
                                    <app-icon name="MapPin" :size="15" /> Current Location &amp; Geofence
                                </div>
                                <span class="text-[10px] font-semibold text-muted">Radius: 1,000m (1km)</span>
                            </div>

                            <!-- Real Interactive Geofence Map GUI -->
                            <attendance-map 
                                :campus-lat="14.327472"
                                :campus-lng="120.940472"
                                :campus-name="selectedRecord.locationName && selectedRecord.locationName !== '—' ? selectedRecord.locationName : 'NCST Main Campus'"
                                :radius-meters="1000"
                                :user-lat="selectedRecord.latitude !== null && selectedRecord.latitude !== undefined ? selectedRecord.latitude : (selectedRecord.gpsVerified ? 14.3279 : 14.3410)"
                                :user-lng="selectedRecord.longitude !== null && selectedRecord.longitude !== undefined ? selectedRecord.longitude : (selectedRecord.gpsVerified ? 120.9410 : 120.9550)"
                                :user-name="selectedRecord.name"
                                :is-inside="!!selectedRecord.gpsVerified"
                                :distance-meters="selectedRecord.distanceMeters || 0"
                                :dark="false"
                                height="h-44 sm:h-52" />

                            <div class="flex items-center justify-between text-xs px-1 pt-1">
                                <div class="text-left">
                                    <div class="text-[11px] font-semibold text-muted">Campus Geofence Status</div>
                                    <div class="font-bold text-navy flex items-center gap-1">
                                        <app-icon :name="selectedRecord.gpsVerified ? 'CheckCircle2' : 'CircleX'" :size="14" :class="selectedRecord.gpsVerified ? 'text-emerald-600' : 'text-rose-600'" />
                                        {{ selectedRecord.gpsVerified ? 'Inside Authorized Range' : 'Out of Geofence Range' }}
                                    </div>
                                </div>
                                <div class="text-right">
                                    <div class="text-[11px] font-semibold text-muted">Recorded Distance</div>
                                    <div class="font-mono font-bold text-ink">{{ Math.round(selectedRecord.distanceMeters || 0) }}m away</div>
                                </div>
                            </div>
                        </div>

                        <!-- Snapshot & Photo Preview if logged -->
                        <div v-if="selectedRecord.photoUrl || (detailData && detailData.sa && detailData.sa.biometricPhoto)" class="rounded-xl border border-line bg-white p-3.5 space-y-2 shadow-2xs">
                            <div class="text-[11px] font-bold uppercase text-muted flex items-center gap-1.5">
                                <app-icon name="ScanFace" :size="14" /> Biometric Capture Snapshot
                            </div>
                            <div class="flex items-center gap-3 rounded-lg border border-line bg-page p-2.5">
                                <img :src="selectedRecord.photoUrl || (detailData && detailData.sa && detailData.sa.biometricPhoto)" alt="Snapshot" class="h-14 w-14 rounded-lg object-cover border border-line" />
                                <div class="text-xs">
                                    <div class="font-bold text-ink">Face Verification Match</div>
                                    <div class="text-[11px] text-muted">Confidence: <b class="text-emerald-700">{{ selectedRecord.confidenceScore || 98 }}%</b></div>
                                    <div class="text-[10px] text-muted mt-0.5 flex items-center gap-2">
                                        <span :class="selectedRecord.faceVerified ? 'text-emerald-700 font-semibold' : 'text-rose-600 font-semibold'">Face {{ selectedRecord.faceVerified ? '✓ Verified' : '✗ Failed' }}</span>
                                        <span>&bull;</span>
                                        <span :class="selectedRecord.gpsVerified ? 'text-emerald-700 font-semibold' : 'text-rose-600 font-semibold'">GPS {{ selectedRecord.gpsVerified ? '✓ Inside' : '✗ Out of Range' }}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Scheduled Official Shifts -->
                        <div v-if="detailData && detailData.duties && detailData.duties.length" class="rounded-xl border border-line bg-white p-3.5 space-y-2 shadow-2xs">
                            <div class="font-bold text-navy text-[11px] uppercase tracking-wider flex items-center gap-1.5">
                                <app-icon name="Calendar" :size="14" /> Official Published Shifts
                            </div>
                            <div v-for="d in detailData.duties" :key="d.id" class="rounded border border-line bg-page/40 p-2 flex items-center justify-between text-xs">
                                <div>
                                    <div class="font-bold text-ink">{{ d.location }} ({{ d.department }})</div>
                                    <div class="text-[11px] text-muted">{{ d.startFormatted }} - {{ d.endFormatted }}</div>
                                </div>
                                <span class="font-bold text-navy">{{ d.hours }} hrs</span>
                            </div>
                        </div>
                    </div>

                    <!-- Right Column: Today's Attendance Timeline + Allowance Breakdown + Requests -->
                    <div class="space-y-4">
                        <!-- Today's Attendance Timeline -->
                        <div class="rounded-xl border border-line bg-white p-4 space-y-3 shadow-2xs">
                            <div class="flex items-center gap-1.5 text-xs font-bold text-navy border-b border-line pb-2">
                                <app-icon name="Clock" :size="15" /> Today's Attendance Timeline
                            </div>

                            <div class="space-y-2.5 text-xs">
                                <!-- Time In -->
                                <div class="flex items-center justify-between rounded-lg border border-line bg-page p-2.5">
                                    <div class="flex items-center gap-2.5">
                                        <div class="grid h-8 w-8 place-items-center rounded bg-emerald-100 text-emerald-800">
                                            <app-icon name="LogIn" :size="15" />
                                        </div>
                                        <div>
                                            <div class="font-bold text-ink">Time In</div>
                                            <div class="text-[10px] text-muted">{{ selectedRecord.scheduledStart }} (Scheduled)</div>
                                        </div>
                                    </div>
                                    <div class="text-right font-mono font-bold text-emerald-700 text-[13px]">
                                        {{ selectedRecord.timeIn }}
                                    </div>
                                </div>

                                <!-- Meal Break (Automatic) -->
                                <div class="flex items-center justify-between rounded-lg border border-line bg-page p-2.5">
                                    <div class="flex items-center gap-2.5">
                                        <div class="grid h-8 w-8 place-items-center rounded bg-amber-50 text-amber-700">
                                            <app-icon name="Coffee" :size="15" />
                                        </div>
                                        <div>
                                            <div class="font-bold text-ink">Meal Break (Automatic)</div>
                                            <div class="text-[10px] text-muted">12:00 NN – 1:00 PM (Unpaid)</div>
                                        </div>
                                    </div>
                                    <div class="text-right font-mono">
                                        <span v-if="Number(selectedRecord.breakDeduction !== undefined ? selectedRecord.breakDeduction : (selectedRecord.recordedHours >= 5 ? 1 : 0)) > 0" class="badge badge-warning text-[11px] font-bold">
                                            -{{ Number(selectedRecord.breakDeduction !== undefined ? selectedRecord.breakDeduction : 1.0).toFixed(2) }}h Break
                                        </span>
                                        <span v-else class="text-muted text-[11px]">No break deducted</span>
                                    </div>
                                </div>

                                <!-- Time Out -->
                                <div class="flex items-center justify-between rounded-lg border border-line bg-page p-2.5">
                                    <div class="flex items-center gap-2.5">
                                        <div class="grid h-8 w-8 place-items-center rounded bg-navy text-white">
                                            <app-icon name="LogOut" :size="15" />
                                        </div>
                                        <div>
                                            <div class="font-bold text-ink">Time Out</div>
                                            <div class="text-[10px] text-muted">{{ selectedRecord.scheduledEnd }} (Scheduled)</div>
                                        </div>
                                    </div>
                                    <div class="text-right font-mono font-bold text-navy text-[13px]">
                                        {{ selectedRecord.timeOut }}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Credited Hours & Allowance Breakdown -->
                        <div class="rounded-xl border border-line bg-page/80 p-3.5 space-y-2 shadow-2xs text-xs">
                            <div class="flex items-center justify-between border-b border-line/60 pb-2">
                                <span class="font-bold text-navy flex items-center gap-1.5">
                                    <app-icon name="Calculator" :size="14" class="text-navy" />
                                    Hours &amp; Allowance Breakdown
                                </span>
                                <span class="font-bold text-emerald-700 font-mono">
                                    ₱{{ Number((selectedRecord.creditedHours || 0) * (detailData?.sa?.hourlyRate || selectedRecord.hourlyRate || 50)).toFixed(2) }}
                                </span>
                            </div>
                            <div class="space-y-1.5">
                                <div class="flex items-center justify-between text-muted">
                                    <span>Recorded Attendance:</span>
                                    <span class="font-bold text-ink font-mono">{{ Number(selectedRecord.recordedHours || 0).toFixed(2) }} hrs</span>
                                </div>
                                <div class="flex items-center justify-between text-amber-700 font-medium">
                                    <span>Automatic Lunch Deduction:</span>
                                    <span class="font-bold font-mono">−{{ Number(selectedRecord.breakDeduction !== undefined ? selectedRecord.breakDeduction : (selectedRecord.recordedHours >= 5 ? 1 : 0)).toFixed(2) }} hr</span>
                                </div>
                                <div class="flex items-center justify-between text-ink font-semibold border-t border-line/50 pt-1">
                                    <span>Net Credited Hours:</span>
                                    <span class="font-bold text-navy font-mono">{{ Number(selectedRecord.creditedHours || 0).toFixed(2) }} hrs</span>
                                </div>
                                <div class="flex items-center justify-between text-muted">
                                    <span>Applicable Rate:</span>
                                    <span class="font-bold text-ink font-mono">₱{{ Number(detailData?.sa?.hourlyRate || selectedRecord.hourlyRate || 50).toFixed(2) }} / hr</span>
                                </div>
                            </div>
                        </div>

                        <!-- Related Excuse / Overtime Requests -->
                        <div v-if="detailData && detailData.requests && detailData.requests.length" class="rounded-xl border border-line bg-white p-3.5 space-y-2 shadow-2xs text-xs">
                            <div class="font-bold text-navy text-[11px] uppercase tracking-wider flex items-center gap-1.5">
                                <app-icon name="FileText" :size="14" /> Related Filed Requests
                            </div>
                            <div v-for="req in detailData.requests" :key="req.id" class="rounded border border-line bg-page/40 p-2 flex items-center justify-between">
                                <div>
                                    <div class="font-bold text-ink">{{ req.request_ref_no }} &bull; {{ req.request_type }}</div>
                                    <div class="text-[11px] text-muted">{{ req.explanation }}</div>
                                </div>
                                <span class="font-bold px-2 py-0.5 rounded text-[10px]" :class="req.status === 'RECORDED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'">
                                    {{ req.status }}
                                </span>
                            </div>
                        </div>

                        <!-- Previous Attendance Records -->
                        <div v-if="detailData && detailData.pastHistory && detailData.pastHistory.length" class="rounded-xl border border-line bg-white p-3.5 space-y-2 shadow-2xs text-xs">
                            <div class="font-bold text-navy text-[11px] uppercase tracking-wider flex items-center justify-between">
                                <span class="flex items-center gap-1.5"><app-icon name="History" :size="14" /> Previous Attendance Records</span>
                                <span class="text-[10px] text-muted font-normal">Past duty dates</span>
                            </div>
                            <div class="space-y-1.5 max-h-[140px] overflow-y-auto pr-1">
                                <div v-for="h in detailData.pastHistory" :key="h.date"
                                     @click="selectedDate = h.date; closeDetailModal(); load();"
                                     class="rounded border border-line bg-page/40 p-2 flex items-center justify-between hover:bg-page hover:border-navy cursor-pointer transition-colors"
                                     title="Click to jump to this date's records">
                                    <div class="flex items-center gap-2">
                                        <span class="font-bold text-ink">{{ h.dateFormatted }}</span>
                                        <span class="text-[11px] text-muted">({{ h.logCount }} logs)</span>
                                    </div>
                                    <div class="flex items-center gap-2 font-mono text-[11px]">
                                        <span>In: <b class="text-emerald-700">{{ h.timeIn }}</b></span>
                                        <span>Out: <b class="text-navy">{{ h.timeOut }}</b></span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Modal Footer -->
            <template #footer>
                <div v-if="selectedRecord" class="flex flex-col sm:flex-row items-center justify-between gap-3 w-full">
                    <div class="text-caption text-muted flex items-center gap-1.5">
                        <app-icon name="UserCheck" :size="15" class="text-navy" />
                        <span>S.A. Record: <b class="text-ink">{{ selectedRecord.name }}</b> ({{ selectedRecord.studentId }})</span>
                    </div>
                    <div class="flex items-center gap-2">
                        <button type="button" @click="closeDetailModal" class="btn btn-secondary btn-sm">
                            Close
                        </button>
                        <button type="button" @click="openReconcileModal(selectedRecord); closeDetailModal();" class="btn btn-primary btn-sm flex items-center gap-1.5">
                            <app-icon name="Scale" :size="14" />
                            <span>Reconcile Attendance</span>
                        </button>
                    </div>
                </div>
            </template>
        </app-modal>

        <!-- 6. Modal: Reconciliation & Credited Hours Adjustment -->
        <app-modal :open="reconcileModal" title="Reconcile Student Assistant Attendance"
                   icon="Scale" tone="navy" @close="reconcileModal = false"
                   :description="reconcileForm.saName + ' — ' + reconcileForm.date">
            <div class="space-y-4 text-xs">
                <p class="text-muted">
                    Set the final attendance status and official credited hours for this shift. Credited hours feed directly into the bi-weekly S.A. allowance payroll.
                </p>

                <form-field label="Attendance Status" required v-slot="f">
                    <select :id="f.id" v-model="reconcileForm.status" class="input text-xs font-semibold">
                        <option value="PRESENT">PRESENT (Duty Completed)</option>
                        <option value="LATE">LATE (Punctuality Penalty / Grace Exceeded)</option>
                        <option value="UNDERTIME">UNDERTIME (Early Departure)</option>
                        <option value="OVERTIME">OVERTIME (Extended Duty)</option>
                        <option value="EXCUSED">EXCUSED (With Approved Excuse Slip)</option>
                        <option value="INCOMPLETE">INCOMPLETE (Missing Time-Out / Partial)</option>
                        <option value="ABSENT">ABSENT (No Duty Logged)</option>
                    </select>
                </form-field>

                <div class="grid grid-cols-2 gap-4">
                    <form-field label="Official Credited Hours" hint="Hours eligible for allowance." required v-slot="f">
                        <input :id="f.id" v-model.number="reconcileForm.creditedHours" type="number" step="0.5" min="0" max="12" class="input font-bold text-navy" />
                    </form-field>

                    <form-field label="Approved Overtime Hours" hint="Requires valid OT request." v-slot="f">
                        <input :id="f.id" v-model.number="reconcileForm.overtimeHours" type="number" step="0.5" min="0" max="8" class="input font-bold text-navy" />
                    </form-field>
                </div>

                <form-field label="Reconciliation Remarks / Audit Note" hint="Explain any manual adjustment for audit records." required v-slot="f">
                    <textarea :id="f.id" v-model="reconcileForm.remarks" rows="2" class="input" placeholder="e.g. Adjusted credited hours after reviewing supervisor signed log sheet."></textarea>
                </form-field>
            </div>

            <template #footer>
                <button type="button" @click="reconcileModal = false" class="btn btn-secondary">Cancel</button>
                <button type="button" @click="saveReconciliation" :disabled="savingAction" class="btn btn-primary">
                    <app-icon :name="savingAction ? 'LoaderCircle' : 'Check'" :size="14" :class="savingAction ? 'animate-spin' : ''" />
                    <span>{{ savingAction ? 'Saving...' : 'Save Reconciliation' }}</span>
                </button>
            </template>
        </app-modal>

        <!-- 7. Modal: Coordinator Manual Attendance Entry -->
        <app-modal :open="manualEntryModal" title="Manual Attendance Entry"
                   icon="Plus" tone="navy" @close="manualEntryModal = false"
                   description="Add missing or retroactively approved attendance for a Student Assistant.">
            <div class="space-y-4 text-xs">
                <form-field label="Student Assistant" required v-slot="f">
                    <select :id="f.id" v-model="manualForm.saProfileId" class="input font-semibold">
                        <option value="" disabled>Select Student Assistant...</option>
                        <option v-for="r in records" :key="r.saProfileId" :value="r.saProfileId">
                            {{ r.name }} ({{ r.studentId }}) &mdash; {{ r.department }}
                        </option>
                    </select>
                </form-field>

                <form-field label="Date of Duty" required v-slot="f">
                    <input :id="f.id" v-model="manualForm.date" type="date" class="input font-bold text-navy" />
                </form-field>

                <div class="grid grid-cols-2 gap-4">
                    <form-field label="Time In" required v-slot="f">
                        <input :id="f.id" v-model="manualForm.timeIn" type="time" class="input font-bold text-emerald-700" />
                    </form-field>
                    <form-field label="Time Out" v-slot="f">
                        <input :id="f.id" v-model="manualForm.timeOut" type="time" class="input font-bold text-navy" />
                    </form-field>
                </div>

                <form-field label="Reason for Manual Entry" required hint="Required for audit logging." v-slot="f">
                    <input :id="f.id" v-model="manualForm.reason" type="text" class="input" placeholder="e.g. Device failure during camera scan, confirmed by Supervisor." />
                </form-field>
            </div>

            <template #footer>
                <button type="button" @click="manualEntryModal = false" class="btn btn-secondary">Cancel</button>
                <button type="button" @click="saveManualEntry" :disabled="savingAction" class="btn btn-primary">
                    <app-icon :name="savingAction ? 'LoaderCircle' : 'Save'" :size="14" :class="savingAction ? 'animate-spin' : ''" />
                    <span>{{ savingAction ? 'Recording...' : 'Record Attendance' }}</span>
                </button>
            </template>
        </app-modal>

        <!-- 8. Modal: Browse Past Attendance Dates & History -->
        <app-modal :open="pastDatesModal" title="Browse Previous Attendance Records"
                   icon="History" tone="navy" @close="pastDatesModal = false"
                   description="Select any previous duty date to review, inspect, and reconcile student assistant attendance records.">
            <div class="space-y-4 text-xs">
                <div v-if="pastDatesLoading" class="space-y-2 py-4">
                    <div v-for="n in 4" :key="n" class="h-10 animate-pulse rounded-lg bg-page"></div>
                </div>
                <div v-else-if="!pastDatesList.length" class="py-8 text-center text-muted">
                    <app-icon name="CalendarX" :size="32" class="mx-auto text-muted/60" />
                    <p class="mt-2 text-xs font-semibold">No historical attendance records found in this semester.</p>
                </div>
                <div v-else class="max-h-[360px] overflow-y-auto space-y-2 pr-1">
                    <div v-for="d in pastDatesList" :key="d.date"
                         @click="selectPastDate(d.date)"
                         class="flex items-center justify-between rounded-xl border border-line bg-page/40 p-3 hover:bg-page hover:border-navy/40 cursor-pointer transition-colors"
                         :class="selectedDate === d.date ? 'bg-navy/10 border-navy font-bold' : ''">
                        <div class="flex items-center gap-3">
                            <div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-white font-bold text-xs"
                                 :class="d.isToday ? 'bg-emerald-600' : 'bg-navy'">
                                <app-icon name="Calendar" :size="16" />
                            </div>
                            <div>
                                <div class="font-bold text-ink text-[13px] flex items-center gap-2">
                                    <span>{{ d.label }}</span>
                                    <span v-if="d.isToday" class="rounded-full bg-emerald-100 px-2 py-0.2 text-[10px] font-bold text-emerald-800">Today</span>
                                </div>
                                <div class="text-[11px] text-muted flex items-center gap-2 mt-0.5">
                                    <span><b>{{ d.saCount }}</b> S.A.s logged</span>
                                    <span>&bull;</span>
                                    <span><b>{{ d.logCount }}</b> biometric events</span>
                                    <span v-if="d.reconciledCount">&bull; <b>{{ d.reconciledCount }}</b> reconciled</span>
                                </div>
                            </div>
                        </div>
                        <button type="button" @click.stop="selectPastDate(d.date)" class="btn btn-secondary btn-sm py-1 px-3 text-[11px]">
                            View Records &rarr;
                        </button>
                    </div>
                </div>
            </div>
            <template #footer>
                <button type="button" @click="pastDatesModal = false" class="btn btn-secondary">Close</button>
            </template>
        </app-modal>

    </div>
    `
};

