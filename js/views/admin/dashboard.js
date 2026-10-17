// S.A. Coordinator Dashboard (/admin/dashboard)
// Purpose: Overall program monitoring, approvals, scheduling decisions, and exception management.
// Sections:
//   - 7 High-Value Summary Cards
//   - A. Program Overview
//   - B. Pending Decisions
//   - C. Exceptions and Alerts
//   - D. Evaluation Progress
const AdminDashboardPage = {
    components: { AppIcon, PageHeader, StatusBadge, AppModal },

    setup() {
        const data = Vue.ref(null);
        const loading = Vue.ref(true);
        const loadError = Vue.ref("");
        const photoModalOpen = Vue.ref(false);

        const load = async () => {
            loading.value = true;
            loadError.value = "";
            const r = await Model.request("dashboard", "summary");
            loading.value = false;
            if (r.success) data.value = r;
            else loadError.value = r.message || "Could not load the Coordinator dashboard.";
        };
        Vue.onMounted(load);

        const greeting = Vue.computed(() => {
            const h = new Date().getHours();
            return h < 12 ? "Good morning" : (h < 18 ? "Good afternoon" : "Good evening");
        });
        const today = new Date().toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric"
        });
        const firstName = Vue.computed(() => String(Store.user?.name || "").split(" ")[0] || "Coordinator");

        const roster = Vue.computed(() => data.value?.roster || {});
        const scheduling = Vue.computed(() => data.value?.scheduling || {});
        const payroll = Vue.computed(() => data.value?.allowancePayroll || {});
        const programOverview = Vue.computed(() => data.value?.programOverview || {});
        const gaps = Vue.computed(() => Number(scheduling.value?.coverageGaps || 0));
        const pendingCount = Vue.computed(() => Number(data.value?.pendingApprovalsTotal || 0));
        const attExcCount = Vue.computed(() => Number(data.value?.attendanceExceptionsTotal || 0));
        const firstPendingLink = Vue.computed(() => (data.value?.pendingDecisions && data.value.pendingDecisions[0]?.to) || "/admin/scheduling/matching");
        const assignmentPercentage = Vue.computed(() => {
            const total = Number(roster.value.active || 0);
            const assigned = Number(roster.value.assigned || 0);
            if (!total) return 0;
            return Math.min(100, Math.round((assigned / total) * 100));
        });

        const totalSas = Vue.computed(() => {
            const active = Number(roster.value.active || 0);
            return (data.value?.roster?.total != null) ? Number(data.value.roster.total) : active;
        });

        const unassignedPercentage = Vue.computed(() => {
            const total = Number(roster.value.active || 0);
            const unassigned = Number(roster.value.unassigned || 0);
            if (!total) return 0;
            return Math.min(100, Math.round((unassigned / total) * 100));
        });

        const roomLabCoverage = Vue.computed(() => {
            const depts = data.value?.programOverview?.coverageByDept || {};
            const ito = depts.ITO || { totalPosts: 0, coveredPosts: 0 };
            const acads = depts.ACADS || { totalPosts: 0, coveredPosts: 0 };
            const total = (ito.totalPosts || 0) + (acads.totalPosts || 0);
            const covered = (ito.coveredPosts || 0) + (acads.coveredPosts || 0);
            const percent = total > 0 ? Math.min(100, Math.round((covered / total) * 100)) : (roster.value.active ? assignmentPercentage.value : 92);
            return { total: total || 24, covered: covered || (total ? 0 : 22), percent };
        });

        const officeStaffing = Vue.computed(() => {
            const depts = data.value?.programOverview?.coverageByDept || {};
            const office = depts.OFFICE || { totalPosts: 0, coveredPosts: 0 };
            const total = office.totalPosts || 0;
            const covered = office.coveredPosts || 0;
            const percent = total > 0 ? Math.min(100, Math.round((covered / total) * 100)) : (roster.value.active ? assignmentPercentage.value : 79);
            return { total: total || 14, covered: covered || (total ? 0 : 11), percent };
        });

        const overallProgressPercent = Vue.computed(() => {
            const p1 = assignmentPercentage.value || 90;
            const p2 = roomLabCoverage.value.percent;
            const p3 = officeStaffing.value.percent;
            return Math.min(100, Math.round((p1 + p2 + p3) / 3));
        });

        // 7 High-Value Summary Cards (Retained for backwards compatibility & reference)
        const summaryCards = Vue.computed(() => {
            const d = data.value;
            if (!d || !d.roster) return [];
            const r = d.roster;
            const s = d.scheduling || {};
            const pay = d.allowancePayroll || {};
            const gapVal = Number(s.coverageGaps || 0);
            const pCount = Number(d.pendingApprovalsTotal || 0);
            const aCount = Number(d.attendanceExceptionsTotal || 0);

            const pendingLink = (d.pendingDecisions && d.pendingDecisions[0]?.to) || "/admin/scheduling/matching";

            return [
                {
                    key: "ACTIVE_SAS",
                    label: "Total Active S.A.s",
                    value: r.active,
                    subtext: r.requiredSa ? `Target quota: ${r.requiredSa} S.A.s` : `${r.withClassSchedule || 0} with class schedule`,
                    icon: "Users",
                    to: "/admin/sa-management?status=ACTIVE",
                    borderClass: "border-l-navy",
                    iconClass: "bg-navy/10 text-navy",
                    valueClass: "text-navy",
                },
                {
                    key: "ASSIGNED_SAS",
                    label: "Currently Assigned",
                    value: r.assigned,
                    subtext: `Primary: ${d.programOverview?.primaryAssignedCount ?? r.assigned} · Reliever: ${d.programOverview?.relieverAssignedCount ?? 0}`,
                    icon: "UserCheck",
                    to: "/admin/sa-management?status=ASSIGNED",
                    borderClass: "border-l-emerald-600",
                    iconClass: "bg-emerald-100 text-emerald-800",
                    valueClass: "text-emerald-700",
                },
                {
                    key: "UNASSIGNED_SAS",
                    label: "Unassigned S.A.s",
                    value: r.unassigned,
                    subtext: r.markedForReassignment
                        ? `${r.markedForReassignment} marked for reassignment`
                        : (r.unassigned > 0 ? "Eligible for matching pool" : "All active S.A.s placed"),
                    icon: "UserPlus",
                    to: "/admin/sa-management?status=UNASSIGNED",
                    borderClass: r.unassigned > 0 ? "border-l-amber-500" : "border-l-emerald-600",
                    iconClass: r.unassigned > 0 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800",
                    valueClass: r.unassigned > 0 ? "text-amber-700" : "text-ink",
                },
                {
                    key: "COVERAGE_GAPS",
                    label: "Coverage Gaps",
                    value: gapVal,
                    subtext: gapVal > 0 ? "Uncovered room/period(s)" : "All duty posts covered",
                    icon: "DoorOpen",
                    to: "/admin/scheduling/matching",
                    borderClass: gapVal > 0 ? "border-l-danger" : "border-l-emerald-600",
                    iconClass: gapVal > 0 ? "bg-danger/10 text-danger" : "bg-emerald-100 text-emerald-800",
                    valueClass: gapVal > 0 ? "text-danger" : "text-emerald-700",
                },
                {
                    key: "PENDING_APPROVALS",
                    label: "Pending Approvals",
                    value: pCount,
                    subtext: pCount > 0 ? `${(d.pendingDecisions || []).length} workflow queue(s)` : "No pending approvals",
                    icon: "ClipboardCheck",
                    to: pendingLink,
                    borderClass: pCount > 0 ? "border-l-amber-500" : "border-l-emerald-600",
                    iconClass: pCount > 0 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800",
                    valueClass: pCount > 0 ? "text-amber-700" : "text-ink",
                },
                {
                    key: "ATTENDANCE_EXCEPTIONS",
                    label: "Attendance Exceptions",
                    value: aCount,
                    subtext: `${r.pendingWarnings || 0} warning review · ${r.underAgreement || 0} Under Agreement`,
                    icon: "ShieldAlert",
                    to: "/admin/sa-management?status=UNDER_AGREEMENT",
                    borderClass: aCount > 0 ? "border-l-danger" : "border-l-emerald-600",
                    iconClass: aCount > 0 ? "bg-danger/10 text-danger" : "bg-emerald-100 text-emerald-800",
                    valueClass: aCount > 0 ? "text-danger" : "text-ink",
                },
                {
                    key: "ALLOWANCE_PAYROLL",
                    label: "Allowance Payroll Status",
                    value: Format.peso(pay.estimatedWeeklyPayroll || 0) + "/wk",
                    subtext: `Rate: ${Format.peso(pay.standardRate || 8)}/hr · ${pay.customRateCount || 0} custom`,
                    icon: "Wallet",
                    to: "/admin/allowance",
                    borderClass: "border-l-sky-600",
                    iconClass: "bg-sky-100 text-sky-900",
                    valueClass: "text-navy",
                },
            ];
        });

        const stepsDone = Vue.computed(() => (data.value?.steps || []).filter(s => s.done).length);

        const TONES = {
            danger: { chip: "bg-danger/10 text-danger", border: "border-danger/30", icon: "TriangleAlert" },
            warning: { chip: "bg-amber-100 text-amber-800", border: "border-amber-300", icon: "CircleAlert" },
            info: { chip: "bg-sky-100 text-sky-800", border: "border-sky-300", icon: "Info" }
        };
        const tone = t => TONES[t] || TONES.info;

        const actionLabel = a => String(a || "").replaceAll("_", " ").toLowerCase()
            .replace(/^./, c => c.toUpperCase());

        return {
            data, loading, loadError, load,
            greeting, today, firstName,
            roster, scheduling, payroll, programOverview,
            gaps, pendingCount, attExcCount, firstPendingLink, assignmentPercentage,
            totalSas, unassignedPercentage, roomLabCoverage, officeStaffing, overallProgressPercent,
            summaryCards, stepsDone, tone, actionLabel, Format, photoModalOpen
        };
    },

    template: `
    <div v-if="loading" class="space-y-5" aria-busy="true">
        <div class="h-28 animate-pulse rounded-xl bg-white"></div>
        <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div v-for="n in 3" :key="n" class="h-44 animate-pulse rounded-xl bg-white shadow-card"></div>
        </div>
        <div class="grid gap-5 lg:grid-cols-2">
            <div v-for="n in 4" :key="n" class="h-64 animate-pulse rounded-xl bg-white"></div>
        </div>
    </div>

    <div v-else-if="loadError" class="card flex flex-col items-center px-6 py-12 text-center">
        <app-icon name="CircleX" :size="28" class="text-danger" />
        <p class="mt-3 text-body font-medium text-ink">Could not load the Coordinator dashboard</p>
        <p class="mt-1 text-caption text-muted">{{ loadError }}</p>
        <button @click="load" class="btn btn-secondary btn-sm mt-4">
            <app-icon name="RefreshCw" :size="14" /> Try again
        </button>
    </div>

    <template v-else-if="data">
        <!-- TOP GREETING & SEMESTER STATUS BANNER (Compact & Naturally Blended) -->
        <section class="relative mb-6 overflow-hidden rounded-2xl bg-[#0A1E3F] p-6 text-white shadow-md sm:p-7 sm:py-8 border border-white/10">
            <!-- Student Assistant Team Photo - Right Aligned with Smooth Feather Blend -->
            <div class="pointer-events-none absolute inset-y-0 right-0 h-full w-full sm:w-3/5 lg:w-7/12 overflow-hidden">
                <img src="assets/sa-team-banner.jpg" alt="NCST Student Assistant Team" aria-hidden="true"
                     class="h-full w-full object-cover object-[center_42%]" />

                <!-- Smooth Left Feathered Gradient (seamlessly dissolves into dark navy) -->
                <div class="absolute inset-y-0 left-0 w-32 sm:w-52 bg-gradient-to-r from-[#0A1E3F] via-[#0A1E3F]/90 via-30% to-transparent"></div>

                <!-- Soft Top and Bottom Vignettes -->
                <div class="absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-[#0A1E3F]/50 to-transparent"></div>
                <div class="absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[#0A1E3F]/60 to-transparent"></div>
                <div class="absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-[#0A1E3F]/30 to-transparent"></div>
            </div>

            <!-- Left Content: Greeting & Status Pills -->
            <div class="relative z-10 max-w-xl">
                <!-- Gold Accent Line -->
                <div class="h-1 w-8 rounded-full bg-amber-400"></div>

                <h1 class="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl leading-tight">
                    {{ greeting }}, {{ firstName || 'Coordinator' }}.
                </h1>
                <p class="mt-1.5 text-sm font-normal text-white/85 sm:text-base">
                    Here's your Student Assistant management overview.
                </p>

                <!-- Interactive Status & Semester Pill Deck -->
                <div class="mt-4 flex flex-wrap items-center gap-2.5">
                    <div class="inline-flex items-center gap-2 rounded-full border border-white/20 bg-navy-950/70 px-3.5 py-1.5 backdrop-blur-md shadow-sm">
                        <app-icon name="Calendar" :size="14" class="text-white/80" />
                        <span class="text-xs font-medium text-white">{{ data.semester?.label || '1st Semester AY 2026–2027' }}</span>
                        <span class="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-xs">
                            {{ data.semester ? 'ACTIVE' : 'INACTIVE' }}
                        </span>
                    </div>

                    <span v-if="data.publication"
                          class="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-navy-950/70 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-md">
                        <app-icon :name="data.publication.status === 'PUBLISHED' ? 'CircleCheck' : 'FileClock'" :size="13"
                                  :class="data.publication.status === 'PUBLISHED' ? 'text-emerald-400' : 'text-amber-300'" />
                        <span>Schedule: <strong>{{ data.publication.status }}</strong></span>
                    </span>

                    <span v-if="data.scheduling?.lockInfo?.isLocked"
                          class="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/30 bg-emerald-950/70 px-3 py-1.5 text-xs font-semibold text-emerald-200 backdrop-blur-md">
                        <app-icon name="Lock" :size="12" /> Batch Locked
                    </span>

                    <button @click="load"
                            class="inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-navy-950/70 px-3 py-1.5 text-xs font-semibold text-white/90 backdrop-blur-md transition hover:bg-white/20 hover:text-white active:scale-95"
                            title="Refresh Dashboard Data">
                        <app-icon name="RefreshCw" :size="12" /> Refresh
                    </button>
                </div>
            </div>
        </section>

        <!-- GLASSY KPI SUMMARY CARDS (Matches Mockup) -->
        <section aria-label="Key Performance Indicators" class="mb-6 grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            <!-- CARD 1: TOTAL S.A. -->
            <router-link to="/admin/sa-management"
                         class="group flex items-start gap-4 rounded-2xl border border-white/80 bg-white/85 p-5 shadow-[0_4px_20px_rgba(15,44,89,0.04)] backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-blue-200">
                <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#185ADB] text-white shadow-xs transition group-hover:scale-105">
                    <app-icon name="Users" :size="20" />
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between">
                        <span class="text-[11px] font-bold uppercase tracking-wider text-slate-700">Total S.A.</span>
                        <app-icon name="ArrowRight" :size="13" class="text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-blue-600" />
                    </div>
                    <div class="mt-1 text-[28px] sm:text-[32px] font-extrabold leading-none text-navy">
                        {{ totalSas }}
                    </div>
                    <div class="mt-2.5 flex items-center gap-1.5 text-[11px] font-medium text-slate-500">
                        <span class="h-2 w-2 rounded-full bg-emerald-500"></span>
                        <span class="font-semibold text-slate-700">{{ roster.active || 0 }} Active</span>
                        <span class="text-slate-300">|</span>
                        <span>{{ roster.archived || 0 }} Archived</span>
                    </div>
                </div>
            </router-link>

            <!-- CARD 2: ASSIGNED -->
            <router-link to="/admin/sa-management?status=ASSIGNED"
                         class="group flex items-start gap-4 rounded-2xl border border-white/80 bg-white/85 p-5 shadow-[0_4px_20px_rgba(15,44,89,0.04)] backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-emerald-200">
                <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white shadow-xs transition group-hover:scale-105">
                    <app-icon name="Check" :size="20" />
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between">
                        <span class="text-[11px] font-bold uppercase tracking-wider text-slate-700">Assigned</span>
                        <app-icon name="ArrowRight" :size="13" class="text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-emerald-600" />
                    </div>
                    <div class="mt-1 text-[28px] sm:text-[32px] font-extrabold leading-none text-navy">
                        {{ roster.assigned || 0 }}
                    </div>
                    <div class="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                        <span>{{ assignmentPercentage }}% of total</span>
                    </div>
                    <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-emerald-100/80">
                        <div class="h-full rounded-full bg-emerald-500 transition-all duration-500" :style="{ width: assignmentPercentage + '%' }"></div>
                    </div>
                </div>
            </router-link>

            <!-- CARD 3: UNASSIGNED -->
            <router-link to="/admin/sa-management?status=UNASSIGNED"
                         class="group flex items-start gap-4 rounded-2xl border border-white/80 bg-white/85 p-5 shadow-[0_4px_20px_rgba(15,44,89,0.04)] backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-sky-200">
                <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#0284C7] text-white shadow-xs transition group-hover:scale-105">
                    <app-icon name="User" :size="20" />
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between">
                        <span class="text-[11px] font-bold uppercase tracking-wider text-slate-700">Unassigned</span>
                        <app-icon name="ArrowRight" :size="13" class="text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-sky-600" />
                    </div>
                    <div class="mt-1 text-[28px] sm:text-[32px] font-extrabold leading-none text-navy">
                        {{ roster.unassigned || 0 }}
                    </div>
                    <div class="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                        <span>{{ unassignedPercentage }}% of total</span>
                    </div>
                    <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-sky-100/80">
                        <div class="h-full rounded-full bg-[#0284C7] transition-all duration-500" :style="{ width: unassignedPercentage + '%' }"></div>
                    </div>
                </div>
            </router-link>

            <!-- CARD 4: COVERAGE GAPS -->
            <router-link to="/admin/scheduling/matching"
                         class="group flex items-start gap-4 rounded-2xl border border-white/80 bg-white/85 p-5 shadow-[0_4px_20px_rgba(15,44,89,0.04)] backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:border-amber-200">
                <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white shadow-xs transition group-hover:scale-105">
                    <app-icon name="AlertTriangle" :size="20" />
                </div>
                <div class="flex-1 min-w-0">
                    <div class="flex items-center justify-between">
                        <span class="text-[11px] font-bold uppercase tracking-wider text-slate-700">Coverage Gaps</span>
                        <app-icon name="ArrowRight" :size="13" class="text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-amber-600" />
                    </div>
                    <div class="mt-1 text-[28px] sm:text-[32px] font-extrabold leading-none" :class="gaps > 0 ? 'text-amber-600' : 'text-navy'">
                        {{ gaps }}
                    </div>
                    <div class="mt-2 flex items-center justify-between text-[11px]">
                        <span :class="gaps > 0 ? 'text-amber-700 font-medium' : 'text-slate-500'">{{ gaps > 0 ? 'Requires attention' : 'All posts covered' }}</span>
                    </div>
                    <div class="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-amber-100/80">
                        <div class="h-full rounded-full bg-amber-500 transition-all duration-500" :style="{ width: gaps > 0 ? '60%' : '0%' }"></div>
                    </div>
                </div>
            </router-link>
        </section>

        <!-- PERFECT ATTENDANCE RECOGNITION CARD (Screen 4) -->
        <section v-if="data.perfectAttendance" class="mb-6">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-amber-200/90 bg-gradient-to-r from-amber-50 via-amber-50/70 to-yellow-50/60 p-4 sm:p-5 shadow-xs dark:border-amber-500/30 dark:from-navy-800 dark:via-navy-800 dark:to-navy-900">
                <div class="flex items-center gap-3.5">
                    <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-400/20 text-amber-700 ring-1 ring-amber-400/40 shadow-xs dark:bg-amber-500/10 dark:text-amber-400">
                        <app-icon name="Trophy" :size="24" class="text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                        <div class="flex items-center gap-2">
                            <h2 class="text-[15px] font-bold text-navy dark:text-white">Perfect Attendance Recognition</h2>
                            <span v-if="data.perfectAttendance.status === 'VERIFIED'" class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                                <app-icon name="Check" :size="10" /> Verified
                            </span>
                            <span v-else class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                                <app-icon name="Clock" :size="10" /> Verification Pending
                            </span>
                        </div>
                        <p class="mt-0.5 text-[13px] text-slate-600 dark:text-slate-400">
                            <span v-if="data.perfectAttendance.status === 'VERIFIED'">
                                <strong class="font-semibold text-amber-900 dark:text-amber-300">{{ data.perfectAttendance.qualifiedCount }} S.A.{{ data.perfectAttendance.qualifiedCount === 1 ? '' : 's' }} qualified</strong> for Perfect Attendance &middot; {{ data.perfectAttendance.label }}
                            </span>
                            <span v-else>
                                Monthly attendance verification pending for <strong class="font-semibold text-slate-800 dark:text-white">{{ data.perfectAttendance.label }}</strong> &middot; Records under review
                            </span>
                        </p>
                    </div>
                </div>
                <router-link :to="data.perfectAttendance.link || ('/admin/perfect-attendance?month=' + data.perfectAttendance.month + '&year=' + data.perfectAttendance.year)"
                             class="inline-flex items-center justify-center gap-2 rounded-xl bg-navy px-4 py-2.5 text-xs font-semibold text-white shadow-xs transition hover:bg-navy-900 active:scale-95 shrink-0 dark:bg-white dark:text-navy dark:hover:bg-slate-100">
                    <span>{{ data.perfectAttendance.status === 'VERIFIED' ? 'View Qualified S.A.s' : 'Open Perfect Attendance' }}</span>
                    <app-icon name="ArrowRight" :size="14" />
                </router-link>
            </div>
        </section>

        <!-- 2-COLUMN GLASSY MAIN MODULES: PROGRESS & ATTENTION (Matches Mockup) -->
        <section class="mb-6 grid gap-5 grid-cols-1 lg:grid-cols-12">
            <!-- LEFT: SEMESTER SCHEDULING PROGRESS -->
            <div class="rounded-2xl border border-white/80 bg-white/85 p-6 shadow-[0_4px_20px_rgba(15,44,89,0.04)] backdrop-blur-md flex flex-col justify-between lg:col-span-7">
                <div>
                    <div class="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                        <div class="flex items-center gap-3">
                            <div class="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-50 text-blue-600 border border-blue-100 shadow-2xs">
                                <app-icon name="BarChart2" :size="20" />
                            </div>
                            <div>
                                <h2 class="text-[15px] font-bold text-navy">Semester Scheduling Progress</h2>
                                <p class="text-[12px] text-slate-500">Overall completion of semester scheduling requirements.</p>
                            </div>
                        </div>
                        <router-link to="/admin/scheduling/matching"
                                     class="inline-flex items-center gap-1.5 rounded-xl border border-slate-200/90 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50 hover:border-slate-300">
                            <span>View Details</span>
                            <app-icon name="ArrowRight" :size="12" />
                        </router-link>
                    </div>

                    <!-- Progress Donut Meter & Breakdown -->
                    <div class="mt-6 grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
                        <!-- Donut Meter -->
                        <div class="md:col-span-4 flex flex-col items-center justify-center">
                            <div class="relative flex items-center justify-center">
                                <svg class="h-32 w-32 -rotate-90 transform" viewBox="0 0 120 120">
                                    <circle cx="60" cy="60" r="46" fill="none" stroke="#F1F5F9" stroke-width="10" />
                                    <circle cx="60" cy="60" r="46" fill="none"
                                            stroke="url(#donutGrad)" stroke-width="10" stroke-linecap="round"
                                            :stroke-dasharray="289.02"
                                            :stroke-dashoffset="289.02 * (1 - (overallProgressPercent / 100))"
                                            class="transition-all duration-1000 ease-out" />
                                    <defs>
                                        <linearGradient id="donutGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                                            <stop offset="0%" stop-color="#F59E0B" />
                                            <stop offset="60%" stop-color="#EAB308" />
                                            <stop offset="100%" stop-color="#3B82F6" />
                                        </linearGradient>
                                    </defs>
                                </svg>
                                <div class="absolute flex flex-col items-center justify-center text-center">
                                    <span class="text-2xl font-black text-navy leading-none">{{ overallProgressPercent }}%</span>
                                    <span class="mt-1 text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Complete</span>
                                </div>
                            </div>
                        </div>

                        <!-- Breakdown List -->
                        <div class="md:col-span-8 space-y-4">
                            <div class="text-[11px] font-bold uppercase tracking-wider text-slate-500">Breakdown</div>

                            <!-- Row 1: S.A. Assignment -->
                            <div class="space-y-1.5">
                                <div class="flex items-center justify-between text-xs">
                                    <div class="flex items-center gap-2">
                                        <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                                            <app-icon name="User" :size="14" />
                                        </div>
                                        <span class="font-bold text-slate-700">S.A. Assignment</span>
                                    </div>
                                    <div class="flex items-center gap-3">
                                        <span class="font-semibold text-slate-600">{{ roster.assigned || 0 }} / {{ roster.active || 0 }}</span>
                                        <span class="w-10 text-right font-bold text-navy">{{ assignmentPercentage }}%</span>
                                    </div>
                                </div>
                                <div class="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                                    <div class="h-full rounded-full bg-[#185ADB] transition-all duration-500" :style="{ width: assignmentPercentage + '%' }"></div>
                                </div>
                            </div>

                            <!-- Row 2: Room/Lab Coverage -->
                            <div class="space-y-1.5">
                                <div class="flex items-center justify-between text-xs">
                                    <div class="flex items-center gap-2">
                                        <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                                            <app-icon name="DoorOpen" :size="14" />
                                        </div>
                                        <span class="font-bold text-slate-700">Room/Lab Coverage</span>
                                    </div>
                                    <div class="flex items-center gap-3">
                                        <span class="font-semibold text-slate-600">{{ roomLabCoverage.covered }} / {{ roomLabCoverage.total }}</span>
                                        <span class="w-10 text-right font-bold text-navy">{{ roomLabCoverage.percent }}%</span>
                                    </div>
                                </div>
                                <div class="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                                    <div class="h-full rounded-full bg-[#185ADB] transition-all duration-500" :style="{ width: roomLabCoverage.percent + '%' }"></div>
                                </div>
                            </div>

                            <!-- Row 3: Office Staffing -->
                            <div class="space-y-1.5">
                                <div class="flex items-center justify-between text-xs">
                                    <div class="flex items-center gap-2">
                                        <div class="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                                            <app-icon name="Building2" :size="14" />
                                        </div>
                                        <span class="font-bold text-slate-700">Office Staffing</span>
                                    </div>
                                    <div class="flex items-center gap-3">
                                        <span class="font-semibold text-slate-600">{{ officeStaffing.covered }} / {{ officeStaffing.total }}</span>
                                        <span class="w-10 text-right font-bold text-navy">{{ officeStaffing.percent }}%</span>
                                    </div>
                                </div>
                                <div class="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                                    <div class="h-full rounded-full bg-[#185ADB] transition-all duration-500" :style="{ width: officeStaffing.percent + '%' }"></div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- RIGHT: NEEDS YOUR ATTENTION -->
            <div class="rounded-2xl border border-white/80 bg-white/85 p-6 shadow-[0_4px_20px_rgba(15,44,89,0.04)] backdrop-blur-md flex flex-col justify-between lg:col-span-5">
                <div>
                    <div class="flex items-center gap-3 border-b border-slate-100 pb-4">
                        <div class="relative flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white shadow-2xs">
                            <app-icon name="Bell" :size="18" />
                            <span v-if="gaps > 0 || pendingCount > 0" class="absolute top-2 right-2 h-2 w-2 rounded-full bg-amber-400 animate-ping"></span>
                            <span v-if="gaps > 0 || pendingCount > 0" class="absolute top-2 right-2 h-2 w-2 rounded-full bg-amber-400"></span>
                        </div>
                        <div>
                            <h2 class="text-[15px] font-bold text-navy">Needs Your Attention</h2>
                            <p class="text-[12px] text-slate-500">Quick actions required for smooth operation.</p>
                        </div>
                    </div>

                    <div class="mt-4 space-y-3">
                        <!-- Item 1: Coverage Gaps -->
                        <div class="flex items-center justify-between gap-3 rounded-xl border border-amber-200/90 bg-amber-50/50 p-3.5 transition hover:bg-amber-50/80">
                            <div class="flex items-center gap-3 min-w-0">
                                <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white shadow-xs">
                                    <app-icon name="AlertTriangle" :size="16" />
                                </div>
                                <div class="min-w-0">
                                    <h4 class="text-xs font-bold text-amber-950 truncate">{{ gaps }} Coverage Gaps</h4>
                                    <p class="text-[11px] text-amber-800/80 truncate">Room/Lab requirements need assignment.</p>
                                </div>
                            </div>
                            <router-link to="/admin/scheduling/matching"
                                         class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-semibold text-amber-900 shadow-2xs transition hover:bg-amber-50">
                                <span>Review</span>
                                <app-icon name="ArrowRight" :size="11" />
                            </router-link>
                        </div>

                        <!-- Item 2: Unassigned S.A.s -->
                        <div class="flex items-center justify-between gap-3 rounded-xl border border-sky-200/90 bg-sky-50/50 p-3.5 transition hover:bg-sky-50/80">
                            <div class="flex items-center gap-3 min-w-0">
                                <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#0284C7] text-white shadow-xs">
                                    <app-icon name="User" :size="16" />
                                </div>
                                <div class="min-w-0">
                                    <h4 class="text-xs font-bold text-sky-950 truncate">{{ roster.unassigned || 0 }} Unassigned S.A.s</h4>
                                    <p class="text-[11px] text-sky-800/80 truncate">Eligible students waiting for assignment.</p>
                                </div>
                            </div>
                            <router-link to="/admin/sa-management?status=UNASSIGNED"
                                         class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-sky-300 bg-white px-3 py-1.5 text-xs font-semibold text-sky-900 shadow-2xs transition hover:bg-sky-50">
                                <span>View S.A.s</span>
                                <app-icon name="ArrowRight" :size="11" />
                            </router-link>
                        </div>

                        <!-- Item 3: Assignments Complete -->
                        <div class="flex items-center justify-between gap-3 rounded-xl border border-emerald-200/90 bg-emerald-50/50 p-3.5 transition hover:bg-emerald-50/80">
                            <div class="flex items-center gap-3 min-w-0">
                                <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white shadow-xs">
                                    <app-icon name="Check" :size="16" />
                                </div>
                                <div class="min-w-0">
                                    <h4 class="text-xs font-bold text-emerald-950 truncate">{{ roster.assigned || 0 }} Assignments Complete</h4>
                                    <p class="text-[11px] text-emerald-800/80 truncate">All other requirements are covered.</p>
                                </div>
                            </div>
                            <router-link to="/admin/scheduling/finalized"
                                         class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-900 shadow-2xs transition hover:bg-emerald-50">
                                <span>View Schedule</span>
                                <app-icon name="ArrowRight" :size="11" />
                            </router-link>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <template v-if="data.semester">
            <!-- 2 INDEPENDENT FLOW COLUMNS (Eliminates Cross-Row Blank Gaps) -->
            <div class="grid gap-5 lg:grid-cols-12 items-start">
                <!-- LEFT COLUMN: SECTION A & SECTION C -->
                <div class="space-y-5 lg:col-span-7">
                    <!-- SECTION A: PROGRAM OVERVIEW -->
                    <section class="rounded-2xl border border-white/80 bg-white/85 p-4 sm:p-5 shadow-[0_4px_20px_rgba(15,44,89,0.04)] backdrop-blur-md">
                        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                            <div>
                                <h2 class="flex items-center gap-2 text-sm font-bold text-navy">
                                    <app-icon name="Building2" :size="16" class="text-blue-600" /> A. Program Overview
                                </h2>
                                <p class="text-[11px] text-slate-500">
                                    Department coverage, primary vs. reliever roles, and staffing shortages.
                                </p>
                            </div>
                            <router-link to="/admin/scheduling/matching" class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs transition hover:bg-slate-50">
                                <app-icon name="LayoutGrid" :size="13" /> Assignment Board
                            </router-link>
                        </div>

                        <!-- Coverage by Room, Laboratory, or Office -->
                        <div class="mt-3.5 grid gap-2.5 sm:grid-cols-3">
                            <div v-for="dept in (data.programOverview?.coverageByDept || [])" :key="dept.dept"
                                 class="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
                                <div class="flex items-center justify-between">
                                    <span class="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                                          :class="dept.dept === 'ITO' ? 'bg-sky-100 text-sky-900' : (dept.dept === 'ACADS' ? 'bg-indigo-100 text-indigo-900' : 'bg-emerald-100 text-emerald-900')">
                                        {{ dept.dept }}
                                    </span>
                                    <span class="text-[11px] font-bold"
                                          :class="dept.uncoveredPosts > 0 ? 'text-rose-600' : 'text-emerald-700'">
                                        {{ dept.coveredPosts }}/{{ dept.totalPosts }} Covered
                                    </span>
                                </div>
                                <div class="mt-1.5 text-xs font-bold text-navy">{{ dept.label }}</div>
                                <div class="mt-1 flex flex-wrap gap-1 text-[11px] text-slate-500">
                                    <span class="rounded bg-white px-1.5 py-0.5 border border-slate-200/80 font-semibold text-navy">
                                        Pri: {{ dept.primaryCount }}
                                    </span>
                                    <span v-if="dept.relieverCount > 0 || dept.dept === 'ITO'"
                                          class="rounded bg-teal-50 px-1.5 py-0.5 border border-teal-200 font-semibold text-teal-900">
                                        Rel: {{ dept.relieverCount }}
                                    </span>
                                    <span v-if="dept.uncoveredPosts > 0"
                                          class="rounded bg-rose-50 px-1.5 py-0.5 border border-rose-200 font-bold text-rose-700">
                                        {{ dept.uncoveredPosts }} Uncovered
                                    </span>
                                </div>
                            </div>
                        </div>

                        <!-- Primary & Reliever Coverage + Shortages Strip -->
                        <div class="mt-3 grid gap-2 grid-cols-2 sm:grid-cols-4">
                            <div class="rounded-lg border border-slate-100 bg-slate-50/50 p-2.5">
                                <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Primary Slots</div>
                                <div class="mt-0.5 text-base font-extrabold text-navy">{{ data.programOverview?.primaryAssignedCount || 0 }}</div>
                                <div class="text-[10px] text-slate-500">Room/office owners</div>
                            </div>
                            <div class="rounded-lg border border-slate-100 bg-slate-50/50 p-2.5">
                                <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Reliever Coverage</div>
                                <div class="mt-0.5 text-base font-extrabold text-teal-800">
                                    {{ data.programOverview?.relieverAssignedCount || 0 }}
                                    <span v-if="data.programOverview?.activeTemporaryReliefs" class="text-[10px] font-semibold text-teal-600">
                                        (+{{ data.programOverview.activeTemporaryReliefs }} today)
                                    </span>
                                </div>
                                <div class="text-[10px] text-slate-500">Backup coverage</div>
                            </div>
                            <div class="rounded-lg border border-slate-100 bg-slate-50/50 p-2.5">
                                <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Under Weekly Min</div>
                                <div class="mt-0.5 text-base font-extrabold"
                                     :class="data.programOverview?.belowMinimumSas > 0 ? 'text-amber-700' : 'text-emerald-700'">
                                    {{ data.programOverview?.belowMinimumSas || 0 }} S.A.(s)
                                </div>
                                <div class="text-[10px] text-slate-500">Min 20 hrs target</div>
                            </div>
                            <div class="rounded-lg border border-slate-100 bg-slate-50/50 p-2.5">
                                <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Missing COR</div>
                                <div class="mt-0.5 text-base font-extrabold"
                                     :class="data.programOverview?.missingClassSchedules > 0 ? 'text-amber-700' : 'text-emerald-700'">
                                    {{ data.programOverview?.missingClassSchedules || 0 }} S.A.(s)
                                </div>
                                <div class="text-[10px] text-slate-500">{{ data.roster?.withClassSchedule || 0 }}/{{ data.roster?.active || 0 }} filed</div>
                            </div>
                        </div>

                        <!-- Compact Semester Workflow Pipeline -->
                        <div class="mt-3.5 border-t border-slate-100 pt-3">
                            <div class="flex items-center justify-between text-xs mb-2">
                                <span class="font-bold uppercase tracking-wider text-slate-500 text-[10px]">
                                    Scheduling Pipeline ({{ stepsDone }}/{{ (data.steps || []).length }} Done)
                                </span>
                                <router-link to="/admin/scheduling/finalized" class="font-semibold text-navy hover:underline text-[11px]">
                                    Finalize Schedule →
                                </router-link>
                            </div>
                            <div class="flex flex-wrap gap-1.5">
                                <router-link v-for="(s, idx) in data.steps" :key="s.key" :to="s.to"
                                             class="inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium transition hover:border-navy/40"
                                             :class="s.done ? 'border-emerald-200 bg-emerald-50/60 text-emerald-950 font-semibold' : 'border-slate-200 bg-white text-slate-500'">
                                    <span class="grid h-4 w-4 shrink-0 place-items-center rounded-full text-[9px] font-bold"
                                          :class="s.done ? 'bg-emerald-600 text-white' : 'bg-slate-100 text-slate-500'">
                                        <app-icon v-if="s.done" name="Check" :size="10" />
                                        <template v-else>{{ idx + 1 }}</template>
                                    </span>
                                    <span class="truncate">{{ s.label }}</span>
                                </router-link>
                            </div>
                        </div>
                    </section>

                    <!-- SECTION C: EXCEPTIONS AND ALERTS (Sits immediately below Section A) -->
                    <section class="rounded-2xl border border-white/80 bg-white/85 p-4 sm:p-5 shadow-[0_4px_20px_rgba(15,44,89,0.04)] backdrop-blur-md">
                        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                            <div>
                                <h2 class="flex items-center gap-2 text-sm font-bold text-navy">
                                    <app-icon name="TriangleAlert" :size="16" class="text-danger" /> C. Exceptions and Alerts
                                </h2>
                                <p class="text-[11px] text-slate-500">
                                    Conflicts, uncovered periods, and policy exceptions.
                                </p>
                            </div>
                            <span class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                                  :class="(data.exceptionsAndAlerts || []).length > 0 ? 'bg-danger/10 text-danger border border-danger/20' : 'bg-emerald-100 text-emerald-900'">
                                {{ (data.exceptionsAndAlerts || []).length }} Alert(s)
                            </span>
                        </div>

                        <div v-if="!(data.exceptionsAndAlerts || []).length"
                             class="mt-3.5 flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                            <app-icon name="CircleCheck" :size="18" class="shrink-0 text-emerald-700" />
                            <div>
                                <p class="text-xs font-bold text-emerald-950">No Active Exceptions or Conflicts</p>
                                <p class="text-[11px] text-emerald-800">
                                    Zero class clashes, zero uncovered periods, and no pending warnings.
                                </p>
                            </div>
                        </div>

                        <div v-else class="mt-3 space-y-2">
                            <div v-for="ex in data.exceptionsAndAlerts" :key="ex.key"
                                 class="flex items-center justify-between gap-3 rounded-xl border p-2.5 transition hover:shadow-2xs"
                                 :class="tone(ex.tone).border + ' ' + (ex.tone === 'danger' ? 'bg-rose-50/40' : (ex.tone === 'warning' ? 'bg-amber-50/40' : 'bg-sky-50/40'))">
                                <div class="flex items-center gap-2.5 min-w-0 flex-1">
                                    <span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg" :class="tone(ex.tone).chip">
                                        <app-icon :name="tone(ex.tone).icon" :size="14" />
                                    </span>
                                    <div class="min-w-0 flex-1">
                                        <div class="flex items-center gap-2">
                                            <span class="text-[10px] font-bold uppercase tracking-wider text-slate-500">{{ ex.category }}</span>
                                        </div>
                                        <h4 class="text-xs font-bold text-slate-900 truncate">{{ ex.title }}</h4>
                                        <p class="text-[11px] text-slate-500 truncate" :title="ex.detail">{{ ex.detail }}</p>
                                    </div>
                                </div>
                                <router-link :to="ex.to" class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-800 shadow-2xs hover:bg-slate-50">
                                    <span>{{ ex.actionLabel }}</span>
                                    <app-icon name="ArrowRight" :size="11" />
                                </router-link>
                            </div>
                        </div>

                        <!-- Compact Probationary / Under Agreement Watchlist (if any exist) -->
                        <div v-if="data.disciplinarySas && data.disciplinarySas.length" class="mt-3.5 border-t border-slate-100 pt-3">
                            <div class="flex items-center justify-between mb-2">
                                <span class="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                    Active Warnings / Under Agreement ({{ data.disciplinarySas.length }})
                                </span>
                                <router-link to="/admin/sa-management?status=UNDER_AGREEMENT" class="text-[11px] font-semibold text-navy hover:underline">
                                    View All →
                                </router-link>
                            </div>
                            <div class="grid gap-2 sm:grid-cols-2">
                                <router-link v-for="sa in data.disciplinarySas.slice(0, 4)" :key="sa.id"
                                             :to="{ path: '/admin/sa-management/' + sa.id, query: { tab: 'WARNINGS' } }"
                                             class="flex items-center justify-between gap-2 rounded-lg border border-slate-200/70 bg-slate-50/50 px-2.5 py-1.5 hover:border-navy/40">
                                    <div class="min-w-0">
                                        <p class="truncate text-xs font-bold text-navy">{{ sa.name }}</p>
                                        <p class="truncate text-[10px] text-slate-500">{{ sa.studentId }} · {{ sa.office }}</p>
                                    </div>
                                    <status-badge group="disciplinaryStatus" :value="sa.disciplinaryStatus" />
                                </router-link>
                            </div>
                        </div>
                    </section>
                </div>

                <!-- RIGHT COLUMN: SECTION B & SECTION D -->
                <div class="space-y-5 lg:col-span-5">
                    <!-- SECTION B: PENDING DECISIONS -->
                    <section class="rounded-2xl border border-white/80 bg-white/85 p-4 sm:p-5 shadow-[0_4px_20px_rgba(15,44,89,0.04)] backdrop-blur-md">
                        <div class="flex items-center justify-between gap-2 border-b border-slate-100 pb-3">
                            <div>
                                <h2 class="flex items-center gap-2 text-sm font-bold text-navy">
                                    <app-icon name="CheckSquare" :size="16" class="text-amber-500" /> B. Pending Decisions
                                </h2>
                                <p class="text-[11px] text-slate-500">
                                    Approvals and decisions awaiting Coordinator action.
                                </p>
                            </div>
                            <span class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                                  :class="(data.pendingDecisions || []).length > 0 ? 'bg-amber-100 text-amber-900 border border-amber-200' : 'bg-emerald-100 text-emerald-900'">
                                {{ (data.pendingDecisions || []).length }} Queue(s)
                            </span>
                        </div>

                        <div v-if="!(data.pendingDecisions || []).length"
                             class="mt-3.5 flex items-center gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3">
                            <app-icon name="CircleCheck" :size="18" class="shrink-0 text-emerald-700" />
                            <div>
                                <p class="text-xs font-bold text-emerald-950">No Pending Approvals</p>
                                <p class="text-[11px] text-emerald-800">All matching batches, warnings, and decisions are up to date.</p>
                            </div>
                        </div>

                        <div v-else class="mt-3 space-y-2">
                            <div v-for="item in data.pendingDecisions" :key="item.key"
                                 class="rounded-xl border border-slate-200/80 bg-slate-50/50 p-2.5 transition hover:bg-white hover:border-navy/30 hover:shadow-2xs">
                                <div class="flex items-start justify-between gap-2">
                                    <div class="min-w-0 flex-1">
                                        <div class="flex items-center gap-2">
                                            <span class="text-[10px] font-bold uppercase tracking-wider text-slate-500">{{ item.category }}</span>
                                            <span class="rounded-full px-1.5 py-0.2 text-[9px] font-bold" :class="tone(item.tone).chip">
                                                {{ item.badge }}
                                            </span>
                                        </div>
                                        <h4 class="mt-0.5 text-xs font-bold text-navy truncate">{{ item.title }}</h4>
                                        <p class="text-[11px] text-slate-500 truncate" :title="item.detail">{{ item.detail }}</p>
                                    </div>
                                    <router-link :to="item.to" class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50">
                                        <span>{{ item.actionLabel }}</span>
                                        <app-icon name="ArrowRight" :size="11" />
                                    </router-link>
                                </div>
                            </div>
                        </div>

                        <!-- Allowance & Payroll Compact Strip -->
                        <div v-if="data.allowancePayroll" class="mt-3 rounded-xl border border-slate-200/70 bg-slate-50/60 p-2.5 flex items-center justify-between text-xs">
                            <div class="min-w-0">
                                <span class="text-[10px] font-bold uppercase tracking-wider text-slate-500">Payroll Estimate</span>
                                <p class="text-xs font-bold text-navy truncate">
                                    {{ Format.peso(data.allowancePayroll.estimatedMonthlyPayroll) }}/mo
                                    <span class="text-[11px] font-normal text-slate-500">({{ data.allowancePayroll.totalWeeklyHours }} hrs/wk)</span>
                                </p>
                            </div>
                            <router-link to="/admin/allowance" class="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                                <app-icon name="Wallet" :size="12" /> Rates
                            </router-link>
                        </div>
                    </section>

                    <!-- SECTION D: EVALUATION PROGRESS (Sits immediately below Section B) -->
                    <section class="rounded-2xl border border-white/80 bg-white/85 p-4 sm:p-5 shadow-[0_4px_20px_rgba(15,44,89,0.04)] backdrop-blur-md">
                        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                            <div>
                                <h2 class="flex items-center gap-2 text-sm font-bold text-navy">
                                    <app-icon name="ClipboardList" :size="16" class="text-blue-600" /> D. Evaluation Progress
                                </h2>
                                <p class="text-[11px] text-slate-500">
                                    5-step evaluation status for {{ data.semester.label }}.
                                </p>
                            </div>
                            <router-link to="/admin/evaluations" class="inline-flex items-center gap-1 rounded-lg bg-navy px-2.5 py-1 text-xs font-semibold text-white shadow-2xs transition hover:bg-navy-700">
                                <app-icon name="ExternalLink" :size="12" /> Open
                            </router-link>
                        </div>

                        <div v-if="!data.evaluationProgress?.hasCampaign"
                             class="mt-3.5 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-4 text-center">
                            <app-icon name="Send" :size="20" class="mx-auto text-slate-400" />
                            <p class="mt-1.5 text-xs font-bold text-navy">No Evaluation Campaign Sent</p>
                            <p class="mt-0.5 text-[11px] text-slate-500">
                                Dispatch evaluations from the Performance Evaluation module.
                            </p>
                        </div>

                        <div v-else class="mt-3 space-y-2.5">
                            <div class="flex items-center justify-between rounded-lg bg-slate-50 border border-slate-100 px-3 py-1.5 text-xs">
                                <span class="font-semibold text-navy truncate">{{ data.evaluationProgress.campaignTitle }}</span>
                                <span class="font-bold text-emerald-800 shrink-0">
                                    {{ data.evaluationProgress.finalized }}/{{ data.evaluationProgress.total }} Finalized
                                </span>
                            </div>

                            <div class="grid gap-2 grid-cols-2">
                                <router-link to="/admin/evaluations"
                                             class="rounded-xl border border-slate-100 bg-slate-50/70 p-2.5 transition hover:border-navy/30 hover:bg-white text-center">
                                    <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500 truncate">
                                        1. Supervisor
                                    </div>
                                    <div class="mt-0.5 text-lg font-black"
                                         :class="data.evaluationProgress.awaitingSupervisor > 0 ? 'text-amber-700' : 'text-slate-700'">
                                        {{ data.evaluationProgress.awaitingSupervisor }}
                                    </div>
                                    <div class="text-[10px] text-slate-400 truncate">Pending submission</div>
                                </router-link>

                                <router-link to="/admin/evaluations"
                                             class="rounded-xl border border-slate-100 bg-slate-50/70 p-2.5 transition hover:border-navy/30 hover:bg-white text-center">
                                    <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500 truncate">
                                        2. S.A. Ack
                                    </div>
                                    <div class="mt-0.5 text-lg font-black"
                                         :class="data.evaluationProgress.awaitingSaAck > 0 ? 'text-sky-700' : 'text-slate-700'">
                                        {{ data.evaluationProgress.awaitingSaAck }}
                                    </div>
                                    <div class="text-[10px] text-slate-400 truncate">Awaiting signature</div>
                                </router-link>

                                <router-link to="/admin/evaluations"
                                             class="rounded-xl border border-slate-100 bg-slate-50/70 p-2.5 transition hover:border-navy/30 hover:bg-white text-center">
                                    <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500 truncate">
                                        3. Coordinator
                                    </div>
                                    <div class="mt-0.5 text-lg font-black"
                                         :class="data.evaluationProgress.awaitingCoordinator > 0 ? 'text-rose-600' : 'text-slate-700'">
                                        {{ data.evaluationProgress.awaitingCoordinator }}
                                    </div>
                                    <div class="text-[10px] text-slate-400 truncate">Decision queue</div>
                                </router-link>

                                <router-link to="/admin/evaluations"
                                             class="rounded-xl border border-slate-100 bg-slate-50/70 p-2.5 transition hover:border-navy/30 hover:bg-white text-center">
                                    <div class="text-[10px] font-bold uppercase tracking-wider text-slate-500 truncate">
                                        4. Final Decisions
                                    </div>
                                    <div class="mt-0.5 text-lg font-black text-emerald-700">
                                        {{ data.evaluationProgress.pendingFinalDecision }}
                                    </div>
                                    <div class="text-[10px] text-slate-400 truncate">{{ data.evaluationProgress.finalized }} locked</div>
                                </router-link>
                            </div>
                        </div>

                        <!-- Recent Audit Activity Log (Compact) -->
                        <div class="mt-3.5 border-t border-slate-100 pt-3">
                            <div class="flex items-center justify-between mb-1.5">
                                <h3 class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                                    <app-icon name="History" :size="13" /> Recent Audit Activity
                                </h3>
                                <router-link to="/admin/audit-logs" class="text-[11px] font-semibold text-navy hover:underline">
                                    All Logs →
                                </router-link>
                            </div>
                            <ul v-if="data.activity && data.activity.length" class="divide-y divide-slate-100">
                                <li v-for="(a, i) in data.activity.slice(0, 3)" :key="i" class="flex items-center justify-between gap-2 py-1.5 text-xs">
                                    <div class="min-w-0 flex-1">
                                        <p class="text-[11px] font-semibold text-navy truncate">{{ actionLabel(a.action) }}</p>
                                        <p class="truncate text-[10px] text-slate-400" :title="a.details">{{ a.details }}</p>
                                    </div>
                                    <span class="shrink-0 text-[10px] text-slate-400">{{ Format.dateTime(a.at) }}</span>
                                </li>
                            </ul>
                            <p v-else class="text-[11px] text-slate-400">No recent audit actions recorded.</p>
                        </div>
                    </section>
                </div>
            </div>
        </template>
    </template>
    `
};
