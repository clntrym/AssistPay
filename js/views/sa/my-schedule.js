// S.A. > My Schedule.
// Displays the student's enrolled class schedule, official duty assignments,
// and lets the S.A. plot preferred duty hours that feed as recommendations to the S.A. Coordinator.
const SaSchedulePage = {
    components: { AppIcon, PageHeader, AppModal },

    setup() {
        const loading = Vue.ref(true);
        const loadError = Vue.ref("");
        const semester = Vue.ref(null);
        const publication = Vue.ref(null);
        const profile = Vue.ref(null);
        const classes = Vue.ref([]);
        const duty = Vue.ref([]);
        const blocks = Vue.ref([]);
        const roomGroup = Vue.ref(null);
        const preferences = Vue.ref([]);
        const classHours = Vue.ref(0);
        const dutyHours = Vue.ref(0);
        const creditedHours = Vue.ref(0);
        const preferenceHours = Vue.ref(0);

        const activeView = Vue.ref("GRID"); // "GRID", "PARTNER", "CLASSES", "DUTY", "PLOTTED"
        const activeBlock = Vue.ref(null);

        const closeBlockPopover = () => {
            activeBlock.value = null;
        };

        const toggleBlockPopover = (item, type, dayCode, ownerName = "") => {
            const key = `${type}-${ownerName}-${dayCode}-${item.start}-${item.end}`;
            if (activeBlock.value && activeBlock.value.key === key) {
                activeBlock.value = null;
                return;
            }
            const startM = item.start !== undefined ? Number(item.start) : 420;
            const endM = item.end !== undefined ? Number(item.end) : startM + 60;
            const clampedStart = Math.max(420, Math.min(1320, startM));
            const clampedEnd = Math.max(clampedStart + 30, Math.min(1320, endM));
            const topPx = ((clampedStart - 420) / 30) * 36;
            const heightPx = Math.max(30, ((clampedEnd - clampedStart) / 30) * 36 - 2);
            const showAbove = clampedStart >= 1080;
            const isReliever = type === "DUTY" && item.location && String(item.location).includes("Reliever");

            activeBlock.value = {
                key,
                dayCode,
                dayLabel: dayNames[dayCode] || dayCode,
                ownerName: ownerName || (profile.value ? profile.value.name : ""),
                type: isReliever ? "RELIEVER" : type,
                badgeLabel: isReliever
                    ? "ITO Reliever Duty"
                    : (type === "CLASS" ? "Official Registrar Class" : (type === "PREF" ? "Plotted Preference" : "Official Duty Schedule")),
                title: type === "CLASS"
                    ? `CLASS: ${item.subject}${item.section ? " (" + item.section + ")" : ""}`
                    : (type === "PREF" ? "Plotted Preferred Duty Window" : `DUTY: ${item.location || item.department} (${item.credited}h)`),
                timeLabel: `${item.startLabel} – ${item.endLabel}`,
                hoursLabel: type === "CLASS"
                    ? `${item.hours} class hr(s)`
                    : (type === "PREF" ? `${item.hours} plotted hr(s)` : `${item.credited} credited hr(s) (${item.hours} raw hr(s))`),
                lunchNote: type === "DUTY" && item.hasBreak ? "-1h lunch break deducted" : "",
                popoverStyle: showAbove
                    ? { top: `${Math.max(4, topPx - 118)}px` }
                    : { top: `${topPx + heightPx + 4}px` },
                alignRight: dayCode === "FRI" || dayCode === "SAT",
            };
        };

        const DAYS_LIST = [
            { code: "MON", label: "MON", name: "Monday" },
            { code: "TUE", label: "TUE", name: "Tuesday" },
            { code: "WED", label: "WED", name: "Wednesday" },
            { code: "THU", label: "THU", name: "Thursday" },
            { code: "FRI", label: "FRI", name: "Friday" },
            { code: "SAT", label: "SAT", name: "Saturday" }
        ];

        const dayNames = { MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday" };

        const formatTime12 = (m) => {
            const hrs = Math.floor(m / 60);
            const mins = m % 60;
            const h12 = hrs % 12 === 0 ? 12 : hrs % 12;
            const ampm = hrs >= 12 ? "PM" : "AM";
            return `${h12}:${String(mins).padStart(2, "0")}${ampm}`;
        };

        const TIME_SLOTS = [];
        for (let m = 420; m < 1320; m += 30) { // 7:00 AM to 10:00 PM (exactly 30 30-min intervals)
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
            if (m24) return parseInt(m24[1], 10) * 60 + parseInt(m24[2], 10);
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

        const getDayClasses = (dayCode) => {
            return classes.value.filter(c => normalizeDay(c.day) === dayCode);
        };

        const getDayDuty = (dayCode) => {
            return duty.value.filter(u => normalizeDay(u.day) === dayCode);
        };

        const getDayPreferences = (dayCode) => {
            return preferences.value.filter(p => normalizeDay(p.day) === dayCode);
        };

        const getDayClassHours = (dayCode) => {
            const dayClasses = getDayClasses(dayCode);
            const sum = dayClasses.reduce((acc, c) => acc + (c.hours || 0), 0);
            return Math.round(sum * 10) / 10;
        };

        const load = async () => {
            loading.value = true;
            loadError.value = "";
            const r = await Model.request("sa", "my_schedule");
            loading.value = false;
            if (!r.success) {
                loadError.value = r.message || "Failed to load schedule.";
                return;
            }
            semester.value = r.semester;
            publication.value = r.publication || null;
            profile.value = r.profile;
            classes.value = r.classes || [];
            duty.value = r.duty || [];
            blocks.value = r.blocks || [];
            roomGroup.value = r.roomGroup || null;
            preferences.value = r.preferences || [];
            classHours.value = r.classHours || 0;
            dutyHours.value = r.dutyHours || 0;
            creditedHours.value = r.creditedHours || 0;
            preferenceHours.value = r.preferenceHours || 0;
        };

        Vue.onMounted(load);

        // Helper: convert HH:MM:SS or HH:MM to minutes
        const toMins = t => {
            if (!t) return 0;
            const parts = t.split(":");
            return parseInt(parts[0], 10) * 60 + parseInt(parts[1] || 0, 10);
        };

        // Format minutes into 12-hour AM/PM label
        const fmtMins = m => {
            const h24 = Math.floor(m / 60);
            const min = m % 60;
            const h12 = h24 % 12 || 12;
            const ampm = h24 < 12 || h24 === 24 ? "AM" : "PM";
            return `${h12}:${min.toString().padStart(2, "0")} ${ampm}`;
        };

        // -------------------------------------------------------------
        // PLOTTING SCHEDULE MODAL LOGIC (DUTY & CLASS SCHEDULE + TIMETABLE PREVIEW)
        // -------------------------------------------------------------
        const showPlotModal = Vue.ref(false);
        const savingPlot = Vue.ref(false);
        const plotError = Vue.ref("");
        const plotModalTab = Vue.ref("DUTY"); // "DUTY", "CLASSES", "PREVIEW"
        const plotBlocks = Vue.ref([]);
        const plotClassBlocks = Vue.ref([]);
        const reasonCategory = Vue.ref("");
        const reasonDetails = Vue.ref("");

        const REASON_OPTIONS = [
            { value: "Change class sched", label: "Change class sched (Class / subject schedule changed)" },
            { value: "Dissolve section", label: "Dissolve section (Section dissolved or moved)" },
            { value: "Conflict with major subjects / laboratory", label: "Conflict with major subjects / laboratory" },
            { value: "Academic load adjustment (Add/Drop of subjects)", label: "Academic load adjustment (Add/Drop of subjects)" },
            { value: "Change of duty availability", label: "Change of duty availability (Change in available hours)" },
            { value: "Others", label: "Others (Other reason...)" }
        ];

        const minsToTime = m => {
            const h = Math.floor(m / 60).toString().padStart(2, "0");
            const min = (m % 60).toString().padStart(2, "0");
            return `${h}:${min}`;
        };

        const isPublished = Vue.computed(() =>
            Boolean(publication.value && publication.value.status === "PUBLISHED")
        );

        const openPlotModal = () => {
            plotError.value = "";
            plotModalTab.value = "DUTY";

            // 1. Seed duty blocks: from preferences if existing, else from duty if published, else default block
            if (preferences.value.length > 0) {
                plotBlocks.value = preferences.value.map(p => ({
                    day: p.day,
                    startTime: (p.startLabel ? minsToTime(p.start) : "08:00"),
                    endTime: (p.endLabel ? minsToTime(p.end) : "12:00")
                }));
                reasonCategory.value = preferences.value[0].reasonCategory || "";
                reasonDetails.value = preferences.value[0].reasonDetails || "";
            } else if (duty.value.length > 0) {
                plotBlocks.value = duty.value.map(d => ({
                    day: d.day,
                    startTime: minsToTime(d.start),
                    endTime: minsToTime(d.end)
                }));
                reasonCategory.value = "";
                reasonDetails.value = "";
            } else {
                plotBlocks.value = [
                    { day: "MON", startTime: "08:00", endTime: "12:00" }
                ];
                reasonCategory.value = "";
                reasonDetails.value = "";
            }

            // 2. Seed class blocks: from proposedClasses in preferences if existing, else from classes
            const activeProposed = preferences.value.find(p => p.proposedClasses && p.proposedClasses.length)?.proposedClasses;
            if (activeProposed && activeProposed.length > 0) {
                plotClassBlocks.value = activeProposed.map(c => ({
                    subject: c.subject || "",
                    section: c.section || "",
                    day: c.day || "MON",
                    startTime: (c.startTime || minsToTime(c.start || 450)),
                    endTime: (c.endTime || minsToTime(c.end || 630))
                }));
            } else if (classes.value.length > 0) {
                plotClassBlocks.value = classes.value.map(c => ({
                    subject: c.subject || "",
                    section: c.section || "",
                    day: c.day || "MON",
                    startTime: minsToTime(c.start),
                    endTime: minsToTime(c.end)
                }));
            } else {
                plotClassBlocks.value = [];
            }

            showPlotModal.value = true;
        };

        const canAddBlock = Vue.computed(() => plotBlocks.value.length < 14);

        const addPlotBlock = () => {
            if (plotBlocks.value.length >= 14) {
                Alerts.warning("Maximum Limit Reached", "Naabot na ang maximum na 14 duty blocks.");
                return;
            }
            const lastDay = plotBlocks.value.length > 0 ? plotBlocks.value[plotBlocks.value.length - 1].day : "MON";
            plotBlocks.value.push({ day: lastDay, startTime: "08:00", endTime: "12:00" });
        };

        const removePlotBlock = index => {
            plotBlocks.value.splice(index, 1);
        };

        const canAddClassBlock = Vue.computed(() => plotClassBlocks.value.length < 20);

        const addPlotClassBlock = () => {
            if (plotClassBlocks.value.length >= 20) {
                Alerts.warning("Maximum Limit Reached", "Naabot na ang maximum na 20 class subjects.");
                return;
            }
            const lastDay = plotClassBlocks.value.length > 0 ? plotClassBlocks.value[plotClassBlocks.value.length - 1].day : "MON";
            plotClassBlocks.value.push({
                subject: "",
                section: "",
                day: lastDay,
                startTime: "07:30",
                endTime: "10:30"
            });
        };

        const removePlotClassBlock = index => {
            plotClassBlocks.value.splice(index, 1);
        };

        // Check if a class block has issues or overlaps with another class block
        const getClassBlockConflict = cb => {
            if (!cb.day) return "Please select a day for the class.";
            if (!cb.subject || !cb.subject.trim()) return "Subject name is required.";
            if (!cb.startTime || !cb.endTime) return null;
            const sM = toMins(cb.startTime);
            const eM = toMins(cb.endTime);
            if (eM <= sM) return "End time must be after start time";
            if (eM - sM < 30) return "Minimum class duration is 30 minutes";

            const normDay = normalizeDay(cb.day);
            if (normDay === "SUN") return "Sunday classes are not supported.";

            for (let i = 0; i < plotClassBlocks.value.length; i++) {
                const other = plotClassBlocks.value[i];
                if (other === cb) continue;
                if (normalizeDay(other.day) !== normDay) continue;
                if (!other.startTime || !other.endTime) continue;
                const osM = toMins(other.startTime);
                const oeM = toMins(other.endTime);
                if (oeM <= osM) continue;

                if (sM < oeM && osM < eM) {
                    return `Overlaps with Class #${i + 1} (${other.subject || 'Class'} ${fmtMins(osM)}–${fmtMins(oeM)}).`;
                }
            }
            return null;
        };

        // Check if a duty block conflicts with another duty block (same day overlap) or class schedule
        const getBlockConflict = b => {
            if (!b.day) return "Please select a day for duty.";
            if (!b.startTime || !b.endTime) return null;
            const sM = toMins(b.startTime);
            const eM = toMins(b.endTime);
            if (eM <= sM) return "End time must be after start time";
            if (eM - sM < 30) return "Minimum duty period is 30 minutes";

            const normDay = normalizeDay(b.day);
            if (normDay === "SUN") {
                return "Sunday schedule is restricted. Duty plotting is only allowed Monday to Saturday.";
            }

            // Overlapping duty hours on the same day are prohibited
            for (let i = 0; i < plotBlocks.value.length; i++) {
                const other = plotBlocks.value[i];
                if (other === b) continue;
                if (normalizeDay(other.day) !== normDay) continue;
                if (!other.startTime || !other.endTime) continue;
                const osM = toMins(other.startTime);
                const oeM = toMins(other.endTime);
                if (oeM <= osM) continue;

                // Overlap: sM < oeM && osM < eM
                if (sM < oeM && osM < eM) {
                    const dayLabel = dayNames[normDay] || normDay;
                    return `Time conflict on ${dayLabel}: Overlaps with Duty Block #${i + 1} (${fmtMins(osM)} – ${fmtMins(oeM)}). Overlapping duty hours on the same day are not allowed.`;
                }
            }

            // Conflict check against class schedule (from plotClassBlocks if present, else classes)
            const targetClasses = (plotClassBlocks.value && plotClassBlocks.value.length > 0)
                ? plotClassBlocks.value
                : classes.value;

            for (const c of targetClasses) {
                if (normalizeDay(c.day) !== normDay) continue;
                const csM = c.start ?? toMins(c.startTime);
                const ceM = c.end ?? toMins(c.endTime);
                if (ceM <= csM) continue;
                if (sM < ceM && eM > csM) {
                    return `Conflicts with Class ${c.subject || 'Subject'} (${c.startLabel || fmtMins(csM)} – ${c.endLabel || fmtMins(ceM)})`;
                }
            }
            return null;
        };

        const hasAnyConflict = Vue.computed(() => {
            const hasDutyConflict = plotBlocks.value.some(b => !!getBlockConflict(b));
            const hasClassConflict = plotClassBlocks.value.some(cb => !!getClassBlockConflict(cb));
            return hasDutyConflict || hasClassConflict;
        });

        const isOfficeSa = Vue.computed(() => {
            const p = profile.value;
            if (!p) return false;
            return p.category === 'OFFICE' || p.departmentType === 'OFFICE' || (!!p.officeName && p.officeName !== 'Not assigned');
        });

        const calcBlockDuration = b => {
            if (!b.startTime || !b.endTime) return { raw: 0, credited: 0, hasBreak: false, coversLunch: false, isHalfDaySat: false };
            const sM = toMins(b.startTime);
            const eM = toMins(b.endTime);
            if (eM <= sM) return { raw: 0, credited: 0, hasBreak: false, coversLunch: false, isHalfDaySat: false };

            const raw = Math.round(((eM - sM) / 60) * 10) / 10;
            const day = normalizeDay(b.day);
            const isOffice = isOfficeSa.value;

            const isHalfDaySat = (isOffice && day === "SAT");
            const hitsLunch = (sM < 780 && eM > 720); // covers/overlaps 12:00 PM - 1:00 PM
            const spansLunch = (sM <= 720 && eM >= 780); // spans full 12:00 PM - 1:00 PM

            // Rules 8, 9, 10:
            // - OFFICE: Mon-Fri automatic 1-hour lunch deduction if spanning/overlapping 12:00-1:00 PM (at most once per day); Saturday is half-day (NO lunch deduction).
            // - ACADS & ITO: Sum daily blocks first (including split/cut-cut schedules); if daily total >= 5.0 hrs on Mon-Sat, deduct 1 hour ONCE on the longest block of that day.
            const isEligibleDay = ["MON", "TUE", "WED", "THU", "FRI", "SAT"].includes(day);
            const sameDayBlocks = (plotBlocks.value || []).filter(item => {
                if (normalizeDay(item.day) !== day || !item.startTime || !item.endTime) return false;
                return toMins(item.endTime) > toMins(item.startTime);
            });

            let hasBreak = false;
            if (isEligibleDay) {
                if (isOffice) {
                    if (day !== "SAT") {
                        const firstLunchBlock = sameDayBlocks.find(item => {
                            const is1 = toMins(item.startTime);
                            const ie1 = toMins(item.endTime);
                            const iraw = Math.round(((ie1 - is1) / 60) * 10) / 10;
                            return (is1 <= 720 && ie1 >= 780) || (iraw >= 5.0 && is1 < 780 && ie1 > 720);
                        });
                        hasBreak = (firstLunchBlock === b);
                    }
                } else {
                    const dayRawTotal = Math.round(sameDayBlocks.reduce((acc, item) => {
                        return acc + ((toMins(item.endTime) - toMins(item.startTime)) / 60);
                    }, 0) * 10) / 10;
                    if (dayRawTotal >= 5.0) {
                        let longestBlock = null;
                        let maxRaw = -1;
                        for (const item of sameDayBlocks) {
                            const iraw = Math.round(((toMins(item.endTime) - toMins(item.startTime)) / 60) * 10) / 10;
                            if (iraw >= 1.0 && iraw > maxRaw) {
                                maxRaw = iraw;
                                longestBlock = item;
                            }
                        }
                        hasBreak = (longestBlock === b);
                    }
                }
            }

            const credited = hasBreak ? Math.max(0, Math.round((raw - 1.0) * 10) / 10) : raw;

            return { raw, credited, hasBreak, coversLunch: hitsLunch, isHalfDaySat };
        };

        const totalPlottedHours = Vue.computed(() => {
            let total = 0;
            for (const b of plotBlocks.value) {
                total += calcBlockDuration(b).credited;
            }
            return Math.round(total * 10) / 10;
        });

        const totalPlottedClassHours = Vue.computed(() => {
            let total = 0;
            for (const c of plotClassBlocks.value) {
                if (!c.startTime || !c.endTime) continue;
                const sM = toMins(c.startTime);
                const eM = toMins(c.endTime);
                if (eM > sM) {
                    total += (eM - sM) / 60;
                }
            }
            return Math.round(total * 10) / 10;
        });

        const totalLunchDeductions = Vue.computed(() => {
            let count = 0;
            for (const b of plotBlocks.value) {
                if (calcBlockDuration(b).hasBreak) count += 1;
            }
            return count;
        });

        const officeLunchBlocksCount = Vue.computed(() => {
            if (!isOfficeSa.value) return 0;
            return plotBlocks.value.filter(b => calcBlockDuration(b).coversLunch).length;
        });

        // Helpers for Timetable Preview (matching Picture 1: Blue Classes & Yellow Duty)
        const getPreviewDayClasses = dayCode => {
            return plotClassBlocks.value.filter(c => normalizeDay(c.day) === dayCode && c.startTime && c.endTime && toMins(c.endTime) > toMins(c.startTime));
        };

        const getPreviewDayDuty = dayCode => {
            return plotBlocks.value.filter(b => normalizeDay(b.day) === dayCode && b.startTime && b.endTime && toMins(b.endTime) > toMins(b.startTime));
        };

        const getPreviewBlockStyle = (startTimeStr, endTimeStr) => {
            const startM = toMins(startTimeStr);
            const endM = toMins(endTimeStr);
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

        const savePlot = async () => {
            plotError.value = "";

            if (!reasonCategory.value) {
                plotError.value = "Please select a reason for plotting or changing your schedule.";
                Alerts.warning("Reason Required", plotError.value);
                return;
            }

            if (reasonCategory.value === "Others" && !reasonDetails.value.trim()) {
                plotError.value = "Please specify details for your schedule change reason in the remarks field.";
                Alerts.warning("Remarks Required", plotError.value);
                return;
            }

            if (hasAnyConflict.value) {
                plotError.value = "Please resolve all schedule conflicts and overlapping hours before submitting.";
                Alerts.warning("Schedule Conflict", plotError.value);
                return;
            }

            if (plotBlocks.value.length === 0 && plotClassBlocks.value.length === 0) {
                Alerts.warning("Empty Schedule", "Please add at least one duty block or class schedule.");
                return;
            }

            const saveOk = await Alerts.confirm({
                title: "Submit Schedule for Coordinator Validation?",
                html: `Your proposed schedule will be submitted to the S.A. Coordinator for review and validation.<br><br><span class="inline-block bg-amber-100 text-amber-900 px-2.5 py-1 rounded text-xs font-bold border border-amber-300">Reason: ${reasonCategory.value}</span>`,
                icon: "question",
                confirmText: "Yes, Submit Schedule",
                requireReason: false
            });
            if (!saveOk) return;

            savingPlot.value = true;
            const r = await Model.request("sa", "save_duty_plot", {
                blocks: plotBlocks.value,
                classBlocks: plotClassBlocks.value,
                reasonCategory: reasonCategory.value,
                reasonDetails: reasonDetails.value
            });
            savingPlot.value = false;

            if (!r.success) {
                plotError.value = r.message || "Failed to save plotted schedule.";
                Alerts.error("Save Failed", plotError.value);
                return;
            }

            showPlotModal.value = false;
            await Alerts.success("Schedule Submitted", r.message || "Schedule submitted to S.A. Coordinator for validation!");
            Store.loadNotifications();
            load();
        };

        const clearPlot = async () => {
            const ok = await Alerts.confirm({
                title: "Clear all plotted duty?",
                html: "This will remove your plotted schedule preferences from the S.A. Coordinator recommendations.",
                icon: "warning",
                danger: true,
                confirmText: "Clear Plot"
            });
            if (!ok) return;

            savingPlot.value = true;
            const r = await Model.request("sa", "save_duty_plot", { blocks: [] });
            savingPlot.value = false;

            if (!r.success) {
                Alerts.error("Couldn't clear preferences", r.message);
                return;
            }
            await Alerts.success("Plot Cleared", "Plotted schedule cleared successfully.");
            Store.loadNotifications();
            load();
        };

        return {
            loading,
            loadError,
            load,
            semester,
            publication,
            profile,
            classes,
            duty,
            blocks,
            roomGroup,
            preferences,
            classHours,
            dutyHours,
            creditedHours,
            preferenceHours,
            activeView,
            activeBlock,
            toggleBlockPopover,
            closeBlockPopover,
            DAYS_LIST,
            dayNames,
            TIME_SLOTS,
            getPeriodStyle,
            getPeriodColor,
            parseSubjectParts,
            getDayClasses,
            getDayDuty,
            getDayPreferences,
            getDayClassHours,
            fmtMins,
            toMins,
            showPlotModal,
            savingPlot,
            plotError,
            plotModalTab,
            plotBlocks,
            plotClassBlocks,
            reasonCategory,
            reasonDetails,
            REASON_OPTIONS,
            openPlotModal,
            addPlotBlock,
            removePlotBlock,
            canAddClassBlock,
            addPlotClassBlock,
            removePlotClassBlock,
            getClassBlockConflict,
            getBlockConflict,
            hasAnyConflict,
            canAddBlock,
            totalPlottedHours,
            totalPlottedClassHours,
            totalLunchDeductions,
            officeLunchBlocksCount,
            isOfficeSa,
            isPublished,
            calcBlockDuration,
            getPreviewDayClasses,
            getPreviewDayDuty,
            getPreviewBlockStyle,
            savePlot,
            clearPlot
        };
    },

    template: `
    <page-header title="My Schedule" section="Student Assistant"
                 :subtitle="semester ? 'Weekly class schedule and official duty assignments for ' + semester.label + '.' : 'View your weekly classes and official duty assignments.'">
        <template #actions>
            <button @click="openPlotModal" class="btn btn-primary shadow-sm flex items-center gap-2">
                <app-icon name="CalendarPlus" :size="16" />
                <span>Plot New Schedule</span>
            </button>
        </template>
    </page-header>

    <div v-if="loading" class="space-y-4" aria-busy="true">
        <div class="h-24 animate-pulse rounded-xl bg-white"></div>
        <div class="h-96 animate-pulse rounded-xl bg-white"></div>
    </div>

    <div v-else-if="loadError" class="card flex flex-col items-center px-6 py-12 text-center">
        <app-icon name="CircleX" :size="32" class="text-danger" />
        <p class="mt-3 text-body font-semibold text-ink">Couldn't load schedule</p>
        <p class="mt-1 text-caption text-muted">{{ loadError }}</p>
        <button @click="load" class="btn btn-secondary btn-sm mt-4">
            <app-icon name="RefreshCw" :size="14" /> Try again
        </button>
    </div>

    <template v-else>
        <!-- Official Published Schedule Banner -->
        <div v-if="publication && publication.status === 'PUBLISHED' && duty.length > 0"
             class="mb-5 rounded-xl border border-emerald-300 bg-emerald-50/80 p-4 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div class="flex items-start gap-3">
                <div class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-emerald-600 text-white shadow-sm">
                    <app-icon name="CalendarCheck" :size="20" />
                </div>
                <div>
                    <div class="flex flex-wrap items-center gap-2">
                        <h3 class="text-body font-bold text-emerald-950">Official Duty Schedule Published</h3>
                        <span class="rounded-full bg-emerald-200 px-2.5 py-0.5 text-[11px] font-bold uppercase text-emerald-900">
                            PUBLISHED
                        </span>
                    </div>
                    <p class="text-caption text-emerald-900 mt-0.5">
                        Assigned Post: <strong class="font-bold">{{ profile ? profile.officeName : 'Assigned' }}</strong> ·
                        Supervisor: <strong class="font-bold">{{ profile ? profile.supervisorName : 'Coordinator' }}</strong> ·
                        Weekly Duty: <strong class="font-bold">{{ creditedHours }} credited hrs/wk</strong> ({{ dutyHours }} raw hrs)
                    </p>
                </div>
            </div>
            <div v-if="roomGroup && roomGroup.partners && roomGroup.partners.length >= 2" class="flex items-center gap-2 shrink-0">
                <button @click="closeBlockPopover(); activeView = 'GRID'"
                        class="btn btn-sm"
                        :class="activeView === 'GRID' ? 'btn-primary' : 'btn-secondary bg-white'">
                    <app-icon name="User" :size="14" /> Solo Schedule
                </button>
                <button @click="closeBlockPopover(); activeView = 'PARTNER'"
                        class="btn btn-sm"
                        :class="activeView === 'PARTNER' ? 'btn-primary' : 'btn-secondary bg-white'">
                    <app-icon name="Users" :size="14" /> With Partner ({{ roomGroup.room }})
                </button>
            </div>
        </div>

        <!-- KPI Summary Cards -->
        <dl class="mb-5 grid grid-cols-2 gap-3" :class="isPublished ? 'sm:grid-cols-3' : 'sm:grid-cols-4'">
            <div class="card px-4 py-3 border-l-4 border-l-blue-500">
                <dt class="text-caption text-muted flex items-center gap-1.5">
                    <app-icon name="BookOpen" :size="13" class="text-blue-600" />
                    <span>Total Class Hours</span>
                </dt>
                <dd class="text-[22px] font-bold text-navy mt-0.5">{{ classHours }} hrs/wk</dd>
                <p class="text-[11px] text-muted">{{ classes.length }} enrolled class period(s)</p>
            </div>

            <div class="card px-4 py-3">
                <dt class="text-caption text-muted flex items-center gap-1.5">
                    <app-icon name="Briefcase" :size="13" class="text-emerald-600" />
                    <span>Official Duty</span>
                </dt>
                <dd class="text-[22px] font-bold mt-0.5" :class="creditedHours > 0 ? 'text-emerald-600' : 'text-slate-400'">
                    {{ creditedHours > 0 ? creditedHours + ' hrs' : 'Pending Publish' }}
                </dd>
                <p class="text-[11px] text-muted">{{ duty.length }} official period(s)</p>
            </div>

            <div v-if="!isPublished" class="card px-4 py-3">
                <dt class="text-caption text-muted flex items-center gap-1.5">
                    <app-icon name="Sparkles" :size="13" class="text-amber-500" />
                    <span>Plotted Preference</span>
                </dt>
                <dd class="text-[22px] font-bold mt-0.5" :class="preferenceHours > 0 ? 'text-amber-600' : 'text-slate-400'">
                    {{ preferenceHours > 0 ? preferenceHours + ' hrs' : 'None' }}
                </dd>
                <p class="text-[11px] text-muted">{{ preferences.length }} block(s) plotted</p>
            </div>

            <div class="card px-4 py-3">
                <dt class="text-caption text-muted flex items-center gap-1.5">
                    <app-icon name="MapPin" :size="13" class="text-indigo-600" />
                    <span>Assigned Post</span>
                </dt>
                <dd class="text-[16px] font-bold text-navy mt-1 truncate" :title="profile ? profile.officeName : ''">
                    {{ profile ? profile.officeName : 'Not assigned' }}
                </dd>
                <p class="text-[11px] text-muted truncate">Supervisor: {{ profile ? profile.supervisorName : 'Not assigned' }}</p>
            </div>
        </dl>

        <!-- Plotted Schedule / Change Request Status Banner -->
        <div v-if="preferences.length" class="mb-5 rounded-xl border p-4 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
             :class="preferences[0].reviewStatus === 'APPROVED' ? 'border-emerald-300 bg-emerald-50/80' : (preferences[0].reviewStatus === 'REJECTED' ? 'border-rose-300 bg-rose-50/80' : 'border-amber-300 bg-amber-50/80')">
            <div class="flex items-start gap-3">
                <div class="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-white shadow-sm"
                     :class="preferences[0].reviewStatus === 'APPROVED' ? 'bg-emerald-600' : (preferences[0].reviewStatus === 'REJECTED' ? 'bg-rose-600' : 'bg-amber-500')">
                    <app-icon :name="preferences[0].reviewStatus === 'APPROVED' ? 'CheckCircle' : (preferences[0].reviewStatus === 'REJECTED' ? 'CircleX' : 'Clock')" :size="20" />
                </div>
                <div>
                    <div class="flex flex-wrap items-center gap-2">
                        <h3 class="text-body font-bold"
                            :class="preferences[0].reviewStatus === 'APPROVED' ? 'text-emerald-950' : (preferences[0].reviewStatus === 'REJECTED' ? 'text-rose-950' : 'text-amber-950')">
                            {{ isPublished ? 'Schedule Change Request' : 'Plotted Duty Schedule Active' }}
                        </h3>
                        <span class="rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide"
                              :class="preferences[0].reviewStatus === 'APPROVED' ? 'bg-emerald-200 text-emerald-900' : (preferences[0].reviewStatus === 'REJECTED' ? 'bg-rose-200 text-rose-900' : 'bg-amber-200 text-amber-900')">
                            {{ preferences[0].reviewStatus === 'APPROVED' ? 'Approved by Coordinator' : (preferences[0].reviewStatus === 'REJECTED' ? 'Not Approved' : 'Pending Coordinator Validation') }}
                        </span>
                        <span v-if="preferences[0].reasonCategory" class="rounded bg-white/90 border border-amber-300/80 px-2 py-0.5 text-[11px] font-semibold text-amber-950">
                            Reason: {{ preferences[0].reasonCategory }}
                        </span>
                    </div>
                    <p v-if="preferences[0].reasonDetails" class="text-caption italic mt-1 text-ink/80">
                        "{{ preferences[0].reasonDetails }}"
                    </p>
                    <p class="text-caption mt-1"
                       :class="preferences[0].reviewStatus === 'APPROVED' ? 'text-emerald-900' : (preferences[0].reviewStatus === 'REJECTED' ? 'text-rose-900' : 'text-amber-900')">
                        Submitted <b class="font-bold">{{ preferenceHours }} hrs/wk</b> of plotted duty across {{ preferences.length }} block(s).
                        <span v-if="preferences[0].proposedClasses && preferences[0].proposedClasses.length">
                            Includes <b>{{ preferences[0].proposedClasses.length }} proposed class subject(s)</b>.
                        </span>
                    </p>
                </div>
            </div>
            <div class="flex items-center gap-2 shrink-0">
                <button @click="openPlotModal" class="btn btn-secondary btn-sm bg-white shadow-xs">
                    <app-icon name="Pencil" :size="14" /> Plot New Schedule
                </button>
                <button v-if="preferences[0].reviewStatus === 'PENDING'" @click="clearPlot" class="btn btn-sm text-slate-700 hover:text-danger hover:bg-rose-50" title="Cancel schedule request">
                    <app-icon name="Trash2" :size="14" /> Cancel Request
                </button>
            </div>
        </div>

        <!-- Optional Plot Invitation (Shown only before schedule is published and no plot submitted) -->
        <div v-else-if="!isPublished" class="mb-5 rounded-xl border border-blue-200 bg-blue-50/60 p-4 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div class="flex items-start gap-3">
                <div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-600 text-white shadow-sm">
                    <app-icon name="CalendarPlus" :size="18" />
                </div>
                <div>
                    <div class="flex items-center gap-2">
                        <h3 class="text-body font-semibold text-blue-950">Plot Preferred Duty Schedule</h3>
                        <span class="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-bold text-blue-800 uppercase tracking-wide">Optional</span>
                    </div>
                    <p class="text-caption text-blue-800/90 mt-0.5">
                        <b>This is optional and NOT mandatory:</b> You may plot your preferred duty hours based on your free time. If you do not plot, no problem — the system will still automatically match you to department/room schedules.
                    </p>
                </div>
            </div>
            <button @click="openPlotModal" class="btn btn-primary btn-sm shrink-0">
                <app-icon name="Plus" :size="14" /> Plot New Schedule
            </button>
        </div>

        <!-- Main Schedule Container -->
        <div class="card overflow-hidden">
            <!-- Toolbar: View Switcher & Legend -->
            <div class="border-b border-line px-5 py-3.5 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div class="flex flex-wrap items-center gap-1.5">
                    <button @click="closeBlockPopover(); activeView = 'GRID'"
                            class="px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5"
                            :class="activeView === 'GRID' ? 'bg-navy text-white shadow-sm' : 'bg-mist text-muted hover:text-ink'">
                        <app-icon name="User" :size="14" />
                        <span>Solo Schedule (7am - 10pm)</span>
                    </button>
                    <button v-if="roomGroup && roomGroup.partners && roomGroup.partners.length >= 2"
                            @click="closeBlockPopover(); activeView = 'PARTNER'"
                            class="px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5"
                            :class="activeView === 'PARTNER' ? 'bg-navy text-white shadow-sm' : 'bg-mist text-muted hover:text-ink'">
                        <app-icon name="Users" :size="14" />
                        <span>With Partner ({{ roomGroup.room }})</span>
                    </button>
                    <button @click="closeBlockPopover(); activeView = 'CLASSES'"
                            class="px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5"
                            :class="activeView === 'CLASSES' ? 'bg-navy text-white shadow-sm' : 'bg-mist text-muted hover:text-ink'">
                        <app-icon name="List" :size="14" />
                        <span>Class Schedule ({{ classes.length }})</span>
                    </button>
                    <button @click="closeBlockPopover(); activeView = 'DUTY'"
                            class="px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5"
                            :class="activeView === 'DUTY' ? 'bg-navy text-white shadow-sm' : 'bg-mist text-muted hover:text-ink'">
                        <app-icon name="Briefcase" :size="14" />
                        <span>Official Duty ({{ duty.length }})</span>
                    </button>
                    <button v-if="!isPublished || preferences.length" @click="closeBlockPopover(); activeView = 'PLOTTED'"
                            class="px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5"
                            :class="activeView === 'PLOTTED' ? 'bg-navy text-white shadow-sm' : 'bg-mist text-muted hover:text-ink'">
                        <app-icon name="Sparkles" :size="14" />
                        <span>{{ isPublished ? 'Change Request' : 'Plotted Duty' }} ({{ preferences.length }})</span>
                    </button>
                </div>

                <!-- Color Legend -->
                <div class="flex flex-wrap items-center gap-3 text-caption">
                    <span class="inline-flex items-center gap-1.5 font-medium text-sky-900">
                        <span class="h-2.5 w-2.5 rounded bg-sky-400"></span> Enrolled Classes
                    </span>
                    <span class="inline-flex items-center gap-1.5 font-medium text-emerald-900">
                        <span class="h-2.5 w-2.5 rounded bg-emerald-500"></span> Official Duty
                    </span>
                    <span v-if="!isPublished" class="inline-flex items-center gap-1.5 font-medium text-amber-900">
                        <span class="h-2.5 w-2.5 rounded bg-amber-400 border border-amber-600 border-dashed"></span> Plotted Preference
                    </span>
                </div>
            </div>

            <!-- VIEW 1: SOLO VISUAL TIMETABLE GRID MATRIX (7:00 AM - 10:00 PM) -->
            <div v-if="activeView === 'GRID'" class="p-4">
                <div v-if="!classes.length && !duty.length && !preferences.length" class="card flex flex-col items-center py-12 text-center border-dashed">
                    <app-icon name="CalendarOff" :size="32" class="text-muted" />
                    <p class="mt-2 font-bold text-ink text-[15px]">No schedule recorded</p>
                    <p class="text-caption text-muted mt-1 max-w-sm">
                        Your class schedule will automatically appear here once officially enrolled by the Registrar.
                    </p>
                    <button v-if="!isPublished" @click="openPlotModal" class="btn btn-primary btn-sm mt-4">
                        <app-icon name="CalendarPlus" :size="14" /> Plot Duty Schedule
                    </button>
                </div>

                <div v-else class="overflow-auto rounded-xl border border-line bg-white shadow-card max-h-[66vh]" @click="closeBlockPopover">
                    <div class="min-w-[940px]">
                        <!-- Dark Navy Header Row -->
                        <div class="sticky top-0 z-30 grid grid-cols-[140px_repeat(6,minmax(0,1fr))] bg-navy text-white text-[12px] font-bold shadow-xs">
                            <div class="sticky left-0 z-40 bg-navy px-2 py-2.5 border-r border-navy-700 text-center uppercase tracking-wider text-[11px]">
                                TIME
                            </div>
                            <div v-for="d in DAYS_LIST" :key="d.code" class="px-2 py-2.5 text-center border-r border-navy-700 uppercase tracking-wider last:border-r-0 text-[11px]">
                                <div>{{ d.label }}</div>
                                <div v-if="getDayClassHours(d.code) > 0" class="text-[9px] font-normal text-sky-200 opacity-90">
                                    {{ getDayClassHours(d.code) }}h class
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

                            <!-- 7 Day Columns -->
                            <div v-for="d in DAYS_LIST" :key="d.code" class="relative border-r border-line last:border-r-0 bg-white">
                                <!-- 30 Slot Background Grid Lines -->
                                <div v-for="t in TIME_SLOTS" :key="t.min"
                                     class="h-9 border-b border-line/40 transition-colors hover:bg-navy/5">
                                </div>

                                <!-- 1. Enrolled Class Period Cards -->
                                <div v-for="(p, idx) in getDayClasses(d.code)" :key="'c-' + p.id"
                                     @click.stop="toggleBlockPopover(p, 'CLASS', d.code)"
                                     :style="getPeriodStyle(p)"
                                     :title="p.subject + ' (' + (p.section || 'No Section') + ') | ' + p.startLabel + ' - ' + p.endLabel + ' (' + p.hours + ' hrs)'"
                                     class="absolute left-1 right-1 rounded-md border px-2 py-1.5 shadow-xs transition-all hover:z-30 hover:shadow-md cursor-pointer flex flex-col justify-between overflow-hidden"
                                     :class="[getPeriodColor(p, idx).bg, getPeriodColor(p, idx).border, getPeriodColor(p, idx).text, getPeriodColor(p, idx).hover]">
                                    <div class="min-w-0 flex-1 leading-snug">
                                        <div class="flex items-center justify-between gap-1">
                                            <span class="font-bold text-[11px] truncate">{{ parseSubjectParts(p.subject).code }}</span>
                                            <span v-if="p.section" class="rounded bg-black/10 px-1 py-0.2 text-[9px] font-bold shrink-0 font-mono">{{ p.section }}</span>
                                        </div>
                                        <div v-if="parseSubjectParts(p.subject).title" class="text-[10px] opacity-90 truncate font-medium">
                                            {{ parseSubjectParts(p.subject).title }}
                                        </div>
                                    </div>
                                    <div class="flex items-center justify-between text-[9px] font-bold opacity-80 mt-0.5 truncate">
                                        <span>{{ p.startLabel }} – {{ p.endLabel }}</span>
                                        <span class="rounded bg-black/10 px-1 py-0.2 font-mono">{{ p.hours }}h</span>
                                    </div>
                                </div>

                                <!-- 2. Official Assigned Duty Cards -->
                                <div v-for="(u, idx) in getDayDuty(d.code)" :key="'u-' + u.id"
                                     @click.stop="toggleBlockPopover(u, 'DUTY', d.code)"
                                     :style="getPeriodStyle(u)"
                                     :title="'Official Duty: ' + (u.location || u.department) + ' | ' + u.startLabel + ' - ' + u.endLabel + ' (' + u.credited + ' credited hrs)'"
                                     class="absolute left-1 right-1 rounded-md border-2 border-emerald-500 bg-emerald-100/95 text-emerald-950 px-2 py-1.5 shadow-xs transition-all hover:z-30 hover:shadow-md cursor-pointer flex flex-col justify-between overflow-hidden hover:bg-emerald-200 z-10">
                                    <div class="min-w-0 flex-1 leading-snug">
                                        <div class="flex items-center justify-between gap-1">
                                            <span class="font-bold text-[11px] truncate flex items-center gap-1">
                                                <app-icon name="Briefcase" :size="10" /> {{ u.location || u.department }}
                                            </span>
                                            <span class="rounded bg-emerald-700 text-white px-1 py-0.2 text-[9px] font-bold shrink-0">DUTY</span>
                                        </div>
                                        <div v-if="u.supervisor" class="text-[10px] text-emerald-800 truncate font-medium">
                                            Sup: {{ u.supervisor }}
                                        </div>
                                    </div>
                                    <div class="flex items-center justify-between text-[9px] font-bold text-emerald-900 mt-0.5 truncate">
                                        <span>{{ u.startLabel }} – {{ u.endLabel }}</span>
                                        <span class="rounded bg-emerald-200 px-1 py-0.2 font-mono">{{ u.credited }}h</span>
                                    </div>
                                </div>

                                <!-- 3. Plotted Duty (Preferences) Cards -->
                                <div v-for="(pref, idx) in (!isPublished || preferences.length ? getDayPreferences(d.code) : [])" :key="'pref-' + pref.id"
                                     @click.stop="toggleBlockPopover(pref, 'PREF', d.code)"
                                     :style="getPeriodStyle(pref)"
                                     :title="'Plotted Duty (Recommendation): ' + pref.startLabel + ' - ' + pref.endLabel + ' (' + pref.hours + ' hrs)'"
                                     class="absolute left-1 right-1 rounded-md border-2 border-dashed border-amber-500 bg-amber-50/95 text-amber-950 px-2 py-1.5 shadow-xs transition-all hover:z-30 hover:shadow-md cursor-pointer flex flex-col justify-between overflow-hidden hover:bg-amber-100 z-10">
                                    <div class="min-w-0 flex-1 leading-snug">
                                        <div class="flex items-center justify-between gap-1">
                                            <span class="font-bold text-[11px] truncate flex items-center gap-1 text-amber-900">
                                                <app-icon name="Sparkles" :size="10" class="text-amber-600" /> Plotted Duty
                                            </span>
                                            <span class="rounded bg-amber-200 text-amber-800 px-1 py-0.2 text-[9px] font-bold shrink-0">REC</span>
                                        </div>
                                        <div class="text-[10px] text-amber-800 truncate font-medium">
                                            Preferred Duty Window
                                        </div>
                                    </div>
                                    <div class="flex items-center justify-between text-[9px] font-bold text-amber-900 mt-0.5 truncate">
                                        <span>{{ pref.startLabel }} – {{ pref.endLabel }}</span>
                                        <span class="rounded bg-amber-200 px-1 py-0.2 font-mono">{{ pref.hours }}h</span>
                                    </div>
                                </div>

                                <!-- Floating Popover Card ("Lulutang") -->
                                <div v-if="activeBlock && activeBlock.dayCode === d.code"
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
            </div>

            <!-- VIEW 1B: WITH PARTNER (LABORATORY / ROOM / OFFICE) GRID -->
            <div v-else-if="activeView === 'PARTNER' && roomGroup" class="p-4 space-y-4">
                <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 rounded-xl border border-line bg-page/60 p-4">
                    <div>
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="rounded px-2.5 py-0.5 text-[11px] font-bold uppercase bg-sky-100 text-sky-900">
                                {{ roomGroup.department }}
                            </span>
                            <h3 class="text-[17px] font-bold text-navy">
                                {{ roomGroup.requirementType === 'OFFICE' ? roomGroup.room : 'Room / Lab ' + roomGroup.room }}
                            </h3>
                        </div>
                        <div class="mt-2.5 flex flex-wrap gap-2">
                            <div v-for="(p, pIdx) in roomGroup.partners" :key="p.saId"
                                 class="rounded-lg border px-3 py-1.5"
                                 :class="p.isMe ? 'border-emerald-400 bg-emerald-50/80' : 'border-line bg-white'">
                                <div class="text-[12px] font-bold text-navy">
                                    {{ pIdx + 1 }}. {{ p.name }}
                                    <span v-if="p.isMe" class="ml-1 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] text-white">YOU</span>
                                    <span class="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">{{ p.creditedHours }}h/wk</span>
                                </div>
                                <div class="text-[11px] text-muted">{{ p.studentId }} · {{ p.course }} (Yr {{ p.yearLevel }})</div>
                            </div>
                        </div>
                    </div>

                    <!-- Top Reliever Box for ITO Rooms -->
                    <div v-if="roomGroup.relievers && roomGroup.relievers.length"
                         class="rounded-xl border border-teal-300 bg-teal-50/80 px-3.5 py-2.5 text-left min-w-[230px]">
                        <div class="text-[11px] font-extrabold uppercase tracking-wider text-teal-900 mb-1">RELIEVER:</div>
                        <ul class="space-y-0.5 text-[12px] font-bold text-teal-950">
                            <li v-for="rel in roomGroup.relievers" :key="rel.key">{{ rel.lineText }}</li>
                        </ul>
                    </div>
                </div>

                <div class="overflow-auto rounded-xl border border-line bg-white shadow-card max-h-[66vh]" @click="closeBlockPopover">
                    <div class="min-w-[980px]">
                        <div class="sticky top-0 z-30 grid grid-cols-[140px_repeat(6,minmax(0,1fr))] bg-navy text-white text-[12px] font-bold shadow-xs">
                            <div class="sticky left-0 z-40 bg-navy px-2 py-2.5 border-r border-navy-700 flex items-center justify-center uppercase tracking-wider text-[11px]">
                                TIME
                            </div>
                            <div v-for="d in DAYS_LIST" :key="d.code" class="border-r border-navy-700 last:border-r-0">
                                <div class="px-2 py-1.5 text-center border-b border-navy-700 uppercase tracking-wider text-[11px]">{{ d.label }}</div>
                                <div class="grid divide-x divide-navy-700 bg-navy-800/90 text-[10px] font-semibold text-sky-100"
                                     :style="{ gridTemplateColumns: 'repeat(' + Math.max(1, roomGroup.partners.length) + ', minmax(0, 1fr))' }">
                                    <div v-for="(p, pIdx) in roomGroup.partners" :key="p.saId" class="px-1 py-1 text-center truncate">
                                        {{ pIdx + 1 }}. {{ p.firstName }}
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div class="relative grid grid-cols-[140px_repeat(6,minmax(0,1fr))] select-none" style="height: 1080px;">
                            <div class="sticky left-0 z-20 bg-mist/90 border-r border-line text-[11px] font-bold text-navy">
                                <div v-for="t in TIME_SLOTS" :key="t.min"
                                     class="h-9 px-1 flex items-center justify-center border-b border-line/40 text-[10px] font-bold text-navy whitespace-nowrap">
                                    {{ t.label }}
                                </div>
                            </div>

                            <div v-for="d in DAYS_LIST" :key="d.code" class="relative border-r border-line last:border-r-0 bg-white">
                                <div class="grid h-full divide-x divide-line/60"
                                     :style="{ gridTemplateColumns: 'repeat(' + Math.max(1, roomGroup.partners.length) + ', minmax(0, 1fr))' }">
                                    <div v-for="(p, pIdx) in roomGroup.partners" :key="p.saId" class="relative h-full">
                                        <div v-for="t in TIME_SLOTS" :key="t.min" class="h-9 border-b border-line/40"></div>

                                        <!-- Partner Classes -->
                                        <div v-for="(cls, ci) in (p.classes || []).filter(c => c.day === d.code)" :key="'pc-' + ci"
                                             @click.stop="toggleBlockPopover(cls, 'CLASS', d.code, p.name)"
                                             :style="getPeriodStyle(cls)"
                                             class="absolute left-0.5 right-0.5 rounded border border-sky-500 bg-sky-100/95 px-1 py-0.5 text-[9.5px] leading-tight text-sky-950 overflow-hidden cursor-pointer hover:ring-2 hover:ring-sky-500 transition">
                                            <div class="font-bold truncate">CLASS: {{ cls.subject }}</div>
                                            <div class="truncate">{{ cls.startLabel }}–{{ cls.endLabel }}</div>
                                        </div>

                                        <!-- Partner Duty Blocks -->
                                        <div v-for="(b, bi) in (p.blocks || []).filter(u => u.day === d.code)" :key="'pd-' + bi"
                                             @click.stop="toggleBlockPopover(b, 'DUTY', d.code, p.name)"
                                             :style="getPeriodStyle(b)"
                                             class="absolute left-0.5 right-0.5 rounded border px-1 py-0.5 text-[9.5px] leading-tight overflow-hidden cursor-pointer transition"
                                             :class="b.location && b.location.includes('Reliever')
                                                 ? 'border-teal-600 bg-teal-100/95 text-teal-950 hover:ring-2 hover:ring-teal-600'
                                                 : (p.isMe ? 'border-emerald-600 bg-emerald-100/95 text-emerald-950 hover:ring-2 hover:ring-emerald-600' : 'border-amber-500 bg-amber-100/95 text-amber-950 hover:ring-2 hover:ring-amber-500')">
                                            <div class="font-bold truncate">{{ p.firstName }}: {{ b.location }} ({{ b.credited }}h)</div>
                                            <div class="truncate">{{ b.startLabel }}–{{ b.endLabel }}</div>
                                            <div v-if="b.hasBreak" class="text-[8.5px] font-semibold truncate" :class="b.location && b.location.includes('Reliever') ? 'text-teal-800' : (p.isMe ? 'text-emerald-800' : 'text-amber-800')">-1h lunch</div>
                                        </div>
                                    </div>
                                </div>

                                <!-- Floating Popover Card ("Lulutang") -->
                                <div v-if="activeBlock && activeBlock.dayCode === d.code"
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

            <!-- VIEW 2: CLASS SCHEDULE TABLE -->
            <div v-else-if="activeView === 'CLASSES'" class="overflow-x-auto">
                <table class="w-full text-left text-[13px]">
                    <thead class="bg-page text-caption font-semibold text-muted">
                        <tr>
                            <th class="px-5 py-3">Day</th>
                            <th class="px-4 py-3">Time</th>
                            <th class="px-4 py-3">Subject</th>
                            <th class="px-4 py-3">Section</th>
                            <th class="px-4 py-3 text-right">Duration</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-line">
                        <tr v-for="c in classes" :key="c.id" class="hover:bg-mist/40 transition-colors">
                            <td class="whitespace-nowrap px-5 py-3 font-semibold text-navy">
                                {{ dayNames[c.day] || c.day }}
                            </td>
                            <td class="whitespace-nowrap px-4 py-3 font-medium text-ink">
                                {{ c.startLabel }} – {{ c.endLabel }}
                            </td>
                            <td class="px-4 py-3 font-semibold text-ink">
                                {{ c.subject }}
                            </td>
                            <td class="whitespace-nowrap px-4 py-3 font-mono text-caption text-muted">
                                {{ c.section || '—' }}
                            </td>
                            <td class="whitespace-nowrap px-4 py-3 text-right font-medium text-muted">
                                {{ c.hours }} hrs
                            </td>
                        </tr>
                        <tr v-if="!classes.length">
                            <td colspan="5" class="px-6 py-12 text-center text-muted">
                                <app-icon name="BookOpen" :size="28" class="mx-auto mb-2 text-muted/60" />
                                <p class="font-semibold text-ink">No class schedule on file</p>
                                <p class="text-caption text-muted mt-0.5">Your Certificate of Registration (COR) schedule will appear here once encoded by Registrar or Coordinator.</p>
                            </td>
                        </tr>
                    </tbody>
                    <tfoot v-if="classes.length" class="bg-page/80 font-semibold border-t-2 border-line text-[13px]">
                        <tr>
                            <td colspan="4" class="px-5 py-3 text-navy font-bold">Total Enrolled Class Hours</td>
                            <td class="px-4 py-3 text-right font-bold text-navy">{{ classHours }} hrs/week</td>
                        </tr>
                    </tfoot>
                </table>
            </div>

            <!-- VIEW 3: OFFICIAL DUTY TABLE -->
            <div v-else-if="activeView === 'DUTY'" class="overflow-x-auto">
                <table class="w-full text-left text-[13px]">
                    <thead class="bg-page text-caption font-semibold text-muted">
                        <tr>
                            <th class="px-5 py-3">Day</th>
                            <th class="px-4 py-3">Duty Hours</th>
                            <th class="px-4 py-3">Assigned Location</th>
                            <th class="px-4 py-3">Supervisor</th>
                            <th class="px-4 py-3 text-right">Credited Hours</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-line">
                        <tr v-for="d in duty" :key="d.id" class="hover:bg-mist/40 transition-colors">
                            <td class="whitespace-nowrap px-5 py-3 font-semibold text-emerald-800">
                                {{ dayNames[d.day] || d.day }}
                            </td>
                            <td class="whitespace-nowrap px-4 py-3 font-medium text-ink">
                                {{ d.startLabel }} – {{ d.endLabel }}
                            </td>
                            <td class="px-4 py-3 font-semibold text-ink">
                                {{ d.location || d.department }}
                            </td>
                            <td class="whitespace-nowrap px-4 py-3 text-muted">
                                {{ d.supervisor || 'Coordinator Assigned' }}
                            </td>
                            <td class="whitespace-nowrap px-4 py-3 text-right font-bold text-emerald-700">
                                {{ d.credited }} hrs
                            </td>
                        </tr>
                        <tr v-if="!duty.length">
                            <td colspan="5" class="px-6 py-12 text-center text-muted">
                                <app-icon name="Briefcase" :size="28" class="mx-auto mb-2 text-muted/60" />
                                <p class="font-semibold text-ink">No official duty assignments published yet</p>
                                <p class="text-caption text-muted mt-0.5">The S.A. Coordinator has not finalized your duty schedule yet.</p>
                                <button v-if="!isPublished" @click="openPlotModal" class="btn btn-primary btn-sm mt-4">
                                     <app-icon name="CalendarPlus" :size="14" /> Plot Duty Schedule
                                </button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- VIEW 4: PLOTTED PREFERENCES / CHANGE REQUEST TABLE -->
            <div v-else-if="activeView === 'PLOTTED'" class="overflow-x-auto">
                <div class="p-4 bg-amber-50/50 border-b border-line flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div>
                        <div class="flex items-center gap-2">
                            <h4 class="font-bold text-body text-amber-950">
                                {{ isPublished ? 'Proposed Schedule Change Request' : 'Plotted Duty Preferences' }}
                            </h4>
                            <span v-if="preferences.length && preferences[0].reasonCategory" class="rounded bg-amber-200 text-amber-900 px-2 py-0.5 text-[11px] font-bold">
                                Reason: {{ preferences[0].reasonCategory }}
                            </span>
                        </div>
                        <p class="text-caption text-amber-800 mt-0.5">
                            {{ isPublished ? 'Your proposed schedule change has been submitted to the S.A. Coordinator for validation.' : 'These duty blocks represent your availability and preference submitted to the Coordinator.' }}
                        </p>
                        <p v-if="preferences.length && preferences[0].reasonDetails" class="text-caption text-amber-950 italic mt-1">
                            Remarks: "{{ preferences[0].reasonDetails }}"
                        </p>
                    </div>
                    <button @click="openPlotModal" class="btn btn-secondary btn-sm bg-white border-amber-300 text-amber-950 shrink-0">
                        <app-icon name="Pencil" :size="13" /> Plot New Schedule
                    </button>
                </div>
                <table class="w-full text-left text-[13px]">
                    <thead class="bg-page text-caption font-semibold text-muted">
                        <tr>
                            <th class="px-5 py-3">Day</th>
                            <th class="px-4 py-3">Preferred Time</th>
                            <th class="px-4 py-3">Duration</th>
                            <th class="px-4 py-3">Status</th>
                            <th class="px-4 py-3 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-line">
                        <tr v-for="p in preferences" :key="p.id" class="hover:bg-mist/40 transition-colors">
                            <td class="whitespace-nowrap px-5 py-3 font-semibold text-amber-900">
                                {{ dayNames[p.day] || p.day }}
                            </td>
                            <td class="whitespace-nowrap px-4 py-3 font-medium text-ink">
                                {{ p.startLabel }} – {{ p.endLabel }}
                            </td>
                            <td class="whitespace-nowrap px-4 py-3 font-semibold text-ink">
                                <span>{{ p.hours }} hrs</span>
                                <span v-if="p.hasBreak" class="ml-1.5 text-[11px] text-amber-700 font-normal">(-1h lunch)</span>
                                <span v-else-if="p.isHalfDaySat" class="ml-1.5 text-[11px] text-emerald-700 font-normal">(half day)</span>
                                <span v-else-if="isOfficeSa && p.coversLunch" class="ml-1.5 text-[11px] text-emerald-700 font-normal">(lunch duty, no deduct)</span>
                            </td>
                            <td class="whitespace-nowrap px-4 py-3">
                                <span v-if="p.reviewStatus === 'APPROVED'" class="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-0.5 text-[11px] font-semibold">
                                    <app-icon name="CheckCircle" :size="11" /> Approved by Coordinator
                                </span>
                                <span v-else-if="p.reviewStatus === 'REJECTED'" class="inline-flex items-center gap-1 rounded-full bg-rose-100 text-rose-800 px-2.5 py-0.5 text-[11px] font-semibold" :title="p.reviewNotes || 'Not included by Coordinator'">
                                    <app-icon name="CircleX" :size="11" /> Not Approved (Rejected)
                                </span>
                                <span v-else class="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 px-2.5 py-0.5 text-[11px] font-semibold">
                                    <app-icon name="Clock" :size="11" /> Pending Coordinator Validation
                                </span>
                                <p v-if="p.reviewNotes" class="mt-0.5 text-[10px] text-muted italic">Note: {{ p.reviewNotes }}</p>
                            </td>
                            <td class="whitespace-nowrap px-4 py-3 text-right">
                                <button @click="openPlotModal" class="text-caption text-navy hover:underline">Edit</button>
                            </td>
                        </tr>
                        <tr v-if="!preferences.length">
                            <td colspan="5" class="px-6 py-12 text-center text-muted">
                                <app-icon name="Sparkles" :size="28" class="mx-auto mb-2 text-muted/60" />
                                <p class="font-semibold text-ink">No plotted schedule submitted yet</p>
                                <p class="text-caption text-muted mt-0.5">You can plot your new class and duty schedule and specify your reason for Coordinator validation.</p>
                                <button @click="openPlotModal" class="btn btn-primary btn-sm mt-4">
                                    <app-icon name="CalendarPlus" :size="14" /> Plot New Schedule
                                </button>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </template>

    <!-- PLOTTING SCHEDULE MODAL (DUTY & CLASS SCHEDULE + TIMETABLE PREVIEW) -->
    <app-modal :open="showPlotModal" title="Plot New Schedule & Availability" icon="CalendarPlus" size="xl" @close="showPlotModal = false">
        <div class="space-y-4">
            <!-- Error banner -->
            <div v-if="plotError" class="rounded-lg bg-rose-50 border border-rose-200 p-3 text-caption text-rose-800 flex items-center gap-2" role="alert">
                <app-icon name="CircleX" :size="16" class="text-danger shrink-0" />
                <span>{{ plotError }}</span>
            </div>

            <!-- Reason for Plotting / Schedule Change -->
            <div class="rounded-xl border border-amber-300 bg-amber-50/70 p-3.5 space-y-2">
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <label class="text-caption font-bold text-amber-950 flex items-center gap-1.5">
                        <app-icon name="FileText" :size="15" class="text-amber-700" />
                        <span>Reason for Plotting / Schedule Change <span class="text-danger">*</span></span>
                    </label>
                    <span class="text-[11px] text-amber-800 font-medium">This will be reviewed and validated by the S.A. Coordinator</span>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-12 gap-2">
                    <div class="sm:col-span-5">
                        <select v-model="reasonCategory" class="input input-sm w-full font-semibold border-amber-300 bg-white">
                            <option value="" disabled>-- Select Reason --</option>
                            <option v-for="opt in REASON_OPTIONS" :key="opt.value" :value="opt.value">
                                {{ opt.label }}
                            </option>
                        </select>
                    </div>
                    <div class="sm:col-span-7">
                        <input v-model="reasonDetails" type="text"
                               class="input input-sm w-full bg-white border-amber-300"
                               :placeholder="reasonCategory === 'Others' ? 'Please specify details for schedule change (required for Others)...' : 'Additional remarks / details (optional)...'" />
                    </div>
                </div>
            </div>

            <!-- Modal Tab Navigation -->
            <div class="flex items-center border-b border-line gap-1 bg-page/50 px-2 pt-1 rounded-t-xl">
                <button type="button" @click="plotModalTab = 'DUTY'"
                        class="px-4 py-2 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5"
                        :class="plotModalTab === 'DUTY' ? 'border-amber-500 text-amber-950 bg-white shadow-2xs rounded-t-lg' : 'border-transparent text-muted hover:text-ink'">
                    <app-icon name="Clock" :size="14" class="text-amber-600" />
                    <span>Duty Schedule</span>
                    <span class="rounded-full bg-amber-200 px-2 py-0.2 text-[10px] font-bold text-amber-900">{{ totalPlottedHours }}h</span>
                </button>
                <button type="button" @click="plotModalTab = 'CLASSES'"
                        class="px-4 py-2 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5"
                        :class="plotModalTab === 'CLASSES' ? 'border-sky-500 text-sky-950 bg-white shadow-2xs rounded-t-lg' : 'border-transparent text-muted hover:text-ink'">
                    <app-icon name="BookOpen" :size="14" class="text-sky-600" />
                    <span>Class Schedule</span>
                    <span class="rounded-full bg-sky-200 px-2 py-0.2 text-[10px] font-bold text-sky-900">{{ totalPlottedClassHours }}h</span>
                </button>
                <button type="button" @click="plotModalTab = 'PREVIEW'"
                        class="px-4 py-2 text-xs font-bold border-b-2 transition-all flex items-center gap-1.5"
                        :class="plotModalTab === 'PREVIEW' ? 'border-navy text-navy bg-white shadow-2xs rounded-t-lg' : 'border-transparent text-muted hover:text-ink'">
                    <app-icon name="CalendarDays" :size="14" class="text-navy" />
                    <span>Timetable Preview</span>
                    <span class="rounded bg-navy text-white px-1.5 py-0.2 text-[9px] font-bold">Picture 1</span>
                </button>
            </div>

            <!-- TAB 1: DUTY SCHEDULE BLOCKS (YELLOW) -->
            <div v-if="plotModalTab === 'DUTY'" class="space-y-3">
                <div class="flex items-center justify-between">
                    <div>
                        <span class="text-caption font-bold text-amber-950 uppercase tracking-wide">Plotted Duty Blocks</span>
                        <span class="ml-2 text-[11px] text-muted">({{ plotBlocks.length }} block(s) · {{ totalPlottedHours }} credited hrs)</span>
                    </div>
                    <button type="button" @click="addPlotBlock" :disabled="!canAddBlock"
                            class="btn btn-secondary btn-sm text-[12px] text-amber-950 border-amber-300 hover:bg-amber-50"
                            :title="!canAddBlock ? 'Maximum blocks reached.' : 'Add duty block'">
                        <app-icon name="Plus" :size="13" /> Add Duty Block
                    </button>
                </div>

                <div class="text-caption text-muted bg-amber-50/70 p-2.5 rounded-lg border border-amber-200 flex items-center gap-2">
                    <app-icon name="Sparkles" :size="15" class="text-amber-600 shrink-0" />
                    <span>Plot preferred duty hours on days/times you are free from classes. In the Timetable Preview, duty hours appear as <b>yellow blocks</b>.</span>
                </div>

                <!-- Plotted blocks form -->
                <div class="space-y-2 max-h-[46vh] overflow-y-auto pr-1">
                    <div v-for="(b, idx) in plotBlocks" :key="idx"
                         class="rounded-xl border p-3 bg-white transition-colors"
                         :class="getBlockConflict(b) ? 'border-rose-300 bg-rose-50/20' : 'border-line'">
                        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div class="flex items-center gap-2">
                                <span class="grid h-6 w-6 place-items-center rounded bg-amber-100 text-[11px] font-bold text-amber-900 font-mono">
                                    #{{ idx + 1 }}
                                </span>
                                <!-- Day of Week -->
                                <select v-model="b.day" class="input input-sm w-44 font-semibold"
                                        :class="getBlockConflict(b) && getBlockConflict(b).includes('conflict') ? 'border-danger text-danger bg-rose-50/50' : ''">
                                    <option v-for="d in DAYS_LIST" :key="d.code" :value="d.code">
                                        {{ d.name }}
                                    </option>
                                </select>
                            </div>

                            <!-- Time inputs -->
                            <div class="flex items-center gap-2">
                                <input v-model="b.startTime" type="time" class="input input-sm w-32" />
                                <span class="text-muted text-caption">to</span>
                                <input v-model="b.endTime" type="time" class="input input-sm w-32" />
                            </div>

                            <!-- Duration & Actions -->
                            <div class="flex items-center justify-between sm:justify-end gap-3">
                                <div class="text-right min-w-[75px]">
                                    <span class="text-[13px] font-bold text-ink">
                                        {{ calcBlockDuration(b).raw > 0 ? calcBlockDuration(b).credited.toFixed(1) + ' hrs' : '—' }}
                                    </span>
                                    <span v-if="calcBlockDuration(b).hasBreak" class="block text-[10px] text-amber-700 font-semibold whitespace-nowrap">
                                        -1h lunch
                                    </span>
                                    <span v-else-if="calcBlockDuration(b).isHalfDaySat" class="block text-[10px] text-emerald-700 font-semibold whitespace-nowrap">
                                        half day
                                    </span>
                                    <span v-else-if="isOfficeSa && calcBlockDuration(b).coversLunch" class="block text-[10px] text-emerald-700 font-semibold whitespace-nowrap">
                                        lunch duty (no deduct)
                                    </span>
                                </div>
                                <button type="button" @click="removePlotBlock(idx)"
                                        class="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-rose-50 hover:text-danger transition-colors"
                                        title="Remove this block">
                                    <app-icon name="Trash2" :size="15" />
                                </button>
                            </div>
                        </div>

                        <!-- Conflict alert on row -->
                        <p v-if="getBlockConflict(b)" class="mt-2 text-[11px] font-semibold text-danger flex items-center gap-1.5">
                            <app-icon name="TriangleAlert" :size="13" />
                            <span>{{ getBlockConflict(b) }}</span>
                        </p>
                    </div>

                    <div v-if="!plotBlocks.length" class="p-6 text-center border border-dashed border-line rounded-xl text-muted">
                        <p class="text-caption">No duty blocks plotted yet.</p>
                        <button type="button" @click="addPlotBlock" class="btn btn-secondary btn-sm mt-2 text-amber-950 border-amber-300">
                            <app-icon name="Plus" :size="13" /> Add a preferred duty block
                        </button>
                    </div>
                </div>

                <!-- Summary Bar -->
                <div class="rounded-xl border border-line bg-page p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="text-caption text-muted">Total Plotted Duty:</span>
                        <span class="text-body font-bold text-navy">{{ totalPlottedHours }} hrs/week</span>
                        <span v-if="totalLunchDeductions > 0" class="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-800 bg-amber-100/90 px-2 py-0.5 rounded-full">
                            <app-icon name="Coffee" :size="11" /> -{{ totalLunchDeductions }}h lunch break deducted
                        </span>
                        <span v-if="isOfficeSa && officeLunchBlocksCount > 0" class="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800 bg-emerald-100/90 px-2 py-0.5 rounded-full">
                            <app-icon name="ShieldCheck" :size="11" /> {{ officeLunchBlocksCount }} lunch duty block(s) credited (no deduction)
                        </span>
                    </div>
                    <div class="text-caption text-muted">
                        Target: <b class="text-ink font-semibold">{{ profile ? profile.weeklyTargetHours : 35 }} hrs/week</b>
                    </div>
                </div>
            </div>

            <!-- TAB 2: CLASS SCHEDULE BLOCKS (BLUE) -->
            <div v-if="plotModalTab === 'CLASSES'" class="space-y-3">
                <div class="flex items-center justify-between">
                    <div>
                        <span class="text-caption font-bold text-sky-950 uppercase tracking-wide">Enrolled Class Schedule</span>
                        <span class="ml-2 text-[11px] text-muted">({{ plotClassBlocks.length }} subjects · {{ totalPlottedClassHours }} hrs)</span>
                    </div>
                    <button type="button" @click="addPlotClassBlock" :disabled="!canAddClassBlock"
                            class="btn btn-secondary btn-sm text-[12px] text-sky-900 border-sky-300 hover:bg-sky-50">
                        <app-icon name="Plus" :size="13" /> Add Class Subject
                    </button>
                </div>

                <div class="text-caption text-muted bg-sky-50/70 p-2.5 rounded-lg border border-sky-200 flex items-center gap-2">
                    <app-icon name="Info" :size="15" class="text-sky-600 shrink-0" />
                    <span>Update or adjust your enrolled classes if sections dissolved or class schedules changed. In the Timetable Preview, classes appear as <b>blue blocks</b>.</span>
                </div>

                <!-- Class schedule list -->
                <div class="space-y-2 max-h-[46vh] overflow-y-auto pr-1">
                    <div v-for="(cb, idx) in plotClassBlocks" :key="'cb-' + idx"
                         class="rounded-xl border p-3 bg-white transition-colors"
                         :class="getClassBlockConflict(cb) ? 'border-rose-300 bg-rose-50/20' : 'border-line'">
                        <div class="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                            <!-- Col 1: Subject Code/Name (4 cols) -->
                            <div class="md:col-span-4">
                                <label class="block text-[11px] font-bold text-navy mb-0.5">Subject Name / Code</label>
                                <input v-model="cb.subject" type="text" placeholder="e.g. NET 2, QM, HCI, INTEG" class="input input-sm w-full font-bold" />
                            </div>

                            <!-- Col 2: Section / Instructor (3 cols) -->
                            <div class="md:col-span-3">
                                <label class="block text-[11px] font-bold text-navy mb-0.5">Section / Instructor</label>
                                <input v-model="cb.section" type="text" placeholder="e.g. 31M3 Sir Sed" class="input input-sm w-full text-caption" />
                            </div>

                            <!-- Col 3: Day of Week (2 cols) -->
                            <div class="md:col-span-2">
                                <label class="block text-[11px] font-bold text-navy mb-0.5">Day</label>
                                <select v-model="cb.day" class="input input-sm w-full font-semibold">
                                    <option v-for="d in DAYS_LIST" :key="d.code" :value="d.code">{{ d.name }}</option>
                                </select>
                            </div>

                            <!-- Col 4: Time Inputs + Delete (3 cols) -->
                            <div class="md:col-span-3 flex items-center justify-between gap-1.5">
                                <div class="flex items-center gap-1">
                                    <div>
                                        <label class="block text-[10px] text-muted mb-0.5">Start</label>
                                        <input v-model="cb.startTime" type="time" class="input input-sm w-24 text-[12px] px-1" />
                                    </div>
                                    <span class="text-muted text-[11px] mt-4">–</span>
                                    <div>
                                        <label class="block text-[10px] text-muted mb-0.5">End</label>
                                        <input v-model="cb.endTime" type="time" class="input input-sm w-24 text-[12px] px-1" />
                                    </div>
                                </div>

                                <button type="button" @click="removePlotClassBlock(idx)"
                                        class="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-rose-50 hover:text-danger transition-colors mt-3"
                                        title="Remove class subject">
                                    <app-icon name="Trash2" :size="15" />
                                </button>
                            </div>
                        </div>

                        <!-- Class conflict alert -->
                        <p v-if="getClassBlockConflict(cb)" class="mt-2 text-[11px] font-semibold text-danger flex items-center gap-1.5">
                            <app-icon name="TriangleAlert" :size="13" />
                            <span>{{ getClassBlockConflict(cb) }}</span>
                        </p>
                    </div>

                    <div v-if="!plotClassBlocks.length" class="p-6 text-center border border-dashed border-line rounded-xl text-muted">
                        <app-icon name="BookOpen" :size="24" class="mx-auto mb-1 text-muted" />
                        <p class="text-caption">No class schedule added.</p>
                        <button type="button" @click="addPlotClassBlock" class="btn btn-secondary btn-sm mt-2 text-sky-900 border-sky-300">
                            <app-icon name="Plus" :size="13" /> Add Enrolled Class Subject
                        </button>
                    </div>
                </div>

                <!-- Class summary bar -->
                <div class="rounded-xl border border-line bg-page p-3 flex items-center justify-between">
                    <span class="text-caption text-muted">Total Enrolled Class Hours:</span>
                    <span class="text-body font-bold text-sky-950">{{ totalPlottedClassHours }} hrs/week</span>
                </div>
            </div>

            <!-- TAB 3: TIMETABLE PREVIEW (MATCHING PICTURE 1) -->
            <div v-if="plotModalTab === 'PREVIEW'" class="space-y-3">
                <div class="flex flex-wrap items-center justify-between gap-2 p-3 bg-mist/60 rounded-xl border border-line">
                    <div class="flex items-center gap-4 text-xs font-semibold">
                        <span class="flex items-center gap-1.5 text-sky-950 font-bold">
                            <span class="h-3.5 w-3.5 rounded bg-[#38bdf8] border border-[#0284c7]"></span>
                            <span>Class Schedule ({{ totalPlottedClassHours }} hrs)</span>
                        </span>
                        <span class="flex items-center gap-1.5 text-amber-950 font-bold">
                            <span class="h-3.5 w-3.5 rounded bg-[#facc15] border border-[#ca8a04]"></span>
                            <span>Duty Schedule ({{ totalPlottedHours }} hrs)</span>
                        </span>
                    </div>
                    <div class="text-[11px] text-muted font-medium">
                        Weekly Spreadsheet Matrix (Mon – Sat · 7:00 AM – 10:00 PM)
                    </div>
                </div>

                <div class="overflow-auto rounded-xl border border-line bg-white shadow-inner max-h-[52vh]">
                    <div class="min-w-[820px]">
                        <!-- Spreadsheet Column Header: TIME, M, T, W, TH, F, Sat -->
                        <div class="sticky top-0 z-30 grid grid-cols-[110px_repeat(6,minmax(0,1fr))] bg-navy text-white text-[12px] font-bold shadow-xs">
                            <div class="sticky left-0 z-40 bg-navy px-2 py-2.5 border-r border-navy-700 text-center uppercase tracking-wider text-[11px]">
                                TIME
                            </div>
                            <div v-for="d in DAYS_LIST" :key="d.code" class="px-2 py-2.5 text-center border-r border-navy-700 uppercase tracking-wider last:border-r-0 text-[11px]">
                                <div>{{ d.label === 'MON' ? 'M' : (d.label === 'TUE' ? 'T' : (d.label === 'WED' ? 'W' : (d.label === 'THU' ? 'TH' : (d.label === 'FRI' ? 'F' : 'Sat')))) }}</div>
                                <div class="text-[9px] font-normal text-sky-200">
                                    {{ d.name }}
                                </div>
                            </div>
                        </div>

                        <!-- Grid Body (30 slots x 36px = 1080px total height) -->
                        <div class="relative grid grid-cols-[110px_repeat(6,minmax(0,1fr))] select-none" style="height: 1080px;">
                            <!-- Time labels column -->
                            <div class="sticky left-0 z-20 bg-mist/95 border-r border-line text-[10px] font-bold text-navy">
                                <div v-for="t in TIME_SLOTS" :key="t.min" class="h-9 px-1 flex items-center justify-center border-b border-line/40 whitespace-nowrap">
                                    {{ t.startStr }}
                                </div>
                            </div>

                            <!-- 6 Day Columns (Mon to Sat) -->
                            <div v-for="d in DAYS_LIST" :key="d.code" class="relative border-r border-line last:border-r-0 bg-white">
                                <!-- 30-min guideline slots -->
                                <div v-for="t in TIME_SLOTS" :key="t.min" class="h-9 border-b border-line/30 transition-colors hover:bg-navy/5"></div>

                                <!-- 1. Blue Class Schedule Blocks (matching Picture 1) -->
                                <div v-for="(cb, cIdx) in getPreviewDayClasses(d.code)" :key="'prev-c-' + cIdx"
                                     :style="getPreviewBlockStyle(cb.startTime, cb.endTime)"
                                     class="absolute left-1 right-1 rounded-md border border-[#0284c7] bg-[#38bdf8] text-[#0f172a] px-2 py-1 shadow-xs flex flex-col justify-between overflow-hidden z-20"
                                     :title="'Class: ' + cb.subject + ' (' + (cb.section || '') + ') | ' + cb.startTime + ' - ' + cb.endTime">
                                    <div class="min-w-0 flex-1 leading-tight">
                                        <div class="font-black text-[11px] truncate uppercase tracking-tight">{{ cb.subject }}</div>
                                        <div v-if="cb.section" class="text-[9px] font-bold text-slate-800 truncate">{{ cb.section }}</div>
                                    </div>
                                    <div class="text-[9px] font-bold text-slate-900 mt-0.5 truncate">
                                        {{ cb.startTime }} – {{ cb.endTime }}
                                    </div>
                                </div>

                                <!-- 2. Yellow Duty Schedule Blocks (matching Picture 1) -->
                                <div v-for="(db, dIdx) in getPreviewDayDuty(d.code)" :key="'prev-d-' + dIdx"
                                     :style="getPreviewBlockStyle(db.startTime, db.endTime)"
                                     class="absolute left-1 right-1 rounded-md border-2 border-[#ca8a04] bg-[#facc15] text-[#713f12] px-2 py-1 shadow-xs flex flex-col justify-between overflow-hidden z-20"
                                     :title="'Duty: ' + db.startTime + ' - ' + db.endTime + ' (' + calcBlockDuration(db).credited + ' hrs)'">
                                    <div class="min-w-0 flex-1 leading-tight">
                                        <div class="font-black text-[11px] truncate flex items-center gap-1 uppercase tracking-tight text-[#854d0e]">
                                            <app-icon name="Briefcase" :size="10" /> DUTY
                                        </div>
                                        <div class="text-[9px] font-bold text-[#713f12]">
                                            ({{ calcBlockDuration(db).credited }} hrs)
                                        </div>
                                    </div>
                                    <div class="text-[9px] font-bold text-[#854d0e] mt-0.5 truncate">
                                        {{ db.startTime }} – {{ db.endTime }}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <template #footer>
            <div class="flex items-center justify-between w-full">
                <div class="text-caption text-muted">
                    Duty: <b class="text-navy font-bold">{{ totalPlottedHours }}h</b> ·
                    Classes: <b class="text-navy font-bold">{{ totalPlottedClassHours }}h</b>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" @click="showPlotModal = false" class="btn btn-secondary">Cancel</button>
                    <button type="button" @click="savePlot" :disabled="savingPlot || hasAnyConflict" class="btn btn-primary">
                        <app-icon :name="savingPlot ? 'LoaderCircle' : 'Check'" :size="16" :class="savingPlot ? 'animate-spin' : ''" />
                        <span>{{ savingPlot ? 'Submitting…' : 'Submit Schedule for Validation' }}</span>
                    </button>
                </div>
            </div>
        </template>
    </app-modal>
    `
};

