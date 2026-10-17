// AssistPay — S.A. Coordinator Reports & Analytics View (/admin/reports)
// Comprehensive institutional reporting across Attendance, Allowance, School Balance,
// S.A. Summary, Schedule & Duty Coverage, and Exceptions & Audit.

const AdminReportsPage = {
    components: { AppIcon, PageHeader },

    setup() {
        const loading = Vue.ref(true);
        const loadError = Vue.ref("");
        const categoryLoading = Vue.ref(false);

        const num = (v, d = 1) => {
            if (v == null || isNaN(Number(v))) return (0).toFixed(d);
            return Number(v).toFixed(d);
        };

        const pct = (v, total) => {
            const n = Number(v) || 0;
            const t = Number(total) || 0;
            if (t <= 0) return 0;
            return Math.min(100, Math.max(0, Math.round((n / t) * 100)));
        };

        // Active View: 'OVERVIEW' | 'ATTENDANCE' | 'ALLOWANCE' | 'SCHOOL_BALANCE' | 'SA_SUMMARY' | 'SCHEDULE_COVERAGE' | 'EXCEPTIONS_AUDIT'
        const activeTab = Vue.ref("OVERVIEW");
        const viewMode = Vue.ref("graph");
        const selectedSemesterId = Vue.ref(null);

        // Overview / Landing Dashboard Data
        const overview = Vue.reactive({
            activeSemester: null,
            semesters: [],
            metrics: {
                totalSas: 0,
                activeSas: 0,
                weeklyScheduledHours: 0,
                totalCreditedHours: 0,
                projectedMonthlyAllowance: 0,
                endorsedAllowance: 0,
                totalSchoolBalance: 0,
                totalConfirmedDeductions: 0,
                yesCount: 0,
                noCount: 0,
                coverageGaps: 0,
                pendingExceptions: 0
            },
            lastRefreshed: "",
            coordinatorName: "Ansherina A Sudario"
        });

        // 1. Attendance Filters & Data
        const attFilters = Vue.reactive({
            startDate: "",
            endDate: "",
            department: "ALL",
            status: "ALL",
            reconciliationStatus: "ALL",
            search: ""
        });
        const attData = Vue.ref({ records: [], summary: {}, departmentSummary: [] });

        // 2. Allowance Filters & Data
        const allowFilters = Vue.reactive({
            department: "ALL",
            status: "ALL",
            search: ""
        });
        const allowData = Vue.ref({ records: [], summary: {}, departmentSummary: [], activeEndorsement: null, baseRate: 8 });

        // 3. School Balance & Deduction Filters & Data
        const balFilters = Vue.reactive({
            decision: "ALL",
            department: "ALL",
            processingStatus: "ALL",
            search: ""
        });
        const balData = Vue.ref({ records: [], summary: {}, campaign: null });

        // 4. S.A. Summary Filters & Data
        const saFilters = Vue.reactive({
            department: "ALL",
            status: "ALL",
            search: ""
        });
        const saData = Vue.ref({ records: [], summary: {} });

        // 5. Schedule & Duty Coverage Filters & Data
        const schedFilters = Vue.reactive({
            dayOfWeek: "ALL",
            department: "ALL",
            coverageStatus: "ALL"
        });
        const schedData = Vue.ref({ records: [], summary: {} });

        // 6. Exceptions & Audit Filters & Data
        const auditFilters = Vue.reactive({
            module: "ALL",
            startDate: "",
            endDate: "",
            search: ""
        });
        const auditData = Vue.ref({ records: [], summary: {} });

        // Pagination
        const page = Vue.ref(1);
        const pageSize = 12;

        // Load Landing Page Overview
        const loadOverview = async () => {
            loading.value = true;
            loadError.value = "";
            const res = await Model.request("reports", "overview");
            loading.value = false;
            if (res.success) {
                overview.activeSemester = res.activeSemester;
                overview.semesters = res.semesters || [];
                if (!selectedSemesterId.value && res.activeSemester) {
                    selectedSemesterId.value = res.activeSemester.id;
                }
                if (res.metrics) {
                    Object.assign(overview.metrics, res.metrics);
                }
                overview.lastRefreshed = res.lastRefreshed || new Date().toLocaleString();
                overview.coordinatorName = res.coordinatorName || Store.user?.full_name || "Ansherina A Sudario";
            } else {
                loadError.value = res.message || "Failed to load reports overview.";
            }
        };

        // Load Specific Category Data
        const loadCategoryData = async (cat) => {
            categoryLoading.value = true;
            page.value = 1;
            try {
                if (cat === "ATTENDANCE") {
                    const res = await Model.request("reports", "attendance_report", {
                        semester_id: selectedSemesterId.value,
                        start_date: attFilters.startDate,
                        end_date: attFilters.endDate,
                        department: attFilters.department,
                        status: attFilters.status,
                        reconciliation_status: attFilters.reconciliationStatus,
                        search: attFilters.search
                    });
                    if (res.success) {
                        attData.value = {
                            records: res.records || [],
                            summary: res.summary || {},
                            departmentSummary: res.departmentSummary || []
                        };
                    } else {
                        Alerts.error("Report Error", res.message);
                    }
                } else if (cat === "ALLOWANCE") {
                    const res = await Model.request("reports", "allowance_report", {
                        semester_id: selectedSemesterId.value,
                        department: allowFilters.department,
                        status: allowFilters.status,
                        search: allowFilters.search
                    });
                    if (res.success) {
                        allowData.value = {
                            records: res.records || [],
                            summary: res.summary || {},
                            departmentSummary: res.departmentSummary || [],
                            activeEndorsement: res.activeEndorsement,
                            baseRate: res.baseRate || 8
                        };
                    } else {
                        Alerts.error("Report Error", res.message);
                    }
                } else if (cat === "SCHOOL_BALANCE") {
                    const res = await Model.request("reports", "school_balance_report", {
                        semester_id: selectedSemesterId.value,
                        decision: balFilters.decision,
                        department: balFilters.department,
                        processing_status: balFilters.processingStatus,
                        search: balFilters.search
                    });
                    if (res.success) {
                        balData.value = {
                            records: res.records || [],
                            summary: res.summary || {},
                            campaign: res.campaign
                        };
                    } else {
                        Alerts.error("Report Error", res.message);
                    }
                } else if (cat === "SA_SUMMARY") {
                    const res = await Model.request("reports", "sa_summary_report", {
                        department: saFilters.department,
                        status: saFilters.status,
                        search: saFilters.search
                    });
                    if (res.success) {
                        saData.value = {
                            records: res.records || [],
                            summary: res.summary || {}
                        };
                    } else {
                        Alerts.error("Report Error", res.message);
                    }
                } else if (cat === "SCHEDULE_COVERAGE") {
                    const res = await Model.request("reports", "schedule_coverage_report", {
                        semester_id: selectedSemesterId.value,
                        day_of_week: schedFilters.dayOfWeek,
                        department: schedFilters.department,
                        coverage_status: schedFilters.coverageStatus
                    });
                    if (res.success) {
                        schedData.value = {
                            records: res.records || [],
                            summary: res.summary || {}
                        };
                    } else {
                        Alerts.error("Report Error", res.message);
                    }
                } else if (cat === "EXCEPTIONS_AUDIT") {
                    const res = await Model.request("reports", "exceptions_audit_report", {
                        module: auditFilters.module,
                        start_date: auditFilters.startDate,
                        end_date: auditFilters.endDate,
                        search: auditFilters.search
                    });
                    if (res.success) {
                        auditData.value = {
                            records: res.records || [],
                            summary: res.summary || {}
                        };
                    } else {
                        Alerts.error("Report Error", res.message);
                    }
                }
            } finally {
                categoryLoading.value = false;
            }
        };

        const openCategory = (cat) => {
            activeTab.value = cat;
            loadCategoryData(cat);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        };

        const backToOverview = () => {
            activeTab.value = "OVERVIEW";
            loadOverview();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        };

        const onSemesterChange = () => {
            if (activeTab.value === "OVERVIEW") {
                loadOverview();
            } else {
                loadCategoryData(activeTab.value);
            }
        };

        // Date validation check
        const validateDates = (start, end) => {
            if (start && end && start > end) {
                Alerts.warning("Invalid Date Range", "The start date cannot be later than the end date.");
                return false;
            }
            return true;
        };

        const applyCategoryFilter = () => {
            if (activeTab.value === "ATTENDANCE") {
                if (!validateDates(attFilters.startDate, attFilters.endDate)) return;
            } else if (activeTab.value === "EXCEPTIONS_AUDIT") {
                if (!validateDates(auditFilters.startDate, auditFilters.endDate)) return;
            }
            loadCategoryData(activeTab.value);
        };

        const resetCategoryFilter = () => {
            if (activeTab.value === "ATTENDANCE") {
                attFilters.startDate = "";
                attFilters.endDate = "";
                attFilters.department = "ALL";
                attFilters.status = "ALL";
                attFilters.reconciliationStatus = "ALL";
                attFilters.search = "";
            } else if (activeTab.value === "ALLOWANCE") {
                allowFilters.department = "ALL";
                allowFilters.status = "ALL";
                allowFilters.search = "";
            } else if (activeTab.value === "SCHOOL_BALANCE") {
                balFilters.decision = "ALL";
                balFilters.department = "ALL";
                balFilters.processingStatus = "ALL";
                balFilters.search = "";
            } else if (activeTab.value === "SA_SUMMARY") {
                saFilters.department = "ALL";
                saFilters.status = "ALL";
                saFilters.search = "";
            } else if (activeTab.value === "SCHEDULE_COVERAGE") {
                schedFilters.dayOfWeek = "ALL";
                schedFilters.department = "ALL";
                schedFilters.coverageStatus = "ALL";
            } else if (activeTab.value === "EXCEPTIONS_AUDIT") {
                auditFilters.module = "ALL";
                auditFilters.startDate = "";
                auditFilters.endDate = "";
                auditFilters.search = "";
            }
            loadCategoryData(activeTab.value);
        };

        // Paginated Records computed per active category
        const currentCategoryRecords = Vue.computed(() => {
            switch (activeTab.value) {
                case "ATTENDANCE": return attData.value.records || [];
                case "ALLOWANCE": return allowData.value.records || [];
                case "SCHOOL_BALANCE": return balData.value.records || [];
                case "SA_SUMMARY": return saData.value.records || [];
                case "SCHEDULE_COVERAGE": return schedData.value.records || [];
                case "EXCEPTIONS_AUDIT": return auditData.value.records || [];
                default: return [];
            }
        });

        const totalPages = Vue.computed(() => {
            return Math.max(1, Math.ceil(currentCategoryRecords.value.length / pageSize));
        });

        const paginatedRecords = Vue.computed(() => {
            const start = (page.value - 1) * pageSize;
            return currentCategoryRecords.value.slice(start, start + pageSize);
        });

        // Current category display labels
        const categoryMeta = Vue.computed(() => {
            switch (activeTab.value) {
                case "ATTENDANCE":
                    return {
                        title: "Attendance & Duty Hours Report",
                        subtitle: "Detailed monitoring of scheduled shifts, actual punch logs, credited duty hours, and reconciliation status.",
                        icon: "Clock",
                        sheetName: "Attendance Report"
                    };
                case "ALLOWANCE":
                    return {
                        title: "Allowance & Payroll Computation Report",
                        subtitle: "S.A. hourly rates, weekly/monthly projections, credited duty allowance, and official endorsement records.",
                        icon: "Wallet",
                        sheetName: "Allowance Report"
                    };
                case "SCHOOL_BALANCE":
                    return {
                        title: "School Balance & Deduction Authorization Report",
                        subtitle: "Registrar COR assessments, scholarship benefits (100% Tuition + 70% Misc), and voluntary deduction responses.",
                        icon: "Landmark",
                        sheetName: "School Balance Deductions"
                    };
                case "SA_SUMMARY":
                    return {
                        title: "Student Assistant Masterlist & Roster Report",
                        subtitle: "Institutional roster of all Student Assistants, department posts, supervisors, and compliance.",
                        icon: "Users",
                        sheetName: "S.A. Masterlist"
                    };
                case "SCHEDULE_COVERAGE":
                    return {
                        title: "Schedule & Duty Coverage Report",
                        subtitle: "Plotted duty blocks, department coverage fulfillment, detected conflicts, and unassigned coverage gaps.",
                        icon: "CalendarDays",
                        sheetName: "Schedule Duty Coverage"
                    };
                case "EXCEPTIONS_AUDIT":
                    return {
                        title: "Exceptions & System Audit Report",
                        subtitle: "Attendance correction requests, hourly rate adjustments, deduction overrides, and security audit trace.",
                        icon: "ShieldAlert",
                        sheetName: "Exceptions & Audit Log"
                    };
                default:
                    return { title: "Reports & Analytics", subtitle: "", icon: "ChartColumn", sheetName: "Report" };
            }
        });

        // Computed Weekday Distribution for Schedule Coverage Visual Analytics
        const schedWeekdayStats = Vue.computed(() => {
            const days = [
                { key: "MON", label: "Monday" },
                { key: "TUE", label: "Tuesday" },
                { key: "WED", label: "Wednesday" },
                { key: "THU", label: "Thursday" },
                { key: "FRI", label: "Friday" },
                { key: "SAT", label: "Saturday" }
            ];
            const recs = schedData.value.records || [];
            const counts = { MON: 0, TUE: 0, WED: 0, THU: 0, FRI: 0, SAT: 0 };
            recs.forEach(r => {
                if (counts[r.dayOfWeek] !== undefined) counts[r.dayOfWeek]++;
            });
            const maxVal = Math.max(1, ...Object.values(counts));
            return days.map(d => ({
                key: d.key,
                label: d.label,
                count: counts[d.key],
                pct: Math.round((counts[d.key] / maxVal) * 100)
            }));
        });

        // Computed Module Breakdown for Exceptions & Audit Visual Analytics
        const auditModuleStats = Vue.computed(() => {
            const summary = auditData.value.summary || {};
            const total = Number(summary.totalEvents) || 1;
            return [
                { label: "Attendance & Corrections", count: summary.attendanceIssues || 0, color: "bg-amber-500", text: "text-amber-700", bg: "bg-amber-50" },
                { label: "Allowance & Rate Revisions", count: summary.allowanceRateChanges || 0, color: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50" },
                { label: "School Balance & Deductions", count: summary.deductionChanges || 0, color: "bg-indigo-500", text: "text-indigo-700", bg: "bg-indigo-50" },
                { label: "System Security & Platform", count: Math.max(0, (summary.totalEvents || 0) - (summary.attendanceIssues || 0) - (summary.allowanceRateChanges || 0) - (summary.deductionChanges || 0)), color: "bg-navy", text: "text-navy", bg: "bg-slate-50" }
            ].map(m => ({
                ...m,
                pct: Math.min(100, Math.max(0, Math.round((Number(m.count) / total) * 100)))
            }));
        });

        // Print Execution
        const printReport = () => {
            window.print();
        };

        // Excel Export via XlsxWriter
        const exportExcel = async () => {
            if (typeof XlsxWriter === "undefined" || !XlsxWriter.Sheet) {
                Alerts.error("Export Error", "Excel export engine not loaded. Please refresh the page.");
                return;
            }

            const cat = activeTab.value;
            const records = currentCategoryRecords.value;
            if (!records.length) {
                Alerts.warning("No Records", "There are no records to export in this report view.");
                return;
            }

            try {
                const sheet = new XlsxWriter.Sheet(categoryMeta.value.sheetName);
                sheet.width(1, 6).width(2, 16).width(3, 26).width(4, 14).width(5, 20).width(6, 16).width(7, 16).width(8, 16);

                // Row 1: Header title
                sheet.set(1, 1, "NATIONAL COLLEGE OF SCIENCE AND TECHNOLOGY", "title");
                sheet.merge(1, 1, 1, 7);
                sheet.set(2, 1, categoryMeta.value.title.toUpperCase(), "bold");
                sheet.merge(2, 1, 2, 7);
                sheet.set(3, 1, `Term: ${overview.activeSemester?.label || 'Active Semester'} · Exported: ${new Date().toLocaleDateString('en-US')}`, "text");
                sheet.merge(3, 1, 3, 7);

                let r = 5;

                if (cat === "ATTENDANCE") {
                    const headers = ["#", "Student ID", "Student Assistant", "Dept", "Duty Date", "Scheduled", "Actual Punch", "Credited Hrs", "Status"];
                    headers.forEach((h, i) => sheet.set(r, i + 1, h, "head"));
                    r++;
                    records.forEach((row, idx) => {
                        sheet.set(r, 1, idx + 1, "cell");
                        sheet.set(r, 2, row.studentId, "cell");
                        sheet.set(r, 3, row.name, "name");
                        sheet.set(r, 4, row.department, "cell");
                        sheet.set(r, 5, row.dutyDate, "cell");
                        sheet.set(r, 6, `${row.scheduledStart} - ${row.scheduledEnd}`, "cell");
                        sheet.set(r, 7, `${row.actualTimeIn} - ${row.actualTimeOut}`, "cell");
                        sheet.set(r, 8, row.creditedHours, "cell");
                        sheet.set(r, 9, row.status, "cell");
                        r++;
                    });
                    // Summary row
                    sheet.set(r, 7, "TOTAL CREDITED:", "bold");
                    sheet.set(r, 8, attData.value.summary.totalCreditedHours || 0, "bold");
                } else if (cat === "ALLOWANCE") {
                    const headers = ["#", "Student ID", "Student Assistant", "Dept", "Rate (₱/hr)", "Weekly Target", "Estimated Monthly", "Credited Hrs", "Final Allowance", "Status"];
                    headers.forEach((h, i) => sheet.set(r, i + 1, h, "head"));
                    r++;
                    records.forEach((row, idx) => {
                        sheet.set(r, 1, idx + 1, "cell");
                        sheet.set(r, 2, row.studentId, "cell");
                        sheet.set(r, 3, row.name, "name");
                        sheet.set(r, 4, row.department, "cell");
                        sheet.set(r, 5, row.hourlyRate, "cell");
                        sheet.set(r, 6, row.weeklyTargetHours, "cell");
                        sheet.set(r, 7, row.monthlyEstimated, "cell");
                        sheet.set(r, 8, row.finalizedCreditedHours, "cell");
                        sheet.set(r, 9, row.finalizedAllowance, "cell");
                        sheet.set(r, 10, row.computationStatus, "cell");
                        r++;
                    });
                    sheet.set(r, 8, "TOTAL FINALIZED:", "bold");
                    sheet.set(r, 9, allowData.value.summary.totalFinalizedAllowance || 0, "bold");
                } else if (cat === "SCHOOL_BALANCE") {
                    const headers = ["#", "Student ID", "Student Assistant", "Dept", "Cash COR", "Benefit Covered", "School Balance", "Decision", "Authorized", "Confirmed Deducted", "Net Balance"];
                    headers.forEach((h, i) => sheet.set(r, i + 1, h, "head"));
                    r++;
                    records.forEach((row, idx) => {
                        sheet.set(r, 1, idx + 1, "cell");
                        sheet.set(r, 2, row.studentId, "cell");
                        sheet.set(r, 3, row.name, "name");
                        sheet.set(r, 4, row.department, "cell");
                        sheet.set(r, 5, row.cashCor, "cell");
                        sheet.set(r, 6, row.benefitCovered, "cell");
                        sheet.set(r, 7, row.schoolBalance, "cell");
                        sheet.set(r, 8, row.decision, "cell");
                        sheet.set(r, 9, row.authorizedAmount, "cell");
                        sheet.set(r, 10, row.confirmedDeducted, "cell");
                        sheet.set(r, 11, row.remainingNetBalance, "cell");
                        r++;
                    });
                } else if (cat === "SA_SUMMARY") {
                    const headers = ["#", "S.A. Number", "Student ID", "Student Assistant", "Course & Year", "Department", "Assigned Post", "Supervisor", "Target Hrs/Wk", "Rate", "Status"];
                    headers.forEach((h, i) => sheet.set(r, i + 1, h, "head"));
                    r++;
                    records.forEach((row, idx) => {
                        sheet.set(r, 1, idx + 1, "cell");
                        sheet.set(r, 2, row.saNumber || "—", "cell");
                        sheet.set(r, 3, row.studentId, "cell");
                        sheet.set(r, 4, row.name, "name");
                        sheet.set(r, 5, row.course, "cell");
                        sheet.set(r, 6, row.department, "cell");
                        sheet.set(r, 7, row.post, "cell");
                        sheet.set(r, 8, row.supervisor, "cell");
                        sheet.set(r, 9, row.weeklyTargetHours, "cell");
                        sheet.set(r, 10, row.hourlyRate, "cell");
                        sheet.set(r, 11, row.status, "cell");
                        r++;
                    });
                } else if (cat === "SCHEDULE_COVERAGE") {
                    const headers = ["#", "Day", "Time Slot", "Duration", "Department", "Location / Room", "Assigned S.A.", "Student ID", "Coverage Status"];
                    headers.forEach((h, i) => sheet.set(r, i + 1, h, "head"));
                    r++;
                    records.forEach((row, idx) => {
                        sheet.set(r, 1, idx + 1, "cell");
                        sheet.set(r, 2, row.dayOfWeek, "cell");
                        sheet.set(r, 3, `${row.startTime} - ${row.endTime}`, "cell");
                        sheet.set(r, 4, `${row.hours} hrs`, "cell");
                        sheet.set(r, 5, row.department, "cell");
                        sheet.set(r, 6, row.location, "cell");
                        sheet.set(r, 7, row.assignedSa, "name");
                        sheet.set(r, 8, row.studentId, "cell");
                        sheet.set(r, 9, row.coverageStatus, "cell");
                        r++;
                    });
                } else {
                    const headers = ["#", "Timestamp", "Module", "Action", "Reference", "Details", "Responsible User", "Status"];
                    headers.forEach((h, i) => sheet.set(r, i + 1, h, "head"));
                    r++;
                    records.forEach((row, idx) => {
                        sheet.set(r, 1, idx + 1, "cell");
                        sheet.set(r, 2, row.timestamp, "cell");
                        sheet.set(r, 3, row.module, "cell");
                        sheet.set(r, 4, row.action, "cell");
                        sheet.set(r, 5, row.reference, "cell");
                        sheet.set(r, 6, row.details, "cell");
                        sheet.set(r, 7, row.responsibleUser, "cell");
                        sheet.set(r, 8, row.status, "cell");
                        r++;
                    });
                }

                const filename = `AssistPay_${cat}_${new Date().toISOString().slice(0, 10)}.xlsx`;
                await XlsxWriter.download(filename, [sheet]);
                Alerts.toast("Excel report generated successfully", "success");
            } catch (err) {
                console.error("XLSX Export Error:", err);
                Alerts.error("Export Failed", "Could not compile the Excel report file.");
            }
        };

        Vue.onMounted(() => {
            loadOverview();
        });

        return {
            loading, loadError, categoryLoading, activeTab, viewMode, selectedSemesterId, overview,
            attFilters, attData, allowFilters, allowData, balFilters, balData,
            saFilters, saData, schedFilters, schedData, auditFilters, auditData,
            page, pageSize, totalPages, paginatedRecords, currentCategoryRecords,
            categoryMeta, loadOverview, openCategory, backToOverview, onSemesterChange,
            applyCategoryFilter, resetCategoryFilter, printReport, exportExcel,
            Format, label, num, pct, schedWeekdayStats, auditModuleStats
        };
    },

    template: `
    <div class="space-y-6">
        <!-- ================================================================= -->
        <!-- TOP HEADER -->
        <!-- ================================================================= -->
        <page-header 
            title="Reports & Analytics" 
            section="Administration"
            subtitle="Official institutional duty monitoring, payroll audit, school balance deductions, schedule coverage, and audit logs.">
            <template #actions>
                <div class="flex flex-wrap items-center gap-2 no-print">
                    <!-- Semester Selector -->
                    <select v-model="selectedSemesterId" @change="onSemesterChange" 
                            class="input w-auto py-1.5 px-3 text-[13px] font-semibold border-navy/20 bg-white shadow-sm">
                        <option v-for="s in overview.semesters" :key="s.id" :value="s.id">
                            {{ s.label }} {{ s.status === 'ACTIVE' ? '(Active)' : '' }}
                        </option>
                    </select>

                    <button @click="activeTab === 'OVERVIEW' ? loadOverview() : applyCategoryFilter()" 
                            class="btn btn-secondary btn-sm flex items-center gap-1.5"
                            :disabled="loading || categoryLoading">
                        <app-icon name="RefreshCw" :size="14" :class="(loading || categoryLoading) ? 'animate-spin' : ''" />
                        Refresh
                    </button>

                    <button v-if="activeTab !== 'OVERVIEW'" @click="exportExcel" 
                            class="btn btn-secondary btn-sm flex items-center gap-1.5 shadow-sm text-emerald-800 border-emerald-300 hover:bg-emerald-50">
                        <app-icon name="FileSpreadsheet" :size="15" /> Export Excel
                    </button>

                    <button v-if="activeTab !== 'OVERVIEW'" @click="printReport" 
                            class="btn btn-primary btn-sm flex items-center gap-1.5 shadow-sm">
                        <app-icon name="Printer" :size="15" /> Print / PDF
                    </button>
                </div>
            </template>
        </page-header>

        <!-- Loading State -->
        <div v-if="loading" class="card p-12 text-center text-muted" aria-busy="true">
            <app-icon name="LoaderCircle" :size="32" class="mx-auto mb-3 animate-spin text-navy" />
            <p class="font-medium text-ink">Compiling institutional reports & analytics…</p>
        </div>

        <!-- Error State -->
        <div v-else-if="loadError" class="card border-danger/30 bg-danger/5 p-6 text-danger">
            <div class="flex items-center gap-3">
                <app-icon name="CircleAlert" :size="20" class="shrink-0" />
                <p class="font-medium">{{ loadError }}</p>
                <button @click="loadOverview" class="btn btn-secondary btn-sm ml-auto"><app-icon name="RefreshCw" :size="14" /> Retry</button>
            </div>
        </div>

        <!-- ================================================================= -->
        <!-- VIEW 1: LANDING DASHBOARD (6 REPORT CATEGORIES) -->
        <!-- ================================================================= -->
        <div v-else-if="activeTab === 'OVERVIEW'" class="space-y-6">
            <!-- High-Level Executive Summary Cards -->
            <dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div class="card p-4 border-l-4 border-l-navy">
                    <dt class="text-caption text-muted flex items-center justify-between">
                        <span>Active S.A.s</span>
                        <app-icon name="Users" :size="16" class="text-navy" />
                    </dt>
                    <dd class="mt-2 text-[22px] font-bold text-navy">{{ overview.metrics.activeSas }} Active</dd>
                    <dd class="mt-0.5 text-caption text-muted">Weekly Load: <b>{{ overview.metrics.weeklyScheduledHours }} hrs</b></dd>
                </div>

                <div class="card p-4 border-l-4 border-l-emerald-600 bg-emerald-50/20">
                    <dt class="text-caption text-emerald-950 font-medium flex items-center justify-between">
                        <span>Payroll Endorsed</span>
                        <app-icon name="Wallet" :size="16" class="text-emerald-700" />
                    </dt>
                    <dd class="mt-2 text-[22px] font-bold text-emerald-800">{{ Format.peso(overview.metrics.endorsedAllowance) }}</dd>
                    <dd class="mt-0.5 text-caption text-emerald-900">Projected Monthly: {{ Format.peso(overview.metrics.projectedMonthlyAllowance) }}</dd>
                </div>

                <div class="card p-4 border-l-4 border-l-indigo-600">
                    <dt class="text-caption text-muted flex items-center justify-between">
                        <span>School Balances & Deduction</span>
                        <app-icon name="Landmark" :size="16" class="text-indigo-600" />
                    </dt>
                    <dd class="mt-2 text-[22px] font-bold text-ink">{{ Format.peso(overview.metrics.totalSchoolBalance) }}</dd>
                    <dd class="mt-0.5 text-caption text-muted">Confirmed Deductions: <b class="text-emerald-700">{{ Format.peso(overview.metrics.totalConfirmedDeductions) }}</b></dd>
                </div>

                <div class="card p-4 border-l-4 border-l-amber-500 bg-amber-50/20">
                    <dt class="text-caption text-amber-950 font-medium flex items-center justify-between">
                        <span>Exceptions & Coverage</span>
                        <app-icon name="ShieldAlert" :size="16" class="text-amber-600" />
                    </dt>
                    <dd class="mt-2 text-[22px] font-bold text-amber-900">{{ overview.metrics.pendingExceptions }} Action(s)</dd>
                    <dd class="mt-0.5 text-caption text-amber-950">Coverage Gaps: <b>{{ overview.metrics.coverageGaps }} unassigned</b></dd>
                </div>
            </dl>

            <!-- Six Category Cards Grid -->
            <div>
                <div class="flex items-center justify-between mb-4">
                    <div>
                        <h2 class="text-card-title text-ink font-bold">Report Categories</h2>
                        <p class="text-caption text-muted">Select an official report category to monitor real-time records, filter parameters, or export reports.</p>
                    </div>
                    <span class="text-[12px] text-muted flex items-center gap-1.5">
                        <app-icon name="Calendar" :size="14" /> Term: <b>{{ overview.activeSemester?.label || 'Active Semester' }}</b>
                    </span>
                </div>

                <div class="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
                    <!-- 1. Attendance & Duty Hours -->
                    <div class="card p-5 flex flex-col justify-between hover:shadow-lift transition duration-150 border-t-4 border-t-navy">
                        <div>
                            <div class="flex items-center justify-between mb-3">
                                <div class="grid h-10 w-10 place-items-center rounded-xl bg-navy/10 text-navy">
                                    <app-icon name="Clock" :size="20" />
                                </div>
                                <span class="rounded-full bg-mist px-2.5 py-0.5 text-[11px] font-bold text-navy border border-line">
                                    {{ Format.number(overview.metrics.totalCreditedHours, 1) }} Credited Hrs
                                </span>
                            </div>
                            <h3 class="text-[16px] font-bold text-navy">1. Attendance & Duty Hours</h3>
                            <p class="mt-1.5 text-caption text-muted leading-relaxed">
                                Monitor daily/monthly attendance logs, scheduled vs. actual punch records, and hours reconciliation.
                            </p>
                        </div>
                        <div class="mt-5 pt-4 border-t border-line flex items-center justify-between">
                            <span class="text-[11px] text-muted font-medium">Daily & Monthly Rosters</span>
                            <button @click="openCategory('ATTENDANCE')" class="btn btn-primary btn-sm flex items-center gap-1">
                                View Report <app-icon name="ArrowRight" :size="14" />
                            </button>
                        </div>
                    </div>

                    <!-- 2. Allowance -->
                    <div class="card p-5 flex flex-col justify-between hover:shadow-lift transition duration-150 border-t-4 border-t-emerald-600">
                        <div>
                            <div class="flex items-center justify-between mb-3">
                                <div class="grid h-10 w-10 place-items-center rounded-xl bg-emerald-100 text-emerald-800">
                                    <app-icon name="Wallet" :size="20" />
                                </div>
                                <span class="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800 border border-emerald-200">
                                    {{ Format.peso(overview.metrics.endorsedAllowance) }} Endorsed
                                </span>
                            </div>
                            <h3 class="text-[16px] font-bold text-navy">2. Allowance & Payroll</h3>
                            <p class="mt-1.5 text-caption text-muted leading-relaxed">
                                Audit S.A. hourly rates, credited hours, and period payroll breakdown for HR/Finance endorsement.
                            </p>
                        </div>
                        <div class="mt-5 pt-4 border-t border-line flex items-center justify-between">
                            <span class="text-[11px] text-muted font-medium">Payroll & Endorsement Slips</span>
                            <button @click="openCategory('ALLOWANCE')" class="btn btn-primary btn-sm flex items-center gap-1">
                                View Report <app-icon name="ArrowRight" :size="14" />
                            </button>
                        </div>
                    </div>

                    <!-- 3. School Balance & Deduction -->
                    <div class="card p-5 flex flex-col justify-between hover:shadow-lift transition duration-150 border-t-4 border-t-indigo-600">
                        <div>
                            <div class="flex items-center justify-between mb-3">
                                <div class="grid h-10 w-10 place-items-center rounded-xl bg-indigo-100 text-indigo-700">
                                    <app-icon name="Landmark" :size="20" />
                                </div>
                                <span class="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-bold text-indigo-800 border border-indigo-200">
                                    {{ overview.metrics.yesCount }} YES Authorization(s)
                                </span>
                            </div>
                            <h3 class="text-[16px] font-bold text-navy">3. School Balance & Deduction</h3>
                            <p class="mt-1.5 text-caption text-muted leading-relaxed">
                                Review Registrar COR assessments, tuition/misc coverage, and confirmed student deductions.
                            </p>
                        </div>
                        <div class="mt-5 pt-4 border-t border-line flex items-center justify-between">
                            <span class="text-[11px] text-muted font-medium">COR Benefits & Deductions</span>
                            <button @click="openCategory('SCHOOL_BALANCE')" class="btn btn-primary btn-sm flex items-center gap-1">
                                View Report <app-icon name="ArrowRight" :size="14" />
                            </button>
                        </div>
                    </div>

                    <!-- 4. Student Assistant Summary -->
                    <div class="card p-5 flex flex-col justify-between hover:shadow-lift transition duration-150 border-t-4 border-t-sky-600">
                        <div>
                            <div class="flex items-center justify-between mb-3">
                                <div class="grid h-10 w-10 place-items-center rounded-xl bg-sky-100 text-sky-800">
                                    <app-icon name="Users" :size="20" />
                                </div>
                                <span class="rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] font-bold text-sky-800 border border-sky-200">
                                    {{ overview.metrics.totalSas }} Total Registered
                                </span>
                            </div>
                            <h3 class="text-[16px] font-bold text-navy">4. Student Assistant Summary</h3>
                            <p class="mt-1.5 text-caption text-muted leading-relaxed">
                                Consolidated masterlist of active S.A.s, assigned departments, offices, and appointment statuses.
                            </p>
                        </div>
                        <div class="mt-5 pt-4 border-t border-line flex items-center justify-between">
                            <span class="text-[11px] text-muted font-medium">Master Roster & Profiles</span>
                            <button @click="openCategory('SA_SUMMARY')" class="btn btn-primary btn-sm flex items-center gap-1">
                                View Report <app-icon name="ArrowRight" :size="14" />
                            </button>
                        </div>
                    </div>

                    <!-- 5. Schedule & Duty Coverage -->
                    <div class="card p-5 flex flex-col justify-between hover:shadow-lift transition duration-150 border-t-4 border-t-amber-500">
                        <div>
                            <div class="flex items-center justify-between mb-3">
                                <div class="grid h-10 w-10 place-items-center rounded-xl bg-amber-100 text-amber-800">
                                    <app-icon name="CalendarDays" :size="20" />
                                </div>
                                <span class="rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-800 border border-amber-200">
                                    {{ overview.metrics.coverageGaps }} Unassigned Gaps
                                </span>
                            </div>
                            <h3 class="text-[16px] font-bold text-navy">5. Schedule & Duty Coverage</h3>
                            <p class="mt-1.5 text-caption text-muted leading-relaxed">
                                Track scheduled workloads, department coverage requirements, and unaddressed shift gaps.
                            </p>
                        </div>
                        <div class="mt-5 pt-4 border-t border-line flex items-center justify-between">
                            <span class="text-[11px] text-muted font-medium">Coverage Matrix & Gaps</span>
                            <button @click="openCategory('SCHEDULE_COVERAGE')" class="btn btn-primary btn-sm flex items-center gap-1">
                                View Report <app-icon name="ArrowRight" :size="14" />
                            </button>
                        </div>
                    </div>

                    <!-- 6. Exceptions & Audit -->
                    <div class="card p-5 flex flex-col justify-between hover:shadow-lift transition duration-150 border-t-4 border-t-rose-600">
                        <div>
                            <div class="flex items-center justify-between mb-3">
                                <div class="grid h-10 w-10 place-items-center rounded-xl bg-rose-100 text-rose-800">
                                    <app-icon name="ShieldAlert" :size="20" />
                                </div>
                                <span class="rounded-full px-2.5 py-0.5 text-[11px]"
                                      :class="(overview.metrics.pendingExceptions === 0 || !overview.metrics.pendingExceptions) ? 'bg-slate-100 text-slate-600 border border-slate-200' : 'bg-red-100 text-red-700 font-semibold border border-red-200'">
                                    {{ overview.metrics.pendingExceptions }} Unresolved Issues
                                </span>
                            </div>
                            <h3 class="text-[16px] font-bold text-navy">6. Exceptions & Audit</h3>
                            <p class="mt-1.5 text-caption text-muted leading-relaxed">
                                Review attendance corrections, missing log requests, hourly rate adjustments, and system audit logs.
                            </p>
                        </div>
                        <div class="mt-5 pt-4 border-t border-line flex items-center justify-between">
                            <span class="text-[11px] text-muted font-medium">Compliance & Audit Trail</span>
                            <button @click="openCategory('EXCEPTIONS_AUDIT')" class="btn btn-primary btn-sm flex items-center gap-1">
                                View Report <app-icon name="ArrowRight" :size="14" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- ================================================================= -->
        <!-- VIEW 2: DEDICATED REPORT CATEGORY VIEW -->
        <!-- ================================================================= -->
        <div v-else class="space-y-5">
            <!-- Navigation Back Bar -->
            <div class="flex items-center justify-between no-print">
                <button @click="backToOverview" class="btn btn-secondary btn-sm flex items-center gap-1.5">
                    <app-icon name="ArrowLeft" :size="14" /> Back to Reports Overview
                </button>
                <div class="flex items-center gap-2">
                    <!-- Segmented View Mode Toggle -->
                    <div class="inline-flex rounded-lg border border-line bg-page p-0.5 text-xs shadow-inner">
                        <button type="button" @click="viewMode = 'graph'"
                                class="inline-flex items-center gap-1.5 rounded-md px-3 py-1 font-semibold transition"
                                :class="viewMode === 'graph' ? 'bg-white text-navy font-bold shadow-xs border border-amber-400' : 'text-muted hover:text-ink border border-transparent'">
                            <app-icon name="ChartColumn" :size="13" /> Visual Analytics
                        </button>
                        <button type="button" @click="viewMode = 'table'"
                                class="inline-flex items-center gap-1.5 rounded-md px-3 py-1 font-semibold transition"
                                :class="viewMode === 'table' ? 'bg-white text-navy font-bold shadow-xs border border-amber-400' : 'text-muted hover:text-ink border border-transparent'">
                            <app-icon name="Table" :size="13" /> Tabular Data
                        </button>
                    </div>

                    <span class="rounded-lg bg-navy px-2.5 py-1 text-xs font-bold text-white shadow-sm flex items-center gap-1.5">
                        <app-icon :name="categoryMeta.icon" :size="14" /> {{ categoryMeta.title }}
                    </span>
                </div>
            </div>

            <!-- Printable Sheet Container -->
            <div id="printable-report-document" class="rounded-xl border border-line bg-white p-6 shadow-sm text-ink font-sans">
                <!-- Institutional Header (Visible in Print & Preview) -->
                <div class="border-b-2 border-navy pb-4 text-center">
                    <h1 class="text-[18px] font-black uppercase tracking-wide text-navy">National College of Science and Technology</h1>
                    <p class="text-[12px] font-semibold text-muted uppercase">Student Assistant Program · AssistPay Management System</p>
                    <h2 class="mt-2 text-[15px] font-bold text-ink uppercase">{{ categoryMeta.title }}</h2>
                    <p class="text-[11px] text-muted mt-0.5">
                        Academic Term: <b>{{ overview.activeSemester?.label || 'Active Semester' }}</b> · Report Date: {{ Format.date(new Date()) }} · Generated by: {{ overview.coordinatorName }}
                    </p>
                </div>

                <!-- CATEGORY 1: ATTENDANCE & DUTY HOURS -->
                <div v-if="activeTab === 'ATTENDANCE'" class="space-y-4 mt-4">
                    <!-- VISUAL ANALYTICS VIEW -->
                    <div v-if="viewMode === 'graph'" class="space-y-4">
                        <!-- Top Visual Metric Cards -->
                        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div class="card p-4 bg-white border border-line">
                                <div class="flex items-center justify-between">
                                    <span class="text-caption text-muted font-medium">Duty Attendance Rate</span>
                                    <span class="grid h-7 w-7 place-items-center rounded-lg bg-emerald-100 text-emerald-800">
                                        <app-icon name="CheckCircle2" :size="15" />
                                    </span>
                                </div>
                                <div class="mt-2 text-2xl font-black text-navy">
                                    {{ pct((attData.summary.presentCount || 0) + (attData.summary.lateCount || 0), attData.summary.totalRecords || 1) }}%
                                </div>
                                <div class="mt-1 text-[11px] text-muted">
                                    {{ (attData.summary.presentCount || 0) + (attData.summary.lateCount || 0) }} fulfilled of {{ attData.summary.totalRecords || 0 }} logged shifts
                                </div>
                            </div>

                            <div class="card p-4 bg-white border border-line">
                                <div class="flex items-center justify-between">
                                    <span class="text-caption text-muted font-medium">Punctuality Score</span>
                                    <span class="grid h-7 w-7 place-items-center rounded-lg bg-blue-100 text-navy">
                                        <app-icon name="Clock" :size="15" />
                                    </span>
                                </div>
                                <div class="mt-2 text-2xl font-black text-navy">
                                    {{ pct(attData.summary.presentCount || 0, ((attData.summary.presentCount || 0) + (attData.summary.lateCount || 0)) || 1) }}%
                                </div>
                                <div class="mt-1 text-[11px] text-muted">
                                    {{ attData.summary.presentCount || 0 }} on-time · {{ attData.summary.lateCount || 0 }} late
                                </div>
                            </div>

                            <div class="card p-4 bg-white border border-emerald-200 bg-emerald-50/30">
                                <div class="flex items-center justify-between">
                                    <span class="text-caption text-emerald-950 font-medium">Credited Duty Hours</span>
                                    <span class="grid h-7 w-7 place-items-center rounded-lg bg-emerald-200 text-emerald-900">
                                        <app-icon name="Award" :size="15" />
                                    </span>
                                </div>
                                <div class="mt-2 text-2xl font-black text-emerald-800">
                                    {{ num(attData.summary.totalCreditedHours, 1) }} <span class="text-xs font-semibold text-emerald-700">hrs</span>
                                </div>
                                <div class="mt-1 text-[11px] text-emerald-700">
                                    {{ num(attData.summary.totalOvertimeHours, 1) }} hrs overtime credited
                                </div>
                            </div>

                            <div class="card p-4 bg-white border border-line">
                                <div class="flex items-center justify-between">
                                    <span class="text-caption text-muted font-medium">Pending Corrections</span>
                                    <span class="grid h-7 w-7 place-items-center rounded-lg" :class="(attData.summary.pendingCorrections || 0) > 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'">
                                        <app-icon name="AlertTriangle" :size="15" />
                                    </span>
                                </div>
                                <div class="mt-2 text-2xl font-black" :class="(attData.summary.pendingCorrections || 0) > 0 ? 'text-amber-800' : 'text-navy'">
                                    {{ attData.summary.pendingCorrections || 0 }}
                                </div>
                                <div class="mt-1 text-[11px] text-muted">
                                    {{ attData.summary.incompleteCount || 0 }} incomplete log records
                                </div>
                            </div>
                        </div>

                        <!-- Status Distribution Bar Chart Card -->
                        <div class="card p-5 bg-white border border-line">
                            <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                                <div>
                                    <h4 class="text-sm font-bold text-navy">Attendance Status Breakdown</h4>
                                    <p class="text-[11px] text-muted">Proportional breakdown of all {{ attData.summary.totalRecords || 0 }} duty logs for the selected period.</p>
                                </div>
                                <span class="text-xs font-semibold text-navy bg-mist px-2.5 py-1 rounded-md border border-line">
                                    Total Logs: {{ attData.summary.totalRecords || 0 }}
                                </span>
                            </div>

                            <!-- Multi-segment visual bar -->
                            <div class="h-5 w-full rounded-full bg-slate-100 flex overflow-hidden p-0.5 border border-slate-200">
                                <div v-if="attData.summary.presentCount" 
                                     :style="{ width: pct(attData.summary.presentCount, attData.summary.totalRecords) + '%' }" 
                                     class="h-full bg-emerald-500 rounded-l-full transition-all duration-500" 
                                     :title="'Present: ' + attData.summary.presentCount"></div>
                                <div v-if="attData.summary.lateCount" 
                                     :style="{ width: pct(attData.summary.lateCount, attData.summary.totalRecords) + '%' }" 
                                     class="h-full bg-amber-400 transition-all duration-500" 
                                     :title="'Late: ' + attData.summary.lateCount"></div>
                                <div v-if="attData.summary.incompleteCount" 
                                     :style="{ width: pct(attData.summary.incompleteCount, attData.summary.totalRecords) + '%' }" 
                                     class="h-full bg-indigo-400 transition-all duration-500" 
                                     :title="'Incomplete: ' + attData.summary.incompleteCount"></div>
                                <div v-if="attData.summary.absentCount" 
                                     :style="{ width: pct(attData.summary.absentCount, attData.summary.totalRecords) + '%' }" 
                                     class="h-full bg-rose-500 rounded-r-full transition-all duration-500" 
                                     :title="'Absent: ' + attData.summary.absentCount"></div>
                            </div>

                            <!-- Legend and Percentages -->
                            <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-3 border-t border-line text-xs">
                                <div class="flex items-center gap-2">
                                    <span class="h-3 w-3 rounded-full bg-emerald-500 flex-shrink-0"></span>
                                    <div>
                                        <span class="font-bold text-ink">{{ attData.summary.presentCount || 0 }} Present</span>
                                        <span class="text-[11px] text-muted block">{{ pct(attData.summary.presentCount, attData.summary.totalRecords) }}% of total</span>
                                    </div>
                                </div>
                                <div class="flex items-center gap-2">
                                    <span class="h-3 w-3 rounded-full bg-amber-400 flex-shrink-0"></span>
                                    <div>
                                        <span class="font-bold text-ink">{{ attData.summary.lateCount || 0 }} Late</span>
                                        <span class="text-[11px] text-muted block">{{ pct(attData.summary.lateCount, attData.summary.totalRecords) }}% of total</span>
                                    </div>
                                </div>
                                <div class="flex items-center gap-2">
                                    <span class="h-3 w-3 rounded-full bg-indigo-400 flex-shrink-0"></span>
                                    <div>
                                        <span class="font-bold text-ink">{{ attData.summary.incompleteCount || 0 }} Incomplete</span>
                                        <span class="text-[11px] text-muted block">{{ pct(attData.summary.incompleteCount, attData.summary.totalRecords) }}% of total</span>
                                    </div>
                                </div>
                                <div class="flex items-center gap-2">
                                    <span class="h-3 w-3 rounded-full bg-rose-500 flex-shrink-0"></span>
                                    <div>
                                        <span class="font-bold text-ink">{{ attData.summary.absentCount || 0 }} Absent</span>
                                        <span class="text-[11px] text-muted block">{{ pct(attData.summary.absentCount, attData.summary.totalRecords) }}% of total</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Comparative Hours & Department Allocation -->
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div class="card p-5 bg-white border border-line">
                                <h4 class="text-sm font-bold text-navy mb-1">Duty Hours Reconciliation Meter</h4>
                                <p class="text-[11px] text-muted mb-4">Comparison between scheduled commitment, physical punch logs, and finalized credited hours.</p>
                                
                                <div class="space-y-4">
                                    <div>
                                        <div class="flex justify-between text-xs font-semibold mb-1">
                                            <span class="text-muted">1. Scheduled Commitment Hours</span>
                                            <span class="text-navy font-bold">{{ num(attData.summary.totalScheduledHours, 1) }} hrs</span>
                                        </div>
                                        <div class="h-3 w-full rounded-full bg-slate-100 overflow-hidden">
                                            <div class="h-full bg-slate-400 rounded-full" style="width: 100%;"></div>
                                        </div>
                                    </div>

                                    <div>
                                        <div class="flex justify-between text-xs font-semibold mb-1">
                                            <span class="text-muted">2. Actual Recorded Punch Hours</span>
                                            <span class="text-ink font-bold">{{ num(attData.summary.totalRecordedHours, 1) }} hrs ({{ pct(attData.summary.totalRecordedHours, attData.summary.totalScheduledHours) }}%)</span>
                                        </div>
                                        <div class="h-3 w-full rounded-full bg-slate-100 overflow-hidden">
                                            <div class="h-full bg-blue-500 rounded-full transition-all duration-500" :style="{ width: pct(attData.summary.totalRecordedHours, attData.summary.totalScheduledHours) + '%' }"></div>
                                        </div>
                                    </div>

                                    <div>
                                        <div class="flex justify-between text-xs font-semibold mb-1">
                                            <span class="text-emerald-950 font-bold">3. Finalized Credited Duty Hours</span>
                                            <span class="text-emerald-800 font-bold">{{ num(attData.summary.totalCreditedHours, 1) }} hrs ({{ pct(attData.summary.totalCreditedHours, attData.summary.totalScheduledHours) }}%)</span>
                                        </div>
                                        <div class="h-3 w-full rounded-full bg-slate-100 overflow-hidden">
                                            <div class="h-full bg-emerald-500 rounded-full transition-all duration-500" :style="{ width: pct(attData.summary.totalCreditedHours, attData.summary.totalScheduledHours) + '%' }"></div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div class="card p-5 bg-white border border-line">
                                <h4 class="text-sm font-bold text-navy mb-1">Department Duty Share</h4>
                                <p class="text-[11px] text-muted mb-4">Credited duty hours across ITO, ACADS, and Admin Offices.</p>
                                
                                <div class="space-y-3.5">
                                    <div v-for="d in (attData.departmentSummary || [])" :key="d.department" class="space-y-1">
                                        <div class="flex items-center justify-between text-xs">
                                            <span class="font-bold text-navy flex items-center gap-1.5">
                                                <span class="rounded bg-mist px-1.5 py-0.5 text-[10px] border border-line">{{ d.department }}</span>
                                                <span>{{ d.count }} shift(s)</span>
                                            </span>
                                            <span class="font-bold text-emerald-800">{{ num(d.credited, 1) }} hrs credited</span>
                                        </div>
                                        <div class="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
                                            <div class="h-full bg-navy rounded-full transition-all duration-500" :style="{ width: pct(d.credited, attData.summary.totalCreditedHours) + '%' }"></div>
                                        </div>
                                        <div class="flex justify-between text-[10px] text-muted">
                                            <span>{{ pct(d.credited, attData.summary.totalCreditedHours) }}% of total hours</span>
                                            <span>{{ d.present }} present · {{ d.late }} late · {{ d.absent }} absent</span>
                                        </div>
                                    </div>
                                    <div v-if="!(attData.departmentSummary || []).length" class="text-center py-6 text-xs text-muted">
                                        No department breakdown available.
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- TABULAR DATA VIEW -->
                    <div v-else class="space-y-4">
                        <!-- Filters Strip (Hidden on Print) -->
                        <div class="card p-4 bg-page/40 no-print">
                            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-6">
                                <div>
                                    <label class="field-label">Search S.A.</label>
                                    <input v-model="attFilters.search" @keyup.enter="applyCategoryFilter" type="text" class="input py-1.5 text-xs" placeholder="Name or Student ID" />
                                </div>
                                <div>
                                    <label class="field-label">Department</label>
                                    <select v-model="attFilters.department" class="input py-1.5 text-xs">
                                        <option value="ALL">All Categories</option>
                                        <option value="ITO">ITO</option>
                                        <option value="ACADS">ACADS</option>
                                        <option value="OFFICE">OFFICE</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="field-label">Attendance Status</label>
                                    <select v-model="attFilters.status" class="input py-1.5 text-xs">
                                        <option value="ALL">All Statuses</option>
                                        <option value="PRESENT">Present</option>
                                        <option value="LATE">Late</option>
                                        <option value="ABSENT">Absent</option>
                                        <option value="INCOMPLETE">Incomplete</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="field-label">From Date</label>
                                    <input v-model="attFilters.startDate" type="date" class="input py-1.5 text-xs" />
                                </div>
                                <div>
                                    <label class="field-label">To Date</label>
                                    <input v-model="attFilters.endDate" type="date" class="input py-1.5 text-xs" />
                                </div>
                                <div class="flex items-end gap-1.5">
                                    <button @click="applyCategoryFilter" class="btn btn-primary btn-sm flex-1"><app-icon name="Filter" :size="13" /> Apply</button>
                                    <button @click="resetCategoryFilter" class="btn btn-secondary btn-sm"><app-icon name="RotateCcw" :size="13" /></button>
                                </div>
                            </div>
                        </div>

                        <!-- Category Summary Badges -->
                        <div class="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
                            <div class="card p-3 bg-mist/30">
                                <span class="text-caption text-muted block">Present</span>
                                <span class="text-[17px] font-bold text-emerald-700">{{ attData.summary.presentCount || 0 }}</span>
                            </div>
                            <div class="card p-3 bg-mist/30">
                                <span class="text-caption text-muted block">Late</span>
                                <span class="text-[17px] font-bold text-amber-700">{{ attData.summary.lateCount || 0 }}</span>
                            </div>
                            <div class="card p-3 bg-mist/30">
                                <span class="text-caption text-muted block">Absent</span>
                                <span class="text-[17px] font-bold text-danger">{{ attData.summary.absentCount || 0 }}</span>
                            </div>
                            <div class="card p-3 bg-mist/30">
                                <span class="text-caption text-muted block">Total Recorded</span>
                                <span class="text-[17px] font-bold text-navy">{{ num(attData.summary.totalRecordedHours, 1) }} hrs</span>
                            </div>
                            <div class="card p-3 border-emerald-300 bg-emerald-50/50">
                                <span class="text-caption text-emerald-950 font-medium block">Finalized Credited</span>
                                <span class="text-[17px] font-bold text-emerald-800">{{ num(attData.summary.totalCreditedHours, 1) }} hrs</span>
                            </div>
                        </div>

                        <!-- Table -->
                        <div class="overflow-x-auto">
                            <table class="w-full text-left text-[12px]">
                                <thead class="border-b-2 border-line bg-page font-bold text-muted">
                                    <tr>
                                        <th class="py-2.5 px-3">Student Assistant</th>
                                        <th class="py-2.5 px-2">Dept</th>
                                        <th class="py-2.5 px-2">Duty Date</th>
                                        <th class="py-2.5 px-2">Scheduled</th>
                                        <th class="py-2.5 px-2">Actual Time In/Out</th>
                                        <th class="py-2.5 px-2 text-right">Recorded</th>
                                        <th class="py-2.5 px-2 text-right font-bold text-emerald-800">Credited</th>
                                        <th class="py-2.5 px-2 text-center">Status</th>
                                        <th class="py-2.5 px-2">Reconciliation</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-line">
                                    <tr v-if="!currentCategoryRecords.length">
                                        <td colspan="9" class="p-8 text-center text-muted">No attendance records match your selected filters.</td>
                                    </tr>
                                    <tr v-for="r in paginatedRecords" :key="r.reconId || r.saProfileId" class="hover:bg-page/60">
                                        <td class="py-2.5 px-3">
                                            <div class="font-bold text-ink">{{ r.name }}</div>
                                            <div class="text-[11px] text-muted"><span v-if="r.saNumber" class="font-mono font-medium text-navy mr-1">{{ r.saNumber }} · </span>{{ r.studentId }} · {{ r.course }}</div>
                                        </td>
                                        <td class="py-2.5 px-2">
                                            <span class="rounded bg-mist px-2 py-0.5 text-[10px] font-bold text-navy border border-line">{{ r.department }}</span>
                                        </td>
                                        <td class="py-2.5 px-2 whitespace-nowrap">{{ r.dutyDate }}</td>
                                        <td class="py-2.5 px-2 whitespace-nowrap text-muted">{{ r.scheduledStart }} – {{ r.scheduledEnd }}</td>
                                        <td class="py-2.5 px-2 whitespace-nowrap font-medium text-ink">{{ r.actualTimeIn }} – {{ r.actualTimeOut }}</td>
                                        <td class="py-2.5 px-2 text-right">{{ num(r.recordedHours, 1) }} hrs</td>
                                        <td class="py-2.5 px-2 text-right font-bold text-emerald-700">{{ num(r.creditedHours, 1) }} hrs</td>
                                        <td class="py-2.5 px-2 text-center">
                                            <span class="rounded-full px-2 py-0.5 text-[10px] font-bold"
                                                  :class="r.status === 'PRESENT' ? 'bg-emerald-100 text-emerald-800' : (r.status === 'LATE' ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800')">
                                                {{ r.status }}
                                            </span>
                                        </td>
                                        <td class="py-2.5 px-2 text-[11px] text-muted">{{ r.reconciliationStatus }}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <!-- CATEGORY 2: ALLOWANCE -->
                <div v-else-if="activeTab === 'ALLOWANCE'" class="space-y-4 mt-4">
                    <!-- VISUAL ANALYTICS VIEW -->
                    <div v-if="viewMode === 'graph'" class="space-y-4">
                        <!-- Key Metrics -->
                        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div class="card p-4 bg-white border border-line">
                                <div class="flex items-center justify-between">
                                    <span class="text-caption text-muted font-medium">Projected Monthly</span>
                                    <span class="grid h-7 w-7 place-items-center rounded-lg bg-blue-100 text-navy">
                                        <app-icon name="Calculator" :size="15" />
                                    </span>
                                </div>
                                <div class="mt-2 text-xl font-black text-navy">{{ Format.peso(allowData.summary.totalEstimatedMonthly) }}</div>
                                <div class="mt-1 text-[11px] text-muted">{{ Format.peso(allowData.summary.totalEstimatedWeekly) }} / wk projected</div>
                            </div>

                            <div class="card p-4 bg-white border border-emerald-200 bg-emerald-50/30">
                                <div class="flex items-center justify-between">
                                    <span class="text-caption text-emerald-950 font-medium">Finalized Payable</span>
                                    <span class="grid h-7 w-7 place-items-center rounded-lg bg-emerald-200 text-emerald-900">
                                        <app-icon name="CheckCircle" :size="15" />
                                    </span>
                                </div>
                                <div class="mt-2 text-xl font-black text-emerald-800">{{ Format.peso(allowData.summary.totalFinalizedAllowance) }}</div>
                                <div class="mt-1 text-[11px] text-emerald-700">From {{ num(allowData.summary.totalFinalizedCreditedHours, 1) }} credited hrs</div>
                            </div>

                            <div class="card p-4 bg-white border border-line">
                                <div class="flex items-center justify-between">
                                    <span class="text-caption text-muted font-medium">Payroll Realization</span>
                                    <span class="grid h-7 w-7 place-items-center rounded-lg bg-amber-100 text-amber-800">
                                        <app-icon name="TrendingUp" :size="15" />
                                    </span>
                                </div>
                                <div class="mt-2 text-xl font-black text-navy">{{ pct(allowData.summary.totalFinalizedAllowance, allowData.summary.totalEstimatedMonthly) }}%</div>
                                <div class="mt-1 text-[11px] text-muted">Finalized vs projected estimate</div>
                            </div>

                            <div class="card p-4 bg-white border border-line">
                                <div class="flex items-center justify-between">
                                    <span class="text-caption text-muted font-medium">Average Hourly Rate</span>
                                    <span class="grid h-7 w-7 place-items-center rounded-lg bg-slate-100 text-slate-700">
                                        <app-icon name="Coins" :size="15" />
                                    </span>
                                </div>
                                <div class="mt-2 text-xl font-black text-navy">{{ Format.peso(allowData.summary.averageRate || 8.00) }}<span class="text-xs font-normal text-muted">/hr</span></div>
                                <div class="mt-1 text-[11px] text-muted">Base rate: {{ Format.peso(allowData.baseRate || 8.00) }}/hr</div>
                            </div>
                        </div>

                        <!-- Department Payroll Distribution -->
                        <div class="card p-5 bg-white border border-line">
                            <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                                <div>
                                    <h4 class="text-sm font-bold text-navy">Department Payroll Allocation</h4>
                                    <p class="text-[11px] text-muted">Comparison of projected monthly payroll vs finalized payable allowance across categories.</p>
                                </div>
                                <span class="text-xs font-bold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-md border border-emerald-200">
                                    Total Payable: {{ Format.peso(allowData.summary.totalFinalizedAllowance) }}
                                </span>
                            </div>

                            <div class="space-y-4 mt-3">
                                <div v-for="dept in (allowData.departmentSummary || [])" :key="dept.department" class="space-y-1.5 p-3 rounded-lg bg-page/50 border border-line">
                                    <div class="flex items-center justify-between text-xs">
                                        <div class="flex items-center gap-2">
                                            <span class="rounded bg-navy px-2 py-0.5 text-[10px] font-bold text-white">{{ dept.department }}</span>
                                            <span class="font-semibold text-ink">{{ dept.saCount }} Student Assistant(s)</span>
                                        </div>
                                        <div class="text-right">
                                            <span class="font-bold text-emerald-800">{{ Format.peso(dept.finalized) }} Finalized</span>
                                            <span class="text-muted text-[11px]"> / {{ Format.peso(dept.monthlyEstimated) }} Proj.</span>
                                        </div>
                                    </div>
                                    <div class="h-3 w-full rounded-full bg-slate-200 overflow-hidden flex">
                                        <div class="h-full bg-emerald-500 rounded-full transition-all duration-500" 
                                             :style="{ width: pct(dept.finalized, dept.monthlyEstimated || 1) + '%' }" 
                                             :title="'Realization: ' + pct(dept.finalized, dept.monthlyEstimated) + '%'"></div>
                                    </div>
                                    <div class="flex justify-between text-[10px] text-muted">
                                        <span>{{ pct(dept.monthlyEstimated, allowData.summary.totalEstimatedMonthly) }}% of total projected monthly budget</span>
                                        <span>{{ pct(dept.finalized, dept.monthlyEstimated) }}% realization rate</span>
                                    </div>
                                </div>
                                <div v-if="!(allowData.departmentSummary || []).length" class="text-center py-6 text-xs text-muted">
                                    No department allowance records available.
                                </div>
                            </div>
                        </div>

                        <!-- Endorsement & Computation Status Card -->
                        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
                            <div class="card p-4 bg-emerald-50/50 border border-emerald-200">
                                <span class="text-caption text-emerald-950 font-medium block">Finalized & Endorsed</span>
                                <span class="text-xl font-bold text-emerald-800 mt-1 block">
                                    {{ currentCategoryRecords.filter(r => r.computationStatus === 'FINALIZED').length }} S.A.(s)
                                </span>
                                <span class="text-[11px] text-emerald-700 mt-0.5 block">Approved for HR/Finance Endorsement</span>
                            </div>
                            <div class="card p-4 bg-amber-50/50 border border-amber-200">
                                <span class="text-caption text-amber-950 font-medium block">Awaiting Review</span>
                                <span class="text-xl font-bold text-amber-800 mt-1 block">
                                    {{ currentCategoryRecords.filter(r => r.computationStatus === 'AWAITING_REVIEW').length }} S.A.(s)
                                </span>
                                <span class="text-[11px] text-amber-700 mt-0.5 block">Credited hours pending supervisor review</span>
                            </div>
                            <div class="card p-4 bg-slate-50 border border-slate-200">
                                <span class="text-caption text-muted font-medium block">Estimated / Draft</span>
                                <span class="text-xl font-bold text-navy mt-1 block">
                                    {{ currentCategoryRecords.filter(r => r.computationStatus === 'ESTIMATED').length }} S.A.(s)
                                </span>
                                <span class="text-[11px] text-muted mt-0.5 block">Awaiting attendance punch logs</span>
                            </div>
                        </div>
                    </div>

                    <!-- TABULAR DATA VIEW -->
                    <div v-else class="space-y-4">
                        <!-- Filters Strip -->
                        <div class="card p-4 bg-page/40 no-print">
                            <div class="grid grid-cols-1 gap-3 sm:grid-cols-4">
                                <div>
                                    <label class="field-label">Search S.A.</label>
                                    <input v-model="allowFilters.search" @keyup.enter="applyCategoryFilter" type="text" class="input py-1.5 text-xs" placeholder="Name or Student ID" />
                                </div>
                                <div>
                                    <label class="field-label">Department</label>
                                    <select v-model="allowFilters.department" class="input py-1.5 text-xs">
                                        <option value="ALL">All Categories</option>
                                        <option value="ITO">ITO</option>
                                        <option value="ACADS">ACADS</option>
                                        <option value="OFFICE">OFFICE</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="field-label">Computation Status</label>
                                    <select v-model="allowFilters.status" class="input py-1.5 text-xs">
                                        <option value="ALL">All Statuses</option>
                                        <option value="ESTIMATED">Estimated / Draft</option>
                                        <option value="AWAITING_REVIEW">Awaiting Review</option>
                                        <option value="FINALIZED">Finalized / Endorsed</option>
                                    </select>
                                </div>
                                <div class="flex items-end gap-1.5">
                                    <button @click="applyCategoryFilter" class="btn btn-primary btn-sm flex-1"><app-icon name="Filter" :size="13" /> Apply</button>
                                    <button @click="resetCategoryFilter" class="btn btn-secondary btn-sm"><app-icon name="RotateCcw" :size="13" /></button>
                                </div>
                            </div>
                        </div>

                        <!-- Allowance Summary Cards -->
                        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                            <div class="card p-3 bg-mist/30">
                                <span class="text-caption text-muted block">Active S.A.s</span>
                                <span class="text-[17px] font-bold text-navy">{{ allowData.summary.totalSas || 0 }}</span>
                            </div>
                            <div class="card p-3 bg-mist/30">
                                <span class="text-caption text-muted block">Projected Monthly</span>
                                <span class="text-[17px] font-bold text-ink">{{ Format.peso(allowData.summary.totalEstimatedMonthly) }}</span>
                            </div>
                            <div class="card p-3 border-emerald-300 bg-emerald-50/50">
                                <span class="text-caption text-emerald-950 font-medium block">Total Credited Duty Hours</span>
                                <span class="text-[17px] font-bold text-emerald-800">{{ num(allowData.summary.totalFinalizedCreditedHours, 1) }} hrs</span>
                            </div>
                            <div class="card p-3 border-emerald-300 bg-emerald-50/50">
                                <span class="text-caption text-emerald-950 font-medium block">Finalized Allowance</span>
                                <span class="text-[17px] font-bold text-emerald-800">{{ Format.peso(allowData.summary.totalFinalizedAllowance) }}</span>
                            </div>
                        </div>

                        <!-- Table -->
                        <div class="overflow-x-auto">
                            <table class="w-full text-left text-[12px]">
                                <thead class="border-b-2 border-line bg-page font-bold text-muted">
                                    <tr>
                                        <th class="py-2.5 px-3">Student Assistant</th>
                                        <th class="py-2.5 px-2">Department</th>
                                        <th class="py-2.5 px-2 text-right">Hourly Rate</th>
                                        <th class="py-2.5 px-2 text-center">Weekly Target</th>
                                        <th class="py-2.5 px-2 text-right">Projected Monthly</th>
                                        <th class="py-2.5 px-2 text-center">Credited Hrs</th>
                                        <th class="py-2.5 px-2 text-right font-bold text-emerald-800">Finalized Allowance</th>
                                        <th class="py-2.5 px-2 text-center">Status</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-line">
                                    <tr v-if="!currentCategoryRecords.length">
                                        <td colspan="8" class="p-8 text-center text-muted">No allowance records found.</td>
                                    </tr>
                                    <tr v-for="r in paginatedRecords" :key="r.saProfileId" class="hover:bg-page/60">
                                        <td class="py-2.5 px-3">
                                            <div class="font-bold text-ink">{{ r.name }}</div>
                                            <div class="text-[11px] text-muted"><span v-if="r.saNumber" class="font-mono font-medium text-navy mr-1">{{ r.saNumber }} · </span>{{ r.studentId }} · {{ r.course }}</div>
                                        </td>
                                        <td class="py-2.5 px-2">
                                            <span class="rounded bg-mist px-2 py-0.5 text-[10px] font-bold text-navy border border-line">{{ r.department }}</span>
                                        </td>
                                        <td class="py-2.5 px-2 text-right font-bold text-navy">{{ Format.peso(r.hourlyRate) }}</td>
                                        <td class="py-2.5 px-2 text-center">{{ r.weeklyTargetHours }} hrs</td>
                                        <td class="py-2.5 px-2 text-right text-muted">{{ Format.peso(r.monthlyEstimated) }}</td>
                                        <td class="py-2.5 px-2 text-center font-bold text-ink">{{ Number(r.finalizedCreditedHours || 0) > 0 ? num(r.finalizedCreditedHours, 1) : '—' }}</td>
                                        <td class="py-2.5 px-2 text-right font-bold text-emerald-700">{{ Format.peso(r.finalizedAllowance) }}</td>
                                        <td class="py-2.5 px-2 text-center">
                                            <span class="rounded-full px-2 py-0.5 text-[10px] font-bold"
                                                  :class="r.computationStatus === 'FINALIZED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'">
                                                {{ r.computationStatus }}
                                            </span>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <!-- CATEGORY 3: SCHOOL BALANCE & DEDUCTION -->
                <div v-else-if="activeTab === 'SCHOOL_BALANCE'" class="space-y-4 mt-4">
                    <!-- VISUAL ANALYTICS VIEW -->
                    <div v-if="viewMode === 'graph'" class="space-y-4">
                        <!-- Top Financial Metrics -->
                        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div class="card p-4 bg-white border border-line">
                                <div class="flex items-center justify-between">
                                    <span class="text-caption text-muted font-medium">Total Cash COR Assessment</span>
                                    <span class="grid h-7 w-7 place-items-center rounded-lg bg-blue-100 text-navy">
                                        <app-icon name="FileText" :size="15" />
                                    </span>
                                </div>
                                <div class="mt-2 text-xl font-black text-ink">{{ Format.peso(balData.summary.totalCashCor) }}</div>
                                <div class="mt-1 text-[11px] text-muted">Official Registrar COR Total</div>
                            </div>

                            <div class="card p-4 bg-white border border-emerald-200 bg-emerald-50/30">
                                <div class="flex items-center justify-between">
                                    <span class="text-caption text-emerald-950 font-medium">S.A. Covered (100+70%)</span>
                                    <span class="grid h-7 w-7 place-items-center rounded-lg bg-emerald-200 text-emerald-900">
                                        <app-icon name="Award" :size="15" />
                                    </span>
                                </div>
                                <div class="mt-2 text-xl font-black text-emerald-800">− {{ Format.peso(balData.summary.totalBenefitCovered) }}</div>
                                <div class="mt-1 text-[11px] text-emerald-700">{{ pct(balData.summary.totalBenefitCovered, balData.summary.totalCashCor) }}% institutional coverage</div>
                            </div>

                            <div class="card p-4 bg-white border border-line">
                                <div class="flex items-center justify-between">
                                    <span class="text-caption text-muted font-medium">Net Student Balance</span>
                                    <span class="grid h-7 w-7 place-items-center rounded-lg bg-navy/10 text-navy">
                                        <app-icon name="Landmark" :size="15" />
                                    </span>
                                </div>
                                <div class="mt-2 text-xl font-black text-navy">{{ Format.peso(balData.summary.totalSchoolBalance) }}</div>
                                <div class="mt-1 text-[11px] text-muted">Payable via deduction or cash</div>
                            </div>

                            <div class="card p-4 bg-white border border-emerald-300 bg-emerald-50/50">
                                <div class="flex items-center justify-between">
                                    <span class="text-caption text-emerald-950 font-medium">Authorized to Deduct</span>
                                    <span class="grid h-7 w-7 place-items-center rounded-lg bg-emerald-200 text-emerald-900">
                                        <app-icon name="CheckCircle2" :size="15" />
                                    </span>
                                </div>
                                <div class="mt-2 text-xl font-black text-emerald-800">{{ Format.peso(balData.summary.authorizedAwaitingAmount) }}</div>
                                <div class="mt-1 text-[11px] text-emerald-700">{{ balData.summary.yesCount || 0 }} student(s) authorized</div>
                            </div>
                        </div>

                        <!-- Tuition Benefit Coverage Visual Ratio -->
                        <div class="card p-5 bg-white border border-line">
                            <div class="flex items-center justify-between mb-2">
                                <h4 class="text-sm font-bold text-navy">Institutional Tuition Coverage Ratio</h4>
                                <span class="text-xs font-bold text-emerald-800">
                                    {{ pct(balData.summary.totalBenefitCovered, balData.summary.totalCashCor) }}% Institutional Coverage
                                </span>
                            </div>
                            <div class="h-5 w-full rounded-full bg-slate-100 flex overflow-hidden p-0.5 border border-slate-200">
                                <div class="h-full bg-emerald-500 rounded-l-full transition-all duration-500" 
                                     :style="{ width: pct(balData.summary.totalBenefitCovered, balData.summary.totalCashCor) + '%' }" 
                                     title="S.A. Scholarship Benefit Covered"></div>
                                <div class="h-full bg-navy rounded-r-full transition-all duration-500" 
                                     :style="{ width: (100 - pct(balData.summary.totalBenefitCovered, balData.summary.totalCashCor)) + '%' }" 
                                     title="Remaining Student Balance"></div>
                            </div>
                            <div class="flex justify-between text-xs mt-2 text-muted">
                                <span class="text-emerald-700 font-semibold">● NCST Benefit: {{ Format.peso(balData.summary.totalBenefitCovered) }} (100% Tuition + 70% Misc)</span>
                                <span class="text-navy font-semibold">● S.A. Balance: {{ Format.peso(balData.summary.totalSchoolBalance) }}</span>
                            </div>
                        </div>

                        <!-- Voluntary Deduction Poll Breakdown -->
                        <div class="card p-5 bg-white border border-line">
                            <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                                <div>
                                    <h4 class="text-sm font-bold text-navy">Voluntary Deduction Poll Response Breakdown</h4>
                                    <p class="text-[11px] text-muted">Student Assistant responses to the School Balance Deduction Authorization Campaign.</p>
                                </div>
                                <span class="text-xs font-semibold text-navy bg-mist px-2.5 py-1 rounded-md border border-line">
                                    Total Responses: {{ (balData.summary.yesCount || 0) + (balData.summary.noCount || 0) + (balData.summary.pendingCount || 0) }}
                                </span>
                            </div>

                            <!-- 3-Segment Bar -->
                            <div class="h-5 w-full rounded-full bg-slate-100 flex overflow-hidden p-0.5 border border-slate-200">
                                <div v-if="balData.summary.yesCount" 
                                     :style="{ width: pct(balData.summary.yesCount, (balData.summary.yesCount + balData.summary.noCount + balData.summary.pendingCount) || 1) + '%' }" 
                                     class="h-full bg-emerald-500 rounded-l-full transition-all duration-500" 
                                     title="YES — Authorized Deduction"></div>
                                <div v-if="balData.summary.noCount" 
                                     :style="{ width: pct(balData.summary.noCount, (balData.summary.yesCount + balData.summary.noCount + balData.summary.pendingCount) || 1) + '%' }" 
                                     class="h-full bg-rose-500 transition-all duration-500" 
                                     title="NO — Personal Cash Payment"></div>
                                <div v-if="balData.summary.pendingCount" 
                                     :style="{ width: pct(balData.summary.pendingCount, (balData.summary.yesCount + balData.summary.noCount + balData.summary.pendingCount) || 1) + '%' }" 
                                     class="h-full bg-amber-400 rounded-r-full transition-all duration-500" 
                                     title="PENDING — Awaiting Response"></div>
                            </div>

                            <!-- 3 Cards Breakdown -->
                            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4 pt-3 border-t border-line">
                                <div class="card p-3 bg-emerald-50/50 border border-emerald-200">
                                    <div class="flex items-center justify-between text-xs font-bold text-emerald-800">
                                        <span>YES — Authorize Deduction</span>
                                        <span>{{ pct(balData.summary.yesCount, (balData.summary.yesCount + balData.summary.noCount + balData.summary.pendingCount) || 1) }}%</span>
                                    </div>
                                    <div class="mt-1 text-lg font-black text-emerald-900">{{ balData.summary.yesCount || 0 }} S.A.(s)</div>
                                    <div class="text-[11px] text-emerald-700 mt-0.5">{{ Format.peso(balData.summary.authorizedAwaitingAmount) }} authorized</div>
                                </div>

                                <div class="card p-3 bg-rose-50/50 border border-rose-200">
                                    <div class="flex items-center justify-between text-xs font-bold text-rose-800">
                                        <span>NO — Cash / Self Pay</span>
                                        <span>{{ pct(balData.summary.noCount, (balData.summary.yesCount + balData.summary.noCount + balData.summary.pendingCount) || 1) }}%</span>
                                    </div>
                                    <div class="mt-1 text-lg font-black text-rose-900">{{ balData.summary.noCount || 0 }} S.A.(s)</div>
                                    <div class="text-[11px] text-rose-700 mt-0.5">Pay direct to Cashier</div>
                                </div>

                                <div class="card p-3 bg-amber-50/50 border border-amber-200">
                                    <div class="flex items-center justify-between text-xs font-bold text-amber-800">
                                        <span>PENDING Response</span>
                                        <span>{{ pct(balData.summary.pendingCount, (balData.summary.yesCount + balData.summary.noCount + balData.summary.pendingCount) || 1) }}%</span>
                                    </div>
                                    <div class="mt-1 text-lg font-black text-amber-900">{{ balData.summary.pendingCount || 0 }} S.A.(s)</div>
                                    <div class="text-[11px] text-amber-700 mt-0.5">Poll active on mobile portal</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- TABULAR DATA VIEW -->
                    <div v-else class="space-y-4">
                        <!-- Filters Strip -->
                        <div class="card p-4 bg-page/40 no-print">
                            <div class="grid grid-cols-1 gap-3 sm:grid-cols-4">
                                <div>
                                    <label class="field-label">Search S.A.</label>
                                    <input v-model="balFilters.search" @keyup.enter="applyCategoryFilter" type="text" class="input py-1.5 text-xs" placeholder="Name or Student ID" />
                                </div>
                                <div>
                                    <label class="field-label">Deduction Decision</label>
                                    <select v-model="balFilters.decision" class="input py-1.5 text-xs">
                                        <option value="ALL">All Decisions</option>
                                        <option value="YES">YES — Deduct Balance</option>
                                        <option value="NO">NO — Do Not Deduct</option>
                                        <option value="PENDING">Pending Response</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="field-label">Department</label>
                                    <select v-model="balFilters.department" class="input py-1.5 text-xs">
                                        <option value="ALL">All Categories</option>
                                        <option value="ITO">ITO</option>
                                        <option value="ACADS">ACADS</option>
                                        <option value="OFFICE">OFFICE</option>
                                    </select>
                                </div>
                                <div class="flex items-end gap-1.5">
                                    <button @click="applyCategoryFilter" class="btn btn-primary btn-sm flex-1"><app-icon name="Filter" :size="13" /> Apply</button>
                                    <button @click="resetCategoryFilter" class="btn btn-secondary btn-sm"><app-icon name="RotateCcw" :size="13" /></button>
                                </div>
                            </div>
                        </div>

                        <!-- Summary Cards -->
                        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                            <div class="card p-3 bg-mist/30">
                                <span class="text-caption text-muted block">Total Cash COR</span>
                                <span class="text-[17px] font-bold text-ink">{{ Format.peso(balData.summary.totalCashCor) }}</span>
                            </div>
                            <div class="card p-3 bg-emerald-50/40 border-emerald-200">
                                <span class="text-caption text-emerald-950 font-medium block">S.A. Covered (100+70%)</span>
                                <span class="text-[17px] font-bold text-emerald-800">− {{ Format.peso(balData.summary.totalBenefitCovered) }}</span>
                            </div>
                            <div class="card p-3 border-navy/20 bg-navy/5">
                                <span class="text-caption text-navy font-semibold block">Total School Balance</span>
                                <span class="text-[17px] font-bold text-navy">{{ Format.peso(balData.summary.totalSchoolBalance) }}</span>
                            </div>
                            <div class="card p-3 border-emerald-300 bg-emerald-50/50">
                                <span class="text-caption text-emerald-950 font-medium block">Authorized to Deduct</span>
                                <span class="text-[17px] font-bold text-emerald-800">{{ Format.peso(balData.summary.authorizedAwaitingAmount) }} ({{ balData.summary.yesCount }} YES)</span>
                            </div>
                        </div>

                        <!-- Table -->
                        <div class="overflow-x-auto">
                            <table class="w-full text-left text-[12px]">
                                <thead class="border-b-2 border-line bg-page font-bold text-muted">
                                    <tr>
                                        <th class="py-2.5 px-3">Student Assistant</th>
                                        <th class="py-2.5 px-2">Dept</th>
                                        <th class="py-2.5 px-2 text-right">COR Assessment</th>
                                        <th class="py-2.5 px-2 text-right text-emerald-800">Benefit Covered</th>
                                        <th class="py-2.5 px-2 text-right">School Balance</th>
                                        <th class="py-2.5 px-2 text-center">Decision</th>
                                        <th class="py-2.5 px-2 text-right">Authorized</th>
                                        <th class="py-2.5 px-2 text-right">Deducted</th>
                                        <th class="py-2.5 px-2 text-right font-bold text-navy">Net Balance</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-line">
                                    <tr v-if="!currentCategoryRecords.length">
                                        <td colspan="9" class="p-8 text-center text-muted">No student balance records found matching filters.</td>
                                    </tr>
                                    <tr v-for="r in paginatedRecords" :key="r.saProfileId" class="hover:bg-page/60">
                                        <td class="py-2.5 px-3">
                                            <div class="font-bold text-ink">{{ r.name }}</div>
                                            <div class="text-[11px] text-muted"><span v-if="r.saNumber" class="font-mono font-medium text-navy mr-1">{{ r.saNumber }} · </span>{{ r.studentId }} · {{ r.course }}</div>
                                        </td>
                                        <td class="py-2.5 px-2">
                                            <span class="rounded bg-mist px-2 py-0.5 text-[10px] font-bold text-navy border border-line">{{ r.department }}</span>
                                        </td>
                                        <td class="py-2.5 px-2 text-right font-medium">{{ Format.peso(r.cashCor) }}</td>
                                        <td class="py-2.5 px-2 text-right text-emerald-700 font-medium">− {{ Format.peso(r.benefitCovered) }}</td>
                                        <td class="py-2.5 px-2 text-right font-bold text-ink">{{ Format.peso(r.schoolBalance) }}</td>
                                        <td class="py-2.5 px-2 text-center">
                                            <span class="rounded-full px-2 py-0.5 text-[10px] font-bold"
                                                  :class="r.decision === 'YES' ? 'bg-emerald-100 text-emerald-800' : (r.decision === 'NO' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800')">
                                                {{ r.decision }}
                                            </span>
                                        </td>
                                        <td class="py-2.5 px-2 text-right font-medium text-emerald-800">{{ r.decision === 'YES' ? Format.peso(r.authorizedAmount) : '—' }}</td>
                                        <td class="py-2.5 px-2 text-right font-medium text-ink">{{ r.confirmedDeducted > 0 ? Format.peso(r.confirmedDeducted) : '—' }}</td>
                                        <td class="py-2.5 px-2 text-right font-bold text-navy">{{ Format.peso(r.remainingNetBalance) }}</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <!-- CATEGORY 4: S.A. SUMMARY -->
                <div v-else-if="activeTab === 'SA_SUMMARY'" class="space-y-4 mt-4">
                    <!-- VISUAL ANALYTICS VIEW -->
                    <div v-if="viewMode === 'graph'" class="space-y-4">
                        <!-- Roster Metrics -->
                        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div class="card p-4 bg-white border border-line">
                                <div class="flex items-center justify-between">
                                    <span class="text-caption text-muted font-medium">Total Registered</span>
                                    <span class="grid h-7 w-7 place-items-center rounded-lg bg-navy/10 text-navy">
                                        <app-icon name="Users" :size="15" />
                                    </span>
                                </div>
                                <div class="mt-2 text-2xl font-black text-navy">{{ saData.summary.totalSas || 0 }}</div>
                                <div class="mt-1 text-[11px] text-muted">Complete institutional roster</div>
                            </div>

                            <div class="card p-4 bg-white border border-emerald-200 bg-emerald-50/30">
                                <div class="flex items-center justify-between">
                                    <span class="text-caption text-emerald-950 font-medium">Active S.A.s</span>
                                    <span class="grid h-7 w-7 place-items-center rounded-lg bg-emerald-200 text-emerald-900">
                                        <app-icon name="CheckCircle2" :size="15" />
                                    </span>
                                </div>
                                <div class="mt-2 text-2xl font-black text-emerald-800">{{ saData.summary.activeSas || 0 }}</div>
                                <div class="mt-1 text-[11px] text-emerald-700">{{ pct(saData.summary.activeSas, saData.summary.totalSas) }}% active duty status</div>
                            </div>

                            <div class="card p-4 bg-white border border-line">
                                <div class="flex items-center justify-between">
                                    <span class="text-caption text-muted font-medium">Biometrics Verified</span>
                                    <span class="grid h-7 w-7 place-items-center rounded-lg bg-blue-100 text-navy">
                                        <app-icon name="ScanFace" :size="15" />
                                    </span>
                                </div>
                                <div class="mt-2 text-2xl font-black text-navy">{{ saData.summary.fullyCompliantCount || 0 }}</div>
                                <div class="mt-1 text-[11px] text-muted">{{ pct(saData.summary.fullyCompliantCount, saData.summary.totalSas) }}% face enrolled</div>
                            </div>

                            <div class="card p-4 bg-white border border-line">
                                <div class="flex items-center justify-between">
                                    <span class="text-caption text-muted font-medium">Weekly Target Hours</span>
                                    <span class="grid h-7 w-7 place-items-center rounded-lg bg-amber-100 text-amber-800">
                                        <app-icon name="Clock" :size="15" />
                                    </span>
                                </div>
                                <div class="mt-2 text-2xl font-black text-navy">{{ saData.summary.totalWeeklyTargetHours || 0 }} <span class="text-xs font-normal text-muted">hrs</span></div>
                                <div class="mt-1 text-[11px] text-muted">Total weekly campus workforce</div>
                            </div>
                        </div>

                        <!-- Department Allocation Breakdown -->
                        <div class="card p-5 bg-white border border-line">
                            <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                                <div>
                                    <h4 class="text-sm font-bold text-navy">Department Category Allocation</h4>
                                    <p class="text-[11px] text-muted">Distribution of active Student Assistants across Information Tech (ITO), Academics (ACADS), and Admin Offices.</p>
                                </div>
                                <span class="text-xs font-semibold text-navy bg-mist px-2.5 py-1 rounded-md border border-line">
                                    Roster: {{ saData.summary.totalSas || 0 }} S.A.s
                                </span>
                            </div>

                            <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
                                <div class="p-4 rounded-xl bg-page/60 border border-line space-y-2">
                                    <div class="flex items-center justify-between">
                                        <span class="rounded bg-navy px-2 py-0.5 text-xs font-bold text-white">ITO</span>
                                        <span class="text-xs font-bold text-navy">{{ pct(saData.summary.itoCount, saData.summary.totalSas) }}%</span>
                                    </div>
                                    <div class="text-2xl font-black text-navy">{{ saData.summary.itoCount || 0 }} <span class="text-xs font-medium text-muted">S.A.s</span></div>
                                    <div class="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
                                        <div class="h-full bg-navy rounded-full" :style="{ width: pct(saData.summary.itoCount, saData.summary.totalSas) + '%' }"></div>
                                    </div>
                                    <div class="text-[11px] text-muted">Information Technology Office labs</div>
                                </div>

                                <div class="p-4 rounded-xl bg-page/60 border border-line space-y-2">
                                    <div class="flex items-center justify-between">
                                        <span class="rounded bg-emerald-800 px-2 py-0.5 text-xs font-bold text-white">ACADS</span>
                                        <span class="text-xs font-bold text-emerald-800">{{ pct(saData.summary.acadsCount, saData.summary.totalSas) }}%</span>
                                    </div>
                                    <div class="text-2xl font-black text-navy">{{ saData.summary.acadsCount || 0 }} <span class="text-xs font-medium text-muted">S.A.s</span></div>
                                    <div class="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
                                        <div class="h-full bg-emerald-600 rounded-full" :style="{ width: pct(saData.summary.acadsCount, saData.summary.totalSas) + '%' }"></div>
                                    </div>
                                    <div class="text-[11px] text-muted">Academic Departments & Faculty</div>
                                </div>

                                <div class="p-4 rounded-xl bg-page/60 border border-line space-y-2">
                                    <div class="flex items-center justify-between">
                                        <span class="rounded bg-amber-600 px-2 py-0.5 text-xs font-bold text-white">OFFICE</span>
                                        <span class="text-xs font-bold text-amber-700">{{ pct(saData.summary.officeCount, saData.summary.totalSas) }}%</span>
                                    </div>
                                    <div class="text-2xl font-black text-navy">{{ saData.summary.officeCount || 0 }} <span class="text-xs font-medium text-muted">S.A.s</span></div>
                                    <div class="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
                                        <div class="h-full bg-amber-500 rounded-full" :style="{ width: pct(saData.summary.officeCount, saData.summary.totalSas) + '%' }"></div>
                                    </div>
                                    <div class="text-[11px] text-muted">Administrative & Student Service Offices</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- TABULAR DATA VIEW -->
                    <div v-else class="space-y-4">
                        <!-- Filters Strip -->
                        <div class="card p-4 bg-page/40 no-print">
                            <div class="grid grid-cols-1 gap-3 sm:grid-cols-4">
                                <div>
                                    <label class="field-label">Search S.A.</label>
                                    <input v-model="saFilters.search" @keyup.enter="applyCategoryFilter" type="text" class="input py-1.5 text-xs" placeholder="Name, ID, or Course" />
                                </div>
                                <div>
                                    <label class="field-label">Department</label>
                                    <select v-model="saFilters.department" class="input py-1.5 text-xs">
                                        <option value="ALL">All Categories</option>
                                        <option value="ITO">ITO</option>
                                        <option value="ACADS">ACADS</option>
                                        <option value="OFFICE">OFFICE</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="field-label">Status</label>
                                    <select v-model="saFilters.status" class="input py-1.5 text-xs">
                                        <option value="ALL">All Statuses</option>
                                        <option value="ACTIVE">Active</option>
                                        <option value="INACTIVE">Inactive</option>
                                    </select>
                                </div>
                                <div class="flex items-end gap-1.5">
                                    <button @click="applyCategoryFilter" class="btn btn-primary btn-sm flex-1"><app-icon name="Filter" :size="13" /> Apply</button>
                                    <button @click="resetCategoryFilter" class="btn btn-secondary btn-sm"><app-icon name="RotateCcw" :size="13" /></button>
                                </div>
                            </div>
                        </div>

                        <!-- Summary Cards -->
                        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                            <div class="card p-3 bg-mist/30">
                                <span class="text-caption text-muted block">Total Roster</span>
                                <span class="text-[17px] font-bold text-navy">{{ saData.summary.totalSas || 0 }} S.A.(s)</span>
                            </div>
                            <div class="card p-3 bg-mist/30">
                                <span class="text-caption text-muted block">Department Distribution</span>
                                <span class="text-xs font-semibold text-ink mt-1 block">
                                    ITO: {{ saData.summary.itoCount || 0 }} · ACADS: {{ saData.summary.acadsCount || 0 }} · OFFICE: {{ saData.summary.officeCount || 0 }}
                                </span>
                            </div>
                            <div class="card p-3 bg-mist/30">
                                <span class="text-caption text-muted block">Weekly Target Hours</span>
                                <span class="text-[17px] font-bold text-ink">{{ saData.summary.totalWeeklyTargetHours || 0 }} hrs</span>
                            </div>
                            <div class="card p-3 border-emerald-300 bg-emerald-50/50">
                                <span class="text-caption text-emerald-950 font-medium block">Biometrics & COR Verified</span>
                                <span class="text-[17px] font-bold text-emerald-800">{{ saData.summary.fullyCompliantCount || 0 }} S.A.(s)</span>
                            </div>
                        </div>

                        <!-- Table -->
                        <div class="overflow-x-auto">
                            <table class="w-full text-left text-[12px]">
                                <thead class="border-b-2 border-line bg-page font-bold text-muted">
                                    <tr>
                                        <th class="py-2.5 px-3">Student Assistant</th>
                                        <th class="py-2.5 px-2">Category</th>
                                        <th class="py-2.5 px-2">Assigned Post</th>
                                        <th class="py-2.5 px-2">Designated Supervisor</th>
                                        <th class="py-2.5 px-2 text-center">Weekly Target</th>
                                        <th class="py-2.5 px-2 text-right">Rate</th>
                                        <th class="py-2.5 px-2 text-center">Status</th>
                                        <th class="py-2.5 px-2 text-center">Biometrics</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-line">
                                    <tr v-if="!currentCategoryRecords.length">
                                        <td colspan="8" class="p-8 text-center text-muted">No Student Assistants found matching filters.</td>
                                    </tr>
                                    <tr v-for="r in paginatedRecords" :key="r.saProfileId" class="hover:bg-page/60">
                                        <td class="py-2.5 px-3">
                                            <div class="font-bold text-ink">{{ r.name }}</div>
                                            <div class="text-[11px] text-muted"><span v-if="r.saNumber" class="font-mono font-medium text-navy mr-1">{{ r.saNumber }} · </span>{{ r.studentId }} · {{ r.course }}</div>
                                        </td>
                                        <td class="py-2.5 px-2">
                                            <span class="rounded bg-mist px-2 py-0.5 text-[10px] font-bold text-navy border border-line">{{ r.department }}</span>
                                        </td>
                                        <td class="py-2.5 px-2 font-medium text-ink">{{ r.post }}</td>
                                        <td class="py-2.5 px-2 text-muted">{{ r.supervisor }}</td>
                                        <td class="py-2.5 px-2 text-center">{{ r.weeklyTargetHours }} hrs/wk</td>
                                        <td class="py-2.5 px-2 text-right font-bold text-navy">{{ Format.peso(r.hourlyRate) }}</td>
                                        <td class="py-2.5 px-2 text-center">
                                            <span class="rounded-full px-2 py-0.5 text-[10px] font-bold"
                                                  :class="r.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-800' : 'bg-gray-100 text-gray-700'">
                                                {{ r.status }}
                                            </span>
                                        </td>
                                        <td class="py-2.5 px-2 text-center">
                                            <span v-if="r.faceEnrolled" class="text-emerald-700 font-bold text-[11px]">Enrolled</span>
                                            <span v-else class="text-amber-700 text-[11px]">Pending</span>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <!-- CATEGORY 5: SCHEDULE & DUTY COVERAGE -->
                <div v-else-if="activeTab === 'SCHEDULE_COVERAGE'" class="space-y-4 mt-4">
                    <!-- VISUAL ANALYTICS VIEW -->
                    <div v-if="viewMode === 'graph'" class="space-y-4">
                        <!-- Shift Coverage Metrics -->
                        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div class="card p-4 bg-white border border-emerald-200 bg-emerald-50/30">
                                <div class="flex items-center justify-between">
                                    <span class="text-caption text-emerald-950 font-medium">Duty Coverage Rate</span>
                                    <span class="grid h-7 w-7 place-items-center rounded-lg bg-emerald-200 text-emerald-900">
                                        <app-icon name="CheckCheck" :size="15" />
                                    </span>
                                </div>
                                <div class="mt-2 text-2xl font-black text-emerald-800">{{ schedData.summary.coverageRate || 0 }}%</div>
                                <div class="mt-1 text-[11px] text-emerald-700">{{ schedData.summary.fulfilledSlots || 0 }} of {{ schedData.summary.totalDutySlots || 0 }} slots staffed</div>
                            </div>

                            <div class="card p-4 bg-white border border-line">
                                <div class="flex items-center justify-between">
                                    <span class="text-caption text-muted font-medium">Coverage Gaps</span>
                                    <span class="grid h-7 w-7 place-items-center rounded-lg" :class="(schedData.summary.coverageGaps || 0) > 0 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600'">
                                        <app-icon name="AlertCircle" :size="15" />
                                    </span>
                                </div>
                                <div class="mt-2 text-2xl font-black" :class="(schedData.summary.coverageGaps || 0) > 0 ? 'text-amber-800' : 'text-navy'">{{ schedData.summary.coverageGaps || 0 }}</div>
                                <div class="mt-1 text-[11px] text-muted">Unassigned shifts needing deployment</div>
                            </div>

                            <div class="card p-4 bg-white border border-line">
                                <div class="flex items-center justify-between">
                                    <span class="text-caption text-muted font-medium">Total Scheduled Hours</span>
                                    <span class="grid h-7 w-7 place-items-center rounded-lg bg-blue-100 text-navy">
                                        <app-icon name="CalendarDays" :size="15" />
                                    </span>
                                </div>
                                <div class="mt-2 text-2xl font-black text-navy">{{ num(schedData.summary.totalScheduledHours, 1) }} <span class="text-xs font-normal text-muted">hrs</span></div>
                                <div class="mt-1 text-[11px] text-muted">Weekly planned duty commitment</div>
                            </div>

                            <div class="card p-4 bg-white border border-line">
                                <div class="flex items-center justify-between">
                                    <span class="text-caption text-muted font-medium">Schedule Conflicts</span>
                                    <span class="grid h-7 w-7 place-items-center rounded-lg" :class="(schedData.summary.conflictCount || 0) > 0 ? 'bg-rose-100 text-rose-800' : 'bg-emerald-100 text-emerald-800'">
                                        <app-icon name="ShieldCheck" :size="15" />
                                    </span>
                                </div>
                                <div class="mt-2 text-2xl font-black" :class="(schedData.summary.conflictCount || 0) > 0 ? 'text-rose-800' : 'text-emerald-800'">{{ schedData.summary.conflictCount || 0 }}</div>
                                <div class="mt-1 text-[11px] text-muted">{{ (schedData.summary.conflictCount || 0) > 0 ? 'Double-bookings detected' : 'Zero schedule overlaps' }}</div>
                            </div>
                        </div>

                        <!-- Campus Coverage Visual Progress Meter -->
                        <div class="card p-5 bg-white border border-line">
                            <div class="flex items-center justify-between mb-2">
                                <div>
                                    <h4 class="text-sm font-bold text-navy">Campus Duty Slot Fulfillment Gauge</h4>
                                    <p class="text-[11px] text-muted">Proportion of campus duty assignments fully covered vs unassigned shift gaps.</p>
                                </div>
                                <span class="text-xs font-bold px-2.5 py-1 rounded-md" 
                                      :class="(schedData.summary.coverageRate || 0) >= 90 ? 'bg-emerald-100 text-emerald-800' : ((schedData.summary.coverageRate || 0) >= 70 ? 'bg-amber-100 text-amber-800' : 'bg-rose-100 text-rose-800')">
                                    {{ schedData.summary.coverageRate || 0 }}% Staffed
                                </span>
                            </div>
                            <div class="h-5 w-full rounded-full bg-slate-100 flex overflow-hidden p-0.5 border border-slate-200">
                                <div class="h-full rounded-l-full transition-all duration-500" 
                                     :class="(schedData.summary.coverageRate || 0) >= 90 ? 'bg-emerald-500' : ((schedData.summary.coverageRate || 0) >= 70 ? 'bg-amber-400' : 'bg-rose-500')"
                                     :style="{ width: (schedData.summary.coverageRate || 0) + '%' }" 
                                     title="Fulfilled Duty Slots"></div>
                                <div class="h-full bg-slate-300 rounded-r-full transition-all duration-500" 
                                     :style="{ width: (100 - (schedData.summary.coverageRate || 0)) + '%' }" 
                                     title="Coverage Gaps"></div>
                            </div>
                            <div class="flex justify-between text-xs mt-2 text-muted">
                                <span class="font-bold text-emerald-800">● Fulfilled: {{ schedData.summary.fulfilledSlots || 0 }} duty blocks</span>
                                <span class="font-bold text-amber-800">● Unassigned Gaps: {{ schedData.summary.coverageGaps || 0 }} slots</span>
                            </div>
                        </div>

                        <!-- Weekday Shift Load Chart -->
                        <div class="card p-5 bg-white border border-line">
                            <h4 class="text-sm font-bold text-navy mb-1">Weekday Shift Load Distribution</h4>
                            <p class="text-[11px] text-muted mb-4">Total scheduled duty slots across days of the operational academic week.</p>
                            
                            <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
                                <div v-for="d in schedWeekdayStats" :key="d.key" class="p-3 rounded-xl bg-page/60 border border-line text-center space-y-2">
                                    <span class="text-xs font-bold text-navy">{{ d.label }}</span>
                                    <div class="text-xl font-black text-ink">{{ d.count }}</div>
                                    <div class="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
                                        <div class="h-full bg-navy rounded-full transition-all duration-500" :style="{ width: d.pct + '%' }"></div>
                                    </div>
                                    <span class="text-[10px] text-muted block">{{ d.count }} shift(s)</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- TABULAR DATA VIEW -->
                    <div v-else class="space-y-4">
                        <!-- Filters Strip -->
                        <div class="card p-4 bg-page/40 no-print">
                            <div class="grid grid-cols-1 gap-3 sm:grid-cols-4">
                                <div>
                                    <label class="field-label">Day of Week</label>
                                    <select v-model="schedFilters.dayOfWeek" class="input py-1.5 text-xs">
                                        <option value="ALL">All Days</option>
                                        <option value="MON">Monday</option>
                                        <option value="TUE">Tuesday</option>
                                        <option value="WED">Wednesday</option>
                                        <option value="THU">Thursday</option>
                                        <option value="FRI">Friday</option>
                                        <option value="SAT">Saturday</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="field-label">Coverage Status</label>
                                    <select v-model="schedFilters.coverageStatus" class="input py-1.5 text-xs">
                                        <option value="ALL">All Slots</option>
                                        <option value="FULFILLED">Fulfilled Coverage</option>
                                        <option value="GAP">Coverage Gaps (Unassigned)</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="field-label">Department</label>
                                    <select v-model="schedFilters.department" class="input py-1.5 text-xs">
                                        <option value="ALL">All Departments</option>
                                        <option value="ITO">ITO</option>
                                        <option value="ACADS">ACADS</option>
                                        <option value="OFFICE">OFFICE</option>
                                    </select>
                                </div>
                                <div class="flex items-end gap-1.5">
                                    <button @click="applyCategoryFilter" class="btn btn-primary btn-sm flex-1"><app-icon name="Filter" :size="13" /> Apply</button>
                                    <button @click="resetCategoryFilter" class="btn btn-secondary btn-sm"><app-icon name="RotateCcw" :size="13" /></button>
                                </div>
                            </div>
                        </div>

                        <!-- Summary Cards -->
                        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                            <div class="card p-3 bg-mist/30">
                                <span class="text-caption text-muted block">Total Duty Slots</span>
                                <span class="text-[17px] font-bold text-navy">{{ schedData.summary.totalDutySlots || 0 }}</span>
                            </div>
                            <div class="card p-3 border-emerald-300 bg-emerald-50/50">
                                <span class="text-caption text-emerald-950 font-medium block">Fulfilled Slots</span>
                                <span class="text-[17px] font-bold text-emerald-800">{{ schedData.summary.fulfilledSlots || 0 }} ({{ schedData.summary.coverageRate || 0 }}%)</span>
                            </div>
                            <div class="card p-3 border-amber-300 bg-amber-50/50">
                                <span class="text-caption text-amber-950 font-medium block">Coverage Gaps</span>
                                <span class="text-[17px] font-bold text-amber-900">{{ schedData.summary.coverageGaps || 0 }} unassigned</span>
                            </div>
                            <div class="card p-3 bg-mist/30">
                                <span class="text-caption text-muted block">Total Scheduled Hours</span>
                                <span class="text-[17px] font-bold text-ink">{{ num(schedData.summary.totalScheduledHours, 1) }} hrs</span>
                            </div>
                        </div>

                        <!-- Table -->
                        <div class="overflow-x-auto">
                            <table class="w-full text-left text-[12px]">
                                <thead class="border-b-2 border-line bg-page font-bold text-muted">
                                    <tr>
                                        <th class="py-2.5 px-3">Day</th>
                                        <th class="py-2.5 px-2">Time Slot</th>
                                        <th class="py-2.5 px-2 text-center">Hours</th>
                                        <th class="py-2.5 px-2">Department</th>
                                        <th class="py-2.5 px-2">Location / Room</th>
                                        <th class="py-2.5 px-2">Assigned S.A.</th>
                                        <th class="py-2.5 px-2 text-center">Coverage Status</th>
                                        <th class="py-2.5 px-2 text-center">Conflict Status</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-line">
                                    <tr v-if="!currentCategoryRecords.length">
                                        <td colspan="8" class="p-8 text-center text-muted">No duty slots match your filters.</td>
                                    </tr>
                                    <tr v-for="r in paginatedRecords" :key="r.slotId || r.assignment_id || (r.dayOfWeek + r.startTime + r.location)" class="hover:bg-page/60">
                                        <td class="py-2.5 px-3 font-bold text-navy">{{ r.dayOfWeek }}</td>
                                        <td class="py-2.5 px-2 whitespace-nowrap">{{ r.startTime }} – {{ r.endTime }}</td>
                                        <td class="py-2.5 px-2 text-center">{{ r.hours }} hrs</td>
                                        <td class="py-2.5 px-2">
                                            <span class="rounded bg-mist px-2 py-0.5 text-[10px] font-bold text-navy border border-line">{{ r.department }}</span>
                                        </td>
                                        <td class="py-2.5 px-2 font-medium text-ink">{{ r.location }}</td>
                                        <td class="py-2.5 px-2 font-semibold" :class="r.type === 'GAP' ? 'text-amber-800' : 'text-ink'">
                                            {{ r.assignedSa }}
                                        </td>
                                        <td class="py-2.5 px-2 text-center">
                                            <span class="rounded-full px-2 py-0.5 text-[10px] font-bold"
                                                  :class="r.coverageStatus === 'FULFILLED' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'">
                                                {{ r.coverageStatus }}
                                            </span>
                                        </td>
                                        <td class="py-2.5 px-2 text-center">
                                            <span v-if="r.conflictStatus === 'CONFLICT_DETECTED'" class="text-rose-700 font-bold text-[11px]">Conflict</span>
                                            <span v-else class="text-muted text-[11px]">Clean</span>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <!-- CATEGORY 6: EXCEPTIONS & AUDIT -->
                <div v-else-if="activeTab === 'EXCEPTIONS_AUDIT'" class="space-y-4 mt-4">
                    <!-- VISUAL ANALYTICS VIEW -->
                    <div v-if="viewMode === 'graph'" class="space-y-4">
                        <!-- Audit Metrics -->
                        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div class="card p-4 bg-white border border-line">
                                <div class="flex items-center justify-between">
                                    <span class="text-caption text-muted font-medium">Total Logged Events</span>
                                    <span class="grid h-7 w-7 place-items-center rounded-lg bg-navy/10 text-navy">
                                        <app-icon name="ShieldAlert" :size="15" />
                                    </span>
                                </div>
                                <div class="mt-2 text-2xl font-black text-navy">{{ auditData.summary.totalEvents || 0 }}</div>
                                <div class="mt-1 text-[11px] text-muted">Audited system transactions</div>
                            </div>

                            <div class="card p-4 bg-white border border-line">
                                <div class="flex items-center justify-between">
                                    <span class="text-caption text-muted font-medium">Attendance Corrections</span>
                                    <span class="grid h-7 w-7 place-items-center rounded-lg bg-amber-100 text-amber-800">
                                        <app-icon name="Clock" :size="15" />
                                    </span>
                                </div>
                                <div class="mt-2 text-2xl font-black text-amber-800">{{ auditData.summary.attendanceIssues || 0 }}</div>
                                <div class="mt-1 text-[11px] text-muted">Missing logs & reconciliation requests</div>
                            </div>

                            <div class="card p-4 bg-white border border-line">
                                <div class="flex items-center justify-between">
                                    <span class="text-caption text-muted font-medium">Rate Revisions</span>
                                    <span class="grid h-7 w-7 place-items-center rounded-lg bg-emerald-100 text-emerald-800">
                                        <app-icon name="Coins" :size="15" />
                                    </span>
                                </div>
                                <div class="mt-2 text-2xl font-black text-emerald-800">{{ auditData.summary.allowanceRateChanges || 0 }}</div>
                                <div class="mt-1 text-[11px] text-muted">Hourly rate adjustment records</div>
                            </div>

                            <div class="card p-4 bg-white border border-line">
                                <div class="flex items-center justify-between">
                                    <span class="text-caption text-muted font-medium">Deduction Changes</span>
                                    <span class="grid h-7 w-7 place-items-center rounded-lg bg-indigo-100 text-indigo-800">
                                        <app-icon name="Landmark" :size="15" />
                                    </span>
                                </div>
                                <div class="mt-2 text-2xl font-black text-indigo-800">{{ auditData.summary.deductionChanges || 0 }}</div>
                                <div class="mt-1 text-[11px] text-muted">School balance authorization modifications</div>
                            </div>
                        </div>

                        <!-- System Audit Distribution by Module -->
                        <div class="card p-5 bg-white border border-line">
                            <h4 class="text-sm font-bold text-navy mb-1">Audit Distribution by System Module</h4>
                            <p class="text-[11px] text-muted mb-4">Event frequency across operational modules recorded in immutable audit logs.</p>
                            
                            <div class="space-y-4">
                                <div v-for="m in auditModuleStats" :key="m.label" class="space-y-1.5">
                                    <div class="flex items-center justify-between text-xs">
                                        <span class="font-bold" :class="m.text">{{ m.label }}</span>
                                        <span class="font-bold text-ink">{{ m.count }} event(s) ({{ m.pct }}%)</span>
                                    </div>
                                    <div class="h-3 w-full rounded-full bg-slate-100 overflow-hidden">
                                        <div class="h-full rounded-full transition-all duration-500" :class="m.color" :style="{ width: m.pct + '%' }"></div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- System Integrity Indicator -->
                        <div class="p-4 rounded-xl border border-emerald-200 bg-emerald-50/60 flex items-center gap-3">
                            <span class="grid h-10 w-10 place-items-center rounded-xl bg-emerald-100 text-emerald-800 flex-shrink-0">
                                <app-icon name="ShieldCheck" :size="20" />
                            </span>
                            <div>
                                <h5 class="text-xs font-bold text-emerald-950">System Audit Trail Active & Compliant</h5>
                                <p class="text-[11px] text-emerald-800">All attendance adjustments, missing punches, hourly rates, and voluntary deductions are recorded with user attribution and timestamps.</p>
                            </div>
                        </div>
                    </div>

                    <!-- TABULAR DATA VIEW -->
                    <div v-else class="space-y-4">
                        <!-- Filters Strip -->
                        <div class="card p-4 bg-page/40 no-print">
                            <div class="grid grid-cols-1 gap-3 sm:grid-cols-5">
                                <div>
                                    <label class="field-label">Search Keyword</label>
                                    <input v-model="auditFilters.search" @keyup.enter="applyCategoryFilter" type="text" class="input py-1.5 text-xs" placeholder="Action, S.A., or user" />
                                </div>
                                <div>
                                    <label class="field-label">System Module</label>
                                    <select v-model="auditFilters.module" class="input py-1.5 text-xs">
                                        <option value="ALL">All Modules</option>
                                        <option value="ATTENDANCE">Attendance & Corrections</option>
                                        <option value="ALLOWANCE">Allowance & Rates</option>
                                        <option value="SCHOOL_BALANCE">School Balances & Deductions</option>
                                        <option value="SCHEDULING">Duty Scheduling</option>
                                        <option value="SECURITY">Security & Access</option>
                                    </select>
                                </div>
                                <div>
                                    <label class="field-label">From Date</label>
                                    <input v-model="auditFilters.startDate" type="date" class="input py-1.5 text-xs" />
                                </div>
                                <div>
                                    <label class="field-label">To Date</label>
                                    <input v-model="auditFilters.endDate" type="date" class="input py-1.5 text-xs" />
                                </div>
                                <div class="flex items-end gap-1.5">
                                    <button @click="applyCategoryFilter" class="btn btn-primary btn-sm flex-1"><app-icon name="Filter" :size="13" /> Apply</button>
                                    <button @click="resetCategoryFilter" class="btn btn-secondary btn-sm"><app-icon name="RotateCcw" :size="13" /></button>
                                </div>
                            </div>
                        </div>

                        <!-- Summary Cards -->
                        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                            <div class="card p-3 bg-mist/30">
                                <span class="text-caption text-muted block">Total Logged Events</span>
                                <span class="text-[17px] font-bold text-navy">{{ auditData.summary.totalEvents || 0 }}</span>
                            </div>
                            <div class="card p-3 bg-mist/30">
                                <span class="text-caption text-muted block">Attendance Issues</span>
                                <span class="text-[17px] font-bold text-amber-700">{{ auditData.summary.attendanceIssues || 0 }}</span>
                            </div>
                            <div class="card p-3 bg-mist/30">
                                <span class="text-caption text-muted block">Rate & Payroll Adjustments</span>
                                <span class="text-[17px] font-bold text-emerald-800">{{ auditData.summary.allowanceRateChanges || 0 }}</span>
                            </div>
                            <div class="card p-3 bg-mist/30">
                                <span class="text-caption text-muted block">Deduction Changes</span>
                                <span class="text-[17px] font-bold text-indigo-700">{{ auditData.summary.deductionChanges || 0 }}</span>
                            </div>
                        </div>

                        <!-- Table -->
                        <div class="overflow-x-auto">
                            <table class="w-full text-left text-[12px]">
                                <thead class="border-b-2 border-line bg-page font-bold text-muted">
                                    <tr>
                                        <th class="py-2.5 px-3">Date & Time</th>
                                        <th class="py-2.5 px-2">Module</th>
                                        <th class="py-2.5 px-2">Action / Issue Type</th>
                                        <th class="py-2.5 px-2">Reference</th>
                                        <th class="py-2.5 px-3">Details / Audit Reason</th>
                                        <th class="py-2.5 px-2">Responsible User</th>
                                        <th class="py-2.5 px-2 text-center">Status</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-line">
                                    <tr v-if="!currentCategoryRecords.length">
                                        <td colspan="7" class="p-8 text-center text-muted">No exception or audit events match your filters.</td>
                                    </tr>
                                    <tr v-for="r in paginatedRecords" :key="r.id" class="hover:bg-page/60">
                                        <td class="py-2.5 px-3 whitespace-nowrap text-muted">{{ r.timestamp }}</td>
                                        <td class="py-2.5 px-2">
                                            <span class="rounded bg-mist px-2 py-0.5 text-[10px] font-bold text-navy border border-line">{{ r.module }}</span>
                                        </td>
                                        <td class="py-2.5 px-2 font-mono font-bold text-ink">{{ r.action }}</td>
                                        <td class="py-2.5 px-2 text-muted">{{ r.reference }}</td>
                                        <td class="py-2.5 px-3 font-medium text-ink max-w-xs truncate">{{ r.details }}</td>
                                        <td class="py-2.5 px-2 text-muted">{{ r.responsibleUser }}</td>
                                        <td class="py-2.5 px-2 text-center">
                                            <span class="rounded-full px-2 py-0.5 text-[10px] font-bold bg-mist text-navy border border-line">
                                                {{ r.status }}
                                            </span>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <!-- Pagination Footer (Hidden in Print) -->
                <div v-if="totalPages > 1 && viewMode === 'table'" class="mt-4 pt-4 border-t border-line flex items-center justify-between no-print text-xs">
                    <span class="text-muted">
                        Showing page <b>{{ page }}</b> of <b>{{ totalPages }}</b> ({{ currentCategoryRecords.length }} records total)
                    </span>
                    <div class="flex items-center gap-1.5">
                        <button @click="page--" :disabled="page <= 1" class="btn btn-secondary btn-sm px-2.5 py-1">
                            Previous
                        </button>
                        <span class="px-2 font-bold text-navy">{{ page }} / {{ totalPages }}</span>
                        <button @click="page++" :disabled="page >= totalPages" class="btn btn-secondary btn-sm px-2.5 py-1">
                            Next
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </div>
    `
};

window.AdminReportsPage = AdminReportsPage;

