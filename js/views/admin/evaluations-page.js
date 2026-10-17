// NCST Student Assistant Performance Evaluation Module — Three-Layer Interface & Five-Step Workflow
// Strictly preserves the 5-step workflow:
// 1. Supervisor Evaluation — Supervisor completes ratings, comments, observations, recommendation, and submission/signature.
// 2. S.A. Review and Acknowledgment — Student Assistant reads the evaluation, acknowledges receipt, and may submit a response or comments.
// 3. Coordinator Review — Coordinator reviews the Supervisor's assessment, S.A.'s response, and relevant records.
// 4. Final Decision — Coordinator records the final decision, rationale, and effective date when applicable.
// 5. Finalized Evaluation — System saves the final record, notifies relevant parties, and allows the S.A. to view the finalized evaluation and disclosed feedback.

const EVALUATION_CRITERIA = [
    { id: 1, title: "Quality of Work", desc: "Assures precision, attention to detail, and consistency of results in the work environment." },
    { id: 2, title: "Personality", desc: "Shows right manners and good attitude in the performance of assigned tasks." },
    { id: 3, title: "Job Knowledge", desc: "Shows a comprehensive understanding of the knowledge required to complete job responsibilities." },
    { id: 4, title: "Dependability", desc: "Ability to find ways and means to carry out duties and responsibilities reliably." },
    { id: 5, title: "Ability to Improve", desc: "Takes constructive feedback to improve performance. Open to new methods." },
    { id: 6, title: "Relationship with Others", desc: "Develops good, harmonious relationships towards supervisors and peers." },
    { id: 7, title: "Comprehension", desc: "Ability to work with accuracy and with least supervision." },
    { id: 8, title: "Initiative", desc: "Has the capability to continue tasks without being explicitly told every detail." },
    { id: 9, title: "Creativity", desc: "Shares new ideas and methods for task optimization." },
    { id: 10, title: "Attendance and Punctuality", desc: "Productivity in attendance and proper observance of official office hours." }
];

const RATING_OPTIONS = [
    { val: 4, label: "Above Average", color: "emerald" },
    { val: 3, label: "Satisfactory", color: "blue" },
    { val: 2, label: "Below Average", color: "amber" },
    { val: 1, label: "Unsatisfactory", color: "rose" }
];

const EXTENSION_REASON_CATEGORIES = [
    "Class or examination conflict",
    "Scheduled duty conflict",
    "Illness",
    "Emergency or urgent personal situation",
    "Absence from campus",
    "Technical or account access problem",
    "Other valid reason"
];

const EVALUATION_PROCESS_STEPS = [
    {
        step: 1,
        title: "1. Supervisor Evaluation",
        responsibleRole: "Immediate Supervisor",
        desc: "Supervisor completes assessment criteria (1–10) ratings and overall performance score."
    },
    {
        step: 2,
        title: "2. Recommended Decision",
        responsibleRole: "Immediate Supervisor",
        desc: "Auto-detected recommendation (Retain, Improvement Plan, Reassignment, or Non-Renewal) with supervisor rationale and e-signature."
    },
    {
        step: 3,
        title: "3. S.A. Review & Acknowledgment",
        responsibleRole: "Student Assistant",
        desc: "Student Assistant reviews criteria (1–10) & supervisor assessment, and electronically signs acknowledgment."
    },
    {
        step: 4,
        title: "4. Coordinator Review",
        responsibleRole: "S.A. Coordinator",
        desc: "Coordinator reviews recommendation and has authority to approve final decision, return for revision, or reject."
    },
    {
        step: 5,
        title: "5. Finalized Evaluation",
        responsibleRole: "System / All Parties",
        desc: "System completes, locks, and preserves the finalized evaluation record."
    }
];

