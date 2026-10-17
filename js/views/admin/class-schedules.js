// Scheduling > Class Schedules.
// View-only official class schedules synced from the Registrar's enrollment records (COR).
// Only the Registrar can edit student class schedules.
const ClassSchedulesPage = {
    components: { AppIcon, PageHeader, AppModal },

    setup() {
        const items = Vue.ref([]);          // every class period
        const students = Vue.ref([]);       // active S.A.s
        const semester = Vue.ref(null);
        const coverage = Vue.reactive({ withSchedule: 0, total: 0 });
        const loading = Vue.ref(true);
        const loadError = Vue.ref("");

        const q = Vue.ref("");
        const status = Vue.ref("ALL");
        const page = Vue.ref(1);
        const PAGE_SIZE = 12;

        const viewer = Vue.ref(null);       // { sa, periods, active, hours, ... }
        const gridViewMode = Vue.ref("grid"); // "grid" or "table"

        const DAYS_LIST = [
            { code: "MON", label: "MON", name: "Monday" },
            { code: "TUE", label: "TUE", name: "Tuesday" },
            { code: "WED", label: "WED", name: "Wednesday" },
            { code: "THU", label: "THU", name: "Thursday" },
            { code: "FRI", label: "FRI", name: "Friday" },
            { code: "SAT", label: "SAT", name: "Saturday" },
            { code: "SUN", label: "SUN", name: "Sunday" }
        ];

        const dayNames = { MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday", SUN: "Sunday" };
        const DAY_ORDER = Object.keys(dayNames);
        const statusStyles = {
            UPLOADED: ["bg-success/10 text-success", "CircleCheck", "Uploaded"],
            ARCHIVED: ["bg-page text-muted", "Archive", "Archived"],
            NONE: ["bg-danger/10 text-danger", "CircleX", "No schedule"]
        };

        const formatTime12 = (m) => {
            const hrs = Math.floor(m / 60);
            const mins = m % 60;
            const h12 = hrs % 12 === 0 ? 12 : hrs % 12;
            const ampm = hrs >= 12 ? "PM" : "AM";
            return `${h12}:${String(mins).padStart(2, "0")}${ampm}`;
        };

        const TIME_SLOTS = [];
        for (let m = 420; m <= 1320; m += 30) { // 7:00 AM to 10:00 PM
            const startStr = formatTime12(m);
            const endStr = formatTime12(m + 30);
            TIME_SLOTS.push({ min: m, label: `${startStr} - ${endStr}`, startStr, endStr });
        }

        const parseMin = (tStr) => {
            if (!tStr) return 420;
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
            if (m24) {
                return parseInt(m24[1], 10) * 60 + parseInt(m24[2], 10);
            }
            return 420;
        };

        const normalizeDay = (d) => {
            if (!d) return "";
            const s = String(d).trim().toUpperCase();
            if (s.startsWith("MON")) return "MON";
            if (s.startsWith("TUE")) return "TUE";
            if (s.startsWith("WED")) return "WED";
            if (s.startsWith("THU")) return "THU";
            if (s.startsWith("FRI")) return "FRI";
            if (s.startsWith("SAT")) return "SAT";
            if (s.startsWith("SUN")) return "SUN";
            return s;
        };

        const getDayPeriods = (dayCode) => {
            if (!viewer.value) return [];
            return viewer.value.periods.filter(p => normalizeDay(p.day) === dayCode);
        };

        const getPeriodStyle = (p) => {
            const startM = parseMin(p.startTime);
            const endM = parseMin(p.endTime);
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
            { bg: "bg-sky-100/90", border: "border-sky-400", text: "text-sky-950", hover: "hover:bg-sky-200" },
            { bg: "bg-amber-100/90", border: "border-amber-400", text: "text-amber-950", hover: "hover:bg-amber-200" },
            { bg: "bg-purple-100/90", border: "border-purple-400", text: "text-purple-950", hover: "hover:bg-purple-200" },
            { bg: "bg-emerald-100/90", border: "border-emerald-400", text: "text-emerald-950", hover: "hover:bg-emerald-200" },
            { bg: "bg-rose-100/90", border: "border-rose-400", text: "text-rose-950", hover: "hover:bg-rose-200" },
            { bg: "bg-indigo-100/90", border: "border-indigo-400", text: "text-indigo-950", hover: "hover:bg-indigo-200" },
            { bg: "bg-teal-100/90", border: "border-teal-400", text: "text-teal-950", hover: "hover:bg-teal-200" }
        ];

        const getPeriodColor = (p, idx) => {
            const key = (p.subject || "") + (p.id || idx);
            let hash = 0;
            for (let i = 0; i < key.length; i++) hash = (hash << 5) - hash + key.charCodeAt(i);
            const colorIdx = Math.abs(hash) % COLOR_CLASSES.length;
            return COLOR_CLASSES[colorIdx];
        };

        const parseSubjectParts = (subjectStr) => {
            const s = String(subjectStr || "").trim();
            const parts = s.split(/\s*-\s*/);
            if (parts.length > 1) {
                return { code: parts[0], title: parts.slice(1).join(" - ") };
            }
            return { code: s, title: "" };
        };

        const route = VueRouter.useRoute();
        const load = async () => {
            loading.value = true;
            loadError.value = "";
            const [classes, sas] = await Promise.all([
                Model.request("scheduling", "class_list"),
                Model.request("sa", "list")
            ]);
            loading.value = false;
            if (!classes.success) { loadError.value = classes.message; return; }
            if (!sas.success) { loadError.value = sas.message; return; }
            items.value = classes.items;
            semester.value = classes.semester;
            coverage.withSchedule = classes.saWithSchedule;
            coverage.total = classes.saTotal;
            students.value = sas.items.filter(sa => sa.saStatus === "ACTIVE" && !sa.archivedAt);

            // Apply incoming query params if navigated from S.A. Management
            if (route.query.studentId) {
                q.value = String(route.query.studentId).trim();
            } else if (route.query.q) {
                q.value = String(route.query.q).trim();
            }
            if (route.query.cat) {
                const reqCat = String(route.query.cat).toUpperCase();
                if (['ACADS', 'ITO', 'OFFICE', 'ALL'].includes(reqCat)) {
                    category.value = reqCat;
                }
            }

            // Auto-open modal if requested
            await Vue.nextTick();
            checkAutoOpen();
        };
        Vue.onMounted(load);

        // class_list hands back times as labels ("1:00 PM"), so they are parsed
        // before they can be sorted or counted
        const minutesOf = t => {
            const m = String(t || "").match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
            if (!m) return 0;
            let h = Number(m[1]) % 12;
            if (/PM/i.test(m[3])) h += 12;
            return h * 60 + Number(m[2]);
        };
        const sortPeriods = list => [...list].sort((a, b) =>
            DAY_ORDER.indexOf(a.day) - DAY_ORDER.indexOf(b.day) || minutesOf(a.startTime) - minutesOf(b.startTime));

        const hoursOf = c => Math.max(0, minutesOf(c.endTime) - minutesOf(c.startTime)) / 60;

        // One row per S.A., with the periods that belong to them
        const rows = Vue.computed(() => students.value.map(sa => {
            const periods = items.value.filter(c => c.saProfileId === sa.id);
            const active = periods.filter(c => !c.archived);
            return {
                sa,
                periods: sortPeriods(periods),
                active: active.length,
                archived: periods.length - active.length,
                hours: Math.round(active.reduce((n, c) => n + hoursOf(c), 0) * 10) / 10,
                status: active.length ? "UPLOADED" : (periods.length ? "ARCHIVED" : "NONE")
            };
        }));

        // S.A. category filter: ALL | ACADS | ITO | OFFICE
        const category = Vue.ref("ALL");
        const categoryCounts = Vue.computed(() => {
            const out = { ALL: rows.value.length, ACADS: 0, ITO: 0, OFFICE: 0 };
            rows.value.forEach(r => {
                const cat = (r.sa.saCategory || r.sa.departmentType || '').toUpperCase();
                if (out[cat] !== undefined) out[cat]++;
            });
            return out;
        });
        const inCategory = Vue.computed(() =>
            rows.value.filter(r => {
                if (category.value === "ALL") return true;
                const cat = (r.sa.saCategory || r.sa.departmentType || '').toUpperCase();
                return cat === category.value;
            }));

        const filtered = Vue.computed(() => {
            const term = q.value.trim().toLowerCase();
            return inCategory.value.filter(r => (status.value === "ALL" || r.status === status.value)
                && (!term || [r.sa.saNumber, r.sa.studentId, r.sa.name, r.sa.course].some(v => v && v.toLowerCase().includes(term))));
        });
        const counts = Vue.computed(() => ({
            ALL: inCategory.value.length,
            UPLOADED: inCategory.value.filter(r => r.status === "UPLOADED").length,
            NONE: inCategory.value.filter(r => r.status === "NONE").length,
            ARCHIVED: inCategory.value.filter(r => r.status === "ARCHIVED").length
        }));
        const sortKey = Vue.ref("name");
        const sortDir = Vue.ref("asc");
        const pageSize = Vue.ref(10);

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

        const sortedRows = Vue.computed(() => {
            const list = [...filtered.value];
            const key = sortKey.value;
            const dir = sortDir.value === "asc" ? 1 : -1;
            list.sort((a, b) => {
                let res = 0;
                if (key === "saNumber") {
                    res = (a.sa.saNumber || a.sa.studentId || "").localeCompare(b.sa.saNumber || b.sa.studentId || "", undefined, { numeric: true });
                } else if (key === "studentId") {
                    res = (a.sa.studentId || "").localeCompare(b.sa.studentId || "", undefined, { numeric: true });
                } else if (key === "name") {
                    res = (a.sa.name || "").localeCompare(b.sa.name || "");
                } else if (key === "course") {
                    res = (a.sa.course || "").localeCompare(b.sa.course || "");
                } else if (key === "departmentType") {
                    const catA = (a.sa.saCategory || a.sa.departmentType || "").toUpperCase();
                    const catB = (b.sa.saCategory || b.sa.departmentType || "").toUpperCase();
                    res = catA.localeCompare(catB);
                } else if (key === "status") {
                    res = (a.status || "").localeCompare(b.status || "");
                    if (res === 0) res = (a.active || 0) - (b.active || 0);
                } else if (key === "hours") {
                    res = (a.hours || 0) - (b.hours || 0);
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
            const pages = [];
            if (current <= 4) {
                for (let i = 1; i <= 5; i++) pages.push(i);
                pages.push("...");
                pages.push(total);
            } else if (current >= total - 3) {
                pages.push(1);
                pages.push("...");
                for (let i = total - 4; i <= total; i++) pages.push(i);
            } else {
                pages.push(1);
                pages.push("...");
                for (let i = current - 1; i <= current + 1; i++) pages.push(i);
                pages.push("...");
                pages.push(total);
            }
            return pages;
        });

        Vue.watch([q, status, category, pageSize], () => { page.value = 1; });
        Vue.watch(pageCount, n => { if (page.value > n) page.value = n; });

        const openView = row => {
            viewer.value = { ...row };
        };

        const checkAutoOpen = () => {
            if ((route.query.open === '1' || route.query.open === 'true') && (route.query.studentId || route.query.saId || route.query.q)) {
                const targetId = route.query.saId ? Number(route.query.saId) : null;
                const targetStud = String(route.query.studentId || route.query.q || '').trim().toLowerCase();
                const match = rows.value.find(r => (targetId && r.sa.id === targetId) || (targetStud && String(r.sa.studentId || '').toLowerCase() === targetStud));
                if (match) {
                    viewer.value = { ...match };
                }
            }
        };

        Vue.watch(() => route.query, () => {
            if (route.query.studentId) q.value = String(route.query.studentId).trim();
            checkAutoOpen();
        });

        return { items, students, semester, coverage, loading, loadError, load, q, status, counts, category, categoryCounts,
                 page, pageSize, pageCount, pageRows, filtered, sortedRows, rangeText, visiblePages,
                 sortKey, sortDir, sortBy, getSortIcon, dayNames, statusStyles,
                 viewer, openView, gridViewMode, DAYS_LIST, TIME_SLOTS, getDayPeriods, getPeriodStyle,
                 getPeriodColor, parseSubjectParts, Format };
    },

    template: `
    <page-header title="Class Schedules" section="Scheduling"
                 :subtitle="semester ? 'Official class schedules synced from Registrar for ' + semester.label + '. Matching uses these to avoid class conflicts.' : ''" />

    <div v-if="loading" class="space-y-4" aria-busy="true">
        <div class="h-28 animate-pulse rounded-xl bg-white"></div>
        <div class="h-80 animate-pulse rounded-xl bg-white"></div>
    </div>

    <div v-else-if="loadError" class="card flex flex-col items-center px-6 py-12 text-center">
        <app-icon name="CircleX" :size="28" class="text-danger" />
        <p class="mt-3 text-body font-medium text-ink">Couldn't load class schedules</p>
        <p class="mt-1 text-caption text-muted">{{ loadError }}</p>
        <button @click="load" class="btn btn-secondary btn-sm mt-4"><app-icon name="RefreshCw" :size="14" /> Try again</button>
    </div>

    <template v-else>
        <!-- Schedule Overview & Sync Status -->
        <section class="card mb-5 p-5 sm:p-6">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h2 class="text-card-title text-navy flex items-center gap-2">
                        <app-icon name="CalendarDays" :size="19" /> Official Class Schedules
                    </h2>
                    <p class="mt-1 max-w-2xl text-body text-muted">
                        All student schedules are automatically retrieved from the Registrar's official enrollment records (COR). Class schedules are strictly view-only to maintain registrar data integrity.
                    </p>
                </div>
                <div class="shrink-0">
                    <span class="inline-flex items-center gap-1.5 rounded-full bg-success/10 px-3 py-1 text-[12px] font-semibold text-success">
                        <app-icon name="CheckCheck" :size="14" /> Registrar Auto-Sync Active
                    </span>
                </div>
            </div>

            <dl class="mt-5 grid gap-3 sm:grid-cols-3">
                <div class="rounded-lg bg-page px-4 py-3">
                    <dt class="text-caption text-muted">Class periods in use</dt>
                    <dd class="text-[20px] font-bold text-navy">{{ items.filter(c => !c.archived).length }}</dd>
                </div>
                <div class="rounded-lg bg-page px-4 py-3">
                    <dt class="text-caption text-muted">Active S.A.s with a schedule</dt>
                    <dd class="text-[20px] font-bold" :class="coverage.withSchedule < coverage.total ? 'text-warning' : 'text-success'">
                        {{ coverage.withSchedule }} / {{ coverage.total }}
                    </dd>
                </div>
                <div class="rounded-lg bg-page px-4 py-3">
                    <dt class="text-caption text-muted">Semester</dt>
                    <dd class="text-[15px] font-semibold text-ink">{{ semester.label }}</dd>
                </div>
            </dl>
            <p v-if="coverage.withSchedule < coverage.total" class="mt-3 flex items-start gap-2 text-caption text-warning">
                <app-icon name="TriangleAlert" :size="14" class="mt-0.5" />
                {{ coverage.total - coverage.withSchedule }} active S.A.(s) have not been enrolled in subjects yet by the Registrar.
            </p>
        </section>

        <!-- One row per S.A. -->
        <section class="card overflow-hidden">
            <div class="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center">
                <div class="relative flex-1">
                    <app-icon name="Search" :size="16" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input v-model="q" type="search" class="input pl-9" placeholder="Search by student ID or name" aria-label="Search S.A.s">
                </div>
                <div class="inline-flex shrink-0 rounded-lg border border-line bg-page p-1" role="tablist" aria-label="Filter by S.A. category">
                    <button v-for="c in [['ALL','All'],['ACADS','ACADS'],['ITO','ITO'],['OFFICE','Office']]" :key="c[0]"
                            type="button" role="tab" :aria-selected="category === c[0]" @click="category = c[0]"
                            class="rounded-md px-3 py-1.5 text-[13px] font-semibold transition-colors"
                            :class="category === c[0] ? 'bg-white text-navy shadow-sm' : 'text-muted hover:text-navy'">
                        {{ c[1] }} <span class="font-normal opacity-70">({{ categoryCounts[c[0]] }})</span>
                    </button>
                </div>
                <select v-model="status" class="input sm:w-52" aria-label="Filter by schedule status">
                    <option value="ALL">All S.A.s ({{ counts.ALL }})</option>
                    <option value="UPLOADED">Uploaded ({{ counts.UPLOADED }})</option>
                    <option value="NONE">No schedule ({{ counts.NONE }})</option>
                    <option value="ARCHIVED">Archived ({{ counts.ARCHIVED }})</option>
                </select>
            </div>

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

            <div v-if="!students.length" class="flex flex-col items-center px-6 py-14 text-center">
                <span class="grid h-12 w-12 place-items-center rounded-full bg-mist text-navy"><app-icon name="Users" :size="22" /></span>
                <p class="mt-3 text-body font-medium text-ink">No active S.A. registered yet</p>
                <p class="mt-1 max-w-sm text-caption text-muted">Register them in S.A. Management first. Their enrolled subjects will automatically connect here.</p>
            </div>

            <div v-else-if="!sortedRows.length" class="flex flex-col items-center px-6 py-14 text-center">
                <span class="grid h-12 w-12 place-items-center rounded-full bg-mist text-navy"><app-icon name="SearchX" :size="22" /></span>
                <p class="mt-3 text-body font-medium text-ink">No S.A. matches this search</p>
            </div>

            <template v-else>
                <div class="overflow-x-auto">
                    <table class="w-full min-w-[720px] text-left text-[13px] border-collapse">
                        <thead>
                            <tr class="border-b border-line bg-mist/60 text-[12px] font-semibold uppercase tracking-wider text-muted select-none">
                                <th class="px-5 py-3.5">
                                    <button type="button" @click="sortBy('saNumber')" class="inline-flex items-center gap-1.5 text-left hover:text-navy transition-colors font-semibold uppercase tracking-wider">
                                        S.A. & Student ID
                                        <app-icon :name="getSortIcon('saNumber')" :size="13" :class="sortKey === 'saNumber' ? 'text-navy font-bold' : 'text-disabled'" />
                                    </button>
                                </th>
                                <th class="px-5 py-3.5">
                                    <button type="button" @click="sortBy('name')" class="inline-flex items-center gap-1.5 text-left hover:text-navy transition-colors font-semibold uppercase tracking-wider">
                                        Name & Course
                                        <app-icon :name="getSortIcon('name')" :size="13" :class="sortKey === 'name' ? 'text-navy font-bold' : 'text-disabled'" />
                                    </button>
                                </th>
                                <th class="px-5 py-3.5">
                                    <button type="button" @click="sortBy('status')" class="inline-flex items-center gap-1.5 text-left hover:text-navy transition-colors font-semibold uppercase tracking-wider">
                                        Status & Schedule
                                        <app-icon :name="getSortIcon('status')" :size="13" :class="sortKey === 'status' ? 'text-navy font-bold' : 'text-disabled'" />
                                    </button>
                                </th>
                                <th class="px-5 py-3.5 text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-line">
                            <tr v-for="row in pageRows" :key="row.sa.id" class="transition-colors duration-150 hover:bg-mist/50">
                                <td class="whitespace-nowrap px-5 py-3.5">
                                    <span v-if="row.sa.saNumber" class="font-mono font-bold text-navy block text-[13px]">{{ row.sa.saNumber }}</span>
                                    <span class="font-mono text-caption text-muted">{{ row.sa.studentId }}</span>
                                </td>
                                <td class="whitespace-nowrap px-5 py-3.5">
                                    <router-link :to="'/admin/sa-management/' + row.sa.id" class="font-semibold text-ink hover:text-navy hover:underline">
                                        {{ row.sa.name }}
                                    </router-link>
                                    <span class="block text-caption text-muted">{{ row.sa.course }} · {{ row.sa.departmentType }}</span>
                                </td>
                                <td class="whitespace-nowrap px-5 py-3.5">
                                    <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold"
                                          :class="statusStyles[row.status][0]">
                                        <app-icon :name="statusStyles[row.status][1]" :size="12" /> {{ statusStyles[row.status][2] }}
                                    </span>
                                    <span v-if="row.active" class="ml-1.5 text-caption text-muted">{{ row.active }} class period(s) · {{ row.hours }} hrs/wk</span>
                                    <span v-else-if="row.archived" class="ml-1.5 text-caption text-muted">{{ row.archived }} period(s) on record</span>
                                </td>
                                <td class="whitespace-nowrap px-5 py-3.5 text-right">
                                    <button @click="openView(row)" :disabled="!row.periods.length"
                                            class="btn btn-secondary btn-sm"
                                            :aria-label="'View schedule for ' + row.sa.name">
                                        <app-icon name="Eye" :size="14" /> View schedule
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
            </template>
        </section>
    </template>

    <!-- Excel-Style Visual Weekly Timetable Grid Modal -->
    <app-modal :open="!!viewer" size="xl" icon="Calendar" :title="viewer ? viewer.sa.name + ' — Weekly Class Timetable' : ''" @close="viewer = null"
               :description="viewer ? ((viewer.sa.saNumber ? viewer.sa.saNumber + ' · ' : '') + viewer.sa.studentId + ' · ' + viewer.sa.course + ' · ' + viewer.active + ' enrolled class period(s)') : ''">
        <template v-if="viewer">
            <!-- Header bar with S.A. info and View Switcher -->
            <div class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-mist/70 p-3">
                <div class="flex flex-wrap items-center gap-2">
                    <span v-if="viewer.sa.saNumber" class="rounded-lg bg-gold/90 text-navy px-3 py-1 text-[13px] font-bold shadow-xs tracking-wide">
                        {{ viewer.sa.saNumber }}
                    </span>
                    <span class="rounded-lg bg-navy px-3 py-1 text-[13px] font-bold text-white shadow-xs">
                        {{ viewer.sa.studentId }}
                    </span>
                    <span class="text-caption font-bold text-navy text-[14px]">{{ viewer.sa.name }}</span>
                    <span class="rounded border border-line bg-white px-2 py-0.5 text-caption font-medium text-muted">
                        {{ viewer.sa.course }} · {{ viewer.sa.departmentType }}
                    </span>
                    <span class="rounded-full bg-success/15 px-2.5 py-0.5 text-[11px] font-bold text-success border border-success/20">
                        {{ viewer.active }} Enrolled Class Period(s)
                    </span>
                </div>
                <div class="flex items-center gap-2">
                    <router-link :to="'/admin/sa-management/' + viewer.sa.id"
                                 class="btn btn-secondary btn-sm flex items-center gap-1.5"
                                 title="Open full S.A. record in S.A. Management">
                        <app-icon name="User" :size="13" /> View S.A. Profile
                    </router-link>
                    <div class="flex rounded-lg border border-line bg-white p-0.5 text-caption font-semibold">
                        <button type="button" @click="gridViewMode = 'grid'"
                                class="flex items-center gap-1 rounded-md px-2.5 py-1 transition-all"
                                :class="gridViewMode === 'grid' ? 'bg-navy text-white shadow-xs' : 'text-muted hover:text-ink'">
                            <app-icon name="LayoutGrid" :size="13" /> Visual Grid (7am - 10pm)
                        </button>
                        <button type="button" @click="gridViewMode = 'table'"
                                class="flex items-center gap-1 rounded-md px-2.5 py-1 transition-all"
                                :class="gridViewMode === 'table' ? 'bg-navy text-white shadow-xs' : 'text-muted hover:text-ink'">
                            <app-icon name="List" :size="13" /> List View
                        </button>
                    </div>
                </div>
            </div>

            <!-- Empty State -->
            <div v-if="!viewer.periods.length" class="card flex flex-col items-center py-12 text-center border-dashed">
                <app-icon name="CalendarOff" :size="32" class="text-muted" />
                <p class="mt-2 font-bold text-ink text-[15px]">No class schedule recorded</p>
                <p class="text-caption text-muted mt-1 max-w-sm">
                    Enrolled subjects will automatically appear here once officially enrolled by the Registrar.
                </p>
            </div>

            <div v-else>
                <!-- 1. Visual Weekly Timetable Grid Matrix (7:00 AM - 10:00 PM) -->
                <div v-if="gridViewMode === 'grid'" class="overflow-auto rounded-xl border border-line bg-white shadow-card max-h-[62vh]">
                    <div class="min-w-[940px]">
                        <!-- Dark Navy Header Row -->
                        <div class="sticky top-0 z-30 grid grid-cols-[140px_repeat(7,minmax(0,1fr))] bg-navy text-white text-[12px] font-bold shadow-xs">
                            <div class="sticky left-0 z-40 bg-navy px-2 py-2.5 border-r border-navy-700 text-center uppercase tracking-wider text-[11px]">
                                TIME
                            </div>
                            <div v-for="d in DAYS_LIST" :key="d.code" class="px-2 py-2.5 text-center border-r border-navy-700 uppercase tracking-wider last:border-r-0 text-[11px]">
                                {{ d.label }}
                            </div>
                        </div>

                        <!-- 7 AM to 10 PM Grid Body (30 slots x 36px = 1080px total height) -->
                        <div class="relative grid grid-cols-[140px_repeat(7,minmax(0,1fr))] select-none" style="height: 1080px;">
                            <!-- Sticky Left Time Column -->
                            <div class="sticky left-0 z-20 bg-mist/90 border-r border-line text-[11px] font-bold text-navy">
                                <div v-for="t in TIME_SLOTS" :key="t.min"
                                     class="h-9 px-1 flex items-center justify-center border-b border-line/40 text-[10px] font-bold text-navy whitespace-nowrap">
                                    {{ t.label }}
                                </div>
                            </div>

                            <!-- 7 Day Columns -->
                            <div v-for="d in DAYS_LIST" :key="d.code" class="relative border-r border-line last:border-r-0 bg-white">
                                <!-- 30 Slot Background Grid Lines -->
                                <div v-for="t in TIME_SLOTS" :key="t.min"
                                     class="h-9 border-b border-line/40 transition-colors hover:bg-navy/5">
                                </div>

                                <!-- Class Period Cards (Absolute Positioned) -->
                                <div v-for="(p, idx) in getDayPeriods(d.code)" :key="p.id"
                                     :style="getPeriodStyle(p)"
                                     :title="p.subject + ' (' + (p.section || 'No Section') + ') | ' + p.startTime + ' - ' + p.endTime"
                                     class="absolute left-1 right-1 rounded-md border px-2 py-1.5 shadow-xs transition-all hover:z-30 hover:shadow-md cursor-default flex flex-col justify-between overflow-hidden"
                                     :class="[getPeriodColor(p, idx).bg, getPeriodColor(p, idx).border, getPeriodColor(p, idx).text, getPeriodColor(p, idx).hover]">
                                    <div class="min-w-0 flex-1 leading-snug">
                                        <div class="flex items-center justify-between gap-1">
                                            <span class="font-bold text-[11px] truncate">{{ parseSubjectParts(p.subject).code }}</span>
                                            <span v-if="p.section" class="rounded bg-black/10 px-1 py-0.2 text-[9px] font-bold shrink-0">{{ p.section }}</span>
                                        </div>
                                        <div v-if="parseSubjectParts(p.subject).title" class="text-[10px] opacity-90 truncate font-medium">
                                            {{ parseSubjectParts(p.subject).title }}
                                        </div>
                                    </div>
                                    <div class="text-[9px] font-bold opacity-75 mt-0.5 truncate">
                                        {{ p.startTime }} – {{ p.endTime }}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 2. Traditional List View -->
                <div v-else class="overflow-x-auto rounded-xl border border-line bg-white shadow-card">
                    <table class="w-full text-left text-[13px] border-collapse">
                        <thead class="bg-navy text-white text-caption font-bold">
                            <tr>
                                <th class="border-b border-navy-700 px-3 py-2.5 w-28">Day</th>
                                <th class="border-b border-navy-700 px-3 py-2.5 w-44">Time Period</th>
                                <th class="border-b border-navy-700 px-3 py-2.5">Subject & Description</th>
                                <th class="border-b border-navy-700 px-3 py-2.5 w-32">Section</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-line">
                            <tr v-for="(p, idx) in viewer.periods" :key="p.id" class="transition-colors hover:bg-mist/40"
                                :class="idx % 2 === 0 ? 'bg-white' : 'bg-mist/15'">
                                <td class="whitespace-nowrap px-3 py-2.5 font-bold text-navy">
                                    <span class="rounded bg-mist px-2.5 py-1 text-[11px] uppercase font-bold text-navy border border-navy/15">
                                        {{ dayNames[p.day] }}
                                    </span>
                                </td>
                                <td class="whitespace-nowrap px-3 py-2.5 font-semibold text-ink">
                                    {{ p.startTime }} – {{ p.endTime }}
                                </td>
                                <td class="px-3 py-2.5 font-medium text-ink">
                                    {{ p.subject }}
                                </td>
                                <td class="px-3 py-2.5 text-muted font-mono text-[12px]">
                                    {{ p.section || '—' }}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="mt-4 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
                <span class="italic">
                    * Class schedules are managed exclusively by the Registrar. Official changes in enrolled subjects or section adjustments will automatically reflect here.
                </span>
                <span class="font-semibold text-navy">
                    Source: Registrar Certificate of Registration (COR)
                </span>
            </div>
        </template>

        <template #footer>
            <button @click="viewer = null" class="btn btn-secondary">Close</button>
        </template>
    </app-modal>
    `
};
