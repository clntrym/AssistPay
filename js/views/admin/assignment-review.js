// Scheduling > Assignment Review.
// Review Student Assistant assignments, status, and individual schedules.
const AssignmentReviewPage = {
    components: { AppIcon, PageHeader, StatusBadge, AppModal },

    setup() {
        const items = Vue.ref([]);
        const semester = Vue.ref(null);
        const loading = Vue.ref(true);
        const loadError = Vue.ref("");

        const q = Vue.ref("");
        const filter = Vue.ref("ALL");
        const page = Vue.ref(1);
        const PAGE_SIZE = 10;

        // Individual S.A. schedule modal state
        const selectedSa = Vue.ref(null);
        const schedLoading = Vue.ref(false);
        const schedData = Vue.ref(null);
        const schedTab = Vue.ref("ALL");

        const DAY_ORDER = ["MON", "TUE", "WED", "THU", "FRI", "SAT"];
        const DAY_LABELS = {
            MON: "Monday", TUE: "Tuesday", WED: "Wednesday",
            THU: "Thursday", FRI: "Friday", SAT: "Saturday", SUN: "Sunday"
        };

        const load = async () => {
            loading.value = true;
            loadError.value = "";
            const r = await Model.request("scheduling", "review_list");
            loading.value = false;
            if (!r.success) { loadError.value = r.message; return; }
            items.value = r.items;
            semester.value = r.semester;
        };
        Vue.onMounted(load);

        const active = Vue.computed(() => items.value.filter(s => s.saStatus === "ACTIVE"));
        const matchingDone = Vue.computed(() => !!semester.value?.matchingDone);

        const stats = Vue.computed(() => ({
            active: active.value.length,
            matched: active.value.filter(s => s.isMatched).length,
            assigned: active.value.filter(s => s.assignmentStatus === "ASSIGNED").length,
            unassigned: active.value.filter(s => !s.isMatched && s.assignmentStatus === "UNASSIGNED").length
        }));

        const filters = Vue.computed(() => {
            if (matchingDone.value) {
                return [
                    { value: "ALL", label: "All Statuses", test: () => true },
                    { value: "MATCHED", label: "Matched", test: s => s.isMatched },
                    { value: "ASSIGNED", label: "Assigned", test: s => s.assignmentStatus === "ASSIGNED" },
                    { value: "UNASSIGNED", label: "Unassigned", test: s => !s.isMatched && s.assignmentStatus === "UNASSIGNED" },
                    { value: "INACTIVE", label: "Inactive", test: s => s.saStatus === "INACTIVE" }
                ];
            }
            return [
                { value: "ALL", label: "All Statuses", test: () => true },
                { value: "ASSIGNED", label: "Assigned", test: s => s.assignmentStatus === "ASSIGNED" },
                { value: "UNASSIGNED", label: "Unassigned", test: s => s.assignmentStatus === "UNASSIGNED" },
                { value: "INACTIVE", label: "Inactive", test: s => s.saStatus === "INACTIVE" }
            ];
        });

        const counts = Vue.computed(() => Object.fromEntries(filters.value.map(f => [f.value, items.value.filter(f.test).length])));

        const filtered = Vue.computed(() => {
            const term = q.value.trim().toLowerCase();
            const test = filters.value.find(f => f.value === filter.value)?.test || (() => true);
            return items.value.filter(s => test(s)
                && (!term || [s.name, s.studentId, s.currentAssignment, s.supervisor, s.course]
                    .some(v => v && v.toLowerCase().includes(term))));
        });

        const pageCount = Vue.computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)));
        const pageRows = Vue.computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
        const rangeText = Vue.computed(() => {
            const n = filtered.value.length;
            if (!n) return "No records";
            const from = (page.value - 1) * PAGE_SIZE + 1;
            return `Showing ${from}–${Math.min(n, from + PAGE_SIZE - 1)} of ${n} records`;
        });
        Vue.watch([filter, q], () => { page.value = 1; });
        Vue.watch(pageCount, n => { if (page.value > n) page.value = n; });

        // Open individual schedule modal
        const openSchedule = async s => {
            selectedSa.value = s;
            schedLoading.value = true;
            schedData.value = null;
            schedTab.value = "ALL";
            const r = await Model.request("scheduling", "sa_schedule", { saProfileId: s.id });
            schedLoading.value = false;
            if (r.success) {
                schedData.value = r;
            } else {
                Store.toast("danger", r.message || "Failed to load schedule.");
            }
        };

        const schedDutyByDay = Vue.computed(() => {
            const out = {};
            DAY_ORDER.forEach(d => { out[d] = []; });
            (schedData.value?.duty || []).forEach(d => {
                const day = d.day;
                if (!out[day]) out[day] = [];
                out[day].push(d);
            });
            return out;
        });

        const schedClassesByDay = Vue.computed(() => {
            const out = {};
            DAY_ORDER.forEach(d => { out[d] = []; });
            (schedData.value?.classes || []).forEach(c => {
                const day = c.day;
                if (!out[day]) out[day] = [];
                out[day].push(c);
            });
            return out;
        });

        return {
            items, semester, loading, loadError, load, q, filter, filters, counts, filtered,
            page, pageCount, pageRows, rangeText, stats, matchingDone, label, Format,
            selectedSa, schedLoading, schedData, schedTab, DAY_ORDER, DAY_LABELS,
            openSchedule, schedDutyByDay, schedClassesByDay
        };
    },

    template: `
    <page-header title="Assignment Review" section="Scheduling"
                 :subtitle="semester ? 'Review Student Assistant assignments and schedules. ' + semester.label : 'Review Student Assistant assignments and schedules.'">
        <template #actions>
            <router-link to="/admin/scheduling/matching" class="btn btn-secondary">
                <app-icon name="Shuffle" :size="16" /> Matching
            </router-link>
            <router-link to="/admin/scheduling/recommendations" class="btn btn-secondary">
                <app-icon name="Sparkles" :size="16" /> Recommendations
            </router-link>
            <router-link to="/admin/scheduling/finalized" class="btn btn-primary">
                Finalize Schedule <app-icon name="ArrowRight" :size="16" />
            </router-link>
        </template>
    </page-header>

    <div v-if="loading" class="space-y-4" aria-busy="true">
        <div class="h-20 animate-pulse rounded-xl bg-white"></div>
        <div class="h-80 animate-pulse rounded-xl bg-white"></div>
    </div>

    <div v-else-if="loadError" class="card flex flex-col items-center px-6 py-12 text-center">
        <app-icon name="CircleX" :size="28" class="text-danger" />
        <p class="mt-3 text-body font-medium text-ink">Couldn't load assignment review</p>
        <p class="mt-1 text-caption text-muted">{{ loadError }}</p>
        <button @click="load" class="btn btn-secondary btn-sm mt-4"><app-icon name="RefreshCw" :size="14" /> Try again</button>
    </div>

    <template v-else>
        <!-- ------------------------------------------------ status banner -->
        <section v-if="matchingDone" class="mb-5 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/50 p-5">
            <app-icon name="CheckCircle2" :size="20" class="mt-0.5 shrink-0 text-emerald-600" />
            <div class="text-body text-ink">
                <p class="font-semibold text-emerald-900">Schedule Matching Completed</p>
                <p class="mt-1 text-muted">
                    The schedule matching process has run for this semester. Review individual S.A. assignments below or click <b>View Schedule</b> to inspect their duty grid and class schedule.
                </p>
                <p class="mt-2 text-caption text-muted">
                    <b class="font-semibold text-ink">{{ stats.matched }} of {{ stats.active }}</b> active S.A.s matched ·
                    <b class="font-semibold text-ink">{{ stats.assigned }}</b> currently assigned
                </p>
            </div>
        </section>
        <section v-else class="mb-5 flex items-start gap-3 rounded-xl border border-info/20 bg-info/5 p-5">
            <app-icon name="ShieldCheck" :size="20" class="mt-0.5 shrink-0 text-info" />
            <div class="text-body text-ink">
                <p class="font-semibold">Assignment Review Overview</p>
                <p class="mt-1 text-muted">
                    Review Student Assistant profiles, assignments, and class schedules across departments.
                </p>
                <p class="mt-2 text-caption text-muted">
                    <b class="font-semibold text-ink">{{ stats.active }}</b> active S.A. records on file
                </p>
            </div>
        </section>

        <section class="card">
            <!-- ------------------------------------------------ search + status -->
            <div class="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
                <div class="relative flex-1">
                    <app-icon name="Search" :size="16" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input v-model="q" type="search" class="input pl-9" placeholder="Search Student Assistants by name, ID, course..."
                           aria-label="Search Student Assistants">
                </div>
                <select v-model="filter" class="input sm:w-56" aria-label="Filter by status">
                    <option v-for="f in filters" :key="f.value" :value="f.value">{{ f.label }} ({{ counts[f.value] }})</option>
                </select>
            </div>

            <div v-if="!filtered.length" class="flex flex-col items-center px-6 py-14 text-center">
                <span class="grid h-12 w-12 place-items-center rounded-full bg-mist text-navy"><app-icon name="ListChecks" :size="22" /></span>
                <p class="mt-3 text-body font-medium text-ink">No S.A.s match this view</p>
                <p class="mt-1 max-w-sm text-caption text-muted">Try clearing the search or changing the filter.</p>
            </div>

            <!-- ------------------------------------------------ the roster -->
            <template v-else>
                <div class="overflow-x-auto">
                    <table class="w-full min-w-[920px] text-left text-[13px]">
                        <thead class="bg-page text-[11px] font-semibold uppercase tracking-wide text-muted">
                            <tr>
                                <th class="px-4 py-3">S.A.</th>
                                <th class="px-4 py-3">Assignment / Post</th>
                                <th class="px-4 py-3">Category</th>
                                <th class="px-4 py-3">Supervisor</th>
                                <th class="px-4 py-3">Status</th>
                                <th class="px-4 py-3 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-line">
                            <tr v-for="s in pageRows" :key="s.id" class="transition-colors duration-150 hover:bg-mist/50"
                                :class="s.saStatus !== 'ACTIVE' ? 'opacity-60' : ''">
                                <td class="whitespace-nowrap px-4 py-3">
                                    <router-link :to="'/admin/sa-management/' + s.id" class="font-semibold text-ink hover:text-navy hover:underline">
                                        {{ s.name }}
                                    </router-link>
                                    <span class="block text-[11px] text-muted">{{ s.studentId }} · {{ s.course || 'No course' }}</span>
                                </td>
                                <td class="whitespace-nowrap px-4 py-3 text-ink">
                                    <div class="font-medium">{{ s.currentAssignment }}</div>
                                    <span v-if="s.isMatched && s.matchedHours" class="block text-[11px] text-emerald-600 font-medium">
                                        {{ s.matchedHours }} hrs recommended
                                    </span>
                                    <span v-if="!s.classRows" class="block text-[11px] text-warning">No class schedule</span>
                                </td>
                                <td class="px-4 py-3 text-ink">{{ label('saCategory', s.saCategory) }}</td>
                                <td class="whitespace-nowrap px-4 py-3" :class="s.supervisor ? 'text-ink' : 'text-muted'">
                                    {{ s.supervisor || 'None' }}
                                </td>
                                <td class="px-4 py-3">
                                    <span v-if="s.isMatched" class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                                        <app-icon name="CheckCircle2" :size="12" /> Matched
                                    </span>
                                    <status-badge v-else group="assignmentStatus" :value="s.assignmentStatus" />
                                </td>

                                <!-- Action: View Schedule modal -->
                                <td class="whitespace-nowrap px-4 py-2.5 text-center">
                                    <button @click="openSchedule(s)" class="btn btn-secondary btn-sm inline-flex items-center gap-1.5" :title="'View schedule for ' + s.name">
                                        <app-icon name="Calendar" :size="14" /> View Schedule
                                    </button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <!-- ------------------------------------------------ paging -->
                <div class="flex flex-col items-center justify-between gap-3 border-t border-line px-4 py-3 sm:flex-row">
                    <p class="text-caption text-muted" aria-live="polite">{{ rangeText }}</p>
                    <nav class="flex items-center gap-1" aria-label="Pages">
                        <button @click="page--" :disabled="page === 1" class="btn btn-secondary btn-sm" aria-label="Previous page">
                            <app-icon name="ChevronLeft" :size="14" />
                        </button>
                        <span class="px-2 text-caption text-muted">{{ page }} / {{ pageCount }}</span>
                        <button @click="page++" :disabled="page === pageCount" class="btn btn-secondary btn-sm" aria-label="Next page">
                            <app-icon name="ChevronRight" :size="14" />
                        </button>
                    </nav>
                </div>
            </template>
        </section>
    </template>

    <!-- ------------------------------------------------ S.A. Individual Schedule Modal -->
    <app-modal :open="!!selectedSa" :title="selectedSa ? selectedSa.name : ''"
               icon="CalendarDays" size="xl" tone="navy" @close="selectedSa = null"
               :description="selectedSa ? (selectedSa.studentId + ' · ' + (selectedSa.course || '') + ' · ' + (selectedSa.currentAssignment || 'No assignment')) : ''">
        <template v-if="selectedSa">
            <div v-if="schedLoading" class="py-12 flex flex-col items-center justify-center space-y-3">
                <app-icon name="LoaderCircle" :size="28" class="animate-spin text-navy" />
                <p class="text-caption text-muted">Loading schedule details…</p>
            </div>

            <div v-else-if="schedData" class="space-y-5">
                <!-- Top Summary Cards -->
                <div class="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div class="rounded-xl border border-line bg-page p-3">
                        <span class="text-[11px] font-semibold uppercase tracking-wider text-muted">Target Hours</span>
                        <p class="mt-1 text-h4 font-bold text-ink">{{ selectedSa.weeklyTargetHours || 35 }} <span class="text-caption font-normal text-muted">hrs/wk</span></p>
                    </div>
                    <div class="rounded-xl border border-line bg-page p-3">
                        <span class="text-[11px] font-semibold uppercase tracking-wider text-muted">Duty Hours</span>
                        <p class="mt-1 text-h4 font-bold text-emerald-700">{{ schedData.creditedHours || 0 }} <span class="text-caption font-normal text-muted">hrs</span></p>
                        <span v-if="schedData.dutyHours && schedData.dutyHours !== schedData.creditedHours" class="text-[10px] text-muted">{{ schedData.dutyHours }}h raw</span>
                    </div>
                    <div class="rounded-xl border border-line bg-page p-3">
                        <span class="text-[11px] font-semibold uppercase tracking-wider text-muted">Class Hours</span>
                        <p class="mt-1 text-h4 font-bold text-navy">{{ schedData.classHours || 0 }} <span class="text-caption font-normal text-muted">hrs</span></p>
                    </div>
                    <div class="rounded-xl border border-line bg-page p-3">
                        <span class="text-[11px] font-semibold uppercase tracking-wider text-muted">Schedule Clashes</span>
                        <div class="mt-1 flex items-center gap-1.5">
                            <span v-if="schedData.clashes && schedData.clashes.length" class="inline-flex items-center gap-1 text-[13px] font-bold text-danger">
                                <app-icon name="TriangleAlert" :size="14" /> {{ schedData.clashes.length }} clash(es)
                            </span>
                            <span v-else class="inline-flex items-center gap-1 text-[13px] font-semibold text-success">
                                <app-icon name="CircleCheck" :size="14" /> All Clear
                            </span>
                        </div>
                    </div>
                </div>

                <!-- Clash Alert if any -->
                <div v-if="schedData.clashes && schedData.clashes.length" class="rounded-xl border border-danger/30 bg-danger/10 p-3.5 text-danger text-caption">
                    <div class="flex items-start gap-2">
                        <app-icon name="TriangleAlert" :size="16" class="mt-0.5 shrink-0" />
                        <div>
                            <p class="font-semibold">Schedule Conflict Detected</p>
                            <ul class="mt-1 list-disc pl-4 space-y-0.5">
                                <li v-for="(cl, idx) in schedData.clashes" :key="idx">
                                    {{ cl.day }}: Duty at {{ cl.dutyLabel || cl.location }} overlaps with class ({{ cl.subject || 'Class' }})
                                </li>
                            </ul>
                        </div>
                    </div>
                </div>

                <!-- Tab Toggle -->
                <div class="flex border-b border-line">
                    <button @click="schedTab = 'ALL'"
                            class="border-b-2 px-4 py-2 text-caption font-semibold transition-colors"
                            :class="schedTab === 'ALL' ? 'border-navy text-navy' : 'border-transparent text-muted hover:text-ink'">
                        Weekly View (All)
                    </button>
                    <button @click="schedTab = 'DUTY'"
                            class="border-b-2 px-4 py-2 text-caption font-semibold transition-colors flex items-center gap-1.5"
                            :class="schedTab === 'DUTY' ? 'border-navy text-navy' : 'border-transparent text-muted hover:text-ink'">
                        Duty Grid ({{ schedData.duty ? schedData.duty.length : 0 }})
                    </button>
                    <button @click="schedTab = 'CLASSES'"
                            class="border-b-2 px-4 py-2 text-caption font-semibold transition-colors flex items-center gap-1.5"
                            :class="schedTab === 'CLASSES' ? 'border-navy text-navy' : 'border-transparent text-muted hover:text-ink'">
                        Class Schedule ({{ schedData.classes ? schedData.classes.length : 0 }})
                    </button>
                </div>

                <!-- Tab 1: Weekly View (Combined by Day) -->
                <div v-if="schedTab === 'ALL'" class="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
                    <div v-for="day in DAY_ORDER" :key="day" class="rounded-xl border border-line bg-surface p-3.5">
                        <div class="flex items-center justify-between border-b border-line pb-2 mb-2.5">
                            <span class="font-semibold text-ink text-body">{{ DAY_LABELS[day] }}</span>
                            <span class="text-[11px] text-muted">
                                {{ schedDutyByDay[day].length }} duty slot(s) · {{ schedClassesByDay[day].length }} class(es)
                            </span>
                        </div>

                        <div v-if="!schedDutyByDay[day].length && !schedClassesByDay[day].length" class="text-caption text-muted italic py-1">
                            No scheduled duty or classes on this day.
                        </div>

                        <div v-else class="space-y-2">
                            <!-- Duty Slots -->
                            <div v-for="d in schedDutyByDay[day]" :key="'d-' + d.id"
                                 class="flex items-center justify-between rounded-lg bg-emerald-50/70 border border-emerald-200/60 px-3 py-2 text-caption">
                                <div class="flex items-center gap-2">
                                    <span class="inline-flex items-center gap-1 font-semibold text-emerald-800 bg-emerald-100 rounded px-1.5 py-0.5 text-[10px]">
                                        DUTY
                                    </span>
                                    <span class="font-medium text-ink">{{ d.startLabel }} – {{ d.endLabel }}</span>
                                    <span class="text-muted">· {{ d.location }} ({{ d.department }})</span>
                                </div>
                                <span class="font-semibold text-emerald-700">{{ d.credited }} hrs</span>
                            </div>

                            <!-- Classes -->
                            <div v-for="c in schedClassesByDay[day]" :key="'c-' + c.id"
                                 class="flex items-center justify-between rounded-lg bg-amber-50/70 border border-amber-200/60 px-3 py-2 text-caption">
                                <div class="flex items-center gap-2">
                                    <span class="inline-flex items-center gap-1 font-semibold text-amber-800 bg-amber-100 rounded px-1.5 py-0.5 text-[10px]">
                                        CLASS
                                    </span>
                                    <span class="font-medium text-ink">{{ c.startLabel }} – {{ c.endLabel }}</span>
                                    <span class="text-muted">· {{ c.subject }} {{ c.section ? '(' + c.section + ')' : '' }}</span>
                                </div>
                                <span class="font-semibold text-amber-800">{{ c.hours }} hrs</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Tab 2: Duty Grid Only -->
                <div v-else-if="schedTab === 'DUTY'" class="max-h-[50vh] overflow-y-auto">
                    <div v-if="!schedData.duty || !schedData.duty.length" class="py-8 text-center text-caption text-muted">
                        No duty slots assigned or recommended for this Student Assistant.
                    </div>
                    <table v-else class="w-full text-left text-[12px]">
                        <thead class="bg-page text-[10px] font-semibold uppercase tracking-wider text-muted">
                            <tr>
                                <th class="px-3 py-2">Day</th>
                                <th class="px-3 py-2">Time</th>
                                <th class="px-3 py-2">Post / Room</th>
                                <th class="px-3 py-2">Department</th>
                                <th class="px-3 py-2 text-right">Credited Hours</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-line">
                            <tr v-for="d in schedData.duty" :key="d.id" class="hover:bg-mist/30">
                                <td class="px-3 py-2 font-medium text-ink">{{ DAY_LABELS[d.day] || d.day }}</td>
                                <td class="px-3 py-2 text-ink">{{ d.startLabel }} – {{ d.endLabel }}</td>
                                <td class="px-3 py-2 text-ink font-medium">{{ d.location }}</td>
                                <td class="px-3 py-2 text-muted">{{ d.department }}</td>
                                <td class="px-3 py-2 text-right font-semibold text-emerald-700">{{ d.credited }} hrs</td>
                            </tr>
                        </tbody>
                        <tfoot class="border-t border-line bg-page font-semibold text-[12px]">
                            <tr>
                                <td colspan="4" class="px-3 py-2 text-ink text-right">Total Weekly Duty:</td>
                                <td class="px-3 py-2 text-right text-emerald-800">{{ schedData.creditedHours }} hrs</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                <!-- Tab 3: Class Schedule Only -->
                <div v-else-if="schedTab === 'CLASSES'" class="max-h-[50vh] overflow-y-auto">
                    <div v-if="!schedData.classes || !schedData.classes.length" class="py-8 text-center text-caption text-muted">
                        No class schedule on file for this Student Assistant.
                    </div>
                    <table v-else class="w-full text-left text-[12px]">
                        <thead class="bg-page text-[10px] font-semibold uppercase tracking-wider text-muted">
                            <tr>
                                <th class="px-3 py-2">Day</th>
                                <th class="px-3 py-2">Time</th>
                                <th class="px-3 py-2">Subject</th>
                                <th class="px-3 py-2">Section</th>
                                <th class="px-3 py-2 text-right">Hours</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-line">
                            <tr v-for="c in schedData.classes" :key="c.id" class="hover:bg-mist/30">
                                <td class="px-3 py-2 font-medium text-ink">{{ DAY_LABELS[c.day] || c.day }}</td>
                                <td class="px-3 py-2 text-ink">{{ c.startLabel }} – {{ c.endLabel }}</td>
                                <td class="px-3 py-2 text-ink font-medium">{{ c.subject }}</td>
                                <td class="px-3 py-2 text-muted">{{ c.section || '—' }}</td>
                                <td class="px-3 py-2 text-right font-semibold text-navy">{{ c.hours }} hrs</td>
                            </tr>
                        </tbody>
                        <tfoot class="border-t border-line bg-page font-semibold text-[12px]">
                            <tr>
                                <td colspan="4" class="px-3 py-2 text-ink text-right">Total Class Hours:</td>
                                <td class="px-3 py-2 text-right text-navy">{{ schedData.classHours }} hrs</td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>
        </template>
        <template #footer>
            <div class="flex w-full items-center justify-between">
                <router-link v-if="selectedSa" :to="'/admin/sa-management/' + selectedSa.id" class="btn btn-ghost btn-sm inline-flex items-center gap-1.5 text-muted hover:text-navy">
                    <span>Full S.A. Profile</span>
                    <app-icon name="ExternalLink" :size="13" />
                </router-link>
                <div v-else></div>
                <button @click="selectedSa = null" class="btn btn-secondary">Close</button>
            </div>
        </template>
    </app-modal>
    `
};
