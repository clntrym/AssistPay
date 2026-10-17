// Supervisor > Dashboard (/supervisor/dashboard) & My S.A. Team (/supervisor/team)
// Displays the published schedules of all Student Assistants assigned under the logged-in Supervisor's department or office(s).
// Supports Solo S.A. Weekly Grid (7AM-10PM), With Partner (Room/Lab/Office) Weekly Grid, and Table View.
const SupervisorTeamPage = {
    components: { AppIcon, PageHeader, AppModal },

    setup() {
        const DAYS = [
            { code: "MON", label: "Monday" },
            { code: "TUE", label: "Tuesday" },
            { code: "WED", label: "Wednesday" },
            { code: "THU", label: "Thursday" },
            { code: "FRI", label: "Friday" },
            { code: "SAT", label: "Saturday" },
        ];

        const HOUR_ROWS = [];
        for (let h = 7; h < 22; h++) {
            const startMin = h * 60;
            const ampm = h >= 12 ? "PM" : "AM";
            const hr12 = h % 12 === 0 ? 12 : h % 12;
            HOUR_ROWS.push({ start: startMin, label: `${hr12}:00 ${ampm}` });
        }

        const PX_PER_HOUR = 42;
        const GRID_START = 7 * 60;
        const GRID_END = 22 * 60;

        const blockStyle = (startMin, endMin) => {
            const s = Math.max(GRID_START, Math.min(GRID_END, Number(startMin) || GRID_START));
            const e = Math.max(s + 15, Math.min(GRID_END, Number(endMin) || s + 60));
            const top = ((s - GRID_START) / 60) * PX_PER_HOUR;
            const height = Math.max(20, ((e - s) / 60) * PX_PER_HOUR - 2);
            return { top: `${top}px`, height: `${height}px` };
        };

        const loading = Vue.ref(true);
        const loadError = Vue.ref("");
        const semester = Vue.ref(null);
        const publication = Vue.ref(null);
        const supervisor = Vue.ref(null);
        const staff = Vue.ref([]);
        const summary = Vue.ref({ sas: 0, hours: 0, blocks: 0 });

        const viewMode = Vue.ref("grid"); // 'grid' (Solo) | 'room' (With Partner) | 'table'
        const searchQuery = Vue.ref("");
        const locationFilter = Vue.ref("ALL");
        const activeBlock = Vue.ref(null);
        const selectedSaRecords = Vue.ref(null);

        const openSaRecordsModal = (saObj) => {
            if (!saObj) return;
            const fullSa = (staff.value || []).find(s => s.saId === saObj.saId || s.name === saObj.name) || saObj;
            selectedSaRecords.value = fullSa;
        };

        const closeBlockPopover = () => {
            activeBlock.value = null;
        };

        const formatCompactTime = (label) => {
            if (!label) return "";
            return String(label).replace(/:00\s*/g, "").replace(/\s+/g, "").toUpperCase();
        };

        const toggleBlockPopover = (sa, item, type, day, contextKey = "") => {
            const dayCode = day.code || day;
            const key = `${contextKey}-${sa.saId}-${type}-${dayCode}-${item.start}-${item.end}`;
            if (activeBlock.value && activeBlock.value.key === key) {
                activeBlock.value = null;
                return;
            }
            const s = Math.max(GRID_START, Math.min(GRID_END, Number(item.start) || GRID_START));
            const e = Math.max(s + 15, Math.min(GRID_END, Number(item.end) || s + 60));
            const isPartnerContext = contextKey !== "solo";
            const top = isPartnerContext ? ((s - 420) / 30) * 36 : ((s - GRID_START) / 60) * PX_PER_HOUR;
            const height = isPartnerContext ? Math.max(20, ((e - s) / 30) * 36 - 2) : Math.max(20, ((e - s) / 60) * PX_PER_HOUR - 2);
            const showAbove = s >= 1080;
            const isReliever = type === "DUTY" && item.location && item.location.includes("Reliever");

            activeBlock.value = {
                key,
                contextKey,
                saId: sa.saId,
                saName: sa.name,
                ownerName: sa.name,
                studentId: sa.studentId,
                dayCode: dayCode,
                dayLabel: day.label || dayCode,
                type: isReliever ? "RELIEVER" : type,
                badgeLabel: isReliever
                    ? "ITO Reliever Duty"
                    : (type === "CLASS" ? "Official Registrar Class" : "Official Duty Schedule"),
                title: type === "CLASS"
                    ? `CLASS: ${item.subject}${item.section ? " (" + item.section + ")" : ""}`
                    : `DUTY: ${item.location} (${item.credited}h)`,
                timeLabel: `${item.startLabel} – ${item.endLabel}`,
                hoursLabel: type === "CLASS"
                    ? `${item.hours || Math.round(((e - s) / 60) * 10) / 10} class hr(s)`
                    : `${item.credited} credited hr(s) (${item.hours} raw hr(s))`,
                lunchNote: type === "DUTY" && item.hasBreak ? "-1h lunch break deducted" : "",
                popoverStyle: showAbove
                    ? { top: `${Math.max(4, top - 118)}px` }
                    : { top: `${top + height + 4}px` },
                alignRight: dayCode === "FRI" || dayCode === "SAT",
            };
        };

        const load = async () => {
            loading.value = true;
            loadError.value = "";
            const res = await Model.request("supervisors", "my_team_schedules");
            loading.value = false;
            if (!res.success) {
                loadError.value = res.message || "Could not load your S.A. team schedules.";
                return;
            }
            semester.value = res.semester;
            publication.value = res.publication || null;
            supervisor.value = res.supervisor || null;
            staff.value = res.staff || [];
            summary.value = res.summary || { sas: 0, hours: 0, blocks: 0 };
        };

        Vue.onMounted(load);

        const getPrimaryRoom = (sa) => {
            const primaryBlocks = (sa.blocks || []).filter(b => !(b.location || "").includes("Reliever"));
            return primaryBlocks[0]?.location || (sa.location || "").split(" + ")[0].replace(/\s*\(ITO Reliever\)/i, "").trim();
        };

        const availableLocations = Vue.computed(() => {
            const set = new Set();
            for (const sa of staff.value) {
                const rm = getPrimaryRoom(sa);
                if (rm) set.add(rm);
            }
            return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
        });

        const filteredStaff = Vue.computed(() => {
            const term = searchQuery.value.trim().toLowerCase();
            return (staff.value || []).filter(s => {
                if (locationFilter.value !== "ALL" && getPrimaryRoom(s) !== locationFilter.value) return false;
                if (!term) return true;
                return (s.name || "").toLowerCase().includes(term) ||
                       (s.saNumber || "").toLowerCase().includes(term) ||
                       (s.studentId || "").toLowerCase().includes(term) ||
                       (s.location || "").toLowerCase().includes(term) ||
                       (s.course || "").toLowerCase().includes(term);
            });
        });

        const formatTime12 = (m) => {
            const hrs = Math.floor(m / 60);
            const mins = m % 60;
            const h12 = hrs % 12 === 0 ? 12 : hrs % 12;
            const ampm = hrs >= 12 ? "PM" : "AM";
            return `${h12}:${String(mins).padStart(2, "0")} ${ampm}`;
        };

        // 30 time slots from 7:00 AM to 10:00 PM (30 intervals of 30 mins, matching Image 4 modern calendar grid)
        const TIME_SLOTS = [];
        for (let m = 420; m < 1320; m += 30) {
            const startStr = formatTime12(m);
            const endStr = formatTime12(m + 30);
            TIME_SLOTS.push({
                min: m,
                start: m,
                end: m + 30,
                startStr,
                endStr,
                startLabel: startStr,
                endLabel: endStr,
                label: `${startStr} – ${endStr}`
            });
        }

        const DAYS_LIST = [
            { code: "MON", label: "MON", name: "Monday" },
            { code: "TUE", label: "TUE", name: "Tuesday" },
            { code: "WED", label: "WED", name: "Wednesday" },
            { code: "THU", label: "THU", name: "Thursday" },
            { code: "FRI", label: "FRI", name: "Friday" },
            { code: "SAT", label: "SAT", name: "Saturday" }
        ];

        const PARTNER_DAYS = [
            { code: "MON", label: "M" },
            { code: "TUE", label: "T" },
            { code: "WED", label: "W" },
            { code: "THU", label: "TH" },
            { code: "FRI", label: "F" },
            { code: "SAT", label: "Sat" },
        ];

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
            if (m24) return parseInt(m24[1], 10) * 60 + parseInt(m24[2], 10);
            return 420;
        };

        const getPeriodStyle = (p) => {
            const startM = (p.start !== undefined ? p.start : parseMin(p.startTime || p.startLabel));
            const endM = (p.end !== undefined ? p.end : parseMin(p.endTime || p.endLabel));
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

        const getSlotInfo = (partner, dayCode, slot, roomName) => {
            // 1. Check duty blocks
            const dutyBlocks = (partner.blocks || []).filter(b => b.day === dayCode);
            for (const b of dutyBlocks) {
                if (slot.start >= b.start && slot.end <= b.end) {
                    const totalSlots = Math.round((b.end - b.start) / 30);
                    const midSlotIndex = Math.floor((totalSlots - 1) / 2);
                    const currentSlotInBlock = Math.round((slot.start - b.start) / 30);
                    const isMiddle = currentSlotInBlock === midSlotIndex;
                    const isFirst = currentSlotInBlock === 0;
                    const isLast = currentSlotInBlock === (totalSlots - 1);
                    const hoursVal = b.credited != null ? b.credited : Math.round((b.end - b.start - (b.hasBreak ? 60 : 0)) / 60);

                    return {
                        type: "DUTY",
                        isFirst,
                        isLast,
                        isMiddle,
                        hours: hoursVal,
                        title: `${partner.name} · Duty: ${b.location || roomName} (${b.startLabel}–${b.endLabel}, ${hoursVal}h credited)`
                    };
                }
            }

            // 2. Check class blocks
            const classes = (partner.classes || []).filter(c => c.day === dayCode);
            for (const c of classes) {
                if (slot.start >= c.start && slot.end <= c.end) {
                    return {
                        type: "CLASS",
                        title: `${partner.name} · Class: ${c.subject}${c.section ? " (" + c.section + ")" : ""} (${c.startLabel}–${c.endLabel})`
                    };
                }
            }

            return {
                type: "FREE",
                title: `${partner.name} · Available / Free (${slot.startLabel}–${slot.endLabel})`
            };
        };

        const getSlotStyle = (partner, dayCode, slot, roomName) => {
            const info = getSlotInfo(partner, dayCode, slot, roomName);
            if (info.type === "DUTY") {
                return {
                    backgroundColor: "#FFFF00",
                    borderLeft: "1px solid #000000",
                    borderRight: "1px solid #000000",
                    borderTop: info.isFirst ? "1px solid #000000" : "1px solid #FFFF00",
                    borderBottom: info.isLast ? "1px solid #000000" : "1px solid #FFFF00"
                };
            }
            if (info.type === "CLASS") {
                return {
                    backgroundColor: "#0070C0",
                    border: "1px solid #000000"
                };
            }
            return {
                backgroundColor: "#FFFFFF",
                border: "1px solid #000000"
            };
        };

        const filteredRooms = Vue.computed(() => {
            const list = staff.value || [];
            if (!list.length) return [];

            // 1. Collect all distinct room/office locations from staff duty blocks and office assignments
            const roomSet = new Set();
            for (const sa of list) {
                for (const b of (sa.blocks || [])) {
                    const loc = (b.location || "").replace(/\s*\(ITO Reliever\)/i, "").trim();
                    if (loc) roomSet.add(loc);
                }
                if (sa.location) {
                    sa.location.split("+").forEach(part => {
                        const loc = part.replace(/\s*\(ITO Reliever\)/i, "").trim();
                        if (loc) roomSet.add(loc);
                    });
                }
            }

            if (supervisor.value && supervisor.value.depts) {
                for (const d of supervisor.value.depts) {
                    if (d && d !== "ITO" && d !== "ACADS") roomSet.add(d);
                }
            }
            if (supervisor.value && supervisor.value.office_name) {
                roomSet.add(supervisor.value.office_name);
            }
            if (!roomSet.size) {
                roomSet.add(supervisor.value?.dept || "HR");
            }

            const sortedRooms = Array.from(roomSet).sort((a, b) =>
                a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
            );

            // Put supervisor's primary department/office first (e.g. HR)
            const supPrimary = supervisor.value?.office_name || (supervisor.value?.depts && supervisor.value.depts[0]) || supervisor.value?.dept;
            if (supPrimary && sortedRooms.includes(supPrimary)) {
                sortedRooms.splice(sortedRooms.indexOf(supPrimary), 1);
                sortedRooms.unshift(supPrimary);
            }

            const rooms = [];
            for (const roomName of sortedRooms) {
                // Find all S.A.s who have duty in this room OR are assigned to this room/office
                const matchingSas = list.filter(sa => {
                    const hasBlockInRoom = (sa.blocks || []).some(b => {
                        const loc = (b.location || "").replace(/\s*\(ITO Reliever\)/i, "").trim();
                        return loc.toLowerCase() === roomName.toLowerCase();
                    });
                    if (hasBlockInRoom) return true;

                    if (sa.location) {
                        const parts = sa.location.split(/\s*\+\s*/).map(p => p.replace(/\s*\(ITO Reliever\)/i, "").trim().toLowerCase());
                        if (parts.includes(roomName.toLowerCase())) return true;
                    }

                    if (supPrimary && roomName.toLowerCase() === supPrimary.toLowerCase()) {
                        if ((sa.department || "").toLowerCase() === roomName.toLowerCase()) return true;
                        if ((sa.blocks || []).some(b => (b.location || "").toLowerCase().includes(roomName.toLowerCase()))) return true;
                        if ((sa.location || "").toLowerCase().includes(roomName.toLowerCase())) return true;
                    }

                    return false;
                });

                // Filter out solo rooms: ONLY show rooms with 2 or more assigned S.A.s
                if (matchingSas.length < 2) continue;

                const firstSa = matchingSas[0];
                const dept = (roomName === "HR" || roomName.includes("OFFICE")) ? "HR" : (firstSa.department || firstSa.category || "OFFICE");
                const key = `${dept}|${roomName}`;

                const partners = matchingSas.map((sa, idx) => {
                    const firstName = (sa.name || "").trim().split(/\s+/)[0] || sa.name;
                    return {
                        saId: sa.saId,
                        slotNo: idx + 1,
                        name: sa.name,
                        firstName,
                        studentId: sa.studentId,
                        course: sa.course,
                        yearLevel: sa.yearLevel,
                        category: sa.category,
                        department: sa.department,
                        creditedHours: sa.creditedHours,
                        rawHours: sa.rawHours,
                        lunchRule: sa.lunchRule,
                        blocks: sa.blocks || [],
                        classes: sa.classes || [],
                        records: sa.records || {},
                        actionHistory: sa.actionHistory || [],
                        notificationLogs: sa.notificationLogs || [],
                    };
                });

                // Find any ITO relievers
                const relievers = [];
                for (const sa of list) {
                    const relBlocks = (sa.blocks || []).filter(b => (b.location || "").includes("Reliever"));
                    const firstUpper = ((sa.name || "").trim().split(/\s+/)[0] || sa.name).toUpperCase();
                    for (const rb of relBlocks) {
                        const targetRoom = rb.location.replace(/\s*\(ITO Reliever\)/i, "").trim();
                        if (targetRoom.toLowerCase() === roomName.toLowerCase()) {
                            relievers.push({
                                key: `${sa.saId}-${rb.day}-${rb.start}-${rb.end}`,
                                day: rb.day,
                                start: rb.start,
                                end: rb.end,
                                lineText: `${rb.day}- ${formatCompactTime(rb.startLabel)}-${formatCompactTime(rb.endLabel)}- ${firstUpper}`,
                                saName: sa.name,
                                credited: rb.credited,
                            });
                        }
                    }
                }

                rooms.push({
                    key,
                    room: roomName,
                    department: dept,
                    requirementType: (dept === "OFFICE" || roomName === "HR") ? "OFFICE" : "ROOM",
                    partners,
                    relievers
                });
            }

            const term = searchQuery.value.trim().toLowerCase();
            return rooms.filter(g => {
                if (locationFilter.value !== "ALL" && g.room !== locationFilter.value) return false;
                if (!term) return true;
                if (g.room.toLowerCase().includes(term) || g.department.toLowerCase().includes(term)) return true;
                return g.partners.some(p =>
                    (p.name || "").toLowerCase().includes(term) ||
                    (p.studentId || "").toLowerCase().includes(term) ||
                    (p.course || "").toLowerCase().includes(term)
                );
            });
        });

        const switchToPartnerRoom = (roomName) => {
            closeBlockPopover();
            searchQuery.value = roomName || "";
            viewMode.value = "room";
        };

        const switchToSoloSa = (saName) => {
            closeBlockPopover();
            searchQuery.value = saName || "";
            viewMode.value = "grid";
        };

        const getPrimaryPartnerRoom = (sa) => {
            const partnerRooms = (filteredRooms.value || []).filter(r => r.partners && r.partners.some(p => p.saId === sa.saId));
            if (partnerRooms.length) return partnerRooms[0].room;
            return getPrimaryRoom(sa);
        };

        const hasPartnerRoom = (sa) => {
            return (filteredRooms.value || []).some(r => r.partners && r.partners.length >= 2 && r.partners.some(p => p.saId === sa.saId));
        };

        const printCurrentSheet = () => {
            window.print();
        };

        return {
            loading, loadError, load,
            semester, publication, supervisor, staff, summary,
            viewMode, searchQuery, locationFilter, availableLocations,
            filteredStaff, filteredRooms, getPrimaryRoom, getPrimaryPartnerRoom, hasPartnerRoom,
            switchToPartnerRoom, switchToSoloSa, printCurrentSheet,
            DAYS, HOUR_ROWS, PX_PER_HOUR, blockStyle,
            TIME_SLOTS, DAYS_LIST, PARTNER_DAYS, getPeriodStyle, parseMin, getSlotInfo, getSlotStyle,
            activeBlock, toggleBlockPopover, closeBlockPopover,
            selectedSaRecords, openSaRecordsModal, Format
        };
    },

    template: `
    <page-header :title="supervisor ? supervisor.name + ' — S.A. Schedules' : 'My S.A. Team & Schedules'"
                 section="Supervisor"
                 :subtitle="semester ? 'Official published Student Assistant duty schedules for ' + semester.label + '.' : 'Official Student Assistant duty schedules.'">
        <template #actions>
            <div class="flex flex-wrap items-center gap-1 rounded-lg bg-white p-1 border border-line shadow-xs">
                <button @click="closeBlockPopover(); viewMode = 'grid'"
                        class="rounded-md px-3 py-1.5 text-caption font-semibold transition"
                        :class="viewMode === 'grid' ? 'bg-navy text-white' : 'text-muted hover:text-ink'">
                    <app-icon name="User" :size="14" class="inline mr-1" /> Solo Schedule
                </button>
                <button @click="closeBlockPopover(); viewMode = 'room'"
                        class="rounded-md px-3 py-1.5 text-caption font-semibold transition"
                        :class="viewMode === 'room' ? 'bg-navy text-white' : 'text-muted hover:text-ink'">
                    <app-icon name="Users" :size="14" class="inline mr-1" /> With Partner (Room/Lab)
                </button>
                <button @click="closeBlockPopover(); viewMode = 'table'"
                        class="rounded-md px-3 py-1.5 text-caption font-semibold transition"
                        :class="viewMode === 'table' ? 'bg-navy text-white' : 'text-muted hover:text-ink'">
                    <app-icon name="Table" :size="14" class="inline mr-1" /> Table View
                </button>
            </div>
        </template>
    </page-header>

    <div v-if="loading" class="space-y-4" aria-busy="true">
        <div class="h-28 animate-pulse rounded-xl bg-white"></div>
        <div class="h-80 animate-pulse rounded-xl bg-white"></div>
    </div>

    <div v-else-if="loadError" class="card flex flex-col items-center px-6 py-12 text-center">
        <app-icon name="CircleX" :size="28" class="text-danger" />
        <p class="mt-3 text-body font-medium text-ink">Could not load S.A. schedules</p>
        <p class="mt-1 text-caption text-muted">{{ loadError }}</p>
        <button @click="load" class="btn btn-secondary btn-sm mt-4"><app-icon name="RefreshCw" :size="14" /> Try again</button>
    </div>

    <template v-else>
        <!-- Status & Summary Card -->
        <section class="card mb-5 p-5">
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-line pb-4">
                <div>
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="rounded-full px-3 py-1 text-[12px] font-bold uppercase"
                              :class="publication && publication.status === 'PUBLISHED'
                                  ? 'bg-emerald-100 text-emerald-900'
                                  : 'bg-amber-100 text-amber-900'">
                            Schedule Status: {{ publication ? publication.status : 'DRAFT' }}
                        </span>
                        <span v-if="supervisor && supervisor.departments && supervisor.departments.length"
                              class="rounded-full bg-page px-3 py-1 text-[12px] font-semibold text-navy border border-line">
                            Department / Office: {{ supervisor.departments.join(', ') }}
                        </span>
                    </div>
                    <p class="mt-1.5 text-caption text-muted">
                        <template v-if="publication && publication.status === 'PUBLISHED'">
                            Official S.A. duty schedules have been published by the S.A. Coordinator. View each S.A. individually (Solo), inspect their Supporting S.A. Records, or view with their Partner per Laboratory / Room / Office.
                        </template>
                        <template v-else>
                            The S.A. Coordinator has not published the official duty schedule yet. You will receive a notification as soon as it is published.
                        </template>
                    </p>
                </div>
            </div>

            <dl class="mt-4 grid gap-3 sm:grid-cols-3">
                <div class="rounded-lg bg-page px-4 py-3">
                    <dt class="text-caption text-muted">Assigned S.A.s Under Your Supervision</dt>
                    <dd class="mt-0.5 text-[22px] font-bold text-navy">{{ summary.sas }}</dd>
                    <dd class="text-[11px] text-muted">Active Student Assistants</dd>
                </div>
                <div class="rounded-lg bg-page px-4 py-3">
                    <dt class="text-caption text-muted">Assigned Rooms / Offices</dt>
                    <dd class="mt-0.5 text-[22px] font-bold text-sky-900">{{ availableLocations.length }}</dd>
                    <dd class="text-[11px] text-muted">{{ supervisor && supervisor.departments ? supervisor.departments.join(', ') : 'Assigned units' }}</dd>
                </div>
                <div class="rounded-lg bg-page px-4 py-3">
                    <dt class="text-caption text-muted">Total Weekly Credited Duty</dt>
                    <dd class="mt-0.5 text-[22px] font-bold text-emerald-700">{{ summary.hours }} hrs/wk</dd>
                    <dd class="text-[11px] text-muted">{{ summary.blocks }} duty block(s)</dd>
                </div>
            </dl>
        </section>

        <!-- Search & Location Filter -->
        <section class="card mb-4 p-4 flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-wrap items-center gap-3 flex-1">
                <div class="relative w-full sm:w-72">
                    <app-icon name="Search" :size="16" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                    <input v-model="searchQuery"
                           type="search"
                           placeholder="Search S.A., ID, room, or office..."
                           class="input pl-9 w-full" />
                </div>
                <button v-if="searchQuery"
                        @click="searchQuery = ''"
                        type="button"
                        class="btn btn-secondary btn-xs">
                    Clear Filter
                </button>
                <select v-if="availableLocations.length > 1"
                        v-model="locationFilter"
                        class="input sm:w-52"
                        aria-label="Filter by Room or Office">
                    <option value="ALL">All Rooms / Offices ({{ availableLocations.length }})</option>
                    <option v-for="loc in availableLocations" :key="loc" :value="loc">{{ loc }}</option>
                </select>
            </div>
            <div class="flex flex-wrap items-center gap-3 text-[12px] text-muted">
                <span class="inline-flex items-center gap-1.5">
                    <span class="h-3 w-3 rounded bg-amber-200 border border-amber-500"></span> Official Duty
                </span>
                <span class="inline-flex items-center gap-1.5">
                    <span class="h-3 w-3 rounded bg-teal-200 border border-teal-600"></span> ITO Reliever Duty
                </span>
                <span class="inline-flex items-center gap-1.5">
                    <span class="h-3 w-3 rounded bg-sky-200 border border-sky-500"></span> Registrar Class
                </span>
                <span class="font-semibold text-navy ml-1">
                    <template v-if="viewMode === 'room'">
                        Showing {{ filteredRooms.length }} Room / Office schedule(s)
                    </template>
                    <template v-else>
                        Showing {{ filteredStaff.length }} S.A. schedule(s)
                    </template>
                </span>
            </div>
        </section>

        <!-- TABLE VIEW -->
        <section v-if="viewMode === 'table'" class="card overflow-hidden">
            <div v-if="!filteredStaff.length" class="p-12 text-center text-muted">
                <template v-if="!publication || publication.status !== 'PUBLISHED'">
                    Official schedules have not been published yet.
                </template>
                <template v-else>
                    No S.A. schedules match your search filter.
                </template>
            </div>
            <div v-else class="overflow-x-auto">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="border-b border-line bg-page text-[11px] font-bold uppercase tracking-wider text-muted">
                            <th class="py-3 px-4">Student Assistant</th>
                            <th class="py-3 px-4">Category</th>
                            <th class="py-3 px-4">Assigned Room / Office</th>
                            <th class="py-3 px-4">Weekly Duty Schedule &amp; Lunch Rule</th>
                            <th class="py-3 px-4 text-right">Weekly Hours</th>
                            <th class="py-3 px-4 text-right">S.A. Records</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-line text-caption">
                        <tr v-for="sa in filteredStaff" :key="sa.saId" class="hover:bg-page/40 align-top">
                            <td class="py-3.5 px-4">
                                <button type="button" @click="openSaRecordsModal(sa)" class="font-bold text-navy hover:underline text-left">
                                    {{ sa.name }}
                                </button>
                                <div class="text-muted text-[11px]"><span v-if="sa.saNumber" class="font-mono font-semibold text-navy mr-1">{{ sa.saNumber }} ·</span>{{ sa.studentId }} · {{ sa.course }} (Yr {{ sa.yearLevel }})</div>
                            </td>
                            <td class="py-3.5 px-4">
                                <span class="rounded px-2 py-0.5 text-[11px] font-bold uppercase"
                                      :class="sa.department === 'ITO'
                                          ? 'bg-sky-100 text-sky-900'
                                          : (sa.department === 'ACADS' ? 'bg-indigo-100 text-indigo-900' : 'bg-emerald-100 text-emerald-900')">
                                    {{ sa.category }}
                                </span>
                            </td>
                            <td class="py-3.5 px-4">
                                <div class="font-semibold text-ink">{{ sa.location }}</div>
                            </td>
                            <td class="py-3.5 px-4">
                                <div class="flex flex-wrap gap-1.5">
                                    <span v-for="b in sa.blocks" :key="b.id"
                                          class="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px]"
                                          :class="b.location && b.location.includes('Reliever') ? 'border-teal-400 bg-teal-50 text-teal-950' : 'border-line bg-white'">
                                        <strong :class="b.location && b.location.includes('Reliever') ? 'text-teal-900' : 'text-navy'">{{ b.day }}</strong>
                                        <span>{{ b.startLabel }}–{{ b.endLabel }}</span>
                                        <span v-if="b.location && b.location.includes('Reliever')" class="font-semibold text-teal-800">[{{ b.location }}]</span>
                                        <span class="text-muted">({{ b.credited }}h<template v-if="b.hasBreak">, -1h lunch</template>)</span>
                                    </span>
                                </div>
                                <div class="mt-1 text-[11px] text-muted">{{ sa.lunchRule }}</div>
                            </td>
                            <td class="py-3.5 px-4 text-right">
                                <div class="text-[14px] font-bold text-navy">{{ sa.creditedHours }} hrs</div>
                                <div class="text-[11px] text-muted">{{ sa.rawHours }} raw hrs</div>
                            </td>
                            <td class="py-3.5 px-4 text-right">
                                <button type="button" @click="openSaRecordsModal(sa)" class="btn btn-secondary btn-xs">
                                    <app-icon name="FolderCheck" :size="13" /> View Records
                                </button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>

        <!-- WITH PARTNER (LABORATORY / ROOM / OFFICE) VIEW -->
        <section v-else-if="viewMode === 'room'" class="space-y-6">
            <div v-if="!filteredRooms.length" class="card p-12 text-center text-muted">
                <template v-if="!publication || publication.status !== 'PUBLISHED'">
                    Official schedules have not been published yet.
                </template>
                <template v-else>
                    No room or office schedules match your search filter.
                </template>
            </div>

            <div v-for="(grp, grpIdx) in filteredRooms" :key="grp.key"
                 class="card p-5 overflow-x-auto"
                 :style="grpIdx >= 2 ? { contentVisibility: 'auto', containIntrinsicSize: 'auto none auto 760px' } : {}">
                <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 pb-4 border-b border-line mb-4">
                    <div>
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="rounded px-2.5 py-0.5 text-[11px] font-bold uppercase"
                                  :class="grp.department === 'ITO'
                                      ? 'bg-sky-100 text-sky-900'
                                      : (grp.department === 'ACADS' ? 'bg-indigo-100 text-indigo-900' : 'bg-emerald-100 text-emerald-900')">
                                {{ grp.department }}
                            </span>
                            <h3 class="text-[18px] font-bold text-navy">
                                {{ grp.requirementType === 'OFFICE' ? grp.room : 'Room / Lab ' + grp.room }}
                            </h3>
                            <span class="rounded-full bg-page px-2.5 py-0.5 text-[11px] font-semibold text-muted border border-line">
                                {{ grp.partners.length }} Assigned S.A.(s)
                            </span>
                        </div>

                        <div class="mt-3 flex flex-wrap gap-2.5">
                            <div v-for="(p, pIdx) in grp.partners" :key="p.saId"
                                 class="flex items-center gap-3 rounded-lg border border-line bg-page/60 px-3 py-2">
                                <div>
                                    <div class="text-[13px] font-bold text-navy">
                                        {{ pIdx + 1 }}. {{ p.name }}
                                        <span class="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-900">
                                            {{ p.creditedHours }}h/wk
                                        </span>
                                    </div>
                                    <div class="text-[11px] text-muted">
                                        <span v-if="p.saNumber" class="font-mono font-semibold text-navy mr-1">{{ p.saNumber }} ·</span>{{ p.studentId }} · {{ p.course }} (Yr {{ p.yearLevel }})
                                    </div>
                                </div>
                                <div class="flex items-center gap-1.5 shrink-0">
                                    <button type="button"
                                            @click="openSaRecordsModal(p)"
                                            class="btn btn-secondary btn-xs"
                                            title="View Supporting S.A. Records & Timeline">
                                        <app-icon name="FolderCheck" :size="12" /> Records
                                    </button>
                                    <button type="button"
                                            @click="switchToSoloSa(p.name)"
                                            class="btn btn-secondary btn-xs"
                                            title="View Solo Schedule">
                                        <app-icon name="User" :size="12" /> Solo
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Top Reliever Box for ITO Rooms -->
                    <div v-if="grp.relievers && grp.relievers.length"
                         class="rounded-xl border border-teal-300 bg-teal-50/70 px-3.5 py-2.5 text-left min-w-[240px]">
                        <div class="text-[11px] font-extrabold uppercase tracking-wider text-teal-900 mb-1">
                            RELIEVER:
                        </div>
                        <ul class="space-y-0.5 text-[12px] font-bold text-teal-950">
                            <li v-for="rel in grp.relievers" :key="rel.key" class="flex items-center justify-between gap-2">
                                <span>{{ rel.lineText }}</span>
                                <button type="button"
                                        @click="switchToSoloSa(rel.saName)"
                                        class="text-[10px] font-semibold text-teal-800 underline hover:text-navy">
                                    View Solo
                                </button>
                            </li>
                        </ul>
                    </div>
                </div>

                <!-- Master Room Schedule Sheet (Modern Calendar Grid Layout - Image 4 Style) -->
                <div class="mt-2">
                    <div class="flex flex-wrap items-center justify-between gap-2 mb-2 text-xs text-muted">
                        <div class="flex flex-wrap items-center gap-3">
                            <span class="inline-flex items-center gap-1.5 font-medium text-emerald-900">
                                <span class="h-2.5 w-2.5 rounded bg-emerald-500"></span> Official Duty (Partner 1)
                            </span>
                            <span class="inline-flex items-center gap-1.5 font-medium text-amber-900">
                                <span class="h-2.5 w-2.5 rounded bg-amber-400"></span> Official Duty (Partner 2)
                            </span>
                            <span class="inline-flex items-center gap-1.5 font-medium text-teal-900">
                                <span class="h-2.5 w-2.5 rounded bg-teal-500"></span> ITO Reliever Duty
                            </span>
                            <span class="inline-flex items-center gap-1.5 font-medium text-sky-900">
                                <span class="h-2.5 w-2.5 rounded bg-sky-400"></span> Registrar Class
                            </span>
                        </div>
                        <button type="button" @click="printCurrentSheet" class="btn btn-secondary btn-xs">
                            <app-icon name="Printer" :size="12" /> Print Sheet
                        </button>
                    </div>

                    <div class="overflow-auto rounded-xl border border-line bg-white shadow-card max-h-[66vh]" @click="closeBlockPopover">
                        <div class="min-w-[980px]">
                            <!-- Dark Navy Header Row with Room & Partners -->
                            <div class="sticky top-0 z-30 grid grid-cols-[140px_repeat(6,minmax(0,1fr))] bg-navy text-white text-[12px] font-bold shadow-xs">
                                <div class="sticky left-0 z-40 bg-navy px-2 py-2.5 border-r border-navy-700 flex items-center justify-center uppercase tracking-wider text-[11px]">
                                    TIME
                                </div>
                                <div v-for="d in DAYS_LIST" :key="d.code" class="border-r border-navy-700 last:border-r-0">
                                    <div class="px-2 py-1.5 text-center border-b border-navy-700 uppercase tracking-wider text-[11px]">{{ d.label }}</div>
                                    <div class="grid divide-x divide-navy-700 bg-navy-800/90 text-[10px] font-semibold text-sky-100"
                                         :style="{ gridTemplateColumns: 'repeat(' + Math.max(1, grp.partners.length) + ', minmax(0, 1fr))' }">
                                        <div v-for="(p, pIdx) in grp.partners" :key="p.saId" class="px-1 py-1 text-center truncate" :title="p.name">
                                            {{ pIdx + 1 }}. {{ p.firstName }}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <!-- 7 AM to 10 PM Grid Body (30 slots x 36px = 1080px total height) -->
                            <div class="relative grid grid-cols-[140px_repeat(6,minmax(0,1fr))] select-none" style="height: 1080px;">
                                <!-- Sticky Left Time Column -->
                                <div class="sticky left-0 z-20 bg-mist/90 border-r border-line text-[11px] font-bold text-navy">
                                    <div v-for="t in TIME_SLOTS" :key="t.min"
                                         class="h-9 px-1 flex items-center justify-center border-b border-line/40 text-[10px] font-bold text-navy whitespace-nowrap">
                                        {{ t.label }}
                                    </div>
                                </div>

                                <!-- 6 Day Columns with Partner Sub-Columns -->
                                <div v-for="d in DAYS_LIST" :key="d.code" class="relative border-r border-line last:border-r-0 bg-white">
                                    <div class="grid h-full divide-x divide-line/60"
                                         :style="{ gridTemplateColumns: 'repeat(' + Math.max(1, grp.partners.length) + ', minmax(0, 1fr))' }">
                                        <div v-for="(p, pIdx) in grp.partners" :key="p.saId" class="relative h-full">
                                            <!-- 30 Slot Background Grid Lines -->
                                            <div v-for="t in TIME_SLOTS" :key="t.min" class="h-9 border-b border-line/40"></div>

                                            <!-- Partner Classes -->
                                            <div v-for="(cls, ci) in (p.classes || []).filter(c => c.day === d.code)" :key="'pc-' + ci"
                                                 @click.stop="toggleBlockPopover(p, cls, 'CLASS', d, grp.key)"
                                                 :style="getPeriodStyle(cls)"
                                                 :title="p.name + ' · CLASS: ' + cls.subject + ' (' + cls.startLabel + '–' + cls.endLabel + ')'"
                                                 class="absolute left-0.5 right-0.5 rounded border border-sky-500 bg-sky-100/95 px-1 py-0.5 text-[9.5px] leading-tight text-sky-950 overflow-hidden cursor-pointer hover:ring-2 hover:ring-sky-500 transition">
                                                <div class="font-bold truncate">CLASS: {{ cls.subject }}</div>
                                                <div class="truncate">{{ cls.startLabel }}–{{ cls.endLabel }}</div>
                                            </div>

                                            <!-- Partner Duty Blocks -->
                                            <div v-for="(b, bi) in (p.blocks || []).filter(u => u.day === d.code)" :key="'pd-' + bi"
                                                 @click.stop="toggleBlockPopover(p, b, 'DUTY', d, grp.key)"
                                                 :style="getPeriodStyle(b)"
                                                 :title="p.name + ' · DUTY: ' + b.location + ' (' + b.credited + 'h) · ' + b.startLabel + '–' + b.endLabel"
                                                 class="absolute left-0.5 right-0.5 rounded border px-1 py-0.5 text-[9.5px] leading-tight overflow-hidden cursor-pointer transition"
                                                 :class="b.location && b.location.includes('Reliever')
                                                     ? 'border-teal-600 bg-teal-100/95 text-teal-950 hover:ring-2 hover:ring-teal-600'
                                                     : (pIdx === 0 ? 'border-emerald-600 bg-emerald-100/95 text-emerald-950 hover:ring-2 hover:ring-emerald-600' : 'border-amber-500 bg-amber-100/95 text-amber-950 hover:ring-2 hover:ring-amber-500')">
                                                <div class="font-bold truncate">{{ p.firstName }}: {{ b.location }} ({{ b.credited }}h)</div>
                                                <div class="truncate">{{ b.startLabel }}–{{ b.endLabel }}</div>
                                                <div v-if="b.hasBreak" class="text-[8.5px] font-semibold truncate" :class="b.location && b.location.includes('Reliever') ? 'text-teal-800' : (pIdx === 0 ? 'text-emerald-800' : 'text-amber-800')">-1h lunch</div>
                                            </div>
                                        </div>
                                    </div>

                                    <!-- Floating Popover Card ("Lulutang") -->
                                    <div v-if="activeBlock && activeBlock.contextKey === grp.key && activeBlock.dayCode === d.code"
                                         @click.stop
                                         class="absolute z-40 w-64 rounded-xl border bg-white p-3 shadow-xl ring-1 ring-navy/10"
                                         :class="[
                                             activeBlock.alignRight ? 'right-1' : 'left-1',
                                             activeBlock.type === 'RELIEVER' ? 'border-teal-500' : (activeBlock.type === 'CLASS' ? 'border-sky-500' : 'border-emerald-500')
                                         ]"
                                         :style="activeBlock.popoverStyle">
                                        <div class="flex items-start justify-between gap-2">
                                            <span class="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                                                  :class="activeBlock.type === 'RELIEVER' ? 'bg-teal-100 text-teal-900' : (activeBlock.type === 'CLASS' ? 'bg-sky-100 text-sky-900' : 'bg-emerald-100 text-emerald-900')">
                                                {{ activeBlock.badgeLabel }}
                                            </span>
                                            <button type="button" @click.stop="closeBlockPopover" class="rounded p-0.5 text-muted hover:bg-page hover:text-ink">
                                                <app-icon name="X" :size="14" />
                                            </button>
                                        </div>
                                        <div class="mt-1.5 text-[11px] font-bold uppercase text-muted">{{ activeBlock.ownerName }}</div>
                                        <div class="mt-0.5 text-[13px] font-bold text-navy break-words">{{ activeBlock.title }}</div>
                                        <div class="mt-1 text-[12px] font-semibold text-ink">{{ activeBlock.dayLabel }} · {{ activeBlock.timeLabel }}</div>
                                        <div class="mt-0.5 text-[11px] text-muted">{{ activeBlock.hoursLabel }}</div>
                                        <div v-if="activeBlock.lunchNote" class="mt-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 border border-amber-200">
                                            {{ activeBlock.lunchNote }}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <!-- SOLO WEEKLY GRID VIEW -->
        <section v-else class="space-y-6">
            <div v-if="!filteredStaff.length" class="card p-12 text-center text-muted">
                <template v-if="!publication || publication.status !== 'PUBLISHED'">
                    Official schedules have not been published yet.
                </template>
                <template v-else>
                    No S.A. schedules match your search filter.
                </template>
            </div>

            <div v-for="(sa, saIdx) in filteredStaff" :key="sa.saId"
                 class="card p-5 overflow-x-auto"
                 :style="saIdx >= 2 ? { contentVisibility: 'auto', containIntrinsicSize: 'auto none auto 720px' } : {}">
                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-line mb-4">
                    <div>
                        <div class="flex flex-wrap items-center gap-2">
                            <h3 class="text-[17px] font-bold text-navy">{{ sa.name }}</h3>
                            <span class="rounded px-2 py-0.5 text-[11px] font-bold uppercase"
                                  :class="sa.department === 'ITO'
                                      ? 'bg-sky-100 text-sky-900'
                                      : (sa.department === 'ACADS' ? 'bg-indigo-100 text-indigo-900' : 'bg-emerald-100 text-emerald-900')">
                                {{ sa.category }}
                            </span>
                            <span class="text-caption text-muted">(<span v-if="sa.saNumber" class="font-mono font-semibold text-navy mr-1">{{ sa.saNumber }} · </span>{{ sa.studentId }} · {{ sa.course }} · Yr {{ sa.yearLevel }})</span>
                        </div>
                        <p class="text-caption text-muted mt-0.5">
                            Assigned to <strong class="text-ink">{{ sa.location }}</strong> ·
                            <strong class="text-navy">{{ sa.creditedHours }} credited hrs/wk</strong> ({{ sa.rawHours }} raw hrs) ·
                            <span>{{ sa.lunchRule }}</span>
                        </p>
                    </div>
                    <div class="flex flex-wrap items-center gap-2 shrink-0">
                        <button type="button"
                                @click="openSaRecordsModal(sa)"
                                class="btn btn-secondary btn-xs">
                            <app-icon name="FolderCheck" :size="13" />
                            View S.A. Records
                        </button>
                        <button v-if="hasPartnerRoom(sa)"
                                type="button"
                                @click="switchToPartnerRoom(getPrimaryPartnerRoom(sa))"
                                class="btn btn-secondary btn-xs">
                            <app-icon name="Users" :size="13" />
                            View With Partner ({{ getPrimaryPartnerRoom(sa) }})
                        </button>
                    </div>
                </div>

                <!-- Supporting S.A. Records & Activity Timeline inside My S.A. Team -->
                <div class="mb-4 space-y-2.5">
                    <details class="group rounded-xl border border-line bg-page/40 open:bg-white open:shadow-xs">
                        <summary class="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-xs font-extrabold uppercase tracking-wider text-navy">
                            <span class="flex items-center gap-2">
                                <app-icon name="FolderCheck" :size="15" />
                                Supporting S.A. Records (Duty Hours, Disciplinary &amp; Academic Standing)
                            </span>
                            <span class="text-[11px] font-semibold text-muted group-open:rotate-180 transition">▼</span>
                        </summary>
                        <div class="grid grid-cols-1 gap-3 border-t border-line px-4 py-3.5 text-xs sm:grid-cols-3">
                            <div class="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                <p class="text-[10px] font-bold uppercase text-muted">Disciplinary Standing</p>
                                <p class="mt-1 font-extrabold" :class="(sa.records?.disciplinaryStatus || 'GOOD_STANDING') === 'GOOD_STANDING' ? 'text-emerald-700' : 'text-amber-700'">
                                    {{ (sa.records?.disciplinaryStatus || 'GOOD_STANDING').replace(/_/g, ' ') }}
                                    ({{ sa.records?.warningCount || 0 }} memo{{ (sa.records?.warningCount || 0) === 1 ? '' : 's' }})
                                </p>
                            </div>
                            <div class="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                <p class="text-[10px] font-bold uppercase text-muted">Credited Duty Hours</p>
                                <p class="mt-1 font-extrabold text-navy">
                                    {{ sa.records?.creditedHours ?? sa.creditedHours ?? 0 }} / {{ sa.records?.weeklyTargetHours || 35 }} hrs
                                </p>
                            </div>
                            <div class="rounded-xl border border-slate-200 bg-slate-50 p-3">
                                <p class="text-[10px] font-bold uppercase text-muted">Academic &amp; Enrollment Status</p>
                                <p class="mt-1 font-extrabold text-navy">
                                    {{ sa.records?.academicStatus || 'REGULAR' }} • {{ sa.records?.enrollmentStatus || 'ENROLLED' }}
                                </p>
                            </div>
                        </div>
                    </details>

                    <details class="group rounded-xl border border-line bg-page/40 open:bg-white open:shadow-xs">
                        <summary class="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-xs font-extrabold uppercase tracking-wider text-navy">
                            <span class="flex items-center gap-2">
                                <app-icon name="History" :size="15" />
                                Activity Timeline ({{ sa.actionHistory?.length || 0 }}) &amp; Notification Delivery Log ({{ sa.notificationLogs?.length || 0 }})
                            </span>
                            <span class="text-[11px] font-semibold text-muted group-open:rotate-180 transition">▼</span>
                        </summary>
                        <div class="grid grid-cols-1 gap-4 border-t border-line px-4 py-3.5 lg:grid-cols-2">
                            <div>
                                <h4 class="mb-2 text-xs font-bold uppercase text-muted">Workflow Action &amp; Return Timeline</h4>
                                <div v-if="!sa.actionHistory?.length" class="text-xs text-muted">No workflow actions recorded yet.</div>
                                <div v-else class="max-h-52 space-y-2 overflow-y-auto pr-1">
                                    <div v-for="act in sa.actionHistory" :key="act.id" class="rounded-xl border border-slate-100 bg-slate-50 p-2.5 text-xs">
                                        <div class="flex flex-wrap items-center justify-between gap-1">
                                            <span class="font-bold text-navy">{{ act.actionType.replace(/_/g, ' ') }}</span>
                                            <span class="text-[10px] text-slate-500">{{ Format.dateTime(act.createdAt) }}</span>
                                        </div>
                                        <p class="mt-0.5 text-[11px] font-semibold text-slate-700">
                                            By {{ act.actorName }} ({{ act.actorRole }})
                                            <span v-if="act.toStatus" class="text-slate-500"> • Stage: {{ act.toStatus }}</span>
                                        </p>
                                        <p v-if="act.remarks" class="mt-1 text-[11px] text-slate-600">{{ act.remarks }}</p>
                                    </div>
                                </div>
                            </div>
                            <div>
                                <h4 class="mb-2 text-xs font-bold uppercase text-muted">Notification &amp; Reminder Delivery Log</h4>
                                <div v-if="!sa.notificationLogs?.length" class="text-xs text-muted">No notifications logged yet.</div>
                                <div v-else class="max-h-52 space-y-2 overflow-y-auto pr-1">
                                    <div v-for="nl in sa.notificationLogs" :key="nl.id" class="rounded-xl border border-slate-100 bg-slate-50 p-2.5 text-xs">
                                        <div class="flex flex-wrap items-center justify-between gap-1">
                                            <span class="font-bold text-slate-800">{{ nl.channel }}: {{ nl.subject }}</span>
                                            <span class="rounded px-1.5 py-0.5 text-[10px] font-bold"
                                                  :class="nl.deliveryStatus === 'SENT' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'">
                                                {{ nl.deliveryStatus }}
                                            </span>
                                        </div>
                                        <p class="mt-0.5 text-[11px] text-slate-600">
                                            To: {{ nl.recipientName }} • {{ Format.dateTime(nl.createdAt) }}
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </details>
                </div>

                <div class="min-w-[860px]">
                    <div class="grid grid-cols-7 border-b border-line bg-page text-caption font-bold text-navy">
                        <div class="p-2.5 border-r border-line">Time</div>
                        <div v-for="day in DAYS" :key="day.code" class="p-2.5 border-r border-line text-center">
                            {{ day.label }}
                        </div>
                    </div>

                    <div class="grid grid-cols-7 relative" :style="{ height: (HOUR_ROWS.length * PX_PER_HOUR) + 'px' }" @click="closeBlockPopover">
                        <div class="border-r border-line bg-page/40">
                            <div v-for="row in HOUR_ROWS" :key="row.start"
                                 class="border-b border-line/70 px-2 py-1 text-[11px] font-medium text-muted"
                                 :style="{ height: PX_PER_HOUR + 'px' }">
                                {{ row.label }}
                            </div>
                        </div>

                        <div v-for="day in DAYS" :key="day.code" class="relative border-r border-line bg-white">
                            <div v-for="row in HOUR_ROWS" :key="row.start"
                                 class="border-b border-line/50"
                                 :style="{ height: PX_PER_HOUR + 'px' }"></div>

                            <!-- Registrar Classes -->
                            <div v-for="(cls, ci) in (sa.classes || []).filter(c => c.day === day.code)" :key="'c-' + ci"
                                 @click.stop="toggleBlockPopover(sa, cls, 'CLASS', day, 'solo')"
                                 class="absolute left-1 right-1 rounded border border-sky-500 bg-sky-100/95 px-1.5 py-0.5 text-[10px] leading-tight text-sky-950 overflow-hidden cursor-pointer hover:ring-2 hover:ring-sky-500 transition"
                                 :style="blockStyle(cls.start, cls.end)">
                                <div class="font-bold truncate">CLASS: {{ cls.subject }}</div>
                                <div class="truncate">{{ cls.startLabel }}–{{ cls.endLabel }}</div>
                            </div>

                            <!-- Official Duty Blocks -->
                            <div v-for="(b, bi) in (sa.blocks || []).filter(d => d.day === day.code)" :key="'d-' + bi"
                                 @click.stop="toggleBlockPopover(sa, b, 'DUTY', day, 'solo')"
                                 class="absolute left-1 right-1 rounded border px-1.5 py-0.5 text-[10px] leading-tight overflow-hidden cursor-pointer transition"
                                 :class="b.location && b.location.includes('Reliever')
                                     ? 'border-teal-600 bg-teal-100/95 text-teal-950 hover:ring-2 hover:ring-teal-600'
                                     : 'border-amber-500 bg-amber-100/95 text-amber-950 hover:ring-2 hover:ring-amber-500'"
                                 :style="blockStyle(b.start, b.end)">
                                <div class="font-bold truncate">DUTY: {{ b.location }} ({{ b.credited }}h)</div>
                                <div class="truncate">{{ b.startLabel }}–{{ b.endLabel }}</div>
                                <div v-if="b.hasBreak" class="text-[9px] font-semibold truncate" :class="b.location && b.location.includes('Reliever') ? 'text-teal-800' : 'text-amber-800'">-1h lunch break</div>
                            </div>

                            <!-- Floating Popover Card ("Lulutang") -->
                            <div v-if="activeBlock && activeBlock.contextKey === 'solo' && activeBlock.saId === sa.saId && activeBlock.dayCode === day.code"
                                 @click.stop
                                 class="absolute z-40 w-64 rounded-xl border bg-white p-3 shadow-xl ring-1 ring-navy/10"
                                 :class="[
                                     activeBlock.alignRight ? 'right-1' : 'left-1',
                                     activeBlock.type === 'RELIEVER'
                                         ? 'border-teal-500'
                                         : (activeBlock.type === 'CLASS' ? 'border-sky-500' : 'border-amber-500')
                                 ]"
                                 :style="activeBlock.popoverStyle">
                                <div class="flex items-start justify-between gap-2">
                                    <span class="rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                                          :class="activeBlock.type === 'RELIEVER'
                                              ? 'bg-teal-100 text-teal-900'
                                              : (activeBlock.type === 'CLASS' ? 'bg-sky-100 text-sky-900' : 'bg-amber-100 text-amber-900')">
                                        {{ activeBlock.badgeLabel }}
                                    </span>
                                    <button type="button" @click.stop="closeBlockPopover" class="rounded p-0.5 text-muted hover:bg-page hover:text-ink">
                                        <app-icon name="X" :size="14" />
                                    </button>
                                </div>
                                <div class="mt-2 text-[13px] font-bold text-navy break-words">{{ activeBlock.title }}</div>
                                <div class="mt-1 text-[12px] font-semibold text-ink">{{ activeBlock.dayLabel }} · {{ activeBlock.timeLabel }}</div>
                                <div class="mt-0.5 text-[11px] text-muted">{{ activeBlock.hoursLabel }}</div>
                                <div v-if="activeBlock.lunchNote" class="mt-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 border border-amber-200">
                                    {{ activeBlock.lunchNote }}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <!-- S.A. Records Modal (Opened when Supervisor views a specific Student Assistant in My S.A. Team) -->
        <app-modal :open="Boolean(selectedSaRecords)"
                   :title="selectedSaRecords ? selectedSaRecords.name + ' — S.A. Records & Activity Log' : 'S.A. Records'"
                   @close="selectedSaRecords = null">
            <div v-if="selectedSaRecords" class="space-y-4">
                <div class="rounded-xl border border-line bg-page p-3.5 text-xs">
                    <p class="font-bold text-navy">{{ selectedSaRecords.name }} (<span v-if="selectedSaRecords.saNumber" class="font-mono">{{ selectedSaRecords.saNumber }} · </span>{{ selectedSaRecords.studentId }})</p>
                    <p class="mt-0.5 text-muted">
                        {{ selectedSaRecords.course }} (Yr {{ selectedSaRecords.yearLevel }}) · Assigned to <strong>{{ selectedSaRecords.location }}</strong>
                    </p>
                </div>

                <div>
                    <h4 class="mb-2 flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-navy">
                        <app-icon name="FolderCheck" :size="15" />
                        Supporting S.A. Records (Duty Hours, Disciplinary &amp; Academic Standing)
                    </h4>
                    <div class="grid grid-cols-1 gap-3 text-xs sm:grid-cols-3">
                        <div class="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <p class="text-[10px] font-bold uppercase text-muted">Disciplinary Standing</p>
                            <p class="mt-1 font-extrabold" :class="(selectedSaRecords.records?.disciplinaryStatus || 'GOOD_STANDING') === 'GOOD_STANDING' ? 'text-emerald-700' : 'text-amber-700'">
                                {{ (selectedSaRecords.records?.disciplinaryStatus || 'GOOD_STANDING').replace(/_/g, ' ') }}
                                ({{ selectedSaRecords.records?.warningCount || 0 }} memo{{ (selectedSaRecords.records?.warningCount || 0) === 1 ? '' : 's' }})
                            </p>
                        </div>
                        <div class="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <p class="text-[10px] font-bold uppercase text-muted">Credited Duty Hours</p>
                            <p class="mt-1 font-extrabold text-navy">
                                {{ selectedSaRecords.records?.creditedHours ?? selectedSaRecords.creditedHours ?? 0 }} / {{ selectedSaRecords.records?.weeklyTargetHours || 35 }} hrs
                            </p>
                        </div>
                        <div class="rounded-xl border border-slate-200 bg-slate-50 p-3">
                            <p class="text-[10px] font-bold uppercase text-muted">Academic &amp; Enrollment Status</p>
                            <p class="mt-1 font-extrabold text-navy">
                                {{ selectedSaRecords.records?.academicStatus || 'REGULAR' }} • {{ selectedSaRecords.records?.enrollmentStatus || 'ENROLLED' }}
                            </p>
                        </div>
                    </div>
                </div>

                <div class="space-y-3 border-t border-line pt-3">
                    <h4 class="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-navy">
                        <app-icon name="History" :size="15" />
                        Activity Timeline ({{ selectedSaRecords.actionHistory?.length || 0 }}) &amp; Notification Delivery Log ({{ selectedSaRecords.notificationLogs?.length || 0 }})
                    </h4>
                    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                            <p class="mb-1.5 text-[11px] font-bold uppercase text-muted">Workflow Action &amp; Return Timeline</p>
                            <div v-if="!selectedSaRecords.actionHistory?.length" class="rounded-lg bg-slate-50 p-3 text-xs text-muted">
                                No workflow actions recorded yet.
                            </div>
                            <div v-else class="max-h-48 space-y-2 overflow-y-auto pr-1">
                                <div v-for="act in selectedSaRecords.actionHistory" :key="act.id" class="rounded-xl border border-slate-100 bg-slate-50 p-2.5 text-xs">
                                    <div class="flex flex-wrap items-center justify-between gap-1">
                                        <span class="font-bold text-navy">{{ act.actionType.replace(/_/g, ' ') }}</span>
                                        <span class="text-[10px] text-slate-500">{{ Format.dateTime(act.createdAt) }}</span>
                                    </div>
                                    <p class="mt-0.5 text-[11px] font-semibold text-slate-700">
                                        By {{ act.actorName }} ({{ act.actorRole }})
                                    </p>
                                    <p v-if="act.remarks" class="mt-1 text-[11px] text-slate-600">{{ act.remarks }}</p>
                                </div>
                            </div>
                        </div>
                        <div>
                            <p class="mb-1.5 text-[11px] font-bold uppercase text-muted">Notification &amp; Reminder Delivery Log</p>
                            <div v-if="!selectedSaRecords.notificationLogs?.length" class="rounded-lg bg-slate-50 p-3 text-xs text-muted">
                                No notifications logged yet.
                            </div>
                            <div v-else class="max-h-48 space-y-2 overflow-y-auto pr-1">
                                <div v-for="nl in selectedSaRecords.notificationLogs" :key="nl.id" class="rounded-xl border border-slate-100 bg-slate-50 p-2.5 text-xs">
                                    <div class="flex flex-wrap items-center justify-between gap-1">
                                        <span class="font-bold text-slate-800">{{ nl.channel }}: {{ nl.subject }}</span>
                                        <span class="rounded px-1.5 py-0.5 text-[10px] font-bold"
                                              :class="nl.deliveryStatus === 'SENT' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'">
                                            {{ nl.deliveryStatus }}
                                        </span>
                                    </div>
                                    <p class="mt-0.5 text-[11px] text-slate-600">
                                        To: {{ nl.recipientName }} • {{ Format.dateTime(nl.createdAt) }}
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <template #footer>
                <div class="flex items-center justify-end">
                    <button type="button" @click="selectedSaRecords = null" class="btn btn-primary btn-sm">Close</button>
                </div>
            </template>
        </app-modal>
    </template>
    `
};

