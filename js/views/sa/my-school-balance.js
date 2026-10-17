// S.A. > My School Balance (/sa/school-balance)
// S.A. > My Allowance (/sa/allowance)
// Admin > School Balance & Allowance Deduction (/admin/school-balance)

const SaSchoolBalancePage = {
    components: { AppIcon, PageHeader, SaProfileView },

    setup() {
        const sa = Vue.ref(null);
        const semester = Vue.ref(null);
        const campaigns = Vue.ref([]);
        const loading = Vue.ref(true);
        const submittingId = Vue.ref(null);
        const loadError = Vue.ref("");

        const load = async () => {
            loading.value = true;
            loadError.value = "";
            const [resSa, resDed] = await Promise.all([
                Model.request("sa", "me"),
                Model.request("deductions", "list_campaigns")
            ]);
            loading.value = false;
            if (!resSa.success) {
                loadError.value = resSa.message || "Could not load your school balance.";
                return;
            }
            sa.value = resSa.sa;
            if (resDed && resDed.success) {
                semester.value = resDed.semester || sa.value?.semester || null;
                campaigns.value = resDed.campaigns || [];
            }
        };

        Vue.onMounted(load);

        const activeCampaign = Vue.computed(() => {
            if (!campaigns.value.length) return null;
            return campaigns.value.find(c => c.status === "OPEN") || campaigns.value[0];
        });

        const respondYesNo = async (campaign, choice) => {
            if (!campaign || submittingId.value) return;
            const bal = Number(sa.value?.benefits?.balance || 0);
            const isYes = choice === "YES";
            const ok = await Alerts.confirm({
                title: isYes ? "Confirm: YES, Deduct School Balance?" : "Confirm: NO, Do Not Deduct?",
                html: isYes
                    ? `Are you sure you want to answer <b class="text-emerald-700">YES</b> so your remaining school balance (<b class="text-ink">${Format.peso(bal)}</b>) for this semester will be deducted from your S.A. allowance?`
                    : `Are you sure you want to answer <b class="text-danger">NO</b> (do not deduct your school balance from your S.A. allowance this semester)?`,
                confirmText: isYes ? "Yes, Deduct My Balance" : "No, Do Not Deduct",
                requireReason: false
            });
            if (!ok) return;

            submittingId.value = campaign.id;
            const r = await Model.request("deductions", "sa_respond", {
                campaignId: campaign.id,
                choice,
                amount: isYes ? bal : 0,
                notes: isYes ? "School Balance Allowance Deduction (YES)" : "Declined School Balance Deduction (NO)"
            });
            submittingId.value = null;

            if (!r.success) {
                Alerts.error("Response Failed", r.message || "Could not save your response.");
                return;
            }
            Store.toast("success", isYes
                ? "Your response (YES — Deduct School Balance from Allowance) has been recorded!"
                : "Your response (NO — Do Not Deduct) has been recorded!");
            if (Store.loadNotifications) Store.loadNotifications();
            load();
        };

        const formatDateTimePretty = (dt) => {
            if (!dt) return "";
            try {
                const d = new Date(dt.replace(/-/g, "/"));
                return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) + ", " +
                       d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
            } catch (e) {
                return dt;
            }
        };

        const formatDatePretty = (dStr) => {
            if (!dStr) return "";
            try {
                const parts = dStr.split("-");
                if (parts.length === 3) {
                    const d = new Date(parts[0], parts[1] - 1, parts[2]);
                    return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
                }
                return dStr;
            } catch (e) {
                return dStr;
            }
        };

        const assessment = Vue.computed(() => {
            const b = sa.value?.benefits || {};
            const a = b.assessment || {};
            const tuition = a.tuitionFee || b.tuitionFee || 11627.10;
            const misc = a.miscFee || b.miscFee || 4743.49;
            const lab = a.labFee || 4104.00;
            const lms = a.lmsFee || 2053.20;
            const omr = a.omrFee || 278.40;
            const nstp = a.nstpFee || 0;
            const cash = a.cashTotal || b.cashTotal || (tuition + lab + misc + lms + omr + nstp);
            return {
                tuitionFee: tuition,
                labFee: lab,
                miscFee: misc,
                lmsFee: lms,
                omrFee: omr,
                nstpFee: nstp,
                cashTotal: cash
            };
        });

        const promptUpdateDecision = async () => {
            if (!activeCampaign.value) return;
            const current = activeCampaign.value.myResponse?.choice;
            const newChoice = current === 'YES' ? 'NO' : 'YES';
            await respondYesNo(activeCampaign.value, newChoice);
        };

        return {
            sa, semester, campaigns, activeCampaign, assessment,
            loading, submittingId, loadError, load, respondYesNo, promptUpdateDecision,
            formatDateTimePretty, formatDatePretty, Format, label
        };
    },

    template: `
    <div class="space-y-5 max-w-7xl mx-auto">
        <!-- 1. Page Header -->
        <div class="flex flex-wrap items-center justify-between gap-4">
            <div class="flex items-center gap-3.5">
                <div class="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400 shadow-xs">
                    <app-icon name="Landmark" :size="26" />
                </div>
                <div>
                    <h1 class="text-2xl font-bold tracking-tight text-[#0f2557] dark:text-white">My School Balance</h1>
                    <p class="text-xs font-medium text-slate-500 dark:text-slate-400 mt-0.5">
                        Your official Registrar COR fee assessment, S.A. scholarship benefit (100% Tuition + 70% Miscellaneous), remaining school balance, and semester allowance deduction decision.
                    </p>
                </div>
            </div>

            <!-- Semester Pill Button -->
            <div class="flex items-center gap-2">
                <button type="button" @click="load"
                        class="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700/80 px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-xs hover:bg-slate-50 transition">
                    <app-icon name="Calendar" :size="14" class="text-blue-600 dark:text-blue-400" />
                    <span>{{ semester?.label || sa?.semester?.label || '1st Semester AY 2026–2027' }}</span>
                    <app-icon name="ChevronDown" :size="13" class="text-slate-400" />
                </button>
            </div>
        </div>

        <!-- Loading State -->
        <div v-if="loading" class="space-y-4" aria-busy="true">
            <div class="h-28 animate-pulse rounded-2xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700"></div>
            <div class="h-72 animate-pulse rounded-2xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700"></div>
        </div>

        <!-- Error State -->
        <div v-else-if="loadError" class="card flex flex-col items-center px-6 py-12 text-center rounded-2xl dark:bg-slate-800 dark:border-slate-700">
            <app-icon name="CircleX" :size="28" class="text-danger" />
            <p class="mt-3 text-body font-medium text-ink dark:text-white">Couldn't load your school balance</p>
            <p class="mt-1 text-caption text-muted dark:text-slate-400">{{ loadError }}</p>
            <button @click="load" class="btn btn-secondary btn-sm mt-4">
                <app-icon name="RefreshCw" :size="14" /> Try again
            </button>
        </div>

        <!-- Main Loaded Content -->
        <template v-else-if="sa">
            <!-- 2. Four Top KPI Summary Cards -->
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <!-- KPI 1: Total COR Assessment (Cash) -->
                <div class="rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-800/90 dark:border-slate-700/80 p-5 shadow-xs flex items-start gap-3.5">
                    <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/70 dark:text-blue-400">
                        <app-icon name="FileText" :size="20" />
                    </div>
                    <div>
                        <div class="text-xs font-medium text-slate-500 dark:text-slate-400">Total COR Assessment (Cash)</div>
                        <div class="text-xl sm:text-2xl font-extrabold text-[#0f2557] dark:text-white mt-1">
                            {{ Format.peso(assessment.cashTotal || sa.benefits?.cashTotal || 0) }}
                        </div>
                        <div class="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                            {{ semester?.label || sa.semester?.label || '1st Semester AY 2026–2027' }}
                        </div>
                    </div>
                </div>

                <!-- KPI 2: S.A. Scholarship Benefit -->
                <div class="rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-800/90 dark:border-slate-700/80 p-5 shadow-xs flex items-start gap-3.5">
                    <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/70 dark:text-emerald-400">
                        <app-icon name="GraduationCap" :size="20" />
                    </div>
                    <div>
                        <div class="text-xs font-medium text-slate-500 dark:text-slate-400">S.A. Scholarship Benefit</div>
                        <div class="text-xl sm:text-2xl font-extrabold text-[#0f2557] dark:text-white mt-1">
                            −{{ Format.peso(sa.benefits?.totalCovered || 0) }}
                        </div>
                        <div class="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                            100% Tuition + 70% Miscellaneous
                        </div>
                    </div>
                </div>

                <!-- KPI 3: Estimated School Balance -->
                <div class="rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-800/90 dark:border-slate-700/80 p-5 shadow-xs flex items-start gap-3.5">
                    <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-purple-50 text-purple-600 dark:bg-purple-950/70 dark:text-purple-400">
                        <app-icon name="Wallet" :size="20" />
                    </div>
                    <div>
                        <div class="text-xs font-medium text-slate-500 dark:text-slate-400">Estimated School Balance</div>
                        <div class="text-xl sm:text-2xl font-extrabold text-[#0f2557] dark:text-white mt-1">
                            {{ Format.peso(sa.benefits?.balance || 0) }}
                        </div>
                        <div class="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                            Remaining 30% Misc + Lab/LMS/OMR fees
                        </div>
                    </div>
                </div>

                <!-- KPI 4: Allowance Deduction Decision -->
                <div class="rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-800/90 dark:border-slate-700/80 p-5 shadow-xs flex items-start gap-3.5">
                    <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/70 dark:text-amber-400">
                        <app-icon name="ShieldAlert" :size="20" />
                    </div>
                    <div>
                        <div class="text-xs font-medium text-slate-500 dark:text-slate-400">Allowance Deduction Decision</div>
                        <div class="text-base sm:text-lg font-extrabold text-[#0f2557] dark:text-white mt-1.5">
                            {{ activeCampaign?.myResponse
                                ? (activeCampaign.myResponse.choice === 'YES' ? 'YES — Deduct Balance' : 'NO — Do Not Deduct')
                                : (activeCampaign ? 'Pending Your Reply' : 'No Active Poll') }}
                        </div>
                        <div class="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                            Rate: {{ Format.peso(sa.benefits?.effectiveHourlyRate || sa.hourlyRate || 0) }}/hr
                        </div>
                    </div>
                </div>
            </div>

            <!-- 3. Coordinator Announcement Banner -->
            <div v-if="activeCampaign" class="rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-800/90 dark:border-slate-700/80 p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div class="flex items-center gap-3.5">
                    <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/70 dark:text-blue-400">
                        <app-icon name="Megaphone" :size="20" />
                    </div>
                    <div>
                        <div class="text-sm font-bold text-[#0f2557] dark:text-white">Coordinator Announcement</div>
                        <div class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            {{ activeCampaign.description || 'The monthly allowance deduction decision is now open. Please make sure to confirm your decision before the deadline.' }}
                        </div>
                    </div>
                </div>

                <div class="flex items-center gap-4 shrink-0">
                    <span class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold"
                          :class="activeCampaign.status === 'OPEN' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800' : 'bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'">
                        <span class="h-1.5 w-1.5 rounded-full" :class="activeCampaign.status === 'OPEN' ? 'bg-emerald-500' : 'bg-slate-400'"></span>
                        <span>{{ activeCampaign.status === 'OPEN' ? 'OPEN' : 'CLOSED' }}</span>
                    </span>
                    <div v-if="activeCampaign.deadline" class="inline-flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                        <app-icon name="Calendar" :size="14" class="text-slate-500 dark:text-slate-400" />
                        <span>Deadline: <b class="font-semibold text-slate-800 dark:text-white">{{ formatDatePretty(activeCampaign.deadline) }}</b></span>
                    </div>
                </div>
            </div>

            <!-- 4. Two Main Content Cards (Side-by-Side Grid) -->
            <div class="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
                <!-- Left Column: Tuition Balance Deduction (Prelims) -->
                <div class="lg:col-span-6 rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-800/90 dark:border-slate-700/80 p-6 sm:p-7 shadow-xs flex flex-col justify-between space-y-5">
                    <div class="space-y-5">
                        <!-- Card Header (matching Image 2) -->
                        <div class="flex items-start gap-3">
                            <div class="shrink-0 text-blue-600 dark:text-blue-400 mt-0.5">
                                <svg class="w-6 h-7" viewBox="0 0 24 28" fill="currentColor">
                                    <path d="M14 2H6C4.9 2 4 2.9 4 4V24C4 25.1 4.9 26 6 26H18C19.1 26 20 25.1 20 24V8L14 2ZM16 22H8V20H16V22ZM16 17H8V15H16V17ZM13 9V3.5L18.5 9H13Z"/>
                                </svg>
                            </div>
                            <div>
                                <h2 class="text-base font-bold text-[#0f2557] dark:text-white">{{ activeCampaign?.title || 'Tuition Balance Deduction (Prelims)' }}</h2>
                                <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                    Please indicate if you wish to deduct your pending prelim tuition balance from your monthly allowance.
                                </p>
                            </div>
                        </div>

                        <!-- Current Decision Box (matching Image 2) -->
                        <div v-if="activeCampaign && activeCampaign.myResponse"
                             class="rounded-2xl bg-[#F0F6FF] dark:bg-slate-900/60 p-5 space-y-2.5">
                            <div class="text-xs font-semibold text-slate-700 dark:text-slate-300">Your Current Decision</div>
                            <div class="flex items-center gap-3">
                                <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#00875A] text-white">
                                    <app-icon name="Check" :size="16" />
                                </div>
                                <div class="space-y-0.5">
                                    <div class="text-sm font-bold text-[#00875A] dark:text-emerald-400 leading-snug">
                                        {{ activeCampaign.myResponse.choice === 'YES'
                                            ? 'YES — Deduct my school balance (' + Format.peso(sa.benefits?.balance || 0) + ') from my allowance'
                                            : 'NO — Do not deduct my school balance from my allowance' }}
                                    </div>
                                    <div v-if="activeCampaign.myResponse.repliedAt" class="text-xs text-slate-500 dark:text-slate-400">
                                        Submitted {{ formatDateTimePretty(activeCampaign.myResponse.repliedAt) }}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <!-- Pending Decision Options (if not yet submitted) -->
                        <div v-else-if="activeCampaign && activeCampaign.status === 'OPEN'"
                             class="rounded-2xl border border-amber-200 bg-amber-50/50 dark:bg-amber-950/40 dark:border-amber-800/50 p-5 space-y-3">
                            <div class="text-xs font-semibold text-amber-900 dark:text-amber-300">
                                Please indicate your decision regarding your remaining school balance ({{ Format.peso(sa.benefits?.balance || 0) }}):
                            </div>
                            <div class="flex flex-wrap items-center gap-2.5">
                                <button type="button" @click="respondYesNo(activeCampaign, 'YES')"
                                        :disabled="submittingId === activeCampaign.id"
                                        class="btn btn-sm bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2">
                                    <app-icon name="Check" :size="14" />
                                    <span>YES, Deduct from Allowance</span>
                                </button>
                                <button type="button" @click="respondYesNo(activeCampaign, 'NO')"
                                        :disabled="submittingId === activeCampaign.id"
                                        class="btn btn-sm btn-secondary font-bold px-4 py-2 dark:bg-slate-700 dark:text-slate-200 dark:border-slate-600">
                                    <app-icon name="X" :size="14" />
                                    <span>NO, Do Not Deduct</span>
                                </button>
                            </div>
                        </div>

                        <!-- Status row (matching Image 2) -->
                        <div class="flex flex-wrap items-center gap-3 pt-1 text-xs">
                            <span class="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#E3FCEF] text-[#006644] dark:bg-emerald-950/60 dark:text-emerald-300">
                                {{ activeCampaign?.myResponse ? 'Decision Submitted' : 'Pending Response' }}
                            </span>
                            <div class="flex items-center gap-1.5 text-slate-600 dark:text-slate-400 font-medium">
                                <app-icon name="Clock" :size="15" class="text-slate-500 dark:text-slate-400" />
                                <span>Awaiting further action (if needed)</span>
                                <app-icon name="Info" :size="14" class="text-slate-500 dark:text-slate-400" />
                            </div>
                        </div>
                    </div>

                    <!-- Bottom Notice Box with Review Decision Button (matching Image 2) -->
                    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl bg-[#EEF5FF] dark:bg-slate-900/60 p-3.5 sm:p-4 text-xs text-blue-700 dark:text-blue-300 mt-auto">
                        <div class="flex items-center gap-2.5">
                            <div class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-white font-bold text-[11px]">
                                i
                            </div>
                            <span class="font-medium text-blue-700 dark:text-blue-300">You can update your decision before the deadline if your situation changes.</span>
                        </div>
                        <button v-if="activeCampaign?.status === 'OPEN'" type="button" @click="promptUpdateDecision"
                                class="inline-flex items-center gap-2 rounded-xl bg-[#1976D2] hover:bg-blue-700 text-white px-4 py-2 text-xs font-semibold shrink-0 shadow-xs transition">
                            <app-icon name="SquarePen" :size="14" />
                            <span>Review Decision</span>
                        </button>
                    </div>
                </div>

                <!-- Right Column: Fee Assessment Breakdown (Registrar COR) -->
                <div class="lg:col-span-6 rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-800/90 dark:border-slate-700/80 p-6 sm:p-7 shadow-xs space-y-4">
                    <!-- Card Header -->
                    <div class="flex items-center gap-2.5 text-base font-bold text-[#0f2557] dark:text-white">
                        <app-icon name="FileText" :size="18" class="text-blue-600 dark:text-blue-400" />
                        <span>Fee Assessment Breakdown (Registrar COR)</span>
                    </div>

                    <!-- Fee Table -->
                    <div class="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
                        <table class="w-full text-left text-xs">
                            <thead class="bg-slate-50/80 dark:bg-slate-900/60 text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                                <tr>
                                    <th class="px-4 py-2.5">Fee</th>
                                    <th class="px-4 py-2.5 text-right">Amount</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-800">
                                <tr v-if="assessment.tuitionFee">
                                    <td class="px-4 py-2.5 font-medium text-slate-700 dark:text-slate-300">Tuition</td>
                                    <td class="px-4 py-2.5 text-right font-medium text-slate-700 dark:text-slate-300">{{ Format.peso(assessment.tuitionFee) }}</td>
                                </tr>
                                <tr v-if="assessment.labFee">
                                    <td class="px-4 py-2.5 font-medium text-slate-700 dark:text-slate-300">Laboratory</td>
                                    <td class="px-4 py-2.5 text-right font-medium text-slate-700 dark:text-slate-300">{{ Format.peso(assessment.labFee) }}</td>
                                </tr>
                                <tr v-if="assessment.miscFee">
                                    <td class="px-4 py-2.5 font-medium text-slate-700 dark:text-slate-300">Miscellaneous</td>
                                    <td class="px-4 py-2.5 text-right font-medium text-slate-700 dark:text-slate-300">{{ Format.peso(assessment.miscFee) }}</td>
                                </tr>
                                <tr v-if="assessment.lmsFee">
                                    <td class="px-4 py-2.5 font-medium text-slate-700 dark:text-slate-300">LMS Fee</td>
                                    <td class="px-4 py-2.5 text-right font-medium text-slate-700 dark:text-slate-300">{{ Format.peso(assessment.lmsFee) }}</td>
                                </tr>
                                <tr v-if="assessment.omrFee">
                                    <td class="px-4 py-2.5 font-medium text-slate-700 dark:text-slate-300">OMR Fee</td>
                                    <td class="px-4 py-2.5 text-right font-medium text-slate-700 dark:text-slate-300">{{ Format.peso(assessment.omrFee) }}</td>
                                </tr>
                                <tr v-if="assessment.nstpFee">
                                    <td class="px-4 py-2.5 font-medium text-slate-700 dark:text-slate-300">NSTP Fee</td>
                                    <td class="px-4 py-2.5 text-right font-medium text-slate-700 dark:text-slate-300">{{ Format.peso(assessment.nstpFee) }}</td>
                                </tr>
                            </tbody>
                            <tfoot class="bg-blue-50/50 dark:bg-slate-900/80 border-t border-slate-200 dark:border-slate-700 font-bold text-[#0f2557] dark:text-white">
                                <tr>
                                    <td class="px-4 py-2.5">Total Assessment</td>
                                    <td class="px-4 py-2.5 text-right">{{ Format.peso(assessment.cashTotal || sa.benefits?.cashTotal || 0) }}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    <!-- Scholarship Coverage Summary Box -->
                    <div class="rounded-xl border border-blue-100 bg-[#F8FAFD] dark:bg-slate-900/60 dark:border-slate-700 p-4 space-y-3">
                        <div class="flex items-center gap-2 text-xs font-bold text-[#0f2557] dark:text-white">
                            <span class="flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-950/70 dark:text-blue-400 text-[10px] font-bold">%</span>
                            <span>Scholarship Coverage Summary</span>
                        </div>
                        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
                            <div>
                                <div class="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Tuition Fee (100% covered)</div>
                                <div class="text-sm font-bold text-slate-800 dark:text-slate-200 mt-1">{{ Format.peso(sa.benefits?.tuitionCovered || sa.benefits?.tuitionFee || 0) }}</div>
                            </div>
                            <div>
                                <div class="text-[11px] text-slate-500 dark:text-slate-400 font-medium">Miscellaneous Fee (70% covered)</div>
                                <div class="text-sm font-bold text-slate-800 dark:text-slate-200 mt-1">{{ Format.peso(sa.benefits?.miscCovered || 0) }}</div>
                            </div>
                            <div>
                                <div class="text-[11px] text-emerald-800 dark:text-emerald-300 font-medium">Covered by S.A. Benefit</div>
                                <div class="text-sm font-bold text-emerald-600 dark:text-emerald-400 mt-1">− {{ Format.peso(sa.benefits?.totalCovered || 0) }}</div>
                            </div>
                        </div>
                    </div>

                    <!-- Estimated Remaining School Balance Banner -->
                    <div class="flex items-center justify-between rounded-xl bg-emerald-50/70 border border-emerald-100 dark:bg-emerald-950/40 dark:border-emerald-800/50 px-4 py-3 text-xs font-bold text-emerald-900 dark:text-emerald-300">
                        <div class="flex items-center gap-2">
                            <app-icon name="CheckCircle2" :size="16" class="text-emerald-600 dark:text-emerald-400 shrink-0" />
                            <span>Estimated Remaining School Balance</span>
                        </div>
                        <span class="text-sm font-extrabold text-emerald-700 dark:text-emerald-400">{{ Format.peso(sa.benefits?.balance || 0) }}</span>
                    </div>

                    <!-- Disclaimer -->
                    <div class="flex items-start gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <app-icon name="Info" :size="13" class="shrink-0 mt-0.5 text-slate-400" />
                        <span>* Assessment synced from Registrar Certificate of Registration. Payment verification and official receipting are handled by Finance / Cashier.</span>
                    </div>
                </div>
            </div>
        </template>
    </div>
    `
};


