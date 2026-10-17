// Student Assistant Dashboard (/sa/dashboard)
// Purpose: Let each Student Assistant monitor their own schedule, attendance, allowance, pending actions, and notifications.
// Sections:
//   - A. My Schedule
//   - B. My Attendance
//   - C. My Allowance (Clearly distinguishing Estimated vs. Approved/Released)
//   - D. My Pending Actions
//   - E. My Notifications
const SaDashboardPage = {
    components: { AppIcon, PageHeader, StatusBadge },

    setup() {
        const loading = Vue.ref(true);
        const loadError = Vue.ref("");
        const data = Vue.ref(null);

        const load = async () => {
            loading.value = true;
            loadError.value = "";
            const r = await Model.request("dashboard", "sa_summary");
            loading.value = false;
            if (!r.success) {
                loadError.value = r.message || "Could not load your Student Assistant dashboard.";
                return;
            }
            data.value = r;
        };

        Vue.onMounted(load);

        const standingBadge = (st) => {
            const map = {
                GOOD_STANDING: { label: "Good Standing", cls: "bg-emerald-100 text-emerald-900 border-emerald-300" },
                FIRST_WARNING: { label: "1st Attendance Warning", cls: "bg-amber-100 text-amber-900 border-amber-300" },
                SECOND_WARNING: { label: "2nd Attendance Warning", cls: "bg-amber-200 text-amber-950 border-amber-400" },
                UNDER_AGREEMENT: { label: "Under Agreement (Probationary)", cls: "bg-danger/10 text-danger border-danger/30" },
            };
            return map[st] || { label: st || "Good Standing", cls: "bg-emerald-100 text-emerald-900 border-emerald-300" };
        };

        const markNotificationRead = async (notif) => {
            if (!notif || notif.isRead) return;
            notif.isRead = true;
            await Model.request("notifications", "mark_read", { id: notif.id });
            if (Store.loadNotifications) Store.loadNotifications();
        };

        const copiedSaNumber = Vue.ref(false);
        const copySaNumber = async (num) => {
            if (!num) return;
            try {
                await navigator.clipboard.writeText(num);
                copiedSaNumber.value = true;
                Store.toast("success", `Copied S.A. Number: ${num}`);
                setTimeout(() => { copiedSaNumber.value = false; }, 2000);
            } catch (e) {
                Store.toast("info", `S.A. Number: ${num}`);
            }
        };

        return {
            loading, loadError, load, data,
            standingBadge, markNotificationRead, Format,
            copiedSaNumber, copySaNumber
        };
    },

    template: `
    <page-header title="My Dashboard" section="Student Assistant"
                 :subtitle="data?.profile ? 'Welcome back, ' + data.profile.name + ' · ' + (data.semester?.label || 'Active Semester') : 'Monitor your schedule, attendance, allowance, and pending actions.'">
        <template #actions>
            <router-link to="/sa/attendance-capture" class="btn btn-primary btn-sm bg-cyan-600 hover:bg-cyan-500 text-white">
                <app-icon name="ScanFace" :size="15" /> Attendance Capture
            </router-link>
            <router-link to="/sa/evaluations" class="btn btn-secondary btn-sm">
                <app-icon name="ClipboardList" :size="15" /> My Evaluation
            </router-link>
            <router-link to="/sa/allowance" class="btn btn-secondary btn-sm">
                <app-icon name="Wallet" :size="15" /> My Allowance
            </router-link>
            <router-link to="/sa/schedule" class="btn btn-primary btn-sm">
                <app-icon name="CalendarDays" :size="15" /> Open My Schedule
            </router-link>
        </template>
    </page-header>

    <div v-if="loading" class="space-y-4" aria-busy="true">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div v-for="i in 4" :key="i" class="h-24 animate-pulse rounded-xl bg-white"></div>
        </div>
        <div class="grid gap-5 lg:grid-cols-2">
            <div v-for="i in 4" :key="i" class="h-64 animate-pulse rounded-xl bg-white"></div>
        </div>
    </div>

    <div v-else-if="loadError" class="card flex flex-col items-center px-6 py-12 text-center">
        <app-icon name="CircleX" :size="28" class="text-danger" />
        <p class="mt-3 text-body font-medium text-ink">Could not load dashboard</p>
        <p class="mt-1 text-caption text-muted">{{ loadError }}</p>
        <button @click="load" class="btn btn-secondary btn-sm mt-4">
            <app-icon name="RefreshCw" :size="14" /> Try again
        </button>
    </div>

    <template v-else-if="data">
        <!-- S.A. IDENTITY BANNER -->
        <div v-if="data.profile" class="mb-5 rounded-xl border border-navy/20 bg-gradient-to-r from-navy via-navy-800 to-navy-900 p-4 text-white shadow-sm flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div class="flex items-center gap-3.5">
                <span class="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-white/10 text-gold font-bold text-lg ring-1 ring-white/20">
                    {{ (data.profile.firstName?.[0] || '') + (data.profile.lastName?.[0] || '') }}
                </span>
                <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                        <h2 class="text-[17px] font-bold text-white leading-tight">{{ data.profile.name }}</h2>
                        <span v-if="data.profile.saNumber" class="inline-flex items-center gap-1.5 rounded-md bg-gold/20 text-gold px-2.5 py-0.5 font-mono text-[12px] font-bold border border-gold/30">
                            <span>S.A. No: {{ data.profile.saNumber }}</span>
                            <button type="button" @click.stop="copySaNumber(data.profile.saNumber)" class="text-gold/80 hover:text-white transition-colors" title="Copy S.A. Number">
                                <app-icon :name="copiedSaNumber ? 'Check' : 'Copy'" :size="12" />
                            </button>
                        </span>
                    </div>
                    <p class="mt-1 text-[12px] text-white/70">
                        Student ID: <span class="font-semibold text-white">{{ data.profile.studentId }}</span> · {{ data.profile.course }} (Yr {{ data.profile.yearLevel }}) ·
                        <span class="text-white/90 font-medium">{{ data.profile.department }}</span>
                    </p>
                </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <router-link to="/sa/profile" class="btn btn-secondary btn-sm bg-white/10 hover:bg-white/20 text-white border-white/20">
                    <app-icon name="User" :size="14" /> View My Profile
                </router-link>
            </div>
        </div>

        <!-- TOP 4 PERSONAL SUMMARY CARDS -->
        <section class="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <router-link to="/sa/schedule"
                         class="card flex items-start justify-between border-l-4 border-l-navy p-4 transition hover:shadow-md">
                <div class="min-w-0">
                    <div class="text-[11px] font-bold uppercase tracking-wider text-muted">Next Scheduled Duty</div>
                    <div class="mt-1 text-[17px] font-extrabold text-navy truncate">
                        <template v-if="data.mySchedule.nextDuty">
                            {{ data.mySchedule.nextDuty.dayLabel }} · {{ data.mySchedule.nextDuty.startLabel }}
                        </template>
                        <template v-else>
                            {{ data.mySchedule.isPublished ? 'No Upcoming Shift' : 'Schedule Pending' }}
                        </template>
                    </div>
                    <div class="mt-1 text-[11px] text-muted truncate">
                        {{ data.mySchedule.assignedLocation }} · {{ data.mySchedule.creditedHours }} credited hrs/wk
                    </div>
                </div>
                <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-navy/10 text-navy">
                    <app-icon name="CalendarClock" :size="18" />
                </span>
            </router-link>

            <router-link to="/sa/profile"
                         class="card flex items-start justify-between border-l-4 p-4 transition hover:shadow-md"
                         :class="data.myAttendance.disciplinaryStatus === 'GOOD_STANDING' ? 'border-l-emerald-600' : 'border-l-amber-500'">
                <div class="min-w-0">
                    <div class="text-[11px] font-bold uppercase tracking-wider text-muted">My Attendance Status</div>
                    <div class="mt-1 text-[17px] font-extrabold truncate"
                         :class="data.myAttendance.disciplinaryStatus === 'GOOD_STANDING' ? 'text-emerald-700' : 'text-amber-800'">
                        {{ standingBadge(data.myAttendance.disciplinaryStatus).label }}
                    </div>
                    <div class="mt-1 text-[11px] text-muted">
                        {{ data.myAttendance.incidentsCount }} recorded attendance incident(s)
                    </div>
                </div>
                <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
                      :class="data.myAttendance.disciplinaryStatus === 'GOOD_STANDING' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'">
                    <app-icon name="ClipboardCheck" :size="18" />
                </span>
            </router-link>

            <router-link to="/sa/allowance"
                         class="card flex items-start justify-between border-l-4 border-l-sky-600 p-4 transition hover:shadow-md">
                <div class="min-w-0">
                    <div class="flex items-center gap-1.5">
                        <span class="text-[11px] font-bold uppercase tracking-wider text-muted">Est. Weekly Allowance</span>
                        <span class="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-amber-900">ESTIMATED</span>
                    </div>
                    <div class="mt-1 text-[20px] font-extrabold text-navy leading-none">
                        {{ Format.peso(data.myAllowance.estimatedWeekly) }}
                    </div>
                    <div class="mt-1 text-[11px] text-muted">
                        Rate: {{ Format.peso(data.myAllowance.hourlyRate) }}/hr · Est. Mo: {{ Format.peso(data.myAllowance.estimatedMonthly) }}
                    </div>
                </div>
                <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sky-100 text-sky-900">
                    <app-icon name="Wallet" :size="18" />
                </span>
            </router-link>

            <router-link :to="(data.myPendingActions && data.myPendingActions[0]?.to) || '/sa/evaluations'"
                         class="card flex items-start justify-between border-l-4 p-4 transition hover:shadow-md"
                         :class="data.actionRequiredCount > 0 ? 'border-l-danger' : 'border-l-emerald-600'">
                <div class="min-w-0">
                    <div class="text-[11px] font-bold uppercase tracking-wider text-muted">My Pending Actions</div>
                    <div class="mt-1 text-[22px] font-extrabold leading-none"
                         :class="data.actionRequiredCount > 0 ? 'text-danger' : 'text-emerald-700'">
                        {{ data.actionRequiredCount }}
                    </div>
                    <div class="mt-1 text-[11px] text-muted">
                        {{ data.actionRequiredCount > 0 ? 'Personal task(s) requiring your action' : 'All acknowledgments up to date' }}
                    </div>
                </div>
                <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg"
                      :class="data.actionRequiredCount > 0 ? 'bg-danger/10 text-danger' : 'bg-emerald-100 text-emerald-800'">
                    <app-icon name="CheckSquare" :size="18" />
                </span>
            </router-link>
        </section>

        <!-- ROW 1: SECTION D (MY PENDING ACTIONS, IF ANY) + SECTION A (MY SCHEDULE) -->
        <div class="grid gap-5 lg:grid-cols-12">
            <!-- SECTION A: MY SCHEDULE -->
            <section class="card p-5 sm:p-6 lg:col-span-7 flex flex-col justify-between">
                <div>
                    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
                        <div>
                            <h2 class="flex items-center gap-2 text-card-title text-navy">
                                <app-icon name="CalendarDays" :size="18" /> A. My Schedule
                            </h2>
                            <p class="text-caption text-muted">
                                Next scheduled duty, today's schedule ({{ data.mySchedule.todayLabel }}), assigned post, and schedule notices.
                            </p>
                        </div>
                        <router-link to="/sa/schedule" class="btn btn-primary btn-sm">
                            <app-icon name="Calendar" :size="14" /> Full Weekly Grid
                        </router-link>
                    </div>

                    <!-- Assignment & Next Scheduled Duty Strip -->
                    <div class="mt-4 grid gap-3 sm:grid-cols-2">
                        <div class="rounded-xl border border-line bg-page/60 p-3.5">
                            <div class="flex items-center justify-between">
                                <span class="text-[11px] font-bold uppercase tracking-wider text-muted">Official Assignment</span>
                                <span class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase whitespace-nowrap shrink-0"
                                      :class="data.mySchedule.isPublished ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'">
                                    {{ data.mySchedule.isPublished ? 'Published' : 'Pending Publication' }}
                                </span>
                            </div>
                            <div class="mt-1.5 text-[15px] font-bold text-navy">{{ data.mySchedule.assignedLocation }}</div>
                            <div class="mt-0.5 text-caption text-muted">
                                Supervisor: <strong class="text-ink">{{ data.mySchedule.supervisorName }}</strong>
                            </div>
                            <div class="mt-1 text-[11px] text-muted">
                                Weekly Duty: <strong class="text-emerald-700">{{ data.mySchedule.creditedHours }} credited hrs/wk</strong>
                                ({{ data.mySchedule.rawHours }} raw hrs · {{ data.mySchedule.blocksCount }} blocks)
                            </div>
                        </div>

                        <div class="rounded-xl border p-3.5"
                             :class="data.mySchedule.nextDuty ? 'border-navy/25 bg-navy/[0.03]' : 'border-line bg-page/40'">
                            <div class="flex items-center justify-between">
                                <span class="text-[11px] font-bold uppercase tracking-wider text-muted">Next Scheduled Duty</span>
                                <span v-if="data.mySchedule.nextDuty"
                                      class="rounded px-2 py-0.5 text-[10px] font-extrabold uppercase"
                                      :class="data.mySchedule.nextDuty.roleBadge === 'RELIEVER' ? 'bg-teal-100 text-teal-900' : 'bg-navy text-white'">
                                    {{ data.mySchedule.nextDuty.roleBadge }}
                                </span>
                            </div>
                            <template v-if="data.mySchedule.nextDuty">
                                <div class="mt-1.5 text-[15px] font-bold text-navy">
                                    {{ data.mySchedule.nextDuty.dayLabel }} · {{ data.mySchedule.nextDuty.location }}
                                </div>
                                <div class="mt-0.5 text-caption font-semibold text-ink">
                                    {{ data.mySchedule.nextDuty.startLabel }} – {{ data.mySchedule.nextDuty.endLabel }}
                                    ({{ data.mySchedule.nextDuty.creditedHours }}h credited)
                                </div>
                                <div class="mt-1 text-[11px] font-bold text-emerald-700">
                                    {{ data.mySchedule.nextDuty.statusLabel }}
                                </div>
                            </template>
                            <template v-else>
                                <div class="mt-2 text-caption text-muted">
                                    {{ data.mySchedule.isPublished ? 'No upcoming duty blocks scheduled.' : 'Your official schedule will appear here once published by the S.A. Coordinator.' }}
                                </div>
                            </template>
                        </div>
                    </div>

                    <!-- Today's Duty & Class Periods -->
                    <div class="mt-4">
                        <div class="flex items-center justify-between mb-2">
                            <span class="text-caption font-bold uppercase tracking-wider text-muted">
                                Today's Schedule ({{ data.mySchedule.todayLabel }})
                            </span>
                            <span class="text-[11px] text-muted">
                                {{ data.mySchedule.todayDuty.length }} Duty · {{ data.mySchedule.todayClasses.length }} Class(es)
                            </span>
                        </div>

                        <div v-if="!data.mySchedule.todayDuty.length && !data.mySchedule.todayClasses.length"
                             class="rounded-xl border border-line bg-page/40 p-4 text-center text-caption text-muted">
                            No duty or class periods scheduled for {{ data.mySchedule.todayLabel }}.
                        </div>

                        <div v-else class="space-y-2">
                            <div v-for="(b, idx) in data.mySchedule.todayDuty" :key="'td-' + idx"
                                 class="flex items-center justify-between rounded-lg border px-3.5 py-2.5"
                                 :class="b.roleBadge === 'RELIEVER' ? 'border-teal-300 bg-teal-50/70' : 'border-emerald-300 bg-emerald-50/70'">
                                <div>
                                    <div class="flex items-center gap-2">
                                        <span class="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
                                              :class="b.roleBadge === 'RELIEVER' ? 'bg-teal-700 text-white' : 'bg-emerald-700 text-white'">
                                            {{ b.roleBadge || 'PRIMARY' }} DUTY
                                        </span>
                                        <span class="text-[13px] font-bold text-ink">{{ b.location }}</span>
                                    </div>
                                    <div class="mt-0.5 text-[12px] text-muted">
                                        {{ b.startLabel }} – {{ b.endLabel }}
                                        <span v-if="b.hasBreak" class="ml-1 font-semibold">(-1h lunch break)</span>
                                    </div>
                                </div>
                                <span class="rounded bg-white border border-line px-2 py-0.5 text-[11px] font-bold text-navy">
                                    {{ b.credited }}h
                                </span>
                            </div>

                            <div v-for="(c, idx) in data.mySchedule.todayClasses" :key="'tc-' + idx"
                                 class="flex items-center justify-between rounded-lg border border-sky-300 bg-sky-50/70 px-3.5 py-2">
                                <div>
                                    <div class="text-[12px] font-bold text-sky-950">
                                        CLASS: {{ c.subject }} <span v-if="c.section" class="font-mono text-[11px]">({{ c.section }})</span>
                                    </div>
                                    <div class="text-[11px] text-sky-800">{{ c.startLabel }} – {{ c.endLabel }}</div>
                                </div>
                                <span class="rounded bg-sky-200 px-2 py-0.5 text-[11px] font-bold text-sky-900">{{ c.hours }}h</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Recent Official Schedule Changes -->
                <div v-if="(data.mySchedule.recentChanges || []).length" class="mt-4 border-t border-line pt-3">
                    <div class="text-[11px] font-bold uppercase tracking-wider text-muted mb-1.5">
                        Recent Official Schedule Adjustments
                    </div>
                    <ul class="space-y-1 text-[11px] text-muted">
                        <li v-for="ch in data.mySchedule.recentChanges.slice(0, 2)" :key="ch.id" class="truncate">
                            <strong class="text-navy">{{ ch.effectiveDate || 'Updated' }}:</strong>
                            {{ ch.reason || ch.newValue }}
                        </li>
                    </ul>
                </div>
            </section>

            <!-- SECTION D: MY PENDING ACTIONS -->
            <section class="card p-5 sm:p-6 lg:col-span-5 flex flex-col justify-between">
                <div>
                    <div class="flex items-start justify-between gap-3 border-b border-line pb-3">
                        <div class="min-w-0 pr-2">
                            <h2 class="flex items-center gap-2 text-card-title text-navy">
                                <app-icon name="CheckSquare" :size="18" /> D. My Pending Actions
                            </h2>
                            <p class="text-caption text-muted">
                                Evaluation acknowledgment, school balance deduction poll, and personal requests.
                            </p>
                        </div>
                        <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap shrink-0"
                              :class="data.actionRequiredCount > 0 ? 'bg-danger/10 text-danger border border-danger/20' : 'bg-emerald-100 text-emerald-900 border border-emerald-200'">
                            <span v-if="data.actionRequiredCount > 0" class="h-1.5 w-1.5 rounded-full bg-danger animate-pulse"></span>
                            <span>{{ data.actionRequiredCount > 0 ? (data.actionRequiredCount + ' Urgent') : 'All Clear' }}</span>
                        </span>
                    </div>

                    <div v-if="!(data.myPendingActions || []).length"
                         class="mt-4 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                        <app-icon name="CircleCheck" :size="20" class="shrink-0 text-emerald-700" />
                        <div>
                            <p class="text-body font-bold text-emerald-950">No Pending Personal Actions</p>
                            <p class="text-caption text-emerald-800">
                                You have no pending evaluation acknowledgments, deduction polls, or warning memos requiring action.
                            </p>
                        </div>
                    </div>

                    <ul v-else class="mt-4 space-y-3">
                        <li v-for="act in data.myPendingActions" :key="act.key"
                            class="rounded-xl border p-3.5"
                            :class="act.priority === 'HIGH' ? 'border-amber-300 bg-amber-50/50' : (act.priority === 'SUCCESS' ? 'border-emerald-200 bg-emerald-50/40' : 'border-line bg-page/40')">
                            <div class="flex flex-wrap items-center justify-between gap-2">
                                <span class="text-[10px] font-bold uppercase tracking-wider text-muted">{{ act.type }}</span>
                                <span class="rounded-full px-2.5 py-0.5 text-[10px] font-bold whitespace-nowrap shrink-0"
                                      :class="act.priority === 'HIGH' ? 'bg-amber-200 text-amber-950' : (act.priority === 'SUCCESS' ? 'bg-emerald-100 text-emerald-900' : 'bg-sky-100 text-sky-900')">
                                    {{ act.badge }}
                                </span>
                            </div>
                            <p class="mt-1 text-body font-bold text-navy">{{ act.title }}</p>
                            <p class="mt-0.5 text-caption text-muted">{{ act.detail }}</p>
                            <div class="mt-2.5 flex justify-end">
                                <router-link :to="act.to" class="btn btn-sm"
                                             :class="act.priority === 'HIGH' ? 'btn-primary' : 'btn-secondary'">
                                    {{ act.actionLabel }} <app-icon name="ArrowRight" :size="14" />
                                </router-link>
                            </div>
                        </li>
                    </ul>
                </div>

                <!-- Quick Links to Personal Modules -->
                <div class="mt-5 border-t border-line pt-4 flex flex-wrap items-center justify-between gap-2 text-caption">
                    <router-link to="/sa/evaluations" class="font-semibold text-navy hover:underline">
                        My Performance Evaluation →
                    </router-link>
                    <router-link to="/sa/profile" class="font-semibold text-navy hover:underline">
                        My Profile &amp; Academic Record →
                    </router-link>
                </div>
            </section>
        </div>

        <!-- ROW 2: SECTION C (MY ALLOWANCE) + SECTION B (MY ATTENDANCE) + SECTION E (MY NOTIFICATIONS) -->
        <div class="mt-5 grid gap-5 lg:grid-cols-12">
            <!-- SECTION C: MY ALLOWANCE (Clearly Distinguishing Estimated vs Approved/Released) -->
            <section class="card p-5 sm:p-6 lg:col-span-5 flex flex-col justify-between">
                <div>
                    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
                        <div>
                            <h2 class="flex items-center gap-2 text-card-title text-navy">
                                <app-icon name="Wallet" :size="18" /> C. My Allowance
                            </h2>
                            <p class="text-caption text-muted">
                                Hourly rate, credited hours, estimated allowance, and school balance adjustments.
                            </p>
                        </div>
                        <router-link to="/sa/allowance" class="btn btn-secondary btn-sm">
                            Details →
                        </router-link>
                    </div>

                    <!-- Important Distinction Banner: Estimated vs Released -->
                    <div class="mt-4 rounded-xl border border-amber-300 bg-amber-50/70 p-3 text-[11px] text-amber-950">
                        <div class="font-bold uppercase tracking-wider text-amber-900 flex items-center gap-1.5">
                            <app-icon name="Info" :size="13" /> Estimated vs. Approved / Released Allowance
                        </div>
                        <p class="mt-0.5 text-amber-900">
                            {{ data.myAllowance.allowanceNotice }}
                        </p>
                    </div>

                    <!-- Rate & Estimated Figures -->
                    <div class="mt-3.5 grid grid-cols-2 gap-2.5">
                        <div class="rounded-lg border border-line bg-page/50 p-3">
                            <div class="text-[10px] font-bold uppercase text-muted">Current Hourly Rate</div>
                            <div class="mt-0.5 text-[18px] font-extrabold text-navy">
                                {{ Format.peso(data.myAllowance.hourlyRate) }}<span class="text-caption font-normal text-muted">/hr</span>
                            </div>
                            <div class="text-[10px] text-muted">{{ data.myAllowance.approvedCreditedHours }} credited hrs/wk</div>
                        </div>
                        <div class="rounded-lg border border-line bg-page/50 p-3">
                            <div class="text-[10px] font-bold uppercase text-muted">Est. 15-Day / Monthly</div>
                            <div class="mt-0.5 text-[16px] font-extrabold text-navy">
                                {{ Format.peso(data.myAllowance.estimatedBiweekly) }}
                                <span class="text-[11px] font-semibold text-muted">/ {{ Format.peso(data.myAllowance.estimatedMonthly) }}</span>
                            </div>
                            <div class="text-[10px] font-semibold text-amber-800">Status: ESTIMATED</div>
                        </div>
                    </div>

                    <!-- Scholarship Benefits & School Balance Adjustment -->
                    <div class="mt-3.5 rounded-xl border border-line bg-page/40 p-3.5">
                        <div class="flex items-center justify-between">
                            <span class="text-[11px] font-bold uppercase tracking-wider text-muted">
                                Scholarship &amp; School Balance Adjustment
                            </span>
                            <router-link to="/sa/school-balance" class="text-[11px] font-semibold text-navy hover:underline">
                                Open School Balance →
                            </router-link>
                        </div>
                        <div class="mt-2 grid grid-cols-2 gap-2 text-caption">
                            <div>
                                <span class="text-muted text-[11px]">Scholarship Covered:</span>
                                <div class="font-bold text-emerald-700">
                                    {{ data.myAllowance.benefits?.totalCovered !== null ? Format.peso(data.myAllowance.benefits.totalCovered) : '100% Tuition + 70% Misc' }}
                                </div>
                            </div>
                            <div>
                                <span class="text-muted text-[11px]">Remaining School Balance:</span>
                                <div class="font-bold text-navy">
                                    {{ data.myAllowance.benefits?.balance !== null ? Format.peso(data.myAllowance.benefits.balance) : '₱0.00' }}
                                </div>
                            </div>
                        </div>
                        <div v-if="data.myAllowance.deductionCampaign" class="mt-2.5 border-t border-line pt-2 text-[11px]">
                            <span class="text-muted">Allowance Deduction Poll ({{ data.myAllowance.deductionCampaign.title }}):</span>
                            <span v-if="data.myAllowance.deductionCampaign.myResponse"
                                  class="ml-1 font-bold"
                                  :class="data.myAllowance.deductionCampaign.myResponse.choice === 'YES' ? 'text-emerald-800' : 'text-ink'">
                                {{ data.myAllowance.deductionCampaign.myResponse.choice === 'YES'
                                    ? 'YES — Deduct ' + Format.peso(data.myAllowance.deductionCampaign.myResponse.amount)
                                    : 'NO — Do Not Deduct' }}
                            </span>
                            <router-link v-else to="/sa/school-balance" class="ml-1 font-bold text-danger underline">
                                Pending Your YES/NO Reply →
                            </router-link>
                        </div>
                    </div>
                </div>
            </section>

            <!-- SECTION B: MY ATTENDANCE -->
            <section class="card p-5 sm:p-6 lg:col-span-4 flex flex-col justify-between">
                <div>
                    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
                        <div>
                            <h2 class="flex items-center gap-2 text-card-title text-navy">
                                <app-icon name="ClipboardCheck" :size="18" /> B. My Attendance
                            </h2>
                            <p class="text-caption text-muted">
                                Personal attendance standing and recorded logs.
                            </p>
                        </div>
                        <span class="rounded-full border px-2.5 py-0.5 text-[10px] font-bold whitespace-nowrap shrink-0"
                              :class="standingBadge(data.myAttendance.disciplinaryStatus).cls">
                            {{ standingBadge(data.myAttendance.disciplinaryStatus).label }}
                        </span>
                    </div>

                    <div v-if="!(data.myAttendance.incidents || []).length"
                         class="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-4 text-center">
                        <app-icon name="CircleCheck" :size="20" class="mx-auto text-emerald-700" />
                        <p class="mt-1.5 text-caption font-bold text-emerald-950">Clean Attendance Record</p>
                        <p class="mt-0.5 text-[11px] text-emerald-800">
                            No late, undertime, or absence discrepancies recorded for this semester.
                        </p>
                    </div>

                    <ul v-else class="mt-4 space-y-2.5 max-h-[280px] overflow-y-auto pr-1">
                        <li v-for="inc in data.myAttendance.incidents" :key="inc.id"
                            class="rounded-xl border border-line bg-page/40 p-3 text-[11px]">
                            <div class="flex items-center justify-between">
                                <strong class="text-navy">{{ inc.incidentDate }}</strong>
                                <span class="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
                                      :class="inc.category === 'ABSENT' ? 'bg-danger/10 text-danger' : 'bg-amber-100 text-amber-900'">
                                    {{ inc.category }}
                                </span>
                            </div>
                            <div class="mt-1 text-muted">
                                Shift: {{ inc.scheduledPeriod }} · Time In/Out: <strong class="text-ink">{{ inc.timeIn }} / {{ inc.timeOut }}</strong>
                            </div>
                            <div v-if="inc.minutesAffected > 0" class="mt-0.5 text-ink">
                                Affected: <strong>{{ inc.minutesAffected }} min(s)</strong> · Status: {{ inc.status }}
                            </div>
                        </li>
                    </ul>
                </div>

                <div class="mt-4 border-t border-line pt-3 flex items-center justify-between text-caption">
                    <span class="text-[11px] text-muted">Warning Memos: {{ (data.myAttendance.warningMemos || []).length }}</span>
                    <router-link to="/sa/profile" class="font-semibold text-navy hover:underline">
                        View Attendance Record →
                    </router-link>
                </div>
            </section>

            <!-- SECTION E: MY NOTIFICATIONS -->
            <section class="card p-5 sm:p-6 lg:col-span-3 flex flex-col justify-between">
                <div>
                    <div class="border-b border-line pb-3">
                        <h2 class="flex items-center gap-2 text-card-title text-navy">
                            <app-icon name="BellRing" :size="18" /> E. My Notifications
                        </h2>
                        <p class="text-caption text-muted">
                            Schedule, allowance, evaluation &amp; Coordinator notices.
                        </p>
                    </div>

                    <div v-if="!(data.myNotifications || []).length"
                         class="mt-4 rounded-xl border border-line bg-page/40 p-5 text-center text-caption text-muted">
                        No notifications yet.
                    </div>

                    <ul v-else class="mt-3 divide-y divide-line max-h-[290px] overflow-y-auto pr-1">
                        <li v-for="n in data.myNotifications" :key="n.id"
                            @click="markNotificationRead(n)"
                            class="py-2.5 px-1.5 cursor-pointer rounded transition hover:bg-page/50"
                            :class="!n.isRead ? 'bg-navy/[0.03]' : ''">
                            <div class="flex items-start justify-between gap-1.5">
                                <span class="text-[12px] font-bold text-navy leading-snug flex items-center gap-1">
                                    <span v-if="!n.isRead" class="h-1.5 w-1.5 rounded-full bg-gold shrink-0"></span>
                                    {{ n.title }}
                                </span>
                                <span class="shrink-0 text-[10px] text-muted">{{ n.timeAgo }}</span>
                            </div>
                            <p class="mt-0.5 text-[11px] text-muted line-clamp-2">{{ n.message }}</p>
                        </li>
                    </ul>
                </div>
            </section>
        </div>
    </template>
    `
};