function sanitizeEvalText(val) {
    if (!val) return "";
    return String(val)
        .replace(/'/g, "’")
        .replace(/["`;<>\\]/g, "")
        .trim();
}

function getStepInfo(status, hasDraft = false) {
    switch (status) {
        case "PENDING":
            return {
                step: hasDraft ? 2 : 1,
                stepTitle: hasDraft ? "Step 2: Recommended Decision" : "Step 1: Supervisor Evaluation",
                shortStep: hasDraft ? "Step 2 of 5" : "Step 1 of 5",
                responsibleRole: "Immediate Supervisor",
                subLabel: hasDraft ? "Draft Saved by Supervisor" : "Awaiting Supervisor Evaluation"
            };
        case "RETURNED_FOR_REVISION":
            return {
                step: 1,
                stepTitle: "Step 1: Supervisor Evaluation",
                shortStep: "Step 1 of 5",
                responsibleRole: "Immediate Supervisor",
                subLabel: "Returned for Clarification / Revision"
            };
        case "FOR_SA_REVIEW":
            return {
                step: 3,
                stepTitle: "Step 3: S.A. Review & Acknowledgment",
                shortStep: "Step 3 of 5",
                responsibleRole: "Student Assistant",
                subLabel: "Awaiting S.A. Review & Acknowledgment"
            };
        case "FOR_COORDINATOR_REVIEW":
        case "FOR_FINAL_DECISION":
            return {
                step: 4,
                stepTitle: "Step 4: Coordinator Review",
                shortStep: "Step 4 of 5",
                responsibleRole: "S.A. Coordinator",
                subLabel: "Pending Coordinator Review & Approval"
            };
        case "REJECTED":
            return {
                step: 4,
                stepTitle: "Step 4: Coordinator Review (Rejected)",
                shortStep: "Step 4 of 5",
                responsibleRole: "S.A. Coordinator",
                subLabel: "Recommendation Rejected by Coordinator"
            };
        case "FINALIZED":
            return {
                step: 5,
                stepTitle: "Step 5: Finalized Evaluation",
                shortStep: "Step 5 of 5",
                responsibleRole: "Completed",
                subLabel: "Authorized & Preserved"
            };
        default:
            return {
                step: 1,
                stepTitle: "Step 1: Supervisor Evaluation",
                shortStep: "Step 1 of 5",
                responsibleRole: "Immediate Supervisor",
                subLabel: "Pending"
            };
    }
}

// Distinct visual badges for: Completed, In Progress, Awaiting Action, Returned, and Overdue
function workflowStatusBadge(ev, viewerRole = "ADMIN") {
    if (!ev) {
        return { label: "Awaiting Action", detail: "Pending", cls: "bg-amber-100 text-amber-900 border border-amber-300", icon: "Clock", category: "AWAITING_ACTION" };
    }
    const status = ev.status || "PENDING";
    const ackStatus = ev.acknowledgmentStatus || "PENDING";
    const isOverdue = Boolean(ev.isAckOverdue) || ackStatus === "OVERDUE_AWAITING_SA" || ackStatus === "OVERDUE_AWAITING_COORDINATOR";

    if (status === "FINALIZED") {
        return {
            label: "Completed",
            detail: "Finalized Evaluation",
            cls: "bg-emerald-100 text-emerald-800 border border-emerald-300",
            icon: "CheckCircle2",
            category: "COMPLETED"
        };
    }
    if (status === "REJECTED") {
        return {
            label: "Rejected",
            detail: "Recommendation Rejected",
            cls: "bg-rose-100 text-rose-800 border border-rose-300",
            icon: "XCircle",
            category: "REJECTED"
        };
    }
    if (status === "RETURNED_FOR_REVISION" || ackStatus === "RETURNED_FOR_REVISION") {
        return {
            label: "Returned",
            detail: "Returned for Clarification",
            cls: "bg-orange-100 text-orange-900 border border-orange-300",
            icon: "RotateCcw",
            category: "RETURNED"
        };
    }
    if (isOverdue && status === "FOR_SA_REVIEW") {
        return {
            label: "Overdue",
            detail: "S.A. Acknowledgment Overdue",
            cls: "bg-rose-100 text-rose-800 border border-rose-300",
            icon: "TriangleAlert",
            category: "OVERDUE"
        };
    }

    // Role-aware Awaiting Action vs In Progress
    if (viewerRole === "SUPERVISOR") {
        if (status === "PENDING") {
            if (ev.hasDraft) {
                return {
                    label: "In Progress",
                    detail: `Draft (${ev.answeredCriteriaCount || 0}/10 rated)`,
                    cls: "bg-blue-100 text-blue-800 border border-blue-300",
                    icon: "FileEdit",
                    category: "IN_PROGRESS"
                };
            }
            return {
                label: "Awaiting Action",
                detail: "Needs Your Evaluation",
                cls: "bg-amber-100 text-amber-900 border border-amber-300",
                icon: "ClipboardEdit",
                category: "AWAITING_ACTION"
            };
        }
        return {
            label: "In Progress",
            detail: status === "FOR_SA_REVIEW" ? "With Student Assistant" : "With S.A. Coordinator",
            cls: "bg-blue-100 text-blue-800 border border-blue-300",
            icon: "Clock",
            category: "IN_PROGRESS"
        };
    }

    if (viewerRole === "SA") {
        if (status === "FOR_SA_REVIEW") {
            return {
                label: "Awaiting Action",
                detail: ackStatus === "EXTENSION_REQUESTED" ? "Extension Requested" : "Needs Your Acknowledgment",
                cls: "bg-amber-100 text-amber-900 border border-amber-300",
                icon: "PenTool",
                category: "AWAITING_ACTION"
            };
        }
        return {
            label: "In Progress",
            detail: status === "PENDING" ? "With Immediate Supervisor" : "Under Coordinator Review",
            cls: "bg-blue-100 text-blue-800 border border-blue-300",
            icon: "Clock",
            category: "IN_PROGRESS"
        };
    }

    // Default / ADMIN (Coordinator) perspective
    if (status === "FOR_COORDINATOR_REVIEW" || status === "FOR_FINAL_DECISION" || ackStatus === "EXTENSION_REQUESTED" || ev.supervisorRevisionRequest) {
        return {
            label: "Awaiting Action",
            detail: status === "FOR_FINAL_DECISION"
                ? "Ready for Final Decision"
                : (ackStatus === "EXTENSION_REQUESTED" ? "Extension Request Pending" : "Ready for Coordinator Review"),
            cls: "bg-amber-100 text-amber-900 border border-amber-300",
            icon: "ClipboardCheck",
            category: "AWAITING_ACTION"
        };
    }

    if (status === "FOR_SA_REVIEW") {
        return {
            label: "In Progress",
            detail: "Awaiting S.A. Acknowledgment",
            cls: "bg-blue-100 text-blue-800 border border-blue-300",
            icon: "Clock",
            category: "IN_PROGRESS"
        };
    }

    if (ev.hasDraft) {
        return {
            label: "In Progress",
            detail: `Supervisor Draft (${ev.answeredCriteriaCount || 0}/10)`,
            cls: "bg-blue-100 text-blue-800 border border-blue-300",
            icon: "FileEdit",
            category: "IN_PROGRESS"
        };
    }

    return {
        label: "Pending Step 1",
        detail: "Awaiting Supervisor (Step 1)",
        cls: "bg-slate-100 text-slate-700 border border-slate-300",
        icon: "Clock",
        category: "IN_PROGRESS"
    };
}

function evalSortPriorityForAdmin(ev) {
    const status = ev.status || "PENDING";
    const ackStatus = ev.acknowledgmentStatus || "PENDING";
    if (status === "FOR_COORDINATOR_REVIEW" || status === "FOR_FINAL_DECISION" || ackStatus === "EXTENSION_REQUESTED" || ev.supervisorRevisionRequest) {
        return 1; // Immediate Coordinator action needed
    }
    if (status === "FOR_SA_REVIEW" || ackStatus === "OVERDUE") {
        return 2; // Active Step 2
    }
    if (status === "RETURNED_FOR_REVISION" || ev.hasDraft) {
        return 3; // Active Step 1 draft or returned
    }
    if (status === "FINALIZED") {
        return 4; // Completed evaluations
    }
    return 5; // Unstarted Step 1
}

function evalSortPriorityForSupervisor(ev) {
    const status = ev.status || "PENDING";
    if (status === "RETURNED_FOR_REVISION") return 1;
    if (status === "PENDING" && ev.hasDraft) return 2;
    if (status === "PENDING") return 3;
    if (status === "FOR_SA_REVIEW" || status === "FOR_COORDINATOR_REVIEW" || status === "FOR_FINAL_DECISION") return 4;
    return 5;
}

function findTargetEvaluationFromNotifOrRoute(evaluationsList, route, notif) {
    if (!Array.isArray(evaluationsList) || !evaluationsList.length) return null;

    let targetSaProfileId = route?.query?.saProfileId ? Number(route.query.saProfileId) : 0;
    let targetEvalId = route?.query?.evalId ? Number(route.query.evalId) : 0;

    if (notif && notif.link) {
        const qIndex = notif.link.indexOf("?");
        if (qIndex !== -1) {
            try {
                const params = new URLSearchParams(notif.link.slice(qIndex + 1));
                if (!targetSaProfileId && params.get("saProfileId")) {
                    targetSaProfileId = Number(params.get("saProfileId"));
                }
                if (!targetEvalId && params.get("evalId")) {
                    targetEvalId = Number(params.get("evalId"));
                }
            } catch (_) {}
        }
    }

    if (targetEvalId > 0) {
        const byEvalId = evaluationsList.find(e => Number(e.id) === targetEvalId);
        if (byEvalId) return byEvalId;
    }

    if (targetSaProfileId > 0) {
        const byProfileId = evaluationsList.find(e => Number(e.saProfileId) === targetSaProfileId);
        if (byProfileId) return byProfileId;
    }

    if (notif) {
        const combinedText = `${notif.title || ""} ${notif.message || ""}`.toLowerCase();
        const refMatch = combinedText.match(/eval-#(\d+)/i);
        if (refMatch) {
            const refId = Number(refMatch[1]);
            const byRef = evaluationsList.find(e => Number(e.id) === refId);
            if (byRef) return byRef;
        }

        for (const ev of evaluationsList) {
            const name = (ev.studentName || "").trim().toLowerCase();
            if (name && name.length >= 4 && combinedText.includes(name)) {
                return ev;
            }
        }
    }

    return null;
}


function evalStatusMeta(status, ackStatus, hasDraft = false) {
    const info = getStepInfo(status, hasDraft);
    const badge = workflowStatusBadge({ status, acknowledgmentStatus: ackStatus, hasDraft }, "ADMIN");
    return {
        badge: `${badge.label} • ${info.shortStep}`,
        cls: badge.cls,
        step: info.step
    };
}

function ackStatusMeta(ackStatus, workflowStatus) {
    const st = ackStatus || "PENDING";
    switch (st) {
        case "SIGNED":
            return { label: "Signed & Acknowledged", cls: "bg-emerald-100 text-emerald-800 border border-emerald-300", icon: "CheckCircle2" };
        case "EXTENSION_REQUESTED":
            return { label: "Extension Requested", cls: "bg-amber-100 text-amber-800 border border-amber-300", icon: "Clock" };
        case "EXTENDED":
            return { label: "Extended Deadline", cls: "bg-blue-100 text-blue-800 border border-blue-300", icon: "CalendarClock" };
        case "OVERDUE_AWAITING_SA":
            return { label: "Overdue — Awaiting S.A.", cls: "bg-rose-100 text-rose-800 border border-rose-300", icon: "TriangleAlert" };
        case "OVERDUE_AWAITING_COORDINATOR":
            return { label: "Overdue — Coordinator Follow-up", cls: "bg-rose-100 text-rose-800 border border-rose-300", icon: "TriangleAlert" };
        case "CONCERN_SUBMITTED":
            return { label: "Concern / Response Submitted", cls: "bg-amber-100 text-amber-900 border border-amber-300", icon: "MessageSquareWarning" };
        case "ACKNOWLEDGMENT_DECLINED":
            return { label: "Acknowledgment Declined", cls: "bg-rose-100 text-rose-800 border border-rose-300", icon: "XCircle" };
        case "UNABLE_TO_ACKNOWLEDGE":
            return { label: "Unable to Acknowledge", cls: "bg-amber-100 text-amber-800 border border-amber-300", icon: "CircleAlert" };
        case "RETURNED_FOR_REVISION":
            return { label: "Returned for Revision", cls: "bg-orange-100 text-orange-800 border border-orange-300", icon: "RotateCcw" };
        default:
            if (workflowStatus === "FOR_SA_REVIEW") {
                return { label: "Awaiting S.A. Review", cls: "bg-blue-100 text-blue-800", icon: "Clock" };
            }
            return { label: "Pending Step 1", cls: "bg-slate-100 text-slate-600", icon: "Clock" };
    }
}

function decisionMeta(decision) {
    switch (decision) {
        case "RETAIN":
            return {
                label: "Retain",
                badgeCls: "bg-emerald-100 text-emerald-800 border border-emerald-300",
                icon: "CheckCircle2",
                desc: "Retained in current Student Assistant assignment"
            };
        case "IMPROVEMENT_PLAN":
            return {
                label: "Improvement Plan",
                badgeCls: "bg-amber-100 text-amber-800 border border-amber-300",
                icon: "ClipboardCheck",
                desc: "Retained under a monitored Performance Improvement Plan"
            };
        case "REASSIGNMENT":
            return {
                label: "Reassignment",
                badgeCls: "bg-blue-100 text-blue-800 border border-blue-300",
                icon: "Shuffle",
                desc: "Reassigned to another department, office, or laboratory"
            };
        case "NOT_RENEWED":
        case "DISQUALIFIED":
            return {
                label: "Non-Renewal",
                badgeCls: "bg-rose-100 text-rose-800 border border-rose-300",
                icon: "XCircle",
                desc: "Not renewed for next semester per S.A. program policy"
            };
        default:
            return null;
    }
}

// ============================================================================
// RESPONSIVE 5-STEP WORKFLOW PROGRESS TRACKER
// Desktop (`md:grid`): Clean horizontal five-step progress tracker
// Mobile (`<md`): Compact vertical five-step progress tracker
// ============================================================================
const EvaluationProcessTracker = {
    components: { AppIcon },
    props: {
        activeStage: { type: Number, default: 0 }, // 0 = overview mode, 1..5 = specific evaluation stage
        tracker: { type: Object, default: null }   // Saved workflow tracker object from api/evaluations.php
    },
    setup(props) {
        const displaySteps = Vue.computed(() => {
            if (props.tracker && Array.isArray(props.tracker.steps) && props.tracker.steps.length === 5) {
                return props.tracker.steps;
            }
            return EVALUATION_PROCESS_STEPS.map(s => {
                let tone = "pending";
                let statusLabel = "Pending";
                if (props.activeStage > 0) {
                    if (s.step < props.activeStage || (props.activeStage === 5 && s.step <= 5)) {
                        tone = "done";
                        statusLabel = "Completed";
                    } else if (s.step === props.activeStage) {
                        tone = "active";
                        statusLabel = s.step === 2 ? "Awaiting Action" : "In Progress";
                    }
                }
                return {
                    ...s,
                    tone,
                    statusLabel
                };
            });
        });

        const stepCardClass = (s) => {
            if (!props.tracker && props.activeStage === 0) {
                return "border-slate-200 bg-slate-50/70";
            }
            switch (s.tone) {
                case "done":
                    return "border-emerald-300 bg-emerald-50/60";
                case "active":
                    return "border-[#0F2C59] bg-blue-50/70 ring-2 ring-[#0F2C59]/15";
                case "warning":
                    return "border-orange-300 bg-orange-50/80 ring-2 ring-orange-400/25";
                case "danger":
                    return "border-rose-300 bg-rose-50/80 ring-2 ring-rose-400/25";
                default:
                    return "border-slate-200 bg-slate-50/50 opacity-80";
            }
        };

        const stepCircleClass = (s) => {
            if (!props.tracker && props.activeStage === 0) {
                return "bg-[#0F2C59] text-[#D4AF37]";
            }
            switch (s.tone) {
                case "done":
                    return "bg-emerald-600 text-white";
                case "active":
                    return "bg-[#0F2C59] text-[#D4AF37]";
                case "warning":
                    return "bg-orange-500 text-white";
                case "danger":
                    return "bg-rose-600 text-white";
                default:
                    return "bg-slate-200 text-slate-600";
            }
        };

        const stepBadgeClass = (s) => {
            switch (s.tone) {
                case "done":
                    return "bg-emerald-100 text-emerald-800";
                case "active":
                    return "bg-[#0F2C59] text-[#D4AF37]";
                case "warning":
                    return "bg-orange-200 text-orange-950";
                case "danger":
                    return "bg-rose-600 text-white";
                default:
                    return "bg-slate-200 text-slate-600";
            }
        };

        return { displaySteps, stepCardClass, stepCircleClass, stepBadgeClass, Format };
    },
    template: `
    <div class="no-print card border border-navy/15 bg-white p-4 shadow-sm">
        <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div class="flex items-center gap-2">
                <span class="flex h-6 w-6 items-center justify-center rounded-full bg-[#0F2C59] text-[11px] font-black text-[#D4AF37]">5</span>
                <h3 class="text-xs font-extrabold uppercase tracking-wider text-[#0F2C59]">Five-Step Performance Evaluation Workflow</h3>
            </div>
            <div v-if="tracker" class="flex flex-wrap items-center gap-2 text-[11px]">
                <span class="rounded-full bg-[#0F2C59]/10 px-2.5 py-0.5 font-bold text-[#0F2C59]">
                    Step {{ tracker.currentStep }} of 5 • {{ tracker.currentStatus }}
                </span>
                <span v-if="tracker.responsibleRole || tracker.responsiblePerson" class="rounded-full bg-slate-100 px-2.5 py-0.5 font-semibold text-slate-700">
                    Responsible: <strong class="text-slate-900">{{ tracker.responsiblePerson || tracker.responsibleRole }}</strong>
                </span>
                <span v-if="tracker.dueDate" class="rounded-full px-2.5 py-0.5 font-bold"
                      :class="tracker.currentStep === 2 && new Date().toISOString().slice(0, 10) > tracker.dueDate ? 'bg-rose-100 text-rose-800' : 'bg-blue-50 text-blue-800'">
                    Deadline: {{ Format.date(tracker.dueDate) }}
                </span>
            </div>
        </div>

        <!-- Desktop Horizontal Five-Step Tracker -->
        <div class="hidden md:grid md:grid-cols-5 md:gap-2.5">
            <div v-for="s in displaySteps" :key="'desk-' + s.step"
                 class="relative flex flex-col justify-between rounded-xl border p-3 transition"
                 :class="stepCardClass(s)">
                <div>
                    <div class="mb-1.5 flex items-center justify-between gap-1.5">
                        <span class="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black"
                              :class="stepCircleClass(s)">
                            <app-icon v-if="s.tone === 'done'" name="Check" :size="13" />
                            <app-icon v-else-if="s.tone === 'warning' || s.tone === 'danger'" name="TriangleAlert" :size="13" />
                            <span v-else>{{ s.step }}</span>
                        </span>
                        <span v-if="tracker || activeStage > 0"
                              class="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                              :class="stepBadgeClass(s)">
                            {{ s.statusLabel }}
                        </span>
                    </div>
                    <p class="text-xs font-bold leading-snug text-slate-900">{{ s.title }}</p>
                    <p class="mt-1 text-[11px] leading-relaxed text-slate-600">{{ s.desc }}</p>
                </div>
                <div v-if="tracker && (s.timestamp || s.dueDate)" class="mt-2 border-t border-slate-200/70 pt-1.5 text-[10px] text-slate-500">
                    <span v-if="s.timestamp" class="block font-medium text-slate-700">{{ Format.dateTime(s.timestamp) }}</span>
                    <span v-else-if="s.dueDate" class="block font-semibold text-blue-800">Deadline: {{ Format.date(s.dueDate) }}</span>
                </div>
            </div>
        </div>

        <!-- Mobile Compact Vertical Five-Step Tracker -->
        <div class="flex flex-col gap-2 md:hidden">
            <div v-for="s in displaySteps" :key="'mob-' + s.step"
                 class="flex items-start gap-3 rounded-xl border p-2.5"
                 :class="stepCardClass(s)">
                <span class="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-black"
                      :class="stepCircleClass(s)">
                    <app-icon v-if="s.tone === 'done'" name="Check" :size="13" />
                    <app-icon v-else-if="s.tone === 'warning' || s.tone === 'danger'" name="TriangleAlert" :size="13" />
                    <span v-else>{{ s.step }}</span>
                </span>
                <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center justify-between gap-1">
                        <p class="text-xs font-bold text-slate-900">{{ s.title }}</p>
                        <span v-if="tracker || activeStage > 0"
                              class="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                              :class="stepBadgeClass(s)">
                            {{ s.statusLabel }}
                        </span>
                    </div>
                    <p class="mt-0.5 text-[11px] text-slate-600">{{ s.desc }}</p>
                </div>
            </div>
        </div>
    </div>
    `
};

// ============================================================================
// LAYER B & LAYER C: EVALUATION DETAILS PAGE + ROLE-SPECIFIC ACTION PANEL
// Replaces the old 5-tab form pagination with a clean, scannable Details Page
// with progressive disclosure (<details> sections for supporting records & logs)
// ============================================================================
const NcstEvaluationWizard = {
    components: { AppIcon, AppModal, FormField, EvaluationProcessTracker },
    props: {
        initialData: { type: Object, required: true },
        mode: { type: String, default: "COORDINATOR" }, // 'SUPERVISOR' | 'SA' | 'COORDINATOR'
        readOnly: { type: Boolean, default: false }
    },
    emits: ["close", "saved"],

    setup(props, { emit }) {
        const saving = Vue.ref(false);
        const savingDraft = Vue.ref(false);
        const savingResponse = Vue.ref(false);
        const today = new Date().toISOString().split("T")[0];

        const form = Vue.reactive({
            evaluationId: props.initialData.evaluationId || null,
            evaluationRef: props.initialData.evaluationRef || (props.initialData.evaluationId ? `EVAL-#${props.initialData.evaluationId}` : `EVAL-SA-${props.initialData.saProfileId}`),
            saProfileId: props.initialData.saProfileId,
            studentId: props.initialData.studentId || "",
            studentName: props.initialData.studentName || "",
            course: props.initialData.course || "",
            positionTitle: props.initialData.positionTitle || "Student Assistant",
            department: props.initialData.department || "",
            category: props.initialData.category || "",
            supervisorName: props.initialData.supervisorName || "",
            evaluationPeriod: props.initialData.evaluationPeriod || "",
            evalDate: props.initialData.evalDate || today,
            criteria: {
                1: props.initialData.criteria?.[1] || null,
                2: props.initialData.criteria?.[2] || null,
                3: props.initialData.criteria?.[3] || null,
                4: props.initialData.criteria?.[4] || null,
                5: props.initialData.criteria?.[5] || null,
                6: props.initialData.criteria?.[6] || null,
                7: props.initialData.criteria?.[7] || null,
                8: props.initialData.criteria?.[8] || null,
                9: props.initialData.criteria?.[9] || null,
                10: props.initialData.criteria?.[10] || null
            },
            strengthsWeaknesses: props.initialData.strengthsWeaknesses || "",
            standardRemarks: props.initialData.standardRemarks || "",
            recommendation: props.initialData.recommendation === "NOT_RECOMMENDED"
                ? "NOT_RECOMMENDED"
                : "RECOMMENDED",
            supervisorRecommendation: props.initialData.supervisorRecommendation || props.initialData.coordinatorDecision || "RETAIN",
            supervisorReason: props.initialData.supervisorReason || props.initialData.strengthsWeaknesses || "",
            disclosedFeedback: props.initialData.disclosedFeedback || "",
            rejectionReason: props.initialData.rejectionReason || "",
            rejectedAt: props.initialData.rejectedAt || null,
            rejectedByName: props.initialData.rejectedByName || null,
            supervisorSignature: props.initialData.supervisorSignature || "",
            supervisorTitle: props.initialData.supervisorTitle || "Immediate Supervisor",
            supervisorSignDate: props.initialData.supervisorSignature ? (props.initialData.supervisorSignDate || today) : "",
            studentSignature: props.initialData.studentSignature || "",
            studentRole: props.initialData.studentRole || "Student Assistant",
            studentSignDate: props.initialData.studentSignature ? (props.initialData.studentSignDate || today) : "",
            saComments: props.initialData.saComments || "",
            saConcernText: props.initialData.saConcernText || "",
            saHasDispute: Boolean(props.initialData.saHasDispute),
            saExceptionReason: props.initialData.saExceptionReason || "",
            saAcknowledgedAt: props.initialData.saAcknowledgedAt || null,
            acknowledgmentStatus: props.initialData.acknowledgmentStatus || "PENDING",
            acknowledgmentStatusLabel: props.initialData.acknowledgmentStatusLabel || "Pending",
            ackReleasedAt: props.initialData.ackReleasedAt || null,
            ackDueDate: props.initialData.ackDueDate || null,
            originalAckDueDate: props.initialData.originalAckDueDate || null,
            isAckOverdue: Boolean(props.initialData.isAckOverdue),
            extensionStatus: props.initialData.extensionStatus || "NONE",
            extensionReasonCategory: props.initialData.extensionReasonCategory || "",
            extensionExplanation: props.initialData.extensionExplanation || "",
            extensionRequestedAt: props.initialData.extensionRequestedAt || null,
            extensionRequestedDays: props.initialData.extensionRequestedDays || 3,
            extensionDecidedByName: props.initialData.extensionDecidedByName || null,
            extensionDecidedAt: props.initialData.extensionDecidedAt || null,
            extensionDecisionReason: props.initialData.extensionDecisionReason || "",
            revisionCount: props.initialData.revisionCount || 0,
            lastReturnReason: props.initialData.lastReturnReason || "",
            returnedByName: props.initialData.returnedByName || null,
            returnedAt: props.initialData.returnedAt || null,
            supervisorRevisionRequest: props.initialData.supervisorRevisionRequest || "",
            supervisorRevisionRequestedAt: props.initialData.supervisorRevisionRequestedAt || null,
            coordinatorDecision: props.initialData.coordinatorDecision || "RETAIN",
            coordinatorReason: props.initialData.coordinatorReason || "",
            effectiveDate: props.initialData.effectiveDate || today,
            coordinatorName: props.initialData.coordinatorName || "",
            finalizedAt: props.initialData.finalizedAt || null,
            reopenedByName: props.initialData.reopenedByName || null,
            reopenedAt: props.initialData.reopenedAt || null,
            reopenReason: props.initialData.reopenReason || "",
            status: props.initialData.status || "PENDING",
            workflowStage: props.initialData.workflowStage || "step1_in_progress",
            nextActionRole: props.initialData.nextActionRole || "SUPERVISOR",
            nextActionAssignedTo: props.initialData.nextActionAssignedTo || (props.initialData.supervisorName || "Immediate Supervisor"),
            authorizedActions: props.initialData.authorizedActions || null,
            hasDraft: Boolean(props.initialData.hasDraft),
            submittedAt: props.initialData.submittedAt || null,
            updatedAt: props.initialData.updatedAt || null,
            tracker: props.initialData.tracker || null,
            actionHistory: props.initialData.actionHistory || [],
            notificationLogs: props.initialData.notificationLogs || [],
            records: props.initialData.records || {}
        });

        // Synchronize reactive form state with fresh backend evaluation payload (Single Source of Truth)
        const applyEvaluationData = (evData) => {
            if (!evData || typeof evData !== "object") return;
            form.evaluationId = evData.evaluationId || form.evaluationId;
            form.evaluationRef = evData.evaluationRef || (evData.evaluationId ? `EVAL-#${evData.evaluationId}` : form.evaluationRef);
            form.saProfileId = evData.saProfileId || form.saProfileId;
            form.studentId = evData.studentId ?? form.studentId;
            form.studentName = evData.studentName ?? form.studentName;
            form.course = evData.course ?? form.course;
            form.positionTitle = evData.positionTitle || form.positionTitle;
            form.department = evData.department ?? form.department;
            form.category = evData.category ?? form.category;
            form.supervisorName = evData.supervisorName ?? form.supervisorName;
            form.evaluationPeriod = evData.evaluationPeriod ?? form.evaluationPeriod;
            form.evalDate = evData.evalDate || form.evalDate;
            if (evData.criteria) {
                for (let i = 1; i <= 10; i++) {
                    form.criteria[i] = evData.criteria[i] ?? form.criteria[i];
                }
            }
            form.strengthsWeaknesses = evData.strengthsWeaknesses ?? form.strengthsWeaknesses;
            form.standardRemarks = evData.standardRemarks ?? form.standardRemarks;
            if (evData.recommendation) {
                form.recommendation = evData.recommendation === "NOT_RECOMMENDED" ? "NOT_RECOMMENDED" : "RECOMMENDED";
            }
            if (evData.supervisorRecommendation) {
                form.supervisorRecommendation = evData.supervisorRecommendation;
            }
            form.supervisorReason = evData.supervisorReason ?? form.supervisorReason;
            form.disclosedFeedback = evData.disclosedFeedback ?? form.disclosedFeedback;
            form.rejectionReason = evData.rejectionReason ?? form.rejectionReason;
            form.rejectedAt = evData.rejectedAt ?? form.rejectedAt;
            form.rejectedByName = evData.rejectedByName ?? form.rejectedByName;
            form.supervisorSignature = evData.supervisorSignature || "";
            form.supervisorTitle = evData.supervisorTitle || form.supervisorTitle;
            form.supervisorSignDate = form.supervisorSignature ? (evData.supervisorSignDate || form.supervisorSignDate || today) : "";
            form.studentSignature = evData.studentSignature || "";
            form.studentRole = evData.studentRole || form.studentRole;
            form.studentSignDate = form.studentSignature ? (evData.studentSignDate || form.studentSignDate || today) : "";
            form.saComments = evData.saComments ?? form.saComments;
            form.saConcernText = evData.saConcernText ?? form.saConcernText;
            form.saHasDispute = Boolean(evData.saHasDispute);
            form.saExceptionReason = evData.saExceptionReason ?? form.saExceptionReason;
            form.saAcknowledgedAt = evData.saAcknowledgedAt ?? form.saAcknowledgedAt;
            form.acknowledgmentStatus = evData.acknowledgmentStatus || form.acknowledgmentStatus;
            form.acknowledgmentStatusLabel = evData.acknowledgmentStatusLabel || form.acknowledgmentStatusLabel;
            form.ackReleasedAt = evData.ackReleasedAt ?? form.ackReleasedAt;
            form.ackDueDate = evData.ackDueDate ?? form.ackDueDate;
            form.originalAckDueDate = evData.originalAckDueDate ?? form.originalAckDueDate;
            form.isAckOverdue = Boolean(evData.isAckOverdue);
            form.extensionStatus = evData.extensionStatus || form.extensionStatus;
            form.extensionReasonCategory = evData.extensionReasonCategory ?? form.extensionReasonCategory;
            form.extensionExplanation = evData.extensionExplanation ?? form.extensionExplanation;
            form.extensionRequestedAt = evData.extensionRequestedAt ?? form.extensionRequestedAt;
            form.extensionRequestedDays = evData.extensionRequestedDays || form.extensionRequestedDays;
            form.extensionDecidedByName = evData.extensionDecidedByName ?? form.extensionDecidedByName;
            form.extensionDecidedAt = evData.extensionDecidedAt ?? form.extensionDecidedAt;
            form.extensionDecisionReason = evData.extensionDecisionReason ?? form.extensionDecisionReason;
            form.revisionCount = evData.revisionCount ?? form.revisionCount;
            form.lastReturnReason = evData.lastReturnReason ?? form.lastReturnReason;
            form.returnedByName = evData.returnedByName ?? form.returnedByName;
            form.returnedAt = evData.returnedAt ?? form.returnedAt;
            form.supervisorRevisionRequest = evData.supervisorRevisionRequest ?? "";
            form.supervisorRevisionRequestedAt = evData.supervisorRevisionRequestedAt ?? null;
            if (evData.coordinatorDecision) {
                form.coordinatorDecision = evData.coordinatorDecision;
            }
            form.coordinatorReason = evData.coordinatorReason ?? form.coordinatorReason;
            form.effectiveDate = evData.effectiveDate || form.effectiveDate;
            form.coordinatorName = evData.coordinatorName ?? form.coordinatorName;
            form.finalizedAt = evData.finalizedAt ?? form.finalizedAt;
            form.reopenedByName = evData.reopenedByName ?? form.reopenedByName;
            form.reopenedAt = evData.reopenedAt ?? form.reopenedAt;
            form.reopenReason = evData.reopenReason ?? form.reopenReason;
            form.status = evData.status || form.status;
            form.workflowStage = evData.workflowStage || form.workflowStage;
            form.nextActionRole = evData.nextActionRole || form.nextActionRole;
            form.nextActionAssignedTo = evData.nextActionAssignedTo || form.nextActionAssignedTo;
            form.authorizedActions = evData.authorizedActions || form.authorizedActions;
            form.hasDraft = Boolean(evData.hasDraft);
            form.submittedAt = evData.submittedAt ?? form.submittedAt;
            form.updatedAt = evData.updatedAt ?? form.updatedAt;
            form.tracker = evData.tracker || form.tracker;
            form.actionHistory = evData.actionHistory || form.actionHistory;
            form.notificationLogs = evData.notificationLogs || form.notificationLogs;
            form.records = evData.records || form.records;
            refreshCanvases();
        };

        Vue.watch(
            () => props.initialData,
            (newVal) => {
                if (newVal) applyEvaluationData(newVal);
            },
            { deep: true }
        );

        const viewerRole = Vue.computed(() => {
            if (props.mode === "SUPERVISOR") return "SUPERVISOR";
            if (props.mode === "SA") return "SA";
            return "ADMIN";
        });

        // Strict Role & Workflow Permissions (Single source of truth from database status):
        const canSupervisorEdit = Vue.computed(() =>
            props.mode === "SUPERVISOR" &&
            !props.readOnly &&
            form.status !== "FINALIZED" &&
            (!form.status || form.status === "PENDING" || form.status === "DRAFT" || form.status === "RETURNED_FOR_REVISION" || form.status === "RETURNED_TO_SUPERVISOR")
        );

        const canSaAcknowledge = Vue.computed(() =>
            props.mode === "SA" &&
            !props.readOnly &&
            form.status === "FOR_SA_REVIEW" &&
            !form.saAcknowledgedAt &&
            form.acknowledgmentStatus !== "SIGNED"
        );

        const canCoordinatorDecide = Vue.computed(() =>
            props.mode === "COORDINATOR" &&
            !props.readOnly &&
            form.status === "FOR_COORDINATOR_REVIEW"
        );

        const activeProcessStage = Vue.computed(() => {
            if (form.tracker?.currentStep) return form.tracker.currentStep;
            return getStepInfo(form.status, form.hasDraft).step;
        });

        const currentStepMeta = Vue.computed(() => getStepInfo(form.status, form.hasDraft));
        const currentStatusBadge = Vue.computed(() => workflowStatusBadge(form, viewerRole.value));

        // Dynamic Authorized Action Panel heading reflecting the current step & viewer role
        const actionPanelHeading = Vue.computed(() => {
            if (props.mode === "SUPERVISOR") {
                if (canSupervisorEdit.value) {
                    return "Immediate Supervisor Actions (Step 1 & Step 2 Recommendation)";
                }
                if (form.status === "FOR_SA_REVIEW") {
                    return "Immediate Supervisor Actions — Sent to S.A. for Acknowledgment (Step 3)";
                }
                if (form.status === "FOR_COORDINATOR_REVIEW") {
                    return "Immediate Supervisor Actions — S.A. Acknowledged (Step 4: Coordinator Review)";
                }
                if (form.status === "REJECTED") {
                    return "Immediate Supervisor Actions — Recommendation Rejected by Coordinator";
                }
                if (form.status === "FINALIZED") {
                    return "Immediate Supervisor Actions (Step 5: Finalized Evaluation)";
                }
                return `Immediate Supervisor Actions (${currentStepMeta.value.stepTitle})`;
            }
            if (props.mode === "SA") {
                if (form.status === "FOR_SA_REVIEW") {
                    return "Student Assistant Actions (Step 3: Review & Acknowledgment)";
                }
                if (form.status === "FOR_COORDINATOR_REVIEW") {
                    return "Student Assistant Actions (Step 4: Acknowledged — Pending Coordinator Review)";
                }
                if (form.status === "FINALIZED") {
                    return "Student Assistant Actions (Step 5: Finalized Evaluation)";
                }
                return "Student Assistant Actions (Evaluation In Progress)";
            }
            // COORDINATOR
            if (form.status === "FOR_COORDINATOR_REVIEW") {
                return "S.A. Coordinator Actions (Step 4: Review & Final Decision)";
            }
            if (form.status === "FOR_SA_REVIEW") {
                return "S.A. Coordinator Actions (Step 3: Awaiting S.A. Acknowledgment)";
            }
            if (form.status === "REJECTED") {
                return "S.A. Coordinator Actions (Recommendation Rejected)";
            }
            if (form.status === "FINALIZED") {
                return "S.A. Coordinator Actions (Step 5: Finalized Evaluation)";
            }
            return "S.A. Coordinator Actions (Step 1: Awaiting Supervisor)";
        });

        // Next Action summary tailored to current workflow step & role
        const nextActionSummary = Vue.computed(() => {
            if (form.status === "FINALIZED") {
                const dec = decisionMeta(form.coordinatorDecision)?.label || form.coordinatorDecision || "Finalized";
                return {
                    title: `Step 5 Complete — Finalized (${dec})`,
                    description: `Final decision recorded by ${form.coordinatorName || "S.A. Coordinator"} (Effective: ${Format.date(form.effectiveDate)}). This evaluation record is finalized, locked, and preserved.`,
                    tone: "emerald"
                };
            }
            if (form.status === "REJECTED") {
                return {
                    title: "Recommendation Rejected by Coordinator",
                    description: `The Coordinator rejected this evaluation recommendation on ${Format.dateTime(form.rejectedAt)}. Reason: ${form.rejectionReason}`,
                    tone: "rose"
                };
            }
            if (form.status === "RETURNED_FOR_REVISION") {
                return {
                    title: "Returned to Immediate Supervisor for Revision",
                    description: props.mode === "SUPERVISOR"
                        ? "Review the Coordinator's return reason below, update the evaluation ratings, recommendation, or rationale, and resubmit."
                        : `Waiting for Immediate Supervisor (${form.supervisorName}) to revise and resubmit.`,
                    tone: "orange"
                };
            }
            if (form.status === "PENDING") {
                return {
                    title: "Step 1 & 2 Action Required — Immediate Supervisor Evaluation",
                    description: props.mode === "SUPERVISOR"
                        ? `Complete criteria 1–10 ratings, review the auto-detected recommendation, sign, and send to ${form.studentName || 'Student Assistant'} for acknowledgment.`
                        : `Assigned to Immediate Supervisor (${form.supervisorName}) for Step 1 evaluation and Step 2 recommendation.`,
                    tone: "amber"
                };
            }
            if (form.status === "FOR_SA_REVIEW") {
                return {
                    title: form.isAckOverdue
                        ? "Step 3 Overdue — Student Assistant Review & Acknowledgment"
                        : "Step 3 Action Required — Student Assistant Review & Acknowledgment",
                    description: props.mode === "SA"
                        ? "Your supervisor has submitted your performance evaluation. Please review criteria 1–10 and supervisor assessment, and sign acknowledgment below."
                        : `Sent to Student Assistant (${form.studentName}) for Step 3 review & acknowledgment (Deadline: ${form.ackDueDate ? Format.date(form.ackDueDate) : "5 school days"}).`,
                    tone: form.isAckOverdue ? "rose" : "blue"
                };
            }
            if (form.status === "FOR_COORDINATOR_REVIEW") {
                return {
                    title: "Step 4 Action Required — S.A. Coordinator Review & Final Decision",
                    description: props.mode === "COORDINATOR"
                        ? "Review the supervisor's recommendation and student assistant's signed acknowledgment. You have the authority to approve the final decision, return for revision, or reject."
                        : "Acknowledged by Student Assistant. Currently under Step 4 administrative review by the S.A. Coordinator.",
                    tone: "amber"
                };
            }
            return {
                title: "In Progress",
                description: "Evaluation is currently being processed.",
                tone: "blue"
            };
        });

        // Filter return/reopen events from actionHistory so Returned History is always visible
        const returnHistoryEntries = Vue.computed(() => {
            const list = (form.actionHistory || []).filter(a =>
                ["COORDINATOR_RETURNED_FOR_REVISION", "RETURNED_FOR_REVISION", "SUPERVISOR_REQUESTED_REVISION", "COORDINATOR_REOPENED_EVALUATION", "COORDINATOR_REOPENED_FINALIZED"].includes(a.actionType)
            );
            return list;
        });

        // Coordinator Step 3 review notes
        const coordReviewNotes = Vue.ref("");

        // Modals
        const showExtensionModal = Vue.ref(false);
        const extForm = Vue.reactive({
            reasonCategory: EXTENSION_REASON_CATEGORIES[0],
            requestedDays: 3,
            explanation: ""
        });

        const showConcernModal = Vue.ref(false);
        const concernForm = Vue.reactive({
            exceptionType: "CONCERN_SUBMITTED",
            reasonText: ""
        });

        const showCoordExtensionModal = Vue.ref(false);
        const coordExtForm = Vue.reactive({
            decision: "APPROVED",
            extensionDays: form.extensionRequestedDays || 3,
            newDueDate: "",
            decisionReason: ""
        });

        const showReturnRevisionModal = Vue.ref(false);
        const returnRevisionReason = Vue.ref("");

        const showSupRevisionReqModal = Vue.ref(false);
        const supRevisionReqReason = Vue.ref("");

        const showCoordExceptionModal = Vue.ref(false);
        const coordExceptionForm = Vue.reactive({
            acknowledgmentStatus: "OVERDUE_AWAITING_COORDINATOR",
            remarks: ""
        });

        const showReopenModal = Vue.ref(false);
        const reopenForm = Vue.reactive({
            targetStage: "FOR_COORDINATOR_REVIEW",
            reopenReason: ""
        });

        const supervisorCanvasRef = Vue.ref(null);
        const studentCanvasRef = Vue.ref(null);

        const scoreStats = Vue.computed(() => {
            let total = 0;
            let answered = 0;
            for (let i = 1; i <= 10; i++) {
                const v = Number(form.criteria[i]);
                if (v >= 1 && v <= 4) {
                    total += v;
                    answered++;
                }
            }
            const avg = answered > 0 ? (total / answered).toFixed(2) : "0.00";
            const numAvg = parseFloat(avg);
            let badgeText = "Not Yet Rated";
            let badgeClass = "bg-slate-100 text-slate-700";

            if (answered > 0) {
                if (numAvg >= 3.5) {
                    badgeText = "Above Average";
                    badgeClass = "bg-emerald-100 text-emerald-800 border border-emerald-300";
                } else if (numAvg >= 2.5) {
                    badgeText = "Satisfactory";
                    badgeClass = "bg-blue-100 text-blue-800 border border-blue-300";
                } else if (numAvg >= 1.8) {
                    badgeText = "Below Average";
                    badgeClass = "bg-amber-100 text-amber-800 border border-amber-300";
                } else {
                    badgeText = "Unsatisfactory";
                    badgeClass = "bg-rose-100 text-rose-800 border border-rose-300";
                }
            }

            return { total, answered, avg, badgeText, badgeClass };
        });

        // Auto-detect Recommended Decision based on total / average rating score:
        // Retain: avg >= 3.00 (Total >= 30) -> "Recommend continuation in current assignment."
        // Improvement Plan: avg >= 2.50 && avg < 3.00 (Total 25–29) -> "Performance development plan with monitoring."
        // Reassignment: avg >= 2.00 && avg < 2.50 (Total 20–24) -> "Transfer/reassign to another department or lab."
        // Non-Renewal: avg < 2.00 (Total < 20) -> "Discontinue appointment for the next semester."
        const autoDetectedRecommendation = Vue.computed(() => {
            const { answered, total } = scoreStats.value;
            if (answered === 0) return null;
            const avg = total / answered;
            if (avg >= 3.0) {
                return {
                    key: "RETAIN",
                    label: "Retain",
                    desc: "Recommend continuation in current assignment.",
                    badgeCls: "bg-emerald-100 text-emerald-800 border-emerald-300 ring-2 ring-emerald-500/20"
                };
            } else if (avg >= 2.5) {
                return {
                    key: "IMPROVEMENT_PLAN",
                    label: "Improvement Plan",
                    desc: "Performance development plan with monitoring.",
                    badgeCls: "bg-amber-100 text-amber-800 border-amber-300 ring-2 ring-amber-500/20"
                };
            } else if (avg >= 2.0) {
                return {
                    key: "REASSIGNMENT",
                    label: "Reassignment",
                    desc: "Transfer/reassign to another department or lab.",
                    badgeCls: "bg-blue-100 text-blue-800 border-blue-300 ring-2 ring-blue-500/20"
                };
            } else {
                return {
                    key: "NOT_RENEWED",
                    label: "Non-Renewal",
                    desc: "Discontinue appointment for the next semester.",
                    badgeCls: "bg-rose-100 text-rose-800 border-rose-300 ring-2 ring-rose-500/20"
                };
            }
        });

        // Automatically update the Recommended Decision when criteria ratings change if supervisor is editing
        Vue.watch(() => scoreStats.value.total, () => {
            if (canSupervisorEdit.value && autoDetectedRecommendation.value) {
                form.supervisorRecommendation = autoDetectedRecommendation.value.key;
            }
        });

        const setAllRatings = (val) => {
            if (!canSupervisorEdit.value) return;
            for (let i = 1; i <= 10; i++) {
                form.criteria[i] = val;
            }
        };

        const insertSampleRationale = () => {
            if (!canSupervisorEdit.value) return;
            const rec = form.supervisorRecommendation || "RETAIN";
            if (rec === "RETAIN") {
                form.supervisorReason = "Consistently performs assigned duties with high quality, precision, and diligence. Demonstrates excellent punctuality, good attitude, and strong team cooperation in the workplace.";
            } else if (rec === "IMPROVEMENT_PLAN") {
                form.supervisorReason = "Shows good potential and positive attitude, but requires improvement in time management, consistency in output delivery, and adherence to assigned duty hours.";
            } else if (rec === "REASSIGNMENT") {
                form.supervisorReason = "Recommended for reassignment/transfer to another department or laboratory that better aligns with student's academic course, skills, and schedule availability.";
            } else {
                form.supervisorReason = "Discontinue appointment for the next academic semester due to recurring scheduling conflicts, multiple unexcused absences, or performance below departmental standards.";
            }
        };

        let supPad = null;
        let stuPad = null;

        const drawFlourishOnCanvas = (canvas, isSupervisor) => {
            if (!canvas) return;
            const ctx = canvas.getContext("2d");
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = "#FFFFFF";
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            ctx.save();
            ctx.strokeStyle = "#0F2C59";
            ctx.lineWidth = 2.4;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";

            const cx = canvas.width / 2;
            const cy = canvas.height / 2;

            ctx.beginPath();
            if (isSupervisor) {
                // Natural supervisor signature flourish stroke
                ctx.moveTo(cx - 85, cy + 5);
                ctx.bezierCurveTo(cx - 75, cy - 28, cx - 55, cy - 32, cx - 45, cy - 12);
                ctx.bezierCurveTo(cx - 35, cy + 8, cx - 60, cy + 12, cx - 72, cy + 20);
                ctx.bezierCurveTo(cx - 40, cy - 2, cx - 12, cy - 6, cx + 15, cy - 16);
                ctx.bezierCurveTo(cx + 35, cy - 22, cx + 52, cy - 4, cx + 38, cy + 8);
                ctx.bezierCurveTo(cx + 22, cy + 16, cx + 58, cy + 6, cx + 92, cy - 10);
                // flourish underline
                ctx.moveTo(cx - 68, cy + 24);
                ctx.bezierCurveTo(cx - 12, cy + 28, cx + 45, cy + 22, cx + 96, cy + 18);
            } else {
                // Natural student assistant signature flourish stroke (matching Image 2)
                ctx.moveTo(cx - 80, cy - 15);
                ctx.bezierCurveTo(cx - 65, cy + 22, cx - 55, cy + 24, cx - 45, cy - 5);
                ctx.bezierCurveTo(cx - 40, cy - 22, cx - 25, cy - 18, cx - 15, cy + 2);
                ctx.bezierCurveTo(cx - 8, cy + 16, cx + 5, cy + 14, cx + 15, cy - 8);
                ctx.bezierCurveTo(cx + 25, cy - 24, cx + 45, cy + 26, cx + 55, cy - 18);
                ctx.bezierCurveTo(cx + 62, cy - 28, cx + 70, cy + 20, cx + 75, cy + 22);
                // flourish underline
                ctx.moveTo(cx - 60, cy - 8);
                ctx.bezierCurveTo(cx - 20, cy - 12, cx + 30, cy - 6, cx + 85, cy + 8);
            }
            ctx.stroke();
            ctx.restore();
        };

        const adoptSupervisorSignature = () => {
            const canvas = supervisorCanvasRef.value;
            if (!canvas) return;
            drawFlourishOnCanvas(canvas, true);
            const dataUrl = canvas.toDataURL("image/png");
            form.supervisorSignature = dataUrl;
            form.supervisorSignDate = today;
            if (supPad) {
                supPad._isEmpty = false;
            }
            return dataUrl;
        };

        const adoptStudentSignature = () => {
            const canvas = studentCanvasRef.value;
            if (!canvas) return;
            drawFlourishOnCanvas(canvas, false);
            const dataUrl = canvas.toDataURL("image/png");
            form.studentSignature = dataUrl;
            form.studentSignDate = today;
            if (stuPad) {
                stuPad._isEmpty = false;
            }
            return dataUrl;
        };

        const initCanvas = (canvas, fieldKey, isInteractive) => {
            if (!canvas) return;

            if (!canvas.width || canvas.width < 100) canvas.width = 380;
            if (!canvas.height || canvas.height < 50) canvas.height = 100;

            let pad = null;
            if (typeof SignaturePad !== "undefined") {
                if (canvas._sigPad) {
                    pad = canvas._sigPad;
                } else {
                    pad = new SignaturePad(canvas, {
                        penColor: "#0F2C59",
                        backgroundColor: "#FFFFFF",
                        minWidth: 1.5,
                        maxWidth: 3.5,
                        throttle: 16
                    });
                    canvas._sigPad = pad;
                }
            }

            if (fieldKey === "supervisorSignature") supPad = pad;
            if (fieldKey === "studentSignature") stuPad = pad;

            const sigVal = form[fieldKey];
            const isDummy1x1 = Boolean(sigVal && sigVal.includes("iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"));
            const hasStaticText = Boolean(sigVal && (sigVal.includes("<text") || sigVal.includes("Georgia") || sigVal.includes("Electronically")));

            if (sigVal && sigVal.startsWith("data:image") && !isDummy1x1 && !hasStaticText) {
                const img = new Image();
                img.onload = () => {
                    const ctx = canvas.getContext("2d");
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.fillStyle = "#FFFFFF";
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    if (pad) pad._isEmpty = false;
                };
                img.src = sigVal;
            } else if (hasStaticText && form.status !== "PENDING") {
                // If previously saved evaluation in DB had static cursive text, replace with authentic pen flourish stroke
                drawFlourishOnCanvas(canvas, fieldKey === "supervisorSignature");
                form[fieldKey] = canvas.toDataURL("image/png");
                if (pad) pad._isEmpty = false;
            } else {
                // By default, canvas starts completely BLANK and clean!
                const ctx = canvas.getContext("2d");
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = "#FFFFFF";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                if (pad) pad.clear();
            }

            if (pad) {
                if (isInteractive) {
                    pad.on();
                    pad.removeEventListener("endStroke", canvas._endStrokeHandler);
                    canvas._endStrokeHandler = () => {
                        form[fieldKey] = pad.toDataURL("image/png");
                        if (fieldKey === "studentSignature" && !form.studentSignDate) {
                            form.studentSignDate = today;
                        }
                        if (fieldKey === "supervisorSignature" && !form.supervisorSignDate) {
                            form.supervisorSignDate = today;
                        }
                    };
                    pad.addEventListener("endStroke", canvas._endStrokeHandler);
                } else {
                    pad.off();
                }
                return;
            }

            // Fallback manual drawing if SignaturePad is not loaded
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
                const ctx = canvas.getContext("2d");
                ctx.beginPath();
                ctx.moveTo(pos.x, pos.y);
                e.preventDefault();
            };

            const moveDraw = (e) => {
                if (!isDrawing) return;
                const pos = getPos(e);
                const ctx = canvas.getContext("2d");
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
                    form[fieldKey] = canvas.toDataURL("image/png");
                    if (fieldKey === "studentSignature" && !form.studentSignDate) {
                        form.studentSignDate = today;
                    }
                    if (fieldKey === "supervisorSignature" && !form.supervisorSignDate) {
                        form.supervisorSignDate = today;
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

        const refreshCanvases = () => {
            Vue.nextTick(() => {
                initCanvas(supervisorCanvasRef.value, "supervisorSignature", canSupervisorEdit.value);
                initCanvas(studentCanvasRef.value, "studentSignature", canSaAcknowledge.value);
            });
        };

        const clearSignature = (which) => {
            const canvas = which === "supervisor" ? supervisorCanvasRef.value : studentCanvasRef.value;
            const key = which === "supervisor" ? "supervisorSignature" : "studentSignature";
            const pad = which === "supervisor" ? supPad : stuPad;
            if (pad) {
                pad.clear();
            } else if (canvas) {
                const ctx = canvas.getContext("2d");
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = "#FFFFFF";
                ctx.fillRect(0, 0, canvas.width, canvas.height);
            }
            form[key] = "";
            if (which === "student") {
                form.studentSignDate = "";
            } else if (which === "supervisor") {
                form.supervisorSignDate = "";
            }
        };

        // Adopt an electronic signature on the Immediate Supervisor canvas if submitting without drawing manually
        const ensureSupervisorElectronicSignature = () => {
            if (form.supervisorSignature && form.supervisorSignature.startsWith("data:image") && !form.supervisorSignature.includes("iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB") && !form.supervisorSignature.includes("Electronically")) {
                return form.supervisorSignature;
            }
            return adoptSupervisorSignature();
        };

        // Adopt an electronic signature on the Student Assistant canvas if the S.A. confirms acknowledgment without drawing manually
        const ensureStudentElectronicSignature = () => {
            if (form.studentSignature && form.studentSignature.startsWith("data:image") && !form.studentSignature.includes("iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB") && !form.studentSignature.includes("Electronically")) {
                return form.studentSignature;
            }
            return adoptStudentSignature();
        };

        const scrollToEvaluationSection = () => {
            const el = document.getElementById("eval-criteria-card");
            if (el) {
                el.scrollIntoView({ behavior: "smooth", block: "start" });
            } else {
                window.scrollTo({ top: 0, behavior: "smooth" });
            }
        };

        // STEP 1 DRAFT SAVE: Supervisor saves progress without locking Step 1 or advancing the workflow
        const saveSupervisorDraft = async () => {
            if (!canSupervisorEdit.value || savingDraft.value || saving.value) return;
            savingDraft.value = true;
            try {
                const res = await Model.request("evaluations", "save_draft", {
                    saProfileId: form.saProfileId,
                    studentName: sanitizeEvalText(form.studentName),
                    positionTitle: sanitizeEvalText(form.positionTitle),
                    department: sanitizeEvalText(form.department),
                    supervisorName: sanitizeEvalText(form.supervisorName),
                    evaluationPeriod: sanitizeEvalText(form.evaluationPeriod),
                    evalDate: form.evalDate,
                    criteria: form.criteria,
                    supervisorRecommendation: form.supervisorRecommendation,
                    supervisorReason: sanitizeEvalText(form.supervisorReason),
                    effectiveDate: form.effectiveDate,
                    strengthsWeaknesses: sanitizeEvalText(form.supervisorReason),
                    standardRemarks: sanitizeEvalText(form.standardRemarks),
                    recommendation: form.supervisorRecommendation === "NOT_RENEWED" ? "NOT_RECOMMENDED" : "RECOMMENDED",
                    supervisorSignature: form.supervisorSignature,
                    supervisorTitle: sanitizeEvalText(form.supervisorTitle),
                    supervisorSignDate: form.supervisorSignDate
                });
                if (!res.success) {
                    Toast.error(res.message || "Could not save evaluation draft.");
                    return;
                }
                form.hasDraft = true;
                if (res.evaluationId) {
                    form.evaluationId = res.evaluationId;
                    form.evaluationRef = `EVAL-#${res.evaluationId}`;
                }
                if (res.evaluation) {
                    applyEvaluationData(res.evaluation);
                }
                Toast.success(res.message || "Draft saved! Workflow remains with Supervisor until you submit the recommendation to the Coordinator.");
            } finally {
                savingDraft.value = false;
            }
        };

        // SUPERVISOR SUBMITS RECOMMENDATION TO COORDINATOR (Advances to FOR_COORDINATOR_REVIEW)
        const submitSupervisorEvaluation = async () => {
            if (!canSupervisorEdit.value || saving.value || savingDraft.value) return;

            for (let i = 1; i <= 10; i++) {
                const ratingVal = Number(form.criteria[i]);
                if (!ratingVal || ratingVal < 1 || ratingVal > 4) {
                    Toast.error(`Please select a rating (1 to 4) for Criterion #${i}: ${EVALUATION_CRITERIA[i - 1].title}.`);
                    return;
                }
            }
            if (!form.supervisorRecommendation) {
                Toast.error("Please select a Recommended Decision (Retain, Improvement Plan, Reassignment, or Non-Renewal).");
                return;
            }
            if (!form.supervisorReason || form.supervisorReason.trim().length < 3) {
                Toast.error("Please provide the Rationale / Feedback for your recommendation.");
                return;
            }
            if (!form.effectiveDate || !/^\d{4}-\d{2}-\d{2}$/.test(form.effectiveDate)) {
                Toast.error("Please provide a valid Effective Date (YYYY-MM-DD).");
                return;
            }
            if (!form.supervisorSignature) {
                Toast.error("Please sign the Immediate Supervisor Signature pad (draw or click Adopt E-Sig) before submitting your recommendation.");
                return;
            }

            const recLabel = decisionMeta(form.supervisorRecommendation)?.label || form.supervisorRecommendation;
            const targetSaName = form.studentName || 'Student Assistant';
            const ok = await Alerts.confirm({
                title: `Sign & Send to ${targetSaName} for Acknowledgement?`,
                text: `Overall Average: ${scoreStats.value.avg}/4.00 (${scoreStats.value.badgeText}) • Recommended Decision: ${recLabel} (Effective: ${Format.date(form.effectiveDate)}). Submitting will record your signature and send this recommendation to ${targetSaName} for acknowledgement.`,
                confirmText: `Yes, Sign & Send to ${targetSaName}`,
                cancelText: "Review Again",
                requireReason: false
            });
            if (!ok) return;

            saving.value = true;
            try {
                const res = await Model.request("evaluations", "save_evaluation", {
                    saProfileId: form.saProfileId,
                    studentName: sanitizeEvalText(form.studentName),
                    positionTitle: sanitizeEvalText(form.positionTitle),
                    department: sanitizeEvalText(form.department),
                    supervisorName: sanitizeEvalText(form.supervisorName),
                    evaluationPeriod: sanitizeEvalText(form.evaluationPeriod),
                    evalDate: form.evalDate,
                    criteria: form.criteria,
                    supervisorRecommendation: form.supervisorRecommendation,
                    supervisorReason: sanitizeEvalText(form.supervisorReason),
                    strengthsWeaknesses: sanitizeEvalText(form.supervisorReason),
                    effectiveDate: form.effectiveDate,
                    standardRemarks: sanitizeEvalText(form.standardRemarks),
                    recommendation: form.supervisorRecommendation === "NOT_RENEWED" ? "NOT_RECOMMENDED" : "RECOMMENDED",
                    supervisorSignature: form.supervisorSignature,
                    supervisorTitle: sanitizeEvalText(form.supervisorTitle),
                    supervisorSignDate: form.supervisorSignDate
                });

                if (!res.success) {
                    Toast.error(res.message || "Could not submit evaluation recommendation.");
                    return;
                }
                if (res.evaluation) {
                    applyEvaluationData(res.evaluation);
                } else {
                    form.status = "FOR_SA_REVIEW";
                    form.workflowStage = "pending_sa_review";
                }
                await Alerts.success("Recommendation Submitted!", res.message || `Evaluation recommendation (${recLabel}) signed and sent to ${targetSaName} for acknowledgement.`);
                emit("saved", { ...res, returnToList: true });
            } finally {
                saving.value = false;
            }
        };

        // Supervisor requests Coordinator authorization to revise a submitted evaluation
        const submitSupervisorRevisionRequest = async () => {
            if (!supRevisionReqReason.value || supRevisionReqReason.value.trim().length < 5) {
                Toast.error("Please enter a clear reason (at least 5 characters) why this evaluation needs revision.");
                return;
            }
            saving.value = true;
            try {
                const res = await Model.request("evaluations", "supervisor_request_revision", {
                    saProfileId: form.saProfileId,
                    reason: sanitizeEvalText(supRevisionReqReason.value)
                });
                if (!res.success) {
                    Toast.error(res.message || "Could not send revision request.");
                    return;
                }
                if (res.evaluation) {
                    applyEvaluationData(res.evaluation);
                }
                await Alerts.success("Revision Requested!", res.message || "Revision request sent to the S.A. Coordinator.");
                showSupRevisionReqModal.value = false;
                emit("saved", { ...res, returnToList: true });
            } finally {
                saving.value = false;
            }
        };

        // STEP 2 OPTIONAL RESPONSE: Student Assistant saves optional response or comments
        const submitSaResponse = async () => {
            if (!canSaAcknowledge.value || savingResponse.value || saving.value) return;
            const trimmedComments = (form.saComments || "").trim();
            if (!trimmedComments) {
                Toast.info("Please type your optional response or comments in the response box first.");
                const commentInput = document.getElementById("sa-step2-comments-input");
                if (commentInput) commentInput.focus();
                return;
            }
            savingResponse.value = true;
            try {
                const res = await Model.request("evaluations", "sa_save_response", {
                    evaluationId: form.evaluationId,
                    saProfileId: form.saProfileId,
                    saComments: sanitizeEvalText(trimmedComments)
                });
                if (res && res.evaluation) {
                    applyEvaluationData(res.evaluation);
                }
                if (!res || !res.success) {
                    const checkRes = await Model.request("evaluations", "sa_my_evaluation");
                    if (checkRes && checkRes.success && checkRes.evaluation) {
                        applyEvaluationData(checkRes.evaluation);
                        if ((checkRes.evaluation.saComments || "").trim() === sanitizeEvalText(trimmedComments)) {
                            Toast.success("Your response has been saved!");
                            emit("saved", { success: true, evaluation: checkRes.evaluation, keepOpen: true });
                            return;
                        }
                    }
                    Toast.error((res && res.message) || "Could not submit your response.");
                    return;
                }
                Toast.success(res.message || "Your response has been saved!");
                emit("saved", { ...res, keepOpen: true });
            } finally {
                savingResponse.value = false;
            }
        };

        // STEP 4 ACKNOWLEDGE: Student Assistant confirms receipt & review -> transitions to FINALIZED
        const submitSaAcknowledgment = async () => {
            if (!canSaAcknowledge.value || saving.value || savingResponse.value) return;
            if (form.saHasDispute && (!form.saConcernText || form.saConcernText.trim().length < 5)) {
                Toast.error("Please describe your concern or response (at least 5 characters) for the S.A. Coordinator to review.");
                return;
            }

            saving.value = true;
            try {
                const ok = await Alerts.confirm({
                    title: "Acknowledge Performance Evaluation?",
                    text: "Your acknowledgment confirms that you have received and reviewed your performance evaluation criteria (1–10) and supervisor assessment. Your electronic signature and acknowledgment will be forwarded to the Student Assistant Coordinator for final review and approval.",
                    confirmText: "Yes, Acknowledge & Forward to Coordinator",
                    cancelText: "Cancel",
                    requireReason: false
                });
                if (!ok) return;

                if (!form.studentSignature) {
                    Toast.error("Please sign the Student Assistant signature pad (draw or click Adopt E-Sig) to acknowledge.");
                    return;
                }
                const sigDataUrl = form.studentSignature;
                if (!form.studentSignDate) {
                    form.studentSignDate = today;
                }
                const res = await Model.request("evaluations", "sa_acknowledge", {
                    evaluationId: form.evaluationId,
                    saProfileId: form.saProfileId,
                    studentSignature: sigDataUrl,
                    studentRole: sanitizeEvalText(form.studentRole),
                    studentSignDate: form.studentSignDate,
                    saComments: sanitizeEvalText(form.saComments),
                    saHasDispute: form.saHasDispute ? 1 : 0,
                    saConcernText: sanitizeEvalText(form.saConcernText)
                });

                if (res && res.evaluation) {
                    applyEvaluationData(res.evaluation);
                }

                if (!res || !res.success) {
                    // Recover from network interruption after database update by checking authoritative server state
                    const verifyRes = await Model.request("evaluations", "sa_my_evaluation");
                    if (verifyRes && verifyRes.success && verifyRes.evaluation) {
                        applyEvaluationData(verifyRes.evaluation);
                        if (verifyRes.evaluation.saAcknowledgedAt || verifyRes.evaluation.acknowledgmentStatus === "SIGNED" || (verifyRes.evaluation.studentSignature && (verifyRes.evaluation.status === "FOR_COORDINATOR_REVIEW" || verifyRes.evaluation.status === "FINALIZED"))) {
                            await Alerts.success("Successfully Acknowledged!", "Evaluation acknowledged successfully! Forwarded to S.A. Coordinator for final review.");
                            emit("saved", { success: true, evaluation: verifyRes.evaluation, returnToList: true });
                            return;
                        }
                    }
                    Toast.error((res && res.message) || "Could not submit your acknowledgment.");
                    return;
                }

                if (!res.evaluation) {
                    const freshRes = await Model.request("evaluations", "sa_my_evaluation");
                    if (freshRes && freshRes.success && freshRes.evaluation) {
                        applyEvaluationData(freshRes.evaluation);
                        res.evaluation = freshRes.evaluation;
                    }
                }

                if (res.alreadyAcknowledged) {
                    await Alerts.success("Evaluation Acknowledged", res.message || "You have already acknowledged this evaluation record.");
                } else {
                    await Alerts.success("Successfully Acknowledged!", res.message || "Evaluation acknowledged successfully! Forwarded to S.A. Coordinator for final review.");
                }
                emit("saved", { ...res, returnToList: true });
            } finally {
                saving.value = false;
            }
        };

        // STEP 2 EXTENSION REQUEST
        const submitSaExtensionRequest = async () => {
            if (!extForm.reasonCategory) {
                Toast.error("Please select a reason category for your extension request.");
                return;
            }
            saving.value = true;
            try {
                const res = await Model.request("evaluations", "sa_request_extension", {
                    reasonCategory: extForm.reasonCategory,
                    requestedDays: extForm.requestedDays,
                    explanation: sanitizeEvalText(extForm.explanation)
                });
                if (!res.success) {
                    Toast.error(res.message || "Could not submit extension request.");
                    return;
                }
                if (res.evaluation) {
                    applyEvaluationData(res.evaluation);
                }
                await Alerts.success("Extension Request Submitted", res.message || "Extension request submitted to the S.A. Coordinator.");
                showExtensionModal.value = false;
                emit("saved", { ...res, returnToList: true });
            } finally {
                saving.value = false;
            }
        };

        // STEP 2 CONCERN / EXCEPTION
        const submitSaConcernException = async () => {
            if (!concernForm.reasonText || concernForm.reasonText.trim().length < 5) {
                Toast.error("Please provide a clear explanation or reason (at least 5 characters) for the S.A. Coordinator.");
                return;
            }
            saving.value = true;
            try {
                const res = await Model.request("evaluations", "sa_submit_concern", {
                    exceptionType: concernForm.exceptionType,
                    reasonText: sanitizeEvalText(concernForm.reasonText),
                    saComments: sanitizeEvalText(form.saComments),
                    studentSignature: form.studentSignature
                });
                if (!res.success) {
                    Toast.error(res.message || "Could not submit concern/exception record.");
                    return;
                }
                if (res.evaluation) {
                    applyEvaluationData(res.evaluation);
                }
                await Alerts.success("Concern Submitted", res.message || "Record submitted and routed to the S.A. Coordinator.");
                showConcernModal.value = false;
                emit("saved", { ...res, returnToList: true });
            } finally {
                saving.value = false;
            }
        };

        // COORDINATOR EXTENSION DECISION (Approve / Reject)
        const submitCoordExtensionDecision = async () => {
            if (!coordExtForm.decisionReason || coordExtForm.decisionReason.trim().length < 3) {
                Toast.error("Please enter a reason for approving or rejecting this extension request.");
                return;
            }
            saving.value = true;
            try {
                const res = await Model.request("evaluations", "coordinator_review_extension", {
                    saProfileId: form.saProfileId,
                    decision: coordExtForm.decision,
                    extensionDays: coordExtForm.extensionDays,
                    newDueDate: coordExtForm.newDueDate || null,
                    decisionReason: sanitizeEvalText(coordExtForm.decisionReason)
                });
                if (!res.success) {
                    Toast.error(res.message || "Could not save extension decision.");
                    return;
                }
                if (res.evaluation) {
                    applyEvaluationData(res.evaluation);
                }
                await Alerts.success("Extension Decision Saved", res.message || "Extension decision saved and S.A. notified.");
                showCoordExtensionModal.value = false;
                emit("saved", { ...res, returnToList: true });
            } finally {
                saving.value = false;
            }
        };

        // COORDINATOR RETURN FOR REVISION (Step 3 -> Step 1)
        const submitReturnForRevision = async () => {
            if (!returnRevisionReason.value || returnRevisionReason.value.trim().length < 5) {
                Toast.error("Please provide a clear reason (at least 5 characters) for returning this evaluation to the Supervisor.");
                return;
            }
            saving.value = true;
            try {
                const res = await Model.request("evaluations", "coordinator_return_revision", {
                    saProfileId: form.saProfileId,
                    returnReason: sanitizeEvalText(returnRevisionReason.value)
                });
                if (!res.success) {
                    Toast.error(res.message || "Could not return evaluation for revision.");
                    return;
                }
                if (res.evaluation) {
                    applyEvaluationData(res.evaluation);
                }
                await Alerts.success("Returned for Correction", res.message || "Evaluation returned to Supervisor for clarification/revision.");
                showReturnRevisionModal.value = false;
                emit("saved", { ...res, returnToList: true });
            } finally {
                saving.value = false;
            }
        };

        // COORDINATOR OVERDUE / EXCEPTION FOLLOW-UP
        const submitCoordExceptionFollowup = async () => {
            if (!coordExceptionForm.remarks || coordExceptionForm.remarks.trim().length < 5) {
                Toast.error("Please enter follow-up notes or the documented exception reason (at least 5 characters).");
                return;
            }
            saving.value = true;
            try {
                const res = await Model.request("evaluations", "coordinator_mark_exception", {
                    saProfileId: form.saProfileId,
                    acknowledgmentStatus: coordExceptionForm.acknowledgmentStatus,
                    remarks: sanitizeEvalText(coordExceptionForm.remarks)
                });
                if (!res.success) {
                    Toast.error(res.message || "Could not log exception follow-up.");
                    return;
                }
                if (res.evaluation) {
                    applyEvaluationData(res.evaluation);
                }
                Toast.success(res.message || "Follow-up logged and routed to Step 3 Coordinator Review.");
                showCoordExceptionModal.value = false;
                emit("saved", res);
            } finally {
                saving.value = false;
            }
        };

        const scrollToSaResponseSection = () => {
            const el = document.getElementById("sa-step2-response-summary") || document.getElementById("sa-signature-card") || document.getElementById("eval-criteria-card");
            if (el) {
                el.scrollIntoView({ behavior: "smooth", block: "center" });
            } else {
                window.scrollTo({ top: 0, behavior: "smooth" });
            }
        };

        // Helper to fetch authoritative evaluation state for Coordinator/Supervisor after an ambiguous network failure
        const fetchAuthoritativeEvaluationForAdminOrSup = async () => {
            const actionName = props.mode === "SUPERVISOR" ? "supervisor_list" : "admin_overview";
            const checkRes = await Model.request("evaluations", actionName);
            if (checkRes && checkRes.success && Array.isArray(checkRes.evaluations)) {
                const found = checkRes.evaluations.find(e => Number(e.saProfileId) === Number(form.saProfileId));
                if (found) {
                    applyEvaluationData(found);
                    return found;
                }
            }
            return null;
        };

        // STEP 3 -> STEP 4: Coordinator completes Step 3 Review and advances to Step 4 Final Decision
        const completeCoordinatorReviewStep = async () => {
            if (saving.value || savingDraft.value) return;
            saving.value = true;
            try {
                const res = await Model.request("evaluations", "coordinator_complete_review", {
                    saProfileId: form.saProfileId,
                    reviewNotes: sanitizeEvalText(coordReviewNotes.value)
                });
                if (res && res.evaluation) {
                    applyEvaluationData(res.evaluation);
                }
                if (!res || !res.success) {
                    const verified = await fetchAuthoritativeEvaluationForAdminOrSup();
                    if (verified && verified.status === "FOR_FINAL_DECISION") {
                        Toast.success("Step 3 (Coordinator Review) completed! Proceed to Step 4: Final Decision.");
                        emit("saved", { success: true, evaluation: verified, keepOpen: true });
                        return;
                    }
                    Toast.error((res && res.message) || "Could not complete Step 3 review.");
                    return;
                }
                if (!res.evaluation) {
                    form.status = "FOR_FINAL_DECISION";
                    form.workflowStage = "step4_pending_final_decision";
                    if (form.tracker) {
                        form.tracker.currentStep = 4;
                        form.tracker.currentStatus = "Step 4: Awaiting Final Decision";
                    }
                }
                if (res.alreadyReviewed) {
                    Toast.info(res.message || "Step 3 (Coordinator Review) has already been completed. Now at Step 4: Final Decision.");
                } else {
                    Toast.success(res.message || "Step 3 (Coordinator Review) completed! Proceed to Step 4: Final Decision.");
                }
                emit("saved", { ...res, keepOpen: true });
            } finally {
                saving.value = false;
            }
        };

        // STEP 4 DRAFT: Coordinator saves Final Decision draft without finalizing or advancing to Step 5
        const saveCoordinatorDecisionDraft = async () => {
            if (!canCoordinatorDecide.value || savingDraft.value || saving.value) return;
            savingDraft.value = true;
            try {
                const res = await Model.request("evaluations", "coordinator_save_decision_draft", {
                    saProfileId: form.saProfileId,
                    coordinatorDecision: form.coordinatorDecision,
                    coordinatorReason: sanitizeEvalText(form.coordinatorReason),
                    effectiveDate: form.effectiveDate
                });
                if (res && res.evaluation) {
                    applyEvaluationData(res.evaluation);
                }
                if (!res || !res.success) {
                    Toast.error((res && res.message) || "Could not save decision draft.");
                    return;
                }
                Toast.success(res.message || "Final Decision draft saved! Evaluation remains in Step 4 until finalized.");
                emit("saved", { ...res, keepOpen: true });
            } finally {
                savingDraft.value = false;
            }
        };

        // COORDINATOR APPROVES RECOMMENDATION & FINALIZES EVALUATION (Step 5)
        const submitApproveRecommendation = async () => {
            if (saving.value || savingDraft.value) return;
            const chosenDecision = form.coordinatorDecision || form.supervisorRecommendation || "RETAIN";
            const decLabel = decisionMeta(chosenDecision)?.label || chosenDecision;
            const chosenDate = form.effectiveDate || today;

            const ok = await Alerts.confirm({
                title: `Approve Final Decision: ${decLabel}?`,
                text: `Approve final decision (${decLabel}, Effective: ${Format.date(chosenDate)}) for ${form.studentName}? This will advance the workflow to Step 5 (Finalized Evaluation), complete and lock the record, and notify both ${form.studentName} and the supervisor.`,
                confirmText: "Yes, Approve & Finalize Record",
                cancelText: "Cancel",
                requireReason: false
            });
            if (!ok) return;

            saving.value = true;
            try {
                const res = await Model.request("evaluations", "coordinator_decide", {
                    saProfileId: form.saProfileId,
                    coordinatorDecision: chosenDecision,
                    coordinatorReason: sanitizeEvalText(form.coordinatorReason || form.supervisorReason),
                    disclosedFeedback: sanitizeEvalText(form.disclosedFeedback || form.coordinatorReason || form.supervisorReason),
                    effectiveDate: chosenDate
                });

                if (res && res.evaluation) {
                    applyEvaluationData(res.evaluation);
                }

                if (!res || !res.success) {
                    Toast.error((res && res.message) || "Could not approve final decision.");
                    return;
                }
                await Alerts.success("Decision Approved & Finalized!", res.message || `Final decision (${decLabel}) approved. Evaluation record is now finalized.`);
                emit("saved", { ...res, returnToList: true });
            } finally {
                saving.value = false;
            }
        };

        const submitCoordinatorDecision = submitApproveRecommendation;

        // COORDINATOR REJECTS RECOMMENDATION (Required Reason)
        const showRejectModal = Vue.ref(false);
        const coordinatorRejectionReason = Vue.ref("");

        const submitCoordinatorReject = async () => {
            if (!coordinatorRejectionReason.value || coordinatorRejectionReason.value.trim().length < 5) {
                Toast.error("Please provide a required reason (at least 5 characters) for rejecting this recommendation.");
                return;
            }
            const ok = await Alerts.confirm({
                title: "Reject Supervisor Recommendation?",
                text: `Are you sure you want to reject the evaluation recommendation for ${form.studentName}? The Immediate Supervisor will be notified of this rejection and the reason provided.`,
                confirmText: "Yes, Reject Recommendation",
                cancelText: "Cancel",
                requireReason: false
            });
            if (!ok) return;

            saving.value = true;
            try {
                const res = await Model.request("evaluations", "coordinator_reject", {
                    saProfileId: form.saProfileId,
                    rejectionReason: sanitizeEvalText(coordinatorRejectionReason.value)
                });
                if (!res || !res.success) {
                    Toast.error((res && res.message) || "Could not reject recommendation.");
                    return;
                }
                if (res.evaluation) {
                    applyEvaluationData(res.evaluation);
                }
                await Alerts.success("Recommendation Rejected", res.message || "Recommendation rejected and recorded.");
                showRejectModal.value = false;
                emit("saved", { ...res, returnToList: true });
            } finally {
                saving.value = false;
            }
        };

        // COORDINATOR REOPENS A FINALIZED EVALUATION
        const submitReopenEvaluation = async () => {
            if (!reopenForm.reopenReason || reopenForm.reopenReason.trim().length < 5) {
                Toast.error("Please enter an authorization reason (at least 5 characters) for reopening this finalized evaluation.");
                return;
            }
            saving.value = true;
            try {
                const res = await Model.request("evaluations", "coordinator_reopen", {
                    saProfileId: form.saProfileId,
                    targetStage: reopenForm.targetStage,
                    reopenReason: sanitizeEvalText(reopenForm.reopenReason)
                });
                if (!res.success) {
                    Toast.error(res.message || "Could not reopen finalized evaluation.");
                    return;
                }
                if (res.evaluation) {
                    applyEvaluationData(res.evaluation);
                }
                await Alerts.success("Evaluation Reopened", res.message || "Finalized evaluation reopened with audit log.");
                showReopenModal.value = false;
                emit("saved", { ...res, returnToList: true });
            } finally {
                saving.value = false;
            }
        };

        const printForm = () => {
            window.print();
        };

        Vue.onMounted(() => {
            refreshCanvases();
        });

        return {
            form, RATING_OPTIONS, EVALUATION_CRITERIA, EXTENSION_REASON_CATEGORIES,
            scoreStats, autoDetectedRecommendation, saving, savingDraft, savingResponse, supervisorCanvasRef, studentCanvasRef,
            canSupervisorEdit, canSaAcknowledge, canCoordinatorDecide,
            activeProcessStage, currentStepMeta, currentStatusBadge, actionPanelHeading, nextActionSummary, returnHistoryEntries,
            coordReviewNotes, completeCoordinatorReviewStep, saveCoordinatorDecisionDraft, scrollToSaResponseSection,
            showExtensionModal, extForm, submitSaExtensionRequest,
            showConcernModal, concernForm, submitSaConcernException,
            showCoordExtensionModal, coordExtForm, submitCoordExtensionDecision,
            showReturnRevisionModal, returnRevisionReason, submitReturnForRevision,
            showRejectModal, coordinatorRejectionReason, submitCoordinatorReject, submitApproveRecommendation,
            showSupRevisionReqModal, supRevisionReqReason, submitSupervisorRevisionRequest,
            showCoordExceptionModal, coordExceptionForm, submitCoordExceptionFollowup,
            showReopenModal, reopenForm, submitReopenEvaluation,
            adoptSupervisorSignature, adoptStudentSignature, setAllRatings, insertSampleRationale,
            clearSignature, saveSupervisorDraft, scrollToEvaluationSection,
            submitSupervisorEvaluation, submitSaResponse, submitSaAcknowledgment, submitCoordinatorDecision,
            printForm, emit, Format, today, evalStatusMeta, ackStatusMeta, decisionMeta, workflowStatusBadge
        };
    },

    template: `
    <div class="space-y-5">
        <!-- ==================================================================== -->
        <!-- LAYER B HEADER: Back Button, Employee Info & Evaluation Reference    -->
        <!-- ==================================================================== -->
        <div class="no-print card border border-line bg-white p-4 shadow-sm">
            <div class="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
                <div class="flex items-start gap-3">
                    <button type="button" @click="emit('close')"
                            class="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 transition"
                            title="Return to Evaluation Overview without losing active filters">
                        <app-icon name="ArrowLeft" :size="16" />
                        <span>Back to List</span>
                    </button>
                    <div>
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="rounded bg-navy/10 px-2 py-0.5 font-mono text-xs font-extrabold text-navy whitespace-nowrap shrink-0">
                                {{ form.evaluationRef }}
                            </span>
                            <span class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold"
                                  :class="currentStatusBadge.cls">
                                <app-icon :name="currentStatusBadge.icon" :size="13" />
                                {{ currentStatusBadge.label }}
                            </span>
                            <span class="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                                {{ currentStepMeta.stepTitle }}
                            </span>
                        </div>
                        <h2 class="mt-1 text-lg font-extrabold text-navy sm:text-xl">
                            {{ form.studentName }}
                            <span v-if="form.studentId" class="ml-1 text-sm font-medium text-muted">({{ form.studentId }})</span>
                        </h2>
                        <p class="mt-0.5 text-xs text-muted">
                            <strong>Assignment:</strong> {{ form.department }} <template v-if="form.category">({{ form.category }})</template>
                            • <strong>Supervisor:</strong> {{ form.supervisorName }}
                            • <strong>Review Period:</strong> {{ form.evaluationPeriod }}
                        </p>
                    </div>
                </div>

                <!-- Secondary Utility Actions (Print / Request Revision / Reopen) -->
                <div class="flex flex-wrap items-center gap-2">
                    <button v-if="mode === 'SUPERVISOR' && !canSupervisorEdit && form.status !== 'FINALIZED'"
                            type="button" @click="showSupRevisionReqModal = true"
                            class="btn btn-sm btn-outline border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100">
                        <app-icon name="RotateCcw" :size="14" /> Request Revision Authorization
                    </button>
                    <button v-if="mode === 'COORDINATOR' && form.status === 'FINALIZED'"
                            type="button" @click="showReopenModal = true"
                            class="btn btn-sm btn-outline border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100">
                        <app-icon name="Unlock" :size="14" /> Reopen Finalized Evaluation
                    </button>
                    <button type="button" @click="printForm" class="btn btn-sm btn-outline">
                        <app-icon name="Printer" :size="14" /> Print / Save PDF
                    </button>
                </div>
            </div>

            <!-- Current Step, Responsible Role, Status & Deadline Summary Strip -->
            <div class="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-3.5 sm:grid-cols-4">
                <div>
                    <p class="text-[11px] font-bold uppercase text-muted">Current Workflow Step</p>
                    <p class="mt-0.5 text-xs font-extrabold text-navy">{{ currentStepMeta.stepTitle }}</p>
                </div>
                <div>
                    <p class="text-[11px] font-bold uppercase text-muted">Next Action Assigned To</p>
                    <p class="mt-0.5 text-xs font-bold text-ink">{{ form.nextActionAssignedTo || form.tracker?.responsiblePerson || currentStepMeta.responsibleRole }}</p>
                </div>
                <div>
                    <p class="text-[11px] font-bold uppercase text-muted">Workflow Status</p>
                    <p class="mt-0.5 text-xs font-bold text-ink">{{ currentStatusBadge.label }} — {{ currentStatusBadge.detail }}</p>
                </div>
                <div>
                    <p class="text-[11px] font-bold uppercase text-muted">Relevant Deadline / Date</p>
                    <p v-if="form.status === 'FOR_SA_REVIEW' && form.ackDueDate"
                       class="mt-0.5 text-xs font-bold"
                       :class="form.isAckOverdue ? 'text-rose-600' : 'text-blue-700'">
                        {{ Format.date(form.ackDueDate) }} {{ form.isAckOverdue ? '(Overdue)' : '(5 School Days)' }}
                    </p>
                    <p v-else-if="form.status === 'FINALIZED' && form.effectiveDate" class="mt-0.5 text-xs font-bold text-emerald-700">
                        Effective {{ Format.date(form.effectiveDate) }}
                    </p>
                    <p v-else class="mt-0.5 text-xs font-medium text-muted">
                        {{ form.submittedAt ? ('Submitted ' + Format.date(form.submittedAt)) : 'Active Cycle' }}
                    </p>
                </div>
            </div>
        </div>

        <!-- ==================================================================== -->
        <!-- FIVE-STEP PROGRESS TRACKER (Horizontal Desktop / Compact Mobile)    -->
        <!-- ==================================================================== -->
        <evaluation-process-tracker :active-stage="activeProcessStage" :tracker="form.tracker" />

        <!-- ==================================================================== -->
        <!-- VISIBLE HISTORY OF RETURNED EVALUATIONS & RECORDED REASONS           -->
        <!-- ==================================================================== -->
        <!-- ==================================================================== -->
        <!-- VISIBLE HISTORY OF RETURNED EVALUATIONS & RECORDED REASONS           -->
        <!-- ==================================================================== -->
        <div v-if="form.status === 'RETURNED_FOR_REVISION' || form.revisionCount > 0 || form.lastReturnReason || returnHistoryEntries.length > 0"
             class="rounded-2xl border-2 border-orange-300 bg-orange-50/70 p-4 text-orange-950 shadow-sm">
            <div class="flex items-start gap-3">
                <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-orange-500 text-white">
                    <app-icon name="RotateCcw" :size="18" />
                </div>
                <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <h3 class="text-sm font-extrabold">
                            Returned Evaluation &amp; Clarification History
                            <span v-if="form.revisionCount > 0" class="ml-1.5 rounded bg-orange-200 px-2 py-0.5 text-[11px] font-bold text-orange-900">
                                Revision #{{ form.revisionCount }}
                            </span>
                        </h3>
                        <span v-if="form.returnedAt" class="text-xs font-semibold text-orange-800">
                            Last Returned: {{ Format.dateTime(form.returnedAt) }}
                        </span>
                    </div>
                    <p v-if="form.lastReturnReason" class="mt-1 text-xs text-orange-900">
                        <strong>Latest Recorded Reason ({{ form.returnedByName || 'S.A. Coordinator' }}):</strong> {{ form.lastReturnReason }}
                    </p>
                    <div v-if="returnHistoryEntries.length > 0" class="mt-2.5 space-y-1.5 border-t border-orange-200/80 pt-2">
                        <div v-for="entry in returnHistoryEntries" :key="entry.id" class="rounded-lg bg-white/80 px-3 py-1.5 text-xs">
                            <span class="font-bold text-navy">{{ entry.actionType.replace(/_/g, ' ') }}</span>
                            <span class="text-muted"> • {{ entry.actorName }} ({{ Format.dateTime(entry.createdAt) }})</span>
                            <p v-if="entry.remarks" class="mt-0.5 text-ink">{{ entry.remarks }}</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- ==================================================================== -->
        <!-- REJECTED BANNER (Visible when Recommendation is Rejected)            -->
        <!-- ==================================================================== -->
        <div v-if="form.status === 'REJECTED'"
             class="rounded-2xl border-2 border-rose-300 bg-rose-50/80 p-4 text-rose-950 shadow-sm">
            <div class="flex items-start gap-3">
                <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-rose-600 text-white">
                    <app-icon name="XCircle" :size="18" />
                </div>
                <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <h3 class="text-sm font-extrabold text-rose-900">
                            Evaluation Recommendation Rejected by S.A. Coordinator
                        </h3>
                        <span v-if="form.rejectedAt" class="text-xs font-semibold text-rose-800">
                            {{ Format.dateTime(form.rejectedAt) }}
                        </span>
                    </div>
                    <p v-if="form.rejectionReason" class="mt-1 text-xs text-rose-900">
                        <strong>Required Reason for Rejection ({{ form.rejectedByName || 'S.A. Coordinator' }}):</strong> {{ form.rejectionReason }}
                    </p>
                </div>
            </div>
        </div>

        <!-- ==================================================================== -->
        <!-- STEP 5 FINALIZED SUMMARY CARD (Visible when Finalized)               -->
        <!-- ==================================================================== -->
        <div v-if="form.status === 'FINALIZED'"
             class="rounded-2xl border-2 border-emerald-400 bg-emerald-50/70 p-5 shadow-sm">
            <!-- Non-SA Viewer (Coordinator / Supervisor) -->
            <div v-if="mode !== 'SA'" class="space-y-1">
                <div class="flex flex-wrap items-center gap-2">
                    <span class="rounded bg-emerald-700 px-2.5 py-0.5 text-[11px] font-bold uppercase text-white">
                        Step 5: Finalized Evaluation Record
                    </span>
                    <span v-if="form.coordinatorDecision" class="inline-flex items-center gap-1 rounded-full px-3 py-0.5 text-xs font-extrabold"
                          :class="decisionMeta(form.coordinatorDecision)?.badgeCls">
                        <app-icon :name="decisionMeta(form.coordinatorDecision)?.icon || 'CheckCircle2'" :size="14" />
                        Official Final Decision: {{ decisionMeta(form.coordinatorDecision)?.label }}
                    </span>
                </div>
                <p v-if="form.coordinatorReason" class="mt-1 text-sm font-bold text-slate-900">
                    Rationale &amp; Official Remarks: <span class="font-normal text-slate-800">{{ form.coordinatorReason }}</span>
                </p>
                <p v-if="form.disclosedFeedback" class="mt-1 text-sm font-bold text-slate-900">
                    Disclosed Feedback: <span class="font-normal text-slate-800">{{ form.disclosedFeedback }}</span>
                </p>
                <p class="text-xs text-slate-600">
                    Authorized by <strong>{{ form.coordinatorName || 'S.A. Coordinator' }}</strong>
                    • Effective Date: <strong>{{ Format.date(form.effectiveDate) }}</strong>
                    <template v-if="form.finalizedAt"> • Finalized {{ Format.dateTime(form.finalizedAt) }}</template>
                </p>
            </div>
            <!-- S.A. Viewer (Masked: confidential internal rationale & decision options hidden) -->
            <div v-else class="space-y-2">
                <div class="flex flex-wrap items-center gap-2">
                    <span class="rounded bg-emerald-700 px-2.5 py-0.5 text-[11px] font-bold uppercase text-white">
                        Official Performance Evaluation Record
                    </span>
                    <span class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-3 py-0.5 text-xs font-extrabold text-emerald-800 border border-emerald-300">
                        <app-icon name="CheckCircle2" :size="14" /> Finalized &amp; Acknowledged
                    </span>
                </div>
                <div v-if="form.disclosedFeedback" class="mt-2 rounded-xl bg-white/90 p-3.5 border border-emerald-200">
                    <p class="text-xs font-bold uppercase tracking-wider text-emerald-900">Approved Performance Feedback:</p>
                    <p class="mt-1 text-sm text-slate-800 whitespace-pre-line">{{ form.disclosedFeedback }}</p>
                </div>
                <p class="text-xs text-slate-600">
                    Evaluation finalized and acknowledged on {{ Format.dateTime(form.finalizedAt || form.updatedAt) }}.
                </p>
            </div>
        </div>

        <!-- ==================================================================== -->
        <!-- UNIFIED EVALUATION FORM & CRITERIA CARD (No 5-tab pagination!)       -->
        <!-- ==================================================================== -->
        <div id="eval-criteria-card" class="card overflow-hidden border border-line bg-white shadow-sm">
            <!-- Official Form Header Banner -->
            <div class="flex flex-col justify-between gap-3 border-b border-line bg-[#0F2C59] px-5 py-4 text-white sm:flex-row sm:items-center">
                <div>
                    <p class="text-[11px] font-bold uppercase tracking-wider text-[#D4AF37]">Step 1 Assessment Record</p>
                    <h3 class="text-base font-extrabold">Performance Evaluation Criteria (1–10) &amp; Supervisor Assessment</h3>
                </div>
                <span class="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200">
                    Rated {{ scoreStats.answered }} of 10 Criteria
                </span>
            </div>

            <div class="divide-y divide-line p-5 space-y-6">
                <!-- Rating Scale Legend & Quick Set Helper -->
                <div class="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-4 py-2.5 text-xs">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="font-bold uppercase tracking-wider text-slate-600">Rating Scale:</span>
                        <div class="flex flex-wrap items-center gap-3">
                            <span class="inline-flex items-center gap-1.5 font-semibold text-emerald-800"><strong class="rounded bg-emerald-100 px-1.5 py-0.5">4</strong> Above Average</span>
                            <span class="inline-flex items-center gap-1.5 font-semibold text-blue-800"><strong class="rounded bg-blue-100 px-1.5 py-0.5">3</strong> Satisfactory</span>
                            <span class="inline-flex items-center gap-1.5 font-semibold text-amber-800"><strong class="rounded bg-amber-100 px-1.5 py-0.5">2</strong> Below Average</span>
                            <span class="inline-flex items-center gap-1.5 font-semibold text-rose-800"><strong class="rounded bg-rose-100 px-1.5 py-0.5">1</strong> Unsatisfactory</span>
                        </div>
                    </div>
                    <div v-if="canSupervisorEdit" class="flex items-center gap-1.5">
                        <span class="text-[11px] font-bold text-slate-500 uppercase">Quick Set:</span>
                        <button type="button" @click="setAllRatings(4)" class="rounded-lg border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-800 hover:bg-emerald-100 transition">
                            All 4 (Above Average)
                        </button>
                        <button type="button" @click="setAllRatings(3)" class="rounded-lg border border-blue-300 bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-800 hover:bg-blue-100 transition">
                            All 3 (Satisfactory)
                        </button>
                    </div>
                </div>

                <!-- 10 Performance Criteria Table/Grid -->
                <div class="space-y-2.5 pt-2">
                    <!-- Table Column Header Row (Reference for ratings) -->
                    <div class="flex items-center justify-between rounded-xl bg-slate-100 border border-slate-200 px-4 py-2 text-xs font-bold text-slate-700">
                        <div class="min-w-0 flex-1 uppercase tracking-wider text-[11px] text-slate-600">
                            Performance Criteria (1–10)
                        </div>
                        <div class="grid grid-cols-4 gap-1.5 sm:gap-2 text-center w-44 sm:w-56 shrink-0 font-extrabold">
                            <div class="flex flex-col items-center">
                                <span class="inline-flex items-center justify-center h-6 w-6 rounded-md bg-emerald-100 text-emerald-800 text-xs font-black">4</span>
                                <span class="text-[9px] sm:text-[10px] text-emerald-800 font-bold mt-0.5 leading-tight">Above Avg</span>
                            </div>
                            <div class="flex flex-col items-center">
                                <span class="inline-flex items-center justify-center h-6 w-6 rounded-md bg-blue-100 text-blue-800 text-xs font-black">3</span>
                                <span class="text-[9px] sm:text-[10px] text-blue-800 font-bold mt-0.5 leading-tight">Satisfactory</span>
                            </div>
                            <div class="flex flex-col items-center">
                                <span class="inline-flex items-center justify-center h-6 w-6 rounded-md bg-amber-100 text-amber-800 text-xs font-black">2</span>
                                <span class="text-[9px] sm:text-[10px] text-amber-800 font-bold mt-0.5 leading-tight">Below Avg</span>
                            </div>
                            <div class="flex flex-col items-center">
                                <span class="inline-flex items-center justify-center h-6 w-6 rounded-md bg-rose-100 text-rose-800 text-xs font-black">1</span>
                                <span class="text-[9px] sm:text-[10px] text-rose-800 font-bold mt-0.5 leading-tight">Unsat</span>
                            </div>
                        </div>
                    </div>

                    <!-- Criteria Rows (1 to 10) -->
                    <div v-for="item in EVALUATION_CRITERIA" :key="item.id"
                         class="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 p-3.5 transition hover:border-slate-300 md:flex-row md:items-center"
                         :class="form.criteria[item.id] ? 'bg-white' : 'bg-slate-50/60'">
                        <div class="min-w-0 flex-1">
                            <div class="flex items-center gap-2">
                                <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#0F2C59] text-xs font-bold text-white">
                                    {{ item.id }}
                                </span>
                                <h4 class="text-sm font-bold text-slate-900">{{ item.title }}</h4>
                            </div>
                            <p class="mt-0.5 pl-8 text-xs text-slate-600">{{ item.desc }}</p>
                        </div>

                        <!-- Interactive Rating Selector (Supervisor in Step 1) -->
                        <div v-if="canSupervisorEdit" class="grid grid-cols-4 gap-1.5 sm:gap-2 w-full md:w-56 shrink-0">
                            <button v-for="opt in RATING_OPTIONS" :key="opt.val" type="button"
                                    @click="form.criteria[item.id] = opt.val"
                                    :title="opt.val + ' - ' + opt.label"
                                    class="flex h-10 items-center justify-center rounded-xl text-sm font-black transition cursor-pointer"
                                    :class="Number(form.criteria[item.id]) === opt.val
                                        ? (opt.val === 4 ? 'border-2 border-emerald-600 bg-emerald-600 text-white shadow-sm ring-2 ring-emerald-500/30'
                                          : opt.val === 3 ? 'border-2 border-blue-600 bg-blue-600 text-white shadow-sm ring-2 ring-blue-500/30'
                                          : opt.val === 2 ? 'border-2 border-amber-600 bg-amber-600 text-white shadow-sm ring-2 ring-amber-500/30'
                                          : 'border-2 border-rose-600 bg-rose-600 text-white shadow-sm ring-2 ring-rose-500/30')
                                        : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 hover:border-slate-300'">
                                {{ opt.val }}
                            </button>
                        </div>

                        <!-- Read-Only Matrix (S.A. Review, Coordinator Review, Finalized) -->
                        <div v-else class="grid grid-cols-4 gap-1.5 sm:gap-2 w-full md:w-56 shrink-0">
                            <div v-for="opt in RATING_OPTIONS" :key="opt.val"
                                 class="flex h-10 items-center justify-center rounded-xl text-sm font-black transition"
                                 :title="Number(form.criteria[item.id]) === opt.val ? (opt.val + ' - ' + opt.label) : ''"
                                 :class="Number(form.criteria[item.id]) === opt.val
                                     ? (opt.val === 4 ? 'border-2 border-emerald-600 bg-emerald-600 text-white shadow-sm'
                                       : opt.val === 3 ? 'border-2 border-blue-600 bg-blue-600 text-white shadow-sm'
                                       : opt.val === 2 ? 'border-2 border-amber-600 bg-amber-600 text-white shadow-sm'
                                       : 'border-2 border-rose-600 bg-rose-600 text-white shadow-sm')
                                     : 'border border-slate-100 bg-slate-50/60 text-slate-300'">
                                <span v-if="Number(form.criteria[item.id]) === opt.val">{{ opt.val }}</span>
                                <span v-else class="text-slate-300 text-xs font-normal">•</span>
                            </div>
                        </div>
                    </div>

                    <!-- Overall Average of Performance (Positioned at the bottom after rating all 10 criteria) -->
                    <div class="mt-4 flex flex-col justify-between gap-3 rounded-2xl border-2 border-[#0F2C59]/20 bg-[#0F2C59]/5 px-5 py-4 sm:flex-row sm:items-center">
                        <div>
                            <p class="text-[11px] font-extrabold uppercase tracking-wider text-[#0F2C59]">Overall Average of S.A. Performance</p>
                            <p class="mt-0.5 text-xs text-slate-600">
                                Computed across all 10 evaluation criteria ({{ scoreStats.answered }} of 10 criteria rated • Total Points: {{ scoreStats.total }} / 40)
                            </p>
                        </div>
                        <div class="flex items-center gap-3">
                            <div class="text-right">
                                <span class="text-2xl font-black text-[#0F2C59]">{{ scoreStats.avg }}</span>
                                <span class="text-xs font-bold text-slate-500"> / 4.00</span>
                            </div>
                            <span class="rounded-xl px-3 py-1.5 text-xs font-extrabold" :class="scoreStats.badgeClass">
                                {{ scoreStats.badgeText }}
                            </span>
                        </div>
                    </div>
                </div>

                <!-- ========================================================== -->
                <!-- SUPERVISOR / COORDINATOR: STEP 2 RECOMMENDED DECISION      -->
                <!-- ========================================================== -->
                <div v-if="mode !== 'SA'" class="pt-4 space-y-4">
                    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="rounded bg-[#0F2C59] px-2 py-0.5 text-[10px] font-bold uppercase text-[#D4AF37]">Step 2</span>
                            <span class="text-sm font-extrabold text-[#0F2C59]">Recommended Decision, Rationale &amp; Effective Date</span>
                            <span v-if="canSupervisorEdit && autoDetectedRecommendation" class="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-[11px] font-bold text-indigo-700 border border-indigo-200">
                                <app-icon name="Sparkles" :size="12" />
                                Auto-detected: {{ autoDetectedRecommendation.label }}
                            </span>
                        </div>
                        <span v-if="!canSupervisorEdit && form.supervisorRecommendation" class="rounded-full px-2.5 py-0.5 text-xs font-bold"
                              :class="decisionMeta(form.supervisorRecommendation)?.badgeCls">
                            Supervisor Recommendation: {{ decisionMeta(form.supervisorRecommendation)?.label }}
                        </span>
                    </div>

                    <!-- 4 Recommended Decision Options (Retain, Improvement Plan, Reassignment, Non-Renewal) -->
                    <div>
                        <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <label class="block text-xs font-extrabold uppercase tracking-wider text-slate-700">
                                Recommended Decision <span v-if="canSupervisorEdit" class="text-rose-500">*</span>
                            </label>
                            <span v-if="canSupervisorEdit && autoDetectedRecommendation" class="text-[11px] font-semibold text-slate-500">
                                System auto-selects based on evaluation score (avg: {{ scoreStats.avg }}). You can manually override if needed.
                            </span>
                        </div>
                        <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                            <label class="flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition"
                                   :class="form.supervisorRecommendation === 'RETAIN' ? 'border-emerald-600 bg-emerald-50/60 ring-2 ring-emerald-500/20' : 'border-slate-200 bg-white'">
                                <input type="radio" value="RETAIN" v-model="form.supervisorRecommendation" :disabled="!canSupervisorEdit" class="mt-0.5 h-4 w-4 text-emerald-600" />
                                <div>
                                    <span class="block text-xs font-extrabold text-emerald-800">Retain</span>
                                    <span class="text-[11px] text-slate-600">Recommend continuation in current assignment.</span>
                                </div>
                            </label>
                            <label class="flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition"
                                   :class="form.supervisorRecommendation === 'IMPROVEMENT_PLAN' ? 'border-amber-600 bg-amber-50/60 ring-2 ring-amber-500/20' : 'border-slate-200 bg-white'">
                                <input type="radio" value="IMPROVEMENT_PLAN" v-model="form.supervisorRecommendation" :disabled="!canSupervisorEdit" class="mt-0.5 h-4 w-4 text-amber-600" />
                                <div>
                                    <span class="block text-xs font-extrabold text-amber-800">Improvement Plan</span>
                                    <span class="text-[11px] text-slate-600">Performance development plan with monitoring.</span>
                                </div>
                            </label>
                            <label class="flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition"
                                   :class="form.supervisorRecommendation === 'REASSIGNMENT' ? 'border-blue-600 bg-blue-50/60 ring-2 ring-blue-500/20' : 'border-slate-200 bg-white'">
                                <input type="radio" value="REASSIGNMENT" v-model="form.supervisorRecommendation" :disabled="!canSupervisorEdit" class="mt-0.5 h-4 w-4 text-blue-600" />
                                <div>
                                    <span class="block text-xs font-extrabold text-blue-800">Reassignment</span>
                                    <span class="text-[11px] text-slate-600">Transfer/reassign to another department or lab.</span>
                                </div>
                            </label>
                            <label class="flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 transition"
                                   :class="form.supervisorRecommendation === 'NOT_RENEWED' ? 'border-rose-600 bg-rose-50/60 ring-2 ring-rose-500/20' : 'border-slate-200 bg-white'">
                                <input type="radio" value="NOT_RENEWED" v-model="form.supervisorRecommendation" :disabled="!canSupervisorEdit" class="mt-0.5 h-4 w-4 text-rose-600" />
                                <div>
                                    <span class="block text-xs font-extrabold text-rose-800">Non-Renewal</span>
                                    <span class="text-[11px] text-slate-600">Discontinue appointment for the next semester.</span>
                                </div>
                            </label>
                        </div>
                    </div>

                    <!-- Required Rationale / Feedback & Effective Date -->
                    <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
                        <div class="md:col-span-2 space-y-1">
                            <div class="flex items-center justify-between">
                                <label class="block text-xs font-extrabold uppercase tracking-wider text-slate-700">
                                    Rationale / Feedback <span v-if="canSupervisorEdit" class="text-rose-500">*</span>
                                </label>
                                <button v-if="canSupervisorEdit" type="button" @click="insertSampleRationale"
                                        class="text-[11px] font-semibold text-blue-700 hover:text-blue-800 hover:underline">
                                    Insert Suggested Rationale
                                </button>
                            </div>
                            <textarea v-model="form.supervisorReason" :disabled="!canSupervisorEdit" rows="3"
                                      placeholder="Provide detailed rationale and feedback justifying this recommendation..."
                                      class="w-full rounded-xl border border-slate-300 bg-white p-3 text-xs text-slate-800 focus:border-[#0F2C59] focus:outline-none disabled:bg-slate-50"></textarea>
                        </div>
                        <div class="space-y-1">
                            <label class="block text-xs font-extrabold uppercase tracking-wider text-slate-700">
                                Effective Date <span v-if="canSupervisorEdit" class="text-rose-500">*</span>
                            </label>
                            <input v-model="form.effectiveDate" :disabled="!canSupervisorEdit" type="date"
                                   class="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs text-slate-800 focus:border-[#0F2C59] focus:outline-none disabled:bg-slate-50" />
                            <p class="text-[11px] text-slate-500">Date this recommendation takes effect.</p>
                        </div>
                    </div>
                </div>

                <!-- ========================================================== -->
                <!-- S.A. VIEW: SUPERVISOR ASSESSMENT & RECOMMENDATION          -->
                <!-- ========================================================== -->
                <div v-else-if="form.supervisorRecommendation || form.supervisorReason || form.disclosedFeedback" class="pt-4 space-y-3">
                    <div class="rounded-2xl border border-blue-200 bg-blue-50/70 p-4 space-y-3">
                        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-blue-200/80 pb-2">
                            <div class="flex items-center gap-2">
                                <app-icon name="FileText" :size="16" class="text-[#0F2C59]" />
                                <h4 class="text-xs font-extrabold uppercase tracking-wider text-[#0F2C59]">
                                    Supervisor Assessment &amp; Recommended Decision
                                </h4>
                            </div>
                            <span v-if="form.supervisorRecommendation" class="rounded-full px-2.5 py-0.5 text-xs font-bold"
                                  :class="decisionMeta(form.supervisorRecommendation)?.badgeCls">
                                {{ decisionMeta(form.supervisorRecommendation)?.label }}
                            </span>
                        </div>
                        <div v-if="form.supervisorReason || form.disclosedFeedback" class="space-y-1">
                            <span class="text-[11px] font-bold uppercase tracking-wider text-slate-600">Rationale / Feedback:</span>
                            <p class="text-xs text-slate-800 whitespace-pre-line leading-relaxed">{{ form.disclosedFeedback || form.supervisorReason }}</p>
                        </div>
                        <div v-if="form.effectiveDate" class="flex items-center gap-2 text-xs text-slate-700">
                            <span class="font-bold">Effective Date:</span>
                            <span>{{ Format.date(form.effectiveDate) }}</span>
                        </div>
                    </div>
                </div>

                <!-- Step 3 Student Assistant Response Summary (Visible once acknowledged or with comments) -->
                <div id="sa-step2-response-summary" v-if="(mode !== 'SA' || form.saAcknowledgedAt) && (form.saAcknowledgedAt || form.saComments || form.saConcernText)" class="pt-4">
                    <div class="rounded-xl border border-slate-200 bg-slate-50 p-4">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <h4 class="text-xs font-extrabold uppercase tracking-wider text-[#0F2C59]">
                                Student Assistant Review &amp; Acknowledgment Record
                            </h4>
                            <span class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold"
                                  :class="ackStatusMeta(form.acknowledgmentStatus, form.status).cls">
                                <app-icon :name="ackStatusMeta(form.acknowledgmentStatus, form.status).icon" :size="12" />
                                {{ ackStatusMeta(form.acknowledgmentStatus, form.status).label }}
                            </span>
                        </div>
                        <div class="mt-2 grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
                            <div>
                                <p class="font-bold text-slate-700">Student Assistant Comments / Response:</p>
                                <p class="mt-0.5 text-slate-600">{{ form.saComments || 'No optional comments submitted.' }}</p>
                            </div>
                            <div>
                                <p class="font-bold text-slate-700">Acknowledgment Timestamp &amp; Deadline:</p>
                                <p class="mt-0.5 text-slate-600">
                                    <template v-if="form.saAcknowledgedAt">Acknowledged on {{ Format.dateTime(form.saAcknowledgedAt) }}</template>
                                    <template v-else-if="form.ackDueDate">Deadline: {{ Format.date(form.ackDueDate) }}</template>
                                    <template v-else>Active Window</template>
                                </p>
                            </div>
                        </div>
                        <div v-if="form.saConcernText" class="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-950">
                            <strong>Recorded S.A. Concern / Exception Note:</strong> {{ form.saConcernText }}
                        </div>
                    </div>
                </div>

                <!-- Electronic Signatures Grid (Step 1 Supervisor & Step 3 Student Assistant) -->
                <div class="grid grid-cols-1 gap-5 pt-4 md:grid-cols-2">
                    <!-- 1. Supervisor Signature Card -->
                    <div class="rounded-xl border border-slate-200 bg-white p-3.5 flex flex-col justify-between space-y-3 shadow-xs"
                         :class="canSupervisorEdit ? 'border-2 border-[#0F2C59]' : ''">
                        <div class="flex items-center justify-between">
                            <span class="font-bold text-slate-800 uppercase tracking-wider text-[11px]">1. Immediate Supervisor</span>
                            <div v-if="canSupervisorEdit" class="flex items-center gap-1.5">
                                <button type="button" @click="adoptSupervisorSignature"
                                        class="text-[10px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded px-1.5 py-0.5 transition-colors">
                                    Adopt E-Sig
                                </button>
                                <button type="button" @click="clearSignature('supervisor')"
                                        class="text-[10px] font-bold text-rose-600 hover:text-rose-800 hover:underline">
                                    Clear
                                </button>
                            </div>
                            <span v-else-if="form.supervisorSignature" class="text-[10px] font-semibold text-emerald-700">Step 1 Signed</span>
                            <span v-else class="text-[10px] font-semibold text-slate-400">Pending Review</span>
                        </div>

                        <!-- Drawing Canvas -->
                        <div class="relative overflow-hidden rounded-lg border border-slate-300 bg-white shadow-inner">
                            <canvas ref="supervisorCanvasRef" width="380" height="100" class="h-24 w-full bg-white block"
                                    :class="canSupervisorEdit ? 'cursor-crosshair' : 'cursor-default'" style="touch-action: none; background-color: #ffffff;"></canvas>
                            <div v-if="!form.supervisorSignature" class="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] text-slate-400 font-medium">
                                <template v-if="canSupervisorEdit">Draw signature with mouse or touch</template>
                                <template v-else>No signature recorded</template>
                            </div>
                        </div>

                        <!-- Sub-Fields: Name & Date -->
                        <div class="space-y-1.5 pt-1 border-t border-slate-100">
                            <div>
                                <label class="block text-[10px] font-bold uppercase text-slate-500">Supervisor Name</label>
                                <input type="text" :value="form.supervisorName || 'Immediate Supervisor'" disabled
                                       class="w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700 cursor-not-allowed" />
                            </div>
                            <div class="flex items-center justify-between text-[11px]">
                                <span class="text-slate-500">Date Signed:</span>
                                <span class="font-semibold text-slate-700">{{ (form.supervisorSignature && form.supervisorSignDate) ? Format.date(form.supervisorSignDate) : 'Pending' }}</span>
                            </div>
                        </div>
                    </div>

                    <!-- 2. Student Assistant Signature Card -->
                    <div id="sa-signature-card" class="rounded-xl border border-slate-200 bg-white p-3.5 flex flex-col justify-between space-y-3 shadow-xs"
                         :class="canSaAcknowledge ? 'border-2 border-[#0F2C59]' : ''">
                        <div class="flex items-center justify-between">
                            <span class="font-bold text-slate-800 uppercase tracking-wider text-[11px]">2. Student Assistant</span>
                            <div v-if="canSaAcknowledge" class="flex items-center gap-1.5">
                                <button type="button" @click="adoptStudentSignature"
                                        class="text-[10px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded px-1.5 py-0.5 transition-colors">
                                    Adopt E-Sig
                                </button>
                                <button type="button" @click="clearSignature('student')"
                                        class="text-[10px] font-bold text-rose-600 hover:text-rose-800 hover:underline">
                                    Clear
                                </button>
                            </div>
                            <span v-else-if="form.studentSignature || form.saAcknowledgedAt" class="text-[10px] font-semibold text-emerald-700">Step 3 Acknowledged</span>
                            <span v-else class="text-[10px] font-semibold text-slate-400">Pending Review</span>
                        </div>

                        <!-- Drawing Canvas -->
                        <div class="relative overflow-hidden rounded-lg border border-slate-300 bg-white shadow-inner">
                            <canvas ref="studentCanvasRef" width="380" height="100" class="h-24 w-full bg-white block"
                                    :class="canSaAcknowledge ? 'cursor-crosshair' : 'cursor-default'" style="touch-action: none; background-color: #ffffff;"></canvas>
                            <div v-if="!form.studentSignature" class="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] text-slate-400 font-medium">
                                <template v-if="canSaAcknowledge">Draw signature with mouse or touch</template>
                                <template v-else-if="form.status === 'FINALIZED' || form.saAcknowledgedAt">No signature recorded</template>
                                <template v-else>Reserved for Student Assistant Acknowledgment</template>
                            </div>
                        </div>

                        <!-- Sub-Fields: Name & Date -->
                        <div class="space-y-1.5 pt-1 border-t border-slate-100">
                            <div>
                                <label class="block text-[10px] font-bold uppercase text-slate-500">Student Assistant Name</label>
                                <input type="text" :value="form.studentName || 'Student Assistant'" disabled
                                       class="w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-700 cursor-not-allowed" />
                            </div>
                            <div class="flex items-center justify-between text-[11px]">
                                <span class="text-slate-500">Date Signed:</span>
                                <span class="font-semibold text-slate-700">{{ (form.studentSignature && form.studentSignDate) ? Format.date(form.studentSignDate) : (form.saAcknowledgedAt ? Format.date(form.saAcknowledgedAt) : 'Pending') }}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- ==================================================================== -->
        <!-- LAYER C: AUTHORIZED ACTION PANEL                                     -->
        <!-- Dynamically reflects the current step of the 5-step workflow         -->
        <!-- Only displayed for S.A. when Step 3 Acknowledgment is required       -->
        <!-- ==================================================================== -->
        <div v-if="mode !== 'SA' || canSaAcknowledge" id="role-action-panel" class="no-print card border border-line bg-white p-5 sm:p-6 shadow-sm">
            <div class="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
                <div class="flex items-center gap-3">
                    <div class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-navy text-gold shadow-xs">
                        <app-icon name="ShieldCheck" :size="20" />
                    </div>
                    <div>
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="inline-flex items-center rounded-md bg-navy/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-navy">
                                {{ currentStepMeta.shortStep || 'Action Panel' }}
                            </span>
                            <h3 class="text-card-title text-navy">
                                {{ actionPanelHeading }}
                            </h3>
                        </div>
                        <p class="text-caption text-muted mt-0.5">
                            Authorize final appointment decision, record official feedback, and finalize evaluation.
                        </p>
                    </div>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <span v-if="form.status === 'FOR_COORDINATOR_REVIEW'"
                          class="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200/80 px-3 py-1 text-[11px] font-bold text-amber-800 shadow-xs">
                        <span class="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse"></span>
                        Awaiting Coordinator Decision
                    </span>
                    <span class="inline-flex items-center rounded-lg bg-page px-2.5 py-1 text-[11px] font-semibold text-muted border border-line">
                        Role: {{ mode === 'COORDINATOR' ? 'S.A. Coordinator' : (mode === 'SUPERVISOR' ? 'Immediate Supervisor' : 'Student Assistant') }}
                    </span>
                </div>
            </div>

            <!-- 1. SUPERVISOR ACTION PANEL -->
            <div v-if="mode === 'SUPERVISOR'">
                <div v-if="canSupervisorEdit" class="space-y-4">
                    <p class="text-xs text-slate-600">
                        You may save a draft while working on your ratings and recommended decision, or sign and send your recommendation to {{ form.studentName || 'the Student Assistant' }} for acknowledgement.
                    </p>
                    <div class="flex flex-wrap items-center justify-end gap-2.5">
                        <button type="button" @click="saveSupervisorDraft" :disabled="savingDraft || saving"
                                class="btn btn-outline border-navy text-navy">
                            <app-icon name="Save" :size="15" />
                            {{ savingDraft ? 'Saving Draft...' : 'Save Draft' }}
                        </button>
                        <button type="button" @click="submitSupervisorEvaluation" :disabled="saving || savingDraft"
                                class="btn btn-primary">
                            <app-icon name="Send" :size="15" />
                            {{ saving ? ('Sending to ' + (form.studentName || 'Student Assistant') + '...') : (form.status === 'RETURNED_FOR_REVISION' ? ('Revise & Send to ' + (form.studentName || 'Student Assistant') + ' for Acknowledgement') : ('Sign & Send to ' + (form.studentName || 'Student Assistant') + ' for Acknowledgement')) }}
                        </button>
                    </div>
                </div>
                <div v-else class="space-y-3 rounded-xl border border-blue-200 bg-blue-50/50 p-4">
                    <div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                        <div class="text-xs text-slate-700 space-y-1">
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800 border border-emerald-300">
                                    <app-icon name="CheckCircle2" :size="12" /> Recommendation Submitted &amp; Signed
                                </span>
                                <span class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold" :class="currentStatusBadge.cls">
                                    <app-icon :name="currentStatusBadge.icon" :size="12" /> {{ currentStepMeta.stepTitle }}
                                </span>
                            </div>
                            <p class="font-bold text-slate-900">
                                {{ nextActionSummary.title }}
                            </p>
                            <p class="text-slate-600">
                                {{ nextActionSummary.description }}
                            </p>
                        </div>
                        <button v-if="form.status !== 'FINALIZED' && form.status !== 'REJECTED'" type="button" @click="showSupRevisionReqModal = true" class="btn btn-sm btn-outline shrink-0">
                            <app-icon name="RotateCcw" :size="14" /> Request Revision Authorization
                        </button>
                    </div>
                </div>
            </div>

            <!-- 2. STUDENT ASSISTANT ACTION PANEL -->
            <div v-else-if="mode === 'SA'">
                <div v-if="canSaAcknowledge" class="space-y-4">
                    <div class="rounded-xl border border-blue-200 bg-blue-50/70 p-4 text-xs text-blue-950 space-y-1.5">
                        <p class="text-sm font-bold text-[#0F2C59]">
                            Your Immediate Supervisor has submitted your performance evaluation. Please review the 10 criteria ratings, supervisor assessment, and recommendation above.
                        </p>
                        <p class="text-[11px] text-blue-900">
                            <strong>Note:</strong> Your electronic signature confirms receipt and review of this evaluation. Upon submission, it will be forwarded to the S.A. Coordinator for final review and approval.
                        </p>
                    </div>

                    <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <div>
                            <label for="sa-step2-comments-input" class="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-700">
                                Optional Response / Comments
                            </label>
                            <textarea id="sa-step2-comments-input" v-model="form.saComments" rows="3"
                                      placeholder="Optionally enter your response, reflection, or comments regarding your performance evaluation..."
                                      class="w-full rounded-xl border border-slate-300 bg-white p-3 text-xs focus:border-[#0F2C59] focus:outline-none"></textarea>
                        </div>
                        <div class="space-y-2">
                            <label class="flex items-center gap-2 text-xs font-bold text-amber-900">
                                <input type="checkbox" v-model="form.saHasDispute" class="h-4 w-4 rounded border-amber-400 text-amber-600" />
                                Flag a concern or disagreement for S.A. Coordinator review
                            </label>
                            <textarea v-if="form.saHasDispute" v-model="form.saConcernText" rows="3"
                                      placeholder="Describe the specific rating or remark you wish to note..."
                                      class="w-full rounded-xl border border-amber-300 bg-amber-50/40 p-3 text-xs focus:border-amber-600 focus:outline-none"></textarea>
                        </div>
                    </div>

                    <div class="flex flex-wrap items-center justify-between gap-2.5 border-t border-line pt-3">
                        <button type="button" @click="scrollToEvaluationSection" class="btn btn-outline">
                            <app-icon name="Eye" :size="15" />
                            View Evaluation
                        </button>
                        <button type="button" @click="submitSaAcknowledgment" :disabled="saving"
                                class="btn btn-primary">
                            <app-icon name="CheckCircle2" :size="15" />
                            {{ saving ? 'Acknowledging...' : 'Sign & Acknowledge Evaluation' }}
                        </button>
                    </div>
                </div>
            </div>

            <!-- 3. S.A. COORDINATOR ACTION PANEL -->
            <div v-else class="space-y-5">
                <!-- Pending Extension Alert -->
                <div v-if="form.extensionStatus === 'PENDING' || form.acknowledgmentStatus === 'EXTENSION_REQUESTED'"
                     class="rounded-xl border-2 border-amber-400 bg-amber-50 p-4 text-amber-950">
                    <div class="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <p class="text-sm font-extrabold">Pending S.A. Deadline Extension Request</p>
                            <p class="mt-0.5 text-xs">
                                <strong>Reason:</strong> {{ form.extensionReasonCategory }} • <strong>Requested:</strong> +{{ form.extensionRequestedDays || 3 }} school days
                                <template v-if="form.extensionExplanation"> • "{{ form.extensionExplanation }}"</template>
                            </p>
                        </div>
                        <div class="flex items-center gap-2">
                            <button type="button" @click="coordExtForm.decision = 'APPROVED'; showCoordExtensionModal = true" class="btn btn-sm btn-primary">
                                Approve / Update Deadline
                            </button>
                            <button type="button" @click="coordExtForm.decision = 'REJECTED'; showCoordExtensionModal = true" class="btn btn-sm btn-outline border-rose-300 bg-white text-rose-700">
                                Reject
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Supervisor Revision Request Alert -->
                <div v-if="form.supervisorRevisionRequest"
                     class="rounded-xl border-2 border-orange-400 bg-orange-50 p-4 text-orange-950">
                    <div class="flex flex-wrap items-center justify-between gap-3">
                        <div>
                            <p class="text-sm font-extrabold">Supervisor Requested Return for Revision</p>
                            <p class="mt-0.5 text-xs">
                                <strong>{{ form.supervisorName }}:</strong> {{ form.supervisorRevisionRequest }}
                            </p>
                        </div>
                        <button type="button" @click="returnRevisionReason = form.supervisorRevisionRequest; showReturnRevisionModal = true"
                                class="btn btn-sm btn-primary">
                            <app-icon name="RotateCcw" :size="14" /> Authorize Return to Supervisor
                        </button>
                    </div>
                </div>

                <!-- COORDINATOR REVIEW & DECISION PANEL (when FOR_COORDINATOR_REVIEW) -->
                <div v-if="form.status === 'FOR_COORDINATOR_REVIEW'" class="space-y-5 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                    <!-- Section Header -->
                    <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3.5">
                        <div class="flex items-center gap-2.5">
                            <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-[#0F2C59]/10 text-[#0F2C59]">
                                <app-icon name="FileCheck2" :size="18" />
                            </div>
                            <div>
                                <h4 class="text-sm font-bold text-[#0F2C59]">Review Supervisor Recommendation &amp; Authorize Decision</h4>
                                <p class="text-[11px] text-slate-500">Confirm the final administrative action or request revision before locking the evaluation.</p>
                            </div>
                        </div>
                        <span class="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800 border border-amber-200">
                            <span class="h-2 w-2 rounded-full bg-amber-500 animate-pulse"></span>
                            Awaiting Coordinator Decision
                        </span>
                    </div>

                    <!-- Supervisor Recommendation Summary Card -->
                    <div class="rounded-xl border border-slate-200/90 bg-slate-50/70 p-4 space-y-3">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <div class="flex items-center gap-2">
                                <span class="text-xs font-bold uppercase tracking-wider text-slate-600">Supervisor Recommended Decision:</span>
                                <span class="rounded-full px-2.5 py-0.5 text-xs font-black" :class="decisionMeta(form.supervisorRecommendation || 'RETAIN')?.badgeCls">
                                    {{ decisionMeta(form.supervisorRecommendation || 'RETAIN')?.label }}
                                </span>
                            </div>
                            <div class="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                                <span class="inline-flex items-center gap-1">
                                    <app-icon name="UserCheck" :size="13" class="text-slate-400" />
                                    <strong class="font-semibold text-slate-700">Supervisor:</strong> {{ form.supervisorName || 'Immediate Supervisor' }}
                                </span>
                                <span class="text-slate-300">•</span>
                                <span class="inline-flex items-center gap-1">
                                    <app-icon name="Award" :size="13" class="text-[#D4AF37]" />
                                    <strong class="font-semibold text-slate-700">Score:</strong> {{ scoreStats.avg }} / 4.00 ({{ scoreStats.badgeText }})
                                </span>
                                <span class="text-slate-300">•</span>
                                <span class="inline-flex items-center gap-1">
                                    <app-icon name="Calendar" :size="13" class="text-slate-400" />
                                    <strong class="font-semibold text-slate-700">Target Date:</strong> {{ Format.date(form.effectiveDate) }}
                                </span>
                            </div>
                        </div>
                        <div class="rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">
                            <span class="font-bold text-slate-800">Rationale / Supervisor Feedback:</span>
                            <p class="mt-1 italic text-slate-600 leading-relaxed">
                                "{{ form.supervisorReason || 'No specific rationale provided by the immediate supervisor.' }}"
                            </p>
                        </div>
                    </div>

                    <!-- Decision Approval & Release Options -->
                    <div class="space-y-4 pt-1">
                        <div>
                            <div class="flex items-center justify-between mb-2">
                                <label class="block text-xs font-bold uppercase tracking-wider text-slate-700">
                                    Authorize Final Decision <span class="text-rose-500">*</span>
                                </label>
                                <span class="text-[11px] text-slate-500">Defaults to supervisor's recommendation</span>
                            </div>
                            <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                                <!-- Retain Option -->
                                <label class="relative flex cursor-pointer flex-col justify-between rounded-xl border p-3 transition hover:shadow-sm"
                                       :class="(form.coordinatorDecision || form.supervisorRecommendation) === 'RETAIN' ? 'border-emerald-500 bg-emerald-50/60 ring-2 ring-emerald-500/20' : 'border-slate-200 bg-white hover:border-slate-300'">
                                    <div class="flex items-start justify-between gap-2">
                                        <div class="flex items-center gap-2">
                                            <input type="radio" value="RETAIN" v-model="form.coordinatorDecision" class="h-4 w-4 text-emerald-600 focus:ring-emerald-500" />
                                            <span class="text-xs font-bold text-emerald-900">Retain</span>
                                        </div>
                                        <span v-if="form.supervisorRecommendation === 'RETAIN'" class="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold text-emerald-800">Rec.</span>
                                    </div>
                                    <span class="mt-2 text-[11px] text-slate-500 leading-tight">Continue current semester assignment</span>
                                </label>

                                <!-- Improvement Plan Option -->
                                <label class="relative flex cursor-pointer flex-col justify-between rounded-xl border p-3 transition hover:shadow-sm"
                                       :class="(form.coordinatorDecision || form.supervisorRecommendation) === 'IMPROVEMENT_PLAN' ? 'border-amber-500 bg-amber-50/60 ring-2 ring-amber-500/20' : 'border-slate-200 bg-white hover:border-slate-300'">
                                    <div class="flex items-start justify-between gap-2">
                                        <div class="flex items-center gap-2">
                                            <input type="radio" value="IMPROVEMENT_PLAN" v-model="form.coordinatorDecision" class="h-4 w-4 text-amber-600 focus:ring-amber-500" />
                                            <span class="text-xs font-bold text-amber-900">Improvement Plan</span>
                                        </div>
                                        <span v-if="form.supervisorRecommendation === 'IMPROVEMENT_PLAN'" class="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold text-amber-800">Rec.</span>
                                    </div>
                                    <span class="mt-2 text-[11px] text-slate-500 leading-tight">Place under monitored development period</span>
                                </label>

                                <!-- Reassignment Option -->
                                <label class="relative flex cursor-pointer flex-col justify-between rounded-xl border p-3 transition hover:shadow-sm"
                                       :class="(form.coordinatorDecision || form.supervisorRecommendation) === 'REASSIGNMENT' ? 'border-blue-500 bg-blue-50/60 ring-2 ring-blue-500/20' : 'border-slate-200 bg-white hover:border-slate-300'">
                                    <div class="flex items-start justify-between gap-2">
                                        <div class="flex items-center gap-2">
                                            <input type="radio" value="REASSIGNMENT" v-model="form.coordinatorDecision" class="h-4 w-4 text-blue-600 focus:ring-blue-500" />
                                            <span class="text-xs font-bold text-blue-900">Reassignment</span>
                                        </div>
                                        <span v-if="form.supervisorRecommendation === 'REASSIGNMENT'" class="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold text-blue-800">Rec.</span>
                                    </div>
                                    <span class="mt-2 text-[11px] text-slate-500 leading-tight">Transfer to alternate office or department</span>
                                </label>

                                <!-- Non-Renewal Option -->
                                <label class="relative flex cursor-pointer flex-col justify-between rounded-xl border p-3 transition hover:shadow-sm"
                                       :class="(form.coordinatorDecision || form.supervisorRecommendation) === 'NOT_RENEWED' ? 'border-rose-500 bg-rose-50/60 ring-2 ring-rose-500/20' : 'border-slate-200 bg-white hover:border-slate-300'">
                                    <div class="flex items-start justify-between gap-2">
                                        <div class="flex items-center gap-2">
                                            <input type="radio" value="NOT_RENEWED" v-model="form.coordinatorDecision" class="h-4 w-4 text-rose-600 focus:ring-rose-500" />
                                            <span class="text-xs font-bold text-rose-900">Non-Renewal</span>
                                        </div>
                                        <span v-if="form.supervisorRecommendation === 'NOT_RENEWED'" class="rounded bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold text-rose-800">Rec.</span>
                                    </div>
                                    <span class="mt-2 text-[11px] text-slate-500 leading-tight">Discontinue S.A. appointment status</span>
                                </label>
                            </div>
                        </div>

                        <!-- Date & Remarks Grid -->
                        <div class="grid grid-cols-1 gap-4 md:grid-cols-3">
                            <div class="space-y-2 md:col-span-1">
                                <div>
                                    <label class="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-700">
                                        Effective Date <span class="text-rose-500">*</span>
                                    </label>
                                    <input v-model="form.effectiveDate" type="date"
                                           class="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 shadow-sm focus:border-[#0F2C59] focus:outline-none focus:ring-1 focus:ring-[#0F2C59]" />
                                </div>
                                <div class="rounded-lg border border-slate-200/80 bg-slate-50 p-2.5 text-[11px] text-slate-500">
                                    <span class="font-semibold text-slate-700">Policy:</span> Date decision takes official effect in system records.
                                </div>
                            </div>
                            <div class="md:col-span-2">
                                <label class="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-700">
                                    Disclosed Feedback to S.A. &amp; Coordinator Remarks
                                </label>
                                <textarea v-model="form.disclosedFeedback" rows="3"
                                          :placeholder="form.supervisorReason || 'Disclosed performance remarks shown to the Student Assistant...'"
                                          class="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-xs text-slate-800 shadow-sm focus:border-[#0F2C59] focus:outline-none focus:ring-1 focus:ring-[#0F2C59]"></textarea>
                                <p class="mt-1 text-[11px] text-slate-500">Official remarks and feedback authorized for this evaluation record and visible to the S.A.</p>
                            </div>
                        </div>
                    </div>

                    <!-- 3 Authority Actions -->
                    <div class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
                        <div class="flex flex-wrap items-center gap-2.5">
                            <button type="button" @click="showReturnRevisionModal = true" :disabled="saving"
                                    class="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50/80 px-3.5 py-2 text-xs font-bold text-amber-900 transition hover:bg-amber-100 hover:border-amber-400 active:scale-[0.99] disabled:opacity-50">
                                <app-icon name="RotateCcw" :size="14" /> Return for Revision
                            </button>
                            <button type="button" @click="showRejectModal = true" :disabled="saving"
                                    class="inline-flex items-center gap-1.5 rounded-lg border border-rose-300 bg-rose-50/80 px-3.5 py-2 text-xs font-bold text-rose-900 transition hover:bg-rose-100 hover:border-rose-400 active:scale-[0.99] disabled:opacity-50">
                                <app-icon name="XCircle" :size="14" /> Reject Recommendation
                            </button>
                        </div>
                        <button type="button" @click="submitApproveRecommendation" :disabled="saving"
                                class="inline-flex items-center gap-2 rounded-lg bg-[#0F2C59] px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-[#1a3d73] active:scale-[0.99] disabled:opacity-50">
                            <app-icon name="BadgeCheck" :size="16" class="text-[#D4AF37]" />
                            {{ saving ? 'Approving & Finalizing...' : 'Approve Final Decision & Finalize Record' }}
                        </button>
                    </div>
                </div>

                <!-- COORDINATOR STATUS SUMMARY (when NOT in FOR_COORDINATOR_REVIEW) -->
                <div v-else class="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-4 text-xs text-slate-700">
                    <div>
                        <p class="font-bold text-slate-900">
                            <template v-if="form.status === 'FINALIZED'">Step 5: Evaluation Finalized &amp; Locked</template>
                            <template v-else-if="form.status === 'FOR_SA_REVIEW'">Step 3: Awaiting {{ form.studentName }}'s Review &amp; Acknowledgment</template>
                            <template v-else-if="form.status === 'FOR_COORDINATOR_REVIEW'">Step 4: Awaiting Coordinator Review &amp; Decision</template>
                            <template v-else-if="form.status === 'REJECTED'">Recommendation Rejected by Coordinator</template>
                            <template v-else-if="form.status === 'RETURNED_FOR_REVISION'">Returned to Immediate Supervisor for Revision</template>
                            <template v-else>Step 1: Awaiting Immediate Supervisor Evaluation</template>
                        </p>
                        <p class="mt-0.5">
                            <template v-if="form.status === 'FINALIZED'">
                                This evaluation record has been completed, approved, and preserved. To modify the final decision, use the audited Reopen action.
                            </template>
                            <template v-else-if="form.status === 'FOR_SA_REVIEW'">
                                The supervisor has submitted the evaluation. The Student Assistant has 5 school days (deadline: {{ Format.date(form.ackDueDate) }}) to review criteria 1–10, supervisor assessment, and draw their acknowledgment signature.
                            </template>
                            <template v-else-if="form.status === 'FOR_COORDINATOR_REVIEW'">
                                The Student Assistant has acknowledged the evaluation. The Coordinator has authority to approve final decision, return for revision, or reject.
                            </template>
                            <template v-else-if="form.status === 'REJECTED'">
                                This evaluation recommendation was rejected on {{ Format.dateTime(form.rejectedAt) }}.
                            </template>
                            <template v-else-if="form.status === 'RETURNED_FOR_REVISION'">
                                The evaluation was returned to {{ form.supervisorName }} on {{ Format.dateTime(form.returnedAt) }}. Waiting for revision.
                            </template>
                            <template v-else>
                                Waiting for {{ form.supervisorName }} to complete and submit their recommendation.
                            </template>
                        </p>
                    </div>
                    <div class="flex items-center gap-2">
                        <button v-if="form.status === 'FOR_SA_REVIEW' || form.status === 'FOR_COORDINATOR_REVIEW'" type="button" @click="showReturnRevisionModal = true" class="btn btn-sm btn-outline border-orange-400 bg-orange-50 text-orange-950">
                            <app-icon name="RotateCcw" :size="14" /> Return to Supervisor
                        </button>
                        <button v-if="form.status === 'FINALIZED'" type="button" @click="showReopenModal = true" class="btn btn-sm btn-outline">
                            <app-icon name="Unlock" :size="14" /> Reopen Finalized Evaluation
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- ==================================================================== -->
        <!-- MODALS FOR WORKFLOW SUB-ACTIONS                                      -->
        <!-- ==================================================================== -->
        <!-- MODAL 1: S.A. REQUEST DEADLINE EXTENSION -->
        <app-modal :open="showExtensionModal" title="Request Acknowledgment Deadline Extension" @close="showExtensionModal = false">
            <div class="space-y-4">
                <div class="rounded-lg border border-navy/20 bg-mist/60 p-3 text-caption text-ink">
                    <p class="font-bold text-navy">Current Acknowledgment Deadline: {{ form.ackDueDate ? Format.date(form.ackDueDate) : '5 School Days' }}</p>
                    <p class="mt-0.5">Select the reason category for your extension request. The S.A. Coordinator will review your request and notify you.</p>
                </div>
                <form-field label="Reason Category" required>
                    <select v-model="extForm.reasonCategory" class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none">
                        <option v-for="cat in EXTENSION_REASON_CATEGORIES" :key="cat" :value="cat">{{ cat }}</option>
                    </select>
                </form-field>
                <form-field label="Requested Additional School Days">
                    <select v-model.number="extForm.requestedDays" class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none">
                        <option :value="2">2 additional school days</option>
                        <option :value="3">3 additional school days (Recommended)</option>
                        <option :value="5">5 additional school days</option>
                    </select>
                </form-field>
                <form-field :label="form.isAckOverdue ? 'Brief Explanation (Required)' : 'Brief Explanation (Optional)'" :required="form.isAckOverdue">
                    <textarea v-model="extForm.explanation" rows="3"
                              placeholder="Optional brief context..."
                              class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none"></textarea>
                </form-field>
            </div>
            <template #footer>
                <div class="flex items-center justify-end gap-2">
                    <button type="button" @click="showExtensionModal = false" class="btn btn-outline" :disabled="saving">Cancel</button>
                    <button type="button" @click="submitSaExtensionRequest" class="btn btn-primary" :disabled="saving">
                        <app-icon name="Send" :size="15" /> {{ saving ? 'Submitting...' : 'Submit Extension Request' }}
                    </button>
                </div>
            </template>
        </app-modal>

        <!-- MODAL 2: S.A. SUBMIT CONCERN / EXCEPTION STATUS -->
        <app-modal :open="showConcernModal" title="Submit Evaluation Concern or Exception Status" @close="showConcernModal = false">
            <div class="space-y-4">
                <div class="rounded-lg border border-amber-300 bg-amber-50 p-3 text-caption text-amber-950">
                    <p class="font-bold">Route Concern or Exception to S.A. Coordinator</p>
                    <p class="mt-0.5">This routes your response to the S.A. Coordinator for Step 4 review while preserving the Supervisor's original ratings.</p>
                </div>
                <form-field label="Status / Action Type" required>
                    <select v-model="concernForm.exceptionType" class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none">
                        <option value="CONCERN_SUBMITTED">Concern / Dispute Submitted</option>
                        <option value="ACKNOWLEDGMENT_DECLINED">Acknowledgment Declined</option>
                        <option value="UNABLE_TO_ACKNOWLEDGE">Unable to Acknowledge</option>
                    </select>
                </form-field>
                <form-field label="Reason / Statement for S.A. Coordinator Review" required>
                    <textarea v-model="concernForm.reasonText" rows="4"
                              placeholder="Clearly state your concern or reason..."
                              class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none"></textarea>
                </form-field>
            </div>
            <template #footer>
                <div class="flex items-center justify-end gap-2">
                    <button type="button" @click="showConcernModal = false" class="btn btn-outline" :disabled="saving">Cancel</button>
                    <button type="button" @click="submitSaConcernException" class="btn btn-primary" :disabled="saving">
                        <app-icon name="Send" :size="15" /> {{ saving ? 'Submitting...' : 'Submit to S.A. Coordinator' }}
                    </button>
                </div>
            </template>
        </app-modal>

        <!-- MODAL 3: COORDINATOR APPROVE / REJECT EXTENSION REQUEST -->
        <app-modal :open="showCoordExtensionModal" title="Review S.A. Acknowledgment Extension Request" @close="showCoordExtensionModal = false">
            <div class="space-y-4">
                <div class="rounded-lg border border-navy/20 bg-mist/60 p-3 text-caption text-ink">
                    <p><strong>Student Assistant:</strong> {{ form.studentName }} ({{ form.department }})</p>
                    <p><strong>Reason Category:</strong> {{ form.extensionReasonCategory || 'Not specified' }}</p>
                    <p v-if="form.extensionExplanation"><strong>Explanation:</strong> {{ form.extensionExplanation }}</p>
                    <p><strong>Current Deadline:</strong> {{ Format.date(form.ackDueDate) }}</p>
                </div>
                <form-field label="Coordinator Decision" required>
                    <select v-model="coordExtForm.decision" class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none">
                        <option value="APPROVED">Approve Extension (Update Deadline &amp; Notify S.A.)</option>
                        <option value="REJECTED">Reject Extension (Retain Current Deadline &amp; Notify S.A.)</option>
                    </select>
                </form-field>
                <div v-if="coordExtForm.decision === 'APPROVED'" class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <form-field label="Additional School Days">
                        <input v-model.number="coordExtForm.extensionDays" type="number" min="1" max="15"
                                class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none" />
                    </form-field>
                    <form-field label="Or Specific Custom Due Date">
                        <input v-model="coordExtForm.newDueDate" type="date"
                                class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none" />
                    </form-field>
                </div>
                <form-field label="Decision Reason / Notes" required>
                    <textarea v-model="coordExtForm.decisionReason" rows="3"
                              placeholder="Enter reason for approving or rejecting this extension..."
                              class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none"></textarea>
                </form-field>
            </div>
            <template #footer>
                <div class="flex items-center justify-end gap-2">
                    <button type="button" @click="showCoordExtensionModal = false" class="btn btn-outline" :disabled="saving">Cancel</button>
                    <button type="button" @click="submitCoordExtensionDecision" class="btn btn-primary" :disabled="saving">
                        <app-icon name="Check" :size="15" /> {{ saving ? 'Saving...' : 'Save Extension Decision' }}
                    </button>
                </div>
            </template>
        </app-modal>

        <!-- MODAL 4: COORDINATOR RETURN TO SUPERVISOR FOR REVISION -->
        <app-modal :open="showReturnRevisionModal" title="Return Evaluation to Supervisor for Clarification / Revision" @close="showReturnRevisionModal = false">
            <div class="space-y-4">
                <div class="rounded-lg border border-orange-300 bg-orange-50 p-3 text-caption text-orange-950">
                    <p class="font-bold">Audited Return-for-Revision Workflow (Step 4 → Step 1)</p>
                    <p class="mt-0.5">This unlocks Step 1 for <strong>{{ form.supervisorName }}</strong> while preserving all previous history and recording your return reason.</p>
                </div>
                <form-field label="Reason / Instructions for Supervisor Revision" required>
                    <textarea v-model="returnRevisionReason" rows="4"
                              placeholder="Explain what needs to be clarified or corrected in the ratings or qualitative assessment..."
                              class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none"></textarea>
                </form-field>
            </div>
            <template #footer>
                <div class="flex items-center justify-end gap-2">
                    <button type="button" @click="showReturnRevisionModal = false" class="btn btn-outline" :disabled="saving">Cancel</button>
                    <button type="button" @click="submitReturnForRevision" class="btn btn-primary" :disabled="saving">
                        <app-icon name="RotateCcw" :size="15" /> {{ saving ? 'Returning...' : 'Return to Supervisor' }}
                    </button>
                </div>
            </template>
        </app-modal>

        <!-- MODAL 4B: COORDINATOR REJECT RECOMMENDATION -->
        <app-modal :open="showRejectModal" title="Reject Evaluation Recommendation" @close="showRejectModal = false">
            <div class="space-y-4">
                <div class="rounded-lg border border-rose-300 bg-rose-50 p-3 text-caption text-rose-950">
                    <p class="font-bold">Audited Coordinator Rejection</p>
                    <p class="mt-0.5">Please provide a required reason for rejecting this evaluation recommendation. The Immediate Supervisor (<strong>{{ form.supervisorName }}</strong>) will be notified.</p>
                </div>
                <form-field label="Required Reason for Rejection" required>
                    <textarea v-model="coordinatorRejectionReason" rows="4"
                              placeholder="Clearly state why this recommendation is being rejected..."
                              class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none"></textarea>
                </form-field>
            </div>
            <template #footer>
                <div class="flex items-center justify-end gap-2">
                    <button type="button" @click="showRejectModal = false" class="btn btn-outline" :disabled="saving">Cancel</button>
                    <button type="button" @click="submitCoordinatorReject" class="btn btn-danger bg-rose-600 text-white hover:bg-rose-700" :disabled="saving">
                        <app-icon name="XCircle" :size="15" /> {{ saving ? 'Rejecting...' : 'Confirm Rejection' }}
                    </button>
                </div>
            </template>
        </app-modal>

        <!-- MODAL 5: SUPERVISOR REQUEST REVISION AUTHORIZATION -->
        <app-modal :open="showSupRevisionReqModal" title="Request Coordinator Authorization to Revise Evaluation" @close="showSupRevisionReqModal = false">
            <div class="space-y-4">
                <div class="rounded-lg border border-navy/20 bg-mist/60 p-3 text-caption text-ink">
                    <p class="font-bold text-navy">Submitted Evaluations Are Locked</p>
                    <p class="mt-0.5">Enter the reason why this evaluation needs to be unlocked for correction. The S.A. Coordinator will be notified.</p>
                </div>
                <form-field label="Reason for Revision Request" required>
                    <textarea v-model="supRevisionReqReason" rows="4"
                              placeholder="Explain what needs to be corrected..."
                              class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none"></textarea>
                </form-field>
            </div>
            <template #footer>
                <div class="flex items-center justify-end gap-2">
                    <button type="button" @click="showSupRevisionReqModal = false" class="btn btn-outline" :disabled="saving">Cancel</button>
                    <button type="button" @click="submitSupervisorRevisionRequest" class="btn btn-primary" :disabled="saving">
                        <app-icon name="Send" :size="15" /> {{ saving ? 'Sending...' : 'Send Revision Request' }}
                    </button>
                </div>
            </template>
        </app-modal>

        <!-- MODAL 6: COORDINATOR LOG OVERDUE FOLLOW-UP / EXCEPTION -->
        <app-modal :open="showCoordExceptionModal" title="Log Step 3 Overdue Follow-Up or Documented Exception" @close="showCoordExceptionModal = false">
            <div class="space-y-4">
                <div class="rounded-lg border border-navy/20 bg-mist/60 p-3 text-caption text-ink">
                    <p class="font-bold text-navy">Document Step 3 Exception to Proceed to Step 4 Review</p>
                    <p class="mt-0.5">Record the follow-up or exception status if the Student Assistant is unable or unwilling to sign.</p>
                </div>
                <form-field label="Recorded Step 3 Exception Status" required>
                    <select v-model="coordExceptionForm.acknowledgmentStatus" class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none">
                        <option value="OVERDUE_AWAITING_COORDINATOR">Overdue — Awaiting Coordinator Review</option>
                        <option value="UNABLE_TO_ACKNOWLEDGE">Unable to Acknowledge (Emergency / Absence)</option>
                        <option value="ACKNOWLEDGMENT_DECLINED">Acknowledgment Declined (Documented Refusal)</option>
                    </select>
                </form-field>
                <form-field label="Follow-Up Notes / Exception Reason" required>
                    <textarea v-model="coordExceptionForm.remarks" rows="3"
                              placeholder="Document the follow-up attempts or reason..."
                              class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none"></textarea>
                </form-field>
            </div>
            <template #footer>
                <div class="flex items-center justify-end gap-2">
                    <button type="button" @click="showCoordExceptionModal = false" class="btn btn-outline" :disabled="saving">Cancel</button>
                    <button type="button" @click="submitCoordExceptionFollowup" class="btn btn-primary" :disabled="saving">
                        <app-icon name="Check" :size="15" /> {{ saving ? 'Saving...' : 'Log Exception & Advance to Step 4' }}
                    </button>
                </div>
            </template>
        </app-modal>

        <!-- MODAL 7: COORDINATOR REOPEN FINALIZED EVALUATION -->
        <app-modal :open="showReopenModal" title="Reopen Finalized Evaluation (Authorized Audit Action)" @close="showReopenModal = false">
            <div class="space-y-4">
                <div class="rounded-lg border border-amber-300 bg-amber-50 p-3 text-caption text-amber-950">
                    <p class="font-bold">Reopening a Finalized Record Requires a Recorded Reason</p>
                    <p class="mt-0.5">Select the target stage and enter the official authorization reason.</p>
                </div>
                <form-field label="Reopen Target Stage" required>
                    <select v-model="reopenForm.targetStage" class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none">
                        <option value="FOR_COORDINATOR_REVIEW">Step 4: Coordinator Review</option>
                        <option value="FOR_SA_REVIEW">Step 3: S.A. Review &amp; Acknowledgment</option>
                        <option value="RETURNED_FOR_REVISION">Step 1: Return to Supervisor for Revision</option>
                    </select>
                </form-field>
                <form-field label="Authorization Reason for Reopening" required>
                    <textarea v-model="reopenForm.reopenReason" rows="3"
                              placeholder="State why this finalized evaluation is being reopened..."
                              class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none"></textarea>
                </form-field>
            </div>
            <template #footer>
                <div class="flex items-center justify-end gap-2">
                    <button type="button" @click="showReopenModal = false" class="btn btn-outline" :disabled="saving">Cancel</button>
                    <button type="button" @click="submitReopenEvaluation" class="btn btn-primary" :disabled="saving">
                        <app-icon name="Unlock" :size="15" /> {{ saving ? 'Reopening...' : 'Authorize & Reopen Evaluation' }}
                    </button>
                </div>
            </template>
        </app-modal>
    </div>
    `
};

// ============================================================================
// 1. S.A. COORDINATOR EVALUATION MODULE (/admin/evaluations)
//    Layer A: Evaluation Overview Page -> Layer B/C: Evaluation Details Page
// ============================================================================
const AdminEvaluationsPage = {
    components: { AppIcon, PageHeader, AppModal, FormField, NcstEvaluationWizard, EvaluationProcessTracker },

    setup() {
        const loading = Vue.ref(true);
        const loadError = Vue.ref("");
        const semester = Vue.ref(null);
        const campaign = Vue.ref(null);
        const summary = Vue.ref({
            totalSas: 0,
            completedCount: 0,
            pendingCount: 0,
            forSaReviewCount: 0,
            forCoordinatorCount: 0,
            forFinalDecisionCount: 0,
            inProgressCount: 0,
            awaitingActionCount: 0,
            finalizedCount: 0,
            recommendedCount: 0,
            notRecommendedCount: 0,
            overdueCount: 0,
            extensionPendingCount: 0,
            concernCount: 0,
            returnedCount: 0,
            overallAverage: 0
        });
        const supervisorProgress = Vue.ref([]);
        const evaluations = Vue.ref([]);
        const schoolHolidays = Vue.ref([]);

        // Layer A Filters (Preserved when returning from Details view)
        const searchQuery = Vue.ref("");
        const periodFilter = Vue.ref("ALL");
        const deptFilter = Vue.ref("ALL");
        const statusFilter = Vue.ref("ALL");
        const activeTab = Vue.ref("sas"); // 'sas' | 'supervisors' | 'holidays'

        // Send Evaluation Modal
        const showSendModal = Vue.ref(false);
        const sending = Vue.ref(false);
        const sendForm = Vue.reactive({
            title: "",
            academicTerm: "",
            deadline: "",
            instructions: "Please evaluate each Student Assistant assigned to your department or office using the 5-Step NCST Evaluation Form."
        });

        // Holiday Management Form
        const holidayForm = Vue.reactive({ date: "", name: "" });
        const savingHoliday = Vue.ref(false);

        // Selected Evaluation for Layer B Details View
        const selectedEvaluation = Vue.ref(null);
        const reminding = Vue.ref(false);
        const processingReminders = Vue.ref(false);

        const route = VueRouter.useRoute();

        const applyPendingTarget = (notifOverride = null) => {
            let pendingNotif = notifOverride;
            if (!pendingNotif && Store.pendingNotif && (Date.now() - (Store.pendingNotif.clickedAt || 0) < 30000)) {
                pendingNotif = Store.pendingNotif;
                Store.pendingNotif = null;
            }
            const matched = findTargetEvaluationFromNotifOrRoute(evaluations.value, route, pendingNotif);
            if (matched) {
                selectedEvaluation.value = matched;
            }
        };

        const load = async (autoSelectFromNotif = false, notifOverride = null) => {
            loading.value = true;
            loadError.value = "";
            const res = await Model.request("evaluations", "admin_overview");
            loading.value = false;
            if (!res.success) {
                loadError.value = res.message || "Failed to load evaluation overview.";
                return;
            }
            semester.value = res.semester;
            campaign.value = res.campaign;
            summary.value = res.summary || summary.value;
            supervisorProgress.value = res.supervisorProgress || [];
            evaluations.value = res.evaluations || [];
            schoolHolidays.value = res.schoolHolidays || [];

            if (autoSelectFromNotif) {
                applyPendingTarget(notifOverride);
            }
        };

        const onNotificationClicked = async (ev) => {
            const notif = ev?.detail || null;
            Store.pendingNotif = null;
            await load(true, notif);
        };

        Vue.onMounted(() => {
            load(true);
            window.addEventListener("assistpay:notification-clicked", onNotificationClicked);
        });

        Vue.onUnmounted(() => {
            window.removeEventListener("assistpay:notification-clicked", onNotificationClicked);
        });

        Vue.watch(() => [route.query.saProfileId, route.query.evalId], () => {
            if (route.query.saProfileId || route.query.evalId) {
                applyPendingTarget();
            }
        });

        // 4 Compact Summary Cards: Total Evaluations, In Progress, Awaiting Action, Completed
        const overviewKpis = Vue.computed(() => {
            let inProgress = 0;
            let awaitingAction = 0;
            let completed = 0;
            for (const ev of evaluations.value) {
                const b = workflowStatusBadge(ev, "ADMIN");
                if (b.category === "COMPLETED") completed++;
                else if (b.category === "IN_PROGRESS") inProgress++;
                else awaitingAction++;
            }
            return {
                total: evaluations.value.length,
                inProgress,
                awaitingAction,
                completed
            };
        });

        const reviewPeriods = Vue.computed(() => {
            const set = new Set();
            for (const ev of evaluations.value) {
                if (ev.evaluationPeriod) set.add(ev.evaluationPeriod);
            }
            return Array.from(set);
        });

        const branchesAndAssignments = Vue.computed(() => {
            const set = new Set();
            for (const ev of evaluations.value) {
                if (ev.department) set.add(ev.department);
            }
            return Array.from(set).sort();
        });

        const filteredEvaluations = Vue.computed(() => {
            const q = searchQuery.value.trim().toLowerCase();
            return evaluations.value.filter(ev => {
                if (periodFilter.value !== "ALL" && ev.evaluationPeriod !== periodFilter.value) {
                    return false;
                }
                if (deptFilter.value !== "ALL" && ev.department !== deptFilter.value && ev.category !== deptFilter.value) {
                    return false;
                }
                if (statusFilter.value !== "ALL") {
                    const badge = workflowStatusBadge(ev, "ADMIN");
                    if (statusFilter.value === "COMPLETED" && badge.category !== "COMPLETED") return false;
                    if (statusFilter.value === "IN_PROGRESS" && badge.category !== "IN_PROGRESS") return false;
                    if (statusFilter.value === "AWAITING_ACTION" && badge.category !== "AWAITING_ACTION") return false;
                    if (statusFilter.value === "RETURNED" && badge.category !== "RETURNED") return false;
                    if (statusFilter.value === "OVERDUE" && badge.category !== "OVERDUE") return false;
                    if (["PENDING", "RETURNED_FOR_REVISION", "FOR_SA_REVIEW", "FOR_COORDINATOR_REVIEW", "FOR_FINAL_DECISION", "FINALIZED"].includes(statusFilter.value) && ev.status !== statusFilter.value) {
                        return false;
                    }
                }
                if (!q) return true;
                return (ev.studentName || "").toLowerCase().includes(q) ||
                       (ev.studentId || "").toLowerCase().includes(q) ||
                       (ev.evaluationRef || "").toLowerCase().includes(q) ||
                       (ev.department || "").toLowerCase().includes(q) ||
                       (ev.supervisorName || "").toLowerCase().includes(q);
            });
        });

        // DataTable state & sorting
        const sortKey = Vue.ref("priority");
        const sortDir = Vue.ref("asc");
        const pageSize = Vue.ref(10);
        const page = Vue.ref(1);

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

        Vue.watch([searchQuery, periodFilter, deptFilter, statusFilter, activeTab], () => {
            page.value = 1;
        });

        const sortedEvaluations = Vue.computed(() => {
            const list = [...filteredEvaluations.value];
            const key = sortKey.value;
            const dir = sortDir.value === "asc" ? 1 : -1;

            if (key === "priority") {
                list.sort((a, b) => {
                    const pa = evalSortPriorityForAdmin(a);
                    const pb = evalSortPriorityForAdmin(b);
                    if (pa !== pb) return (pa - pb) * dir;
                    return (a.studentName || "").localeCompare(b.studentName || "") * dir;
                });
                return list;
            }

            list.sort((a, b) => {
                let res = 0;
                if (key === "studentName") {
                    res = (a.studentName || "").localeCompare(b.studentName || "");
                    if (res === 0) res = (a.studentId || "").localeCompare(b.studentId || "");
                } else if (key === "evaluationPeriod") {
                    res = (a.evaluationPeriod || "").localeCompare(b.evaluationPeriod || "");
                } else if (key === "supervisorName") {
                    res = (a.supervisorName || "").localeCompare(b.supervisorName || "");
                } else if (key === "step") {
                    const stepA = getStepInfo(a.status, a.hasDraft).step || 0;
                    const stepB = getStepInfo(b.status, b.hasDraft).step || 0;
                    res = stepA - stepB;
                } else if (key === "status") {
                    res = (a.status || "").localeCompare(b.status || "");
                } else if (key === "deadline") {
                    const dateA = a.ackDueDate || a.effectiveDate || campaign.value?.deadline || "";
                    const dateB = b.ackDueDate || b.effectiveDate || campaign.value?.deadline || "";
                    res = dateA.localeCompare(dateB);
                }
                return res * dir;
            });
            return list;
        });

        const pageCount = Vue.computed(() => {
            if (pageSize.value <= 0) return 1;
            return Math.max(1, Math.ceil(sortedEvaluations.value.length / pageSize.value));
        });

        const pageRows = Vue.computed(() => {
            if (pageSize.value <= 0) return sortedEvaluations.value;
            const start = (page.value - 1) * pageSize.value;
            return sortedEvaluations.value.slice(start, start + pageSize.value);
        });

        const rangeText = Vue.computed(() => {
            const total = sortedEvaluations.value.length;
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

        const openSendModal = () => {
            const semLabel = semester.value?.label || "2nd Semester, A.Y. 2025-2026";
            sendForm.title = campaign.value?.title || `${semLabel} Student Assistant Performance Evaluation`;
            sendForm.academicTerm = campaign.value?.academicTerm || semLabel;
            sendForm.deadline = campaign.value?.deadline || "";
            sendForm.instructions = campaign.value?.instructions || "Please evaluate each Student Assistant assigned to your department or office using the 5-Step NCST Evaluation Form.";
            showSendModal.value = true;
        };

        const submitSendCampaign = async () => {
            sending.value = true;
            const res = await Model.request("evaluations", "send_campaign", {
                title: sanitizeEvalText(sendForm.title),
                academicTerm: sanitizeEvalText(sendForm.academicTerm),
                deadline: sendForm.deadline || null,
                instructions: sanitizeEvalText(sendForm.instructions)
            });
            sending.value = false;
            if (!res.success) {
                Toast.error(res.message || "Could not send evaluation campaign.");
                return;
            }
            Toast.success(res.message || "Evaluation forms sent to all Supervisors!");
            showSendModal.value = false;
            load();
        };

        const remindSupervisors = async (supId = null) => {
            reminding.value = true;
            const res = await Model.request("evaluations", "remind_supervisors", {
                supervisorId: supId
            });
            reminding.value = false;
            if (!res.success) {
                Toast.error(res.message || "Could not send reminder.");
                return;
            }
            Toast.success(res.message || "Reminder sent to Supervisor(s)!");
        };

        const runAutomatedReminders = async () => {
            processingReminders.value = true;
            const res = await Model.request("evaluations", "process_reminders");
            processingReminders.value = false;
            if (!res.success) {
                Toast.error(res.message || "Could not process S.A. acknowledgment reminders.");
                return;
            }
            Toast.success(res.message || "S.A. acknowledgment deadlines and reminders checked!");
            load();
        };

        const addHoliday = async () => {
            if (!holidayForm.date || !holidayForm.name.trim()) {
                Toast.error("Please enter both a holiday date and holiday name.");
                return;
            }
            savingHoliday.value = true;
            const res = await Model.request("evaluations", "add_holiday", {
                holidayDate: holidayForm.date,
                holidayName: sanitizeEvalText(holidayForm.name)
            });
            savingHoliday.value = false;
            if (!res.success) {
                Toast.error(res.message || "Could not save school holiday.");
                return;
            }
            Toast.success(res.message || "School holiday saved.");
            holidayForm.date = "";
            holidayForm.name = "";
            load();
        };

        const deleteHoliday = async (id) => {
            const res = await Model.request("evaluations", "delete_holiday", { holidayId: id });
            if (res.success) {
                Toast.success("School holiday removed.");
                load();
            }
        };

        const openDetails = (ev) => {
            selectedEvaluation.value = ev;
        };

        const onWizardSaved = async (res) => {
            if (res && res.evaluation) {
                selectedEvaluation.value = res.evaluation;
            }
            await load();
            if (res && res.returnToList) {
                selectedEvaluation.value = null;
            } else if (selectedEvaluation.value) {
                const fresh = evaluations.value.find(e => e.saProfileId === selectedEvaluation.value.saProfileId);
                if (fresh) selectedEvaluation.value = fresh;
            }
        };

        return {
            loading, loadError, semester, campaign, summary, overviewKpis,
            supervisorProgress, evaluations, filteredEvaluations, sortedEvaluations, pageRows, reviewPeriods, branchesAndAssignments, schoolHolidays,
            searchQuery, periodFilter, deptFilter, statusFilter, activeTab,
            sortKey, sortDir, pageSize, page, sortBy, getSortIcon, pageCount, rangeText, visiblePages,
            showSendModal, sending, sendForm, openSendModal, submitSendCampaign,
            holidayForm, savingHoliday, addHoliday, deleteHoliday,
            remindSupervisors, reminding, runAutomatedReminders, processingReminders,
            selectedEvaluation, openDetails, onWizardSaved,
            Format, getStepInfo, workflowStatusBadge, evalStatusMeta, ackStatusMeta, decisionMeta
        };
    },

    template: `
    <div class="space-y-6">
        <!-- LAYER B & C: Evaluation Details Page -->
        <ncst-evaluation-wizard
            v-if="selectedEvaluation"
            :initial-data="selectedEvaluation"
            mode="COORDINATOR"
            @close="selectedEvaluation = null"
            @saved="onWizardSaved" />

        <!-- LAYER A: Evaluation Overview Page -->
        <template v-else>
            <page-header
                title="S.A. Performance Evaluation"
                subtitle="Monitor and manage the five-step Student Assistant performance evaluation workflow across all assigned offices and laboratories."
                :breadcrumbs="[
                    { label: 'Dashboard', to: '/admin/dashboard' },
                    { label: 'S.A. Performance Evaluation' }
                ]">
                <template v-if="campaign" #actions>
                    <div class="flex flex-wrap items-center gap-2">
                        <button type="button" @click="runAutomatedReminders" :disabled="processingReminders" class="btn btn-outline" title="Check 5-school-day S.A. acknowledgment deadlines">
                            <app-icon name="CalendarClock" :size="16" />
                            {{ processingReminders ? 'Checking Deadlines...' : 'Check Deadlines' }}
                        </button>
                        <button type="button" @click="remindSupervisors(null)" :disabled="reminding" class="btn btn-primary">
                            <app-icon name="BellRing" :size="16" />
                            {{ reminding ? 'Sending Reminder...' : 'Remind Pending Supervisors' }}
                        </button>
                    </div>
                </template>
            </page-header>

            <div v-if="loading" class="card p-12 text-center text-muted">
                <app-icon name="LoaderCircle" :size="32" class="mx-auto mb-3 animate-spin text-navy" />
                <p class="font-medium text-ink">Loading semester performance evaluations…</p>
            </div>

            <div v-else-if="loadError" class="card border-danger/30 bg-danger/5 p-6 text-danger">
                <div class="flex items-center gap-3">
                    <app-icon name="CircleAlert" :size="20" class="shrink-0" />
                    <p class="font-medium">{{ loadError }}</p>
                </div>
            </div>

            <template v-else>
                <!-- Empty-State Launch Banner when no evaluation campaign has been sent yet (Single Primary CTA) -->
                <div v-if="!campaign" class="card border-2 border-dashed border-navy/30 bg-mist/40 p-6">
                    <div class="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
                        <div class="flex items-start gap-3.5">
                            <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-navy text-gold shadow-sm">
                                <app-icon name="ClipboardList" :size="24" />
                            </div>
                            <div>
                                <h2 class="text-[17px] font-bold text-navy">No Evaluation Sent Yet for {{ semester?.label || 'This Semester' }}</h2>
                                <p class="mt-0.5 text-body text-muted">
                                    Click <strong>Send Evaluation to Supervisors</strong> to initiate Step 1 of the evaluation workflow for all department and office supervisors.
                                </p>
                            </div>
                        </div>
                        <button type="button" @click="openSendModal" class="btn btn-primary shrink-0">
                            <app-icon name="Send" :size="16" /> Send Evaluation to Supervisors
                        </button>
                    </div>
                </div>

                <!-- 4 Compact Summary Cards: Total Evaluations, In Progress, Awaiting Action, Completed -->
                <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div class="card p-4">
                        <p class="text-caption font-bold uppercase text-muted">Total Evaluations</p>
                        <p class="mt-1 text-[26px] font-extrabold text-navy">{{ overviewKpis.total }}</p>
                        <p class="mt-0.5 text-caption text-muted">{{ campaign?.academicTerm || semester?.label || 'Active Semester' }}</p>
                    </div>
                    <div class="card p-4">
                        <p class="text-caption font-bold uppercase text-muted">In Progress</p>
                        <p class="mt-1 text-[26px] font-extrabold text-blue-600">{{ overviewKpis.inProgress }}</p>
                        <p class="mt-0.5 text-caption text-muted">Active drafts &amp; S.A. acknowledgments</p>
                    </div>
                    <div class="card p-4">
                        <p class="text-caption font-bold uppercase text-muted">Awaiting Action</p>
                        <p class="mt-1 text-[26px] font-extrabold text-amber-600">{{ overviewKpis.awaitingAction }}</p>
                        <p class="mt-0.5 text-caption text-muted">
                            Needs Supervisor or Coordinator action
                            <span v-if="summary.overdueCount > 0" class="font-bold text-rose-600">({{ summary.overdueCount }} overdue)</span>
                        </p>
                    </div>
                    <div class="card p-4">
                        <p class="text-caption font-bold uppercase text-muted">Completed</p>
                        <p class="mt-1 text-[26px] font-extrabold text-emerald-600">{{ overviewKpis.completed }}</p>
                        <p class="mt-0.5 text-caption text-muted">Step 5 finalized &amp; disclosed</p>
                    </div>
                </div>

                <!-- View Switcher Tabs -->
                <div class="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
                    <div class="flex flex-wrap items-center gap-2">
                        <button type="button" @click="activeTab = 'sas'"
                                class="rounded-lg px-4 py-2 text-body font-bold transition"
                                :class="activeTab === 'sas' ? 'bg-navy text-white shadow-sm' : 'bg-mist text-ink hover:bg-navy/10'">
                            Evaluation Overview ({{ evaluations.length }})
                        </button>
                        <button type="button" @click="activeTab = 'supervisors'"
                                class="rounded-lg px-4 py-2 text-body font-bold transition"
                                :class="activeTab === 'supervisors' ? 'bg-navy text-white shadow-sm' : 'bg-mist text-ink hover:bg-navy/10'">
                            Supervisor Progress ({{ supervisorProgress.length }})
                        </button>
                        <button type="button" @click="activeTab = 'holidays'"
                                class="rounded-lg px-4 py-2 text-body font-bold transition"
                                :class="activeTab === 'holidays' ? 'bg-navy text-white shadow-sm' : 'bg-mist text-ink hover:bg-navy/10'">
                            School Calendar Holidays ({{ schoolHolidays.length }})
                        </button>
                    </div>
                </div>

                <!-- TAB 1: Clean 7-Column Evaluation Overview Table -->
                <div v-if="activeTab === 'sas'" class="card overflow-hidden">
                    <!-- Search & Filters Bar -->
                    <div class="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
                        <div class="relative flex-1 max-w-md">
                            <app-icon name="Search" :size="16" class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                            <input v-model="searchQuery" type="text"
                                   placeholder="Search Student Assistant name, student ID, or ref (e.g. EVAL-#1)…"
                                   class="w-full rounded-lg border border-line bg-page py-2 pl-9 pr-3.5 text-body focus:border-navy focus:outline-none" />
                        </div>
                        <div class="flex flex-wrap items-center gap-2">
                            <select v-model="periodFilter" class="rounded-lg border border-line bg-page px-3 py-2 text-body focus:border-navy focus:outline-none">
                                <option value="ALL">All Review Periods</option>
                                <option v-for="p in reviewPeriods" :key="p" :value="p">{{ p }}</option>
                            </select>
                            <select v-model="deptFilter" class="rounded-lg border border-line bg-page px-3 py-2 text-body focus:border-navy focus:outline-none">
                                <option value="ALL">All Branches / Assignments</option>
                                <option v-for="d in branchesAndAssignments" :key="d" :value="d">{{ d }}</option>
                            </select>
                            <select v-model="statusFilter" class="rounded-lg border border-line bg-page px-3 py-2 text-body focus:border-navy focus:outline-none">
                                <option value="ALL">All Workflow Statuses</option>
                                <option value="AWAITING_ACTION">Awaiting Action</option>
                                <option value="IN_PROGRESS">In Progress</option>
                                <option value="RETURNED">Returned</option>
                                <option value="OVERDUE">Overdue</option>
                                <option value="COMPLETED">Completed (Finalized)</option>
                            </select>
                        </div>
                    </div>

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
                            <b class="text-ink">{{ sortedEvaluations.length }}</b> total evaluation records
                        </span>
                    </div>

                    <div class="overflow-x-auto">
                        <table class="w-full text-left text-body">
                            <thead class="bg-mist/70 text-caption font-bold uppercase text-muted select-none">
                                <tr>
                                    <th class="px-4 py-3 whitespace-nowrap">
                                        <button type="button" @click="sortBy('studentName')" class="inline-flex items-center gap-1 text-caption font-bold uppercase text-muted hover:text-ink transition-colors">
                                            Student Assistant
                                            <app-icon :name="getSortIcon('studentName')" :size="13" />
                                        </button>
                                    </th>
                                    <th class="px-4 py-3 whitespace-nowrap">
                                        <button type="button" @click="sortBy('evaluationPeriod')" class="inline-flex items-center gap-1 text-caption font-bold uppercase text-muted hover:text-ink transition-colors">
                                            Evaluation Period
                                            <app-icon :name="getSortIcon('evaluationPeriod')" :size="13" />
                                        </button>
                                    </th>
                                    <th class="px-4 py-3 whitespace-nowrap">
                                        <button type="button" @click="sortBy('supervisorName')" class="inline-flex items-center gap-1 text-caption font-bold uppercase text-muted hover:text-ink transition-colors">
                                            Supervisor
                                            <app-icon :name="getSortIcon('supervisorName')" :size="13" />
                                        </button>
                                    </th>
                                    <th class="px-4 py-3 whitespace-nowrap">
                                        <button type="button" @click="sortBy('step')" class="inline-flex items-center gap-1 text-caption font-bold uppercase text-muted hover:text-ink transition-colors">
                                            Current Step
                                            <app-icon :name="getSortIcon('step')" :size="13" />
                                        </button>
                                    </th>
                                    <th class="px-4 py-3 whitespace-nowrap">
                                        <button type="button" @click="sortBy('status')" class="inline-flex items-center gap-1 text-caption font-bold uppercase text-muted hover:text-ink transition-colors">
                                            Status
                                            <app-icon :name="getSortIcon('status')" :size="13" />
                                        </button>
                                    </th>
                                    <th class="px-4 py-3 whitespace-nowrap">
                                        <button type="button" @click="sortBy('deadline')" class="inline-flex items-center gap-1 text-caption font-bold uppercase text-muted hover:text-ink transition-colors">
                                            Deadline
                                            <app-icon :name="getSortIcon('deadline')" :size="13" />
                                        </button>
                                    </th>
                                    <th class="px-4 py-3 text-right whitespace-nowrap">Action</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-line">
                                <tr v-if="!sortedEvaluations.length">
                                    <td colspan="7" class="p-8 text-center text-muted">
                                        No evaluation records match your current search or filters.
                                    </td>
                                </tr>
                                <tr v-for="ev in pageRows" :key="ev.saProfileId" class="hover:bg-mist/30">
                                    <td class="px-4 py-3 whitespace-nowrap">
                                        <div class="flex items-center gap-2">
                                            <span class="rounded bg-navy/10 px-1.5 py-0.5 font-mono text-[11px] font-bold text-navy whitespace-nowrap shrink-0">{{ ev.evaluationRef }}</span>
                                            <p class="font-bold text-navy whitespace-nowrap">{{ ev.studentName }}</p>
                                        </div>
                                        <p class="mt-0.5 text-caption text-muted whitespace-nowrap">{{ ev.studentId }} • {{ ev.department }}</p>
                                    </td>
                                    <td class="px-4 py-3 text-caption font-semibold text-ink">
                                        {{ ev.evaluationPeriod }}
                                    </td>
                                    <td class="px-4 py-3">
                                        <p class="font-semibold text-ink">{{ ev.supervisorName }}</p>
                                        <p class="text-caption text-muted">{{ ev.category }}</p>
                                    </td>
                                    <td class="px-4 py-3">
                                        <p class="text-xs font-bold text-navy">{{ getStepInfo(ev.status, ev.hasDraft).stepTitle }}</p>
                                        <p class="text-[11px] text-muted">{{ getStepInfo(ev.status, ev.hasDraft).subLabel }}</p>
                                    </td>
                                    <td class="px-4 py-3 whitespace-nowrap">
                                        <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap"
                                              :class="workflowStatusBadge(ev, 'ADMIN').cls">
                                            <app-icon :name="workflowStatusBadge(ev, 'ADMIN').icon" :size="12" />
                                            {{ workflowStatusBadge(ev, 'ADMIN').label }}
                                        </span>
                                        <p class="mt-0.5 text-[11px] text-muted whitespace-nowrap">{{ workflowStatusBadge(ev, 'ADMIN').detail }}</p>
                                    </td>
                                    <td class="px-4 py-3 text-caption">
                                        <template v-if="ev.status === 'FOR_SA_REVIEW' && ev.ackDueDate">
                                            <span :class="ev.isAckOverdue ? 'font-bold text-rose-600' : 'font-semibold text-ink'">
                                                {{ Format.date(ev.ackDueDate) }}
                                            </span>
                                            <span class="block text-[10px] text-muted">S.A. Ack Window</span>
                                        </template>
                                        <template v-else-if="ev.status === 'FINALIZED' && ev.effectiveDate">
                                            <span class="font-semibold text-emerald-700">{{ Format.date(ev.effectiveDate) }}</span>
                                            <span class="block text-[10px] text-muted">Effective Date</span>
                                        </template>
                                        <template v-else-if="campaign?.deadline">
                                            <span class="font-medium text-ink">{{ Format.date(campaign.deadline) }}</span>
                                            <span class="block text-[10px] text-muted">Campaign Due</span>
                                        </template>
                                        <span v-else class="text-muted">—</span>
                                    </td>
                                    <td class="px-4 py-3 text-right">
                                        <button type="button" @click="openDetails(ev)"
                                                class="btn btn-sm"
                                                :class="['FOR_COORDINATOR_REVIEW', 'FOR_FINAL_DECISION'].includes(ev.status) ? 'btn-primary' : 'btn-outline'">
                                            <app-icon :name="['FOR_COORDINATOR_REVIEW', 'FOR_FINAL_DECISION'].includes(ev.status) ? 'ClipboardCheck' : 'Eye'" :size="14" />
                                            {{ ev.status === 'FOR_FINAL_DECISION'
                                                ? 'Record Decision'
                                                : (ev.status === 'FOR_COORDINATOR_REVIEW' ? 'Review Evaluation' : 'View Details') }}
                                        </button>
                                    </td>
                                </tr>
                            </tbody>
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
                </div>

                <!-- TAB 2: Supervisor Completion Progress -->
                <div v-else-if="activeTab === 'supervisors'" class="card overflow-hidden">
                    <div class="overflow-x-auto">
                        <table class="w-full text-left text-body">
                            <thead class="bg-mist/70 text-caption font-bold uppercase text-muted">
                                <tr>
                                    <th class="px-4 py-3">Supervisor</th>
                                    <th class="px-4 py-3">Branch / Assignment Scope</th>
                                    <th class="px-4 py-3 text-center">Assigned S.A.s</th>
                                    <th class="px-4 py-3 text-center">Step 1 Submitted</th>
                                    <th class="px-4 py-3 text-center">Pending</th>
                                    <th class="px-4 py-3 text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-line">
                                <tr v-for="sp in supervisorProgress" :key="sp.supervisorId" class="hover:bg-mist/30">
                                    <td class="px-4 py-3">
                                        <p class="font-bold text-navy">{{ sp.name }}</p>
                                        <p class="text-caption text-muted">{{ sp.empId }}</p>
                                    </td>
                                    <td class="px-4 py-3">
                                        <span class="rounded bg-navy/10 px-2 py-0.5 text-[11px] font-bold text-navy">{{ sp.category }}</span>
                                        <span class="ml-2 text-caption font-medium text-ink">{{ sp.department }}</span>
                                    </td>
                                    <td class="px-4 py-3 text-center font-bold text-ink">{{ sp.assignedCount }}</td>
                                    <td class="px-4 py-3 text-center font-bold text-success">{{ sp.completedCount }}</td>
                                    <td class="px-4 py-3 text-center font-bold" :class="sp.pendingCount > 0 ? 'text-warning' : 'text-muted'">
                                        {{ sp.pendingCount }}
                                    </td>
                                    <td class="px-4 py-3 text-right">
                                        <button v-if="sp.pendingCount > 0" type="button" @click="remindSupervisors(sp.supervisorId)" :disabled="reminding" class="btn btn-sm btn-outline">
                                            <app-icon name="BellRing" :size="14" /> Send Reminder
                                        </button>
                                        <span v-else class="inline-flex items-center gap-1 text-caption font-bold text-success">
                                            <app-icon name="CheckCircle2" :size="14" /> Completed
                                        </span>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- TAB 3: School Calendar Holidays -->
                <div v-else class="card p-5 space-y-4">
                    <div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
                        <div>
                            <h3 class="text-base font-bold text-navy">Configured School Holidays (5-School-Day Deadline Calendar)</h3>
                            <p class="text-caption text-muted">Saturdays, Sundays, and these dates are excluded when computing the 5-school-day S.A. acknowledgment deadline.</p>
                        </div>
                        <div class="flex flex-wrap items-center gap-2">
                            <input v-model="holidayForm.date" type="date" class="rounded-lg border border-line bg-page px-3 py-2 text-xs" />
                            <input v-model="holidayForm.name" type="text" placeholder="Holiday name" class="rounded-lg border border-line bg-page px-3 py-2 text-xs" />
                            <button type="button" @click="addHoliday" :disabled="savingHoliday" class="btn btn-sm btn-primary">
                                <app-icon name="Plus" :size="14" /> Add Holiday
                            </button>
                        </div>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="w-full text-left text-body">
                            <thead class="bg-mist/70 text-caption font-bold uppercase text-muted">
                                <tr>
                                    <th class="px-4 py-2.5">Date</th>
                                    <th class="px-4 py-2.5">Holiday Description</th>
                                    <th class="px-4 py-2.5 text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-line">
                                <tr v-for="h in schoolHolidays" :key="h.id">
                                    <td class="px-4 py-2.5 font-mono text-xs font-bold text-navy">{{ Format.date(h.date) }} ({{ h.date }})</td>
                                    <td class="px-4 py-2.5 text-xs font-medium text-ink">{{ h.name }}</td>
                                    <td class="px-4 py-2.5 text-right">
                                        <button type="button" @click="deleteHoliday(h.id)" class="text-xs font-semibold text-danger hover:underline">Remove</button>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </template>

            <!-- Modal: Send Evaluation Campaign to Supervisors -->
            <app-modal :open="showSendModal" title="Send S.A. Performance Evaluation Form to Supervisors" @close="showSendModal = false">
                <div class="space-y-4">
                    <div class="rounded-lg border border-navy/20 bg-mist/60 p-3.5 text-caption text-ink">
                        <p class="font-bold text-navy">Dispatch Semester Performance Evaluation (Step 1)</p>
                        <p class="mt-0.5">This notifies all Department and Office Supervisors to complete Step 1 of the 5-step S.A. Performance Evaluation workflow.</p>
                    </div>
                    <form-field label="Evaluation Campaign Title" required>
                        <input v-model="sendForm.title" type="text"
                               class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none" />
                    </form-field>
                    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <form-field label="Evaluation Academic Term" required>
                            <input v-model="sendForm.academicTerm" type="text"
                                   class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none" />
                        </form-field>
                        <form-field label="Supervisor Submission Deadline (Optional)">
                            <input v-model="sendForm.deadline" type="date"
                                   class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none" />
                        </form-field>
                    </div>
                    <form-field label="Instructions for Supervisors">
                        <textarea v-model="sendForm.instructions" rows="3"
                                  class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none"></textarea>
                    </form-field>
                </div>
                <template #footer>
                    <div class="flex items-center justify-end gap-2">
                        <button type="button" @click="showSendModal = false" class="btn btn-outline" :disabled="sending">Cancel</button>
                        <button type="button" @click="submitSendCampaign" class="btn btn-primary" :disabled="sending">
                            <app-icon name="Send" :size="15" />
                            {{ sending ? 'Sending...' : 'Send Evaluation to All Supervisors' }}
                        </button>
                    </div>
                </template>
            </app-modal>
        </template>
    </div>
    `
};

// ============================================================================
// 2. SUPERVISOR S.A. EVALUATION MODULE (/supervisor/evaluations)
//    Layer A: Evaluation Overview Page -> Layer B/C: Evaluation Details Page
// ============================================================================
const SupervisorEvaluationsPage = {
    components: { AppIcon, PageHeader, NcstEvaluationWizard, EvaluationProcessTracker },

    setup() {
        const loading = Vue.ref(true);
        const loadError = Vue.ref("");
        const semester = Vue.ref(null);
        const supervisor = Vue.ref(null);
        const campaign = Vue.ref(null);
        const summary = Vue.ref({ totalAssigned: 0, completedCount: 0, returnedCount: 0, pendingCount: 0 });
        const evaluations = Vue.ref([]);

        // Layer A Filters (Preserved when returning from Details view)
        const searchQuery = Vue.ref("");
        const periodFilter = Vue.ref("ALL");
        const deptFilter = Vue.ref("ALL");
        const statusFilter = Vue.ref("ALL");
        const selectedEvaluation = Vue.ref(null);

        const route = VueRouter.useRoute();

        const applyPendingTarget = (notifOverride = null) => {
            let pendingNotif = notifOverride;
            if (!pendingNotif && Store.pendingNotif && (Date.now() - (Store.pendingNotif.clickedAt || 0) < 30000)) {
                pendingNotif = Store.pendingNotif;
                Store.pendingNotif = null;
            }
            const matched = findTargetEvaluationFromNotifOrRoute(evaluations.value, route, pendingNotif);
            if (matched) {
                selectedEvaluation.value = matched;
            }
        };

        const load = async (autoSelectFromNotif = false, notifOverride = null) => {
            loading.value = true;
            loadError.value = "";
            const res = await Model.request("evaluations", "supervisor_list");
            loading.value = false;
            if (!res.success) {
                loadError.value = res.message || "Could not load your assigned S.A. evaluations.";
                return;
            }
            semester.value = res.semester;
            supervisor.value = res.supervisor;
            campaign.value = res.campaign;
            summary.value = res.summary || summary.value;
            evaluations.value = res.evaluations || [];

            if (autoSelectFromNotif) {
                applyPendingTarget(notifOverride);
            }
        };

        const onNotificationClicked = async (ev) => {
            const notif = ev?.detail || null;
            Store.pendingNotif = null;
            await load(true, notif);
        };

        Vue.onMounted(() => {
            load(true);
            window.addEventListener("assistpay:notification-clicked", onNotificationClicked);
        });

        Vue.onUnmounted(() => {
            window.removeEventListener("assistpay:notification-clicked", onNotificationClicked);
        });

        Vue.watch(() => [route.query.saProfileId, route.query.evalId], () => {
            if (route.query.saProfileId || route.query.evalId) {
                applyPendingTarget();
            }
        });

        const overviewKpis = Vue.computed(() => {
            let inProgress = 0;
            let awaitingAction = 0;
            let completed = 0;
            for (const ev of evaluations.value) {
                const b = workflowStatusBadge(ev, "SUPERVISOR");
                if (b.category === "COMPLETED") completed++;
                else if (b.category === "IN_PROGRESS") inProgress++;
                else awaitingAction++;
            }
            return {
                total: evaluations.value.length,
                inProgress,
                awaitingAction,
                completed
            };
        });

        const reviewPeriods = Vue.computed(() => {
            const set = new Set();
            for (const ev of evaluations.value) {
                if (ev.evaluationPeriod) set.add(ev.evaluationPeriod);
            }
            return Array.from(set);
        });

        const branchesAndAssignments = Vue.computed(() => {
            const set = new Set();
            for (const ev of evaluations.value) {
                if (ev.department) set.add(ev.department);
            }
            return Array.from(set).sort();
        });

        const filteredEvaluations = Vue.computed(() => {
            const q = searchQuery.value.trim().toLowerCase();
            return evaluations.value.filter(ev => {
                if (periodFilter.value !== "ALL" && ev.evaluationPeriod !== periodFilter.value) return false;
                if (deptFilter.value !== "ALL" && ev.department !== deptFilter.value) return false;
                if (statusFilter.value !== "ALL") {
                    const badge = workflowStatusBadge(ev, "SUPERVISOR");
                    if (statusFilter.value === "AWAITING_ACTION" && badge.category !== "AWAITING_ACTION") return false;
                    if (statusFilter.value === "IN_PROGRESS" && badge.category !== "IN_PROGRESS") return false;
                    if (statusFilter.value === "RETURNED" && badge.category !== "RETURNED") return false;
                    if (statusFilter.value === "OVERDUE" && badge.category !== "OVERDUE") return false;
                    if (statusFilter.value === "COMPLETED" && badge.category !== "COMPLETED") return false;
                }
                if (!q) return true;
                return (ev.studentName || "").toLowerCase().includes(q) ||
                       (ev.studentId || "").toLowerCase().includes(q) ||
                       (ev.evaluationRef || "").toLowerCase().includes(q) ||
                       (ev.department || "").toLowerCase().includes(q);
            });
        });

        // DataTable state & sorting
        const sortKey = Vue.ref("priority");
        const sortDir = Vue.ref("asc");
        const pageSize = Vue.ref(10);
        const page = Vue.ref(1);

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

        Vue.watch([searchQuery, periodFilter, deptFilter, statusFilter], () => {
            page.value = 1;
        });

        const sortedEvaluations = Vue.computed(() => {
            const list = [...filteredEvaluations.value];
            const key = sortKey.value;
            const dir = sortDir.value === "asc" ? 1 : -1;

            if (key === "priority") {
                list.sort((a, b) => {
                    const pa = evalSortPriorityForSupervisor(a);
                    const pb = evalSortPriorityForSupervisor(b);
                    if (pa !== pb) return (pa - pb) * dir;
                    return (a.studentName || "").localeCompare(b.studentName || "") * dir;
                });
                return list;
            }

            list.sort((a, b) => {
                let res = 0;
                if (key === "studentName") {
                    res = (a.studentName || "").localeCompare(b.studentName || "");
                    if (res === 0) res = (a.studentId || "").localeCompare(b.studentId || "");
                } else if (key === "evaluationPeriod") {
                    res = (a.evaluationPeriod || "").localeCompare(b.evaluationPeriod || "");
                } else if (key === "supervisorName") {
                    res = (a.supervisorName || "").localeCompare(b.supervisorName || "");
                } else if (key === "step") {
                    const stepA = getStepInfo(a.status, a.hasDraft).step || 0;
                    const stepB = getStepInfo(b.status, b.hasDraft).step || 0;
                    res = stepA - stepB;
                } else if (key === "status") {
                    res = (a.status || "").localeCompare(b.status || "");
                } else if (key === "deadline") {
                    const dateA = a.ackDueDate || campaign.value?.deadline || "";
                    const dateB = b.ackDueDate || campaign.value?.deadline || "";
                    res = dateA.localeCompare(dateB);
                }
                return res * dir;
            });
            return list;
        });

        const pageCount = Vue.computed(() => {
            if (pageSize.value <= 0) return 1;
            return Math.max(1, Math.ceil(sortedEvaluations.value.length / pageSize.value));
        });

        const pageRows = Vue.computed(() => {
            if (pageSize.value <= 0) return sortedEvaluations.value;
            const start = (page.value - 1) * pageSize.value;
            return sortedEvaluations.value.slice(start, start + pageSize.value);
        });

        const rangeText = Vue.computed(() => {
            const total = sortedEvaluations.value.length;
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

        const openDetails = (ev) => {
            selectedEvaluation.value = ev;
        };

        const onWizardSaved = async (res) => {
            if (res && res.evaluation) {
                selectedEvaluation.value = res.evaluation;
            }
            await load();
            if (res && res.returnToList) {
                selectedEvaluation.value = null;
            } else if (selectedEvaluation.value) {
                const fresh = evaluations.value.find(e => e.saProfileId === selectedEvaluation.value.saProfileId);
                if (fresh) selectedEvaluation.value = fresh;
            }
        };

        return {
            loading, loadError, semester, supervisor, campaign, summary, overviewKpis,
            evaluations, filteredEvaluations, sortedEvaluations, pageRows, reviewPeriods, branchesAndAssignments,
            searchQuery, periodFilter, deptFilter, statusFilter,
            sortKey, sortDir, pageSize, page, sortBy, getSortIcon, pageCount, rangeText, visiblePages,
            selectedEvaluation, openDetails, onWizardSaved,
            Format, getStepInfo, workflowStatusBadge, evalStatusMeta, ackStatusMeta, decisionMeta
        };
    },

    template: `
    <div class="space-y-6">
        <!-- LAYER B & C: Evaluation Details Page -->
        <ncst-evaluation-wizard
            v-if="selectedEvaluation"
            :initial-data="selectedEvaluation"
            mode="SUPERVISOR"
            :read-only="!selectedEvaluation.canSupervisorEdit"
            @close="selectedEvaluation = null"
            @saved="onWizardSaved" />

        <!-- LAYER A: Evaluation Overview Page -->
        <template v-else>
            <page-header
                title="S.A. Performance Evaluation"
                subtitle="Complete Step 1 performance evaluations for Student Assistants assigned to your office or laboratory, and track their progress through finalization."
                :breadcrumbs="[
                    { label: 'Dashboard', to: '/supervisor/dashboard' },
                    { label: 'S.A. Performance Evaluation' }
                ]" />

            <div v-if="loading" class="card p-12 text-center text-muted">
                <app-icon name="LoaderCircle" :size="32" class="mx-auto mb-3 animate-spin text-navy" />
                <p class="font-medium text-ink">Loading your assigned Student Assistant evaluations…</p>
            </div>

            <div v-else-if="loadError" class="card border-danger/30 bg-danger/5 p-6 text-danger">
                <div class="flex items-center gap-3">
                    <app-icon name="CircleAlert" :size="20" class="shrink-0" />
                    <p class="font-medium">{{ loadError }}</p>
                </div>
            </div>

            <template v-else>
                <!-- 4 Compact Summary Cards: Total Evaluations, In Progress, Awaiting Action, Completed -->
                <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div class="card p-4">
                        <p class="text-caption font-bold uppercase text-muted">Total Evaluations</p>
                        <p class="mt-1 text-[26px] font-extrabold text-navy">{{ overviewKpis.total }}</p>
                        <p class="mt-0.5 text-caption text-muted">{{ supervisor?.deptLabel || 'Assigned Scope' }}</p>
                    </div>
                    <div class="card p-4">
                        <p class="text-caption font-bold uppercase text-muted">In Progress</p>
                        <p class="mt-1 text-[26px] font-extrabold text-blue-600">{{ overviewKpis.inProgress }}</p>
                        <p class="mt-0.5 text-caption text-muted">Saved drafts or in Steps 2–4</p>
                    </div>
                    <div class="card p-4">
                        <p class="text-caption font-bold uppercase text-muted">Awaiting Action</p>
                        <p class="mt-1 text-[26px] font-extrabold text-amber-600">{{ overviewKpis.awaitingAction }}</p>
                        <p class="mt-0.5 text-caption text-muted">
                            Needs your Step 1 submission
                            <span v-if="summary.returnedCount > 0" class="font-bold text-orange-700">({{ summary.returnedCount }} returned)</span>
                        </p>
                    </div>
                    <div class="card p-4">
                        <p class="text-caption font-bold uppercase text-muted">Completed</p>
                        <p class="mt-1 text-[26px] font-extrabold text-emerald-600">{{ overviewKpis.completed }}</p>
                        <p class="mt-0.5 text-caption text-muted">Step 5 finalized evaluations</p>
                    </div>
                </div>

                <!-- Clean 7-Column Evaluation Overview Table -->
                <div class="card overflow-hidden">
                    <div class="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
                        <div class="relative flex-1 max-w-md">
                            <app-icon name="Search" :size="16" class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                            <input v-model="searchQuery" type="text"
                                   placeholder="Search Student Assistant name, student ID, or evaluation ref…"
                                   class="w-full rounded-lg border border-line bg-page py-2 pl-9 pr-3.5 text-body focus:border-navy focus:outline-none" />
                        </div>
                        <div class="flex flex-wrap items-center gap-2">
                            <select v-model="periodFilter" class="rounded-lg border border-line bg-page px-3 py-2 text-body focus:border-navy focus:outline-none">
                                <option value="ALL">All Review Periods</option>
                                <option v-for="p in reviewPeriods" :key="p" :value="p">{{ p }}</option>
                            </select>
                            <select v-model="deptFilter" class="rounded-lg border border-line bg-page px-3 py-2 text-body focus:border-navy focus:outline-none">
                                <option value="ALL">All Assignments</option>
                                <option v-for="d in branchesAndAssignments" :key="d" :value="d">{{ d }}</option>
                            </select>
                            <select v-model="statusFilter" class="rounded-lg border border-line bg-page px-3 py-2 text-body focus:border-navy focus:outline-none">
                                <option value="ALL">All Workflow Statuses</option>
                                <option value="AWAITING_ACTION">Awaiting Action</option>
                                <option value="IN_PROGRESS">In Progress</option>
                                <option value="RETURNED">Returned</option>
                                <option value="OVERDUE">Overdue</option>
                                <option value="COMPLETED">Completed</option>
                            </select>
                        </div>
                    </div>

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
                            <b class="text-ink">{{ sortedEvaluations.length }}</b> total evaluation records
                        </span>
                    </div>

                    <div class="overflow-x-auto">
                        <table class="w-full text-left text-body">
                            <thead class="bg-mist/70 text-caption font-bold uppercase text-muted select-none">
                                <tr>
                                    <th class="px-4 py-3 whitespace-nowrap">
                                        <button type="button" @click="sortBy('studentName')" class="inline-flex items-center gap-1 text-caption font-bold uppercase text-muted hover:text-ink transition-colors">
                                            Student Assistant
                                            <app-icon :name="getSortIcon('studentName')" :size="13" />
                                        </button>
                                    </th>
                                    <th class="px-4 py-3 whitespace-nowrap">
                                        <button type="button" @click="sortBy('evaluationPeriod')" class="inline-flex items-center gap-1 text-caption font-bold uppercase text-muted hover:text-ink transition-colors">
                                            Evaluation Period
                                            <app-icon :name="getSortIcon('evaluationPeriod')" :size="13" />
                                        </button>
                                    </th>
                                    <th class="px-4 py-3 whitespace-nowrap">
                                        <button type="button" @click="sortBy('supervisorName')" class="inline-flex items-center gap-1 text-caption font-bold uppercase text-muted hover:text-ink transition-colors">
                                            Supervisor
                                            <app-icon :name="getSortIcon('supervisorName')" :size="13" />
                                        </button>
                                    </th>
                                    <th class="px-4 py-3 whitespace-nowrap">
                                        <button type="button" @click="sortBy('step')" class="inline-flex items-center gap-1 text-caption font-bold uppercase text-muted hover:text-ink transition-colors">
                                            Current Step
                                            <app-icon :name="getSortIcon('step')" :size="13" />
                                        </button>
                                    </th>
                                    <th class="px-4 py-3 whitespace-nowrap">
                                        <button type="button" @click="sortBy('status')" class="inline-flex items-center gap-1 text-caption font-bold uppercase text-muted hover:text-ink transition-colors">
                                            Status
                                            <app-icon :name="getSortIcon('status')" :size="13" />
                                        </button>
                                    </th>
                                    <th class="px-4 py-3 whitespace-nowrap">
                                        <button type="button" @click="sortBy('deadline')" class="inline-flex items-center gap-1 text-caption font-bold uppercase text-muted hover:text-ink transition-colors">
                                            Deadline
                                            <app-icon :name="getSortIcon('deadline')" :size="13" />
                                        </button>
                                    </th>
                                    <th class="px-4 py-3 text-right whitespace-nowrap">Action</th>
                                 </tr>
                            </thead>
                            <tbody class="divide-y divide-line">
                                <tr v-if="!sortedEvaluations.length">
                                    <td colspan="7" class="p-8 text-center text-muted">No Student Assistant evaluations match your filter.</td>
                                </tr>
                                <tr v-for="ev in pageRows" :key="ev.saProfileId" class="hover:bg-mist/30">
                                    <td class="px-4 py-3 whitespace-nowrap">
                                        <div class="flex items-center gap-2">
                                            <span class="rounded bg-navy/10 px-1.5 py-0.5 font-mono text-[11px] font-bold text-navy whitespace-nowrap shrink-0">{{ ev.evaluationRef }}</span>
                                            <p class="font-bold text-navy whitespace-nowrap">{{ ev.studentName }}</p>
                                        </div>
                                        <p class="mt-0.5 text-caption text-muted whitespace-nowrap">{{ ev.studentId }} • {{ ev.department }}</p>
                                    </td>
                                    <td class="px-4 py-3 text-caption font-semibold text-ink">
                                        {{ ev.evaluationPeriod }}
                                    </td>
                                    <td class="px-4 py-3">
                                        <p class="font-semibold text-ink">{{ ev.supervisorName }}</p>
                                        <p class="text-caption text-muted">{{ ev.category }}</p>
                                    </td>
                                    <td class="px-4 py-3">
                                        <p class="text-xs font-bold text-navy">{{ getStepInfo(ev.status, ev.hasDraft).stepTitle }}</p>
                                        <p class="text-[11px] text-muted">{{ getStepInfo(ev.status, ev.hasDraft).subLabel }}</p>
                                    </td>
                                    <td class="px-4 py-3 whitespace-nowrap">
                                        <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap"
                                              :class="workflowStatusBadge(ev, 'SUPERVISOR').cls">
                                            <app-icon :name="workflowStatusBadge(ev, 'SUPERVISOR').icon" :size="12" />
                                            {{ workflowStatusBadge(ev, 'SUPERVISOR').label }}
                                        </span>
                                        <p class="mt-0.5 text-[11px] text-muted whitespace-nowrap">{{ workflowStatusBadge(ev, 'SUPERVISOR').detail }}</p>
                                    </td>
                                    <td class="px-4 py-3 text-caption">
                                        <template v-if="ev.status === 'FOR_SA_REVIEW' && ev.ackDueDate">
                                            <span class="font-semibold text-ink">{{ Format.date(ev.ackDueDate) }}</span>
                                            <span class="block text-[10px] text-muted">S.A. Ack Due</span>
                                        </template>
                                        <template v-else-if="campaign?.deadline">
                                            <span class="font-semibold text-ink">{{ Format.date(campaign.deadline) }}</span>
                                            <span class="block text-[10px] text-muted">Step 1 Deadline</span>
                                        </template>
                                        <span v-else class="text-muted">—</span>
                                    </td>
                                    <td class="px-4 py-3 text-right">
                                        <button type="button" @click="openDetails(ev)"
                                                class="btn btn-sm"
                                                :class="ev.canSupervisorEdit ? 'btn-primary' : 'btn-outline'">
                                            <app-icon :name="ev.canSupervisorEdit ? 'ClipboardEdit' : 'Eye'" :size="14" />
                                            {{ ev.status === 'RETURNED_FOR_REVISION'
                                                ? 'Revise & Resubmit'
                                                : (ev.canSupervisorEdit ? (ev.hasDraft ? 'Continue Draft' : 'Evaluate S.A.') : 'View Details') }}
                                        </button>
                                    </td>
                                </tr>
                            </tbody>
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
                </div>
            </template>
        </template>
    </div>
    `
};

// ============================================================================
// 3. STUDENT ASSISTANT EVALUATION MODULE (/sa/evaluations)
//    Layer A: Evaluation Overview Page -> Layer B/C: Evaluation Details Page
// ============================================================================
const SaEvaluationsPage = {
    components: { AppIcon, PageHeader, NcstEvaluationWizard, EvaluationProcessTracker },

    setup() {
        const loading = Vue.ref(true);
        const loadError = Vue.ref("");
        const semester = Vue.ref(null);
        const campaign = Vue.ref(null);
        const evaluation = Vue.ref(null);
        const savingQuickAck = Vue.ref(false);
        const savingQuickResponse = Vue.ref(false);
        const quickComments = Vue.ref("");

        // Layer A Filters
        const searchQuery = Vue.ref("");
        const periodFilter = Vue.ref("ALL");
        const deptFilter = Vue.ref("ALL");
        const statusFilter = Vue.ref("ALL");
        const showDetailsView = Vue.ref(false);

        const load = async () => {
            loading.value = true;
            loadError.value = "";
            const res = await Model.request("evaluations", "sa_my_evaluation");
            loading.value = false;
            if (!res.success) {
                loadError.value = res.message || "Could not load your semester performance evaluation.";
                return;
            }
            semester.value = res.semester;
            campaign.value = res.campaign;
            evaluation.value = res.evaluation;
            if (res.evaluation && typeof res.evaluation.saComments === "string") {
                quickComments.value = res.evaluation.saComments;
            }
        };

        Vue.onMounted(load);

        const evaluationList = Vue.computed(() => (evaluation.value ? [evaluation.value] : []));

        const overviewKpis = Vue.computed(() => {
            let inProgress = 0;
            let awaitingAction = 0;
            let completed = 0;
            for (const ev of evaluationList.value) {
                const b = workflowStatusBadge(ev, "SA");
                if (b.category === "COMPLETED") completed++;
                else if (b.category === "AWAITING_ACTION") awaitingAction++;
                else inProgress++;
            }
            return {
                total: evaluationList.value.length,
                inProgress,
                awaitingAction,
                completed
            };
        });

        const filteredEvaluations = Vue.computed(() => {
            const q = searchQuery.value.trim().toLowerCase();
            return evaluationList.value.filter(ev => {
                if (periodFilter.value !== "ALL" && ev.evaluationPeriod !== periodFilter.value) return false;
                if (deptFilter.value !== "ALL" && ev.department !== deptFilter.value) return false;
                if (statusFilter.value !== "ALL") {
                    const badge = workflowStatusBadge(ev, "SA");
                    if (statusFilter.value !== badge.category) return false;
                }
                if (!q) return true;
                return (ev.studentName || "").toLowerCase().includes(q) ||
                       (ev.evaluationRef || "").toLowerCase().includes(q) ||
                       (ev.supervisorName || "").toLowerCase().includes(q);
            });
        });

        const openDetails = (ev, scrollToTarget = null) => {
            if (!ev.supervisorDone) {
                Toast.info("Your Immediate Supervisor is still completing Step 1. You will be notified as soon as it is released for your Step 3 review.");
                return;
            }
            showDetailsView.value = true;
            if (scrollToTarget) {
                Vue.nextTick(() => {
                    setTimeout(() => {
                        const targetEl = document.getElementById(scrollToTarget);
                        if (targetEl) targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
                    }, 80);
                });
            }
        };

        // Generate electronic signature image for Step 3 receipt acknowledgment
        const buildElectronicSignatureDataUrl = (studentName) => {
            const today = new Date().toISOString().split("T")[0];
            const canvas = document.createElement("canvas");
            canvas.width = 400;
            canvas.height = 110;
            const ctx = canvas.getContext("2d");
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = "#0F2C59";
            ctx.font = "italic bold 22px Georgia, serif";
            ctx.textAlign = "center";
            ctx.fillText(studentName || "Student Assistant", canvas.width / 2, 54);
            ctx.font = "bold 10px sans-serif";
            ctx.fillStyle = "#475569";
            ctx.fillText(`Electronically Acknowledged • ${today}`, canvas.width / 2, 82);
            return canvas.toDataURL("image/png");
        };

        const submitOverviewSaResponse = async () => {
            if (!evaluation.value || savingQuickResponse.value || savingQuickAck.value) return;
            const trimmed = (quickComments.value || "").trim();
            if (!trimmed) {
                Toast.info("Please enter your optional response or comments in the text box first.");
                return;
            }
            savingQuickResponse.value = true;
            try {
                const res = await Model.request("evaluations", "sa_save_response", {
                    saProfileId: evaluation.value.saProfileId,
                    saComments: sanitizeEvalText(trimmed)
                });
                if (!res || !res.success) {
                    if (res && res.evaluation) {
                        evaluation.value = res.evaluation;
                    } else {
                        await load();
                    }
                    Toast.error((res && res.message) || "Could not submit your response.");
                    return;
                }
                if (res.evaluation) {
                    evaluation.value = res.evaluation;
                }
                await load();
                if (res.alreadyAcknowledged) {
                    Toast.info(res.message || "Your evaluation has already been acknowledged and is currently awaiting Coordinator review (Step 4).");
                } else {
                    Toast.success(res.message || "Your response has been saved!");
                }
            } catch (err) {
                await load();
                Toast.error("Unable to verify response status due to a connection interruption. Please check the refreshed page.");
            } finally {
                savingQuickResponse.value = false;
            }
        };

        const submitOverviewSaAcknowledge = async () => {
            if (!evaluation.value || savingQuickAck.value || savingQuickResponse.value) return;
            const ok = await Alerts.confirm({
                title: "Acknowledge Evaluation (Step 3)?",
                text: "Your acknowledgment confirms that you have received and reviewed your performance evaluation criteria (1–10) and supervisor assessment. Upon confirmation, your electronic signature and acknowledgment will be recorded, and the evaluation will advance to Step 4 (Coordinator Review).",
                confirmText: "Yes, Acknowledge Evaluation",
                cancelText: "Cancel",
                requireReason: false
            });
            if (!ok || savingQuickAck.value) return;

            savingQuickAck.value = true;
            try {
                const today = new Date().toISOString().split("T")[0];
                const sigDataUrl = evaluation.value.studentSignature || buildElectronicSignatureDataUrl(evaluation.value.studentName);
                const res = await Model.request("evaluations", "sa_acknowledge", {
                    saProfileId: evaluation.value.saProfileId,
                    studentSignature: sigDataUrl,
                    studentRole: "Student Assistant",
                    studentSignDate: today,
                    saComments: sanitizeEvalText(quickComments.value),
                    saHasDispute: 0,
                    saConcernText: ""
                });
                if (!res || !res.success) {
                    if (res && res.evaluation) {
                        evaluation.value = res.evaluation;
                    } else {
                        await load();
                    }
                    if (evaluation.value && String(evaluation.value.acknowledgmentStatus || "").toUpperCase() === "SIGNED") {
                        await Alerts.success("Successfully Acknowledged!", "Evaluation acknowledged successfully. It is now awaiting Coordinator review.");
                        return;
                    }
                    Toast.error((res && res.message) || "Could not submit your acknowledgment.");
                    return;
                }
                if (res.evaluation) {
                    evaluation.value = res.evaluation;
                }
                await load();
                if (res.alreadyAcknowledged) {
                    await Alerts.success("Evaluation Acknowledged", res.message || "Evaluation acknowledged successfully. It is now awaiting Coordinator review.");
                } else {
                    await Alerts.success("Successfully Acknowledged!", res.message || "Evaluation acknowledged successfully. It is now awaiting Coordinator review.");
                }
            } catch (err) {
                await load();
                if (evaluation.value && String(evaluation.value.acknowledgmentStatus || "").toUpperCase() === "SIGNED") {
                    await Alerts.success("Successfully Acknowledged!", "Evaluation acknowledged successfully. It is now awaiting Coordinator review.");
                } else {
                    Toast.error("Connection interrupted while acknowledging. Please verify your evaluation status.");
                }
            } finally {
                savingQuickAck.value = false;
            }
        };

        const onSaved = async (res) => {
            if (res && res.evaluation) {
                evaluation.value = res.evaluation;
            }
            await load();
            if (!res || res.returnToList !== false) {
                showDetailsView.value = false;
            }
        };

        return {
            loading, loadError, semester, campaign, evaluation, evaluationList, overviewKpis, filteredEvaluations,
            searchQuery, periodFilter, deptFilter, statusFilter, showDetailsView,
            quickComments, savingQuickAck, savingQuickResponse, submitOverviewSaResponse, submitOverviewSaAcknowledge,
            openDetails, onSaved, load, Format, getStepInfo, workflowStatusBadge, evalStatusMeta, ackStatusMeta, decisionMeta
        };
    },

    template: `
    <div class="space-y-6">
        <!-- LAYER B & C: Evaluation Details Page -->
        <ncst-evaluation-wizard
            v-if="showDetailsView && evaluation && evaluation.supervisorDone"
            :initial-data="evaluation"
            mode="SA"
            :read-only="evaluation.status === 'FINALIZED'"
            @close="showDetailsView = false"
            @saved="onSaved" />

        <!-- LAYER A: Evaluation Overview Page -->
        <template v-else>
            <page-header
                title="S.A. Performance Evaluation"
                subtitle="Track your semester performance evaluation across all five workflow steps, acknowledge receipt within 5 school days, and view your finalized evaluation result."
                :breadcrumbs="[
                    { label: 'Dashboard', to: '/sa/dashboard' },
                    { label: 'S.A. Performance Evaluation' }
                ]" />

            <div v-if="loading" class="card p-12 text-center text-muted">
                <app-icon name="LoaderCircle" :size="32" class="mx-auto mb-3 animate-spin text-navy" />
                <p class="font-medium text-ink">Loading your semester performance evaluation…</p>
            </div>

            <div v-else-if="loadError" class="card border-danger/30 bg-danger/5 p-6 text-danger">
                <div class="flex items-center gap-3">
                    <app-icon name="CircleAlert" :size="20" class="shrink-0" />
                    <p class="font-medium">{{ loadError }}</p>
                </div>
            </div>

            <template v-else-if="evaluation">
                <!-- 4 Compact Summary Cards: Total Evaluations, In Progress, Awaiting Action, Completed -->
                <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div class="card p-4">
                        <p class="text-caption font-bold uppercase text-muted">Total Evaluations</p>
                        <p class="mt-1 text-[26px] font-extrabold text-navy">{{ overviewKpis.total }}</p>
                        <p class="mt-0.5 text-caption text-muted">{{ evaluation.evaluationPeriod }}</p>
                    </div>
                    <div class="card p-4">
                        <p class="text-caption font-bold uppercase text-muted">In Progress</p>
                        <p class="mt-1 text-[26px] font-extrabold text-blue-600">{{ overviewKpis.inProgress }}</p>
                        <p class="mt-0.5 text-caption text-muted">Supervisor or Coordinator stage</p>
                    </div>
                    <div class="card p-4">
                        <p class="text-caption font-bold uppercase text-muted">Awaiting Action</p>
                        <p class="mt-1 text-[26px] font-extrabold text-amber-600">{{ overviewKpis.awaitingAction }}</p>
                        <p class="mt-0.5 text-caption text-muted">Needs your Step 3 acknowledgment</p>
                    </div>
                    <div class="card p-4">
                        <p class="text-caption font-bold uppercase text-muted">Completed</p>
                        <p class="mt-1 text-[26px] font-extrabold text-emerald-600">{{ overviewKpis.completed }}</p>
                        <p class="mt-0.5 text-caption text-muted">Step 5 finalized evaluation</p>
                    </div>
                </div>

                <!-- Five-Step Workflow Progress Tracker -->
                <evaluation-process-tracker :active-stage="getStepInfo(evaluation.status, evaluation.hasDraft).step" :tracker="evaluation.tracker" />

                <!-- ==================================================================== -->
                <!-- AUTHORIZED ACTION PANEL FOR STUDENT ASSISTANT (STEP 3 REVIEW)        -->
                <!-- Only visible when Step 3 Acknowledgment is actively required         -->
                <!-- ==================================================================== -->
                <div v-if="evaluation.status === 'FOR_SA_REVIEW' && !evaluation.saAcknowledged" class="card border-2 border-[#0F2C59] bg-white p-5 shadow-md">
                    <div class="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="rounded bg-[#0F2C59] px-2.5 py-1 text-[11px] font-black uppercase text-[#D4AF37]">
                                Authorized Action Panel
                            </span>
                            <h3 class="text-base font-extrabold text-[#0F2C59]">
                                Student Assistant Actions (Step 3: Review &amp; Acknowledgment)
                            </h3>
                        </div>
                        <span class="text-xs font-semibold text-muted">
                            Role: Student Assistant
                        </span>
                    </div>

                    <div class="space-y-4">
                        <div class="rounded-xl border border-blue-200 bg-blue-50/70 p-4 text-xs text-blue-950 space-y-1.5">
                            <p class="text-sm font-bold text-[#0F2C59]">
                                Your Immediate Supervisor has submitted your performance evaluation. Please review the criteria ratings (1–10) and supervisor assessment. You may acknowledge that you have reviewed the evaluation and optionally provide your response or comments before it is forwarded to the Coordinator for final review.
                            </p>
                            <p class="text-[11px] text-blue-900">
                                <strong>Note:</strong> Your electronic signature confirms receipt and review of this evaluation.
                            </p>
                        </div>

                        <div>
                            <label class="mb-1 block text-xs font-bold uppercase tracking-wider text-slate-700">
                                Optional Response / Comments
                            </label>
                            <textarea v-model="quickComments" rows="2"
                                      placeholder="Optionally enter your response, reflection, or comments regarding your performance evaluation..."
                                      class="w-full rounded-xl border border-slate-300 bg-white p-3 text-xs focus:border-[#0F2C59] focus:outline-none"></textarea>
                        </div>

                        <div class="flex flex-wrap items-center justify-between gap-2.5 border-t border-line pt-3">
                            <button type="button" @click="openDetails(evaluation, 'eval-criteria-card')" class="btn btn-outline">
                                <app-icon name="Eye" :size="15" />
                                View Evaluation
                            </button>
                            <div class="flex flex-wrap items-center gap-2.5">
                                <button type="button" @click="submitOverviewSaResponse" :disabled="savingQuickResponse || savingQuickAck"
                                        class="btn btn-outline border-navy text-navy">
                                    <app-icon name="MessageSquarePlus" :size="15" />
                                    {{ savingQuickResponse ? 'Submitting Response...' : 'Submit Response' }}
                                </button>
                                <button type="button" @click="submitOverviewSaAcknowledge" :disabled="savingQuickAck || savingQuickResponse"
                                        class="btn btn-primary">
                                    <app-icon name="CheckCircle2" :size="15" />
                                    {{ savingQuickAck ? 'Acknowledging...' : 'Acknowledge Evaluation' }}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Clean 7-Column Evaluation Overview Table -->
                <div class="card overflow-hidden">
                    <div class="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
                        <div class="relative flex-1 max-w-md">
                            <app-icon name="Search" :size="16" class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                            <input v-model="searchQuery" type="text"
                                   placeholder="Search by Student Assistant name or evaluation reference…"
                                   class="w-full rounded-lg border border-line bg-page py-2 pl-9 pr-3.5 text-body focus:border-navy focus:outline-none" />
                        </div>
                        <div class="flex flex-wrap items-center gap-2">
                            <select v-model="periodFilter" class="rounded-lg border border-line bg-page px-3 py-2 text-body focus:border-navy focus:outline-none">
                                <option value="ALL">All Review Periods</option>
                                <option :value="evaluation.evaluationPeriod">{{ evaluation.evaluationPeriod }}</option>
                            </select>
                            <select v-model="deptFilter" class="rounded-lg border border-line bg-page px-3 py-2 text-body focus:border-navy focus:outline-none">
                                <option value="ALL">All Assignments</option>
                                <option :value="evaluation.department">{{ evaluation.department }}</option>
                            </select>
                            <select v-model="statusFilter" class="rounded-lg border border-line bg-page px-3 py-2 text-body focus:border-navy focus:outline-none">
                                <option value="ALL">All Workflow Statuses</option>
                                <option value="AWAITING_ACTION">Awaiting Action</option>
                                <option value="IN_PROGRESS">In Progress</option>
                                <option value="COMPLETED">Completed</option>
                            </select>
                        </div>
                    </div>

                    <div class="overflow-x-auto">
                        <table class="w-full text-left text-body">
                            <thead class="bg-mist/70 text-caption font-bold uppercase text-muted">
                                <tr>
                                    <th class="px-4 py-3 whitespace-nowrap">Student Assistant</th>
                                    <th class="px-4 py-3 whitespace-nowrap">Evaluation Period</th>
                                    <th class="px-4 py-3 whitespace-nowrap">Supervisor</th>
                                    <th class="px-4 py-3 whitespace-nowrap">Current Step</th>
                                    <th class="px-4 py-3 whitespace-nowrap">Status</th>
                                    <th class="px-4 py-3 whitespace-nowrap">Deadline</th>
                                    <th class="px-4 py-3 text-right whitespace-nowrap">Action</th>
                                 </tr>
                            </thead>
                            <tbody class="divide-y divide-line">
                                <tr v-for="ev in filteredEvaluations" :key="ev.saProfileId" class="hover:bg-mist/30">
                                    <td class="px-4 py-3 whitespace-nowrap">
                                        <div class="flex items-center gap-2">
                                            <span class="rounded bg-navy/10 px-1.5 py-0.5 font-mono text-[11px] font-bold text-navy whitespace-nowrap shrink-0">{{ ev.evaluationRef }}</span>
                                            <p class="font-bold text-navy whitespace-nowrap">{{ ev.studentName }}</p>
                                        </div>
                                        <p class="mt-0.5 text-caption text-muted whitespace-nowrap">{{ ev.studentId }} • {{ ev.department }}</p>
                                    </td>
                                    <td class="px-4 py-3 text-caption font-semibold text-ink">
                                        {{ ev.evaluationPeriod }}
                                    </td>
                                    <td class="px-4 py-3">
                                        <p class="font-semibold text-ink">{{ ev.supervisorName }}</p>
                                        <p class="text-caption text-muted">{{ ev.category }}</p>
                                    </td>
                                    <td class="px-4 py-3">
                                        <p class="text-xs font-bold text-navy">{{ getStepInfo(ev.status, ev.hasDraft).stepTitle }}</p>
                                        <p class="text-[11px] text-muted">{{ getStepInfo(ev.status, ev.hasDraft).subLabel }}</p>
                                    </td>
                                    <td class="px-4 py-3 whitespace-nowrap">
                                        <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold whitespace-nowrap"
                                              :class="workflowStatusBadge(ev, 'SA').cls">
                                            <app-icon :name="workflowStatusBadge(ev, 'SA').icon" :size="12" />
                                            {{ workflowStatusBadge(ev, 'SA').label }}
                                        </span>
                                        <p class="mt-0.5 text-[11px] text-muted whitespace-nowrap">{{ workflowStatusBadge(ev, 'SA').detail }}</p>
                                    </td>
                                    <td class="px-4 py-3 text-caption">
                                        <template v-if="ev.ackDueDate && !ev.saAcknowledged">
                                            <span :class="ev.isAckOverdue ? 'font-bold text-rose-600' : 'font-semibold text-ink'">
                                                {{ Format.date(ev.ackDueDate) }}
                                            </span>
                                            <span class="block text-[10px] text-muted">5-School-Day Window</span>
                                        </template>
                                        <template v-else-if="ev.status === 'FINALIZED' && ev.effectiveDate">
                                            <span class="font-semibold text-emerald-700">{{ Format.date(ev.effectiveDate) }}</span>
                                            <span class="block text-[10px] text-muted">Effective Date</span>
                                        </template>
                                        <span v-else class="text-muted">—</span>
                                    </td>
                                    <td class="px-4 py-3 text-right">
                                        <button v-if="ev.supervisorDone" type="button" @click="openDetails(ev)"
                                                class="btn btn-sm"
                                                :class="ev.status === 'FOR_SA_REVIEW' && !ev.saAcknowledged ? 'btn-primary' : 'btn-outline'">
                                            <app-icon :name="ev.status === 'FOR_SA_REVIEW' && !ev.saAcknowledged ? 'PenTool' : 'Eye'" :size="14" />
                                            {{ ev.status === 'FOR_SA_REVIEW' && !ev.saAcknowledged ? 'View & Acknowledge' : 'View Evaluation' }}
                                        </button>
                                        <span v-else class="text-caption font-medium text-muted">Awaiting Step 1</span>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </template>
        </template>
    </div>
    `
};
