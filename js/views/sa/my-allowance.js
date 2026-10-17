// Student Assistant > My Allowance (/sa/allowance)
// Visual Overview and Breakdown of Cutoff Duty Allowance based on verified attendance
const SaAllowancePage = {
    components: { AppIcon, AppModal },

    setup() {
        const loading = Vue.ref(true);
        const loadError = Vue.ref("");
        const data = Vue.ref(null);
        const selectedCutoffId = Vue.ref(null);
        const showComputationModal = Vue.ref(false);

        const formatPeso = (val) => {
            return "₱" + (Number(val) || 0).toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
        };

        const formatHours = (val) => {
            return (Number(val) || 0).toFixed(2);
        };

        const formatDate = (val) => {
            if (!val) return "—";
            try {
                const parts = String(val).split("-");
                if (parts.length === 3) {
                    const d = new Date(parts[0], parts[1] - 1, parts[2]);
                    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                }
                return val;
            } catch (e) {
                return val;
            }
        };

        const load = async (cutoffId = null) => {
            loading.value = true;
            loadError.value = "";
            const payload = cutoffId ? { cutoffId } : {};
            const r = await Model.request("sa", "my_allowance_cutoff", payload);
            loading.value = false;
            if (!r.success) {
                loadError.value = r.message || "Failed to load allowance details.";
                return;
            }
            data.value = r;
            if (r.activeCutoff && r.activeCutoff.id) {
                selectedCutoffId.value = r.activeCutoff.id;
            }
        };

        Vue.onMounted(() => {
            load();
        });

        const computedAllowance = Vue.computed(() => data.value?.breakdown?.computedAllowance ?? 0);
        const netCreditedHours = Vue.computed(() => data.value?.breakdown?.netCreditedHours ?? 0);
        const hourlyRate = Vue.computed(() => data.value?.breakdown?.hourlyRate ?? 0);
        const isCustomRate = Vue.computed(() => Boolean(data.value?.sa?.isCustomRate));
        const breakDeduction = Vue.computed(() => data.value?.breakdown?.breakDeduction ?? 0);
        const recordedHours = Vue.computed(() => data.value?.breakdown?.recordedHours ?? 0);
        const cutoffLabel = Vue.computed(() => data.value?.activeCutoff?.label ?? "Current Cutoff");
        const statusLabel = Vue.computed(() => data.value?.activeCutoff?.statusLabel ?? "For Verification");
        const statusClass = Vue.computed(() => data.value?.activeCutoff?.statusClass ?? "bg-amber-100 text-amber-800");
        const cutoffs = Vue.computed(() => data.value?.cutoffs ?? []);
        const attendanceLogs = Vue.computed(() => data.value?.attendanceLogs ?? []);

        return {
            loading,
            loadError,
            data,
            selectedCutoffId,
            showComputationModal,
            load,
            formatPeso,
            formatHours,
            formatDate,
            computedAllowance,
            netCreditedHours,
            hourlyRate,
            isCustomRate,
            breakDeduction,
            recordedHours,
            cutoffLabel,
            statusLabel,
            statusClass,
            cutoffs,
            attendanceLogs
        };
    },

    template: `
    <div class="space-y-6 max-w-7xl mx-auto">
        <!-- Page Header -->
        <div class="flex flex-wrap items-center justify-between gap-4">
            <div class="flex items-center gap-3.5">
                <div class="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400 shadow-xs">
                    <app-icon name="Wallet" :size="26" />
                </div>
                <div>
                    <h1 class="text-2xl font-bold tracking-tight text-[#0f2557] dark:text-white">My Allowance</h1>
                    <p class="text-xs font-medium text-slate-500 dark:text-slate-400">Current cutoff overview</p>
                </div>
            </div>

            <!-- Optional Cutoff Selector for Historical Cutoffs -->
            <div v-if="cutoffs && cutoffs.length > 1" class="flex items-center gap-2">
                <span class="text-xs text-slate-500 dark:text-slate-400 font-medium">Period:</span>
                <select v-model="selectedCutoffId" @change="load(selectedCutoffId)"
                        class="rounded-xl border border-slate-200 bg-white dark:bg-slate-800 dark:border-slate-700 dark:text-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-xs focus:border-blue-500 focus:outline-none">
                    <option v-for="c in cutoffs" :key="c.id" :value="c.id">
                        {{ c.name || ('Cutoff ' + c.id + ': ' + c.startDate + ' to ' + c.endDate) }}
                        {{ c.isCurrent ? ' (Active)' : '' }}
                    </option>
                </select>
            </div>
        </div>

        <!-- Loading Skeleton -->
        <div v-if="loading" class="space-y-6" aria-busy="true">
            <div class="h-44 animate-pulse rounded-2xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-xs"></div>
            <div class="h-48 animate-pulse rounded-2xl bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-xs"></div>
        </div>

        <!-- Error State -->
        <div v-else-if="loadError" class="card p-10 text-center space-y-3 dark:bg-slate-800 dark:border-slate-700">
            <app-icon name="AlertCircle" :size="32" class="text-rose-500 mx-auto" />
            <h3 class="text-base font-bold text-slate-800 dark:text-white">Could not load allowance overview</h3>
            <p class="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">{{ loadError }}</p>
            <button type="button" @click="load()" class="btn btn-secondary btn-sm inline-flex items-center gap-1.5 mt-2">
                <app-icon name="RotateCcw" :size="14" />
                <span>Try Again</span>
            </button>
        </div>

        <!-- Main Content -->
        <div v-else-if="data" class="space-y-6">
            <!-- Top Card: Current Cutoff Allowance -->
            <div class="relative overflow-hidden rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-800/90 dark:border-slate-700/80 p-6 sm:p-7 shadow-xs">
                <!-- Center/Right Decorative 3D Blue Wallet with Peso & Golden Sparkles -->
                <div class="absolute right-4 sm:right-16 top-1/2 -translate-y-1/2 pointer-events-none hidden md:flex items-center justify-center">
                    <svg width="220" height="170" viewBox="0 0 220 170" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <defs>
                            <!-- Soft Ambient Radial Glow Backdrop -->
                            <radialGradient id="walletGlow" cx="50%" cy="50%" r="50%">
                                <stop offset="0%" stop-color="#3b82f6" stop-opacity="0.18" />
                                <stop offset="70%" stop-color="#60a5fa" stop-opacity="0.06" />
                                <stop offset="100%" stop-color="#ffffff" stop-opacity="0" />
                            </radialGradient>
                            <!-- Wallet Main Body Gradient -->
                            <linearGradient id="walletBodyGrad" x1="40" y1="35" x2="180" y2="145" gradientUnits="userSpaceOnUse">
                                <stop offset="0%" stop-color="#4997ff" />
                                <stop offset="50%" stop-color="#2a77f4" />
                                <stop offset="100%" stop-color="#195fd9" />
                            </linearGradient>
                            <!-- Wallet Flap Gradient -->
                            <linearGradient id="flapGrad" x1="40" y1="30" x2="180" y2="80" gradientUnits="userSpaceOnUse">
                                <stop offset="0%" stop-color="#5fa5ff" />
                                <stop offset="100%" stop-color="#246de6" />
                            </linearGradient>
                            <filter id="softWalletShadow" x="15" y="20" width="190" height="150" filterUnits="userSpaceOnUse">
                                <feDropShadow dx="0" dy="12" stdDeviation="14" flood-color="#1d4ed8" flood-opacity="0.2" />
                            </filter>
                        </defs>

                        <!-- Soft Cloud Glow -->
                        <ellipse cx="115" cy="85" rx="88" ry="70" fill="url(#walletGlow)" />

                        <!-- Golden Sparkles -->
                        <path d="M48 48 C48 54 51 57 57 57 C51 57 48 60 48 66 C48 60 45 57 39 57 C45 57 48 54 48 48 Z" fill="#F59E0B" />
                        <path d="M178 44 C178 50 181 53 187 53 C181 53 178 56 178 62 C178 56 175 53 169 53 C175 53 178 50 178 44 Z" fill="#F59E0B" />

                        <!-- 3D Wallet Body -->
                        <g filter="url(#softWalletShadow)">
                            <rect x="42" y="45" width="136" height="88" rx="20" fill="url(#walletBodyGrad)" />
                            <!-- Upper Fold / Flap -->
                            <path d="M42 58 C42 47 51 38 62 38 H158 C169 38 178 47 178 58 V66 C178 77 169 86 158 86 H62 C51 86 42 77 42 66 Z" fill="url(#flapGrad)" />
                            <!-- Subtle Highlight Line -->
                            <path d="M46 72 C52 75 62 78 74 78 H146 C158 78 168 75 174 72" stroke="#93c5fd" stroke-width="2.5" stroke-linecap="round" opacity="0.45" />
                            <!-- Inner Pocket Tab -->
                            <rect x="144" y="74" width="26" height="28" rx="7" fill="#0f2557" opacity="0.25" />
                            <circle cx="157" cy="88" r="4" fill="#bfdbfe" />
                            <!-- White Philippine Peso Symbol -->
                            <text x="105" y="103" fill="#ffffff" font-size="34" font-family="'Inter', -apple-system, sans-serif" font-weight="900" text-anchor="middle" letter-spacing="-1">₱</text>
                        </g>
                    </svg>
                </div>

                <!-- Content Layout -->
                <div class="relative z-10 flex flex-col justify-between gap-6 sm:flex-row sm:items-start">
                    <!-- Left Stats -->
                    <div class="space-y-3">
                        <!-- Stack of Golden Coins Icon -->
                        <div class="flex h-11 w-11 items-center justify-center rounded-full bg-amber-100 text-amber-500 dark:bg-amber-950/70 dark:text-amber-400 shadow-2xs">
                            <svg class="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <ellipse cx="12" cy="7" rx="8" ry="3.5" fill="#fef3c7" />
                                <path d="M4 7v6c0 1.93 3.58 3.5 8 3.5s8-1.57 8-3.5V7" />
                                <path d="M4 13v6c0 1.93 3.58 3.5 8 3.5s8-1.57 8-3.5v-6" />
                            </svg>
                        </div>

                        <!-- Amount Block -->
                        <div>
                            <span class="text-xs font-semibold text-slate-500 dark:text-slate-400">Current Cutoff Allowance</span>
                            <div class="text-3xl sm:text-4xl font-extrabold text-[#0f2557] dark:text-white tracking-tight mt-1 mb-2.5">
                                {{ formatPeso(computedAllowance) }}
                            </div>
                        </div>

                        <!-- Status Pill Badge -->
                        <div>
                            <span class="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/60">
                                <app-icon name="Clock" :size="13" class="text-amber-700 dark:text-amber-400" />
                                <span>{{ statusLabel }}</span>
                            </span>
                        </div>

                        <!-- Cutoff Calendar Date -->
                        <div class="flex items-center gap-2 pt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                            <app-icon name="Calendar" :size="15" class="text-blue-600 dark:text-blue-400 shrink-0" />
                            <span>{{ cutoffLabel }}</span>
                        </div>
                    </div>

                    <!-- Right Top View Computation Button -->
                    <div class="sm:self-start">
                        <button type="button" @click="showComputationModal = true"
                                class="inline-flex items-center gap-2 rounded-xl border border-blue-200 bg-white dark:bg-slate-700/60 dark:border-slate-600 dark:text-blue-300 dark:hover:bg-slate-700 px-4 py-2.5 text-xs font-semibold text-blue-600 shadow-xs hover:bg-blue-50/80 transition">
                            <app-icon name="Calculator" :size="15" />
                            <span>View Computation</span>
                            <app-icon name="ChevronRight" :size="14" />
                        </button>
                    </div>
                </div>
            </div>

            <!-- Bottom Card: Current Cutoff Breakdown -->
            <div class="rounded-2xl border border-slate-200/80 bg-white dark:bg-slate-800/90 dark:border-slate-700/80 p-6 sm:p-7 shadow-xs space-y-6">
                <!-- Header -->
                <div class="flex items-center gap-2.5 text-base font-bold text-[#0f2557] dark:text-white">
                    <app-icon name="Calculator" :size="20" class="text-blue-600 dark:text-blue-400" />
                    <span>Current Cutoff Breakdown</span>
                </div>

                <!-- 4 Stat Boxes in Inner Container (with central vertical divider) -->
                <div class="rounded-2xl bg-[#F8FAFD] dark:bg-slate-900/60 border border-blue-100/60 dark:border-slate-700/60 p-6 sm:p-7">
                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 divide-y lg:divide-y-0 lg:divide-x divide-slate-200/80 dark:divide-slate-700/60">
                        <!-- Left Side: Net Credited Hours & Hourly Rate -->
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <!-- 1. Net Credited Hours -->
                            <div class="space-y-2">
                                <div class="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100/70 text-blue-600 dark:bg-blue-950/70 dark:text-blue-400 shadow-2xs">
                                    <app-icon name="Clock" :size="18" />
                                </div>
                                <div>
                                    <div class="text-xs font-medium text-slate-500 dark:text-slate-400">Net Credited Hours</div>
                                    <div class="text-2xl font-bold text-[#0f2557] dark:text-white mt-1">{{ formatHours(netCreditedHours) }} hrs</div>
                                </div>
                            </div>

                            <!-- 2. Hourly Rate -->
                            <div class="space-y-2">
                                <div class="flex h-10 w-10 items-center justify-center rounded-full bg-purple-100/70 text-purple-600 dark:bg-purple-950/70 dark:text-purple-400 font-extrabold text-sm shadow-2xs">
                                    ₱
                                </div>
                                <div>
                                    <div class="text-xs font-medium text-slate-500 dark:text-slate-400">Hourly Rate</div>
                                    <div class="text-2xl font-bold text-[#0f2557] dark:text-white mt-1">{{ formatPeso(hourlyRate) }} /hr</div>
                                </div>
                            </div>
                        </div>

                        <!-- Right Side: Automatic Unpaid Break Deduction & Computed Allowance -->
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-6 lg:pt-0 lg:pl-8">
                            <!-- 3. Automatic Unpaid Break Deduction -->
                            <div class="space-y-2">
                                <div class="flex h-10 w-10 items-center justify-center rounded-full bg-rose-100/70 text-rose-500 dark:bg-rose-950/70 dark:text-rose-400 shadow-2xs">
                                    <app-icon name="MinusCircle" :size="18" />
                                </div>
                                <div>
                                    <div class="text-xs font-medium text-slate-500 dark:text-slate-400">Automatic Unpaid Break Deduction</div>
                                    <div class="text-2xl font-bold text-[#0f2557] dark:text-white mt-1">{{ formatHours(breakDeduction) }} hrs</div>
                                </div>
                            </div>

                            <!-- 4. Computed Allowance -->
                            <div class="space-y-2">
                                <div class="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100/70 text-emerald-600 dark:bg-emerald-950/70 dark:text-emerald-400 font-extrabold text-sm shadow-2xs">
                                    ₱
                                </div>
                                <div>
                                    <div class="text-xs font-medium text-slate-500 dark:text-slate-400">Computed Allowance</div>
                                    <div class="text-2xl font-bold text-[#0f2557] dark:text-white mt-1">{{ formatPeso(computedAllowance) }}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Bottom Note Banner -->
                <div class="flex items-center gap-2.5 rounded-xl bg-blue-50/70 border border-blue-100/80 dark:bg-slate-900/50 dark:border-slate-700/60 px-4 py-3 text-xs font-medium text-blue-700 dark:text-blue-300">
                    <app-icon name="Info" :size="16" class="text-blue-600 dark:text-blue-400 shrink-0" />
                    <span>Final amount is based on verified attendance records.</span>
                </div>
            </div>
        </div>

        <!-- View Computation Modal -->
        <app-modal v-if="showComputationModal" :open="showComputationModal" @close="showComputationModal = false"
                   title="Cutoff Allowance Computation" size="lg">
            <div class="space-y-5">
                <!-- Mathematical Formula Banner -->
                <div class="rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50/90 to-indigo-50/60 dark:from-slate-800 dark:to-slate-900 dark:border-blue-900/60 p-5 space-y-2">
                    <div class="flex items-center gap-2 text-xs font-bold text-blue-900 dark:text-blue-300 uppercase tracking-wider">
                        <app-icon name="Calculator" :size="15" class="text-blue-600 dark:text-blue-400" />
                        <span>Official Computation Formula</span>
                    </div>
                    <div class="text-base sm:text-lg font-extrabold text-[#0f2557] dark:text-white">
                        {{ formatHours(netCreditedHours) }} Credited Hours × {{ formatPeso(hourlyRate) }} /hr = {{ formatPeso(computedAllowance) }}
                    </div>
                    <p class="text-[11px] text-blue-800 dark:text-blue-300/90 leading-relaxed">
                        Allowance is strictly computed from verified attendance duty hours credited within <strong>{{ cutoffLabel }}</strong>. Scheduled hours are used for duty planning only.
                    </p>
                </div>

                <!-- Step-by-Step Breakdown Grid -->
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div class="rounded-xl border border-slate-200 bg-slate-50/60 dark:bg-slate-800/80 dark:border-slate-700 p-3.5 space-y-1">
                        <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase">Recorded Duty Hours</span>
                        <div class="text-lg font-bold text-slate-800 dark:text-white">{{ formatHours(recordedHours) }} hrs</div>
                        <p class="text-[10px] text-slate-500 dark:text-slate-400">Total duration captured from biometric/attendance logs.</p>
                    </div>
                    <div class="rounded-xl border border-rose-200 bg-rose-50/50 dark:bg-rose-950/30 dark:border-rose-900/50 p-3.5 space-y-1">
                        <span class="text-[11px] font-semibold text-rose-700 dark:text-rose-400 uppercase">Unpaid Break Deductions</span>
                        <div class="text-lg font-bold text-rose-700 dark:text-rose-300">- {{ formatHours(breakDeduction) }} hrs</div>
                        <p class="text-[10px] text-rose-600 dark:text-rose-400">Institutional policy: 1 hr unpaid break on shifts ≥ 5 hrs.</p>
                    </div>
                    <div class="rounded-xl border border-emerald-200 bg-emerald-50/60 dark:bg-emerald-950/30 dark:border-emerald-900/50 p-3.5 space-y-1">
                        <span class="text-[11px] font-semibold text-emerald-800 dark:text-emerald-400 uppercase">Net Credited Hours</span>
                        <div class="text-lg font-bold text-emerald-700 dark:text-emerald-300">{{ formatHours(netCreditedHours) }} hrs</div>
                        <p class="text-[10px] text-emerald-700 dark:text-emerald-400">Official hours multiplied by your hourly rate.</p>
                    </div>
                </div>

                <!-- Cutoff Attendance Log Summary Table -->
                <div class="space-y-2">
                    <div class="flex items-center justify-between text-xs font-bold text-[#0f2557] dark:text-white">
                        <span class="flex items-center gap-1.5">
                            <app-icon name="Clock" :size="14" class="text-blue-600 dark:text-blue-400" />
                            <span>Duty Records in this Cutoff</span>
                        </span>
                        <span class="text-slate-500 dark:text-slate-400 font-medium">{{ attendanceLogs.length }} recorded duty date(s)</span>
                    </div>

                    <div v-if="attendanceLogs.length" class="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 max-h-60">
                        <table class="w-full text-left text-xs">
                            <thead class="bg-slate-50 text-[11px] font-bold uppercase text-slate-600 border-b border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700 sticky top-0">
                                <tr>
                                    <th class="px-3 py-2">Duty Date</th>
                                    <th class="px-3 py-2 text-right">Recorded</th>
                                    <th class="px-3 py-2 text-right">Break</th>
                                    <th class="px-3 py-2 text-right">Credited</th>
                                    <th class="px-3 py-2">Status</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-800">
                                <tr v-for="(log, idx) in attendanceLogs" :key="idx" class="hover:bg-slate-50/70 dark:hover:bg-slate-700/60">
                                    <td class="px-3 py-2 font-medium text-slate-700 dark:text-slate-300">{{ formatDate(log.duty_date) }}</td>
                                    <td class="px-3 py-2 text-right font-medium text-slate-600 dark:text-slate-400">{{ formatHours(log.recorded_hours) }} hrs</td>
                                    <td class="px-3 py-2 text-right font-medium text-rose-600 dark:text-rose-400">-{{ formatHours(log.break_deduction) }} hrs</td>
                                    <td class="px-3 py-2 text-right font-bold text-emerald-700 dark:text-emerald-400">{{ formatHours(log.credited_hours) }} hrs</td>
                                    <td class="px-3 py-2">
                                        <span class="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold"
                                              :class="log.status === 'PRESENT' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'">
                                            {{ log.status || 'RECORDED' }}
                                        </span>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                    <div v-else class="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 dark:border-slate-700 dark:bg-slate-900/40 p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                        Attendance logs for this cutoff period are aggregated directly in the verified computation record.
                    </div>
                </div>

                <!-- Footer Close Button -->
                <div class="flex items-center justify-end pt-3 border-t border-slate-100 dark:border-slate-800">
                    <button type="button" @click="showComputationModal = false"
                            class="rounded-xl border border-slate-300 bg-white hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-200 px-5 py-2 text-xs font-semibold text-slate-700 transition">
                        Close
                    </button>
                </div>
            </div>
        </app-modal>
    </div>
    `
};
