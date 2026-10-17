// Student Assistant > My History (/sa/history)
// Read-only historical archive of attendance, allowance cutoffs, memos, requests, incidents, and schedules.
const SaHistoryPage = {
    components: { AppIcon, AppModal },

    setup() {
        const loading = Vue.ref(true);
        const loadError = Vue.ref("");
        const summary = Vue.ref({
            counts: {
                attendance: 0,
                allowance: 0,
                memos: 0,
                requests: 0,
                incidents: 0,
                schedules: 0
            },
            semesters: [],
            currentSemester: null,
            sa: null
        });

        const selectedSemesterId = Vue.ref(null);
        const searchQuery = Vue.ref("");

        // Modal states
        const activeCategory = Vue.ref(null); // 'attendance' | 'allowance' | 'memos' | 'requests' | 'incidents' | 'schedules'
        const modalLoading = Vue.ref(false);
        const modalRecords = Vue.ref([]);
        const modalTotalRecords = Vue.ref(0);
        const modalPage = Vue.ref(1);
        const modalLimit = Vue.ref(8);
        const modalTotalPages = Vue.ref(1);
        const modalSearch = Vue.ref("");
        const modalStatusFilter = Vue.ref("");
        const modalDateFrom = Vue.ref("");
        const modalDateTo = Vue.ref("");

        // Detail view inside modal
        const selectedRecord = Vue.ref(null);
        const detailLoading = Vue.ref(false);
        const detailData = Vue.ref(null);

        // Formatters
        const formatPeso = (val) => {
            return "₱" + (Number(val) || 0).toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
            });
        };

        const formatHours = (val) => {
            const num = Number(val) || 0;
            return num.toFixed(2) + " hrs";
        };

        const formatDate = (val) => {
            if (!val) return "—";
            try {
                const parts = String(val).split("T")[0].split("-");
                if (parts.length === 3) {
                    const d = new Date(parts[0], parts[1] - 1, parts[2]);
                    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                }
                return val;
            } catch (e) {
                return val;
            }
        };

        const formatTime = (timeStr) => {
            if (!timeStr) return "—";
            const parts = timeStr.split(":");
            if (parts.length < 2) return timeStr;
            let h = parseInt(parts[0], 10);
            const m = parts[1];
            const ampm = h >= 12 ? "PM" : "AM";
            h = h % 12 || 12;
            return `${h}:${m} ${ampm}`;
        };

        // Category configurations matching mockup
        const categoryConfigs = {
            attendance: {
                key: "attendance",
                title: "Attendance History",
                description: "View your past attendance records, including check-in/out times, status, and verification details.",
                icon: "Calendar",
                iconBg: "bg-blue-100 text-blue-600 dark:bg-blue-950/60 dark:text-blue-400 dark:border-blue-900/40",
                badgeBg: "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300",
                countLabel: "Total Records",
                countKey: "attendance",
                statusOptions: [
                    { value: "", label: "All Statuses" },
                    { value: "PRESENT", label: "Present" },
                    { value: "LATE", label: "Late" },
                    { value: "ABSENT", label: "Absent" },
                    { value: "EXCUSED", label: "Excused" },
                    { value: "INCOMPLETE", label: "Incomplete" },
                    { value: "APPROVED", label: "Verified / Approved" }
                ]
            },
            allowance: {
                key: "allowance",
                title: "Allowance History",
                description: "See your previous cutoff computations, amounts, and payment status.",
                icon: "Wallet",
                iconBg: "bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400 dark:border-amber-900/40",
                badgeBg: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
                countLabel: "Total Cutoffs",
                countKey: "allowance",
                statusOptions: [
                    { value: "", label: "All Statuses" },
                    { value: "SETTLED", label: "Settled" },
                    { value: "PROCESSING_CONFIRMED", label: "Processing Confirmed" },
                    { value: "ENDORSED_TO_ACCOUNTING", label: "Endorsed to Accounting" },
                    { value: "READY_FOR_ENDORSEMENT", label: "Verified" },
                    { value: "FOR_REVIEW", label: "For Verification" }
                ]
            },
            memos: {
                key: "memos",
                title: "Memos & Official Notices",
                description: "Access official memos, announcements, and important notices sent to you.",
                icon: "FileText",
                iconBg: "bg-purple-100 text-purple-600 dark:bg-purple-950/60 dark:text-purple-400 dark:border-purple-900/40",
                badgeBg: "bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300",
                countLabel: "Total Memos",
                countKey: "memos",
                statusOptions: [
                    { value: "", label: "All Statuses" },
                    { value: "ISSUED", label: "Issued" },
                    { value: "ACKNOWLEDGED", label: "Acknowledged" }
                ]
            },
            requests: {
                key: "requests",
                title: "Request History",
                description: "Track your submitted requests and their final decisions.",
                icon: "ClipboardCheck",
                iconBg: "bg-emerald-100 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400 dark:border-emerald-900/40",
                badgeBg: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
                countLabel: "Total Requests",
                countKey: "requests",
                statusOptions: [
                    { value: "", label: "All Statuses" },
                    { value: "RECORDED", label: "Recorded / Approved" },
                    { value: "PENDING_COORDINATOR_RECORDING", label: "Pending Coordinator" },
                    { value: "PENDING_SUPERVISOR_REVIEW", label: "Pending Supervisor" },
                    { value: "RETURNED_TO_SA", label: "Returned for Revision" },
                    { value: "REJECTED_BY_SUPERVISOR", label: "Rejected" }
                ]
            },
            incidents: {
                key: "incidents",
                title: "Incident Records",
                description: "View official late, absence, or undertime notices and their resolutions.",
                icon: "ShieldAlert",
                iconBg: "bg-rose-100 text-rose-600 dark:bg-rose-950/60 dark:text-rose-400 dark:border-rose-900/40",
                badgeBg: "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
                countLabel: "Total Records",
                countKey: "incidents",
                statusOptions: [
                    { value: "", label: "All Statuses" },
                    { value: "VALID", label: "Valid" },
                    { value: "CORRECTED", label: "Corrected" },
                    { value: "VOIDED", label: "Voided" }
                ]
            },
            schedules: {
                key: "schedules",
                title: "Schedule History",
                description: "Check your previous duty schedules, including any changes or adjustments.",
                icon: "CalendarClock",
                iconBg: "bg-sky-100 text-sky-600 dark:bg-sky-950/60 dark:text-sky-400 dark:border-sky-900/40",
                badgeBg: "bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
                countLabel: "Total Schedules",
                countKey: "schedules",
                statusOptions: [
                    { value: "", label: "All Schedules" }
                ]
            }
        };

        const loadSummary = async () => {
            loading.value = true;
            loadError.value = "";
            const payload = {
                action: "my_history",
                type: "summary",
                semesterId: selectedSemesterId.value || undefined
            };
            const r = await Model.request("sa", "my_history", payload);
            loading.value = false;
            if (!r.success) {
                loadError.value = r.message || "Failed to load history summary.";
                return;
            }
            summary.value = r;
            if (!selectedSemesterId.value && r.currentSemester && r.currentSemester.id) {
                selectedSemesterId.value = r.currentSemester.id;
            }
        };

        const loadCategoryRecords = async () => {
            if (!activeCategory.value) return;
            modalLoading.value = true;
            const payload = {
                action: "my_history",
                type: "records",
                category: activeCategory.value,
                semesterId: selectedSemesterId.value || undefined,
                search: modalSearch.value || undefined,
                status: modalStatusFilter.value || undefined,
                dateFrom: modalDateFrom.value || undefined,
                dateTo: modalDateTo.value || undefined,
                page: modalPage.value,
                limit: modalLimit.value
            };
            const r = await Model.request("sa", "my_history", payload);
            modalLoading.value = false;
            if (r.success) {
                modalRecords.value = r.records || [];
                modalTotalRecords.value = r.totalRecords || 0;
                modalTotalPages.value = r.totalPages || 1;
            } else {
                modalRecords.value = [];
                modalTotalRecords.value = 0;
                modalTotalPages.value = 1;
            }
        };

        const openCategoryModal = (catKey) => {
            activeCategory.value = catKey;
            selectedRecord.value = null;
            detailData.value = null;
            modalSearch.value = searchQuery.value || "";
            modalStatusFilter.value = "";
            modalDateFrom.value = "";
            modalDateTo.value = "";
            modalPage.value = 1;
            loadCategoryRecords();
        };

        const closeCategoryModal = () => {
            activeCategory.value = null;
            selectedRecord.value = null;
            detailData.value = null;
        };

        const viewRecordDetails = async (record) => {
            selectedRecord.value = record;
            detailLoading.value = true;
            detailData.value = null;
            const r = await Model.request("sa", "my_history", {
                action: "my_history",
                category: activeCategory.value,
                recordId: record.id,
                getDetail: true
            });
            detailLoading.value = false;
            if (r.success) {
                detailData.value = r;
            }
        };

        const backToRecords = () => {
            selectedRecord.value = null;
            detailData.value = null;
        };

        const changePage = (newPage) => {
            if (newPage < 1 || newPage > modalTotalPages.value) return;
            modalPage.value = newPage;
            loadCategoryRecords();
        };

        const onSemesterChange = () => {
            loadSummary();
            if (activeCategory.value) {
                modalPage.value = 1;
                loadCategoryRecords();
            }
        };

        // Status badge color helpers
        const getStatusBadge = (status) => {
            const s = String(status || "").toUpperCase();
            if (["PRESENT", "SETTLED", "RECORDED", "APPROVED", "VALID", "ACKNOWLEDGED"].includes(s)) {
                return { label: s.replace(/_/g, " "), class: "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/50" };
            }
            if (["READY_FOR_ENDORSEMENT", "PROCESSING_CONFIRMED", "ISSUED"].includes(s)) {
                return { label: s.replace(/_/g, " "), class: "bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800/50" };
            }
            if (["FOR_REVIEW", "PENDING_COORDINATOR_RECORDING", "PENDING_SUPERVISOR_REVIEW", "AWAITING_ATTENDANCE", "PENDING_VERIFICATION", "LATE"].includes(s)) {
                return { label: s.replace(/_/g, " "), class: "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/50" };
            }
            if (["ABSENT", "REJECTED_BY_SUPERVISOR", "VOIDED"].includes(s)) {
                return { label: s.replace(/_/g, " "), class: "bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/50" };
            }
            if (["RETURNED_TO_SA", "RETURNED_FOR_CLARIFICATION", "EXCUSED", "CORRECTED"].includes(s)) {
                return { label: s.replace(/_/g, " "), class: "bg-purple-50 text-purple-700 border border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-800/50" };
            }
            return { label: s.replace(/_/g, " ") || "Pending", class: "bg-slate-100 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700" };
        };

        const activeCategoryConfig = Vue.computed(() => {
            return activeCategory.value ? categoryConfigs[activeCategory.value] : null;
        });

        // Filter cards by main page search query
        const filteredCategories = Vue.computed(() => {
            const q = searchQuery.value.toLowerCase().trim();
            const list = [
                categoryConfigs.attendance,
                categoryConfigs.allowance,
                categoryConfigs.memos,
                categoryConfigs.requests,
                categoryConfigs.incidents,
                categoryConfigs.schedules
            ];
            if (!q) return list;
            return list.filter(c => c.title.toLowerCase().includes(q) || c.description.toLowerCase().includes(q));
        });

        Vue.onMounted(() => {
            loadSummary();
        });

        return {
            loading,
            loadError,
            summary,
            selectedSemesterId,
            searchQuery,
            activeCategory,
            activeCategoryConfig,
            modalLoading,
            modalRecords,
            modalTotalRecords,
            modalPage,
            modalLimit,
            modalTotalPages,
            modalSearch,
            modalStatusFilter,
            modalDateFrom,
            modalDateTo,
            selectedRecord,
            detailLoading,
            detailData,
            categoryConfigs,
            filteredCategories,
            formatPeso,
            formatHours,
            formatDate,
            formatTime,
            getStatusBadge,
            loadSummary,
            loadCategoryRecords,
            openCategoryModal,
            closeCategoryModal,
            viewRecordDetails,
            backToRecords,
            changePage,
            onSemesterChange
        };
    },

    template: `
    <div class="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 space-y-6">
        
        <!-- Header Banner matching media_1792122060404_fd2ee704.jpg -->
        <div class="relative overflow-hidden rounded-3xl bg-gradient-to-r from-white via-blue-50/30 to-indigo-50/40 p-6 sm:p-8 border border-slate-200/80 shadow-sm dark:bg-gradient-to-r dark:from-slate-900 dark:via-slate-900 dark:to-slate-850 dark:border-slate-800">
            <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                
                <!-- Left Title & Subtitle -->
                <div class="max-w-2xl">
                    <h1 class="text-3xl font-extrabold tracking-tight text-slate-800 dark:text-slate-100 sm:text-4xl">
                        My History
                    </h1>
                    <p class="mt-2 text-base font-medium text-slate-600 dark:text-slate-300">
                        Your past records, achievements, and official documents.
                    </p>
                    <p class="mt-1 text-sm text-slate-500 dark:text-slate-400">
                        View your previous attendance, allowance, requests, memos, schedules, and more.
                    </p>
                </div>

                <!-- Right Mascot Card with "Every record builds your journey ♡" -->
                <div class="flex items-center justify-end gap-3 self-end sm:self-center shrink-0">
                    <div class="text-right select-none">
                        <p class="font-caveat text-xl sm:text-2xl font-bold text-sky-600 dark:text-sky-400 tracking-wide" style="font-family: 'Caveat', 'Segoe Print', cursive;">
                            Every record<br>builds your journey ♡
                        </p>
                        <!-- Gentle hand-drawn curved arc SVG -->
                        <svg class="w-36 h-3 text-sky-400 dark:text-sky-500 ml-auto mt-0.5" viewBox="0 0 140 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M2 9C38 2 102 2 138 9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
                        </svg>
                    </div>

                    <!-- Cute Robot Mascot with Graduation Cap Vector SVG -->
                    <div class="relative w-20 h-20 sm:w-24 sm:h-24 shrink-0 transition-transform hover:scale-105 duration-200">
                        <!-- Floating sparkle stars -->
                        <span class="absolute -top-1 -right-1 text-amber-400 text-sm animate-pulse">✦</span>
                        <span class="absolute top-2 -left-2 text-sky-400 text-xs animate-ping">★</span>
                        
                        <svg viewBox="0 0 120 120" class="w-full h-full drop-shadow-md" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <!-- Soft drop shadow -->
                            <ellipse cx="60" cy="112" rx="34" ry="6" fill="#000000" fill-opacity="0.12"/>
                            
                            <!-- Robot Body -->
                            <ellipse cx="60" cy="80" rx="36" ry="28" fill="#FFFFFF" stroke="#3B82F6" stroke-width="3"/>
                            <!-- Inner chest panel -->
                            <rect x="42" y="70" width="36" height="20" rx="6" fill="#EFF6FF" stroke="#93C5FD" stroke-width="1.5"/>
                            <circle cx="50" cy="80" r="3" fill="#3B82F6"/>
                            <circle cx="60" cy="80" r="3" fill="#10B981"/>
                            <circle cx="70" cy="80" r="3" fill="#F59E0B"/>

                            <!-- Robot Head -->
                            <rect x="28" y="28" width="64" height="46" rx="23" fill="#FFFFFF" stroke="#2563EB" stroke-width="3"/>
                            
                            <!-- Visor Screen -->
                            <rect x="34" y="34" width="52" height="34" rx="17" fill="#1E3A8A"/>
                            
                            <!-- Happy Eyes (Big glossy curved cyan arches) -->
                            <path d="M43 51C43 45 49 45 49 51" stroke="#38BDF8" stroke-width="4" stroke-linecap="round"/>
                            <path d="M71 51C71 45 77 45 77 51" stroke="#38BDF8" stroke-width="4" stroke-linecap="round"/>
                            <circle cx="46" cy="46" r="1.5" fill="#FFFFFF"/>
                            <circle cx="74" cy="46" r="1.5" fill="#FFFFFF"/>
                            
                            <!-- Cute rosy cheeks -->
                            <ellipse cx="39" cy="56" rx="3" ry="1.5" fill="#F472B6" fill-opacity="0.8"/>
                            <ellipse cx="81" cy="56" rx="3" ry="1.5" fill="#F472B6" fill-opacity="0.8"/>
                            
                            <!-- Side ear antennas -->
                            <rect x="22" y="44" width="6" height="14" rx="3" fill="#93C5FD" stroke="#2563EB" stroke-width="2"/>
                            <rect x="92" y="44" width="6" height="14" rx="3" fill="#93C5FD" stroke="#2563EB" stroke-width="2"/>

                            <!-- Graduation Mortarboard Cap -->
                            <polygon points="60,6 106,20 60,34 14,20" fill="#1E293B" stroke="#0F172A" stroke-width="2"/>
                            <polygon points="36,27 36,36 60,43 84,36 84,27" fill="#0F172A"/>
                            <!-- Button and Gold Tassel -->
                            <circle cx="60" cy="20" r="3.5" fill="#F59E0B"/>
                            <path d="M60 20C72 23 88 32 86 46" stroke="#F59E0B" stroke-width="2" stroke-linecap="round"/>
                            <rect x="83" y="46" width="6" height="8" rx="1.5" fill="#F59E0B"/>

                            <!-- Certificate binder in hand -->
                            <g transform="translate(76, 70) rotate(-12)">
                                <rect x="0" y="0" width="22" height="28" rx="3" fill="#FDE68A" stroke="#F59E0B" stroke-width="1.8"/>
                                <rect x="4" y="6" width="14" height="2.5" rx="1" fill="#D97706"/>
                                <rect x="4" y="11" width="10" height="2.5" rx="1" fill="#D97706"/>
                                <polygon points="11,18 15,24 7,24" fill="#3B82F6"/>
                            </g>
                            <!-- Right hand holding certificate -->
                            <circle cx="78" cy="85" r="5" fill="#DBEAFE" stroke="#3B82F6" stroke-width="2"/>
                        </svg>
                    </div>
                </div>

            </div>

            <!-- Compact Search and Filter Bar -->
            <div class="mt-6 pt-5 border-t border-slate-200/70 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
                
                <!-- Search input -->
                <div class="relative flex-1 min-w-[260px] max-w-md">
                    <span class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                        <app-icon name="Search" :size="16" />
                    </span>
                    <input type="text" v-model="searchQuery" placeholder="Search history categories or records..."
                           class="w-full pl-10 pr-9 py-2 text-sm rounded-xl border border-slate-200 bg-white/90 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 transition-all shadow-2xs">
                    <button v-if="searchQuery" @click="searchQuery = ''" class="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200">
                        <app-icon name="X" :size="14" />
                    </button>
                </div>

                <!-- Semester Selector -->
                <div class="flex items-center gap-2">
                    <span class="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <app-icon name="Calendar" :size="14" /> Academic Period:
                    </span>
                    <select v-model="selectedSemesterId" @change="onSemesterChange"
                            class="text-xs font-medium py-2 px-3 rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 shadow-2xs">
                        <option :value="null">All Semesters</option>
                        <option v-for="sem in summary.semesters" :key="sem.id" :value="sem.id">
                            {{ sem.term }} Term AY {{ sem.academic_year }} ({{ sem.status }})
                        </option>
                    </select>
                </div>

            </div>
        </div>

        <!-- Six Category Cards Grid (2 columns on desktop, 1 column on mobile) -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-6">
            
            <div v-for="cat in filteredCategories" :key="cat.key"
                 @click="openCategoryModal(cat.key)"
                 class="group relative flex flex-col justify-between rounded-3xl bg-white p-6 border border-slate-200/90 shadow-sm transition-all duration-200 hover:shadow-md hover:border-blue-300 dark:bg-slate-900 dark:border-slate-800 dark:hover:border-slate-700 cursor-pointer">
                
                <div>
                    <!-- Top row: Pastel Icon, Title, and Chevron Arrow -->
                    <div class="flex items-start justify-between gap-4">
                        <div class="flex items-center gap-4">
                            <div class="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border transition-transform duration-200 group-hover:scale-105"
                                 :class="cat.iconBg">
                                <app-icon :name="cat.icon" :size="26" />
                            </div>
                            <div>
                                <h2 class="text-lg font-bold text-slate-800 group-hover:text-blue-600 dark:text-slate-100 dark:group-hover:text-blue-400 transition-colors">
                                    {{ cat.title }}
                                </h2>
                            </div>
                        </div>

                        <!-- Chevron arrow -->
                        <span class="p-2 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-1 transition-all">
                            <app-icon name="ChevronRight" :size="20" />
                        </span>
                    </div>

                    <!-- Category Description -->
                    <p class="mt-3 text-sm text-slate-500 dark:text-slate-400 leading-relaxed pr-6">
                        {{ cat.description }}
                    </p>
                </div>

                <!-- Bottom Record Count Pill -->
                <div class="mt-6 pt-4 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
                    <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
                          :class="cat.badgeBg">
                        <app-icon :name="cat.icon" :size="13" />
                        <span>{{ cat.countLabel }}: {{ summary.counts[cat.countKey] ?? 0 }}</span>
                    </span>

                    <span class="text-xs font-medium text-blue-600 dark:text-blue-400 group-hover:underline flex items-center gap-1">
                        View Records
                        <app-icon name="ArrowRight" :size="12" />
                    </span>
                </div>
            </div>

        </div>

        <!-- Quick Tip Banner matching media_1792122060404_fd2ee704.jpg -->
        <div class="rounded-2xl bg-blue-50/70 border border-blue-100/90 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 dark:bg-blue-950/20 dark:border-blue-900/40">
            <div class="flex items-center gap-3.5">
                <div class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-900/50 dark:text-blue-300">
                    <app-icon name="Lightbulb" :size="20" />
                </div>
                <div>
                    <h3 class="text-sm font-bold text-slate-800 dark:text-slate-200">Quick Tip</h3>
                    <p class="text-xs text-slate-600 dark:text-slate-400">
                        For any corrections or updates, submit a request through the <router-link to="/sa/requests" class="text-blue-600 dark:text-blue-400 font-semibold underline">My Requests</router-link> section.
                    </p>
                </div>
            </div>

            <div class="text-right sm:text-right">
                <p class="font-caveat text-lg sm:text-xl font-bold text-sky-600 dark:text-sky-400 whitespace-nowrap" style="font-family: 'Caveat', 'Segoe Print', cursive;">
                    Stay consistent, keep going! ♡
                </p>
            </div>
        </div>

        <!-- CATEGORY RECORDS MODAL -->
        <app-modal :open="!!activeCategory"
                   :title="activeCategoryConfig?.title || 'History Records'"
                   :description="selectedRecord ? 'Detailed record inspection and audit information.' : activeCategoryConfig?.description"
                   :icon="activeCategoryConfig?.icon"
                   size="xl"
                   @close="closeCategoryModal">

            <!-- INSIDE MODAL: DETAIL VIEW (When a record is selected) -->
            <div v-if="selectedRecord" class="space-y-6">
                
                <!-- Back Button & Record Header -->
                <div class="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
                    <button @click="backToRecords"
                            class="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-750 transition-colors shadow-2xs">
                        <app-icon name="ArrowLeft" :size="14" />
                        Back to Records List
                    </button>

                    <div class="flex items-center gap-2">
                        <span class="text-xs text-slate-500 dark:text-slate-400 font-medium">Status:</span>
                        <span class="px-2.5 py-0.5 rounded-full text-xs font-semibold"
                              :class="getStatusBadge(selectedRecord.status || selectedRecord.computation_status || selectedRecord.cutoff_status).class">
                            {{ getStatusBadge(selectedRecord.status || selectedRecord.computation_status || selectedRecord.cutoff_status).label }}
                        </span>
                    </div>
                </div>

                <div v-if="detailLoading" class="py-12 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
                    <span class="inline-block animate-spin text-blue-600">
                        <app-icon name="Loader2" :size="32" />
                    </span>
                    <span class="text-sm font-medium">Loading record details...</span>
                </div>

                <!-- 1. ATTENDANCE RECORD DETAIL -->
                <div v-else-if="activeCategory === 'attendance'" class="space-y-6">
                    <!-- Key stats cards -->
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div class="p-4 rounded-2xl bg-blue-50/60 dark:bg-blue-950/20 border border-blue-100 dark:border-blue-900/40">
                            <span class="text-xs font-medium text-blue-600 dark:text-blue-400">Duty Date</span>
                            <p class="mt-1 text-base font-bold text-slate-800 dark:text-slate-100">{{ formatDate(selectedRecord.duty_date) }}</p>
                        </div>
                        <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/80">
                            <span class="text-xs font-medium text-slate-500 dark:text-slate-400">Credited Hours</span>
                            <p class="mt-1 text-base font-bold text-slate-800 dark:text-slate-100">{{ formatHours(selectedRecord.credited_hours) }}</p>
                        </div>
                        <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/80">
                            <span class="text-xs font-medium text-slate-500 dark:text-slate-400">Scheduled Time</span>
                            <p class="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
                                {{ selectedRecord.scheduled_start ? (formatTime(selectedRecord.scheduled_start) + ' – ' + formatTime(selectedRecord.scheduled_end)) : 'As assigned' }}
                            </p>
                        </div>
                        <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/80">
                            <span class="text-xs font-medium text-slate-500 dark:text-slate-400">Actual Time</span>
                            <p class="mt-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
                                {{ selectedRecord.actual_time_in ? (formatTime(selectedRecord.actual_time_in) + ' – ' + formatTime(selectedRecord.actual_time_out)) : 'Recorded via punches' }}
                            </p>
                        </div>
                    </div>

                    <!-- Verification & Review info -->
                    <div class="rounded-2xl border border-slate-200 dark:border-slate-800 p-4 bg-white dark:bg-slate-900 space-y-3">
                        <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                            <app-icon name="CheckCircle" :size="14" /> Supervisor Verification & Audit Trail
                        </h4>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                            <div>
                                <span class="text-slate-500 dark:text-slate-400">Reviewer:</span>
                                <p class="font-semibold text-slate-800 dark:text-slate-200">{{ selectedRecord.reviewed_by_name || selectedRecord.reconciled_by_name || 'System Reconciled' }}</p>
                            </div>
                            <div>
                                <span class="text-slate-500 dark:text-slate-400">Reconciliation Status:</span>
                                <p class="font-semibold text-slate-800 dark:text-slate-200">{{ selectedRecord.reconciliation_status || 'SYSTEM_GENERATED' }}</p>
                            </div>
                            <div class="sm:col-span-2" v-if="selectedRecord.review_notes || selectedRecord.verification_notes">
                                <span class="text-slate-500 dark:text-slate-400">Reviewer Remarks / Notes:</span>
                                <p class="mt-1 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-850 font-medium text-slate-700 dark:text-slate-300">
                                    {{ selectedRecord.review_notes || selectedRecord.verification_notes }}
                                </p>
                            </div>
                        </div>
                    </div>

                    <!-- Raw biometric punches on this date -->
                    <div v-if="detailData?.punches?.length" class="space-y-3">
                        <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                            <app-icon name="ScanFace" :size="14" /> Raw Time Punches Recorded ({{ detailData.punches.length }})
                        </h4>
                        <div class="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
                            <table class="w-full text-left text-xs">
                                <thead class="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                                    <tr>
                                        <th class="px-4 py-2.5 font-semibold">Type</th>
                                        <th class="px-4 py-2.5 font-semibold">Timestamp</th>
                                        <th class="px-4 py-2.5 font-semibold">Location</th>
                                        <th class="px-4 py-2.5 font-semibold">Verification</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                                    <tr v-for="p in detailData.punches" :key="p.id" class="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                                        <td class="px-4 py-2.5 font-bold text-slate-800 dark:text-slate-200">{{ p.log_type }}</td>
                                        <td class="px-4 py-2.5 text-slate-600 dark:text-slate-300">{{ p.logged_at }}</td>
                                        <td class="px-4 py-2.5 text-slate-600 dark:text-slate-400">{{ p.location_name || 'Campus' }}</td>
                                        <td class="px-4 py-2.5">
                                            <span class="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                                                <app-icon name="Check" :size="12" /> {{ p.verification_status }}
                                            </span>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <!-- 2. ALLOWANCE RECORD DETAIL -->
                <div v-else-if="activeCategory === 'allowance'" class="space-y-6">
                    <!-- Key stats cards -->
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div class="p-4 rounded-2xl bg-amber-50/70 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/40">
                            <span class="text-xs font-medium text-amber-700 dark:text-amber-400">Net Allowance</span>
                            <p class="mt-1 text-xl font-extrabold text-amber-700 dark:text-amber-300">{{ formatPeso(selectedRecord.net_allowance) }}</p>
                        </div>
                        <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/80">
                            <span class="text-xs font-medium text-slate-500 dark:text-slate-400">Gross Allowance</span>
                            <p class="mt-1 text-base font-bold text-slate-800 dark:text-slate-100">{{ formatPeso(selectedRecord.gross_allowance) }}</p>
                        </div>
                        <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/80">
                            <span class="text-xs font-medium text-slate-500 dark:text-slate-400">Credited Hours</span>
                            <p class="mt-1 text-base font-bold text-slate-800 dark:text-slate-100">{{ formatHours(selectedRecord.credited_hours) }}</p>
                        </div>
                        <div class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/80 dark:border-slate-700/80">
                            <span class="text-xs font-medium text-slate-500 dark:text-slate-400">Hourly Rate</span>
                            <p class="mt-1 text-base font-bold text-slate-800 dark:text-slate-100">{{ formatPeso(selectedRecord.hourly_rate) }}/hr</p>
                        </div>
                    </div>

                    <!-- Cutoff Computation Breakdown -->
                    <div class="rounded-2xl border border-slate-200 dark:border-slate-800 p-5 bg-white dark:bg-slate-900 space-y-4">
                        <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                            <app-icon name="Calculator" :size="14" /> Cutoff Breakdown & Settlement
                        </h4>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                            <div>
                                <span class="text-slate-500 dark:text-slate-400">Cutoff Period:</span>
                                <p class="font-semibold text-slate-800 dark:text-slate-200">{{ selectedRecord.cutoff_name || (formatDate(selectedRecord.start_date) + ' – ' + formatDate(selectedRecord.end_date)) }}</p>
                            </div>
                            <div>
                                <span class="text-slate-500 dark:text-slate-400">Cutoff Settlement Status:</span>
                                <p class="font-semibold text-slate-800 dark:text-slate-200">{{ selectedRecord.cutoff_status }}</p>
                            </div>
                            <div>
                                <span class="text-slate-500 dark:text-slate-400">Authorized School Deduction:</span>
                                <p class="font-semibold text-rose-600 dark:text-rose-400">{{ formatPeso(selectedRecord.proposed_deduction || 0) }}</p>
                            </div>
                            <div>
                                <span class="text-slate-500 dark:text-slate-400">Remaining School Balance (After):</span>
                                <p class="font-semibold text-slate-800 dark:text-slate-200">{{ formatPeso(selectedRecord.expected_balance_after || 0) }}</p>
                            </div>
                            <div v-if="selectedRecord.settled_notes" class="sm:col-span-2">
                                <span class="text-slate-500 dark:text-slate-400">Settlement Notes:</span>
                                <p class="mt-1 p-2 rounded-xl bg-slate-50 dark:bg-slate-850 text-slate-700 dark:text-slate-300">{{ selectedRecord.settled_notes }}</p>
                            </div>
                        </div>
                    </div>

                    <!-- Per-duty attendance records in this cutoff -->
                    <div v-if="detailData?.attendanceLogs?.length" class="space-y-3">
                        <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                            <app-icon name="Clock" :size="14" /> Attendance Duties in this Cutoff ({{ detailData.attendanceLogs.length }})
                        </h4>
                        <div class="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
                            <table class="w-full text-left text-xs">
                                <thead class="bg-slate-50 dark:bg-slate-800/60 text-slate-500 border-b border-slate-200 dark:border-slate-800">
                                    <tr>
                                        <th class="px-4 py-2.5 font-semibold">Duty Date</th>
                                        <th class="px-4 py-2.5 font-semibold">Time In / Out</th>
                                        <th class="px-4 py-2.5 font-semibold">Credited</th>
                                        <th class="px-4 py-2.5 font-semibold">Status</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                                    <tr v-for="log in detailData.attendanceLogs" :key="log.duty_date" class="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                                        <td class="px-4 py-2.5 font-bold text-slate-800 dark:text-slate-200">{{ formatDate(log.duty_date) }}</td>
                                        <td class="px-4 py-2.5 text-slate-600 dark:text-slate-300">
                                            {{ log.actual_time_in ? (formatTime(log.actual_time_in) + ' – ' + formatTime(log.actual_time_out)) : '—' }}
                                        </td>
                                        <td class="px-4 py-2.5 font-semibold text-slate-800 dark:text-slate-200">{{ formatHours(log.credited_hours) }}</td>
                                        <td class="px-4 py-2.5">
                                            <span class="px-2 py-0.5 rounded-full text-[11px] font-semibold" :class="getStatusBadge(log.status).class">
                                                {{ getStatusBadge(log.status).label }}
                                            </span>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                <!-- 3. MEMOS RECORD DETAIL -->
                <div v-else-if="activeCategory === 'memos'" class="space-y-6">
                    <div class="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
                        <div class="flex items-start justify-between gap-4">
                            <div>
                                <span class="text-xs font-semibold text-purple-600 dark:text-purple-400 uppercase tracking-wider">{{ selectedRecord.warning_level }}</span>
                                <h3 class="text-lg font-bold text-slate-800 dark:text-slate-100 mt-0.5">{{ selectedRecord.subject_line || 'Official Memo Notice' }}</h3>
                                <p class="text-xs text-slate-400 mt-0.5">Ref No: {{ selectedRecord.memo_ref_no }} • Issued: {{ formatDate(selectedRecord.issued_date) }}</p>
                            </div>
                        </div>

                        <div class="p-4 rounded-xl bg-slate-50 dark:bg-slate-850 text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-line">
                            {{ selectedRecord.explanation_body }}
                        </div>

                        <div v-if="selectedRecord.corrective_action" class="p-3.5 rounded-xl bg-purple-50/50 dark:bg-purple-950/20 border border-purple-100 dark:border-purple-900/30 text-xs">
                            <span class="font-bold text-purple-700 dark:text-purple-300">Required Corrective Action:</span>
                            <p class="mt-1 text-slate-600 dark:text-slate-300">{{ selectedRecord.corrective_action }}</p>
                        </div>

                        <div class="pt-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500">
                            <span>Coordinator: {{ selectedRecord.coordinator_name || 'Academic Coordinator' }}</span>
                            <span>Acknowledgment: {{ selectedRecord.acknowledged_at ? ('Acknowledged on ' + formatDate(selectedRecord.acknowledged_at)) : 'Pending Acknowledgment' }}</span>
                        </div>
                    </div>
                </div>

                <!-- 4. REQUESTS RECORD DETAIL -->
                <div v-else-if="activeCategory === 'requests'" class="space-y-6">
                    <div class="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
                        <div class="flex items-start justify-between gap-4">
                            <div>
                                <span class="text-xs font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">{{ selectedRecord.request_type }}</span>
                                <h3 class="text-lg font-bold text-slate-800 dark:text-slate-100 mt-0.5">Ref: {{ selectedRecord.request_ref_no }}</h3>
                                <p class="text-xs text-slate-400 mt-0.5">Filed: {{ formatDate(selectedRecord.date_filed || selectedRecord.submitted_at) }}</p>
                            </div>
                        </div>

                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                            <div>
                                <span class="text-slate-500 dark:text-slate-400">Reason Category:</span>
                                <p class="font-semibold text-slate-800 dark:text-slate-200">{{ selectedRecord.reason_category || 'General' }}</p>
                            </div>
                            <div>
                                <span class="text-slate-500 dark:text-slate-400">Affected Time / Hours:</span>
                                <p class="font-semibold text-slate-800 dark:text-slate-200">{{ selectedRecord.hours_affected ? (formatHours(selectedRecord.hours_affected)) : (selectedRecord.minutes_affected + ' mins') }}</p>
                            </div>
                            <div class="sm:col-span-2">
                                <span class="text-slate-500 dark:text-slate-400">Explanation & Request Details:</span>
                                <p class="mt-1 p-3 rounded-xl bg-slate-50 dark:bg-slate-850 font-medium text-slate-700 dark:text-slate-300 leading-relaxed">
                                    {{ selectedRecord.explanation || 'No explanation specified.' }}
                                </p>
                            </div>
                        </div>

                        <!-- Supervisor review notes -->
                        <div v-if="selectedRecord.supervisor_decision" class="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-850 border border-slate-200 dark:border-slate-800 text-xs space-y-1">
                            <span class="font-bold text-slate-700 dark:text-slate-300">Supervisor Decision: {{ selectedRecord.supervisor_decision }} (by {{ selectedRecord.supervisor_name || 'Supervisor' }})</span>
                            <p v-if="selectedRecord.supervisor_remarks" class="text-slate-600 dark:text-slate-400">Remarks: {{ selectedRecord.supervisor_remarks }}</p>
                        </div>
                    </div>
                </div>

                <!-- 5. INCIDENTS RECORD DETAIL -->
                <div v-else-if="activeCategory === 'incidents'" class="space-y-6">
                    <div class="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
                        <div class="flex items-start justify-between gap-4">
                            <div>
                                <span class="text-xs font-bold text-rose-600 dark:text-rose-400 uppercase tracking-wider">{{ selectedRecord.category }}</span>
                                <h3 class="text-lg font-bold text-slate-800 dark:text-slate-100 mt-0.5">Incident on {{ formatDate(selectedRecord.incident_date) }}</h3>
                            </div>
                        </div>

                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                            <div>
                                <span class="text-slate-500 dark:text-slate-400">Minutes Affected:</span>
                                <p class="font-semibold text-slate-800 dark:text-slate-200">{{ selectedRecord.minutes_affected }} mins</p>
                            </div>
                            <div>
                                <span class="text-slate-500 dark:text-slate-400">Recorded By:</span>
                                <p class="font-semibold text-slate-800 dark:text-slate-200">{{ selectedRecord.recorded_by_name || 'System / Coordinator' }}</p>
                            </div>
                            <div class="sm:col-span-2" v-if="selectedRecord.evidence_notes">
                                <span class="text-slate-500 dark:text-slate-400">Evidence / Incident Notes:</span>
                                <p class="mt-1 p-3 rounded-xl bg-slate-50 dark:bg-slate-850 text-slate-700 dark:text-slate-300">
                                    {{ selectedRecord.evidence_notes }}
                                </p>
                            </div>
                            <div class="sm:col-span-2" v-if="selectedRecord.correction_notes">
                                <span class="text-slate-500 dark:text-slate-400">Resolution / Correction:</span>
                                <p class="mt-1 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-300 border border-emerald-100 dark:border-emerald-900/30">
                                    {{ selectedRecord.correction_notes }}
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 6. SCHEDULE RECORD DETAIL -->
                <div v-else-if="activeCategory === 'schedules'" class="space-y-6">
                    <div class="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                            <div>
                                <span class="text-slate-500 dark:text-slate-400">Day & Time:</span>
                                <p class="text-sm font-bold text-slate-800 dark:text-slate-100">{{ selectedRecord.day_of_week }} • {{ formatTime(selectedRecord.start_time) }} – {{ formatTime(selectedRecord.end_time) }}</p>
                            </div>
                            <div>
                                <span class="text-slate-500 dark:text-slate-400">Location & Department:</span>
                                <p class="text-sm font-bold text-slate-800 dark:text-slate-100">{{ selectedRecord.location }} ({{ selectedRecord.department }})</p>
                            </div>
                            <div>
                                <span class="text-slate-500 dark:text-slate-400">Supervisor:</span>
                                <p class="font-semibold text-slate-800 dark:text-slate-200">{{ selectedRecord.supervisor_name || 'As assigned' }}</p>
                            </div>
                            <div>
                                <span class="text-slate-500 dark:text-slate-400">Assignment Source:</span>
                                <p class="font-semibold text-slate-800 dark:text-slate-200">{{ selectedRecord.source }}</p>
                            </div>
                        </div>

                        <!-- Schedule change audit trail if any -->
                        <div v-if="detailData?.changes?.length" class="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 space-y-3">
                            <h4 class="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                                <app-icon name="History" :size="14" /> Schedule Change History
                            </h4>
                            <div class="space-y-2">
                                <div v-for="ch in detailData.changes" :key="ch.id" class="p-3 rounded-xl bg-slate-50 dark:bg-slate-850 text-xs space-y-1">
                                    <div class="flex justify-between font-semibold text-slate-700 dark:text-slate-300">
                                        <span>Change Type: {{ ch.change_type }}</span>
                                        <span>Effective: {{ formatDate(ch.effective_date) }}</span>
                                    </div>
                                    <p class="text-slate-500">Reason: {{ ch.reason || 'Official schedule adjustment' }}</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

            </div>

            <!-- INSIDE MODAL: LIST VIEW (Default table / list with filters) -->
            <div v-else class="space-y-5">
                
                <!-- Compact search and filters within modal -->
                <div class="flex flex-wrap items-center justify-between gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-850 border border-slate-200/80 dark:border-slate-800">
                    
                    <!-- Search input -->
                    <div class="relative flex-1 min-w-[200px]">
                        <span class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                            <app-icon name="Search" :size="14" />
                        </span>
                        <input type="text" v-model="modalSearch" @input="loadCategoryRecords"
                               placeholder="Search records..."
                               class="w-full pl-9 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 shadow-2xs">
                    </div>

                    <!-- Category Status dropdown -->
                    <div v-if="activeCategoryConfig?.statusOptions?.length > 1" class="w-auto">
                        <select v-model="modalStatusFilter" @change="loadCategoryRecords"
                                class="text-xs font-medium py-1.5 px-3 rounded-xl border border-slate-200 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 shadow-2xs">
                            <option v-for="opt in activeCategoryConfig.statusOptions" :key="opt.value" :value="opt.value">
                                {{ opt.label }}
                            </option>
                        </select>
                    </div>

                    <!-- Record counter -->
                    <span class="text-xs font-semibold text-slate-500 dark:text-slate-400">
                        {{ modalTotalRecords }} record{{ modalTotalRecords === 1 ? '' : 's' }}
                    </span>
                </div>

                <!-- Loading State -->
                <div v-if="modalLoading" class="py-16 text-center text-slate-400 flex flex-col items-center justify-center gap-3">
                    <span class="inline-block animate-spin text-blue-600">
                        <app-icon name="Loader2" :size="32" />
                    </span>
                    <span class="text-sm font-medium">Loading {{ activeCategoryConfig?.title }}...</span>
                </div>

                <!-- Empty State (No records found) -->
                <div v-else-if="!modalRecords.length"
                     class="py-14 text-center rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center gap-3 px-6">
                    <div class="grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800/80 dark:text-slate-500">
                        <app-icon :name="activeCategoryConfig?.icon || 'FolderOpen'" :size="28" />
                    </div>
                    <div>
                        <h4 class="text-base font-bold text-slate-700 dark:text-slate-200">No Records Found</h4>
                        <p class="mt-1 text-xs text-slate-500 dark:text-slate-400 max-w-sm">
                            There are currently no recorded entries in your {{ activeCategoryConfig?.title.toLowerCase() }} for the selected filters.
                        </p>
                    </div>
                </div>

                <!-- Table View for Category Records -->
                <div v-else class="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800">
                    <table class="w-full text-left text-xs">
                        <thead class="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 font-semibold border-b border-slate-200 dark:border-slate-800">
                            
                            <!-- Attendance Columns -->
                            <tr v-if="activeCategory === 'attendance'">
                                <th class="px-4 py-3">Duty Date</th>
                                <th class="px-4 py-3">Scheduled</th>
                                <th class="px-4 py-3">Actual Time</th>
                                <th class="px-4 py-3">Credited</th>
                                <th class="px-4 py-3">Status</th>
                                <th class="px-4 py-3 text-right">Action</th>
                            </tr>

                            <!-- Allowance Columns -->
                            <tr v-else-if="activeCategory === 'allowance'">
                                <th class="px-4 py-3">Cutoff Period</th>
                                <th class="px-4 py-3">Credited Hours</th>
                                <th class="px-4 py-3">Hourly Rate</th>
                                <th class="px-4 py-3">Net Allowance</th>
                                <th class="px-4 py-3">Status</th>
                                <th class="px-4 py-3 text-right">Action</th>
                            </tr>

                            <!-- Memos Columns -->
                            <tr v-else-if="activeCategory === 'memos'">
                                <th class="px-4 py-3">Ref No</th>
                                <th class="px-4 py-3">Subject / Violation</th>
                                <th class="px-4 py-3">Issued Date</th>
                                <th class="px-4 py-3">Status</th>
                                <th class="px-4 py-3 text-right">Action</th>
                            </tr>

                            <!-- Requests Columns -->
                            <tr v-else-if="activeCategory === 'requests'">
                                <th class="px-4 py-3">Ref No</th>
                                <th class="px-4 py-3">Request Type</th>
                                <th class="px-4 py-3">Date Filed</th>
                                <th class="px-4 py-3">Status</th>
                                <th class="px-4 py-3 text-right">Action</th>
                            </tr>

                            <!-- Incidents Columns -->
                            <tr v-else-if="activeCategory === 'incidents'">
                                <th class="px-4 py-3">Date</th>
                                <th class="px-4 py-3">Incident Category</th>
                                <th class="px-4 py-3">Minutes</th>
                                <th class="px-4 py-3">Status</th>
                                <th class="px-4 py-3 text-right">Action</th>
                            </tr>

                            <!-- Schedules Columns -->
                            <tr v-else-if="activeCategory === 'schedules'">
                                <th class="px-4 py-3">Day of Week</th>
                                <th class="px-4 py-3">Time Range</th>
                                <th class="px-4 py-3">Location</th>
                                <th class="px-4 py-3">Supervisor</th>
                                <th class="px-4 py-3 text-right">Action</th>
                            </tr>

                        </thead>
                        <tbody class="divide-y divide-slate-100 dark:divide-slate-800">
                            
                            <!-- Attendance Rows -->
                            <template v-if="activeCategory === 'attendance'">
                                <tr v-for="r in modalRecords" :key="r.id" class="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                                    <td class="px-4 py-3 font-bold text-slate-800 dark:text-slate-100">{{ formatDate(r.duty_date) }}</td>
                                    <td class="px-4 py-3 text-slate-600 dark:text-slate-400">
                                        {{ r.scheduled_start ? (formatTime(r.scheduled_start) + ' – ' + formatTime(r.scheduled_end)) : 'As assigned' }}
                                    </td>
                                    <td class="px-4 py-3 text-slate-600 dark:text-slate-400">
                                        {{ r.actual_time_in ? (formatTime(r.actual_time_in) + ' – ' + formatTime(r.actual_time_out)) : '—' }}
                                    </td>
                                    <td class="px-4 py-3 font-semibold text-slate-800 dark:text-slate-200">{{ formatHours(r.credited_hours) }}</td>
                                    <td class="px-4 py-3">
                                        <span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold" :class="getStatusBadge(r.status).class">
                                            {{ getStatusBadge(r.status).label }}
                                        </span>
                                    </td>
                                    <td class="px-4 py-3 text-right">
                                        <button @click="viewRecordDetails(r)"
                                                class="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-400 transition-colors">
                                            View Details
                                        </button>
                                    </td>
                                </tr>
                            </template>

                            <!-- Allowance Rows -->
                            <template v-else-if="activeCategory === 'allowance'">
                                <tr v-for="r in modalRecords" :key="r.id" class="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                                    <td class="px-4 py-3 font-bold text-slate-800 dark:text-slate-100">
                                        {{ r.cutoff_name || (formatDate(r.start_date) + ' – ' + formatDate(r.end_date)) }}
                                    </td>
                                    <td class="px-4 py-3 font-semibold text-slate-800 dark:text-slate-200">{{ formatHours(r.credited_hours) }}</td>
                                    <td class="px-4 py-3 text-slate-600 dark:text-slate-400">{{ formatPeso(r.hourly_rate) }}/hr</td>
                                    <td class="px-4 py-3 font-extrabold text-amber-700 dark:text-amber-400">{{ formatPeso(r.net_allowance) }}</td>
                                    <td class="px-4 py-3">
                                        <span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold" :class="getStatusBadge(r.cutoff_status).class">
                                            {{ getStatusBadge(r.cutoff_status).label }}
                                        </span>
                                    </td>
                                    <td class="px-4 py-3 text-right">
                                        <button @click="viewRecordDetails(r)"
                                                class="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300 transition-colors">
                                            View Details
                                        </button>
                                    </td>
                                </tr>
                            </template>

                            <!-- Memos Rows -->
                            <template v-else-if="activeCategory === 'memos'">
                                <tr v-for="r in modalRecords" :key="r.id" class="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                                    <td class="px-4 py-3 font-bold text-purple-700 dark:text-purple-300">{{ r.memo_ref_no }}</td>
                                    <td class="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">{{ r.subject_line }}</td>
                                    <td class="px-4 py-3 text-slate-500">{{ formatDate(r.issued_date) }}</td>
                                    <td class="px-4 py-3">
                                        <span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold" :class="getStatusBadge(r.status).class">
                                            {{ getStatusBadge(r.status).label }}
                                        </span>
                                    </td>
                                    <td class="px-4 py-3 text-right">
                                        <button @click="viewRecordDetails(r)"
                                                class="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-purple-50 text-purple-700 hover:bg-purple-100 dark:bg-purple-950/40 dark:text-purple-300 transition-colors">
                                            View Details
                                        </button>
                                    </td>
                                </tr>
                            </template>

                            <!-- Requests Rows -->
                            <template v-else-if="activeCategory === 'requests'">
                                <tr v-for="r in modalRecords" :key="r.id" class="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                                    <td class="px-4 py-3 font-bold text-emerald-700 dark:text-emerald-400">{{ r.request_ref_no }}</td>
                                    <td class="px-4 py-3 font-medium text-slate-800 dark:text-slate-200">{{ r.request_type }}</td>
                                    <td class="px-4 py-3 text-slate-500">{{ formatDate(r.date_filed || r.submitted_at) }}</td>
                                    <td class="px-4 py-3">
                                        <span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold" :class="getStatusBadge(r.status).class">
                                            {{ getStatusBadge(r.status).label }}
                                        </span>
                                    </td>
                                    <td class="px-4 py-3 text-right">
                                        <button @click="viewRecordDetails(r)"
                                                class="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:bg-emerald-950/40 dark:text-emerald-300 transition-colors">
                                            View Details
                                        </button>
                                    </td>
                                </tr>
                            </template>

                            <!-- Incidents Rows -->
                            <template v-else-if="activeCategory === 'incidents'">
                                <tr v-for="r in modalRecords" :key="r.id" class="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                                    <td class="px-4 py-3 font-bold text-slate-800 dark:text-slate-100">{{ formatDate(r.incident_date) }}</td>
                                    <td class="px-4 py-3 font-medium text-rose-600 dark:text-rose-400">{{ r.category }}</td>
                                    <td class="px-4 py-3 text-slate-600 dark:text-slate-400">{{ r.minutes_affected }} mins</td>
                                    <td class="px-4 py-3">
                                        <span class="px-2.5 py-0.5 rounded-full text-[11px] font-semibold" :class="getStatusBadge(r.status).class">
                                            {{ getStatusBadge(r.status).label }}
                                        </span>
                                    </td>
                                    <td class="px-4 py-3 text-right">
                                        <button @click="viewRecordDetails(r)"
                                                class="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-rose-50 text-rose-700 hover:bg-rose-100 dark:bg-rose-950/40 dark:text-rose-300 transition-colors">
                                            View Details
                                        </button>
                                    </td>
                                </tr>
                            </template>

                            <!-- Schedules Rows -->
                            <template v-else-if="activeCategory === 'schedules'">
                                <tr v-for="r in modalRecords" :key="r.id" class="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                                    <td class="px-4 py-3 font-bold text-slate-800 dark:text-slate-100">{{ r.day_of_week }}</td>
                                    <td class="px-4 py-3 text-slate-600 dark:text-slate-400">
                                        {{ formatTime(r.start_time) }} – {{ formatTime(r.end_time) }}
                                    </td>
                                    <td class="px-4 py-3 text-slate-800 dark:text-slate-200 font-medium">{{ r.location }}</td>
                                    <td class="px-4 py-3 text-slate-500">{{ r.supervisor_name || 'As assigned' }}</td>
                                    <td class="px-4 py-3 text-right">
                                        <button @click="viewRecordDetails(r)"
                                                class="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-sky-50 text-sky-700 hover:bg-sky-100 dark:bg-sky-950/40 dark:text-sky-300 transition-colors">
                                            View Details
                                        </button>
                                    </td>
                                </tr>
                            </template>

                        </tbody>
                    </table>
                </div>

                <!-- Pagination footer -->
                <div v-if="modalTotalPages > 1" class="flex items-center justify-between pt-3 text-xs text-slate-500 dark:text-slate-400">
                    <span>Page {{ modalPage }} of {{ modalTotalPages }}</span>
                    <div class="flex items-center gap-2">
                        <button :disabled="modalPage <= 1" @click="changePage(modalPage - 1)"
                                class="px-3 py-1 rounded-lg border border-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                            Previous
                        </button>
                        <button :disabled="modalPage >= modalTotalPages" @click="changePage(modalPage + 1)"
                                class="px-3 py-1 rounded-lg border border-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800">
                            Next
                        </button>
                    </div>
                </div>

            </div>

            <!-- Modal footer -->
            <template #footer>
                <div class="flex w-full items-center justify-between">
                    <span class="text-xs text-slate-400">AssistPay Official Historical Archive</span>
                    <button @click="closeCategoryModal"
                            class="px-4 py-2 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 shadow-2xs">
                        Close
                    </button>
                </div>
            </template>

        </app-modal>

    </div>
    `
};

