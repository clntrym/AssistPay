// Reusable Modals for Official Warning Memorandums (1st, 2nd, 3rd Warning)
// and Student Assistant "Under Agreement" Probationary Documents.

const DisciplinaryMemoModal = {
    components: { AppIcon, AppModal, StatusBadge },
    props: {
        open: { type: Boolean, default: false },
        warning: { type: Object, default: null },
        canManage: { type: Boolean, default: false },
        isSaOwner: { type: Boolean, default: false }
    },
    emits: ["close", "saved"],

    setup(props, { emit }) {
        const editing = Vue.ref(false);
        const busy = Vue.ref(false);
        const approveUaToo = Vue.ref(false);

        const form = Vue.reactive({
            issuedDate: "",
            subjectLine: "",
            explanationBody: "",
            applicablePolicy: "",
            correctiveAction: "",
            coordinatorName: "",
            coordinatorTitle: "S.A. Coordinator",
            status: "PENDING_REVIEW"
        });

        const memo = Vue.computed(() => props.warning?.memo || null);

        const syncForm = () => {
            const m = memo.value;
            if (!m) return;
            form.issuedDate = m.issuedDate || new Date().toISOString().slice(0, 10);
            form.subjectLine = m.subjectLine || "";
            form.explanationBody = m.explanationBody || "";
            form.applicablePolicy = m.applicablePolicy || "";
            form.correctiveAction = m.correctiveAction || "";
            form.coordinatorName = m.coordinatorName || "S.A. Coordinator";
            form.coordinatorTitle = m.coordinatorTitle || "S.A. Coordinator";
            form.status = m.status || "PENDING_REVIEW";
            approveUaToo.value = false;
            editing.value = false;
        };

        Vue.watch(() => props.warning, syncForm, { immediate: true });

        const saveEdits = async () => {
            if (!memo.value) return;
            busy.value = true;
            const r = await Model.request("violations", "update_memo", {
                memoId: memo.value.id,
                issuedDate: form.issuedDate,
                subjectLine: form.subjectLine,
                explanationBody: form.explanationBody,
                applicablePolicy: form.applicablePolicy,
                correctiveAction: form.correctiveAction,
                coordinatorName: form.coordinatorName,
                coordinatorTitle: form.coordinatorTitle,
                status: form.status
            });
            busy.value = false;
            if (!r.success) {
                Alerts.error("Couldn't save memo", r.message);
                return;
            }
            Store.toast("success", "Warning memo changes saved.");
            editing.value = false;
            emit("saved");
        };

        const approveAndIssue = async () => {
            if (!props.warning) return;
            const ok = await Alerts.confirm({
                title: `Approve & Issue ${props.warning.warningLevelLabel}?`,
                text: props.warning.warningLevel === "THIRD_WARNING"
                    ? "This will issue the official Third Warning Memorandum and flag the S.A. for Under Agreement status."
                    : `This will finalize and issue the ${props.warning.warningLevelLabel} Memorandum (${memo.value?.memoRefNo || ""}).`,
                icon: "warning",
                confirmText: "Approve & Issue Memo"
            });
            if (!ok) return;

            busy.value = true;
            const r = await Model.request("violations", "approve_warning", {
                warningId: props.warning.id,
                issuedDate: form.issuedDate,
                explanationBody: form.explanationBody,
                applicablePolicy: form.applicablePolicy,
                correctiveAction: form.correctiveAction,
                status: "ISSUED",
                approveUnderAgreement: approveUaToo.value
            });
            busy.value = false;
            if (!r.success) {
                Alerts.error("Approval failed", r.message);
                return;
            }
            Store.toast("success", `${props.warning.warningLevelLabel} Memorandum issued.`);
            emit("saved");
            emit("close");
        };

        const acknowledgeMemo = async () => {
            if (!memo.value) return;
            busy.value = true;
            const r = await Model.request("violations", "acknowledge_memo", {
                memoId: memo.value.id,
                acknowledgedDate: new Date().toISOString().slice(0, 10)
            });
            busy.value = false;
            if (!r.success) {
                Alerts.error("Couldn't acknowledge memo", r.message);
                return;
            }
            Store.toast("success", "Memorandum marked as acknowledged.");
            emit("saved");
            emit("close");
        };

        const openPrintWindow = () => {
            if (!memo.value) return;
            window.open(`api/memo_print.php?type=memo&id=${memo.value.id}`, "_blank", "noopener");
        };

        return {
            editing, busy, form, memo, approveUaToo,
            saveEdits, approveAndIssue, acknowledgeMemo, openPrintWindow,
            Format, label
        };
    },

    template: `
    <app-modal :open="open" :title="warning ? warning.warningLevelLabel + ' Memorandum' : 'Warning Memorandum'"
               size="xl" @close="$emit('close')">
        <template v-if="warning && memo">
            <!-- Action Toolbar -->
            <div class="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-page px-3.5 py-2.5">
                <div class="flex flex-wrap items-center gap-2">
                    <span class="font-mono text-[12px] font-bold text-navy">{{ memo.memoRefNo }}</span>
                    <status-badge group="warningLevel" :value="warning.warningLevel" />
                    <status-badge group="memoStatus" :value="memo.status" />
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <button v-if="canManage && warning.evaluationStatus !== 'RECALLED'"
                            type="button" @click="editing = !editing" class="btn btn-secondary btn-sm">
                        <app-icon :name="editing ? 'Eye' : 'Pencil'" :size="14" />
                        {{ editing ? 'Preview Letter' : 'Review & Edit Memo' }}
                    </button>
                    <button type="button" @click="openPrintWindow" class="btn btn-secondary btn-sm">
                        <app-icon name="Printer" :size="14" /> Printable Document
                    </button>
                </div>
            </div>

            <!-- Coordinator Edit Mode -->
            <div v-if="editing && canManage" class="space-y-4 rounded-xl border border-line bg-white p-4">
                <div class="grid gap-3 sm:grid-cols-3">
                    <div>
                        <label class="field-label">Date of Issuance</label>
                        <input v-model="form.issuedDate" type="date" class="input" />
                    </div>
                    <div>
                        <label class="field-label">Memo Status</label>
                        <select v-model="form.status" class="input">
                            <option value="DRAFT">Draft</option>
                            <option value="PENDING_REVIEW">Pending Review</option>
                            <option value="APPROVED">Approved</option>
                            <option value="ISSUED">Issued</option>
                        </select>
                    </div>
                    <div>
                        <label class="field-label">Signatory Coordinator Name</label>
                        <input v-model="form.coordinatorName" type="text" class="input" />
                    </div>
                </div>

                <div>
                    <label class="field-label">Subject Line</label>
                    <input v-model="form.subjectLine" type="text" class="input" />
                </div>

                <div>
                    <label class="field-label">Explanation of Violation &amp; Reason for Warning</label>
                    <textarea v-model="form.explanationBody" rows="4" class="input"></textarea>
                    <p class="mt-1 text-[11px] text-muted">Generated strictly from recorded attendance incidents. Review before final issuance.</p>
                </div>

                <div>
                    <label class="field-label">Applicable Institutional Policy / Rule</label>
                    <textarea v-model="form.applicablePolicy" rows="2" class="input"></textarea>
                </div>

                <div>
                    <label class="field-label">Required Corrective Action &amp; Expectations</label>
                    <textarea v-model="form.correctiveAction" rows="3" class="input"></textarea>
                </div>

                <div class="flex justify-end gap-2 border-t border-line pt-3">
                    <button type="button" @click="editing = false" class="btn btn-secondary btn-sm">Cancel Edit</button>
                    <button type="button" @click="saveEdits" :disabled="busy" class="btn btn-primary btn-sm">
                        <app-icon name="Save" :size="14" /> Save Memo Changes
                    </button>
                </div>
            </div>

            <!-- Official Printable Memo Letter Preview -->
            <div v-else class="rounded-xl border border-line bg-white p-6 shadow-sm">
                <!-- Institutional Header -->
                <div class="flex items-center justify-center gap-4 border-b-2 border-navy pb-4 text-center">
                    <img src="assets/logo-96.png" alt="NCST Logo" class="h-14 w-14 object-contain" />
                    <div>
                        <h3 class="text-[16px] font-bold uppercase tracking-wide text-navy">National College of Science and Technology</h3>
                        <p class="text-[12px] text-muted">Amafel Building, Aguinaldo Highway, Dasmariñas City, Cavite</p>
                        <p class="text-[12px] font-semibold text-ink">Office of the Student Assistant Coordinator — AssistPay System</p>
                    </div>
                </div>

                <!-- Memo Header Block -->
                <div class="mt-4 grid gap-2 rounded-lg border border-line bg-page/60 p-3.5 text-[13px] sm:grid-cols-2">
                    <div><span class="font-semibold text-muted">MEMO REF. NO.:</span> <span class="font-mono font-bold text-navy">{{ memo.memoRefNo }}</span></div>
                    <div><span class="font-semibold text-muted">DATE OF ISSUANCE:</span> <span class="font-medium text-ink">{{ Format.date(form.issuedDate || memo.issuedDate) }}</span></div>
                    <div><span class="font-semibold text-muted">TO (S.A. NAME):</span> <span class="font-bold text-ink">{{ memo.recipientName }}</span> ({{ memo.studentNumber }}<span v-if="memo.saNumber"> · {{ memo.saNumber }}</span>)</div>
                    <div><span class="font-semibold text-muted">COURSE &amp; YEAR:</span> <span class="text-ink">{{ memo.courseYear }}</span></div>
                    <div><span class="font-semibold text-muted">ASSIGNED OFFICE:</span> <span class="text-ink">{{ memo.assignedOffice }}</span></div>
                    <div><span class="font-semibold text-muted">SEMESTER:</span> <span class="text-ink">{{ memo.semesterLabel }}</span></div>
                    <div class="sm:col-span-2"><span class="font-semibold text-muted">SUBJECT:</span> <span class="font-bold text-navy">{{ form.subjectLine || memo.subjectLine }}</span></div>
                </div>

                <!-- Violation Summary & Evidence -->
                <div class="mt-4 space-y-3 text-[13px] leading-relaxed text-ink">
                    <div class="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-3">
                        <div>
                            <span class="block text-[11px] font-semibold uppercase text-muted">Warning Level</span>
                            <span class="font-bold text-navy">{{ warning.warningLevelLabel }}</span>
                        </div>
                        <div>
                            <span class="block text-[11px] font-semibold uppercase text-muted">Violation Category</span>
                            <span class="font-bold text-ink">{{ warning.violationCategoryLabel }}</span>
                        </div>
                        <div>
                            <span class="block text-[11px] font-semibold uppercase text-muted">Allowed Chances vs. Recorded</span>
                            <span class="font-bold text-danger">{{ memo.recordedOccurrences }} recorded / {{ memo.allowedChances }} allowed</span>
                        </div>
                    </div>

                    <div>
                        <h4 class="text-[12px] font-bold uppercase tracking-wider text-navy">Incident Dates &amp; Official Attendance Evidence</h4>
                        <pre class="mt-1 whitespace-pre-wrap rounded-lg border border-line bg-page p-3 font-mono text-[12px] text-ink">{{ memo.attendanceRecordsText }}</pre>
                    </div>

                    <div v-if="memo.previousWarningsText && warning.warningLevel !== 'FIRST_WARNING'">
                        <h4 class="text-[12px] font-bold uppercase tracking-wider text-navy">Relevant Previous Warning(s)</h4>
                        <p class="mt-1 rounded-lg border border-warning/30 bg-warning/5 p-2.5 text-[12px] text-ink">{{ memo.previousWarningsText }}</p>
                    </div>

                    <div>
                        <h4 class="text-[12px] font-bold uppercase tracking-wider text-navy">Explanation of Violation &amp; Reason for Warning</h4>
                        <p class="mt-1 whitespace-pre-line">{{ form.explanationBody }}</p>
                    </div>

                    <div>
                        <h4 class="text-[12px] font-bold uppercase tracking-wider text-navy">Applicable Institutional Policy / Rule</h4>
                        <p class="mt-1 font-medium">{{ form.applicablePolicy }}</p>
                    </div>

                    <div>
                        <h4 class="text-[12px] font-bold uppercase tracking-wider text-navy">Required Corrective Action &amp; Expectations</h4>
                        <p class="mt-1 whitespace-pre-line">{{ form.correctiveAction }}</p>
                    </div>

                    <!-- Third Warning Under Agreement Option -->
                    <div v-if="warning.warningLevel === 'THIRD_WARNING'" class="rounded-lg border border-danger/30 bg-danger/5 p-3">
                        <div class="flex items-start gap-2.5">
                            <app-icon name="FileWarning" :size="18" class="mt-0.5 shrink-0 text-danger" />
                            <div class="flex-1">
                                <p class="font-semibold text-danger">Third Warning — Under Agreement Review Triggered</p>
                                <p class="mt-0.5 text-[12px] text-ink">
                                    Reaching the Third Warning flags this Student Assistant for <b>Under Agreement</b> status without automatically terminating or deactivating their assignment.
                                </p>
                                <label v-if="canManage && warning.evaluationStatus === 'PENDING_REVIEW'" class="mt-2 inline-flex items-center gap-2 text-[12px] font-semibold text-navy cursor-pointer">
                                    <input type="checkbox" v-model="approveUaToo" class="rounded border-line text-navy focus:ring-navy" />
                                    Also approve Under Agreement status &amp; generate agreement for S.A. signature now
                                </label>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Signature & Acknowledgment Section -->
                <div class="mt-6 grid gap-6 border-t border-line pt-4 text-[12px] sm:grid-cols-2">
                    <div>
                        <p class="font-semibold text-muted">Issued &amp; Approved By:</p>
                        <div class="mt-6 border-t border-ink pt-1.5">
                            <p class="font-bold text-ink">{{ form.coordinatorName || memo.coordinatorName }}</p>
                            <p class="text-muted">{{ form.coordinatorTitle || memo.coordinatorTitle }}</p>
                        </div>
                    </div>
                    <div>
                        <p class="font-semibold text-muted">S.A. Acknowledgment &amp; Signature:</p>
                        <div class="mt-6 border-t border-ink pt-1.5">
                            <p class="font-bold text-ink">{{ memo.recipientName }}</p>
                            <p class="text-muted">
                                Date Acknowledged:
                                <b class="text-ink">{{ memo.acknowledgedAt ? Format.date(memo.acknowledgedAt) : 'Pending Acknowledgment' }}</b>
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Modal Footer Actions -->
            <div class="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                <button type="button" @click="$emit('close')" class="btn btn-secondary btn-sm">Close</button>
                <div class="flex flex-wrap items-center gap-2">
                    <button v-if="(canManage || isSaOwner) && (memo.status === 'ISSUED' || memo.status === 'APPROVED') && !memo.acknowledgedAt"
                            type="button" @click="acknowledgeMemo" :disabled="busy" class="btn btn-secondary btn-sm">
                        <app-icon name="CheckCheck" :size="14" />
                        {{ isSaOwner ? 'Acknowledge Receipt of Memo' : 'Record S.A. Acknowledgment' }}
                    </button>
                    <button v-if="canManage && (warning.evaluationStatus === 'PENDING_REVIEW' || memo.status === 'DRAFT' || memo.status === 'PENDING_REVIEW')"
                            type="button" @click="approveAndIssue" :disabled="busy" class="btn btn-primary btn-sm">
                        <app-icon name="ShieldCheck" :size="14" /> Approve &amp; Issue Warning Memo
                    </button>
                </div>
            </div>
        </template>
    </app-modal>
    `
};

