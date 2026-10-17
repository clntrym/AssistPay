// SA Attendance Violation, Three-Level Warning History, Memo & Under Agreement Panel
// Embedded in Admin SA Profile (sa-detail.js) and SA My Profile (my-profile.js).

const SaDisciplinaryPanel = {
    components: {
        AppIcon, AppModal, StatusBadge,
        DisciplinaryMemoModal, UnderAgreementModal
    },
    props: {
        saProfileId: { type: Number, required: true },
        canManage: { type: Boolean, default: false },
        isSaOwner: { type: Boolean, default: false }
    },
    emits: ["statusChanged"],

    setup(props, { emit }) {
        const loading = Vue.ref(true);
        const busy = Vue.ref(false);
        const error = Vue.ref("");

        const disciplinaryStatus = Vue.ref("GOOD_STANDING");
        const underAgreementAt = Vue.ref(null);
        const assignmentStatus = Vue.ref("UNASSIGNED");
        const selectedSemesterId = Vue.ref(0);
        const semesters = Vue.ref([]);
        const escalationMode = Vue.ref("CONTINUE_ACROSS_SEMESTERS");
        const categorySummary = Vue.ref([]);
        const incidents = Vue.ref([]);
        const warnings = Vue.ref([]);
        const agreements = Vue.ref([]);

        // Warning History Filters (Section 4 requirements)
        const filterSemester = Vue.ref("ALL");
        const filterAcademicYear = Vue.ref("ALL");
        const filterCategory = Vue.ref("ALL");
        const filterLevel = Vue.ref("ALL");

        // Modals
        const activeWarningModal = Vue.ref(null);
        const activeAgreementModal = Vue.ref(null);
        const recordModalOpen = Vue.ref(false);
        const showIncidentsLog = Vue.ref(false);

        const incidentForm = Vue.reactive({
            category: "LATES",
            incidentDate: new Date().toISOString().slice(0, 10),
            scheduledStart: "08:00",
            scheduledEnd: "12:00",
            actualTimeIn: "",
            actualTimeOut: "",
            minutesAffected: 15,
            evidenceNotes: ""
        });

        const load = async (semId = null) => {
            loading.value = true;
            error.value = "";
            const payload = { saProfileId: props.saProfileId };
            if (semId || selectedSemesterId.value) {
                payload.semesterId = semId || selectedSemesterId.value;
            }
            const r = await Model.request("violations", "sa_disciplinary_profile", payload);
            loading.value = false;
            if (!r.success) {
                error.value = r.message || "Could not load disciplinary records.";
                return;
            }
            disciplinaryStatus.value = r.disciplinaryStatus || "GOOD_STANDING";
            underAgreementAt.value = r.underAgreementAt || null;
            assignmentStatus.value = r.assignmentStatus || "UNASSIGNED";
            selectedSemesterId.value = r.selectedSemesterId || 0;
            semesters.value = r.semesters || [];
            escalationMode.value = r.escalationMode || "CONTINUE_ACROSS_SEMESTERS";
            categorySummary.value = r.categorySummary || [];
            incidents.value = r.incidents || [];
            warnings.value = r.warnings || [];
            agreements.value = r.agreements || [];
            emit("statusChanged", {
                disciplinaryStatus: disciplinaryStatus.value,
                underAgreementAt: underAgreementAt.value
            });
        };

        Vue.onMounted(() => load());
        Vue.watch(() => props.saProfileId, () => load());

        const onSemesterChange = () => {
            load(selectedSemesterId.value);
        };

        const academicYears = Vue.computed(() => {
            const set = new Set();
            semesters.value.forEach(s => { if (s.academicYear) set.add(s.academicYear); });
            warnings.value.forEach(w => { if (w.academicYear) set.add(w.academicYear); });
            return [...set].sort().reverse();
        });

        const filteredWarnings = Vue.computed(() => {
            return warnings.value.filter(w => {
                if (filterSemester.value !== "ALL" && Number(w.semesterId) !== Number(filterSemester.value)) return false;
                if (filterAcademicYear.value !== "ALL" && w.academicYear !== filterAcademicYear.value) return false;
                if (filterCategory.value !== "ALL" && w.violationCategory !== filterCategory.value) return false;
                if (filterLevel.value !== "ALL" && w.warningLevel !== filterLevel.value) return false;
                return true;
            });
        });

        const filteredIncidents = Vue.computed(() => {
            if (!selectedSemesterId.value) return incidents.value;
            return incidents.value.filter(i => Number(i.semesterId) === Number(selectedSemesterId.value));
        });

        const latestAgreement = Vue.computed(() => agreements.value[0] || null);

        const openRecordIncident = (cat = "LATES") => {
            incidentForm.category = cat;
            incidentForm.incidentDate = new Date().toISOString().slice(0, 10);
            incidentForm.scheduledStart = "08:00";
            incidentForm.scheduledEnd = "12:00";
            incidentForm.actualTimeIn = cat === "LATES" ? "08:20" : "";
            incidentForm.actualTimeOut = cat === "UNDERTIME" ? "11:30" : "";
            incidentForm.minutesAffected = (cat === "LATES" || cat === "UNDERTIME") ? 20 : 0;
            incidentForm.evidenceNotes = "";
            recordModalOpen.value = true;
        };

        const submitIncident = async () => {
            busy.value = true;
            const r = await Model.request("violations", "record_incident", {
                saProfileId: props.saProfileId,
                semesterId: selectedSemesterId.value,
                category: incidentForm.category,
                incidentDate: incidentForm.incidentDate,
                scheduledStart: incidentForm.scheduledStart || null,
                scheduledEnd: incidentForm.scheduledEnd || null,
                actualTimeIn: incidentForm.actualTimeIn || null,
                actualTimeOut: incidentForm.actualTimeOut || null,
                minutesAffected: incidentForm.minutesAffected || 0,
                evidenceNotes: incidentForm.evidenceNotes
            });
            busy.value = false;
            if (!r.success) {
                Alerts.error("Couldn't record violation", r.message);
                return;
            }
            recordModalOpen.value = false;
            if (r.wasDuplicate) {
                Store.toast("info", "Attendance incident for that date/category was already on file; record updated without creating duplicate warnings.");
            } else if (r.evaluation?.evaluatedWarnings?.length) {
                Store.toast("warning", "Allowed chances exceeded! A warning evaluation and draft memo have been generated for review.");
            } else {
                Store.toast("success", "Attendance violation incident recorded.");
            }
            await load(selectedSemesterId.value);
        };

        const runReevaluation = async () => {
            busy.value = true;
            const r = await Model.request("violations", "evaluate_sa", {
                saProfileId: props.saProfileId,
                semesterId: selectedSemesterId.value
            });
            busy.value = false;
            if (!r.success) {
                Alerts.error("Evaluation failed", r.message);
                return;
            }
            Store.toast("success", "Attendance violations re-evaluated against semester thresholds.");
            await load(selectedSemesterId.value);
        };

        const correctOrVoidIncident = async (inc, targetStatus) => {
            const labelText = targetStatus === "CORRECTED" ? "Mark as Corrected" : "Void Incident";
            const reason = await Alerts.prompt({
                title: `${labelText} (${inc.categoryLabel} on ${Format.date(inc.incidentDate)})?`,
                text: "The attendance record will be updated and any pending warning evaluations will be re-evaluated automatically while preserving the audit trail.",
                inputLabel: "Reason for correction / voiding",
                placeholder: "e.g. Approved DTR adjustment / biometric log verified by supervisor",
                confirmText: labelText,
                validate: v => (!v || v.trim().length < 4) ? "Enter a brief explanation (at least 4 characters)." : null
            });
            if (reason === null) return;

            busy.value = true;
            const r = await Model.request("violations", "update_incident", {
                incidentId: inc.id,
                status: targetStatus,
                correctionNotes: reason.trim()
            });
            busy.value = false;
            if (!r.success) {
                Alerts.error("Update failed", r.message);
                return;
            }
            Store.toast("success", `Attendance record marked ${targetStatus.toLowerCase()} and warnings re-evaluated.`);
            await load(selectedSemesterId.value);
        };

        const restoreIncident = async (inc) => {
            busy.value = true;
            const r = await Model.request("violations", "update_incident", {
                incidentId: inc.id,
                status: "VALID",
                correctionNotes: "Re-validated by S.A. Coordinator"
            });
            busy.value = false;
            if (!r.success) {
                Alerts.error("Update failed", r.message);
                return;
            }
            Store.toast("success", "Attendance incident restored to Valid.");
            await load(selectedSemesterId.value);
        };

        const clearWarningFilters = () => {
            filterSemester.value = "ALL";
            filterAcademicYear.value = "ALL";
            filterCategory.value = "ALL";
            filterLevel.value = "ALL";
        };

        const openPrintMemo = (memoId) => {
            window.open(`api/memo_print.php?type=memo&id=${memoId}`, "_blank", "noopener");
        };

        const openPrintAgreement = (uaId) => {
            window.open(`api/memo_print.php?type=agreement&id=${uaId}`, "_blank", "noopener");
        };

        return {
            loading, busy, error,
            disciplinaryStatus, underAgreementAt, assignmentStatus,
            selectedSemesterId, semesters, escalationMode,
            categorySummary, incidents, warnings, agreements,
            filterSemester, filterAcademicYear, filterCategory, filterLevel,
            academicYears, filteredWarnings, filteredIncidents, latestAgreement,
            activeWarningModal, activeAgreementModal, recordModalOpen, showIncidentsLog,
            incidentForm,
            load, onSemesterChange, openRecordIncident, submitIncident,
            runReevaluation, correctOrVoidIncident, restoreIncident,
            clearWarningFilters, openPrintMemo, openPrintAgreement,
            Format, label
        };
    },

    template: `
    <div class="mt-4 space-y-4">
        <!-- 1. Disciplinary Status & Under Agreement Management Banner -->
        <section class="card p-5" :class="disciplinaryStatus === 'UNDER_AGREEMENT' ? 'border-danger/40 bg-danger/5' : ''">
            <div class="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
                <div class="flex items-start gap-3.5">
                    <span class="grid h-11 w-11 shrink-0 place-items-center rounded-xl"
                          :class="disciplinaryStatus === 'UNDER_AGREEMENT' ? 'bg-danger/15 text-danger'
                                : (disciplinaryStatus === 'GOOD_STANDING' ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning')">
                        <app-icon :name="disciplinaryStatus === 'UNDER_AGREEMENT' ? 'FileWarning' : (disciplinaryStatus === 'GOOD_STANDING' ? 'ShieldCheck' : 'TriangleAlert')" :size="22" />
                    </span>
                    <div>
                        <div class="flex flex-wrap items-center gap-2">
                            <h2 class="text-h3 font-semibold text-navy">Disciplinary &amp; Attendance Standing</h2>
                            <status-badge group="disciplinaryStatus" :value="disciplinaryStatus" />
                            <status-badge group="assignmentStatus" :value="assignmentStatus" />
                        </div>
                        <p class="mt-1 text-[12px] text-muted">
                            Disciplinary status is tracked independently from duty assignment status so an S.A. placed <b>Under Agreement</b> retains their active assignment when permitted by institutional policy.
                        </p>
                        <p v-if="underAgreementAt" class="mt-1 text-[12px] font-semibold text-danger">
                            Placed Under Agreement Effective: {{ Format.date(underAgreementAt) }}
                        </p>
                    </div>
                </div>

                <!-- Semester Selector + Actions -->
                <div class="flex flex-wrap items-center gap-2">
                    <select v-if="semesters.length" v-model="selectedSemesterId" @change="onSemesterChange"
                            class="input w-auto py-1.5 text-[13px]" aria-label="Select semester for violation counts">
                        <option v-for="s in semesters" :key="s.id" :value="s.id">
                            {{ s.label }} {{ s.status === 'ACTIVE' ? '(Active)' : '' }}
                        </option>
                    </select>
                    <button v-if="canManage" type="button" @click="openRecordIncident('LATES')" class="btn btn-primary btn-sm">
                        <app-icon name="PlusCircle" :size="14" /> Record Violation
                    </button>
                    <button v-if="canManage" type="button" @click="runReevaluation" :disabled="busy" class="btn btn-secondary btn-sm">
                        <app-icon name="RefreshCw" :size="14" /> Evaluate Policy
                    </button>
                </div>
            </div>

            <!-- Under Agreement Active / Pending Review Card -->
            <div v-if="latestAgreement" class="mt-4 rounded-xl border border-danger/30 bg-white p-4 shadow-sm">
                <div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                    <div>
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="text-[12px] font-bold uppercase tracking-wider text-danger">Under Agreement Record</span>
                            <span class="font-mono text-[12px] font-bold text-navy">{{ latestAgreement.agreementRefNo }}</span>
                            <status-badge group="agreementStatus" :value="latestAgreement.status" />
                        </div>
                        <p class="mt-1 text-[13px] text-ink">{{ latestAgreement.reason }}</p>
                        <div class="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
                            <span>Effective Date: <b class="text-ink">{{ Format.date(latestAgreement.effectiveDate) }}</b></span>
                            <span>Approver: <b class="text-ink">{{ latestAgreement.approverName }}</b></span>
                            <span v-if="latestAgreement.signedAt">Signed: <b class="text-ink">{{ Format.date(latestAgreement.signedAt) }}</b></span>
                            <span v-if="latestAgreement.completedAt">Completed: <b class="text-ink">{{ Format.date(latestAgreement.completedAt) }}</b></span>
                        </div>
                    </div>
                    <div class="flex flex-wrap items-center gap-2 shrink-0">
                        <button type="button" @click="activeAgreementModal = latestAgreement" class="btn btn-primary btn-sm">
                            <app-icon name="FileCheck" :size="14" />
                            {{ canManage ? (latestAgreement.status === 'PENDING_APPROVAL' ? 'Review & Approve Agreement' : 'Manage Agreement') : 'View / Sign Agreement' }}
                        </button>
                        <button type="button" @click="openPrintAgreement(latestAgreement.id)" class="btn btn-secondary btn-sm">
                            <app-icon name="Printer" :size="14" /> Print Agreement
                        </button>
                    </div>
                </div>
            </div>
        </section>

        <!-- 2. Semester Attendance Violation Chances & Counts -->
        <section class="card p-5">
            <div class="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
                <div>
                    <h3 class="text-h3 font-semibold text-navy">Semester Attendance Violation Chances</h3>
                    <p class="text-caption text-muted">
                        Violation counts and chances apply to the selected semester and reset at the start of every new semester without deleting historical warnings.
                    </p>
                </div>
                <button type="button" @click="showIncidentsLog = !showIncidentsLog" class="btn btn-secondary btn-sm self-start sm:self-auto">
                    <app-icon name="ListChecks" :size="14" />
                    {{ showIncidentsLog ? 'Hide Attendance Incident Log' : 'Attendance Incident Log (' + filteredIncidents.length + ')' }}
                </button>
            </div>

            <div v-if="loading" class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div v-for="n in 5" :key="n" class="h-24 animate-pulse rounded-xl bg-page"></div>
            </div>

            <div v-else class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div v-for="c in categorySummary" :key="c.category"
                     class="rounded-xl border p-3.5 transition-shadow"
                     :class="c.exceeded ? 'border-danger/40 bg-danger/5' : 'border-line bg-white'">
                    <div class="flex items-center justify-between gap-2">
                        <span class="text-[13px] font-bold text-navy">{{ c.label }}</span>
                        <span class="rounded-full px-2 py-0.5 text-[11px] font-bold"
                              :class="c.exceeded ? 'bg-danger text-white' : (c.recordedCount === c.allowedChances ? 'bg-warning/20 text-warning' : 'bg-mist text-navy')">
                            {{ c.recordedCount }} / {{ c.allowedChances }}
                        </span>
                    </div>
                    <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-page">
                        <div class="h-full rounded-full transition-all duration-300"
                             :class="c.exceeded ? 'bg-danger' : (c.recordedCount >= c.allowedChances ? 'bg-warning' : 'bg-navy')"
                             :style="{ width: Math.min(100, c.allowedChances > 0 ? Math.round((c.recordedCount / c.allowedChances) * 100) : 100) + '%' }"></div>
                    </div>
                    <div class="mt-2 flex items-center justify-between text-[11px]">
                        <span v-if="c.exceeded" class="font-semibold text-danger">Exceeded by {{ c.recordedCount - c.allowedChances }}</span>
                        <span v-else class="text-muted">{{ c.remainingChances }} chance(s) left</span>
                        <button v-if="canManage" type="button" @click="openRecordIncident(c.category)"
                                class="font-semibold text-navy hover:underline">+ Log</button>
                    </div>
                </div>
            </div>

            <!-- Collapsible Recorded Attendance Incidents Log (with Correction / Void Audit Trail) -->
            <div v-if="showIncidentsLog" class="mt-5 border-t border-line pt-4">
                <div class="mb-2 flex items-center justify-between">
                    <h4 class="text-[13px] font-bold text-navy">Recorded Attendance Violation Incidents (Selected Semester)</h4>
                    <span class="text-[11px] text-muted">Corrected or voided records trigger automatic warning re-evaluation while preserving the audit trail.</span>
                </div>
                <div v-if="!filteredIncidents.length" class="rounded-lg border border-dashed border-line py-6 text-center text-caption text-muted">
                    No attendance violation incidents recorded for this semester.
                </div>
                <div v-else class="overflow-x-auto rounded-lg border border-line">
                    <table class="w-full text-left text-[12px]">
                        <thead class="bg-page text-muted font-semibold">
                            <tr>
                                <th class="px-3 py-2">Incident Date</th>
                                <th class="px-3 py-2">Category</th>
                                <th class="px-3 py-2">Shift / Time Log</th>
                                <th class="px-3 py-2">Evidence / Correction Notes</th>
                                <th class="px-3 py-2">Status</th>
                                <th v-if="canManage" class="px-3 py-2 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-line">
                            <tr v-for="inc in filteredIncidents" :key="inc.id" :class="inc.status !== 'VALID' ? 'bg-page/60 text-muted' : ''">
                                <td class="whitespace-nowrap px-3 py-2 font-medium text-ink">{{ Format.date(inc.incidentDate) }}</td>
                                <td class="px-3 py-2 font-semibold">{{ inc.categoryLabel }}</td>
                                <td class="px-3 py-2">
                                    <span v-if="inc.scheduledStart">{{ inc.scheduledStart }}–{{ inc.scheduledEnd }}</span>
                                    <span v-if="inc.actualTimeIn || inc.actualTimeOut" class="block text-[11px] text-muted">
                                        Logged: {{ inc.actualTimeIn || 'No In' }} / {{ inc.actualTimeOut || 'No Out' }}
                                    </span>
                                    <span v-if="inc.minutesAffected > 0" class="text-[11px] text-danger font-medium">({{ inc.minutesAffected }} mins)</span>
                                </td>
                                <td class="px-3 py-2">
                                    <div>{{ inc.evidenceNotes || '—' }}</div>
                                    <div v-if="inc.correctionNotes" class="mt-0.5 text-[11px] font-medium text-info">
                                        Correction note: {{ inc.correctionNotes }}
                                    </div>
                                </td>
                                <td class="px-3 py-2">
                                    <status-badge group="incidentStatus" :value="inc.status" />
                                </td>
                                <td v-if="canManage" class="whitespace-nowrap px-3 py-2 text-right">
                                    <template v-if="inc.status === 'VALID'">
                                        <button type="button" @click="correctOrVoidIncident(inc, 'CORRECTED')"
                                                class="text-[11px] font-semibold text-navy hover:underline mr-2">Correct</button>
                                        <button type="button" @click="correctOrVoidIncident(inc, 'VOIDED')"
                                                class="text-[11px] font-semibold text-danger hover:underline">Void</button>
                                    </template>
                                    <button v-else type="button" @click="restoreIncident(inc)"
                                            class="text-[11px] font-semibold text-success hover:underline">Restore</button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </section>

        <!-- 3. Warning History & Tracking Section (with Semester, AY, Category & Level Filters) -->
        <section class="card p-5">
            <div class="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
                <div>
                    <h3 class="text-h3 font-semibold text-navy">Warning History &amp; Memo Tracking</h3>
                    <p class="text-caption text-muted">
                        Complete historical log of First, Second, and Third Warnings, issued memos, and Under Agreement status across all semesters.
                    </p>
                </div>

                <!-- Filters: Semester, Academic Year, Violation Category, Warning Level -->
                <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <select v-model="filterSemester" class="input py-1.5 text-[12px]" aria-label="Filter by semester">
                        <option value="ALL">All semesters</option>
                        <option v-for="s in semesters" :key="s.id" :value="s.id">{{ s.label }}</option>
                    </select>
                    <select v-model="filterAcademicYear" class="input py-1.5 text-[12px]" aria-label="Filter by academic year">
                        <option value="ALL">All academic years</option>
                        <option v-for="ay in academicYears" :key="ay" :value="ay">AY {{ ay }}</option>
                    </select>
                    <select v-model="filterCategory" class="input py-1.5 text-[12px]" aria-label="Filter by violation category">
                        <option value="ALL">All categories</option>
                        <option value="LATES">Lates</option>
                        <option value="EXCUSE_SLIP">Excuse Slip</option>
                        <option value="AWOL">AWOL</option>
                        <option value="NTI_NTO">NTI/NTO</option>
                        <option value="UNDERTIME">Undertime</option>
                    </select>
                    <select v-model="filterLevel" class="input py-1.5 text-[12px]" aria-label="Filter by warning level">
                        <option value="ALL">All warning levels</option>
                        <option value="FIRST_WARNING">First Warning</option>
                        <option value="SECOND_WARNING">Second Warning</option>
                        <option value="THIRD_WARNING">Third Warning</option>
                    </select>
                </div>
            </div>

            <div v-if="!filteredWarnings.length" class="mt-4 rounded-xl border border-dashed border-line py-10 text-center">
                <app-icon name="ShieldCheck" :size="26" class="mx-auto text-success" />
                <p class="mt-2 text-body font-medium text-ink">No disciplinary warnings match the selected filters</p>
                <p class="mt-0.5 text-caption text-muted">Warnings are generated automatically when an S.A. exceeds the allowed chances for a violation category.</p>
                <button v-if="filterSemester !== 'ALL' || filterAcademicYear !== 'ALL' || filterCategory !== 'ALL' || filterLevel !== 'ALL'"
                        type="button" @click="clearWarningFilters" class="btn btn-secondary btn-sm mt-3">Clear filters</button>
            </div>

            <div v-else class="mt-4 overflow-x-auto rounded-xl border border-line">
                <table class="w-full min-w-[920px] text-left text-[13px]">
                    <thead class="bg-page text-caption font-semibold text-muted">
                        <tr>
                            <th class="px-3 py-2.5">Warning Level</th>
                            <th class="px-3 py-2.5">Violation Category</th>
                            <th class="px-3 py-2.5">Incident Date(s)</th>
                            <th class="px-3 py-2.5">Semester &amp; AY</th>
                            <th class="px-3 py-2.5">Memo Ref. No.</th>
                            <th class="px-3 py-2.5">Date Issued</th>
                            <th class="px-3 py-2.5">Approved By</th>
                            <th class="px-3 py-2.5">Memo Status</th>
                            <th class="px-3 py-2.5">Under Agreement</th>
                            <th class="px-3 py-2.5 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-line">
                        <tr v-for="w in filteredWarnings" :key="w.id"
                            :class="w.evaluationStatus === 'RECALLED' ? 'bg-page/60 opacity-75' : 'hover:bg-mist/40'">
                            <td class="px-3 py-2.5">
                                <status-badge group="warningLevel" :value="w.warningLevel" />
                            </td>
                            <td class="px-3 py-2.5">
                                <span class="font-semibold text-ink">{{ w.violationCategoryLabel }}</span>
                                <span class="block text-[11px] text-muted">{{ w.recordedOccurrences }} / {{ w.allowedChances }} chances</span>
                            </td>
                            <td class="px-3 py-2.5">
                                <span class="text-ink">{{ Format.date(w.latestIncidentDate) }}</span>
                                <span v-if="w.incidentDates && w.incidentDates.length > 1" class="block text-[11px] text-muted">
                                    {{ w.incidentDates.length }} incident dates
                                </span>
                            </td>
                            <td class="px-3 py-2.5">
                                <span class="font-medium text-ink">{{ w.semesterLabel }}</span>
                                <span class="block text-[11px] text-muted">AY {{ w.academicYear }}</span>
                            </td>
                            <td class="px-3 py-2.5 font-mono text-[12px] font-semibold text-navy">
                                {{ w.memo ? w.memo.memoRefNo : '—' }}
                            </td>
                            <td class="px-3 py-2.5">
                                {{ w.memo && w.memo.issuedDate ? Format.date(w.memo.issuedDate) : '—' }}
                            </td>
                            <td class="px-3 py-2.5">
                                <span v-if="w.approvedByName" class="text-ink font-medium">{{ w.approvedByName }}</span>
                                <span v-else class="text-muted text-[12px]">Pending Approval</span>
                            </td>
                            <td class="px-3 py-2.5">
                                <status-badge v-if="w.evaluationStatus === 'RECALLED'" group="memoStatus" value="RECALLED" />
                                <status-badge v-else-if="w.memo" group="memoStatus" :value="w.memo.status" />
                                <status-badge v-else group="memoStatus" :value="w.evaluationStatus" />
                                <span v-if="w.recallReason" class="mt-0.5 block text-[11px] text-muted" :title="w.recallReason">Recalled on correction</span>
                            </td>
                            <td class="px-3 py-2.5">
                                <template v-if="w.underAgreement">
                                    <status-badge group="agreementStatus" :value="w.underAgreement.status" />
                                </template>
                                <span v-else class="text-[12px] text-muted">N/A</span>
                            </td>
                            <td class="whitespace-nowrap px-3 py-2.5 text-right">
                                <div class="inline-flex items-center gap-1">
                                    <button v-if="w.memo" type="button" @click="activeWarningModal = w" class="btn btn-secondary btn-sm">
                                        <app-icon :name="canManage && w.evaluationStatus === 'PENDING_REVIEW' ? 'CheckCircle2' : 'FileText'" :size="14" />
                                        {{ canManage && w.evaluationStatus === 'PENDING_REVIEW' ? 'Review & Approve' : 'Memo' }}
                                    </button>
                                    <button v-if="w.memo" type="button" @click="openPrintMemo(w.memo.id)"
                                            class="btn btn-secondary btn-sm" title="Print Memo">
                                        <app-icon name="Printer" :size="14" />
                                    </button>
                                    <button v-if="w.underAgreement" type="button" @click="activeAgreementModal = w.underAgreement"
                                            class="btn btn-secondary btn-sm" title="Manage Under Agreement">
                                        <app-icon name="FileWarning" :size="14" /> Agreement
                                    </button>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>

        <!-- Record Attendance Violation Incident Modal (Coordinator) -->
        <app-modal :open="recordModalOpen" title="Record S.A. Attendance Violation Incident" @close="recordModalOpen = false">
            <form @submit.prevent="submitIncident" class="space-y-4">
                <div class="grid gap-3 sm:grid-cols-2">
                    <div>
                        <label class="field-label">Violation Category</label>
                        <select v-model="incidentForm.category" class="input" required>
                            <option value="LATES">Lates</option>
                            <option value="EXCUSE_SLIP">Excuse Slip</option>
                            <option value="AWOL">AWOL (Absence Without Official Leave)</option>
                            <option value="NTI_NTO">NTI/NTO (No Time In / No Time Out)</option>
                            <option value="UNDERTIME">Undertime</option>
                        </select>
                    </div>
                    <div>
                        <label class="field-label">Incident Date</label>
                        <input v-model="incidentForm.incidentDate" type="date" class="input" required />
                    </div>
                </div>

                <div class="grid gap-3 sm:grid-cols-2">
                    <div>
                        <label class="field-label">Scheduled Duty Start (Optional)</label>
                        <input v-model="incidentForm.scheduledStart" type="time" class="input" />
                    </div>
                    <div>
                        <label class="field-label">Scheduled Duty End (Optional)</label>
                        <input v-model="incidentForm.scheduledEnd" type="time" class="input" />
                    </div>
                </div>

                <div class="grid gap-3 sm:grid-cols-3">
                    <div>
                        <label class="field-label">Actual Time-In</label>
                        <input v-model="incidentForm.actualTimeIn" type="time" class="input" />
                    </div>
                    <div>
                        <label class="field-label">Actual Time-Out</label>
                        <input v-model="incidentForm.actualTimeOut" type="time" class="input" />
                    </div>
                    <div>
                        <label class="field-label">Minutes Late / Undertime</label>
                        <input v-model.number="incidentForm.minutesAffected" type="number" min="0" max="600" class="input" />
                    </div>
                </div>

                <div>
                    <label class="field-label">Attendance Evidence / DTR Remarks</label>
                    <input v-model="incidentForm.evidenceNotes" type="text" class="input"
                           placeholder="e.g. Biometric DTR log #412 — arrived 20 mins past grace period" />
                </div>

                <div class="flex justify-end gap-2 border-t border-line pt-3">
                    <button type="button" @click="recordModalOpen = false" class="btn btn-secondary btn-sm">Cancel</button>
                    <button type="submit" :disabled="busy" class="btn btn-primary btn-sm">
                        <app-icon name="Save" :size="14" /> Save Incident &amp; Evaluate Chances
                    </button>
                </div>
            </form>
        </app-modal>

        <!-- Warning Memo Review / Edit / Print Modal -->
        <disciplinary-memo-modal
            :open="!!activeWarningModal"
            :warning="activeWarningModal"
            :can-manage="canManage"
            :is-sa-owner="isSaOwner"
            @close="activeWarningModal = null"
            @saved="load(selectedSemesterId)"
        />

        <!-- Under Agreement Review / Approval / Print Modal -->
        <under-agreement-modal
            :open="!!activeAgreementModal"
            :agreement="activeAgreementModal"
            :can-manage="canManage"
            :is-sa-owner="isSaOwner"
            @close="activeAgreementModal = null"
            @saved="load(selectedSemesterId)"
        />
    </div>
    `
};

