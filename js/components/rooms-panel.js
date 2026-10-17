// The room master list behind Room/Lab Schedules: importing the NCST room
// assignment workbook, and Room Setup.
//
// The workbook says WHEN EACH ROOM IS IN USE and holds far more rooms than need
// an S.A., so Room Setup is where the Coordinator says which rooms count, for
// which department, and how many S.A.s each one needs. Scheduling reads only
// those. The component renders no section of its own — the page calls
// pickFile() and openSetup() through a template ref and draws the schedule.
const RoomsPanel = {
    components: { AppIcon, AppModal, FormField },
    props: { semesterId: Number },
    emits: ["generated"],

    setup(props, { emit }) {
        const rooms = Vue.ref([]);
        const busy = Vue.ref(false);

        const fileInput = Vue.ref(null);
        const preview = Vue.ref(null);      // { rooms, periods, warnings, fileName }
        const setup = Vue.ref(null);        // { department, search, applyValue, rooms: { id: {...} } }

        const load = async () => {
            const r = await Model.request("scheduling", "rooms_overview");
            if (!r.success) { Store.toast("danger", r.message, 6000); return; }
            rooms.value = r.rooms;
        };
        Vue.onMounted(load);

        const configured = Vue.computed(() => rooms.value.filter(r => r.departmentType));

        // ---------- .xlsx import ----------
        const pickFile = () => fileInput.value?.click();
        const handleFile = async file => {
            if (!file) return;
            if (!/\.(xlsx|xlsm)$/i.test(file.name)) {
                Alerts.error("That file can't be read", "Choose an .xlsx or .xlsm room assignment file. Older .xls files must be saved as .xlsx or .xlsm first.");
                if (fileInput.value) fileInput.value.value = "";
                return;
            }
            busy.value = true;
            try {
                const parsed = await XlsxRooms.parse(file);
                preview.value = { ...parsed, fileName: file.name };
            } catch (e) {
                Alerts.error("That file can't be read", e.message || "The workbook could not be opened.");
            } finally {
                busy.value = false;
                if (fileInput.value) fileInput.value.value = "";
            }
        };

        const previewByBuilding = Vue.computed(() => {
            if (!preview.value) return [];
            const map = {};
            for (const r of preview.value.rooms) {
                map[r.building] ??= { building: r.building, rooms: 0, periods: 0 };
                map[r.building].rooms++;
            }
            const roomBuilding = Object.fromEntries(preview.value.rooms.map(r => [r.code, r.building]));
            for (const p of preview.value.periods) {
                const b = roomBuilding[p.room];
                if (map[b]) map[b].periods++;
            }
            return Object.values(map);
        });

        const confirmImport = async () => {
            busy.value = true;
            const r = await Model.request("scheduling", "rooms_import", {
                semesterId: props.semesterId,
                rooms: preview.value.rooms,
                periods: preview.value.periods
            });
            busy.value = false;
            if (!r.success) { Alerts.error("Couldn't import the workbook", r.message); return; }
            preview.value = null;
            Store.toast("success", `${r.rooms} room(s) and ${r.periods} scheduled period(s) imported.`);
            if (r.skipped) Store.toast("warning", `${r.skipped} row(s) were skipped.`, 6000);
            load();
            emit("generated");
        };

        // ---------- Room Setup: which rooms the scheduling engine sees ----------
        const DEPARTMENTS = { ITO: "ITO", ACADS: "ACADS", ALL: "All Rooms" };   // offices are staffed in Office Staffing

        // Default rules for S.A. required rooms (Coordinator double-checks in Setup)
        // Loaded from dedicated config file: js/config/room-requirements.js
        function getDefaultRoomConfig(room) {
            if (typeof RoomRequirements !== "undefined" && typeof RoomRequirements.getDefaultConfig === "function") {
                return RoomRequirements.getDefaultConfig(room);
            }
            const code = String(room.code || "").trim().toUpperCase();
            const desc = String(room.description || "").trim().toUpperCase();
            const bldg = String(room.building || "").trim().toUpperCase();

            // 1. ITO Rooms
            if (code === "1303" || desc.includes("ABCOM") || code.includes("1303")) {
                return { selected: true, departmentType: "ITO", requiredSa: 1 };
            }
            const ito2 = ["1106", "1107", "1108", "2206", "2207", "2211", "2301", "2304", "2305", "2306", "2307", "2308", "2309", "2310", "2312", "5301", "5401"];
            if (ito2.includes(code)) {
                return { selected: true, departmentType: "ITO", requiredSa: 2 };
            }

            // 2. ACADS Rooms (2 S.A.s each)
            if (code === "1403" || desc.includes("PHYSICS")) {
                return { selected: true, departmentType: "ACADS", requiredSa: 2 };
            }
            if (code === "1404" || desc.includes("CHEMISTRY")) {
                return { selected: true, departmentType: "ACADS", requiredSa: 2 };
            }
            if (code.startsWith("1407") || desc.includes("CRIM")) {
                return { selected: true, departmentType: "ACADS", requiredSa: 2 };
            }
            if (code.startsWith("2401") || (desc.includes("ARCHI") && (bldg.includes("ANNEX") || code.startsWith("2401")))) {
                return { selected: true, departmentType: "ACADS", requiredSa: 2 };
            }
            if (code.includes("ARDR") || desc.includes("MULTI-COLORED") || desc.includes("ARDR")) {
                return { selected: true, departmentType: "ACADS", requiredSa: 2 };
            }
            const roomNum = parseInt(code, 10);
            if (bldg.includes("CRIS") || (!isNaN(roomNum) && roomNum >= 6301 && roomNum <= 6401)) {
                return { selected: true, departmentType: "ACADS", requiredSa: 2 };
            }

            return { selected: false, departmentType: "ACADS", requiredSa: 1 };
        }

        // Every room has its own S.A. unless the Coordinator puts a few rooms in
        // one shared post. ACADS is mixed: a room with one S.A., a room with two
        // partners, and three rooms watched by a single S.A. all live side by side.
        const openSetup = async () => {
            await load();
            if (!rooms.value.length) {
                Store.toast("warning", "Upload the room assignment workbook first, then set the rooms up.", 6000);
                return;
            }
            const state = {};
            const shared = {};      // "ACADS|1403 / 1404" -> post key, rebuilt from what is saved
            let counter = 0;
            for (const room of rooms.value) {
                if (!room.periods) continue;                       // nothing to put an S.A. on
                let post = null;
                if (room.sharedWith) {
                    const key = room.departmentType + "|" + room.sharedWith;
                    shared[key] ??= "p" + (++counter);
                    post = shared[key];
                }
                const def = getDefaultRoomConfig(room);
                state[room.id] = {
                    selected: room.departmentType ? true : def.selected,
                    departmentType: room.departmentType || def.departmentType,
                    requiredSa: room.requiredSa || def.requiredSa,
                    post
                };
            }
            const first = rooms.value.find(r => r.departmentType);
            setup.value = { department: first?.departmentType || "ITO", search: "", applyValue: 2,
                            rooms: state, counter };
        };

        const setupRooms = Vue.computed(() => {
            if (!setup.value) return [];
            const term = setup.value.search.trim().toLowerCase();
            const selectedDept = setup.value.department;
            return rooms.value.filter(r => {
                if (r.periods <= 0) return false;
                const rDept = setup.value.rooms[r.id]?.departmentType;
                if (selectedDept !== "ALL" && rDept !== selectedDept) return false;
                return (!term || [r.code, r.description, r.building].some(v => v && v.toLowerCase().includes(term)));
            });
        });
        const setupTotal = Vue.computed(() => rooms.value.filter(r => r.periods > 0).length);
        const setupChosen = Vue.computed(() => setup.value
            ? Object.values(setup.value.rooms).filter(r => r.selected).length : 0);

        const toggleSetupRoom = id => {
            const row = setup.value.rooms[id];
            row.selected = !row.selected;
            if (row.selected && setup.value.department !== "ALL") {
                row.departmentType = setup.value.department;
            }
            if (!row.selected) leavePost(id);
        };

        const setDepartment = (id, newDept) => {
            const row = setup.value.rooms[id];
            row.departmentType = newDept;
            if (row.post) leavePost(id);
        };

        // ----- shared posts: a few rooms one S.A. watches together -----
        const membersOf = post => rooms.value.filter(r => setup.value.rooms[r.id]?.post === post);
        const postLabels = Vue.computed(() => {
            const labels = {};
            let n = 0;
            for (const room of rooms.value) {
                const post = setup.value?.rooms[room.id]?.post;
                if (post && !labels[post]) labels[post] = "Post " + String.fromCharCode(65 + (n++ % 26));
            }
            return labels;
        });

        /** The rooms already in a post, for the dropdown. */
        const postSummary = post => membersOf(post).map(r => r.code).join(", ") || "empty";

        /** Posts a room may join: the shared posts already in its department. */
        const postChoices = room => {
            const row = setup.value.rooms[room.id];
            return Object.keys(postLabels.value).filter(post => {
                const members = membersOf(post);
                return members.length && (members[0].id === room.id
                    || setup.value.rooms[members[0].id].departmentType === row.departmentType);
            });
        };

        const leavePost = id => {
            const post = setup.value.rooms[id].post;
            setup.value.rooms[id].post = null;
            if (post && membersOf(post).length === 1) {            // a post of one is just a room
                membersOf(post).forEach(r => { setup.value.rooms[r.id].post = null; });
            }
        };

        const setPost = (id, value) => {
            const row = setup.value.rooms[id];
            if (!value) { leavePost(id); return; }
            row.selected = true;
            if (value === "new") {
                leavePost(id);
                row.post = "p" + (++setup.value.counter);
                return;
            }
            leavePost(id);
            row.post = value;
            const mate = membersOf(value).find(r => r.id !== id);  // follow the post's own settings
            if (mate) {
                row.departmentType = setup.value.rooms[mate.id].departmentType;
                row.requiredSa = setup.value.rooms[mate.id].requiredSa;
            }
        };

        /** The S.A. count belongs to the post, so every room in it moves together. */
        const setRequired = (id, value) => {
            const row = setup.value.rooms[id];
            row.requiredSa = Number(value);
            if (row.post) membersOf(row.post).forEach(r => { setup.value.rooms[r.id].requiredSa = Number(value); });
        };

        // What the save will build: one duty post per S.A. group
        const posts = Vue.computed(() => {
            if (!setup.value) return [];
            const groups = new Map();
            for (const room of rooms.value) {
                const row = setup.value.rooms[room.id];
                if (!row?.selected) continue;
                const key = row.post || "own-" + room.id;
                if (!groups.has(key)) {
                    groups.set(key, { roomIds: [], codes: [], departmentType: row.departmentType, requiredSa: row.requiredSa });
                }
                const group = groups.get(key);
                group.roomIds.push(room.id);
                group.codes.push(room.code);
            }
            return [...groups.values()].map(g => ({ ...g, label: g.codes.join(" / ") }));
        });

        /** Ticks every room in the current search and gives them the same numbers. */
        const applyToAll = () => {
            for (const room of setupRooms.value) {
                const row = setup.value.rooms[room.id];
                row.selected = true;
                if (!row.post && setup.value.department !== "ALL") {
                    row.departmentType = setup.value.department;
                }
                setRequired(room.id, setup.value.applyValue);
            }
        };

        const saveSetup = async () => {
            const chosen = posts.value;
            const roomCount = chosen.reduce((n, p) => n + p.roomIds.length, 0);
            const shared = chosen.filter(p => p.roomIds.length > 1).length;
            const dropped = configured.value.filter(r => !setup.value.rooms[r.id]?.selected).length;

            const ok = await Alerts.confirm({
                title: "Save room setup?",
                html: `<b class="text-ink">${roomCount} room(s)</b> will be scheduled as `
                    + `<b class="text-ink">${chosen.length} duty post(s)</b>.`
                    + (shared ? `<br>${shared} post(s) cover more than one room, so the same S.A. watches them together.` : "")
                    + (dropped ? `<br><b class="text-ink">${dropped} room(s)</b> are no longer selected and lose their duty periods.` : "")
                    + `<br><span class="text-caption">Duty periods are rebuilt from the imported room schedule.</span>`,
                confirmText: "Save setup"
            });
            if (!ok) return;

            busy.value = true;
            const r = await Model.request("scheduling", "rooms_setup_save", {
                semesterId: props.semesterId,
                posts: chosen.map(p => ({ roomIds: p.roomIds, departmentType: p.departmentType, requiredSa: p.requiredSa }))
            });
            busy.value = false;
            if (!r.success) { Alerts.error("Couldn't save the room setup", r.message); return; }
            setup.value = null;
            Store.toast("success", `${r.rooms} room(s) in ${r.posts} duty post(s), ${r.created} duty period(s) ready for matching.`);
            load();
            emit("generated");
        };

        // ---------- Excel-style Room Schedule Grid Viewer & Editor ----------
        const gridRoom = Vue.ref(null);
        const gridItems = Vue.ref([]);
        const gridLoading = Vue.ref(false);
        const gridViewMode = Vue.ref("grid"); // "grid" or "table"
        const editPeriod = Vue.ref(null);
        const showEditForm = Vue.ref(false);

        const DAYS_LIST = [
            { code: "MON", label: "MON", name: "Monday" },
            { code: "TUE", label: "TUES", name: "Tuesday" },
            { code: "WED", label: "WED", name: "Wednesday" },
            { code: "THU", label: "THURS", name: "Thursday" },
            { code: "FRI", label: "FRI", name: "Friday" },
            { code: "SAT", label: "SAT", name: "Saturday" },
            { code: "SUN", label: "SUN", name: "Sunday" }
        ];

        const formatTime12 = (m) => {
            const hrs = Math.floor(m / 60);
            const mins = m % 60;
            const h12 = hrs % 12 === 0 ? 12 : hrs % 12;
            const ampm = hrs >= 12 ? "PM" : "AM";
            return `${h12}:${String(mins).padStart(2, "0")}${ampm}`;
        };

        const TIME_SLOTS = [];
        for (let m = 420; m <= 1290; m += 30) {
            const startStr = formatTime12(m);
            const endStr = formatTime12(m + 30);
            const label = `${startStr} - ${endStr}`;
            TIME_SLOTS.push({ min: m, label, startStr, endStr });
        }

        const parseMin = (tStr) => {
            if (!tStr) return 420;
            const firstPart = String(tStr).split("-")[0].trim().toUpperCase();
            const isPM = firstPart.includes("PM");
            const isAM = firstPart.includes("AM");
            const clean = firstPart.replace(/[^\d:]/g, "");
            const parts = clean.split(":");
            let h = parseInt(parts[0], 10) || 0;
            const m = parseInt(parts[1], 10) || 0;
            if (isPM && h < 12) h += 12;
            if (isAM && h === 12) h = 0;
            return h * 60 + m;
        };

        const addHours = (tStr, hrsToAdd = 2) => {
            const startM = parseMin(tStr);
            const endM = Math.min(1320, startM + hrsToAdd * 60);
            const hrs = Math.floor(endM / 60);
            const mins = endM % 60;
            const h12 = hrs % 12 === 0 ? 12 : hrs % 12;
            const ampm = hrs >= 12 ? "PM" : "AM";
            return `${String(h12).padStart(2, "0")}:${String(mins).padStart(2, "0")}${ampm}`;
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
            return gridItems.value.filter(p => normalizeDay(p.day) === dayCode);
        };

        const getPeriodStyle = (p) => {
            const startM = parseMin(p.startLabel || p.startTime);
            const endM = parseMin(p.endLabel || p.endTime);
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
            const key = (p.className || "") + (p.id || idx);
            let hash = 0;
            for (let i = 0; i < key.length; i++) hash = (hash << 5) - hash + key.charCodeAt(i);
            const colorIdx = Math.abs(hash) % COLOR_CLASSES.length;
            return COLOR_CLASSES[colorIdx];
        };

        const openGridEditor = async (room) => {
            gridRoom.value = room;
            gridLoading.value = true;
            const r = await Model.request("scheduling", "room_utilization", { roomId: room.id, roomCode: room.code, semesterId: props.semesterId });
            gridLoading.value = false;
            if (r.success) gridItems.value = r.items;
            else Store.toast("danger", r.message);
        };

        const closeGridEditor = () => {
            gridRoom.value = null;
            gridItems.value = [];
        };

        const parseClassParts = (classNameStr) => {
            if (!classNameStr) return { subject: "", section: "" };
            const str = String(classNameStr).trim();
            const match = str.match(/^(.*?)\s+((?:BS|AB|BE|SHS|TVL|[A-Z]{2,4}\s*[-–—]?\s*\d).*)$/i);
            if (match) {
                return { subject: match[1].trim(), section: match[2].trim() };
            }
            const parts = str.split(/\s+/);
            if (parts.length > 1 && /^[A-Z0-9-]+$/i.test(parts[parts.length - 1])) {
                return {
                    subject: parts.slice(0, -1).join(" "),
                    section: parts[parts.length - 1]
                };
            }
            return { subject: str, section: "" };
        };

        const openAddPeriod = (dayCode = "MON", timeLabel = "07:00 AM") => {
            const startStr = timeLabel.includes("-") ? timeLabel.split("-")[0].trim() : timeLabel;
            const end = addHours(startStr, 2);
            editPeriod.value = { id: 0, day: normalizeDay(dayCode), startTime: startStr, endTime: end, subject: "", section: "" };
            showEditForm.value = true;
        };

        const openEditPeriod = (p) => {
            const parts = parseClassParts(p.className);
            editPeriod.value = {
                id: p.id,
                day: normalizeDay(p.day),
                startTime: p.startLabel || p.startTime,
                endTime: p.endLabel || p.endTime,
                subject: parts.subject,
                section: parts.section
            };
            showEditForm.value = true;
        };

        const savePeriod = async () => {
            if (!editPeriod.value || !gridRoom.value) return;
            const fullClassName = (editPeriod.value.subject.trim() + (editPeriod.value.section.trim() ? " " + editPeriod.value.section.trim() : "")).trim();
            busy.value = true;
            const r = await Model.request("scheduling", "room_utilization_save", {
                semesterId: props.semesterId,
                roomId: gridRoom.value.id,
                id: editPeriod.value.id,
                day: normalizeDay(editPeriod.value.day),
                startTime: editPeriod.value.startTime,
                endTime: editPeriod.value.endTime,
                className: fullClassName
            });
            busy.value = false;
            if (!r.success) { Alerts.error("Couldn't save period", r.message); return; }
            Store.toast("success", editPeriod.value.id ? "Class schedule updated." : "Class schedule added.");
            showEditForm.value = false;
            openGridEditor(gridRoom.value);
            load();
            emit("generated");
        };

        const deletePeriod = async (p) => {
            const ok = await Alerts.confirm({
                title: "Delete this period?",
                html: `Remove <b class="text-ink">${Alerts.esc(p.className || 'Class')}</b> (${p.day} ${p.startLabel} - ${p.endLabel}) from ${Alerts.esc(gridRoom.value.code)}?`,
                icon: "warning", danger: true, confirmText: "Delete period"
            });
            if (!ok) return;
            const r = await Model.request("scheduling", "room_utilization_delete", { semesterId: props.semesterId, id: p.id });
            if (!r.success) { Alerts.error("Couldn't delete period", r.message); return; }
            Store.toast("success", "Period deleted.");
            openGridEditor(gridRoom.value);
            load();
            emit("generated");
        };

        return { rooms, load, busy, fileInput, preview, pickFile, handleFile, previewByBuilding, confirmImport,
                 setup, openSetup, setupRooms, setupTotal, setupChosen, toggleSetupRoom, setDepartment, applyToAll, saveSetup,
                 posts, configured, postLabels, postChoices, postSummary, setPost, setRequired, DEPARTMENTS,
                 gridRoom, gridItems, gridLoading, gridViewMode, DAYS_LIST, TIME_SLOTS, getDayPeriods, getPeriodStyle, getPeriodColor, parseClassParts,
                 editPeriod, showEditForm, openGridEditor, closeGridEditor,
                 openAddPeriod, openEditPeriod, savePeriod, deletePeriod };
    },

    template: `
    <input ref="fileInput" type="file" accept=".xlsx,.xlsm" class="sr-only"
           @change="handleFile($event.target.files[0])" aria-label="Room assignment workbook">

    <!-- Import preview -->
    <app-modal :open="!!preview" size="lg" icon="DoorOpen" title="Import rooms and schedules" @close="preview = null"
               :description="preview ? preview.fileName : ''">
        <template v-if="preview">
            <dl class="grid grid-cols-2 gap-3">
                <div class="rounded-lg border border-line px-4 py-3">
                    <dt class="text-caption text-muted">Rooms found</dt>
                    <dd class="text-[22px] font-bold text-navy">{{ preview.rooms.length }}</dd>
                </div>
                <div class="rounded-lg border border-line px-4 py-3">
                    <dt class="text-caption text-muted">Scheduled periods</dt>
                    <dd class="text-[22px] font-bold text-navy">{{ preview.periods.length }}</dd>
                </div>
            </dl>

            <table class="mt-4 w-full text-left text-body">
                <thead class="text-caption font-semibold text-muted">
                    <tr><th class="pb-2">Building</th><th class="pb-2">Rooms</th><th class="pb-2">Periods</th></tr>
                </thead>
                <tbody class="divide-y divide-line">
                    <tr v-for="b in previewByBuilding" :key="b.building">
                        <td class="py-2 font-medium text-ink">{{ b.building }}</td>
                        <td class="py-2 text-ink">{{ b.rooms }}</td>
                        <td class="py-2 text-muted">{{ b.periods }}</td>
                    </tr>
                </tbody>
            </table>

            <ul v-if="preview.warnings.length" class="mt-4 space-y-1">
                <li v-for="w in preview.warnings" :key="w" class="flex items-start gap-2 text-caption text-warning">
                    <app-icon name="TriangleAlert" :size="14" class="mt-0.5 shrink-0" /> {{ w }}
                </li>
            </ul>

            <p class="mt-4 text-caption text-muted">
                Importing replaces the room schedule stored for this semester. The rooms you already set up keep their
                duty periods, and no S.A. duty is created here.
            </p>
        </template>
        <template #footer>
            <button @click="preview = null" class="btn btn-secondary">Cancel</button>
            <button @click="confirmImport" :disabled="busy" class="btn btn-primary">
                <app-icon :name="busy ? 'LoaderCircle' : 'Check'" :size="16" :class="busy ? 'animate-spin' : ''" />
                Import {{ preview ? preview.rooms.length : 0 }} room(s)
            </button>
        </template>
    </app-modal>

    <!-- Room Setup: the only place that decides what matching sees -->
    <app-modal :open="!!setup" size="xl" icon="Settings2" title="Room Schedule Settings" @close="setup = null"
               description="Select a department, search for a room, and set the required number of S.A.s for all matching rooms.">
        <template v-if="setup">
            <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.3fr)]">
                <div>
                    <label for="setup-dept" class="field-label">Department Filter</label>
                    <select id="setup-dept" v-model="setup.department" class="input font-semibold">
                        <option v-for="(label, code) in DEPARTMENTS" :key="code" :value="code">{{ label }}</option>
                    </select>
                </div>
                <div>
                    <label for="setup-search" class="field-label">Search Room</label>
                    <div class="relative">
                        <app-icon name="Search" :size="15" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                        <input id="setup-search" v-model="setup.search" type="search" class="input px-9" placeholder="Comp Lab">
                        <button v-if="setup.search" type="button" @click="setup.search = ''"
                                class="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded text-muted hover:text-ink"
                                aria-label="Clear the search"><app-icon name="X" :size="14" /></button>
                    </div>
                </div>
                <div class="flex items-start gap-3 rounded-lg bg-info/5 p-3">
                    <app-icon name="Info" :size="16" class="mt-0.5 shrink-0 text-info" />
                    <div class="min-w-0 flex-1">
                        <p class="text-caption text-muted">
                            Every room in the search is selected, so you can set the required S.A. for all of them at once.
                        </p>
                        <div class="mt-2 flex items-center gap-2">
                            <label for="setup-apply" class="sr-only">Required S.A. to apply</label>
                            <select id="setup-apply" v-model.number="setup.applyValue" class="input w-20 px-2 py-1.5">
                                <option v-for="n in 10" :key="n" :value="n">{{ n }}</option>
                            </select>
                            <button type="button" @click="applyToAll" :disabled="!setupRooms.length" class="btn btn-primary btn-sm">
                                Apply to All ({{ setup.applyValue }})
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="mt-4 overflow-hidden rounded-lg border border-line">
                <div class="flex flex-wrap items-center gap-x-2 gap-y-1 bg-mist px-3 py-2 text-[13px] font-semibold text-navy">
                    <app-icon name="ClipboardList" :size="15" />
                    {{ DEPARTMENTS[setup.department] || setup.department }} ({{ setupRooms.length }} rooms found)
                    <span class="font-normal text-muted">
                        · each room has its own S.A.; put rooms in the same post when one S.A. watches them together
                    </span>
                </div>
                <div class="max-h-[42vh] overflow-auto">
                    <table class="w-full min-w-[680px] text-left text-[13px]">
                        <thead class="sticky top-0 z-10 bg-page text-caption font-semibold text-muted">
                            <tr>
                                <th class="px-3 py-2"><span class="sr-only">Selected</span></th>
                                <th class="px-3 py-2">Room Name</th>
                                <th class="px-3 py-2">Building</th>
                                <th class="px-3 py-2">Department</th>
                                <th class="px-3 py-2">Days / Time (from file)</th>
                                <th class="px-3 py-2">Duty post</th>
                                <th class="px-3 py-2">Required S.A.</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-line">
                            <tr v-for="r in setupRooms" :key="r.id" class="hover:bg-mist/40"
                                :class="setup.rooms[r.id].selected ? '' : 'opacity-70'">
                                <td class="px-3 py-2">
                                    <input type="checkbox" :checked="setup.rooms[r.id].selected" @change="toggleSetupRoom(r.id)"
                                           :aria-label="'Use ' + r.code + ' for S.A. duty'"
                                           class="h-4 w-4 rounded border-line text-navy focus:ring-navy/30">
                                </td>
                                <td class="whitespace-nowrap px-3 py-2">
                                    <span class="font-semibold text-navy">{{ r.code }}</span>
                                    <span v-if="r.description" class="block max-w-[170px] truncate text-caption text-muted">{{ r.description }}</span>
                                </td>
                                <td class="px-3 py-2 text-muted">{{ r.building }}</td>
                                <td class="px-3 py-2">
                                    <select :value="setup.rooms[r.id].departmentType" @change="setDepartment(r.id, $event.target.value)"
                                            class="input w-28 px-2 py-1 text-[12px] font-semibold">
                                        <option value="ITO">ITO</option>
                                        <option value="ACADS">ACADS</option>
                                    </select>
                                </td>
                                <td class="px-3 py-2 text-[12px] text-ink">
                                    <span v-for="(line, i) in r.schedule" :key="i" class="block whitespace-nowrap">
                                        <span v-if="line.days" class="text-muted">{{ line.days }}</span>
                                        {{ line.time }}
                                    </span>
                                    <button type="button" @click="openGridEditor(r)"
                                            class="mt-1.5 inline-flex items-center gap-1 rounded bg-navy/10 px-2 py-1 text-[11px] font-bold text-navy hover:bg-navy hover:text-white transition-colors">
                                        <app-icon name="Table" :size="12" /> View / Edit Timetable Grid
                                    </button>
                                </td>
                                <td class="px-3 py-2">
                                    <select :value="setup.rooms[r.id].post || ''" @change="setPost(r.id, $event.target.value)"
                                            :disabled="!setup.rooms[r.id].selected"
                                            class="input w-36 px-2 py-1.5" :aria-label="'Duty post for ' + r.code">
                                        <option value="">Own post</option>
                                        <option v-for="post in postChoices(r)" :key="post" :value="post">
                                            {{ postLabels[post] }} · {{ postSummary(post) }}
                                        </option>
                                        <option value="new">+ New shared post</option>
                                    </select>
                                </td>
                                <td class="px-3 py-2">
                                    <select :value="setup.rooms[r.id].requiredSa" @change="setRequired(r.id, $event.target.value)"
                                            :disabled="!setup.rooms[r.id].selected"
                                            class="input w-16 px-2 py-1.5" :aria-label="'Required S.A. for ' + r.code">
                                        <option v-for="n in 10" :key="n" :value="n">{{ n }}</option>
                                    </select>
                                </td>
                            </tr>
                            <tr v-if="!setupRooms.length">
                                <td colspan="7" class="px-3 py-8 text-center text-muted">No room matches this search.</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <p class="mt-2 text-caption text-muted">
                Showing {{ setupRooms.length }} of {{ setupTotal }} rooms{{ setup.search ? ' (filtered results)' : '' }} ·
                {{ setupChosen }} selected, {{ posts.length }} duty post(s)
            </p>
        </template>

        <template #footer>
            <button @click="setup = null" class="btn btn-secondary">Cancel</button>
            <button @click="saveSetup" :disabled="busy" class="btn btn-primary">
                <app-icon :name="busy ? 'LoaderCircle' : 'Check'" :size="16" :class="busy ? 'animate-spin' : ''" />
                Save setup
            </button>
        </template>
    </app-modal>

    <!-- Excel-Style Visual Weekly Timetable Grid Viewer & Editor Modal -->
    <app-modal :open="!!gridRoom" size="xl" icon="Calendar" :title="gridRoom ? 'Room ' + gridRoom.code + ' Schedule Timetable' : ''" @close="closeGridEditor"
               :description="gridRoom ? (gridRoom.building + (gridRoom.description ? ' · ' + gridRoom.description : '') + ' · ' + gridItems.length + ' scheduled period(s)') : ''">
        <template v-if="gridRoom">
            <div class="mb-4 flex flex-wrap items-center justify-between gap-3 bg-mist/70 rounded-xl p-3 border border-line">
                <div class="flex items-center gap-2">
                    <span class="rounded-lg bg-navy px-3 py-1 font-bold text-white text-[15px] shadow-xs">{{ gridRoom.code }}</span>
                    <span class="text-caption font-bold text-navy">{{ gridRoom.building }}</span>
                    <span v-if="gridRoom.description" class="rounded bg-white px-2 py-0.5 text-caption font-medium text-muted border border-line">{{ gridRoom.description }}</span>
                </div>
                <div class="flex items-center gap-2">
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
                    <button type="button" @click="openAddPeriod('MON', '08:00 AM')" class="btn btn-primary btn-sm shadow-xs">
                        <app-icon name="Plus" :size="14" /> Add Class Period
                    </button>
                </div>
            </div>

            <div v-if="gridLoading" class="py-16 text-center text-muted">
                <app-icon name="LoaderCircle" :size="28" class="animate-spin inline-block text-navy" />
                <p class="mt-2 text-caption font-medium">Loading {{ gridRoom.code }} weekly timetable grid…</p>
            </div>

            <div v-else-if="!gridItems.length" class="card flex flex-col items-center py-12 text-center border-dashed">
                <app-icon name="CalendarOff" :size="32" class="text-muted" />
                <p class="mt-2 font-bold text-ink text-[15px]">No class schedule periods recorded for {{ gridRoom.code }}</p>
                <p class="text-caption text-muted mt-1 max-w-sm">Click below or click on any cell in the grid to add a schedule period for this room.</p>
                <button type="button" @click="openAddPeriod('MON', '08:00 AM')" class="btn btn-primary btn-sm mt-4">
                    <app-icon name="Plus" :size="14" /> Add Class Period
                </button>
            </div>

            <div v-else>
                <!-- 1. Visual Weekly Timetable Grid Matrix (7:00 AM - 10:00 PM) -->
                <div v-if="gridViewMode === 'grid'" class="overflow-auto rounded-xl border border-line bg-white shadow-card max-h-[65vh]">
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
                                <!-- 30 Slot Background Clickable Cells -->
                                <div v-for="t in TIME_SLOTS" :key="t.min"
                                     @click="openAddPeriod(d.code, t.startStr)"
                                     @dblclick="openAddPeriod(d.code, t.startStr)"
                                     title="Double-click or click to add class period at this time"
                                     class="h-9 border-b border-line/40 transition-colors hover:bg-navy/5 cursor-pointer group flex items-center justify-center">
                                    <span class="opacity-0 group-hover:opacity-100 text-[10px] font-bold text-navy bg-white/90 px-1.5 py-0.5 rounded shadow-xs border border-navy/20">
                                        + Add
                                    </span>
                                </div>

                                <!-- Class Period Cards (Absolute Positioned) -->
                                <div v-for="(p, idx) in getDayPeriods(d.code)" :key="p.id"
                                     :style="getPeriodStyle(p)"
                                     @click.stop="openEditPeriod(p)"
                                     @dblclick.stop="openEditPeriod(p)"
                                     title="Double-click or click to edit subject, section & time"
                                     class="absolute left-1 right-1 rounded-md border px-2 py-1.5 shadow-xs transition-all hover:z-30 hover:shadow-md cursor-pointer flex flex-col justify-between overflow-hidden group"
                                     :class="[getPeriodColor(p, idx).bg, getPeriodColor(p, idx).border, getPeriodColor(p, idx).text, getPeriodColor(p, idx).hover]">
                                    <div class="min-w-0 flex-1">
                                        <div class="flex items-start justify-between gap-1">
                                            <div class="min-w-0 flex-1 leading-snug">
                                                <div class="font-bold text-[11px] truncate">{{ parseClassParts(p.className).subject || p.className || 'Scheduled Class' }}</div>
                                                <div v-if="parseClassParts(p.className).section" class="text-[10px] font-semibold opacity-85 truncate">{{ parseClassParts(p.className).section }}</div>
                                            </div>
                                            <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-1">
                                                <button type="button" @click.stop="openEditPeriod(p)"
                                                        class="rounded p-0.5 hover:bg-black/10 transition-colors"
                                                        title="Edit subject, section & time">
                                                    <app-icon name="Pencil" :size="12" />
                                                </button>
                                                <button type="button" @click.stop="deletePeriod(p)"
                                                        class="rounded p-0.5 text-danger hover:bg-danger/20 transition-colors"
                                                        title="Delete period">
                                                    <app-icon name="Trash2" :size="12" />
                                                </button>
                                            </div>
                                        </div>
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
                                <th class="border-b border-navy-700 px-3 py-2.5 w-24">Day</th>
                                <th class="border-b border-navy-700 px-3 py-2.5 w-40">Time Period</th>
                                <th class="border-b border-navy-700 px-3 py-2.5">Class / Subject</th>
                                <th class="border-b border-navy-700 px-3 py-2.5 text-right w-28">Actions</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-line">
                            <tr v-for="(p, idx) in gridItems" :key="p.id" class="transition-colors hover:bg-mist/40"
                                :class="idx % 2 === 0 ? 'bg-white' : 'bg-mist/15'">
                                <td class="whitespace-nowrap px-3 py-2.5 font-bold text-navy">
                                    <span class="rounded bg-mist px-2.5 py-1 text-[11px] uppercase font-bold text-navy border border-navy/15">{{ p.day }}</span>
                                </td>
                                <td class="whitespace-nowrap px-3 py-2.5 font-semibold text-ink">
                                    <app-icon name="Clock" :size="13" class="inline text-muted mr-1.5" />
                                    {{ p.startLabel }} – {{ p.endLabel }}
                                </td>
                                <td class="px-3 py-2.5">
                                    <div class="inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 font-bold text-[12px] shadow-xs"
                                         :class="[getPeriodColor(p, idx).bg, getPeriodColor(p, idx).border, getPeriodColor(p, idx).text]">
                                        <app-icon name="BookOpen" :size="14" class="opacity-75" />
                                        <span>{{ p.className || 'Scheduled Class' }}</span>
                                    </div>
                                </td>
                                <td class="whitespace-nowrap px-3 py-2.5 text-right">
                                    <button type="button" @click="openEditPeriod(p)" class="btn btn-ghost btn-sm px-2 text-navy hover:bg-mist" title="Edit this period">
                                        <app-icon name="Pencil" :size="13" /> Edit
                                    </button>
                                    <button type="button" @click="deletePeriod(p)" class="btn btn-ghost btn-sm px-2 text-danger hover:bg-danger/10" title="Delete this period">
                                        <app-icon name="Trash2" :size="13" />
                                    </button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </template>
        <template #footer>
            <button @click="closeGridEditor" class="btn btn-secondary">Close Schedule</button>
        </template>
    </app-modal>

    <!-- Add / Edit Period Inner Modal -->
    <app-modal :open="showEditForm" z="z-[60]" :title="editPeriod?.id ? 'Edit Class Schedule' : 'Add Class Schedule'" icon="Clock" @close="showEditForm = false">
        <form v-if="editPeriod" @submit.prevent="savePeriod" class="space-y-4">
            <div class="grid grid-cols-2 gap-3">
                <form-field label="Subject Code / Name" required hint="e.g. ARCH 018 or IT 208" v-slot="f">
                    <input :id="f.id" v-model="editPeriod.subject" placeholder="ARCH 018" class="input font-bold text-navy" autofocus>
                </form-field>
                <form-field label="Section" hint="e.g. BSARC-21A1 or BSIT-22M4" v-slot="f">
                    <input :id="f.id" v-model="editPeriod.section" placeholder="BSARC-21A1" class="input font-bold text-navy">
                </form-field>
            </div>

            <form-field label="Day of week" required v-slot="f">
                <select :id="f.id" v-model="editPeriod.day" class="input font-semibold">
                    <option value="MON">Monday (MON)</option>
                    <option value="TUE">Tuesday (TUES)</option>
                    <option value="WED">Wednesday (WED)</option>
                    <option value="THU">Thursday (THURS)</option>
                    <option value="FRI">Friday (FRI)</option>
                    <option value="SAT">Saturday (SAT)</option>
                    <option value="SUN">Sunday (SUN)</option>
                </select>
            </form-field>

            <div class="grid grid-cols-2 gap-3">
                <form-field label="Start time" required hint="e.g. 07:00 AM" v-slot="f">
                    <input :id="f.id" v-model="editPeriod.startTime" list="time-options-list" placeholder="07:00 AM" class="input font-semibold">
                </form-field>
                <form-field label="End time" required hint="e.g. 09:00 AM" v-slot="f">
                    <input :id="f.id" v-model="editPeriod.endTime" list="time-options-list" placeholder="09:00 AM" class="input font-semibold">
                </form-field>
            </div>
            <datalist id="time-options-list">
                <option v-for="t in TIME_SLOTS" :key="t.min" :value="t.startStr">{{ t.startStr }}</option>
                <option value="10:00PM">10:00 PM</option>
            </datalist>

            <div class="flex justify-end gap-2 pt-3 border-t border-line">
                <button type="button" @click="showEditForm = false" class="btn btn-secondary">Cancel</button>
                <button type="submit" class="btn btn-primary">
                    <app-icon name="Check" :size="16" /> Save Class Schedule
                </button>
            </div>
        </form>
    </app-modal>
    `
};