const AdminSchoolBalancePage = {
    components: { AppIcon, PageHeader, SaProfileView, AppModal, FormField },

    setup() {
        const items = Vue.ref([]);
        const semester = Vue.ref(null);
        const campaigns = Vue.ref([]);
        const activeCampaignId = Vue.ref(null);
        const activeCampaign = Vue.ref(null);
        const saResponses = Vue.ref([]);
        const loading = Vue.ref(true);
        const loadError = Vue.ref("");

        const search = Vue.ref("");
        const categoryFilter = Vue.ref("ALL");
        const responseFilter = Vue.ref("ALL"); // ALL | YES | NO | PENDING
        const selectedSa = Vue.ref(null);

        // Modal: New School Balance Deduction Announcement
        const showNewModal = Vue.ref(false);
        const savingCampaign = Vue.ref(false);
        const newForm = Vue.reactive({
            title: "",
            description: "Do you want your remaining school balance for this semester to be deducted from your monthly S.A. allowance? Please answer YES or NO.",
            deadline: ""
        });

        // Modal: Final List for Allowance Deduction Endorsement
        const showFinalListModal = Vue.ref(false);
        const yesItems = Vue.computed(() => {
            return (enrichedItems.value || []).filter(s => s.deductionChoice === "YES");
        });
        const coordinatorName = Vue.computed(() => {
            return Store.user?.full_name || Store.user?.name || "Ansherina A Sudario";
        });
        const endorsementDate = Vue.computed(() => {
            const today = new Date();
            return today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
        });
        const openFinalListModal = () => {
            showFinalListModal.value = true;
        };
        const executePrint = () => {
            document.body.classList.add("printing-deduction-endorsement");
            window.print();
            setTimeout(() => {
                document.body.classList.remove("printing-deduction-endorsement");
            }, 500);
        };

        const selectCampaign = async (id) => {
            activeCampaignId.value = id;
            const r = await Model.request("deductions", "campaign_details", { campaignId: id });
            if (r.success) {
                activeCampaign.value = r.campaign;
                saResponses.value = r.saResponses || [];
            }
        };

        const load = async () => {
            loading.value = true;
            loadError.value = "";
            const [resBal, resCamp] = await Promise.all([
                Model.request("sa", "school_balances"),
                Model.request("deductions", "list_campaigns")
            ]);
            loading.value = false;
            if (!resBal.success) {
                loadError.value = resBal.message || "Could not load S.A. school balances.";
                return;
            }
            items.value = resBal.items || [];
            if (resCamp && resCamp.success) {
                semester.value = resCamp.semester || null;
                campaigns.value = resCamp.campaigns || [];
                if (campaigns.value.length > 0) {
                    const targetId = activeCampaignId.value || campaigns.value[0].id;
                    await selectCampaign(targetId);
                } else {
                    activeCampaign.value = null;
                    saResponses.value = [];
                }
            }
        };

        Vue.onMounted(load);

        // Map saProfileId -> response from activeCampaign
        const responseMap = Vue.computed(() => {
            const m = {};
            (saResponses.value || []).forEach(r => {
                m[r.saProfileId] = r;
            });
            return m;
        });

        const enrichedItems = Vue.computed(() => {
            return (items.value || []).map(s => {
                const resp = responseMap.value[s.id] || null;
                return {
                    ...s,
                    deductionChoice: resp ? resp.choice : null, // 'YES', 'NO', or null
                    deductionNotes: resp ? resp.notes : "",
                    deductionRepliedAt: resp ? resp.repliedAt : null
                };
            });
        });

        const filtered = Vue.computed(() => {
            const q = search.value.trim().toLowerCase();
            return enrichedItems.value.filter(s => {
                if (categoryFilter.value !== "ALL" && s.saCategory !== categoryFilter.value) return false;
                if (responseFilter.value === "YES" && s.deductionChoice !== "YES") return false;
                if (responseFilter.value === "NO" && s.deductionChoice !== "NO") return false;
                if (responseFilter.value === "PENDING" && s.deductionChoice) return false;
                if (!q) return true;
                return (
                    (s.name || "").toLowerCase().includes(q) ||
                    (s.studentId || "").toLowerCase().includes(q) ||
                    (s.course || "").toLowerCase().includes(q)
                );
            });
        });

        // DataTable state & sorting
        const sortKey = Vue.ref("name");
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

        Vue.watch([search, categoryFilter, responseFilter], () => {
            page.value = 1;
        });

        const sortedRows = Vue.computed(() => {
            const list = [...filtered.value];
            const key = sortKey.value;
            const dir = sortDir.value === "asc" ? 1 : -1;

            list.sort((a, b) => {
                let res = 0;
                if (key === "name") {
                    res = (a.name || "").localeCompare(b.name || "");
                    if (res === 0) res = (a.studentId || "").localeCompare(b.studentId || "");
                } else if (key === "saCategory") {
                    res = (a.saCategory || "").localeCompare(b.saCategory || "");
                } else if (key === "cashTotal") {
                    res = (Number(a.benefits?.cashTotal) || 0) - (Number(b.benefits?.cashTotal) || 0);
                } else if (key === "totalCovered") {
                    res = (Number(a.benefits?.totalCovered) || 0) - (Number(b.benefits?.totalCovered) || 0);
                } else if (key === "balance") {
                    res = (Number(a.benefits?.balance) || 0) - (Number(b.benefits?.balance) || 0);
                } else if (key === "deductionChoice") {
                    const cA = a.deductionChoice || "PENDING";
                    const cB = b.deductionChoice || "PENDING";
                    res = cA.localeCompare(cB);
                }
                return res * dir;
            });
            return list;
        });

        const pageCount = Vue.computed(() => {
            if (pageSize.value <= 0) return 1;
            return Math.max(1, Math.ceil(sortedRows.value.length / pageSize.value));
        });

        const pageRows = Vue.computed(() => {
            if (pageSize.value <= 0) return sortedRows.value;
            const start = (page.value - 1) * pageSize.value;
            return sortedRows.value.slice(start, start + pageSize.value);
        });

        const rangeText = Vue.computed(() => {
            const total = sortedRows.value.length;
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

        const totals = Vue.computed(() => {
            let cash = 0, covered = 0, balance = 0, yesCount = 0, noCount = 0, pendingCount = 0, yesBalanceTotal = 0;
            enrichedItems.value.forEach(s => {
                const bal = Number(s.benefits?.balance || 0);
                if (s.benefits) {
                    cash += Number(s.benefits.cashTotal || 0);
                    covered += Number(s.benefits.totalCovered || 0);
                    balance += bal;
                }
                if (s.deductionChoice === "YES") {
                    yesCount++;
                    yesBalanceTotal += bal;
                } else if (s.deductionChoice === "NO") {
                    noCount++;
                } else {
                    pendingCount++;
                }
            });
            return { cash, covered, balance, yesCount, noCount, pendingCount, yesBalanceTotal };
        });

        const openCreateModal = () => {
            const semLabel = semester.value?.label || "This Semester";
            newForm.title = `School Balance Allowance Deduction (${semLabel})`;
            newForm.description = "Do you want your remaining school balance for this semester to be deducted from your monthly S.A. allowance? Please answer YES or NO.";
            newForm.deadline = "";
            showNewModal.value = true;
        };

        const submitNewCampaign = async () => {
            if (!newForm.title.trim()) {
                Alerts.warning("Announcement Title Required", "Please enter an announcement title.");
                return;
            }
            const ok = await Alerts.confirm({
                title: "Send Deduction Announcement to All S.A.s?",
                html: `Broadcast <b class="text-ink">${Alerts.esc(newForm.title.trim())}</b> to all active Student Assistants so they can answer <b>YES</b> or <b>NO</b> in their accounts?`,
                confirmText: "Send Announcement",
                requireReason: false
            });
            if (!ok) return;

            savingCampaign.value = true;
            const r = await Model.request("deductions", "create_campaign", {
                title: newForm.title.trim(),
                deductionType: "TUITION",
                description: newForm.description.trim(),
                defaultAmount: 0,
                deadline: newForm.deadline || null
            });
            savingCampaign.value = false;
            if (!r.success) {
                Alerts.error("Create Announcement Failed", r.message || "Failed to create announcement.");
                return;
            }
            Store.toast("success", "School Balance deduction announcement sent to all active S.A.s!");
            showNewModal.value = false;
            activeCampaignId.value = r.campaignId;
            await load();
        };

        const toggleCampaignStatus = async () => {
            if (!activeCampaign.value) return;
            const newStatus = activeCampaign.value.status === "OPEN" ? "CLOSED" : "OPEN";
            const ok = await Alerts.confirm({
                title: `${newStatus === "CLOSED" ? "Close" : "Re-open"} Announcement?`,
                text: newStatus === "CLOSED"
                    ? "Closing this announcement will lock S.A. YES/NO responses."
                    : "Re-opening will allow S.A.s to submit or update their YES/NO response.",
                icon: "warning",
                confirmText: newStatus === "CLOSED" ? "Close Announcement" : "Re-open Announcement",
                requireReason: false
            });
            if (!ok) return;

            const r = await Model.request("deductions", "update_campaign_status", {
                campaignId: activeCampaign.value.id,
                status: newStatus
            });
            if (r.success) {
                Store.toast("success", `Announcement is now ${newStatus.toLowerCase()}.`);
                await load();
            } else {
                Alerts.error("Status Update Failed", r.message || "Failed to update status.");
            }
        };

        return {
            items, enrichedItems, filtered, sortedRows, pageRows, totals, semester, campaigns, activeCampaignId, activeCampaign,
            loading, loadError, load, selectCampaign,
            search, categoryFilter, responseFilter, selectedSa,
            sortKey, sortDir, pageSize, page, sortBy, getSortIcon, pageCount, rangeText, visiblePages,
            showNewModal, savingCampaign, newForm, openCreateModal, submitNewCampaign,
            toggleCampaignStatus, showFinalListModal, yesItems, coordinatorName, endorsementDate, openFinalListModal, executePrint,
            Format, label
        };
    },

    template: `
    <page-header title="School Balance & Allowance Deduction" section="Benefits & Allowance"
                 subtitle="Official Registrar COR fee assessments, remaining school balances, and semester announcement polling S.A.s (YES / NO) if they want their school balance deducted from their allowance.">
        <template #actions>
            <div class="flex flex-wrap items-center gap-2">
                <button @click="load" class="btn btn-secondary btn-sm">
                    <app-icon name="RefreshCw" :size="15" /> Sync from Registrar COR
                </button>
                <button @click="openFinalListModal" class="btn btn-primary btn-sm flex items-center gap-1.5 shadow-sm">
                    <app-icon name="Eye" :size="15" /> View Final Endorsement List
                </button>
                <button @click="openCreateModal" class="btn btn-secondary btn-sm">
                    <app-icon name="Megaphone" :size="15" /> Create Announcement (Yes / No)
                </button>
            </div>
        </template>
    </page-header>

    <div v-if="loading" class="space-y-4" aria-busy="true">
        <div class="h-24 animate-pulse rounded-xl bg-white"></div>
        <div class="h-96 animate-pulse rounded-xl bg-white"></div>
    </div>

    <div v-else-if="loadError" class="card flex flex-col items-center px-6 py-12 text-center">
        <app-icon name="CircleX" :size="28" class="text-danger" />
        <p class="mt-3 text-body font-medium text-ink">Couldn't load school balances</p>
        <p class="mt-1 text-caption text-muted">{{ loadError }}</p>
        <button @click="load" class="btn btn-secondary btn-sm mt-4"><app-icon name="RefreshCw" :size="14" /> Try again</button>
    </div>

    <template v-else>
        <!-- Active Deduction Announcement Banner -->
        <section v-if="activeCampaign" class="card mb-5 p-5 border-l-4 border-l-navy">
            <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                <div>
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="rounded-full bg-navy/10 px-2.5 py-0.5 text-[11px] font-bold uppercase text-navy">
                            Active Semester Poll
                        </span>
                        <span class="rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase"
                              :class="activeCampaign.status === 'OPEN' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'">
                            {{ activeCampaign.status }}
                        </span>
                        <span v-if="campaigns.length > 1" class="inline-flex items-center gap-1 ml-1">
                            <select :value="activeCampaignId" @change="selectCampaign(Number($event.target.value))"
                                    class="input py-1 px-2 text-[12px] w-auto">
                                <option v-for="c in campaigns" :key="c.id" :value="c.id">{{ c.title }} ({{ c.status }})</option>
                            </select>
                        </span>
                    </div>
                    <h2 class="mt-1 text-[17px] font-bold text-navy">{{ activeCampaign.title }}</h2>
                    <p class="text-caption text-muted mt-0.5">
                        {{ activeCampaign.description }}
                        <span v-if="activeCampaign.deadline" class="ml-1 font-semibold text-ink">· Deadline: {{ Format.date(activeCampaign.deadline) }}</span>
                    </p>
                </div>
                <div class="flex flex-wrap items-center gap-2 shrink-0">
                    <button @click="toggleCampaignStatus" class="btn btn-secondary btn-sm">
                        <app-icon :name="activeCampaign.status === 'OPEN' ? 'Lock' : 'Unlock'" :size="14" />
                        {{ activeCampaign.status === 'OPEN' ? 'Close Poll' : 'Re-open Poll' }}
                    </button>
                </div>
            </div>
        </section>

        <section v-else class="card mb-5 p-5 border-l-4 border-l-amber-500 bg-amber-50/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
                <h2 class="text-body font-bold text-navy">No School Balance Deduction Announcement Yet</h2>
                <p class="text-caption text-muted mt-0.5">
                    Create an announcement to ask all Student Assistants (YES or NO) if they want their remaining school balance for this semester deducted from their allowance.
                </p>
            </div>
            <button @click="openCreateModal" class="btn btn-primary btn-sm shrink-0">
                <app-icon name="Megaphone" :size="14" /> Create Announcement Now
            </button>
        </section>

        <!-- Summary KPI Cards -->
        <dl class="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <div class="card px-4 py-3.5">
                <dt class="text-caption text-muted">Active S.A.s</dt>
                <dd class="mt-1 text-[20px] font-bold text-navy">{{ enrichedItems.length }}</dd>
                <dd class="text-[11px] text-muted">Total Cash COR: {{ Format.peso(totals.cash) }}</dd>
            </div>
            <div class="card px-4 py-3.5 border-emerald-200 bg-emerald-50/40">
                <dt class="text-caption text-emerald-900 font-medium">S.A. Benefit Covered</dt>
                <dd class="mt-1 text-[20px] font-bold text-emerald-700">− {{ Format.peso(totals.covered) }}</dd>
                <dd class="text-[11px] text-emerald-800">100% Tuition + 70% Misc</dd>
            </div>
            <div class="card px-4 py-3.5 border-navy/20 bg-navy/5">
                <dt class="text-caption text-navy font-semibold">Total School Balance</dt>
                <dd class="mt-1 text-[20px] font-bold text-navy">{{ Format.peso(totals.balance) }}</dd>
                <dd class="text-[11px] text-muted">Remaining 30% Misc + Lab/LMS</dd>
            </div>
            <div class="card px-4 py-3.5 border-emerald-300 bg-emerald-50/60">
                <dt class="text-caption text-emerald-950 font-semibold">Answered YES (Deduct)</dt>
                <dd class="mt-1 text-[20px] font-bold text-emerald-700">{{ totals.yesCount }} S.A.(s)</dd>
                <dd class="text-[11px] text-emerald-900">Balance to deduct: {{ Format.peso(totals.yesBalanceTotal) }}</dd>
            </div>
            <div class="card px-4 py-3.5">
                <dt class="text-caption text-muted">Answered NO / Pending</dt>
                <dd class="mt-1 text-[20px] font-bold text-ink">{{ totals.noCount }} No · {{ totals.pendingCount }} Pending</dd>
                <dd class="text-[11px] text-muted">Semester deduction poll</dd>
            </div>
        </dl>

        <!-- Search & Filter Controls -->
        <div class="card p-4 mb-4 flex flex-wrap items-center justify-between gap-3">
            <div class="relative flex-1 min-w-[220px]">
                <input v-model="search" type="search" class="input py-2 text-[13px]"
                       placeholder="Search S.A. name, student ID, or course..." />
            </div>
            <div class="flex flex-wrap items-center gap-2">
                <div class="inline-flex rounded-lg border border-line bg-page p-0.5 text-[12px]">
                    <button @click="responseFilter = 'ALL'" class="rounded px-2.5 py-1 font-semibold transition"
                            :class="responseFilter === 'ALL' ? 'bg-navy text-white' : 'text-muted hover:text-ink'">
                        All ({{ enrichedItems.length }})
                    </button>
                    <button @click="responseFilter = 'YES'" class="rounded px-2.5 py-1 font-semibold transition"
                            :class="responseFilter === 'YES' ? 'bg-emerald-600 text-white' : 'text-muted hover:text-ink'">
                        YES — Deduct ({{ totals.yesCount }})
                    </button>
                    <button @click="responseFilter = 'NO'" class="rounded px-2.5 py-1 font-semibold transition"
                            :class="responseFilter === 'NO' ? 'bg-navy text-white' : 'text-muted hover:text-ink'">
                        NO ({{ totals.noCount }})
                    </button>
                    <button @click="responseFilter = 'PENDING'" class="rounded px-2.5 py-1 font-semibold transition"
                            :class="responseFilter === 'PENDING' ? 'bg-amber-600 text-white' : 'text-muted hover:text-ink'">
                        Pending ({{ totals.pendingCount }})
                    </button>
                </div>
                <select v-model="categoryFilter" class="input w-auto py-2 text-[13px]">
                    <option value="ALL">Department Categories</option>
                    <option value="ITO">ITO</option>
                    <option value="ACADS">ACADS</option>
                    <option value="OFFICE">OFFICE</option>
                </select>
            </div>
        </div>

        <!-- Banner when viewing YES (Deduct) filter -->
        <div v-if="responseFilter === 'YES'" class="card mb-4 p-4 border-l-4 border-l-emerald-600 bg-emerald-50/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
                <h3 class="text-body font-bold text-emerald-950">Final List for Allowance Deduction Endorsement</h3>
                <p class="text-caption text-emerald-900 mt-0.5">
                    Official roster of Student Assistants who authorized deducting their remaining school balance from their monthly S.A. allowance (<b>{{ totals.yesCount }} S.A.s</b> · Total to deduct: <b>{{ Format.peso(totals.yesBalanceTotal) }}</b>).
                </p>
            </div>
            <button @click="openFinalListModal" class="btn btn-primary btn-sm shrink-0 flex items-center gap-1.5 shadow-sm">
                <app-icon name="Eye" :size="14" /> View Final Endorsement List
            </button>
        </div>

        <!-- Unified School Balance & Allowance Deduction Table -->
        <div class="card overflow-hidden">
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
                    <b class="text-ink">{{ sortedRows.length }}</b> total S.A.s found
                </span>
            </div>

            <div class="overflow-x-auto">
                <table class="w-full text-left text-[13px]">
                    <thead class="bg-page text-caption font-semibold text-muted border-b border-line select-none">
                        <tr>
                            <th class="px-4 py-3">
                                <button type="button" @click="sortBy('name')" class="inline-flex items-center gap-1 text-caption font-semibold text-muted hover:text-ink transition-colors">
                                    Student Assistant
                                    <app-icon :name="getSortIcon('name')" :size="13" />
                                </button>
                            </th>
                            <th class="px-4 py-3">
                                <button type="button" @click="sortBy('saCategory')" class="inline-flex items-center gap-1 text-caption font-semibold text-muted hover:text-ink transition-colors">
                                    Category
                                    <app-icon :name="getSortIcon('saCategory')" :size="13" />
                                </button>
                            </th>
                            <th class="px-4 py-3 text-right">
                                <button type="button" @click="sortBy('cashTotal')" class="inline-flex items-center gap-1 text-caption font-semibold text-muted hover:text-ink transition-colors ml-auto">
                                    Total Assessment (COR)
                                    <app-icon :name="getSortIcon('cashTotal')" :size="13" />
                                </button>
                            </th>
                            <th class="px-4 py-3 text-right">
                                <button type="button" @click="sortBy('totalCovered')" class="inline-flex items-center gap-1 text-caption font-semibold text-muted hover:text-ink transition-colors ml-auto">
                                    S.A. Benefit (Covered)
                                    <app-icon :name="getSortIcon('totalCovered')" :size="13" />
                                </button>
                            </th>
                            <th class="px-4 py-3 text-right">
                                <button type="button" @click="sortBy('balance')" class="inline-flex items-center gap-1 text-caption font-semibold text-muted hover:text-ink transition-colors ml-auto">
                                    School Balance
                                    <app-icon :name="getSortIcon('balance')" :size="13" />
                                </button>
                            </th>
                            <th class="px-4 py-3 text-center">
                                <button type="button" @click="sortBy('deductionChoice')" class="inline-flex items-center gap-1 text-caption font-semibold text-muted hover:text-ink transition-colors">
                                    Deduct from Allowance?
                                    <app-icon :name="getSortIcon('deductionChoice')" :size="13" />
                                </button>
                            </th>
                            <th class="px-4 py-3 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-line">
                        <tr v-if="!sortedRows.length">
                            <td colspan="7" class="p-8 text-center text-muted">
                                No Student Assistants found matching this filter.
                            </td>
                        </tr>
                        <tr v-for="s in pageRows" :key="s.id" class="hover:bg-page/60">
                            <td class="px-4 py-3">
                                <div class="font-semibold text-ink">{{ s.name }}</div>
                                <div class="text-caption text-muted">{{ s.studentId }} · {{ s.course }} {{ s.yearLevel }}</div>
                            </td>
                            <td class="px-4 py-3">
                                <span class="rounded-full bg-page px-2.5 py-0.5 text-[11px] font-semibold text-navy border border-line">
                                    {{ s.saCategory }}
                                </span>
                            </td>
                            <td class="px-4 py-3 text-right font-medium text-ink">
                                {{ s.benefits && s.benefits.cashTotal !== null ? Format.peso(s.benefits.cashTotal) : '—' }}
                            </td>
                            <td class="px-4 py-3 text-right font-semibold text-emerald-700">
                                {{ s.benefits && s.benefits.totalCovered !== null ? '− ' + Format.peso(s.benefits.totalCovered) : '—' }}
                            </td>
                            <td class="px-4 py-3 text-right font-bold text-navy">
                                {{ s.benefits && s.benefits.balance !== null ? Format.peso(s.benefits.balance) : '—' }}
                            </td>
                            <td class="px-4 py-3 text-center">
                                <span v-if="s.deductionChoice === 'YES'"
                                      class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
                                    <app-icon name="Check" :size="12" /> YES (Deduct)
                                </span>
                                <span v-else-if="s.deductionChoice === 'NO'"
                                      class="inline-flex items-center gap-1 rounded-full bg-slate-200 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700">
                                    <app-icon name="X" :size="12" /> NO
                                </span>
                                <span v-else
                                      class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                                    <app-icon name="Clock" :size="12" /> Pending
                                </span>
                            </td>
                            <td class="px-4 py-3 text-right">
                                <button @click="selectedSa = s" class="btn btn-secondary btn-sm">
                                    <app-icon name="Eye" :size="14" /> COR Breakdown
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

        <!-- Modal: Full COR Breakdown -->
        <app-modal :open="!!selectedSa" :title="selectedSa ? selectedSa.name + ' — School Balance' : 'School Balance'"
                   icon="Wallet" size="lg" @close="selectedSa = null">
            <sa-profile-view v-if="selectedSa" :sa="selectedSa" mode="admin" :only="['benefits']" />
            <template #footer>
                <router-link v-if="selectedSa" :to="'/admin/sa-management/' + selectedSa.id + '?tab=BALANCE'" class="btn btn-secondary">
                    Open S.A. Record
                </router-link>
                <button @click="selectedSa = null" class="btn btn-primary">Close</button>
            </template>
        </app-modal>

        <!-- Modal: Create School Balance Deduction Announcement (Yes / No Poll) -->
        <app-modal :open="showNewModal" title="Create School Balance Deduction Announcement" icon="Megaphone" @close="showNewModal = false">
            <div class="space-y-4">
                <div class="rounded-lg border border-navy/15 bg-navy/5 p-3.5 text-caption text-ink">
                    This sends an announcement and notification to all active Student Assistants asking if they want their <b>Remaining School Balance</b> for this semester to be deducted from their monthly S.A. allowance (<b>YES</b> or <b>NO</b>).
                </div>

                <form-field label="Announcement Title" required>
                    <input v-model="newForm.title" type="text" class="input"
                           placeholder="e.g. 1st Semester School Balance Allowance Deduction" />
                </form-field>

                <form-field label="Message / Question for Student Assistants">
                    <textarea v-model="newForm.description" rows="3" class="input"
                              placeholder="Do you want your remaining school balance for this semester to be deducted from your monthly S.A. allowance? Please answer YES or NO."></textarea>
                </form-field>

                <form-field label="Response Deadline (Optional)">
                    <input v-model="newForm.deadline" type="date" class="input" />
                </form-field>
            </div>
            <template #footer>
                <button @click="showNewModal = false" class="btn btn-secondary" :disabled="savingCampaign">Cancel</button>
                <button @click="submitNewCampaign" class="btn btn-primary" :disabled="savingCampaign">
                    <app-icon :name="savingCampaign ? 'LoaderCircle' : 'Send'" :size="15" :class="savingCampaign ? 'animate-spin' : ''" />
                    {{ savingCampaign ? 'Sending…' : 'Send Announcement to S.A.s' }}
                </button>
            </template>
        </app-modal>

        <!-- Modal: Final List of S.A.s for Allowance Deduction (Endorsement) -->
        <app-modal :open="showFinalListModal" title="Final Allowance Deduction List (Endorsement)" size="lg" @close="showFinalListModal = false">
            <div class="space-y-4">
                <div class="flex items-center justify-between mb-1">
                    <span class="text-xs font-bold text-navy uppercase tracking-wider flex items-center gap-1.5">
                        <app-icon name="FileText" :size="14" /> Allowance Deduction Endorsement Document Preview
                    </span>
                    <span class="text-[11px] text-muted">Ready for print or physical filing</span>
                </div>

                <!-- Document Printable Area -->
                <div id="printable-deduction-endorsement" class="rounded-xl border border-line bg-white p-6 shadow-sm text-ink font-sans">
                    <!-- Institutional Header -->
                    <div class="border-b-2 border-navy pb-4 text-center">
                        <h1 class="text-[17px] font-black uppercase tracking-wide text-navy">National College of Science and Technology</h1>
                        <p class="text-[12px] font-semibold text-muted uppercase">Student Assistant Program · AssistPay Management System</p>
                        <h2 class="mt-2 text-[15px] font-bold text-ink uppercase">Final List of Student Assistants for Allowance Deduction</h2>
                        <p class="text-[11px] text-muted mt-0.5">
                            {{ activeCampaign?.title || 'School Balance Allowance Deduction' }} · {{ semester?.label || 'Academic Semester' }} · Endorsement Date: {{ endorsementDate }}
                        </p>
                    </div>

                    <!-- Summary Card -->
                    <div class="my-4 grid grid-cols-2 sm:grid-cols-3 gap-3 border border-line bg-mist/40 p-3 text-center text-xs rounded-lg">
                        <div>
                            <p class="text-caption text-muted">Total Authorized S.A.s</p>
                            <p class="text-[16px] font-bold text-navy">{{ yesItems.length }} S.A.(s)</p>
                        </div>
                        <div>
                            <p class="text-caption text-muted">Total Deduction Amount</p>
                            <p class="text-[16px] font-bold text-emerald-700">{{ Format.peso(totals.yesBalanceTotal) }}</p>
                        </div>
                        <div class="col-span-2 sm:col-span-1">
                            <p class="text-caption text-muted">Academic Term</p>
                            <p class="text-[13px] font-semibold text-ink">{{ semester?.label || 'Active Semester' }}</p>
                        </div>
                    </div>

                    <!-- Table of YES respondents -->
                    <div class="overflow-x-auto">
                        <table class="w-full text-left text-[12px]">
                            <thead class="border-b border-line bg-mist/80 font-bold text-muted">
                                <tr>
                                    <th class="py-2 px-2.5">#</th>
                                    <th class="py-2 px-2.5">Student ID</th>
                                    <th class="py-2 px-2.5">Student Assistant</th>
                                    <th class="py-2 px-2.5">Department</th>
                                    <th class="py-2 px-2.5">Course & Year</th>
                                    <th class="py-2 px-2.5 text-right">COR Assessment</th>
                                    <th class="py-2 px-2.5 text-right text-emerald-800">Benefit Covered</th>
                                    <th class="py-2 px-2.5 text-right font-bold text-navy">Amount to Deduct</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-line">
                                <tr v-if="!yesItems.length">
                                    <td colspan="8" class="p-6 text-center text-muted">
                                        No Student Assistants have authorized allowance deduction yet.
                                    </td>
                                </tr>
                                <tr v-for="(s, idx) in yesItems" :key="s.id" class="hover:bg-mist/30">
                                    <td class="py-2 px-2.5 text-muted">{{ idx + 1 }}</td>
                                    <td class="py-2 px-2.5 font-mono font-medium">{{ s.studentId }}</td>
                                    <td class="py-2 px-2.5 font-bold text-ink">{{ s.name }}</td>
                                    <td class="py-2 px-2.5">
                                        <span class="rounded bg-mist px-2 py-0.5 text-[10px] font-bold text-navy border border-line">
                                            {{ s.saCategory }}
                                        </span>
                                    </td>
                                    <td class="py-2 px-2.5 text-caption">{{ s.course }} {{ s.yearLevel }}</td>
                                    <td class="py-2 px-2.5 text-right font-medium">{{ s.benefits && s.benefits.cashTotal !== null ? Format.peso(s.benefits.cashTotal) : '—' }}</td>
                                    <td class="py-2 px-2.5 text-right text-emerald-700 font-medium">− {{ s.benefits && s.benefits.totalCovered !== null ? Format.peso(s.benefits.totalCovered) : '—' }}</td>
                                    <td class="py-2 px-2.5 text-right font-bold text-navy">{{ s.benefits && s.benefits.balance !== null ? Format.peso(s.benefits.balance) : '—' }}</td>
                                </tr>
                            </tbody>
                            <tfoot v-if="yesItems.length" class="border-t-2 border-navy bg-mist/60 font-bold">
                                <tr>
                                    <td colspan="7" class="py-2.5 px-2.5 text-right uppercase text-navy">Total Authorized Deduction:</td>
                                    <td class="py-2.5 px-2.5 text-right text-[14px] text-emerald-800">{{ Format.peso(totals.yesBalanceTotal) }}</td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>

                    <!-- Signatures Block -->
                    <div class="mt-12 pt-6 border-t border-line grid grid-cols-2 gap-8 text-center text-xs">
                        <div>
                            <p class="text-caption text-muted mb-8">Prepared & Endorsed By:</p>
                            <p class="font-bold text-ink underline text-[13px]">{{ coordinatorName }}</p>
                            <p class="text-caption text-muted">Student Assistant Coordinator</p>
                        </div>
                        <div>
                            <p class="text-caption text-muted mb-8">Noted & Approved By:</p>
                            <div class="mx-auto w-48 border-b border-ink mb-1"></div>
                            <p class="font-bold text-ink text-[13px]">HR Manager</p>
                            <p class="text-caption text-muted">Human Resource Office</p>
                        </div>
                    </div>
                </div>
            </div>

            <template #footer>
                <div class="flex items-center justify-between w-full">
                    <span class="text-caption text-muted">
                        {{ yesItems.length }} Student Assistant(s) ready for endorsement.
                    </span>
                    <div class="flex items-center gap-2">
                        <button @click="showFinalListModal = false" class="btn btn-secondary">Close</button>
                        <button @click="executePrint" class="btn btn-primary inline-flex items-center gap-1.5 shadow-sm">
                            <app-icon name="Printer" :size="16" /> Print Final Endorsement List
                        </button>
                    </div>
                </div>
            </template>
        </app-modal>
    </template>
    `
};
