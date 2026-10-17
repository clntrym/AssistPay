// Display labels and formatters shared by every page.
const LABELS = {
    saCategory: { ACADS: "ACADS", ITO: "ITO", OFFICE: "Office", RELIEVER: "Reliever" },
    departmentType: { ACADS: "ACADS", ITO: "ITO", OFFICE: "Office" },
    saStatus: { ACTIVE: "Active", INACTIVE: "Inactive" },
    assignmentStatus: { ASSIGNED: "Assigned", UNASSIGNED: "Unassigned", FOR_REASSIGNMENT: "For reassignment", INACTIVE: "Inactive" },
    accountStatus: { ACTIVE: "Active", PENDING_ACTIVATION: "Pending activation", INACTIVE: "Inactive", LOCKED: "Locked", SUSPENDED: "Suspended" },
    academicStatus: { REGULAR: "Regular", IRREGULAR: "Irregular" },
    enrollmentStatus: { ENROLLED: "Enrolled", NOT_ENROLLED: "Not enrolled" },
    sex: { MALE: "Male", FEMALE: "Female" },
    yearLevel: { 1: "1st Year", 2: "2nd Year", 3: "3rd Year", 4: "4th Year", 5: "5th Year" },
    disciplinaryStatus: {
        GOOD_STANDING: "Good Standing",
        FIRST_WARNING: "1st Warning",
        SECOND_WARNING: "2nd Warning",
        UNDER_AGREEMENT: "Under Agreement"
    },
    warningLevel: {
        FIRST_WARNING: "First Warning",
        SECOND_WARNING: "Second Warning",
        THIRD_WARNING: "Third Warning"
    },
    violationCategory: {
        LATES: "Lates",
        EXCUSE_SLIP: "Excuse Slip",
        AWOL: "AWOL",
        NTI_NTO: "NTI/NTO",
        UNDERTIME: "Undertime"
    },
    memoStatus: {
        DRAFT: "Draft",
        PENDING_REVIEW: "Pending Review",
        APPROVED: "Approved",
        ISSUED: "Issued",
        ACKNOWLEDGED: "Acknowledged",
        RECALLED: "Recalled",
        SUPERSEDED: "Superseded"
    },
    agreementStatus: {
        PENDING_APPROVAL: "Pending Approval",
        PENDING_SIGNATURE: "Pending Signature",
        SIGNED: "Signed",
        COMPLETED: "Completed",
        REVOKED: "Revoked"
    },
    incidentStatus: {
        VALID: "Valid",
        CORRECTED: "Corrected",
        VOIDED: "Voided"
    },
    requestType: {
        EXCUSE_SLIP: "Excuse Slip",
        OVERTIME: "Overtime (OT) Form",
        UNDERTIME: "Undertime Form",
        CORRECTION: "Attendance Correction"
    },
    requestStatus: {
        DRAFT: "Draft",
        PENDING_SUPERVISOR_REVIEW: "Pending Supervisor Review",
        RETURNED_TO_SA: "Returned to S.A.",
        PENDING_COORDINATOR_RECORDING: "Pending Coordinator Recording",
        RETURNED_FOR_CLARIFICATION: "Returned for Clarification",
        REJECTED_BY_SUPERVISOR: "Rejected by Supervisor",
        RECORDED: "Recorded"
    }
};

const label = (group, value) => (value == null || value === "") ? "—" : (LABELS[group]?.[value] ?? value);

const Format = {
    peso(n) {
        if (n == null) return "—";
        return "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },
    date(iso) {
        if (!iso) return "—";
        if (iso instanceof Date) {
            return isNaN(iso.getTime()) ? "—" : iso.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
        }
        const s = String(iso);
        const d = new Date(s.length === 10 ? s + "T00:00:00" : s.replace(" ", "T"));
        return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    },
    dateTime(iso) {
        if (!iso) return "—";
        const d = new Date(iso.replace(" ", "T"));
        return d.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
    },
    number(n, decimals = 0) {
        if (n == null || isNaN(Number(n))) return "0";
        return Number(n).toLocaleString("en-PH", {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    },
    month(ym) {
        if (!ym) return "—";
        if (/^\d{4}$/.test(String(ym))) return String(ym);
        return new Date(ym + "-01T00:00:00").toLocaleDateString("en-US", { month: "long", year: "numeric" });
    },
    text: v => (v == null || v === "") ? "—" : v
};
