// Sidebar menus for each role (INTEG_ASSISTPAY.pdf: "Final User Roles",
// "Admin Scheduling Sidebar", "Supervisor View", "Student Assistant View").
//
// `step`    = the build step in which the page is implemented.
// `planned` = what the page will contain (shown on placeholder pages until built).
//
// Hiding a menu item is NOT security: from Step 3, every PHP endpoint checks the
// role and data scope of the logged-in user on its own.

const LATER = "Later phase";

const NAVIGATION = {
    registrar: {
        home: "/registrar/dashboard",
        title: "SMALL STUDENT INFO DATABASE",
        items: [
            { path: "/registrar/dashboard", label: "Dashboard", icon: "LayoutDashboard", step: 11, subtitle: "Overview", planned: [] },
            {
                label: "STUDENTS", icon: "Users", group: "students",
                children: [
                    { path: "/registrar/students/records", label: "Student Records", icon: "Users", step: 11, subtitle: "Manage student information.", planned: [] }
                ]
            },
            {
                label: "ACADEMIC DATA", icon: "GraduationCap", group: "academic",
                children: [
                    { path: "/registrar/academic/semester-setup", label: "Semester Setup", icon: "CalendarCog", step: 11, subtitle: "Manage academic semesters.", planned: [] },
                    { path: "/registrar/academic/curriculum", label: "Curriculum", icon: "BookOpen", step: 11, subtitle: "Manage degree programs.", planned: [] },
                    { path: "/registrar/academic/enrollment", label: "Enrollment", icon: "FileSignature", step: 11, subtitle: "Student enrollments.", planned: [] },
                    { path: "/registrar/academic/grades", label: "Grades", icon: "Award", step: 11, subtitle: "Student grades.", planned: [] }
                ]
            },
            {
                label: "DOCUMENTS", icon: "Files", group: "documents",
                children: [
                    { path: "/registrar/documents/academic", label: "Academic Docs", icon: "FileText", step: 11, subtitle: "Curriculum documents.", planned: [] },
                    { path: "/registrar/documents/pending", label: "Pending Review", icon: "Clock", step: 11, subtitle: "Registration forms.", planned: [], badge: "1" }
                ]
            },
            {
                label: "SYSTEM", icon: "Settings", group: "system",
                children: [
                    { path: "/registrar/system/audit-logs", label: "Audit Logs", icon: "ScrollText", step: 11, subtitle: "System activity.", planned: [] },
                    { path: "/registrar/system/settings", label: "Settings", icon: "Settings", step: 11, subtitle: "Configuration.", planned: [] }
                ]
            }
        ]
    },

    admin: {
        home: "/admin/dashboard",
        items: [
            { path: "/admin/dashboard", label: "Dashboard", icon: "LayoutDashboard", step: 9,
              subtitle: "Welcome back, Coordinator.",
              planned: ["Current semester and status", "Total active, assigned and unassigned S.A.s",
                        "Semester scheduling progress bars", "Attention required: coverage gaps, conflicts, vacancies",
                        "Recent scheduling activity"] },
            { path: "/admin/sa-management", label: "S.A. Management", icon: "Users", step: 4,
              subtitle: "Manage Student Assistant records and assignment information.",
              planned: ["Register S.A. (creates the login account automatically)", "Search and filter by status",
                        "Personal, academic and class schedule information", "Assignment, supervisor and account status",
                        "Benefits and allowance rate history"] },
            { path: "/admin/supervisor-management", label: "Supervisor Management", icon: "UserCheck", step: 4,
              subtitle: "Manage Supervisor records categorized by ITO, ACADS, and OFFICES departments.",
              planned: [] },
            {
                label: "Scheduling", icon: "CalendarDays", group: "scheduling",
                children: [
                    { path: "/admin/scheduling/semester-setup", label: "Semester", icon: "CalendarCog", step: 5,
                      subtitle: "View the active semester that all scheduling records belong to.",
                      planned: ["Current semester card", "Create Semester form", "Only one ACTIVE semester at a time"] },
                    { path: "/admin/scheduling/room-lab", label: "Room/Lab Schedules", icon: "DoorOpen", step: 5,
                      subtitle: "Period-specific duty requirements for ACADS and ITO.",
                      planned: ["Upload room schedule", "Required vs. assigned S.A. per period", "Coverage status badges"] },
                    { path: "/admin/scheduling/class-schedules", label: "Class Schedule", icon: "FileSpreadsheet", step: 5,
                      subtitle: "Import official class schedules used to detect class conflicts.",
                      planned: ["Upload CSV / Excel", "Download template", "Import preview: valid, warnings, errors",
                                "Searchable schedule table"] },
                    { path: "/admin/scheduling/office-staffing", label: "Office Staffing", icon: "Building2", step: 5,
                      subtitle: "Define how many S.A.s each office needs this semester.",
                      planned: ["Add office requirement (entered by the Coordinator, never assumed)",
                                "Required, assigned and vacant slots", "Operating hours and weekly target hours"] },
                    { path: "/admin/scheduling/matching", label: "Schedule Matching", icon: "Shuffle", step: 7,
                      subtitle: "Match the matching pool against all requirements in one semester batch.",
                      planned: ["Pre-run summary", "Checks: class conflicts, double booking, eligibility, office hours, duty load",
                                "Projected weekly hours (35 hrs is a target, not a blocker)", "Matching results"] },
                    { path: "/admin/scheduling/recommendations", label: "Recommendations", icon: "Sparkles", step: 8,
                      subtitle: "The system recommends. The Coordinator decides.",
                      planned: ["Ranked candidates per requirement", "Candidate matching details",
                                "Choose Another with a required reason (audit logged)"] },
                    { path: "/admin/scheduling/finalized", label: "Finalize Schedule", icon: "CalendarCheck", step: 9,
                      subtitle: "The official recurring weekly schedule for the semester.",
                      planned: ["Draft → Review → Finalized → Published", "Weekly calendar by ACADS / ITO / OFFICE",
                                "Publish confirmation", "Controlled schedule changes after publishing", "Print and export"] },
                    { path: "/admin/scheduling/final-schedule", label: "Schedule Adjustment", icon: "CalendarCog", step: 9,
                      subtitle: "Edit individual S.A. duty schedules and notify only the affected S.A. and Supervisor.",
                      planned: ["Per-S.A. duty schedule editing", "Targeted notification only to edited S.A. and Supervisor", "Schedule change history"] }
                ]
            },
            { path: "/admin/attendance", label: "Attendance", icon: "ClipboardCheck", step: 10,
              subtitle: "Reconcile actual duty against the published schedule.",
              planned: ["Uses the published schedule as expected duty", "Reconciliation and credited hours"] },
            { path: "/admin/perfect-attendance", label: "Perfect Attendance", icon: "Trophy", step: 10,
              subtitle: "Monthly recognition for qualified Student Assistants.",
              planned: ["Monthly attendance verification", "Qualified S.A. roster", "Audit trail & recognition"] },
            { path: "/admin/requests", label: "Requests", icon: "Inbox", step: 10,
              subtitle: "Verify and record Supervisor-approved Excuse Slips, Overtime Forms, and Undertime Forms.",
              planned: ["Requests checked against the published schedule", "Supervisor review, then Coordinator decision"] },
            { path: "/admin/allowance", label: "Allowance", icon: "Wallet", step: 10,
              subtitle: "Compute and manage S.A. hourly rates and allowance.",
              planned: ["Hourly rates per Student Assistant", "Weekly and monthly allowance computation", "Allowance Endorsement & Billing Report"] },
            { path: "/admin/school-balance", label: "School Balance", icon: "Landmark", step: 10,
              subtitle: "Track S.A. school balances and manage semester allowance deduction announcements (Yes/No).",
              planned: ["Computed from Registrar COR", "Broadcast Yes/No allowance deduction announcement"] },
            { path: "/admin/evaluations", label: "S.A. Performance Evaluation", icon: "ClipboardList", step: 10,
              subtitle: "Send semester performance evaluations to Supervisors and track S.A. retention recommendations.",
              planned: ["5-Step NCST Evaluation Wizard", "Send to Supervisors per semester", "Track Recommended / Not Recommended"] },
            { path: "/admin/reports", label: "Reports & Analytics", icon: "ChartColumn", step: 10,
              subtitle: "Attendance, allowance, school balance, roster, duty coverage, and audit reports.",
              planned: ["Attendance & Credited Hours", "Allowance & Payroll Endorsements", "School Balance Deductions", "S.A. Master Roster", "Schedule Coverage & Gaps", "Exceptions & Audit Log"] },
            { path: "/admin/audit-logs", label: "Audit Logs", icon: "ScrollText", step: 3,
              subtitle: "Who did what, and when.",
              planned: ["Login success/failure, lockouts, logouts", "Assignment overrides with reasons", "Schedule changes"] },
            { path: "/admin/settings", label: "Settings", icon: "Settings", step: 3,
              subtitle: "Account and system settings.", planned: ["Change password", "Security settings"] }
        ]
    },

    supervisor: {
        home: "/supervisor/dashboard",
        items: [
            { path: "/supervisor/dashboard", label: "Dashboard", icon: "LayoutDashboard", step: 10,
              subtitle: "Your team at a glance.",
              planned: ["My S.A.s", "Today's duty", "Attendance to review", "Pending requests"] },
            { path: "/supervisor/team", label: "My S.A. Team", icon: "UsersRound", step: 10,
              subtitle: "Only the S.A.s assigned to your office or department.",
              planned: ["S.A., course, assignment and today's schedule", "View S.A. and view schedule"] },
            { path: "/supervisor/evaluations", label: "S.A. Performance Evaluation", icon: "ClipboardList", step: 10,
              subtitle: "Evaluate the Student Assistants assigned to your department or office.",
              planned: ["5-Step NCST Evaluation Form", "Ratings 1-10, Assessment, Signatures"] },
            { path: "/supervisor/attendance-review", label: "S.A. Attendance Review", icon: "ClipboardCheck", step: 10,
              subtitle: "Monitor, verify punches, and review attendance records of your assigned S.A. team.",
              planned: ["Today's punches and scheduled shifts", "Face and GPS geofence verification", "Attendance approval, rejection, and correction review"] },
            { path: "/supervisor/requests", label: "Review Requests", icon: "Inbox", step: 10,
              subtitle: "Review requests from your team before the Coordinator decides.", planned: [] },
            { path: "/supervisor/audit-logs", label: "Audit Logs", icon: "ScrollText", step: 3,
              subtitle: "Your account activity and actions.", planned: [] },
            { path: "/supervisor/settings", label: "Settings", icon: "Settings", step: 3,
              subtitle: "Account settings.", planned: ["Change password"] }
        ]
    },

    sa: {
        home: "/sa/dashboard",
        items: [
            { path: "/sa/attendance-capture", label: "Attendance Capture", icon: "ScanFace", step: 10,
              subtitle: "Record your time in and time out with Face Recognition.", planned: [] },
            { path: "/sa/dashboard", label: "Dashboard", icon: "LayoutDashboard", step: 10,
              subtitle: "Your duty for today.",
              planned: ["Today's schedule and duty location", "Supervisor", "Weekly duty hours", "Allowance summary"] },
            { path: "/sa/schedule", label: "My Schedule", icon: "CalendarDays", step: 10,
              subtitle: "Your published weekly duty schedule.",
              planned: ["Weekly recurring schedule", "Request schedule change"] },
            { path: "/sa/requests", label: "My Requests", icon: "Inbox", step: 10, subtitle: "Submit and track your Excuse Slips, Overtime Forms, and Undertime Forms.", planned: [] },
            { path: "/sa/allowance", label: "My Allowance", icon: "Wallet", step: 10, subtitle: "Your allowance by period.", planned: [] },
            { path: "/sa/history", label: "My History", icon: "History", step: 10, subtitle: "Review your previous attendance, allowance, schedules, requests, and official records.", planned: [] },
            { path: "/sa/evaluations", label: "My Evaluation", icon: "ClipboardList", step: 10, subtitle: "Review your semester performance evaluation, sign acknowledgment, and view your finalized result.", planned: [] },
            { path: "/sa/school-balance", label: "My School Balance", icon: "Landmark", step: 10, subtitle: "Your remaining school balance and Yes/No allowance deduction decision.", planned: [] },
            { path: "/sa/audit-logs", label: "Audit Logs", icon: "ScrollText", step: 3, subtitle: "Your account activity and actions.", planned: [] },
            { path: "/sa/profile", label: "My Profile", icon: "CircleUser", step: 4,
              subtitle: "Your personal and academic information.", planned: ["Profile details", "Change password"] }
        ]
    }
};

// Flat list of every page (used by the router)
function flattenNavigation() {
    const pages = [];
    for (const [role, nav] of Object.entries(NAVIGATION)) {
        for (const item of nav.items) {
            for (const page of item.children || [item]) {
                pages.push({ ...page, role, section: item.children ? item.label : null });
            }
        }
    }
    return pages;
}
