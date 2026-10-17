// Scheduling > Finalize Schedule (Page 7)
// Combines:
//   1. Approved ITO & ACADS room/laboratory assignments from Recommendations
//   2. Approved OFFICE assignments from Office Staffing
// Re-validates all schedules for 0 class conflicts, 0 category mismatches, and 0 duplicates before finalization.
const FinalizedSchedulePage = {
    components: { AppIcon, PageHeader, AppModal },

    setup() {
        const loading = Vue.ref(true);
        const busy = Vue.ref(false);
        const loadError = Vue.ref("");
        const semester = Vue.ref(null);
        const schedule = Vue.ref(null);

        const viewMode = Vue.ref("grid"); // "grid" | "table"
        const deptFilter = Vue.ref("ALL"); // "ALL" | "OFFICE" | "ACADS" | "ITO"
        const searchQuery = Vue.ref("");
        const activeBlock = Vue.ref(null);

        const DAYS = [
            { code: "MON", label: "Monday" },
            { code: "TUE", label: "Tuesday" },
            { code: "WED", label: "Wednesday" },
            { code: "THU", label: "Thursday" },
            { code: "FRI", label: "Friday" },
            { code: "SAT", label: "Saturday" },
        ];

        const formatTime12 = (m) => {
            const hrs = Math.floor(m / 60);
            const mins = m % 60;
            const h12 = hrs % 12 === 0 ? 12 : hrs % 12;
            const ampm = hrs >= 12 ? "PM" : "AM";
            return `${h12}:${String(mins).padStart(2, "0")} ${ampm}`;
        };

        const HOUR_ROWS = [];
        for (let m = 420; m < 1320; m += 60) {
            HOUR_ROWS.push({
                start: m,
                end: m + 60,
                label: `${formatTime12(m)} – ${formatTime12(m + 60)}`,
            });
        }
        const GRID_START = 420;
        const GRID_END = 1320;
        const PX_PER_HOUR = 42;

        const blockStyle = (startMin, endMin) => {
            const s = Math.max(GRID_START, Math.min(GRID_END, Number(startMin) || GRID_START));
            const e = Math.max(s + 15, Math.min(GRID_END, Number(endMin) || s + 60));
            const top = ((s - GRID_START) / 60) * PX_PER_HOUR;
            const height = Math.max(20, ((e - s) / 60) * PX_PER_HOUR - 2);
            return { top: `${top}px`, height: `${height}px` };
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

        const DAY_SORT_INDEX = { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6, SUN: 7 };

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
            const showAbove = s >= 1080; // If 6:00 PM or later, float above the block
            const isReliever = type === "DUTY" && item.location && item.location.includes("Reliever");

            activeBlock.value = {
                key,
                contextKey,
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
                    : `DUTY: ${item.location} (${item.credited}h)`,
                timeLabel: `${item.startLabel} – ${item.endLabel}`,
                hoursLabel: type === "CLASS"
                    ? `${item.hours || Math.round(((e - s) / 60) * 10) / 10} class hr(s)`
                    : `${item.credited} credited hr(s) (${item.hours} raw hr(s))`,
                lunchNote: type === "DUTY" && item.hasBreak ? "-1h lunch break deducted" : "",
                popoverStyle: showAbove
                    ? { top: `${Math.max(4, top - 118)}px` }
                    : { top: `${top + height + 4}px` },
                alignRight: day.code === "FRI" || day.code === "SAT",
            };
        };

        const load = async () => {
            loading.value = true;
            loadError.value = "";
            const res = await Model.request("scheduling", "schedule_view");
            loading.value = false;
            if (!res.success) {
                loadError.value = res.message || "Could not load Finalize Schedule.";
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

        const toggleDeptFilter = (dept) => {
            deptFilter.value = deptFilter.value === dept ? "ALL" : dept;
        };

        const getPrimaryRoom = (sa) => {
            const primaryBlocks = (sa.blocks || []).filter(b => !(b.location || "").includes("Reliever"));
            if (primaryBlocks.length > 0) {
                return primaryBlocks[0]?.location || "";
            }
            if ((sa.category || sa.saCategory) === "RELIEVER") return "";
            return "";
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
                    (s.department || "").toLowerCase().includes(term)
                );
            });
        });

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
                        saId: sa.saId,
                        slotNo: grp.partners.length + 1,
                        name: sa.name,
                        firstName: (sa.name || "").trim().split(/\s+/)[0],
                        studentId: sa.studentId,
                        course: sa.course,
                        yearLevel: sa.yearLevel,
                        category: sa.category,
                        department: sa.department,
                        creditedHours: sa.creditedHours,
                        rawHours: sa.rawHours,
                        lunchRule: sa.lunchRule,
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
                        donorRoom: primaryRoom || "Dedicated Reliever",
                        credited: rb.credited,
                    });
                }
            }

            const rooms = Array.from(roomMap.values()).filter(g => g.partners.length > 0);
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

        const finalize = async () => {
            if (busy.value) return;
            const isRe = schedule.value && schedule.value.status !== "DRAFT";
            const ok = await Alerts.confirm({
                title: isRe ? "Re-Finalize Official Schedule?" : "Finalize Official Schedule?",
                html: `Finalize the official duty schedules for <b class="text-ink">${schedule.value?.summary?.sas || 0} S.A.(s)</b> (${schedule.value?.summary?.hours || 0} total credited hrs/wk)?`,
                confirmText: isRe ? "Re-Finalize Schedule" : "Finalize Schedule",
                requireReason: false
            });
            if (!ok) return;

            busy.value = true;
            const res = await Model.request("scheduling", "schedule_finalize");
            busy.value = false;
            if (!res.success) {
                Store.toast("danger", res.message || "Could not finalize schedule.");
                return;
            }
            schedule.value = res.schedule;
            await Alerts.success("Schedule Finalized", "Official semester schedule finalized successfully!");
        };

        const publish = async () => {
            if (busy.value) return;
            const isRe = schedule.value && schedule.value.status === "PUBLISHED";
            const ok = await Alerts.confirm({
                title: isRe ? "Re-Publish & Notify All?" : "Publish Official Schedule?",
                html: `Publish the official semester duty schedule and send notifications to all <b class="text-ink">${schedule.value?.summary?.sas || 0} assigned S.A.(s)</b> and their <b class="text-ink">Supervisors</b> so they can immediately view their schedules in their accounts?`,
                confirmText: "Publish & Notify All",
                requireReason: false
            });
            if (!ok) return;

            busy.value = true;
            const res = await Model.request("scheduling", "schedule_publish");
            busy.value = false;
            if (!res.success) {
                Store.toast("danger", res.message || "Could not publish schedule.");
                Alerts.error("Could not publish schedule", res.message || "Please check schedule conflicts.");
                return;
            }
            schedule.value = res.schedule;
            const nSa = res.schedule?.notifiedSas ?? (res.schedule?.summary?.sas || 0);
            const nSup = res.schedule?.notifiedSupervisors ?? 0;
            Store.toast("success", `Official schedule published! Notified ${nSa} S.A.(s) and ${nSup} Supervisor(s).`);
            if (Store.loadNotifications) Store.loadNotifications();
            const result = await Swal.fire({
                icon: "success",
                title: "Official Schedule Published!",
                html: `
                    <div class="text-left text-[13px] space-y-2 mt-1">
                        <p>The official duty schedule is now <b>PUBLISHED</b> and live across all accounts:</p>
                        <ul class="list-disc pl-5 space-y-1">
                            <li><b>${nSa} Student Assistants</b> received an in-app notification and can now view their official duty schedules in <b>My Schedule</b> and <b>Dashboard</b>.</li>
                            <li><b>${nSup} Department &amp; Office Supervisors</b> received an in-app notification and can now view their assigned S.A.s in <b>My S.A. Team</b>.</li>
                        </ul>
                        <p class="text-navy font-semibold pt-2 text-[13px]">
                            Nai-unlock na rin ang <b>Step 8: Schedule Adjustment</b> at makikita na ang lahat ng iskedyul para sa individual adjustments.
                        </p>
                    </div>
                `,
                showCancelButton: true,
                confirmButtonText: "Bumukas sa Schedule Adjustment",
                cancelButtonText: "Manatili sa Step 7",
                confirmButtonColor: "#0a143c",
                cancelButtonColor: "#64748b"
            });
            if (result.isConfirmed) {
                location.hash = "#/admin/scheduling/final-schedule";
            }
        };

        const exportCsv = async () => {
            const staff = filteredStaff.value;
            if (!staff.length) {
                Store.toast("info", "No approved schedules to export.");
                return;
            }
            const ok = await Alerts.confirm({
                title: "Export Schedule to CSV?",
                html: `Download the CSV file for <b class="text-ink">${staff.length} S.A. schedule(s)</b>?`,
                confirmText: "Export CSV",
                requireReason: false
            });
            if (!ok) return;

            const lines = [
                ["Student ID", "Full Name", "Category", "Course", "Assigned Room / Office", "Day", "Start Time", "End Time", "Raw Hours", "Credited Hours", "Lunch Break Deducted", "Weekly Total Credited Hours"].join(",")
            ];
            for (const s of staff) {
                for (const b of (s.blocks || [])) {
                    lines.push([
                        `"${s.studentId}"`,
                        `"${s.name}"`,
                        `"${s.category}"`,
                        `"${s.course}"`,
                        `"${b.location}"`,
                        `"${b.day}"`,
                        `"${b.startLabel}"`,
                        `"${b.endLabel}"`,
                        b.hours,
                        b.credited,
                        b.hasBreak ? '"Yes (-1h)"' : '"No"',
                        s.creditedHours,
                    ].join(","));
                }
            }
            const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `AssistPay_Final_Schedule_${semester.value?.academicYear || "Semester"}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        };

        const isEnrollmentMode = Vue.computed(() => {
            return (semester.value?.dutyScheduleMode || schedule.value?.dutyScheduleMode) === "ENROLLMENT";
        });

        const applyEnrollment = async () => {
            if (busy.value) return;
            const ok = await Alerts.confirm({
                title: "Apply 8AM–5PM Enrollment Schedule?",
                html: `
                    <div class="text-left text-[13px] space-y-2 mt-1">
                        <p>This will set the duty schedule for all active Student Assistants to <b>8:00 AM – 5:00 PM (Monday–Friday)</b> and <b>8:00 AM – 12:00 PM (Saturday)</b> during the enrollment period.</p>
                        <p class="text-muted">A complete backup of existing class-matched regular schedules will be preserved so you can reset back at any time. S.A. attendance DTR time-in/out and allowance computations will follow this 8–5 schedule.</p>
                    </div>
                `,
                confirmText: "Apply Enrollment Schedule (8-5)",
                confirmButtonColor: "#059669"
            });
            if (!ok) return;

            busy.value = true;
            const res = await Model.request("scheduling", "apply_enrollment_schedule", {
                semesterId: semester.value?.id
            });
            busy.value = false;
            if (!res.success) {
                Store.toast("danger", res.message || "Could not apply enrollment schedule.");
                Alerts.error("Error", res.message || "Failed to switch to enrollment schedule.");
                return;
            }
            Store.toast("success", `Enrollment schedule applied to ${res.assignedCount || 0} active S.A.s!`);
            await Alerts.success(
                "Enrollment Schedule Active (8-5)",
                `Switched ${res.assignedCount || 0} active S.A.s to 8:00 AM – 5:00 PM duty. Original schedule safely backed up.`
            );
            await load();
        };

        const resetToSemester = async () => {
            if (busy.value) return;
            const ok = await Alerts.confirm({
                title: "Reset to Regular Semester Schedule?",
                html: `
                    <div class="text-left text-[13px] space-y-2 mt-1">
                        <p>This will <b>restore the original class-matched room, laboratory, and office schedules</b> from the backup saved prior to enrollment.</p>
                        <p class="text-muted">Attendance logs, time-in/out validation, and allowance computations will immediately return to following regular semester schedules.</p>
                    </div>
                `,
                confirmText: "Reset to Regular Schedule",
                confirmButtonColor: "#2563eb"
            });
            if (!ok) return;

            busy.value = true;
            const res = await Model.request("scheduling", "reset_semester_schedule", {
                semesterId: semester.value?.id
            });
            busy.value = false;
            if (!res.success) {
                Store.toast("danger", res.message || "Could not reset schedule.");
                Alerts.error("Error", res.message || "Failed to reset to regular schedule.");
                return;
            }
            Store.toast("success", `Reset complete! Restored ${res.restoredCount || 0} duty schedule assignments.`);
            await Alerts.success(
                "Regular Schedule Restored",
                `Restored ${res.restoredCount || 0} official schedule assignments. Mode is now Regular Semester.`
            );
            await load();
        };

        return {
            loading, busy, loadError, semester, schedule,
            viewMode, deptFilter, searchQuery, filteredStaff, filteredRooms,
            countByDept, toggleDeptFilter, getPrimaryRoom, switchToPartnerRoom, switchToSoloSa,
            DAYS, HOUR_ROWS, PX_PER_HOUR, blockStyle,
            activeBlock, toggleBlockPopover, closeBlockPopover,
            relieverBlocksForPartner,
            isEnrollmentMode, applyEnrollment, resetToSemester,
            load, finalize, publish, exportCsv, Format
        };
    },

    template: `
    <page-header title="Finalize Schedule" section="Scheduling"
                 :subtitle="semester ? 'Combined official duty schedules for approved ITO, ACADS, and OFFICE Student Assistants (' + semester.label + ').' : 'Combined official duty schedules.'">
        <template #actions>
            <div class="flex flex-wrap items-center gap-2">
                <!-- Reset to Regular Semester Schedule (only shown if in Enrollment Mode) -->
                <button v-if="isEnrollmentMode"
                        @click="resetToSemester"
                        :disabled="busy"
                        class="btn btn-secondary btn-sm border-sky-300 text-sky-900 bg-sky-50 hover:bg-sky-100"
                        title="Restore regular semester class-matched schedule from backup">
                    <app-icon name="RotateCcw" :size="15" class="text-sky-700" />
                    Reset to Regular Semester Schedule
                </button>

                <button @click="exportCsv" :disabled="!schedule || !schedule.staff || !schedule.staff.length"
                        class="btn btn-secondary btn-sm">
                    <app-icon name="Download" :size="15" /> Export CSV
                </button>
                <button @click="finalize"
                        :disabled="busy || !schedule || !schedule.staff || !schedule.staff.length || (schedule.clashes && schedule.clashes.length > 0)"
                        class="btn btn-secondary btn-sm">
                    <app-icon name="ShieldCheck" :size="15" />
                    {{ schedule && schedule.status !== 'DRAFT' ? 'Re-Finalize Schedule' : 'Finalize Schedule' }}
                </button>
                <button @click="publish"
                        :disabled="busy || !schedule || !schedule.staff || !schedule.staff.length"
                        class="btn btn-primary btn-sm bg-emerald-600 hover:bg-emerald-700 text-white">
                    <app-icon name="Send" :size="15" />
                    {{ schedule && schedule.status === 'PUBLISHED' ? 'Re-Publish Official Schedule (Notify All)' : 'Publish Official Schedule (Notify All)' }}
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
        <p class="mt-3 text-body font-medium text-ink">Could not load Finalize Schedule</p>
        <p class="mt-1 text-caption text-muted">{{ loadError }}</p>
        <button @click="load" class="btn btn-secondary btn-sm mt-4"><app-icon name="RefreshCw" :size="14" /> Try again</button>
    </div>

    <template v-else-if="schedule">
        <!-- Duty Schedule Mode Banner (Enrollment vs Regular Semester) -->
        <div v-if="isEnrollmentMode"
             class="card mb-4 border-l-4 border-l-amber-500 bg-gradient-to-r from-amber-50/80 to-white p-4">
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div class="flex items-start gap-3">
                    <div class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-800">
                        <app-icon name="Clock" :size="20" />
                    </div>
                    <div>
                        <div class="flex items-center gap-2">
                            <h3 class="text-[15px] font-bold text-amber-950">Enrollment Period Duty Mode Active (8:00 AM – 5:00 PM)</h3>
                            <span class="rounded-full bg-amber-200 px-2.5 py-0.5 text-[11px] font-extrabold text-amber-900">ENROLLMENT</span>
                        </div>
                        <p class="mt-0.5 text-caption text-amber-800">
                            Active S.A.s are currently on fixed <b>8:00 AM – 5:00 PM</b> duty (Mon–Fri with 1-hr lunch break, Sat 8:00 AM – 12:00 PM). DTR time-in/out and allowance computations follow this enrollment schedule.
                        </p>
                    </div>
                </div>
                <button @click="resetToSemester" :disabled="busy" class="btn btn-primary btn-sm shrink-0 bg-navy hover:bg-navy-700">
                    <app-icon name="RotateCcw" :size="14" /> Reset to Regular Semester Schedule
                </button>
            </div>
        </div>

        <!-- Status & Summary Cards -->
        <section class="card mb-5 p-5">
            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-line pb-4">
                <div>
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="rounded-full px-3 py-1 text-[12px] font-bold uppercase"
                              :class="schedule.status === 'PUBLISHED'
                                  ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                                  : (schedule.status === 'FINALIZED' ? 'bg-sky-100 text-sky-900' : 'bg-amber-100 text-amber-900')">
                            Status: {{ schedule.status }}
                        </span>
                        <span v-if="schedule.status === 'PUBLISHED'" class="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-3 py-1 text-[12px] font-semibold text-emerald-800 border border-emerald-200">
                            <app-icon name="BellRing" :size="13" class="text-emerald-600" />
                            Sent to all Supervisors &amp; Student Assistants (Live in their accounts)
                        </span>
                        <span class="inline-flex items-center gap-1 rounded-full bg-page px-3 py-1 text-[12px] font-medium text-muted">
                            <app-icon name="CheckCheck" :size="14" class="text-success" />
                            Combines Approved ITO/ACADS Recommendations + Approved Office Staffing
                        </span>
                    </div>
                    <p class="mt-1.5 text-caption text-muted">
                        View all approved Student Assistant schedules individually (Solo) or side-by-side with their Partner per Laboratory / Room / Office.
                    </p>
                </div>
                <div class="flex flex-wrap items-center gap-1 rounded-lg bg-page p-1 border border-line">
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
            </div>

            <dl class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div class="rounded-lg bg-page px-4 py-3">
                    <dt class="text-caption text-muted">Total Approved S.A.s</dt>
                    <dd class="mt-0.5 text-[20px] font-bold text-navy">{{ schedule.summary.sas }}</dd>
                    <dd class="text-[11px] text-muted">{{ schedule.summary.blocks }} duty blocks</dd>
                </div>
                <div class="rounded-lg bg-page px-4 py-3">
                    <dt class="text-caption text-muted">Approved ITO S.A.s</dt>
                    <dd class="mt-0.5 text-[20px] font-bold text-sky-900">{{ schedule.summary.itoSas || 0 }}</dd>
                    <dd class="text-[11px] text-muted">From Recommendations</dd>
                </div>
                <div class="rounded-lg bg-page px-4 py-3">
                    <dt class="text-caption text-muted">Approved ACADS S.A.s</dt>
                    <dd class="mt-0.5 text-[20px] font-bold text-indigo-900">{{ schedule.summary.acadsSas || 0 }}</dd>
                    <dd class="text-[11px] text-muted">From Recommendations</dd>
                </div>
                <div class="rounded-lg bg-page px-4 py-3">
                    <dt class="text-caption text-muted">Approved OFFICE S.A.s</dt>
                    <dd class="mt-0.5 text-[20px] font-bold text-emerald-900">{{ schedule.summary.officeSas || 0 }}</dd>
                    <dd class="text-[11px] text-muted">From Office Staffing (8AM–5PM)</dd>
                </div>
                <div class="rounded-lg bg-page px-4 py-3">
                    <dt class="text-caption text-muted">Conflict Validation</dt>
                    <dd class="mt-0.5 text-[20px] font-bold"
                        :class="(schedule.clashes?.length || schedule.categoryErrors?.length || schedule.overlapErrors?.length) ? 'text-danger' : 'text-success'">
                        {{ (schedule.clashes?.length || 0) + (schedule.categoryErrors?.length || 0) + (schedule.overlapErrors?.length || 0) === 0 ? '0 Conflicts' : 'Needs Review' }}
                    </dd>
                    <dd class="text-[11px] text-muted">{{ schedule.summary.hours }} total credited hrs/wk</dd>
                </div>
            </dl>

            <!-- Pending Room Approvals Reminder -->
            <div v-if="schedule.summary.roomSlotsPending > 0"
                 class="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-caption text-amber-950 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                    <strong>{{ schedule.summary.roomSlotsPending }} ITO/ACADS room slot(s)</strong> are still pending approval in Recommendations. Only approved room slots are included here.
                </div>
                <a href="#/admin/scheduling/recommendations" class="btn btn-secondary btn-xs shrink-0">
                    Review Recommendations
                </a>
            </div>

            <!-- Validation Errors if any -->
            <div v-if="schedule.clashes && schedule.clashes.length"
                 class="mt-4 rounded-lg border border-danger/30 bg-danger/5 p-3.5 text-caption text-danger">
                <div class="font-bold">Class Schedule Conflicts Detected ({{ schedule.clashes.length }})</div>
                <ul class="mt-1 list-disc pl-5">
                    <li v-for="c in schedule.clashes" :key="c.assignmentId">
                        {{ c.name }} ({{ c.day }}): Duty {{ c.duty }} at {{ c.location }} overlaps class {{ c.subject }} ({{ c.class }})
                    </li>
                </ul>
            </div>
        </section>

        <!-- Search & Single Category Dropdown -->
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
                <select v-model="deptFilter" class="input sm:w-44" aria-label="Filter by S.A. category">
                    <option value="ALL">All categories</option>
                    <option value="ACADS">ACADS</option>
                    <option value="ITO">ITO</option>
                    <option value="OFFICE">Office</option>
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

        <!-- TABLE VIEW (All Filtered Schedules at Once) -->
        <section v-if="viewMode === 'table'" class="card overflow-hidden">
            <div v-if="!filteredStaff.length" class="p-12 text-center text-muted">
                No approved schedules match the selected category filter.
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
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-line text-caption">
                        <tr v-for="sa in filteredStaff" :key="sa.saId" class="hover:bg-page/40 align-top">
                            <td class="py-3.5 px-4">
                                <div class="font-bold text-navy">{{ sa.name }}</div>
                                <div class="text-muted text-[11px]">{{ sa.studentId }} · {{ sa.course }} (Yr {{ sa.yearLevel }})</div>
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
                                <div class="text-[11px] text-muted">{{ sa.requirementType === 'OFFICE' ? 'Office Staffing' : 'Room/Lab Matching' }}</div>
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
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>

        <!-- WITH PARTNER (LABORATORY / ROOM / OFFICE) VIEW -->
        <section v-else-if="viewMode === 'room'" class="space-y-6">
            <div v-if="!filteredRooms.length" class="card p-12 text-center text-muted">
                No approved room or office schedules match the selected category filter.
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

                        <!-- Partner S.A. Cards with quick switch to Solo Schedule -->
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
                                        {{ p.studentId }} · {{ p.course }} (Yr {{ p.yearLevel }})
                                    </div>
                                </div>
                                <button type="button"
                                        @click="switchToSoloSa(p.name)"
                                        class="btn btn-secondary btn-xs shrink-0"
                                        title="View Solo Schedule">
                                    <app-icon name="User" :size="12" /> Solo
                                </button>
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

                                    <!-- Partner Registrar Classes (Blue) -->
                                    <div v-for="(cls, ci) in (p.classes || []).filter(c => c.day === day.code)" :key="'rc-' + ci"
                                         @click.stop="toggleBlockPopover(p, cls, 'CLASS', day, grp.key)"
                                         :title="p.name + ' · CLASS: ' + cls.subject + ' (' + cls.startLabel + '–' + cls.endLabel + ')'"
                                         class="absolute left-0.5 right-0.5 rounded border border-sky-500 bg-sky-100/95 px-1 py-0.5 text-[9.5px] leading-tight text-sky-950 overflow-hidden cursor-pointer hover:ring-2 hover:ring-sky-500 transition"
                                         :style="blockStyle(cls.start, cls.end)">
                                        <div class="font-bold truncate">CLASS: {{ cls.subject }}</div>
                                        <div class="truncate">{{ cls.startLabel }}–{{ cls.endLabel }}</div>
                                    </div>

                                    <!-- Partner Official Duty Blocks (Amber for Primary in this room, Teal for Reliever) -->
                                    <div v-for="(b, bi) in (p.blocks || []).filter(d => d.day === day.code)" :key="'rd-' + bi"
                                         @click.stop="toggleBlockPopover(p, b, 'DUTY', day, grp.key)"
                                         :title="p.name + ' · DUTY: ' + b.location + ' (' + b.credited + 'h) · ' + b.startLabel + '–' + b.endLabel"
                                         class="absolute left-0.5 right-0.5 rounded border px-1 py-0.5 text-[9.5px] leading-tight overflow-hidden cursor-pointer transition"
                                         :class="b.location && b.location.includes('Reliever')
                                             ? 'border-teal-600 bg-teal-100/95 text-teal-950 hover:ring-2 hover:ring-teal-600'
                                             : 'border-amber-500 bg-amber-100/95 text-amber-950 hover:ring-2 hover:ring-amber-500'"
                                         :style="blockStyle(b.start, b.end)">
                                        <div class="font-bold truncate">{{ p.firstName }}: {{ b.location }} ({{ b.credited }}h)</div>
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

                            <!-- Floating Popover Card ("Lulutang") when a Partner's Block is Clicked -->
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
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>

        <!-- SOLO WEEKLY GRID VIEW: ALL INDIVIDUAL S.A. SCHEDULES AT ONCE (7:00 AM - 10:00 PM) -->
        <section v-else class="space-y-6">
            <div v-if="!filteredStaff.length" class="card p-12 text-center text-muted">
                No approved schedules match the selected category filter.
            </div>

            <div v-for="(sa, saIdx) in filteredStaff" :key="sa.saId"
                 class="card p-5 overflow-x-auto"
                 :style="saIdx >= 2 ? { contentVisibility: 'auto', containIntrinsicSize: 'auto none auto 720px' } : {}">
                <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-4 border-b border-line mb-4">
                    <div>
                        <div class="flex flex-wrap items-center gap-2">
                            <h3 class="text-[17px] font-bold text-navy">
                                {{ sa.name }}
                            </h3>
                            <span class="rounded px-2 py-0.5 text-[11px] font-bold uppercase"
                                  :class="sa.department === 'ITO'
                                      ? 'bg-sky-100 text-sky-900'
                                      : (sa.department === 'ACADS' ? 'bg-indigo-100 text-indigo-900' : 'bg-emerald-100 text-emerald-900')">
                                {{ sa.category }}
                            </span>
                            <span class="text-caption text-muted">({{ sa.studentId }} · {{ sa.course }} · Yr {{ sa.yearLevel }})</span>
                        </div>
                        <p class="text-caption text-muted mt-0.5">
                            Assigned to <strong class="text-ink">{{ sa.location }}</strong> ·
                            <strong class="text-navy">{{ sa.creditedHours }} credited hrs/wk</strong> ({{ sa.rawHours }} raw hrs) ·
                            <span>{{ sa.lunchRule }}</span>
                        </p>
                    </div>
                    <div class="shrink-0" v-if="getPrimaryRoom(sa)">
                        <button type="button"
                                @click="switchToPartnerRoom(getPrimaryRoom(sa))"
                                class="btn btn-secondary btn-xs">
                            <app-icon name="Users" :size="13" />
                            View With Partner ({{ getPrimaryRoom(sa) }})
                        </button>
                    </div>
                </div>

                <div class="min-w-[860px]">
                    <div class="grid grid-cols-7 border-b border-line bg-page text-caption font-bold text-navy">
                        <div class="p-2.5 border-r border-line text-center">Time (7 AM – 10 PM)</div>
                        <div v-for="day in DAYS" :key="day.code" class="p-2.5 border-r border-line text-center">
                            {{ day.label }}
                        </div>
                    </div>

                    <div class="grid grid-cols-7 relative" :style="{ height: (HOUR_ROWS.length * PX_PER_HOUR) + 'px' }" @click="closeBlockPopover">
                        <div class="border-r border-line bg-page/40">
                            <div v-for="row in HOUR_ROWS" :key="row.start"
                                 class="border-b border-line/70 px-1 text-[10.5px] font-semibold text-muted flex items-center justify-center text-center"
                                 :style="{ height: PX_PER_HOUR + 'px' }">
                                {{ row.label }}
                            </div>
                        </div>

                        <div v-for="day in DAYS" :key="day.code" class="relative border-r border-line bg-white">
                            <div v-for="row in HOUR_ROWS" :key="row.start"
                                 class="border-b border-line/50"
                                 :style="{ height: PX_PER_HOUR + 'px' }"></div>

                            <!-- Registrar Classes (Blue) -->
                            <div v-for="(cls, ci) in (sa.classes || []).filter(c => c.day === day.code)" :key="'c-' + ci"
                                 @click.stop="toggleBlockPopover(sa, cls, 'CLASS', day, 'solo')"
                                 :title="'CLASS: ' + cls.subject + ' (' + cls.startLabel + '–' + cls.endLabel + ')'"
                                 class="absolute left-1 right-1 rounded border border-sky-500 bg-sky-100/95 px-1.5 py-0.5 text-[10px] leading-tight text-sky-950 overflow-hidden cursor-pointer hover:ring-2 hover:ring-sky-500 transition"
                                 :style="blockStyle(cls.start, cls.end)">
                                <div class="font-bold truncate">CLASS: {{ cls.subject }}</div>
                                <div class="truncate">{{ cls.startLabel }}–{{ cls.endLabel }}</div>
                            </div>

                            <!-- Official Duty Blocks (Amber for Primary, Teal for ITO Reliever) -->
                            <div v-for="(b, bi) in (sa.blocks || []).filter(d => d.day === day.code)" :key="'d-' + bi"
                                 @click.stop="toggleBlockPopover(sa, b, 'DUTY', day, 'solo')"
                                 :title="'DUTY: ' + b.location + ' (' + b.credited + 'h) · ' + b.startLabel + '–' + b.endLabel"
                                 class="absolute left-1 right-1 rounded border px-1.5 py-0.5 text-[10px] leading-tight overflow-hidden cursor-pointer transition"
                                 :class="b.location && b.location.includes('Reliever')
                                     ? 'border-teal-600 bg-teal-100/95 text-teal-950 hover:ring-2 hover:ring-teal-600'
                                     : 'border-amber-500 bg-amber-100/95 text-amber-950 hover:ring-2 hover:ring-amber-500'"
                                 :style="blockStyle(b.start, b.end)">
                                <div class="font-bold truncate">DUTY: {{ b.location }} ({{ b.credited }}h)</div>
                                <div class="truncate">{{ b.startLabel }}–{{ b.endLabel }}</div>
                                <div v-if="b.hasBreak" class="text-[9px] font-semibold truncate" :class="b.location && b.location.includes('Reliever') ? 'text-teal-800' : 'text-amber-800'">-1h lunch break</div>
                            </div>

                            <!-- Floating Popover Card ("Lulutang") when a Block is Clicked -->
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
                                    <button type="button"
                                            @click.stop="closeBlockPopover"
                                            class="rounded p-0.5 text-muted hover:bg-page hover:text-ink"
                                            title="Close">
                                        <app-icon name="X" :size="14" />
                                    </button>
                                </div>
                                <div class="mt-2 text-[13px] font-bold text-navy break-words">
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
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    </template>
    `
};
