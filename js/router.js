// Routes are generated from js/navigation.js.
// Finished pages are mapped here; everything else shows the "not built yet" placeholder.
const PAGE_COMPONENTS = {
    "/admin/dashboard": AdminDashboardPage,
    "/admin/sa-management": SaListPage,
    "/admin/supervisor-management": SupervisorManagementPage,
    "/admin/scheduling/semester-setup": SemesterSetupPage,
    "/admin/scheduling/class-schedules": ClassSchedulesPage,
    "/admin/scheduling/room-lab": RoomLabPage,
    "/admin/scheduling/office-staffing": OfficeStaffingPage,
    "/admin/scheduling/matching": ScheduleMatchingPage,
    "/admin/scheduling/recommendations": DutyGridPage,
    "/admin/scheduling/finalized": FinalizedSchedulePage,
    "/admin/scheduling/final-schedule": FinalSchedulePage,
    "/admin/attendance": AdminAttendancePage,
    "/admin/perfect-attendance": AdminPerfectAttendancePage,
    "/admin/allowance": AllowancePage,
    "/admin/requests": AdminRequestsPage,
    "/admin/school-balance": AdminSchoolBalancePage,
    "/admin/evaluations": AdminEvaluationsPage,
    "/admin/reports": AdminReportsPage,
    "/admin/audit-logs": RegistrarAuditLogsPage,
    "/admin/settings": AdminSettingsPage,
    "/registrar/dashboard": RegistrarDashboardPage,
    "/registrar/academic/semester-setup": SemesterSetupPage,
    "/registrar/academic/curriculum": RegistrarCurriculumPage,
    "/registrar/students/records": RegistrarStudentRecordsPage,
    "/registrar/academic/enrollment": RegistrarEnrollmentPage,
    "/registrar/academic/grades": RegistrarGradesPage,
    "/registrar/documents/academic": RegistrarAcademicDocsPage,
    "/registrar/documents/pending": RegistrarPendingReviewPage,
    "/registrar/system/audit-logs": RegistrarAuditLogsPage,
    "/registrar/system/settings": RegistrarSettingsPage,
    "/supervisor/dashboard": SupervisorDashboardPage,
    "/supervisor/team": SupervisorTeamPage,
    "/supervisor/attendance-review": SupervisorAttendanceReviewPage,
    "/supervisor/requests": SupervisorRequestsPage,
    "/supervisor/reports": SupervisorReportsPage,
    "/supervisor/evaluations": SupervisorEvaluationsPage,
    "/supervisor/audit-logs": RegistrarAuditLogsPage,
    "/supervisor/settings": RegistrarSettingsPage,
    "/sa/attendance-capture": SaAttendanceCapturePage,
    "/sa/attendance": SaAttendanceCapturePage,
    "/sa/dashboard": SaDashboardPage,
    "/sa/schedule": SaSchedulePage,
    "/sa/requests": SaRequestsPage,
    "/sa/allowance": SaAllowancePage,
    "/sa/school-balance": SaSchoolBalancePage,
    "/sa/history": SaHistoryPage,
    "/sa/evaluations": SaEvaluationsPage,
    "/sa/audit-logs": RegistrarAuditLogsPage,
    "/sa/profile": SaMyProfilePage,
    "/sa/settings": SaMyProfilePage
};

const routes = [
    { path: "/", redirect: () => Store.home },
    { path: "/login", component: LoginPage, meta: { public: true, title: "Sign in" } },
    { path: "/change-password", component: ChangePasswordPage, meta: { title: "Change password" } },

    // Pages below a menu item (the sidebar keeps the parent highlighted)
    { path: "/admin/sa-management/new", component: SaFormPage, meta: { role: "admin", title: "Register S.A." } },
    { path: "/admin/sa-management/:id(\\d+)", component: SaDetailPage, meta: { role: "admin", title: "S.A. record" } },
    { path: "/admin/sa-management/:id(\\d+)/edit", component: SaFormPage, meta: { role: "admin", title: "Edit S.A." } },

    // The duty grid is the Recommendations page; the slot-by-slot list, which is
    // also where office staffing is decided, sits underneath it.
    { path: "/admin/scheduling/recommendations/slots", component: RecommendationsPage,
      meta: { role: "admin", title: "Recommendations by slot" } },
    { path: "/admin/scheduling/assignment-review", redirect: "/admin/scheduling/recommendations" },
    { path: "/admin/deductions", redirect: "/admin/school-balance" },
    { path: "/admin/sa/:id(\\d+)", redirect: to => `/admin/sa-management/${to.params.id}?tab=CLASSES` },
    { path: "/sa/my-schedule", redirect: "/sa/schedule" },
    { path: "/sa/deductions", redirect: "/sa/school-balance" },
    { path: "/sa/settings", redirect: "/sa/profile" },

    ...flattenNavigation().map(page => ({
        path: page.path,
        component: PAGE_COMPONENTS[page.path] || PlannedPage,
        meta: { role: page.role, page }
    })),
    { path: "/:pathMatch(.*)*", component: NotFound }
];

const router = VueRouter.createRouter({
    history: VueRouter.createWebHashHistory(),
    routes,
    scrollBehavior: () => ({ top: 0 })
});

// UX guard: keeps people on pages meant for them.
// Real authorization is enforced by PHP on every API request.
router.beforeEach(to => {
    if (to.meta.public) {
        return Store.user ? Store.home : true;
    }
    if (!Store.user) {
        return { path: "/login", query: to.fullPath !== "/" ? { redirect: to.fullPath } : {} };
    }
    // Temporary password: nothing else is reachable until it's replaced
    if (Store.user.mustChangePassword && to.path !== "/change-password") {
        return "/change-password";
    }
    if (to.meta.role && to.meta.role !== Store.role) {
        return Store.home;
    }
});

router.afterEach(to => {
    const title = to.meta.page?.label || to.meta.title;
    document.title = title ? `${title} | AssistPay` : "AssistPay | NCST S.A. System";
});
