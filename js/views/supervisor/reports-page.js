// AssistPay — Supervisor Reports & Analytics View (/supervisor/reports)
// Clean, modern, non-redundant administrative attendance dashboard:
// 1. Unified header with authorization indicator (HR Department · Jazielyn Diaz · EMP-003 · 2 Assigned S.A.s).
// 2. Compact filter toolbar (quick presets, date range, assigned S.A. filter, reset, export).
// 3. Exactly 4 summary cards: Present, Late, Confirmed Absent, Requires Review (NO redundant assigned/records/incomplete vanity cards).
// 4. Operational Duty Hours Fulfillment (Scheduled vs Recorded vs Credited, progress bar, data quality audit warning).
// 5. Four Report Cards in a clean 2-column grid with live status badges (NO duplicate tab bar on overview).
// 6. Seamless detail views for Daily, Summary, Exceptions, and Corrections with "← Back to Overview", table pagination, search, and approval/rejection modal.
// 7. Strictly scoped to assigned team, zero financial/allowance data exposure, and print/export ready.

const SupervisorReportsPage = {
    components: { AppIcon, PageHeader, StatusBadge },

    setup() {
        const loading = Vue.ref(true);
        const reportLoading = Vue.ref(false);
        const loadError = Vue.ref("");

        // Active Tab: 'OVERVIEW' | 'DAILY' | 'SUMMARY' | 'EXCEPTIONS' | 'CORRECTIONS'
        const activeTab = Vue.ref("OVERVIEW");

        // Helper formatting functions
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

        // Supervisor Context & Scope
        const supervisor = Vue.ref(null);
        const assignedSas = Vue.ref([]);
        const departments = Vue.ref([]);

        // Default Date Range & Presets
        const activePreset = Vue.ref("OCT_FIRST_HALF");
        const singleDate = Vue.ref("2026-10-12");
        const startDate = Vue.ref("2026-10-01");
        const endDate = Vue.ref("2026-10-15");

        // Filter Controls
        const filters = Vue.reactive({
            saId: "ALL",
            department: "ALL",
            status: "ALL",
            reviewStatus: "ALL",
            exceptionType: "ALL",
            searchQuery: ""
        });

        // Pagination for tables
        const pagination = Vue.reactive({
            currentPage: 1,
            pageSize: 15
        });

        // Rejection Modal State
        const rejectModal = Vue.reactive({
            open: false,
            requestId: null,
            refNo: "",
            saName: "",
            reason: "",
            submitting: false
        });

        // Dashboard Summary Metrics
        const dashboardSummary = Vue.reactive({
            totalAssignedSas: 0,
            selectedAssignedSas: 0,
            totalScheduledShifts: 0,
            attendanceRecords: 0,
            present: 0,
            late: 0,
            absent: 0,
            onLeave: 0,
            incomplete: 0,
            unresolvedExceptions: 0,
            pendingCorrections: 0,
            requiresReview: 0,
            attendanceRate: 0.0,
            lateRate: 0.0,
            absenceRate: 0.0,
            totalScheduledHours: 0.0,
            totalRecordedHours: 0.0,
            totalCreditedHours: 0.0,
            hasHoursDiscrepancy: false,
            discrepancyNote: ""
        });

        // Report Datasets
        const dailyData = Vue.ref({ records: [], summary: {}, date: "", formattedDate: "" });
        const summaryData = Vue.ref({ records: [], summary: {}, dateRange: {} });
        const exceptionsData = Vue.ref({ records: [], summary: {}, dateRange: {} });
        const correctionsData = Vue.ref({ records: [], summary: {}, dateRange: {} });

        // Available Tabs Configuration (Used inside detailed report views)
        const subReportTabs = [
            { id: "DAILY", label: "Daily Attendance", icon: "Calendar" },
            { id: "SUMMARY", label: "Attendance Summary", icon: "CalendarDays" },
            { id: "EXCEPTIONS", label: "Exceptions Report", icon: "AlertTriangle" },
            { id: "CORRECTIONS", label: "Correction Requests", icon: "FileText" }
        ];

        // Format Date Helper
        const formatDatePretty = (dStr) => {
            if (!dStr) return "—";
            try {
                const parts = dStr.split("-").map(Number);
                const d = new Date(parts[0], parts[1] - 1, parts[2]);
                return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
            } catch {
                return dStr;
            }
        };

        // Quick Date Presets
        const setDatePreset = (preset) => {
            activePreset.value = preset;
            const now = new Date();
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, "0");
            const d = String(now.getDate()).padStart(2, "0");

            if (preset === "TODAY") {
                startDate.value = `${y}-${m}-${d}`;
                endDate.value = `${y}-${m}-${d}`;
            } else if (preset === "THIS_WEEK") {
                const curr = new Date();
                const firstDay = new Date(curr.setDate(curr.getDate() - curr.getDay() + 1));
                const lastDay = new Date(curr.setDate(curr.getDate() - curr.getDay() + 6));
                startDate.value = firstDay.toISOString().slice(0, 10);
                endDate.value = lastDay.toISOString().slice(0, 10);
            } else if (preset === "THIS_MONTH") {
                startDate.value = `${y}-${m}-01`;
                const last = new Date(y, Number(m), 0).getDate();
                endDate.value = `${y}-${m}-${String(last).padStart(2, "0")}`;
            } else if (preset === "OCT_FIRST_HALF") {
                startDate.value = "2026-10-01";
                endDate.value = "2026-10-15";
            } else if (preset === "OCT_SECOND_HALF") {
                startDate.value = "2026-10-16";
                endDate.value = "2026-10-31";
            }
            pagination.currentPage = 1;
            fetchCurrentReport();
        };

        // Clear Filters
        const resetFilters = () => {
            filters.saId = "ALL";
            filters.department = "ALL";
            filters.status = "ALL";
            filters.reviewStatus = "ALL";
            filters.exceptionType = "ALL";
            filters.searchQuery = "";
            activePreset.value = "OCT_FIRST_HALF";
            startDate.value = "2026-10-01";
            endDate.value = "2026-10-15";
            singleDate.value = "2026-10-12";
            pagination.currentPage = 1;
            fetchCurrentReport();
        };

        // Fetch Landing Dashboard
        const loadDashboard = async () => {
            try {
                const res = await Model.request("reports", "supervisor_reports_dashboard", {
                    startDate: startDate.value,
                    endDate: endDate.value,
                    saId: filters.saId !== "ALL" ? filters.saId : 0
                });
                if (res && res.success) {
                    supervisor.value = res.supervisor;
                    assignedSas.value = res.assignedSas || [];
                    departments.value = res.departments || [];
                    Object.assign(dashboardSummary, res.summary || {});
                }
            } catch (err) {
                console.error("Supervisor reports dashboard error:", err);
                loadError.value = err.message || "Failed to load supervisor reports.";
            }
        };

        // Fetch Daily Report
        const loadDailyReport = async () => {
            reportLoading.value = true;
            try {
                const res = await Model.request("reports", "supervisor_daily_attendance_report", {
                    date: singleDate.value,
                    saId: filters.saId !== "ALL" ? filters.saId : 0,
                    status: filters.status,
                    reviewStatus: filters.reviewStatus,
                    department: filters.department,
                    search: filters.searchQuery
                });
                if (res && res.success) {
                    dailyData.value = {
                        records: res.records || [],
                        summary: res.summary || {},
                        date: res.date,
                        formattedDate: res.formattedDate
                    };
                }
            } catch (err) {
                console.error("Daily report error:", err);
                Alerts.error("Load Failed", err.message || "Failed to load daily attendance report.");
            } finally {
                reportLoading.value = false;
            }
        };

        // Fetch Summary Report
        const loadSummaryReport = async () => {
            reportLoading.value = true;
            try {
                const res = await Model.request("reports", "supervisor_attendance_summary_report", {
                    startDate: startDate.value,
                    endDate: endDate.value,
                    saId: filters.saId !== "ALL" ? filters.saId : 0,
                    department: filters.department,
                    search: filters.searchQuery
                });
                if (res && res.success) {
                    summaryData.value = {
                        records: res.records || [],
                        summary: res.summary || {},
                        dateRange: res.dateRange
                    };
                }
            } catch (err) {
                console.error("Attendance summary error:", err);
                Alerts.error("Load Failed", err.message || "Failed to load attendance summary report.");
            } finally {
                reportLoading.value = false;
            }
        };

        // Fetch Exceptions Report
        const loadExceptionsReport = async () => {
            reportLoading.value = true;
            try {
                const res = await Model.request("reports", "supervisor_attendance_exceptions_report", {
                    startDate: startDate.value,
                    endDate: endDate.value,
                    saId: filters.saId !== "ALL" ? filters.saId : 0,
                    type: filters.exceptionType,
                    department: filters.department,
                    search: filters.searchQuery
                });
                if (res && res.success) {
                    exceptionsData.value = {
                        records: res.records || [],
                        summary: res.summary || {},
                        dateRange: res.dateRange
                    };
                }
            } catch (err) {
                console.error("Exceptions report error:", err);
                Alerts.error("Load Failed", err.message || "Failed to load exceptions report.");
            } finally {
                reportLoading.value = false;
            }
        };

        // Fetch Correction Requests Report
        const loadCorrectionsReport = async () => {
            reportLoading.value = true;
            try {
                const res = await Model.request("reports", "supervisor_correction_requests_report", {
                    startDate: startDate.value,
                    endDate: endDate.value,
                    saId: filters.saId !== "ALL" ? filters.saId : 0,
                    status: filters.reviewStatus,
                    department: filters.department,
                    search: filters.searchQuery
                });
                if (res && res.success) {
                    correctionsData.value = {
                        records: res.records || [],
                        summary: res.summary || {},
                        dateRange: res.dateRange
                    };
                }
            } catch (err) {
                console.error("Correction requests report error:", err);
                Alerts.error("Load Failed", err.message || "Failed to load correction requests report.");
            } finally {
                reportLoading.value = false;
            }
        };

        // Fetch active report
        const fetchCurrentReport = async () => {
            if (activeTab.value === "OVERVIEW") {
                await loadDashboard();
            } else if (activeTab.value === "DAILY") {
                await loadDailyReport();
            } else if (activeTab.value === "SUMMARY") {
                await loadSummaryReport();
            } else if (activeTab.value === "EXCEPTIONS") {
                await loadExceptionsReport();
            } else if (activeTab.value === "CORRECTIONS") {
                await loadCorrectionsReport();
            }
        };

        // Switch Tab
        const selectTab = (tabId, extraFilter = null) => {
            activeTab.value = tabId;
            pagination.currentPage = 1;
            if (extraFilter && tabId === "EXCEPTIONS") {
                filters.exceptionType = extraFilter;
            } else if (extraFilter && tabId === "DAILY") {
                filters.status = extraFilter;
            }
            fetchCurrentReport();
            window.scrollTo({ top: 0, behavior: "smooth" });
        };

        // Navigation to Attendance Review
        const jumpToReview = (recordUrl) => {
            if (recordUrl) {
                window.location.hash = "#" + recordUrl;
            } else {
                window.location.hash = "#/supervisor/attendance-review";
            }
        };

        // Correction Request Workflow: Approve
        const approveCorrectionRequest = async (row) => {
            const confirmed = await Alerts.confirm(
                "Approve Correction Request",
                `Are you sure you want to approve attendance correction request ${row.refNo} for ${row.name}?`
            );
            if (!confirmed) return;

            try {
                const res = await Model.request("requests", "supervisor_approve", {
                    id: row.id,
                    remarks: "Approved by Immediate Supervisor"
                });
                if (res && res.success) {
                    Alerts.success("Request Approved", `Correction request ${row.refNo} was approved and forwarded to Coordinator.`);
                    await loadCorrectionsReport();
                    await loadDashboard();
                } else {
                    Alerts.error("Approval Failed", res?.message || "Failed to approve request.");
                }
            } catch (err) {
                Alerts.error("Error", err.message || "Failed to approve correction request.");
            }
        };

        // Correction Request Workflow: Open Reject Modal
        const openRejectModal = (row) => {
            rejectModal.open = true;
            rejectModal.requestId = row.id;
            rejectModal.refNo = row.refNo;
            rejectModal.saName = row.name;
            rejectModal.reason = "";
            rejectModal.submitting = false;
        };

        // Correction Request Workflow: Submit Rejection with Mandatory Reason
        const submitRejectRequest = async () => {
            if (!rejectModal.reason || rejectModal.reason.trim().length < 5) {
                Alerts.warning("Reason Required", "Please provide a valid explanation for rejecting this correction request (minimum 5 characters).");
                return;
            }
            rejectModal.submitting = true;
            try {
                const res = await Model.request("requests", "supervisor_reject", {
                    id: rejectModal.requestId,
                    reason: rejectModal.reason.trim()
                });
                if (res && res.success) {
                    Alerts.success("Request Rejected", `Correction request ${rejectModal.refNo} was rejected.`);
                    rejectModal.open = false;
                    await loadCorrectionsReport();
                    await loadDashboard();
                } else {
                    Alerts.error("Rejection Failed", res?.message || "Failed to reject request.");
                }
            } catch (err) {
                Alerts.error("Error", err.message || "Failed to reject correction request.");
            } finally {
                rejectModal.submitting = false;
            }
        };

        // Current Report Meta
        const currentMeta = Vue.computed(() => {
            switch (activeTab.value) {
                case "DAILY":
                    return {
                        title: "Daily Attendance Report",
                        sheetName: "Daily_Attendance",
                        records: dailyData.value.records || [],
                        period: dailyData.value.formattedDate || singleDate.value
                    };
                case "SUMMARY":
                    return {
                        title: "Attendance Summary Report",
                        sheetName: "Attendance_Summary",
                        records: summaryData.value.records || [],
                        period: `${formatDatePretty(startDate.value)} to ${formatDatePretty(endDate.value)}`
                    };
                case "EXCEPTIONS":
                    return {
                        title: "Attendance Exceptions Report",
                        sheetName: "Attendance_Exceptions",
                        records: exceptionsData.value.records || [],
                        period: `${formatDatePretty(startDate.value)} to ${formatDatePretty(endDate.value)}`
                    };
                case "CORRECTIONS":
                    return {
                        title: "Attendance Correction Requests Report",
                        sheetName: "Correction_Requests",
                        records: correctionsData.value.records || [],
                        period: `${formatDatePretty(startDate.value)} to ${formatDatePretty(endDate.value)}`
                    };
                default:
                    return {
                        title: "Supervisor Reports & Analytics Overview",
                        sheetName: "Overview",
                        records: [],
                        period: `${formatDatePretty(startDate.value)} to ${formatDatePretty(endDate.value)}`
                    };
            }
        });

        // Filtered records for current active tab
        const currentTabRecords = Vue.computed(() => {
            if (activeTab.value === "DAILY") return dailyData.value.records || [];
            if (activeTab.value === "SUMMARY") return summaryData.value.records || [];
            if (activeTab.value === "EXCEPTIONS") return exceptionsData.value.records || [];
            if (activeTab.value === "CORRECTIONS") return correctionsData.value.records || [];
            return [];
        });

        // Paginated records for active tab
        const paginatedRecords = Vue.computed(() => {
            const list = currentTabRecords.value;
            const start = (pagination.currentPage - 1) * pagination.pageSize;
            return list.slice(start, start + pagination.pageSize);
        });

        const totalPages = Vue.computed(() => {
            return Math.max(1, Math.ceil(currentTabRecords.value.length / pagination.pageSize));
        });

        // Excel Export via XlsxWriter (Strictly Attendance Only, NO Payroll / Allowance data)
        const exportExcel = async () => {
            if (typeof XlsxWriter === "undefined" || !XlsxWriter.Sheet) {
                Alerts.error("Export Error", "Excel export engine is not loaded. Please refresh the page.");
                return;
            }

            const meta = currentMeta.value;
            const records = meta.records;
            if (!records || records.length === 0) {
                Alerts.warning("No Records", "There are no records to export for this report.");
                return;
            }

            try {
                const sheet = new XlsxWriter.Sheet(meta.sheetName);
                sheet.width(1, 6).width(2, 16).width(3, 26).width(4, 18).width(5, 20).width(6, 16).width(7, 16).width(8, 16);

                sheet.set(1, 1, "NATIONAL COLLEGE OF SCIENCE AND TECHNOLOGY", "title");
                sheet.merge(1, 1, 1, 8);
                sheet.set(2, 1, meta.title.toUpperCase(), "bold");
                sheet.merge(2, 1, 2, 8);
                sheet.set(3, 1, `Department: ${supervisor.value?.deptDisplayName || 'HR Department'} · Supervisor: ${supervisor.value?.name || 'Supervisor'} (${supervisor.value?.empId || ''})`, "text");
                sheet.merge(3, 1, 3, 8);
                sheet.set(4, 1, `Reporting Period: ${meta.period} · Generated: ${new Date().toLocaleString('en-US')}`, "text");
                sheet.merge(4, 1, 4, 8);

                let r = 6;

                if (activeTab.value === "DAILY") {
                    const headers = ["#", "Student ID", "Student Assistant", "Department", "Shift", "Time In", "Time Out", "Recorded Hrs", "Credited Hrs", "Status", "Review"];
                    headers.forEach((h, i) => sheet.set(r, i + 1, h, "head"));
                    r++;
                    records.forEach((row, idx) => {
                        sheet.set(r, 1, idx + 1, "cell");
                        sheet.set(r, 2, row.studentId || row.studentNumber, "cell");
                        sheet.set(r, 3, row.name, "name");
                        sheet.set(r, 4, row.department || row.assignedDepartment, "cell");
                        sheet.set(r, 5, row.scheduledShift, "cell");
                        sheet.set(r, 6, row.timeIn, "cell");
                        sheet.set(r, 7, row.timeOut, "cell");
                        sheet.set(r, 8, row.recordedHours, "cell");
                        sheet.set(r, 9, row.creditedHours, "cell");
                        sheet.set(r, 10, row.attendanceStatus, "cell");
                        sheet.set(r, 11, row.reviewStatus, "cell");
                        r++;
                    });
                    sheet.set(r, 8, "TOTAL CREDITED:", "bold");
                    sheet.set(r, 9, dailyData.value.summary.totalCreditedHours || 0, "bold");
                } else if (activeTab.value === "SUMMARY") {
                    const headers = ["#", "Student ID", "Student Assistant", "Department", "Scheduled", "Present", "Late", "Absent", "On Leave", "Incomplete", "Recorded Hrs", "Credited Hrs"];
                    headers.forEach((h, i) => sheet.set(r, i + 1, h, "head"));
                    r++;
                    records.forEach((row, idx) => {
                        sheet.set(r, 1, idx + 1, "cell");
                        sheet.set(r, 2, row.studentId || row.studentNumber, "cell");
                        sheet.set(r, 3, row.name, "name");
                        sheet.set(r, 4, row.department, "cell");
                        sheet.set(r, 5, row.totalScheduled || row.scheduledShifts, "cell");
                        sheet.set(r, 6, row.present, "cell");
                        sheet.set(r, 7, row.late, "cell");
                        sheet.set(r, 8, row.absent, "cell");
                        sheet.set(r, 9, row.onLeave, "cell");
                        sheet.set(r, 10, row.incomplete, "cell");
                        sheet.set(r, 11, row.recordedHours, "cell");
                        sheet.set(r, 12, row.creditedHours, "cell");
                        r++;
                    });
                    sheet.set(r, 11, "TOTAL CREDITED:", "bold");
                    sheet.set(r, 12, summaryData.value.summary.totalCreditedHours || 0, "bold");
                } else if (activeTab.value === "EXCEPTIONS") {
                    const headers = ["#", "Date", "Student ID", "Student Assistant", "Department", "Exception Category", "Severity", "Details", "Punch Record", "Status"];
                    headers.forEach((h, i) => sheet.set(r, i + 1, h, "head"));
                    r++;
                    records.forEach((row, idx) => {
                        sheet.set(r, 1, idx + 1, "cell");
                        sheet.set(r, 2, row.date, "cell");
                        sheet.set(r, 3, row.studentId || row.studentNumber, "cell");
                        sheet.set(r, 4, row.name, "name");
                        sheet.set(r, 5, row.department, "cell");
                        sheet.set(r, 6, row.title || row.exceptionType, "cell");
                        sheet.set(r, 7, row.severity, "cell");
                        sheet.set(r, 8, row.description, "cell");
                        sheet.set(r, 9, row.recordedPunch, "cell");
                        sheet.set(r, 10, row.reviewStatus, "cell");
                        r++;
                    });
                } else if (activeTab.value === "CORRECTIONS") {
                    const headers = ["#", "Duty Date", "Ref No", "Student ID", "Student Assistant", "Correction", "Reason", "Submitted", "Status", "Decision"];
                    headers.forEach((h, i) => sheet.set(r, i + 1, h, "head"));
                    r++;
                    records.forEach((row, idx) => {
                        sheet.set(r, 1, idx + 1, "cell");
                        sheet.set(r, 2, row.dutyDate || row.attendanceDate, "cell");
                        sheet.set(r, 3, row.refNo, "cell");
                        sheet.set(r, 4, row.studentId || row.studentNumber, "cell");
                        sheet.set(r, 5, row.name, "name");
                        sheet.set(r, 6, row.requestedPunch || row.requestedValue, "cell");
                        sheet.set(r, 7, `${row.reasonCategory}: ${row.explanation || ''}`, "cell");
                        sheet.set(r, 8, row.requestDate, "cell");
                        sheet.set(r, 9, row.currentStatus, "cell");
                        sheet.set(r, 10, row.supervisorDecision, "cell");
                        r++;
                    });
                }

                const filename = `AssistPay_${meta.sheetName}_${new Date().toISOString().slice(0, 10)}.xlsx`;
                await XlsxWriter.download(filename, [sheet]);
                Alerts.success("Export Complete", `Report downloaded as ${filename}`);
            } catch (err) {
                console.error("XLSX Export Error:", err);
                Alerts.error("Export Failed", "Could not compile the Excel file.");
            }
        };

        // CSV Export (Strictly Attendance Only)
        const exportCsv = () => {
            const meta = currentMeta.value;
            const records = meta.records;
            if (!records || records.length === 0) {
                Alerts.warning("No Records", "There are no records to export for this report.");
                return;
            }

            let csv = "";
            const escapeCsv = (str) => {
                if (str == null) return '""';
                const s = String(str).replace(/"/g, '""');
                return `"${s}"`;
            };

            csv += escapeCsv("National College of Science and Technology — AssistPay") + "\n";
            csv += escapeCsv(meta.title) + "\n";
            csv += escapeCsv(`Department: ${supervisor.value?.deptDisplayName || 'HR Department'} · Supervisor: ${supervisor.value?.name || 'Supervisor'} (${supervisor.value?.empId || ''})`) + "\n";
            csv += escapeCsv(`Reporting Period: ${meta.period} · Generated: ${new Date().toLocaleString('en-US')}`) + "\n\n";

            if (activeTab.value === "DAILY") {
                csv += ["#", "Student ID", "Student Assistant", "Department", "Shift", "Time In", "Time Out", "Recorded Hrs", "Credited Hrs", "Status", "Review"].map(escapeCsv).join(",") + "\n";
                records.forEach((r, idx) => {
                    csv += [idx + 1, r.studentId || r.studentNumber, r.name, r.department || r.assignedDepartment, r.scheduledShift, r.timeIn, r.timeOut, r.recordedHours, r.creditedHours, r.attendanceStatus, r.reviewStatus].map(escapeCsv).join(",") + "\n";
                });
            } else if (activeTab.value === "SUMMARY") {
                csv += ["#", "Student ID", "Student Assistant", "Department", "Scheduled", "Present", "Late", "Absent", "On Leave", "Incomplete", "Recorded Hrs", "Credited Hrs"].map(escapeCsv).join(",") + "\n";
                records.forEach((r, idx) => {
                    csv += [idx + 1, r.studentId || r.studentNumber, r.name, r.department, r.totalScheduled || r.scheduledShifts, r.present, r.late, r.absent, r.onLeave, r.incomplete, r.recordedHours, r.creditedHours].map(escapeCsv).join(",") + "\n";
                });
            } else if (activeTab.value === "EXCEPTIONS") {
                csv += ["#", "Date", "Student ID", "Student Assistant", "Department", "Exception Category", "Severity", "Description", "Punch Record", "Status"].map(escapeCsv).join(",") + "\n";
                records.forEach((r, idx) => {
                    csv += [idx + 1, r.date, r.studentId || r.studentNumber, r.name, r.department, r.title || r.exceptionType, r.severity, r.description, r.recordedPunch, r.reviewStatus].map(escapeCsv).join(",") + "\n";
                });
            } else if (activeTab.value === "CORRECTIONS") {
                csv += ["#", "Duty Date", "Ref No", "Student ID", "Student Assistant", "Correction", "Reason", "Submitted", "Status", "Decision"].map(escapeCsv).join(",") + "\n";
                records.forEach((r, idx) => {
                    csv += [idx + 1, r.dutyDate || r.attendanceDate, r.refNo, r.studentId || r.studentNumber, r.name, r.requestedPunch || r.requestedValue, `${r.reasonCategory}: ${r.explanation || ''}`, r.requestDate, r.currentStatus, r.supervisorDecision].map(escapeCsv).join(",") + "\n";
                });
            }

            const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
            const link = document.createElement("a");
            const url = URL.createObjectURL(blob);
            link.setAttribute("href", url);
            link.setAttribute("download", `AssistPay_${meta.sheetName}_${new Date().toISOString().slice(0, 10)}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            Alerts.success("CSV Downloaded", "Report CSV file generated successfully.");
        };

        // Print Report
        const printReport = () => {
            window.print();
        };

        // Lifecycle
        Vue.onMounted(async () => {
            loading.value = true;
            await loadDashboard();
            loading.value = false;
        });

        return {
            loading,
            reportLoading,
            loadError,
            activeTab,
            activePreset,
            subReportTabs,
            supervisor,
            assignedSas,
            departments,
            singleDate,
            startDate,
            endDate,
            filters,
            pagination,
            rejectModal,
            dashboardSummary,
            dailyData,
            summaryData,
            exceptionsData,
            correctionsData,
            currentMeta,
            currentTabRecords,
            paginatedRecords,
            totalPages,
            num,
            pct,
            formatDatePretty,
            setDatePreset,
            resetFilters,
            selectTab,
            fetchCurrentReport,
            loadDailyReport,
            loadSummaryReport,
            loadExceptionsReport,
            loadCorrectionsReport,
            jumpToReview,
            approveCorrectionRequest,
            openRejectModal,
            submitRejectRequest,
            exportExcel,
            exportCsv,
            printReport
        };
    },

    template: `
        <div class="space-y-6 pb-12 print:p-0 print:space-y-4 font-sans text-slate-800">
            <!-- 1. UNIFIED ADMINISTRATIVE HEADER & SCOPE BAR -->
            <div class="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-4 no-print">
                <div class="flex flex-wrap items-start justify-between gap-4">
                    <div>
                        <h1 class="text-xl font-extrabold text-slate-900 tracking-tight">Supervisor Reports & Analytics</h1>
                        <p class="text-xs text-slate-500 mt-1">
                            Monitor attendance, review exceptions, and analyze operational records for your assigned team.
                        </p>
                    </div>

                    <!-- Authorization Indicator Badge -->
                    <div class="flex flex-wrap items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl text-xs">
                        <div class="flex items-center gap-1.5">
                            <span class="w-2 h-2 rounded-full bg-emerald-500"></span>
                            <span class="font-bold text-slate-800">{{ supervisor?.deptDisplayName || 'HR Department' }}</span>
                        </div>
                        <span class="text-slate-300">&bull;</span>
                        <div class="text-slate-600">
                            Supervisor: <span class="font-bold text-slate-900">{{ supervisor?.name || 'Jazielyn Diaz' }}</span>
                        </div>
                        <span class="text-slate-300">&bull;</span>
                        <span class="font-mono text-blue-900 font-bold">{{ supervisor?.empId || 'EMP-003' }}</span>
                        <span class="text-slate-300">&bull;</span>
                        <span class="font-semibold text-slate-700 bg-blue-50 text-blue-800 border border-blue-200 px-2 py-0.5 rounded-full text-[11px]">
                            {{ assignedSas.length }} Assigned S.A.s
                        </span>
                    </div>
                </div>

                <!-- 2. COMPACT FILTER TOOLBAR (Unified inside control panel) -->
                <div class="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-3">
                    <!-- Quick Presets -->
                    <div class="flex flex-wrap items-center gap-1.5">
                        <span class="text-[11px] font-bold uppercase tracking-wider text-slate-400 mr-1">Period:</span>
                        <button
                            @click="setDatePreset('TODAY')"
                            :class="[
                                'px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors',
                                activePreset === 'TODAY'
                                    ? 'bg-blue-900 text-white shadow-xs'
                                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            ]"
                        >
                            Today
                        </button>
                        <button
                            @click="setDatePreset('THIS_WEEK')"
                            :class="[
                                'px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors',
                                activePreset === 'THIS_WEEK'
                                    ? 'bg-blue-900 text-white shadow-xs'
                                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            ]"
                        >
                            This Week
                        </button>
                        <button
                            @click="setDatePreset('THIS_MONTH')"
                            :class="[
                                'px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors',
                                activePreset === 'THIS_MONTH'
                                    ? 'bg-blue-900 text-white shadow-xs'
                                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            ]"
                        >
                            This Month
                        </button>
                        <button
                            @click="setDatePreset('OCT_FIRST_HALF')"
                            :class="[
                                'px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors',
                                activePreset === 'OCT_FIRST_HALF'
                                    ? 'bg-blue-900 text-white shadow-xs'
                                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            ]"
                        >
                            Oct 1 &ndash; 15 (Cutoff 1)
                        </button>
                        <button
                            @click="setDatePreset('OCT_SECOND_HALF')"
                            :class="[
                                'px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors',
                                activePreset === 'OCT_SECOND_HALF'
                                    ? 'bg-blue-900 text-white shadow-xs'
                                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                            ]"
                        >
                            Oct 16 &ndash; 31 (Cutoff 2)
                        </button>
                    </div>

                    <!-- Date Picker, S.A. Select, and Export Actions -->
                    <div class="flex flex-wrap items-center gap-2">
                        <!-- Date range input -->
                        <div class="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-700">
                            <input
                                type="date"
                                v-model="startDate"
                                @change="activePreset = 'CUSTOM'; fetchCurrentReport();"
                                class="bg-transparent border-0 text-slate-800 font-semibold text-xs focus:ring-0 p-0 w-28"
                            />
                            <span class="text-slate-400 font-bold">&ndash;</span>
                            <input
                                type="date"
                                v-model="endDate"
                                @change="activePreset = 'CUSTOM'; fetchCurrentReport();"
                                class="bg-transparent border-0 text-slate-800 font-semibold text-xs focus:ring-0 p-0 w-28"
                            />
                        </div>

                        <!-- Team member filter -->
                        <select
                            v-model="filters.saId"
                            @change="fetchCurrentReport"
                            class="text-xs bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-slate-800 font-medium focus:bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        >
                            <option value="ALL">All Team Members ({{ assignedSas.length }})</option>
                            <option v-for="sa in assignedSas" :key="sa.id || sa.saProfileId" :value="sa.id || sa.saProfileId">
                                {{ sa.name }} ({{ sa.studentId || sa.studentNumber }})
                            </option>
                        </select>

                        <!-- Reset -->
                        <button
                            @click="resetFilters"
                            class="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors"
                            title="Reset filters"
                        >
                            <app-icon name="RotateCcw" :size="12" />
                            <span>Reset</span>
                        </button>

                        <!-- Export buttons -->
                        <div class="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                            <button
                                @click="exportExcel"
                                class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-emerald-800 bg-white hover:bg-emerald-50 rounded-md shadow-2xs transition-colors"
                                title="Download Excel (.xlsx)"
                            >
                                <app-icon name="FileSpreadsheet" :size="13" class="text-emerald-600" />
                                <span>Excel</span>
                            </button>
                            <button
                                @click="exportCsv"
                                class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-white rounded-md transition-colors"
                                title="Download CSV"
                            >
                                <app-icon name="Download" :size="13" class="text-slate-500" />
                                <span>CSV</span>
                            </button>
                            <button
                                @click="printReport"
                                class="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-white rounded-md transition-colors"
                                title="Print report"
                            >
                                <app-icon name="Printer" :size="13" class="text-slate-500" />
                                <span>Print</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Print Header Banner (Only visible during print) -->
            <div class="hidden print:block mb-6 border-b border-slate-300 pb-4">
                <div class="text-center space-y-1">
                    <h1 class="text-lg font-bold uppercase tracking-wider text-slate-900">National College of Science and Technology</h1>
                    <h2 class="text-base font-semibold text-blue-900">{{ currentMeta.title }}</h2>
                    <p class="text-xs text-slate-600">
                        Department: <span class="font-medium text-slate-800">{{ supervisor?.deptDisplayName || 'HR Department' }}</span> &bull;
                        Supervisor: <span class="font-medium text-slate-800">{{ supervisor?.name || 'Jazielyn Diaz' }} ({{ supervisor?.empId || 'EMP-003' }})</span> &bull;
                        Assigned S.A.s: <span class="font-medium text-slate-800">{{ assignedSas.length }}</span> &bull;
                        Period: <span class="font-medium text-slate-800">{{ currentMeta.period }}</span>
                    </p>
                </div>
            </div>

            <!-- DETAIL VIEW TOP NAVIGATION BAR (ONLY shown when inside Daily, Summary, Exceptions, or Corrections) -->
            <div v-if="activeTab !== 'OVERVIEW'" class="bg-white rounded-xl border border-slate-200/90 p-3 flex flex-wrap items-center justify-between gap-3 shadow-xs no-print">
                <div class="flex items-center gap-3">
                    <button
                        @click="selectTab('OVERVIEW')"
                        class="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-900 hover:bg-blue-800 text-white text-xs font-bold shadow-xs transition-all"
                    >
                        <app-icon name="ArrowLeft" :size="14" />
                        <span>&larr; Back to Overview</span>
                    </button>

                    <!-- Sibling Report Switcher Pills -->
                    <div class="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
                        <button
                            v-for="sub in subReportTabs"
                            :key="sub.id"
                            @click="selectTab(sub.id)"
                            :class="[
                                'px-3 py-1 text-xs font-semibold rounded-md transition-colors',
                                activeTab === sub.id
                                    ? 'bg-white text-blue-900 shadow-2xs font-bold'
                                    : 'text-slate-600 hover:text-slate-900'
                            ]"
                        >
                            {{ sub.label }}
                        </button>
                    </div>
                </div>

                <div class="text-xs text-slate-500 font-medium">
                    Showing: <span class="font-bold text-slate-800">{{ currentMeta.title }}</span> &bull;
                    <span class="text-slate-600">{{ currentMeta.period }}</span>
                </div>
            </div>

            <!-- 3. SUMMARY CARDS (Exactly FOUR clean, non-redundant cards in one responsive row) -->
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <!-- Card 1 — Present -->
                <div
                    @click="selectTab('DAILY', 'PRESENT')"
                    class="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-emerald-400 hover:shadow-sm transition-all cursor-pointer group"
                >
                    <div class="flex items-center justify-between text-slate-400 mb-2">
                        <span class="text-xs font-bold uppercase tracking-wider text-emerald-800">Present</span>
                        <div class="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                            <app-icon name="CheckCircle2" :size="18" />
                        </div>
                    </div>
                    <div class="text-3xl font-extrabold text-slate-900">{{ dashboardSummary.present }}</div>
                    <div class="text-xs font-medium text-emerald-700 mt-1 flex items-center gap-1">
                        <app-icon name="TrendingUp" :size="13" />
                        <span>{{ dashboardSummary.attendanceRate || 0 }}% attendance rate</span>
                    </div>
                    <div class="text-[11px] text-slate-400 mt-1">Shifts completed on schedule</div>
                </div>

                <!-- Card 2 — Late -->
                <div
                    @click="selectTab('EXCEPTIONS', 'LATE_ARRIVAL')"
                    class="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-amber-400 hover:shadow-sm transition-all cursor-pointer group"
                >
                    <div class="flex items-center justify-between text-slate-400 mb-2">
                        <span class="text-xs font-bold uppercase tracking-wider text-amber-800">Late</span>
                        <div class="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                            <app-icon name="Clock" :size="18" />
                        </div>
                    </div>
                    <div class="text-3xl font-extrabold text-slate-900">{{ dashboardSummary.late }}</div>
                    <div class="text-xs font-medium text-amber-700 mt-1 flex items-center gap-1">
                        <app-icon name="AlertCircle" :size="13" />
                        <span>{{ dashboardSummary.lateRate || 0 }}% late rate</span>
                    </div>
                    <div class="text-[11px] text-slate-400 mt-1">&gt; 15 min scheduled start grace</div>
                </div>

                <!-- Card 3 — Confirmed Absent -->
                <div
                    @click="selectTab('SUMMARY')"
                    class="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-rose-400 hover:shadow-sm transition-all cursor-pointer group"
                >
                    <div class="flex items-center justify-between text-slate-400 mb-2">
                        <span class="text-xs font-bold uppercase tracking-wider text-rose-800">Confirmed Absent</span>
                        <div class="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                            <app-icon name="XCircle" :size="18" />
                        </div>
                    </div>
                    <div class="text-3xl font-extrabold text-slate-900">{{ dashboardSummary.absent }}</div>
                    <div class="text-xs font-medium text-rose-700 mt-1 flex items-center gap-1">
                        <span>{{ dashboardSummary.absenceRate || 0 }}% confirmed absence</span>
                    </div>
                    <div class="text-[11px] text-slate-400 mt-1">Excludes approved leave & rest days</div>
                </div>

                <!-- Card 4 — Requires Review -->
                <div
                    @click="selectTab('EXCEPTIONS')"
                    class="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-orange-400 hover:shadow-sm transition-all cursor-pointer group"
                >
                    <div class="flex items-center justify-between text-slate-400 mb-2">
                        <span class="text-xs font-bold uppercase tracking-wider text-orange-800">Requires Review</span>
                        <div class="w-8 h-8 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center group-hover:scale-105 transition-transform">
                            <app-icon name="AlertTriangle" :size="18" />
                        </div>
                    </div>
                    <div class="text-3xl font-extrabold text-slate-900">{{ dashboardSummary.requiresReview }}</div>
                    <div class="text-xs font-medium text-orange-700 mt-1 flex items-center gap-1">
                        <span>{{ dashboardSummary.unresolvedExceptions }} exceptions &bull; {{ dashboardSummary.pendingCorrections }} requests</span>
                    </div>
                    <div class="text-[11px] text-slate-400 mt-1">Unresolved punches & requests</div>
                </div>
            </div>

            <!-- Loading Spinner State -->
            <div v-if="reportLoading" class="bg-white rounded-2xl border border-slate-200/90 p-12 text-center shadow-xs">
                <div class="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-50 text-blue-900 mb-3 animate-spin">
                    <app-icon name="RefreshCw" :size="22" />
                </div>
                <h3 class="text-sm font-bold text-slate-900">Compiling Report Records...</h3>
                <p class="text-xs text-slate-500 mt-1">Querying team attendance logs, reconciliation data, and published schedule assignments.</p>
            </div>

            <!-- TAB CONTENT VIEWS -->
            <div v-else>
                <!-- ========================================================================= -->
                <!-- VIEW 0: OPERATIONAL OVERVIEW (DUTY HOURS + 4 CLEAN REPORT CARDS) -->
                <!-- ========================================================================= -->
                <div v-if="activeTab === 'OVERVIEW'" class="space-y-6">
                    <!-- 4. OPERATIONAL DUTY HOURS FULFILLMENT -->
                    <div class="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs space-y-4">
                        <div class="pb-3 border-b border-slate-100">
                            <h3 class="text-base font-bold text-slate-900">Operational Duty Hours Fulfillment</h3>
                            <p class="text-xs text-slate-500">Scheduled capacity vs. actual recorded biometric punches vs. finalized credited duty hours.</p>
                        </div>

                        <!-- 3 Distinguished Metrics -->
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <!-- Metric 1: Scheduled Hours -->
                            <div class="bg-slate-50 rounded-xl p-4 border border-slate-200/80">
                                <div class="flex items-center justify-between text-slate-500 mb-1">
                                    <span class="text-xs font-bold uppercase tracking-wider">Scheduled Hours</span>
                                    <app-icon name="CalendarCheck" :size="16" class="text-slate-400" />
                                </div>
                                <div class="text-3xl font-extrabold text-slate-900">
                                    {{ dashboardSummary.totalScheduledHours }} <span class="text-sm font-normal text-slate-500">hrs</span>
                                </div>
                                <p class="text-xs text-slate-500 mt-1">Total planned hours from published schedules.</p>
                            </div>

                            <!-- Metric 2: Actual Recorded Hours -->
                            <div class="bg-blue-50/70 rounded-xl p-4 border border-blue-200/70">
                                <div class="flex items-center justify-between text-blue-800 mb-1">
                                    <span class="text-xs font-bold uppercase tracking-wider">Actual Recorded Hours</span>
                                    <app-icon name="Fingerprint" :size="16" class="text-blue-600" />
                                </div>
                                <div class="text-3xl font-extrabold text-blue-950">
                                    {{ dashboardSummary.totalRecordedHours }} <span class="text-sm font-normal text-blue-700">hrs</span>
                                </div>
                                <p class="text-xs text-blue-700 mt-1">Hours derived from terminal check-in & check-out logs.</p>
                            </div>

                            <!-- Metric 3: Finalized Credited Hours -->
                            <div class="bg-emerald-50/70 rounded-xl p-4 border border-emerald-200/70">
                                <div class="flex items-center justify-between text-emerald-800 mb-1">
                                    <span class="text-xs font-bold uppercase tracking-wider">Finalized Credited Hours</span>
                                    <app-icon name="Award" :size="16" class="text-emerald-600" />
                                </div>
                                <div class="text-3xl font-extrabold text-emerald-950">
                                    {{ dashboardSummary.totalCreditedHours }} <span class="text-sm font-normal text-emerald-700">hrs</span>
                                </div>
                                <p class="text-xs text-emerald-700 mt-1">Hours from attendance records verified by supervisor.</p>
                            </div>
                        </div>

                        <!-- Horizontal Fulfillment Comparison Bar -->
                        <div class="bg-slate-50 rounded-xl p-4 border border-slate-200/80 space-y-2">
                            <div class="flex items-center justify-between text-xs font-semibold">
                                <span class="text-slate-700">Overall Duty Fulfillment Rate:</span>
                                <span class="font-bold text-blue-900">
                                    {{ num((dashboardSummary.totalCreditedHours / (dashboardSummary.totalScheduledHours || 1)) * 100, 1) }}% completed
                                </span>
                            </div>
                            <div class="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
                                <div
                                    class="h-full bg-blue-900 rounded-full transition-all duration-500"
                                    :style="{ width: Math.min(100, ((dashboardSummary.totalCreditedHours / (dashboardSummary.totalScheduledHours || 1)) * 100)) + '%' }"
                                ></div>
                            </div>
                            <div class="flex items-center justify-between text-[11px] text-slate-500">
                                <span>Credited: {{ dashboardSummary.totalCreditedHours }} hrs</span>
                                <span>Planned Capacity: {{ dashboardSummary.totalScheduledHours }} hrs</span>
                            </div>
                        </div>

                        <!-- Data Quality Audit Note Banner (Discrepancy validation) -->
                        <div
                            v-if="dashboardSummary.hasHoursDiscrepancy || (dashboardSummary.totalRecordedHours === 0 && dashboardSummary.totalCreditedHours > 0)"
                            class="p-4 rounded-xl bg-amber-50/80 border border-amber-300/80 flex items-start gap-3 text-xs text-amber-900"
                        >
                            <app-icon name="AlertCircle" :size="18" class="text-amber-600 shrink-0 mt-0.5" />
                            <div class="space-y-1">
                                <div class="font-bold text-amber-900">Data Quality & Source Audit Notice</div>
                                <p class="leading-relaxed">
                                    {{ dashboardSummary.discrepancyNote || '24.0 finalized duty hours were verified through supervisor duty reconciliations, while 0.0 biometric terminal punches were recorded for this period. Biometric terminal logs and manual verification entries have been audited.' }}
                                </p>
                                <p class="text-[11px] text-amber-700">
                                    Actual biometric punch timestamps are recorded via terminal devices. Credited duty hours for this period originate from supervisor-approved reconciliation records.
                                </p>
                            </div>
                        </div>
                    </div>

                    <!-- 5. FOUR REPORT CARDS (Clean two-column grid — NO duplicate tabs above) -->
                    <div>
                        <div class="mb-3">
                            <h3 class="text-sm font-bold text-slate-900 uppercase tracking-wider">Attendance Report Modules</h3>
                            <p class="text-xs text-slate-500">Open a report module to view full records, filter by date, and take administrative action.</p>
                        </div>

                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <!-- Card A — Daily Attendance Report -->
                            <div class="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-blue-500 hover:shadow-md transition-all flex flex-col justify-between">
                                <div class="space-y-3">
                                    <div class="flex items-center justify-between">
                                        <div class="w-10 h-10 rounded-xl bg-blue-50 text-blue-900 flex items-center justify-center font-bold">
                                            <app-icon name="Calendar" :size="20" />
                                        </div>
                                        <span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-800 border border-blue-200">
                                            Daily Audit
                                        </span>
                                    </div>
                                    <div>
                                        <h4 class="text-base font-bold text-slate-900">Daily Attendance Report</h4>
                                        <p class="text-xs text-slate-500 mt-1 leading-relaxed">
                                            Daily attendance log by date, student assistant, and shift. Inspect check-in/out timestamps, geofence radius, and approval states.
                                        </p>
                                    </div>
                                </div>
                                <div class="pt-4 mt-3 border-t border-slate-100 flex items-center justify-between">
                                    <span class="text-xs text-slate-500 font-medium">Single date log verification</span>
                                    <button
                                        @click="selectTab('DAILY')"
                                        class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-900 hover:bg-blue-800 text-white font-bold text-xs rounded-lg shadow-xs transition-colors"
                                    >
                                        <span>View Daily Report</span>
                                        <app-icon name="ArrowRight" :size="13" />
                                    </button>
                                </div>
                            </div>

                            <!-- Card B — Attendance Summary Report -->
                            <div class="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-blue-500 hover:shadow-md transition-all flex flex-col justify-between">
                                <div class="space-y-3">
                                    <div class="flex items-center justify-between">
                                        <div class="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center font-bold">
                                            <app-icon name="CalendarDays" :size="20" />
                                        </div>
                                        <span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-800 border border-indigo-200">
                                            Cutoff Matrix
                                        </span>
                                    </div>
                                    <div>
                                        <h4 class="text-base font-bold text-slate-900">Attendance Summary Report</h4>
                                        <p class="text-xs text-slate-500 mt-1 leading-relaxed">
                                            Attendance summaries grouped by student assistant or department. Comprehensive shift counts, punctuality, absences, and credited hours.
                                        </p>
                                    </div>
                                </div>
                                <div class="pt-4 mt-3 border-t border-slate-100 flex items-center justify-between">
                                    <span class="text-xs text-slate-500 font-medium">Multi-day rollup evaluation</span>
                                    <button
                                        @click="selectTab('SUMMARY')"
                                        class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-900 hover:bg-blue-800 text-white font-bold text-xs rounded-lg shadow-xs transition-colors"
                                    >
                                        <span>View Summary</span>
                                        <app-icon name="ArrowRight" :size="13" />
                                    </button>
                                </div>
                            </div>

                            <!-- Card C — Attendance Exceptions Report -->
                            <div class="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-blue-500 hover:shadow-md transition-all flex flex-col justify-between">
                                <div class="space-y-3">
                                    <div class="flex items-center justify-between">
                                        <div class="w-10 h-10 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center font-bold">
                                            <app-icon name="AlertTriangle" :size="20" />
                                        </div>
                                        <span class="text-xs font-bold px-2 py-0.5 rounded-full bg-orange-50 text-orange-800 border border-orange-200">
                                            {{ dashboardSummary.unresolvedExceptions }} Exceptions
                                        </span>
                                    </div>
                                    <div>
                                        <h4 class="text-base font-bold text-slate-900">Attendance Exceptions Report</h4>
                                        <p class="text-xs text-slate-500 mt-1 leading-relaxed">
                                            Incomplete punches, late arrivals, missing check-outs, and geofence flags requiring immediate supervisor intervention.
                                        </p>
                                    </div>
                                </div>
                                <div class="pt-4 mt-3 border-t border-slate-100 flex items-center justify-between">
                                    <span class="text-xs font-semibold text-orange-700">Anomalies requiring resolution</span>
                                    <button
                                        @click="selectTab('EXCEPTIONS')"
                                        class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-900 hover:bg-blue-800 text-white font-bold text-xs rounded-lg shadow-xs transition-colors"
                                    >
                                        <span>View Exceptions</span>
                                        <app-icon name="ArrowRight" :size="13" />
                                    </button>
                                </div>
                            </div>

                            <!-- Card D — Correction Requests Report -->
                            <div class="bg-white rounded-2xl border border-slate-200/90 p-5 shadow-xs hover:border-blue-500 hover:shadow-md transition-all flex flex-col justify-between">
                                <div class="space-y-3">
                                    <div class="flex items-center justify-between">
                                        <div class="w-10 h-10 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center font-bold">
                                            <app-icon name="FileText" :size="20" />
                                        </div>
                                        <span class="text-xs font-bold px-2 py-0.5 rounded-full bg-purple-50 text-purple-800 border border-purple-200">
                                            {{ dashboardSummary.pendingCorrections }} Pending
                                        </span>
                                    </div>
                                    <div>
                                        <h4 class="text-base font-bold text-slate-900">Correction Requests Report</h4>
                                        <p class="text-xs text-slate-500 mt-1 leading-relaxed">
                                            Pending correction requests submitted by assigned team members. Audit requested adjustments and render review decisions.
                                        </p>
                                    </div>
                                </div>
                                <div class="pt-4 mt-3 border-t border-slate-100 flex items-center justify-between">
                                    <span class="text-xs font-semibold text-purple-700">Awaiting supervisor decision</span>
                                    <button
                                        @click="selectTab('CORRECTIONS')"
                                        class="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-900 hover:bg-blue-800 text-white font-bold text-xs rounded-lg shadow-xs transition-colors"
                                    >
                                        <span>View Correction Requests</span>
                                        <app-icon name="ArrowRight" :size="13" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- ========================================================================= -->
                <!-- 6. REPORT DETAIL EXPERIENCES (DAILY, SUMMARY, EXCEPTIONS, CORRECTIONS) -->
                <!-- ========================================================================= -->

                <!-- TAB A: DAILY ATTENDANCE REPORT -->
                <div v-else-if="activeTab === 'DAILY'" class="space-y-4">
                    <div class="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
                        <div class="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h3 class="text-base font-bold text-slate-900">Daily Attendance Log & Verification</h3>
                                <p class="text-xs text-slate-500">Attendance records for {{ dailyData.formattedDate || singleDate }} &bull; {{ dailyData.records.length }} records found</p>
                            </div>
                            <div class="flex items-center gap-2">
                                <span class="text-xs font-medium text-slate-500">Credited Hours Total:</span>
                                <span class="text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
                                    {{ dailyData.summary?.totalCreditedHours || 0 }} hrs
                                </span>
                            </div>
                        </div>

                        <div class="overflow-x-auto">
                            <table class="w-full text-xs text-left border-collapse">
                                <thead>
                                    <tr class="bg-slate-50/90 border-b border-slate-200 text-slate-600 text-[11px] font-bold uppercase tracking-wider">
                                        <th class="px-3.5 py-3 w-10 text-center">#</th>
                                        <th class="px-3.5 py-3">Student ID</th>
                                        <th class="px-3.5 py-3">Student Assistant</th>
                                        <th class="px-3.5 py-3">Department</th>
                                        <th class="px-3.5 py-3">Scheduled Shift</th>
                                        <th class="px-3.5 py-3">Time In</th>
                                        <th class="px-3.5 py-3">Time Out</th>
                                        <th class="px-3.5 py-3 text-right">Recorded</th>
                                        <th class="px-3.5 py-3 text-right">Credited</th>
                                        <th class="px-3.5 py-3 text-center">Status</th>
                                        <th class="px-3.5 py-3 text-center">Review</th>
                                        <th class="px-3.5 py-3 text-center no-print">Action</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-100">
                                    <tr v-if="dailyData.records.length === 0">
                                        <td colspan="12" class="px-4 py-16 text-center text-slate-400 text-xs">
                                            <div class="w-12 h-12 rounded-full bg-slate-100 text-slate-400 mx-auto mb-2 flex items-center justify-center">
                                                <app-icon name="CalendarX" :size="22" />
                                            </div>
                                            <div class="font-bold text-slate-600">No attendance logs found for this date.</div>
                                            <div class="text-[11px] text-slate-400 mt-1">Change the date picker or check published schedules.</div>
                                        </td>
                                    </tr>
                                    <tr
                                        v-for="(row, idx) in paginatedRecords"
                                        :key="row.saProfileId"
                                        class="hover:bg-blue-50/40 transition-colors"
                                    >
                                        <td class="px-3.5 py-3 text-center text-slate-400 font-medium">
                                            {{ (pagination.currentPage - 1) * pagination.pageSize + idx + 1 }}
                                        </td>
                                        <td class="px-3.5 py-3 font-mono font-medium text-slate-700">{{ row.studentId || row.studentNumber }}</td>
                                        <td class="px-3.5 py-3 font-bold text-slate-900">{{ row.name }}</td>
                                        <td class="px-3.5 py-3 text-slate-600">{{ row.department || row.assignedDepartment }}</td>
                                        <td class="px-3.5 py-3 font-medium text-slate-700">{{ row.scheduledShift }}</td>
                                        <td class="px-3.5 py-3 font-mono text-slate-800">
                                            <div class="flex items-center gap-1.5">
                                                <span>{{ row.timeIn }}</span>
                                                <app-icon v-if="row.faceVerified" name="ScanFace" :size="12" class="text-blue-500" title="Face Biometric Verified" />
                                                <app-icon v-if="row.gpsVerified" name="MapPin" :size="12" class="text-emerald-500" title="GPS Geofence Verified" />
                                            </div>
                                        </td>
                                        <td class="px-3.5 py-3 font-mono text-slate-800">{{ row.timeOut }}</td>
                                        <td class="px-3.5 py-3 text-right font-mono text-slate-600">{{ row.recordedHours }}</td>
                                        <td class="px-3.5 py-3 text-right font-mono font-bold text-emerald-800">{{ row.creditedHours }}</td>
                                        <td class="px-3.5 py-3 text-center">
                                            <span
                                                :class="[
                                                    'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border',
                                                    row.attendanceStatus === 'PRESENT' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                                    row.attendanceStatus === 'LATE' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                                    row.attendanceStatus === 'ON_LEAVE' ? 'bg-sky-50 text-sky-700 border-sky-200' :
                                                    row.attendanceStatus === 'INCOMPLETE' ? 'bg-orange-50 text-orange-700 border-orange-200' :
                                                    'bg-rose-50 text-rose-700 border-rose-200'
                                                ]"
                                            >
                                                {{ row.attendanceStatus }}
                                            </span>
                                        </td>
                                        <td class="px-3.5 py-3 text-center">
                                            <span
                                                :class="[
                                                    'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border',
                                                    row.reviewStatus === 'APPROVED' || row.reviewStatus === 'Approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                                    row.reviewStatus === 'UNDER_REVIEW' || row.reviewStatus === 'Pending Review' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                                    row.reviewStatus === 'REJECTED' || row.reviewStatus === 'Rejected' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                                                    'bg-slate-100 text-slate-700 border-slate-200'
                                                ]"
                                            >
                                                {{ row.reviewStatus }}
                                            </span>
                                        </td>
                                        <td class="px-3.5 py-3 text-center no-print">
                                            <button
                                                @click="jumpToReview('/supervisor/attendance-review?date=' + singleDate + '&saId=' + row.saProfileId)"
                                                class="inline-flex items-center gap-1 text-[11px] font-bold text-blue-900 hover:text-blue-700 hover:underline"
                                            >
                                                <span>Review</span>
                                                <app-icon name="ExternalLink" :size="12" />
                                            </button>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        <!-- Pagination Bar -->
                        <div v-if="totalPages > 1" class="px-5 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 no-print">
                            <div>Showing {{ (pagination.currentPage - 1) * pagination.pageSize + 1 }} to {{ Math.min(pagination.currentPage * pagination.pageSize, currentTabRecords.length) }} of {{ currentTabRecords.length }} records</div>
                            <div class="flex items-center gap-1">
                                <button
                                    @click="pagination.currentPage--"
                                    :disabled="pagination.currentPage === 1"
                                    class="px-2 py-1 rounded border border-slate-200 disabled:opacity-40"
                                >
                                    Prev
                                </button>
                                <span class="px-2">Page {{ pagination.currentPage }} of {{ totalPages }}</span>
                                <button
                                    @click="pagination.currentPage++"
                                    :disabled="pagination.currentPage === totalPages"
                                    class="px-2 py-1 rounded border border-slate-200 disabled:opacity-40"
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- TAB B: ATTENDANCE SUMMARY REPORT -->
                <div v-else-if="activeTab === 'SUMMARY'" class="space-y-4">
                    <div class="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
                        <div class="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h3 class="text-base font-bold text-slate-900">Attendance Summary Matrix</h3>
                                <p class="text-xs text-slate-500">Period: {{ formatDatePretty(startDate) }} &ndash; {{ formatDatePretty(endDate) }} &bull; {{ summaryData.records.length }} S.A.s evaluated</p>
                            </div>
                            <div class="flex items-center gap-3">
                                <div class="text-xs text-slate-600">
                                    Duty Punches: <span class="font-bold text-slate-900">{{ summaryData.summary?.attendanceRecords || 0 }}</span>
                                </div>
                                <div class="text-xs text-emerald-800 font-bold bg-emerald-50 px-3 py-1 rounded-lg border border-emerald-200">
                                    Total Credited: {{ summaryData.summary?.totalCreditedHours || 0 }} hrs
                                </div>
                            </div>
                        </div>

                        <div class="overflow-x-auto">
                            <table class="w-full text-xs text-left border-collapse">
                                <thead>
                                    <tr class="bg-slate-50/90 border-b border-slate-200 text-slate-600 text-[11px] font-bold uppercase tracking-wider">
                                        <th class="px-3.5 py-3 w-10 text-center">#</th>
                                        <th class="px-3.5 py-3">Student ID</th>
                                        <th class="px-3.5 py-3">Student Assistant</th>
                                        <th class="px-3.5 py-3">Department</th>
                                        <th class="px-3 py-3 text-center">Scheduled</th>
                                        <th class="px-3 py-3 text-center text-emerald-800">Present</th>
                                        <th class="px-3 py-3 text-center text-amber-800">Late</th>
                                        <th class="px-3 py-3 text-center text-rose-800">Absent</th>
                                        <th class="px-3 py-3 text-center text-sky-800">Leave</th>
                                        <th class="px-3 py-3 text-center text-orange-800">Incomplete</th>
                                        <th class="px-3.5 py-3 text-right">Recorded</th>
                                        <th class="px-3.5 py-3 text-right font-bold text-emerald-800">Credited</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-100">
                                    <tr v-if="summaryData.records.length === 0">
                                        <td colspan="12" class="px-4 py-16 text-center text-slate-400 text-xs">
                                            <div class="w-12 h-12 rounded-full bg-slate-100 text-slate-400 mx-auto mb-2 flex items-center justify-center">
                                                <app-icon name="Users" :size="22" />
                                            </div>
                                            <div class="font-bold text-slate-600">No attendance summary records found for this period.</div>
                                        </td>
                                    </tr>
                                    <tr
                                        v-for="(row, idx) in summaryData.records"
                                        :key="row.saProfileId"
                                        class="hover:bg-blue-50/40 transition-colors"
                                    >
                                        <td class="px-3.5 py-3 text-center text-slate-400 font-medium">{{ idx + 1 }}</td>
                                        <td class="px-3.5 py-3 font-mono font-medium text-slate-700">{{ row.studentId || row.studentNumber }}</td>
                                        <td class="px-3.5 py-3 font-bold text-slate-900">{{ row.name }}</td>
                                        <td class="px-3.5 py-3 text-slate-600">{{ row.department }}</td>
                                        <td class="px-3 py-3 text-center font-bold text-slate-800">{{ row.totalScheduled || row.scheduledShifts }}</td>
                                        <td class="px-3 py-3 text-center font-extrabold text-emerald-700">{{ row.present }}</td>
                                        <td class="px-3 py-3 text-center font-bold text-amber-700">{{ row.late }}</td>
                                        <td class="px-3 py-3 text-center font-bold text-rose-700">{{ row.absent }}</td>
                                        <td class="px-3 py-3 text-center font-semibold text-sky-700">{{ row.onLeave }}</td>
                                        <td class="px-3 py-3 text-center font-semibold text-orange-700">{{ row.incomplete }}</td>
                                        <td class="px-3.5 py-3 text-right font-mono text-slate-600">{{ row.recordedHours }}</td>
                                        <td class="px-3.5 py-3 text-right font-mono font-extrabold text-emerald-800">{{ row.creditedHours }}</td>
                                    </tr>
                                </tbody>
                                <tfoot v-if="summaryData.records.length > 0" class="bg-slate-50/90 font-bold border-t-2 border-slate-200">
                                    <tr>
                                        <td colspan="4" class="px-3.5 py-3 text-slate-700 uppercase tracking-wider text-[11px]">Total Summary</td>
                                        <td class="px-3 py-3 text-center text-slate-900 font-extrabold">{{ summaryData.summary?.scheduledShifts || 0 }}</td>
                                        <td class="px-3 py-3 text-center text-emerald-800 font-extrabold">{{ summaryData.summary?.present || 0 }}</td>
                                        <td class="px-3 py-3 text-center text-amber-800 font-extrabold">{{ summaryData.summary?.late || 0 }}</td>
                                        <td class="px-3 py-3 text-center text-rose-800 font-extrabold">{{ summaryData.summary?.absent || 0 }}</td>
                                        <td class="px-3 py-3 text-center text-sky-800 font-bold">{{ summaryData.summary?.onLeave || 0 }}</td>
                                        <td class="px-3 py-3 text-center text-orange-800 font-bold">{{ summaryData.summary?.incomplete || 0 }}</td>
                                        <td class="px-3.5 py-3 text-right font-mono text-slate-700">{{ summaryData.summary?.totalRecordedHours || 0 }}</td>
                                        <td class="px-3.5 py-3 text-right font-mono text-emerald-800 text-sm font-extrabold">{{ summaryData.summary?.totalCreditedHours || 0 }}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                </div>

                <!-- TAB C: ATTENDANCE EXCEPTIONS REPORT -->
                <div v-else-if="activeTab === 'EXCEPTIONS'" class="space-y-4">
                    <div class="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
                        <div class="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h3 class="text-base font-bold text-slate-900">Attendance Exceptions & Anomalies</h3>
                                <p class="text-xs text-slate-500">Unresolved discrepancies, missing punches, and tardiness requiring supervisor attention.</p>
                            </div>
                            <div class="flex items-center gap-2">
                                <span class="text-xs font-bold px-3 py-1 rounded-full bg-orange-50 text-orange-800 border border-orange-200">
                                    {{ exceptionsData.records.length }} Anomalies Flagged
                                </span>
                            </div>
                        </div>

                        <div class="overflow-x-auto">
                            <table class="w-full text-xs text-left border-collapse">
                                <thead>
                                    <tr class="bg-slate-50/90 border-b border-slate-200 text-slate-600 text-[11px] font-bold uppercase tracking-wider">
                                        <th class="px-3.5 py-3 w-10 text-center">#</th>
                                        <th class="px-3.5 py-3">Date</th>
                                        <th class="px-3.5 py-3">Student Assistant</th>
                                        <th class="px-3.5 py-3">Department</th>
                                        <th class="px-3.5 py-3">Exception Category</th>
                                        <th class="px-3.5 py-3 text-center">Severity</th>
                                        <th class="px-3.5 py-3">Anomaly Details</th>
                                        <th class="px-3.5 py-3">Punch State</th>
                                        <th class="px-3.5 py-3 text-center">Status</th>
                                        <th class="px-3.5 py-3 text-center no-print">Action</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-100">
                                    <tr v-if="exceptionsData.records.length === 0">
                                        <td colspan="10" class="px-4 py-16 text-center text-slate-400 text-xs">
                                            <div class="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 mx-auto mb-2 flex items-center justify-center">
                                                <app-icon name="CheckCircle2" :size="24" />
                                            </div>
                                            <div class="font-bold text-slate-700">No attendance exceptions found!</div>
                                            <div class="text-[11px] text-slate-400 mt-1">All shift punches and reconciliations for this period are in order.</div>
                                        </td>
                                    </tr>
                                    <tr
                                        v-for="(row, idx) in paginatedRecords"
                                        :key="idx"
                                        class="hover:bg-blue-50/40 transition-colors"
                                    >
                                        <td class="px-3.5 py-3 text-center text-slate-400 font-medium">
                                            {{ (pagination.currentPage - 1) * pagination.pageSize + idx + 1 }}
                                        </td>
                                        <td class="px-3.5 py-3 font-mono font-medium text-slate-800">{{ row.date }}</td>
                                        <td class="px-3.5 py-3 font-bold text-slate-900">
                                            {{ row.name }}
                                            <div class="text-[11px] font-mono text-slate-500 font-normal">{{ row.studentId || row.studentNumber }}</div>
                                        </td>
                                        <td class="px-3.5 py-3 text-slate-600">{{ row.department }}</td>
                                        <td class="px-3.5 py-3 font-bold text-slate-800">{{ row.title }}</td>
                                        <td class="px-3.5 py-3 text-center">
                                            <span
                                                :class="[
                                                    'inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider border',
                                                    row.severity === 'HIGH' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                                                    row.severity === 'MEDIUM' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                                                    'bg-blue-50 text-blue-700 border-blue-200'
                                                ]"
                                            >
                                                {{ row.severity }}
                                            </span>
                                        </td>
                                        <td class="px-3.5 py-3 text-slate-700 max-w-xs">{{ row.description }}</td>
                                        <td class="px-3.5 py-3 font-mono text-slate-600">{{ row.recordedPunch }}</td>
                                        <td class="px-3.5 py-3 text-center">
                                            <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                                {{ row.reviewStatus }}
                                            </span>
                                        </td>
                                        <td class="px-3.5 py-3 text-center no-print">
                                            <button
                                                @click="jumpToReview(row.actionUrl)"
                                                class="inline-flex items-center gap-1 px-3 py-1 text-[11px] font-bold text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors"
                                                title="Open in Attendance Review to resolve"
                                            >
                                                <span>Resolve</span>
                                                <app-icon name="ArrowRight" :size="12" />
                                            </button>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        <!-- Pagination Bar -->
                        <div v-if="totalPages > 1" class="px-5 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 no-print">
                            <div>Showing {{ (pagination.currentPage - 1) * pagination.pageSize + 1 }} to {{ Math.min(pagination.currentPage * pagination.pageSize, currentTabRecords.length) }} of {{ currentTabRecords.length }} exceptions</div>
                            <div class="flex items-center gap-1">
                                <button
                                    @click="pagination.currentPage--"
                                    :disabled="pagination.currentPage === 1"
                                    class="px-2 py-1 rounded border border-slate-200 disabled:opacity-40"
                                >
                                    Prev
                                </button>
                                <span class="px-2">Page {{ pagination.currentPage }} of {{ totalPages }}</span>
                                <button
                                    @click="pagination.currentPage++"
                                    :disabled="pagination.currentPage === totalPages"
                                    class="px-2 py-1 rounded border border-slate-200 disabled:opacity-40"
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- TAB D: CORRECTION REQUESTS REPORT -->
                <div v-else-if="activeTab === 'CORRECTIONS'" class="space-y-4">
                    <div class="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden">
                        <div class="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <h3 class="text-base font-bold text-slate-900">Attendance Correction Requests Audit Log</h3>
                                <p class="text-xs text-slate-500">Student Assistant submitted attendance time adjustments & reconciliation requests.</p>
                            </div>
                            <div class="flex items-center gap-2">
                                <span class="text-xs font-bold px-3 py-1 rounded-full bg-purple-50 text-purple-800 border border-purple-200">
                                    {{ correctionsData.records.length }} Requests Total
                                </span>
                            </div>
                        </div>

                        <div class="overflow-x-auto">
                            <table class="w-full text-xs text-left border-collapse">
                                <thead>
                                    <tr class="bg-slate-50/90 border-b border-slate-200 text-slate-600 text-[11px] font-bold uppercase tracking-wider">
                                        <th class="px-3.5 py-3 w-10 text-center">#</th>
                                        <th class="px-3.5 py-3">Duty Date</th>
                                        <th class="px-3.5 py-3">Student Assistant</th>
                                        <th class="px-3.5 py-3">Ref No</th>
                                        <th class="px-3.5 py-3">Requested Correction</th>
                                        <th class="px-3.5 py-3">Reason Category & Explanation</th>
                                        <th class="px-3.5 py-3">Date Filed</th>
                                        <th class="px-3.5 py-3 text-center">Status</th>
                                        <th class="px-3.5 py-3">Supervisor Action</th>
                                        <th class="px-3.5 py-3 text-center no-print">Review Actions</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-100">
                                    <tr v-if="correctionsData.records.length === 0">
                                        <td colspan="10" class="px-4 py-16 text-center text-slate-400 text-xs">
                                            <div class="w-12 h-12 rounded-full bg-purple-50 text-purple-600 mx-auto mb-2 flex items-center justify-center">
                                                <app-icon name="FileCheck" :size="22" />
                                            </div>
                                            <div class="font-bold text-slate-700">No correction requests found for this period.</div>
                                        </td>
                                    </tr>
                                    <tr
                                        v-for="(row, idx) in paginatedRecords"
                                        :key="row.id"
                                        class="hover:bg-blue-50/40 transition-colors"
                                    >
                                        <td class="px-3.5 py-3 text-center text-slate-400 font-medium">
                                            {{ (pagination.currentPage - 1) * pagination.pageSize + idx + 1 }}
                                        </td>
                                        <td class="px-3.5 py-3 font-mono font-medium text-slate-800">{{ row.dutyDate || row.attendanceDate }}</td>
                                        <td class="px-3.5 py-3 font-bold text-slate-900">
                                            {{ row.name }}
                                            <div class="text-[11px] font-mono text-slate-500 font-normal">{{ row.studentId || row.studentNumber }}</div>
                                        </td>
                                        <td class="px-3.5 py-3 font-mono text-slate-600">{{ row.refNo }}</td>
                                        <td class="px-3.5 py-3 font-mono font-bold text-blue-900">{{ row.requestedPunch || row.requestedValue }}</td>
                                        <td class="px-3.5 py-3 text-slate-700 max-w-xs">
                                            <div class="font-bold text-slate-800">{{ row.reasonCategory }}</div>
                                            <div class="text-slate-500 text-[11px] line-clamp-2">{{ row.explanation || '—' }}</div>
                                        </td>
                                        <td class="px-3.5 py-3 text-slate-500 text-[11px]">{{ row.requestDate }}</td>
                                        <td class="px-3.5 py-3 text-center">
                                            <span
                                                :class="[
                                                    'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold border',
                                                    row.currentStatus === 'APPROVED' || row.currentStatus === 'RECORDED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                                                    row.currentStatus === 'REJECTED' || row.currentStatus === 'REJECTED_BY_SUPERVISOR' ? 'bg-rose-50 text-rose-700 border-rose-200' :
                                                    'bg-amber-50 text-amber-700 border-amber-200'
                                                ]"
                                            >
                                                {{ row.currentStatus }}
                                            </span>
                                        </td>
                                        <td class="px-3.5 py-3 text-slate-700">
                                            <div class="font-medium">{{ row.supervisorDecision }}</div>
                                            <div v-if="row.supervisorRemarks && row.supervisorRemarks !== '—'" class="text-[11px] text-slate-400 italic">
                                                "{{ row.supervisorRemarks }}"
                                            </div>
                                        </td>
                                        <td class="px-3.5 py-3 text-center no-print">
                                            <div class="flex items-center justify-center gap-1.5">
                                                <!-- Action 1: Review Request Link -->
                                                <button
                                                    @click="jumpToReview(row.actionUrl)"
                                                    class="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md transition-colors"
                                                    title="Review full attendance context"
                                                >
                                                    <app-icon name="Eye" :size="12" />
                                                    <span>Review</span>
                                                </button>

                                                <!-- Action 2: Approve button (if pending) -->
                                                <button
                                                    v-if="row.canApprove || row.currentStatus === 'PENDING_SUPERVISOR_REVIEW'"
                                                    @click="approveCorrectionRequest(row)"
                                                    class="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-md transition-colors"
                                                    title="Approve this correction"
                                                >
                                                    <app-icon name="Check" :size="12" />
                                                    <span>Approve</span>
                                                </button>

                                                <!-- Action 3: Reject button (with modal requirement) -->
                                                <button
                                                    v-if="row.canApprove || row.currentStatus === 'PENDING_SUPERVISOR_REVIEW'"
                                                    @click="openRejectModal(row)"
                                                    class="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-bold text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-md transition-colors"
                                                    title="Reject with mandatory explanation"
                                                >
                                                    <app-icon name="X" :size="12" />
                                                    <span>Reject</span>
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        <!-- Pagination Bar -->
                        <div v-if="totalPages > 1" class="px-5 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 no-print">
                            <div>Showing {{ (pagination.currentPage - 1) * pagination.pageSize + 1 }} to {{ Math.min(pagination.currentPage * pagination.pageSize, currentTabRecords.length) }} of {{ currentTabRecords.length }} requests</div>
                            <div class="flex items-center gap-1">
                                <button
                                    @click="pagination.currentPage--"
                                    :disabled="pagination.currentPage === 1"
                                    class="px-2 py-1 rounded border border-slate-200 disabled:opacity-40"
                                >
                                    Prev
                                </button>
                                <span class="px-2">Page {{ pagination.currentPage }} of {{ totalPages }}</span>
                                <button
                                    @click="pagination.currentPage++"
                                    :disabled="pagination.currentPage === totalPages"
                                    class="px-2 py-1 rounded border border-slate-200 disabled:opacity-40"
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- MANDATORY REJECTION REASON MODAL -->
            <div
                v-if="rejectModal.open"
                class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs no-print"
            >
                <div class="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4 animate-in fade-in zoom-in-95">
                    <div class="flex items-center justify-between border-b border-slate-100 pb-3">
                        <div class="flex items-center gap-2 text-rose-600">
                            <app-icon name="AlertTriangle" :size="20" />
                            <h3 class="text-sm font-bold text-slate-900">Reject Correction Request</h3>
                        </div>
                        <button @click="rejectModal.open = false" class="text-slate-400 hover:text-slate-600">
                            <app-icon name="X" :size="18" />
                        </button>
                    </div>

                    <div class="text-xs text-slate-600 space-y-1">
                        <div><span class="font-semibold text-slate-700">Request Ref:</span> <span class="font-mono font-bold">{{ rejectModal.refNo }}</span></div>
                        <div><span class="font-semibold text-slate-700">Student Assistant:</span> <span class="font-bold">{{ rejectModal.saName }}</span></div>
                    </div>

                    <div>
                        <label class="block text-xs font-bold text-slate-700 mb-1.5">
                            Rejection Explanation <span class="text-rose-500">* (Mandatory)</span>
                        </label>
                        <textarea
                            v-model="rejectModal.reason"
                            rows="4"
                            placeholder="Please explain specifically why this correction request is rejected..."
                            class="w-full text-xs bg-slate-50 border border-slate-200 rounded-xl p-3 text-slate-800 focus:bg-white focus:ring-2 focus:ring-rose-500 focus:outline-none"
                        ></textarea>
                        <p class="text-[11px] text-slate-400 mt-1">This explanation will be permanently recorded in the request audit trail.</p>
                    </div>

                    <div class="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                        <button
                            @click="rejectModal.open = false"
                            class="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            @click="submitRejectRequest"
                            :disabled="rejectModal.submitting || !rejectModal.reason || rejectModal.reason.trim().length < 5"
                            class="px-4 py-2 text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-xs transition-colors disabled:opacity-40 flex items-center gap-1.5"
                        >
                            <app-icon v-if="rejectModal.submitting" name="RefreshCw" :size="14" class="animate-spin" />
                            <span>Confirm Rejection</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `
};
