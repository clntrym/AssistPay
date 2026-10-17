// Scheduling > Recommendations & Weekly Duty Grid (Page 6)
// Displays ITO & ACADS room/laboratory partner recommendations on the 7:00 AM - 10:00 PM Weekly Duty Grid.
// Allows the Coordinator to review, approve (per SA, per room, or Approve All), edit/adjust duty hours,
// view overlapping partner duty windows, unassign/reject, swap, or re-run Initial / Alternative matching.
const DutyGridPage = {
    components: { AppIcon, PageHeader, AppModal },

    setup() {
        const loading = Vue.ref(true);
        const busy = Vue.ref(false);
        const loadError = Vue.ref("");
        const semester = Vue.ref(null);
        const grid = Vue.ref(null);
        const progress = Vue.ref({ total: 0, decided: 0, pending: 0, gaps: 0, overlaps: 0 });
        const publication = Vue.ref(null);

        const deptFilter = Vue.ref("ALL");
        const statusFilter = Vue.ref("ALL");
        const q = Vue.ref("");
        const selectedKey = Vue.ref("");

        const swapModal = Vue.reactive({
            open: false,
            room: "",
            department: "",
            dropSaId: 0,
            dropSaName: "",
            pickSaId: 0,
            reason: "",
            alternates: [],
        });

        const editDutyModal = Vue.reactive({
            open: false,
            room: "",
            department: "",
            slotId: 0,
            saId: 0,
            saName: "",
            studentId: "",
            isReliever: false,
            donorRoom: "",
            classes: [],
            otherPartners: [],
            blocks: [],
            activeBlockIdx: -1,
            activeBlock: null,
            reason: "",
            error: "",
        });

        const isBatchLocked = Vue.computed(() => !!grid.value?.isLocked);
        const sanitizeText = (val) => String(val || "").replace(/['"`;<>\\]/g, " ").trim();

        const DAYS = [
            { code: "MON", label: "Monday" },
            { code: "TUE", label: "Tuesday" },
            { code: "WED", label: "Wednesday" },
            { code: "THU", label: "Thursday" },
            { code: "FRI", label: "Friday" },
            { code: "SAT", label: "Saturday" },
        ];

        const TIME_OPTIONS = [];
        for (let m = 420; m <= 1320; m += 30) {
            const hh = String(Math.floor(m / 60)).padStart(2, "0");
            const mm = String(m % 60).padStart(2, "0");
            const hrs = Math.floor(m / 60);
            const mins = m % 60;
            const h12 = hrs % 12 === 0 ? 12 : hrs % 12;
            const ampm = hrs >= 12 ? "PM" : "AM";
            TIME_OPTIONS.push({
                value: `${hh}:${mm}`,
                minutes: m,
                label: `${h12}:${String(mins).padStart(2, "0")} ${ampm}`,
            });
        }

        const timeToMin = (t) => {
            if (!t || typeof t !== "string") return 0;
            const parts = t.trim().split(":");
            if (parts.length < 2) return 0;
            return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
        };

        const minToTime = (m) => {
            const clamped = Math.max(420, Math.min(1320, Math.round(m)));
            const hh = String(Math.floor(clamped / 60)).padStart(2, "0");
            const mm = String(clamped % 60).padStart(2, "0");
            return `${hh}:${mm}`;
        };

        const normalizeToHhMm = (t, minsFallback = null) => {
            if (typeof t === "string" && t.trim()) {
                const clean = t.trim();
                const parts = clean.split(":");
                if (parts.length >= 2) {
                    const h = parseInt(parts[0], 10);
                    const m = parseInt(parts[1], 10);
                    if (!isNaN(h) && !isNaN(m)) {
                        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
                    }
                }
            }
            if (typeof minsFallback === "number" && !isNaN(minsFallback) && minsFallback >= 0) {
                return minToTime(minsFallback);
            }
            return "08:00";
        };

        const formatTime12 = (m) => {
            const hrs = Math.floor(m / 60);
            const mins = m % 60;
            const h12 = hrs % 12 === 0 ? 12 : hrs % 12;
            const ampm = hrs >= 12 ? "PM" : "AM";
            return `${h12}:${String(mins).padStart(2, "0")} ${ampm}`;
        };

        const ensureTimeOption = (val) => {
            if (!val || typeof val !== "string") return;
            const norm = normalizeToHhMm(val);
            if (!TIME_OPTIONS.some(t => t.value === norm)) {
                const m = timeToMin(norm);
                TIME_OPTIONS.push({
                    value: norm,
                    minutes: m,
                    label: formatTime12(m),
                });
                TIME_OPTIONS.sort((a, b) => a.minutes - b.minutes);
            }
        };

        // 7:00 AM (420) to 10:00 PM (1320) in 60-minute rows (15 hours)
        const HOUR_ROWS = [];
        for (let m = 420; m < 1320; m += 60) {
            HOUR_ROWS.push({
                start: m,
                end: m + 60,
                label: `${formatTime12(m)} – ${formatTime12(m + 60)}`,
                shortLabel: formatTime12(m),
            });
        }
        const GRID_START = 420;   // 7:00 AM
        const GRID_END = 1320;    // 10:00 PM
        const PX_PER_HOUR = 48;   // 48px per hour -> 720px total height

        const blockStyle = (startMin, endMin) => {
            const s = Math.max(GRID_START, Math.min(GRID_END, Number(startMin) || GRID_START));
            const e = Math.max(s + 15, Math.min(GRID_END, Number(endMin) || s + 60));
            const top = ((s - GRID_START) / 60) * PX_PER_HOUR;
            const height = Math.max(20, ((e - s) / 60) * PX_PER_HOUR - 2);
            return {
                top: `${top}px`,
                height: `${height}px`,
            };
        };

        const parseTarget = () => {
            const route = VueRouter.useRoute ? VueRouter.useRoute() : null;
            let targetRoom = (route?.query?.room || "").trim();
            let targetKey = (route?.query?.key || "").trim();

            if (!targetRoom) {
                const hash = window.location.hash || "";
                const qIndex = hash.indexOf("?");
                if (qIndex !== -1) {
                    const params = new URLSearchParams(hash.substring(qIndex));
                    targetRoom = (params.get("room") || "").trim();
                    if (!targetKey) targetKey = (params.get("key") || "").trim();
                }
            }

            if (!targetRoom) {
                try {
                    targetRoom = (sessionStorage.getItem("assistpay_target_room") || "").trim();
                    sessionStorage.removeItem("assistpay_target_room");
                } catch (e) {}
            }
            if (!targetKey) {
                try {
                    targetKey = (sessionStorage.getItem("assistpay_target_key") || "").trim();
                    sessionStorage.removeItem("assistpay_target_key");
                } catch (e) {}
            }

            return { room: targetRoom, key: targetKey };
        };

        const selectPostByTarget = (targetRoom = "", targetKey = "") => {
            const posts = grid.value?.posts || [];
            if (!posts.length) return false;

            let matched = null;
            if (targetKey) {
                matched = posts.find(p => p.key === targetKey);
            }
            if (!matched && targetRoom) {
                const trClean = targetRoom.trim().toLowerCase();
                matched = posts.find(p =>
                    (p.room && p.room.trim().toLowerCase() === trClean) ||
                    (p.key && p.key.toLowerCase().includes(trClean))
                );
            }

            if (matched) {
                selectedKey.value = matched.key;
                if (deptFilter.value !== "ALL" && deptFilter.value !== matched.department) {
                    deptFilter.value = "ALL";
                }
                if (statusFilter.value !== "ALL") {
                    statusFilter.value = "ALL";
                }
                q.value = "";

                Vue.nextTick(() => {
                    const cardEl = document.querySelector(`button[data-post-room="${CSS.escape(matched.room)}"]`) ||
                                   document.querySelector(`button[data-post-key="${CSS.escape(matched.key)}"]`);
                    if (cardEl && cardEl.scrollIntoView) {
                        cardEl.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
                    }
                    const dutyEl = document.getElementById("duty-grid-details");
                    if (dutyEl && dutyEl.scrollIntoView) {
                        dutyEl.scrollIntoView({ behavior: "smooth", block: "start" });
                    }
                });
                return true;
            }
            return false;
        };

        const applyResponse = (res) => {
            semester.value = res.semester || semester.value;
            grid.value = res.grid || null;
            progress.value = res.progress || { total: 0, decided: 0, pending: 0, gaps: 0, overlaps: 0 };
            publication.value = res.publication || publication.value;

            const posts = grid.value?.posts || [];
            if (posts.length > 0) {
                const { room, key } = parseTarget();
                const matched = (room || key) ? selectPostByTarget(room, key) : false;
                if (!matched) {
                    const exists = posts.some(p => p.key === selectedKey.value);
                    if (!exists) selectedKey.value = posts[0].key;
                }
            } else {
                selectedKey.value = "";
            }
        };

        const load = async () => {
            loading.value = true;
            loadError.value = "";
            const res = await Model.request("scheduling", "room_grid");
            loading.value = false;
            if (!res.success) {
                loadError.value = res.message || "Could not load Recommendations.";
                return;
            }
            applyResponse(res);
        };

        const route = VueRouter.useRoute ? VueRouter.useRoute() : null;
        if (route) {
            Vue.watch(() => route.query.room, (newRoom) => {
                if (newRoom) {
                    selectPostByTarget(newRoom, route.query.key || "");
                }
            });
        }

        const onHashChange = () => {
            const { room, key } = parseTarget();
            if (room || key) {
                selectPostByTarget(room, key);
            }
        };

        Vue.onMounted(() => {
            load();
            window.addEventListener("hashchange", onHashChange);
        });

        Vue.onUnmounted(() => {
            window.removeEventListener("hashchange", onHashChange);
        });

        const filteredPosts = Vue.computed(() => {
            const posts = grid.value?.posts || [];
            const term = q.value.trim().toLowerCase();
            return posts.filter(p => {
                if (deptFilter.value === "RELIEVER") {
                    if (!p.isRelieverPost) return false;
                } else if (deptFilter.value !== "ALL" && p.department !== deptFilter.value) {
                    return false;
                }
                if (statusFilter.value === "ACCEPTED" && !p.accepted) return false;
                if (statusFilter.value === "PENDING" && p.accepted) return false;
                if (statusFilter.value === "OVERLAPS" && (!p.overlaps || p.overlaps.length === 0)) return false;
                if (statusFilter.value === "GAPS" && p.missingSaCount === 0 && (!p.gaps || p.gaps.length === 0)) return false;
                if (!term) return true;
                if (p.room.toLowerCase().includes(term) || p.department.toLowerCase().includes(term)) return true;
                return (p.staff || []).some(s =>
                    s.name.toLowerCase().includes(term) ||
                    s.studentId.toLowerCase().includes(term) ||
                    (s.course || "").toLowerCase().includes(term)
                );
            });
        });

        const currentPost = Vue.computed(() => {
            const posts = grid.value?.posts || [];
            return posts.find(p => p.key === selectedKey.value) || filteredPosts.value[0] || null;
        });

        const runMatching = async (mode = "standard") => {
            if (busy.value) return;
            const isAlt = mode === "alternative";
            const ok = await Alerts.confirm({
                title: isAlt ? "Explore Alternative Matches?" : "Restore Initial Match?",
                html: isAlt
                    ? "Generate alternative complementary partner matches for ITO &amp; ACADS rooms while re-verifying official Registrar class schedules?"
                    : "Restore the initial complementary partner recommendations for all ITO &amp; ACADS rooms?",
                confirmText: isAlt ? "Explore Alternatives" : "Restore Initial Match"
            });
            if (!ok) return;

            busy.value = true;
            const res = await Model.request("scheduling", "matching_run", { mode });
            busy.value = false;
            if (!res.success) {
                Toast.error(res.message || "Could not run Schedule Matching.");
                return;
            }
            applyResponse(res);
            const adaptedCnt = res.recheck?.adaptedChanges?.length || res.grid?.recheck?.adaptedChanges?.length || 0;
            const adaptSuffix = adaptedCnt > 0 ? ` (${adaptedCnt} schedule/required S.A. update(s) adapted)` : "";
            Toast.success(
                isAlt
                    ? `Alternative partner matches loaded! Double-checked S.A. class hours & Room/Lab requirements${adaptSuffix}.`
                    : `Initial matching recommendations restored${adaptSuffix}.`
            );
        };

        const acceptRoom = async (room) => {
            if (busy.value || !room) return;
            const post = (grid.value?.posts || []).find(p => p.room === room);
            const isReSync = !!post?.accepted;
            const labelType = post?.department === "OFFICE" ? "Office" : "Room";
            const ok = await Alerts.confirm({
                title: isReSync ? `Re-sync Approved ${labelType}?` : `Approve ${labelType} Post?`,
                html: `Approve the recommended schedule for <b class="text-ink">${Alerts.esc(room)}</b> and sync it to Finalize Schedule?`,
                confirmText: isReSync ? `Re-sync ${labelType}` : `Approve ${labelType}`
            });
            if (!ok) return;

            busy.value = true;
            const res = await Model.request("scheduling", "post_accept", { room });
            busy.value = false;
            if (!res.success) {
                Toast.error(res.message || "Could not approve room post.");
                return;
            }
            applyResponse(res);
            Toast.success(`Approved ${room} recommendations and synced to Finalize Schedule.`);
        };

        const acceptAll = async () => {
            if (busy.value) return;
            if (isBatchLocked.value) {
                Toast.info("This matching batch is already approved and locked.");
                return;
            }
            const ok = await Alerts.confirm({
                title: "Approve & Lock Matching Batch?",
                html: `Approve, publish, and lock all <b class="text-ink">${progress.value.total || 0}</b> reviewed ITO, ACADS, and Office assignments for this semester? Once locked, changes require an authorized reassignment reason.`,
                confirmText: "Approve & Lock Batch"
            });
            if (!ok) return;

            busy.value = true;
            const res = await Model.request("scheduling", "batch_approve_lock", {
                notes: "Approved and locked reviewed matching batch from Recommendations & Weekly Duty Grid.",
            });
            busy.value = false;
            if (!res.success) {
                Toast.error(res.message || "Could not approve and lock matching batch.");
                return;
            }
            applyResponse(res);
            Toast.success("Room Assignment Batch approved and locked!");
        };

        const unlockBatch = async () => {
            if (busy.value) return;
            const ok = await Alerts.confirm({
                title: "Unlock Matching Batch?",
                html: "Unlock the matching batch so you can adjust schedules, explore alternatives, or re-match?",
                confirmText: "Unlock Batch"
            });
            if (!ok) return;

            busy.value = true;
            const res = await Model.request("scheduling", "batch_unlock");
            busy.value = false;
            if (!res.success) {
                Toast.error(res.message || "Could not unlock matching batch.");
                return;
            }
            applyResponse(res);
            Toast.success("Matching batch unlocked. You can now adjust schedules and explore matches.");
        };

        const approveStaff = async (room, sa) => {
            if (busy.value || !room || !sa) return;
            const ok = await Alerts.confirm({
                title: `Approve ${sa.name}?`,
                html: `Approve <b class="text-ink">${Alerts.esc(sa.name)}</b> (${sa.creditedHours} hrs/wk) for <b class="text-ink">${Alerts.esc(room)}</b>?`,
                confirmText: "Approve S.A."
            });
            if (!ok) return;

            busy.value = true;
            const res = await Model.request("scheduling", "post_staff_approve", {
                room,
                saId: sa.saId,
            });
            busy.value = false;
            if (!res.success) {
                Toast.error(res.message || "Could not approve S.A.");
                return;
            }
            applyResponse(res);
            Toast.success(`Approved ${sa.name} for ${room}.`);
        };

        const rejectStaff = async (room, sa) => {
            if (busy.value || !room || !sa) return;
            if (isBatchLocked.value) {
                Toast.error("Batch is locked. Use 'Swap / Reassign S.A.' with an official reason instead of unassigning.");
                return;
            }
            const ok = await Alerts.confirm({
                title: `Unassign ${sa.name}?`,
                html: `Unassign <b class="text-ink">${Alerts.esc(sa.name)}</b> from <b class="text-ink">${Alerts.esc(room)}</b>? You can assign a replacement or re-run matching afterward.`,
                icon: "warning",
                danger: true,
                confirmText: "Unassign"
            });
            if (!ok) return;

            busy.value = true;
            const res = await Model.request("scheduling", "post_staff_reject", {
                room,
                saId: sa.saId,
            });
            busy.value = false;
            if (!res.success) {
                Toast.error(res.message || "Could not unassign S.A.");
                return;
            }
            applyResponse(res);
            Toast.info(`Unassigned ${sa.name} from ${room}. You can swap a replacement or re-run matching.`);
        };

        const openSwapModal = (post, sa = null) => {
            swapModal.room = post.room;
            swapModal.department = post.department;
            swapModal.dropSaId = sa ? sa.saId : 0;
            swapModal.dropSaName = sa ? sa.name : "Vacant Slot";
            swapModal.reason = "";

            // Exclude anyone already assigned to ANY room
            // "dapat di na nag papakita here yung may naka assign na sa na match ng system."
            const assignedSaIds = new Set();
            (grid.value?.posts || []).forEach(p => {
                (p.staff || []).forEach(st => {
                    const sid = Number(st.saId);
                    if (sid && sid !== Number(swapModal.dropSaId)) {
                        assignedSaIds.add(sid);
                    }
                });
            });

            swapModal.alternates = (post.alternates || []).filter(alt => !assignedSaIds.has(Number(alt.saId)));
            swapModal.pickSaId = swapModal.alternates[0]?.saId || 0;
            swapModal.open = true;
        };

        const submitSwap = async () => {
            if (busy.value || !swapModal.pickSaId) return;
            const cleanReason = sanitizeText(swapModal.reason);
            if (isBatchLocked.value && cleanReason.length < 5) {
                Toast.error("Please enter an official reassignment reason (at least 5 characters) because the batch is locked.");
                return;
            }
            const picked = (swapModal.alternates || []).find(a => a.saId === swapModal.pickSaId);
            const pickedName = picked ? picked.name : "Selected S.A.";
            const ok = await Alerts.confirm({
                title: isBatchLocked.value ? `Authorized Reassignment for ${swapModal.room}?` : `Confirm Assignment for ${swapModal.room}?`,
                html: `Assign <b class="text-ink">${Alerts.esc(pickedName)}</b> to <b class="text-ink">${Alerts.esc(swapModal.room)}</b> (replacing <b class="text-ink">${Alerts.esc(swapModal.dropSaName)}</b>)?`,
                confirmText: isBatchLocked.value ? "Confirm Authorized Reassignment" : "Confirm Assignment"
            });
            if (!ok) return;

            busy.value = true;
            const action = isBatchLocked.value ? "authorized_reassign_room_sa" : "post_swap";
            const res = await Model.request("scheduling", action, {
                room: swapModal.room,
                dropSaId: swapModal.dropSaId,
                pickSaId: swapModal.pickSaId,
                reason: cleanReason || "Updated by Coordinator during pre-approval review",
            });
            busy.value = false;
            if (!res.success) {
                Toast.error(res.message || "Could not swap S.A.");
                return;
            }
            swapModal.open = false;
            applyResponse(res);
            Toast.success(
                isBatchLocked.value
                    ? `Authorized reassignment recorded for ${swapModal.room}.`
                    : `Updated assignment for ${swapModal.room}.`
            );
        };

        // --- Edit / Adjust Duty Hours Modal ---
        const openEditDutyModal = (post, sa, clickedBlock = null, prefillBlock = null) => {
            if (!post || !sa) return;
            editDutyModal.room = post.room;
            editDutyModal.department = post.department;
            editDutyModal.slotId = sa.slotId || 0;
            editDutyModal.saId = sa.saId;
            editDutyModal.saName = sa.name;
            editDutyModal.studentId = sa.studentId;
            editDutyModal.isReliever = !!sa.isReliever;
            editDutyModal.donorRoom = sa.donorRoom || "";
            editDutyModal.classes = sa.classes || [];
            editDutyModal.otherPartners = (post.staff || []).filter(p => p.saId !== sa.saId && !p.isReliever);
            editDutyModal.reason = "";
            editDutyModal.error = "";
            editDutyModal.blocks = (sa.duty || []).map(d => {
                const st = normalizeToHhMm(d.startTime, d.start);
                const et = normalizeToHhMm(d.endTime, d.end);
                ensureTimeOption(st);
                ensureTimeOption(et);
                return {
                    day: d.day,
                    startTime: st,
                    endTime: et,
                };
            });

            if (prefillBlock) {
                const pst = normalizeToHhMm(prefillBlock.startTime, prefillBlock.start);
                const pet = normalizeToHhMm(prefillBlock.endTime, prefillBlock.end);
                ensureTimeOption(pst);
                ensureTimeOption(pet);
                editDutyModal.blocks.push({
                    day: prefillBlock.day,
                    startTime: pst,
                    endTime: pet,
                });
                editDutyModal.activeBlockIdx = editDutyModal.blocks.length - 1;
                editDutyModal.activeBlock = editDutyModal.blocks[editDutyModal.activeBlockIdx];
            } else if (clickedBlock) {
                const cDay = clickedBlock.day;
                const cStart = normalizeToHhMm(clickedBlock.startTime, clickedBlock.start);
                const foundIdx = editDutyModal.blocks.findIndex(b => b.day === cDay && b.startTime === cStart);
                editDutyModal.activeBlockIdx = foundIdx >= 0 ? foundIdx : 0;
                editDutyModal.activeBlock = editDutyModal.blocks[editDutyModal.activeBlockIdx] || null;
            } else {
                editDutyModal.activeBlockIdx = editDutyModal.blocks.length > 0 ? 0 : -1;
                editDutyModal.activeBlock = editDutyModal.blocks.length > 0 ? editDutyModal.blocks[0] : null;
            }

            editDutyModal.open = true;
        };

        const addDutyBlockRow = () => {
            const usedDays = new Set(editDutyModal.blocks.map(b => b.day));
            const nextDay = DAYS.find(d => !usedDays.has(d.code))?.code || "MON";
            editDutyModal.blocks.push({
                day: nextDay,
                startTime: "08:00",
                endTime: "12:00",
            });
            editDutyModal.activeBlockIdx = editDutyModal.blocks.length - 1;
            editDutyModal.activeBlock = editDutyModal.blocks[editDutyModal.activeBlockIdx];
        };

        const removeDutyBlockRow = async (idx) => {
            const blk = editDutyModal.blocks[idx];
            if (!blk) return;
            const isLast = editDutyModal.blocks.length === 1;
            const ok = await Alerts.confirm({
                title: isLast ? "Remove Last Duty Block?" : "Remove Duty Block?",
                html: isLast
                    ? `Remove the last duty block <b class="text-ink">${Alerts.esc(blk.day)} (${Alerts.esc(blk.startTime)} – ${Alerts.esc(blk.endTime)})</b>? Saving with 0 duty blocks will unassign <b class="text-ink">${Alerts.esc(editDutyModal.saName)}</b> from this room.`
                    : `Remove the <b class="text-ink">${Alerts.esc(blk.day)} (${Alerts.esc(blk.startTime)} – ${Alerts.esc(blk.endTime)})</b> duty block?`,
                icon: "warning",
                danger: true,
                confirmText: isLast ? "Remove Last Block" : "Remove Block"
            });
            if (!ok) return;
            editDutyModal.blocks.splice(idx, 1);
            if (editDutyModal.activeBlockIdx === idx) {
                editDutyModal.activeBlockIdx = editDutyModal.blocks.length > 0 ? 0 : -1;
                editDutyModal.activeBlock = editDutyModal.blocks[editDutyModal.activeBlockIdx] || null;
            } else if (editDutyModal.activeBlockIdx > idx) {
                editDutyModal.activeBlockIdx--;
                editDutyModal.activeBlock = editDutyModal.blocks[editDutyModal.activeBlockIdx] || null;
            }
        };

        const deleteActiveBlock = async () => {
            if (editDutyModal.activeBlockIdx < 0 || !editDutyModal.blocks[editDutyModal.activeBlockIdx]) return;
            await removeDutyBlockRow(editDutyModal.activeBlockIdx);
        };

        const clearAllBlocks = async () => {
            const ok = await Alerts.confirm({
                title: "Clear All Duty Blocks?",
                html: `Clear all duty blocks for <b class="text-ink">${Alerts.esc(editDutyModal.saName)}</b>? Saving will unassign this S.A. from <b class="text-ink">${Alerts.esc(editDutyModal.room)}</b>.`,
                icon: "warning",
                danger: true,
                confirmText: "Clear All Blocks"
            });
            if (!ok) return;
            editDutyModal.blocks = [];
            editDutyModal.activeBlockIdx = -1;
            editDutyModal.activeBlock = null;
            Toast.info("All blocks cleared. Click 'Save & Unassign S.A.' to confirm removal.");
        };

        const unassignFromModal = async () => {
            const sa = { saId: editDutyModal.saId, name: editDutyModal.saName };
            const room = editDutyModal.room;
            editDutyModal.open = false;
            await rejectStaff(room, sa);
        };

        const swapFromModal = () => {
            const post = (grid.value?.posts || []).find(p => p.room === editDutyModal.room);
            const sa = { saId: editDutyModal.saId, name: editDutyModal.saName };
            editDutyModal.open = false;
            if (post) openSwapModal(post, sa);
        };

        const handleLaneDblClick = (e, post, sa, dayCode) => {
            if (e.target !== e.currentTarget) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const clickY = e.clientY - rect.top;
            const hourOffset = Math.floor(clickY / PX_PER_HOUR);
            const startMins = Math.max(GRID_START, Math.min(GRID_END - 60, GRID_START + (hourOffset * 60)));
            const endMins = Math.min(GRID_END, startMins + 120);
            openEditDutyModal(post, sa, null, {
                day: dayCode,
                startTime: minToTime(startMins),
                endTime: minToTime(endMins)
            });
        };

        // Live preview and conflict checker for the Duty Hour Editor
        const editDutyPreview = Vue.computed(() => {
            const isOfficePost = editDutyModal.department === "OFFICE";
            let rawTotal = 0;
            const dayRaw = {};
            const daySpansLunch = {};
            const warnings = [];
            const rowDetails = [];

            editDutyModal.blocks.forEach((b, idx) => {
                const s = timeToMin(b.startTime);
                const e = timeToMin(b.endTime);
                const hrs = e > s ? Math.round(((e - s) / 60) * 100) / 100 : 0;
                let conflict = "";

                if (e <= s) {
                    conflict = "End time must be after start time.";
                } else if (e - s < 60) {
                    conflict = "Minimum 1.0 hour per duty block.";
                } else if (isOfficePost && b.day === "SAT" && (s < 420 || e > 720)) {
                    conflict = "Saturday Office duty is half-day only (standard 8:00 AM – 12:00 PM, adjustable from 7:00 AM – 12:00 PM, no lunch deduction).";
                } else if (isOfficePost && b.day !== "SAT" && (s < 420 || e > 1080)) {
                    conflict = "Office duty window is 8:00 AM – 5:00 PM standard (adjustable between 7:00 AM and 6:00 PM to fill required hours).";
                } else if (isOfficePost && b.day !== "SAT" && s >= 720 && e <= 780) {
                    conflict = "12:00 PM – 1:00 PM is automatic lunch break (not counted as duty).";
                } else if (isOfficePost && b.day !== "SAT" && s < 780 && e > 720 && !(s <= 720 && e >= 780)) {
                    conflict = "12:00 PM – 1:00 PM is automatic lunch break. End morning duty at 12:00 PM or start afternoon duty at 1:00 PM.";
                } else if (!isOfficePost && (s < 420 || e > 1320)) {
                    conflict = "Duty must be within 7:00 AM – 10:00 PM.";
                } else {
                    // Check Registrar Class conflict
                    const clsHit = (editDutyModal.classes || []).find(
                        c => c.day === b.day && Math.max(s, c.start) < Math.min(e, c.end)
                    );
                    if (clsHit) {
                        conflict = `Clashes with Registrar Class ${clsHit.subject} (${clsHit.startLabel}–${clsHit.endLabel}).`;
                    }
                    // Check duplicate/self-overlap on same day
                    const selfHit = editDutyModal.blocks.find((other, oIdx) => {
                        if (oIdx >= idx || other.day !== b.day) return false;
                        const os = timeToMin(other.startTime);
                        const oe = timeToMin(other.endTime);
                        return Math.max(s, os) < Math.min(e, oe);
                    });
                    if (!conflict && selfHit) {
                        conflict = `Overlaps with another duty block on ${b.day}.`;
                    }
                }

                // Check partner overlap in the same room (informational for ITO/ACADS rooms)
                let partnerOverlapHrs = 0;
                let partnerOverlapLabel = "";
                if (!isOfficePost && !editDutyModal.isReliever && e > s) {
                    editDutyModal.otherPartners.forEach(p => {
                        (p.duty || []).forEach(pd => {
                            if (pd.day !== b.day) return;
                            const os = Math.max(s, pd.start);
                            const oe = Math.min(e, pd.end);
                            if (oe > os) {
                                const oh = Math.round(((oe - os) / 60) * 100) / 100;
                                partnerOverlapHrs = Math.round((partnerOverlapHrs + oh) * 100) / 100;
                                partnerOverlapLabel = `${formatTime12(os)}–${formatTime12(oe)} with ${p.name.split(" ")[0]}`;
                            }
                        });
                    });
                }

                if (conflict) warnings.push(`Block #${idx + 1} (${b.day}): ${conflict}`);
                if (hrs > 0) {
                    rawTotal += hrs;
                    dayRaw[b.day] = (dayRaw[b.day] || 0) + hrs;
                    if (isOfficePost && b.day !== "SAT" && ((s <= 720 && e >= 780) || (hrs >= 5.0 && s < 780 && e > 720))) {
                        daySpansLunch[b.day] = true;
                    }
                }
                rowDetails.push({
                    hours: hrs,
                    conflict,
                    partnerOverlapHrs,
                    partnerOverlapLabel,
                    spansOfficeLunch: isOfficePost && b.day !== "SAT" && ((s <= 720 && e >= 780) || (hrs >= 5.0 && s < 780 && e > 720)),
                    isExtendedOffice: isOfficePost && e > s && (s < 480 || e > 1020),
                });
            });

            let creditedTotal = 0;
            Object.entries(dayRaw).forEach(([day, r]) => {
                let deduct = 0.0;
                if (isOfficePost) {
                    deduct = day !== "SAT" && daySpansLunch[day] ? 1.0 : 0.0;
                } else {
                    deduct = !editDutyModal.isReliever && day !== "SAT" && r >= 5.0 ? 1.0 : 0.0;
                }
                creditedTotal += Math.max(0, r - deduct);
            });

            const minW = Number(grid.value?.minWeekly || 0);
            const maxW = Number(grid.value?.maxWeekly || 0);
            if (!editDutyModal.isReliever && maxW > 0 && creditedTotal > maxW) {
                warnings.push(`Credited weekly total (${creditedTotal} hrs) exceeds Coordinator maximum (${maxW} hrs/wk).`);
            }

            return {
                rawHours: Math.round(rawTotal * 100) / 100,
                creditedHours: Math.round(creditedTotal * 100) / 100,
                belowMinimum: !editDutyModal.isReliever && minW > 0 && creditedTotal < minW,
                overMaximum: !editDutyModal.isReliever && maxW > 0 && creditedTotal > maxW,
                warnings,
                rowDetails,
                hasErrors: warnings.length > 0,
            };
        });

        // 1-click helper to trim overlapping duty windows with other primary partner(s) in the room
        const trimPartnerOverlapInModal = async () => {
            if (editDutyModal.isReliever || !editDutyModal.otherPartners.length) return;
            const ok = await Alerts.confirm({
                title: "Auto-Trim Partner Overlaps?",
                html: `Trim overlapping duty windows with partner(s) in <b class="text-ink">${Alerts.esc(editDutyModal.room)}</b> (keeping blocks &ge; 1.0 hr)?`,
                confirmText: "Auto-Trim Overlaps"
            });
            if (!ok) return;

            const trimmed = [];
            editDutyModal.blocks.forEach(b => {
                let segments = [{ s: timeToMin(b.startTime), e: timeToMin(b.endTime) }];
                editDutyModal.otherPartners.forEach(p => {
                    (p.duty || []).forEach(pd => {
                        if (pd.day !== b.day) return;
                        const nextSegs = [];
                        segments.forEach(seg => {
                            const os = Math.max(seg.s, pd.start);
                            const oe = Math.min(seg.e, pd.end);
                            if (oe <= os) {
                                nextSegs.push(seg);
                            } else {
                                if (os - seg.s >= 60) nextSegs.push({ s: seg.s, e: os });
                                if (seg.e - oe >= 60) nextSegs.push({ s: oe, e: seg.e });
                            }
                        });
                        segments = nextSegs;
                    });
                });
                if (segments.length > 0) {
                    segments.forEach(seg => {
                        trimmed.push({
                            day: b.day,
                            startTime: minToTime(seg.s),
                            endTime: minToTime(seg.e),
                        });
                    });
                } else {
                    // Keep original if trimming would completely wipe out the block
                    trimmed.push(b);
                }
            });
            editDutyModal.blocks = trimmed;
            Toast.info("Trimmed overlapping partner windows (kept blocks >= 1.0 hr). Review and click Save.");
        };

        const saveDutyHours = async (resetToAuto = false) => {
            if (busy.value) return;
            editDutyModal.error = "";
            if (!resetToAuto && editDutyPreview.value.hasErrors) {
                editDutyModal.error = editDutyPreview.value.warnings[0] || "Please fix schedule conflicts before saving.";
                return;
            }
            const cleanReason = sanitizeText(editDutyModal.reason);
            if (isBatchLocked.value && cleanReason.length < 5) {
                editDutyModal.error = "An official exception reason (at least 5 characters) is required because the matching batch is locked.";
                Toast.error(editDutyModal.error);
                return;
            }
            const isZeroBlocks = !resetToAuto && editDutyModal.blocks.length === 0;
            const ok = await Alerts.confirm({
                title: resetToAuto ? "Reset to Auto-Recommended Duty?" : (isZeroBlocks ? "Unassign S.A.?" : "Save Adjusted Duty Hours?"),
                html: resetToAuto
                    ? `Restore the automatic recommended duty schedule for <b class="text-ink">${Alerts.esc(editDutyModal.saName)}</b> in <b class="text-ink">${Alerts.esc(editDutyModal.room)}</b>?`
                    : (isZeroBlocks
                        ? `Saving with 0 duty blocks will unassign <b class="text-ink">${Alerts.esc(editDutyModal.saName)}</b> from <b class="text-ink">${Alerts.esc(editDutyModal.room)}</b>. Proceed?`
                        : `Save the adjusted duty schedule (<b class="text-ink">${editDutyPreview.value.creditedHours} credited hrs/wk</b>) for <b class="text-ink">${Alerts.esc(editDutyModal.saName)}</b> in <b class="text-ink">${Alerts.esc(editDutyModal.room)}</b>?`),
                confirmText: resetToAuto ? "Reset to Auto" : (isZeroBlocks ? "Unassign S.A." : "Save Duty Hours")
            });
            if (!ok) return;

            busy.value = true;
            const action = isBatchLocked.value ? "authorized_reassign_room_sa" : "post_duty_save";
            const res = await Model.request("scheduling", action, {
                room: editDutyModal.room,
                slotId: editDutyModal.slotId,
                saId: editDutyModal.saId,
                pickSaId: editDutyModal.saId,
                blocks: editDutyModal.blocks,
                resetToAuto: !!resetToAuto,
                reason: cleanReason || (isZeroBlocks ? "Unassigned by Coordinator (removed all duty blocks)" : "Adjusted duty schedule during review"),
            });
            busy.value = false;
            if (!res.success) {
                editDutyModal.error = res.message || "Could not save adjusted duty hours.";
                Toast.error(editDutyModal.error);
                return;
            }
            editDutyModal.open = false;
            applyResponse(res);
            Toast.success(
                resetToAuto
                    ? `Restored auto-recommended duty hours for ${editDutyModal.saName}.`
                    : (isZeroBlocks
                        ? `Unassigned ${editDutyModal.saName} from ${editDutyModal.room}.`
                        : `Saved adjusted duty hours for ${editDutyModal.saName} in ${editDutyModal.room}.`)
            );
        };

        const goFinalize = async () => {
            const ok = await Alerts.confirm({
                title: "Proceed to Finalize Schedule?",
                html: "Open Finalize Schedule to review and publish all approved S.A. duty schedules?",
                confirmText: "Proceed"
            });
            if (!ok) return;
            window.location.hash = "#/admin/scheduling/finalized";
        };

        const primaryStaff = (post) => {
            if (!post || !post.staff) return [];
            return post.staff.filter(sa => !sa.isReliever);
        };

        const staffForDay = (post, _dayCode) => {
            return primaryStaff(post);
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

        const relieverEntries = (post) => {
            if (!post || !post.staff) return [];
            const bySa = new Map();
            for (const sa of post.staff) {
                if (!sa.isReliever) continue;
                const saKey = sa.saId || sa.slotId;
                if (!bySa.has(saKey)) {
                    const firstName = (sa.name || "").trim().split(/\s+/)[0].toUpperCase();
                    const isDedicated = !sa.donorRoom || sa.donorRoom.toLowerCase().includes('reliever') || sa.donorRoom.toLowerCase().includes('pool');
                    const originLabel = isDedicated ? 'Dedicated Lab Reliever' : `From Room ${sa.donorRoom}`;
                    bySa.set(saKey, {
                        key: `rel-${sa.slotId || saKey}`,
                        sa,
                        saId: sa.saId,
                        slotId: sa.slotId,
                        name: sa.name,
                        firstName,
                        originLabel,
                        isDedicated,
                        blocks: [],
                    });
                }
                const entry = bySa.get(saKey);
                for (const b of (sa.duty || [])) {
                    const startText = formatCompactTime(b.start);
                    const endText = formatCompactTime(b.end);
                    entry.blocks.push({
                        day: b.day,
                        start: Number(b.start) || 0,
                        end: Number(b.end) || 0,
                        startText,
                        endText,
                        credited: b.credited,
                        lineText: `${b.day}- ${startText}-${endText}`,
                    });
                }
            }

            const items = Array.from(bySa.values());
            items.forEach(entry => {
                entry.blocks.sort((a, b) => {
                    const da = DAY_SORT_INDEX[a.day] || 99;
                    const db = DAY_SORT_INDEX[b.day] || 99;
                    if (da !== db) return da - db;
                    return a.start - b.start;
                });
                const totalCred = entry.blocks.reduce((acc, b) => acc + (Number(b.credited) || ((b.end - b.start) / 60.0)), 0);
                entry.creditedHours = Number(entry.sa.creditedHours) || Math.round(totalCred * 10) / 10;
            });

            return items;
        };

        const relieverBlocksForPartner = (post, targetSa, dayCode) => {
            if (!post || !post.staff) return [];
            const primStaff = primaryStaff(post);
            const saIdx = primStaff.findIndex(s => s.slotId === targetSa.slotId);
            if (saIdx < 0) return [];

            const relStaff = (post.staff || []).filter(s => s.isReliever);
            const matchingBlocks = [];

            for (const rSa of relStaff) {
                const firstName = (rSa.name || "").trim().split(/\s+/)[0].toUpperCase();
                for (const b of (rSa.duty || [])) {
                    if (b.day !== dayCode) continue;
                    const bStart = Number(b.start) || 0;
                    const bEnd = Number(b.end) || 0;

                    let assignedToIdx = -1;
                    primStaff.forEach((pst, pi) => {
                        const hasClassOv = (pst.classes || []).some(c =>
                            c.day === dayCode && !(Number(c.end) <= bStart || Number(c.start) >= bEnd)
                        );
                        if (hasClassOv && assignedToIdx === -1) {
                            assignedToIdx = pi;
                        }
                    });

                    if (assignedToIdx === -1) {
                        primStaff.forEach((pst, pi) => {
                            const hasDuty = (pst.duty || []).some(d =>
                                d.day === dayCode && !(Number(d.end) <= bStart || Number(d.start) >= bEnd)
                            );
                            if (!hasDuty && assignedToIdx === -1) {
                                assignedToIdx = pi;
                            }
                        });
                    }

                    if (assignedToIdx === -1) {
                        assignedToIdx = primStaff.length >= 2 ? 1 : 0;
                    }

                    if (assignedToIdx === saIdx) {
                        matchingBlocks.push({
                            sa: rSa,
                            name: rSa.name,
                            firstName,
                            day: dayCode,
                            start: bStart,
                            end: bEnd,
                            startTime: normalizeToHhMm(b.startTime, bStart),
                            endTime: normalizeToHhMm(b.endTime, bEnd),
                            startLabel: formatCompactTime(bStart),
                            endLabel: formatCompactTime(bEnd),
                            credited: b.credited || Math.round(((bEnd - bStart) / 60.0) * 10) / 10,
                        });
                    }
                }
            }

            return matchingBlocks;
        };

        return {
            loading, busy, loadError, semester, grid, progress, publication, isBatchLocked,
            deptFilter, statusFilter, q, selectedKey, filteredPosts, currentPost,
            DAYS, TIME_OPTIONS, HOUR_ROWS, PX_PER_HOUR, blockStyle,
            primaryStaff, staffForDay, relieverEntries, relieverBlocksForPartner,
            swapModal, editDutyModal, editDutyPreview,
            load, runMatching, acceptRoom, acceptAll,
            approveStaff, rejectStaff, openSwapModal, submitSwap,
            openEditDutyModal, addDutyBlockRow, removeDutyBlockRow,
            deleteActiveBlock, clearAllBlocks, unassignFromModal, swapFromModal, handleLaneDblClick,
            trimPartnerOverlapInModal, saveDutyHours, goFinalize, unlockBatch
        };
    },

    template: `
    <page-header title="Recommendations & Weekly Duty Grid" section="Scheduling" stack-actions
                 :subtitle="semester ? 'Review, adjust duty hours, and approve ITO, ACADS & OFFICE recommended schedules (' + semester.label + ').' : 'Review and approve recommended schedules.'">
        <template #actions>
            <div class="flex flex-wrap items-center gap-2">
                <a href="#/admin/scheduling/matching" class="btn btn-secondary btn-sm">
                    <app-icon name="LayoutGrid" :size="14" /> Room Assignment Board
                </a>
                <button v-if="!isBatchLocked" @click="runMatching('standard')" :disabled="busy" class="btn btn-secondary btn-sm">
                    <app-icon name="RotateCcw" :size="14" /> Restore Initial Match
                </button>
                <button v-if="!isBatchLocked" @click="runMatching('alternative')" :disabled="busy" class="btn btn-secondary btn-sm">
                    <app-icon name="Shuffle" :size="14" /> Explore Alternatives
                </button>
                <button v-if="grid && grid.posts && grid.posts.length && !isBatchLocked" @click="acceptAll" :disabled="busy"
                        class="btn btn-primary btn-sm">
                    <app-icon name="ShieldCheck" :size="15" /> Approve &amp; Lock Batch ({{ progress.decided }}/{{ progress.total }})
                </button>
                <template v-else-if="isBatchLocked">
                    <span class="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-caption font-bold text-emerald-900">
                        <app-icon name="Lock" :size="14" class="text-emerald-700" /> Batch Approved &amp; Locked
                    </span>
                    <button @click="unlockBatch" :disabled="busy"
                            class="btn btn-secondary btn-sm text-amber-900 border-amber-300 bg-amber-50 hover:bg-amber-100 flex items-center gap-1.5">
                        <app-icon name="Unlock" :size="14" /> Unlock Batch
                    </button>
                </template>
                <button @click="goFinalize" class="btn btn-secondary btn-sm">
                    <app-icon name="FileCheck2" :size="15" /> Finalize Schedule
                </button>
            </div>
        </template>
    </page-header>

    <div v-if="loading" class="space-y-4" aria-busy="true">
        <div class="h-24 animate-pulse rounded-xl bg-white"></div>
        <div class="h-96 animate-pulse rounded-xl bg-white"></div>
    </div>

    <div v-else-if="loadError" class="card flex flex-col items-center px-6 py-12 text-center">
        <app-icon name="CircleX" :size="28" class="text-danger" />
        <p class="mt-3 text-body font-medium text-ink">Could not load Recommendations</p>
        <p class="mt-1 text-caption text-muted">{{ loadError }}</p>
        <button @click="load" class="btn btn-secondary btn-sm mt-4"><app-icon name="RefreshCw" :size="14" /> Try again</button>
    </div>

    <!-- Empty state if matching hasn't been run -->
    <div v-else-if="!grid || !grid.posts || !grid.posts.length" class="card flex flex-col items-center px-6 py-14 text-center">
        <div class="flex h-12 w-12 items-center justify-center rounded-full bg-navy/10 text-navy">
            <app-icon name="CalendarClock" :size="24" />
        </div>
        <h3 class="mt-3 text-card-title text-navy">No Recommendations Yet</h3>
        <p class="mt-1 max-w-md text-body text-muted">
            Run Schedule Matching to generate complementary partner schedules for ITO &amp; ACADS rooms and automatic duty schedules for OFFICE S.A.s.
        </p>
        <div class="mt-5 flex items-center gap-2">
            <button @click="runMatching('standard')" :disabled="busy" class="btn btn-primary">
                <app-icon name="Sparkles" :size="16" /> Run Initial Matching
            </button>
            <a href="#/admin/scheduling/matching" class="btn btn-secondary">Go to Schedule Matching</a>
        </div>
    </div>

    <template v-else>
        <!-- Summary Bar -->
        <section class="card mb-4 p-4">
            <div class="flex flex-wrap items-center justify-between gap-4">
                <div class="flex flex-wrap items-center gap-4 text-caption">
                    <div>
                        <span class="text-muted">Posts Approved:</span>
                        <strong class="ml-1 text-navy">{{ progress.decided }} / {{ progress.total }}</strong>
                    </div>
                    <div>
                        <span class="text-muted">S.A. Slots Approved:</span>
                        <strong class="ml-1 text-success">{{ progress.slotsAccepted || 0 }} / {{ progress.slotsTotal || 0 }}</strong>
                    </div>
                    <div>
                        <span class="text-muted">Office S.A.s Recommended:</span>
                        <strong class="ml-1 text-emerald-800">{{ progress.officeSlotsTotal || 0 }} ({{ progress.officePostsTotal || 0 }} offices)</strong>
                    </div>
                    <div>
                        <span class="text-muted">Posts with Partner Overlap:</span>
                        <strong class="ml-1 text-violet-800">{{ progress.overlaps || 0 }}</strong>
                    </div>
                    <div>
                        <span class="text-muted">Weekly Credited Target:</span>
                        <strong class="ml-1 text-navy">{{ grid.minWeekly }} – {{ grid.maxWeekly }} hrs/wk</strong>
                    </div>
                </div>
                <div class="flex flex-wrap items-center gap-3 text-[12px]">
                    <span class="inline-flex items-center gap-1.5">
                        <span class="h-3 w-3 rounded bg-amber-200 border border-amber-500"></span> Proposed Duty (Click to Edit)
                    </span>
                    <span class="inline-flex items-center gap-1.5">
                        <span class="h-3 w-3 rounded bg-teal-200 border border-teal-600"></span> Reliever Duty
                    </span>
                    <span class="inline-flex items-center gap-1.5">
                        <span class="h-3 w-3 rounded bg-violet-200 border border-violet-600"></span> Partner Duty Overlap
                    </span>
                    <span class="inline-flex items-center gap-1.5">
                        <span class="h-3 w-3 rounded bg-sky-200 border border-sky-500"></span> Official Registrar Class
                    </span>
                    <span class="inline-flex items-center gap-1.5">
                        <span class="h-3 w-3 rounded bg-emerald-100 border border-emerald-500"></span> Allowed Duty Window
                    </span>
                </div>
            </div>
        </section>

        <div class="space-y-4">
            <!-- Top Horizontal Bar: Search, Filters & Horizontal Room/Lab/Office Cards -->
            <section class="card p-4 space-y-3">
                <div class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                    <div class="flex flex-wrap items-center gap-2">
                        <div class="w-full sm:w-64">
                            <input v-model="q" type="search" placeholder="Search room, office, or S.A...." class="input input-sm w-full" />
                        </div>
                        <div class="flex flex-wrap items-center gap-1">
                            <button v-for="d in ['ALL', 'ITO', 'ACADS', 'OFFICE', 'RELIEVER']" :key="d"
                                    @click="deptFilter = d"
                                    class="rounded px-2.5 py-1 text-[11px] font-bold transition"
                                    :class="deptFilter === d ? 'bg-navy text-white' : 'bg-page text-muted hover:text-ink'">
                                {{ d }}
                            </button>
                        </div>
                        <span class="hidden sm:inline text-line">|</span>
                        <div class="flex flex-wrap items-center gap-1">
                            <button v-for="st in ['ALL', 'PENDING', 'ACCEPTED', 'OVERLAPS', 'GAPS']" :key="st"
                                    @click="statusFilter = st"
                                    class="rounded px-2.5 py-1 text-[11px] font-semibold transition"
                                    :class="statusFilter === st ? 'bg-navy/15 text-navy' : 'bg-page text-muted hover:text-ink'">
                                {{ st }}
                            </button>
                        </div>
                    </div>
                    <div class="text-caption text-muted">
                        Showing <strong class="text-navy">{{ filteredPosts.length }}</strong> post(s) — select a card below
                    </div>
                </div>

                <!-- Horizontal Room/Lab/Office Cards Row -->
                <div class="flex items-stretch gap-3 overflow-x-auto pb-2 pt-0.5 snap-x">
                    <button v-for="post in filteredPosts" :key="post.key"
                            :data-post-key="post.key"
                            :data-post-room="post.room"
                            @click="selectedKey = post.key"
                            class="w-[285px] sm:w-[300px] shrink-0 snap-start text-left rounded-xl border p-3.5 transition flex flex-col justify-between"
                            :class="currentPost && currentPost.key === post.key
                                ? 'border-navy bg-navy/5 shadow-sm ring-1 ring-navy/20'
                                : 'border-line bg-white hover:border-navy/40'">
                        <div>
                            <div class="flex items-center justify-between gap-2">
                                <div class="flex flex-wrap items-center gap-1.5">
                                    <span class="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
                                          :class="post.isRelieverPost
                                              ? 'bg-teal-100 text-teal-900 border border-teal-300'
                                              : (post.department === 'ITO'
                                                  ? 'bg-sky-100 text-sky-900'
                                                  : (post.department === 'OFFICE' ? 'bg-emerald-100 text-emerald-900' : 'bg-indigo-100 text-indigo-900'))">
                                        {{ post.isRelieverPost ? 'ITO RELIEVER' : post.department }}
                                    </span>
                                    <span class="font-bold text-navy text-[14px]">{{ post.room }}</span>
                                    <span v-if="post.overlapHours > 0"
                                          class="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-900">
                                        Overlap {{ post.overlapHours }}h
                                    </span>
                                    <span v-if="relieverEntries(post).length > 0"
                                          class="rounded bg-teal-100 px-1.5 py-0.5 text-[10px] font-bold text-teal-900">
                                        Reliever ({{ relieverEntries(post).length }})
                                    </span>
                                </div>
                                <span class="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase shrink-0"
                                      :class="post.accepted
                                          ? 'bg-success/10 text-success'
                                          : (post.missingSaCount > 0 ? 'bg-danger/10 text-danger' : 'bg-amber-100 text-amber-900')">
                                    {{ post.accepted ? 'Approved' : (post.missingSaCount > 0 ? 'Needs Review' : 'Pending') }}
                                </span>
                            </div>
                            <div class="mt-1.5 text-[12px] text-muted flex items-center justify-between">
                                <span>S.A.s: <strong>{{ post.assignedCount }} / {{ post.requiredSa }}</strong></span>
                                <span>{{ post.acceptedSlots }}/{{ post.totalSlots }} slot(s) approved</span>
                            </div>
                        </div>

                        <div class="mt-2 space-y-1">
                            <div v-for="s in primaryStaff(post)" :key="s.slotId"
                                 class="flex items-center justify-between text-[11px] rounded px-2 py-1 bg-page">
                                <span class="font-medium truncate">{{ s.slotNo }}. {{ s.name }}</span>
                                <span class="font-semibold text-navy shrink-0 ml-1">{{ s.creditedHours }}h</span>
                            </div>
                            <div v-if="post.missingSaCount > 0"
                                 class="text-[11px] font-semibold text-danger bg-danger/5 rounded px-2 py-1">
                                Missing {{ post.missingSaCount }} S.A. — Coordinator Review
                            </div>
                        </div>
                    </button>
                </div>
            </section>

            <!-- Selected Room/Office Detail & Weekly Duty Grid (Full Width) -->
            <div id="duty-grid-details" class="space-y-4" v-if="currentPost">
                <!-- Post Header & Staff Cards -->
                <section class="card p-5">
                    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-line pb-4">
                        <div>
                            <div class="flex flex-wrap items-center gap-2">
                                <span class="rounded px-2 py-0.5 text-[11px] font-bold uppercase"
                                      :class="currentPost.isRelieverPost
                                          ? 'bg-teal-100 text-teal-900 border border-teal-300'
                                          : (currentPost.department === 'ITO'
                                              ? 'bg-sky-100 text-sky-900'
                                              : (currentPost.department === 'OFFICE' ? 'bg-emerald-100 text-emerald-900' : 'bg-indigo-100 text-indigo-900'))">
                                    {{ currentPost.isRelieverPost ? 'ITO FLOATING RELIEVER' : currentPost.department }}
                                </span>
                                <h2 class="text-[18px] font-bold text-navy">{{ currentPost.room }}</h2>
                                <span class="text-caption text-muted">({{ currentPost.building }})</span>
                                <span v-if="currentPost.overlapHours > 0"
                                      class="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2.5 py-0.5 text-[11px] font-semibold text-violet-900">
                                    <app-icon name="Layers" :size="12" />
                                    Partner Duty Overlap: {{ currentPost.overlapHours }} hrs/wk
                                </span>
                                <span v-if="relieverEntries(currentPost).length > 0"
                                      class="inline-flex items-center gap-1 rounded-full bg-teal-100 px-2.5 py-0.5 text-[11px] font-semibold text-teal-900">
                                    <app-icon name="Repeat" :size="12" /> {{ relieverEntries(currentPost).length }} Reliever Schedule(s)
                                </span>
                            </div>
                            <p class="mt-1 text-caption text-muted">
                                Required S.A.: <strong>{{ currentPost.requiredSa }}</strong> ·
                                Assigned: <strong>{{ currentPost.assignedCount }} / {{ currentPost.requiredSa }}</strong> ·
                                Status: <strong :class="currentPost.accepted ? 'text-success' : 'text-amber-700'">
                                    {{ currentPost.accepted ? 'Approved for Finalization' : 'Pending Coordinator Approval' }}
                                </strong>
                            </p>
                        </div>
                        <div class="flex flex-wrap items-center gap-2">
                            <button v-if="currentPost.missingSaCount > 0 && currentPost.alternates?.length"
                                    @click="openSwapModal(currentPost, null)"
                                    class="btn btn-secondary btn-sm">
                                <app-icon name="UserPlus" :size="14" /> Assign Replacement S.A.
                            </button>
                            <button @click="acceptRoom(currentPost.room)"
                                    :disabled="busy || currentPost.staff.length === 0"
                                    class="btn btn-primary btn-sm">
                                <app-icon name="Check" :size="15" />
                                {{ currentPost.accepted ? ('Re-sync Approved ' + (currentPost.department === 'OFFICE' ? 'Office' : 'Room')) : ('Approve ' + (currentPost.department === 'OFFICE' ? 'Office' : 'Room') + ' Post') }}
                            </button>
                        </div>
                    </div>

                    <!-- Floating ITO Reliever Assigned Laboratory Coverage Banner -->
                    <div v-if="currentPost.isRelieverPost"
                         class="mt-4 rounded-xl border border-teal-300 bg-teal-50/70 p-4">
                        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-teal-200/80 pb-2 mb-2.5">
                            <div class="font-bold text-[13px] tracking-wide text-navy uppercase flex items-center gap-1.5">
                                <app-icon name="Repeat" :size="15" class="text-teal-700" />
                                <span>Assigned Laboratory Coverage (Multi-Lab Floating Coverage):</span>
                            </div>
                            <span class="text-caption text-teal-950 font-medium">
                                Assigned to cover {{ (currentPost.coveredRooms || []).length }} computer lab(s) during Primary S.A. class windows
                            </span>
                        </div>
                        <div class="flex flex-wrap items-center gap-2">
                            <span v-for="rm in (currentPost.coveredRooms || [])" :key="rm"
                                  class="inline-flex items-center gap-1.5 rounded-lg border border-teal-300 bg-white px-3 py-1 text-[12px] font-bold text-teal-950 shadow-2xs">
                                <app-icon name="DoorOpen" :size="13" class="text-teal-700" />
                                Room {{ rm }}
                            </span>
                        </div>
                    </div>

                    <!-- ITO RELIEVER List at the Top (SA TAAS — Not placed inside the Weekly Schedule Grid) -->
                    <div v-if="!currentPost.isRelieverPost && currentPost.department === 'ITO' && relieverEntries(currentPost).length > 0"
                         class="mt-4 rounded-xl border border-teal-300 bg-teal-50/70 p-4">
                        <div class="flex flex-wrap items-center justify-between gap-2 border-b border-teal-200/80 pb-2 mb-2.5">
                            <div class="font-bold text-[14px] tracking-wide text-navy uppercase flex items-center gap-1.5">
                                <app-icon name="Repeat" :size="15" class="text-teal-700" />
                                <span>RELIEVER:</span>
                            </div>
                        </div>
                        <div class="space-y-2">
                            <div v-for="item in relieverEntries(currentPost)" :key="item.key"
                                 class="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-white border border-teal-200 p-3 shadow-2xs">
                                <div class="flex flex-col gap-1.5">
                                    <div class="flex flex-wrap items-center gap-2">
                                        <span class="font-bold text-[14px] text-navy">
                                            {{ item.name }}
                                        </span>
                                        <span class="rounded bg-teal-100 px-2 py-0.5 text-[11px] font-semibold text-teal-900">
                                            {{ item.originLabel }} · {{ item.creditedHours }}h total
                                        </span>
                                    </div>
                                    <div class="flex flex-wrap items-center gap-1.5">
                                        <span v-for="(blk, bIdx) in item.blocks" :key="bIdx"
                                              class="inline-flex items-center gap-1 rounded border border-teal-300 bg-teal-50/80 px-2 py-0.5 font-mono text-[11px] font-semibold text-teal-950">
                                            <strong class="text-teal-900">{{ blk.day }}</strong>
                                            <span>{{ blk.startText }}–{{ blk.endText }}</span>
                                            <span class="text-[10px] text-muted">({{ blk.credited }}h)</span>
                                        </span>
                                    </div>
                                </div>
                                <div class="flex items-center gap-1.5 shrink-0">
                                    <span class="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase"
                                          :class="item.sa.approved ? 'bg-success/15 text-success' : 'bg-amber-100 text-amber-900'">
                                        {{ item.sa.approved ? 'Approved' : 'Pending' }}
                                    </span>
                                    <button v-if="!item.sa.approved"
                                            @click="approveStaff(currentPost.room, item.sa)"
                                            :disabled="busy"
                                            class="rounded border border-teal-600 bg-teal-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-teal-700 transition">
                                        Approve
                                    </button>
                                    <button @click="openEditDutyModal(currentPost, item.sa)"
                                            :disabled="busy"
                                            class="rounded border border-line bg-white px-2.5 py-1 text-[11px] font-semibold text-navy hover:border-navy transition">
                                        Edit Time
                                    </button>
                                    <button @click="rejectStaff(currentPost.room, item.sa)"
                                            :disabled="busy"
                                            class="rounded border border-danger/30 bg-white px-2.5 py-1 text-[11px] font-semibold text-danger hover:bg-danger/5 transition">
                                        Unassign
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Conflict / Missing SA Alert -->
                    <div v-if="currentPost.missingSaCount > 0 || (currentPost.conflictReasons && currentPost.conflictReasons.length)"
                         class="mt-4 rounded-lg border border-danger/30 bg-danger/5 p-3.5 text-caption text-danger">
                        <div class="font-bold flex items-center gap-1.5">
                            <app-icon name="TriangleAlert" :size="15" />
                            Coordinator Review Required ({{ currentPost.assignedCount }} of {{ currentPost.requiredSa }} S.A. assigned)
                        </div>
                        <ul class="mt-1 list-disc pl-5 space-y-0.5">
                            <li v-for="(reason, ri) in currentPost.conflictReasons" :key="ri">{{ reason }}</li>
                        </ul>
                    </div>

                    <!-- Overlapping Partner Duty Hours Card -->
                    <div v-if="currentPost.overlaps && currentPost.overlaps.length > 0"
                         class="mt-4 rounded-xl border border-violet-300 bg-violet-50/75 p-3.5">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                            <div class="flex items-center gap-2 text-caption font-bold text-violet-950">
                                <app-icon name="Layers" :size="16" class="text-violet-700" />
                                <span>Overlapping Partner Duty Hours ({{ currentPost.overlapHours }} hrs/wk total)</span>
                            </div>
                            <div class="flex flex-wrap items-center gap-1.5">
                                <button v-for="p in primaryStaff(currentPost)" :key="'adj-' + p.slotId"
                                        @click="openEditDutyModal(currentPost, p)"
                                        class="rounded border border-violet-400 bg-white px-2 py-0.5 text-[11px] font-semibold text-violet-900 hover:bg-violet-100 transition">
                                    Adjust {{ p.name.split(' ')[0] }}'s Hours
                                </button>
                            </div>
                        </div>
                        <div class="mt-2.5 flex flex-wrap gap-1.5">
                            <span v-for="(ov, oIdx) in currentPost.overlaps" :key="'ov-' + oIdx"
                                  class="inline-flex items-center gap-1.5 rounded-lg border border-violet-300 bg-white px-2.5 py-1 text-[11px] text-violet-950 shadow-2xs">
                                <strong class="text-violet-900">{{ ov.day }}</strong>
                                <span>{{ ov.startLabel }} – {{ ov.endLabel }}</span>
                                <span class="rounded bg-violet-100 px-1.5 py-0.2 text-[10px] font-bold text-violet-800">{{ ov.hours }}h</span>
                                <span class="text-[10px] text-muted">({{ ov.partner1.split(' ')[0] }} &amp; {{ ov.partner2.split(' ')[0] }})</span>
                            </span>
                        </div>
                    </div>

                    <!-- Primary Partner & Office S.A. Cards -->
                    <div class="mt-4 grid gap-4 md:grid-cols-2">
                        <div v-for="sa in primaryStaff(currentPost)" :key="sa.slotId"
                             class="rounded-xl border p-4 flex flex-col justify-between"
                             :class="sa.approved ? 'border-success/40 bg-success/5' : 'border-line bg-page/50'">
                            <div>
                                <div class="flex items-start justify-between gap-2">
                                    <div>
                                        <span v-if="currentPost.isRelieverPost"
                                              class="inline-flex items-center gap-1 rounded bg-teal-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-teal-950">
                                            Floating ITO Reliever
                                        </span>
                                        <span v-else-if="currentPost.department === 'OFFICE'"
                                              class="inline-flex items-center gap-1 rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider text-emerald-950">
                                            Office S.A. {{ sa.slotNo }} of {{ currentPost.requiredSa }}
                                        </span>
                                        <span v-else class="text-[11px] font-bold uppercase tracking-wider text-muted">
                                            Partner {{ sa.slotNo }} of {{ currentPost.requiredSa }}
                                        </span>
                                        <h3 class="text-[15px] font-bold text-navy mt-1">
                                            {{ sa.name }}
                                            <span class="text-caption font-normal text-muted">({{ sa.studentId }})</span>
                                        </h3>
                                        <p class="text-caption text-muted">
                                            {{ sa.course }} · Year {{ sa.yearLevel }} · Category: <strong>{{ sa.category }}</strong>
                                        </p>
                                    </div>
                                    <span class="rounded-full px-2.5 py-0.5 text-[11px] font-bold uppercase shrink-0"
                                          :class="sa.approved ? 'bg-success/15 text-success' : 'bg-amber-100 text-amber-900'">
                                        {{ sa.approved ? 'Approved' : 'Pending' }}
                                    </span>
                                </div>

                                <div class="mt-3 rounded-lg bg-white p-2.5 border border-line text-caption">
                                    <span class="text-muted">Credited Weekly Duty:</span>
                                    <strong class="ml-1 text-navy">{{ sa.creditedHours }} hrs/wk</strong>
                                </div>
                            </div>

                            <div class="mt-3 pt-2.5 border-t border-line/60 flex flex-wrap items-center gap-1.5">
                                <button v-if="!sa.approved"
                                        @click="approveStaff(currentPost.room, sa)"
                                        :disabled="busy"
                                        class="rounded border border-teal-600 bg-teal-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-teal-700 transition flex items-center gap-1">
                                    <app-icon name="Check" :size="12" /> Approve
                                </button>
                                <button @click="openEditDutyModal(currentPost, sa)"
                                        :disabled="busy"
                                        class="rounded border border-line bg-white px-2.5 py-1 text-[11px] font-semibold text-navy hover:border-navy transition flex items-center gap-1">
                                    <app-icon name="Clock" :size="12" /> Edit Hours
                                </button>
                                <button @click="openSwapModal(currentPost, sa)"
                                        :disabled="busy"
                                        class="rounded border border-sky-300 bg-sky-50 px-2.5 py-1 text-[11px] font-semibold text-sky-900 hover:bg-sky-100 transition flex items-center gap-1">
                                    <app-icon name="UserCheck" :size="12" /> Change S.A.
                                </button>
                                <button @click="rejectStaff(currentPost.room, sa)"
                                        :disabled="busy"
                                        class="rounded border border-danger/30 bg-white px-2.5 py-1 text-[11px] font-semibold text-danger hover:bg-danger/5 transition flex items-center gap-1">
                                    <app-icon name="Trash2" :size="12" /> Unassign / Delete
                                </button>
                            </div>
                        </div>
                    </div>
                </section>

                <!-- Weekly Duty Grid (7:00 AM - 10:00 PM, Mon - Sat) -->
                <section class="card p-5 overflow-x-auto">
                    <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                        <h3 class="text-card-title text-navy flex items-center gap-2">
                            <app-icon name="CalendarRange" :size="18" />
                            Weekly Schedule Grid (7:00 AM – 10:00 PM)
                        </h3>
                        <span class="text-caption text-muted">Click any duty block to adjust hours.</span>
                    </div>

                    <div class="min-w-[920px]">
                        <!-- Grid Header -->
                        <div class="grid grid-cols-7 border-b border-line bg-page text-caption font-bold text-navy">
                            <div class="p-2.5 border-r border-line">Time</div>
                            <div v-for="day in DAYS" :key="day.code" class="p-2 border-r border-line text-center">
                                <div>
                                    {{ day.label }}
                                    <span v-if="currentPost.department === 'OFFICE' && day.code === 'SAT'"
                                          class="ml-1 rounded bg-emerald-100 px-1 py-0.2 text-[9px] font-bold text-emerald-900">
                                        Half-Day
                                    </span>
                                </div>
                                <div v-if="primaryStaff(currentPost).length > 1"
                                     class="mt-1 grid grid-cols-2 text-[10px] font-semibold text-muted border-t border-line pt-1">
                                    <span v-for="(st, idx) in primaryStaff(currentPost)" :key="st.slotId"
                                          class="truncate px-1"
                                          :class="idx > 0 ? 'border-l border-line' : ''">
                                        SA{{ st.slotNo }}: {{ st.name.split(' ')[0] }}
                                    </span>
                                </div>
                            </div>
                        </div>

                        <!-- Grid Body (7:00 AM to 10:00 PM = 720px) -->
                        <div class="grid grid-cols-7 relative" :style="{ height: (HOUR_ROWS.length * PX_PER_HOUR) + 'px' }">
                            <!-- Time Column -->
                            <div class="border-r border-line bg-page/40">
                                <div v-for="row in HOUR_ROWS" :key="row.start"
                                     class="border-b border-line/70 px-2 py-1 text-[11px] font-medium text-muted"
                                     :style="{ height: PX_PER_HOUR + 'px' }">
                                    {{ row.label }}
                                </div>
                            </div>

                            <!-- Day Columns (Mon - Sat) -->
                            <div v-for="day in DAYS" :key="day.code"
                                 class="relative border-r border-line bg-white">
                                <!-- Hourly horizontal guide lines -->
                                <div v-for="row in HOUR_ROWS" :key="row.start"
                                     class="border-b border-line/50"
                                     :style="{ height: PX_PER_HOUR + 'px' }"></div>

                                <!-- Allowed Room/Office Open Envelope (Subtle Green Background) -->
                                <div v-for="(openSpan, oi) in (currentPost.open[day.code] || [])" :key="'open-' + oi"
                                     class="absolute left-0 right-0 bg-emerald-50/60 border-y border-emerald-300/60 pointer-events-none"
                                     :style="blockStyle(openSpan.start, openSpan.end)">
                                </div>

                                <!-- Partner Overlap Highlight Band across the Day Column -->
                                <div v-for="(ov, ovi) in (currentPost.overlaps || []).filter(o => o.day === day.code)" :key="'ovband-' + ovi"
                                     class="absolute left-0 right-0 bg-violet-200/35 border-y border-dashed border-violet-500 pointer-events-none z-[1]"
                                     :style="blockStyle(ov.start, ov.end)">
                                </div>

                                <!-- Primary Partner / Office S.A. Lanes inside Day Column (Relievers excluded from Grid) -->
                                <div class="absolute inset-0 grid z-[2]"
                                     :class="primaryStaff(currentPost).length >= 2 ? 'grid-cols-2' : 'grid-cols-1'">
                                    <div v-for="(sa, sIdx) in primaryStaff(currentPost)" :key="sa.slotId"
                                         class="relative h-full"
                                         :class="sIdx > 0 ? 'border-l border-dashed border-line' : ''"
                                         @dblclick="handleLaneDblClick($event, currentPost, sa, day.code)"
                                         title="Double-click empty area to add a new duty block here">
                                        <!-- Official Registrar Class Blocks (Blue) -->
                                        <div v-for="(cls, ci) in (sa.classes || []).filter(c => c.day === day.code)" :key="'cls-' + ci"
                                             class="absolute left-1 right-1 rounded border border-sky-500 bg-sky-100/95 px-1.5 py-0.5 text-[10px] leading-tight text-sky-950 overflow-hidden shadow-xs"
                                             :style="blockStyle(cls.start, cls.end)"
                                             :title="sa.name + ' — CLASS: ' + cls.subject + ' (' + cls.startLabel + ' - ' + cls.endLabel + ')'">
                                            <div class="font-bold truncate">CLASS: {{ cls.subject }}</div>
                                            <div class="truncate">{{ cls.startLabel }}–{{ cls.endLabel }}</div>
                                        </div>

                                        <!-- Proposed Duty Blocks (Clickable to Edit; Teal for Reliever post, Amber for Primary/Office, Violet border if Overlap) -->
                                        <div v-for="(d, di) in (sa.duty || []).filter(b => b.day === day.code)" :key="'duty-' + di"
                                             @click="openEditDutyModal(currentPost, sa, d)"
                                             class="absolute left-1 right-1 rounded border px-1.5 py-0.5 text-[10px] leading-tight overflow-hidden shadow-xs cursor-pointer transition hover:ring-2 hover:ring-navy/40"
                                             :class="currentPost.isRelieverPost
                                                 ? 'border-teal-600 bg-teal-100/95 text-teal-950 ring-1 ring-teal-400'
                                                 : (d.hasOverlap
                                                     ? 'border-violet-600 bg-amber-100/95 text-amber-950 ring-1 ring-violet-400'
                                                     : 'border-amber-500 bg-amber-100/95 text-amber-950')"
                                             :style="blockStyle(d.start, d.end)"
                                             :title="sa.name + ' — ' + (d.room ? ('COVERING LAB ' + d.room + ': ') : 'DUTY: ') + d.startLabel + ' - ' + d.endLabel + ' (' + d.credited + 'h credited)' + (d.isExtended ? ' • Adjusted 7AM/6PM to fill required hours' : '') + (d.hasOverlap ? ' • Partner Overlap: ' + d.overlapHours + 'h' : '') + ' • Click to edit or delete'">
                                            <div class="font-bold truncate flex items-center justify-between gap-1">
                                                <span class="truncate">{{ d.room ? ('[' + d.room + '] ') : '' }}{{ sa.name.split(' ')[0] }} ({{ d.credited }}h)</span>
                                                <span v-if="currentPost.isRelieverPost && d.room" class="rounded bg-teal-700 px-1 text-[8px] font-bold text-white shrink-0">
                                                    {{ d.room }}
                                                </span>
                                                <span v-else-if="d.hasOverlap" class="rounded bg-violet-600 px-1 text-[8px] font-bold text-white shrink-0">
                                                    OVL {{ d.overlapHours }}h
                                                </span>
                                                <span v-else-if="d.isExtended" class="rounded bg-emerald-700 px-1 text-[8px] font-bold text-white shrink-0" title="Adjusted earlier/later to fill required duty hours">
                                                    +EXT
                                                </span>
                                            </div>
                                            <div class="truncate">{{ d.startLabel }}–{{ d.endLabel }}</div>
                                            <div v-if="currentPost.isRelieverPost && d.room" class="text-[9px] font-semibold text-teal-900 truncate">
                                                Covering Lab {{ d.room }}
                                            </div>
                                            <div v-else-if="d.hasOverlap && d.overlapWindows && d.overlapWindows.length" class="text-[9px] font-semibold text-violet-900 truncate">
                                                Overlap: {{ d.overlapWindows[0].startLabel }}–{{ d.overlapWindows[0].endLabel }}
                                            </div>
                                            <div v-else-if="d.hasBreak" class="text-[9px] font-semibold text-amber-800 truncate">
                                                {{ currentPost.department === 'OFFICE' ? 'Auto lunch 12–1 (-1h)' : '-1h lunch break' }}
                                            </div>
                                            <div v-else-if="currentPost.department === 'OFFICE' && day.code === 'SAT'" class="text-[9px] font-semibold text-emerald-800 truncate">
                                                Sat half-day (0h deduct)
                                            </div>
                                        </div>

                                        <!-- Reliever Duty Blocks (Teal/Blue, plotted directly on the Grid as in NCST Schedule Sheet) -->
                                        <div v-for="(rb, rbi) in relieverBlocksForPartner(currentPost, sa, day.code)" :key="'relb-' + rbi"
                                             @click="openEditDutyModal(currentPost, rb.sa, rb)"
                                             class="absolute left-1 right-1 rounded border border-teal-600 bg-teal-100/95 text-teal-950 px-1.5 py-0.5 text-[10px] leading-tight overflow-hidden shadow-xs cursor-pointer transition hover:ring-2 hover:ring-teal-700 z-[3]"
                                             :style="blockStyle(rb.start, rb.end)"
                                             :title="'RELIEVER: ' + rb.name + ' (' + rb.credited + 'h) · ' + rb.startLabel + '–' + rb.endLabel + ' · Click to edit or delete'">
                                            <div class="font-bold truncate text-teal-900 flex items-center justify-between gap-1">
                                                <span class="truncate">RELIEVER: {{ rb.firstName }}</span>
                                                <span class="rounded bg-teal-700 px-1 text-[8px] font-bold text-white shrink-0">{{ rb.credited }}h</span>
                                            </div>
                                            <div class="truncate text-teal-950 font-medium">{{ rb.startLabel }}–{{ rb.endLabel }}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        </div>

        <!-- Edit / Adjust S.A. Duty Hours Modal -->
        <app-modal :open="editDutyModal.open"
                   :title="'Edit / Adjust Duty Hours — ' + editDutyModal.saName + ' (' + editDutyModal.room + ')'"
                   @close="editDutyModal.open = false">
            <div class="space-y-4">
                <div class="rounded-lg border border-line bg-page/60 p-3 text-caption">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <div>
                            <strong class="text-navy">{{ editDutyModal.saName }}</strong>
                            <span class="text-muted ml-1">({{ editDutyModal.studentId }})</span>
                            <span class="ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
                                  :class="editDutyModal.isReliever
                                      ? 'bg-teal-100 text-teal-900'
                                      : (editDutyModal.department === 'OFFICE' ? 'bg-emerald-100 text-emerald-900' : 'bg-sky-100 text-sky-900')">
                                {{ editDutyModal.isReliever ? ('ITO Reliever from ' + editDutyModal.donorRoom) : (editDutyModal.department + ' S.A.') }}
                            </span>
                        </div>
                        <div class="text-right">
                            <span class="text-muted">Live Credited Preview:</span>
                            <strong class="ml-1"
                                    :class="(editDutyPreview.belowMinimum || editDutyPreview.overMaximum) ? 'text-warning' : 'text-navy'">
                                {{ editDutyPreview.creditedHours }} hrs/wk
                            </strong>
                            <span class="text-[11px] text-muted ml-1">({{ editDutyPreview.rawHours }} raw hrs · Target {{ grid.minWeekly }}–{{ grid.maxWeekly }}h)</span>
                        </div>
                    </div>

                    <div v-if="editDutyModal.department === 'OFFICE'" class="mt-2 rounded bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 text-[11px] text-emerald-950">
                        <strong>Office Rules:</strong> Standard window is <strong>8:00 AM – 5:00 PM</strong> Mon–Fri (with automatic <strong>12:00 PM – 1:00 PM</strong> lunch break, -1h deduction) &amp; Sat half-day (<strong>8:00 AM – 12:00 PM</strong>, 0h deduction). Duty can be adjusted earlier to <strong>7:00 AM</strong> or later to <strong>6:00 PM</strong> to fill required duty hours.
                    </div>

                    <!-- Official Registrar Class Schedule Reference (Read-Only) -->
                    <div class="mt-2.5 pt-2 border-t border-line">
                        <div class="text-[11px] font-bold uppercase tracking-wider text-sky-900 mb-1">
                            Locked Official Registrar Class Schedule (Cannot Overlap):
                        </div>
                        <div v-if="editDutyModal.classes && editDutyModal.classes.length" class="flex flex-wrap gap-1.5">
                            <span v-for="(c, ci) in editDutyModal.classes" :key="'mcls-' + ci"
                                  class="inline-flex items-center gap-1 rounded border border-sky-300 bg-sky-50 px-2 py-0.5 text-[11px] text-sky-950">
                                <strong>{{ c.day }}</strong>
                                <span>{{ c.startLabel }}–{{ c.endLabel }}</span>
                                <span class="text-[10px] text-sky-800">({{ c.subject }})</span>
                            </span>
                        </div>
                        <div v-else class="text-[11px] text-muted">No class blocks recorded for this S.A.</div>
                    </div>
                </div>

                <!-- Validation Error / Conflict Alert -->
                <div v-if="editDutyModal.error || editDutyPreview.warnings.length"
                     class="rounded-lg border border-danger/40 bg-danger/5 p-3 text-caption text-danger">
                    <div class="font-bold flex items-center gap-1.5">
                        <app-icon name="TriangleAlert" :size="14" />
                        Schedule Validation Notice
                    </div>
                    <p v-if="editDutyModal.error" class="mt-1">{{ editDutyModal.error }}</p>
                    <ul v-if="editDutyPreview.warnings.length" class="mt-1 list-disc pl-5 space-y-0.5">
                        <li v-for="(w, wi) in editDutyPreview.warnings" :key="wi">{{ w }}</li>
                    </ul>
                </div>

                <!-- Selected / Clicked Duty Block Quick Action -->
                <div v-if="editDutyModal.activeBlock"
                     class="rounded-xl border border-navy/30 bg-navy/5 p-3 flex flex-wrap items-center justify-between gap-2.5">
                    <div class="flex items-center gap-2">
                        <app-icon name="Clock" :size="16" class="text-navy shrink-0" />
                        <div>
                            <span class="text-[10px] font-bold uppercase tracking-wider text-muted">Selected Duty Block</span>
                            <div class="text-[13px] font-bold text-navy">
                                {{ editDutyModal.activeBlock.day }} · {{ editDutyModal.activeBlock.startTime }} – {{ editDutyModal.activeBlock.endTime }}
                            </div>
                        </div>
                    </div>
                    <button type="button"
                            @click="deleteActiveBlock"
                            class="rounded border border-danger/40 bg-white px-2.5 py-1 text-[11px] font-bold text-danger hover:bg-danger/10 transition flex items-center gap-1 shadow-2xs">
                        <app-icon name="Trash2" :size="13" /> Delete This Block
                    </button>
                </div>

                <!-- Editable Duty Blocks List -->
                <div class="space-y-2 max-h-72 overflow-y-auto pr-1">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                        <span class="text-caption font-bold text-navy">Duty Blocks ({{ editDutyModal.blocks.length }})</span>
                        <div class="flex flex-wrap items-center gap-1.5">
                            <button v-if="editDutyModal.department !== 'OFFICE' && !editDutyModal.isReliever && editDutyModal.otherPartners.length"
                                    type="button"
                                    @click="trimPartnerOverlapInModal"
                                    class="btn btn-secondary btn-xs text-violet-900">
                                <app-icon name="Scissors" :size="12" /> Auto-Trim Partner Overlaps
                            </button>
                            <button type="button" @click="addDutyBlockRow" class="btn btn-secondary btn-xs">
                                <app-icon name="Plus" :size="12" /> Add Duty Block
                            </button>
                            <button v-if="editDutyModal.blocks.length > 0"
                                    type="button"
                                    @click="clearAllBlocks"
                                    class="btn btn-secondary btn-xs text-danger hover:bg-danger/10">
                                <app-icon name="Trash2" :size="12" /> Clear All Blocks
                            </button>
                        </div>
                    </div>

                    <div v-for="(blk, bIdx) in editDutyModal.blocks" :key="'eblk-' + bIdx"
                         class="rounded-lg border p-2.5 transition"
                         :class="editDutyPreview.rowDetails[bIdx]?.conflict
                             ? 'border-danger bg-danger/5'
                             : (editDutyModal.activeBlockIdx === bIdx
                                 ? 'border-navy bg-navy/5 ring-1 ring-navy/30'
                                 : (editDutyPreview.rowDetails[bIdx]?.partnerOverlapHrs > 0
                                     ? 'border-violet-300 bg-violet-50/40'
                                     : 'border-line bg-white'))">
                        <div class="grid grid-cols-12 items-center gap-2">
                            <div class="col-span-3">
                                <label class="block text-[10px] font-semibold uppercase text-muted">Day</label>
                                <select v-model="blk.day" class="input input-sm w-full">
                                    <option v-for="d in DAYS" :key="d.code" :value="d.code">{{ d.label }}</option>
                                </select>
                            </div>
                            <div class="col-span-4">
                                <label class="block text-[10px] font-semibold uppercase text-muted">Start Time</label>
                                <select v-model="blk.startTime" class="input input-sm w-full">
                                    <option v-for="t in TIME_OPTIONS" :key="'st-' + t.value" :value="t.value">{{ t.label }}</option>
                                </select>
                            </div>
                            <div class="col-span-4">
                                <label class="block text-[10px] font-semibold uppercase text-muted">End Time</label>
                                <select v-model="blk.endTime" class="input input-sm w-full">
                                    <option v-for="t in TIME_OPTIONS" :key="'et-' + t.value" :value="t.value">{{ t.label }}</option>
                                </select>
                            </div>
                            <div class="col-span-1 flex flex-col items-end justify-end pt-3">
                                <button type="button"
                                        @click="removeDutyBlockRow(bIdx)"
                                        class="rounded p-1 text-danger hover:bg-danger/10 transition"
                                        title="Remove / Delete duty block">
                                    <app-icon name="Trash2" :size="14" />
                                </button>
                            </div>
                        </div>

                        <div class="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                            <span class="text-muted">
                                Raw Duration: <strong class="text-navy">{{ editDutyPreview.rowDetails[bIdx]?.hours || 0 }} hrs</strong>
                                <span v-if="editDutyModal.department === 'OFFICE' && blk.day !== 'SAT' && editDutyPreview.rowDetails[bIdx]?.spansOfficeLunch">
                                    (12:00–1:00 PM lunch break: -1h deduction)
                                </span>
                                <span v-else-if="editDutyModal.department === 'OFFICE' && blk.day === 'SAT'">
                                    (Saturday half-day: no lunch deduction)
                                </span>
                                <span v-else-if="editDutyModal.department !== 'OFFICE' && !editDutyModal.isReliever && blk.day !== 'SAT' && (editDutyPreview.rowDetails[bIdx]?.hours || 0) >= 5">
                                    (1h lunch deducted on daily total &gt;= 5h)
                                </span>
                                <span v-if="editDutyPreview.rowDetails[bIdx]?.isExtendedOffice" class="ml-1 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-900">
                                    Adjusted 7AM/6PM window
                                </span>
                            </span>
                            <span v-if="editDutyPreview.rowDetails[bIdx]?.conflict" class="font-semibold text-danger">
                                {{ editDutyPreview.rowDetails[bIdx].conflict }}
                            </span>
                            <span v-else-if="editDutyPreview.rowDetails[bIdx]?.partnerOverlapHrs > 0"
                                  class="rounded bg-violet-100 px-1.5 py-0.5 font-semibold text-violet-900">
                                Partner Overlap: {{ editDutyPreview.rowDetails[bIdx].partnerOverlapHrs }}h ({{ editDutyPreview.rowDetails[bIdx].partnerOverlapLabel }})
                            </span>
                            <span v-else class="text-success font-semibold">Valid — No class or window conflict</span>
                        </div>
                    </div>
                </div>

                <div v-if="isBatchLocked" class="pt-2">
                    <label class="block text-caption font-semibold text-ink mb-1">
                        Authorized Exception Reason <span class="text-danger">* (Required — Batch is Locked)</span>
                    </label>
                    <input v-model="editDutyModal.reason" type="text" class="input input-sm w-full"
                           placeholder="Enter official reason for modifying approved duty schedule..." />
                </div>

                <div class="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-line">
                    <div class="flex items-center gap-1.5 flex-wrap">
                        <button v-if="!editDutyModal.isReliever"
                                type="button"
                                @click="saveDutyHours(true)"
                                :disabled="busy"
                                class="btn btn-secondary btn-sm"
                                title="Restore initial auto-recommended duty pattern">
                            <app-icon name="RotateCcw" :size="13" /> Reset to Auto
                        </button>
                        <button type="button"
                                @click="unassignFromModal"
                                :disabled="busy"
                                class="rounded border border-danger/30 bg-white px-2.5 py-1.5 text-caption font-semibold text-danger hover:bg-danger/5 transition flex items-center gap-1"
                                title="Unassign / Remove S.A. from this room">
                            <app-icon name="Trash2" :size="13" /> Unassign S.A.
                        </button>
                        <button type="button"
                                @click="swapFromModal"
                                :disabled="busy"
                                class="rounded border border-sky-300 bg-sky-50 px-2.5 py-1.5 text-caption font-semibold text-sky-900 hover:bg-sky-100 transition flex items-center gap-1"
                                title="Replace with an eligible candidate">
                            <app-icon name="UserCheck" :size="13" /> Change S.A.
                        </button>
                    </div>
                    <div class="flex items-center gap-2 ml-auto">
                        <button type="button" @click="editDutyModal.open = false" class="btn btn-secondary btn-sm">Cancel</button>
                        <button type="button"
                                @click="saveDutyHours(false)"
                                :disabled="busy || editDutyPreview.hasErrors"
                                class="btn btn-sm"
                                :class="editDutyModal.blocks.length === 0 ? 'btn-danger' : 'btn-primary'">
                            <app-icon :name="editDutyModal.blocks.length === 0 ? 'Trash2' : 'Check'" :size="14" />
                            {{ editDutyModal.blocks.length === 0 ? 'Save & Unassign S.A.' : 'Save Adjusted Duty Hours' }}
                        </button>
                    </div>
                </div>
            </div>
        </app-modal>

        <!-- Swap SA Modal -->
        <app-modal :open="swapModal.open" :title="isBatchLocked ? 'Authorized S.A. Reassignment' : 'Swap / Assign Eligible S.A.'" @close="swapModal.open = false">
            <div class="space-y-4">
                <p class="text-caption text-muted">
                    Select an eligible <strong>{{ swapModal.department }}</strong> S.A. for <strong>{{ swapModal.room }}</strong>
                    (replacing <strong>{{ swapModal.dropSaName }}</strong>). Only candidates with verified Registrar class schedules are listed.
                </p>
                <div v-if="!swapModal.alternates.length" class="rounded-lg bg-page p-4 text-caption text-muted">
                    No alternative S.A.s available for this slot.
                </div>
                <div v-else class="space-y-2 max-h-64 overflow-y-auto">
                    <label v-for="alt in swapModal.alternates" :key="alt.saId"
                           class="flex items-center justify-between gap-3 rounded-lg border p-3 cursor-pointer"
                           :class="swapModal.pickSaId === alt.saId ? 'border-navy bg-navy/5' : 'border-line'">
                        <div class="flex items-center gap-2.5">
                            <input type="radio" :value="alt.saId" v-model="swapModal.pickSaId" />
                            <div>
                                <div class="font-semibold text-ink">{{ alt.name }} ({{ alt.studentId }})</div>
                                <div class="text-caption text-muted">{{ alt.course }} · Year {{ alt.yearLevel }} · {{ alt.category }}</div>
                            </div>
                        </div>
                        <div class="text-right text-caption">
                            <div class="font-bold text-navy">{{ alt.creditedHours }} hrs/wk</div>
                            <div class="text-muted">Score {{ alt.score }}</div>
                        </div>
                    </label>
                </div>
                <div>
                    <label class="block text-caption font-semibold text-ink mb-1">
                        Reason for Reassignment <span v-if="isBatchLocked" class="text-danger">* (Required — Batch is Locked)</span>
                    </label>
                    <input v-model="swapModal.reason" type="text" class="input input-sm w-full"
                           placeholder="Enter official reason for reassignment..." />
                </div>
                <div class="flex justify-end gap-2 pt-2">
                    <button @click="swapModal.open = false" class="btn btn-secondary btn-sm">Cancel</button>
                    <button @click="submitSwap" :disabled="busy || !swapModal.pickSaId" class="btn btn-primary btn-sm">
                        {{ isBatchLocked ? 'Confirm Authorized Reassignment' : 'Confirm Assignment' }}
                    </button>
                </div>
            </div>
        </app-modal>
    </template>
    `
};
