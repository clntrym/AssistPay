// Scheduling > Room/Lab Schedules.
// The imported room schedule, displayed as a clear table with View/Edit controls,
// or as the full weekly duty timetable matrix.
const RoomLabPage = {
    components: { AppIcon, PageHeader, AppModal, RoomsPanel },

    setup() {
        const items = Vue.ref([]);
        const semester = Vue.ref(null);
        const loading = Vue.ref(true);
        const loadError = Vue.ref("");

        const dept = Vue.ref("ALL");
        const q = Vue.ref("");
        const viewMode = Vue.ref("table");   // 'table' (default) or 'calendar'
        const detail = Vue.ref(null);        // one post's full schedule details
        const editingPost = Vue.ref(null);   // post currently being edited
        const editForm = Vue.reactive({ departmentType: "ITO", requiredSa: 2, roomType: "LABORATORY" });
        const savingEdit = Vue.ref(false);

        // DataTable pagination & sorting state
        const page = Vue.ref(1);
        const pageSize = Vue.ref(10);
        const sortKey = Vue.ref("room");
        const sortDir = Vue.ref("asc");

        const DAY_ORDER = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
        const dayNames = { MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday", SUN: "Sunday" };
        const typeLabels = { COMPUTER_LAB: "Lab", LABORATORY: "Lab", LECTURE: "Lecture", OTHER: "Room" };

        // One colour per department, used by the card, the badge and the legend
        const departments = {
            ITO: { label: "ITO", chip: "bg-info/10 text-info", dot: "bg-info",
                   card: "border-info/25 bg-info/[0.04]", period: "border-info/20 bg-info/[0.06]" },
            ACADS: { label: "ACADS", chip: "bg-success/10 text-success", dot: "bg-success",
                     card: "border-success/25 bg-success/[0.04]", period: "border-success/20 bg-success/[0.06]" }
        };

        const load = async () => {
            loading.value = true;
            loadError.value = "";
            const r = await Model.request("scheduling", "room_list");
            loading.value = false;
            if (!r.success) { loadError.value = r.message; return; }
            items.value = r.items;
            semester.value = r.semester;
        };
        Vue.onMounted(load);

        const filtered = Vue.computed(() => {
            const term = q.value.trim().toLowerCase();
            return items.value.filter(r => (dept.value === "ALL" || r.departmentType === dept.value)
                && (!term || [r.room, r.building, r.className, r.roomType].some(v => v && v.toLowerCase().includes(term))));
        });

        // Rows of the week grid: a duty post and its periods, day by day
        const posts = Vue.computed(() => {
            const map = new Map();
            for (const r of filtered.value) {
                const key = r.departmentType + "|" + r.room;
                if (!map.has(key)) {
                    map.set(key, { key, departmentType: r.departmentType, room: r.room, roomCount: r.roomCount || 1,
                                   building: r.building, roomType: r.roomType, requiredSa: 0,
                                   periods: [], byDay: {}, hours: 0 });
                }
                const post = map.get(key);
                post.requiredSa = Math.max(post.requiredSa, r.requiredSa);
                post.hours += r.hours;
                post.periods.push(r);
                (post.byDay[r.day] ||= []).push(r);
            }
            return [...map.values()].map(post => ({ ...post, hours: Math.round(post.hours * 10) / 10 }));
        });

        // DataTable Sorting
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

        const sortedPosts = Vue.computed(() => {
            const list = [...posts.value];
            const key = sortKey.value;
            const dir = sortDir.value === "asc" ? 1 : -1;

            list.sort((a, b) => {
                let res = 0;
                if (key === "room") {
                    res = (a.room || "").localeCompare(b.room || "", undefined, { numeric: true, sensitivity: "base" });
                } else if (key === "building") {
                    res = (a.building || "").localeCompare(b.building || "");
                } else if (key === "departmentType") {
                    res = (a.departmentType || "").localeCompare(b.departmentType || "");
                } else if (key === "requiredSa") {
                    res = (Number(a.requiredSa) || 0) - (Number(b.requiredSa) || 0);
                } else if (key === "hours") {
                    res = (Number(a.hours) || 0) - (Number(b.hours) || 0);
                } else if (key === "periods") {
                    res = (a.periods?.length || 0) - (b.periods?.length || 0);
                }
                return res * dir;
            });
            return list;
        });

        // DataTable Pagination
        const pageCount = Vue.computed(() => {
            if (pageSize.value <= 0) return 1;
            return Math.max(1, Math.ceil(sortedPosts.value.length / pageSize.value));
        });

        const pagedPosts = Vue.computed(() => {
            if (pageSize.value <= 0) return sortedPosts.value;
            const start = (page.value - 1) * pageSize.value;
            return sortedPosts.value.slice(start, start + pageSize.value);
        });

        const rangeText = Vue.computed(() => {
            const total = sortedPosts.value.length;
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

        Vue.watch([q, dept, pageSize], () => {
            page.value = 1;
        });
        Vue.watch(pageCount, n => {
            if (page.value > n) page.value = n;
        });

        // Only the days that are actually used, so a Mon–Fri week stays Mon–Fri
        const days = Vue.computed(() => {
            const used = new Set(filtered.value.map(r => r.day));
            const shown = DAY_ORDER.filter(d => used.has(d));
            return shown.length ? shown : ["MON", "TUE", "WED", "THU", "FRI"];
        });

        const counts = Vue.computed(() => {
            const postSet = list => new Set(list.map(r => r.departmentType + "|" + r.room)).size;
            return {
                ALL: postSet(items.value),
                ITO: postSet(items.value.filter(r => r.departmentType === "ITO")),
                ACADS: postSet(items.value.filter(r => r.departmentType === "ACADS"))
            };
        });

        const roomsRef = Vue.ref(null);
        const isDragging = Vue.ref(false);

        const pickFile = () => roomsRef.value?.pickFile();
        const openSetup = () => roomsRef.value?.openSetup();

        const onDragOver = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
            isDragging.value = true;
        };

        const onDragLeave = (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.currentTarget && e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
            isDragging.value = false;
        };

        const onDrop = (e) => {
            e.preventDefault();
            e.stopPropagation();
            isDragging.value = false;
            const file = e.dataTransfer?.files?.[0];
            if (file && roomsRef.value) {
                roomsRef.value.handleFile(file);
            }
        };

        const openEdit = (post) => {
            editingPost.value = post;
            editForm.departmentType = post.departmentType || "ITO";
            editForm.requiredSa = post.requiredSa || 2;
            editForm.roomType = post.roomType || "LABORATORY";
        };

        const saveEdit = async () => {
            if (!editingPost.value) return;
            savingEdit.value = true;
            const r = await Model.request("scheduling", "room_requirement_update", {
                semesterId: semester.value?.id,
                room: editingPost.value.room,
                departmentType: editForm.departmentType,
                requiredSa: Number(editForm.requiredSa),
                roomType: editForm.roomType
            });
            savingEdit.value = false;
            if (!r.success) {
                Alerts.error("Couldn't update room", r.message);
                return;
            }
            await Alerts.success("Room Updated", `Room ${editingPost.value.room} updated successfully.`);
            editingPost.value = null;
            load();
        };

        const openRoomGrid = (post) => {
            if (!post) return;
            const allRooms = roomsRef.value?.rooms || [];
            let r = allRooms.find(rm => rm.code?.toUpperCase() === post.room?.toUpperCase());
            if (!r && post.roomId) {
                r = allRooms.find(rm => rm.id === post.roomId);
            }
            if (!r) {
                r = {
                    id: post.roomId || post.id,
                    code: post.room,
                    building: post.building || '',
                    description: post.className || '',
                    roomType: post.roomType || 'LABORATORY'
                };
            }
            roomsRef.value?.openGridEditor(r);
        };

        return {
            items, semester, loading, loadError, load, dept, q, viewMode, filtered, posts, days, counts,
            page, pageSize, sortKey, sortDir, sortedPosts, pagedPosts, pageCount, rangeText, visiblePages, sortBy, getSortIcon,
            DAY_ORDER, dayNames, typeLabels, departments, detail, editingPost, editForm, savingEdit,
            roomsRef, isDragging, onDragOver, onDragLeave, onDrop, pickFile, openSetup, openEdit, saveEdit, openRoomGrid
        };
    },

    template: `
    <div @dragover="onDragOver" @dragenter="onDragOver" @dragleave="onDragLeave" @drop="onDrop" class="relative">
    <!-- Full-screen drag overlay when dragging a file over an existing schedule -->
    <div v-if="isDragging && items.length"
         class="fixed inset-0 z-50 flex items-center justify-center bg-navy/70 p-6 text-center text-white backdrop-blur-sm transition-all duration-200">
        <div class="card flex flex-col items-center p-10 text-center border-2 border-dashed border-white bg-white text-ink shadow-2xl">
            <span class="grid h-20 w-20 place-items-center rounded-full bg-navy text-white shadow-lg">
                <app-icon name="UploadCloud" :size="40" />
            </span>
            <h3 class="mt-4 text-xl font-bold text-navy">Drop room assignment file (.xlsx / .xlsm) here</h3>
            <p class="mt-1 text-body text-muted">Import or update the room assignment schedule</p>
        </div>
    </div>

    <page-header title="Room Schedule" section="Scheduling"
                 :subtitle="semester ? 'The imported room schedule and the S.A. required per room, ' + semester.label + '.' : ''">
        <template #actions>
            <button @click="pickFile" class="btn btn-secondary" :disabled="loading || !!loadError">
                <app-icon name="Upload" :size="16" /> Upload room assignment
            </button>
            <button @click="openSetup" class="btn btn-primary" :disabled="loading || !!loadError">
                <app-icon name="Settings2" :size="16" /> Setup
            </button>
        </template>
    </page-header>

    <div v-if="loading" class="space-y-4" aria-busy="true">
        <div class="h-14 animate-pulse rounded-xl bg-white"></div>
        <div class="h-96 animate-pulse rounded-xl bg-white"></div>
    </div>

    <div v-else-if="loadError" class="card flex flex-col items-center px-6 py-12 text-center">
        <app-icon name="CircleX" :size="28" class="text-danger" />
        <p class="mt-3 text-body font-medium text-ink">Couldn't load the room schedule</p>
        <p class="mt-1 text-caption text-muted">{{ loadError }}</p>
        <button @click="load" class="btn btn-secondary btn-sm mt-4"><app-icon name="RefreshCw" :size="14" /> Try again</button>
    </div>

    <template v-else>
        <!-- Upload, import preview and Room Setup all live here -->
        <rooms-panel ref="roomsRef" :semester-id="semester ? semester.id : 0" @generated="load" />

        <!-- Filter bar with department tabs, search, and view switcher -->
        <div class="card mb-4 flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
            <div class="flex flex-wrap gap-1.5" role="group" aria-label="Filter by department">
                <button v-for="tab in [['ALL', 'All departments'], ['ITO', 'ITO'], ['ACADS', 'ACADS']]"
                        :key="tab[0]" @click="dept = tab[0]"
                        class="rounded-full px-3.5 py-1.5 text-[13px] font-semibold transition-colors duration-150"
                        :class="dept === tab[0] ? 'bg-navy text-white' : 'bg-page text-muted hover:bg-mist hover:text-navy'">
                    {{ tab[1] }}
                    <span class="ml-1 opacity-70">{{ counts[tab[0]] }}</span>
                </button>
            </div>

            <!-- View Switcher Toggle -->
            <div class="flex items-center gap-1 rounded-lg border border-line bg-page p-1 sm:ml-4">
                <button @click="viewMode = 'table'"
                        class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors duration-150"
                        :class="viewMode === 'table' ? 'bg-white text-navy shadow-sm' : 'text-muted hover:text-ink'">
                    <app-icon name="Table" :size="14" /> Table View
                </button>
                <button @click="viewMode = 'calendar'"
                        class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold transition-colors duration-150"
                        :class="viewMode === 'calendar' ? 'bg-white text-navy shadow-sm' : 'text-muted hover:text-ink'">
                    <app-icon name="Calendar" :size="14" /> Weekly Grid
                </button>
            </div>

            <div class="relative sm:ml-auto sm:w-72">
                <app-icon name="Search" :size="16" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                <input v-model="q" type="search" class="input pl-9" placeholder="Search room or building" aria-label="Search the room schedule">
            </div>
        </div>

        <div v-if="!items.length" @click="pickFile"
             class="card flex flex-col items-center justify-center px-6 py-16 text-center cursor-pointer border-2 border-dashed transition-all duration-200"
             :class="isDragging ? 'border-navy bg-navy/5 scale-[1.01] shadow-xl ring-4 ring-navy/10' : 'border-line hover:border-navy/50 hover:bg-mist/30'">
            <span class="grid h-16 w-16 place-items-center rounded-full transition-transform duration-200"
                  :class="isDragging ? 'bg-navy text-white scale-110' : 'bg-mist text-navy'">
                <app-icon :name="isDragging ? 'Download' : 'UploadCloud'" :size="32" />
            </span>
            <h3 class="mt-4 text-[18px] font-bold text-navy">
                {{ isDragging ? 'Drop your Excel room assignment file (.xlsx / .xlsm) here' : 'Drag & drop room assignment workbook (.xlsx / .xlsm) here' }}
            </h3>
            <p class="mt-1.5 max-w-md text-caption text-muted">
                Upload the room assignment Excel file (<code class="rounded bg-gray-100 px-1.5 py-0.5 font-semibold text-navy">.xlsx / .xlsm</code>), then open <b class="font-semibold text-ink">Setup</b> to choose which rooms need an S.A.
            </p>
            <div class="mt-5 flex items-center gap-3">
                <button type="button" class="btn btn-primary btn-sm shadow-sm pointer-events-none">
                    <app-icon name="FolderOpen" :size="15" /> Choose .xlsx File
                </button>
                <span class="text-caption text-muted">or drop file anywhere in this box</span>
            </div>
        </div>

        <div v-else-if="!posts.length" class="card flex flex-col items-center px-6 py-16 text-center">
            <span class="grid h-12 w-12 place-items-center rounded-full bg-mist text-navy"><app-icon name="SearchX" :size="22" /></span>
            <p class="mt-3 text-body font-medium text-ink">No room matches this search</p>
        </div>

        <!-- 1. TABLE VIEW (Default DataTable) -->
        <section v-else-if="viewMode === 'table'" class="card overflow-hidden">
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
                <div class="flex items-center gap-3">
                    <span class="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1 text-[12px] font-medium text-muted shadow-2xs">
                        <span class="h-2 w-2 rounded-full bg-navy"></span>
                        <b class="text-ink">{{ sortedPosts.length }}</b> total rooms found
                    </span>
                    <button @click="openSetup" class="btn btn-ghost btn-sm text-[12px]">
                        <app-icon name="SlidersHorizontal" :size="14" /> Setup
                    </button>
                </div>
            </div>

            <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="border-b border-line bg-mist/60 text-[12px] font-semibold uppercase tracking-wider text-muted select-none">
                            <th class="px-5 py-3.5">
                                <button type="button" @click="sortBy('room')" class="inline-flex items-center gap-1.5 text-left hover:text-navy transition-colors font-semibold uppercase tracking-wider">
                                    Room / Lab
                                    <app-icon :name="getSortIcon('room')" :size="13" :class="sortKey === 'room' ? 'text-navy font-bold' : 'text-disabled'" />
                                </button>
                            </th>
                            <th class="px-5 py-3.5">
                                <button type="button" @click="sortBy('building')" class="inline-flex items-center gap-1.5 text-left hover:text-navy transition-colors font-semibold uppercase tracking-wider">
                                    Building
                                    <app-icon :name="getSortIcon('building')" :size="13" :class="sortKey === 'building' ? 'text-navy font-bold' : 'text-disabled'" />
                                </button>
                            </th>
                            <th class="px-5 py-3.5">
                                <button type="button" @click="sortBy('departmentType')" class="inline-flex items-center gap-1.5 text-left hover:text-navy transition-colors font-semibold uppercase tracking-wider">
                                    Department
                                    <app-icon :name="getSortIcon('departmentType')" :size="13" :class="sortKey === 'departmentType' ? 'text-navy font-bold' : 'text-disabled'" />
                                </button>
                            </th>
                            <th class="px-5 py-3.5 text-center">
                                <button type="button" @click="sortBy('requiredSa')" class="inline-flex items-center justify-center gap-1.5 hover:text-navy transition-colors font-semibold uppercase tracking-wider">
                                    Required S.A.
                                    <app-icon :name="getSortIcon('requiredSa')" :size="13" :class="sortKey === 'requiredSa' ? 'text-navy font-bold' : 'text-disabled'" />
                                </button>
                            </th>
                            <th class="px-5 py-3.5">
                                <button type="button" @click="sortBy('hours')" class="inline-flex items-center gap-1.5 text-left hover:text-navy transition-colors font-semibold uppercase tracking-wider">
                                    Schedule & Hours
                                    <app-icon :name="getSortIcon('hours')" :size="13" :class="sortKey === 'hours' ? 'text-navy font-bold' : 'text-disabled'" />
                                </button>
                            </th>
                            <th class="px-5 py-3.5">Active Days</th>
                            <th class="px-5 py-3.5 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-line text-[14px]">
                        <tr v-for="post in pagedPosts" :key="post.key" class="transition-colors hover:bg-mist/30">
                            <!-- Room / Lab -->
                            <td class="px-5 py-3.5 whitespace-nowrap">
                                <div class="flex items-center gap-2">
                                    <button type="button" @click="openRoomGrid(post)"
                                            class="rounded-md bg-navy px-2.5 py-1 text-[13px] font-bold text-white shadow-2xs hover:bg-navy-700 transition-colors"
                                            title="Click to view weekly timetable grid">
                                        {{ post.room }}
                                    </button>
                                    <span class="rounded bg-mist px-2 py-0.5 text-[11px] font-medium uppercase text-muted">
                                        {{ typeLabels[post.roomType] || 'Room' }}
                                    </span>
                                </div>
                            </td>

                            <!-- Building -->
                            <td class="px-5 py-3.5 text-ink">
                                <div class="flex items-center gap-1.5 text-[13px]">
                                    <app-icon name="Building2" :size="14" class="text-muted shrink-0" />
                                    <span class="font-medium">{{ post.building || '—' }}</span>
                                </div>
                            </td>

                            <!-- Department -->
                            <td class="px-5 py-3.5 whitespace-nowrap">
                                <span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold"
                                      :class="departments[post.departmentType]?.chip">
                                    <span class="h-2 w-2 rounded-full" :class="departments[post.departmentType]?.dot"></span>
                                    {{ departments[post.departmentType]?.label || post.departmentType }}
                                </span>
                            </td>

                            <!-- Required S.A. -->
                            <td class="px-5 py-3.5 whitespace-nowrap text-center">
                                <span class="inline-flex items-center gap-1.5 rounded-lg border border-line bg-page px-3 py-1 text-[13px] font-bold text-ink">
                                    <app-icon name="UserCheck" :size="14" class="text-muted" />
                                    {{ post.requiredSa }} S.A.
                                </span>
                            </td>

                            <!-- Schedule Details -->
                            <td class="px-5 py-3.5 whitespace-nowrap text-[13px] text-muted">
                                <span class="font-medium text-ink">{{ post.periods.length }} duty period(s)</span>
                                <span class="mx-1.5 text-disabled">·</span>
                                <span>{{ post.hours }} hrs/week</span>
                            </td>

                            <!-- Active Days -->
                            <td class="px-5 py-3.5">
                                <div class="flex flex-wrap gap-1 max-w-[140px]">
                                    <span v-for="d in DAY_ORDER.filter(day => post.byDay[day]?.length)" :key="d"
                                          class="rounded bg-slate-700 px-2 py-0.5 text-[11px] font-semibold text-white shadow-2xs">
                                        {{ d }}
                                    </span>
                                </div>
                            </td>

                            <!-- Actions: View & Edit -->
                            <td class="px-5 py-3.5 whitespace-nowrap text-right">
                                <div class="inline-flex items-center justify-end gap-2">
                                    <button @click="openRoomGrid(post)" class="btn btn-secondary btn-sm" title="View Schedule Timetable Grid">
                                        <app-icon name="LayoutGrid" :size="14" /> View
                                    </button>
                                    <button @click="openEdit(post)" class="btn btn-primary btn-sm" title="Edit Room Setup">
                                        <app-icon name="Pencil" :size="14" /> Edit
                                    </button>
                                </div>
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
                        <span v-if="p === '...'" class="px-2 text-caption text-muted select-none">…</span>
                        <button v-else type="button" @click="page = p"
                                :aria-current="page === p ? 'page' : null"
                                class="h-8 min-w-8 rounded-md px-2 text-[12px] font-semibold transition-colors"
                                :class="page === p ? 'bg-navy text-white shadow-2xs' : 'border border-line bg-white text-ink hover:bg-page'">
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
        </section>

        <!-- 2. WEEKLY CALENDAR GRID VIEW -->
        <section v-else class="card overflow-hidden">
            <div class="overflow-x-auto">
                <table class="w-full border-separate border-spacing-0 text-left align-top">
                    <thead>
                        <tr>
                            <th class="sticky left-0 z-20 w-[230px] min-w-[230px] bg-white px-4 py-3 text-caption font-semibold text-muted">
                                Room
                            </th>
                            <th v-for="day in days" :key="day"
                                class="min-w-[200px] border-l border-line bg-mist/60 px-3 py-3 text-center text-[13px] font-semibold text-navy">
                                {{ dayNames[day] }}
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr v-for="post in posts" :key="post.key" class="align-top">
                            <!-- duty post column -->
                            <td class="sticky left-0 z-10 border-t border-line bg-white p-3">
                                <div class="cursor-pointer rounded-lg border p-3 transition-shadow duration-150 hover:shadow-card"
                                     :class="departments[post.departmentType].card"
                                     role="button" tabindex="0" @click="detail = post" @keydown.enter="detail = post"
                                     :aria-label="'See the full week for ' + post.room">
                                    <div class="flex flex-wrap items-center gap-1.5">
                                        <span class="rounded-md bg-navy px-2 py-0.5 text-[13px] font-bold text-white">{{ post.room }}</span>
                                        <span class="rounded bg-white px-1.5 py-0.5 text-[11px] font-semibold uppercase text-muted">
                                            {{ typeLabels[post.roomType] || 'Room' }}
                                        </span>
                                    </div>
                                    <p v-if="post.building" class="mt-2 flex items-center gap-1.5 text-caption text-muted">
                                        <app-icon name="Building2" :size="13" /> {{ post.building }}
                                    </p>
                                    <p class="mt-1.5">
                                        <span class="rounded px-1.5 py-0.5 text-[11px] font-semibold" :class="departments[post.departmentType].chip">
                                            {{ departments[post.departmentType].label }}
                                        </span>
                                    </p>
                                    <p class="mt-2 flex items-center gap-1.5 text-caption text-ink">
                                        <app-icon name="UserCheck" :size="13" class="text-muted" />
                                        Required S.A.: <b class="font-semibold">{{ post.requiredSa }}</b>
                                    </p>
                                    <div class="mt-3 flex items-center gap-2">
                                        <button @click.stop="openRoomGrid(post)" class="btn btn-secondary btn-sm !px-2 !py-1 text-[11px]" title="View Schedule Timetable Grid">
                                            <app-icon name="LayoutGrid" :size="12" /> View
                                        </button>
                                        <button @click.stop="openEdit(post)" class="btn btn-primary btn-sm !px-2 !py-1 text-[11px]">
                                            <app-icon name="Pencil" :size="12" /> Edit
                                        </button>
                                    </div>
                                </div>
                            </td>

                            <!-- one day of that post -->
                            <td v-for="day in days" :key="day" class="border-l border-t border-line p-2">
                                <div v-if="post.byDay[day]" class="space-y-2">
                                    <div v-for="p in post.byDay[day]" :key="p.id"
                                         class="rounded-lg border px-2.5 py-2" :class="departments[post.departmentType].period">
                                        <p class="flex items-center gap-1.5 text-caption font-semibold text-ink">
                                            <app-icon name="Clock" :size="12" class="text-muted" />
                                            {{ p.startLabel }} – {{ p.endLabel }}
                                        </p>
                                        <p class="mt-0.5 truncate text-caption text-muted" :title="p.className || ''">
                                            {{ p.className || 'No class listed' }}
                                        </p>
                                        <p class="mt-1 inline-flex items-center gap-1 rounded bg-white/80 px-1.5 py-0.5 text-[11px] font-semibold"
                                           :class="p.assignedSa >= p.requiredSa ? 'text-success' : 'text-muted'">
                                            {{ p.requiredSa }} S.A.
                                            <span v-if="p.assignedSa">· {{ p.assignedSa }} assigned</span>
                                        </p>
                                    </div>
                                </div>
                                <p v-else class="px-1 py-3 text-center text-caption text-disabled">—</p>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <div class="flex flex-col gap-3 border-t border-line px-4 py-3 sm:flex-row sm:items-center">
                <ul class="flex flex-wrap items-center gap-4">
                    <li v-for="(style, code) in departments" :key="code" class="flex items-center gap-1.5 text-caption text-muted">
                        <span class="h-2.5 w-2.5 rounded-full" :class="style.dot"></span> {{ style.label }}
                    </li>
                </ul>
                <p class="flex items-start gap-2 text-caption text-muted sm:ml-auto">
                    <app-icon name="Info" :size="14" class="mt-0.5 shrink-0 text-info" />
                    Built from the imported room schedule and the Room Setup settings.
                </p>
            </div>
        </section>
    </template>

    <!-- VIEW MODAL: One room's full week duty periods -->
    <app-modal :open="!!detail" size="lg" icon="CalendarDays" :title="'Room ' + (detail ? detail.room : '') + ' Schedule'" @close="detail = null"
               :description="detail ? detail.departmentType + ' · ' + detail.periods.length + ' duty period(s), ' + detail.hours + ' hrs a week · ' + detail.requiredSa + ' S.A. Required' : ''">
        <div v-if="detail">
            <div class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-page p-3">
                <div class="flex items-center gap-2">
                    <span class="rounded-md bg-navy px-2.5 py-1 text-[13px] font-bold text-white">{{ detail.room }}</span>
                    <span class="text-[13px] font-medium text-ink">{{ detail.building || 'No building' }}</span>
                </div>
                <div class="flex items-center gap-2">
                    <span class="rounded-full px-2.5 py-0.5 text-[12px] font-semibold" :class="departments[detail.departmentType].chip">
                        {{ departments[detail.departmentType].label }}
                    </span>
                    <span class="rounded-md border border-line bg-white px-2 py-0.5 text-[12px] font-bold text-ink">
                        {{ detail.requiredSa }} S.A.
                    </span>
                </div>
            </div>

            <div class="overflow-x-auto">
                <table class="w-full text-left text-body">
                    <thead class="text-caption font-semibold text-muted border-b border-line">
                        <tr>
                            <th class="pb-2.5">Day</th>
                            <th class="pb-2.5">Period</th>
                            <th class="pb-2.5">Class / Subject</th>
                            <th class="pb-2.5 text-center">Required S.A.</th>
                            <th class="pb-2.5 text-center">Assigned S.A.</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-line text-[13px]">
                        <tr v-for="p in detail.periods" :key="p.id">
                            <td class="whitespace-nowrap py-2.5 font-semibold text-navy">{{ dayNames[p.day] }}</td>
                            <td class="whitespace-nowrap py-2.5 text-ink">
                                {{ p.startLabel }} – {{ p.endLabel }}
                                <span class="text-caption text-muted">({{ p.hours }} hrs)</span>
                            </td>
                            <td class="py-2.5 text-muted font-medium">{{ p.className || '—' }}</td>
                            <td class="py-2.5 text-center font-bold text-ink">{{ p.requiredSa }}</td>
                            <td class="py-2.5 text-center" :class="p.assignedSa >= p.requiredSa ? 'text-success font-semibold' : 'text-muted'">{{ p.assignedSa }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <p v-if="detail.roomCount > 1" class="mt-4 flex items-start gap-2 text-caption text-muted">
                <app-icon name="Info" :size="14" class="mt-0.5 shrink-0 text-info" />
                One S.A. covers all {{ detail.roomCount }} rooms in this post, so their schedules are merged into these periods.
            </p>
        </div>

        <template #footer>
            <div class="flex items-center justify-between w-full">
                <button v-if="detail" @click="openEdit(detail); detail = null" class="btn btn-secondary">
                    <app-icon name="Pencil" :size="14" /> Edit Room Setup
                </button>
                <button @click="detail = null" class="btn btn-primary sm:ml-auto">Close</button>
            </div>
        </template>
    </app-modal>

    <!-- EDIT MODAL: Edit room department and required S.A. count -->
    <app-modal :open="!!editingPost" size="md" icon="Pencil" :title="'Edit Room: ' + (editingPost ? editingPost.room : '')"
               description="Update the department assignment and required S.A. count for this room."
               @close="editingPost = null">
        <div v-if="editingPost" class="space-y-5">
            <!-- Room info summary -->
            <div class="flex items-center justify-between rounded-lg border border-line bg-page p-3">
                <div>
                    <span class="rounded bg-navy px-2 py-0.5 text-[13px] font-bold text-white">{{ editingPost.room }}</span>
                    <span class="ml-2 text-[13px] text-muted">{{ editingPost.building || '' }}</span>
                </div>
                <span class="text-caption text-muted">{{ editingPost.periods.length }} period(s)</span>
            </div>

            <!-- Department Selection -->
            <div>
                <label class="field-label">Department</label>
                <div class="grid grid-cols-2 gap-3">
                    <label class="flex items-center gap-2.5 rounded-lg border p-3 cursor-pointer transition-colors"
                           :class="editForm.departmentType === 'ITO' ? 'border-info bg-info/5 ring-1 ring-info' : 'border-line hover:bg-page'">
                        <input type="radio" v-model="editForm.departmentType" value="ITO" class="accent-navy">
                        <div>
                            <p class="text-[13px] font-bold text-ink">ITO</p>
                            <p class="text-[11px] text-muted">IT Operations & Labs</p>
                        </div>
                    </label>
                    <label class="flex items-center gap-2.5 rounded-lg border p-3 cursor-pointer transition-colors"
                           :class="editForm.departmentType === 'ACADS' ? 'border-success bg-success/5 ring-1 ring-success' : 'border-line hover:bg-page'">
                        <input type="radio" v-model="editForm.departmentType" value="ACADS" class="accent-navy">
                        <div>
                            <p class="text-[13px] font-bold text-ink">ACADS</p>
                            <p class="text-[11px] text-muted">Academic Labs & Rooms</p>
                        </div>
                    </label>
                </div>
            </div>

            <!-- Required S.A. Count Selection -->
            <div>
                <label class="field-label">Required S.A. Count</label>
                <div class="flex items-center gap-2">
                    <button type="button" v-for="num in [1, 2, 3]" :key="num"
                            @click="editForm.requiredSa = num"
                            class="flex-1 rounded-lg border py-2.5 text-[14px] font-bold transition-colors"
                            :class="editForm.requiredSa === num ? 'border-navy bg-navy text-white shadow-sm' : 'border-line bg-white text-ink hover:bg-page'">
                        {{ num }} S.A.
                    </button>
                    <input type="number" min="1" max="20" v-model.number="editForm.requiredSa"
                           class="input w-24 text-center font-bold" placeholder="Other">
                </div>
                <p class="mt-1.5 text-caption text-muted">
                    Total number of Student Assistants required to supervise this room simultaneously.
                </p>
            </div>

            <!-- Room Type -->
            <div>
                <label class="field-label">Room Classification</label>
                <select v-model="editForm.roomType" class="input">
                    <option value="COMPUTER_LAB">Computer Laboratory</option>
                    <option value="LABORATORY">General Laboratory</option>
                    <option value="LECTURE">Lecture Room</option>
                    <option value="OTHER">Other Room</option>
                </select>
            </div>

            <div class="pt-3 border-t border-line">
                <button type="button" @click="openRoomGrid(editingPost); editingPost = null"
                        class="btn btn-secondary w-full flex items-center justify-center gap-2">
                    <app-icon name="LayoutGrid" :size="15" /> Open Visual Grid Schedule Timetable
                </button>
            </div>
        </div>

        <template #footer>
            <button @click="editingPost = null" class="btn btn-secondary" :disabled="savingEdit">Cancel</button>
            <button @click="saveEdit" class="btn btn-primary" :disabled="savingEdit">
                <app-icon v-if="savingEdit" name="Loader2" :size="16" class="animate-spin" />
                {{ savingEdit ? 'Saving...' : 'Save Changes' }}
            </button>
        </template>
    </app-modal>
    </div>
    `
};