const SupervisorDashboardPage = {
    components: { AppIcon, PageHeader, StatusBadge },

    setup() {
        const loading = Vue.ref(true);
        const loadError = Vue.ref("");
        const data = Vue.ref(null);
        const requestsSummary = Vue.ref(null);

        const load = async () => {
            loading.value = true;
            loadError.value = "";
            try {
                const [dashRes, reqRes] = await Promise.all([
                    Model.request("dashboard", "supervisor_summary"),
                    Model.request("requests", "team_requests").catch(() => null)
                ]);
                loading.value = false;
                if (!dashRes || !dashRes.success) {
                    loadError.value = dashRes?.message || "Could not load your Supervisor dashboard.";
                    return;
                }
                data.value = dashRes;
                if (reqRes && reqRes.success && reqRes.summary) {
                    requestsSummary.value = reqRes.summary;
                }
            } catch (err) {
                loading.value = false;
                loadError.value = err?.message || "Could not load your Supervisor dashboard.";
            }
        };

        Vue.onMounted(load);

        const assignedSasCount = Vue.computed(() => {
            return data.value?.summaryCards?.assignedSasCount ?? 0;
        });

        const presentTodayCount = Vue.computed(() => {
            if (!data.value?.todayDeployments?.items) return 0;
            return data.value.todayDeployments.items.filter(dep =>
                dep.verificationStatus === 'ON_DUTY_NOW' || dep.verificationStatus === 'COMPLETED'
            ).length;
        });

        const lateTodayCount = Vue.computed(() => {
            const today = data.value?.todayDeployments?.date;
            let count = 0;
            const records = data.value?.attendanceVerification?.records || [];
            const countedSaIds = new Set();
            for (const r of records) {
                const cat = (r.category || '').toUpperCase();
                if ((cat === 'TARDY' || cat === 'LATE') && (!today || r.incidentDate === today)) {
                    count++;
                    if (r.saId) countedSaIds.add(r.saId);
                }
            }
            const items = data.value?.todayDeployments?.items || [];
            for (const dep of items) {
                const lbl = (dep.verificationLabel || '').toUpperCase();
                if ((lbl.includes('TARDY') || lbl.includes('LATE')) && !countedSaIds.has(dep.saId)) {
                    count++;
                }
            }
            return count;
        });

        const absentTodayCount = Vue.computed(() => {
            const today = data.value?.todayDeployments?.date;
            let count = 0;
            const records = data.value?.attendanceVerification?.records || [];
            const countedSaIds = new Set();
            for (const r of records) {
                const cat = (r.category || '').toUpperCase();
                if (cat === 'ABSENT' && (!today || r.incidentDate === today)) {
                    count++;
                    if (r.saId) countedSaIds.add(r.saId);
                }
            }
            const items = data.value?.todayDeployments?.items || [];
            for (const dep of items) {
                const lbl = (dep.verificationLabel || '').toUpperCase();
                if (lbl.includes('ABSENT') && !countedSaIds.has(dep.saId)) {
                    count++;
                }
            }
            return count;
        });

        const pendingReviewsCount = Vue.computed(() => {
            return data.value?.summaryCards?.attendanceVerificationCount
                ?? data.value?.attendanceVerification?.pendingCount
                ?? 0;
        });

        const pendingRequestsCount = Vue.computed(() => {
            if (!requestsSummary.value) return 0;
            return (requestsSummary.value.pendingSupervisorReview || 0)
                + (requestsSummary.value.returnedForClarification || 0);
        });

        const notifIcon = (type) => {
            const t = (type || "").toUpperCase();
            if (t.includes("EVAL")) return "ClipboardCheck";
            if (t.includes("ATTENDANCE") || t.includes("CORRECTION") || t.includes("DUTY")) return "Clock";
            if (t.includes("REQUEST") || t.includes("OVERTIME") || t.includes("EXCUSE") || t.includes("UNDERTIME")) return "FileText";
            if (t.includes("SCHEDULE")) return "CalendarDays";
            return "BellRing";
        };

        const totalScheduledShifts = Vue.computed(() => {
            return (data.value?.todayDeployments?.items || []).length;
        });

        const completedShiftsCount = Vue.computed(() => {
            return (data.value?.todayDeployments?.items || []).filter(d => d.verificationStatus === 'COMPLETED').length;
        });

        const onDutyShiftsCount = Vue.computed(() => {
            return (data.value?.todayDeployments?.items || []).filter(d => d.verificationStatus === 'ON_DUTY_NOW').length;
        });

        const unreadNotifsCount = Vue.computed(() => {
            return (data.value?.notifications || []).filter(n => !n.isRead).length;
        });

        const evalStatusBadge = (st) => {
            const map = {
                PENDING_SUPERVISOR: { label: "Pending Your Submission", cls: "bg-amber-100 text-amber-900 border border-amber-200" },
                RETURNED_FOR_REVISION: { label: "Returned for Revision", cls: "bg-danger/10 text-danger border border-danger/20" },
                FOR_SA_REVIEW: { label: "Awaiting S.A. Ack", cls: "bg-sky-100 text-sky-900 border border-sky-200" },
                FOR_COORDINATOR_REVIEW: { label: "With Coordinator", cls: "bg-indigo-100 text-indigo-900 border border-indigo-200" },
                FINALIZED: { label: "Finalized", cls: "bg-emerald-100 text-emerald-900 border border-emerald-200" },
            };
            return map[st] || { label: st || "Pending", cls: "bg-page text-muted border border-line" };
        };

        const verifyBadgeClass = (st) => {
            if (st === "INCIDENT_LOGGED") return "bg-rose-50 text-rose-700 border-rose-200";
            if (st === "ON_DUTY_NOW") return "bg-emerald-50 text-emerald-700 border-emerald-200";
            if (st === "COMPLETED") return "bg-sky-50 text-sky-700 border-sky-200";
            return "bg-amber-50 text-amber-700 border-amber-200";
        };

        const markNotificationRead = async (notif) => {
            if (!notif || notif.isRead) return;
            notif.isRead = true;
            await Model.request("notifications", "mark_read", { id: notif.id });
            if (Store.loadNotifications) Store.loadNotifications();
        };

        return {
            loading, loadError, load, data, requestsSummary,
            assignedSasCount, presentTodayCount, lateTodayCount, absentTodayCount,
            pendingReviewsCount, pendingRequestsCount,
            totalScheduledShifts, completedShiftsCount, onDutyShiftsCount, unreadNotifsCount,
            notifIcon, evalStatusBadge, verifyBadgeClass, markNotificationRead, Format
        };
    },

    template: `
    <page-header :title="data?.supervisor ? data.supervisor.name + ' — Supervisor Dashboard' : 'Supervisor Dashboard'"
                 section="Supervisor"
                 :subtitle="data?.supervisor ? 'Authorized Scope: ' + data.supervisor.scopeLabel + ' · Monitor assigned deployments, attendance verification, and evaluation tasks.' : 'Monitor assigned deployments, attendance verification, and evaluation tasks.'">
        <template #actions>
            <router-link to="/supervisor/team" class="btn btn-secondary btn-sm">
                <app-icon name="CalendarDays" :size="14" /> My S.A. Team &amp; Weekly Grid
            </router-link>
            <router-link to="/supervisor/evaluations" class="btn btn-primary btn-sm">
                <app-icon name="ClipboardList" :size="14" /> S.A. Performance Evaluation
            </router-link>
        </template>
    </page-header>

    <div v-if="loading" class="space-y-4" aria-busy="true">
        <div class="grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
            <div v-for="i in 6" :key="i" class="h-24 animate-pulse rounded-xl bg-white"></div>
        </div>
        <div class="grid gap-5 lg:grid-cols-2">
            <div v-for="i in 4" :key="i" class="h-64 animate-pulse rounded-xl bg-white"></div>
        </div>
    </div>

    <div v-else-if="loadError" class="card flex flex-col items-center px-6 py-12 text-center">
        <app-icon name="CircleX" :size="28" class="text-danger" />
        <p class="mt-3 text-body font-medium text-ink">Could not load Supervisor dashboard</p>
        <p class="mt-1 text-caption text-muted">{{ loadError }}</p>
        <button @click="load" class="btn btn-secondary btn-sm mt-4">
            <app-icon name="RefreshCw" :size="14" /> Try again
        </button>
    </div>

    <template v-else-if="data">
        <!-- COMPACT SUMMARY CARDS (6 Key Operational Metrics) -->
        <section class="mb-6 grid gap-3 grid-cols-2 sm:grid-cols-3 xl:grid-cols-6">
            <!-- 1. Assigned S.A.s -->
            <router-link to="/supervisor/team"
                         class="card p-3.5 transition-all hover:shadow-md hover:-translate-y-0.5 flex flex-col justify-between border-slate-200/80 group">
                <div>
                    <div class="flex items-center justify-between gap-1">
                        <span class="text-[11px] font-bold uppercase tracking-wider text-muted truncate">Assigned S.A.s</span>
                        <span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-navy/10 text-navy group-hover:bg-navy group-hover:text-white transition-colors">
                            <app-icon name="UsersRound" :size="15" />
                        </span>
                    </div>
                    <div class="mt-1 text-[26px] font-black text-navy leading-none">
                        {{ assignedSasCount }}
                    </div>
                </div>
                <div class="mt-2.5 pt-2 border-t border-line/60">
                    <span class="text-[11px] text-muted truncate block">
                        {{ data.summaryCards?.assignedLocationsCount || 0 }} Room(s) in Scope
                    </span>
                    <div class="h-1 w-full rounded-full bg-navy/20 mt-1.5 overflow-hidden">
                        <div class="h-full bg-navy w-full"></div>
                    </div>
                </div>
            </router-link>

            <!-- 2. Present Today -->
            <router-link to="/supervisor/team"
                         class="card p-3.5 transition-all hover:shadow-md hover:-translate-y-0.5 flex flex-col justify-between border-slate-200/80 group">
                <div>
                    <div class="flex items-center justify-between gap-1">
                        <span class="text-[11px] font-bold uppercase tracking-wider text-muted truncate">Present Today</span>
                        <span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-100 text-emerald-800 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                            <app-icon name="UserCheck" :size="15" />
                        </span>
                    </div>
                    <div class="mt-1 text-[26px] font-black text-emerald-700 leading-none">
                        {{ presentTodayCount }}
                    </div>
                </div>
                <div class="mt-2.5 pt-2 border-t border-line/60">
                    <span class="text-[11px] text-muted truncate block">
                        {{ presentTodayCount > 0 ? presentTodayCount + ' on duty / done' : 'No active shifts' }}
                    </span>
                    <div class="h-1 w-full rounded-full bg-emerald-100 mt-1.5 overflow-hidden">
                        <div class="h-full bg-emerald-600 w-full"></div>
                    </div>
                </div>
            </router-link>

            <!-- 3. Late Today -->
            <router-link to="/supervisor/attendance-review"
                         class="card p-3.5 transition-all hover:shadow-md hover:-translate-y-0.5 flex flex-col justify-between border-slate-200/80 group">
                <div>
                    <div class="flex items-center justify-between gap-1">
                        <span class="text-[11px] font-bold uppercase tracking-wider text-muted truncate">Late Today</span>
                        <span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors"
                              :class="lateTodayCount > 0 ? 'bg-amber-100 text-amber-800 group-hover:bg-amber-600 group-hover:text-white' : 'bg-slate-100 text-slate-500'">
                            <app-icon name="Clock" :size="15" />
                        </span>
                    </div>
                    <div class="mt-1 text-[26px] font-black leading-none"
                         :class="lateTodayCount > 0 ? 'text-amber-700' : 'text-ink'">
                        {{ lateTodayCount }}
                    </div>
                </div>
                <div class="mt-2.5 pt-2 border-t border-line/60">
                    <span class="text-[11px] text-muted truncate block">
                        {{ lateTodayCount > 0 ? lateTodayCount + ' tardy arrivals' : 'No tardy arrivals' }}
                    </span>
                    <div class="h-1 w-full rounded-full bg-slate-100 mt-1.5 overflow-hidden">
                        <div class="h-full" :class="lateTodayCount > 0 ? 'bg-amber-500 w-full' : 'bg-transparent'"></div>
                    </div>
                </div>
            </router-link>

            <!-- 4. Absences Today -->
            <router-link to="/supervisor/attendance-review"
                         class="card p-3.5 transition-all hover:shadow-md hover:-translate-y-0.5 flex flex-col justify-between border-slate-200/80 group">
                <div>
                    <div class="flex items-center justify-between gap-1">
                        <span class="text-[11px] font-bold uppercase tracking-wider text-muted truncate">Absences Today</span>
                        <span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors"
                              :class="absentTodayCount > 0 ? 'bg-danger/10 text-danger group-hover:bg-danger group-hover:text-white' : 'bg-slate-100 text-slate-500'">
                            <app-icon name="UserX" :size="15" />
                        </span>
                    </div>
                    <div class="mt-1 text-[26px] font-black leading-none"
                         :class="absentTodayCount > 0 ? 'text-danger' : 'text-ink'">
                        {{ absentTodayCount }}
                    </div>
                </div>
                <div class="mt-2.5 pt-2 border-t border-line/60">
                    <span class="text-[11px] text-muted truncate block">
                        {{ absentTodayCount > 0 ? absentTodayCount + ' confirmed absent' : 'No absences today' }}
                    </span>
                    <div class="h-1 w-full rounded-full bg-slate-100 mt-1.5 overflow-hidden">
                        <div class="h-full" :class="absentTodayCount > 0 ? 'bg-danger w-full' : 'bg-transparent'"></div>
                    </div>
                </div>
            </router-link>

            <!-- 5. Pending Reviews -->
            <router-link to="/supervisor/attendance-review"
                         class="card p-3.5 transition-all hover:shadow-md hover:-translate-y-0.5 flex flex-col justify-between border-slate-200/80 group">
                <div>
                    <div class="flex items-center justify-between gap-1">
                        <span class="text-[11px] font-bold uppercase tracking-wider text-muted truncate">Pending Reviews</span>
                        <span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors"
                              :class="pendingReviewsCount > 0 ? 'bg-danger/10 text-danger group-hover:bg-danger group-hover:text-white' : 'bg-sky-100 text-sky-800'">
                            <app-icon name="ClipboardCheck" :size="15" />
                        </span>
                    </div>
                    <div class="mt-1 text-[26px] font-black leading-none"
                         :class="pendingReviewsCount > 0 ? 'text-danger' : 'text-ink'">
                        {{ pendingReviewsCount }}
                    </div>
                </div>
                <div class="mt-2.5 pt-2 border-t border-line/60">
                    <span class="text-[11px] text-muted truncate block">
                        {{ pendingReviewsCount > 0 ? pendingReviewsCount + ' to verify' : 'All exceptions clear' }}
                    </span>
                    <div class="h-1 w-full rounded-full bg-slate-100 mt-1.5 overflow-hidden">
                        <div class="h-full" :class="pendingReviewsCount > 0 ? 'bg-danger w-full' : 'bg-sky-600 w-full'"></div>
                    </div>
                </div>
            </router-link>

            <!-- 6. Pending Requests -->
            <router-link to="/supervisor/requests"
                         class="card p-3.5 transition-all hover:shadow-md hover:-translate-y-0.5 flex flex-col justify-between border-slate-200/80 group">
                <div>
                    <div class="flex items-center justify-between gap-1">
                        <span class="text-[11px] font-bold uppercase tracking-wider text-muted truncate">Pending Requests</span>
                        <span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors"
                              :class="pendingRequestsCount > 0 ? 'bg-amber-100 text-amber-800 group-hover:bg-amber-600 group-hover:text-white' : 'bg-indigo-100 text-indigo-800'">
                            <app-icon name="FileText" :size="15" />
                        </span>
                    </div>
                    <div class="mt-1 text-[26px] font-black leading-none"
                         :class="pendingRequestsCount > 0 ? 'text-amber-700' : 'text-ink'">
                        {{ pendingRequestsCount }}
                    </div>
                </div>
                <div class="mt-2.5 pt-2 border-t border-line/60">
                    <span class="text-[11px] text-muted truncate block">
                        {{ pendingRequestsCount > 0 ? pendingRequestsCount + ' need review' : 'No pending requests' }}
                    </span>
                    <div class="h-1 w-full rounded-full bg-slate-100 mt-1.5 overflow-hidden">
                        <div class="h-full" :class="pendingRequestsCount > 0 ? 'bg-amber-500 w-full' : 'bg-indigo-600 w-full'"></div>
                    </div>
                </div>
            </router-link>
        </section>

        <div class="grid gap-5 lg:grid-cols-12 items-stretch">
            <!-- SECTION A: TODAY'S ASSIGNED DEPLOYMENTS -->
            <section class="card p-5 sm:p-6 lg:col-span-7 flex flex-col justify-between h-full">
                <div>
                    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
                        <div>
                            <h2 class="flex items-center gap-2 text-card-title text-navy">
                                <app-icon name="CalendarCheck" :size="18" />
                                A. Today's Assigned Deployments ({{ data.todayDeployments.dayLabel }})
                            </h2>
                            <p class="text-caption text-muted">
                                Scheduled Student Assistants, assigned rooms/offices, expected duty periods, and verification status.
                            </p>
                        </div>
                        <router-link to="/supervisor/team" class="btn btn-secondary btn-sm">
                            <app-icon name="LayoutGrid" :size="14" /> Full Weekly Grid
                        </router-link>
                    </div>

                    <!-- Active Reliever Coverages Banner -->
                    <div v-if="(data.todayDeployments.activeReliefs || []).length"
                         class="mt-4 rounded-xl border border-teal-300 bg-teal-50/80 p-3.5">
                        <div class="text-[11px] font-bold uppercase tracking-wider text-teal-900">
                            Active Reliever Coverage Today
                        </div>
                        <ul class="mt-1.5 space-y-1 text-caption text-teal-950">
                            <li v-for="rc in data.todayDeployments.activeReliefs" :key="rc.id">
                                <strong>{{ rc.room }}</strong>: Reliever <strong>{{ rc.relieverSaName }}</strong>
                                ({{ rc.startLabel }} – {{ rc.endLabel }}) covering for {{ rc.primarySaName || 'Primary S.A.' }}
                                <span class="text-teal-800">— {{ rc.reason }}</span>
                            </li>
                        </ul>
                    </div>

                    <div v-if="data.publication.status !== 'PUBLISHED'"
                         class="mt-4 rounded-xl border border-amber-300 bg-amber-50/70 p-4 text-caption text-amber-900">
                        The S.A. Coordinator has not published the official semester schedule yet. Deployments will appear here once published.
                    </div>

                    <div v-else-if="!(data.todayDeployments.items || []).length"
                         class="mt-4 rounded-xl border border-line bg-page/50 p-6 text-center text-caption text-muted">
                        No S.A. duty shifts are scheduled for {{ data.todayDeployments.dayLabel }} in your assigned scope ({{ data.supervisor.scopeLabel }}).
                    </div>

                    <div v-else class="mt-4 overflow-x-auto">
                        <table class="w-full text-left border-collapse min-w-[560px]">
                            <thead>
                                <tr class="border-b border-line bg-page text-[11px] font-bold uppercase tracking-wider text-muted">
                                    <th class="py-2.5 px-3.5 whitespace-nowrap min-w-[130px]">Room / Office</th>
                                    <th class="py-2.5 px-3.5 whitespace-nowrap min-w-[160px]">Student Assistant</th>
                                    <th class="py-2.5 px-3.5 whitespace-nowrap min-w-[140px]">Expected Period</th>
                                    <th class="py-2.5 px-3.5 text-right whitespace-nowrap min-w-[140px]">Deployment Status</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-line text-caption">
                                <tr v-for="(dep, idx) in data.todayDeployments.items" :key="idx" class="hover:bg-page/40 transition-colors">
                                    <td class="py-3 px-3.5 whitespace-nowrap">
                                        <div class="flex items-center gap-2">
                                            <span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-navy/5 text-navy">
                                                <app-icon name="Building2" :size="13" />
                                            </span>
                                            <div>
                                                <div class="font-bold text-navy text-[13px] leading-tight">{{ dep.location }}</div>
                                                <span class="mt-0.5 inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                                                      :class="dep.roleBadge === 'RELIEVER' ? 'bg-teal-100 text-teal-900 border border-teal-200' : 'bg-slate-100 text-slate-700 border border-slate-200'">
                                                    {{ dep.roleBadge }}
                                                </span>
                                            </div>
                                        </div>
                                    </td>
                                    <td class="py-3 px-3.5 whitespace-nowrap">
                                        <div class="font-bold text-ink text-[13px] leading-tight">{{ dep.saName }}</div>
                                        <div class="mt-0.5 text-[11px] text-muted"><span v-if="dep.saNumber" class="font-mono font-medium text-navy mr-1">{{ dep.saNumber }} ·</span>{{ dep.studentId }} · {{ dep.course }}</div>
                                    </td>
                                    <td class="py-3 px-3.5 whitespace-nowrap">
                                        <div class="font-semibold text-ink text-[13px] leading-tight">{{ dep.startLabel }} – {{ dep.endLabel }}</div>
                                        <div class="mt-0.5 text-[11px] text-muted">
                                            {{ dep.creditedHours }} credited hr(s)
                                            <span v-if="dep.hasBreak" class="text-amber-700 font-medium">(-1h lunch)</span>
                                        </div>
                                    </td>
                                    <td class="py-3 px-3.5 text-right whitespace-nowrap">
                                        <span class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold whitespace-nowrap shadow-2xs"
                                              :class="verifyBadgeClass(dep.verificationStatus)">
                                            <span class="h-1.5 w-1.5 rounded-full shrink-0"
                                                  :class="{
                                                      'bg-rose-500': dep.verificationStatus === 'INCIDENT_LOGGED',
                                                      'bg-emerald-500': dep.verificationStatus === 'ON_DUTY_NOW',
                                                      'bg-sky-500': dep.verificationStatus === 'COMPLETED',
                                                      'bg-amber-500': dep.verificationStatus === 'SCHEDULED_TODAY'
                                                  }"></span>
                                            <span>{{ dep.verificationLabel }}</span>
                                        </span>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <!-- Assigned Units Summary Strip -->
                <div v-if="(data.todayDeployments.assignedLocations || []).length" class="mt-4 border-t border-line pt-3.5">
                    <div class="flex items-center justify-between mb-2">
                        <span class="text-[11px] font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
                            <app-icon name="Building2" :size="13" />
                            Assigned Rooms &amp; Labs in Scope ({{ data.todayDeployments.assignedLocations.length }})
                        </span>
                        <router-link to="/supervisor/team" class="text-[11px] font-semibold text-navy hover:underline">
                            View details &rarr;
                        </router-link>
                    </div>
                    <div class="flex flex-wrap gap-2">
                        <router-link v-for="loc in data.todayDeployments.assignedLocations" :key="loc.location"
                                     to="/supervisor/team"
                                     class="inline-flex items-center gap-1.5 rounded-lg border border-line bg-page/60 px-3 py-1.5 text-[12px] hover:bg-white hover:border-navy/40 transition-colors">
                            <span class="font-bold text-navy">{{ loc.location }}</span>
                            <span class="text-[11px] text-muted">
                                &middot; {{ loc.primarySas.length }} Primary<template v-if="loc.relieverSas.length">, {{ loc.relieverSas.length }} Reliever</template>
                            </span>
                        </router-link>
                    </div>
                </div>
            </section>

            <!-- SECTION B: ATTENDANCE VERIFICATION -->
            <section class="card p-5 sm:p-6 lg:col-span-5 flex flex-col justify-between h-full">
                <div>
                    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
                        <div>
                            <h2 class="flex items-center gap-2 text-card-title text-navy">
                                <app-icon name="ClipboardCheck" :size="18" /> B. Attendance Verification
                            </h2>
                            <p class="text-caption text-muted">
                                Attendance exceptions and time-in/time-out logs for your assigned team.
                            </p>
                        </div>
                        <span class="rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                              :class="data.attendanceVerification.pendingCount > 0 ? 'bg-danger/10 text-danger border border-danger/20' : 'bg-emerald-100 text-emerald-900 border border-emerald-200'">
                            {{ data.attendanceVerification.pendingCount }} Pending
                        </span>
                    </div>

                    <!-- Clean Attendance Verification State -->
                    <div v-if="!(data.attendanceVerification.records || []).length" class="mt-4 space-y-3">
                        <div class="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
                            <span class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-emerald-100 text-emerald-700">
                                <app-icon name="CheckCircle2" :size="20" />
                            </span>
                            <div class="min-w-0 flex-1">
                                <p class="text-caption font-bold text-emerald-950">All Records Verified &amp; Clean</p>
                                <p class="mt-0.5 text-[12px] text-emerald-800 leading-relaxed">
                                    All assigned Student Assistants in your scope currently have clean attendance with zero unresolved exceptions or missing punches.
                                </p>
                            </div>
                        </div>

                        <!-- Today's Attendance Verification Summary -->
                        <div class="rounded-xl border border-line bg-page/50 p-4 space-y-2.5">
                            <div class="text-[11px] font-bold uppercase tracking-wider text-muted">
                                Today's Attendance Overview
                            </div>
                            <div class="grid grid-cols-2 gap-2 text-[12px]">
                                <div class="flex items-center justify-between rounded-lg bg-white px-3 py-2 border border-line/60">
                                    <span class="text-muted">Total Shifts Scheduled</span>
                                    <span class="font-bold text-navy">{{ totalScheduledShifts }}</span>
                                </div>
                                <div class="flex items-center justify-between rounded-lg bg-white px-3 py-2 border border-line/60">
                                    <span class="text-muted">Completed Shifts</span>
                                    <span class="font-bold text-emerald-700">{{ completedShiftsCount }}</span>
                                </div>
                                <div class="flex items-center justify-between rounded-lg bg-white px-3 py-2 border border-line/60">
                                    <span class="text-muted">Active On-Duty Shifts</span>
                                    <span class="font-bold text-emerald-700">{{ onDutyShiftsCount }}</span>
                                </div>
                                <div class="flex items-center justify-between rounded-lg bg-white px-3 py-2 border border-line/60">
                                    <span class="text-muted">Unresolved Incidents</span>
                                    <span class="font-bold text-slate-600">0</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Exceptions List -->
                    <ul v-else class="mt-4 space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                        <li v-for="rec in data.attendanceVerification.records" :key="rec.id"
                            class="rounded-xl border p-3.5 transition hover:shadow-2xs"
                            :class="rec.needsVerification ? 'border-amber-300 bg-amber-50/40' : 'border-line bg-page/40'">
                            <div class="flex flex-wrap items-center justify-between gap-2">
                                <div>
                                    <span class="font-bold text-navy text-caption">{{ rec.saName }}</span>
                                    <span class="ml-1 text-[11px] text-muted">({{ rec.studentId }} &middot; {{ rec.location }})</span>
                                </div>
                                <span class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                                      :class="rec.category === 'ABSENT' ? 'bg-danger/10 text-danger border border-danger/20' : 'bg-amber-100 text-amber-900 border border-amber-200'">
                                    {{ rec.category }}
                                </span>
                            </div>
                            <div class="mt-2 grid grid-cols-2 gap-2 text-[11px] text-ink">
                                <div class="rounded-lg bg-white/80 p-2 border border-line/60">
                                    <span class="text-muted block text-[10px] uppercase font-bold">Shift &amp; Date</span>
                                    <span class="font-semibold text-ink">{{ rec.scheduledPeriod }}</span>
                                    <div class="text-[10px] text-muted">{{ rec.incidentDate }}</div>
                                </div>
                                <div class="rounded-lg bg-white/80 p-2 border border-line/60">
                                    <span class="text-muted block text-[10px] uppercase font-bold">Punches</span>
                                    <span class="font-semibold text-ink">{{ rec.timeIn }} &rarr; {{ rec.timeOut }}</span>
                                    <div class="text-[10px] text-muted">{{ rec.minutesAffected }} min(s) affected</div>
                                </div>
                            </div>
                            <p v-if="rec.notes" class="mt-2 text-[11px] text-muted truncate bg-white/60 p-1.5 rounded border border-line/40" :title="rec.notes">
                                <strong class="text-slate-600">Note:</strong> {{ rec.notes }}
                            </p>
                        </li>
                    </ul>
                </div>

                <div class="mt-4 pt-3 border-t border-line flex items-center justify-between">
                    <span class="text-[11px] text-muted">Need to review detailed punch logs?</span>
                    <router-link to="/supervisor/attendance-review" class="btn btn-secondary btn-sm">
                        <app-icon name="FileSpreadsheet" :size="13" /> Attendance Logs
                    </router-link>
                </div>
            </section>
        </div>

        <!-- SECOND ROW: SECTION C (EVALUATION TASKS) & SECTION D (RELEVANT NOTIFICATIONS) -->
        <div class="mt-5 grid gap-5 lg:grid-cols-12 items-stretch">
            <!-- SECTION C: EVALUATION TASKS -->
            <section class="card p-5 sm:p-6 lg:col-span-7 flex flex-col justify-between h-full">
                <div>
                    <div class="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
                        <div>
                            <h2 class="flex items-center gap-2 text-card-title text-navy">
                                <app-icon name="ClipboardList" :size="18" /> C. Evaluation Tasks
                            </h2>
                            <p class="text-caption text-muted">
                                S.A. performance evaluations assigned to you for completion and electronic signature.
                            </p>
                        </div>
                        <router-link to="/supervisor/evaluations" class="btn btn-primary btn-sm">
                            <app-icon name="FileSignature" :size="14" /> Open Evaluation Module
                        </router-link>
                    </div>

                    <div v-if="!data.evaluationTasks.hasCampaign"
                         class="mt-4 rounded-xl border border-dashed border-line bg-page/50 p-6 text-center text-caption text-muted">
                        No evaluation campaign has been released by the S.A. Coordinator for this semester yet.
                    </div>

                    <template v-else>
                        <!-- Mini status counters -->
                        <div class="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                            <div class="rounded-xl border border-line bg-page/50 p-3 transition hover:border-amber-300">
                                <div class="text-[10px] font-bold uppercase tracking-wider text-muted">Pending Submission</div>
                                <div class="mt-1 text-[20px] font-black text-amber-700 leading-none">
                                    {{ data.evaluationTasks.pendingSubmission + data.evaluationTasks.returnedForRevision }}
                                </div>
                            </div>
                            <div class="rounded-xl border border-line bg-page/50 p-3 transition hover:border-sky-300">
                                <div class="text-[10px] font-bold uppercase tracking-wider text-muted">Awaiting S.A. Ack</div>
                                <div class="mt-1 text-[20px] font-black text-sky-800 leading-none">{{ data.evaluationTasks.awaitingSaAck }}</div>
                            </div>
                            <div class="rounded-xl border border-line bg-page/50 p-3 transition hover:border-indigo-300">
                                <div class="text-[10px] font-bold uppercase tracking-wider text-muted">With Coordinator</div>
                                <div class="mt-1 text-[20px] font-black text-indigo-800 leading-none">{{ data.evaluationTasks.awaitingCoordinator }}</div>
                            </div>
                            <div class="rounded-xl border border-line bg-page/50 p-3 transition hover:border-emerald-300">
                                <div class="text-[10px] font-bold uppercase tracking-wider text-muted">Finalized</div>
                                <div class="mt-1 text-[20px] font-black text-emerald-700 leading-none">{{ data.evaluationTasks.finalized }}</div>
                            </div>
                        </div>

                        <div v-if="!(data.evaluationTasks.items || []).length"
                             class="mt-4 rounded-xl border border-line bg-page/40 p-5 text-center text-caption text-muted">
                            No S.A. evaluations are currently assigned to your Supervisor account.
                        </div>

                        <ul v-else class="mt-4 divide-y divide-line">
                            <li v-for="ev in data.evaluationTasks.items.slice(0, 5)" :key="ev.id"
                                class="flex flex-wrap items-center justify-between gap-3 py-3 hover:bg-page/40 px-2 rounded-lg transition-colors">
                                <div class="min-w-0 flex-1">
                                    <div class="flex flex-wrap items-center gap-2">
                                        <span class="font-bold text-navy text-[13px]">{{ ev.studentName }}</span>
                                        <span class="text-[11px] text-muted">({{ ev.studentId }} · {{ ev.department }})</span>
                                        <span class="rounded-full px-2.5 py-0.5 text-[10px] font-bold"
                                              :class="evalStatusBadge(ev.status).cls">
                                            {{ evalStatusBadge(ev.status).label }}
                                        </span>
                                    </div>
                                    <p v-if="ev.returnReason && ev.status === 'RETURNED_FOR_REVISION'"
                                       class="mt-1 text-[11px] font-medium text-danger">
                                        Return Reason: {{ ev.returnReason }}
                                    </p>
                                    <p v-else-if="ev.averageScore" class="mt-0.5 text-[11px] text-muted">
                                        Rating: <strong class="text-ink">{{ ev.averageScore }}/10</strong> ({{ ev.ratingLabel }}) &middot; Recommendation: <strong class="text-ink">{{ ev.recommendation }}</strong>
                                    </p>
                                </div>
                                <router-link to="/supervisor/evaluations" class="btn btn-secondary btn-sm shrink-0">
                                    {{ (ev.status === 'PENDING_SUPERVISOR' || ev.status === 'RETURNED_FOR_REVISION') ? 'Evaluate S.A.' : 'View Record' }}
                                </router-link>
                            </li>
                        </ul>
                    </template>
                </div>

                <div v-if="data.evaluationTasks.hasCampaign && (data.evaluationTasks.items || []).length > 5" class="mt-3 pt-3 border-t border-line text-right">
                    <router-link to="/supervisor/evaluations" class="text-[11px] font-semibold text-navy hover:underline">
                        View all {{ data.evaluationTasks.items.length }} evaluations &rarr;
                    </router-link>
                </div>
            </section>

            <!-- SECTION D: RELEVANT NOTIFICATIONS -->
            <section class="card p-5 sm:p-6 lg:col-span-5 flex flex-col justify-between h-full">
                <div>
                    <div class="flex items-center justify-between gap-2 border-b border-line pb-3">
                        <div>
                            <h2 class="flex items-center gap-2 text-card-title text-navy">
                                <app-icon name="BellRing" :size="18" /> D. Relevant Notifications
                            </h2>
                            <p class="text-caption text-muted">
                                Schedule changes, evaluation reminders, and Coordinator notices for your scope.
                            </p>
                        </div>
                        <span v-if="unreadNotifsCount > 0" class="rounded-full bg-amber-100 text-amber-900 border border-amber-300 px-2.5 py-0.5 text-[11px] font-bold">
                            {{ unreadNotifsCount }} New
                        </span>
                    </div>

                    <div v-if="!(data.notifications || []).length"
                         class="mt-4 rounded-xl border border-line bg-page/50 p-6 text-center text-caption text-muted">
                        No notifications for your Supervisor account right now.
                    </div>

                    <ul v-else class="mt-3 divide-y divide-line max-h-[360px] overflow-y-auto pr-1">
                        <li v-for="n in data.notifications" :key="n.id"
                            @click="markNotificationRead(n)"
                            class="group flex items-start gap-3 py-3 px-2 rounded-xl transition hover:bg-page/60 cursor-pointer"
                            :class="!n.isRead ? 'bg-navy/[0.02]' : ''">
                            <span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg border shadow-2xs transition-colors"
                                  :class="!n.isRead ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-white border-line text-slate-500'">
                                <app-icon :name="notifIcon(n.type)" :size="14" />
                            </span>
                            <div class="min-w-0 flex-1">
                                <div class="flex items-start justify-between gap-2">
                                    <p class="text-[12px] font-bold text-navy flex items-center gap-1.5 leading-snug">
                                        <span v-if="!n.isRead" class="h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0"></span>
                                        {{ n.title }}
                                    </p>
                                    <span class="shrink-0 text-[10px] text-muted whitespace-nowrap">{{ n.timeAgo }}</span>
                                </div>
                                <p class="mt-0.5 text-[11px] text-muted leading-relaxed line-clamp-2">{{ n.message }}</p>
                            </div>
                        </li>
                    </ul>
                </div>
            </section>
        </div>
    </template>
    `
};


