// Administration > School Balance & Allowance Deductions (/admin/school-balance).
// Coordinator broadcasts deduction announcements/polls to S.A.s (e.g. tuition balance).
// S.A.s respond with Yes/No, and the coordinator manages opt-in deduction authorization,
// Registrar COR fee assessments, scholarship benefits (100% Tuition + 70% Misc), and payroll deduction processing.
const DeductionsPage = {
    components: { AppIcon, PageHeader, AppModal, FormField },

    setup() {
        const loading = Vue.ref(true);
        const loadError = Vue.ref("");
        const semester = Vue.ref(null);
        const campaigns = Vue.ref([]);
        const activeCampaignId = Vue.ref(null);
        const activeCampaign = Vue.ref(null);
        const saResponses = Vue.ref([]);
        const transactions = Vue.ref([]);
        const loadingDetails = Vue.ref(false);

        // Search and Filters
        const q = Vue.ref("");
        const activeTab = Vue.ref("ALL"); // ALL | YES | NO | PENDING | PROCESSING
        const deptFilter = Vue.ref("ALL"); // ALL | ITO | ACADS | OFFICE
        const page = Vue.ref(1);
        const PAGE_SIZE = 10;

        // Modal: New Campaign
        const showNewModal = Vue.ref(false);
        const newForm = Vue.reactive({
            title: "",
            deductionType: "TUITION",
            scopeCategory: "ALL",
            description: "",
            defaultAmount: 500,
            startDate: new Date().toISOString().slice(0, 10),
            deadline: ""
        });
        const savingCampaign = Vue.ref(false);

        // Modal: Edit Response (Coordinator Override)
        const showEditModal = Vue.ref(false);
        const editForm = Vue.reactive({
            saProfileId: null,
            name: "",
            studentId: "",
            department: "",
            balanceBefore: 0,
            cashTotal: 0,
            choice: "YES",
            amount: 0,
            notes: "",
            processingStatus: "AWAITING_PROCESSING"
        });
        const savingResponse = Vue.ref(false);

        // Modal: Process Deduction
        const showProcessModal = Vue.ref(false);
        const processForm = Vue.reactive({
            saProfileId: null,
            name: "",
            studentId: "",
            department: "",
            balanceBefore: 0,
            authorizedAmount: 0,
            processedAmount: 0,
            status: "PROCESSED",
            remarks: ""
        });
        const savingProcess = Vue.ref(false);

        // Modal: COR Breakdown
        const showCorModal = Vue.ref(false);
        const selectedCorSa = Vue.ref(null);

        // Modal: Reports & Print
        const showReportModal = Vue.ref(false);
        const reportType = Vue.ref("SUMMARY"); // SUMMARY | YES | NO_PENDING | MASTERLIST
        const reportDeptFilter = Vue.ref("ALL");

        // Sync Registrar COR state
        const syncingCor = Vue.ref(false);
        const sendingReminder = Vue.ref(false);

        const typeLabels = {
            TUITION: "Tuition & School Fee Balance"
        };

        const loadCampaigns = async () => {
            loading.value = true;
            loadError.value = "";
            const r = await Model.request("deductions", "list_campaigns");
            loading.value = false;
            if (!r.success) {
                loadError.value = r.message || "Failed to load deduction announcements.";
                return;
            }
            semester.value = r.semester;
            campaigns.value = r.campaigns || [];
            if (campaigns.value.length > 0) {
                const targetId = activeCampaignId.value && campaigns.value.some(c => c.id === activeCampaignId.value)
                    ? activeCampaignId.value
                    : campaigns.value[0].id;
                selectCampaign(targetId);
            }
        };

        const selectCampaign = async (id) => {
            activeCampaignId.value = id;
            loadingDetails.value = true;
            const r = await Model.request("deductions", "campaign_details", { campaignId: id });
            loadingDetails.value = false;
            if (r.success) {
                activeCampaign.value = r.campaign;
                saResponses.value = r.saResponses || [];
                transactions.value = r.transactions || [];
                page.value = 1;
            } else {
                Store.toast("danger", r.message || "Could not load campaign details.");
            }
        };

        Vue.onMounted(loadCampaigns);

        // Filtered S.A. list
        const filteredResponses = Vue.computed(() => {
            const term = q.value.trim().toLowerCase();
            return saResponses.value.filter(s => {
                // Text search
                const matchQ = !term || [
                    s.name, s.studentId, s.course, s.notes,
                    s.cor?.referenceNo, s.cor?.enrollmentStatus
                ].some(v => v && String(v).toLowerCase().includes(term));
                if (!matchQ) return false;

                // Department filter
                if (deptFilter.value !== "ALL") {
                    if (s.department !== deptFilter.value && s.category !== deptFilter.value) {
                        return false;
                    }
                }

                // Active Tab filter
                if (activeTab.value === "YES") return s.choice === "YES";
                if (activeTab.value === "NO") return s.choice === "NO";
                if (activeTab.value === "PENDING") return !s.choice;
                if (activeTab.value === "PROCESSING") return s.choice === "YES";
                return true;
            });
        });

        // Tab counts
        const tabCounts = Vue.computed(() => {
            let yes = 0, no = 0, pending = 0;
            saResponses.value.forEach(s => {
                if (s.choice === "YES") yes++;
                else if (s.choice === "NO") no++;
                else pending++;
            });
            return {
                all: saResponses.value.length,
                yes,
                no,
                pending,
                processing: yes
            };
        });

        const paginatedResponses = Vue.computed(() => {
            const start = (page.value - 1) * PAGE_SIZE;
            return filteredResponses.value.slice(start, start + PAGE_SIZE);
        });

        const totalPages = Vue.computed(() => Math.max(1, Math.ceil(filteredResponses.value.length / PAGE_SIZE)));

        // Create Announcement
        const openCreateModal = () => {
            newForm.title = "";
            newForm.deductionType = "TUITION";
            newForm.scopeCategory = "ALL";
            newForm.description = "Please indicate if you wish to deduct your remaining school balance from your monthly S.A. allowance for this semester.";
            newForm.defaultAmount = 500;
            newForm.startDate = new Date().toISOString().slice(0, 10);
            newForm.deadline = "";
            showNewModal.value = true;
        };

        const submitNewCampaign = async () => {
            const title = newForm.title.trim();
            if (!title) {
                Alerts.error("Missing Title", "Please provide a title for the deduction announcement.");
                return;
            }
            const defaultAmt = Number(newForm.defaultAmount);
            if (isNaN(defaultAmt) || defaultAmt < 0) {
                Alerts.error("Invalid Amount", "Please enter a valid non-negative suggested deduction amount.");
                return;
            }
            if (newForm.deadline && newForm.deadline < newForm.startDate) {
                Alerts.error("Invalid Deadline", "The response deadline cannot be earlier than the start date.");
                return;
            }

            const ok = await Alerts.confirm({
                title: "Broadcast Deduction Announcement?",
                html: `Are you sure you want to broadcast <b>${Alerts.esc(title)}</b> to all active Student Assistants?`,
                icon: "question",
                confirmText: "Yes, Broadcast Announcement",
                requireReason: false
            });
            if (!ok) return;

            savingCampaign.value = true;
            const r = await Model.request("deductions", "create_campaign", {
                title,
                deductionType: newForm.deductionType,
                scopeCategory: newForm.scopeCategory,
                description: newForm.description.trim(),
                defaultAmount: defaultAmt,
                startDate: newForm.startDate,
                deadline: newForm.deadline || null
            });
            savingCampaign.value = false;

            if (!r.success) {
                Alerts.error("Failed to Create Announcement", r.message || "An unexpected error occurred.");
                return;
            }

            await Alerts.success("Broadcast Sent", "Deduction announcement successfully broadcasted to all active S.A.s!");
            showNewModal.value = false;
            await loadCampaigns();
            if (r.campaignId) selectCampaign(r.campaignId);
        };

        // Toggle Poll Status (Open/Close)
        const toggleCampaignStatus = async () => {
            if (!activeCampaign.value) return;
            const isClosing = activeCampaign.value.status === "OPEN";
            const newStatus = isClosing ? "CLOSED" : "OPEN";
            const ok = await Alerts.confirm({
                title: isClosing ? "Close Announcement Poll?" : "Re-open Announcement Poll?",
                text: isClosing
                    ? "Closing this announcement will freeze poll submissions and prevent S.A.s from submitting new replies."
                    : "Re-opening will allow S.A.s to submit or update their responses under My School Balance.",
                icon: "warning",
                confirmText: isClosing ? "Close Announcement" : "Re-open Announcement",
                requireReason: false
            });
            if (!ok) return;

            const r = await Model.request("deductions", "update_campaign_status", {
                campaignId: activeCampaign.value.id,
                status: newStatus
            });
            if (r.success) {
                Store.toast("success", `Announcement poll is now ${newStatus.toLowerCase()}.`);
                await loadCampaigns();
            } else {
                Alerts.error("Status Update Failed", r.message || "Could not update status.");
            }
        };

        // Sync from Registrar COR
        const syncRegistrarCor = async () => {
            if (!activeCampaign.value) return;
            const ok = await Alerts.confirm({
                title: "Sync with Registrar COR?",
                text: "This will synchronize all active S.A. fee assessments from the official Registrar enrollments and recalculate 100% Tuition + 70% Misc coverage.",
                icon: "info",
                confirmText: "Sync Now",
                requireReason: false
            });
            if (!ok) return;

            syncingCor.value = true;
            const r = await Model.request("deductions", "sync_registrar_cor", {
                campaignId: activeCampaign.value.id,
                semesterId: activeCampaign.value.semesterId
            });
            syncingCor.value = false;

            if (!r.success) {
                Alerts.error("COR Sync Failed", r.message || "Could not synchronize Registrar COR.");
                return;
            }

            const html = `
                <div class="text-left space-y-2 text-xs">
                    <p class="font-medium text-ink">Registrar Fee Assessment synchronization completed successfully:</p>
                    <ul class="list-disc pl-5 text-muted space-y-1">
                        <li><b>${r.syncedCount}</b> of <b>${r.totalActiveSas}</b> S.A.s matched with official fee assessments.</li>
                        <li><b>${r.updatedCount}</b> S.A. benefit & balance records updated.</li>
                        <li><b>${r.unmatchedCount}</b> S.A.s with pending or missing fee assessments.</li>
                    </ul>
                    <p class="text-[11px] text-muted pt-2 border-t border-line">Timestamp: ${r.timestamp}</p>
                </div>
            `;
            Alerts.info("Registrar COR Synchronized", html);
            await selectCampaign(activeCampaign.value.id);
        };

        // Send Reminders to Pending S.A.s
        const sendReminders = async (targetSa = null) => {
            if (!activeCampaign.value) return;
            const isSingle = !!targetSa;
            const ok = await Alerts.confirm({
                title: isSingle ? `Send Reminder to ${targetSa.name}?` : "Send Reminders to All Pending S.A.s?",
                text: isSingle
                    ? `This will send an in-app notification to ${targetSa.name} to complete their deduction response.`
                    : `This will send an in-app reminder notification to all ${activeCampaign.value.metrics?.pendingCount || 0} Student Assistants who haven't responded yet.`,
                icon: "question",
                confirmText: "Send Reminder",
                requireReason: false
            });
            if (!ok) return;

            sendingReminder.value = true;
            const r = await Model.request("deductions", "send_reminder", {
                campaignId: activeCampaign.value.id,
                saProfileId: targetSa ? targetSa.saProfileId : null
            });
            sendingReminder.value = false;

            if (r.success) {
                Store.toast("success", `Reminder sent to ${r.sentCount} Student Assistant(s)!`);
            } else {
                Alerts.error("Reminder Failed", r.message || "Failed to dispatch reminders.");
            }
        };

        // Edit Decision Modal
        const openEditResponse = (row) => {
            editForm.saProfileId = row.saProfileId;
            editForm.name = row.name;
            editForm.studentId = row.studentId;
            editForm.department = row.department;
            editForm.balanceBefore = row.balanceBefore;
            editForm.cashTotal = row.cor?.cashTotal || 0;
            editForm.choice = row.choice || "YES";
            editForm.amount = row.authorizedAmount || row.balanceBefore || activeCampaign.value?.defaultAmount || 0;
            editForm.notes = row.notes || row.lastOverrideReason || "";
            editForm.processingStatus = row.processingStatus === "PENDING_RESPONSE" ? "AWAITING_PROCESSING" : row.processingStatus;
            showEditModal.value = true;
        };

        const submitEditResponse = async () => {
            const cleanReason = String(editForm.notes || "").trim();
            if (cleanReason.length < 3) {
                Alerts.error("Reason Required", "Please enter a valid reason for updating this decision (minimum 3 characters).");
                return;
            }
            if (cleanReason.length > 200) {
                Alerts.error("Reason Too Long", "The reason must be 200 characters or fewer.");
                return;
            }

            const amt = Number(editForm.amount);
            if (editForm.choice === "YES" && (isNaN(amt) || amt < 0)) {
                Alerts.error("Invalid Amount", "Please enter a valid non-negative deduction amount.");
                return;
            }

            savingResponse.value = true;
            const r = await Model.request("deductions", "admin_update_response", {
                campaignId: activeCampaign.value.id,
                saProfileId: editForm.saProfileId,
                choice: editForm.choice,
                amount: editForm.choice === "YES" ? amt : 0,
                reason: cleanReason,
                notes: cleanReason,
                processingStatus: editForm.processingStatus
            });
            savingResponse.value = false;

            if (!r.success) {
                Alerts.error("Update Failed", r.message || "Could not update deduction decision.");
                return;
            }

            await Alerts.success("Decision Updated", `Deduction decision updated for ${editForm.name}.`);
            showEditModal.value = false;
            await selectCampaign(activeCampaign.value.id);
        };

        // Process Deduction Modal
        const openProcessModal = (row) => {
            processForm.saProfileId = row.saProfileId;
            processForm.name = row.name;
            processForm.studentId = row.studentId;
            processForm.department = row.department;
            processForm.balanceBefore = row.balanceBefore;
            processForm.authorizedAmount = row.authorizedAmount;
            processForm.processedAmount = row.processedAmount > 0 ? row.processedAmount : row.authorizedAmount;
            processForm.status = row.processingStatus === "AWAITING_PROCESSING" ? "PROCESSED" : row.processingStatus;
            processForm.remarks = "";
            showProcessModal.value = true;
        };

        const submitProcessDeduction = async () => {
            const amt = Number(processForm.processedAmount);
            if (isNaN(amt) || amt < 0) {
                Alerts.error("Invalid Amount", "Please enter a valid processed deduction amount.");
                return;
            }

            savingProcess.value = true;
            const r = await Model.request("deductions", "process_deduction", {
                campaignId: activeCampaign.value.id,
                saProfileId: processForm.saProfileId,
                processedAmount: amt,
                status: processForm.status,
                remarks: processForm.remarks.trim()
            });
            savingProcess.value = false;

            if (!r.success) {
                Alerts.error("Processing Failed", r.message || "Could not record deduction processing.");
                return;
            }

            await Alerts.success("Deduction Processed", `Deduction processed for ${processForm.name} (Ref: ${r.referenceNo}).`);
            showProcessModal.value = false;
            await selectCampaign(activeCampaign.value.id);
        };

        // COR Breakdown Modal
        const openCorModal = (row) => {
            selectedCorSa.value = row;
            showCorModal.value = true;
        };

        // Print / Report Modal
        const openReportModal = (type = "SUMMARY") => {
            reportType.value = type;
            reportDeptFilter.value = "ALL";
            showReportModal.value = true;
        };

        const reportFilteredResponses = Vue.computed(() => {
            return saResponses.value.filter(s => {
                if (reportDeptFilter.value !== "ALL") {
                    if (s.department !== reportDeptFilter.value && s.category !== reportDeptFilter.value) {
                        return false;
                    }
                }
                if (reportType.value === "YES") return s.choice === "YES";
                if (reportType.value === "NO_PENDING") return s.choice !== "YES";
                return true;
            });
        });

        const doPrint = () => {
            window.print();
        };

        const coordinatorName = Vue.computed(() => {
            return Store.user?.full_name || Store.user?.name || "Ansherina A. Sudario";
        });

        const fmtPeso = val => "₱" + (Number(val) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        const statusBadgeClass = (status) => {
            switch (status) {
                case "PROCESSED": return "bg-emerald-100 text-emerald-800 border-emerald-200";
                case "PARTIALLY_PROCESSED": return "bg-purple-100 text-purple-800 border-purple-200";
                case "PROCESSING": return "bg-blue-100 text-blue-800 border-blue-200";
                case "AWAITING_PROCESSING": return "bg-amber-100 text-amber-800 border-amber-200";
                case "RETURNED_FOR_CORRECTION": return "bg-rose-100 text-rose-800 border-rose-200";
                case "CANCELLED": return "bg-gray-100 text-gray-700 border-gray-200";
                case "DECLINED": return "bg-gray-100 text-ink border-gray-200";
                default: return "bg-amber-50 text-amber-700 border-amber-200";
            }
        };

        const formatProcStatus = (s) => {
            if (!s) return "Awaiting Processing";
            return s.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
        };

        return {
            loading, loadError, semester, campaigns, activeCampaignId, activeCampaign,
            saResponses, transactions, loadingDetails, selectCampaign, q, activeTab, deptFilter,
            page, PAGE_SIZE, filteredResponses, tabCounts, paginatedResponses, totalPages,
            showNewModal, newForm, savingCampaign, openCreateModal, submitNewCampaign,
            toggleCampaignStatus, syncRegistrarCor, syncingCor, sendReminders, sendingReminder,
            showEditModal, editForm, savingResponse, openEditResponse, submitEditResponse,
            showProcessModal, processForm, savingProcess, openProcessModal, submitProcessDeduction,
            showCorModal, selectedCorSa, openCorModal,
            showReportModal, reportType, reportDeptFilter, reportFilteredResponses, openReportModal, doPrint,
            coordinatorName, fmtPeso, statusBadgeClass, formatProcStatus, typeLabels, Format
        };
    },

    template: `
    <div class="space-y-6">
        <!-- Page Header -->
        <page-header 
            title="School Balance & Allowance Deduction" 
            subtitle="Monitor official Registrar COR assessments, S.A. scholarship coverage (100% Tuition + 70% Misc), and manage voluntary allowance deduction authorization polls."
            :breadcrumbs="[
                { label: 'Dashboard', to: '/admin/dashboard' },
                { label: 'Allowance', to: '/admin/allowance' },
                { label: 'School Balance & Deductions' }
            ]">
            <template #actions>
                <div class="flex flex-wrap items-center gap-2">
                    <button v-if="activeCampaign" @click="syncRegistrarCor" class="btn btn-outline btn-sm" :disabled="syncingCor">
                        <app-icon :name="syncingCor ? 'LoaderCircle' : 'RefreshCw'" :size="15" :class="syncingCor ? 'animate-spin' : ''" />
                        {{ syncingCor ? 'Syncing COR…' : 'Sync from Registrar COR' }}
                    </button>
                    <button v-if="activeCampaign" @click="openReportModal('SUMMARY')" class="btn btn-outline btn-sm">
                        <app-icon name="Printer" :size="15" /> Print / Reports
                    </button>
                    <button @click="openCreateModal" class="btn btn-primary btn-sm">
                        <app-icon name="Megaphone" :size="15" /> Create Deduction Announcement
                    </button>
                </div>
            </template>
        </page-header>

        <!-- Loading / Error -->
        <div v-if="loading" class="card p-12 text-center text-muted">
            <app-icon name="LoaderCircle" :size="32" class="mx-auto mb-3 animate-spin text-navy" />
            <p class="font-medium text-ink">Loading School Balance & Deduction polls…</p>
        </div>

        <div v-else-if="loadError" class="card border-danger/30 bg-danger/5 p-6 text-danger">
            <div class="flex items-center gap-3">
                <app-icon name="CircleAlert" :size="20" class="shrink-0" />
                <p class="font-medium">{{ loadError }}</p>
            </div>
        </div>

        <!-- No Campaigns State -->
        <div v-else-if="!campaigns.length" class="card p-12 text-center">
            <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-gold/15 text-navy">
                <app-icon name="Megaphone" :size="32" />
            </div>
            <h2 class="text-[18px] font-bold text-navy">No Deduction Announcements Yet</h2>
            <p class="mx-auto mt-2 max-w-md text-body text-muted">
                Create an announcement to poll Student Assistants on whether they authorize deducting their remaining school balance from their monthly allowance.
            </p>
            <button @click="openCreateModal" class="btn btn-primary mt-6">
                <app-icon name="Plus" :size="16" /> Create First Announcement
            </button>
        </div>

        <!-- Active View -->
        <template v-else>
            <!-- Campaign Selector & Status Bar -->
            <div class="card p-4">
                <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="text-caption font-semibold uppercase text-muted">Semester Polls:</span>
                        <div class="flex flex-wrap gap-2">
                            <button v-for="c in campaigns" :key="c.id" 
                                    @click="selectCampaign(c.id)"
                                    class="rounded-lg px-3 py-1.5 text-[13px] font-semibold transition"
                                    :class="activeCampaignId === c.id ? 'bg-navy text-white shadow-sm' : 'bg-mist text-ink hover:bg-mist/80'">
                                {{ c.title }}
                                <span class="ml-1.5 rounded px-1.5 py-0.2 text-[11px]" 
                                      :class="c.status === 'OPEN' ? 'bg-success/20 text-success' : 'bg-gray-200 text-muted'">
                                    {{ c.status }}
                                </span>
                            </button>
                        </div>
                    </div>

                    <div v-if="activeCampaign" class="flex flex-wrap items-center gap-2">
                        <span v-if="activeCampaign.deadline" class="inline-flex items-center gap-1 rounded-md bg-gold/15 px-2.5 py-1 text-[12px] font-medium text-navy">
                            <app-icon name="Calendar" :size="13" />
                            Deadline: <b>{{ Format.date(activeCampaign.deadline) }}</b>
                        </span>
                        <button @click="toggleCampaignStatus" class="btn btn-outline btn-xs">
                            <app-icon :name="activeCampaign.status === 'OPEN' ? 'Lock' : 'Unlock'" :size="13" />
                            {{ activeCampaign.status === 'OPEN' ? 'Close Poll' : 'Re-open Poll' }}
                        </button>
                        <button @click="sendReminders()" class="btn btn-outline btn-xs text-navy" :disabled="sendingReminder || !activeCampaign.metrics?.pendingCount">
                            <app-icon name="Bell" :size="13" />
                            Send Reminders ({{ activeCampaign.metrics?.pendingCount || 0 }})
                        </button>
                    </div>
                </div>
            </div>

            <!-- Enhanced Summary Metrics Cards (2 Rows) -->
            <div v-if="activeCampaign && activeCampaign.metrics" class="space-y-3">
                <!-- Row 1: Registrar COR Assessment & S.A. Scholarship Benefits -->
                <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div class="card p-4">
                        <div class="flex items-center justify-between">
                            <span class="text-caption font-semibold text-muted">Active S.A.s Polled</span>
                            <app-icon name="Users" :size="18" class="text-muted" />
                        </div>
                        <p class="mt-2 text-[26px] font-bold text-navy">{{ activeCampaign.metrics.totalSas }}</p>
                        <p class="text-caption text-muted">Total active in {{ semester?.label || 'Semester' }}</p>
                    </div>

                    <div class="card p-4">
                        <div class="flex items-center justify-between">
                            <span class="text-caption font-semibold text-muted">Total Cash COR Assessment</span>
                            <app-icon name="FileText" :size="18" class="text-muted" />
                        </div>
                        <p class="mt-2 text-[24px] font-bold text-ink">{{ fmtPeso(activeCampaign.metrics.totalCashCor) }}</p>
                        <p class="text-caption text-muted">Authoritative Registrar assessment</p>
                    </div>

                    <div class="card border-emerald-200 bg-emerald-50/40 p-4">
                        <div class="flex items-center justify-between">
                            <span class="text-caption font-semibold text-emerald-900">S.A. Benefit Covered</span>
                            <app-icon name="ShieldCheck" :size="18" class="text-emerald-700" />
                        </div>
                        <p class="mt-2 text-[24px] font-bold text-emerald-700">− {{ fmtPeso(activeCampaign.metrics.totalCoveredBenefit) }}</p>
                        <p class="text-caption text-emerald-800">100% Tuition + 70% Misc coverage</p>
                    </div>

                    <div class="card border-navy/20 bg-navy/5 p-4">
                        <div class="flex items-center justify-between">
                            <span class="text-caption font-semibold text-navy">Total School Balance</span>
                            <app-icon name="Landmark" :size="18" class="text-navy" />
                        </div>
                        <p class="mt-2 text-[24px] font-bold text-navy">{{ fmtPeso(activeCampaign.metrics.totalSchoolBalance) }}</p>
                        <p class="text-caption text-muted">Remaining 30% Misc + Lab/LMS fees</p>
                    </div>
                </div>

                <!-- Row 2: Poll Decisions & Deduction Processing Lifecycle -->
                <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div class="card border-success/30 bg-success/5 p-4">
                        <div class="flex items-center justify-between">
                            <span class="text-caption font-semibold text-success">Answered YES — Deduct</span>
                            <app-icon name="CheckCircle2" :size="18" class="text-success" />
                        </div>
                        <p class="mt-2 text-[24px] font-bold text-success">{{ activeCampaign.metrics.optedInCount }} S.A.s</p>
                        <p class="text-caption text-success font-medium">Authorized: {{ fmtPeso(activeCampaign.metrics.totalOptedInAmount) }}</p>
                    </div>

                    <div class="card p-4">
                        <div class="flex items-center justify-between">
                            <span class="text-caption font-semibold text-muted">Answered NO — Do Not Deduct</span>
                            <app-icon name="XCircle" :size="18" class="text-muted" />
                        </div>
                        <p class="mt-2 text-[24px] font-bold text-ink">{{ activeCampaign.metrics.declinedCount }} S.A.s</p>
                        <p class="text-caption text-muted">Outstanding: {{ fmtPeso(activeCampaign.metrics.totalDeclinedBalance) }}</p>
                    </div>

                    <div class="card p-4">
                        <div class="flex items-center justify-between">
                            <span class="text-caption font-semibold text-warning">Pending Responses</span>
                            <app-icon name="Clock" :size="18" class="text-warning" />
                        </div>
                        <p class="mt-2 text-[24px] font-bold text-warning">{{ activeCampaign.metrics.pendingCount }} S.A.s</p>
                        <p class="text-caption text-muted">Unanswered: {{ fmtPeso(activeCampaign.metrics.totalPendingBalance) }}</p>
                    </div>

                    <div class="card border-gold/30 bg-gold/5 p-4">
                        <div class="flex items-center justify-between">
                            <span class="text-caption font-semibold text-navy">Deduction Processing</span>
                            <app-icon name="CreditCard" :size="18" class="text-gold" />
                        </div>
                        <p class="mt-2 text-[20px] font-bold text-navy">{{ fmtPeso(activeCampaign.metrics.totalProcessedAmount) }}</p>
                        <p class="text-caption text-muted">
                            Awaiting: <b class="text-navy">{{ fmtPeso(activeCampaign.metrics.awaitingProcessingAmount) }}</b>
                        </p>
                    </div>
                </div>
            </div>

            <!-- Announcement Details Card & Data Views -->
            <div v-if="activeCampaign" class="card">
                <!-- Announcement Description & Details -->
                <div class="border-b border-line p-5">
                    <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <div class="flex flex-wrap items-center gap-2">
                                <h2 class="text-card-title text-navy">{{ activeCampaign.title }}</h2>
                                <span class="rounded px-2 py-0.5 text-[11px] font-bold uppercase"
                                      :class="activeCampaign.status === 'OPEN' ? 'bg-success/15 text-success' : 'bg-gray-200 text-muted'">
                                    {{ activeCampaign.status }}
                                </span>
                                <span class="rounded bg-navy/10 px-2 py-0.5 text-[11px] font-semibold text-navy">
                                    {{ typeLabels[activeCampaign.deductionType] || activeCampaign.deductionType }}
                                </span>
                                <span class="rounded bg-mist px-2 py-0.5 text-[11px] font-medium text-ink">
                                    Target: <b>{{ activeCampaign.scopeCategory }}</b>
                                </span>
                            </div>
                            <p v-if="activeCampaign.description" class="mt-1 text-body text-ink">
                                {{ activeCampaign.description }}
                            </p>
                            <p class="mt-1 text-caption text-muted">
                                Posted by {{ activeCampaign.createdByName }} on {{ Format.date(activeCampaign.createdAt) }}
                                <span v-if="activeCampaign.deadline"> · Deadline: <b class="text-ink">{{ Format.date(activeCampaign.deadline) }}</b></span>
                                <span v-if="activeCampaign.defaultAmount > 0"> · Suggested Amount: <b class="text-ink">{{ fmtPeso(activeCampaign.defaultAmount) }}</b></span>
                                <span v-if="activeCampaign.lastSyncedAt"> · Last COR Sync: <b class="text-ink">{{ Format.dateTime(activeCampaign.lastSyncedAt) }}</b></span>
                            </p>
                        </div>
                    </div>
                </div>

                <!-- Nav Tabs for YES, NO, Pending, Processing -->
                <div class="flex flex-wrap items-center justify-between border-b border-line px-5 pt-3 gap-2 bg-mist/30">
                    <div class="flex flex-wrap gap-2">
                        <button @click="activeTab = 'ALL'; page = 1"
                                class="border-b-2 px-3 py-2 text-caption font-semibold transition flex items-center gap-1.5"
                                :class="activeTab === 'ALL' ? 'border-navy text-navy font-bold' : 'border-transparent text-muted hover:text-ink'">
                            <app-icon name="Users" :size="14" />
                            All S.A.s
                            <span class="rounded-full bg-mist px-2 py-0.5 text-[11px] font-bold">{{ tabCounts.all }}</span>
                        </button>

                        <button @click="activeTab = 'YES'; page = 1"
                                class="border-b-2 px-3 py-2 text-caption font-semibold transition flex items-center gap-1.5"
                                :class="activeTab === 'YES' ? 'border-success text-success font-bold' : 'border-transparent text-muted hover:text-success'">
                            <app-icon name="CheckCircle2" :size="14" />
                            YES — Deduct Balance
                            <span class="rounded-full bg-success/15 text-success px-2 py-0.5 text-[11px] font-bold">{{ tabCounts.yes }}</span>
                        </button>

                        <button @click="activeTab = 'NO'; page = 1"
                                class="border-b-2 px-3 py-2 text-caption font-semibold transition flex items-center gap-1.5"
                                :class="activeTab === 'NO' ? 'border-ink text-ink font-bold' : 'border-transparent text-muted hover:text-ink'">
                            <app-icon name="XCircle" :size="14" />
                            NO — Do Not Deduct
                            <span class="rounded-full bg-gray-200 text-ink px-2 py-0.5 text-[11px] font-bold">{{ tabCounts.no }}</span>
                        </button>

                        <button @click="activeTab = 'PENDING'; page = 1"
                                class="border-b-2 px-3 py-2 text-caption font-semibold transition flex items-center gap-1.5"
                                :class="activeTab === 'PENDING' ? 'border-warning text-warning font-bold' : 'border-transparent text-muted hover:text-warning'">
                            <app-icon name="Clock" :size="14" />
                            Pending Response
                            <span class="rounded-full bg-warning/15 text-warning px-2 py-0.5 text-[11px] font-bold">{{ tabCounts.pending }}</span>
                        </button>

                        <button @click="activeTab = 'PROCESSING'; page = 1"
                                class="border-b-2 px-3 py-2 text-caption font-semibold transition flex items-center gap-1.5"
                                :class="activeTab === 'PROCESSING' ? 'border-gold text-navy font-bold' : 'border-transparent text-muted hover:text-navy'">
                            <app-icon name="CreditCard" :size="14" />
                            Deduction Processing
                            <span class="rounded-full bg-gold/20 text-navy px-2 py-0.5 text-[11px] font-bold">{{ tabCounts.processing }}</span>
                        </button>
                    </div>

                    <!-- Department Category Filter -->
                    <div class="flex items-center gap-1.5 pb-2">
                        <span class="text-caption font-medium text-muted">Dept:</span>
                        <div class="inline-flex rounded-lg border border-line bg-mist p-0.5 text-[12px]">
                            <button @click="deptFilter = 'ALL'; page = 1" 
                                    class="rounded px-2.5 py-0.5 font-semibold transition"
                                    :class="deptFilter === 'ALL' ? 'bg-white text-navy shadow-xs' : 'text-muted'">
                                All
                            </button>
                            <button @click="deptFilter = 'ITO'; page = 1" 
                                    class="rounded px-2.5 py-0.5 font-semibold transition"
                                    :class="deptFilter === 'ITO' ? 'bg-white text-navy shadow-xs' : 'text-muted'">
                                ITO
                            </button>
                            <button @click="deptFilter = 'ACADS'; page = 1" 
                                    class="rounded px-2.5 py-0.5 font-semibold transition"
                                    :class="deptFilter === 'ACADS' ? 'bg-white text-navy shadow-xs' : 'text-muted'">
                                ACADS
                            </button>
                            <button @click="deptFilter = 'OFFICE'; page = 1" 
                                    class="rounded px-2.5 py-0.5 font-semibold transition"
                                    :class="deptFilter === 'OFFICE' ? 'bg-white text-navy shadow-xs' : 'text-muted'">
                                OFFICE
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Search and Quick Summary Toolbar -->
                <div class="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div class="relative w-full max-w-sm">
                        <app-icon name="Search" :size="16" class="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                        <input v-model="q" type="text" placeholder="Search S.A. name, student ID, course, COR ref…" 
                               class="w-full rounded-lg border border-line bg-page py-2 pl-9 pr-3 text-body focus:border-navy focus:outline-none" />
                    </div>

                    <div class="flex items-center gap-2">
                        <span class="text-caption text-muted">
                            Showing <b>{{ filteredResponses.length }}</b> of <b>{{ saResponses.length }}</b> Student Assistants
                        </span>
                    </div>
                </div>

                <!-- Main Data Table -->
                <div class="overflow-x-auto">
                    <table class="w-full text-left text-body">
                        <thead class="border-b border-line bg-mist/60 text-caption font-semibold text-muted">
                            <tr>
                                <th class="px-5 py-3">Student Assistant</th>
                                <th class="px-3 py-3">Course & Dept</th>
                                <th class="px-3 py-3 text-right">Total Cash COR</th>
                                <th class="px-3 py-3 text-right text-emerald-800">S.A. Covered (100+70%)</th>
                                <th class="px-3 py-3 text-right">Remaining Balance</th>
                                
                                <template v-if="activeTab === 'YES' || activeTab === 'PROCESSING'">
                                    <th class="px-3 py-3 text-right text-navy font-bold">Authorized Deduct</th>
                                    <th class="px-3 py-3 text-right">Actual Deducted</th>
                                    <th class="px-3 py-3 text-right">Net Balance After</th>
                                    <th class="px-3 py-3">Processing Status</th>
                                </template>

                                <template v-else-if="activeTab === 'NO'">
                                    <th class="px-3 py-3">Poll Decision</th>
                                    <th class="px-3 py-3">Decision Date</th>
                                    <th class="px-3 py-3">Remarks / Notes</th>
                                </template>

                                <template v-else-if="activeTab === 'PENDING'">
                                    <th class="px-3 py-3">Poll Deadline</th>
                                    <th class="px-3 py-3">Status</th>
                                </template>

                                <template v-else>
                                    <th class="px-3 py-3">Decision</th>
                                    <th class="px-3 py-3 text-right">Authorized</th>
                                    <th class="px-3 py-3">Processing</th>
                                </template>

                                <th class="px-4 py-3 text-center">Actions</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-line">
                            <tr v-if="loadingDetails">
                                <td colspan="10" class="p-8 text-center text-muted">
                                    <app-icon name="LoaderCircle" :size="24" class="mx-auto mb-2 animate-spin text-navy" />
                                    Loading Student Assistant records and balances…
                                </td>
                            </tr>
                            <tr v-else-if="!paginatedResponses.length">
                                <td colspan="10" class="p-8 text-center text-muted">
                                    No Student Assistants found matching this view and filter.
                                </td>
                            </tr>
                            <tr v-for="s in paginatedResponses" :key="s.saProfileId" class="hover:bg-mist/30 transition">
                                <!-- Student Assistant Info -->
                                <td class="px-5 py-3">
                                    <p class="font-bold text-ink">{{ s.name }}</p>
                                    <p class="text-caption text-muted flex items-center gap-1.5">
                                        <span>{{ s.studentId }}</span>
                                        <span v-if="s.cor?.referenceNo" class="text-[11px] text-muted">· Ref: {{ s.cor.referenceNo }}</span>
                                    </p>
                                </td>

                                <!-- Course & Department -->
                                <td class="px-3 py-3 text-caption text-ink">
                                    <p class="font-medium">{{ s.course }} · Yr {{ s.yearLevel }}</p>
                                    <span class="inline-block mt-0.5 rounded bg-mist px-2 py-0.5 text-[10px] font-bold text-navy">
                                        {{ s.department }}
                                    </span>
                                </td>

                                <!-- Total Cash COR Assessment -->
                                <td class="px-3 py-3 text-right font-medium text-ink">
                                    {{ fmtPeso(s.cor?.cashTotal) }}
                                </td>

                                <!-- S.A. Scholarship Coverage -->
                                <td class="px-3 py-3 text-right font-medium text-emerald-700">
                                    − {{ fmtPeso(s.benefit?.totalCovered) }}
                                </td>

                                <!-- Remaining School Balance Before Deduction -->
                                <td class="px-3 py-3 text-right font-bold text-navy">
                                    {{ fmtPeso(s.balanceBefore) }}
                                </td>

                                <!-- Columns for YES or PROCESSING view -->
                                <template v-if="activeTab === 'YES' || activeTab === 'PROCESSING'">
                                    <td class="px-3 py-3 text-right font-bold text-success">
                                        {{ fmtPeso(s.authorizedAmount) }}
                                    </td>
                                    <td class="px-3 py-3 text-right font-bold text-ink">
                                        {{ fmtPeso(s.processedAmount) }}
                                    </td>
                                    <td class="px-3 py-3 text-right font-bold"
                                        :class="s.balanceAfter > 0 ? 'text-navy' : 'text-success'">
                                        {{ fmtPeso(s.balanceAfter) }}
                                    </td>
                                    <td class="px-3 py-3">
                                        <span class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold"
                                              :class="statusBadgeClass(s.processingStatus)">
                                            {{ formatProcStatus(s.processingStatus) }}
                                        </span>
                                    </td>
                                </template>

                                <!-- Columns for NO view -->
                                <template v-else-if="activeTab === 'NO'">
                                    <td class="px-3 py-3">
                                        <span class="inline-flex items-center gap-1 rounded-full bg-gray-200 px-2.5 py-0.5 text-[12px] font-semibold text-muted">
                                            <app-icon name="X" :size="13" /> Declined (No)
                                        </span>
                                    </td>
                                    <td class="px-3 py-3 text-caption text-muted">
                                        {{ s.repliedAt ? Format.dateTime(s.repliedAt) : '—' }}
                                    </td>
                                    <td class="px-3 py-3 text-caption text-ink max-w-xs truncate" :title="s.notes">
                                        {{ s.notes || 'Declined allowance deduction; balance payable via Bursar/Cashier' }}
                                    </td>
                                </template>

                                <!-- Columns for PENDING view -->
                                <template v-else-if="activeTab === 'PENDING'">
                                    <td class="px-3 py-3 text-caption text-ink">
                                        {{ activeCampaign.deadline ? Format.date(activeCampaign.deadline) : 'No deadline' }}
                                    </td>
                                    <td class="px-3 py-3">
                                        <span v-if="s.deadlineStatus === 'OVERDUE'" class="inline-flex items-center gap-1 rounded-full bg-danger/15 text-danger px-2.5 py-0.5 text-[11px] font-bold">
                                            <app-icon name="AlertTriangle" :size="12" /> Overdue ({{ Math.abs(s.daysRemaining) }}d ago)
                                        </span>
                                        <span v-else-if="s.deadlineStatus === 'DUE_TODAY'" class="inline-flex items-center gap-1 rounded-full bg-warning/20 text-warning px-2.5 py-0.5 text-[11px] font-bold">
                                            <app-icon name="Clock" :size="12" /> Due Today
                                        </span>
                                        <span v-else-if="s.daysRemaining !== null" class="inline-flex items-center gap-1 rounded-full bg-warning/15 text-warning px-2.5 py-0.5 text-[11px] font-semibold">
                                            <app-icon name="Clock" :size="12" /> {{ s.daysRemaining }} day(s) left
                                        </span>
                                        <span v-else class="inline-flex items-center gap-1 rounded-full bg-gray-100 text-muted px-2.5 py-0.5 text-[11px] font-semibold">
                                            Pending Reply
                                        </span>
                                    </td>
                                </template>

                                <!-- Columns for ALL view -->
                                <template v-else>
                                    <td class="px-3 py-3">
                                        <span v-if="s.choice === 'YES'" class="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[11px] font-bold text-success">
                                            <app-icon name="Check" :size="12" /> YES
                                        </span>
                                        <span v-else-if="s.choice === 'NO'" class="inline-flex items-center gap-1 rounded-full bg-gray-200 px-2 py-0.5 text-[11px] font-semibold text-muted">
                                            <app-icon name="X" :size="12" /> NO
                                        </span>
                                        <span v-else class="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-semibold text-warning">
                                            <app-icon name="Clock" :size="12" /> Pending
                                        </span>
                                    </td>
                                    <td class="px-3 py-3 text-right font-medium">
                                        <span v-if="s.choice === 'YES'" class="font-bold text-navy">{{ fmtPeso(s.authorizedAmount) }}</span>
                                        <span v-else class="text-muted">—</span>
                                    </td>
                                    <td class="px-3 py-3">
                                        <span v-if="s.choice === 'YES'" class="rounded-full border px-2 py-0.5 text-[11px] font-semibold"
                                              :class="statusBadgeClass(s.processingStatus)">
                                            {{ formatProcStatus(s.processingStatus) }}
                                        </span>
                                        <span v-else class="text-caption text-muted">—</span>
                                    </td>
                                </template>

                                <!-- Actions Column -->
                                <td class="px-4 py-3 text-center">
                                    <div class="flex items-center justify-center gap-1">
                                        <!-- View COR Breakdown -->
                                        <button @click="openCorModal(s)" class="btn btn-ghost btn-xs text-navy" title="View official COR Fee Assessment Breakdown">
                                            <app-icon name="Eye" :size="14" />
                                        </button>

                                        <!-- Process Deduction (YES Records) -->
                                        <button v-if="s.choice === 'YES'" @click="openProcessModal(s)" class="btn btn-ghost btn-xs text-emerald-700" title="Process allowance deduction transaction">
                                            <app-icon name="CreditCard" :size="14" />
                                        </button>

                                        <!-- Send Single Reminder (Pending Records) -->
                                        <button v-if="!s.choice" @click="sendReminders(s)" class="btn btn-ghost btn-xs text-amber-700" title="Send in-app reminder to this S.A.">
                                            <app-icon name="Send" :size="14" />
                                        </button>

                                        <!-- Edit / Override Decision -->
                                        <button @click="openEditResponse(s)" class="btn btn-ghost btn-xs text-muted hover:text-navy" title="Edit decision or record override with reason">
                                            <app-icon name="Pencil" :size="14" />
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <!-- Pagination Footer -->
                <div v-if="totalPages > 1" class="flex items-center justify-between border-t border-line px-5 py-3 text-caption text-muted">
                    <span>Showing {{ ((page - 1) * PAGE_SIZE) + 1 }} to {{ Math.min(page * PAGE_SIZE, filteredResponses.length) }} of {{ filteredResponses.length }} records</span>
                    <div class="flex items-center gap-1">
                        <button @click="page--" :disabled="page <= 1" class="btn btn-outline btn-sm px-2 py-1" :class="page <= 1 ? 'opacity-40' : ''">Previous</button>
                        <span class="px-2 font-semibold text-ink">{{ page }} / {{ totalPages }}</span>
                        <button @click="page++" :disabled="page >= totalPages" class="btn btn-outline btn-sm px-2 py-1" :class="page >= totalPages ? 'opacity-40' : ''">Next</button>
                    </div>
                </div>
            </div>
        </template>

        <!-- Modal A: Create Deduction Announcement -->
        <app-modal :open="showNewModal" title="Create Deduction Announcement" @close="showNewModal = false">
            <div class="space-y-4">
                <p class="text-caption text-muted">
                    This poll will be broadcasted to active Student Assistants. They will indicate whether they authorize deducting their school balance from their monthly allowance.
                </p>

                <form-field label="Announcement Title" required>
                    <input v-model="newForm.title" type="text" placeholder="e.g. Tuition Balance Deduction - Prelims AY 2026-2027"
                           class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none" />
                </form-field>

                <div class="grid gap-3 sm:grid-cols-2">
                    <form-field label="Deduction Category" required>
                        <select v-model="newForm.deductionType" class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none">
                            <option value="TUITION">Tuition & School Fee Balance</option>
                        </select>
                    </form-field>

                    <form-field label="Scope / Target Category" required>
                        <select v-model="newForm.scopeCategory" class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none">
                            <option value="ALL">All Active S.A.s</option>
                            <option value="ITO">ITO Category Only</option>
                            <option value="ACADS">ACADS Category Only</option>
                            <option value="OFFICE">OFFICE Category Only</option>
                        </select>
                    </form-field>
                </div>

                <div class="grid gap-3 sm:grid-cols-2">
                    <form-field label="Start / Open Date" required>
                        <input v-model="newForm.startDate" type="date"
                               class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none" />
                    </form-field>

                    <form-field label="Response Deadline (Optional)">
                        <input v-model="newForm.deadline" type="date"
                               class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none" />
                    </form-field>
                </div>

                <form-field label="Suggested / Default Amount (₱)">
                    <input v-model="newForm.defaultAmount" type="number" step="1" min="0" placeholder="500"
                           class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none" />
                    <p class="text-[11px] text-muted mt-1">If set to 0, the S.A.'s remaining school balance will be suggested automatically.</p>
                </form-field>

                <form-field label="Instructions / Message for S.A.s">
                    <textarea v-model="newForm.description" rows="3" placeholder="Please indicate if you wish to deduct your remaining balance from your monthly allowance."
                              class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none"></textarea>
                </form-field>
            </div>

            <template #footer>
                <div class="flex items-center justify-end gap-2">
                    <button @click="showNewModal = false" class="btn btn-outline" :disabled="savingCampaign">Cancel</button>
                    <button @click="submitNewCampaign" class="btn btn-primary" :disabled="savingCampaign">
                        <app-icon :name="savingCampaign ? 'LoaderCircle' : 'Megaphone'" :size="16" :class="savingCampaign ? 'animate-spin' : ''" />
                        {{ savingCampaign ? 'Broadcasting…' : 'Broadcast Announcement' }}
                    </button>
                </div>
            </template>
        </app-modal>

        <!-- Modal B: Edit Deduction Decision (Coordinator Override with Mandatory Reason) -->
        <app-modal :open="showEditModal" :title="'Update Deduction Decision: ' + editForm.name" @close="showEditModal = false">
            <div class="space-y-4">
                <div class="rounded-lg bg-mist/60 p-3 flex items-center justify-between">
                    <div>
                        <p class="font-bold text-navy">{{ editForm.name }}</p>
                        <p class="text-caption text-muted">{{ editForm.studentId }} · Dept: {{ editForm.department }}</p>
                    </div>
                    <div class="text-right">
                        <p class="text-caption text-muted">Remaining Balance</p>
                        <p class="text-body font-bold text-navy">{{ fmtPeso(editForm.balanceBefore) }}</p>
                    </div>
                </div>

                <form-field label="Poll Decision" required>
                    <div class="grid grid-cols-2 gap-3">
                        <label class="flex cursor-pointer items-center gap-2 rounded-lg border p-3 transition"
                                :class="editForm.choice === 'YES' ? 'border-success bg-success/10 font-bold text-success' : 'border-line bg-page text-muted'">
                            <input type="radio" value="YES" v-model="editForm.choice" class="text-success" />
                            <span>YES — Authorize Deduct</span>
                        </label>
                        <label class="flex cursor-pointer items-center gap-2 rounded-lg border p-3 transition"
                                :class="editForm.choice === 'NO' ? 'border-muted bg-gray-100 font-bold text-ink' : 'border-line bg-page text-muted'">
                            <input type="radio" value="NO" v-model="editForm.choice" class="text-navy" />
                            <span>NO — Do Not Deduct</span>
                        </label>
                    </div>
                </form-field>

                <form-field v-if="editForm.choice === 'YES'" label="Authorized Deduction Amount (₱)" required>
                    <input v-model="editForm.amount" type="number" step="0.5" min="0" 
                           class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none" />
                </form-field>

                <form-field v-if="editForm.choice === 'YES'" label="Processing Status">
                    <select v-model="editForm.processingStatus" class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none">
                        <option value="AWAITING_PROCESSING">Awaiting Processing</option>
                        <option value="PROCESSING">Processing</option>
                        <option value="PARTIALLY_PROCESSED">Partially Processed</option>
                        <option value="PROCESSED">Processed / Applied</option>
                        <option value="RETURNED_FOR_CORRECTION">Returned for Correction</option>
                        <option value="CANCELLED">Cancelled</option>
                    </select>
                </form-field>

                <form-field label="Reason for Editing / Override *" required>
                    <textarea v-model="editForm.notes" rows="3" maxlength="200" 
                              placeholder="Please enter reason for overriding or updating this deduction response (minimum 3 characters)..."
                              class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none"></textarea>
                    <p class="text-[11px] text-muted mt-1">This change is recorded in the permanent deduction audit log.</p>
                </form-field>
            </div>

            <template #footer>
                <div class="flex items-center justify-end gap-2">
                    <button @click="showEditModal = false" class="btn btn-outline" :disabled="savingResponse">Cancel</button>
                    <button @click="submitEditResponse" class="btn btn-primary" :disabled="savingResponse">
                        <app-icon :name="savingResponse ? 'LoaderCircle' : 'Check'" :size="16" :class="savingResponse ? 'animate-spin' : ''" />
                        {{ savingResponse ? 'Saving…' : 'Save Changes' }}
                    </button>
                </div>
            </template>
        </app-modal>

        <!-- Modal C: Process Deduction Transaction -->
        <app-modal :open="showProcessModal" :title="'Process Deduction: ' + processForm.name" @close="showProcessModal = false">
            <div class="space-y-4">
                <div class="rounded-lg bg-navy/5 border border-navy/20 p-3.5 flex items-center justify-between">
                    <div>
                        <p class="font-bold text-navy">{{ processForm.name }}</p>
                        <p class="text-caption text-muted">{{ processForm.studentId }} · {{ processForm.department }}</p>
                    </div>
                    <div class="text-right">
                        <p class="text-caption text-muted">Authorized to Deduct</p>
                        <p class="text-body font-bold text-success">{{ fmtPeso(processForm.authorizedAmount) }}</p>
                    </div>
                </div>

                <div class="grid gap-3 sm:grid-cols-2">
                    <form-field label="Amount to Process / Deduct (₱)" required>
                        <input v-model="processForm.processedAmount" type="number" step="0.5" min="0" 
                               class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none font-bold text-navy" />
                    </form-field>

                    <form-field label="Processing Status" required>
                        <select v-model="processForm.status" class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none">
                            <option value="PROCESSED">Processed / Confirmed</option>
                            <option value="PARTIALLY_PROCESSED">Partially Processed</option>
                            <option value="PROCESSING">Processing</option>
                            <option value="RETURNED_FOR_CORRECTION">Returned for Correction</option>
                            <option value="FAILED">Failed</option>
                            <option value="CANCELLED">Cancelled</option>
                        </select>
                    </form-field>
                </div>

                <form-field label="Remarks / Payroll Batch Reference">
                    <textarea v-model="processForm.remarks" rows="2" placeholder="e.g. Deducted from 1st Cutoff Allowance October 2026..."
                              class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none"></textarea>
                </form-field>
            </div>

            <template #footer>
                <div class="flex items-center justify-end gap-2">
                    <button @click="showProcessModal = false" class="btn btn-outline" :disabled="savingProcess">Cancel</button>
                    <button @click="submitProcessDeduction" class="btn btn-primary" :disabled="savingProcess">
                        <app-icon :name="savingProcess ? 'LoaderCircle' : 'CreditCard'" :size="16" :class="savingProcess ? 'animate-spin' : ''" />
                        {{ savingProcess ? 'Processing…' : 'Confirm Deduction' }}
                    </button>
                </div>
            </template>
        </app-modal>

        <!-- Modal D: Registrar COR Fee Assessment Breakdown -->
        <app-modal :open="showCorModal" title="Certificate of Registration (COR) Fee Breakdown" @close="showCorModal = false">
            <div v-if="selectedCorSa" class="space-y-4">
                <!-- Header Info -->
                <div class="rounded-lg bg-mist/60 p-3.5 flex items-center justify-between">
                    <div>
                        <p class="text-body font-bold text-navy">{{ selectedCorSa.name }}</p>
                        <p class="text-caption text-muted">{{ selectedCorSa.studentId }} · {{ selectedCorSa.course }} (Yr {{ selectedCorSa.yearLevel }})</p>
                        <p class="text-caption text-ink mt-0.5">Category: <b>{{ selectedCorSa.category }}</b> ({{ selectedCorSa.department }})</p>
                    </div>
                    <div class="text-right">
                        <span class="rounded bg-navy/10 px-2 py-0.5 text-[11px] font-semibold text-navy">
                            {{ selectedCorSa.cor?.enrollmentStatus || 'Enrolled' }}
                        </span>
                        <p v-if="selectedCorSa.cor?.referenceNo" class="text-caption text-muted mt-1">Ref: <b>{{ selectedCorSa.cor.referenceNo }}</b></p>
                    </div>
                </div>

                <!-- Fee Table Breakdown -->
                <div class="overflow-hidden rounded-lg border border-line">
                    <table class="w-full text-left text-xs">
                        <thead class="bg-mist/80 text-caption font-semibold text-muted border-b border-line">
                            <tr>
                                <th class="px-3 py-2">Assessment Item</th>
                                <th class="px-3 py-2 text-right">Official Fee</th>
                                <th class="px-3 py-2 text-right text-emerald-800">S.A. Scholarship Coverage</th>
                                <th class="px-3 py-2 text-right font-bold text-navy">Net S.A. Payable</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-line">
                            <tr>
                                <td class="px-3 py-2 font-medium">Tuition Fee</td>
                                <td class="px-3 py-2 text-right">{{ fmtPeso(selectedCorSa.cor?.tuitionFee) }}</td>
                                <td class="px-3 py-2 text-right text-emerald-700">100% (− {{ fmtPeso(selectedCorSa.benefit?.tuitionCovered) }})</td>
                                <td class="px-3 py-2 text-right font-bold text-navy">₱0.00</td>
                            </tr>
                            <tr>
                                <td class="px-3 py-2 font-medium">Miscellaneous Fee</td>
                                <td class="px-3 py-2 text-right">{{ fmtPeso(selectedCorSa.cor?.miscFee) }}</td>
                                <td class="px-3 py-2 text-right text-emerald-700">70% (− {{ fmtPeso(selectedCorSa.benefit?.miscCovered) }})</td>
                                <td class="px-3 py-2 text-right font-bold text-navy">{{ fmtPeso((selectedCorSa.cor?.miscFee || 0) * 0.30) }}</td>
                            </tr>
                            <tr v-if="selectedCorSa.cor?.labFee > 0">
                                <td class="px-3 py-2 font-medium">Laboratory Fee</td>
                                <td class="px-3 py-2 text-right">{{ fmtPeso(selectedCorSa.cor?.labFee) }}</td>
                                <td class="px-3 py-2 text-right text-muted">0% (—)</td>
                                <td class="px-3 py-2 text-right font-bold text-navy">{{ fmtPeso(selectedCorSa.cor?.labFee) }}</td>
                            </tr>
                            <tr v-if="selectedCorSa.cor?.lmsFee > 0">
                                <td class="px-3 py-2 font-medium">LMS / Online Learning Fee</td>
                                <td class="px-3 py-2 text-right">{{ fmtPeso(selectedCorSa.cor?.lmsFee) }}</td>
                                <td class="px-3 py-2 text-right text-muted">0% (—)</td>
                                <td class="px-3 py-2 text-right font-bold text-navy">{{ fmtPeso(selectedCorSa.cor?.lmsFee) }}</td>
                            </tr>
                            <tr v-if="selectedCorSa.cor?.nstpFee > 0">
                                <td class="px-3 py-2 font-medium">NSTP Fee</td>
                                <td class="px-3 py-2 text-right">{{ fmtPeso(selectedCorSa.cor?.nstpFee) }}</td>
                                <td class="px-3 py-2 text-right text-muted">0% (—)</td>
                                <td class="px-3 py-2 text-right font-bold text-navy">{{ fmtPeso(selectedCorSa.cor?.nstpFee) }}</td>
                            </tr>
                            <tr v-if="selectedCorSa.cor?.omrFee > 0">
                                <td class="px-3 py-2 font-medium">OMR & Exam Materials Fee</td>
                                <td class="px-3 py-2 text-right">{{ fmtPeso(selectedCorSa.cor?.omrFee) }}</td>
                                <td class="px-3 py-2 text-right text-muted">0% (—)</td>
                                <td class="px-3 py-2 text-right font-bold text-navy">{{ fmtPeso(selectedCorSa.cor?.omrFee) }}</td>
                            </tr>
                        </tbody>
                        <tfoot class="border-t-2 border-line bg-mist/40 font-bold">
                            <tr>
                                <td class="px-3 py-2.5 text-navy">Total Official Assessment</td>
                                <td class="px-3 py-2.5 text-right text-ink">{{ fmtPeso(selectedCorSa.cor?.cashTotal) }}</td>
                                <td class="px-3 py-2.5 text-right text-emerald-800">− {{ fmtPeso(selectedCorSa.benefit?.totalCovered) }}</td>
                                <td class="px-3 py-2.5 text-right text-[14px] text-navy">{{ fmtPeso(selectedCorSa.balanceBefore) }}</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                <!-- Deduction Status Notice -->
                <div class="rounded-lg p-3 text-xs" :class="selectedCorSa.choice === 'YES' ? 'bg-success/10 border border-success/30' : 'bg-gray-100 border border-line'">
                    <p class="font-bold" :class="selectedCorSa.choice === 'YES' ? 'text-success' : 'text-ink'">
                        Poll Status: {{ selectedCorSa.choice === 'YES' ? 'Authorized Allowance Deduction (YES)' : (selectedCorSa.choice === 'NO' ? 'Declined (NO)' : 'Pending Response') }}
                    </p>
                    <p class="mt-1 text-muted">
                        <template v-if="selectedCorSa.choice === 'YES'">
                            Authorized Amount: <b>{{ fmtPeso(selectedCorSa.authorizedAmount) }}</b> · Actual Deducted: <b>{{ fmtPeso(selectedCorSa.processedAmount) }}</b> · Remaining Balance After: <b>{{ fmtPeso(selectedCorSa.balanceAfter) }}</b>
                        </template>
                        <template v-else-if="selectedCorSa.choice === 'NO'">
                            The student assistant declined allowance deduction. The outstanding balance of <b>{{ fmtPeso(selectedCorSa.balanceBefore) }}</b> must be settled via the Cashier/Bursar.
                        </template>
                        <template v-else>
                            The student assistant has not responded to this poll yet. Outstanding balance is <b>{{ fmtPeso(selectedCorSa.balanceBefore) }}</b>.
                        </template>
                    </p>
                </div>
            </div>

            <template #footer>
                <div class="flex items-center justify-end">
                    <button @click="showCorModal = false" class="btn btn-outline btn-sm">Close</button>
                </div>
            </template>
        </app-modal>

        <!-- Modal E: Print / Reports Modal -->
        <app-modal :open="showReportModal" title="Print School Balance & Deduction Reports" @close="showReportModal = false" size="lg">
            <div class="space-y-4">
                <!-- Report Options Header -->
                <div class="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="text-caption font-semibold text-muted">Report Type:</span>
                        <div class="inline-flex rounded-lg border border-line bg-mist p-0.5 text-xs">
                            <button @click="reportType = 'SUMMARY'" class="rounded px-2.5 py-1 font-semibold transition"
                                    :class="reportType === 'SUMMARY' ? 'bg-white text-navy shadow-xs' : 'text-muted'">
                                Summary Report
                            </button>
                            <button @click="reportType = 'YES'" class="rounded px-2.5 py-1 font-semibold transition"
                                    :class="reportType === 'YES' ? 'bg-white text-success shadow-xs' : 'text-muted'">
                                YES Authorization List
                            </button>
                            <button @click="reportType = 'NO_PENDING'" class="rounded px-2.5 py-1 font-semibold transition"
                                    :class="reportType === 'NO_PENDING' ? 'bg-white text-navy shadow-xs' : 'text-muted'">
                                NO & Pending Balances
                            </button>
                            <button @click="reportType = 'MASTERLIST'" class="rounded px-2.5 py-1 font-semibold transition"
                                    :class="reportType === 'MASTERLIST' ? 'bg-white text-navy shadow-xs' : 'text-muted'">
                                Full Masterlist
                            </button>
                        </div>
                    </div>

                    <div class="flex items-center gap-2">
                        <span class="text-caption font-medium text-muted">Dept:</span>
                        <select v-model="reportDeptFilter" class="rounded border border-line bg-page px-2 py-1 text-caption text-ink">
                            <option value="ALL">All Departments</option>
                            <option value="ITO">ITO</option>
                            <option value="ACADS">ACADS</option>
                            <option value="OFFICE">OFFICE</option>
                        </select>
                    </div>
                </div>

                <!-- Printable Report Sheet -->
                <div id="deduction-printable-sheet" class="rounded-lg border border-line bg-white p-6 shadow-sm text-ink font-sans">
                    <!-- Formal Header -->
                    <div class="border-b-2 border-navy pb-4 text-center">
                        <h1 class="text-[18px] font-black tracking-wide text-navy uppercase">National College of Science and Technology</h1>
                        <p class="text-[12px] font-semibold text-muted uppercase">Student Assistant Program · AssistPay Management System</p>
                        <h2 class="mt-2 text-[15px] font-bold text-ink">
                            <template v-if="reportType === 'SUMMARY'">School Balance & Deduction Poll Summary Report</template>
                            <template v-else-if="reportType === 'YES'">Allowance Deduction Authorization Endorsement (YES List)</template>
                            <template v-else-if="reportType === 'NO_PENDING'">Outstanding School Balances Follow-Up List (NO & Pending)</template>
                            <template v-else>Student Assistant School Balance & Deduction Masterlist</template>
                        </h2>
                        <p class="text-[11px] text-muted mt-0.5">
                            {{ activeCampaign?.title }} · {{ semester?.label || 'Active Semester' }} · As of {{ new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) }}
                        </p>
                    </div>

                    <!-- Summary Stats Strip -->
                    <div class="my-4 grid grid-cols-4 gap-2 border border-line bg-mist/40 p-3 text-center text-xs rounded">
                        <div>
                            <p class="text-caption text-muted">Total Polled</p>
                            <p class="text-[14px] font-bold text-navy">{{ activeCampaign?.metrics?.totalSas || 0 }} S.A.s</p>
                        </div>
                        <div>
                            <p class="text-caption text-muted">Total Cash COR</p>
                            <p class="text-[14px] font-bold text-ink">{{ fmtPeso(activeCampaign?.metrics?.totalCashCor) }}</p>
                        </div>
                        <div>
                            <p class="text-caption text-muted">S.A. Covered (100+70%)</p>
                            <p class="text-[14px] font-bold text-emerald-700">− {{ fmtPeso(activeCampaign?.metrics?.totalCoveredBenefit) }}</p>
                        </div>
                        <div>
                            <p class="text-caption text-muted">Net Remaining Balance</p>
                            <p class="text-[14px] font-bold text-navy">{{ fmtPeso(activeCampaign?.metrics?.totalSchoolBalance) }}</p>
                        </div>
                    </div>

                    <!-- Printable Table -->
                    <div class="overflow-x-auto">
                        <table class="w-full text-left text-[11px]">
                            <thead class="border-b border-line bg-mist/80 font-bold text-muted">
                                <tr>
                                    <th class="py-1.5 px-2">#</th>
                                    <th class="py-1.5 px-2">Student ID</th>
                                    <th class="py-1.5 px-2">Student Assistant</th>
                                    <th class="py-1.5 px-2">Dept</th>
                                    <th class="py-1.5 px-2 text-right">Cash COR</th>
                                    <th class="py-1.5 px-2 text-right">S.A. Covered</th>
                                    <th class="py-1.5 px-2 text-right">Net Balance</th>
                                    <th class="py-1.5 px-2 text-center">Decision</th>
                                    <th class="py-1.5 px-2 text-right">Authorized</th>
                                    <th class="py-1.5 px-2 text-right">Deducted</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-line">
                                <tr v-for="(s, idx) in reportFilteredResponses" :key="s.saProfileId">
                                    <td class="py-1.5 px-2 text-muted">{{ idx + 1 }}</td>
                                    <td class="py-1.5 px-2 font-mono font-medium">{{ s.studentId }}</td>
                                    <td class="py-1.5 px-2 font-semibold text-ink">{{ s.name }}</td>
                                    <td class="py-1.5 px-2">{{ s.department }}</td>
                                    <td class="py-1.5 px-2 text-right">{{ fmtPeso(s.cor?.cashTotal) }}</td>
                                    <td class="py-1.5 px-2 text-right text-emerald-800">− {{ fmtPeso(s.benefit?.totalCovered) }}</td>
                                    <td class="py-1.5 px-2 text-right font-bold">{{ fmtPeso(s.balanceBefore) }}</td>
                                    <td class="py-1.5 px-2 text-center font-bold"
                                        :class="s.choice === 'YES' ? 'text-success' : (s.choice === 'NO' ? 'text-ink' : 'text-warning')">
                                        {{ s.choice || 'PENDING' }}
                                    </td>
                                    <td class="py-1.5 px-2 text-right font-semibold">
                                        {{ s.choice === 'YES' ? fmtPeso(s.authorizedAmount) : '—' }}
                                    </td>
                                    <td class="py-1.5 px-2 text-right font-bold text-navy">
                                        {{ s.processedAmount > 0 ? fmtPeso(s.processedAmount) : '—' }}
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <!-- Signatures Block (Dynamic S.A. Coordinator and HR Manager) -->
                    <div class="mt-8 pt-4 border-t border-line grid grid-cols-2 gap-8 text-center text-xs">
                        <div>
                            <p class="text-caption text-muted mb-8">Prepared & Endorsed By:</p>
                            <p class="font-bold text-ink underline text-[13px]">{{ coordinatorName }}</p>
                            <p class="text-caption text-muted">Student Assistant Coordinator</p>
                        </div>
                        <div>
                            <p class="text-caption text-muted mb-8">Noted & Approved By:</p>
                            <div class="mx-auto w-48 border-b border-ink mb-1"></div>
                            <p class="font-bold text-ink text-[13px]">HR Manager</p>
                            <p class="text-caption text-muted">Human Resource Office</p>
                        </div>
                    </div>
                </div>
            </div>

            <template #footer>
                <div class="flex items-center justify-between">
                    <span class="text-caption text-muted">
                        {{ reportFilteredResponses.length }} records included in this report.
                    </span>
                    <div class="flex items-center gap-2">
                        <button @click="showReportModal = false" class="btn btn-outline btn-sm">Close</button>
                        <button @click="doPrint" class="btn btn-primary btn-sm">
                            <app-icon name="Printer" :size="15" /> Print Report
                        </button>
                    </div>
                </div>
            </template>
        </app-modal>
    </div>
    `
};
