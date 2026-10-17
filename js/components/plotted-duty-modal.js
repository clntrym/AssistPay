// Modal for S.A. Coordinator to review and approve/reject plotted duty schedules submitted by S.A.s
const PlottedDutyModal = {
    components: { AppIcon, AppModal },

    props: {
        open: { type: Boolean, default: false }
    },

    emits: ["close", "reviewed"],

    setup(props, { emit }) {
        const loading = Vue.ref(false);
        const submissions = Vue.ref([]);
        const pendingCount = Vue.ref(0);
        const filter = Vue.ref("ALL"); // ALL, PENDING, APPROVED, REJECTED
        const reviewingId = Vue.ref(null);

        // State for Schedule Detail Modal (Grid View)
        const viewingSub = Vue.ref(null);
        const gridViewMode = Vue.ref("grid"); // "grid" | "table"
        const optionalNote = Vue.ref("");

        const DAYS = {
            MON: "Monday", TUE: "Tuesday", WED: "Wednesday",
            THU: "Thursday", FRI: "Friday", SAT: "Saturday"
        };

        const BASE_DAYS_LIST = [
            { code: "MON", label: "Monday", short: "Mon" },
            { code: "TUE", label: "Tuesday", short: "Tue" },
            { code: "WED", label: "Wednesday", short: "Wed" },
            { code: "THU", label: "Thursday", short: "Thu" },
            { code: "FRI", label: "Friday", short: "Fri" },
            { code: "SAT", label: "Saturday", short: "Sat" }
        ];

        const formatTime12 = m => {
            const hrs = Math.floor(m / 60);
            const mins = m % 60;
            const h12 = hrs % 12 === 0 ? 12 : hrs % 12;
            const ampm = hrs >= 12 ? "PM" : "AM";
            return `${h12}:${String(mins).padStart(2, "0")} ${ampm}`;
        };

        const TIME_SLOTS = [];
        for (let m = 420; m < 1320; m += 30) {
            const startStr = formatTime12(m);
            const endStr = formatTime12(m + 30);
            TIME_SLOTS.push({ min: m, label: `${startStr} – ${endStr}`, startStr, endStr });
        }

        const parseMin = tStr => {
            if (!tStr) return 420;
            if (typeof tStr === "number") return tStr;
            const str = String(tStr).trim();
            const m12 = str.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
            if (m12) {
                let h = parseInt(m12[1], 10);
                const mins = parseInt(m12[2], 10);
                const ampm = (m12[3] || "").toUpperCase();
                if (ampm === "PM" && h < 12) h += 12;
                if (ampm === "AM" && h === 12) h = 0;
                return h * 60 + mins;
            }
            const m24 = str.match(/^(\d{1,2}):(\d{2})/);
            if (m24) return parseInt(m24[1], 10) * 60 + parseInt(m24[2], 10);
            return 420;
        };

        const normalizeDay = d => {
            if (!d) return "";
            const s = String(d).trim().toUpperCase();
            if (s.startsWith("MON")) return "MON";
            if (s.startsWith("TUE")) return "TUE";
            if (s.startsWith("WED")) return "WED";
            if (s.startsWith("THU")) return "THU";
            if (s.startsWith("FRI")) return "FRI";
            if (s.startsWith("SAT")) return "SAT";
            return "";
        };

        const daysToDisplay = Vue.computed(() => BASE_DAYS_LIST);

        const getPeriodStyle = p => {
            const startM = p.start !== undefined ? p.start : parseMin(p.startTime);
            const endM = p.end !== undefined ? p.end : parseMin(p.endTime);
            const clampedStart = Math.max(420, Math.min(1320, startM));
            const clampedEnd = Math.max(clampedStart, Math.min(1320, endM));

            const topPx = ((clampedStart - 420) / 30) * 36;
            const durationMin = Math.max(30, clampedEnd - clampedStart);
            const heightPx = (durationMin / 30) * 36;

            return {
                top: `${topPx}px`,
                height: `${heightPx - 2}px`
            };
        };

        const COLOR_CLASSES = [
            { bg: "bg-sky-100/95", border: "border-sky-400", text: "text-sky-950", tag: "bg-sky-200 text-sky-800" },
            { bg: "bg-indigo-100/95", border: "border-indigo-400", text: "text-indigo-950", tag: "bg-indigo-200 text-indigo-800" },
            { bg: "bg-purple-100/95", border: "border-purple-400", text: "text-purple-950", tag: "bg-purple-200 text-purple-800" },
            { bg: "bg-teal-100/95", border: "border-teal-400", text: "text-teal-950", tag: "bg-teal-200 text-teal-800" },
            { bg: "bg-blue-100/95", border: "border-blue-400", text: "text-blue-950", tag: "bg-blue-200 text-blue-800" }
        ];

        const getPeriodColor = (p, idx) => {
            const key = (p.subject || "") + (p.id || idx);
            let hash = 0;
            for (let i = 0; i < key.length; i++) hash = (hash << 5) - hash + key.charCodeAt(i);
            const colorIdx = Math.abs(hash) % COLOR_CLASSES.length;
            return COLOR_CLASSES[colorIdx];
        };

        const parseSubjectParts = subjectStr => {
            const s = String(subjectStr || "").trim();
            const parts = s.split(/\s*-\s*/);
            if (parts.length > 1) {
                return { code: parts[0], title: parts.slice(1).join(" - ") };
            }
            return { code: s, title: "" };
        };

        const getDayClasses = (sub, dayCode) => {
            if (!sub) return [];
            const list = (sub.proposedClasses && sub.proposedClasses.length > 0) ? sub.proposedClasses : (sub.classes || []);
            return list.filter(c => normalizeDay(c.day) === dayCode);
        };

        const getDayPreferences = (sub, dayCode) => {
            if (!sub || !sub.blocks) return [];
            return sub.blocks.filter(b => normalizeDay(b.day) === dayCode);
        };

        const getDayClassHours = (sub, dayCode) => {
            const list = getDayClasses(sub, dayCode);
            let h = 0;
            for (const c of list) h += (c.hours || 0);
            return Math.round(h * 10) / 10;
        };

        const getDayDutyHours = (sub, dayCode) => {
            const list = getDayPreferences(sub, dayCode);
            let h = 0;
            for (const b of list) h += (b.hours || 0);
            return Math.round(h * 10) / 10;
        };

        const getDistinctDays = blocks => {
            if (!blocks) return [];
            const set = new Set();
            for (const b of blocks) {
                const norm = normalizeDay(b.day);
                if (norm) set.add(norm);
            }
            return Array.from(set).map(d => DAYS[d] ? DAYS[d].slice(0, 3) : d);
        };

        const getInitials = name => {
            if (!name) return "SA";
            const parts = name.trim().split(/\s+/);
            if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
            return name.slice(0, 2).toUpperCase();
        };

        const load = async () => {
            loading.value = true;
            const r = await Model.request("scheduling", "list_plotted_reviews");
            loading.value = false;
            if (r.success) {
                submissions.value = r.submissions || [];
                pendingCount.value = r.pendingCount || 0;

                // Sync viewingSub if currently open
                if (viewingSub.value) {
                    const updated = submissions.value.find(s => s.saProfileId === viewingSub.value.saProfileId);
                    if (updated) viewingSub.value = updated;
                }
            }
        };

        Vue.watch(() => props.open, val => {
            if (val) {
                viewingSub.value = null;
                optionalNote.value = "";
                load();
            }
        });

        const filteredList = Vue.computed(() => {
            if (filter.value === "ALL") return submissions.value;
            return submissions.value.filter(s => s.reviewStatus === filter.value);
        });

        const openScheduleModal = sub => {
            viewingSub.value = sub;
            gridViewMode.value = "grid";
            optionalNote.value = sub.reviewNotes || "";
        };

        const review = async (sub, status, notesParam = null) => {
            const notes = notesParam !== null ? notesParam : optionalNote.value;

            reviewingId.value = sub.saProfileId;
            const r = await Model.request("scheduling", "review_plotted_duty", {
                saProfileId: sub.saProfileId,
                status: status,
                notes: notes
            });
            reviewingId.value = null;

            if (!r.success) {
                Alerts.error("Decision could not be saved", r.message);
                return;
            }

            Store.toast("success", r.message);
            await load();
            emit("reviewed", { saProfileId: sub.saProfileId, status });
        };

        return {
            loading,
            submissions,
            pendingCount,
            filter,
            filteredList,
            reviewingId,
            viewingSub,
            gridViewMode,
            optionalNote,
            DAYS,
            TIME_SLOTS,
            daysToDisplay,
            load,
            review,
            openScheduleModal,
            getPeriodStyle,
            getPeriodColor,
            parseSubjectParts,
            getDayClasses,
            getDayPreferences,
            getDayClassHours,
            getDayDutyHours,
            getDistinctDays,
            getInitials
        };
    },

    template: `
    <!-- MAIN REVIEW MODAL: SUBMISSIONS LIST -->
    <app-modal :open="open" title="Review S.A. Plotted Duty Schedules" icon="Sparkles" size="xl" @close="$emit('close')"
               description="Review preferred duty schedules submitted by Student Assistants. Click 'View Schedule' to inspect each student's weekly timetable grid.">
        <div class="space-y-4">
            <!-- Filter Bar -->
            <div class="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3">
                <div class="flex flex-wrap items-center gap-1.5">
                    <button type="button" @click="filter = 'ALL'"
                            class="rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors"
                            :class="filter === 'ALL' ? 'bg-navy text-white shadow-xs' : 'bg-mist text-muted hover:text-ink'">
                        All ({{ submissions.length }})
                    </button>
                    <button type="button" @click="filter = 'PENDING'"
                            class="rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors flex items-center gap-1.5"
                            :class="filter === 'PENDING' ? 'bg-amber-600 text-white shadow-xs' : 'bg-amber-50 text-amber-800 hover:bg-amber-100'">
                        <app-icon name="Clock" :size="13" />
                        Pending Review ({{ pendingCount }})
                    </button>
                    <button type="button" @click="filter = 'APPROVED'"
                            class="rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors flex items-center gap-1.5"
                            :class="filter === 'APPROVED' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100'">
                        <app-icon name="CheckCircle" :size="13" />
                        Approved ({{ submissions.filter(s => s.reviewStatus === 'APPROVED').length }})
                    </button>
                    <button type="button" @click="filter = 'REJECTED'"
                            class="rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors flex items-center gap-1.5"
                            :class="filter === 'REJECTED' ? 'bg-rose-600 text-white shadow-xs' : 'bg-rose-50 text-rose-800 hover:bg-rose-100'">
                        <app-icon name="CircleX" :size="13" />
                        Not Included ({{ submissions.filter(s => s.reviewStatus === 'REJECTED').length }})
                    </button>
                </div>

                <button type="button" @click="load" :disabled="loading" class="btn btn-secondary btn-sm text-[12px]">
                    <app-icon name="RefreshCw" :size="13" :class="loading ? 'animate-spin' : ''" />
                    <span>Refresh</span>
                </button>
            </div>

            <!-- Loading State -->
            <div v-if="loading" class="p-12 text-center text-muted">
                <app-icon name="LoaderCircle" :size="28" class="mx-auto mb-2 animate-spin text-navy" />
                <p class="text-caption">Loading plotted duty submissions…</p>
            </div>

            <!-- Empty State -->
            <div v-else-if="!filteredList.length" class="p-10 text-center text-muted border border-dashed border-line rounded-xl">
                <app-icon name="Sparkles" :size="30" class="mx-auto mb-2 text-muted/50" />
                <p class="text-body font-semibold text-ink">No plotted duty submissions in this category</p>
                <p class="text-caption text-muted mt-0.5">
                    {{ filter === 'PENDING' ? 'All submitted duty schedules have been reviewed.' : 'No records found.' }}
                </p>
            </div>

            <!-- List of Submissions Cards -->
            <div v-else class="space-y-3 max-h-[62vh] overflow-y-auto pr-1">
                <div v-for="sub in filteredList" :key="sub.saProfileId"
                     class="rounded-xl border p-4 transition-all bg-white shadow-2xs hover:shadow-xs"
                     :class="sub.reviewStatus === 'APPROVED' ? 'border-emerald-300 bg-emerald-50/10' : (sub.reviewStatus === 'REJECTED' ? 'border-rose-300 bg-rose-50/10' : 'border-amber-300 bg-amber-50/10')">
                    
                    <div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <!-- Left Info -->
                        <div class="flex items-start gap-3 min-w-0">
                            <!-- Avatar / Initials -->
                            <div class="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[13px] font-bold"
                                 :class="sub.reviewStatus === 'APPROVED' ? 'bg-emerald-100 text-emerald-800' : (sub.reviewStatus === 'REJECTED' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800')">
                                {{ getInitials(sub.name) }}
                            </div>

                            <div class="min-w-0 space-y-1">
                                <div class="flex flex-wrap items-center gap-2">
                                    <h3 class="font-bold text-body text-navy truncate">{{ sub.name }}</h3>
                                    <span class="font-mono text-caption text-muted font-semibold">({{ sub.studentId }})</span>
                                    <span class="rounded bg-mist px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                                        {{ sub.course }} {{ sub.yearLevel ? '· Year ' + sub.yearLevel : '' }}
                                    </span>
                                    <span class="rounded bg-navy/10 text-navy px-2 py-0.5 text-[11px] font-semibold">
                                        {{ sub.category }} · {{ sub.officeName }}
                                    </span>
                                </div>

                                <!-- Metric pills row -->
                                <div class="flex flex-wrap items-center gap-2 text-caption text-muted">
                                    <span>Target: <b class="text-ink font-semibold">{{ sub.targetHours }} hrs/wk</b></span>
                                    <span>•</span>
                                    <span>Plotted: <b class="text-navy font-bold">{{ sub.totalHours }} hrs/wk</b> ({{ sub.blocks.length }} blocks)</span>
                                    <span>•</span>
                                    <div class="inline-flex items-center gap-1">
                                        <span class="text-[11px]">Days:</span>
                                        <span v-for="d in getDistinctDays(sub.blocks)" :key="d"
                                              class="rounded bg-amber-100 text-amber-900 font-mono text-[10px] font-bold px-1.5 py-0.2">
                                            {{ d }}
                                        </span>
                                    </div>
                                <div v-if="sub.reasonCategory" class="flex flex-wrap items-center gap-1.5 mt-1">
                                    <span class="rounded bg-amber-200/80 text-amber-950 font-bold text-[11px] px-2 py-0.5 border border-amber-300">
                                        Reason: {{ sub.reasonCategory }}
                                    </span>
                                    <span v-if="sub.reasonDetails" class="text-[11px] text-ink/80 italic">
                                        "{{ sub.reasonDetails }}"
                                    </span>
                                </div>

                                <p v-if="sub.reviewNotes" class="text-[11px] text-rose-800 bg-rose-50 px-2 py-1 rounded border border-rose-200 mt-1 inline-block">
                                    <b>Note:</b> {{ sub.reviewNotes }}
                                </p>
                            </div>
                        </div>

                        <!-- Right Actions -->
                        <div class="flex flex-wrap items-center gap-2 md:justify-end shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-line/40">
                            <!-- Status Badges -->
                            <span v-if="sub.reviewStatus === 'APPROVED'" class="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-1 text-[11px] font-semibold">
                                <app-icon name="CheckCircle" :size="12" /> Included in Recommendations
                            </span>
                            <span v-else-if="sub.reviewStatus === 'REJECTED'" class="inline-flex items-center gap-1 rounded-full bg-rose-100 text-rose-800 px-2.5 py-1 text-[11px] font-semibold">
                                <app-icon name="CircleX" :size="12" /> Not Included
                            </span>
                            <span v-else class="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-2.5 py-1 text-[11px] font-semibold">
                                <app-icon name="Clock" :size="12" /> Pending Review
                            </span>

                            <!-- View Schedule Button (Opens Timetable Grid Modal) -->
                            <button type="button" @click="openScheduleModal(sub)"
                                    class="btn btn-sm btn-primary bg-navy hover:bg-navy-700 text-white flex items-center gap-1.5 text-[12px] py-1.5 px-3 shadow-xs">
                                <app-icon name="CalendarDays" :size="14" />
                                <span>View Schedule</span>
                            </button>

                            <!-- Quick Action Buttons -->
                            <template v-if="sub.reviewStatus === 'APPROVED'">
                                <button type="button" @click="review(sub, 'REJECTED')"
                                        :disabled="reviewingId === sub.saProfileId"
                                        class="btn btn-sm btn-secondary hover:bg-rose-50 hover:text-danger text-[12px] py-1.5 px-2.5"
                                        title="Remove from Recommendations">
                                    <app-icon name="X" :size="13" class="text-danger" />
                                    <span>Remove</span>
                                </button>
                            </template>

                            <template v-else-if="sub.reviewStatus === 'REJECTED'">
                                <button type="button" @click="review(sub, 'APPROVED')"
                                        :disabled="reviewingId === sub.saProfileId"
                                        class="btn btn-sm btn-secondary hover:bg-emerald-50 hover:text-emerald-700 text-[12px] py-1.5 px-2.5"
                                        title="Include in Recommendations">
                                    <app-icon name="Check" :size="13" class="text-emerald-600" />
                                    <span>Include</span>
                                </button>
                            </template>

                            <template v-else>
                                <button type="button" @click="review(sub, 'APPROVED')"
                                        :disabled="reviewingId === sub.saProfileId"
                                        class="btn btn-sm btn-primary bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] py-1.5 px-2.5"
                                        title="Include in Recommendations">
                                    <app-icon name="Check" :size="13" />
                                    <span>Include</span>
                                </button>
                                <button type="button" @click="review(sub, 'REJECTED')"
                                        :disabled="reviewingId === sub.saProfileId"
                                        class="btn btn-sm btn-secondary hover:bg-rose-50 hover:text-danger text-[12px] py-1.5 px-2.5"
                                        title="Do Not Include">
                                    <app-icon name="X" :size="13" class="text-danger" />
                                    <span>Do Not Include</span>
                                </button>
                            </template>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <template #footer>
            <button type="button" @click="$emit('close')" class="btn btn-secondary">Close</button>
        </template>
    </app-modal>

    <!-- DETAIL MODAL: SCHEDULE GRID VIEW ("LIKE JANICE VIEW") -->
    <app-modal :open="!!viewingSub" :title="'Plotted Schedule — ' + (viewingSub ? viewingSub.name : '')"
               icon="CalendarDays" size="2xl" z="z-[60]" @close="viewingSub = null"
               description="Visual weekly schedule showing enrolled classes alongside preferred duty blocks to inspect availability and avoid conflicts.">
        <div v-if="viewingSub" class="space-y-4">
            <!-- Student Header & Summary Banner -->
            <div class="rounded-xl border border-line bg-page p-3.5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div class="space-y-1 min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="font-bold text-body text-navy">{{ viewingSub.name }}</span>
                        <span class="font-mono text-caption text-muted font-semibold">({{ viewingSub.studentId }})</span>
                        <span class="rounded bg-navy/10 text-navy font-semibold text-[11px] px-2 py-0.5">
                            {{ viewingSub.category }} · {{ viewingSub.officeName }}
                        </span>
                        <!-- Status Badge -->
                        <span v-if="viewingSub.reviewStatus === 'APPROVED'" class="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 px-2 py-0.5 text-[11px] font-semibold">
                            <app-icon name="CheckCircle" :size="11" /> Included
                        </span>
                        <span v-else-if="viewingSub.reviewStatus === 'REJECTED'" class="inline-flex items-center gap-1 rounded-full bg-rose-100 text-rose-800 px-2 py-0.5 text-[11px] font-semibold">
                            <app-icon name="CircleX" :size="11" /> Excluded
                        </span>
                        <span v-else class="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-2 py-0.5 text-[11px] font-semibold">
                            <app-icon name="Clock" :size="11" /> Pending
                        </span>
                    </div>

                    <div class="flex flex-wrap items-center gap-2.5 text-caption text-muted">
                        <span>Target: <b class="text-ink font-semibold">{{ viewingSub.targetHours }} hrs/wk</b></span>
                        <span>•</span>
                        <span>Plotted Duty: <b class="text-navy font-bold">{{ viewingSub.totalHours }} hrs/wk</b> ({{ viewingSub.blocks.length }} blocks)</span>
                        <span>•</span>
                        <span>Enrolled Classes: <b class="text-ink font-semibold">{{ (viewingSub.classes || []).length }} periods</b></span>
                    </div>
                </div>

                <!-- View Switcher (Grid vs Table) -->
                <div class="flex items-center gap-2 shrink-0">
                    <div class="flex rounded-lg border border-line bg-white p-0.5 text-caption font-semibold shadow-2xs">
                        <button type="button" @click="gridViewMode = 'grid'"
                                class="flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-all text-[12px]"
                                :class="gridViewMode === 'grid' ? 'bg-navy text-white shadow-xs' : 'text-muted hover:text-ink'">
                            <app-icon name="LayoutGrid" :size="13" /> Visual Grid
                        </button>
                        <button type="button" @click="gridViewMode = 'table'"
                                class="flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-all text-[12px]"
                                :class="gridViewMode === 'table' ? 'bg-navy text-white shadow-xs' : 'text-muted hover:text-ink'">
                            <app-icon name="List" :size="13" /> Table View
                        </button>
                    </div>
                </div>
            </div>

            <!-- Reason for Schedule Plotting / Change Banner -->
            <div v-if="viewingSub.reasonCategory" class="rounded-xl border border-amber-300 bg-amber-50/80 p-3.5 flex items-start gap-3">
                <div class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-500 text-white shadow-xs">
                    <app-icon name="FileText" :size="16" />
                </div>
                <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="text-caption font-bold text-amber-950">Reason for Schedule Plotting / Change:</span>
                        <span class="rounded bg-amber-200 text-amber-900 font-bold px-2 py-0.5 text-[11px] border border-amber-300">
                            {{ viewingSub.reasonCategory }}
                        </span>
                    </div>
                    <p v-if="viewingSub.reasonDetails" class="text-caption text-ink/90 italic mt-1 bg-white/70 p-2 rounded-lg border border-amber-200/60">
                        "{{ viewingSub.reasonDetails }}"
                    </p>
                    <p v-if="viewingSub.proposedClasses && viewingSub.proposedClasses.length" class="text-[11px] text-amber-900 font-semibold mt-1.5 flex items-center gap-1.5">
                        <app-icon name="BookOpen" :size="13" class="text-sky-600" />
                        <span>Includes {{ viewingSub.proposedClasses.length }} proposed class subject(s). Approving will sync both their official classes and duty schedule.</span>
                    </p>
                </div>
            </div>

            <!-- Legend Bar -->
            <div class="flex flex-wrap items-center justify-between gap-2 text-caption px-1">
                <div class="flex flex-wrap items-center gap-3">
                    <span class="text-muted font-medium">Legend:</span>
                    <span class="inline-flex items-center gap-1.5 text-sky-950 font-semibold bg-sky-100 border border-sky-400 px-2.5 py-0.5 rounded text-[11px]">
                        <span class="h-2 w-2 rounded-full bg-sky-500"></span> Enrolled Class (COR)
                    </span>
                    <span class="inline-flex items-center gap-1.5 text-amber-950 font-semibold bg-amber-100 border-2 border-dashed border-amber-500 px-2.5 py-0.5 rounded text-[11px]">
                        <app-icon name="Sparkles" :size="11" class="text-amber-600" /> Plotted Duty (Recommendation)
                    </span>
                </div>
                <div class="text-[11px] text-muted">
                    Duty hours span between 7:00 AM – 10:00 PM (Mon – Sat)
                </div>
            </div>

            <!-- VIEW 1: VISUAL WEEKLY TIMETABLE GRID -->
            <div v-if="gridViewMode === 'grid'" class="overflow-auto rounded-xl border border-line bg-white shadow-card max-h-[58vh]">
                <div class="min-w-[880px]">
                    <!-- Dark Navy Header Row -->
                    <div class="sticky top-0 z-30 grid grid-cols-[120px_repeat(6,minmax(0,1fr))] bg-navy text-white text-[12px] font-bold shadow-xs">
                        <div class="sticky left-0 z-40 bg-navy px-2 py-2.5 border-r border-navy-700 text-center uppercase tracking-wider text-[11px]">
                            TIME
                        </div>
                        <div v-for="d in daysToDisplay" :key="d.code"
                             class="px-2 py-2 border-r border-navy-700 uppercase tracking-wider last:border-r-0 text-center text-[11px]">
                            <div class="font-bold">{{ d.label }}</div>
                            <div class="flex items-center justify-center gap-2 mt-0.5 text-[9px] font-normal opacity-90">
                                <span v-if="getDayClassHours(viewingSub, d.code) > 0" class="text-sky-200">
                                    {{ getDayClassHours(viewingSub, d.code) }}h class
                                </span>
                                <span v-if="getDayDutyHours(viewingSub, d.code) > 0" class="text-amber-300 font-semibold">
                                    {{ getDayDutyHours(viewingSub, d.code) }}h duty
                                </span>
                            </div>
                        </div>
                    </div>

                    <!-- Grid Body (30 slots x 36px = 1080px total height) -->
                    <div class="relative grid grid-cols-[120px_repeat(6,minmax(0,1fr))] select-none" style="height: 1080px;">
                        
                        <!-- Left Sticky Time Column -->
                        <div class="sticky left-0 z-20 bg-mist/95 border-r border-line text-[11px] font-bold text-navy">
                            <div v-for="t in TIME_SLOTS" :key="t.min"
                                 class="h-9 px-1 flex items-center justify-center border-b border-line/40 text-[10px] font-bold text-navy whitespace-nowrap">
                                {{ t.startStr }}
                            </div>
                        </div>

                        <!-- 6 Day Columns (Mon-Sat) -->
                        <div v-for="d in daysToDisplay" :key="d.code" class="relative border-r border-line last:border-r-0 bg-white">
                            <!-- Background 30-min guideline slots -->
                            <div v-for="t in TIME_SLOTS" :key="t.min" class="h-9 border-b border-line/40 transition-colors hover:bg-navy/5"></div>

                            <!-- 1. Enrolled Class Schedule Blocks -->
                            <div v-for="(c, idx) in getDayClasses(viewingSub, d.code)" :key="'cls-' + c.id"
                                 :style="getPeriodStyle(c)"
                                 :title="c.subject + ' (' + (c.section || '—') + ') | ' + c.startLabel + ' - ' + c.endLabel"
                                 class="absolute left-1 right-1 rounded-md border px-2 py-1.5 shadow-xs transition-all hover:z-30 hover:shadow-md cursor-default flex flex-col justify-between overflow-hidden"
                                 :class="[getPeriodColor(c, idx).bg, getPeriodColor(c, idx).border, getPeriodColor(c, idx).text]">
                                <div class="min-w-0 flex-1 leading-snug">
                                    <div class="flex items-center justify-between gap-1">
                                        <span class="font-bold text-[11px] truncate">{{ parseSubjectParts(c.subject).code }}</span>
                                        <span v-if="c.section" class="rounded bg-black/10 px-1 py-0.2 text-[9px] font-bold shrink-0">{{ c.section }}</span>
                                    </div>
                                    <div v-if="parseSubjectParts(c.subject).title" class="text-[10px] opacity-90 truncate font-medium">
                                        {{ parseSubjectParts(c.subject).title }}
                                    </div>
                                </div>
                                <div class="text-[9px] font-bold opacity-80 mt-0.5 truncate">
                                    {{ c.startLabel || c.startTime }} – {{ c.endLabel || c.endTime }}
                                </div>
                            </div>

                            <!-- 2. Plotted Duty Preference Blocks -->
                            <div v-for="pref in getDayPreferences(viewingSub, d.code)" :key="'pref-' + pref.id"
                                 :style="getPeriodStyle(pref)"
                                 :title="'Plotted Duty: ' + pref.startLabel + ' – ' + pref.endLabel + ' (' + pref.hours + ' hrs)'"
                                 class="absolute left-1 right-1 rounded-md border-2 border-dashed border-amber-500 bg-amber-50/95 text-amber-950 px-2 py-1.5 shadow-xs transition-all hover:z-30 hover:shadow-md cursor-default flex flex-col justify-between overflow-hidden hover:bg-amber-100 z-10">
                                <div class="min-w-0 flex-1 leading-snug">
                                    <div class="flex items-center justify-between gap-1">
                                        <span class="font-bold text-[11px] truncate flex items-center gap-1 text-amber-900">
                                            <app-icon name="Sparkles" :size="10" class="text-amber-600" /> Plotted Duty
                                        </span>
                                        <span class="rounded bg-amber-200 text-amber-900 px-1 py-0.2 text-[9px] font-bold shrink-0">REC</span>
                                    </div>
                                    <div class="text-[10px] text-amber-800 truncate font-medium">
                                        Preferred Shift
                                    </div>
                                </div>
                                <div class="flex items-center justify-between text-[9px] font-bold text-amber-900 mt-0.5 truncate">
                                    <span>{{ pref.startLabel }} – {{ pref.endLabel }}</span>
                                    <span class="rounded bg-amber-200 px-1 py-0.2 font-mono">
                                        {{ pref.hours }}h
                                        <span v-if="pref.hasBreak" class="font-normal text-amber-700">(-1h)</span>
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- VIEW 2: TABLE VIEW (Clean and Spacious, No Text Clipping) -->
            <div v-else class="space-y-4 max-h-[58vh] overflow-y-auto">
                <!-- Plotted Duty Table -->
                <div class="rounded-xl border border-line bg-white overflow-hidden shadow-2xs">
                    <div class="p-3.5 bg-amber-50/70 border-b border-line flex items-center justify-between">
                        <span class="text-caption font-bold text-amber-950 uppercase tracking-wide">Plotted Duty Blocks ({{ viewingSub.blocks.length }})</span>
                        <span class="text-caption font-bold text-navy">Total Hours: {{ viewingSub.totalHours }} hrs/week</span>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="w-full text-left text-[13px] min-w-[650px]">
                            <thead class="bg-page text-caption font-semibold text-muted">
                                <tr>
                                    <th class="px-5 py-3 w-36">Day</th>
                                    <th class="px-4 py-3 w-52">Preferred Time</th>
                                    <th class="px-4 py-3 w-28">Duration</th>
                                    <th class="px-4 py-3">Break & Deduction Policy</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-line">
                                <tr v-for="b in viewingSub.blocks" :key="b.id" class="hover:bg-mist/30 transition-colors">
                                    <td class="px-5 py-3 font-bold text-amber-900">{{ DAYS[b.day] || b.day }}</td>
                                    <td class="px-4 py-3 font-medium text-ink whitespace-nowrap">{{ b.startLabel }} – {{ b.endLabel }}</td>
                                    <td class="px-4 py-3 font-semibold text-ink whitespace-nowrap">{{ b.hours }} hrs</td>
                                    <td class="px-4 py-3 text-caption">
                                        <span v-if="b.hasBreak" class="inline-flex items-center gap-1 text-amber-800 font-semibold bg-amber-100 px-2 py-0.5 rounded">
                                            -1h lunch break deducted (shift spans 12:00 PM – 1:00 PM)
                                        </span>
                                        <span v-else-if="b.isHalfDaySat" class="inline-flex items-center gap-1 text-emerald-800 font-semibold bg-emerald-100 px-2 py-0.5 rounded">
                                            Saturday half day (no lunch deduction)
                                        </span>
                                        <span v-else-if="b.coversLunch" class="inline-flex items-center gap-1 text-emerald-800 font-semibold bg-emerald-100 px-2 py-0.5 rounded">
                                            Lunch duty credited
                                        </span>
                                        <span v-else class="text-muted">Standard duty period</span>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Enrolled Classes Table -->
                <div class="rounded-xl border border-line bg-white overflow-hidden shadow-2xs">
                    <div class="p-3.5 bg-sky-50/70 border-b border-line flex items-center justify-between">
                        <span class="text-caption font-bold text-sky-950 uppercase tracking-wide">Enrolled Classes ({{ (viewingSub.classes || []).length }})</span>
                        <span class="text-caption text-muted">Synced from Registrar COR</span>
                    </div>
                    <div class="overflow-x-auto">
                        <table class="w-full text-left text-[13px] min-w-[650px]">
                            <thead class="bg-page text-caption font-semibold text-muted">
                                <tr>
                                    <th class="px-5 py-3 w-36">Day</th>
                                    <th class="px-4 py-3 w-52">Class Time</th>
                                    <th class="px-4 py-3">Subject</th>
                                    <th class="px-4 py-3 w-32">Section</th>
                                    <th class="px-4 py-3 w-24 text-right">Hours</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-line">
                                <tr v-for="c in viewingSub.classes" :key="c.id" class="hover:bg-mist/30 transition-colors">
                                    <td class="px-5 py-3 font-bold text-navy">{{ DAYS[c.day] || c.day }}</td>
                                    <td class="px-4 py-3 font-medium text-ink whitespace-nowrap">{{ c.startLabel }} – {{ c.endLabel }}</td>
                                    <td class="px-4 py-3 font-semibold text-ink">{{ c.subject }}</td>
                                    <td class="px-4 py-3 font-mono text-caption text-muted">{{ c.section || '—' }}</td>
                                    <td class="px-4 py-3 text-right font-medium text-muted whitespace-nowrap">{{ c.hours }} hrs</td>
                                </tr>
                                <tr v-if="!(viewingSub.classes || []).length">
                                    <td colspan="5" class="p-8 text-center text-muted">No enrolled class periods recorded for this semester.</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- Optional Coordinator Notes Bar -->
            <div class="rounded-xl border border-line bg-white p-3 flex flex-col sm:flex-row sm:items-center gap-2">
                <span class="text-caption font-semibold text-muted shrink-0 flex items-center gap-1">
                    <app-icon name="MessageSquare" :size="13" /> Coordinator Note:
                </span>
                <input v-model="optionalNote" type="text"
                       placeholder="Add an optional note or reason for the S.A. (e.g. Schedule approved or requires shift adjustments)…"
                       class="input input-sm flex-1 text-[12px]" />
            </div>
        </div>

        <template #footer>
            <div class="flex items-center justify-between w-full">
                <button type="button" @click="viewingSub = null" class="btn btn-secondary">
                    Close Schedule
                </button>

                <!-- Decision Action Buttons with full flexibility -->
                <div v-if="viewingSub" class="flex items-center gap-2">
                    <!-- Reset to Pending button -->
                    <button v-if="viewingSub.reviewStatus !== 'PENDING'" type="button"
                            @click="review(viewingSub, 'PENDING')"
                            :disabled="reviewingId === viewingSub.saProfileId"
                            class="btn btn-secondary text-[12px] py-1.5 px-3"
                            title="Reset back to pending review">
                        <app-icon name="Clock" :size="13" class="text-amber-600" />
                        <span>Reset to Pending</span>
                    </button>

                    <!-- If currently APPROVED: show option to Remove / Exclude -->
                    <button v-if="viewingSub.reviewStatus === 'APPROVED'" type="button"
                            @click="review(viewingSub, 'REJECTED')"
                            :disabled="reviewingId === viewingSub.saProfileId"
                            class="btn btn-secondary text-danger hover:bg-rose-50 border-rose-300 text-[13px] py-1.5 px-3.5">
                        <app-icon name="CircleX" :size="15" />
                        <span>Remove from Recommendations</span>
                    </button>

                    <!-- If currently REJECTED: show option to Include -->
                    <button v-else-if="viewingSub.reviewStatus === 'REJECTED'" type="button"
                            @click="review(viewingSub, 'APPROVED')"
                            :disabled="reviewingId === viewingSub.saProfileId"
                            class="btn btn-primary bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] py-1.5 px-3.5">
                        <app-icon name="Check" :size="15" />
                        <span>Include in Recommendations</span>
                    </button>

                    <!-- If currently PENDING: show both Include and Do Not Include -->
                    <template v-else>
                        <button type="button" @click="review(viewingSub, 'REJECTED')"
                                :disabled="reviewingId === viewingSub.saProfileId"
                                class="btn btn-secondary hover:bg-rose-50 hover:text-danger text-[13px] py-1.5 px-3">
                            <app-icon name="X" :size="14" class="text-danger" />
                            <span>Do Not Include</span>
                        </button>

                        <button type="button" @click="review(viewingSub, 'APPROVED')"
                                :disabled="reviewingId === viewingSub.saProfileId"
                                class="btn btn-primary bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] py-1.5 px-3.5">
                            <app-icon name="Check" :size="15" />
                            <span>Include in Recommendations</span>
                        </button>
                    </template>
                </div>
            </div>
        </template>
    </app-modal>
    `
};
