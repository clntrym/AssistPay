// <status-badge group="assignmentStatus" :value="sa.assignmentStatus" />
// Every badge pairs an icon with text, so status never relies on color alone.
const STATUS_STYLES = {
    ASSIGNED: ["bg-success/10 text-success", "CircleCheck"],
    ACTIVE: ["bg-success/10 text-success", "CircleCheck"],
    UNASSIGNED: ["bg-warning/10 text-warning", "CircleDashed"],
    FOR_REASSIGNMENT: ["bg-info/10 text-info", "RefreshCw"],
    PENDING_ACTIVATION: ["bg-gold/20 text-navy", "Clock"],
    INACTIVE: ["bg-slate-100 text-muted", "CircleSlash"],
    LOCKED: ["bg-danger/10 text-danger", "Lock"],
    SUSPENDED: ["bg-danger/10 text-danger", "Ban"],
    GOOD_STANDING: ["bg-success/10 text-success", "ShieldCheck"],
    FIRST_WARNING: ["bg-warning/10 text-warning", "TriangleAlert"],
    SECOND_WARNING: ["bg-warning/20 text-warning", "TriangleAlert"],
    THIRD_WARNING: ["bg-danger/10 text-danger", "OctagonAlert"],
    UNDER_AGREEMENT: ["bg-danger/10 text-danger", "FileWarning"],
    DRAFT: ["bg-slate-100 text-muted", "FileEdit"],
    PENDING_REVIEW: ["bg-warning/10 text-warning", "Clock"],
    PENDING_APPROVAL: ["bg-warning/10 text-warning", "Clock"],
    PENDING_SIGNATURE: ["bg-info/10 text-info", "PenTool"],
    APPROVED: ["bg-info/10 text-info", "Check"],
    ISSUED: ["bg-navy/10 text-navy", "Send"],
    ACKNOWLEDGED: ["bg-success/10 text-success", "CircleCheck"],
    SIGNED: ["bg-navy/10 text-navy", "FileCheck"],
    COMPLETED: ["bg-success/10 text-success", "CircleCheck"],
    RECALLED: ["bg-slate-100 text-muted", "Undo2"],
    SUPERSEDED: ["bg-slate-100 text-muted", "Archive"],
    REVOKED: ["bg-slate-100 text-muted", "XCircle"],
    VALID: ["bg-danger/10 text-danger", "AlertCircle"],
    CORRECTED: ["bg-info/10 text-info", "CheckCircle2"],
    VOIDED: ["bg-slate-100 text-muted", "Slash"],
    PENDING_SUPERVISOR_REVIEW: ["bg-warning/10 text-warning", "Clock"],
    RETURNED_TO_SA: ["bg-warning/20 text-warning", "RotateCcw"],
    PENDING_COORDINATOR_RECORDING: ["bg-info/10 text-info", "UserCheck"],
    RETURNED_FOR_CLARIFICATION: ["bg-warning/20 text-warning", "HelpCircle"],
    REJECTED_BY_SUPERVISOR: ["bg-danger/10 text-danger", "XCircle"],
    RECORDED: ["bg-success/10 text-success", "CheckCircle2"],
    CANCELLED: ["bg-slate-100 text-muted", "XCircle"]
};

const StatusBadge = {
    components: { AppIcon },
    props: { group: { type: String, required: true }, value: String },
    setup(props) {
        const style = Vue.computed(() => STATUS_STYLES[props.value] || ["bg-mist text-navy", "Circle"]);
        const text = Vue.computed(() => label(props.group, props.value));
        return { style, text };
    },
    template: `
    <span class="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-semibold" :class="style[0]">
        <app-icon :name="style[1]" :size="12" :stroke-width="2.5" /> {{ text }}
    </span>
    `
};
