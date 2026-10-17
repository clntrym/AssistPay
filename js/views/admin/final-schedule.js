// Step 8 — Final Schedule (/admin/scheduling/final-schedule)
// Allows the S.A. Coordinator to view the official Final Schedule and edit
// an individual Student Assistant's duty blocks (Day, Start Time, End Time, Location)
// with a required reason. Saving sends an in-app notification ONLY to that specific
// Student Assistant and their assigned Supervisor(s) — without spamming all other S.A.s or Supervisors.

const FinalSchedulePage = {
    components: { AppIcon, PageHeader, AppModal, FormField },

    setup() {
        const DAYS = [
            { code: "MON", label: "Monday" },
            { code: "TUE", label: "Tuesday" },
            { code: "WED", label: "Wednesday" },
            { code: "THU", label: "Thursday" },
            { code: "FRI", label: "Friday" },
            { code: "SAT", label: "Saturday" }
        ];

        const formatTime12 = (mins) => {
            const m = Number(mins) || 0;
            const hrs = Math.floor(m / 60);
            const rem = m % 60;
            const h12 = hrs % 12 === 0 ? 12 : hrs % 12;
            const ampm = hrs >= 12 ? "PM" : "AM";
            return `${h12}:${String(rem).padStart(2, "0")} ${ampm}`;
        };

        // 7:00 AM (420) to 10:00 PM (1320) in 60-minute rows (15 hours)
        const HOUR_ROWS = [];
        for (let m = 420; m < 1320; m += 60) {
            HOUR_ROWS.push({
                start: m,
                end: m + 60,
                label: `${formatTime12(m)} - ${formatTime12(m + 60)}`,
                shortLabel: formatTime12(m),
            });
        }

        const PX_PER_HOUR = 42;
        const GRID_START = 420;  // 7:00 AM
        const GRID_END = 1320;   // 10:00 PM

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
        const schedule = Vue.ref(null);

        const viewMode = Vue.ref("grid"); // 'grid' | 'table' | 'changes'
        const deptFilter = Vue.ref("ALL");
        const searchQuery = Vue.ref("");

        // Edit Modal state
        const showEditModal = Vue.ref(false);
        const targetSa = Vue.ref(null);
        const editBlocks = Vue.ref([]);
        const editReason = Vue.ref("");
        const savingEdit = Vue.ref(false);

        const load = async () => {
            loading.value = true;
            loadError.value = "";
            const res = await Model.request("scheduling", "schedule_view");
            loading.value = false;
            if (!res.success) {
                loadError.value = res.message || "Could not load Final Schedule.";
                return;
            }
            semester.value = res.semester;
            schedule.value = res.schedule;
        };

        Vue.onMounted(load);

        const countByDept = (dept) => {
            const list = schedule.value?.staff || [];
            if (dept === "ALL") return list.length;
            return list.filter(s => s.department === dept).length;
        };

        const filteredStaff = Vue.computed(() => {
            const list = schedule.value?.staff || [];
            const term = searchQuery.value.trim().toLowerCase();
            return list.filter(s => {
                if (deptFilter.value !== "ALL" && s.department !== deptFilter.value) return false;
                if (!term) return true;
                return (
                    (s.name || "").toLowerCase().includes(term) ||
                    (s.studentId || "").toLowerCase().includes(term) ||
                    (s.course || "").toLowerCase().includes(term) ||
                    (s.location || "").toLowerCase().includes(term) ||
                    (s.supervisor || "").toLowerCase().includes(term)
                );
            });
        });

        const isEnrollmentMode = Vue.computed(() => {
            return (semester.value?.dutyScheduleMode || schedule.value?.dutyScheduleMode || Store.semester?.dutyScheduleMode) === "ENROLLMENT";
        });

        const isSemesterEnded = Vue.computed(() => {
            if (semester.value?.isEnded) return true;
            if (semester.value?.status === "CLOSED") return true;
            if (semester.value?.endDate) {
                const todayStr = new Date().toISOString().slice(0, 10);
                return todayStr >= semester.value.endDate;
            }
            return false;
        });

        const formatSemesterDate = (dateStr) => {
            if (!dateStr) return "";
            try {
                const d = new Date(dateStr + "T00:00:00");
                return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
            } catch (_) {
                return dateStr;
            }
        };

        const blocksForDay = (sa, dayCode) => (sa.blocks || []).filter(b => b.day === dayCode);
        const classesForDay = (sa, dayCode) => {
            if (isEnrollmentMode.value) return [];
            return (sa.classes || []).filter(c => c.day === dayCode);
        };

        const formatCompactTime = (mins) => {
            const m = Number(mins) || 0;
            const hrs = Math.floor(m / 60);
            const rem = m % 60;
            const h12 = hrs % 12 === 0 ? 12 : hrs % 12;
            const suffix = (hrs === 12 && rem === 0) ? "NN" : (hrs >= 12 ? "PM" : "AM");
            const minPart = rem === 0 ? "" : `:${String(rem).padStart(2, "0")}`;
            return `${h12}${minPart}${suffix}`;
        };

        const activeBlock = Vue.ref(null);

        const closeBlockPopover = () => {
            activeBlock.value = null;
        };

        const toggleBlockPopover = (sa, item, type, day, contextKey = "") => {
            const key = `${contextKey}-${sa.saId}-${type}-${day.code}-${item.start}-${item.end}`;
            if (activeBlock.value && activeBlock.value.key === key) {
                activeBlock.value = null;
                return;
            }
            const s = Math.max(GRID_START, Math.min(GRID_END, Number(item.start) || GRID_START));
            const e = Math.max(s + 15, Math.min(GRID_END, Number(item.end) || s + 60));
            const top = ((s - GRID_START) / 60) * PX_PER_HOUR;
            const height = Math.max(20, ((e - s) / 60) * PX_PER_HOUR - 2);
            const showAbove = s >= 1080;
            const isReliever = type === "DUTY" && item.location && item.location.includes("Reliever");

            activeBlock.value = {
                key,
                contextKey,
                sa,
                saId: sa.saId,
                saName: sa.name,
                studentId: sa.studentId,
                dayCode: day.code,
                dayLabel: day.label,
                type: isReliever ? "RELIEVER" : type,
                badgeLabel: isReliever
                    ? "ITO Reliever Duty"
                    : (type === "CLASS" ? "Official Registrar Class" : "Official Duty Schedule"),
                title: type === "CLASS"
                    ? `CLASS: ${item.subject}${item.section ? " (" + item.section + ")" : ""}`
                    : `DUTY: ${item.location} (${item.credited || item.hours}h)`,
                timeLabel: `${item.startLabel || formatTime12(item.start)} – ${item.endLabel || formatTime12(item.end)}`,
                hoursLabel: type === "CLASS"
                    ? `${item.hours || Math.round(((e - s) / 60) * 10) / 10} class hr(s)`
                    : `${item.credited || item.hours} credited hr(s)`,
                lunchNote: type === "DUTY" && item.hasBreak ? "-1h lunch break deducted" : "",
                popoverStyle: showAbove
                    ? { top: `${Math.max(4, top - 125)}px` }
                    : { top: `${top + height + 4}px` },
                alignRight: day.code === "FRI" || day.code === "SAT",
            };
        };

        const getPrimaryRoom = (sa) => {
            const primaryBlocks = (sa.blocks || []).filter(b => !(b.location || "").includes("Reliever"));
            if (primaryBlocks.length > 0) {
                return primaryBlocks[0]?.location || "";
            }
            if ((sa.category || sa.saCategory) === "RELIEVER") return "";
            return (sa.location || "").split(" + ")[0].replace(/\s*\(ITO Reliever\)/i, "").trim();
        };

        const DAY_SORT_INDEX = { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6, SUN: 7 };

        const filteredRooms = Vue.computed(() => {
            const list = schedule.value?.staff || [];
            const roomMap = new Map();

            const ensureRoom = (dept, roomName, reqType) => {
                const key = `${dept}|${roomName}`;
                if (!roomMap.has(key)) {
                    roomMap.set(key, {
                        key,
                        room: roomName,
                        department: dept,
                        requirementType: reqType,
                        partners: [],
                        relievers: [],
                    });
                }
                return roomMap.get(key);
            };

            for (const sa of list) {
                const primaryBlocks = (sa.blocks || []).filter(b => !(b.location || "").includes("Reliever"));
                const relieverBlocks = (sa.blocks || []).filter(b => (b.location || "").includes("Reliever"));
                const primaryRoom = getPrimaryRoom(sa);

                if (primaryRoom && primaryBlocks.length > 0) {
                    const grp = ensureRoom(sa.department, primaryRoom, sa.requirementType);
                    grp.partners.push({
                        ...sa,
                        slotNo: grp.partners.length + 1,
                        firstName: (sa.name || "").trim().split(/\s+/)[0],
                        blocks: primaryBlocks,
                        classes: sa.classes || [],
                    });
                }

                for (const rb of relieverBlocks) {
                    const targetRoom = (rb.location || "").replace(/\s*\(ITO Reliever\)/i, "").trim();
                    if (!targetRoom) continue;
                    const grp = ensureRoom(sa.department, targetRoom, "ROOM");
                    const firstName = (sa.name || "").trim().split(/\s+/)[0].toUpperCase();
                    grp.relievers.push({
                        key: `${sa.saId}-${rb.day}-${rb.start}-${rb.end}`,
                        saId: sa.saId,
                        studentId: sa.studentId,
                        day: rb.day,
                        start: Number(rb.start) || 0,
                        end: Number(rb.end) || 0,
                        lineText: `${rb.day}- ${formatCompactTime(rb.start)}-${formatCompactTime(rb.end)}- ${firstName}`,
                        saName: sa.name,
                        donorRoom: primaryRoom || "Reliever Pool",
                        credited: rb.credited,
                    });
                }
            }

            const rooms = Array.from(roomMap.values());
            for (const g of rooms) {
                g.relievers.sort((a, b) => {
                    const da = DAY_SORT_INDEX[a.day] || 99;
                    const db = DAY_SORT_INDEX[b.day] || 99;
                    if (da !== db) return da - db;
                    return a.start - b.start;
                });
            }

            const deptOrder = { ITO: 1, ACADS: 2, OFFICE: 3 };
            rooms.sort((a, b) => {
                const da = deptOrder[a.department] || 99;
                const db = deptOrder[b.department] || 99;
                if (da !== db) return da - db;
                return a.room.localeCompare(b.room, undefined, { numeric: true, sensitivity: "base" });
            });

            const term = searchQuery.value.trim().toLowerCase();
            return rooms.filter(g => {
                if (deptFilter.value !== "ALL" && g.department !== deptFilter.value) return false;
                if (!term) return true;
                if (g.room.toLowerCase().includes(term) || g.department.toLowerCase().includes(term)) return true;
                if (g.partners.some(p =>
                    (p.name || "").toLowerCase().includes(term) ||
                    (p.studentId || "").toLowerCase().includes(term) ||
                    (p.course || "").toLowerCase().includes(term)
                )) return true;
                return g.relievers.some(r => (r.saName || "").toLowerCase().includes(term));
            });
        });

        const relieverBlocksForPartner = (grp, targetPartner, dayCode) => {
            if (!grp || !grp.partners || !grp.partners.length || !grp.relievers || !grp.relievers.length) return [];
            const pIdx = grp.partners.findIndex(p => p.saId === targetPartner.saId);
            if (pIdx < 0) return [];

            const matchingBlocks = [];
            const dayRelievers = grp.relievers.filter(r => r.day === dayCode);

            for (const rb of dayRelievers) {
                const bStart = Number(rb.start) || 0;
                const bEnd = Number(rb.end) || 0;

                // 1. Check which partner has class overlapping with this block
                let assignedToIdx = -1;
                grp.partners.forEach((p, pi) => {
                    const hasClassOv = (p.classes || []).some(c =>
                        c.day === dayCode && !(Number(c.end) <= bStart || Number(c.start) >= bEnd)
                    );
                    if (hasClassOv && assignedToIdx === -1) {
                        assignedToIdx = pi;
                    }
                });

                // 2. If neither has class during this block, check which partner does NOT have duty during this block
                if (assignedToIdx === -1) {
                    grp.partners.forEach((p, pi) => {
                        const hasDuty = (p.blocks || []).some(d =>
                            d.day === dayCode && !(Number(d.end) <= bStart || Number(d.start) >= bEnd)
                        );
                        if (!hasDuty && assignedToIdx === -1) {
                            assignedToIdx = pi;
                        }
                    });
                }

                // 3. Fallback: if 2 partners, default to Partner 2 (Slot 2, as in NCST schedule sheet); else Partner 1
                if (assignedToIdx === -1) {
                    assignedToIdx = grp.partners.length >= 2 ? 1 : 0;
                }

                if (assignedToIdx === pIdx) {
                    const firstName = (rb.saName || "").trim().split(/\s+/)[0].toUpperCase();
                    matchingBlocks.push({
                        ...rb,
                        firstName,
                        startLabel: formatCompactTime(bStart),
                        endLabel: formatCompactTime(bEnd),
                    });
                }
            }
            return matchingBlocks;
        };

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

        const toHHMM = (minsVal, timeStr) => {
            if (timeStr && /^\d{2}:\d{2}/.test(String(timeStr))) {
                return String(timeStr).slice(0, 5);
            }
            const m = Number(minsVal) || 480;
            const hh = String(Math.floor(m / 60)).padStart(2, "0");
            const mm = String(m % 60).padStart(2, "0");
            return `${hh}:${mm}`;
        };

        const openEditModal = (sa) => {
            targetSa.value = sa;
            const primaryLoc = (sa.location || "").split(" + ")[0] || sa.department;
            if (sa.blocks && sa.blocks.length) {
                editBlocks.value = sa.blocks.map(b => ({
                    day: b.day || "MON",
                    startTime: toHHMM(b.start, b.startTime),
                    endTime: toHHMM(b.end, b.endTime),
                    location: b.location || primaryLoc
                }));
            } else {
                editBlocks.value = [
                    { day: "MON", startTime: "08:00", endTime: "12:00", location: primaryLoc }
                ];
            }
            editReason.value = "";
            showEditModal.value = true;
        };

        const addBlockRow = () => {
            const primaryLoc = (targetSa.value?.location || "").split(" + ")[0] || "Duty";
            editBlocks.value.push({
                day: "MON",
                startTime: "08:00",
                endTime: "12:00",
                location: primaryLoc
            });
        };

        const removeBlockRow = (idx) => {
            if (editBlocks.value.length <= 1) {
                Toast.error("At least one duty block is required.");
                return;
            }
            editBlocks.value.splice(idx, 1);
        };

        const sanitizeText = (str) => String(str || "").replace(/'/g, "’").replace(/["`;<>\\|{}\[\]=*%$#^~!?&]/g, "").trim();

        const submitEditSchedule = async () => {
            if (!targetSa.value) return;
            const cleanReason = sanitizeText(editReason.value);
            if (cleanReason.length < 3) {
                Toast.error("Please enter a valid reason (at least 3 characters) for editing this Student Assistant's schedule.");
                return;
            }
            if (!editBlocks.value.length) {
                Toast.error("Please provide at least one duty block.");
                return;
            }

            for (let i = 0; i < editBlocks.value.length; i++) {
                const b = editBlocks.value[i];
                if (!b.day || !b.startTime || !b.endTime) {
                    Toast.error(`Block #${i + 1}: Please select Day, Start Time, and End Time.`);
                    return;
                }
                if (b.endTime <= b.startTime) {
                    Toast.error(`Block #${i + 1}: End Time must be later than Start Time.`);
                    return;
                }
                if (!sanitizeText(b.location)) {
                    Toast.error(`Block #${i + 1}: Please enter the Room / Office / Duty Location.`);
                    return;
                }
            }

            const ok = await Alerts.confirm({
                title: `Save Final Schedule for ${targetSa.value.name}?`,
                text: `Save ${editBlocks.value.length} duty block(s) and send notification ONLY to ${targetSa.value.name} and their assigned Supervisor (${targetSa.value.supervisor})?`,
                confirmText: "Yes, Save & Notify",
                cancelText: "Cancel",
                requireReason: false
            });
            if (!ok) return;

            const payloadBlocks = editBlocks.value.map(b => ({
                day: b.day,
                startTime: b.startTime,
                endTime: b.endTime,
                location: sanitizeText(b.location)
            }));

            savingEdit.value = true;
            const res = await Model.request("scheduling", "final_schedule_save_sa", {
                saId: targetSa.value.saId,
                blocks: payloadBlocks,
                reason: cleanReason
            });
            savingEdit.value = false;

            if (!res.success) {
                Toast.error(res.message || "Could not update schedule.");
                return;
            }

            schedule.value = res.schedule;
            showEditModal.value = false;

            const saName = res.notifiedSaName || targetSa.value.name;
            const supNames = (res.notifiedSupervisorNames || []).join(", ") || targetSa.value.supervisor;
            Toast.success(`Schedule updated! Notification sent ONLY to ${saName} and Supervisor (${supNames}).`);
        };

        const switchingMode = Vue.ref(false);

        const switchScheduleMode = async (targetMode) => {
            if (switchingMode.value) return;

            if (targetMode === "ENROLLMENT") {
                const endNotice = isSemesterEnded.value
                    ? `<div class="rounded-lg bg-emerald-50 border border-emerald-200 p-2 text-xs text-emerald-900">
                           ✓ <b>Semester Ended:</b> Academic classes have officially concluded (${formatSemesterDate(semester.value?.endDate)}). Previous class cards will be cleared and all S.A.s transitioned to standard 8:00 AM – 5:00 PM duty hours for the enrollment period.
                       </div>`
                    : `<div class="rounded-lg bg-amber-50 border border-amber-200 p-2 text-xs text-amber-900">
                           ℹ️ <b>Reminder (Ongoing Semester):</b> Current semester classes are scheduled until <b>${formatSemesterDate(semester.value?.endDate)}</b>. Switching to Enrollment Schedule will end room/lab class duties and set duty hours to 8:00 AM – 5:00 PM.
                       </div>`;

                const result = await Swal.fire({
                    icon: "question",
                    title: "Switch to Enrollment Schedule (8:00 AM – 5:00 PM)?",
                    html: `
                        <div class="text-left text-[13px] space-y-2.5 mt-2">
                            <p class="text-slate-800">Transition all Student Assistants to the <b>Enrollment Duty Schedule (8:00 AM – 5:00 PM)</b>:</p>
                            <ul class="list-disc pl-5 space-y-1.5 text-slate-700">
                                <li><b>No Academic Classes:</b> Enrolled class schedules will no longer be displayed since the semester has concluded and registration for the upcoming term is ongoing.</li>
                                <li><b>No Room/Lab Duties:</b> <b>ITO</b> and <b>ACADS</b> S.A.s are <b>relieved from laboratory duties</b> to support general enrollment operations.</li>
                                <li><b>Office S.A.s:</b> <b>Remain in their assigned offices</b> (RECORDS, REGISTRAR, HR, OCM, etc.).</li>
                                <li><b>Duty Hours:</b> Standard <b>8:00 AM – 5:00 PM</b> duty schedule (includes an automatic 12:00 PM – 1:00 PM lunch break).</li>
                                <li><b>Targeted Notifications:</b> Automated official notifications will be sent to all active <b>S.A.s</b> and <b>Supervisors</b>.</li>
                            </ul>
                            ${endNotice}
                            <div class="rounded-lg bg-slate-50 border border-line p-2 text-xs text-slate-600">
                                ℹ️ Safe &amp; Reversible: The original class-matched semester schedule is automatically backed up and can be restored at any time.
                            </div>
                        </div>
                    `,
                    showCancelButton: true,
                    confirmButtonText: "Yes, Activate Enrollment (8-5)",
                    cancelButtonText: "Cancel",
                    confirmButtonColor: "#d97706",
                    cancelButtonColor: "#64748b"
                });

                if (!result.isConfirmed) return;

                switchingMode.value = true;
                const semId = semester.value?.id || Store.semester?.id || 1;
                const res = await Model.request("scheduling", "apply_enrollment_schedule", { semesterId: semId });
                switchingMode.value = false;

                if (!res.success) {
                    await Swal.fire({ icon: "error", title: "Activation Failed", text: res.message || "Could not switch to Enrollment mode." });
                    return;
                }

                if (Store.semester) Store.semester.dutyScheduleMode = "ENROLLMENT";
                if (semester.value) semester.value.dutyScheduleMode = "ENROLLMENT";
                if (schedule.value) schedule.value.dutyScheduleMode = "ENROLLMENT";

                await Swal.fire({
                    icon: "success",
                    title: "Enrollment Schedule Activated!",
                    html: `
                        <div class="text-left text-[13px] space-y-2 mt-1">
                            <p>All Student Assistants have been successfully transitioned to the <b>Enrollment Duty Schedule (8:00 AM – 5:00 PM)</b>.</p>
                            <p class="text-slate-600">All Student Assistants and Immediate Supervisors have been notified that the 8:00 AM – 5:00 PM schedule is now in effect, with room/lab duties temporarily suspended for ITO and ACADS.</p>
                        </div>
                    `,
                    confirmButtonColor: "#0a143c"
                });
                await load();
            } else {
                const result = await Swal.fire({
                    icon: "question",
                    title: "Reset to Regular Semester Schedule?",
                    html: `
                        <div class="text-left text-[13px] space-y-2 mt-2">
                            <p class="text-slate-800">Restore system to the <b>Regular Semester Class-Matched Schedule</b>:</p>
                            <ul class="list-disc pl-5 space-y-1.5 text-slate-700">
                                <li>Restores original <b>class-matched room and laboratory duties</b> for ITO and ACADS.</li>
                                <li>Restores regular office duty hours for Office S.A.s.</li>
                                <li>Automatically notifies all <b>S.A.s</b> and <b>Supervisors</b> that the regular semester schedule is back in effect.</li>
                            </ul>
                        </div>
                    `,
                    showCancelButton: true,
                    confirmButtonText: "Yes, Reset to Regular Semester",
                    cancelButtonText: "Cancel",
                    confirmButtonColor: "#0a143c",
                    cancelButtonColor: "#64748b"
                });

                if (!result.isConfirmed) return;

                switchingMode.value = true;
                const semId = semester.value?.id || Store.semester?.id || 1;
                const res = await Model.request("scheduling", "reset_semester_schedule", { semesterId: semId });
                switchingMode.value = false;

                if (!res.success) {
                    await Swal.fire({ icon: "error", title: "Reset Failed", text: res.message || "Could not reset to Semester mode." });
                    return;
                }

                if (Store.semester) Store.semester.dutyScheduleMode = "SEMESTER";
                if (semester.value) semester.value.dutyScheduleMode = "SEMESTER";
                if (schedule.value) schedule.value.dutyScheduleMode = "SEMESTER";

                await Swal.fire({
                    icon: "success",
                    title: "Regular Semester Schedule Restored!",
                    text: res.message || "Schedule successfully reset to the Regular Semester class-matched schedule. S.A.s and Supervisors have been notified.",
                    confirmButtonColor: "#0a143c"
                });
                await load();
            }
        };

        const isSchedulePublished = Vue.computed(() => {
            return schedule.value?.status === "PUBLISHED";
        });

        return {
            DAYS, HOUR_ROWS, PX_PER_HOUR, blockStyle,
            loading, loadError, semester, schedule, isSchedulePublished,
            viewMode, deptFilter, searchQuery,
            countByDept, filteredStaff, filteredRooms, blocksForDay, classesForDay,
            activeBlock, closeBlockPopover, toggleBlockPopover, getPrimaryRoom, switchToPartnerRoom, switchToSoloSa,
            relieverBlocksForPartner,
            showEditModal, targetSa, editBlocks, editReason, savingEdit,
            openEditModal, addBlockRow, removeBlockRow, submitEditSchedule,
            isEnrollmentMode, isSemesterEnded, formatSemesterDate, switchingMode, switchScheduleMode,
            Format
        };
    },

    template: `
    <div class="space-y-6">
        <page-header
            section="Scheduling"
            title="Schedule Adjustment (Individual Edit & Targeted Notification)"
            subtitle="Edit a specific Student Assistant's official duty schedule and send a notification ONLY to that Student Assistant and their assigned Supervisor." />

        <!-- Loading -->
        <div v-if="loading" class="card p-12 text-center text-muted">
            <app-icon name="LoaderCircle" :size="32" class="mx-auto mb-3 animate-spin text-navy" />
            <p class="font-medium text-ink">Loading Schedule Adjustment…</p>
        </div>

        <!-- Error -->
        <div v-else-if="loadError" class="card border-danger/30 bg-danger/5 p-6 text-danger">
            <div class="flex items-center gap-3">
                <app-icon name="CircleAlert" :size="20" class="shrink-0" />
                <p class="font-medium">{{ loadError }}</p>
            </div>
            <button @click="load" class="btn btn-secondary btn-sm mt-3 inline-flex items-center gap-1.5">
                <app-icon name="RefreshCw" :size="14" /> Try Again
            </button>
        </div>

        <!-- UNPUBLISHED / EMPTY STATE: POPULATES ONCE PUBLISHED IN STEP 7 -->
        <div v-else-if="!isSchedulePublished"
             class="card flex flex-col items-center justify-center p-10 sm:p-14 text-center max-w-2xl mx-auto shadow-sm border border-line">
            <div class="grid h-16 w-16 place-items-center rounded-2xl bg-amber-100 text-amber-900 mb-4 shadow-xs">
                <app-icon name="CalendarX2" :size="32" />
            </div>
            <div class="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-amber-900 mb-2">
                <app-icon name="Lock" :size="12" />
                Schedule Not Yet Published
            </div>
            <h3 class="text-[20px] font-bold text-navy">
                No Schedules Available for Adjustment Yet
            </h3>
            <p class="mt-2 text-[13px] text-muted leading-relaxed max-w-lg">
                No official schedule has been published yet for the current semester (<strong>{{ semester?.label || 'Active Semester' }}</strong>).
                <strong>Schedule Adjustment</strong> will become available once the official schedule is published in <strong>Step 7</strong>.
            </p>
            
            <div class="mt-5 rounded-xl border border-line bg-page p-4 text-left text-[12px] text-ink space-y-2 max-w-md w-full">
                <div class="font-bold text-navy flex items-center gap-2">
                    <app-icon name="Info" :size="15" class="text-navy" />
                    How to Activate the Schedule:
                </div>
                <ol class="list-decimal pl-5 space-y-1.5 text-muted leading-relaxed">
                    <li>Go to <router-link to="/admin/scheduling/finalized" class="font-bold underline text-navy hover:text-navy/80">Step 7: Finalize Schedule</router-link>.</li>
                    <li>Review the consolidated schedule and click <b>"Publish Official Schedule (Notify All)"</b>.</li>
                    <li>All <b>Supervisors</b> and <b>Student Assistants</b> will automatically receive their official duty schedules in their accounts.</li>
                    <li>Once published, all schedules will appear here for live individual adjustments and targeted notifications.</li>
                </ol>
            </div>

            <div class="mt-6 flex flex-wrap items-center justify-center gap-3">
                <router-link to="/admin/scheduling/finalized"
                             class="btn btn-primary btn-md inline-flex items-center gap-2 bg-navy hover:bg-navy-700 text-white shadow-xs">
                    <app-icon name="ArrowRight" :size="16" />
                    Go to Step 7: Finalize Schedule
                </router-link>
            </div>
        </div>

        <!-- PUBLISHED STATE: DISPLAYS SCHEDULES ONCE PUBLISHED IN STEP 7 -->
        <template v-else-if="schedule && isSchedulePublished">
            <!-- Targeted Notification & Mode Switch Banner -->
            <div class="card border border-navy/15 bg-white p-4 sm:p-5 shadow-xs dark:border-slate-800 dark:bg-slate-900">
                <div class="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
                    <div class="flex items-start gap-3.5">
                        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-navy/10 text-navy dark:bg-navy/30 dark:text-gold">
                            <app-icon name="CalendarClock" :size="20" />
                        </div>
                        <div>
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="font-bold text-navy text-[15px] dark:text-slate-100">Duty Schedule Mode</span>
                                <span v-if="isEnrollmentMode" class="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-800 dark:bg-amber-950/40 dark:border-amber-700 dark:text-amber-300">
                                    <span class="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse"></span> Enrollment Duty (8:00 AM – 5:00 PM)
                                </span>
                                <span v-else-if="isSemesterEnded" class="inline-flex items-center gap-1.5 rounded-full border border-indigo-300 bg-indigo-50 px-2.5 py-0.5 text-[11px] font-bold text-indigo-900 dark:bg-indigo-950/40 dark:border-indigo-700 dark:text-indigo-300">
                                    <span class="h-1.5 w-1.5 rounded-full bg-indigo-600"></span> Semester Concluded (Ended {{ formatSemesterDate(semester?.endDate) }})
                                </span>
                                <span v-else class="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-700 dark:text-emerald-300">
                                    <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span> Regular Semester Mode (Classes until {{ formatSemesterDate(semester?.endDate) }})
                                </span>
                            </div>
                            <p class="mt-1 text-caption text-slate-500 dark:text-slate-400 max-w-2xl leading-relaxed">
                                {{ isEnrollmentMode
                                    ? 'Academic classes have concluded. All S.A.s are on standard 8:00 AM – 5:00 PM duty. Office S.A.s remain in their respective offices, while ITO and ACADS S.A.s are assigned to enrollment support.'
                                    : (isSemesterEnded
                                        ? 'Semester classes have concluded. You may now transition to the 8:00 AM – 5:00 PM Enrollment Schedule for the upcoming registration period.'
                                        : 'Official class-matched room, laboratory, and office duty assignments are active for the regular semester.')
                                }}
                            </p>
                        </div>
                    </div>

                    <!-- SWITCH / RESET BUTTON -->
                    <div class="flex flex-wrap items-center gap-2.5 shrink-0">
                        <button v-if="!isEnrollmentMode && isSemesterEnded"
                                type="button"
                                @click="switchScheduleMode('ENROLLMENT')"
                                :disabled="switchingMode"
                                class="btn bg-navy hover:bg-[#070f30] text-white font-semibold text-[13px] px-4 py-2.5 rounded-xl shadow-xs border border-navy/40 flex items-center gap-2 transition-all cursor-pointer">
                            <app-icon v-if="switchingMode" name="Loader" :size="15" class="animate-spin text-gold" />
                            <app-icon v-else name="CalendarClock" :size="15" class="text-gold" />
                            <span>Switch to Enrollment Schedule (8–5)</span>
                        </button>
                        <button v-else-if="isEnrollmentMode"
                                type="button"
                                @click="switchScheduleMode('SEMESTER')"
                                :disabled="switchingMode"
                                class="btn bg-white hover:bg-slate-50 text-navy font-semibold text-[13px] px-4 py-2.5 rounded-xl shadow-xs border border-line flex items-center gap-2 transition-all cursor-pointer dark:bg-slate-800 dark:border-slate-700 dark:text-white dark:hover:bg-slate-700">
                            <app-icon v-if="switchingMode" name="Loader" :size="15" class="animate-spin text-navy dark:text-gold" />
                            <app-icon v-else name="RotateCcw" :size="15" class="text-navy dark:text-gold" />
                            <span>Reset to Regular Semester Schedule</span>
                        </button>
                        <span v-if="schedule" class="inline-flex items-center gap-1.5 rounded-xl border border-line bg-slate-50 px-3 py-2 text-[12px] font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-800/80 dark:text-slate-300">
                            <app-icon name="Users" :size="13" class="text-slate-400" />
                            <span>{{ schedule.summary?.sas || 0 }} Active S.A.s</span>
                        </span>
                    </div>
                </div>
            </div>

            <!-- Filter & View Switcher Bar -->
            <div class="card p-4">
                <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <!-- Department Filter Pills -->
                    <div class="flex flex-wrap items-center gap-1.5">
                        <button v-for="d in [
                                    { code: 'ALL', label: 'All S.A.s' },
                                    { code: 'ITO', label: 'ITO Labs' },
                                    { code: 'ACADS', label: 'ACADS Rooms' },
                                    { code: 'OFFICE', label: 'Offices' }
                                ]"
                                :key="d.code"
                                type="button"
                                @click="deptFilter = d.code"
                                class="rounded-lg px-3 py-1.5 text-caption font-bold transition"
                                :class="deptFilter === d.code ? 'bg-navy text-white shadow-sm' : 'bg-mist text-ink hover:bg-navy/10'">
                            {{ d.label }} ({{ countByDept(d.code) }})
                        </button>
                    </div>

                    <!-- Search & View Mode -->
                    <div class="flex flex-wrap items-center gap-2">
                        <div class="relative min-w-[240px] flex-1 sm:flex-initial">
                            <app-icon name="Search" :size="15" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                            <input v-model="searchQuery" type="text" placeholder="Search S.A. name, ID, room, supervisor…"
                                   class="w-full rounded-lg border border-line bg-page py-1.5 pl-8 pr-3 text-caption focus:border-navy focus:outline-none" />
                        </div>

                        <div class="inline-flex rounded-lg border border-line bg-mist p-0.5">
                            <button type="button" @click="closeBlockPopover(); viewMode = 'grid'"
                                    class="flex items-center gap-1.5 rounded-md px-3 py-1 text-caption font-bold transition"
                                    :class="viewMode === 'grid' ? 'bg-navy text-white shadow-sm' : 'text-ink hover:text-navy'">
                                <app-icon name="User" :size="14" /> Solo Grid View
                            </button>
                            <button type="button" @click="closeBlockPopover(); viewMode = 'room'"
                                    class="flex items-center gap-1.5 rounded-md px-3 py-1 text-caption font-bold transition"
                                    :class="viewMode === 'room' ? 'bg-navy text-white shadow-sm' : 'text-ink hover:text-navy'">
                                <app-icon name="Users" :size="14" /> With Partner (Room/Lab)
                            </button>
                            <button type="button" @click="closeBlockPopover(); viewMode = 'table'"
                                    class="flex items-center gap-1.5 rounded-md px-3 py-1 text-caption font-bold transition"
                                    :class="viewMode === 'table' ? 'bg-navy text-white shadow-sm' : 'text-ink hover:text-navy'">
                                <app-icon name="Table" :size="14" /> Table View
                            </button>
                            <button type="button" @click="closeBlockPopover(); viewMode = 'changes'"
                                    class="flex items-center gap-1.5 rounded-md px-3 py-1 text-caption font-bold transition"
                                    :class="viewMode === 'changes' ? 'bg-navy text-white shadow-sm' : 'text-ink hover:text-navy'">
                                <app-icon name="History" :size="14" /> Edit History ({{ (schedule.changes || []).length }})
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Unified Schedule Color Legend & Operating Hours Info -->
            <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-page px-4 py-2.5 text-[12px]">
                <div class="flex flex-wrap items-center gap-3.5">
                    <span class="inline-flex items-center gap-1.5 font-medium text-ink">
                        <span class="h-3 w-3 rounded bg-amber-200 border border-amber-500 shadow-2xs"></span>
                        Official Duty
                    </span>
                    <span class="inline-flex items-center gap-1.5 font-medium text-ink">
                        <span class="h-3 w-3 rounded bg-teal-200 border border-teal-600 shadow-2xs"></span>
                        ITO Reliever Duty
                    </span>
                    <span class="inline-flex items-center gap-1.5 font-medium text-ink">
                        <span class="h-3 w-3 rounded bg-sky-200 border border-sky-500 shadow-2xs"></span>
                        Registrar Class
                    </span>
                </div>
                <div class="inline-flex items-center gap-1.5 text-caption font-semibold text-navy">
                    <app-icon name="Clock" :size="13" class="text-navy" />
                    Grid Operating Hours: 7:00 AM – 10:00 PM (Monday to Saturday)
                </div>
            </div>

            <!-- VIEW MODE 1: SOLO S.A. WEEKLY GRID WITH EDIT SCHEDULE BUTTON -->
            <div v-if="viewMode === 'grid'" class="space-y-5">
                <div v-if="!filteredStaff.length" class="card p-10 text-center text-muted">
                    No Student Assistants match your search filter.
                </div>

                <div v-for="sa in filteredStaff" :key="sa.saId" class="card overflow-hidden">
                    <!-- S.A. Card Header -->
                    <div class="flex flex-col justify-between gap-3 border-b border-line bg-mist/40 px-5 py-3.5 sm:flex-row sm:items-center">
                        <div class="space-y-0.5">
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="text-[16px] font-extrabold text-navy">{{ sa.name }}</span>
                                <span class="rounded bg-navy/10 px-2 py-0.5 font-mono text-[11px] font-bold text-navy">{{ sa.studentId }}</span>
                                <span v-if="(sa.saCategory || sa.category) === 'RELIEVER'" class="rounded bg-teal-700 px-2 py-0.5 text-[11px] font-bold text-white uppercase tracking-wider">
                                    RELIEVER
                                </span>
                                <span v-else class="rounded bg-gold/25 px-2 py-0.5 text-[11px] font-bold text-navy">{{ sa.department }}</span>
                                <span class="rounded border border-line bg-page px-2 py-0.5 text-[11px] font-semibold text-ink">
                                    {{ sa.location }}
                                </span>
                            </div>
                            <p class="text-caption text-muted">
                                Course: <strong class="text-ink">{{ sa.course }}</strong> •
                                Supervisor: <strong class="text-ink">{{ sa.supervisor }}</strong> •
                                Credited Duty: <strong class="text-navy">{{ sa.creditedHours }} hrs/wk</strong> ({{ sa.rawHours }} raw hrs)
                            </p>
                        </div>

                        <div class="flex items-center gap-2">
                            <button v-if="getPrimaryRoom(sa)"
                                    type="button" @click="switchToPartnerRoom(getPrimaryRoom(sa))"
                                    class="btn btn-sm btn-secondary flex items-center gap-1.5"
                                    title="View with Partner in Room / Lab / Office">
                                <app-icon name="Users" :size="14" /> Partner View
                            </button>
                            <button type="button" @click="openEditModal(sa)" class="btn btn-sm btn-primary">
                                <app-icon name="CalendarCog" :size="15" />
                                Edit Schedule &amp; Notify Only {{ sa.name.split(' ')[0] }}
                            </button>
                        </div>
                    </div>

                    <!-- Weekly Calendar Grid (7:00 AM - 10:00 PM) -->
                    <div class="overflow-x-auto">
                        <div class="min-w-[850px]">
                            <div class="grid grid-cols-[105px_repeat(6,minmax(0,1fr))] border-b border-line bg-page text-center text-[11px] font-bold uppercase text-navy">
                                <div class="border-r border-line py-2 text-center">Time (7 AM – 10 PM)</div>
                                <div v-for="day in DAYS" :key="day.code" class="border-r border-line py-2 last:border-r-0">
                                    {{ day.label }}
                                </div>
                            </div>

                            <div class="grid grid-cols-[105px_repeat(6,minmax(0,1fr))]">
                                <!-- Hour labels column -->
                                <div class="border-r border-line bg-page/40">
                                    <div v-for="hr in HOUR_ROWS" :key="hr.start"
                                         class="border-b border-line/70 px-1 text-center text-[10px] font-semibold text-muted flex items-center justify-center"
                                         :style="{ height: PX_PER_HOUR + 'px' }">
                                        {{ hr.label }}
                                    </div>
                                </div>

                                <!-- Day columns -->
                                <div v-for="day in DAYS" :key="day.code"
                                     class="relative border-r border-line last:border-r-0 bg-white"
                                     :style="{ height: (HOUR_ROWS.length * PX_PER_HOUR) + 'px' }">
                                    <div v-for="hr in HOUR_ROWS" :key="hr.start"
                                         class="border-b border-line/50"
                                         :style="{ height: PX_PER_HOUR + 'px' }"></div>

                                    <!-- Registrar Class Blocks (Blue) - Hidden in Enrollment Mode -->
                                    <template v-if="!isEnrollmentMode">
                                        <div v-for="(cls, cIdx) in classesForDay(sa, day.code)" :key="'c-' + cIdx"
                                             class="absolute inset-x-1 overflow-hidden rounded border border-sky-500 bg-sky-100/95 px-1.5 py-0.5 text-[10px] leading-tight text-sky-950 shadow-xs cursor-pointer hover:ring-2 hover:ring-sky-500 transition"
                                             :style="blockStyle(cls.start, cls.end)"
                                             :title="'CLASS: ' + cls.subject + ' (' + cls.startLabel + ' – ' + cls.endLabel + ')'">
                                            <p class="truncate font-bold">CLASS: {{ cls.subject }}</p>
                                            <p class="truncate text-[9px] text-sky-800 font-medium">{{ cls.startLabel }}–{{ cls.endLabel }}</p>
                                        </div>
                                    </template>

                                    <!-- Duty Blocks (Amber for Primary, Teal for Reliever) -->
                                    <div v-for="(b, bIdx) in blocksForDay(sa, day.code)" :key="'d-' + bIdx"
                                         @click="openEditModal(sa)"
                                         class="absolute inset-x-1 cursor-pointer overflow-hidden rounded border px-1.5 py-1 text-[10px] leading-tight shadow-xs transition hover:ring-2"
                                         :class="b.location && b.location.includes('Reliever')
                                             ? 'border-teal-600 bg-teal-100/95 text-teal-950 hover:ring-teal-600'
                                             : 'border-amber-500 bg-amber-100/95 text-amber-950 hover:ring-amber-500'"
                                         :style="blockStyle(b.start, b.end)"
                                         :title="'Click to edit • DUTY: ' + b.location + ' (' + b.startLabel + ' – ' + b.endLabel + ')'">
                                        <p class="truncate font-bold" :class="b.location && b.location.includes('Reliever') ? 'text-teal-900' : 'text-amber-950'">
                                            {{ b.location }} ({{ b.credited }}h)
                                        </p>
                                        <p class="truncate text-[9px] font-medium" :class="b.location && b.location.includes('Reliever') ? 'text-teal-800' : 'text-amber-800'">
                                            {{ b.startLabel }}–{{ b.endLabel }}
                                        </p>
                                        <p v-if="b.hasBreak" class="truncate text-[8.5px] font-semibold" :class="b.location && b.location.includes('Reliever') ? 'text-teal-800' : 'text-amber-800'">
                                            -1h lunch
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- VIEW MODE 2: WITH PARTNER (LABORATORY / ROOM / OFFICE) VIEW -->
            <div v-else-if="viewMode === 'room'" class="space-y-6">
                <div v-if="!filteredRooms.length" class="card p-10 text-center text-muted">
                    No approved room or office schedules match the selected filter.
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

                            <!-- Partner S.A. Cards with Edit & Solo buttons -->
                            <div class="mt-3 flex flex-wrap gap-2.5">
                                <div v-for="(p, pIdx) in grp.partners" :key="p.saId"
                                     class="flex items-center gap-3 rounded-lg border border-line bg-page/60 px-3 py-2">
                                    <div>
                                        <div class="text-[13px] font-bold text-navy flex items-center gap-1.5">
                                            <span>{{ pIdx + 1 }}. {{ p.name }}</span>
                                            <span class="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-900">
                                                {{ p.creditedHours }}h/wk
                                            </span>
                                        </div>
                                        <div class="text-[11px] text-muted">
                                            {{ p.studentId }} · {{ p.course }} · Sup: {{ p.supervisor }}
                                        </div>
                                    </div>
                                    <div class="flex items-center gap-1.5 shrink-0">
                                        <button type="button"
                                                @click="openEditModal(p)"
                                                class="btn btn-primary btn-xs flex items-center gap-1"
                                                :title="'Edit Schedule for ' + p.name">
                                            <app-icon name="CalendarCog" :size="12" /> Edit
                                        </button>
                                        <button type="button"
                                                @click="switchToSoloSa(p.name)"
                                                class="btn btn-secondary btn-xs flex items-center gap-1"
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

                    <!-- Combined Partner Weekly Schedule Grid (7:00 AM - 10:00 PM) -->
                    <div class="min-w-[980px]">
                        <div class="grid grid-cols-7 border-b border-line bg-page text-caption font-bold text-navy">
                            <div class="p-2.5 border-r border-line flex items-center justify-center text-center">Time (7 AM – 10 PM)</div>
                            <div v-for="day in DAYS" :key="day.code" class="border-r border-line">
                                <div class="p-1.5 text-center border-b border-line/70">{{ day.label }}</div>
                                <div class="grid divide-x divide-line/60 bg-white/70 text-[10px] font-semibold text-muted"
                                     :style="{ gridTemplateColumns: 'repeat(' + Math.max(1, grp.partners.length) + ', minmax(0, 1fr))' }">
                                    <div v-for="(p, pIdx) in grp.partners" :key="p.saId"
                                         class="px-1 py-1 text-center truncate"
                                         :title="p.name">
                                        {{ pIdx + 1 }}. {{ p.firstName }}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="grid grid-cols-7 relative" :style="{ height: (HOUR_ROWS.length * PX_PER_HOUR) + 'px' }" @click="closeBlockPopover">
                            <!-- Time Column -->
                            <div class="border-r border-line bg-page/40">
                                <div v-for="row in HOUR_ROWS" :key="row.start"
                                     class="border-b border-line/70 px-1 text-[10.5px] font-semibold text-muted flex items-center justify-center text-center"
                                     :style="{ height: PX_PER_HOUR + 'px' }">
                                    {{ row.label }}
                                </div>
                            </div>

                            <!-- Day Columns with Partner Sub-Columns -->
                            <div v-for="day in DAYS" :key="day.code" class="relative border-r border-line bg-white">
                                <div class="grid h-full divide-x divide-line/60"
                                     :style="{ gridTemplateColumns: 'repeat(' + Math.max(1, grp.partners.length) + ', minmax(0, 1fr))' }">
                                    <div v-for="(p, pIdx) in grp.partners" :key="p.saId" class="relative h-full">
                                        <div v-for="row in HOUR_ROWS" :key="row.start"
                                             class="border-b border-line/50"
                                             :style="{ height: PX_PER_HOUR + 'px' }"></div>

                                        <!-- Partner Registrar Classes (Blue) - Hidden in Enrollment Mode -->
                                        <template v-if="!isEnrollmentMode">
                                            <div v-for="(cls, ci) in classesForDay(p, day.code)" :key="'rc-' + ci"
                                                 @click.stop="toggleBlockPopover(p, cls, 'CLASS', day, grp.key)"
                                                 :title="p.name + ' · CLASS: ' + cls.subject + ' (' + cls.startLabel + '–' + cls.endLabel + ')'"
                                                 class="absolute left-0.5 right-0.5 rounded border border-sky-500 bg-sky-100/95 px-1 py-0.5 text-[9.5px] leading-tight text-sky-950 overflow-hidden cursor-pointer hover:ring-2 hover:ring-sky-500 transition"
                                                 :style="blockStyle(cls.start, cls.end)">
                                                <div class="font-bold truncate">CLASS: {{ cls.subject }}</div>
                                                <div class="truncate">{{ cls.startLabel }}–{{ cls.endLabel }}</div>
                                            </div>
                                        </template>

                                        <!-- Partner Official Duty Blocks (Amber for Primary in this room, Teal for Reliever) -->
                                        <div v-for="(b, bi) in blocksForDay(p, day.code)" :key="'rd-' + bi"
                                             @click.stop="toggleBlockPopover(p, b, 'DUTY', day, grp.key)"
                                             :title="p.name + ' · DUTY: ' + b.location + ' (' + (b.credited || b.hours) + 'h) · ' + b.startLabel + '–' + b.endLabel"
                                             class="absolute left-0.5 right-0.5 rounded border px-1 py-0.5 text-[9.5px] leading-tight overflow-hidden cursor-pointer transition"
                                             :class="b.location && b.location.includes('Reliever')
                                                 ? 'border-teal-600 bg-teal-100/95 text-teal-950 hover:ring-2 hover:ring-teal-600'
                                                 : 'border-amber-500 bg-amber-100/95 text-amber-950 hover:ring-2 hover:ring-amber-500'"
                                             :style="blockStyle(b.start, b.end)">
                                            <div class="font-bold truncate">{{ p.firstName }}: {{ b.location }} ({{ b.credited || b.hours }}h)</div>
                                            <div class="truncate">{{ b.startLabel }}–{{ b.endLabel }}</div>
                                            <div v-if="b.hasBreak" class="text-[8.5px] font-semibold truncate" :class="b.location && b.location.includes('Reliever') ? 'text-teal-800' : 'text-amber-800'">-1h lunch</div>
                                        </div>

                                        <!-- Reliever Duty Blocks (Teal/Blue, plotted directly on the Grid as in NCST Schedule Sheet) -->
                                        <div v-for="(rb, rbi) in relieverBlocksForPartner(grp, p, day.code)" :key="'relb-' + rbi"
                                             @click.stop="toggleBlockPopover({ saId: rb.saId, name: rb.saName, studentId: rb.studentId }, { location: grp.room + ' (Reliever)', start: rb.start, end: rb.end, credited: rb.credited, startLabel: rb.startLabel, endLabel: rb.endLabel }, 'DUTY', day, grp.key)"
                                             :title="'RELIEVER: ' + rb.saName + ' (' + rb.credited + 'h) · ' + rb.startLabel + '–' + rb.endLabel"
                                             class="absolute left-0.5 right-0.5 rounded border border-teal-600 bg-teal-100/95 text-teal-950 px-1 py-0.5 text-[9.5px] leading-tight overflow-hidden cursor-pointer transition hover:ring-2 hover:ring-teal-600 z-[3]"
                                             :style="blockStyle(rb.start, rb.end)">
                                            <div class="font-bold truncate text-teal-900 flex items-center justify-between gap-1">
                                                <span class="truncate">REL: {{ rb.firstName }}</span>
                                                <span class="rounded bg-teal-700 px-1 text-[7.5px] font-bold text-white shrink-0">{{ rb.credited }}h</span>
                                            </div>
                                            <div class="truncate text-teal-950 font-medium">{{ rb.startLabel }}–{{ rb.endLabel }}</div>
                                        </div>
                                    </div>
                                </div>

                                <!-- Floating Popover Card when a Block is Clicked -->
                                <div v-if="activeBlock && activeBlock.contextKey === grp.key && activeBlock.dayCode === day.code"
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
                                        <button type="button"
                                                @click.stop="closeBlockPopover"
                                                class="rounded p-0.5 text-muted hover:bg-page hover:text-ink"
                                                title="Close">
                                            <app-icon name="X" :size="14" />
                                        </button>
                                    </div>
                                    <div class="mt-1.5 text-[11px] font-bold text-muted uppercase">
                                        {{ activeBlock.saName }} ({{ activeBlock.studentId }})
                                    </div>
                                    <div class="mt-0.5 text-[13px] font-bold text-navy break-words">
                                        {{ activeBlock.title }}
                                    </div>
                                    <div class="mt-1 text-[12px] font-semibold text-ink">
                                        {{ activeBlock.dayLabel }} · {{ activeBlock.timeLabel }}
                                    </div>
                                    <div class="mt-0.5 text-[11px] text-muted">
                                        {{ activeBlock.hoursLabel }}
                                    </div>
                                    <div v-if="activeBlock.lunchNote"
                                         class="mt-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 border border-amber-200">
                                        {{ activeBlock.lunchNote }}
                                    </div>
                                    <div class="mt-2.5 pt-2 border-t border-line flex items-center justify-between gap-2">
                                        <button type="button"
                                                @click="closeBlockPopover(); openEditModal(activeBlock.sa)"
                                                class="btn btn-primary btn-xs flex items-center gap-1">
                                            <app-icon name="CalendarCog" :size="12" /> Edit Schedule
                                        </button>
                                        <button type="button"
                                                @click="switchToSoloSa(activeBlock.saName)"
                                                class="btn btn-secondary btn-xs flex items-center gap-1">
                                            <app-icon name="User" :size="12" /> Solo
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- VIEW MODE 3: TABLE VIEW -->
            <div v-else-if="viewMode === 'table'" class="card overflow-hidden">
                <div class="overflow-x-auto">
                    <table class="w-full text-left text-body">
                        <thead class="bg-mist/70 text-caption font-bold uppercase text-muted">
                            <tr>
                                <th class="px-4 py-3">Student Assistant</th>
                                <th class="px-4 py-3">Dept &amp; Location</th>
                                <th class="px-4 py-3">Supervisor</th>
                                <th class="px-4 py-3">Weekly Duty Schedule</th>
                                <th class="px-4 py-3 text-center">Credited Hrs</th>
                                <th class="px-4 py-3 text-right">Action</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-line">
                            <tr v-for="sa in filteredStaff" :key="sa.saId" class="hover:bg-mist/30">
                                <td class="px-4 py-3">
                                    <p class="font-bold text-navy">{{ sa.name }}</p>
                                    <p class="text-caption text-muted">{{ sa.studentId }} • {{ sa.course }}</p>
                                </td>
                                <td class="px-4 py-3">
                                    <span class="rounded bg-navy/10 px-2 py-0.5 text-[11px] font-bold text-navy">{{ sa.department }}</span>
                                    <p class="mt-0.5 text-caption font-semibold text-ink">{{ sa.location }}</p>
                                </td>
                                <td class="px-4 py-3 text-caption font-medium text-ink">
                                    {{ sa.supervisor }}
                                </td>
                                <td class="px-4 py-3">
                                    <div class="flex flex-wrap gap-1">
                                        <span v-for="(b, idx) in sa.blocks" :key="idx"
                                              class="rounded border border-line bg-mist/60 px-2 py-0.5 text-[11px] font-medium text-ink">
                                            <strong class="text-navy">{{ b.day }}</strong> {{ b.startLabel }}–{{ b.endLabel }}
                                        </span>
                                    </div>
                                </td>
                                <td class="px-4 py-3 text-center font-extrabold text-navy">
                                    {{ sa.creditedHours }}h
                                </td>
                                <td class="px-4 py-3 text-right">
                                    <button type="button" @click="openEditModal(sa)" class="btn btn-sm btn-primary">
                                        <app-icon name="CalendarCog" :size="14" />
                                        Edit &amp; Notify
                                    </button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <!-- VIEW MODE 3: RECENT SCHEDULE CHANGES HISTORY -->
            <div v-else class="card overflow-hidden">
                <div class="border-b border-line p-4">
                    <h3 class="font-bold text-navy">Individual Final Schedule Adjustments</h3>
                    <p class="text-caption text-muted">Audit trail of schedule edits made on Final Schedule with targeted notifications.</p>
                </div>
                <div class="overflow-x-auto">
                    <table class="w-full text-left text-body">
                        <thead class="bg-mist/70 text-caption font-bold uppercase text-muted">
                            <tr>
                                <th class="px-4 py-3">Date &amp; Time</th>
                                <th class="px-4 py-3">Student Assistant</th>
                                <th class="px-4 py-3">Summary</th>
                                <th class="px-4 py-3">Reason</th>
                                <th class="px-4 py-3">Edited By</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-line">
                            <tr v-if="!(schedule.changes && schedule.changes.length)">
                                <td colspan="5" class="p-8 text-center text-muted">No individual schedule edits recorded yet.</td>
                            </tr>
                            <tr v-for="ch in (schedule.changes || [])" :key="ch.id">
                                <td class="px-4 py-3 text-caption text-muted">{{ Format.dateTime(ch.createdAt) }}</td>
                                <td class="px-4 py-3">
                                    <p class="font-bold text-navy">{{ ch.name }}</p>
                                    <p class="text-caption text-muted">{{ ch.studentId }}</p>
                                </td>
                                <td class="px-4 py-3 text-caption font-medium text-ink">{{ ch.summary }}</td>
                                <td class="px-4 py-3 text-caption text-ink">{{ ch.reason }}</td>
                                <td class="px-4 py-3 text-caption text-muted">{{ ch.changedBy }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </template>

        <!-- MODAL: EDIT INDIVIDUAL S.A. SCHEDULE & SEND TARGETED NOTIFICATION -->
        <app-modal :open="showEditModal" :title="'Edit Final Schedule — ' + (targetSa?.name || '')" @close="showEditModal = false">
            <div v-if="targetSa" class="space-y-4">
                <!-- Targeted Notification Highlight Box -->
                <div class="rounded-xl border border-emerald-300 bg-emerald-50 p-3.5 text-caption text-emerald-950">
                    <div class="flex items-start gap-2.5">
                        <app-icon name="BellRing" :size="18" class="mt-0.5 shrink-0 text-emerald-700" />
                        <div>
                            <p class="font-bold text-emerald-900">Targeted Notification Only</p>
                            <p class="mt-0.5">
                                Saving this change will send a notification <strong>ONLY</strong> to:
                                <span class="underline font-bold">{{ targetSa.name }}</span> (S.A.) and
                                <span class="underline font-bold">{{ targetSa.supervisor }}</span> (Supervisor).
                            </p>
                        </div>
                    </div>
                </div>

                <!-- Official Registrar Class Schedule Reference (to avoid conflicts in regular semester) -->
                <div v-if="!isEnrollmentMode && targetSa.classes && targetSa.classes.length" class="rounded-xl border border-line bg-mist/40 p-3">
                    <p class="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">
                        Official Registrar Class Schedule (Avoid Overlapping These Times):
                    </p>
                    <div class="flex flex-wrap gap-1.5">
                        <span v-for="(cls, idx) in targetSa.classes" :key="idx"
                              class="rounded border border-slate-300 bg-white px-2 py-0.5 text-[11px] text-slate-700">
                            <strong>{{ cls.day }}</strong> {{ cls.startLabel }}–{{ cls.endLabel }} ({{ cls.subject }})
                        </span>
                    </div>
                </div>
                <div v-else-if="isEnrollmentMode" class="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-caption text-amber-900">
                    <div class="flex items-center gap-2 font-bold text-amber-950">
                        <app-icon name="CalendarCheck" :size="16" class="text-amber-700" />
                        <span>Enrollment Schedule Period (No Academic Classes)</span>
                    </div>
                    <p class="mt-1 text-xs text-amber-800">
                        S.A.s have no academic classes during this period as the semester has concluded. The standard duty schedule is 8:00 AM – 5:00 PM for enrollment assistance.
                    </p>
                </div>

                <!-- Duty Blocks Editor -->
                <div class="space-y-2">
                    <div class="flex items-center justify-between">
                        <label class="text-caption font-bold uppercase text-navy">Duty Schedule Blocks (Mon–Sat)</label>
                        <button type="button" @click="addBlockRow" class="btn btn-sm btn-outline">
                            <app-icon name="Plus" :size="14" /> Add Duty Block
                        </button>
                    </div>

                    <div class="max-h-64 space-y-2 overflow-y-auto pr-1">
                        <div v-for="(b, idx) in editBlocks" :key="idx"
                             class="grid grid-cols-1 gap-2 rounded-xl border border-line bg-page p-2.5 sm:grid-cols-12 sm:items-center">
                            <div class="sm:col-span-3">
                                <label class="block text-[10px] font-bold uppercase text-muted">Day</label>
                                <select v-model="b.day" class="w-full rounded-lg border border-line bg-white px-2 py-1.5 text-caption font-semibold">
                                    <option v-for="d in DAYS" :key="d.code" :value="d.code">{{ d.label }}</option>
                                </select>
                            </div>
                            <div class="sm:col-span-3">
                                <label class="block text-[10px] font-bold uppercase text-muted">Start Time</label>
                                <input v-model="b.startTime" type="time" class="w-full rounded-lg border border-line bg-white px-2 py-1.5 text-caption" />
                            </div>
                            <div class="sm:col-span-3">
                                <label class="block text-[10px] font-bold uppercase text-muted">End Time</label>
                                <input v-model="b.endTime" type="time" class="w-full rounded-lg border border-line bg-white px-2 py-1.5 text-caption" />
                            </div>
                            <div class="sm:col-span-2">
                                <label class="block text-[10px] font-bold uppercase text-muted">Location</label>
                                <input v-model="b.location" type="text" class="w-full rounded-lg border border-line bg-white px-2 py-1.5 text-caption" />
                            </div>
                            <div class="flex items-end justify-end sm:col-span-1 sm:pt-3">
                                <button type="button" @click="removeBlockRow(idx)" class="rounded-lg p-1.5 text-danger hover:bg-danger/10" title="Remove Block">
                                    <app-icon name="Trash2" :size="15" />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Required Reason -->
                <form-field label="Reason for Schedule Modification" required>
                    <input v-model="editReason" type="text"
                           placeholder="e.g. Adjusted Tuesday afternoon shift due to laboratory schedule change"
                           class="w-full rounded-lg border border-line bg-page px-3.5 py-2 text-body focus:border-navy focus:outline-none" />
                </form-field>
            </div>

            <template #footer>
                <div class="flex items-center justify-end gap-2">
                    <button type="button" @click="showEditModal = false" class="btn btn-outline" :disabled="savingEdit">Cancel</button>
                    <button type="button" @click="submitEditSchedule" class="btn btn-primary" :disabled="savingEdit">
                        <app-icon name="Send" :size="15" />
                        {{ savingEdit ? 'Saving & Notifying...' : 'Save Changes & Notify S.A. + Supervisor' }}
                    </button>
                </div>
            </template>
        </app-modal>
    </div>
    `
};