const UnderAgreementModal = {
    components: { AppIcon, AppModal, StatusBadge },
    props: {
        open: { type: Boolean, default: false },
        agreement: { type: Object, default: null },
        canManage: { type: Boolean, default: false },
        isSaOwner: { type: Boolean, default: false }
    },
    emits: ["close", "saved"],

    setup(props, { emit }) {
        const busy = Vue.ref(false);
        const form = Vue.reactive({
            effectiveDate: "",
            endDate: "",
            reason: "",
            conditionsText: "",
            agreementStatus: "PENDING_SIGNATURE",
            remarks: ""
        });

        Vue.watch(() => props.agreement, (ua) => {
            if (!ua) return;
            form.effectiveDate = ua.effectiveDate || new Date().toISOString().slice(0, 10);
            form.endDate = ua.endDate || "";
            form.reason = ua.reason || "";
            form.conditionsText = ua.conditionsText || "";
            form.agreementStatus = ua.status === "PENDING_APPROVAL" ? "PENDING_SIGNATURE" : (ua.status || "PENDING_SIGNATURE");
            form.remarks = ua.remarks || "";
        }, { immediate: true });

        const approveAgreement = async () => {
            if (!props.agreement) return;
            const ok = await Alerts.confirm({
                title: "Approve Under Agreement Status?",
                text: `This will set ${props.agreement.saName}'s disciplinary status to UNDER AGREEMENT effective ${form.effectiveDate} while keeping their current duty assignment active.`,
                icon: "warning",
                confirmText: "Approve & Set Under Agreement"
            });
            if (!ok) return;

            busy.value = true;
            const r = await Model.request("violations", "approve_under_agreement", {
                agreementId: props.agreement.id,
                effectiveDate: form.effectiveDate,
                endDate: form.endDate || null,
                reason: form.reason,
                conditionsText: form.conditionsText,
                agreementStatus: form.agreementStatus,
                remarks: form.remarks
            });
            busy.value = false;
            if (!r.success) {
                Alerts.error("Couldn't approve Under Agreement", r.message);
                return;
            }
            Store.toast("success", "Under Agreement status approved and document generated.");
            emit("saved");
            emit("close");
        };

        const updateStatus = async (targetStatus) => {
            if (!props.agreement) return;
            busy.value = true;
            const r = await Model.request("violations", "update_agreement_status", {
                agreementId: props.agreement.id,
                status: targetStatus,
                remarks: form.remarks
            });
            busy.value = false;
            if (!r.success) {
                Alerts.error("Update failed", r.message);
                return;
            }
            Store.toast("success", `Agreement status updated to ${label("agreementStatus", targetStatus)}.`);
            emit("saved");
            emit("close");
        };

        const openPrint = () => {
            if (!props.agreement) return;
            window.open(`api/memo_print.php?type=agreement&id=${props.agreement.id}`, "_blank", "noopener");
        };

        return { busy, form, approveAgreement, updateStatus, openPrint, Format, label };
    },

    template: `
    <app-modal :open="open" title="Under Agreement Probationary Management" size="xl" @close="$emit('close')">
        <template v-if="agreement">
            <div class="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-page px-3.5 py-2.5">
                <div class="flex flex-wrap items-center gap-2">
                    <span class="font-mono text-[12px] font-bold text-navy">{{ agreement.agreementRefNo }}</span>
                    <status-badge group="agreementStatus" :value="agreement.status" />
                    <span class="text-[12px] text-muted">S.A.: <b class="text-ink">{{ agreement.saName }}</b> ({{ agreement.studentNumber }})</span>
                </div>
                <button type="button" @click="openPrint" class="btn btn-secondary btn-sm">
                    <app-icon name="Printer" :size="14" /> Print Agreement Document
                </button>
            </div>

            <div class="space-y-4">
                <div class="grid gap-3 sm:grid-cols-3">
                    <div>
                        <label class="field-label">Effective Date</label>
                        <input v-model="form.effectiveDate" type="date" class="input" :disabled="!canManage" />
                    </div>
                    <div>
                        <label class="field-label">Effectivity End Date</label>
                        <input v-model="form.endDate" type="date" class="input" :disabled="!canManage" />
                    </div>
                    <div>
                        <label class="field-label">Agreement Document Status</label>
                        <select v-model="form.agreementStatus" class="input" :disabled="!canManage">
                            <option value="PENDING_SIGNATURE">Pending Signature</option>
                            <option value="SIGNED">Signed</option>
                            <option value="COMPLETED">Completed</option>
                        </select>
                    </div>
                </div>

                <div>
                    <label class="field-label">Reason for Placement Under Agreement</label>
                    <textarea v-model="form.reason" rows="2" class="input" :disabled="!canManage"></textarea>
                </div>

                <div>
                    <label class="field-label">Probationary Terms, Conditions &amp; Expectations</label>
                    <textarea v-model="form.conditionsText" rows="5" class="input" :disabled="!canManage"></textarea>
                </div>

                <div>
                    <label class="field-label">Coordinator Remarks / Tracking Notes</label>
                    <input v-model="form.remarks" type="text" class="input" placeholder="Optional compliance or signature verification notes" :disabled="!canManage" />
                </div>

                <div class="grid gap-3 rounded-lg border border-line bg-page/60 p-3 text-[12px] sm:grid-cols-3">
                    <div>
                        <span class="text-muted">Authorized Approver:</span>
                        <b class="mt-0.5 block text-ink">{{ agreement.approverName || 'Pending Coordinator Approval' }}</b>
                    </div>
                    <div>
                        <span class="text-muted">Date Signed by S.A.:</span>
                        <b class="mt-0.5 block text-ink">{{ agreement.signedAt ? Format.date(agreement.signedAt) : 'Not signed yet' }}</b>
                    </div>
                    <div>
                        <span class="text-muted">Date Completed:</span>
                        <b class="mt-0.5 block text-ink">{{ agreement.completedAt ? Format.date(agreement.completedAt) : 'In progress' }}</b>
                    </div>
                </div>
            </div>

            <div class="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                <button type="button" @click="$emit('close')" class="btn btn-secondary btn-sm">Close</button>
                <div class="flex flex-wrap items-center gap-2">
                    <button v-if="isSaOwner && agreement.status === 'PENDING_SIGNATURE'"
                            type="button" @click="updateStatus('SIGNED')" :disabled="busy" class="btn btn-primary btn-sm">
                        <app-icon name="PenTool" :size="14" /> Sign &amp; Acknowledge Under Agreement
                    </button>
                    <template v-if="canManage">
                        <button v-if="agreement.status === 'PENDING_SIGNATURE'"
                                type="button" @click="updateStatus('SIGNED')" :disabled="busy" class="btn btn-secondary btn-sm">
                            <app-icon name="FileCheck" :size="14" /> Mark as Signed
                        </button>
                        <button v-if="agreement.status === 'SIGNED'"
                                type="button" @click="updateStatus('COMPLETED')" :disabled="busy" class="btn btn-secondary btn-sm">
                            <app-icon name="CircleCheck" :size="14" /> Mark Agreement Completed
                        </button>
                        <button type="button" @click="approveAgreement" :disabled="busy" class="btn btn-primary btn-sm">
                            <app-icon name="ShieldCheck" :size="14" />
                            {{ agreement.status === 'PENDING_APPROVAL' ? 'Approve Under Agreement Status' : 'Save Agreement Updates' }}
                        </button>
                    </template>
                </div>
            </div>
        </template>
    </app-modal>
    `
};

