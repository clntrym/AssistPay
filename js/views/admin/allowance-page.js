// Administration > Allowance Management.
// View and configure hourly allowance rates per Student Assistant.
// Features: Cutoff Period Computation (Attendance-Based Credited Hours),
// School-Balance Deduction Endorsement for Accounting, Single S.A. Edit, Quick Inline Edit,
// Multi-S.A. Bulk Edit, Strict Whole-Number Validation (₱8 - ₱1,000), Configurable Base Rate,
// Rate History Audit Trail, Cutoffs Management, Discrepancy Alerts, Dual Official Print Slips.

const AllowancePage = {
    components: { AppIcon, PageHeader, AppModal, FormField },

    setup() {
        const loading = Vue.ref(true);
        const loadError = Vue.ref("");
        const items = Vue.ref([]);
        const semester = Vue.ref(null);
        const semRate = Vue.ref(8.00);
        const stats = Vue.ref({
            activeCount: 0,
            customRateCount: 0,
            standardRateCount: 0,
            scheduledWeeklyLoad: 0,
            weeklyAllowanceEstimate: 0,
            monthlyProjectedEstimate: 0,
            cutoffCreditedHours: 0,
            cutoffPayableAllowance: 0,
            cutoffProposedDeductions: 0,
            cutoffNetAllowance: 0,
            awaitingAttendanceCount: 0,
            discrepancyCount: 0,
            readyForEndorsementCount: 0,
            authorizedDeductionSasCount: 0
        });

        const PRESET_RATES = [8, 9, 10, 12, 15, 20, 25, 50, 100];
        const MIN_RATE = 8;
        const MAX_RATE = 1000;

        // Cutoff Management & Selection State
        const cutoffs = Vue.ref([]);
        const activeCutoff = Vue.ref(null);
        const selectedCutoffId = Vue.ref(null);
        const computingCutoff = Vue.ref(false);
        const cutoffsModal = Vue.ref(false);
        const savingCutoff = Vue.ref(false);
        const cutoffFormError = Vue.ref("");
        const newCutoff = Vue.reactive({
            id: 0,
            cutoffName: "",
            startDate: "",
            endDate: "",
            status: "OPEN_FOR_ATTENDANCE"
        });

        // Period Selection State (kept for compatibility)
        const periodType = Vue.ref("CUTOFF");
        const periodStartDate = Vue.ref("");
        const periodEndDate = Vue.ref("");
        const periodLabel = Vue.ref("");
        const endorsementInfo = Vue.ref(null);

        // Dual Endorsement Modal State
        const endorseModal = Vue.ref(false);
        const endorseModalTab = Vue.ref("ALLOWANCE"); // "ALLOWANCE" | "DEDUCTION"
        const endorseRemarks = Vue.ref("");
        const savingEndorse = Vue.ref(false);
        const coordinatorName = Vue.ref("Ansherina A. Sudario");
        const deductionListData = Vue.ref(null);
        const loadingDeductionList = Vue.ref(false);

        // Historical Read-Only State
        const isReadOnly = Vue.ref(false);

        // Computation Breakdown Modal State
        const computationModal = Vue.ref(false);
        const breakdownLoading = Vue.ref(false);
        const breakdownData = Vue.ref(null);
        const breakdownSearch = Vue.ref("");
        const breakdownStatusFilter = Vue.ref("ALL");
        const expandedBreakdownRows = Vue.reactive({});

        // Dedicated S.A. Billing Modal State
        const deductionModal = Vue.ref(false);

        // Allowance Settlement Modal State
        const settleModal = Vue.ref(false);
        const settleRemarks = Vue.ref("");
        const settleConfirmed = Vue.ref(false);
        const savingSettle = Vue.ref(false);

        // Search & Filters
        const q = Vue.ref("");
        const deptFilter = Vue.ref("ALL");
        const rateFilter = Vue.ref("ALL");
        const statusFilter = Vue.ref("ALL");
        const page = Vue.ref(1);
        const pageSize = Vue.ref(10);
        const sortKey = Vue.ref("name");
        const sortDir = Vue.ref("asc");

        // Multi-S.A. Selection
        const selectedIds = Vue.ref([]);
        const quickBulkRate = Vue.ref(10);
        const quickBulkMode = Vue.ref("CUSTOM"); // "CUSTOM" | "STANDARD"
        const quickBulkReason = Vue.ref("");
        const quickBulkEffectiveDate = Vue.ref(new Date().toISOString().slice(0, 10));
        const quickBulkError = Vue.ref("");
        const savingBulk = Vue.ref(false);

        // Inline Quick Edit Mode
        const inlineMode = Vue.ref(false);
        const inlineDrafts = Vue.reactive({});
        const inlineErrors = Vue.reactive({});
        const inlineReason = Vue.ref("");
        const inlineEffectiveDate = Vue.ref(new Date().toISOString().slice(0, 10));
        const savingInline = Vue.ref(false);

        // Bulk Edit Modal
        const bulkModal = Vue.ref(false);
        const bulkSearch = Vue.ref("");
        const bulkModalRateFilter = Vue.ref("ALL"); // "ALL" | number (e.g. 8, 9, 10)
        const bulkApplyType = Vue.ref("UNIFORM"); // "UNIFORM" | "INDIVIDUAL"
        const bulkRateMode = Vue.ref("CUSTOM");   // "CUSTOM" | "STANDARD"
        const bulkRateInput = Vue.ref(10);
        const bulkIndividualRates = Vue.reactive({});
        const bulkIndividualErrors = Vue.reactive({});
        const bulkReason = Vue.ref("");
        const bulkEffectiveDate = Vue.ref(new Date().toISOString().slice(0, 10));
        const bulkRateError = Vue.ref("");

        // Single S.A. Edit Rate Modal
        const editModal = Vue.ref(false);
        const editSa = Vue.ref(null);
        const rateMode = Vue.ref("CUSTOM"); // "STANDARD" | "CUSTOM"
        const customRateInput = Vue.ref(8);
        const editReason = Vue.ref("");
        const editEffectiveDate = Vue.ref(new Date().toISOString().slice(0, 10));
        const editRateError = Vue.ref("");
        const editReasonError = Vue.ref("");
        const savingRate = Vue.ref(false);

        // Semester Base Rate Modal
        const semRateModal = Vue.ref(false);
        const semRateInput = Vue.ref(8);
        const semRateReason = Vue.ref("");
        const semRateEffectiveDate = Vue.ref(new Date().toISOString().slice(0, 10));
        const semRateError = Vue.ref("");
        const semRateReasonError = Vue.ref("");
        const savingSemRate = Vue.ref(false);

        // Rate History Modal
        const historyModal = Vue.ref(false);
        const historyLoading = Vue.ref(false);
        const historySa = Vue.ref(null);
        const historyLogs = Vue.ref([]);

        // Return for Correction Modal
        const returnModal = Vue.ref(false);
        const returnReason = Vue.ref("");
        const savingReturn = Vue.ref(false);

        // Print Preview Modal
        const printModal = Vue.ref(false);

        // -------------------------------------------------------------
        // Strict Validation Engine (₱8 - ₱1,000 Whole Numbers Only)
        // -------------------------------------------------------------
        const preventDecimalKey = e => {
            if ([".", ",", "e", "E", "-", "+"].includes(e.key)) {
                e.preventDefault();
                if (typeof Alerts !== "undefined" && Alerts.error) {
                    if (e.key === "-" || e.key === "+") {
                        Alerts.error("Negative Value Not Allowed", "Negative allowance rates are not allowed. Minimum allowed rate is ₱8.");
                    } else if (e.key === "." || e.key === ",") {
                        Alerts.error("Decimal Rates Not Allowed", "Enter a whole-number rate only. Decimal values (e.g. 9.50) are not allowed.");
                    } else if (e.key === "e" || e.key === "E") {
                        Alerts.error("Invalid Format", "Scientific notation is not allowed. Enter a whole-number rate only.");
                    }
                }
            }
        };

        const validateRateStrict = (val, isBaseRate = false, triggerSwal = true) => {
            const fieldName = isBaseRate ? "Standard Base Rate" : "Hourly allowance rate";
            if (val === "" || val === null || val === undefined) {
                const msg = `${fieldName} is required. Please enter a whole-number rate between ₱${MIN_RATE} and ₱${MAX_RATE}.`;
                if (triggerSwal && typeof Alerts !== "undefined") Alerts.error("Hourly Rate Required", msg);
                return { valid: false, message: msg, title: "Hourly Rate Required" };
            }
            const str = String(val).trim();
            if (str === "") {
                const msg = `${fieldName} is required. Please enter a whole-number rate between ₱${MIN_RATE} and ₱${MAX_RATE}.`;
                if (triggerSwal && typeof Alerts !== "undefined") Alerts.error("Hourly Rate Required", msg);
                return { valid: false, message: msg, title: "Hourly Rate Required" };
            }

            // Reject negative values
            if (str.startsWith("-") || Number(str) < 0) {
                const msg = "Negative allowance rates are not allowed. Minimum allowed rate is ₱8.";
                if (triggerSwal && typeof Alerts !== "undefined") Alerts.error("Negative Value Not Allowed", msg);
                return { valid: false, message: msg, title: "Negative Value Not Allowed" };
            }

            // Reject decimal values
            if (str.includes(".") || str.includes(",") || !Number.isInteger(Number(str))) {
                const msg = "Enter a whole-number rate only. Decimal values (e.g. 9.50) are not allowed.";
                if (triggerSwal && typeof Alerts !== "undefined") Alerts.error("Decimal Rates Not Allowed", msg);
                return { valid: false, message: msg, title: "Decimal Rates Not Allowed" };
            }

            // Reject non-numeric / scientific notation / letters
            if (!/^[0-9]+$/.test(str)) {
                const msg = isBaseRate
                    ? "Standard Base Rate must be a whole number from ₱8 to ₱1,000 (numbers only)."
                    : "Enter a valid whole-number hourly rate (numbers only).";
                if (triggerSwal && typeof Alerts !== "undefined") Alerts.error("Invalid Rate Format", msg);
                return { valid: false, message: msg, title: "Invalid Rate Format" };
            }

            const num = Number(str);
            if (num < MIN_RATE) {
                const msg = isBaseRate
                    ? `Standard Base Rate must be at least ₱${MIN_RATE}. Rates below ₱${MIN_RATE} are not allowed.`
                    : `Hourly allowance rate cannot be below ₱${MIN_RATE}. Minimum allowed rate is ₱${MIN_RATE}.`;
                if (triggerSwal && typeof Alerts !== "undefined") Alerts.error("Rate Below Minimum", msg);
                return { valid: false, message: msg, title: "Rate Below Minimum" };
            }

            if (num > MAX_RATE) {
                const msg = `${fieldName} cannot exceed ₱${MAX_RATE.toLocaleString()}.`;
                if (triggerSwal && typeof Alerts !== "undefined") Alerts.error("Rate Exceeds Maximum", msg);
                return { valid: false, message: msg, title: "Rate Exceeds Maximum" };
            }

            return { valid: true, message: "", num: num };
        };

        const validateReason = (val, fieldLabel = "Reason", triggerSwal = true) => {
            const clean = String(val || "").trim();
            if (clean.length < 3) {
                const msg = `${fieldLabel} must be at least 3 characters long.`;
                if (triggerSwal && typeof Alerts !== "undefined") Alerts.error("Reason Required", msg);
                return { valid: false, message: msg };
            }
            if (clean.length > 200) {
                const msg = `${fieldLabel} must be 200 characters or fewer.`;
                if (triggerSwal && typeof Alerts !== "undefined") Alerts.error("Reason Too Long", msg);
                return { valid: false, message: msg };
            }
            if (typeof Alerts !== "undefined" && Alerts.validateSafeText) {
                const sqli = Alerts.validateSafeText(clean);
                if (sqli) {
                    if (triggerSwal) Alerts.error("Invalid Characters", sqli);
                    return { valid: false, message: sqli };
                }
            }
            return { valid: true, message: "", value: clean };
        };

        const validateEffectiveDate = (val, fieldLabel = "Effective Date", triggerSwal = true) => {
            if (!val || !String(val).trim()) {
                const msg = `${fieldLabel} is required. Please pick a valid date.`;
                if (triggerSwal && typeof Alerts !== "undefined") Alerts.error("Effective Date Required", msg);
                return { valid: false, message: msg };
            }
            return { valid: true };
        };

        // Blur event handlers for inputs
        const onCustomRateBlur = () => {
            if (rateMode.value === "CUSTOM") {
                const v = validateRateStrict(customRateInput.value, false, true);
                if (!v.valid) {
                    editRateError.value = v.message;
                } else {
                    editRateError.value = "";
                    customRateInput.value = v.num;
                }
            }
        };

        const onSemRateBlur = () => {
            const v = validateRateStrict(semRateInput.value, true, true);
            if (!v.valid) {
                semRateError.value = v.message;
            } else {
                semRateError.value = "";
                semRateInput.value = v.num;
            }
        };

        const onQuickBulkRateBlur = () => {
            if (quickBulkMode.value === "CUSTOM") {
                const v = validateRateStrict(quickBulkRate.value, false, true);
                if (!v.valid) {
                    quickBulkError.value = v.message;
                } else {
                    quickBulkError.value = "";
                    quickBulkRate.value = v.num;
                }
            }
        };

        const onBulkModalRateBlur = () => {
            if (bulkRateMode.value === "CUSTOM") {
                const v = validateRateStrict(bulkRateInput.value, false, true);
                if (!v.valid) {
                    bulkRateError.value = v.message;
                } else {
                    bulkRateError.value = "";
                    bulkRateInput.value = v.num;
                }
            }
        };

        const onBulkIndividualRateBlur = (id) => {
            const v = validateRateStrict(bulkIndividualRates[id], false, true);
            if (!v.valid) {
                bulkIndividualErrors[id] = v.message;
            } else {
                delete bulkIndividualErrors[id];
                bulkIndividualRates[id] = v.num;
            }
        };

        const onInlineRateBlur = (id) => {
            const v = validateRateStrict(inlineDrafts[id], false, true);
            if (!v.valid) {
                inlineErrors[id] = v.message;
            } else {
                delete inlineErrors[id];
                inlineDrafts[id] = v.num;
            }
        };

        const syncInlineDrafts = () => {
            for (const s of items.value) {
                inlineDrafts[s.id] = Number(s.effectiveRate);
                delete inlineErrors[s.id];
                if (bulkIndividualRates[s.id] === undefined) {
                    bulkIndividualRates[s.id] = Number(s.effectiveRate);
                }
            }
        };

        // -------------------------------------------------------------
        // Data Loading
        // -------------------------------------------------------------
        const load = async () => {
            loading.value = true;
            loadError.value = "";
            const payload = {
                action: "list",
                cutoffId: selectedCutoffId.value || undefined,
                periodType: periodType.value,
                startDate: periodStartDate.value || undefined,
                endDate: periodEndDate.value || undefined
            };

            const r = await Model.request("allowance", "list", payload);
            loading.value = false;
            if (!r.success) {
                loadError.value = r.message || "Could not load allowance records.";
                return;
            }
            semRate.value = Number(r.semRate || 8.00);
            stats.value = r.stats || stats.value;
            items.value = (r.items || []).map(s => {
                const rate = Number(s.effectiveRate ?? s.hourlyRate ?? semRate.value ?? 8.00);
                return {
                    ...s,
                    effectiveRate: rate,
                    hourlyRate: rate,
                    scheduledHours: Number(s.scheduledHours ?? s.weeklyHours ?? 0),
                    recordedHours: Number(s.recordedHours ?? 0),
                    creditedHours: Number(s.creditedHours ?? 0),
                    overtimeHours: Number(s.overtimeHours ?? 0),
                    payableAllowance: Number(s.payableAllowance ?? 0),
                    proposedDeduction: Number(s.proposedDeduction ?? 0),
                    netAllowance: Number(s.netAllowance ?? 0),
                    schoolBalanceBefore: Number(s.schoolBalanceBefore ?? 0),
                    expectedBalanceAfter: Number(s.expectedBalanceAfter ?? 0)
                };
            });
            semester.value = r.semester || null;
            cutoffs.value = r.cutoffs || [];
            activeCutoff.value = r.activeCutoff || null;

            if (activeCutoff.value) {
                selectedCutoffId.value = activeCutoff.value.id;
                periodStartDate.value = activeCutoff.value.start_date;
                periodEndDate.value = activeCutoff.value.end_date;
                periodLabel.value = activeCutoff.value.cutoff_name;
            } else if (r.period) {
                periodStartDate.value = r.period.startDate;
                periodEndDate.value = r.period.endDate;
                periodLabel.value = r.period.label;
            }

            if (r.coordinatorName) {
                coordinatorName.value = r.coordinatorName;
            } else if (typeof Store !== "undefined" && (Store.user?.fullName || Store.user?.name)) {
                coordinatorName.value = Store.user.fullName || Store.user.name;
            }
            endorsementInfo.value = r.endorsement || null;
            isReadOnly.value = !!r.isReadOnly;
            syncInlineDrafts();
        };

        const displayCoordinatorName = Vue.computed(() => {
            return endorsementInfo.value?.coordinator_name
                || endorsementInfo.value?.endorsedByName
                || coordinatorName.value
                || (typeof Store !== "undefined" && (Store.user?.fullName || Store.user?.name))
                || "Ansherina A. Sudario";
        });

        Vue.onMounted(load);

        // -------------------------------------------------------------
        // Cutoff Navigation & Management
        // -------------------------------------------------------------
        const onCutoffChange = (id) => {
            selectedCutoffId.value = Number(id);
            load();
        };

        const hasPrevCutoff = Vue.computed(() => {
            if (!cutoffs.value.length) return false;
            const idx = cutoffs.value.findIndex(c => Number(c.id) === Number(selectedCutoffId.value));
            return idx > 0;
        });

        const hasNextCutoff = Vue.computed(() => {
            if (!cutoffs.value.length) return false;
            const idx = cutoffs.value.findIndex(c => Number(c.id) === Number(selectedCutoffId.value));
            return idx !== -1 && idx < cutoffs.value.length - 1;
        });

        const prevCutoff = () => {
            if (!hasPrevCutoff.value) return;
            const idx = cutoffs.value.findIndex(c => Number(c.id) === Number(selectedCutoffId.value));
            if (idx > 0) {
                selectedCutoffId.value = cutoffs.value[idx - 1].id;
                load();
            }
        };

        const nextCutoff = () => {
            if (!hasNextCutoff.value) return;
            const idx = cutoffs.value.findIndex(c => Number(c.id) === Number(selectedCutoffId.value));
            if (idx !== -1 && idx < cutoffs.value.length - 1) {
                selectedCutoffId.value = cutoffs.value[idx + 1].id;
                load();
            }
        };

        const computeCutoff = async () => {
            if (!selectedCutoffId.value) return;
            if (isReadOnly.value) {
                Alerts.warning("Cutoff Locked", "Cannot recompute an endorsed historical cutoff period. Historical records are preserved in read-only mode to maintain audit integrity.");
                return;
            }
            const confirmed = await Alerts.confirm({
                title: "Compute Cutoff Allowance?",
                text: `Compute actual attendance punches and credited duty hours for "${activeCutoff.value?.cutoff_name || 'this cutoff'}"?`,
                icon: "question",
                confirmText: "Yes, Compute",
                requireReason: false
            });
            if (!confirmed) return;

            computingCutoff.value = true;
            const r = await Model.request("allowance", "compute_cutoff", {
                cutoffId: selectedCutoffId.value
            });
            computingCutoff.value = false;
            if (r.success) {
                Store.toast("success", r.message || "Cutoff allowance computed successfully from attendance records.");
                await load();
            } else {
                Alerts.error("Computation Error", r.message || "Failed to compute cutoff.");
            }
        };

        // -------------------------------------------------------------
        // -------------------------------------------------------------
        // Computation Breakdown Modal
        // -------------------------------------------------------------
        const openComputationBreakdown = async () => {
            const targetCutoff = activeCutoff.value || cutoffs.value.find(c => Number(c.id) === Number(selectedCutoffId.value)) || cutoffs.value[0];
            if (!targetCutoff) {
                Alerts.warning("No Cutoff Available", "No cutoff period selected or available.");
                return;
            }
            if (!activeCutoff.value) activeCutoff.value = targetCutoff;
            computationModal.value = true;
            breakdownLoading.value = true;
            breakdownSearch.value = "";
            breakdownStatusFilter.value = "ALL";
            const r = await Model.request("allowance", "computation_breakdown", {
                cutoffId: targetCutoff.id,
                semesterId: semester.value?.id
            });
            breakdownLoading.value = false;
            if (r.success) {
                breakdownData.value = r;
            } else {
                Alerts.error("Allowance Billing Error", r.message || "Failed to load computation breakdown.");
            }
        };

        const toggleBreakdownRow = (id) => {
            expandedBreakdownRows[id] = !expandedBreakdownRows[id];
        };

        const filteredBreakdownItems = Vue.computed(() => {
            if (!breakdownData.value?.items) return [];
            let list = breakdownData.value.items;
            const search = breakdownSearch.value.trim().toLowerCase();
            if (search) {
                list = list.filter(s =>
                    (s.name && s.name.toLowerCase().includes(search)) ||
                    (s.studentId && s.studentId.toLowerCase().includes(search)) ||
                    (s.department && s.department.toLowerCase().includes(search))
                );
            }
            if (breakdownStatusFilter.value === "READY") {
                list = list.filter(s => !s.hasIssues && s.creditedHours > 0);
            } else if (breakdownStatusFilter.value === "ISSUES") {
                list = list.filter(s => s.hasIssues);
            } else if (breakdownStatusFilter.value === "ZERO_ATTENDANCE") {
                list = list.filter(s => s.creditedHours <= 0);
            }
            return list;
        });

        const printComputationSummary = () => {
            document.body.classList.add("printing-computation-breakdown");
            window.print();
            setTimeout(() => {
                document.body.classList.remove("printing-computation-breakdown");
            }, 500);
        };

        const recomputeFromModal = async () => {
            if (!activeCutoff.value || isReadOnly.value) return;
            const confirmed = await Alerts.confirm({
                title: "Recompute Cutoff Allowance?",
                text: `This will re-evaluate actual attendance punches and credited duty hours for "${activeCutoff.value.cutoff_name}". Continue?`,
                confirmText: "Yes, Recompute",
                requireReason: false
            });
            if (!confirmed) return;
            computingCutoff.value = true;
            const r = await Model.request("allowance", "compute_cutoff", {
                cutoffId: activeCutoff.value.id
            });
            computingCutoff.value = false;
            if (r.success) {
                Store.toast("success", r.message || "Cutoff allowance computed successfully.");
                await load();
                await openComputationBreakdown();
            } else {
                Alerts.error("Computation Error", r.message || "Failed to compute cutoff.");
            }
        };

        // -------------------------------------------------------------
        // Dedicated S.A. Billing Deduction List Modal
        // -------------------------------------------------------------
        const openDeductionListModal = async () => {
            const targetCutoff = activeCutoff.value || cutoffs.value.find(c => Number(c.id) === Number(selectedCutoffId.value)) || cutoffs.value[0];
            if (!targetCutoff) {
                Alerts.warning("No Cutoff Available", "No cutoff period selected or available.");
                return;
            }
            if (!activeCutoff.value) activeCutoff.value = targetCutoff;
            deductionModal.value = true;
            loadingDeductionList.value = true;
            const r = await Model.request("allowance", "deduction_endorsement_list", {
                cutoffId: targetCutoff.id,
                semesterId: semester.value?.id
            });
            loadingDeductionList.value = false;
            if (r.success) {
                deductionListData.value = r;
            } else {
                Alerts.error("Deduction Billing Error", r.message || "Failed to load deduction billing list.");
            }
        };

        const printDeductionBilling = () => {
            document.body.classList.add("printing-deduction-billing");
            window.print();
            setTimeout(() => {
                document.body.classList.remove("printing-deduction-billing");
            }, 500);
        };

        const openCutoffsModal = () => {
            cutoffFormError.value = "";
            newCutoff.id = 0;
            newCutoff.cutoffName = `Cutoff ${cutoffs.value.length + 1}`;
            newCutoff.startDate = "";
            newCutoff.endDate = "";
            newCutoff.status = "OPEN_FOR_ATTENDANCE";
            cutoffsModal.value = true;
        };

        const saveCutoff = async () => {
            cutoffFormError.value = "";
            if (!newCutoff.cutoffName || !newCutoff.startDate || !newCutoff.endDate) {
                cutoffFormError.value = "Cutoff name, start date, and end date are required.";
                return;
            }
            if (new Date(newCutoff.startDate) > new Date(newCutoff.endDate)) {
                cutoffFormError.value = "Start date must be before or equal to end date.";
                return;
            }
            savingCutoff.value = true;
            const r = await Model.request("allowance", "cutoff_save", {
                id: newCutoff.id,
                cutoffName: newCutoff.cutoffName,
                startDate: newCutoff.startDate,
                endDate: newCutoff.endDate,
                status: newCutoff.status
            });
            savingCutoff.value = false;
            if (r.success) {
                await Alerts.success("Cutoff Saved", r.message || "Allowance cutoff saved.");
                await load();
                newCutoff.id = 0;
                newCutoff.cutoffName = `Cutoff ${cutoffs.value.length + 1}`;
                newCutoff.startDate = "";
                newCutoff.endDate = "";
            } else {
                cutoffFormError.value = r.message || "Failed to save cutoff.";
            }
        };

        // -------------------------------------------------------------
        // Filtering & Search
        // -------------------------------------------------------------
        const filtered = Vue.computed(() => {
            const term = q.value.trim().toLowerCase();
            return items.value.filter(s => {
                const matchQ = !term || [s.name, s.studentId, s.studentNumber, s.course, s.courseYear, s.location, s.department, s.departmentType]
                    .some(v => v && String(v).toLowerCase().includes(term));
                const matchDept = deptFilter.value === "ALL" || s.department === deptFilter.value || s.departmentType === deptFilter.value;
                const matchRate = rateFilter.value === "ALL"
                    || (rateFilter.value === "CUSTOM" && s.isCustom)
                    || (rateFilter.value === "HIGHER" && s.effectiveRate > semRate.value)
                    || (rateFilter.value === "STANDARD" && !s.isCustom);
                const matchStatus = statusFilter.value === "ALL"
                    || (statusFilter.value === "DISCREPANCY" && s.hasDiscrepancy)
                    || (statusFilter.value === "FINALIZED" && s.attendanceStatus === "FINALIZED")
                    || (statusFilter.value === "READY_FOR_ENDORSEMENT" && s.computationStatus === "READY_FOR_ENDORSEMENT")
                    || (statusFilter.value === "AWAITING_ATTENDANCE" && s.computationStatus === "AWAITING_ATTENDANCE")
                    || (statusFilter.value === "FOR_REVIEW" && s.computationStatus === "FOR_REVIEW")
                    || (statusFilter.value === "DEDUCT_YES" && s.hasDeductionAuth);
                return matchQ && matchDept && matchRate && matchStatus;
            });
        });

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

        Vue.watch([q, deptFilter, rateFilter, statusFilter], () => { page.value = 1; });

        const sortedRows = Vue.computed(() => {
            const list = [...filtered.value];
            const key = sortKey.value;
            const dir = sortDir.value === "asc" ? 1 : -1;

            list.sort((a, b) => {
                let res = 0;
                if (key === "name") {
                    res = (a.name || "").localeCompare(b.name || "");
                    if (res === 0) res = (a.studentId || "").localeCompare(b.studentId || "");
                } else if (key === "department") {
                    const deptA = (a.dept || a.departmentType || "").toUpperCase();
                    const deptB = (b.dept || b.departmentType || "").toUpperCase();
                    res = deptA.localeCompare(deptB);
                } else if (key === "creditedHours") {
                    res = (Number(a.creditedHours) || 0) - (Number(b.creditedHours) || 0);
                } else if (key === "effectiveRate") {
                    res = (Number(a.effectiveRate) || 0) - (Number(b.effectiveRate) || 0);
                } else if (key === "payableAllowance") {
                    res = (Number(a.payableAllowance) || 0) - (Number(b.payableAllowance) || 0);
                } else if (key === "proposedDeduction") {
                    res = (Number(a.proposedDeduction) || 0) - (Number(b.proposedDeduction) || 0);
                } else if (key === "netAllowance") {
                    res = (Number(a.netAllowance) || 0) - (Number(b.netAllowance) || 0);
                } else if (key === "status") {
                    res = (a.computationStatus || "").localeCompare(b.computationStatus || "");
                }
                return res * dir;
            });
            return list;
        });

        const pageCount = Vue.computed(() => {
            if (pageSize.value <= 0) return 1;
            return Math.max(1, Math.ceil(sortedRows.value.length / pageSize.value));
        });

        const pageRows = Vue.computed(() => {
            if (pageSize.value <= 0) return sortedRows.value;
            const start = (page.value - 1) * pageSize.value;
            return sortedRows.value.slice(start, start + pageSize.value);
        });

        const rangeText = Vue.computed(() => {
            const total = sortedRows.value.length;
            if (!total) return "Showing 0 to 0 of 0 entries";
            if (pageSize.value <= 0) return `Showing 1 to ${total} of ${total} entries`;
            const from = (page.value - 1) * pageSize.value + 1;
            const to = Math.min(total, from + pageSize.value - 1);
            return `Showing ${from} to ${to} of ${total} entries`;
        });

        const visiblePages = Vue.computed(() => {
            const total = pageCount.value;
            const current = page.value;
            if (total <= 7) {
                return Array.from({ length: total }, (_, i) => i + 1);
            }
            if (current <= 4) {
                return [1, 2, 3, 4, 5, '...', total];
            }
            if (current >= total - 3) {
                return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
            }
            return [1, '...', current - 1, current, current + 1, '...', total];
        });

        // -------------------------------------------------------------
        // Multi-Select Helpers
        // -------------------------------------------------------------
        const selectedSas = Vue.computed(() => {
            const map = new Map(items.value.map(s => [s.id, s]));
            return selectedIds.value.map(id => map.get(id)).filter(Boolean);
        });

        const isSelected = id => selectedIds.value.includes(id);

        const toggleSelect = id => {
            const idx = selectedIds.value.indexOf(id);
            if (idx === -1) {
                selectedIds.value.push(id);
                const sa = items.value.find(x => x.id === id);
                if (sa && bulkIndividualRates[id] === undefined) {
                    bulkIndividualRates[id] = Number(sa.effectiveRate);
                }
            } else {
                selectedIds.value.splice(idx, 1);
            }
        };

        const isPageAllSelected = Vue.computed(() => {
            return pageRows.value.length > 0 && pageRows.value.every(s => selectedIds.value.includes(s.id));
        });

        const toggleSelectPage = () => {
            if (isPageAllSelected.value) {
                const pageIds = new Set(pageRows.value.map(s => s.id));
                selectedIds.value = selectedIds.value.filter(id => !pageIds.has(id));
            } else {
                for (const s of pageRows.value) {
                    if (!selectedIds.value.includes(s.id)) {
                        selectedIds.value.push(s.id);
                    }
                }
            }
        };

        const selectAllFiltered = () => {
            for (const s of filtered.value) {
                if (!selectedIds.value.includes(s.id)) {
                    selectedIds.value.push(s.id);
                }
            }
        };

        const clearSelection = () => {
            selectedIds.value = [];
        };

        // -------------------------------------------------------------
        // Quick Bulk Bar Save (with Strict Validation)
        // -------------------------------------------------------------
        const applyQuickBulkPreset = rate => {
            quickBulkMode.value = "CUSTOM";
            quickBulkRate.value = Number(rate);
            quickBulkError.value = "";
        };

        const saveQuickBulk = async () => {
            quickBulkError.value = "";
            if (!selectedSas.value.length) {
                Alerts.error("No S.A. Selected", "Please select at least one Student Assistant using the checkboxes.");
                return;
            }
            const useStd = quickBulkMode.value === "STANDARD";
            let rateVal = null;
            if (!useStd) {
                const v = validateRateStrict(quickBulkRate.value);
                if (!v.valid) {
                    quickBulkError.value = v.message;
                    return;
                }
                rateVal = v.num;
            }

            const dCheck = validateEffectiveDate(quickBulkEffectiveDate.value, "Effective Date", true);
            if (!dCheck.valid) return;

            const rCheck = validateReason(quickBulkReason.value, "Reason for Bulk Update", true);
            if (!rCheck.valid) {
                quickBulkError.value = rCheck.message;
                return;
            }

            const rateLabel = useStd ? `Standard Rate (₱${Number(semRate.value).toFixed(2)}/hr)` : `₱${rateVal.toFixed(2)}/hr`;
            const ok = await Alerts.confirm({
                title: `Update Rates for ${selectedSas.value.length} S.A.(s)?`,
                html: `<p class="mb-2">Are you sure you want to set the hourly rate of <strong>${selectedSas.value.length} selected Student Assistant(s)</strong> to <strong>${Alerts.esc(rateLabel)}</strong>?</p>
                       <div class="rounded-lg bg-page p-2.5 text-left text-xs border border-line">
                           <span class="font-semibold text-navy">Reason:</span> ${Alerts.esc(rCheck.value)}
                       </div>`,
                confirmText: `Yes, Update ${selectedSas.value.length} S.A.(s)`,
                requireReason: false
            });
            if (!ok) return;

            savingBulk.value = true;
            const updates = selectedSas.value.map(s => ({
                saProfileId: s.id,
                useStandard: useStd,
                hourlyRate: rateVal
            }));

            const r = await Model.request("allowance", "bulk_update_rates", {
                updates,
                reason: rCheck.value,
                effectiveDate: quickBulkEffectiveDate.value
            });
            savingBulk.value = false;

            if (!r.success) {
                if (!r.cancelled) Alerts.error("Bulk Update Failed", r.message || "Could not update S.A. rates.");
                return;
            }

            Store.toast("success", r.message || "Bulk allowance rates updated.");
            selectedIds.value = [];
            await load();
        };

        // -------------------------------------------------------------
        // Full Bulk Edit Modal
        // -------------------------------------------------------------
        const availableCurrentRates = Vue.computed(() => {
            const counts = {};
            for (const s of items.value) {
                const r = Math.round(Number(s.effectiveRate || semRate.value || 8));
                counts[r] = (counts[r] || 0) + 1;
            }
            return Object.keys(counts).map(Number).sort((a, b) => a - b).map(r => ({
                rate: r,
                count: counts[r]
            }));
        });

        const bulkModalSas = Vue.computed(() => {
            let list = items.value;
            if (bulkModalRateFilter.value !== "ALL") {
                const targetRate = Number(bulkModalRateFilter.value);
                list = list.filter(s => Math.round(Number(s.effectiveRate || semRate.value || 8)) === targetRate);
            }
            const term = bulkSearch.value.trim().toLowerCase();
            if (term) {
                list = list.filter(s =>
                    s.name.toLowerCase().includes(term) ||
                    s.studentId.toLowerCase().includes(term) ||
                    (s.department || s.departmentType || "").toLowerCase().includes(term) ||
                    (s.location || "").toLowerCase().includes(term)
                );
            }
            return list;
        });

        const isBulkModalAllSelected = Vue.computed(() => {
            if (!bulkModalSas.value.length) return false;
            return bulkModalSas.value.every(s => selectedIds.value.includes(s.id));
        });

        const toggleBulkModalSelectAll = () => {
            if (isBulkModalAllSelected.value) {
                const idsToUnselect = new Set(bulkModalSas.value.map(s => s.id));
                selectedIds.value = selectedIds.value.filter(id => !idsToUnselect.has(id));
            } else {
                for (const s of bulkModalSas.value) {
                    if (!selectedIds.value.includes(s.id)) {
                        selectedIds.value.push(s.id);
                    }
                }
            }
        };

        const isRateFullySelected = (rate) => {
            const sasWithRate = items.value.filter(s => Math.round(Number(s.effectiveRate || semRate.value || 8)) === Number(rate));
            if (!sasWithRate.length) return false;
            return sasWithRate.every(s => selectedIds.value.includes(s.id));
        };

        const toggleSelectByRate = (rate) => {
            const sasWithRate = items.value.filter(s => Math.round(Number(s.effectiveRate || semRate.value || 8)) === Number(rate));
            if (!sasWithRate.length) return;
            const allSelected = sasWithRate.every(s => selectedIds.value.includes(s.id));
            if (allSelected) {
                const idsToRemove = new Set(sasWithRate.map(s => s.id));
                selectedIds.value = selectedIds.value.filter(id => !idsToRemove.has(id));
            } else {
                for (const s of sasWithRate) {
                    if (!selectedIds.value.includes(s.id)) {
                        selectedIds.value.push(s.id);
                    }
                }
            }
        };

        const openBulkModal = () => {
            bulkSearch.value = "";
            bulkModalRateFilter.value = "ALL";
            bulkReason.value = "";
            bulkRateError.value = "";
            bulkApplyType.value = "UNIFORM";
            bulkRateMode.value = "CUSTOM";
            bulkRateInput.value = 10;
            bulkEffectiveDate.value = new Date().toISOString().slice(0, 10);
            for (const s of items.value) {
                bulkIndividualRates[s.id] = Number(s.effectiveRate);
                delete bulkIndividualErrors[s.id];
            }
            bulkModal.value = true;
        };

        const saveBulkModal = async () => {
            bulkRateError.value = "";
            if (!selectedSas.value.length) {
                Alerts.error("No S.A. Selected", "Select at least one Student Assistant to update.");
                return;
            }

            const dCheck = validateEffectiveDate(bulkEffectiveDate.value, "Effective Date", true);
            if (!dCheck.valid) return;

            const rCheck = validateReason(bulkReason.value, "Reason for Bulk Update", true);
            if (!rCheck.valid) {
                bulkRateError.value = rCheck.message;
                return;
            }

            let updates = [];
            if (bulkApplyType.value === "UNIFORM") {
                const useStd = bulkRateMode.value === "STANDARD";
                let rateVal = null;
                if (!useStd) {
                    const v = validateRateStrict(bulkRateInput.value, false, true);
                    if (!v.valid) {
                        bulkRateError.value = v.message;
                        return;
                    }
                    rateVal = v.num;
                }
                updates = selectedSas.value.map(s => ({
                    saProfileId: s.id,
                    useStandard: useStd,
                    hourlyRate: rateVal
                }));
            } else {
                let hasErr = false;
                for (const s of selectedSas.value) {
                    const v = validateRateStrict(bulkIndividualRates[s.id], false, true);
                    if (!v.valid) {
                        bulkIndividualErrors[s.id] = v.message;
                        hasErr = true;
                    } else {
                        delete bulkIndividualErrors[s.id];
                    }
                }
                if (hasErr) {
                    Alerts.error("Invalid Individual Rates", "Please check and fix the invalid rates highlighted in red.");
                    return;
                }
                updates = selectedSas.value.map(s => ({
                    saProfileId: s.id,
                    useStandard: false,
                    hourlyRate: Number(bulkIndividualRates[s.id])
                }));
            }

            const ok = await Alerts.confirm({
                title: `Confirm Rate Updates for ${updates.length} S.A.(s)?`,
                html: `<p class="mb-2">Are you sure you want to apply these hourly rate updates?</p>
                       <div class="rounded-lg bg-page p-2.5 text-left text-xs border border-line">
                           <span class="font-semibold text-navy">Reason:</span> ${Alerts.esc(rCheck.value)}
                       </div>`,
                confirmText: "Yes, Apply Updates",
                requireReason: false
            });
            if (!ok) return;

            savingBulk.value = true;
            const r = await Model.request("allowance", "bulk_update_rates", {
                updates,
                reason: rCheck.value,
                effectiveDate: bulkEffectiveDate.value
            });
            savingBulk.value = false;

            if (!r.success) {
                if (!r.cancelled) Alerts.error("Bulk Update Failed", r.message || "Could not update S.A. rates.");
                return;
            }

            Store.toast("success", r.message || "Bulk allowance rates updated.");
            bulkModal.value = false;
            selectedIds.value = [];
            await load();
        };

        // -------------------------------------------------------------
        // Inline Quick Edit Mode
        // -------------------------------------------------------------
        const toggleInlineMode = () => {
            inlineMode.value = !inlineMode.value;
            if (inlineMode.value) {
                syncInlineDrafts();
            }
        };

        const changedInlineRows = Vue.computed(() => {
            return items.value.filter(s => {
                const draft = Number(inlineDrafts[s.id]);
                return !isNaN(draft) && Math.abs(draft - Number(s.effectiveRate)) >= 0.01;
            });
        });

        const saveInlineChanges = async () => {
            if (!changedInlineRows.value.length) {
                Store.toast("info", "No rate changes detected in the table.");
                return;
            }

            let hasErr = false;
            for (const s of changedInlineRows.value) {
                const v = validateRateStrict(inlineDrafts[s.id]);
                if (!v.valid) {
                    inlineErrors[s.id] = v.message;
                    hasErr = true;
                } else {
                    delete inlineErrors[s.id];
                }
            }
            if (hasErr) {
                Alerts.error("Invalid Rates in Table", "One or more modified rates are invalid. Please check the red fields.");
                return;
            }

            let reasonText = String(inlineReason.value || "").trim();
            if (reasonText.length > 0 && reasonText.length < 3) {
                Alerts.error("Validation Error", "Reason must be at least 3 characters long.");
                return;
            }

            const listHtml = changedInlineRows.value.slice(0, 6).map(s => {
                const newR = Number(inlineDrafts[s.id]);
                return `<li class="flex justify-between py-0.5">
                    <span class="font-semibold text-ink">${Alerts.esc(s.name)}</span>
                    <span>₱${Number(s.effectiveRate).toFixed(2)} → <strong class="text-navy">₱${newR.toFixed(2)}/hr</strong></span>
                </li>`;
            }).join("");
            const extraHtml = changedInlineRows.value.length > 6
                ? `<li class="text-muted italic pt-0.5">+ ${changedInlineRows.value.length - 6} more S.A.(s)...</li>`
                : "";

            const hasTypedReason = reasonText.length >= 3;
            const ok = await Alerts.confirm({
                title: `Save ${changedInlineRows.value.length} Inline Allowance Change(s)?`,
                html: `<p class="mb-2 text-xs">Confirm the modified hourly rates below:</p>
                       <ul class="mb-2 rounded-lg border border-line bg-page p-2.5 text-left text-[11px] divide-y divide-line/60">${listHtml}${extraHtml}</ul>
                       ${hasTypedReason ? `<div class="rounded-lg bg-page p-2 text-left text-xs border border-line"><span class="font-semibold text-navy">Reason:</span> ${Alerts.esc(reasonText)}</div>` : ''}`,
                confirmText: `Yes, Save ${changedInlineRows.value.length} Change(s)`,
                requireReason: !hasTypedReason
            });
            if (!ok) return;

            if (!hasTypedReason && typeof Alerts !== "undefined" && Alerts.consumeReason) {
                reasonText = Alerts.consumeReason();
            }
            const rCheck = validateReason(reasonText);
            if (!rCheck.valid) {
                Alerts.error("Reason Required", rCheck.message);
                return;
            }

            const updates = changedInlineRows.value.map(s => ({
                saProfileId: s.id,
                useStandard: false,
                hourlyRate: Number(inlineDrafts[s.id])
            }));

            savingInline.value = true;
            const r = await Model.request("allowance", "bulk_update_rates", {
                updates,
                reason: rCheck.value,
                effectiveDate: inlineEffectiveDate.value,
                isInline: true
            });
            savingInline.value = false;

            if (!r.success) {
                if (!r.cancelled) Alerts.error("Save Failed", r.message || "Failed to save inline rate changes.");
                return;
            }

            await Alerts.success("Rates Saved", r.message || `Saved ${updates.length} allowance rate change(s).`);
            inlineReason.value = "";
            inlineMode.value = false;
            await load();
        };

        // -------------------------------------------------------------
        // Single S.A. Edit Rate Modal
        // -------------------------------------------------------------
        const openEditRate = s => {
            editSa.value = s;
            editReason.value = "";
            editRateError.value = "";
            editReasonError.value = "";
            editEffectiveDate.value = new Date().toISOString().slice(0, 10);
            if (s.isCustom) {
                rateMode.value = "CUSTOM";
                customRateInput.value = Number(s.effectiveRate);
            } else {
                rateMode.value = "STANDARD";
                customRateInput.value = Number(semRate.value);
            }
            editModal.value = true;
        };

        const activeEditRate = Vue.computed(() => {
            if (rateMode.value === "STANDARD") return Number(semRate.value);
            const v = validateRateStrict(customRateInput.value);
            return v.valid ? v.num : null;
        });

        const saveSaRate = async () => {
            if (!editSa.value) return;
            editRateError.value = "";
            editReasonError.value = "";

            const useStd = rateMode.value === "STANDARD";
            let rateVal = null;

            if (!useStd) {
                const v = validateRateStrict(customRateInput.value, false, true);
                if (!v.valid) {
                    editRateError.value = v.message;
                    return;
                }
                rateVal = v.num;
            }

            const dCheck = validateEffectiveDate(editEffectiveDate.value, "Effective Date", true);
            if (!dCheck.valid) return;

            const rCheck = validateReason(editReason.value, "Reason for Rate Edit", true);
            if (!rCheck.valid) {
                editReasonError.value = rCheck.message;
                return;
            }

            const newEffective = useStd ? Number(semRate.value) : rateVal;
            const unchanged = (useStd && !editSa.value.isCustom) ||
                (!useStd && editSa.value.isCustom && Math.abs(Number(editSa.value.effectiveRate) - rateVal) < 0.01);
            if (unchanged) {
                Alerts.warning("Rate Unchanged", `${editSa.value.name} already has this hourly rate.`);
                return;
            }

            const rateLabel = useStd ? `Standard Rate (₱${Number(semRate.value).toFixed(2)}/hr)` : `₱${rateVal.toFixed(2)}/hr`;
            const ok = await Alerts.confirm({
                title: `Update Hourly Rate — ${editSa.value.name}?`,
                html: `<p class="mb-2">Change rate from <strong>₱${Number(editSa.value.effectiveRate).toFixed(2)}/hr</strong> to <strong>${Alerts.esc(rateLabel)}</strong>?</p>
                       <div class="rounded-lg bg-page p-2.5 text-left text-xs border border-line">
                           <span class="font-semibold text-navy">Reason:</span> ${Alerts.esc(rCheck.value)}
                       </div>`,
                confirmText: "Yes, Save Rate",
                requireReason: false
            });
            if (!ok) return;

            savingRate.value = true;
            const r = await Model.request("allowance", "update_rate", {
                saProfileId: editSa.value.id,
                semesterId: semester.value?.id,
                rateMode: useStd ? "STANDARD" : "CUSTOM",
                useStandard: useStd,
                hourlyRate: rateVal,
                reason: rCheck.value,
                effectiveDate: editEffectiveDate.value
            });
            savingRate.value = false;

            if (!r.success) {
                if (!r.cancelled) Alerts.error("Save Failed", r.message || "Failed to update hourly rate.");
                return;
            }

            await Alerts.success("Rate Updated", r.message || `Updated hourly rate for ${editSa.value.name}.`);
            editModal.value = false;
            await load();
        };

        // -------------------------------------------------------------
        // Semester Base Rate Modal
        // -------------------------------------------------------------
        const openSemRateModal = () => {
            semRateInput.value = Number(semRate.value);
            semRateReason.value = "";
            semRateError.value = "";
            semRateReasonError.value = "";
            semRateEffectiveDate.value = new Date().toISOString().slice(0, 10);
            semRateModal.value = true;
        };

        const saveSemRate = async () => {
            semRateError.value = "";
            semRateReasonError.value = "";

            const v = validateRateStrict(semRateInput.value, true, true);
            if (!v.valid) {
                semRateError.value = v.message;
                return;
            }

            const dCheck = validateEffectiveDate(semRateEffectiveDate.value, "Effective Date", true);
            if (!dCheck.valid) return;

            const rCheck = validateReason(semRateReason.value, "Reason for Standard Rate Edit", true);
            if (!rCheck.valid) {
                semRateReasonError.value = rCheck.message;
                return;
            }

            if (Math.abs(Number(semRate.value) - v.num) < 0.01) {
                Alerts.warning("Rate Unchanged", "Base rate is already set to this value.");
                return;
            }

            const ok = await Alerts.confirm({
                title: `Update Standard Semester Base Rate to ₱${v.num.toFixed(2)}/hr?`,
                html: `<p class="mb-2">This standard rate applies to all Student Assistants in <strong>${Alerts.esc(semester.value?.label || 'active semester')}</strong> who do not have an individual custom rate.</p>
                       <div class="rounded-lg bg-page p-2.5 text-left text-xs border border-line">
                           <span class="font-semibold text-navy">Reason:</span> ${Alerts.esc(rCheck.value)}
                       </div>`,
                confirmText: "Yes, Update Base Rate",
                requireReason: false
            });
            if (!ok) return;

            savingSemRate.value = true;
            const r = await Model.request("allowance", "update_semester_rate", {
                semesterId: semester.value?.id,
                hourlyRate: v.num,
                reason: rCheck.value,
                effectiveDate: semRateEffectiveDate.value
            });
            savingSemRate.value = false;

            if (!r.success) {
                if (!r.cancelled) Alerts.error("Base Rate Update Failed", r.message || "Could not update base rate.");
                return;
            }

            await Alerts.success("Base Rate Updated", r.message || "Standard base rate updated.");
            semRateModal.value = false;
            await load();
        };

        // -------------------------------------------------------------
        // Rate History Audit Trail
        // -------------------------------------------------------------
        const openRateHistory = async (sa = null) => {
            historySa.value = sa;
            historyLogs.value = [];
            historyLoading.value = true;
            historyModal.value = true;

            const r = await Model.request("allowance", "rate_history", {
                saProfileId: sa ? sa.id : undefined,
                semesterId: semester.value?.id
            });
            historyLoading.value = false;
            if (r.success) {
                historyLogs.value = r.logs || [];
            } else {
                Alerts.error("Load Error", r.message || "Could not load rate change history.");
            }
        };

        // -------------------------------------------------------------
        // Endorsement & Deduction Workflow
        // -------------------------------------------------------------
        const loadDeductionList = async () => {
            if (!selectedCutoffId.value) return;
            loadingDeductionList.value = true;
            const r = await Model.request("allowance", "deduction_endorsement_list", {
                cutoffId: selectedCutoffId.value
            });
            loadingDeductionList.value = false;
            if (r.success) {
                deductionListData.value = r;
            }
        };

        const openEndorsementModal = async (tab = "ALLOWANCE") => {
            endorseModalTab.value = tab;
            endorseRemarks.value = "";
            endorseModal.value = true;
            await loadDeductionList();
        };

        const setEndorseTab = async (tab) => {
            endorseModalTab.value = tab;
            if (tab === "DEDUCTION" && !deductionListData.value) {
                await loadDeductionList();
            }
        };

        const isCutoffEndorsed = Vue.computed(() => {
            if (!activeCutoff.value) return false;
            return activeCutoff.value.status === "ENDORSED_TO_ACCOUNTING" || !!activeCutoff.value.endorsement_ref;
        });

        const isCutoffSettled = Vue.computed(() => {
            if (!activeCutoff.value) return false;
            return activeCutoff.value.status === "SETTLED" || activeCutoff.value.status === "CLOSED";
        });

        const isSettlementEligible = Vue.computed(() => {
            if (!activeCutoff.value) return false;
            const dc = activeCutoff.value.dateClassification || getDateClassification(activeCutoff.value);
            const isPrev = (dc === "PREVIOUS CUT-OFF");
            const isEndorsed = isCutoffEndorsed.value;
            const notSettled = !isCutoffSettled.value;
            return isPrev && isEndorsed && notSettled;
        });

        const submitEndorsementToAccounting = async () => {
            if (!selectedCutoffId.value) return;

            // Validate that cutoff has ended
            const today = new Date().toISOString().slice(0, 10);
            if (activeCutoff.value && activeCutoff.value.end_date && today < activeCutoff.value.end_date) {
                Alerts.warning("Cutoff Still Active", `Cutoff '${activeCutoff.value.cutoff_name}' is active until ${activeCutoff.value.end_date}. Accounting endorsement requires the period to close.`);
                return;
            }

            if (stats.value.discrepancyCount > 0) {
                const ok = await Alerts.confirm({
                    title: "Discrepancies Detected",
                    text: `There are ${stats.value.discrepancyCount} attendance/rate discrepancies in this cutoff. Unresolved records will be withheld. Proceed with endorsement to Accounting?`,
                    confirmText: "Yes, Endorse Cutoff",
                    requireReason: false
                });
                if (!ok) return;
            } else {
                const ok = await Alerts.confirm({
                    title: "Confirm Accounting Endorsement",
                    text: `Certify and submit allowance billing for ${activeCutoff.value?.cutoff_name} (Gross: ₱${formatMoney(stats.value.cutoffPayableAllowance)}, Net: ₱${formatMoney(stats.value.cutoffNetAllowance)}) to the Accounting Office?`,
                    confirmText: "Yes, Endorse to Accounting",
                    requireReason: false
                });
                if (!ok) return;
            }

            savingEndorse.value = true;
            const r = await Model.request("allowance", "endorse_to_accounting", {
                cutoffId: selectedCutoffId.value,
                remarks: endorseRemarks.value,
                totalSas: items.value.length,
                totalScheduledHours: stats.value.scheduledWeeklyLoad,
                totalCreditedHours: stats.value.cutoffCreditedHours,
                totalGrossAllowance: stats.value.cutoffPayableAllowance,
                totalDeductions: stats.value.cutoffProposedDeductions,
                totalNetAllowance: stats.value.cutoffNetAllowance,
                discrepancyCount: stats.value.discrepancyCount
            });
            savingEndorse.value = false;

            if (r.success) {
                endorseModal.value = false;
                Store.toast("success", r.message || "Cutoff endorsed to Accounting.");
                await load();
                await loadDeductionList();
            } else {
                Alerts.error("Endorsement Failed", r.message || "Could not complete endorsement to Accounting.");
            }
        };

        const openSettlementModal = () => {
            settleRemarks.value = "";
            settleConfirmed.value = false;
            settleModal.value = true;
        };

        const submitSettlement = async () => {
            if (!selectedCutoffId.value) return;
            if (!isSettlementEligible.value) {
                Alerts.warning("Settlement Prerequisites Incomplete", "Allowance settlement requires the cutoff to have ended (PREVIOUS CUT-OFF) and billing to be officially endorsed to Accounting.");
                return;
            }
            savingSettle.value = true;
            const r = await Model.request("allowance", "settle_cutoff", {
                cutoffId: selectedCutoffId.value,
                notes: settleRemarks.value
            });
            savingSettle.value = false;

            if (r.success) {
                settleModal.value = false;
                Store.toast("success", r.message || "Cutoff marked Allowance Settled successfully.");
                await load();
            } else {
                Alerts.error("Settlement Failed", r.message || "Could not complete allowance settlement.");
            }
        };

        const executePrint = (tabOverride = null) => {
            const activeTab = tabOverride || endorseModalTab.value;
            const cls = activeTab === "DEDUCTION" ? "printing-deduction-endorsement" : "printing-allowance-slip";
            document.body.classList.add(cls);
            window.print();
            setTimeout(() => {
                document.body.classList.remove(cls);
            }, 500);
        };

        const formatMoney = val => {
            const n = Number(val) || 0;
            return n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        };

        const formatDateRange = (start, end) => {
            if (!start && !end) return "";
            const opts = { month: "short", day: "numeric", year: "numeric" };
            const s = start ? new Date(start + "T00:00:00").toLocaleDateString("en-US", opts) : "";
            const e = end ? new Date(end + "T00:00:00").toLocaleDateString("en-US", opts) : "";
            return `${s} – ${e}`;
        };

        const getDateClassification = (cutoff) => {
            if (!cutoff) return "CURRENT CUT-OFF";
            if (cutoff.dateClassification) return cutoff.dateClassification;
            const today = new Date().toISOString().slice(0, 10);
            if (cutoff.start_date && cutoff.end_date) {
                if (today >= cutoff.start_date && today <= cutoff.end_date) return "CURRENT CUT-OFF";
                if (today > cutoff.end_date) return "PREVIOUS CUT-OFF";
                return "FUTURE CUT-OFF";
            }
            return "CURRENT CUT-OFF";
        };

        const getDateClassificationClass = (cutoff) => {
            const dc = cutoff?.dateClassification || getDateClassification(cutoff);
            if (dc === "CURRENT CUT-OFF") {
                return "bg-navy text-white border-navy font-bold shadow-xs";
            }
            return "bg-slate-100 text-slate-700 border-slate-300 font-semibold shadow-xs";
        };

        const getWorkflowBadgeLabel = (cutoff) => {
            if (!cutoff) return "Pending Endorsement";
            if (cutoff.status === "SETTLED" || cutoff.status === "CLOSED") {
                return "Allowance Settled";
            }
            if (cutoff.status === "ENDORSED_TO_ACCOUNTING" || cutoff.endorsement_ref) {
                return "Endorsed to Accounting";
            }
            if (cutoff.status === "COMPUTED" || (stats.value && stats.value.cutoffCreditedHours > 0)) {
                return "Pending Endorsement";
            }
            return "Open for Attendance";
        };

        const getWorkflowBadgeClass = (cutoff) => {
            if (!cutoff) return "bg-gray-100 text-gray-700 border-gray-200";
            if (cutoff.status === "SETTLED" || cutoff.status === "CLOSED") {
                return "bg-emerald-100 text-emerald-800 border-emerald-300 font-bold";
            }
            if (cutoff.status === "ENDORSED_TO_ACCOUNTING" || cutoff.endorsement_ref) {
                return "bg-emerald-50 text-emerald-700 border-emerald-200 font-bold";
            }
            if (cutoff.status === "COMPUTED" || (stats.value && stats.value.cutoffCreditedHours > 0)) {
                return "bg-amber-50 text-amber-800 border-amber-200 font-semibold";
            }
            return "bg-sky-50 text-sky-700 border-sky-200 font-semibold";
        };

        const getWorkflowBadgeIcon = (cutoff) => {
            if (!cutoff) return "Clock";
            if (cutoff.status === "SETTLED" || cutoff.status === "CLOSED") return "CheckCheck";
            if (cutoff.status === "ENDORSED_TO_ACCOUNTING" || cutoff.endorsement_ref) return "FileCheck";
            return "Clock";
        };

        const getCutoffBadgeLabel = (statusOrCutoff) => {
            if (!statusOrCutoff) return "Open for Attendance";
            if (typeof statusOrCutoff === "object") {
                return getWorkflowBadgeLabel(statusOrCutoff);
            }
            const s = String(statusOrCutoff).toUpperCase();
            if (s === "SETTLED" || s === "CLOSED") return "Allowance Settled";
            if (s === "ENDORSED_TO_ACCOUNTING" || s === "ENDORSED") return "Endorsed to Accounting";
            if (s === "COMPUTED") return "Computed / Ready";
            if (s === "PROCESSING_CONFIRMED") return "Processing Confirmed";
            return "Open for Attendance";
        };

        const getCutoffBadgeClass = (statusOrCutoff) => {
            if (!statusOrCutoff) return "bg-gray-100 text-gray-700 border-gray-200";
            if (typeof statusOrCutoff === "object") {
                return getWorkflowBadgeClass(statusOrCutoff);
            }
            const s = String(statusOrCutoff).toUpperCase();
            if (s === "SETTLED" || s === "CLOSED") return "bg-emerald-100 text-emerald-800 border-emerald-300 font-bold";
            if (s === "ENDORSED_TO_ACCOUNTING" || s === "ENDORSED") return "bg-emerald-50 text-emerald-700 border-emerald-200 font-bold";
            if (s === "COMPUTED") return "bg-amber-50 text-amber-800 border-amber-200 font-semibold";
            return "bg-sky-50 text-sky-700 border-sky-200 font-semibold";
        };

        const getComputationBadgeClass = (s) => {
            if (s.hasDiscrepancy || s.computationStatus === 'FOR_REVIEW') {
                return "bg-amber-100 text-amber-800 border-amber-200";
            }
            if (s.computationStatus === 'READY_FOR_ENDORSEMENT' || s.attendanceStatus === 'FINALIZED') {
                return "bg-emerald-100 text-emerald-800 border-emerald-200";
            }
            if (s.computationStatus === 'AWAITING_ATTENDANCE' || s.creditedHours <= 0) {
                return "bg-gray-100 text-gray-700 border-gray-200";
            }
            return "bg-page text-muted border-line";
        };

        const getComputationBadgeLabel = (s) => {
            if (s.hasDiscrepancy || s.computationStatus === 'FOR_REVIEW') {
                return "For Review";
            }
            if (s.computationStatus === 'READY_FOR_ENDORSEMENT' || s.attendanceStatus === 'FINALIZED') {
                return "Ready for Endorsement";
            }
            if (s.computationStatus === 'AWAITING_ATTENDANCE' || s.creditedHours <= 0) {
                return "Awaiting Attendance";
            }
            return s.computationStatus || "Draft";
        };

        const getComputationIcon = (s) => {
            if (!s) return "Clock";
            if (s.hasDiscrepancy) return "AlertCircle";
            if (s.creditedHours && Number(s.creditedHours) > 0) return "Check";
            return "Clock";
        };

        const expandedRows = Vue.reactive({});
        const toggleRowExpand = (id) => {
            expandedRows[id] = !expandedRows[id];
        };

        return {
            PRESET_RATES, preventDecimalKey, formatMoney, formatDateRange,
            getDateClassification, getDateClassificationClass, getWorkflowBadgeLabel, getWorkflowBadgeClass, getWorkflowBadgeIcon,
            getCutoffBadgeLabel, getCutoffBadgeClass,
            getComputationBadgeClass, getComputationBadgeLabel, getComputationIcon,
            loading, loadError, items, semester, semRate, stats, load,
            cutoffs, activeCutoff, selectedCutoffId, onCutoffChange, prevCutoff, nextCutoff, hasPrevCutoff, hasNextCutoff,
            computeCutoff, computingCutoff, cutoffsModal, openCutoffsModal, newCutoff, savingCutoff, cutoffFormError, saveCutoff,
            endorseModalTab, deductionListData, loadingDeductionList, setEndorseTab, submitEndorsementToAccounting,
            isCutoffEndorsed, isCutoffSettled, isSettlementEligible,
            settleModal, settleRemarks, settleConfirmed, savingSettle, openSettlementModal, submitSettlement,
            periodType, periodStartDate, periodEndDate, periodLabel, endorsementInfo,
            q, deptFilter, rateFilter, statusFilter, filtered, page, pageCount, pageRows, rangeText,
            sortKey, sortDir, pageSize, sortBy, getSortIcon, sortedRows, visiblePages,
            selectedIds, selectedSas, isSelected, toggleSelect, isPageAllSelected, toggleSelectPage, selectAllFiltered, clearSelection,
            quickBulkRate, quickBulkMode, quickBulkReason, quickBulkEffectiveDate, quickBulkError, savingBulk, applyQuickBulkPreset, saveQuickBulk, onQuickBulkRateBlur,
            inlineMode, inlineDrafts, inlineErrors, inlineReason, inlineEffectiveDate, savingInline, toggleInlineMode, changedInlineRows, saveInlineChanges, onInlineRateBlur,
            bulkModal, bulkSearch, bulkModalRateFilter, bulkModalSas, availableCurrentRates, isBulkModalAllSelected, toggleBulkModalSelectAll, isRateFullySelected, toggleSelectByRate,
            bulkApplyType, bulkRateMode, bulkRateInput, bulkIndividualRates, bulkIndividualErrors, bulkReason, bulkEffectiveDate, bulkRateError, openBulkModal, saveBulkModal, onBulkModalRateBlur, onBulkIndividualRateBlur,
            editModal, editSa, rateMode, customRateInput, editReason, editEffectiveDate, editRateError, editReasonError, activeEditRate, savingRate, openEditRate, saveSaRate, onCustomRateBlur,
            semRateModal, semRateInput, semRateReason, semRateEffectiveDate, semRateError, semRateReasonError, savingSemRate, openSemRateModal, saveSemRate, onSemRateBlur,
            historyModal, historyLoading, historySa, historyLogs, openRateHistory,
            endorseModal, endorseRemarks, savingEndorse, openEndorsementModal, submitEndorsement: submitEndorsementToAccounting,
            coordinatorName, displayCoordinatorName,
            returnModal, returnReason, savingReturn,
            printModal, executePrint,
            expandedRows, toggleRowExpand,
            isReadOnly,
            computationModal, breakdownLoading, breakdownData, breakdownSearch, breakdownStatusFilter,
            filteredBreakdownItems, expandedBreakdownRows, openComputationBreakdown, toggleBreakdownRow,
            printComputationSummary, recomputeFromModal,
            deductionModal, openDeductionListModal, printDeductionBilling
        };
    },

    template: `
    <div class="space-y-6">
    <page-header title="Allowance" section="Administration"
                 subtitle="Manage S.A. hourly rates and cutoff allowance">
        <template #actions>
            <button @click="openRateHistory(null)" class="btn btn-secondary inline-flex items-center gap-1.5" title="View allowance rate change history">
                <app-icon name="History" :size="15" />
                <span>Rate History</span>
            </button>
            <button @click="openBulkModal" class="btn btn-secondary inline-flex items-center gap-1.5" title="Select and edit multiple S.A.s at once">
                <app-icon name="Users" :size="15" />
                <span>Bulk Edit S.A.s</span>
                <span v-if="selectedIds.length" class="rounded-full bg-gold px-1.5 py-0.2 text-[11px] font-bold text-navy">{{ selectedIds.length }}</span>
            </button>
            <div class="inline-flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-1.5 text-left shadow-xs select-none" title="Starting rate of new S.A's">
                <div class="grid h-7 w-7 place-items-center rounded-lg bg-mist text-navy shrink-0">
                    <app-icon name="Coins" :size="15" />
                </div>
                <div class="leading-tight">
                    <span class="block text-xs font-bold text-navy">Base Rate: ₱8.00/hr</span>
                    <span class="block text-[10px] font-medium text-muted">Starting rate of new S.A's</span>
                </div>
            </div>
            <button v-if="isCutoffSettled" type="button" disabled
                    class="btn btn-secondary inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-800 border-emerald-200 cursor-default shadow-xs" title="Allowance Settled and finalized">
                <app-icon name="CheckCheck" :size="15" class="text-emerald-700" /> Allowance Settled
            </button>
            <button v-else-if="isCutoffEndorsed" @click="openEndorsementModal('ALLOWANCE')"
                    class="btn btn-secondary inline-flex items-center gap-1.5 bg-white shadow-xs" title="View S.A. Billing Endorsement and reports">
                <app-icon name="FileCheck" :size="15" class="text-emerald-700" /> S.A Billing Endorsement
            </button>
            <button v-else @click="openEndorsementModal('ALLOWANCE')"
                    class="btn btn-primary inline-flex items-center gap-1.5" title="Allowance Endorsement and Billing Report">
                <app-icon name="Send" :size="15" /> Endorse Billing to Accounting
            </button>
        </template>
    </page-header>

    <div v-if="loading" class="space-y-4" aria-busy="true">
        <div class="h-24 animate-pulse rounded-xl bg-white"></div>
        <div class="h-80 animate-pulse rounded-xl bg-white"></div>
    </div>

    <div v-else-if="loadError" class="card flex flex-col items-center px-6 py-12 text-center">
        <app-icon name="CircleX" :size="28" class="text-danger" />
        <p class="mt-3 text-body font-medium text-ink">Couldn't load allowance data</p>
        <p class="mt-1 text-caption text-muted">{{ loadError }}</p>
        <button @click="load" class="btn btn-secondary btn-sm mt-4"><app-icon name="RefreshCw" :size="14" /> Try again</button>
    </div>

    <template v-else>
        <!-- ------------------------------------------------ Cutoff Selector Toolbar -->
        <div class="card mb-3 flex flex-col gap-3 border border-line bg-page p-3.5 lg:flex-row lg:items-center lg:justify-between shadow-sm">
            <div class="flex flex-wrap items-center gap-2 min-w-0">
                <span class="text-[11px] font-bold uppercase tracking-wider text-muted flex items-center gap-1 shrink-0">
                    <app-icon name="Calendar" :size="14" class="text-gold" /> Cutoff:
                </span>

                <!-- Cutoff Dropdown Selector (Only eligible non-future cutoffs, showing explicit date classification) -->
                <div class="relative min-w-[220px] max-w-[340px]">
                    <select :value="selectedCutoffId" @change="onCutoffChange($event.target.value)"
                            class="input py-1.5 text-xs font-bold text-navy pr-8 cursor-pointer bg-white truncate shadow-xs"
                            aria-label="Select Allowance Cutoff">
                        <option v-for="c in cutoffs" :key="c.id" :value="c.id">
                            {{ c.cutoff_name }} — {{ c.dateClassification || getDateClassification(c) }}
                        </option>
                    </select>
                </div>

                <!-- Prev / Next Cutoff Navigation (Next disabled if on latest/current cutoff) -->
                <div class="flex items-center gap-1 shrink-0">
                    <button type="button" @click="prevCutoff" :disabled="!hasPrevCutoff"
                            class="btn btn-secondary btn-sm px-2 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Previous Cutoff" aria-label="Previous Cutoff">
                        <app-icon name="ChevronLeft" :size="14" />
                    </button>
                    <button type="button" @click="nextCutoff" :disabled="!hasNextCutoff"
                            class="btn btn-secondary btn-sm px-2 py-1 disabled:opacity-40 disabled:cursor-not-allowed"
                            title="Next Cutoff" aria-label="Next Cutoff">
                        <app-icon name="ChevronRight" :size="14" />
                    </button>
                </div>

                <!-- Date Classification Badge (CURRENT CUT-OFF or PREVIOUS CUT-OFF, never Draft) -->
                <span class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold border shadow-xs shrink-0"
                      :class="getDateClassificationClass(activeCutoff)">
                    <app-icon :name="(activeCutoff?.dateClassification || getDateClassification(activeCutoff)) === 'CURRENT CUT-OFF' ? 'Calendar' : 'History'" :size="12" />
                    {{ activeCutoff?.dateClassification || getDateClassification(activeCutoff) }}
                </span>

                <!-- Workflow Status Badge (Endorsed, Settled, Pending Endorsement) -->
                <span class="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold border shadow-xs shrink-0"
                      :class="getWorkflowBadgeClass(activeCutoff)">
                    <app-icon :name="getWorkflowBadgeIcon(activeCutoff)" :size="12" />
                    {{ getWorkflowBadgeLabel(activeCutoff) }}
                </span>

                <span v-if="activeCutoff?.endorsement_ref" class="text-[11px] font-mono text-muted bg-white border border-line rounded px-2 py-0.5 shrink-0" title="Accounting Endorsement Reference">
                    Ref: {{ activeCutoff.endorsement_ref }}
                </span>

                <span v-if="isReadOnly" class="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-800 bg-sky-100 border border-sky-300 rounded-full px-2 py-0.5 shrink-0">
                    <app-icon name="Lock" :size="11" /> Read-Only Historical Snapshot
                </span>
            </div>

            <!-- Toolbar Action Buttons -->
            <div class="flex items-center gap-2 shrink-0 flex-nowrap overflow-x-auto pb-0.5 sm:pb-0">
                <button type="button" @click="openComputationBreakdown" :disabled="breakdownLoading"
                        class="btn btn-secondary btn-sm text-[12px] inline-flex items-center gap-1.5 bg-white whitespace-nowrap shadow-xs hover:border-navy"
                        title="View transparent computation breakdown, duty attendance records, and formula calculations">
                    <app-icon :name="breakdownLoading ? 'LoaderCircle' : 'Calculator'" :size="14" :class="breakdownLoading ? 'animate-spin text-navy' : 'text-navy'" />
                    <span>S.A Allowance Billing</span>
                </button>
                <button type="button" @click="openDeductionListModal" :disabled="loadingDeductionList"
                        class="btn btn-secondary btn-sm text-[12px] inline-flex items-center gap-1.5 bg-white whitespace-nowrap shadow-xs hover:border-navy"
                        title="View S.A. Allowance Deduction Billing and School-Balance Endorsement">
                    <app-icon :name="loadingDeductionList ? 'LoaderCircle' : 'FileSpreadsheet'" :size="14" :class="loadingDeductionList ? 'animate-spin text-amber-700' : 'text-amber-700'" />
                    <span>S.A Allowance Deduction Billing</span>
                </button>
            </div>
        </div>

        <!-- Read-Only Historical Mode Banner -->
        <div v-if="isReadOnly" class="mb-4 rounded-xl border p-3.5 text-xs shadow-xs"
             :class="isCutoffSettled ? 'border-emerald-300 bg-emerald-50/80 text-emerald-950' : 'border-sky-300 bg-sky-50/80 text-sky-950'">
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div class="flex items-start gap-2.5">
                    <span class="rounded-lg p-1.5 shrink-0 mt-0.5"
                          :class="isCutoffSettled ? 'bg-emerald-100 text-emerald-800' : 'bg-sky-100 text-sky-800'">
                        <app-icon :name="isCutoffSettled ? 'CheckCheck' : 'Lock'" :size="16" />
                    </span>
                    <div v-if="isCutoffSettled">
                        <p class="font-bold text-emerald-950 text-sm">Allowance Settled — Historical Archive Permanently Finalized</p>
                        <p class="mt-0.5 text-emerald-900">
                            Cutoff <strong>{{ activeCutoff?.cutoff_name }}</strong> ({{ formatDateRange(activeCutoff?.start_date, activeCutoff?.end_date) }}) has been fully settled and archived
                            <span v-if="activeCutoff?.endorsement_ref">under Reference No. <strong class="font-mono text-ink">{{ activeCutoff.endorsement_ref }}</strong></span>.
                            All allowance disbursements and authorized deductions are complete. Rates, attendance figures, and billing amounts are permanently locked.
                        </p>
                    </div>
                    <div v-else>
                        <p class="font-bold text-sky-900 text-sm">Read-Only Historical Period — Endorsed to Accounting</p>
                        <p class="mt-0.5 text-sky-800">
                            Cutoff <strong>{{ activeCutoff?.cutoff_name }}</strong> ({{ formatDateRange(activeCutoff?.start_date, activeCutoff?.end_date) }}) is officially finalized and endorsed to Accounting
                            <span v-if="activeCutoff?.endorsement_ref">under Reference No. <strong class="font-mono text-ink">{{ activeCutoff.endorsement_ref }}</strong></span>.
                            Rates, attendance figures, and billing amounts are locked to preserve audit integrity. Normal editing and recomputation are disabled.
                        </p>
                    </div>
                </div>
                <div class="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                    <button type="button" @click="openEndorsementModal('ALLOWANCE')" class="btn btn-secondary btn-sm text-xs inline-flex items-center gap-1 bg-white" title="View official S.A. Billing Endorsement slip">
                        <app-icon name="FileText" :size="13" /> S.A Billing Endorsement
                    </button>
                    <button type="button" @click="openDeductionListModal" class="btn btn-secondary btn-sm text-xs inline-flex items-center gap-1 bg-white" title="View S.A. Allowance Deduction Endorsement & Billing">
                        <app-icon name="FileSpreadsheet" :size="13" /> S.A Allowance Deduction Endorsement
                    </button>
                    <button v-if="!isCutoffSettled && (activeCutoff?.dateClassification === 'PREVIOUS CUT-OFF' || getDateClassification(activeCutoff) === 'PREVIOUS CUT-OFF')"
                            type="button" @click="openSettlementModal"
                            class="btn btn-sm text-xs inline-flex items-center gap-1 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-xs">
                        <app-icon name="BadgeCheck" :size="13" /> Allowance Settled
                    </button>
                </div>
            </div>
        </div>

        <!-- ------------------------------------------------ KPI Summary Section (3 Clean Cards) -->
        <div class="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <!-- Card 1: Active S.A.s -->
            <div class="card p-4">
                <span class="text-[11px] font-semibold uppercase tracking-wider text-muted">Active S.A.s</span>
                <p class="mt-1 text-h2 font-bold text-ink">{{ stats.activeCount }}</p>
                <span class="mt-1 block text-caption text-muted">
                    {{ stats.customRateCount }} custom · {{ stats.standardRateCount }} standard
                </span>
            </div>

            <!-- Card 2: Total Payable Allowance for Selected Cutoff -->
            <div class="card p-4 border-l-4 border-navy bg-white">
                <div class="flex items-start justify-between">
                    <div>
                        <span class="text-[11px] font-bold uppercase tracking-wider text-navy">Total Payable Allowance</span>
                        <p class="mt-1 text-h2 font-bold text-navy">₱{{ formatMoney(stats.cutoffPayableAllowance) }}</p>
                    </div>
                    <span class="rounded-full bg-mist p-2 text-navy">
                        <app-icon name="Wallet" :size="18" />
                    </span>
                </div>
                <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-muted">
                    <span>Credited: <strong class="text-ink">{{ Number(stats.cutoffCreditedHours || 0).toFixed(1) }} hrs</strong></span>
                    <span>·</span>
                    <span>Deductions: <strong class="text-amber-700">−₱{{ formatMoney(stats.cutoffProposedDeductions) }}</strong></span>
                    <span>·</span>
                    <span>Net: <strong class="text-emerald-700">₱{{ formatMoney(stats.cutoffNetAllowance) }}</strong></span>
                </div>
            </div>

            <!-- Card 3: For Review -->
            <div class="card p-4" :class="stats.discrepancyCount > 0 ? 'border-l-4 border-amber-500 bg-amber-50/30' : ''">
                <div class="flex items-start justify-between">
                    <div>
                        <span class="text-[11px] font-semibold uppercase tracking-wider" :class="stats.discrepancyCount > 0 ? 'text-amber-800' : 'text-muted'">For Review</span>
                        <p class="mt-1 text-h2 font-bold" :class="stats.discrepancyCount > 0 ? 'text-amber-700' : 'text-ink'">
                            {{ stats.discrepancyCount + stats.awaitingAttendanceCount }}
                        </p>
                    </div>
                    <span v-if="stats.discrepancyCount > 0" class="rounded-full bg-amber-100 p-2 text-amber-700">
                        <app-icon name="AlertTriangle" :size="18" />
                    </span>
                </div>
                <div class="mt-1 flex flex-wrap items-center justify-between gap-1">
                    <span class="text-caption" :class="stats.discrepancyCount > 0 ? 'text-amber-800 font-medium' : 'text-muted'">
                        {{ stats.discrepancyCount }} discrepancies · {{ stats.awaitingAttendanceCount }} awaiting attendance
                    </span>
                    <div class="flex items-center gap-2">
                        <button v-if="stats.discrepancyCount > 0"
                                type="button"
                                @click="statusFilter = 'DISCREPANCY'"
                                class="text-caption font-semibold text-amber-800 hover:text-amber-900 underline inline-flex items-center gap-1">
                            <app-icon name="Filter" :size="12" /> Filter
                        </button>
                        <router-link v-if="stats.discrepancyCount > 0"
                                     to="/admin/attendance"
                                     class="text-caption font-semibold text-navy hover:underline inline-flex items-center gap-1">
                            Attendance <app-icon name="ArrowUpRight" :size="12" />
                        </router-link>
                    </div>
                </div>
            </div>
        </div>

        <!-- ------------------------------------------------ Multi-S.A. Quick Bulk Edit Bar -->
        <div v-if="selectedSas.length > 0 && !isReadOnly"
             class="card mb-4 border-2 border-navy bg-mist/60 p-4 shadow-lift transition-all">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="inline-flex items-center gap-1.5 rounded-full bg-navy px-3 py-1 text-[12px] font-bold text-white">
                            <app-icon name="CheckSquare" :size="14" class="text-gold" />
                            {{ selectedSas.length }} S.A.(s) Selected
                        </span>
                        <button type="button" @click="openBulkModal" class="text-[12px] font-semibold text-navy underline hover:opacity-80">
                            Open Full Bulk Editor
                        </button>
                        <button type="button" @click="clearSelection" class="text-[12px] font-medium text-danger hover:underline">
                            Clear Selection
                        </button>
                    </div>
                    <!-- Selected S.A. Chips -->
                    <div class="mt-2 flex flex-wrap gap-1.5">
                        <span v-for="sa in selectedSas" :key="sa.id"
                              class="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1 text-[12px] font-semibold text-ink shadow-sm">
                            <span>{{ sa.name }}</span>
                            <span class="text-[10px] text-muted">(₱{{ Number(sa.effectiveRate || sa.hourlyRate || 8).toFixed(2) }}/hr)</span>
                            <button type="button" @click="toggleSelect(sa.id)" class="ml-0.5 rounded text-muted hover:text-danger" :aria-label="'Remove ' + sa.name">
                                <app-icon name="X" :size="13" />
                            </button>
                        </span>
                    </div>
                </div>

                <!-- 1-Click Rate Controls -->
                <div class="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white p-3 shadow-sm">
                    <div class="flex flex-wrap items-center gap-1">
                        <span class="mr-1 text-[11px] font-bold uppercase tracking-wider text-muted">Quick Set:</span>
                        <button type="button"
                                @click="quickBulkMode = 'STANDARD'; quickBulkRate = semRate; quickBulkError = ''"
                                class="rounded-lg border px-2.5 py-1 text-[12px] font-semibold transition-colors"
                                :class="quickBulkMode === 'STANDARD' ? 'border-navy bg-navy text-white' : 'border-line bg-page text-ink hover:bg-mist'">
                            Std ₱{{ Number(semRate || 8).toFixed(0) }}
                        </button>
                        <button v-for="preset in [10, 12, 15, 20, 25]" :key="preset" type="button"
                                @click="applyQuickBulkPreset(preset)"
                                class="rounded-lg border px-2.5 py-1 text-[12px] font-semibold transition-colors"
                                :class="quickBulkMode === 'CUSTOM' && Number(quickBulkRate) === preset ? 'border-navy bg-navy text-white' : 'border-line bg-page text-ink hover:bg-mist'">
                            ₱{{ preset }}
                        </button>
                    </div>

                    <div v-if="quickBulkMode === 'CUSTOM'" class="relative w-28">
                        <span class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-muted">₱</span>
                        <input v-model.number="quickBulkRate" @blur="onQuickBulkRateBlur" @keydown="preventDecimalKey" type="number" step="1" min="8" max="1000"
                                class="input py-1.5 pl-6 pr-8 text-[13px] font-bold text-ink"
                                :class="quickBulkError ? 'border-danger focus:ring-danger' : ''"
                               aria-label="Bulk hourly rate">
                        <span class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted">/hr</span>
                    </div>

                    <input v-model="quickBulkReason" type="text" maxlength="200"
                           class="input w-44 py-1.5 text-[12px]"
                           placeholder="Reason for update *">

                    <button type="button" @click="saveQuickBulk" :disabled="savingBulk"
                            class="btn btn-primary btn-sm inline-flex items-center gap-1.5">
                        <app-icon :name="savingBulk ? 'LoaderCircle' : 'Check'" :size="15" :class="savingBulk ? 'animate-spin' : ''" />
                        {{ savingBulk ? 'Saving…' : 'Update ' + selectedSas.length + ' S.A.(s)' }}
                    </button>
                </div>
            </div>
            <p v-if="quickBulkError" class="mt-2 text-[12px] font-semibold text-danger flex items-center gap-1">
                <app-icon name="AlertCircle" :size="13" /> {{ quickBulkError }}
            </p>
        </div>


        <!-- ------------------------------------------------ Main Roster Card -->
        <section class="card">
            <!-- Search & Filters Toolbar -->
            <div class="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
                <div class="flex flex-1 flex-wrap items-center gap-2">
                    <div class="relative flex-1 min-w-[240px] max-w-md">
                        <app-icon name="Search" :size="16" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                        <input v-model="q" type="search" class="input pl-9" placeholder="Search S.A. (name, ID, course, post)..."
                               aria-label="Search Student Assistants">
                    </div>
                    <button v-if="filtered.length > 0" type="button" @click="selectAllFiltered"
                            class="btn btn-secondary btn-sm text-[12px]" title="Select all S.A.s matching current filter">
                        <app-icon name="CheckSquare" :size="14" /> Select Filtered ({{ filtered.length }})
                    </button>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <select v-model="deptFilter" class="input sm:w-40" aria-label="Filter by department">
                        <option value="ALL">All Departments</option>
                        <option value="ITO">ITO Computer Labs</option>
                        <option value="ACADS">ACADS Lecture</option>
                        <option value="OFFICE">Administrative Offices</option>
                    </select>
                    <select v-model="rateFilter" class="input sm:w-44" aria-label="Filter by rate">
                        <option value="ALL">All Rates</option>
                        <option value="STANDARD">Standard Rate (₱{{ Number(semRate || 8).toFixed(2) }})</option>
                        <option value="CUSTOM">Custom Rates</option>
                        <option value="HIGHER">Higher Than Base Rate</option>
                    </select>
                    <select v-model="statusFilter" class="input sm:w-48" aria-label="Filter by computation status">
                        <option value="ALL">All Computation Statuses</option>
                        <option value="READY_FOR_ENDORSEMENT">Ready for Endorsement</option>
                        <option value="AWAITING_ATTENDANCE">Awaiting Attendance (0 hrs)</option>
                        <option value="DISCREPANCY">With Discrepancy Warnings</option>
                        <option value="DEDUCT_YES">With Authorized Deductions</option>
                    </select>
                </div>
            </div>

            <!-- Empty State -->
            <div v-if="!filtered.length" class="flex flex-col items-center px-6 py-14 text-center">
                <span class="grid h-12 w-12 place-items-center rounded-full bg-mist text-navy">
                    <app-icon name="Wallet" :size="22" />
                </span>
                <p class="mt-3 text-body font-medium text-ink">No Student Assistants found</p>
                <p class="mt-1 max-w-sm text-caption text-muted">Try clearing the search query or changing the filter options.</p>
            </div>

            <!-- Allowance Roster Table (Attendance-Based with Deductions) -->
            <template v-else>
                <!-- DataTable Top Toolbar: Page Size Selector & Count Badge -->
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line px-5 py-3.5 bg-mist/30">
                    <div class="flex items-center gap-2 text-caption text-muted">
                        <span class="font-medium text-ink">Show</span>
                        <select v-model.number="pageSize" class="rounded-md border border-line bg-white px-2.5 py-1 text-[13px] font-semibold text-ink shadow-2xs focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy">
                            <option :value="10">10</option>
                            <option :value="25">25</option>
                            <option :value="50">50</option>
                            <option :value="100">100</option>
                            <option :value="0">All</option>
                        </select>
                        <span>entries per page</span>
                    </div>
                    <span class="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1 text-[12px] font-medium text-muted shadow-2xs">
                        <span class="h-2 w-2 rounded-full bg-navy"></span>
                        <b class="text-ink">{{ sortedRows.length }}</b> total S.A. records found
                    </span>
                </div>

                <div class="overflow-x-auto">
                    <table class="w-full min-w-[1100px] text-left text-[13px]">
                        <thead class="bg-page text-[11px] font-semibold uppercase tracking-wide text-muted select-none">
                            <tr>
                                <th class="w-10 px-3.5 py-3 text-center">
                                    <input type="checkbox"
                                           :checked="isPageAllSelected"
                                           @change="toggleSelectPage"
                                           class="h-4 w-4 cursor-pointer rounded border-line text-navy focus:ring-navy/30"
                                           aria-label="Select all S.A.s on this page">
                                </th>
                                <th class="px-3.5 py-3">
                                    <button type="button" @click="sortBy('name')" class="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted hover:text-ink transition-colors">
                                        Student Assistant
                                        <app-icon :name="getSortIcon('name')" :size="13" />
                                    </button>
                                </th>
                                <th class="px-3.5 py-3">
                                    <button type="button" @click="sortBy('department')" class="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted hover:text-ink transition-colors">
                                        Department &amp; Post
                                        <app-icon :name="getSortIcon('department')" :size="13" />
                                    </button>
                                </th>
                                <th class="px-3.5 py-3 text-center">
                                    <button type="button" @click="sortBy('creditedHours')" class="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted hover:text-ink transition-colors">
                                        Credited Hours
                                        <app-icon :name="getSortIcon('creditedHours')" :size="13" />
                                    </button>
                                </th>
                                <th class="px-3.5 py-3">
                                    <button type="button" @click="sortBy('effectiveRate')" class="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted hover:text-ink transition-colors">
                                        Hourly Rate
                                        <app-icon :name="getSortIcon('effectiveRate')" :size="13" />
                                    </button>
                                </th>
                                <th class="px-3.5 py-3 text-right">
                                    <button type="button" @click="sortBy('payableAllowance')" class="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted hover:text-ink transition-colors">
                                        Gross Allowance
                                        <app-icon :name="getSortIcon('payableAllowance')" :size="13" />
                                    </button>
                                </th>
                                <th class="px-3.5 py-3 text-center">
                                    <button type="button" @click="sortBy('proposedDeduction')" class="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted hover:text-ink transition-colors">
                                        Deduction
                                        <app-icon :name="getSortIcon('proposedDeduction')" :size="13" />
                                    </button>
                                </th>
                                <th class="px-3.5 py-3 text-right">
                                    <button type="button" @click="sortBy('netAllowance')" class="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted hover:text-ink transition-colors">
                                        Net Allowance
                                        <app-icon :name="getSortIcon('netAllowance')" :size="13" />
                                    </button>
                                </th>
                                <th class="px-3.5 py-3 text-center">
                                    <button type="button" @click="sortBy('status')" class="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-muted hover:text-ink transition-colors">
                                        Status &amp; Action
                                        <app-icon :name="getSortIcon('status')" :size="13" />
                                    </button>
                                </th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-line">
                            <template v-for="s in pageRows" :key="s.id">
                                <tr class="transition-colors duration-150 hover:bg-mist/40"
                                    :class="isSelected(s.id) ? 'bg-mist/50' : (expandedRows[s.id] ? 'bg-slate-50/50' : '')">
                                    <!-- Multi-select Checkbox -->
                                    <td class="px-3.5 py-3 text-center">
                                        <input type="checkbox"
                                               :checked="isSelected(s.id)"
                                               @change="toggleSelect(s.id)"
                                               class="h-4 w-4 cursor-pointer rounded border-line text-navy focus:ring-navy/30"
                                               :aria-label="'Select ' + s.name">
                                    </td>

                                    <!-- S.A. Name & ID -->
                                    <td class="whitespace-nowrap px-3.5 py-3">
                                        <router-link :to="'/admin/sa-management/' + s.id" class="font-semibold text-ink hover:text-navy hover:underline">
                                            {{ s.name }}
                                        </router-link>
                                        <span class="block text-[11px] text-muted">{{ s.studentId }} · {{ s.course || s.courseYear || 'No course' }}</span>
                                    </td>

                                    <!-- Department & Post -->
                                    <td class="whitespace-nowrap px-3.5 py-3">
                                        <div class="flex items-center gap-1.5">
                                            <span class="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold"
                                                  :class="s.department === 'ITO' ? 'bg-sky-100 text-sky-800' : (s.department === 'ACADS' ? 'bg-purple-100 text-purple-800' : 'bg-emerald-100 text-emerald-800')">
                                                {{ s.department || s.departmentType }}
                                            </span>
                                            <span class="font-medium text-ink truncate max-w-[170px]" :title="s.location">{{ s.location }}</span>
                                        </div>
                                    </td>

                                    <!-- Credited Duty Hours (Actual Attendance) -->
                                    <td class="whitespace-nowrap px-3.5 py-3 text-center">
                                        <span v-if="s.creditedHours > 0" class="inline-block rounded-md bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-800 border border-sky-300">
                                            {{ Number(s.creditedHours || 0).toFixed(1) }} hrs
                                        </span>
                                        <span v-else class="inline-block rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-500 border border-gray-200">
                                            0.0 hrs
                                        </span>
                                        <span v-if="s.overtimeHours > 0" class="block text-[10px] text-indigo-700 font-semibold mt-0.5">
                                            +{{ s.overtimeHours }}h OT
                                        </span>
                                        <span v-if="s.breakDeduction > 0" class="block text-[10px] text-amber-700 font-medium mt-0.5" title="Automatic meal break deduction across qualifying duty days">
                                            -{{ Number(s.breakDeduction).toFixed(1) }}h break
                                        </span>
                                    </td>

                                    <!-- Hourly Rate -->
                                    <td class="whitespace-nowrap px-3.5 py-3">
                                        <div class="flex items-center gap-1.5">
                                            <span class="text-body font-bold"
                                                  :class="Number(s.effectiveRate || 0) > Number(semRate || 0) ? 'text-emerald-700' : 'text-ink'">
                                                ₱{{ Number(s.effectiveRate || s.hourlyRate || 8).toFixed(2) }}
                                            </span>
                                            <span v-if="Number(s.effectiveRate || 0) > Number(semRate || 0)"
                                                  class="inline-flex items-center gap-0.5 rounded-full bg-gold/20 px-1.5 py-0.2 text-[9px] font-bold text-navy"
                                                  title="Higher rate">
                                                <app-icon name="TrendingUp" :size="9" /> Higher
                                            </span>
                                            <span v-else-if="s.isCustom"
                                                  class="inline-flex items-center rounded-full bg-info/10 px-1.5 py-0.2 text-[9px] font-semibold text-info">
                                                Custom
                                            </span>
                                            <span v-else
                                                  class="inline-flex items-center rounded-full bg-page px-1.5 py-0.2 text-[9px] text-muted border border-line">
                                                Std
                                            </span>
                                        </div>
                                        <span class="block text-[10px] text-muted">per credited hr</span>
                                    </td>

                                    <!-- Gross Allowance (Attendance-Based: Credited * Rate) -->
                                    <td class="whitespace-nowrap px-3.5 py-3 text-right">
                                        <span class="font-bold text-body"
                                              :class="s.payableAllowance > 0 ? 'text-ink' : 'text-muted'">
                                            ₱{{ formatMoney(s.payableAllowance) }}
                                        </span>
                                        <span class="block text-[10px] text-muted">
                                            {{ s.creditedHours > 0 ? s.creditedHours + 'h × ₱' + s.effectiveRate : '0.0h credited' }}
                                        </span>
                                    </td>

                                    <!-- Deduction (Auth & Proposed Amount) -->
                                    <td class="whitespace-nowrap px-3.5 py-3 text-center">
                                        <div v-if="s.deductionChoice === 'YES'" class="inline-flex flex-col items-center">
                                            <span class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 border border-emerald-300">
                                                <app-icon name="Check" :size="10" /> YES Auth
                                            </span>
                                            <span v-if="s.proposedDeduction > 0" class="text-[11px] font-bold text-amber-700 mt-0.5">
                                                −₱{{ formatMoney(s.proposedDeduction) }}
                                            </span>
                                            <span v-else class="text-[10px] text-muted mt-0.5">₱0.00</span>
                                        </div>
                                        <div v-else-if="s.deductionChoice === 'NO'" class="inline-flex flex-col items-center">
                                            <span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 border border-slate-200">
                                                NO Deduct
                                            </span>
                                            <span class="text-[10px] text-muted mt-0.5">₱0.00</span>
                                        </div>
                                        <span v-else class="text-[11px] text-muted italic">—</span>
                                    </td>

                                    <!-- Net Allowance -->
                                    <td class="whitespace-nowrap px-3.5 py-3 text-right">
                                        <span class="font-bold text-body"
                                              :class="s.netAllowance > 0 ? 'text-emerald-700' : 'text-muted'">
                                            ₱{{ formatMoney(s.netAllowance) }}
                                        </span>
                                    </td>

                                    <!-- Status & Action -->
                                    <td class="whitespace-nowrap px-3.5 py-2.5 text-center">
                                        <div class="flex items-center justify-center gap-1.5">
                                            <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold border"
                                                  :class="getComputationBadgeClass(s)"
                                                  :title="s.discrepancies?.join('; ') || ''">
                                                <app-icon :name="getComputationIcon(s)" :size="10" />
                                                {{ getComputationBadgeLabel(s) }}
                                            </span>

                                            <button v-if="!isReadOnly" @click="openEditRate(s)" class="btn btn-secondary btn-sm px-2 py-1 inline-flex items-center gap-1" :title="'Change hourly rate for ' + s.name">
                                                <app-icon name="Pencil" :size="12" />
                                            </button>
                                            <span v-else class="inline-flex p-1 text-slate-400" title="Rate editing is disabled for historical endorsed cutoffs">
                                                <app-icon name="Lock" :size="12" />
                                            </span>
                                            <button @click="openRateHistory(s)" class="btn btn-secondary btn-sm px-1.5 py-1" :title="'View rate history for ' + s.name">
                                                <app-icon name="History" :size="12" />
                                            </button>
                                            <button @click="toggleRowExpand(s.id)"
                                                    class="btn btn-secondary btn-sm px-1.5 py-1 text-muted hover:text-ink"
                                                    :title="expandedRows[s.id] ? 'Hide planning details' : 'Show planning & supervisor details'">
                                                <app-icon :name="expandedRows[s.id] ? 'ChevronUp' : 'ChevronDown'" :size="12" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>

                                <!-- Expandable Secondary Details Row (Planning Load, Supervisor, Balance) -->
                                <tr v-if="expandedRows[s.id]" class="bg-slate-50/80 border-b border-line text-[12px]">
                                    <td colspan="9" class="px-6 py-3">
                                        <div class="grid grid-cols-1 sm:grid-cols-4 gap-4 text-ink">
                                            <div>
                                                <span class="block text-[11px] font-bold uppercase tracking-wider text-muted">Scheduled Planning Load</span>
                                                <span class="font-semibold text-ink text-sm">{{ s.scheduledHours || s.weeklyHours || 0 }} hrs/wk</span>
                                                <span class="block text-[11px] text-muted italic mt-0.5">Planning estimate only (not payable)</span>
                                            </div>
                                            <div>
                                                <span class="block text-[11px] font-bold uppercase tracking-wider text-muted">Monthly Planning Projection</span>
                                                <span class="font-semibold text-ink text-sm">₱{{ formatMoney(s.monthlyProjected || (Number(s.weeklyHours || 0) * 4 * Number(s.effectiveRate || semRate || 8))) }}</span>
                                                <span class="block text-[11px] text-muted italic mt-0.5">Est. 4-week planning load</span>
                                            </div>
                                            <div>
                                                <span class="block text-[11px] font-bold uppercase tracking-wider text-muted">Supervisor &amp; Location</span>
                                                <span class="font-semibold text-ink">{{ s.supervisor || 'Not assigned' }}</span>
                                                <span class="block text-[11px] text-muted">{{ s.location || '—' }}</span>
                                            </div>
                                            <div>
                                                <span class="block text-[11px] font-bold uppercase tracking-wider text-muted">Account &amp; Balance</span>
                                                <span class="font-medium" :class="s.schoolBalanceBefore > 0 ? 'text-amber-700 font-semibold' : 'text-muted'">
                                                    Balance: ₱{{ formatMoney(s.schoolBalanceBefore || 0) }}
                                                </span>
                                                <span v-if="s.discrepancies?.length" class="block text-[11px] text-amber-700 font-medium mt-0.5">
                                                    Issues: {{ s.discrepancies.join(', ') }}
                                                </span>
                                                <span v-else class="block text-[11px] text-emerald-700 font-medium mt-0.5">
                                                    All duty logs verified
                                                </span>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            </template>
                        </tbody>
                        <tfoot class="border-t-2 border-line bg-page text-[12px] font-semibold">
                            <tr>
                                <td colspan="3" class="px-3.5 py-3 text-ink">Total for {{ filtered.length }} S.A.(s) listed:</td>
                                <td class="px-3.5 py-3 text-center text-sky-800 font-bold">{{ filtered.reduce((acc, x) => acc + (Number(x.creditedHours) || 0), 0).toFixed(1) }} hrs</td>
                                <td class="px-3.5 py-3"></td>
                                <td class="px-3.5 py-3 text-right text-ink font-bold">₱{{ formatMoney(filtered.reduce((acc, x) => acc + (Number(x.payableAllowance) || 0), 0)) }}</td>
                                <td class="px-3.5 py-3 text-center text-amber-800 font-bold">−₱{{ formatMoney(filtered.reduce((acc, x) => acc + (Number(x.proposedDeduction) || 0), 0)) }}</td>
                                <td class="px-3.5 py-3 text-right text-emerald-800 text-[13px] font-bold">₱{{ formatMoney(filtered.reduce((acc, x) => acc + (Number(x.netAllowance) || 0), 0)) }}</td>
                                <td class="px-3.5 py-3"></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                <!-- DataTable Footer: Showing X to Y of Z & Pagination controls -->
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-line px-5 py-3.5 bg-white">
                    <p class="text-caption text-muted" aria-live="polite">
                        {{ rangeText }}
                    </p>

                    <nav v-if="pageCount > 1" class="flex items-center gap-1" aria-label="Pagination Navigation">
                        <button type="button" @click="page--" :disabled="page <= 1"
                                class="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1 text-[12px] font-semibold text-ink shadow-2xs hover:bg-page disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                aria-label="Previous page">
                            <app-icon name="ChevronLeft" :size="14" /> Prev
                        </button>

                        <template v-for="(p, idx) in visiblePages" :key="idx">
                            <span v-if="p === '...'" class="px-2 py-1 text-caption text-muted select-none">...</span>
                            <button v-else type="button" @click="page = p"
                                    class="h-7 min-w-[28px] rounded-md px-2 text-[12px] font-semibold transition-colors"
                                    :class="page === p ? 'bg-navy text-white shadow-xs' : 'border border-line bg-white text-ink hover:bg-page'">
                                {{ p }}
                            </button>
                        </template>

                        <button type="button" @click="page++" :disabled="page >= pageCount"
                                class="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1 text-[12px] font-semibold text-ink shadow-2xs hover:bg-page disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                aria-label="Next page">
                            Next <app-icon name="ChevronRight" :size="14" />
                        </button>
                    </nav>
                </div>
            </template>
        </section>
    </template>

    <!-- ------------------------------------------------ Modal: Manage Allowance Cutoffs -->
    <app-modal :open="cutoffsModal" title="Allowance Cutoff Periods"
               icon="CalendarCog" tone="navy" size="lg" @close="cutoffsModal = false"
               description="Manage bimonthly cutoff schedules, attendance closing, and accounting computation periods.">
        <div class="space-y-4">
            <!-- Existing Cutoffs Table -->
            <div class="overflow-x-auto rounded-xl border border-line">
                <table class="w-full text-left text-[12px]">
                    <thead class="bg-page text-[10px] font-bold uppercase tracking-wider text-muted">
                        <tr>
                            <th class="px-3 py-2">Cutoff Name</th>
                            <th class="px-3 py-2">Date Range</th>
                            <th class="px-3 py-2 text-center">Status</th>
                            <th class="px-3 py-2 text-center">Credited</th>
                            <th class="px-3 py-2 text-right">Net Allowance</th>
                            <th class="px-3 py-2 text-center">Action</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-line">
                        <tr v-for="c in cutoffs" :key="c.id" :class="selectedCutoffId === c.id ? 'bg-sky-50/60 font-semibold' : ''">
                            <td class="px-3 py-2 text-navy font-bold">{{ c.cutoff_name }}</td>
                            <td class="px-3 py-2 text-muted">{{ formatDateRange(c.start_date, c.end_date) }}</td>
                            <td class="px-3 py-2 text-center">
                                <span class="rounded px-2 py-0.5 text-[10px] font-bold border" :class="getCutoffBadgeClass(c.status)">
                                    {{ getCutoffBadgeLabel(c.status) }}
                                </span>
                            </td>
                            <td class="px-3 py-2 text-center">{{ Number(c.total_credited_hours || 0).toFixed(1) }}h</td>
                            <td class="px-3 py-2 text-right font-semibold text-emerald-800">₱{{ formatMoney(c.total_net_allowance) }}</td>
                            <td class="px-3 py-2 text-center">
                                <button type="button" @click="selectedCutoffId = c.id; load(); cutoffsModal = false"
                                        class="btn btn-secondary btn-sm text-[11px] py-0.5 px-2">
                                    {{ selectedCutoffId === c.id ? 'Active' : 'Select' }}
                                </button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- Add Custom Cutoff Form -->
            <div class="rounded-xl border border-line bg-page p-3.5 space-y-3">
                <h5 class="text-xs font-bold uppercase tracking-wider text-navy flex items-center gap-1.5">
                    <app-icon name="Plus" :size="13" /> Create Custom Cutoff Period
                </h5>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    <div>
                        <label class="field-label text-[11px] font-semibold text-navy">Cutoff Name</label>
                        <input v-model="newCutoff.cutoffName" type="text" class="input py-1 text-xs" placeholder="e.g. Cutoff 6">
                    </div>
                    <div>
                        <label class="field-label text-[11px] font-semibold text-navy">Start Date</label>
                        <input v-model="newCutoff.startDate" type="date" class="input py-1 text-xs">
                    </div>
                    <div>
                        <label class="field-label text-[11px] font-semibold text-navy">End Date</label>
                        <input v-model="newCutoff.endDate" type="date" class="input py-1 text-xs">
                    </div>
                </div>
                <p v-if="cutoffFormError" class="text-[11px] font-semibold text-danger flex items-center gap-1">
                    <app-icon name="AlertCircle" :size="12" /> {{ cutoffFormError }}
                </p>
                <div class="flex justify-end pt-1">
                    <button type="button" @click="saveCutoff" :disabled="savingCutoff" class="btn btn-primary btn-sm inline-flex items-center gap-1">
                        <app-icon :name="savingCutoff ? 'LoaderCircle' : 'Plus'" :size="13" :class="savingCutoff ? 'animate-spin' : ''" />
                        {{ savingCutoff ? 'Saving…' : 'Save Cutoff Period' }}
                    </button>
                </div>
            </div>
        </div>
        <template #footer>
            <button @click="cutoffsModal = false" class="btn btn-secondary">Close</button>
        </template>
    </app-modal>

    <!-- ------------------------------------------------ Modal: S.A Allowance Billing Breakdown -->
    <app-modal :open="computationModal" :title="'S.A. Allowance Billing — ' + (activeCutoff?.cutoff_name || '')"
               icon="Calculator" tone="navy" size="xl" @close="computationModal = false"
               :description="formatDateRange(activeCutoff?.start_date, activeCutoff?.end_date) + (isReadOnly ? ' · Endorsed Historical Snapshot (Read-Only)' : ' · Attendance-Based Payable Calculation')">
        <div class="space-y-4">
            <div v-if="breakdownLoading" class="py-14 text-center text-muted">
                <app-icon name="LoaderCircle" :size="28" class="animate-spin mx-auto text-navy" />
                <p class="mt-2 text-body font-medium text-ink">Analyzing attendance logs &amp; computing breakdown...</p>
                <p class="text-caption text-muted">Verifying credited duty hours, schedule shifts, late/undertime, and deductions.</p>
            </div>

            <template v-else-if="breakdownData">
                <!-- Cutoff Summary Metrics Strip -->
                <div class="grid grid-cols-2 sm:grid-cols-6 gap-2.5">
                    <div class="rounded-xl border border-line bg-page p-2.5">
                        <span class="text-[10px] font-semibold uppercase text-muted">Total S.A.s</span>
                        <p class="text-h4 font-bold text-ink mt-0.5">{{ breakdownData.totals.totalSas }}</p>
                        <span class="text-[10px] text-muted">Active in cutoff</span>
                    </div>
                    <div class="rounded-xl border border-line bg-page p-2.5">
                        <span class="text-[10px] font-semibold uppercase text-muted">Credited Duty</span>
                        <p class="text-h4 font-bold text-sky-800 mt-0.5">{{ Number(breakdownData.totals.totalCreditedHours || 0).toFixed(1) }}h</p>
                        <span class="text-[10px] text-muted">Finalized attendance</span>
                    </div>
                    <div class="rounded-xl border border-line bg-page p-2.5">
                        <span class="text-[10px] font-semibold uppercase text-muted">Gross Allowance</span>
                        <p class="text-h4 font-bold text-ink mt-0.5">₱{{ formatMoney(breakdownData.totals.totalGrossAllowance) }}</p>
                        <span class="text-[10px] text-muted">Credited × Rate</span>
                    </div>
                    <div class="rounded-xl border border-amber-300 bg-amber-50/70 p-2.5">
                        <span class="text-[10px] font-semibold uppercase text-amber-900">Deductions</span>
                        <p class="text-h4 font-bold text-amber-800 mt-0.5">−₱{{ formatMoney(breakdownData.totals.totalProposedDeductions) }}</p>
                        <span class="text-[10px] text-amber-700">School Balance</span>
                    </div>
                    <div class="rounded-xl border border-emerald-300 bg-emerald-50/70 p-2.5">
                        <span class="text-[10px] font-semibold uppercase text-emerald-900">Net Allowance</span>
                        <p class="text-h4 font-bold text-emerald-800 mt-0.5">₱{{ formatMoney(breakdownData.totals.totalNetAllowance) }}</p>
                        <span class="text-[10px] text-emerald-700">Payable amount</span>
                    </div>
                    <div class="rounded-xl border border-line bg-page p-2.5" :class="breakdownData.totals.discrepancyCount > 0 ? 'border-amber-300 bg-amber-50/40' : ''">
                        <span class="text-[10px] font-semibold uppercase" :class="breakdownData.totals.discrepancyCount > 0 ? 'text-amber-800' : 'text-muted'">Review / Issues</span>
                        <p class="text-h4 font-bold mt-0.5" :class="breakdownData.totals.discrepancyCount > 0 ? 'text-amber-700' : 'text-ink'">
                            {{ breakdownData.totals.discrepancyCount }}
                        </p>
                        <span class="text-[10px] text-muted">{{ breakdownData.totals.zeroAttendanceCount }} zero attendance</span>
                    </div>
                </div>

                <!-- Search and Status Filter Bar -->
                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-1">
                    <div class="relative flex-1 max-w-sm">
                        <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
                            <app-icon name="Search" :size="14" />
                        </span>
                        <input v-model="breakdownSearch" type="search" placeholder="Search S.A. by name, student ID, or dept..."
                               class="input pl-8 py-1.5 text-xs">
                    </div>
                    <div class="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
                        <button type="button" @click="breakdownStatusFilter = 'ALL'"
                                class="rounded-full px-2.5 py-1 text-[11px] font-bold border transition-colors whitespace-nowrap"
                                :class="breakdownStatusFilter === 'ALL' ? 'bg-navy text-white border-navy' : 'bg-white text-muted border-line hover:bg-mist'">
                            All ({{ breakdownData.items.length }})
                        </button>
                        <button type="button" @click="breakdownStatusFilter = 'READY'"
                                class="rounded-full px-2.5 py-1 text-[11px] font-bold border transition-colors whitespace-nowrap"
                                :class="breakdownStatusFilter === 'READY' ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-white text-emerald-800 border-line hover:bg-emerald-50'">
                            Ready ({{ breakdownData.totals.totalSas - breakdownData.totals.discrepancyCount }})
                        </button>
                        <button type="button" @click="breakdownStatusFilter = 'ISSUES'"
                                class="rounded-full px-2.5 py-1 text-[11px] font-bold border transition-colors whitespace-nowrap"
                                :class="breakdownStatusFilter === 'ISSUES' ? 'bg-amber-700 text-white border-amber-700' : 'bg-white text-amber-800 border-line hover:bg-amber-50'">
                            Needs Review ({{ breakdownData.totals.discrepancyCount }})
                        </button>
                        <button type="button" @click="breakdownStatusFilter = 'ZERO_ATTENDANCE'"
                                class="rounded-full px-2.5 py-1 text-[11px] font-bold border transition-colors whitespace-nowrap"
                                :class="breakdownStatusFilter === 'ZERO_ATTENDANCE' ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-700 border-line hover:bg-slate-100'">
                            Zero Attendance ({{ breakdownData.totals.zeroAttendanceCount }})
                        </button>
                    </div>
                </div>

                <!-- Detailed Computation Breakdown Table -->
                <div class="max-h-[500px] overflow-y-auto rounded-xl border border-line bg-white shadow-xs">
                    <table class="w-full text-left text-[11px]">
                        <thead class="sticky top-0 z-10 bg-page text-[10px] font-bold uppercase tracking-wider text-muted border-b border-line">
                            <tr>
                                <th class="px-3 py-2.5">Student Assistant</th>
                                <th class="px-2.5 py-2.5 text-center">Attendance Status</th>
                                <th class="px-2.5 py-2.5 text-center">Credited Hrs</th>
                                <th class="px-2.5 py-2.5 text-right">Rate</th>
                                <th class="px-2.5 py-2.5 text-right">Gross</th>
                                <th class="px-2.5 py-2.5 text-right">Deduction</th>
                                <th class="px-2.5 py-2.5 text-right">Net Payable</th>
                                <th class="px-3 py-2.5">Explanations &amp; Policy Reason</th>
                                <th class="px-2 py-2.5 text-center">Duty Logs</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-line">
                            <tr v-if="!filteredBreakdownItems.length">
                                <td colspan="9" class="p-8 text-center text-muted text-xs">
                                    No Student Assistant records match the current filter in this cutoff.
                                </td>
                            </tr>
                            <template v-for="s in filteredBreakdownItems" :key="s.id">
                                <tr class="hover:bg-mist/30 transition-colors" :class="s.hasIssues ? 'bg-amber-50/30' : (s.zeroAttendance ? 'bg-slate-50/40' : '')">
                                    <td class="px-3 py-2.5">
                                        <span class="font-bold text-ink block text-[12px]">{{ s.name }}</span>
                                        <span class="font-mono text-muted text-[10px]">{{ s.studentId }} · {{ s.department }}</span>
                                    </td>
                                    <td class="px-2.5 py-2.5 text-center whitespace-nowrap">
                                        <span v-if="s.zeroAttendance" class="rounded-full px-2 py-0.5 text-[9px] font-bold bg-slate-100 text-slate-600 border border-slate-300">
                                            Zero Attendance
                                        </span>
                                        <span v-else-if="s.hasIssues" class="rounded-full px-2 py-0.5 text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                                            Incomplete / Review
                                        </span>
                                        <span v-else class="rounded-full px-2 py-0.5 text-[9px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                                            Finalized
                                        </span>
                                    </td>
                                    <td class="px-2.5 py-2.5 text-center font-bold" :class="s.creditedHours > 0 ? 'text-sky-800' : 'text-muted'">
                                        {{ Number(s.creditedHours || 0).toFixed(1) }}h
                                    </td>
                                    <td class="px-2.5 py-2.5 text-right font-mono text-muted">
                                        ₱{{ Number(s.hourlyRate).toFixed(2) }}
                                    </td>
                                    <td class="px-2.5 py-2.5 text-right font-bold text-ink">
                                        ₱{{ formatMoney(s.grossAllowance) }}
                                    </td>
                                    <td class="px-2.5 py-2.5 text-right font-semibold" :class="s.deductionFromAllowance > 0 ? 'text-amber-700' : 'text-muted'">
                                        {{ s.deductionFromAllowance > 0 ? '−₱' + formatMoney(s.deductionFromAllowance) : '₱0.00' }}
                                    </td>
                                    <td class="px-2.5 py-2.5 text-right font-bold text-[12px]" :class="s.netAllowance > 0 ? 'text-emerald-700' : 'text-muted'">
                                        ₱{{ formatMoney(s.netAllowance) }}
                                    </td>
                                    <td class="px-3 py-2.5 text-[10px]">
                                        <div class="space-y-0.5 max-w-xs">
                                            <div v-for="(exp, expIdx) in s.explanations" :key="expIdx"
                                                 class="flex items-start gap-1"
                                                 :class="exp.includes('Late') || exp.includes('Absence') || exp.includes('Missing') ? 'text-amber-800 font-medium' : (exp.includes('Rate') ? 'text-purple-800 font-medium' : 'text-muted')">
                                                <span>•</span> <span>{{ exp }}</span>
                                            </div>
                                            <div v-if="!s.explanations.length" class="text-emerald-700 font-medium">
                                                All duty hours verified according to policy.
                                            </div>
                                        </div>
                                    </td>
                                    <td class="px-2 py-2.5 text-center">
                                        <button type="button" @click="toggleBreakdownRow(s.id)"
                                                class="btn btn-secondary btn-sm px-1.5 py-0.5 text-[10px]"
                                                :title="expandedBreakdownRows[s.id] ? 'Hide detailed duty punches' : 'View punch logs & calculation formula'">
                                            <app-icon :name="expandedBreakdownRows[s.id] ? 'ChevronUp' : 'ChevronDown'" :size="12" />
                                            <span>{{ s.dutyDaysCount || s.dutyLogs?.length || 0 }}d</span>
                                        </button>
                                    </td>
                                </tr>

                                <!-- Expandable Detailed Attendance Punches & Formula Breakdown -->
                                <tr v-if="expandedBreakdownRows[s.id]" class="bg-sky-50/40 border-b border-line text-[11px]">
                                    <td colspan="9" class="p-4">
                                        <div class="rounded-xl border border-sky-200 bg-white p-3 space-y-3">
                                            <!-- Formula Row -->
                                            <div class="rounded-lg bg-page p-2.5 border border-line flex flex-wrap items-center justify-between gap-2">
                                                <div>
                                                    <span class="text-[10px] font-bold uppercase tracking-wider text-muted block">Calculation Breakdown Formula:</span>
                                                    <p class="font-mono text-xs text-navy mt-0.5">
                                                        Credited Hours (<strong>{{ Number(s.creditedHours).toFixed(1) }}h</strong>) × Rate (<strong>₱{{ Number(s.hourlyRate).toFixed(2) }}</strong>) = Gross: <strong>₱{{ formatMoney(s.grossAllowance) }}</strong>
                                                        <span v-if="s.deductionFromAllowance > 0"> − Authorized Deduction (<strong>₱{{ formatMoney(s.deductionFromAllowance) }}</strong>)</span>
                                                        = Net Payable: <strong class="text-emerald-700">₱{{ formatMoney(s.netAllowance) }}</strong>
                                                        <span v-if="s.breakDeduction > 0" class="block font-sans text-[10px] text-amber-700 font-medium mt-0.5">
                                                            (Includes <strong>-{{ Number(s.breakDeduction).toFixed(1) }}h</strong> automatic unpaid meal break deduction across qualifying duty days)
                                                        </span>
                                                    </p>
                                                </div>
                                                <div class="text-right text-[11px]">
                                                    <span class="text-muted block">School Balance: <strong>₱{{ formatMoney(s.schoolBalanceBefore) }}</strong></span>
                                                    <span class="text-muted block">Remaining Due: <strong class="text-navy">₱{{ formatMoney(s.expectedBalanceAfter) }}</strong></span>
                                                </div>
                                            </div>

                                            <!-- Duty Punch Records Table (if any) -->
                                            <div>
                                                <span class="text-[10px] font-bold uppercase tracking-wider text-muted block mb-1">
                                                    Recorded Attendance Duty Logs in this Cutoff:
                                                </span>
                                                <div v-if="!s.dutyLogs?.length" class="p-2 text-center text-[10px] text-muted italic bg-page rounded border border-line">
                                                    No specific punch logs recorded for {{ s.name }} within this cutoff date range.
                                                </div>
                                                <div v-else class="overflow-x-auto rounded border border-line">
                                                    <table class="w-full text-left text-[10px]">
                                                        <thead class="bg-page text-muted uppercase font-semibold">
                                                            <tr>
                                                                <th class="px-2 py-1">Duty Date</th>
                                                                <th class="px-2 py-1">Scheduled</th>
                                                                <th class="px-2 py-1">Time In</th>
                                                                <th class="px-2 py-1">Time Out</th>
                                                                <th class="px-2 py-1 text-center">Recorded</th>
                                                                <th class="px-2 py-1 text-center">Break Ded.</th>
                                                                <th class="px-2 py-1 text-center">Credited</th>
                                                                <th class="px-2 py-1 text-center">Late</th>
                                                                <th class="px-2 py-1 text-center">Undertime</th>
                                                                <th class="px-2 py-1 text-center">OT</th>
                                                                <th class="px-2 py-1">Status</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody class="divide-y divide-line">
                                                            <tr v-for="log in s.dutyLogs" :key="log.id">
                                                                <td class="px-2 py-1 font-semibold text-ink">{{ log.duty_date }}</td>
                                                                <td class="px-2 py-1 text-muted">{{ log.scheduled_start || '—' }} to {{ log.scheduled_end || '—' }}</td>
                                                                <td class="px-2 py-1 font-mono text-ink">{{ log.actual_time_in || 'MISSING' }}</td>
                                                                <td class="px-2 py-1 font-mono text-ink">{{ log.actual_time_out || 'MISSING' }}</td>
                                                                <td class="px-2 py-1 text-center">{{ Number(log.recorded_hours || 0).toFixed(1) }}h</td>
                                                                <td class="px-2 py-1 text-center font-medium" :class="Number(log.break_deduction || 0) > 0 ? 'text-amber-700' : 'text-muted'">
                                                                    {{ Number(log.break_deduction || 0) > 0 ? ('-' + Number(log.break_deduction).toFixed(1) + 'h') : '—' }}
                                                                </td>
                                                                <td class="px-2 py-1 text-center font-bold text-sky-800">{{ Number(log.credited_hours || 0).toFixed(1) }}h</td>
                                                                <td class="px-2 py-1 text-center" :class="log.late_minutes > 0 ? 'text-amber-700 font-bold' : 'text-muted'">{{ log.late_minutes || 0 }}m</td>
                                                                <td class="px-2 py-1 text-center" :class="log.undertime_minutes > 0 ? 'text-amber-700 font-bold' : 'text-muted'">{{ log.undertime_minutes || 0 }}m</td>
                                                                <td class="px-2 py-1 text-center text-purple-700 font-semibold">{{ Number(log.overtime_hours || 0).toFixed(1) }}h</td>
                                                                <td class="px-2 py-1">
                                                                    <span class="rounded px-1.5 py-0.2 text-[9px] font-bold"
                                                                          :class="log.status === 'PRESENT' ? 'bg-emerald-100 text-emerald-800' : (log.status === 'ABSENT' ? 'bg-danger/10 text-danger' : 'bg-amber-100 text-amber-800')">
                                                                        {{ log.status }}
                                                                    </span>
                                                                </td>
                                                            </tr>
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        </div>
                                    </td>
                                </tr>
                            </template>
                        </tbody>
                    </table>
                </div>

                <!-- Printable Document Slip: Computation Summary & Explanations -->
                <div id="printable-computation-breakdown" class="hidden border border-line rounded-xl bg-white p-6 shadow-sm text-ink">
                    <!-- Letterhead -->
                    <div class="text-center border-b pb-4 mb-4">
                        <h3 class="text-sm font-bold tracking-wider text-ink uppercase">National College of Science and Technology</h3>
                        <h4 class="text-xs font-semibold text-muted">Office of Student Affairs &amp; Services · Student Assistant Program</h4>
                        <h2 class="text-base font-bold text-navy mt-2">STUDENT ASSISTANT ALLOWANCE COMPUTATION BREAKDOWN REPORT</h2>
                        <p class="text-xs text-muted mt-1">
                            Cutoff Period: <strong>{{ activeCutoff?.cutoff_name }}</strong> ({{ formatDateRange(activeCutoff?.start_date, activeCutoff?.end_date) }}) · Semester: {{ semester ? semester.label : '' }}
                        </p>
                        <div class="mt-1.5 flex items-center justify-center gap-3 text-[10px]">
                            <span class="font-mono text-muted">Reference: {{ activeCutoff?.endorsement_ref || 'DRAFT-CUTOFF' }}</span>
                            <span class="font-bold" :class="isReadOnly ? 'text-emerald-800' : 'text-amber-800'">
                                Status: {{ getCutoffBadgeLabel(activeCutoff?.status) }}
                            </span>
                        </div>
                    </div>

                    <!-- Printable Table with Explanations -->
                    <table class="w-full text-left text-[10px] mb-6 border-collapse">
                        <thead class="border-b-2 border-ink font-bold text-ink">
                            <tr>
                                <th class="py-2">Student ID</th>
                                <th class="py-2">Student Assistant</th>
                                <th class="py-2">Department</th>
                                <th class="py-2 text-center">Credited</th>
                                <th class="py-2 text-right">Rate</th>
                                <th class="py-2 text-right">Gross</th>
                                <th class="py-2 text-right">Deduction</th>
                                <th class="py-2 text-right">Net</th>
                                <th class="py-2">Policy Reasons &amp; Explanations</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-line/60">
                            <tr v-for="s in breakdownData.items" :key="s.id">
                                <td class="py-1 font-mono text-muted">{{ s.studentId }}</td>
                                <td class="py-1 font-semibold text-ink">{{ s.name }}</td>
                                <td class="py-1">{{ s.department }}</td>
                                <td class="py-1 text-center font-bold">{{ Number(s.creditedHours || 0).toFixed(1) }}h</td>
                                <td class="py-1 text-right">₱{{ Number(s.hourlyRate).toFixed(2) }}</td>
                                <td class="py-1 text-right font-semibold">₱{{ formatMoney(s.grossAllowance) }}</td>
                                <td class="py-1 text-right text-amber-800">{{ s.deductionFromAllowance > 0 ? '−₱' + formatMoney(s.deductionFromAllowance) : '—' }}</td>
                                <td class="py-1 text-right font-bold text-emerald-800">₱{{ formatMoney(s.netAllowance) }}</td>
                                <td class="py-1 text-[9px] text-muted">{{ s.explanations?.join('; ') || 'Verified duty hours' }}</td>
                            </tr>
                        </tbody>
                        <tfoot class="border-t-2 border-ink font-bold">
                            <tr>
                                <td colspan="3" class="py-2">Totals ({{ breakdownData.totals.totalSas }} S.A.s):</td>
                                <td class="py-2 text-center">{{ Number(breakdownData.totals.totalCreditedHours || 0).toFixed(1) }}h</td>
                                <td class="py-2"></td>
                                <td class="py-2 text-right">₱{{ formatMoney(breakdownData.totals.totalGrossAllowance) }}</td>
                                <td class="py-2 text-right text-amber-800">−₱{{ formatMoney(breakdownData.totals.totalProposedDeductions) }}</td>
                                <td class="py-2 text-right text-emerald-800 text-[11px]">₱{{ formatMoney(breakdownData.totals.totalNetAllowance) }}</td>
                                <td class="py-2 text-[9px] text-muted">{{ breakdownData.totals.discrepancyCount }} discrepancies noted</td>
                            </tr>
                        </tfoot>
                    </table>

                    <!-- Signatures -->
                    <div class="grid grid-cols-2 gap-8 pt-6 border-t border-line text-xs">
                        <div>
                            <p class="font-semibold text-muted">Computed &amp; Reconciled By:</p>
                            <div class="mt-8 border-b border-ink/60 w-56"></div>
                            <p class="font-bold text-ink mt-1.5 text-xs uppercase tracking-wide">{{ displayCoordinatorName }}</p>
                            <p class="text-[11px] font-medium text-ink">Student Assistant Coordinator</p>
                        </div>
                        <div class="text-right">
                            <p class="font-semibold text-muted">Audited &amp; Noted By:</p>
                            <div class="mt-8 border-b border-ink/60 w-56 ml-auto"></div>
                            <p class="font-bold text-ink mt-1.5 text-xs">HR Manager</p>
                            <p class="text-[11px] text-muted">Human Resource Office</p>
                        </div>
                    </div>
                </div>
            </template>

            <div v-else class="py-14 text-center text-muted">
                <app-icon name="AlertCircle" :size="28" class="mx-auto text-amber-500 mb-2" />
                <p class="text-body font-medium text-ink">No allowance billing breakdown available</p>
                <p class="text-caption text-muted mt-1">Attendance records could not be loaded for this cutoff.</p>
                <button type="button" @click="openComputationBreakdown" class="btn btn-secondary btn-sm mt-3">Try again</button>
            </div>
        </div>
        <template #footer>
            <button @click="computationModal = false" class="btn btn-secondary">Close</button>
            <button v-if="!isReadOnly" type="button" @click="recomputeFromModal" :disabled="computingCutoff"
                    class="btn btn-secondary inline-flex items-center gap-1.5 bg-white text-navy border-navy"
                    title="Re-evaluate punches and save computation snapshot">
                <app-icon :name="computingCutoff ? 'LoaderCircle' : 'RefreshCw'" :size="15" :class="computingCutoff ? 'animate-spin' : ''" />
                <span>{{ computingCutoff ? 'Computing…' : 'Recompute & Save Snapshot' }}</span>
            </button>
            <button type="button" @click="printComputationSummary" class="btn btn-primary inline-flex items-center gap-1.5">
                <app-icon name="Printer" :size="16" /> Print Computation Summary
            </button>
        </template>
    </app-modal>

    <!-- ------------------------------------------------ Modal: Dedicated S.A. Allowance Deduction Billing Spreadsheet -->
    <app-modal :open="deductionModal" :title="deductionListData?.billingTitle || ('S.A. Allowance Deduction Billing — ' + (semester?.label || '1st Semester AY 2026–2027'))"
               icon="FileSpreadsheet" tone="navy" size="xl" @close="deductionModal = false"
               :description="'Official School-Balance Allowance Deduction Billing · Cutoff: ' + (activeCutoff?.cutoff_name || '') + ' (' + formatDateRange(activeCutoff?.start_date, activeCutoff?.end_date) + ')'">
        <div class="space-y-4">
            <div v-if="loadingDeductionList" class="py-14 text-center text-muted">
                <app-icon name="LoaderCircle" :size="28" class="animate-spin mx-auto text-navy" />
                <p class="mt-2 text-body font-medium text-ink">Loading S.A. Billing spreadsheet records...</p>
                <p class="text-caption text-muted">Matching active YES deduction authorizations against school balances.</p>
            </div>

            <template v-else-if="deductionListData">
                <!-- Summary KPI Cards -->
                <div class="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
                    <div class="rounded-xl border border-line bg-page p-2.5">
                        <span class="text-[10px] font-semibold uppercase text-muted">Authorized S.A.s</span>
                        <p class="text-h4 font-bold text-ink mt-0.5">{{ deductionListData.summary.totalEligible }}</p>
                        <span class="text-[10px] text-muted">Explicit YES Auth</span>
                    </div>
                    <div class="rounded-xl border border-line bg-page p-2.5">
                        <span class="text-[10px] font-semibold uppercase text-muted">Student Due Before</span>
                        <p class="text-h4 font-bold text-ink mt-0.5">₱{{ formatMoney(deductionListData.summary.totalStudentDueBefore) }}</p>
                        <span class="text-[10px] text-muted">Unpaid balance</span>
                    </div>
                    <div class="rounded-xl border border-amber-300 bg-amber-50/70 p-2.5">
                        <span class="text-[10px] font-semibold uppercase text-amber-900">Cutoff Deduction</span>
                        <p class="text-h4 font-bold text-amber-800 mt-0.5">−₱{{ formatMoney(deductionListData.summary.totalDeductionFromAllowance) }}</p>
                        <span class="text-[10px] text-amber-700">Deduction from allowance</span>
                    </div>
                    <div class="rounded-xl border border-line bg-page p-2.5">
                        <span class="text-[10px] font-semibold uppercase text-muted">Total Cumulative Deducted</span>
                        <p class="text-h4 font-bold text-slate-800 mt-0.5">₱{{ formatMoney(deductionListData.summary.totalCumulativeDeducted) }}</p>
                        <span class="text-[10px] text-muted">Prior confirmed cutoffs</span>
                    </div>
                    <div class="rounded-xl border border-sky-300 bg-sky-50/70 p-2.5">
                        <span class="text-[10px] font-semibold uppercase text-navy">Remaining Balance</span>
                        <p class="text-h4 font-bold text-navy mt-0.5">₱{{ formatMoney(deductionListData.summary.totalRemainingBalance) }}</p>
                        <span class="text-[10px] text-sky-800">Due after this cutoff</span>
                    </div>
                </div>

                <!-- Official 9-Column S.A. Billing Table -->
                <div class="overflow-x-auto rounded-xl border border-line bg-white shadow-xs">
                    <table class="w-full text-left text-[11px]">
                        <thead class="bg-navy text-white text-[10px] font-bold uppercase tracking-wider">
                            <tr>
                                <th class="px-2.5 py-2.5 text-center">No.</th>
                                <th class="px-3 py-2.5">Student Number</th>
                                <th class="px-3 py-2.5">Name</th>
                                <th class="px-3 py-2.5 text-right">Authorized Deduction / School Balance</th>
                                <th class="px-3 py-2.5 text-right">Student Due Before Deduction</th>
                                <th class="px-3 py-2.5 text-right">Deduction from Allowance</th>
                                <th class="px-3 py-2.5 text-right">Total Amount Deducted</th>
                                <th class="px-3 py-2.5 text-right">Remaining Balance</th>
                                <th class="px-3 py-2.5 text-center">Deduction Status</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-line">
                            <tr v-if="!deductionListData.activeDeductions.length">
                                <td colspan="9" class="p-6 text-center text-xs text-muted">
                                    No active Student Assistants with YES deduction authorization and payable allowance in this cutoff period.
                                </td>
                            </tr>
                            <tr v-for="d in deductionListData.activeDeductions" :key="d.student_number" class="hover:bg-mist/30 transition-colors">
                                <td class="px-2.5 py-2.5 text-center font-bold text-muted">{{ d.no }}</td>
                                <td class="px-3 py-2.5 font-mono text-navy font-semibold">{{ d.student_number }}</td>
                                <td class="px-3 py-2.5">
                                    <span class="font-bold text-ink block">{{ d.name }}</span>
                                    <span v-if="d.course" class="text-[10px] text-muted">{{ d.course }} · {{ d.department }}</span>
                                </td>
                                <td class="px-3 py-2.5 text-right font-medium text-ink">₱{{ formatMoney(d.authorized_deduction) }}</td>
                                <td class="px-3 py-2.5 text-right font-medium text-amber-800">₱{{ formatMoney(d.student_due_before) }}</td>
                                <td class="px-3 py-2.5 text-right font-bold text-danger">−₱{{ formatMoney(d.deduction_from_allowance) }}</td>
                                <td class="px-3 py-2.5 text-right font-medium text-slate-700">₱{{ formatMoney(d.total_amount_deducted) }}</td>
                                <td class="px-3 py-2.5 text-right font-bold text-navy">₱{{ formatMoney(d.remaining_balance) }}</td>
                                <td class="px-3 py-2.5 text-center whitespace-nowrap">
                                    <span class="rounded-full px-2.5 py-0.5 text-[10px] font-bold border"
                                          :class="d.remaining_balance <= 0 ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : 'bg-sky-100 text-sky-800 border-sky-300'">
                                        {{ d.deduction_status }}
                                    </span>
                                </td>
                            </tr>
                        </tbody>
                        <tfoot class="border-t-2 border-navy bg-slate-100 font-bold text-[11px] text-ink">
                            <tr>
                                <td colspan="3" class="px-3 py-2.5 text-navy">
                                    Total for {{ deductionListData.summary.totalEligible }} Authorized S.A.(s):
                                </td>
                                <td class="px-3 py-2.5 text-right">₱{{ formatMoney(deductionListData.summary.totalAuthorized) }}</td>
                                <td class="px-3 py-2.5 text-right text-amber-800">₱{{ formatMoney(deductionListData.summary.totalStudentDueBefore) }}</td>
                                <td class="px-3 py-2.5 text-right text-danger">−₱{{ formatMoney(deductionListData.summary.totalDeductionFromAllowance) }}</td>
                                <td class="px-3 py-2.5 text-right text-slate-700">₱{{ formatMoney(deductionListData.summary.totalCumulativeDeducted) }}</td>
                                <td class="px-3 py-2.5 text-right text-navy">₱{{ formatMoney(deductionListData.summary.totalRemainingBalance) }}</td>
                                <td class="px-3 py-2.5 text-center text-emerald-800">Active</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                <!-- Section B: Withheld (₱0 Allowance) S.A.s -->
                <div v-if="deductionListData.excludedNoAllowance?.length" class="mt-4">
                    <span class="text-[11px] font-bold uppercase tracking-wider text-muted block mb-1">
                        Withheld Deductions (Explicit YES Authorization but ₱0.00 Payable Allowance in this Cutoff — Balance Intact)
                    </span>
                    <div class="overflow-x-auto rounded-lg border border-line bg-page/40">
                        <table class="w-full text-left text-[10px]">
                            <thead class="bg-page text-muted uppercase font-semibold">
                                <tr>
                                    <th class="px-3 py-1.5 text-center">No.</th>
                                    <th class="px-3 py-1.5">Student Number</th>
                                    <th class="px-3 py-1.5">Name</th>
                                    <th class="px-3 py-1.5">Department</th>
                                    <th class="px-3 py-1.5 text-right">Current Balance</th>
                                    <th class="px-3 py-1.5">Reason / Policy Note</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-line">
                                <tr v-for="ex in deductionListData.excludedNoAllowance" :key="ex.student_number">
                                    <td class="px-3 py-1 text-center font-bold text-muted">{{ ex.no }}</td>
                                    <td class="px-3 py-1 font-mono text-muted">{{ ex.student_number }}</td>
                                    <td class="px-3 py-1 font-semibold text-ink">{{ ex.name }}</td>
                                    <td class="px-3 py-1">{{ ex.department }}</td>
                                    <td class="px-3 py-1 text-right font-medium text-amber-800">₱{{ formatMoney(ex.student_due_before) }}</td>
                                    <td class="px-3 py-1 text-muted italic">₱0.00 payable allowance in this cutoff. Deduction withheld; balance remains intact.</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Printable Document: Official S.A. BILLING Spreadsheet -->
                <div id="printable-deduction-billing" class="hidden border border-line rounded-xl bg-white p-6 shadow-sm text-ink">
                    <!-- Slip Header -->
                    <div class="text-center border-b pb-4 mb-4">
                        <h3 class="text-sm font-bold tracking-wider text-ink uppercase">National College of Science and Technology</h3>
                        <h4 class="text-xs font-semibold text-muted">Office of the Student Assistant Coordinator · Accounting Department</h4>
                        <h2 class="text-base font-bold text-navy mt-2">{{ deductionListData.billingTitle }}</h2>
                        <p class="text-xs text-muted mt-1">
                            Cutoff Period: <strong>{{ activeCutoff?.cutoff_name }}</strong> ({{ formatDateRange(activeCutoff?.start_date, activeCutoff?.end_date) }}) · Academic Year / Semester: {{ semester ? semester.label : '' }}
                        </p>
                        <p class="text-[10px] font-mono text-muted mt-0.5">
                            Reference: {{ activeCutoff?.endorsement_ref || 'DRAFT-CUTOFF' }} · Status: {{ getCutoffBadgeLabel(activeCutoff?.status) }}
                        </p>
                    </div>

                    <!-- Printable 9-Column Table -->
                    <table class="w-full text-left text-[10px] mb-6 border-collapse">
                        <thead class="border-b-2 border-ink font-bold text-ink">
                            <tr>
                                <th class="py-2 text-center">No.</th>
                                <th class="py-2">Student Number</th>
                                <th class="py-2">Name</th>
                                <th class="py-2 text-right">Authorized School Balance</th>
                                <th class="py-2 text-right">Student Due Before Deduction</th>
                                <th class="py-2 text-right">Deduction from Allowance</th>
                                <th class="py-2 text-right">Total Amount Deducted</th>
                                <th class="py-2 text-right">Remaining Balance</th>
                                <th class="py-2 text-center">Deduction Status</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-line/60">
                            <tr v-for="d in deductionListData.activeDeductions" :key="d.student_number">
                                <td class="py-1 text-center text-muted font-bold">{{ d.no }}</td>
                                <td class="py-1 font-mono text-muted">{{ d.student_number }}</td>
                                <td class="py-1 font-semibold text-ink">{{ d.name }}</td>
                                <td class="py-1 text-right">₱{{ formatMoney(d.authorized_deduction) }}</td>
                                <td class="py-1 text-right text-amber-800">₱{{ formatMoney(d.student_due_before) }}</td>
                                <td class="py-1 text-right font-bold text-danger">−₱{{ formatMoney(d.deduction_from_allowance) }}</td>
                                <td class="py-1 text-right text-slate-700">₱{{ formatMoney(d.total_amount_deducted) }}</td>
                                <td class="py-1 text-right font-bold text-ink">₱{{ formatMoney(d.remaining_balance) }}</td>
                                <td class="py-1 text-center font-semibold">{{ d.deduction_status }}</td>
                            </tr>
                        </tbody>
                        <tfoot class="border-t-2 border-ink font-bold">
                            <tr>
                                <td colspan="3" class="py-2">Total for {{ deductionListData.summary.totalEligible }} Student Assistants:</td>
                                <td class="py-2 text-right">₱{{ formatMoney(deductionListData.summary.totalAuthorized) }}</td>
                                <td class="py-2 text-right text-amber-800">₱{{ formatMoney(deductionListData.summary.totalStudentDueBefore) }}</td>
                                <td class="py-2 text-right text-danger">−₱{{ formatMoney(deductionListData.summary.totalDeductionFromAllowance) }}</td>
                                <td class="py-2 text-right text-slate-700">₱{{ formatMoney(deductionListData.summary.totalCumulativeDeducted) }}</td>
                                <td class="py-2 text-right text-emerald-800 text-[11px]">₱{{ formatMoney(deductionListData.summary.totalRemainingBalance) }}</td>
                                <td class="py-2 text-center text-emerald-800">Verified</td>
                            </tr>
                        </tfoot>
                    </table>

                    <!-- Signatures Block: 3 Parties (Coordinator, HR, Accounting) -->
                    <div class="grid grid-cols-3 gap-6 pt-6 border-t border-line text-xs">
                        <div>
                            <p class="font-semibold text-muted">Prepared &amp; Endorsed By:</p>
                            <div class="mt-8 border-b border-ink/60 w-44"></div>
                            <p class="font-bold text-ink mt-1.5 text-xs uppercase tracking-wide">{{ displayCoordinatorName }}</p>
                            <p class="text-[11px] font-medium text-ink">Student Assistant Coordinator</p>
                        </div>
                        <div>
                            <p class="font-semibold text-muted">Noted &amp; Approved By:</p>
                            <div class="mt-8 border-b border-ink/60 w-44"></div>
                            <p class="font-bold text-ink mt-1.5 text-xs">HR Manager</p>
                            <p class="text-[11px] text-muted">Human Resource Office</p>
                        </div>
                        <div>
                            <p class="font-semibold text-muted">Received &amp; Processed By:</p>
                            <div class="mt-8 border-b border-ink/60 w-44"></div>
                            <p class="font-bold text-ink mt-1.5 text-xs">Accounting Office / Cashier</p>
                            <p class="text-[11px] text-muted">Date Received &amp; Processed</p>
                        </div>
                    </div>
                </div>
            </template>

            <div v-else class="py-14 text-center text-muted">
                <app-icon name="AlertCircle" :size="28" class="mx-auto text-amber-500 mb-2" />
                <p class="text-body font-medium text-ink">No deduction billing records available</p>
                <p class="text-caption text-muted mt-1">Deduction records could not be loaded for this cutoff.</p>
                <button type="button" @click="openDeductionListModal" class="btn btn-secondary btn-sm mt-3">Try again</button>
            </div>
        </div>
        <template #footer>
            <button @click="deductionModal = false" class="btn btn-secondary">Close</button>
            <button type="button" @click="printDeductionBilling" class="btn btn-primary inline-flex items-center gap-1.5">
                <app-icon name="Printer" :size="16" /> Print S.A. Billing Report
            </button>
        </template>
    </app-modal>

    <!-- ------------------------------------------------ Modal: Allowance Settlement Confirmation -->
    <app-modal :open="settleModal" title="Confirm Allowance Settlement"
               icon="BadgeCheck" tone="emerald" size="lg" @close="settleModal = false"
               :description="'Finalize and archive cutoff: ' + (activeCutoff?.cutoff_name || '')">
        <div class="space-y-4">
            <!-- Cutoff Financial Summary Strip -->
            <div class="rounded-xl border border-emerald-200 bg-emerald-50/70 p-3.5">
                <span class="text-[11px] font-bold uppercase tracking-wider text-emerald-900">Settlement Period &amp; Financial Totals</span>
                <div class="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div class="rounded-lg bg-white p-2 border border-emerald-100">
                        <span class="text-[10px] uppercase text-muted font-semibold">Cutoff Period</span>
                        <p class="text-xs font-bold text-ink mt-0.5 truncate">{{ activeCutoff?.cutoff_name }}</p>
                        <span class="text-[10px] text-muted">{{ formatDateRange(activeCutoff?.start_date, activeCutoff?.end_date) }}</span>
                    </div>
                    <div class="rounded-lg bg-white p-2 border border-emerald-100">
                        <span class="text-[10px] uppercase text-muted font-semibold">Student Assistants</span>
                        <p class="text-xs font-bold text-ink mt-0.5">{{ items.length }} S.A.s</p>
                        <span class="text-[10px] text-muted">{{ stats.cutoffCreditedHours || 0 }} credited hrs</span>
                    </div>
                    <div class="rounded-lg bg-white p-2 border border-emerald-100">
                        <span class="text-[10px] uppercase text-muted font-semibold">Gross Allowance</span>
                        <p class="text-xs font-bold text-ink mt-0.5">₱{{ formatMoney(stats.cutoffPayableAllowance) }}</p>
                        <span class="text-[10px] text-amber-800">− ₱{{ formatMoney(stats.cutoffProposedDeductions) }} ded.</span>
                    </div>
                    <div class="rounded-lg bg-white p-2 border border-emerald-100">
                        <span class="text-[10px] uppercase text-muted font-semibold">Net Disbursed</span>
                        <p class="text-xs font-bold text-emerald-700 mt-0.5">₱{{ formatMoney(stats.cutoffNetAllowance) }}</p>
                        <span class="text-[10px] text-muted">Paid to S.A.s</span>
                    </div>
                </div>
            </div>

            <!-- Settlement Requirements Verification Checklist -->
            <div class="rounded-xl border border-line bg-page p-3.5">
                <span class="text-[11px] font-bold uppercase tracking-wider text-muted">Requirements Verification Checklist</span>
                <div class="mt-2.5 space-y-2 text-xs">
                    <div class="flex items-center gap-2 p-2 rounded-lg bg-white border border-line">
                        <app-icon :name="(activeCutoff?.dateClassification || getDateClassification(activeCutoff)) === 'PREVIOUS CUT-OFF' ? 'CheckCircle2' : 'AlertCircle'" :size="16"
                                  :class="(activeCutoff?.dateClassification || getDateClassification(activeCutoff)) === 'PREVIOUS CUT-OFF' ? 'text-emerald-600' : 'text-amber-500'" />
                        <div class="flex-1">
                            <span class="font-bold text-ink">1. Cutoff has concluded (PREVIOUS CUT-OFF)</span>
                            <p class="text-[11px] text-muted">Ended on {{ formatDateRange(activeCutoff?.end_date, activeCutoff?.end_date) }}</p>
                        </div>
                        <span class="badge" :class="(activeCutoff?.dateClassification || getDateClassification(activeCutoff)) === 'PREVIOUS CUT-OFF' ? 'badge-success' : 'badge-warning'">
                            {{ (activeCutoff?.dateClassification || getDateClassification(activeCutoff)) === 'PREVIOUS CUT-OFF' ? 'Satisfied' : 'Pending Period End' }}
                        </span>
                    </div>

                    <div class="flex items-center gap-2 p-2 rounded-lg bg-white border border-line">
                        <app-icon :name="isCutoffEndorsed ? 'CheckCircle2' : 'AlertCircle'" :size="16"
                                  :class="isCutoffEndorsed ? 'text-emerald-600' : 'text-amber-500'" />
                        <div class="flex-1">
                            <span class="font-bold text-ink">2. Billing endorsed to Accounting</span>
                            <p class="text-[11px] text-muted">Ref: {{ activeCutoff?.endorsement_ref || 'Pending Official Endorsement' }}</p>
                        </div>
                        <span class="badge" :class="isCutoffEndorsed ? 'badge-success' : 'badge-warning'">
                            {{ isCutoffEndorsed ? 'Endorsed' : 'Pending' }}
                        </span>
                    </div>

                    <div class="flex items-center gap-2 p-2 rounded-lg bg-white border border-line">
                        <app-icon name="CheckCircle2" :size="16" class="text-emerald-600" />
                        <div class="flex-1">
                            <span class="font-bold text-ink">3. Authorized deductions endorsed</span>
                            <p class="text-[11px] text-muted">Transmitted to Accounting Office along with billing statement</p>
                        </div>
                        <span class="badge badge-success">Verified</span>
                    </div>

                    <div class="flex items-center gap-2 p-2 rounded-lg bg-white border border-line">
                        <app-icon name="CheckCircle2" :size="16" class="text-emerald-600" />
                        <div class="flex-1">
                            <span class="font-bold text-ink">4. Allowance distribution completed</span>
                            <p class="text-[11px] text-muted">Cashier / payroll disbursement matches payable net allowance</p>
                        </div>
                        <span class="badge badge-success">Confirmed</span>
                    </div>

                    <div class="flex items-center gap-2 p-2 rounded-lg bg-white border border-line">
                        <app-icon name="CheckCircle2" :size="16" class="text-emerald-600" />
                        <div class="flex-1">
                            <span class="font-bold text-ink">5. No blocking financial exceptions</span>
                            <p class="text-[11px] text-muted">All {{ items.length }} student records audited and synchronized</p>
                        </div>
                        <span class="badge badge-success">Clean</span>
                    </div>
                </div>
            </div>

            <!-- Settlement Remarks / Notes -->
            <div>
                <label class="block text-xs font-semibold text-navy mb-1">Coordinator Settlement Notes / Disbursement References</label>
                <textarea v-model="settleRemarks" rows="2" class="input text-xs"
                          placeholder="Enter disbursement confirmation notes, cashier voucher references, or settlement remarks..."></textarea>
            </div>

            <!-- Confirmation Checkbox -->
            <label class="flex items-start gap-2.5 p-3 rounded-xl border border-amber-300 bg-amber-50/60 cursor-pointer select-none">
                <input type="checkbox" v-model="settleConfirmed" class="mt-0.5 rounded text-navy focus:ring-navy h-4 w-4" />
                <span class="text-xs text-amber-950">
                    <strong>I hereby confirm</strong> that allowance distribution for <strong>{{ activeCutoff?.cutoff_name }}</strong> has been fully completed and verified with Accounting/Cashier. I understand that finalizing settlement will permanently lock this cutoff period.
                </span>
            </label>
        </div>

        <template #footer>
            <button @click="settleModal = false" class="btn btn-secondary">Cancel</button>
            <button type="button" @click="submitSettlement" :disabled="!settleConfirmed || savingSettle || !isSettlementEligible"
                    class="btn btn-primary inline-flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600 disabled:opacity-50">
                <app-icon :name="savingSettle ? 'LoaderCircle' : 'BadgeCheck'" :size="16" :class="savingSettle ? 'animate-spin' : ''" />
                <span>{{ savingSettle ? 'Settling…' : 'Confirm & Mark Allowance Settled' }}</span>
            </button>
        </template>
    </app-modal>

    <!-- ------------------------------------------------ Modal: Accounting Endorsement & Deduction Reports -->
    <app-modal :open="endorseModal" title="Accounting Endorsement &amp; Deduction Reports"
               icon="FileCheck" tone="navy" size="xl" @close="endorseModal = false"
               :description="'Official cut-off billing summary and school-balance deduction endorsement for ' + (activeCutoff?.cutoff_name || periodLabel)">
        <div class="space-y-4">
            <!-- Tabs Navigation -->
            <div class="flex border-b border-line bg-page/70 rounded-t-xl px-2 pt-2 gap-1">
                <button type="button" @click="setEndorseTab('ALLOWANCE')"
                        class="flex items-center gap-1.5 border-b-2 px-4 py-2 text-xs font-bold transition-colors"
                        :class="endorseModalTab === 'ALLOWANCE' ? 'border-navy text-navy bg-white rounded-t-lg shadow-xs' : 'border-transparent text-muted hover:text-ink'">
                    <app-icon name="FileCheck" :size="14" />
                    Allowance Endorsement &amp; Billing Report
                </button>
                <button type="button" @click="setEndorseTab('DEDUCTION')"
                        class="flex items-center gap-1.5 border-b-2 px-4 py-2 text-xs font-bold transition-colors"
                        :class="endorseModalTab === 'DEDUCTION' ? 'border-navy text-navy bg-white rounded-t-lg shadow-xs' : 'border-transparent text-muted hover:text-ink'">
                    <app-icon name="FileText" :size="14" />
                    School-Balance Deduction Endorsement List (Accounting)
                    <span v-if="deductionListData && deductionListData.activeDeductions"
                          class="rounded-full bg-gold px-1.5 py-0.2 text-[10px] font-bold text-navy">
                        {{ deductionListData.activeDeductions.length }}
                    </span>
                </button>
            </div>

            <!-- ============================== TAB 1: ALLOWANCE ENDORSEMENT REPORT ============================== -->
            <div v-if="endorseModalTab === 'ALLOWANCE'" class="space-y-4">
                <!-- Cutoff Summary Card -->
                <div class="rounded-xl border border-line bg-page p-3.5 shadow-sm">
                    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
                        <div>
                            <span class="text-[11px] font-bold uppercase tracking-wider text-muted">Allowance Billing Summary</span>
                            <h4 class="text-card-title text-navy font-bold">
                                {{ activeCutoff?.cutoff_name }} ({{ formatDateRange(activeCutoff?.start_date, activeCutoff?.end_date) }})
                            </h4>
                        </div>
                        <div>
                            <span v-if="isCutoffSettled"
                                  class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
                                <app-icon name="CheckCheck" :size="14" /> Allowance Settled
                            </span>
                            <span v-else-if="isCutoffEndorsed"
                                  class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800">
                                <app-icon name="CheckCheck" :size="14" /> Officially Endorsed
                            </span>
                            <span v-else
                                  class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
                                <app-icon name="Clock" :size="14" /> Ready for Accounting Endorsement
                            </span>
                        </div>
                    </div>

                    <div class="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                        <div class="rounded-lg bg-white p-2.5 border border-line">
                            <span class="text-[10px] font-semibold uppercase text-muted">Student Assistants</span>
                            <p class="text-h4 font-bold text-ink mt-0.5">{{ items.length }} S.A.s</p>
                        </div>
                        <div class="rounded-lg bg-white p-2.5 border border-line">
                            <span class="text-[10px] font-semibold uppercase text-muted">Finalized Credited</span>
                            <p class="text-h4 font-bold text-sky-800 mt-0.5">{{ Number(stats.cutoffCreditedHours || 0).toFixed(1) }} hrs</p>
                        </div>
                        <div class="rounded-lg bg-white p-2.5 border border-line">
                            <span class="text-[10px] font-semibold uppercase text-muted">Total Gross</span>
                            <p class="text-h4 font-bold text-ink mt-0.5">₱{{ formatMoney(stats.cutoffPayableAllowance) }}</p>
                        </div>
                        <div class="rounded-lg bg-white p-2.5 border border-line">
                            <span class="text-[10px] font-semibold uppercase text-muted">Net Allowance</span>
                            <p class="text-h4 font-bold text-emerald-700 mt-0.5">₱{{ formatMoney(stats.cutoffNetAllowance) }}</p>
                        </div>
                    </div>
                </div>

                <!-- Coordinator Endorsement Action Box (if not yet endorsed) -->
                <div v-if="!isCutoffEndorsed && !isCutoffSettled" class="rounded-xl border border-navy/20 bg-mist/40 p-4 space-y-3">
                    <span class="text-[11px] font-bold uppercase tracking-wider text-navy">Coordinator Official Endorsement</span>
                    <p class="text-xs text-muted">
                        Official endorsement transmits this cutoff computation and school-balance deduction list to the Accounting Office.
                    </p>

                    <!-- Prerequisites checklist -->
                    <div class="rounded-lg bg-white border border-line p-2.5 space-y-1.5 text-xs">
                        <div class="flex items-center justify-between">
                            <span class="flex items-center gap-1.5 text-ink">
                                <app-icon :name="activeCutoff?.end_date && (new Date().toISOString().slice(0, 10) >= activeCutoff.end_date) ? 'CheckCircle2' : 'AlertCircle'" :size="14"
                                          :class="activeCutoff?.end_date && (new Date().toISOString().slice(0, 10) >= activeCutoff.end_date) ? 'text-emerald-600' : 'text-amber-500'" />
                                Cutoff Period Ended ({{ activeCutoff?.end_date }})
                            </span>
                            <span class="text-[10px] font-bold" :class="activeCutoff?.end_date && (new Date().toISOString().slice(0, 10) >= activeCutoff.end_date) ? 'text-emerald-700' : 'text-amber-700'">
                                {{ activeCutoff?.end_date && (new Date().toISOString().slice(0, 10) >= activeCutoff.end_date) ? 'Satisfied' : 'Pending Period End' }}
                            </span>
                        </div>
                        <div class="flex items-center justify-between">
                            <span class="flex items-center gap-1.5 text-ink">
                                <app-icon name="CheckCircle2" :size="14" class="text-emerald-600" />
                                Computations Finalized ({{ items.length }} S.A.s, ₱{{ formatMoney(stats.cutoffPayableAllowance) }})
                            </span>
                            <span class="text-[10px] font-bold text-emerald-700">Verified</span>
                        </div>
                        <div class="flex items-center justify-between">
                            <span class="flex items-center gap-1.5 text-ink">
                                <app-icon :name="stats.discrepancyCount > 0 ? 'AlertCircle' : 'CheckCircle2'" :size="14"
                                          :class="stats.discrepancyCount > 0 ? 'text-amber-500' : 'text-emerald-600'" />
                                Attendance Discrepancies
                            </span>
                            <span class="text-[10px] font-bold" :class="stats.discrepancyCount > 0 ? 'text-amber-700' : 'text-emerald-700'">
                                {{ stats.discrepancyCount > 0 ? stats.discrepancyCount + ' Withheld' : 'Clean' }}
                            </span>
                        </div>
                    </div>

                    <div>
                        <textarea v-model="endorseRemarks" rows="2" class="input text-xs"
                                  placeholder="Enter coordinator endorsement remarks or certification notes (optional)..."></textarea>
                    </div>
                    <div class="flex items-center justify-between pt-1">
                        <span class="text-[11px] text-muted italic">Prepared &amp; Endorsed by: <strong>{{ displayCoordinatorName }}</strong></span>
                        <button type="button" @click="submitEndorsementToAccounting" :disabled="savingEndorse || (activeCutoff?.end_date && new Date().toISOString().slice(0, 10) < activeCutoff.end_date)"
                                class="btn btn-primary btn-sm inline-flex items-center gap-1.5 disabled:opacity-50">
                            <app-icon :name="savingEndorse ? 'LoaderCircle' : 'Send'" :size="14" :class="savingEndorse ? 'animate-spin' : ''" />
                            {{ savingEndorse ? 'Endorsing…' : 'Certify & Endorse to Accounting' }}
                        </button>
                    </div>
                </div>

                <!-- Endorsed Banner (if already endorsed) -->
                <div v-else class="rounded-xl border border-emerald-300 bg-emerald-50/70 p-3.5 text-xs text-emerald-900">
                    <div class="flex items-start gap-2.5">
                        <app-icon name="CheckCheck" :size="18" class="text-emerald-700 shrink-0 mt-0.5" />
                        <div>
                            <p class="font-bold text-emerald-800">This cutoff is officially endorsed to Accounting.</p>
                            <p class="mt-0.5 text-emerald-700">
                                Reference No: <strong>{{ activeCutoff.endorsement_ref }}</strong> · Endorsed by {{ displayCoordinatorName }}.
                            </p>
                            <p v-if="activeCutoff.remarks" class="mt-1 text-[11px] font-medium text-ink">
                                <span class="font-semibold text-emerald-800">Remarks:</span> {{ activeCutoff.remarks }}
                            </p>
                        </div>
                    </div>
                </div>

                <!-- Printable Document Slip: Allowance Endorsement Slip -->
                <div>
                    <div class="flex items-center justify-between mb-2">
                        <span class="text-xs font-bold text-navy uppercase tracking-wider flex items-center gap-1.5">
                            <app-icon name="FileText" :size="14" /> Printable Allowance Endorsement Slip Preview
                        </span>
                        <span class="text-[11px] text-muted">Ready for print or physical filing</span>
                    </div>

                    <div id="printable-endorsement" class="border border-line rounded-xl bg-white p-6 shadow-sm text-ink">
                        <!-- Slip Header -->
                        <div class="text-center border-b pb-4 mb-4">
                            <h3 class="text-sm font-bold tracking-wider text-ink uppercase">National College of Science and Technology</h3>
                            <h4 class="text-xs font-semibold text-muted">Office of Student Affairs &amp; Services · S.A. Program</h4>
                            <h2 class="text-base font-bold text-navy mt-2">STUDENT ASSISTANT ALLOWANCE BILLING &amp; ENDORSEMENT SLIP</h2>
                            <p class="text-xs text-muted mt-1">
                                Cutoff: <strong>{{ activeCutoff?.cutoff_name }}</strong> ({{ formatDateRange(activeCutoff?.start_date, activeCutoff?.end_date) }}) · Semester: {{ semester ? semester.label : '' }}
                            </p>
                            <div class="mt-1.5 flex items-center justify-center gap-3">
                                <span class="text-[10px] font-mono text-muted">Ref: {{ activeCutoff?.endorsement_ref || 'DRAFT-CUTOFF' }}</span>
                                <span class="rounded-full px-2.5 py-0.5 text-[10px] font-bold"
                                      :class="activeCutoff?.status === 'ENDORSED_TO_ACCOUNTING' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'">
                                    {{ activeCutoff?.status === 'ENDORSED_TO_ACCOUNTING' ? 'OFFICIALLY ENDORSED' : 'DRAFT / READY FOR ENDORSEMENT' }}
                                </span>
                            </div>
                        </div>

                        <!-- Printable Table -->
                        <div class="overflow-x-auto">
                            <table class="w-full text-left text-[11px] mb-6">
                                <thead class="border-b-2 border-ink font-bold text-ink">
                                    <tr>
                                        <th class="py-2">Student ID</th>
                                        <th class="py-2">Student Assistant Name</th>
                                        <th class="py-2">Department</th>
                                        <th class="py-2 text-center">Credited Hrs</th>
                                        <th class="py-2 text-right">Hourly Rate</th>
                                        <th class="py-2 text-right">Gross Allowance</th>
                                        <th class="py-2 text-right">School Deductions</th>
                                        <th class="py-2 text-right">Net Allowance</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-line/60">
                                    <tr v-for="s in filtered" :key="s.id">
                                        <td class="py-1.5 font-mono text-muted">{{ s.studentId }}</td>
                                        <td class="py-1.5 font-semibold text-ink">{{ s.name }}</td>
                                        <td class="py-1.5">{{ s.department || s.departmentType }}</td>
                                        <td class="py-1.5 text-center font-semibold">{{ Number(s.creditedHours || 0) > 0 ? Number(s.creditedHours).toFixed(1) : '0.0' }}</td>
                                        <td class="py-1.5 text-right">₱{{ Number(s.effectiveRate || s.hourlyRate || 8).toFixed(2) }}</td>
                                        <td class="py-1.5 text-right font-medium">₱{{ formatMoney(s.payableAllowance) }}</td>
                                        <td class="py-1.5 text-right text-amber-800">{{ s.proposedDeduction > 0 ? '− ₱' + formatMoney(s.proposedDeduction) : '—' }}</td>
                                        <td class="py-1.5 text-right font-bold text-ink">₱{{ formatMoney(s.netAllowance) }}</td>
                                    </tr>
                                </tbody>
                                <tfoot class="border-t-2 border-ink font-bold">
                                    <tr>
                                        <td colspan="3" class="py-2">Total for {{ filtered.length }} Student Assistants:</td>
                                        <td class="py-2 text-center">{{ filtered.reduce((a, b) => a + (Number(b.creditedHours) || 0), 0).toFixed(1) }}</td>
                                        <td class="py-2"></td>
                                        <td class="py-2 text-right">₱{{ formatMoney(filtered.reduce((a, b) => a + (Number(b.payableAllowance) || 0), 0)) }}</td>
                                        <td class="py-2 text-right text-amber-800">− ₱{{ formatMoney(filtered.reduce((a, b) => a + (Number(b.proposedDeduction) || 0), 0)) }}</td>
                                        <td class="py-2 text-right text-emerald-800 text-[12px]">₱{{ formatMoney(filtered.reduce((a, b) => a + (Number(b.netAllowance) || 0), 0)) }}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>

                        <!-- Signatures Block: S.A. Coordinator and HR Manager -->
                        <div class="grid grid-cols-2 gap-8 pt-6 border-t border-line text-xs">
                            <div>
                                <p class="font-semibold text-muted">Prepared &amp; Endorsed By:</p>
                                <div class="mt-8 border-b border-ink/60 w-56"></div>
                                <p class="font-bold text-ink mt-1.5 text-xs uppercase tracking-wide">{{ displayCoordinatorName }}</p>
                                <p class="text-[11px] font-medium text-ink">Student Assistant Coordinator</p>
                            </div>
                            <div class="text-right">
                                <p class="font-semibold text-muted">Noted &amp; Approved By:</p>
                                <div class="mt-8 border-b border-ink/60 w-56 ml-auto"></div>
                                <p class="font-bold text-ink mt-1.5 text-xs">HR Manager</p>
                                <p class="text-[11px] text-muted">Human Resource Office</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- ============================== TAB 2: DEDUCTION ENDORSEMENT LIST (ACCOUNTING) ============================== -->
            <div v-else class="space-y-4">
                <div v-if="loadingDeductionList" class="py-12 text-center text-muted">
                    <app-icon name="LoaderCircle" :size="24" class="animate-spin mx-auto text-navy" />
                    <p class="mt-2 text-caption">Loading deduction endorsement records...</p>
                </div>

                <template v-else-if="deductionListData">
                    <!-- Deduction Summary KPI Cards -->
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div class="rounded-xl border border-line bg-page p-3">
                            <span class="text-[10px] font-bold uppercase text-muted">Authorized S.A.s</span>
                            <p class="text-h3 font-bold text-ink mt-0.5">{{ deductionListData.summary.totalEligible }}</p>
                            <span class="text-[11px] text-muted">With payable allowance</span>
                        </div>
                        <div class="rounded-xl border border-line bg-page p-3">
                            <span class="text-[10px] font-bold uppercase text-muted">Gross Allowance</span>
                            <p class="text-h3 font-bold text-ink mt-0.5">₱{{ formatMoney(deductionListData.summary.totalGross) }}</p>
                            <span class="text-[11px] text-muted">Total for eligible S.A.s</span>
                        </div>
                        <div class="rounded-xl border border-amber-300 bg-amber-50/70 p-3">
                            <span class="text-[10px] font-bold uppercase text-amber-900">Total Deductions</span>
                            <p class="text-h3 font-bold text-amber-800 mt-0.5">₱{{ formatMoney(deductionListData.summary.totalProposedDeductions) }}</p>
                            <span class="text-[11px] text-amber-700">To credit to School Balance</span>
                        </div>
                        <div class="rounded-xl border border-line bg-page p-3">
                            <span class="text-[10px] font-bold uppercase text-muted">Remaining Balance</span>
                            <p class="text-h3 font-bold text-navy mt-0.5">₱{{ formatMoney(deductionListData.summary.totalRemainingBalance) }}</p>
                            <span class="text-[11px] text-muted">Expected balance after cutoff</span>
                        </div>
                    </div>

                    <!-- Printable Document: School-Balance Deduction Endorsement List -->
                    <div id="printable-deduction-endorsement" class="border border-line rounded-xl bg-white p-6 shadow-sm text-ink">
                        <!-- Slip Header -->
                        <div class="text-center border-b pb-4 mb-4">
                            <h3 class="text-sm font-bold tracking-wider text-ink uppercase">National College of Science and Technology</h3>
                            <h4 class="text-xs font-semibold text-muted">Office of the Student Assistant Coordinator</h4>
                            <h2 class="text-base font-bold text-navy mt-2">STUDENT ASSISTANT SCHOOL-BALANCE ALLOWANCE DEDUCTION ENDORSEMENT LIST</h2>
                            <p class="text-xs text-muted mt-1">
                                Endorsement to: <strong>Accounting Office / Cashier's Department</strong> · Cutoff: <strong>{{ activeCutoff?.cutoff_name }}</strong> ({{ formatDateRange(activeCutoff?.start_date, activeCutoff?.end_date) }})
                            </p>
                            <p class="text-[11px] font-mono text-muted mt-0.5">
                                Endorsement Ref: <strong>{{ activeCutoff?.endorsement_ref || 'DRAFT-CUTOFF' }}</strong> · Academic Year / Semester: {{ semester ? semester.label : '' }}
                            </p>
                        </div>

                        <!-- Section A: Eligible Authorized Deductions -->
                        <div class="mb-6">
                            <div class="flex items-center justify-between mb-2">
                                <h4 class="text-xs font-bold uppercase tracking-wider text-navy">
                                    A. Active Authorized Deductions (Transferred to Accounting for Payroll Withholding)
                                </h4>
                                <span class="text-[11px] text-muted">{{ deductionListData.activeDeductions.length }} Student Assistant(s)</span>
                            </div>

                            <div v-if="!deductionListData.activeDeductions.length" class="p-4 text-center text-xs text-muted bg-page rounded-lg border border-line">
                                No S.A.s with active deduction authorizations and payable allowance in this cutoff.
                            </div>

                            <div v-else class="overflow-x-auto">
                                <table class="w-full text-left text-[11px]">
                                    <thead class="border-b-2 border-ink font-bold text-ink">
                                        <tr>
                                            <th class="py-2">#</th>
                                            <th class="py-2">Student ID</th>
                                            <th class="py-2">Student Assistant Name</th>
                                            <th class="py-2">Course / Dept</th>
                                            <th class="py-2 text-right">Balance Before</th>
                                            <th class="py-2 text-right">Cutoff Allowance</th>
                                            <th class="py-2 text-right">Proposed Deduction</th>
                                            <th class="py-2 text-right">Balance After</th>
                                        </tr>
                                    </thead>
                                    <tbody class="divide-y divide-line/60">
                                        <tr v-for="(d, idx) in deductionListData.activeDeductions" :key="d.id || idx">
                                            <td class="py-1.5 text-muted">{{ idx + 1 }}</td>
                                            <td class="py-1.5 font-mono text-muted">{{ d.student_id }}</td>
                                            <td class="py-1.5 font-semibold text-ink">{{ d.student_name }}</td>
                                            <td class="py-1.5 text-muted">{{ d.course }} · {{ d.department }}</td>
                                            <td class="py-1.5 text-right font-medium">₱{{ formatMoney(d.school_balance_before) }}</td>
                                            <td class="py-1.5 text-right font-medium text-sky-800">₱{{ formatMoney(d.gross_allowance) }}</td>
                                            <td class="py-1.5 text-right font-bold text-amber-800">₱{{ formatMoney(d.proposed_deduction) }}</td>
                                            <td class="py-1.5 text-right font-semibold text-navy">₱{{ formatMoney(d.expected_balance_after) }}</td>
                                        </tr>
                                    </tbody>
                                    <tfoot class="border-t-2 border-ink font-bold">
                                        <tr>
                                            <td colspan="4" class="py-2">Total Active Authorized Deductions:</td>
                                            <td class="py-2 text-right">₱{{ formatMoney(deductionListData.summary.totalBalance) }}</td>
                                            <td class="py-2 text-right text-sky-800">₱{{ formatMoney(deductionListData.summary.totalGross) }}</td>
                                            <td class="py-2 text-right text-amber-800 text-[12px]">₱{{ formatMoney(deductionListData.summary.totalProposedDeductions) }}</td>
                                            <td class="py-2 text-right text-navy text-[12px]">₱{{ formatMoney(deductionListData.summary.totalRemainingBalance) }}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        </div>

                        <!-- Section B: Excluded (YES Auth but ₱0 Allowance) -->
                        <div v-if="deductionListData.excludedNoAllowance && deductionListData.excludedNoAllowance.length" class="mb-6">
                            <h4 class="text-xs font-bold uppercase tracking-wider text-muted mb-1.5">
                                B. Authorized S.A.s Withheld (₱0.00 Payable Allowance in this Cutoff — Balance Unchanged)
                            </h4>
                            <div class="overflow-x-auto rounded-lg border border-line bg-page/50">
                                <table class="w-full text-left text-[10px]">
                                    <thead class="border-b border-line font-semibold text-muted bg-page">
                                        <tr>
                                            <th class="px-3 py-1.5">Student ID</th>
                                            <th class="px-3 py-1.5">Student Assistant Name</th>
                                            <th class="px-3 py-1.5">Department</th>
                                            <th class="px-3 py-1.5 text-right">Current Balance</th>
                                            <th class="px-3 py-1.5">Remarks / Reason</th>
                                        </tr>
                                    </thead>
                                    <tbody class="divide-y divide-line">
                                        <tr v-for="ex in deductionListData.excludedNoAllowance" :key="ex.id">
                                            <td class="px-3 py-1 font-mono text-muted">{{ ex.student_id }}</td>
                                            <td class="px-3 py-1 font-semibold text-ink">{{ ex.student_name }}</td>
                                            <td class="px-3 py-1">{{ ex.department }}</td>
                                            <td class="px-3 py-1 text-right font-medium">₱{{ formatMoney(ex.school_balance_before) }}</td>
                                            <td class="px-3 py-1 text-muted italic">No attendance records in this cutoff (₱0.00 allowance). Deduction postponed; balance remains intact.</td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <!-- Signatures & Accounting Acknowledgment Block -->
                        <div class="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-6 border-t border-line text-xs">
                            <div>
                                <p class="font-semibold text-muted">Prepared &amp; Endorsed By:</p>
                                <div class="mt-8 border-b border-ink/60 w-44"></div>
                                <p class="font-bold text-ink mt-1.5 text-xs uppercase tracking-wide">{{ displayCoordinatorName }}</p>
                                <p class="text-[11px] font-medium text-ink">Student Assistant Coordinator</p>
                            </div>
                            <div>
                                <p class="font-semibold text-muted">Noted &amp; Approved By:</p>
                                <div class="mt-8 border-b border-ink/60 w-44"></div>
                                <p class="font-bold text-ink mt-1.5 text-xs">HR Manager</p>
                                <p class="text-[11px] text-muted">Human Resource Office</p>
                            </div>
                            <div>
                                <p class="font-semibold text-muted">Received &amp; Processed By:</p>
                                <div class="mt-8 border-b border-ink/60 w-44"></div>
                                <p class="font-bold text-ink mt-1.5 text-xs">Accounting Office / Cashier</p>
                                <p class="text-[11px] text-muted">Date Received &amp; Verified</p>
                            </div>
                        </div>
                    </div>
                </template>
            </div>
        </div>
        <template #footer>
            <button @click="endorseModal = false" class="btn btn-secondary">Close</button>
            <button @click="executePrint(endorseModalTab)" class="btn btn-primary inline-flex items-center gap-1.5">
                <app-icon name="Printer" :size="16" /> Print {{ endorseModalTab === 'DEDUCTION' ? 'Deduction Endorsement List' : 'Allowance Billing Report' }}
            </button>
        </template>
    </app-modal>

    <!-- ------------------------------------------------ Modal: Edit Single S.A. Rate -->
    <app-modal :open="editModal" :title="editSa ? 'Edit Allowance Rate — ' + editSa.name : 'Edit Allowance Rate'"
               icon="Coins" tone="navy" @close="editModal = false"
               :description="editSa ? (editSa.studentId + ' · ' + (editSa.department || editSa.departmentType) + ' · ' + editSa.location) : ''">
        <template v-if="editSa">
            <div class="space-y-4">
                <div>
                    <label class="field-label font-semibold text-navy">Rate Mode</label>
                    <div class="grid grid-cols-2 gap-2 mt-1">
                        <button type="button" @click="rateMode = 'STANDARD'; editRateError = ''"
                                class="rounded-lg border p-2.5 text-left transition-colors"
                                :class="rateMode === 'STANDARD' ? 'border-navy bg-navy/5 ring-1 ring-navy' : 'border-line hover:bg-mist'">
                            <span class="block text-xs font-bold text-navy">Standard Rate</span>
                            <span class="text-caption text-muted">₱{{ Number(semRate || 8).toFixed(2) }}/hr (Semester default)</span>
                        </button>
                        <button type="button" @click="rateMode = 'CUSTOM'; editRateError = ''"
                                class="rounded-lg border p-2.5 text-left transition-colors"
                                :class="rateMode === 'CUSTOM' ? 'border-navy bg-navy/5 ring-1 ring-navy' : 'border-line hover:bg-mist'">
                            <span class="block text-xs font-bold text-navy">Custom Rate</span>
                            <span class="text-caption text-muted">Specific whole-number rate</span>
                        </button>
                    </div>
                </div>

                <div v-if="rateMode === 'CUSTOM'" class="space-y-2">
                    <form-field label="Custom Hourly Rate (₱)" hint="Whole numbers only: ₱8 to ₱1,000 (no decimals)." v-slot="f">
                        <div class="relative max-w-xs">
                            <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-bold text-muted">₱</span>
                            <input :id="f.id" v-model.number="customRateInput" @blur="onCustomRateBlur" @input="editRateError = ''" @keydown="preventDecimalKey" type="number" step="1" min="8" max="1000"
                                   class="input pl-8 font-bold text-ink text-body"
                                   :class="editRateError ? 'border-danger focus:ring-danger' : ''"
                                   placeholder="8">
                            <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-caption text-muted">/ hour</span>
                        </div>
                    </form-field>
                    <p v-if="editRateError" class="text-[12px] font-semibold text-danger flex items-center gap-1">
                        <app-icon name="AlertCircle" :size="13" /> {{ editRateError }}
                    </p>
                </div>

                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                        <label class="field-label font-semibold text-navy">Effective Date</label>
                        <input v-model="editEffectiveDate" type="date" class="input text-xs">
                    </div>
                    <div>
                        <label class="field-label font-semibold text-navy">Reason for Rate Edit <span class="text-danger">*</span> <span class="text-caption font-normal text-muted">(3–200 chars)</span></label>
                        <input v-model="editReason" @input="editReasonError = ''" type="text" maxlength="200"
                               class="input text-xs"
                               :class="editReasonError ? 'border-danger focus:ring-danger' : ''"
                               placeholder="e.g. Merit increase or office reassignment">
                        <p v-if="editReasonError" class="mt-1 text-[11px] font-semibold text-danger">
                            {{ editReasonError }}
                        </p>
                    </div>
                </div>

                <div class="flex justify-end pt-1">
                    <button type="button" @click="openRateHistory(editSa)" class="text-caption text-info hover:underline inline-flex items-center gap-1">
                        <app-icon name="History" :size="13" /> View Rate History for {{ editSa.name }}
                    </button>
                </div>
            </div>
        </template>
        <template #footer>
            <button @click="editModal = false" class="btn btn-secondary">Cancel</button>
            <button @click="saveSaRate" :disabled="savingRate" class="btn btn-primary inline-flex items-center gap-1.5">
                <app-icon :name="savingRate ? 'LoaderCircle' : 'Check'" :size="16" :class="savingRate ? 'animate-spin' : ''" />
                {{ savingRate ? 'Saving…' : 'Save Rate' }}
            </button>
        </template>
    </app-modal>

    <!-- ------------------------------------------------ Modal: Edit Semester Base Rate -->
    <app-modal :open="semRateModal" title="Edit Standard Semester Base Rate"
               icon="Coins" tone="navy" @close="semRateModal = false"
               :description="semester ? semester.label : ''">
        <div class="space-y-4">
            <p class="text-body text-ink">
                Update the standard default hourly rate for all Student Assistants in this semester.
            </p>
            <form-field label="Standard Hourly Rate (₱)" hint="Whole numbers only: ₱8 to ₱1,000 — applies to all S.A.s who do not have an individual custom rate." v-slot="f">
                <div class="relative max-w-xs">
                    <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-bold text-muted">₱</span>
                    <input :id="f.id" v-model.number="semRateInput" @blur="onSemRateBlur" @input="semRateError = ''" @keydown="preventDecimalKey" type="number" step="1" min="8" max="1000"
                           class="input pl-8 font-bold text-ink text-body"
                           :class="semRateError ? 'border-danger focus:ring-danger' : ''"
                           placeholder="8" autofocus>
                    <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-caption text-muted">/ hour</span>
                </div>
                <p v-if="semRateError" class="mt-1 text-[12px] font-semibold text-danger flex items-center gap-1">
                    <app-icon name="AlertCircle" :size="13" /> {{ semRateError }}
                </p>
            </form-field>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                    <label class="field-label font-semibold text-navy">Effective Date</label>
                    <input v-model="semRateEffectiveDate" type="date" class="input text-xs">
                </div>
                <div>
                    <label class="field-label font-semibold text-navy">Reason for Base Rate Edit <span class="text-danger">*</span> <span class="text-caption font-normal text-muted">(3–200 chars)</span></label>
                    <input v-model="semRateReason" @input="semRateReasonError = ''" type="text" maxlength="200"
                           class="input text-xs"
                           :class="semRateReasonError ? 'border-danger focus:ring-danger' : ''"
                           placeholder="e.g. Standard rate adjustment per administration policy">
                    <p v-if="semRateReasonError" class="mt-1 text-[11px] font-semibold text-danger">
                        {{ semRateReasonError }}
                    </p>
                </div>
            </div>

            <p class="text-caption text-muted">
                Note: S.A.s with customized hourly rates will preserve their individual rates.
            </p>
        </div>
        <template #footer>
            <button @click="semRateModal = false" class="btn btn-secondary">Cancel</button>
            <button @click="saveSemRate" :disabled="savingSemRate" class="btn btn-primary inline-flex items-center gap-1.5">
                <app-icon :name="savingSemRate ? 'LoaderCircle' : 'Check'" :size="16" :class="savingSemRate ? 'animate-spin' : ''" />
                {{ savingSemRate ? 'Saving…' : 'Save Standard Rate' }}
            </button>
        </template>
    </app-modal>

    <!-- ------------------------------------------------ Modal: Full Bulk Edit -->
    <app-modal :open="bulkModal" title="Bulk Edit Student Assistant Allowance Rates"
               icon="Users" tone="navy" size="xl" @close="bulkModal = false"
               description="Batch-update allowance rates for multiple Student Assistants with strict whole-number validation (₱8 – ₱1,000).">
        <div class="space-y-4">
            <!-- Section 1: Choose S.A.s to Update (Filtered by Current Rate with Select All/Unselect) -->
            <div class="rounded-xl border border-line bg-page p-3.5 space-y-3">
                <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <span class="text-xs font-bold uppercase tracking-wider text-navy flex items-center gap-1.5">
                            <app-icon name="CheckSquare" :size="14" class="text-gold" />
                            1. Select S.A.s by Current Rate
                        </span>
                        <p class="text-[11px] text-muted">
                            Piliin kung sino ang mga S.A. na naka-rate ng ₱8, ₱9, ₱10, atbp. gamit ang mga rate filters at select all / unselect checkbox.
                        </p>
                    </div>
                    <div class="flex items-center gap-2">
                        <span class="text-xs font-semibold text-muted">
                            Selected: <strong class="text-navy font-bold">{{ selectedSas.length }}</strong> of {{ items.length }}
                        </span>
                        <button v-if="selectedSas.length" type="button" @click="clearSelection" class="text-xs text-danger font-semibold hover:underline">
                            Clear
                        </button>
                    </div>
                </div>

                <!-- Rate Filter Tabs & Quick 1-Click Select by Rate -->
                <div class="flex flex-wrap items-center gap-1.5 pt-1 border-t border-line/60">
                    <span class="text-[11px] font-bold text-muted mr-1">Current Rate:</span>

                    <!-- All Rates Filter Button -->
                    <button type="button"
                            @click="bulkModalRateFilter = 'ALL'"
                            class="rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors"
                            :class="bulkModalRateFilter === 'ALL' ? 'border-navy bg-navy text-white' : 'border-line bg-white text-ink hover:bg-mist'">
                        All ({{ items.length }})
                    </button>

                    <!-- Individual Rate Filter Buttons (₱8, ₱9, ₱10, etc.) -->
                    <button v-for="rf in availableCurrentRates" :key="rf.rate" type="button"
                            @click="bulkModalRateFilter = rf.rate"
                            class="rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors inline-flex items-center gap-1"
                            :class="bulkModalRateFilter === rf.rate ? 'border-navy bg-navy text-white' : 'border-line bg-white text-ink hover:bg-mist'">
                        <span>₱{{ rf.rate }}/hr</span>
                        <span class="rounded-full px-1.5 py-0.2 text-[10px]"
                              :class="bulkModalRateFilter === rf.rate ? 'bg-gold text-navy font-bold' : 'bg-mist text-muted'">
                            {{ rf.count }}
                        </span>
                    </button>

                </div>

                <!-- Roster Search & Select All Bar -->
                <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between pt-1">
                    <label class="inline-flex items-center gap-2 cursor-pointer text-xs font-bold text-navy select-none">
                        <input type="checkbox"
                               :checked="isBulkModalAllSelected"
                               @change="toggleBulkModalSelectAll"
                               class="h-4 w-4 cursor-pointer rounded border-line text-navy focus:ring-navy">
                        <span>
                            {{ isBulkModalAllSelected ? 'Unselect All Filtered' : 'Select All Filtered' }}
                            ({{ bulkModalSas.length }} S.A.{{ bulkModalSas.length === 1 ? '' : 's' }})
                        </span>
                    </label>

                    <div class="relative w-full sm:w-64">
                        <app-icon name="Search" :size="13" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                        <input v-model="bulkSearch" type="search" placeholder="Search name or ID..."
                               class="input py-1 pl-7 text-xs" aria-label="Search S.A.s in modal">
                    </div>
                </div>

                <!-- S.A. Checkbox List Table -->
                <div class="max-h-52 overflow-y-auto rounded-lg border border-line bg-white">
                    <div v-if="!bulkModalSas.length" class="p-6 text-center text-xs text-muted">
                        No Student Assistants match the selected rate filter or search term.
                    </div>
                    <table v-else class="w-full text-left text-xs">
                        <thead class="bg-page text-[10px] font-bold uppercase tracking-wider text-muted sticky top-0 border-b border-line">
                            <tr>
                                <th class="w-10 px-3 py-2 text-center">
                                    <input type="checkbox"
                                           :checked="isBulkModalAllSelected"
                                           @change="toggleBulkModalSelectAll"
                                           class="h-3.5 w-3.5 cursor-pointer rounded border-line text-navy focus:ring-navy"
                                           aria-label="Select all in list">
                                </th>
                                <th class="px-3 py-2">Student Assistant</th>
                                <th class="px-3 py-2">Department &amp; Post</th>
                                <th class="px-3 py-2 text-right">Current Rate</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-line">
                            <tr v-for="s in bulkModalSas" :key="s.id"
                                @click="toggleSelect(s.id)"
                                class="cursor-pointer transition-colors duration-150 hover:bg-mist/40"
                                :class="isSelected(s.id) ? 'bg-sky-50/60' : ''">
                                <td class="px-3 py-1.5 text-center" @click.stop>
                                    <input type="checkbox"
                                           :checked="isSelected(s.id)"
                                           @change="toggleSelect(s.id)"
                                           class="h-3.5 w-3.5 cursor-pointer rounded border-line text-navy focus:ring-navy"
                                           :aria-label="'Select ' + s.name">
                                </td>
                                <td class="px-3 py-1.5 whitespace-nowrap">
                                    <span class="font-semibold text-ink">{{ s.name }}</span>
                                    <span class="block text-[10px] text-muted">{{ s.studentId }} · {{ s.course || s.courseYear || 'No course' }}</span>
                                </td>
                                <td class="px-3 py-1.5 whitespace-nowrap">
                                    <span class="inline-flex items-center rounded px-1.5 py-0.2 text-[10px] font-semibold"
                                          :class="s.department === 'ITO' ? 'bg-sky-100 text-sky-800' : (s.department === 'ACADS' ? 'bg-purple-100 text-purple-800' : 'bg-emerald-100 text-emerald-800')">
                                        {{ s.department || s.departmentType }}
                                    </span>
                                    <span class="ml-1 text-[11px] text-muted">{{ s.location }}</span>
                                </td>
                                <td class="px-3 py-1.5 text-right whitespace-nowrap font-bold">
                                    <span class="rounded-full px-2 py-0.5 text-[11px]"
                                          :class="Number(s.effectiveRate) > Number(semRate || 8) ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-800'">
                                        ₱{{ Number(s.effectiveRate || s.hourlyRate || 8).toFixed(2) }}/hr
                                    </span>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- Section 2: Set New Allowance Rate -->
            <div class="space-y-3 pt-1">
                <span class="text-xs font-bold uppercase tracking-wider text-navy flex items-center gap-1.5">
                    <app-icon name="Coins" :size="14" class="text-gold" />
                    2. Set New Allowance Rate
                </span>

                <!-- Mode Switch: Uniform vs Individual -->
                <div class="flex items-center gap-4">
                    <label class="flex items-center gap-2 cursor-pointer text-xs font-semibold text-ink">
                        <input type="radio" v-model="bulkApplyType" value="UNIFORM" class="text-navy focus:ring-navy">
                        <span>Uniform Rate (Apply same rate to all selected)</span>
                    </label>
                    <label class="flex items-center gap-2 cursor-pointer text-xs font-semibold text-ink">
                        <input type="radio" v-model="bulkApplyType" value="INDIVIDUAL" class="text-navy focus:ring-navy">
                        <span>Individual Rates (Set rate per S.A.)</span>
                    </label>
                </div>

                <!-- Uniform Rate Controls -->
                <div v-if="bulkApplyType === 'UNIFORM'" class="rounded-xl border border-line bg-page p-3.5 space-y-3">
                    <div class="flex flex-wrap items-center gap-2">
                        <button type="button" @click="bulkRateMode = 'STANDARD'; bulkRateError = ''"
                                class="rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors"
                                :class="bulkRateMode === 'STANDARD' ? 'border-navy bg-navy text-white' : 'border-line bg-white text-ink hover:bg-mist'">
                            Standard Semester Rate (₱{{ Number(semRate || 8).toFixed(2) }}/hr)
                        </button>
                        <button type="button" @click="bulkRateMode = 'CUSTOM'; bulkRateError = ''"
                                class="rounded-lg border px-3 py-1.5 text-xs font-bold transition-colors"
                                :class="bulkRateMode === 'CUSTOM' ? 'border-navy bg-navy text-white' : 'border-line bg-white text-ink hover:bg-mist'">
                            Custom Hourly Rate
                        </button>
                    </div>

                    <div v-if="bulkRateMode === 'CUSTOM'" class="space-y-1.5">
                        <div class="flex items-center gap-2">
                            <div class="relative w-36">
                                <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-bold text-muted text-xs">₱</span>
                                <input v-model.number="bulkRateInput" @blur="onBulkModalRateBlur" @keydown="preventDecimalKey" type="number" step="1" min="8" max="1000"
                                       class="input pl-7 text-xs font-bold"
                                       :class="bulkRateError ? 'border-danger focus:ring-danger' : ''"
                                       placeholder="8">
                                <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[10px] text-muted">/ hr</span>
                            </div>
                            <div class="flex flex-wrap gap-1">
                                <button v-for="p in PRESET_RATES" :key="p" type="button"
                                        @click="bulkRateInput = p; bulkRateError = ''"
                                        class="rounded border border-line bg-white px-2 py-1 text-[11px] font-semibold text-ink hover:bg-mist">
                                    ₱{{ p }}
                                </button>
                            </div>
                        </div>
                        <p v-if="bulkRateError" class="text-[11px] font-semibold text-danger flex items-center gap-1">
                            <app-icon name="AlertCircle" :size="12" /> {{ bulkRateError }}
                        </p>
                    </div>
                </div>

                <!-- Individual Rates Table (when INDIVIDUAL is selected) -->
                <div v-else class="max-h-52 overflow-y-auto rounded-xl border border-line">
                    <div v-if="!selectedSas.length" class="p-6 text-center text-xs text-muted">
                        No Student Assistants currently selected. Select S.A.s above to set their individual rates.
                    </div>
                    <table v-else class="w-full text-left text-xs">
                        <thead class="bg-page text-[10px] font-bold uppercase tracking-wider text-muted sticky top-0">
                            <tr>
                                <th class="px-3 py-2">Student Assistant</th>
                                <th class="px-3 py-2">Department</th>
                                <th class="px-3 py-2 text-right">Current Rate</th>
                                <th class="px-3 py-2 text-right w-36">New Rate (₱/hr)</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-line">
                            <tr v-for="s in selectedSas" :key="s.id">
                                <td class="px-3 py-2 font-semibold text-ink">{{ s.name }}</td>
                                <td class="px-3 py-2 text-muted">{{ s.department || s.departmentType }}</td>
                                <td class="px-3 py-2 text-right text-muted">₱{{ Number(s.effectiveRate || s.hourlyRate || 8).toFixed(2) }}</td>
                                <td class="px-3 py-1.5 text-right">
                                    <div class="relative w-28 ml-auto">
                                        <span class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 font-bold text-muted text-[11px]">₱</span>
                                        <input v-model.number="bulkIndividualRates[s.id]" @blur="onBulkIndividualRateBlur(s.id)" @keydown="preventDecimalKey" type="number" step="1" min="8" max="1000"
                                               class="input py-1 pl-5 pr-6 text-xs font-bold text-right"
                                               :class="bulkIndividualErrors[s.id] ? 'border-danger focus:ring-danger' : ''">
                                        <span class="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[9px] text-muted">/h</span>
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <!-- Effective Date & Reason -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    <div>
                        <label class="field-label font-semibold text-navy text-xs">Effective Date</label>
                        <input v-model="bulkEffectiveDate" type="date" class="input text-xs">
                    </div>
                    <div>
                        <label class="field-label font-semibold text-navy text-xs">Reason for Bulk Edit <span class="text-danger">*</span> <span class="text-caption font-normal text-muted">(3–200 chars)</span></label>
                        <input v-model="bulkReason" type="text" maxlength="200"
                               class="input text-xs"
                               placeholder="e.g. Approved allowance increment for S.A. roster">
                    </div>
                </div>
            </div>
        </div>
        <template #footer>
            <button @click="bulkModal = false" class="btn btn-secondary">Cancel</button>
            <button @click="saveBulkModal" :disabled="savingBulk || !selectedSas.length" class="btn btn-primary inline-flex items-center gap-1.5">
                <app-icon :name="savingBulk ? 'LoaderCircle' : 'Check'" :size="16" :class="savingBulk ? 'animate-spin' : ''" />
                {{ savingBulk ? 'Saving…' : 'Apply to ' + selectedSas.length + ' S.A.(s)' }}
            </button>
        </template>
    </app-modal>

    <!-- ------------------------------------------------ Modal: Rate History Audit Trail -->
    <app-modal :open="historyModal" :title="historySa ? 'Rate History — ' + historySa.name : 'Allowance Rate Change History'"
               icon="History" tone="navy" size="lg" @close="historyModal = false"
               :description="historySa ? (historySa.studentId + ' · Current Rate: ₱' + Number(historySa.effectiveRate || historySa.hourlyRate || 8).toFixed(2) + '/hr') : 'Complete audit trail of all allowance rate adjustments.'">
        <div class="space-y-4">
            <div v-if="historyLoading" class="py-12 text-center text-muted">
                <app-icon name="LoaderCircle" :size="24" class="animate-spin mx-auto text-navy" />
                <p class="mt-2 text-caption">Loading rate history logs...</p>
            </div>
            <div v-else-if="!historyLogs.length" class="py-12 text-center text-muted">
                <app-icon name="FileClock" :size="28" class="mx-auto text-muted" />
                <p class="mt-2 text-body font-medium text-ink">No rate change records found</p>
                <p class="mt-1 text-caption">No historical rate updates have been logged for this selection.</p>
            </div>
            <div v-else class="max-h-96 overflow-y-auto rounded-xl border border-line">
                <table class="w-full text-left text-[12px]">
                    <thead class="bg-page text-[10px] font-bold uppercase tracking-wider text-muted sticky top-0">
                        <tr>
                            <th class="px-3.5 py-2.5">Date &amp; Time</th>
                            <th class="px-3.5 py-2.5">Student Assistant</th>
                            <th class="px-3.5 py-2.5">Previous Rate</th>
                            <th class="px-3.5 py-2.5">New Rate</th>
                            <th class="px-3.5 py-2.5">Source</th>
                            <th class="px-3.5 py-2.5">Reason &amp; Actor</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-line">
                        <tr v-for="h in historyLogs" :key="h.id" class="hover:bg-mist/30">
                            <td class="whitespace-nowrap px-3.5 py-2.5 text-muted">
                                {{ new Date(h.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' }) }}
                            </td>
                            <td class="whitespace-nowrap px-3.5 py-2.5 font-semibold text-ink">
                                {{ h.saName }}
                                <span v-if="h.studentId" class="block text-[10px] text-muted">{{ h.studentId }}</span>
                            </td>
                            <td class="whitespace-nowrap px-3.5 py-2.5 text-muted">
                                {{ h.previousRate !== null && h.previousRate !== undefined ? '₱' + Number(h.previousRate).toFixed(2) + '/hr' : 'None / Initial' }}
                            </td>
                            <td class="whitespace-nowrap px-3.5 py-2.5 font-bold text-navy">
                                ₱{{ Number(h.newRate || 0).toFixed(2) }}/hr
                            </td>
                            <td class="whitespace-nowrap px-3.5 py-2.5">
                                <span class="rounded px-1.5 py-0.5 text-[10px] font-semibold"
                                      :class="h.source === 'STANDARD_RATE_UPDATE' ? 'bg-purple-100 text-purple-800' : (h.source === 'BULK_EDIT' ? 'bg-sky-100 text-sky-800' : 'bg-page text-muted border border-line')">
                                    {{ h.source }}
                                </span>
                            </td>
                            <td class="px-3.5 py-2.5">
                                <span class="font-medium text-ink">{{ h.reason }}</span>
                                <span class="block text-[10px] text-muted">By: {{ h.changedByName }} (Effective: {{ h.effectiveDate }})</span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
        <template #footer>
            <button @click="historyModal = false" class="btn btn-secondary">Close</button>
        </template>
    </app-modal>
    </div>
    `
};
