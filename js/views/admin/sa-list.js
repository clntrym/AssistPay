// S.A. Management: the roster.
// Search, filters, sorting and paging all run in the browser (a few hundred rows
// at most). The filters are kept in the URL so Back returns to the same view.
const SaListPage = {
    components: { AppIcon, PageHeader, StatusBadge },

    setup() {
        const route = VueRouter.useRoute();
        const router = VueRouter.useRouter();

        const items = Vue.ref([]);
        const loading = Vue.ref(true);
        const loadError = Vue.ref("");
        const busy = Vue.ref(false);
        const menuFor = Vue.ref(null);      // { id, x, y } — the row menu, positioned over the table

        const q = Vue.ref(route.query.q || "");
        const status = Vue.ref(route.query.status || "ALL");
        const category = Vue.ref(route.query.cat || "ALL");
        const department = Vue.ref(route.query.dept || "ALL");
        const deployment = Vue.ref(route.query.dep || "ALL");
        const classFilter = Vue.ref(route.query.cls || "ALL");
        const page = Vue.ref(Number(route.query.page) || 1);
        const sortKey = Vue.ref(route.query.sort || "name");
        const sortDir = Vue.ref(route.query.dir === "desc" ? "desc" : "asc");
        const PAGE_SIZE = 10;

        const activeSemester = Vue.ref(null);
        const isEnrollmentMode = Vue.computed(() => {
            const sem = activeSemester.value || Store.semester;
            return (sem?.dutyScheduleMode || '').toUpperCase() === 'ENROLLMENT';
        });

        // Roster filter list: All, (Active in Enrollment mode), Assigned, Unassigned, Under Agreement, Archived.
        // During regular semester mode, Active is omitted in favor of Assigned/Unassigned.
        const statusFilters = Vue.computed(() => {
            const list = [
                { value: "ALL", label: "All", test: s => !s.archivedAt }
            ];
            if (isEnrollmentMode.value) {
                list.push({ value: "ACTIVE", label: "Active", test: s => !s.archivedAt });
            }
            list.push(
                { value: "ASSIGNED", label: "Assigned", test: s => s.assignmentStatus === "ASSIGNED" && !s.archivedAt },
                { value: "UNASSIGNED", label: "Unassigned", test: s => s.assignmentStatus === "UNASSIGNED" && !s.archivedAt },
                { value: "UNDER_AGREEMENT", label: "Under Agreement", test: s => s.disciplinaryStatus === "UNDER_AGREEMENT" && !s.archivedAt },
                { value: "ARCHIVED", label: "Archived", test: s => !!s.archivedAt }
            );
            return list;
        });
        const counts = Vue.computed(() =>
            Object.fromEntries(statusFilters.value.map(f => [f.value, items.value.filter(f.test).length])));

        // Category counts synced with Class Schedules (ALL, ACADS, ITO, OFFICE)
        const categoryCounts = Vue.computed(() => {
            const activeSas = items.value.filter(s => !s.archivedAt);
            const out = { ALL: activeSas.length, ACADS: 0, ITO: 0, OFFICE: 0 };
            activeSas.forEach(s => {
                const c = (s.saCategory || s.departmentType || '').toUpperCase();
                if (out[c] !== undefined) out[c]++;
            });
            return out;
        });

        // The four figures across the top, each one a shortcut into the list
        const tiles = Vue.computed(() => [
            { key: "ALL", label: "All S.A.", value: counts.value.ALL, icon: "Users", tone: "text-navy bg-mist" },
            { key: "ASSIGNED", label: "Assigned", value: counts.value.ASSIGNED, icon: "CircleCheck", tone: "text-success bg-success/10" },
            { key: "UNASSIGNED", label: "Unassigned", value: counts.value.UNASSIGNED, icon: "UserMinus", tone: "text-warning bg-warning/10" },
            { key: "ARCHIVED", label: "Archived", value: counts.value.ARCHIVED, icon: "Archive", tone: "text-slate-600 bg-slate-100" }
        ]);

        const departments = Vue.computed(() => {
            const seen = new Set();
            items.value.forEach(s => seen.add(s.office ? s.office.name : s.departmentType));
            return [...seen].filter(Boolean).sort();
        });

        const columns = [
            { key: "saNumber", label: "S.A. Number", sortValue: s => s.saNumber || "" },
            { key: "name", label: "Student Assistant", sortValue: s => s.lastName + " " + s.firstName },
            { key: "department", label: "Department", sortValue: s => s.office?.name || s.departmentType },
            { key: "deployment", label: "Deployment", sortValue: s => s.deployment || "~" },
            { key: "supervisor", label: "Supervisor", sortValue: s => s.supervisor?.name || "~" },
            { key: "classSchedule", label: "Class schedule", sortValue: s => (s.hasClassSchedule ? 0 : 1) },
            { key: "saStatus", label: "Status", sortable: false }
        ];

        const filtered = Vue.computed(() => {
            const term = q.value.trim().toLowerCase();
            const test = statusFilters.value.find(f => f.value === status.value)?.test || (() => true);
            const rows = items.value.filter(s => test(s)
                && (category.value === "ALL" || s.saCategory === category.value)
                && (department.value === "ALL" || (s.office ? s.office.name : s.departmentType) === department.value)
                && (deployment.value === "ALL" || (deployment.value === "YES" ? s.deployed : !s.deployed))
                && (classFilter.value === "ALL" || (classFilter.value === "YES" ? s.hasClassSchedule : !s.hasClassSchedule))
                && (!term || [s.saNumber, s.studentId, s.name, s.course, s.office?.name, s.supervisor?.name, s.saCategory, s.deployment]
                    .some(v => v && String(v).toLowerCase().includes(term))));

            const col = columns.find(c => c.key === sortKey.value);
            const val = col?.sortValue || (s => s[sortKey.value]);
            const dir = sortDir.value === "asc" ? 1 : -1;
            return [...rows].sort((a, b) => {
                const x = val(a), y = val(b);
                return (typeof x === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? ""))) * dir;
            });
        });

        const pageCount = Vue.computed(() => Math.max(1, Math.ceil(filtered.value.length / PAGE_SIZE)));
        const pageRows = Vue.computed(() => filtered.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
        const rangeText = Vue.computed(() => {
            const n = filtered.value.length;
            if (!n) return "No results";
            const from = (page.value - 1) * PAGE_SIZE + 1;
            return `Showing ${from}–${Math.min(n, from + PAGE_SIZE - 1)} of ${n}`;
        });

        const sortBy = key => {
            if (sortKey.value === key) sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
            else { sortKey.value = key; sortDir.value = "asc"; }
        };
        const ariaSort = key => sortKey.value !== key ? "none" : (sortDir.value === "asc" ? "ascending" : "descending");

        const initials = name => String(name || "").trim().split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

        const copiedSaNumber = Vue.ref("");
        const copySaNumber = async (num) => {
            if (!num) return;
            try {
                await navigator.clipboard.writeText(num);
                copiedSaNumber.value = num;
                Store.toast("success", `Copied S.A. Number: ${num}`);
                setTimeout(() => {
                    if (copiedSaNumber.value === num) copiedSaNumber.value = "";
                }, 2000);
            } catch (e) {
                Store.toast("info", `S.A. Number: ${num}`);
            }
        };

        // Filters changed -> back to page 1; keep everything in the URL
        Vue.watch([q, status, category, department, deployment, classFilter], () => { page.value = 1; });
        Vue.watch([q, status, category, department, deployment, classFilter, page, sortKey, sortDir], () => {
            const query = {};
            if (q.value) query.q = q.value;
            if (status.value !== "ALL") query.status = status.value;
            if (category.value !== "ALL") query.cat = category.value;
            if (department.value !== "ALL") query.dept = department.value;
            if (deployment.value !== "ALL") query.dep = deployment.value;
            if (classFilter.value !== "ALL") query.cls = classFilter.value;
            if (page.value > 1) query.page = page.value;
            if (sortKey.value !== "name") query.sort = sortKey.value;
            if (sortDir.value !== "asc") query.dir = sortDir.value;
            router.replace({ query });
        });
        Vue.watch(pageCount, n => { if (page.value > n) page.value = n; });

        const clearFilters = () => {
            q.value = ""; status.value = "ALL"; category.value = "ALL";
            department.value = "ALL"; deployment.value = "ALL"; classFilter.value = "ALL";
        };
        const hasFilters = Vue.computed(() => q.value || status.value !== "ALL" || category.value !== "ALL"
            || department.value !== "ALL" || deployment.value !== "ALL" || classFilter.value !== "ALL");

        const load = async () => {
            loading.value = true;
            loadError.value = "";
            const r = await Model.request("sa", "list");
            loading.value = false;
            if (r.success) {
                if (r.semester) activeSemester.value = r.semester;
                items.value = r.items || [];
            } else {
                loadError.value = r.message;
            }
        };
        Vue.onMounted(load);

        // ---------- the row menu ----------
        // Positioned from the button's own rectangle so the table's scrollbox
        // cannot clip it.
        const toggleMenu = (row, event) => {
            if (menuFor.value?.id === row.id) { menuFor.value = null; return; }
            const r = event.currentTarget.getBoundingClientRect();
            const flipUp = r.bottom + 190 > window.innerHeight;
            menuFor.value = { id: row.id, row, x: r.right - 200, y: flipUp ? r.top - 190 : r.bottom + 6 };
        };
        const closeMenu = () => { menuFor.value = null; };
        Vue.onMounted(() => window.addEventListener("scroll", closeMenu, true));
        Vue.onUnmounted(() => window.removeEventListener("scroll", closeMenu, true));

        const archive = async (row, restore) => {
            closeMenu();
            let reason = null;
            if (!restore) {
                reason = await Alerts.prompt({
                    title: "Archive " + row.name + "?",
                    text: "They come off the roster and cannot sign in. Their records stay for reports.",
                    inputLabel: "Why are they being archived?",
                    placeholder: "e.g. Graduated, resigned, transferred course",
                    confirmText: "Archive S.A.",
                    validate: v => !v || v.trim().length < 5 ? "Give a reason of at least 5 characters."
                             : (v.trim().length > 200 ? "Use 200 characters or fewer." : null)
                });
                if (reason === null) return;
            } else {
                const ok = await Alerts.confirm({
                    title: "Bring " + row.name + " back?",
                    text: "They return to the active roster as Active.",
                    icon: "question", confirmText: "Restore S.A."
                });
                if (!ok) return;
            }
            busy.value = true;
            const r = restore
                ? await Model.request("sa", "restore", { id: row.id })
                : await Model.request("sa", "archive", { id: row.id, reason: reason.trim() });
            busy.value = false;
            await Alerts.success(restore ? "S.A. Restored" : "S.A. Archived", restore ? row.name + " is back on the roster." : row.name + " was archived.");
            load();
        };

        return { items, loading, loadError, busy, q, status, category, categoryCounts, department, deployment, classFilter,
                 departments, page, pageCount, pageRows, rangeText, filtered, statusFilters, counts, tiles,
                 columns, sortKey, sortDir, sortBy, ariaSort, clearFilters, hasFilters, load, initials,
                 menuFor, toggleMenu, closeMenu, archive, label, isEnrollmentMode,
                 copiedSaNumber, copySaNumber };
    },

    template: `
    <page-header title="S.A. Management" subtitle="Manage Student Assistant records and assignment information.">
        <template #actions>
            <router-link to="/admin/sa-management/new" class="btn btn-primary">
                <app-icon name="UserPlus" :size="16" /> Register S.A.
            </router-link>
        </template>
    </page-header>

    <!-- ------------------------------------------------ the roster at a glance -->
    <div class="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <button v-for="t in tiles" :key="t.key" @click="status = t.key" :aria-pressed="status === t.key"
                class="card flex items-center gap-3 p-4 text-left transition-shadow duration-150 hover:shadow-md"
                :class="status === t.key ? 'ring-2 ring-navy' : ''">
            <span class="grid h-10 w-10 shrink-0 place-items-center rounded-lg" :class="t.tone">
                <app-icon :name="t.icon" :size="18" />
            </span>
            <span>
                <span class="block text-[22px] font-bold leading-none text-navy">{{ loading ? '—' : t.value }}</span>
                <span class="mt-1 block text-caption text-muted">{{ t.label }}</span>
            </span>
        </button>
    </div>

    <section class="card">
        <!-- ------------------------------------------------ filters -->
        <div class="border-b border-line p-4">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center">
                <div class="relative flex-1 lg:min-w-[240px]">
                    <app-icon name="Search" :size="16" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input v-model="q" type="search" class="input pl-9"
                           placeholder="Search by name, student ID, course, department or supervisor" aria-label="Search S.A.s">
                </div>
                <!-- Category Tabs (synced with Class Schedules: All, ACADS, ITO, Office) -->
                <div class="inline-flex shrink-0 rounded-lg border border-line bg-page p-1" role="tablist" aria-label="Filter by S.A. category">
                    <button v-for="c in [['ALL','All'],['ACADS','ACADS'],['ITO','ITO'],['OFFICE','Office']]" :key="c[0]"
                            type="button" role="tab" :aria-selected="category === c[0]" @click="category = c[0]"
                            class="rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors"
                            :class="category === c[0] ? 'bg-white text-navy shadow-xs font-bold' : 'text-muted hover:text-navy'">
                        {{ c[1] }} <span class="font-normal opacity-70">({{ categoryCounts[c[0]] }})</span>
                    </button>
                </div>
                <div class="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:shrink-0">
                    <select v-model="department" class="input" aria-label="Filter by department">
                        <option value="ALL">All departments</option>
                        <option v-for="d in departments" :key="d" :value="d">{{ d }}</option>
                    </select>
                    <select v-model="deployment" class="input" aria-label="Filter by deployment">
                        <option value="ALL">Any deployment</option>
                        <option value="YES">Deployed</option>
                        <option value="NO">Not deployed</option>
                    </select>
                    <select v-model="classFilter" class="input" aria-label="Filter by class schedule">
                        <option value="ALL">Any class schedule</option>
                        <option value="YES">On record</option>
                        <option value="NO">Missing</option>
                    </select>
                </div>
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-2">
                <button v-for="f in statusFilters" :key="f.value" @click="status = f.value" :aria-pressed="status === f.value"
                        class="inline-flex shrink-0 items-center gap-2 rounded-full border px-3 py-1 text-[12px] font-medium transition-colors duration-150"
                        :class="status === f.value ? 'border-navy bg-navy text-white' : 'border-line bg-white text-ink hover:border-navy/40'">
                    {{ f.label }}
                    <span class="rounded-full px-1.5 text-[11px] font-semibold"
                          :class="status === f.value ? 'bg-gold text-navy' : 'bg-page text-muted'">{{ counts[f.value] }}</span>
                </button>
                <button v-if="hasFilters" @click="clearFilters" class="btn btn-ghost btn-sm ml-auto">
                    <app-icon name="X" :size="14" /> Clear filters
                </button>
            </div>
        </div>

        <!-- Loading -->
        <div v-if="loading" class="space-y-3 p-4" aria-busy="true" aria-label="Loading S.A.s">
            <div v-for="n in 6" :key="n" class="h-12 animate-pulse rounded-md bg-page"></div>
        </div>

        <!-- Error -->
        <div v-else-if="loadError" class="flex flex-col items-center px-6 py-12 text-center">
            <app-icon name="CircleX" :size="28" class="text-danger" />
            <p class="mt-3 text-body font-medium text-ink">Couldn't load S.A. records</p>
            <p class="mt-1 text-caption text-muted">{{ loadError }}</p>
            <button @click="load" class="btn btn-secondary btn-sm mt-4"><app-icon name="RefreshCw" :size="14" /> Try again</button>
        </div>

        <!-- Empty: no S.A.s at all -->
        <div v-else-if="!items.length" class="flex flex-col items-center px-6 py-14 text-center">
            <span class="grid h-12 w-12 place-items-center rounded-full bg-mist text-navy"><app-icon name="Users" :size="22" /></span>
            <p class="mt-3 text-body font-medium text-ink">No Student Assistants yet</p>
            <p class="mt-1 text-caption text-muted">Register the first S.A. to start building the semester schedule.</p>
            <router-link to="/admin/sa-management/new" class="btn btn-primary btn-sm mt-4"><app-icon name="UserPlus" :size="14" /> Register S.A.</router-link>
        </div>

        <!-- Empty: filters match nothing -->
        <div v-else-if="!filtered.length" class="flex flex-col items-center px-6 py-14 text-center">
            <span class="grid h-12 w-12 place-items-center rounded-full bg-mist text-navy"><app-icon name="SearchX" :size="22" /></span>
            <p class="mt-3 text-body font-medium text-ink">No S.A.s match these filters</p>
            <button @click="clearFilters" class="btn btn-secondary btn-sm mt-4">Clear filters</button>
        </div>

        <!-- ------------------------------------------------ the roster -->
        <template v-else>
            <div class="max-h-[65vh] overflow-auto touch-scroll table-scroll">
                <table class="w-full min-w-[850px] text-left text-[13px]">
                    <thead class="sticky top-0 z-10 bg-page text-caption font-semibold text-muted">
                        <tr>
                            <th v-for="col in columns" :key="col.key" scope="col" class="border-b border-line px-3 py-3"
                                :aria-sort="col.sortable === false ? null : ariaSort(col.key)">
                                <button v-if="col.sortable !== false" @click="sortBy(col.key)"
                                        class="inline-flex items-center gap-1 rounded hover:text-ink">
                                    {{ col.label }}
                                    <app-icon :name="sortKey !== col.key ? 'ChevronsUpDown' : (sortDir === 'asc' ? 'ChevronUp' : 'ChevronDown')"
                                              :size="13" :class="sortKey === col.key ? 'text-navy' : 'text-disabled'" />
                                </button>
                                <span v-else>{{ col.label }}</span>
                            </th>
                            <th scope="col" class="border-b border-line px-3 py-3 text-right"><span class="sr-only">Actions</span></th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-line">
                        <tr v-for="s in pageRows" :key="s.id" class="transition-colors duration-150 hover:bg-mist/50"
                            :class="s.archivedAt ? 'bg-page/60' : ''">
                            <!-- S.A. Number -->
                            <td class="whitespace-nowrap px-3 py-2.5">
                                <div class="inline-flex items-center gap-1.5 rounded bg-slate-100/80 border border-slate-200 px-2 py-0.5 font-mono text-[11px] font-bold text-navy">
                                    <span>{{ s.saNumber || '—' }}</span>
                                    <button v-if="s.saNumber" type="button" @click.stop="copySaNumber(s.saNumber)"
                                            class="text-slate-400 hover:text-navy transition-colors"
                                            :title="'Copy S.A. Number: ' + s.saNumber">
                                        <app-icon :name="copiedSaNumber === s.saNumber ? 'Check' : 'Copy'" :size="12" />
                                    </button>
                                </div>
                            </td>
                            <!-- who -->
                            <td class="px-3 py-2.5">
                                <div class="flex items-center gap-3">
                                    <span class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-mist text-[12px] font-bold text-navy">
                                        {{ initials(s.name) }}
                                    </span>
                                    <span class="min-w-0">
                                        <router-link :to="'/admin/sa-management/' + s.id"
                                                     class="block truncate font-semibold text-ink hover:text-navy hover:underline">
                                            {{ s.name }}
                                        </router-link>
                                        <span class="block truncate text-[11px] text-muted">
                                            {{ s.studentId }} · {{ s.course }} {{ s.yearLevel }}
                                        </span>
                                    </span>
                                </div>
                            </td>
                            <!-- department -->
                            <td class="px-3 py-2.5">
                                <span class="inline-flex items-center rounded-full bg-mist px-2 py-0.5 text-[11px] font-semibold text-navy">
                                    {{ s.office ? s.office.name : label('departmentType', s.departmentType) }}
                                </span>
                                <span v-if="s.office" class="mt-0.5 block text-[11px] text-muted">{{ label('saCategory', s.saCategory) }}</span>
                            </td>
                            <!-- deployment -->
                            <td class="px-3 py-2.5">
                                <span v-if="s.deployed" class="text-ink">{{ s.deployment }}</span>
                                <span v-else class="text-muted">Not deployed</span>
                                <span v-if="s.deployed" class="mt-0.5 block text-[11px] text-muted">{{ s.dutyHours }} hrs a week</span>
                            </td>
                            <!-- supervisor -->
                            <td class="whitespace-nowrap px-3 py-2.5" :class="s.supervisor ? 'text-ink' : 'text-muted'">
                                {{ s.supervisor ? s.supervisor.name : 'None' }}
                            </td>
                            <!-- class schedule -->
                            <td class="px-3 py-2.5">
                                <router-link v-if="s.hasClassSchedule"
                                             :to="'/admin/scheduling/class-schedules?studentId=' + encodeURIComponent(s.studentId) + '&open=1'"
                                             class="group inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-success transition-all hover:bg-success/15 hover:text-emerald-800"
                                             :title="'Click to view visual class schedule for ' + s.name">
                                    <app-icon name="CircleCheck" :size="14" />
                                    <span class="font-medium underline decoration-success/40 group-hover:decoration-current">{{ s.classPeriods }} period(s)</span>
                                    <app-icon name="ExternalLink" :size="11" class="opacity-60 group-hover:opacity-100 transition-opacity" />
                                </router-link>
                                <router-link v-else
                                             :to="'/admin/scheduling/class-schedules?studentId=' + encodeURIComponent(s.studentId)"
                                             class="inline-flex items-center gap-1 rounded-md px-2 py-1 text-warning hover:bg-warning/10"
                                             :title="'No class schedule on record for ' + s.name + '. Click to check in Class Schedules.'">
                                    <app-icon name="TriangleAlert" :size="14" /> <span class="font-medium">Missing</span>
                                </router-link>
                            </td>
                            <!-- status -->
                            <td class="px-3 py-2.5">
                                <span v-if="s.archivedAt" class="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-700 border border-slate-200">
                                    <app-icon name="Archive" :size="12" /> Archived
                                </span>
                                <template v-else>
                                    <div v-if="isEnrollmentMode" class="mb-0.5">
                                        <status-badge group="saStatus" value="ACTIVE" />
                                    </div>
                                    <status-badge group="assignmentStatus" :value="s.assignmentStatus" />
                                    <div v-if="s.disciplinaryStatus && s.disciplinaryStatus !== 'GOOD_STANDING'" class="mt-0.5">
                                        <status-badge group="disciplinaryStatus" :value="s.disciplinaryStatus" />
                                    </div>
                                </template>
                            </td>
                            <!-- actions -->
                            <td class="whitespace-nowrap px-3 py-2 text-right">
                                <div class="inline-flex items-center gap-1">
                                    <router-link :to="'/admin/sa-management/' + s.id" class="btn btn-secondary btn-sm">
                                        <app-icon name="Eye" :size="14" /> View
                                    </router-link>
                                    <button @click="toggleMenu(s, $event)" :aria-expanded="menuFor && menuFor.id === s.id"
                                            class="grid h-8 w-8 place-items-center rounded-md text-muted transition-colors duration-150 hover:bg-mist hover:text-navy"
                                            :aria-label="'More actions for ' + s.name">
                                        <app-icon name="EllipsisVertical" :size="16" />
                                    </button>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- legend + pagination -->
            <div class="flex flex-col items-center justify-between gap-3 border-t border-line px-4 py-3 sm:flex-row">
                <p class="text-caption text-muted" aria-live="polite">{{ rangeText }}</p>
                <nav class="flex items-center gap-1" aria-label="Pages">
                    <button @click="page--" :disabled="page === 1" class="btn btn-secondary btn-sm" aria-label="Previous page">
                        <app-icon name="ChevronLeft" :size="14" />
                    </button>
                    <button v-for="n in pageCount" :key="n" @click="page = n" :aria-current="page === n ? 'page' : null"
                            class="h-8 min-w-8 rounded-md px-2 text-[13px] font-semibold"
                            :class="page === n ? 'bg-navy text-white' : 'text-ink hover:bg-page'">{{ n }}</button>
                    <button @click="page++" :disabled="page === pageCount" class="btn btn-secondary btn-sm" aria-label="Next page">
                        <app-icon name="ChevronRight" :size="14" />
                    </button>
                </nav>
            </div>
            <p class="border-t border-line px-4 py-2.5 text-[11px] text-muted">
                <b class="font-semibold text-ink">Deployment</b> is where the finalized schedule puts them this semester ·
                <b class="font-semibold text-ink">Class schedule</b> is what was uploaded for them ·
                an S.A. with no class schedule can still be matched, and their duty is marked provisional.
            </p>
        </template>
    </section>

    <!-- ------------------------------------------------ row menu -->
    <template v-if="menuFor">
        <div class="fixed inset-0 z-40" @click="closeMenu"></div>
        <div class="fixed z-50 w-[200px] overflow-hidden rounded-lg border border-line bg-white py-1 shadow-lg"
             :style="{ left: menuFor.x + 'px', top: menuFor.y + 'px' }" role="menu">
            <router-link :to="'/admin/sa-management/' + menuFor.id + '/edit'" @click="closeMenu" role="menuitem"
                         class="flex items-center gap-2 px-3 py-2 text-[13px] text-ink hover:bg-mist">
                <app-icon name="Pencil" :size="14" /> Edit details
            </router-link>
            <router-link :to="{ path: '/admin/sa-management/' + menuFor.id, query: { tab: 'WARNINGS' } }" @click="closeMenu" role="menuitem"
                         class="flex items-center gap-2 px-3 py-2 text-[13px] text-ink hover:bg-mist">
                <app-icon name="ShieldAlert" :size="14" /> Warnings &amp; Attendance
            </router-link>
            <router-link :to="{ path: '/admin/sa-management/' + menuFor.id + '/edit', hash: '#assignment' }" @click="closeMenu" role="menuitem"
                         class="flex items-center gap-2 px-3 py-2 text-[13px] text-ink hover:bg-mist">
                <app-icon name="Building2" :size="14" /> Department &amp; deployment
            </router-link>
            <router-link :to="'/admin/scheduling/class-schedules?studentId=' + encodeURIComponent(menuFor.row.studentId) + '&open=1'"
                         @click="closeMenu" role="menuitem"
                         class="flex items-center gap-2 px-3 py-2 text-[13px] text-ink hover:bg-mist">
                <app-icon name="CalendarDays" :size="14" /> Class schedule
            </router-link>
            <div class="my-1 border-t border-line"></div>
            <button v-if="!menuFor.row.archivedAt" @click="archive(menuFor.row, false)" :disabled="busy" role="menuitem"
                    class="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-danger hover:bg-danger/5">
                <app-icon name="Archive" :size="14" /> Archive S.A.
            </button>
            <button v-else @click="archive(menuFor.row, true)" :disabled="busy" role="menuitem"
                    class="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-success hover:bg-success/5">
                <app-icon name="ArchiveRestore" :size="14" /> Restore S.A.
            </button>
        </div>
    </template>
    `
};
