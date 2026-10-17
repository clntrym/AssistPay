// Perfect Attendance Recognition & Streaks View (/admin/perfect-attendance)
// S.A. Coordinator Monthly Recognition & Streaks Overview
// Strictly matches the AssistPay reference UI (media_1792212643034_21d47d47.png)

const AdminPerfectAttendancePage = {
    components: { AppIcon, PageHeader, StatusBadge, AppModal },

    setup() {
        const route = VueRouter.useRoute();
        const router = VueRouter.useRouter();

        const loading = Vue.ref(true);
        const loadError = Vue.ref("");
        const selectedPeriodKey = Vue.ref("");
        const availableMonths = Vue.ref([]);
        const currentPeriod = Vue.ref({
            month: 10,
            year: 2026,
            monthName: "October",
            label: "October 2026"
        });

        // 4 Top KPI Cards
        const kpis = Vue.ref({
            perfectAttendance: { count: 12, subtitle: "This Month", trend: "+3 vs. last month", trendPositive: true },
            activeStreaks: { count: 38, subtitle: "Currently tracking", trend: "+6 vs. last month", trendPositive: true },
            longestStreak: { count: 42, label: "42 days", subtitle: "S.A. of the Year", trend: "+7 vs. last month", trendPositive: true },
            pendingVerification: { count: 3, subtitle: "Attendance records", trend: "-2 vs. last month", trendPositive: false }
        });

        // Sidecards
        const sideCards = Vue.ref({
            monthEndVerification: { dueCount: 3, message: "3 attendance records need verification before month-end.", link: "#/admin/attendance" },
            aiAssistantInsights: { message: "3 attendance records need verification before month-end.", action: "open_ai_assistant" }
        });

        // Champions Leaderboard
        const champions = Vue.ref([]);

        // Mystery Token Card
        const mysteryToken = Vue.ref({
            title: "Mystery Token of Appreciation",
            subtitle: "Next month's surprise is waiting...",
            clue: "A little something to brighten your S.A. journey.",
            targetMonth: 11,
            targetYear: 2026,
            targetMonthLabel: "November 2026",
            visibility: "VISIBLE",
            visibilityLabel: "Visible to all S.A.s",
            imageUrl: null
        });

        // Calendar Streak Widget
        const calendarStreak = Vue.ref({
            month: 10,
            year: 2026,
            monthName: "October",
            label: "October 2026",
            days: [],
            currentStreak: 18,
            currentStreakSubtitle: "Keep it up!"
        });

        // Streak Pet Evolution Widget
        const streakPetEvolution = Vue.ref({
            stage: 3,
            stageName: "Baby Pet",
            streakDays: 18,
            progressDays: 18,
            targetDays: 30,
            percent: 60,
            message: "Your Pet is at Stage 3! Just a few more days to unlock the next stage!",
            stages: []
        });

        // Modals
        const mysteryModalOpen = Vue.ref(false);
        const mysteryForm = Vue.reactive({
            title: "Mystery Token of Appreciation",
            clue: "A little something to brighten your S.A. journey.",
            targetMonth: 11,
            targetYear: 2026,
            visibility: "VISIBLE",
            imageUrl: ""
        });
        const savingMystery = Vue.ref(false);

        const previewModalOpen = Vue.ref(false);
        const saDetailModalOpen = Vue.ref(false);
        const activeSaDetail = Vue.ref(null);
        const detailLoading = Vue.ref(false);

        // Verification Roster Modal / View
        const verificationModalOpen = Vue.ref(false);
        const verifying = Vue.ref(false);
        const verification = Vue.ref({
            status: "VERIFIED",
            qualifiedCount: 12,
            totalEvaluated: 77,
            verifiedAt: null
        });

        const initFromRoute = () => {
            const qMonth = parseInt(route.query.month, 10);
            const qYear = parseInt(route.query.year, 10);
            if (qMonth && qYear) {
                selectedPeriodKey.value = `${qYear}-${qMonth}`;
            }
        };

        const loadOverview = async () => {
            loading.value = true;
            loadError.value = "";

            let m = 0;
            let y = 0;
            if (selectedPeriodKey.value) {
                const parts = selectedPeriodKey.value.split("-");
                y = parseInt(parts[0], 10);
                m = parseInt(parts[1], 10);
            }

            try {
                const r = await Model.request("attendance", "coordinator_streaks_overview", {
                    month: m || undefined,
                    year: y || undefined
                });

                if (r && r.success) {
                    if (r.period) currentPeriod.value = r.period;
                    if (r.kpis) kpis.value = r.kpis;
                    if (r.sideCards) sideCards.value = r.sideCards;
                    if (r.champions) champions.value = r.champions;
                    if (r.mysteryToken) {
                        mysteryToken.value = r.mysteryToken;
                        mysteryForm.title = r.mysteryToken.title;
                        mysteryForm.clue = r.mysteryToken.clue;
                        mysteryForm.targetMonth = r.mysteryToken.targetMonth;
                        mysteryForm.targetYear = r.mysteryToken.targetYear;
                        mysteryForm.visibility = r.mysteryToken.visibility;
                        mysteryForm.imageUrl = r.mysteryToken.imageUrl || "";
                    }
                    if (r.calendarStreak) calendarStreak.value = r.calendarStreak;
                    if (r.streakPetEvolution) streakPetEvolution.value = r.streakPetEvolution;
                    if (r.availableMonths) availableMonths.value = r.availableMonths;

                    if (!selectedPeriodKey.value && r.period) {
                        selectedPeriodKey.value = `${r.period.year}-${r.period.month}`;
                    }
                } else {
                    loadError.value = r?.message || "Failed to load Perfect Attendance & Streaks overview.";
                }
            } catch (err) {
                loadError.value = err?.message || "An unexpected error occurred while loading data.";
            } finally {
                loading.value = false;
            }
        };

        const onPeriodChange = () => {
            if (selectedPeriodKey.value) {
                const parts = selectedPeriodKey.value.split("-");
                const y = parseInt(parts[0], 10);
                const m = parseInt(parts[1], 10);
                router.replace({
                    path: "/admin/perfect-attendance",
                    query: { month: m, year: y }
                });
            }
            loadOverview();
        };

        const prevMonth = () => {
            let m = currentPeriod.value.month - 1;
            let y = currentPeriod.value.year;
            if (m < 1) { m = 12; y--; }
            selectedPeriodKey.value = `${y}-${m}`;
            onPeriodChange();
        };

        const nextMonth = () => {
            let m = currentPeriod.value.month + 1;
            let y = currentPeriod.value.year;
            if (m > 12) { m = 1; y++; }
            selectedPeriodKey.value = `${y}-${m}`;
            onPeriodChange();
        };

        // Open Mystery Token edit modal
        const openMysteryModal = () => {
            mysteryModalOpen.value = true;
        };

        // Save Mystery Token
        const saveMysteryTokenAction = async () => {
            savingMystery.value = true;
            try {
                const r = await Model.request("attendance", "save_mystery_token", {
                    title: mysteryForm.title,
                    clue: mysteryForm.clue,
                    targetMonth: mysteryForm.targetMonth,
                    targetYear: mysteryForm.targetYear,
                    visibility: mysteryForm.visibility,
                    imageUrl: mysteryForm.imageUrl || null
                });
                if (r && r.success) {
                    mysteryToken.value = r.mysteryToken;
                    mysteryModalOpen.value = false;
                    Store.toast("success", "Mystery Token of Appreciation updated successfully!");
                } else {
                    Store.toast("error", r?.message || "Failed to save Mystery Token.");
                }
            } catch (err) {
                Store.toast("error", err?.message || "Failed to save Mystery Token.");
            } finally {
                savingMystery.value = false;
            }
        };

        // Preview announcement modal
        const openPreviewModal = () => {
            previewModalOpen.value = true;
        };

        // View S.A. attendance details modal
        const viewSaDetails = async (sa) => {
            activeSaDetail.value = sa;
            saDetailModalOpen.value = true;
            detailLoading.value = true;
            try {
                const r = await Model.request("attendance", "sa_attendance_history_table", {
                    saProfileId: sa.saProfileId,
                    month: currentPeriod.value.month,
                    year: currentPeriod.value.year
                });
                if (r && r.success) {
                    activeSaDetail.value.history = r.history || [];
                }
            } catch (e) {
                console.error(e);
            } finally {
                detailLoading.value = false;
            }
        };

        const openAiAssistant = () => {
            if (Store.openAiChat) {
                Store.openAiChat("Analyze monthly attendance consistency, streaks, and pending verifications.");
            } else {
                Store.toast("info", "Opening AI Assistant for attendance verification insights...");
                window.dispatchEvent(new CustomEvent("open-coordinator-ai", {
                    detail: { prompt: "Analyze monthly attendance consistency, streaks, and pending verifications." }
                }));
            }
        };

        const goToAttendanceReview = () => {
            router.push("/admin/attendance");
        };

        // Force Re-verify Monthly attendance
        const reVerifyMonthly = async () => {
            verifying.value = true;
            try {
                const parts = selectedPeriodKey.value.split("-");
                const y = parseInt(parts[0], 10) || currentPeriod.value.year;
                const m = parseInt(parts[1], 10) || currentPeriod.value.month;
                const r = await Model.request("attendance", "perfect_attendance_verify", {
                    month: m,
                    year: y,
                    force: true
                });
                if (r && r.success) {
                    Store.toast("success", `Monthly attendance verified: ${r.verification?.qualifiedCount || 0} qualified S.A.(s).`);
                    await loadOverview();
                } else {
                    Store.toast("error", r?.message || "Failed to re-verify monthly attendance.");
                }
            } catch (e) {
                Store.toast("error", e?.message || "Failed to re-verify monthly attendance.");
            } finally {
                verifying.value = false;
            }
        };

        Vue.onMounted(() => {
            initFromRoute();
            loadOverview();
        });

        return {
            loading, verifying, loadError,
            selectedPeriodKey, availableMonths, currentPeriod,
            kpis, sideCards, champions, mysteryToken, calendarStreak, streakPetEvolution,
            mysteryModalOpen, mysteryForm, savingMystery, openMysteryModal, saveMysteryTokenAction,
            previewModalOpen, openPreviewModal,
            saDetailModalOpen, activeSaDetail, detailLoading, viewSaDetails,
            openAiAssistant, goToAttendanceReview, reVerifyMonthly,
            onPeriodChange, prevMonth, nextMonth, router
        };
    },

    template: `
    <div class="space-y-6 pb-12">
        <!-- TOP HEADER & CONTROLS -->
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200/80 dark:border-navy-700/80 pb-4">
            <div>
                <div class="flex items-center gap-2.5">
                    <span class="text-amber-500 text-xl font-black">⭐</span>
                    <h1 class="text-2xl font-black tracking-tight text-navy dark:text-white">Perfect Attendance & Streaks</h1>
                </div>
                <p class="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Recognize consistency. Celebrate progress.</p>
            </div>

            <!-- Month Filter & Verification Controls -->
            <div class="flex items-center flex-wrap gap-2.5">
                <div class="flex items-center rounded-xl border border-slate-200 bg-white px-3 py-1.5 shadow-2xs dark:border-navy-700 dark:bg-navy-800">
                    <app-icon name="Calendar" :size="14" class="text-slate-400 mr-2" />
                    <select v-model="selectedPeriodKey" @change="onPeriodChange"
                            class="bg-transparent text-xs font-semibold text-slate-700 outline-hidden dark:text-slate-200 cursor-pointer">
                        <option v-for="m in availableMonths" :key="m.year + '-' + m.month" :value="m.year + '-' + m.month">
                            {{ m.label }} {{ m.isCurrent ? '(Current)' : '' }}
                        </option>
                        <option v-if="!availableMonths.length" value="2026-10">October 2026</option>
                    </select>
                </div>

                <button @click="reVerifyMonthly" :disabled="verifying"
                        class="inline-flex items-center gap-1.5 rounded-xl border border-amber-300/80 bg-amber-50/70 px-3 py-1.5 text-xs font-semibold text-amber-900 transition hover:bg-amber-100 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300">
                    <app-icon name="RotateCw" :size="13" :class="verifying ? 'animate-spin' : ''" />
                    <span>{{ verifying ? 'Verifying...' : 'Re-verify Attendance' }}</span>
                </button>
            </div>
        </div>

        <!-- LOADING STATE -->
        <div v-if="loading" class="flex flex-col items-center justify-center py-20">
            <div class="h-10 w-10 animate-spin rounded-full border-3 border-navy border-t-transparent dark:border-white dark:border-t-transparent"></div>
            <p class="mt-3 text-xs font-medium text-slate-500">Loading Perfect Attendance & Streaks data...</p>
        </div>

        <!-- ERROR STATE -->
        <div v-else-if="loadError" class="rounded-2xl border border-rose-200 bg-rose-50 p-6 text-center text-rose-800 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300">
            <app-icon name="AlertTriangle" :size="32" class="mx-auto mb-2 text-rose-600" />
            <h3 class="font-bold text-sm">Failed to load overview</h3>
            <p class="text-xs mt-1 text-rose-700 dark:text-rose-400">{{ loadError }}</p>
            <button @click="loadOverview" class="mt-3 btn btn-sm bg-rose-600 hover:bg-rose-500 text-white">Retry</button>
        </div>

        <div v-else class="space-y-6">
            <!-- 4 TOP KPI CARDS + 2 RIGHT SIDECARDS -->
            <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
                <!-- 4 KPI CARDS (Takes 8 columns on large screens) -->
                <div class="lg:col-span-8 grid grid-cols-2 sm:grid-cols-4 gap-3.5">
                    <!-- KPI 1: Perfect Attendance -->
                    <div class="rounded-2xl border border-emerald-200/80 bg-white p-4 shadow-2xs dark:border-navy-700 dark:bg-navy-800 flex flex-col justify-between">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-medium text-slate-500 dark:text-slate-400">Perfect Attendance</span>
                            <div class="grid h-8 w-8 place-items-center rounded-full bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
                                <app-icon name="Trophy" :size="16" />
                            </div>
                        </div>
                        <div class="mt-2">
                            <div class="text-[11px] text-slate-400">This Month</div>
                            <div class="text-2xl font-black text-navy dark:text-white">{{ kpis.perfectAttendance.count }}</div>
                            <div class="mt-1 text-[10px] font-bold text-emerald-600 flex items-center gap-0.5">
                                <span>▲</span> {{ kpis.perfectAttendance.trend }}
                            </div>
                        </div>
                    </div>

                    <!-- KPI 2: Active Streaks -->
                    <div class="rounded-2xl border border-orange-200/80 bg-white p-4 shadow-2xs dark:border-navy-700 dark:bg-navy-800 flex flex-col justify-between">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-medium text-slate-500 dark:text-slate-400">Active Streaks</span>
                            <div class="grid h-8 w-8 place-items-center rounded-full bg-orange-100 text-orange-600 dark:bg-orange-950/50 dark:text-orange-400">
                                <app-icon name="Flame" :size="16" />
                            </div>
                        </div>
                        <div class="mt-2">
                            <div class="text-[11px] text-slate-400">Currently tracking</div>
                            <div class="text-2xl font-black text-navy dark:text-white">{{ kpis.activeStreaks.count }}</div>
                            <div class="mt-1 text-[10px] font-bold text-emerald-600 flex items-center gap-0.5">
                                <span>▲</span> {{ kpis.activeStreaks.trend }}
                            </div>
                        </div>
                    </div>

                    <!-- KPI 3: Longest Streak -->
                    <div class="rounded-2xl border border-purple-200/80 bg-white p-4 shadow-2xs dark:border-navy-700 dark:bg-navy-800 flex flex-col justify-between">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-medium text-slate-500 dark:text-slate-400">Longest Streak</span>
                            <div class="grid h-8 w-8 place-items-center rounded-full bg-purple-100 text-purple-600 dark:bg-purple-950/50 dark:text-purple-400">
                                <app-icon name="Crown" :size="16" />
                            </div>
                        </div>
                        <div class="mt-2">
                            <div class="text-[11px] text-slate-400">S.A. of the Year</div>
                            <div class="text-2xl font-black text-navy dark:text-white">{{ kpis.longestStreak.label || (kpis.longestStreak.count + ' days') }}</div>
                            <div class="mt-1 text-[10px] font-bold text-emerald-600 flex items-center gap-0.5">
                                <span>▲</span> {{ kpis.longestStreak.trend }}
                            </div>
                        </div>
                    </div>

                    <!-- KPI 4: Pending Verification -->
                    <div class="rounded-2xl border border-amber-200/80 bg-white p-4 shadow-2xs dark:border-navy-700 dark:bg-navy-800 flex flex-col justify-between">
                        <div class="flex items-center justify-between">
                            <span class="text-xs font-medium text-slate-500 dark:text-slate-400">Pending Verification</span>
                            <div class="grid h-8 w-8 place-items-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400">
                                <app-icon name="Clock" :size="16" />
                            </div>
                        </div>
                        <div class="mt-2">
                            <div class="text-[11px] text-slate-400">Attendance records</div>
                            <div class="text-2xl font-black text-navy dark:text-white">{{ kpis.pendingVerification.count }}</div>
                            <div class="mt-1 text-[10px] font-bold text-slate-500 flex items-center gap-0.5">
                                <span>▼</span> {{ kpis.pendingVerification.trend }}
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 2 SIDECARDS (Takes 4 columns on large screens) -->
                <div class="lg:col-span-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-3.5">
                    <!-- SIDECARD 1: Month-end verification due -->
                    <div class="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs dark:border-navy-700 dark:bg-navy-800 flex flex-col justify-between">
                        <div class="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
                            <span class="flex h-2 w-2 rounded-full bg-rose-500"></span>
                            <span>Month-end verification due</span>
                        </div>
                        <p class="mt-1.5 text-xs text-slate-600 dark:text-slate-400">
                            <strong class="font-bold text-slate-900 dark:text-white">{{ sideCards.monthEndVerification.dueCount }}</strong> attendance records need verification before month-end.
                        </p>
                        <div class="mt-3">
                            <button @click="goToAttendanceReview"
                                    class="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 px-3.5 py-2 text-xs font-semibold text-white shadow-2xs transition active:scale-98">
                                <span>Go to Attendance Review</span>
                            </button>
                        </div>
                    </div>

                    <!-- SIDECARD 2: AI Assistant Insights -->
                    <div class="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs dark:border-navy-700 dark:bg-navy-800 flex flex-col justify-between">
                        <div class="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
                            <span class="text-blue-500">🤖</span>
                            <span>AI Assistant Insights</span>
                            <span class="text-amber-500 text-xs">✨</span>
                        </div>
                        <p class="mt-1.5 text-xs text-slate-600 dark:text-slate-400">
                            {{ sideCards.aiAssistantInsights.message }}
                        </p>
                        <div class="mt-3">
                            <button @click="openAiAssistant"
                                    class="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-blue-500 bg-white dark:bg-navy-800 px-3.5 py-2 text-xs font-semibold text-blue-600 dark:text-blue-400 shadow-2xs transition hover:bg-blue-50 dark:hover:bg-navy-700 active:scale-98">
                                <span>Open AI Assistant</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- MAIN 2-COLUMN SECTION -->
            <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
                <!-- LEFT COLUMN: Monthly Attendance Champions & Calendar Streak (Takes 7 cols) -->
                <div class="lg:col-span-7 space-y-5">
                    <!-- MONTHLY ATTENDANCE CHAMPIONS TABLE -->
                    <div class="rounded-2xl border border-slate-200/90 bg-white shadow-2xs dark:border-navy-700 dark:bg-navy-800 overflow-hidden">
                        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 p-4 sm:p-5 dark:border-navy-700/60">
                            <div class="flex items-center gap-3">
                                <span class="text-amber-500 text-xl font-bold">👑</span>
                                <div>
                                    <h2 class="text-sm font-bold text-navy dark:text-white">Monthly Attendance Champions</h2>
                                    <p class="text-[11px] text-slate-500 dark:text-slate-400">Top S.A.s with perfect attendance this month</p>
                                </div>
                            </div>
                            <span class="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:border-navy-700 dark:bg-navy-900/60 dark:text-slate-300">
                                {{ currentPeriod.label }}
                            </span>
                        </div>

                        <div class="overflow-x-auto">
                            <table class="w-full text-left text-xs">
                                <thead class="border-b border-slate-100 bg-slate-50/80 text-[11px] font-bold text-slate-500 dark:border-navy-700/60 dark:bg-navy-900/30 dark:text-slate-400">
                                    <tr>
                                        <th class="py-3 pl-4 pr-2">#</th>
                                        <th class="py-3 px-3">S.A. Name</th>
                                        <th class="py-3 px-3">Student ID</th>
                                        <th class="py-3 px-3">Department / Area</th>
                                        <th class="py-3 px-3">Current Streak</th>
                                        <th class="py-3 px-3">Monthly Status</th>
                                        <th class="py-3 pr-4 pl-3 text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-100 dark:divide-navy-700/50">
                                    <tr v-for="c in champions" :key="c.saProfileId" class="hover:bg-slate-50/70 dark:hover:bg-navy-700/30 transition">
                                        <td class="py-3 pl-4 pr-2 font-bold text-slate-400">{{ c.rank }}</td>
                                        <td class="py-3 px-3 font-semibold text-slate-900 dark:text-white">
                                            <div class="flex items-center gap-2">
                                                <img :src="c.avatarUrl || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(c.name) + '&background=0c1836&color=fff')"
                                                     alt="Avatar" class="h-6 w-6 rounded-full object-cover shadow-2xs border border-white/10" />
                                                <span>{{ c.name }}</span>
                                            </div>
                                        </td>
                                        <td class="py-3 px-3 text-slate-600 dark:text-slate-300">{{ c.studentId }}</td>
                                        <td class="py-3 px-3 text-slate-600 dark:text-slate-300">{{ c.departmentArea }}</td>
                                        <td class="py-3 px-3 font-semibold text-slate-800 dark:text-slate-200">
                                            <span class="inline-flex items-center gap-1">
                                                <app-icon name="Flame" :size="12" class="text-orange-500" />
                                                {{ c.currentStreakLabel }}
                                            </span>
                                        </td>
                                        <td class="py-3 px-3">
                                            <span class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-bold border"
                                                  :class="c.monthlyStatus === 'Perfect Attendance' ? 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800' : 'bg-cyan-100 text-cyan-800 border-cyan-300 dark:bg-cyan-950/60 dark:text-cyan-300 dark:border-cyan-800'">
                                                <app-icon v-if="c.monthlyStatus === 'Perfect Attendance'" name="Check" :size="10" />
                                                {{ c.monthlyStatus }}
                                            </span>
                                        </td>
                                        <td class="py-3 pr-4 pl-3 text-right">
                                            <button @click="viewSaDetails(c)"
                                                    class="inline-flex items-center gap-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white px-2.5 py-1 text-[11px] font-semibold shadow-2xs transition">
                                                View Profile
                                            </button>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <!-- CALENDAR STREAK WIDGET -->
                    <div class="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-navy-700 dark:bg-navy-800">
                        <div class="flex items-center justify-between mb-4">
                            <div class="flex items-center gap-2.5">
                                <app-icon name="Calendar" :size="18" class="text-blue-600" />
                                <div>
                                    <h3 class="text-sm font-bold text-navy dark:text-white">Calendar Streak</h3>
                                    <p class="text-[11px] text-slate-500 dark:text-slate-400">Monthly attendance overview</p>
                                </div>
                            </div>

                            <div class="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
                                <button @click="prevMonth" class="rounded-md p-1 hover:bg-slate-100 dark:hover:bg-navy-700 transition">
                                    <app-icon name="ChevronLeft" :size="14" />
                                </button>
                                <span class="px-2">{{ calendarStreak.label }}</span>
                                <button @click="nextMonth" class="rounded-md p-1 hover:bg-slate-100 dark:hover:bg-navy-700 transition">
                                    <app-icon name="ChevronRight" :size="14" />
                                </button>
                            </div>
                        </div>

                        <!-- Legend -->
                        <div class="flex items-center flex-wrap gap-4 text-[11px] mb-4 text-slate-600 dark:text-slate-400 border-b border-slate-100 dark:border-navy-700/60 pb-3">
                            <div class="flex items-center gap-1.5">
                                <span class="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
                                <span>Perfect Attendance</span>
                            </div>
                            <div class="flex items-center gap-1.5">
                                <span class="h-2.5 w-2.5 rounded-full bg-amber-400"></span>
                                <span>Attendance Exception</span>
                            </div>
                            <div class="flex items-center gap-1.5">
                                <span class="h-2.5 w-2.5 rounded-full bg-slate-300 dark:bg-slate-600"></span>
                                <span>Non-Duty Day</span>
                            </div>
                        </div>

                        <div class="grid grid-cols-1 sm:grid-cols-12 gap-5 items-center">
                            <!-- Monthly Calendar Grid (8 cols) -->
                            <div class="sm:col-span-8">
                                <div class="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-slate-400 mb-1">
                                    <span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span>
                                </div>
                                <div class="grid grid-cols-7 gap-1">
                                    <div v-for="day in calendarStreak.days" :key="day.date"
                                         class="h-8 rounded-lg flex flex-col items-center justify-center text-[11px] font-bold transition relative group cursor-pointer"
                                         :class="day.status === 'PERFECT' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-200/60' :
                                                 (day.status === 'EXCEPTION' ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-200/60' :
                                                 (day.status === 'PENDING' ? 'bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200/60' :
                                                 'bg-slate-50 text-slate-400 dark:bg-navy-900/30 dark:text-slate-500'))">
                                        <span>{{ day.day }}</span>
                                        <span v-if="day.status === 'PERFECT'" class="h-1 w-1 rounded-full bg-emerald-500"></span>
                                        <span v-else-if="day.status === 'EXCEPTION'" class="h-1 w-1 rounded-full bg-amber-400"></span>
                                        <span v-else-if="day.status === 'PENDING'" class="h-1 w-1 rounded-full bg-blue-500"></span>

                                        <!-- Tooltip -->
                                        <div class="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-30 w-32 rounded-lg bg-navy p-1.5 text-[10px] text-white shadow-lg pointer-events-none text-center">
                                            <div class="font-bold">{{ day.date }}</div>
                                            <div>{{ day.statusLabel }}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- Current Streak Flame Card (4 cols) -->
                            <div class="sm:col-span-4 rounded-xl border border-orange-200 bg-orange-50/50 p-4 text-center dark:border-orange-500/30 dark:bg-orange-500/10">
                                <app-icon name="Flame" :size="32" class="mx-auto text-orange-500 mb-1" />
                                <div class="text-[11px] font-medium text-slate-500 dark:text-slate-400">Current Streak</div>
                                <div class="text-2xl font-black text-navy dark:text-white">{{ calendarStreak.currentStreak }} days</div>
                                <div class="text-[10px] font-bold text-orange-600 dark:text-orange-400 mt-1">{{ calendarStreak.currentStreakSubtitle }}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- RIGHT COLUMN: Mystery Token & Streak Pet Evolution (Takes 5 cols) -->
                <div class="lg:col-span-5 space-y-5">
                    <!-- MYSTERY TOKEN OF APPRECIATION CARD -->
                    <div class="rounded-2xl bg-gradient-to-br from-[#0c1836] via-[#10224d] to-[#162f6d] p-5 text-white shadow-md relative overflow-hidden">
                        <!-- Glow highlight -->
                        <div class="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-blue-500/20 blur-2xl"></div>

                        <div class="flex items-center justify-between mb-4 relative z-10">
                            <div class="flex items-center gap-2.5">
                                <span class="text-amber-400 text-xl">🎁</span>
                                <div>
                                    <h3 class="text-sm font-bold text-white">{{ mysteryToken.title }}</h3>
                                    <p class="text-[11px] text-white/70">{{ mysteryToken.subtitle }}</p>
                                </div>
                            </div>
                        </div>

                        <div class="grid grid-cols-1 sm:grid-cols-12 gap-4 items-center relative z-10 my-4">
                            <!-- 3D Glowing Gift Box Illustration (5 cols) -->
                            <div class="sm:col-span-5 flex justify-center">
                                <div class="relative flex h-28 w-28 items-center justify-center rounded-2xl bg-gradient-to-tr from-amber-500/20 via-blue-500/20 to-purple-500/20 border border-white/20 shadow-inner">
                                    <div class="text-5xl animate-bounce">🎁</div>
                                    <div class="absolute top-2 right-2 text-xs font-black text-amber-300">✨</div>
                                    <div class="absolute bottom-2 left-2 text-xs font-black text-blue-300">⭐</div>
                                </div>
                            </div>

                            <!-- Details (7 cols) -->
                            <div class="sm:col-span-7 space-y-2.5 text-xs">
                                <div>
                                    <div class="text-[10px] uppercase tracking-wider font-bold text-amber-400 flex items-center gap-1">
                                        <span>💡</span> Clue
                                    </div>
                                    <p class="text-white font-medium text-[12px] leading-tight mt-0.5">
                                        "{{ mysteryToken.clue }}"
                                    </p>
                                </div>

                                <div>
                                    <div class="text-[10px] uppercase tracking-wider font-bold text-white/60 flex items-center gap-1">
                                        <app-icon name="Calendar" :size="11" /> Target Month
                                    </div>
                                    <p class="text-white font-semibold text-[12px] mt-0.5">
                                        {{ mysteryToken.targetMonthLabel }}
                                    </p>
                                </div>

                                <div>
                                    <div class="text-[10px] uppercase tracking-wider font-bold text-white/60 flex items-center gap-1">
                                        <app-icon name="Eye" :size="11" /> Visibility
                                    </div>
                                    <span class="inline-flex items-center gap-1 mt-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30 px-2 py-0.5 text-[10px] font-bold">
                                        {{ mysteryToken.visibilityLabel || 'Visible to all S.A.s' }}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <!-- Action buttons -->
                        <div class="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-white/10 relative z-10">
                            <button @click="openMysteryModal"
                                    class="inline-flex items-center justify-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white px-3 py-2 text-xs font-semibold shadow-2xs transition">
                                <app-icon name="Upload" :size="13" />
                                <span>Upload Image / Clue</span>
                            </button>

                            <button @click="openPreviewModal"
                                    class="inline-flex items-center justify-center gap-1.5 rounded-xl border border-white/20 bg-white/10 hover:bg-white/15 text-white px-3 py-2 text-xs font-semibold transition">
                                <app-icon name="Eye" :size="13" />
                                <span>Preview Announcement</span>
                            </button>
                        </div>
                    </div>

                    <!-- STREAK PET EVOLUTION WIDGET -->
                    <div class="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-navy-700 dark:bg-navy-800">
                        <div class="flex items-center justify-between mb-4">
                            <div class="flex items-center gap-2">
                                <app-icon name="Sparkles" :size="18" class="text-amber-500" />
                                <div>
                                    <h3 class="text-sm font-bold text-navy dark:text-white">Streak Pet Evolution</h3>
                                    <p class="text-[11px] text-slate-500 dark:text-slate-400">Monthly attendance overview</p>
                                </div>
                            </div>
                            <span class="text-xs font-semibold text-slate-500 dark:text-slate-400">{{ currentPeriod.label }}</span>
                        </div>

                        <!-- 4 Stages Evolution Pathway -->
                        <div class="grid grid-cols-4 gap-2 text-center my-4 relative">
                            <!-- Stage 1 -->
                            <div class="flex flex-col items-center">
                                <div class="h-10 w-10 rounded-full flex items-center justify-center text-lg border-2"
                                     :class="streakPetEvolution.stage >= 1 ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40 shadow-xs' : 'border-slate-200 bg-slate-50 opacity-60'">
                                    🐣
                                </div>
                                <div class="mt-1 text-[10px] font-bold text-slate-700 dark:text-slate-200">Day 1-7</div>
                                <div class="text-[9px] text-slate-400 leading-tight">Little Flame</div>
                            </div>

                            <!-- Stage 2 -->
                            <div class="flex flex-col items-center">
                                <div class="h-10 w-10 rounded-full flex items-center justify-center text-lg border-2"
                                     :class="streakPetEvolution.stage >= 2 ? 'border-orange-500 bg-orange-50 dark:bg-orange-950/40 shadow-xs' : 'border-slate-200 bg-slate-50 opacity-60'">
                                    🦊
                                </div>
                                <div class="mt-1 text-[10px] font-bold text-slate-700 dark:text-slate-200">Day 8-14</div>
                                <div class="text-[9px] text-slate-400 leading-tight">Growing Companion</div>
                            </div>

                            <!-- Stage 3 -->
                            <div class="flex flex-col items-center">
                                <div class="h-10 w-10 rounded-full flex items-center justify-center text-lg border-2"
                                     :class="streakPetEvolution.stage >= 3 ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 ring-2 ring-blue-400/40 shadow-xs' : 'border-slate-200 bg-slate-50 opacity-60'">
                                    🐶
                                </div>
                                <div class="mt-1 text-[10px] font-bold text-blue-600 dark:text-blue-400">Day 15-21</div>
                                <div class="text-[9px] text-blue-600 dark:text-blue-400 font-bold leading-tight">Baby Pet</div>
                            </div>

                            <!-- Stage 4 -->
                            <div class="flex flex-col items-center">
                                <div class="h-10 w-10 rounded-full flex items-center justify-center text-lg border-2"
                                     :class="streakPetEvolution.stage >= 4 ? 'border-purple-500 bg-purple-50 dark:bg-purple-950/40 shadow-xs' : 'border-slate-200 bg-slate-50 opacity-60'">
                                    🦁
                                </div>
                                <div class="mt-1 text-[10px] font-bold text-slate-700 dark:text-slate-200">Day 22+</div>
                                <div class="text-[9px] text-slate-400 leading-tight">Full Companion</div>
                            </div>
                        </div>

                        <!-- Pet Status & Progress Bar -->
                        <div class="rounded-xl border border-slate-100 bg-slate-50/80 p-3.5 dark:border-navy-700 dark:bg-navy-900/40 mt-3">
                            <div class="flex items-center gap-3">
                                <div class="h-9 w-9 rounded-full bg-blue-100 text-blue-700 grid place-items-center text-xl shrink-0 dark:bg-blue-950/60 dark:text-blue-300">
                                    🐶
                                </div>
                                <div class="flex-1 min-w-0">
                                    <div class="text-xs font-bold text-slate-900 dark:text-white">Your Pet is at Stage {{ streakPetEvolution.stage }}!</div>
                                    <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate">{{ streakPetEvolution.message }}</div>
                                </div>
                            </div>

                            <div class="mt-3 flex items-center gap-3">
                                <div class="flex-1 h-2 rounded-full bg-slate-200 dark:bg-navy-700 overflow-hidden">
                                    <div class="h-full bg-blue-600 rounded-full transition-all duration-500"
                                         :style="{ width: streakPetEvolution.percent + '%' }"></div>
                                </div>
                                <span class="text-[11px] font-bold text-slate-700 dark:text-slate-300 shrink-0">
                                    {{ streakPetEvolution.progressDays }} / {{ streakPetEvolution.targetDays }} days
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- MODAL: UPLOAD IMAGE / CLUE -->
        <app-modal v-model="mysteryModalOpen" title="Manage Mystery Token of Appreciation">
            <div class="space-y-4 text-xs">
                <div>
                    <label class="block font-bold text-slate-700 dark:text-slate-200 mb-1">Token Title</label>
                    <input type="text" v-model="mysteryForm.title"
                           class="w-full rounded-xl border border-slate-300 p-2.5 text-xs outline-hidden focus:border-navy dark:border-navy-600 dark:bg-navy-800 dark:text-white" />
                </div>

                <div>
                    <label class="block font-bold text-slate-700 dark:text-slate-200 mb-1">Mystery Clue / Teaser</label>
                    <textarea v-model="mysteryForm.clue" rows="3"
                              class="w-full rounded-xl border border-slate-300 p-2.5 text-xs outline-hidden focus:border-navy dark:border-navy-600 dark:bg-navy-800 dark:text-white"
                              placeholder="Write an intriguing clue for the S.A.s..."></textarea>
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block font-bold text-slate-700 dark:text-slate-200 mb-1">Target Month</label>
                        <select v-model.number="mysteryForm.targetMonth"
                                class="w-full rounded-xl border border-slate-300 p-2.5 text-xs outline-hidden focus:border-navy dark:border-navy-600 dark:bg-navy-800 dark:text-white">
                            <option :value="10">October 2026</option>
                            <option :value="11">November 2026</option>
                            <option :value="12">December 2026</option>
                        </select>
                    </div>

                    <div>
                        <label class="block font-bold text-slate-700 dark:text-slate-200 mb-1">Visibility</label>
                        <select v-model="mysteryForm.visibility"
                                class="w-full rounded-xl border border-slate-300 p-2.5 text-xs outline-hidden focus:border-navy dark:border-navy-600 dark:bg-navy-800 dark:text-white">
                            <option value="VISIBLE">Visible to all S.A.s</option>
                            <option value="HIDDEN">Hidden (Draft)</option>
                        </select>
                    </div>
                </div>

                <div>
                    <label class="block font-bold text-slate-700 dark:text-slate-200 mb-1">Image URL (Optional)</label>
                    <input type="text" v-model="mysteryForm.imageUrl"
                           class="w-full rounded-xl border border-slate-300 p-2.5 text-xs outline-hidden focus:border-navy dark:border-navy-600 dark:bg-navy-800 dark:text-white"
                           placeholder="assets/gifts/special-token.png" />
                </div>
            </div>

            <template #footer>
                <button @click="mysteryModalOpen = false" class="btn btn-secondary btn-sm">Cancel</button>
                <button @click="saveMysteryTokenAction" :disabled="savingMystery" class="btn btn-primary btn-sm bg-navy text-white">
                    {{ savingMystery ? 'Saving...' : 'Save & Publish Clue' }}
                </button>
            </template>
        </app-modal>

        <!-- MODAL: PREVIEW ANNOUNCEMENT -->
        <app-modal v-model="previewModalOpen" title="Student Assistant Announcement Preview">
            <div class="rounded-2xl bg-gradient-to-br from-[#0c1836] via-[#10224d] to-[#162f6d] p-6 text-white text-center shadow-lg">
                <div class="text-5xl mb-2 animate-bounce">🎁</div>
                <h3 class="text-lg font-black text-amber-300">{{ mysteryToken.title }}</h3>
                <p class="text-xs text-white/80 mt-1">Upcoming Milestone Reward for {{ mysteryToken.targetMonthLabel }}</p>

                <div class="my-4 rounded-xl bg-white/10 p-4 border border-white/15">
                    <div class="text-[11px] uppercase tracking-wider font-bold text-amber-400">💡 Clue from Coordinator</div>
                    <p class="text-sm font-medium text-white mt-1">"{{ mysteryToken.clue }}"</p>
                </div>

                <div class="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-300 border border-emerald-400/30">
                    <app-icon name="Flame" :size="13" /> Keep your streak active to qualify!
                </div>
            </div>
            <template #footer>
                <button @click="previewModalOpen = false" class="btn btn-primary btn-sm bg-navy text-white">Close Preview</button>
            </template>
        </app-modal>

        <!-- MODAL: S.A. PROFILE & ATTENDANCE BREAKDOWN -->
        <app-modal v-model="saDetailModalOpen" :title="activeSaDetail ? (activeSaDetail.name + ' — Attendance Breakdown') : 'S.A. Detail'">
            <div v-if="activeSaDetail" class="space-y-4">
                <div class="flex items-center justify-between border-b border-slate-100 pb-3 dark:border-navy-700">
                    <div class="flex items-center gap-3">
                        <img :src="activeSaDetail.avatarUrl || ('https://ui-avatars.com/api/?name=' + encodeURIComponent(activeSaDetail.name) + '&background=0c1836&color=fff')"
                             class="h-10 w-10 rounded-full object-cover border border-slate-200" />
                        <div>
                            <div class="font-bold text-sm text-slate-900 dark:text-white">{{ activeSaDetail.name }}</div>
                            <div class="text-xs text-slate-500">{{ activeSaDetail.studentId }} &middot; {{ activeSaDetail.departmentArea }}</div>
                        </div>
                    </div>
                    <div class="text-right">
                        <div class="text-xs font-bold text-orange-600 flex items-center gap-1 justify-end">
                            <app-icon name="Flame" :size="14" /> {{ activeSaDetail.currentStreakLabel }}
                        </div>
                        <span class="inline-block mt-0.5 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                            {{ activeSaDetail.monthlyStatus }}
                        </span>
                    </div>
                </div>

                <div v-if="detailLoading" class="py-10 text-center text-xs text-slate-400">Loading attendance history...</div>
                <div v-else-if="activeSaDetail.history && activeSaDetail.history.length" class="max-h-80 overflow-y-auto">
                    <table class="w-full text-left text-xs">
                        <thead class="sticky top-0 bg-slate-50 text-slate-500 font-bold dark:bg-navy-900">
                            <tr>
                                <th class="py-2 px-2">Date</th>
                                <th class="py-2 px-2">Shift</th>
                                <th class="py-2 px-2">Punches</th>
                                <th class="py-2 px-2">Credited</th>
                                <th class="py-2 px-2">Status</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100 dark:divide-navy-700/60">
                            <tr v-for="h in activeSaDetail.history" :key="h.id">
                                <td class="py-2 px-2 font-semibold text-slate-800 dark:text-slate-200">{{ h.dutyDateFormatted }}</td>
                                <td class="py-2 px-2 text-slate-500">{{ h.scheduledShift }}</td>
                                <td class="py-2 px-2 text-slate-600">{{ h.checkIn }} - {{ h.checkOut }}</td>
                                <td class="py-2 px-2 font-bold text-navy dark:text-white">{{ h.creditedHours }}</td>
                                <td class="py-2 px-2">
                                    <span class="rounded px-1.5 py-0.5 text-[10px] font-bold"
                                          :class="h.status === 'PRESENT' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'">
                                        {{ h.statusLabel }}
                                    </span>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <div v-else class="py-6 text-center text-xs text-slate-400">No attendance records found for this period.</div>
            </div>
            <template #footer>
                <router-link v-if="activeSaDetail" :to="'/admin/sa-management/' + activeSaDetail.saProfileId"
                             class="btn btn-secondary btn-sm">
                    Open Full S.A. Profile
                </router-link>
                <button @click="saDetailModalOpen = false" class="btn btn-primary btn-sm bg-navy text-white">Close</button>
            </template>
        </app-modal>
    </div>
    `
};
