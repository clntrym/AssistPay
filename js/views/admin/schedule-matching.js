// Scheduling > Schedule Matching & Room Assignment Board (Page 5)
// Performs matching once per assignment cycle and provides a clean, easy-to-scan
// Room Assignment Board with Primary S.A. & Reliever S.A. distinction, suitability checks,
// single-batch approval & lock, Reliever coverage, and authorized post-approval reassignment.
const ScheduleMatchingPage = {
    components: { AppIcon, PageHeader, AppModal },

    setup() {
        const loading = Vue.ref(true);
        const running = Vue.ref(false);
        const busy = Vue.ref(false);
        const runMode = Vue.ref("standard");
        const loadError = Vue.ref("");

        const semester = Vue.ref(null);
        const ready = Vue.ref(null);
        const run = Vue.ref(null);
        const grid = Vue.ref(null);
        const lockInfo = Vue.ref({ batchStatus: "UNRUN", isLocked: false });
        const publication = Vue.ref(null);
        const recheck = Vue.ref(null);
        const pool = Vue.ref([]);
        const minWeekly = Vue.ref(20);
        const maxWeekly = Vue.ref(20);

        // Matching Snapshots & Multi-Trial State
        const savedRuns = Vue.ref([]);
        const switchingRun = Vue.ref(false);
        const currentActiveRun = Vue.computed(() => {
            return savedRuns.value.find(r => r.isActive) || run.value;
        });

        // Board View & Filter State
        const viewMode = Vue.ref("CARDS"); // 'CARDS' | 'TABLE'
        const q = Vue.ref("");
        const deptFilter = Vue.ref("ALL"); // 'ALL' | 'ITO' | 'ACADS' | 'OFFICE'
        const roleFilter = Vue.ref("ALL"); // 'ALL' | 'PRIMARY' | 'RELIEVER'
        const approvalFilter = Vue.ref("ALL"); // 'ALL' | 'AWAITING_APPROVAL' | 'APPROVED'
        const coverageFilter = Vue.ref("ALL"); // 'ALL' | 'COVERED' | 'RELIEVER_NEEDED' | 'UNCOVERED'

        // Modals
        const detailsModal = Vue.reactive({
            open: false,
            loading: false,
            post: null,
        });

        const batchApproveModal = Vue.reactive({
            open: false,
            notes: "",
        });

        const reassignModal = Vue.reactive({
            open: false,
            isLockedOverride: false,
            room: "",
            department: "",
            dropSaId: 0,
            dropSaName: "",
            pickSaId: 0,
            reason: "",
            candidates: [],
        });

        const reliefModal = Vue.reactive({
            open: false,
            checking: false,
            room: "",
            department: "",
            primarySaId: 0,
            primarySaName: "",
            coverageDate: new Date().toISOString().slice(0, 10),
            startTime: "08:00",
            endTime: "12:00",
            relieverSaId: 0,
            reason: "",
            outcome: "",
            candidateResult: null,
        });

        const poolModal = Vue.reactive({
            open: false,
            saId: 0,
            reason: "",
        });

        const sanitizeText = (val) => String(val || "").replace(/['"`;<>\\]/g, " ").trim();

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
                label: `${h12}:${String(mins).padStart(2, "0")} ${ampm}`,
            });
        }

        const applyPayload = (res) => {
            if (res.semester) semester.value = res.semester;
            if (res.ready) ready.value = res.ready;
            if (res.run !== undefined) run.value = res.run;
            if (Array.isArray(res.runs)) savedRuns.value = res.runs;
            if (res.grid !== undefined) grid.value = res.grid;
            if (res.lockInfo) lockInfo.value = res.lockInfo;
            else if (res.grid?.lockInfo) lockInfo.value = res.grid.lockInfo;
            if (res.publication) publication.value = res.publication;
            if (res.recheck || res.run?.recheck) recheck.value = res.recheck || res.run?.recheck;
            if (Array.isArray(res.pool)) pool.value = res.pool;
            if (res.minWeekly != null) minWeekly.value = res.minWeekly;
            if (res.maxWeekly != null) maxWeekly.value = res.maxWeekly;
        };

        const load = async (silent = false) => {
            if (!silent) loading.value = true;
            loadError.value = "";
            const res = await Model.request("scheduling", "matching_summary");
            if (!silent) loading.value = false;
            if (!res.success) {
                if (!silent) loadError.value = res.message || "Could not load Room Assignment Board.";
                return;
            }
            applyPayload(res);
        };

        const onWindowFocus = () => {
            if (!busy.value && !running.value && !reassignModal.open && !reliefModal.open && !detailsModal.open) {
                load(true);
            }
        };

        Vue.onMounted(() => {
            load();
            window.addEventListener("focus", onWindowFocus);
        });

        Vue.onUnmounted(() => {
            window.removeEventListener("focus", onWindowFocus);
        });

        const isBatchLocked = Vue.computed(() => !!lockInfo.value?.isLocked);
        const isSchedulePublished = Vue.computed(() => {
            const status = String(publication.value?.status || "").toUpperCase();
            return status === "PUBLISHED" || status === "FINALIZED" || !!publication.value?.published_at;
        });
        const showMatchingSnapshots = Vue.computed(() => {
            if (isBatchLocked.value || isSchedulePublished.value) return false;
            return Array.isArray(savedRuns.value) && savedRuns.value.length > 0;
        });

        const boardSummary = Vue.computed(() => {
            if (grid.value?.boardSummary) return grid.value.boardSummary;
            const posts = grid.value?.posts || [];
            let awaiting = 0;
            let approved = 0;
            let uncovered = 0;
            let primaryCnt = 0;
            let relieverCnt = 0;
            for (const p of posts) {
                if (p.accepted) approved++;
                else awaiting++;
                if (p.coverageStatus === "UNCOVERED" || p.coverageStatus === "RELIEVER_NEEDED") uncovered++;
                primaryCnt += (p.primarySas || []).length;
                relieverCnt += (p.relieverSas || []).length + (p.activeReliefCoverages || []).length;
            }
            return {
                totalAssignments: posts.length,
                awaitingApproval: awaiting,
                approvedAssignments: approved,
                uncoveredRooms: uncovered,
                primaryAssignedCount: primaryCnt,
                relieverAssignedCount: relieverCnt,
            };
        });

        const boardPosts = Vue.computed(() => {
            const posts = grid.value?.posts || [];
            const term = q.value.trim().toLowerCase();

            return posts.filter(p => {
                if (deptFilter.value !== "ALL" && p.department !== deptFilter.value) return false;

                if (roleFilter.value === "PRIMARY") {
                    if (!p.primarySas || p.primarySas.length === 0) return false;
                } else if (roleFilter.value === "RELIEVER") {
                    const hasRel = (p.relieverSas && p.relieverSas.length > 0) ||
                                   (p.activeReliefCoverages && p.activeReliefCoverages.length > 0) ||
                                   p.coverageStatus === "RELIEVER_NEEDED";
                    if (!hasRel) return false;
                }

                if (approvalFilter.value === "APPROVED") {
                    if (!p.accepted) return false;
                } else if (approvalFilter.value === "AWAITING_APPROVAL") {
                    if (p.accepted) return false;
                }

                if (coverageFilter.value === "COVERED") {
                    if (p.coverageStatus !== "FULLY_COVERED" && p.coverageStatus !== "RELIEVER_COVERED") return false;
                } else if (coverageFilter.value === "RELIEVER_NEEDED") {
                    if (p.coverageStatus !== "RELIEVER_NEEDED") return false;
                } else if (coverageFilter.value === "UNCOVERED") {
                    if (p.coverageStatus !== "UNCOVERED") return false;
                } else if (coverageFilter.value === "UNCOVERED_OR_RELIEVER") {
                    if (p.coverageStatus !== "UNCOVERED" && p.coverageStatus !== "RELIEVER_NEEDED") return false;
                }

                if (!term) return true;
                if (
                    p.room.toLowerCase().includes(term) ||
                    p.department.toLowerCase().includes(term) ||
                    (p.building || "").toLowerCase().includes(term)
                ) {
                    return true;
                }

                const staffHit = (p.staff || []).some(s =>
                    s.name.toLowerCase().includes(term) ||
                    s.studentId.toLowerCase().includes(term) ||
                    (s.course || "").toLowerCase().includes(term) ||
                    (s.donorRoom || "").toLowerCase().includes(term)
                );
                if (staffHit) return true;

                return (p.activeReliefCoverages || []).some(r =>
                    (r.relieverName || "").toLowerCase().includes(term) ||
                    (r.relieverStudentId || "").toLowerCase().includes(term)
                );
            });
        });

        const resetFilters = () => {
            q.value = "";
            deptFilter.value = "ALL";
            roleFilter.value = "ALL";
            approvalFilter.value = "ALL";
            coverageFilter.value = "ALL";
        };

        const filterByKpi = (type) => {
            if (type === "TOTAL") {
                resetFilters();
            } else if (type === "AWAITING") {
                approvalFilter.value = "AWAITING_APPROVAL";
                coverageFilter.value = "ALL";
                q.value = "";
            } else if (type === "APPROVED") {
                approvalFilter.value = "APPROVED";
                coverageFilter.value = "ALL";
                q.value = "";
            } else if (type === "UNCOVERED") {
                coverageFilter.value = "UNCOVERED_OR_RELIEVER";
                approvalFilter.value = "ALL";
                q.value = "";
            }
            Vue.nextTick(() => {
                const el = document.getElementById("assignment-board");
                if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            });
        };

        const triggerRun = async (mode = "standard") => {
            if (running.value || busy.value) return;

            if (isBatchLocked.value && mode !== "incremental") {
                Toast.error("This matching batch is approved and locked. Use 'Match Unassigned Pool' or 'Authorized Reassignment'.");
                return;
            }

            const titles = {
                standard: run.value ? "Re-run Initial Matching Batch?" : "Run Initial Matching Batch?",
                alternative: "Explore Alternative Partner Matches?",
                incremental: "Match Unassigned / Reassignment Pool?",
                cross_shuffle: "Cross-Department Shuffle (All Departments)?",
            };
            const htmls = {
                standard: "Run the assignment cycle matching for ITO &amp; ACADS rooms using official Registrar class schedules, course/skill alignment, and Coordinator weekly hour limits?",
                alternative: "Generate alternative complementary partner matches before batch approval while re-verifying official Registrar class schedules?",
                incremental: "Match only new, unassigned, or marked-for-reassignment S.A.s into uncovered room slots while preserving all valid existing assignments?",
                cross_shuffle: "Shuffle S.A.s across all departments (ITO &amp; ACADS) based on availability, while strictly respecting evaluation Retain and Non-Renewal decisions?",
            };
            const confirms = {
                standard: run.value ? "Re-run Matching" : "Run Initial Matching",
                alternative: "Explore Alternatives",
                incremental: "Match Pool S.A.s",
                cross_shuffle: "Shuffle All Departments",
            };

            const ok = await Alerts.confirm({
                title: titles[mode] || titles.standard,
                html: htmls[mode] || htmls.standard,
                confirmText: confirms[mode] || "Run Matching",
            });
            if (!ok) return;

            running.value = true;
            runMode.value = mode;
            const res = await Model.request("scheduling", "matching_run", { mode });
            running.value = false;
            if (!res.success) {
                Toast.error(res.message || "Schedule matching failed.");
                return;
            }
            applyPayload(res);
            Toast.success(
                mode === "incremental"
                    ? "Incremental matching completed! Existing valid room assignments were preserved."
                    : mode === "alternative"
                    ? "Alternative room matches generated for Coordinator review."
                    : mode === "cross_shuffle"
                    ? "Cross-department matching completed! S.A.s shuffled across ITO and ACADS."
                    : "Initial room assignment matching completed for review."
            );
        };

        const switchMatchRun = async (runId) => {
            if (switchingRun.value || busy.value || running.value) return;
            switchingRun.value = true;
            const semId = semester.value?.id || 1;
            const res = await Model.request("scheduling", "switch_matching_run", { semesterId: semId, runId });
            switchingRun.value = false;
            if (!res.success) {
                Toast.error(res.message || "Could not switch matching run.");
                return;
            }
            applyPayload(res);
            Toast.success(res.message || "Switched matching run!");
        };

        const saveCurrentMatch = async () => {
            if (busy.value || running.value || switchingRun.value) return;
            const active = currentActiveRun.value;
            const defaultName = active?.name ? `${active.name} (Copy)` : `Match ${(savedRuns.value.length + 1)}`;
            const { value: matchName } = await Swal.fire({
                title: "Save Matching Snapshot?",
                text: "Save a new copy of this matching to revisit at any time.",
                input: "text",
                inputLabel: "Match Snapshot Name",
                inputValue: defaultName,
                showCancelButton: true,
                confirmButtonText: "Save Snapshot",
                cancelButtonText: "Cancel",
                inputValidator: (val) => !val?.trim() ? "Please enter a name for the matching snapshot." : null
            });
            if (!matchName) return;

            busy.value = true;
            const semId = semester.value?.id || 1;
            const res = await Model.request("scheduling", "save_current_match", {
                semesterId: semId,
                runName: matchName.trim()
            });
            busy.value = false;
            if (!res.success) {
                Alerts.error("Save Failed", res.message || "Could not save match snapshot.");
                return;
            }
            applyPayload(res);
            await Alerts.success("Snapshot Saved", `Saved "${matchName}" as a matching snapshot!`);
        };

        const deleteMatchRun = async (runId) => {
            if (savedRuns.value.length <= 1) {
                Alerts.info("Matching Run", "Cannot delete the only remaining matching run.");
                return;
            }
            const target = savedRuns.value.find(r => r.id === runId);
            const ok = await Alerts.confirm({
                title: `Delete ${target?.name || 'Match'}?`,
                text: "This exploratory matching snapshot will be permanently removed. The most recent remaining match will become active.",
                confirmText: "Yes, Delete Match",
                cancelText: "Cancel"
            });
            if (!ok) return;

            busy.value = true;
            const semId = semester.value?.id || 1;
            const res = await Model.request("scheduling", "delete_matching_run", { semesterId: semId, runId });
            busy.value = false;
            if (!res.success) {
                Alerts.error("Delete Failed", res.message || "Could not delete matching run.");
                return;
            }
            applyPayload(res);
            await Alerts.success("Snapshot Deleted", "Na-delete ang matching snapshot.");
        };

        const unlockBatch = async () => {
            if (busy.value) return;
            const ok = await Alerts.confirm({
                title: "Unlock Matching Batch?",
                html: "Unlock the matching batch so you can adjust schedules, explore alternatives, or re-run matching?",
                confirmText: "Unlock Batch"
            });
            if (!ok) return;

            busy.value = true;
            const res = await Model.request("scheduling", "batch_unlock");
            busy.value = false;
            if (!res.success) {
                Alerts.error("Unlock Failed", res.message || "Could not unlock matching batch.");
                return;
            }
            if (res.lockInfo) lockInfo.value = res.lockInfo;
            if (res.run) run.value = res.run;
            if (res.grid) grid.value = res.grid;
            await Alerts.success("Batch Unlocked", "Matching batch unlocked. You can now adjust assignments and explore alternatives.");
        };

        const openRoomDetails = async (post) => {
            detailsModal.post = post;
            detailsModal.open = true;
            detailsModal.loading = true;
            const res = await Model.request("scheduling", "room_board_details", { room: post.room });
            detailsModal.loading = false;
            if (res.success && res.details) {
                detailsModal.post = res.details;
            }
        };

        const openReassignModal = (post, staffMember = null) => {
            reassignModal.isLockedOverride = isBatchLocked.value;
            reassignModal.room = post.room;
            reassignModal.department = post.department;
            reassignModal.dropSaId = staffMember ? staffMember.saId : 0;
            reassignModal.dropSaName = staffMember ? `${staffMember.name} (${staffMember.studentId})` : "";
            reassignModal.reason = "";

            // Collect all S.A.s currently assigned / matched across ANY post or slot (excluding the SA being replaced)
            // "dapat di na nag papakita here yung may naka assign na sa na match ng system."
            const assignedSaIds = new Set();
            (grid.value?.posts || []).forEach(p => {
                (p.staff || []).forEach(s => {
                    const sid = Number(s.saId);
                    if (sid && sid !== Number(reassignModal.dropSaId)) {
                        assignedSaIds.add(sid);
                    }
                });
            });
            (run.value?.slots || []).forEach(sl => {
                const sid = Number(sl.assigned_sa_profile_id || sl.recommended?.saId || 0);
                if (sid && sid !== Number(reassignModal.dropSaId)) {
                    assignedSaIds.add(sid);
                }
            });

            // Build candidate list ONLY from truly unassigned S.A.s
            const candMap = new Map();
            for (const alt of (post.alternates || [])) {
                const altId = Number(alt.saId);
                if (!assignedSaIds.has(altId)) {
                    candMap.set(altId, {
                        saId: altId,
                        studentId: alt.studentId,
                        name: alt.name,
                        course: alt.course,
                        yearLevel: alt.yearLevel,
                        category: alt.category,
                        creditedHours: alt.creditedHours,
                        score: alt.score,
                    });
                }
            }
            for (const pSa of (pool.value || [])) {
                const sid = Number(pSa.id);
                if (!assignedSaIds.has(sid) && !candMap.has(sid) && pSa.category === post.department) {
                    candMap.set(sid, {
                        saId: sid,
                        studentId: pSa.studentId,
                        name: pSa.name,
                        course: pSa.course,
                        yearLevel: pSa.yearLevel,
                        category: pSa.category,
                        creditedHours: minWeekly.value,
                        score: 85,
                    });
                }
            }
            const cands = Array.from(candMap.values());
            reassignModal.candidates = cands;
            reassignModal.pickSaId = cands[0]?.saId || 0;
            reassignModal.open = true;
        };

        const submitReassign = async () => {
            if (busy.value) return;
            if (!reassignModal.pickSaId) {
                Toast.error("Please select a qualified Student Assistant.");
                return;
            }
            const cleanReason = sanitizeText(reassignModal.reason);
            if (reassignModal.isLockedOverride && cleanReason.length < 5) {
                Toast.error("An official reason (at least 5 characters) is required for post-approval reassignment.");
                return;
            }

            busy.value = true;
            const action = reassignModal.isLockedOverride ? "authorized_reassign_room_sa" : "post_swap";
            const res = await Model.request("scheduling", action, {
                room: reassignModal.room,
                dropSaId: reassignModal.dropSaId,
                pickSaId: reassignModal.pickSaId,
                reason: cleanReason || "Resolved by S.A. Coordinator prior to batch approval",
            });
            busy.value = false;
            if (!res.success) {
                Toast.error(res.message || "Could not update room assignment.");
                return;
            }
            reassignModal.open = false;
            applyPayload(res);
            if (detailsModal.open && detailsModal.post?.room === reassignModal.room) {
                await openRoomDetails({ room: reassignModal.room });
            }
            Toast.success(
                reassignModal.isLockedOverride
                    ? `Authorized reassignment recorded for ${reassignModal.room} with audit trail.`
                    : `Updated Primary S.A. assignment for ${reassignModal.room}.`
            );
        };

        const openReliefModal = async (post, primarySa = null) => {
            const firstPrimary = primarySa || (post.primarySas && post.primarySas[0]) || null;
            reliefModal.room = post.room;
            reliefModal.department = post.department;
            reliefModal.primarySaId = firstPrimary ? firstPrimary.saId : 0;
            reliefModal.primarySaName = firstPrimary ? `${firstPrimary.name} (${firstPrimary.studentId})` : "Unassigned / Room Window";
            reliefModal.coverageDate = new Date().toISOString().slice(0, 10);
            reliefModal.startTime = "08:00";
            reliefModal.endTime = "12:00";
            reliefModal.relieverSaId = 0;
            reliefModal.reason = "";
            reliefModal.outcome = "Reliever coverage confirmed; Primary S.A. official assignment unchanged.";
            reliefModal.candidateResult = null;
            reliefModal.open = true;
            await checkReliefCandidates();
        };

        const checkReliefCandidates = async () => {
            if (!reliefModal.room || !reliefModal.coverageDate || !reliefModal.startTime || !reliefModal.endTime) return;
            reliefModal.checking = true;
            const res = await Model.request("scheduling", "relief_coverage_candidates", {
                room: reliefModal.room,
                coverageDate: reliefModal.coverageDate,
                startTime: reliefModal.startTime,
                endTime: reliefModal.endTime,
                primarySaId: reliefModal.primarySaId || null,
            });
            reliefModal.checking = false;
            if (!res.success) {
                reliefModal.candidateResult = null;
                Toast.error(res.message || "Could not check Reliever availability.");
                return;
            }
            reliefModal.candidateResult = res.candidates;
            const qual = res.candidates?.qualified || [];
            reliefModal.relieverSaId = qual[0]?.saId || 0;
        };

        const submitReliefCoverage = async () => {
            if (busy.value) return;
            if (!reliefModal.relieverSaId) {
                Toast.error("Select a qualified conflict-free Reliever S.A.");
                return;
            }
            const cleanReason = sanitizeText(reliefModal.reason);
            if (cleanReason.length < 3) {
                Toast.error("Please enter the reason for reliever coverage (e.g., exam, sick leave, official activity).");
                return;
            }
            busy.value = true;
            const res = await Model.request("scheduling", "relief_coverage_save", {
                room: reliefModal.room,
                primarySaId: reliefModal.primarySaId || null,
                relieverSaId: reliefModal.relieverSaId,
                coverageDate: reliefModal.coverageDate,
                startTime: reliefModal.startTime,
                endTime: reliefModal.endTime,
                reason: cleanReason,
                outcome: sanitizeText(reliefModal.outcome),
            });
            busy.value = false;
            if (!res.success) {
                Toast.error(res.message || "Could not save Reliever coverage.");
                return;
            }
            reliefModal.open = false;
            if (res.grid) grid.value = res.grid;
            if (detailsModal.open && res.details) detailsModal.post = res.details;
            await Alerts.success("Reliever Assigned", `Reliever coverage confirmed for ${reliefModal.room}. Primary S.A. assignment remains unchanged.`);
        };

        const updateReliefStatus = async (cov, newStatus) => {
            if (busy.value || !cov) return;
            const label = newStatus === "COMPLETED" ? "Complete Reliever Coverage" : "Cancel Reliever Coverage";
            const ok = await Alerts.confirm({
                title: `${label}?`,
                html: newStatus === "COMPLETED"
                    ? `Mark reliever coverage by <b class="text-ink">${Alerts.esc(cov.relieverName)}</b> on <b>${Alerts.esc(cov.coverageDate)}</b> as <b>COMPLETED</b>? The original Primary S.A. assignment for <b>${Alerts.esc(cov.room)}</b> will remain unchanged.`
                    : `Cancel Reliever coverage by <b class="text-ink">${Alerts.esc(cov.relieverName)}</b> on <b>${Alerts.esc(cov.coverageDate)}</b>?`,
                confirmText: label,
            });
            if (!ok) return;

            busy.value = true;
            const res = await Model.request("scheduling", "relief_coverage_update_status", {
                coverageId: cov.id,
                status: newStatus,
                outcome: newStatus === "COMPLETED"
                    ? "Reliever coverage completed; original Primary S.A. room assignment remains unchanged."
                    : "Reliever coverage cancelled by Coordinator.",
            });
            busy.value = false;
            if (!res.success) {
                Alerts.error("Update Failed", res.message || "Could not update reliever coverage status.");
                return;
            }
            if (res.grid) grid.value = res.grid;
            if (detailsModal.open && res.details) detailsModal.post = res.details;
            await Alerts.success("Status Updated", `Reliever coverage marked ${newStatus}. Primary S.A. assignment unchanged.`);
        };

        const openPoolModal = () => {
            const firstSa = (pool.value || []).find(s => !s.markedForReassignment) || pool.value?.[0];
            poolModal.saId = firstSa ? firstSa.id : 0;
            poolModal.reason = "";
            poolModal.open = true;
        };

        const toggleMarkForReassignment = async (saId, marked, customReason = "") => {
            if (busy.value || !saId) return;
            const cleanReason = sanitizeText(customReason || poolModal.reason || "Marked by Coordinator for reassignment pool");
            if (marked && cleanReason.length < 3) {
                Alerts.warning("Reason Required", "Please enter a reason for marking this S.A. for the reassignment pool.");
                return;
            }
            busy.value = true;
            const res = await Model.request("scheduling", "mark_sa_for_reassignment", {
                saId,
                marked,
                reason: cleanReason,
            });
            busy.value = false;
            if (!res.success) {
                Alerts.error("Update Failed", res.message || "Could not update reassignment pool status.");
                return;
            }
            applyPayload(res);
            await load();
            await Alerts.success(marked ? "Added to Pool" : "Removed from Pool", marked ? "S.A. added to the Reassignment Pool." : "Removed S.A. from the Reassignment Pool.");
        };

        const resetToZeroMatching = async () => {
            if (busy.value || running.value) return;
            const ok = await Alerts.confirm({
                title: "Reset to Zero Matching?",
                text: "All current match recommendations will be cleared, resetting schedule matching back to the beginning for this semester.",
                confirmText: "Yes, Reset to Zero",
                tone: "danger",
            });
            if (!ok) return;

            busy.value = true;
            const res = await Model.request("scheduling", "recommendation_clear", {});
            busy.value = false;
            if (!res.success) {
                Alerts.error("Reset Failed", res.message || "Could not reset matching.");
                return;
            }
            await Alerts.success("Reset Complete", "Successfully reset to zero matching!");
            await load();
        };

        const goRecommendations = (post = null) => {
            const room = post?.room || "";
            const key = post?.key || "";
            if (room) {
                try {
                    sessionStorage.setItem("assistpay_target_room", room);
                    if (key) sessionStorage.setItem("assistpay_target_key", key);
                } catch (e) {}
                window.location.hash = `#/admin/scheduling/recommendations?room=${encodeURIComponent(room)}`;
            } else {
                window.location.hash = "#/admin/scheduling/recommendations";
            }
        };

        return {
            loading, running, busy, runMode, loadError,
            semester, ready, run, grid, lockInfo, publication, recheck, pool,
            minWeekly, maxWeekly,
            viewMode, q, deptFilter, roleFilter, approvalFilter, coverageFilter,
            isBatchLocked, isSchedulePublished, showMatchingSnapshots, boardSummary, boardPosts,
            detailsModal, batchApproveModal, reassignModal, reliefModal, poolModal,
            TIME_OPTIONS,
            load, resetFilters, filterByKpi, triggerRun, resetToZeroMatching,
            savedRuns, switchingRun, currentActiveRun,
            switchMatchRun, saveCurrentMatch, deleteMatchRun,
            openRoomDetails,
            openReassignModal, submitReassign,
            openReliefModal, checkReliefCandidates, submitReliefCoverage, updateReliefStatus,
            openPoolModal, toggleMarkForReassignment,
            goRecommendations, Format, unlockBatch
        };
    },

    template: `
    <page-header title="Room Assignment Board & Schedule Matching" section="Scheduling" stack-actions
                 :subtitle="semester ? 'Single-batch room matching, Primary vs. Reliever S.A. assignment board, and candidate exploration (' + semester.label + ').' : 'Single-batch room matching and Room Assignment Board.'">
        <template #actions>
            <div class="flex flex-wrap items-center gap-2">
                <!-- If NO run exists yet: Only show Run Initial Matching -->
                <button v-if="!run && !isBatchLocked"
                        @click="triggerRun('standard')"
                        :disabled="running || busy || (ready && !ready.canRun)"
                        class="btn btn-primary btn-sm flex items-center gap-1.5 shadow-xs">
                    <app-icon :name="running && runMode === 'standard' ? 'Loader' : 'Sparkles'" :size="15"
                              :class="running && runMode === 'standard' ? 'animate-spin' : ''" />
                    <span>Run Initial Matching</span>
                </button>

                <!-- If run exists: Show Re-run, Explore Alternatives, Shuffle All Depts, and Proceed to Recommendations -->
                <template v-else-if="run && !isBatchLocked">
                    <button @click="triggerRun('standard')"
                            :disabled="running || busy || (ready && !ready.canRun)"
                            class="btn btn-secondary btn-sm flex items-center gap-1.5">
                        <app-icon :name="running && runMode === 'standard' ? 'Loader' : 'Sparkles'" :size="15"
                                  :class="running && runMode === 'standard' ? 'animate-spin' : ''" />
                        <span>Re-run Initial Matching</span>
                    </button>

                    <button @click="triggerRun('alternative')"
                            :disabled="running || busy"
                            class="btn btn-secondary btn-sm flex items-center gap-1.5">
                        <app-icon :name="running && runMode === 'alternative' ? 'Loader' : 'Shuffle'" :size="15"
                                  :class="running && runMode === 'alternative' ? 'animate-spin' : ''" />
                        <span>Explore Alternatives</span>
                    </button>

                    <button @click="triggerRun('cross_shuffle')"
                            :disabled="running || busy || (ready && !ready.canRun)"
                            class="btn btn-secondary btn-sm flex items-center gap-1.5"
                            title="Shuffle S.A.s across all departments (ITO & ACADS) while respecting Retain and Non-Renewal bans">
                        <app-icon :name="running && runMode === 'cross_shuffle' ? 'Loader' : 'RefreshCw'" :size="15"
                                  :class="running && runMode === 'cross_shuffle' ? 'animate-spin' : ''" />
                        <span>Shuffle All Depts</span>
                    </button>

                    <button @click="resetToZeroMatching"
                            :disabled="running || busy"
                            class="btn btn-sm text-danger hover:bg-danger/10 border border-line flex items-center gap-1.5"
                            title="Reset all recommendations to zero matching to start fresh">
                        <app-icon name="RotateCcw" :size="14" />
                        <span>Reset to Zero</span>
                    </button>

                    <!-- Proceed to Step 6: Recommendations (Approve & Lock Batch is handled in Recommendations) -->
                    <router-link to="/admin/scheduling/recommendations"
                                 class="btn btn-primary btn-sm flex items-center gap-1.5 shadow-xs">
                        <span>Review in Recommendations</span>
                        <app-icon name="ArrowRight" :size="14" />
                    </router-link>
                </template>

                <template v-else-if="isBatchLocked">
                    <span class="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-caption font-bold text-emerald-900">
                        <app-icon name="Lock" :size="14" class="text-emerald-700" />
                        Batch Approved &amp; Locked
                    </span>
                    <button @click="unlockBatch" :disabled="busy"
                            class="btn btn-secondary btn-sm text-amber-900 border-amber-300 bg-amber-50 hover:bg-amber-100 flex items-center gap-1.5">
                        <app-icon name="Unlock" :size="14" /> Unlock Batch
                    </button>
                </template>
            </div>
        </template>
    </page-header>

    <div v-if="loading" class="space-y-4" aria-busy="true">
        <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div v-for="i in 4" :key="i" class="h-24 animate-pulse rounded-xl bg-white"></div>
        </div>
        <div class="h-80 animate-pulse rounded-xl bg-white"></div>
    </div>

    <div v-else-if="loadError" class="card flex flex-col items-center px-6 py-12 text-center">
        <app-icon name="CircleX" :size="28" class="text-danger" />
        <p class="mt-3 text-body font-medium text-ink">Could not load Room Assignment Board</p>
        <p class="mt-1 text-caption text-muted">{{ loadError }}</p>
        <button @click="load" class="btn btn-secondary btn-sm mt-4"><app-icon name="RefreshCw" :size="14" /> Try again</button>
    </div>

    <template v-else>
        <!-- MATCHING RUNS / SNAPSHOTS SELECTOR (MATCH 1, MATCH 2...) -->
        <section v-if="showMatchingSnapshots" class="card mb-5 p-3.5 bg-gradient-to-r from-slate-50 via-white to-slate-50 border border-line shadow-xs">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div class="flex items-center gap-3">
                    <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-navy/10 text-navy">
                        <app-icon name="Layers" :size="18" />
                    </div>
                    <div>
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="text-[13px] font-bold text-navy">Matching Snapshots</span>
                            <span class="inline-flex items-center gap-1 rounded-full bg-navy/10 px-2 py-0.5 text-[11px] font-semibold text-navy">
                                Active: {{ currentActiveRun?.name || 'Match 1' }}
                            </span>
                        </div>
                        <p class="text-[11px] text-muted mt-0.5">
                            Select a match version to revisit previous recommendations or explore new partner matching:
                        </p>
                    </div>
                </div>

                <!-- Match Version Pills & Actions -->
                <div class="flex flex-wrap items-center gap-2">
                    <div class="flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-page border border-line">
                        <button v-for="r in savedRuns" :key="r.id"
                                type="button"
                                @click="switchMatchRun(r.id)"
                                :disabled="busy || switchingRun"
                                class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-bold transition-all cursor-pointer"
                                :class="r.isActive ? 'bg-navy text-white shadow-xs' : 'text-slate-600 hover:bg-white hover:text-navy'">
                            <app-icon :name="r.isActive ? 'CheckCircle2' : 'Circle'" :size="13" :class="r.isActive ? 'text-gold' : 'text-slate-400'" />
                            <span>{{ r.name }}</span>
                            <span class="text-[10px] opacity-85 font-semibold">({{ r.recommended }}/{{ r.roomSlots }})</span>
                        </button>
                    </div>

                    <!-- Save Match Snapshot Button -->
                    <button type="button"
                            @click="saveCurrentMatch"
                            :disabled="busy || running || switchingRun"
                            class="btn btn-secondary btn-sm flex items-center gap-1.5"
                            title="Save current match as a new snapshot before exploring">
                        <app-icon name="BookmarkPlus" :size="14" class="text-navy" />
                        <span>Save Match</span>
                    </button>

                    <!-- Delete snapshot (when more than 1 exist) -->
                    <button v-if="savedRuns.length > 1 && currentActiveRun"
                            type="button"
                            @click="deleteMatchRun(currentActiveRun.id)"
                            :disabled="busy || running || switchingRun"
                            class="btn btn-sm text-danger hover:bg-danger/10 border border-transparent hover:border-danger/30"
                            :title="'Delete ' + (currentActiveRun.name || 'Match')">
                        <app-icon name="Trash2" :size="14" />
                    </button>
                </div>
            </div>
        </section>

        <!-- 1. FOUR SUMMARY KPI CARDS -->
        <section class="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <!-- Card 1: Total Assignments -->
            <div @click="filterByKpi('TOTAL')"
                 role="button" tabindex="0"
                 class="card p-4 border-l-4 border-l-navy cursor-pointer transition-all hover:shadow-md active:scale-[0.99] select-none"
                 :class="approvalFilter === 'ALL' && coverageFilter === 'ALL' && deptFilter === 'ALL' && roleFilter === 'ALL' && !q ? 'ring-2 ring-navy/30 shadow-xs' : ''"
                 title="Click to show all room/office assignments">
                <div class="flex items-start justify-between gap-2">
                    <div>
                        <div class="text-[11px] font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
                            <span>Total Assignments</span>
                            <span class="text-[10px] text-navy font-semibold underline">View all</span>
                        </div>
                        <div class="mt-1 text-[24px] font-extrabold text-navy leading-none">
                            {{ boardSummary.totalAssignments }}
                            <span class="text-[13px] font-semibold text-muted">Rooms &amp; Offices</span>
                        </div>
                    </div>
                    <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-navy/10 text-navy">
                        <app-icon name="Building2" :size="18" />
                    </div>
                </div>
                <div class="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] text-muted">
                    <span class="inline-flex items-center gap-1 rounded bg-navy/10 px-1.5 py-0.5 font-semibold text-navy">
                        PRIMARY: {{ boardSummary.primaryAssignedCount }}
                    </span>
                    <span class="inline-flex items-center gap-1 rounded bg-teal-100 px-1.5 py-0.5 font-semibold text-teal-900">
                        RELIEVER: {{ boardSummary.relieverAssignedCount }}
                    </span>
                </div>
            </div>

            <!-- Card 2: Awaiting Approval -->
            <div @click="filterByKpi('AWAITING')"
                 role="button" tabindex="0"
                 class="card p-4 border-l-4 border-l-amber-500 cursor-pointer transition-all hover:shadow-md active:scale-[0.99] select-none"
                 :class="approvalFilter === 'AWAITING_APPROVAL' ? 'ring-2 ring-amber-500/50 shadow-xs bg-amber-50/20' : ''"
                 title="Click to filter and view posts awaiting approval">
                <div class="flex items-start justify-between gap-2">
                    <div>
                        <div class="text-[11px] font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
                            <span>Awaiting Approval</span>
                            <span class="text-[10px] text-amber-800 font-semibold underline">Filter</span>
                        </div>
                        <div class="mt-1 text-[24px] font-extrabold leading-none"
                             :class="boardSummary.awaitingApproval > 0 ? 'text-amber-700' : 'text-ink'">
                            {{ boardSummary.awaitingApproval }}
                            <span class="text-[13px] font-semibold text-muted">Posts</span>
                        </div>
                    </div>
                    <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
                        <app-icon name="Clock" :size="18" />
                    </div>
                </div>
                <div class="mt-2.5 text-[11px] text-muted">
                    {{ isBatchLocked ? 'Batch is locked; 0 pending batch approvals' : (boardSummary.awaitingApproval > 0 ? 'Ready for Coordinator batch review & approval' : 'All matched posts reviewed') }}
                </div>
            </div>

            <!-- Card 3: Approved Assignments -->
            <div @click="filterByKpi('APPROVED')"
                 role="button" tabindex="0"
                 class="card p-4 border-l-4 border-l-emerald-600 cursor-pointer transition-all hover:shadow-md active:scale-[0.99] select-none"
                 :class="approvalFilter === 'APPROVED' ? 'ring-2 ring-emerald-600/50 shadow-xs bg-emerald-50/20' : ''"
                 title="Click to filter and view approved assignments">
                <div class="flex items-start justify-between gap-2">
                    <div>
                        <div class="text-[11px] font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
                            <span>Approved Assignments</span>
                            <span class="text-[10px] text-emerald-800 font-semibold underline">Filter</span>
                        </div>
                        <div class="mt-1 text-[24px] font-extrabold text-emerald-700 leading-none">
                            {{ boardSummary.approvedAssignments }}
                            <span class="text-[13px] font-semibold text-muted">/ {{ boardSummary.totalAssignments }}</span>
                        </div>
                    </div>
                    <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800">
                        <app-icon :name="isBatchLocked ? 'Lock' : 'CircleCheck'" :size="18" />
                    </div>
                </div>
                <div class="mt-2.5 text-[11px] text-muted">
                    <span v-if="isBatchLocked" class="font-semibold text-emerald-800">
                        Published &amp; Locked by {{ lockInfo.approvedBy || 'Coordinator' }}
                    </span>
                    <span v-else>Approve batch once to publish &amp; lock assignments</span>
                </div>
            </div>

            <!-- Card 4: Uncovered Rooms -->
            <div @click="filterByKpi('UNCOVERED')"
                 role="button" tabindex="0"
                 class="card p-4 border-l-4 cursor-pointer transition-all hover:shadow-md active:scale-[0.99] select-none"
                 :class="[
                     boardSummary.uncoveredRooms > 0 ? 'border-l-danger' : 'border-l-emerald-500',
                     (coverageFilter === 'UNCOVERED_OR_RELIEVER' || coverageFilter === 'UNCOVERED' || coverageFilter === 'RELIEVER_NEEDED') ? 'ring-2 ring-danger/50 shadow-xs bg-danger/5' : ''
                 ]"
                 title="Click to filter and view rooms or posts needing S.A. coverage or reliever">
                <div class="flex items-start justify-between gap-2">
                    <div>
                        <div class="text-[11px] font-bold uppercase tracking-wider text-muted flex items-center gap-1.5">
                            <span>Uncovered / Reliever Needed</span>
                            <span class="text-[10px] text-danger font-semibold underline">Filter</span>
                        </div>
                        <div class="mt-1 text-[24px] font-extrabold leading-none"
                             :class="boardSummary.uncoveredRooms > 0 ? 'text-danger' : 'text-emerald-700'">
                            {{ boardSummary.uncoveredRooms }}
                            <span class="text-[13px] font-semibold text-muted">Rooms</span>
                        </div>
                    </div>
                    <div class="flex h-9 w-9 items-center justify-center rounded-lg"
                         :class="boardSummary.uncoveredRooms > 0 ? 'bg-danger/10 text-danger' : 'bg-emerald-100 text-emerald-800'">
                        <app-icon :name="boardSummary.uncoveredRooms > 0 ? 'TriangleAlert' : 'ShieldCheck'" :size="18" />
                    </div>
                </div>
                <div class="mt-2.5 text-[11px] text-muted">
                    {{ boardSummary.uncoveredRooms > 0 ? 'Resolve missing Primary or assign Reliever coverage' : '100% of required rooms & lab windows covered' }}
                </div>
            </div>
        </section>

        <!-- 2. BATCH CYCLE STATUS & ROLE LEGEND BANNER -->
        <section class="card mb-5 p-4">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div class="space-y-1">
                    <div class="flex flex-wrap items-center gap-2">
                        <span class="inline-flex items-center gap-1.5 rounded bg-navy px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-white">
                            PRIMARY — Official Room Assignment
                        </span>
                        <span class="inline-flex items-center gap-1.5 rounded border border-teal-400 bg-teal-100 px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wider text-teal-950">
                            RELIEVER — Backup / Reliever Coverage Only
                        </span>
                        <span v-if="isBatchLocked"
                              class="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-900">
                            <app-icon name="Lock" :size="12" />
                            Approved &amp; Locked ({{ lockInfo.approvedAt || 'Current Cycle' }})
                        </span>
                        <span v-else-if="run"
                              class="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-900">
                            <app-icon name="Sparkles" :size="12" />
                            Batch #{{ run.id }} Ready for Coordinator Review ({{ run.createdAt }})
                        </span>
                    </div>
                    <p class="text-caption text-muted">
                        Matching runs once per assignment cycle and never overwrites valid assignments on page open.
                        <strong>PRIMARY S.A.</strong> holds the permanent room assignment; <strong>RELIEVER S.A.</strong> provides backup or date-specific reliever coverage without altering the Primary assignment.
                    </p>
                </div>

                <div class="flex shrink-0 items-center gap-2">
                    <div class="inline-flex rounded-lg border border-line bg-page p-0.5">
                        <button @click="viewMode = 'CARDS'"
                                class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-caption font-semibold transition"
                                :class="viewMode === 'CARDS' ? 'bg-navy text-white shadow-sm' : 'text-muted hover:text-ink'">
                            <app-icon name="LayoutGrid" :size="14" /> Room Cards
                        </button>
                        <button @click="viewMode = 'TABLE'"
                                class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-caption font-semibold transition"
                                :class="viewMode === 'TABLE' ? 'bg-navy text-white shadow-sm' : 'text-muted hover:text-ink'">
                            <app-icon name="Table" :size="14" /> Readable Table
                        </button>
                    </div>
                </div>
            </div>

            <!-- Missing Registrar Class Schedule Alert -->
            <div v-if="ready && ready.missingSchedule && ready.missingSchedule.length"
                 class="mt-3 rounded-lg border border-danger/30 bg-danger/5 p-3 text-caption text-danger">
                <div class="font-semibold flex items-center gap-1.5">
                    <app-icon name="TriangleAlert" :size="15" />
                    Missing Official Registrar Class Schedule ({{ ready.missingSchedule.length }} S.A.)
                </div>
                <p class="mt-0.5">
                    Cannot match until Registrar class schedules are on file for:
                    <strong>{{ ready.missingSchedule.map(s => s.name + ' (' + s.category + ')').join(', ') }}</strong>
                </p>
            </div>
        </section>

        <!-- EMPTY STATE WHEN INITIAL MATCHING HAS NOT BEEN RUN YET -->
        <section v-if="!run" class="card flex flex-col items-center justify-center px-6 py-14 text-center">
            <div class="flex h-12 w-12 items-center justify-center rounded-full bg-navy/10 text-navy">
                <app-icon name="Sparkles" :size="24" />
            </div>
            <h3 class="mt-3 text-card-title text-navy">Initial Matching Cycle Not Run Yet</h3>
            <p class="mt-1 max-w-lg text-body text-muted">
                The system does not automatically run matching when opening the page. Click <strong>Run Initial Matching</strong> once to generate Primary and Reliever S.A. assignments for all configured rooms and laboratories.
            </p>
            <button @click="triggerRun('standard')" :disabled="running || (ready && !ready.canRun)"
                    class="btn btn-primary mt-5">
                <app-icon name="Sparkles" :size="16" /> Run Initial Matching Now
            </button>
        </section>

        <!-- 3. SEARCH & FILTER BAR + ROOM ASSIGNMENT BOARD -->
        <section v-else id="assignment-board" class="space-y-4">
            <div class="card p-4">
                <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
                    <!-- Search -->
                    <div class="lg:col-span-2">
                        <label class="block text-[11px] font-bold uppercase tracking-wider text-muted mb-1">Search Room or S.A.</label>
                        <input v-model="q" type="search" placeholder="Room, office, S.A. name, ID, course..."
                               class="input input-sm w-full" />
                    </div>

                    <!-- Department Filter -->
                    <div>
                        <label class="block text-[11px] font-bold uppercase tracking-wider text-muted mb-1">Department</label>
                        <select v-model="deptFilter" class="input input-sm w-full">
                            <option value="ALL">All Departments</option>
                            <option value="ITO">ITO Laboratories</option>
                            <option value="ACADS">ACADS Rooms</option>
                            <option value="OFFICE">Offices</option>
                        </select>
                    </div>

                    <!-- Primary / Reliever Role Filter -->
                    <div>
                        <label class="block text-[11px] font-bold uppercase tracking-wider text-muted mb-1">Role Filter</label>
                        <select v-model="roleFilter" class="input input-sm w-full">
                            <option value="ALL">All Roles (Primary &amp; Reliever)</option>
                            <option value="PRIMARY">Has Primary S.A.</option>
                            <option value="RELIEVER">Has Reliever / Needs Reliever</option>
                        </select>
                    </div>

                    <!-- Approval Status Filter -->
                    <div>
                        <label class="block text-[11px] font-bold uppercase tracking-wider text-muted mb-1">Approval Status</label>
                        <select v-model="approvalFilter" class="input input-sm w-full">
                            <option value="ALL">All Approval Statuses</option>
                            <option value="AWAITING_APPROVAL">Awaiting Approval</option>
                            <option value="APPROVED">Approved / Locked</option>
                        </select>
                    </div>

                    <!-- Coverage Status Filter -->
                    <div>
                        <label class="block text-[11px] font-bold uppercase tracking-wider text-muted mb-1">Coverage Status</label>
                        <select v-model="coverageFilter" class="input input-sm w-full">
                            <option value="ALL">All Coverage Statuses</option>
                            <option value="COVERED">Covered (Primary / +Reliever)</option>
                            <option value="RELIEVER_NEEDED">Reliever Needed</option>
                            <option value="UNCOVERED">Uncovered (Missing Primary)</option>
                            <option value="UNCOVERED_OR_RELIEVER">Uncovered / Reliever Needed</option>
                        </select>
                    </div>
                </div>

                <div class="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-2.5 text-caption text-muted">
                    <span>
                        Showing <strong class="text-ink">{{ boardPosts.length }}</strong> of <strong>{{ (grid?.posts || []).length }}</strong> room/office assignment posts
                    </span>
                    <button v-if="q || deptFilter !== 'ALL' || roleFilter !== 'ALL' || approvalFilter !== 'ALL' || coverageFilter !== 'ALL'"
                            @click="resetFilters"
                            class="text-navy font-semibold hover:underline inline-flex items-center gap-1">
                        <app-icon name="RotateCcw" :size="12" /> Clear Filters
                    </button>
                </div>
            </div>

            <!-- No matching filter results -->
            <div v-if="boardPosts.length === 0" class="card p-10 text-center">
                <app-icon name="SearchX" :size="26" class="mx-auto text-muted" />
                <p class="mt-2 font-semibold text-ink">No rooms match your current filters</p>
                <p class="mt-1 text-caption text-muted">Try clearing one or more filters to view all room assignments.</p>
                <button @click="resetFilters" class="btn btn-secondary btn-sm mt-3">Reset Filters</button>
            </div>

            <!-- 4A. COMPACT ROOM CARDS VIEW -->
            <div v-else-if="viewMode === 'CARDS'" class="grid gap-4 lg:grid-cols-2">
                <div v-for="post in boardPosts" :key="post.key"
                     class="card p-5 flex flex-col justify-between border-t-4"
                     :class="post.coverageStatus === 'UNCOVERED'
                         ? 'border-t-danger'
                         : (post.coverageStatus === 'RELIEVER_NEEDED' ? 'border-t-amber-500' : 'border-t-navy')">
                    <div>
                        <!-- Card Header: Room, Dept, Schedule, Approval & Coverage Badges -->
                        <div class="flex flex-wrap items-start justify-between gap-2 border-b border-line pb-3">
                            <div>
                                <div class="flex flex-wrap items-center gap-2">
                                    <span class="rounded px-2 py-0.5 text-[11px] font-bold uppercase"
                                          :class="post.department === 'ITO'
                                              ? 'bg-sky-100 text-sky-900'
                                              : (post.department === 'ACADS' ? 'bg-indigo-100 text-indigo-900' : 'bg-emerald-100 text-emerald-900')">
                                        {{ post.department }}
                                    </span>
                                    <h3 class="text-[16px] font-bold text-navy">{{ post.room }}</h3>
                                    <span class="text-caption text-muted">· {{ post.building }}</span>
                                </div>
                                <div class="mt-1 flex flex-wrap items-center gap-2 text-caption text-muted">
                                    <span class="inline-flex items-center gap-1 font-medium text-ink">
                                        <app-icon name="Calendar" :size="12" class="text-navy" />
                                        {{ post.scheduleSummary?.daysLabel || 'Mon – Sat' }}
                                    </span>
                                    <span>·</span>
                                    <span>{{ post.scheduleSummary?.operatingHoursLabel || '7:00 AM – 9:00 PM' }}</span>
                                    <span>·</span>
                                    <span>Required Primary: <strong>{{ post.requiredSa }}</strong></span>
                                </div>
                            </div>

                            <!-- Status Badges -->
                            <div class="flex flex-wrap items-center gap-1.5">
                                <!-- Approval Badge -->
                                <span class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                                      :class="post.approvalStatus === 'APPROVED_LOCKED'
                                          ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                                          : (post.approvalStatus === 'APPROVED' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-100 text-amber-900')">
                                    <app-icon :name="post.approvalStatus === 'APPROVED_LOCKED' ? 'Lock' : (post.approvalStatus === 'APPROVED' ? 'CircleCheck' : 'Clock')" :size="11" />
                                    {{ post.approvalLabel }}
                                </span>

                                <!-- Coverage Badge -->
                                <span class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                                      :class="post.coverageStatus === 'UNCOVERED'
                                          ? 'bg-danger/10 text-danger'
                                          : (post.coverageStatus === 'RELIEVER_NEEDED'
                                              ? 'bg-amber-100 text-amber-900'
                                              : (post.coverageStatus === 'RELIEVER_COVERED' ? 'bg-teal-100 text-teal-900' : 'bg-success/10 text-success'))">
                                    {{ post.coverageLabel }}
                                </span>
                            </div>
                        </div>

                        <!-- Match Suitability Summary Bar -->
                        <div class="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2 text-caption"
                             :class="post.suitability?.status === 'SUITABLE'
                                 ? 'bg-emerald-50/80 text-emerald-950 border border-emerald-200'
                                 : (post.suitability?.status === 'PARTIAL'
                                     ? 'bg-amber-50/90 text-amber-950 border border-amber-200'
                                     : 'bg-danger/5 text-danger border border-danger/20')">
                            <div class="flex items-center gap-1.5 font-semibold">
                                <app-icon :name="post.suitability?.status === 'SUITABLE' ? 'ShieldCheck' : 'TriangleAlert'" :size="14" />
                                <span>Suitability: {{ post.suitability?.label }}</span>
                            </div>
                            <span v-if="post.suitability?.score > 0" class="text-[11px] font-bold">
                                Match Score: {{ post.suitability.score }} pts
                            </span>
                        </div>

                        <!-- SECTION A: PRIMARY S.A. (OFFICIAL ROOM ASSIGNMENT — SHOWN FIRST) -->
                        <div class="mt-3">
                            <div class="mb-1.5 flex items-center justify-between">
                                <span class="inline-flex items-center gap-1.5 rounded bg-navy px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                                    PRIMARY — Official Room Assignment ({{ (post.primarySas || []).length }} / {{ post.requiredSa }})
                                </span>
                                <button v-if="post.missingSaCount > 0"
                                        @click="openReassignModal(post, null)"
                                        class="text-[11px] font-bold text-navy hover:underline inline-flex items-center gap-1">
                                    <app-icon name="UserPlus" :size="12" /> Assign Missing Primary S.A.
                                </button>
                            </div>

                            <div v-if="post.primarySas && post.primarySas.length" class="space-y-2">
                                <div v-for="psa in post.primarySas" :key="psa.slotId"
                                     class="rounded-lg border border-line bg-page/60 p-3">
                                    <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                                        <div>
                                            <div class="flex flex-wrap items-center gap-1.5">
                                                <span class="rounded bg-navy px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">PRIMARY</span>
                                                <span class="font-bold text-ink">{{ psa.name }}</span>
                                                <span class="text-caption text-muted">({{ psa.studentId }})</span>
                                                <span class="rounded px-1.5 py-0.5 text-[10px] font-bold"
                                                      :class="psa.suitability?.status === 'SUITABLE' ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'">
                                                    {{ psa.suitability?.label || 'Verified' }}
                                                </span>
                                            </div>
                                            <div class="mt-0.5 text-caption text-muted">
                                                {{ psa.course }} · Yr {{ psa.yearLevel }} · Category: <strong>{{ psa.category }}</strong>
                                            </div>
                                        </div>
                                        <div class="sm:text-right">
                                            <div class="text-[13px] font-bold"
                                                 :class="psa.needsCoordinatorReview ? 'text-amber-700' : 'text-navy'">
                                                {{ psa.creditedHours }} credited hrs/wk
                                            </div>
                                            <div class="text-[11px] text-muted">{{ psa.rawHours }} raw hrs</div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div v-else class="rounded-lg border border-danger/30 bg-danger/5 p-3 text-caption text-danger flex items-center justify-between gap-2">
                                <span class="font-semibold flex items-center gap-1.5">
                                    <app-icon name="CircleAlert" :size="14" />
                                    Uncovered Room: No Primary S.A. assigned yet.
                                </span>
                                <button @click="openReassignModal(post, null)" class="btn btn-secondary btn-xs">
                                    Assign Primary S.A.
                                </button>
                            </div>
                        </div>

                        <!-- SECTION B: RELIEVER S.A. (ITO LABORATORIES ONLY) -->
                        <div v-if="post.department === 'ITO'" class="mt-3 pt-2.5 border-t border-dashed border-line">
                            <div class="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                                <span class="inline-flex items-center gap-1.5 rounded border border-teal-400 bg-teal-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-teal-950">
                                    RELIEVER — Backup or Coverage Only
                                </span>
                                <button @click="openReliefModal(post)"
                                        class="text-[11px] font-bold text-teal-800 hover:underline inline-flex items-center gap-1">
                                    <app-icon name="CalendarPlus" :size="12" /> + Record Reliever Coverage
                                </button>
                            </div>

                            <!-- ITO Simultaneous Class Window Relievers -->
                            <div v-if="post.relieverSas && post.relieverSas.length" class="space-y-2 mb-2">
                                <div v-for="rsa in post.relieverSas" :key="rsa.slotId"
                                     class="rounded-lg border border-teal-300 bg-teal-50/70 p-2.5">
                                    <div class="flex flex-wrap items-center justify-between gap-2">
                                        <div>
                                            <div class="flex flex-wrap items-center gap-1.5">
                                                <span class="rounded bg-teal-700 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">RELIEVER</span>
                                                <span class="font-bold text-teal-950">{{ rsa.name }}</span>
                                                <span class="text-caption text-teal-800">({{ rsa.studentId }})</span>
                                                <span v-if="rsa.donorRoom" class="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-teal-900 border border-teal-200">
                                                    Home Room: {{ rsa.donorRoom }}
                                                </span>
                                            </div>
                                            <div class="text-[11px] text-teal-800 mt-0.5">
                                                Covers simultaneous Primary S.A. class hours · Not permanent owner of {{ post.room }}
                                            </div>
                                        </div>
                                        <div class="text-right flex items-center gap-2">
                                            <div class="text-[12px] font-bold text-teal-950">{{ rsa.creditedHours }}h reliever duty</div>
                                            <button @click="goRecommendations({ room: 'RELIEVER — ' + rsa.name, key: 'ITO|RELIEVER-' + rsa.saId })"
                                                    class="btn btn-secondary btn-2xs text-[10px] inline-flex items-center gap-1"
                                                    title="View Reliever Weekly Duty Grid">
                                                <app-icon name="Calendar" :size="11" /> Grid
                                            </button>
                                        </div>
                                    </div>
                                    <div v-if="rsa.duty && rsa.duty.length" class="mt-1.5 flex flex-wrap gap-1">
                                        <span v-for="(db, dbi) in rsa.duty" :key="dbi"
                                              class="inline-flex items-center gap-1 rounded border border-teal-300 bg-white px-2 py-0.5 text-[10px] text-teal-950">
                                            <strong>{{ db.day }}</strong> {{ db.startLabel }}–{{ db.endLabel }}
                                        </span>
                                    </div>
                                </div>
                            </div>

                            <!-- Active Date-Specific Reliever Coverages -->
                            <div v-if="post.activeReliefCoverages && post.activeReliefCoverages.length" class="space-y-2">
                                <div v-for="cov in post.activeReliefCoverages" :key="cov.id"
                                     class="rounded-lg border border-teal-300 bg-teal-50/50 p-2.5 text-caption">
                                    <div class="flex flex-wrap items-center justify-between gap-2">
                                        <div class="flex flex-wrap items-center gap-1.5">
                                            <span class="rounded bg-teal-700 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">RELIEVER</span>
                                            <strong class="text-teal-950">{{ cov.relieverName }}</strong>
                                            <span class="text-teal-800">({{ cov.relieverStudentId }})</span>
                                        </div>
                                        <div class="flex items-center gap-1">
                                            <button @click="updateReliefStatus(cov, 'COMPLETED')"
                                                    class="rounded bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-emerald-700">
                                                End / Complete
                                            </button>
                                            <button @click="updateReliefStatus(cov, 'CANCELLED')"
                                                    class="rounded bg-white border border-line px-2 py-0.5 text-[10px] font-semibold text-muted hover:text-danger">
                                                Cancel
                                            </button>
                                        </div>
                                    </div>
                                    <div class="mt-1 text-[11px] text-teal-900">
                                        <strong>{{ cov.coverageDate }} ({{ cov.dayOfWeek }})</strong> · {{ cov.startLabel }} – {{ cov.endLabel }} ({{ cov.hours }}h)
                                        · Relieving: <strong>{{ cov.primaryName }}</strong>
                                    </div>
                                    <div class="mt-0.5 text-[11px] text-muted">
                                        Reason: {{ cov.reason }} · Confirmed by {{ cov.confirmedBy }}
                                    </div>
                                </div>
                            </div>

                            <!-- Warning when Reliever is needed and none is available -->
                            <div v-if="post.coverageStatus === 'RELIEVER_NEEDED'"
                                 class="rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-caption text-amber-950 flex items-center justify-between gap-2">
                                <span class="font-semibold flex items-center gap-1.5">
                                    <app-icon name="TriangleAlert" :size="14" class="text-amber-700 shrink-0" />
                                    Reliever Needed: Simultaneous Primary class window has no qualified Reliever assigned.
                                </span>
                                <button @click="openReliefModal(post)" class="btn btn-secondary btn-xs shrink-0">
                                    Assign Reliever
                                </button>
                            </div>

                            <div v-else-if="(!post.relieverSas || !post.relieverSas.length) && (!post.activeReliefCoverages || !post.activeReliefCoverages.length)"
                                 class="text-[11px] text-muted italic">
                                No Reliever S.A. currently active for this room. Primary S.A. covers regular schedule.
                            </div>
                        </div>
                    </div>

                    <!-- Card Footer Actions -->
                    <div class="mt-4 pt-3 border-t border-line flex flex-wrap items-center justify-between gap-2 text-caption">
                        <button v-if="post.department === 'ITO'" @click="openRoomDetails(post)"
                                class="font-semibold text-navy hover:underline inline-flex items-center gap-1">
                            <app-icon name="Info" :size="14" />
                            Room Details, Criteria &amp; History ({{ (post.assignmentHistory || []).length }})
                        </button>
                        <span v-else></span>
                        <div class="flex items-center gap-2">
                            <button v-if="post.department === 'ITO'" @click="openReliefModal(post)" class="btn btn-secondary btn-xs">
                                <app-icon name="Repeat" :size="12" /> Reliever
                            </button>
                            <button @click="goRecommendations(post)" class="btn btn-secondary btn-xs" title="View Weekly Duty Grid for this room">
                                <app-icon name="Calendar" :size="12" /> Duty Grid
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 4B. READABLE TABLE VIEW -->
            <div v-else class="card overflow-hidden">
                <div class="overflow-x-auto">
                    <table class="w-full text-left border-collapse">
                        <thead>
                            <tr class="border-b border-line bg-page text-[11px] font-bold uppercase tracking-wider text-muted">
                                <th class="py-3 px-4">Room / Dept</th>
                                <th class="py-3 px-4">Assigned Days &amp; Periods</th>
                                <th class="py-3 px-4">Primary S.A. (Official Assignment)</th>
                                <th class="py-3 px-4">Reliever S.A. (Backup / Temp)</th>
                                <th class="py-3 px-4">Suitability</th>
                                <th class="py-3 px-4">Approval &amp; Coverage</th>
                                <th class="py-3 px-4 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-line text-caption">
                            <tr v-for="post in boardPosts" :key="post.key" class="hover:bg-page/50 align-top">
                                <!-- Room / Dept -->
                                <td class="py-3.5 px-4">
                                    <div class="flex items-center gap-1.5">
                                        <span class="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
                                              :class="post.department === 'ITO'
                                                  ? 'bg-sky-100 text-sky-900'
                                                  : (post.department === 'ACADS' ? 'bg-indigo-100 text-indigo-900' : 'bg-emerald-100 text-emerald-900')">
                                            {{ post.department }}
                                        </span>
                                        <strong class="text-[14px] text-navy">{{ post.room }}</strong>
                                    </div>
                                    <div class="mt-0.5 text-[11px] text-muted">{{ post.building }}</div>
                                </td>

                                <!-- Assigned Days & Periods -->
                                <td class="py-3.5 px-4">
                                    <div class="font-semibold text-ink">{{ post.scheduleSummary?.daysLabel || 'Mon – Sat' }}</div>
                                    <div class="text-[11px] text-muted">{{ post.scheduleSummary?.operatingHoursLabel }}</div>
                                    <div class="mt-0.5 text-[11px] text-muted">Required Primary: <strong>{{ post.requiredSa }}</strong></div>
                                </td>

                                <!-- Primary S.A. -->
                                <td class="py-3.5 px-4">
                                    <div v-if="post.primarySas && post.primarySas.length" class="space-y-2">
                                        <div v-for="psa in post.primarySas" :key="psa.slotId"
                                             class="rounded border border-line bg-page/60 p-2">
                                            <div class="flex items-center gap-1.5">
                                                <span class="rounded bg-navy px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">PRIMARY</span>
                                                <strong class="text-ink">{{ psa.name }}</strong>
                                                <span class="text-[11px] text-muted">({{ psa.studentId }})</span>
                                            </div>
                                            <div class="mt-0.5 text-[11px] text-muted">
                                                {{ psa.course }} · <strong>{{ psa.creditedHours }} credited hrs/wk</strong>
                                            </div>
                                        </div>
                                    </div>
                                    <span v-else class="inline-flex items-center gap-1 rounded bg-danger/10 px-2 py-1 text-[11px] font-bold text-danger">
                                        <app-icon name="CircleAlert" :size="12" /> Unassigned ({{ post.missingSaCount }} missing)
                                    </span>
                                </td>

                                <!-- Reliever S.A. -->
                                <td class="py-3.5 px-4">
                                    <div v-if="post.department === 'ITO'">
                                        <div v-if="(post.relieverSas && post.relieverSas.length) || (post.activeReliefCoverages && post.activeReliefCoverages.length)"
                                             class="space-y-1.5">
                                            <div v-for="rsa in post.relieverSas" :key="rsa.slotId"
                                                 @click="goRecommendations({ room: 'RELIEVER — ' + rsa.name, key: 'ITO|RELIEVER-' + rsa.saId })"
                                                 class="rounded border border-teal-300 bg-teal-50/70 p-2 cursor-pointer hover:bg-teal-100/80 transition"
                                                 title="View Reliever Weekly Duty Grid">
                                                <div class="flex items-center justify-between gap-1">
                                                    <div class="flex items-center gap-1.5">
                                                        <span class="rounded bg-teal-700 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">RELIEVER</span>
                                                        <strong class="text-teal-950">{{ rsa.name }}</strong>
                                                    </div>
                                                    <app-icon name="Calendar" :size="12" class="text-teal-700 shrink-0" />
                                                </div>
                                                <div class="mt-0.5 text-[11px] text-teal-800">
                                                    {{ rsa.creditedHours }}h backup · Click to view Weekly Grid
                                                </div>
                                            </div>
                                            <div v-for="cov in post.activeReliefCoverages" :key="cov.id"
                                                 class="rounded border border-teal-300 bg-teal-50/50 p-2">
                                                <div class="flex items-center gap-1.5">
                                                    <span class="rounded bg-teal-700 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">RELIEVER (TEMP)</span>
                                                    <strong class="text-teal-950">{{ cov.relieverName }}</strong>
                                                </div>
                                                <div class="mt-0.5 text-[11px] text-teal-800">
                                                    {{ cov.coverageDate }} · {{ cov.startLabel }}–{{ cov.endLabel }}
                                                </div>
                                            </div>
                                        </div>
                                        <span v-else-if="post.coverageStatus === 'RELIEVER_NEEDED'"
                                              class="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-900">
                                            <app-icon name="TriangleAlert" :size="12" /> Reliever Needed
                                        </span>
                                        <span v-else class="text-[11px] text-muted">— None needed</span>
                                    </div>
                                    <span v-else class="text-[11px] text-muted italic">— Not applicable</span>
                                </td>

                                <!-- Suitability -->
                                <td class="py-3.5 px-4">
                                    <span class="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-bold"
                                          :class="post.suitability?.status === 'SUITABLE'
                                              ? 'bg-emerald-100 text-emerald-900'
                                              : (post.suitability?.status === 'PARTIAL' ? 'bg-amber-100 text-amber-900' : 'bg-danger/10 text-danger')">
                                        {{ post.suitability?.label }}
                                    </span>
                                    <div v-if="post.suitability?.warnings?.length" class="mt-1 text-[11px] text-amber-800">
                                        {{ post.suitability.warnings[0] }}
                                    </div>
                                </td>

                                <!-- Approval & Coverage -->
                                <td class="py-3.5 px-4 space-y-1">
                                    <div>
                                        <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                                              :class="post.accepted ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'">
                                            {{ post.approvalLabel }}
                                        </span>
                                    </div>
                                    <div>
                                        <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                                              :class="post.coverageStatus === 'UNCOVERED'
                                                  ? 'bg-danger/10 text-danger'
                                                  : (post.coverageStatus === 'RELIEVER_NEEDED' ? 'bg-amber-100 text-amber-900' : 'bg-teal-100 text-teal-900')">
                                            {{ post.coverageLabel }}
                                        </span>
                                    </div>
                                </td>

                                <!-- Actions -->
                                <td class="py-3.5 px-4 text-right">
                                    <div class="inline-flex flex-wrap justify-end gap-1.5">
                                        <button @click="openRoomDetails(post)" class="btn btn-secondary btn-xs">Details</button>
                                        <button v-if="post.department === 'ITO'" @click="openReliefModal(post)" class="btn btn-secondary btn-xs">+ Reliever</button>
                                        <button @click="goRecommendations(post)" class="btn btn-secondary btn-xs inline-flex items-center gap-1">
                                            <app-icon name="Calendar" :size="12" /> Duty Grid
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </section>

        <!-- MODAL 1: ROOM DETAILS (MATCHING CRITERIA, SCHEDULE, RELIEVERS, WARNINGS & AUDIT HISTORY) -->
        <app-modal :open="detailsModal.open"
                   :title="detailsModal.post ? ('Room Details: ' + detailsModal.post.room + ' (' + detailsModal.post.department + ')') : 'Room Details'"
                   size="lg"
                   @close="detailsModal.open = false">
            <div v-if="detailsModal.post" class="space-y-4 text-caption">
                <!-- Criteria & Suitability Grid -->
                <div class="grid gap-3 sm:grid-cols-2">
                    <div class="rounded-lg border border-line bg-page p-3.5">
                        <div class="font-bold uppercase tracking-wider text-[11px] text-navy mb-2">Matching Criteria &amp; Rules</div>
                        <dl class="space-y-1">
                            <div class="flex justify-between"><dt class="text-muted">Department / Type:</dt><dd class="font-semibold">{{ detailsModal.post.matchingCriteria?.department }} ({{ detailsModal.post.matchingCriteria?.roomType }})</dd></div>
                            <div class="flex justify-between"><dt class="text-muted">Required Primary S.A.:</dt><dd class="font-semibold">{{ detailsModal.post.matchingCriteria?.requiredPrimarySa }} Primary S.A.(s)</dd></div>
                            <div class="flex justify-between"><dt class="text-muted">Weekly Duty Limit:</dt><dd class="font-semibold">{{ detailsModal.post.matchingCriteria?.minWeeklyHours }}–{{ detailsModal.post.matchingCriteria?.maxWeeklyHours }} credited hrs/wk</dd></div>
                            <div class="pt-1 text-[11px] text-muted border-t border-line mt-1">
                                <strong>Reliever Rule:</strong> {{ detailsModal.post.matchingCriteria?.relieverPolicy }}
                            </div>
                        </dl>
                    </div>

                    <div class="rounded-lg border border-line bg-page p-3.5">
                        <div class="font-bold uppercase tracking-wider text-[11px] text-navy mb-2">Suitability &amp; Warnings</div>
                        <div class="font-bold text-[13px]"
                             :class="detailsModal.post.suitability?.status === 'SUITABLE' ? 'text-emerald-700' : 'text-amber-800'">
                            {{ detailsModal.post.suitability?.label }}
                        </div>
                        <ul v-if="detailsModal.post.suitability?.warnings?.length" class="mt-2 space-y-1 text-danger font-medium">
                            <li v-for="(w, wi) in detailsModal.post.suitability.warnings" :key="wi" class="flex items-start gap-1.5">
                                <app-icon name="TriangleAlert" :size="13" class="shrink-0 mt-0.5" />
                                <span>{{ w }}</span>
                            </li>
                        </ul>
                        <ul v-else class="mt-2 space-y-1 text-emerald-800">
                            <li v-for="(chk, ci) in (detailsModal.post.suitability?.passedChecks || []).slice(0, 4)" :key="ci" class="flex items-start gap-1.5">
                                <app-icon name="Check" :size="13" class="shrink-0 mt-0.5" />
                                <span>{{ chk }}</span>
                            </li>
                        </ul>
                    </div>
                </div>

                <!-- Operating Schedule -->
                <div class="rounded-lg border border-line p-3.5">
                    <div class="font-bold uppercase tracking-wider text-[11px] text-navy mb-2">Room Operating Schedule</div>
                    <div class="flex flex-wrap gap-1.5">
                        <span v-for="(per, pi) in (detailsModal.post.scheduleSummary?.periods || [])" :key="pi"
                              class="rounded border border-line bg-page px-2.5 py-1 text-[11px] font-medium text-ink">
                            {{ per }}
                        </span>
                    </div>
                </div>

                <!-- Reliever Coverage Records -->
                <div class="rounded-lg border border-line p-3.5">
                    <div class="flex items-center justify-between mb-2">
                        <span class="font-bold uppercase tracking-wider text-[11px] text-teal-900">
                            Reliever Coverage Records ({{ (detailsModal.post.tempReliefCoverages || []).length }})
                        </span>
                        <button @click="openReliefModal(detailsModal.post)" class="btn btn-secondary btn-xs">
                            + Record Coverage
                        </button>
                    </div>
                    <div v-if="detailsModal.post.tempReliefCoverages && detailsModal.post.tempReliefCoverages.length" class="space-y-2 max-h-44 overflow-y-auto">
                        <div v-for="rc in detailsModal.post.tempReliefCoverages" :key="rc.id"
                             class="rounded border border-line bg-page/60 p-2.5 flex flex-wrap items-center justify-between gap-2">
                            <div>
                                <div class="flex items-center gap-1.5">
                                    <span class="rounded bg-teal-700 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">RELIEVER</span>
                                    <strong>{{ rc.relieverName }}</strong>
                                    <span class="text-muted">({{ rc.relieverStudentId }})</span>
                                    <span class="rounded px-1.5 py-0.5 text-[10px] font-bold"
                                          :class="rc.status === 'ACTIVE' ? 'bg-teal-100 text-teal-900' : (rc.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-900' : 'bg-gray-200 text-gray-700')">
                                        {{ rc.status }}
                                    </span>
                                </div>
                                <div class="text-[11px] text-muted mt-0.5">
                                    Date: <strong>{{ rc.coverageDate }} ({{ rc.dayOfWeek }})</strong> · {{ rc.startLabel }}–{{ rc.endLabel }}
                                    · Relieving Primary: <strong>{{ rc.primaryName }}</strong>
                                </div>
                                <div class="text-[11px] text-muted">
                                    Reason: {{ rc.reason }} · Confirmed by {{ rc.confirmedBy }} · Outcome: {{ rc.outcome }}
                                </div>
                            </div>
                            <div v-if="rc.status === 'ACTIVE'" class="flex items-center gap-1">
                                <button @click="updateReliefStatus(rc, 'COMPLETED')" class="btn btn-primary btn-xs">Mark Completed</button>
                                <button @click="updateReliefStatus(rc, 'CANCELLED')" class="btn btn-secondary btn-xs">Cancel</button>
                            </div>
                        </div>
                    </div>
                    <p v-else class="text-muted italic">No Reliever coverages recorded for this room yet.</p>
                </div>

                <!-- Assignment & Audit History -->
                <div class="rounded-lg border border-line p-3.5">
                    <div class="font-bold uppercase tracking-wider text-[11px] text-navy mb-2">
                        Room Assignment &amp; Audit History ({{ (detailsModal.post.assignmentHistory || []).length }})
                    </div>
                    <div v-if="detailsModal.post.assignmentHistory && detailsModal.post.assignmentHistory.length"
                         class="space-y-2 max-h-48 overflow-y-auto">
                        <div v-for="h in detailsModal.post.assignmentHistory" :key="h.id"
                             class="rounded border border-line bg-page/40 p-2.5">
                            <div class="flex flex-wrap items-center justify-between gap-1">
                                <div class="flex items-center gap-1.5">
                                    <span class="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase"
                                          :class="h.roleType === 'RELIEVER' ? 'bg-teal-100 text-teal-900' : 'bg-navy/10 text-navy'">
                                        {{ h.roleType }}
                                    </span>
                                    <strong class="text-ink">{{ h.actionType }}</strong>
                                </div>
                                <span class="text-[11px] text-muted">{{ h.createdAt }} · {{ h.actedBy }}</span>
                            </div>
                            <div class="mt-1 text-ink">{{ h.summary }}</div>
                            <div v-if="h.reason" class="mt-0.5 text-[11px] text-muted">
                                <strong>Reason / Notes:</strong> {{ h.reason }}
                            </div>
                        </div>
                    </div>
                    <p v-else class="text-muted italic">No assignment changes logged yet.</p>
                </div>

                <!-- Jump to Duty Grid in Recommendations -->
                <div class="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-line mt-2">
                    <span class="text-caption text-muted">Weekly duty blocks, partner class overlaps &amp; lunch rules:</span>
                    <button @click="goRecommendations(detailsModal.post)" class="btn btn-primary btn-sm flex items-center gap-1.5">
                        <app-icon name="Calendar" :size="14" />
                        <span>View {{ detailsModal.post.room }} in Duty Grid</span>
                    </button>
                </div>
            </div>
        </app-modal>


        <!-- MODAL 3: RELIEVER COVERAGE (SEPARATE FROM PRIMARY ASSIGNMENT) -->
        <app-modal :open="reliefModal.open"
                   :title="'Record Reliever Coverage — ' + reliefModal.room"
                   size="lg"
                   @close="reliefModal.open = false">
            <div class="space-y-4 text-caption">
                <div class="rounded-lg border border-teal-300 bg-teal-50/80 p-3 text-teal-950">
                    <strong>Reliever Rule:</strong> A Reliever S.A. provides backup coverage only and is not the permanent owner of <strong>{{ reliefModal.room }}</strong>. After coverage ends, the original <strong>Primary S.A.</strong> assignment remains unchanged.
                </div>

                <div class="grid gap-3 sm:grid-cols-3">
                    <div>
                        <label class="block font-semibold text-ink mb-1">Coverage Date</label>
                        <input v-model="reliefModal.coverageDate" @change="checkReliefCandidates" type="date" class="input input-sm w-full" />
                    </div>
                    <div>
                        <label class="block font-semibold text-ink mb-1">Start Time</label>
                        <select v-model="reliefModal.startTime" @change="checkReliefCandidates" class="input input-sm w-full">
                            <option v-for="t in TIME_OPTIONS" :key="'rs-' + t.value" :value="t.value">{{ t.label }}</option>
                        </select>
                    </div>
                    <div>
                        <label class="block font-semibold text-ink mb-1">End Time</label>
                        <select v-model="reliefModal.endTime" @change="checkReliefCandidates" class="input input-sm w-full">
                            <option v-for="t in TIME_OPTIONS" :key="'re-' + t.value" :value="t.value">{{ t.label }}</option>
                        </select>
                    </div>
                </div>

                <!-- Candidate Check Results -->
                <div v-if="reliefModal.checking" class="rounded-lg border border-line p-4 text-center text-muted">
                    Checking S.A. availability, Registrar class conflicts, eligibility, and overlapping duties...
                </div>

                <template v-else-if="reliefModal.candidateResult">
                    <div v-if="reliefModal.candidateResult.existingActiveCoverage"
                         class="rounded-lg border border-amber-300 bg-amber-50 p-3.5 text-amber-950 font-semibold">
                        <div class="flex items-center gap-1.5">
                            <app-icon name="TriangleAlert" :size="15" class="text-amber-800 shrink-0" />
                            <span>{{ reliefModal.candidateResult.warning }}</span>
                        </div>
                    </div>

                    <div v-else-if="!reliefModal.candidateResult.hasQualifiedReliever"
                         class="rounded-lg border border-danger/40 bg-danger/5 p-3.5 text-danger font-semibold">
                        <div class="flex items-center gap-1.5">
                            <app-icon name="TriangleAlert" :size="15" class="shrink-0" />
                            <span>{{ reliefModal.candidateResult.warning }}</span>
                        </div>
                    </div>

                    <div v-else>
                        <label class="block font-semibold text-ink mb-1">
                            Select Qualified &amp; Conflict-Free Reliever S.A. ({{ reliefModal.candidateResult.qualified.length }} available)
                        </label>
                        <select v-model.number="reliefModal.relieverSaId" class="input input-sm w-full">
                            <option v-for="qSa in reliefModal.candidateResult.qualified" :key="qSa.saId" :value="qSa.saId">
                                [RELIEVER] {{ qSa.name }} ({{ qSa.studentId }}) — {{ qSa.course }} · {{ qSa.category }} (0 Conflicts)
                            </option>
                        </select>
                    </div>

                    <details v-if="reliefModal.candidateResult.unavailable && reliefModal.candidateResult.unavailable.length"
                             class="rounded-lg border border-line bg-page p-2.5">
                        <summary class="cursor-pointer font-semibold text-muted">
                            View Unavailable / Conflicting S.A.s ({{ reliefModal.candidateResult.unavailable.length }} excluded)
                        </summary>
                        <ul class="mt-2 space-y-1 text-[11px] text-muted max-h-32 overflow-y-auto">
                            <li v-for="uSa in reliefModal.candidateResult.unavailable" :key="uSa.saId">
                                <strong class="text-ink">{{ uSa.name }} ({{ uSa.category }}):</strong>
                                <span class="text-danger"> {{ (uSa.failedChecks || []).join('; ') }}</span>
                            </li>
                        </ul>
                    </details>
                </template>

                <div>
                    <label class="block font-semibold text-ink mb-1">Coverage Reason <span class="text-danger">*</span></label>
                    <input v-model="reliefModal.reason" type="text" class="input input-sm w-full"
                           placeholder="e.g., Primary S.A. departmental exam / sick leave / official activity" />
                </div>

                <div>
                    <label class="block font-semibold text-ink mb-1">Expected Outcome / Notes</label>
                    <input v-model="reliefModal.outcome" type="text" class="input input-sm w-full" />
                </div>

                <div class="flex justify-end gap-2 pt-2">
                    <button @click="reliefModal.open = false" class="btn btn-secondary btn-sm">Cancel</button>
                    <button @click="submitReliefCoverage"
                            :disabled="busy || !reliefModal.relieverSaId || reliefModal.candidateResult?.existingActiveCoverage"
                            class="btn btn-primary btn-sm">
                        <app-icon name="Check" :size="14" /> Confirm Reliever Coverage
                    </button>
                </div>
            </div>
        </app-modal>

        <!-- MODAL 4: PRE-APPROVAL RESOLVE OR POST-APPROVAL AUTHORIZED REASSIGNMENT -->
        <app-modal :open="reassignModal.open"
                   :title="(reassignModal.isLockedOverride ? 'Authorized Reassignment Workflow — ' : 'Assign / Change Primary S.A. — ') + reassignModal.room"
                   @close="reassignModal.open = false">
            <div class="space-y-4 text-caption">
                <div v-if="reassignModal.isLockedOverride"
                     class="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950">
                    <strong>Approved Batch Exception:</strong> Because this matching batch is locked, reassigning a Primary S.A. requires an official reason and will be recorded in the room's permanent audit history.
                </div>

                <div v-if="reassignModal.dropSaName" class="rounded-lg border border-line bg-page p-3">
                    <span class="text-muted">Current Primary S.A.:</span>
                    <strong class="ml-1 text-ink">{{ reassignModal.dropSaName }}</strong>
                </div>

                <div v-if="reassignModal.candidates && reassignModal.candidates.length">
                    <label class="block font-semibold text-ink mb-1">
                        Select Eligible Unassigned Primary S.A. ({{ reassignModal.department }})
                        <span class="text-muted font-normal text-xs ml-1">({{ reassignModal.candidates.length }} unassigned available)</span>
                    </label>
                    <select v-model.number="reassignModal.pickSaId" class="input input-sm w-full">
                        <option v-for="c in reassignModal.candidates" :key="c.saId" :value="c.saId">
                            [PRIMARY] {{ c.name }} ({{ c.studentId }}) — {{ c.course }} · ~{{ c.creditedHours }}h/wk ({{ c.score }} pts)
                        </option>
                    </select>
                </div>
                <div v-else class="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-950 font-semibold flex items-center gap-2">
                    <app-icon name="TriangleAlert" :size="16" class="text-amber-800 shrink-0" />
                    <span>All {{ reassignModal.department }} S.A.s are currently matched and assigned to rooms. No unassigned S.A. is available in the pool.</span>
                </div>

                <div>
                    <label class="block font-semibold text-ink mb-1">
                        Reason for Assignment / Reassignment
                        <span v-if="reassignModal.isLockedOverride" class="text-danger">* (Required)</span>
                    </label>
                    <textarea v-model="reassignModal.reason" rows="3" class="input w-full"
                              placeholder="Enter official reason for this assignment update..."></textarea>
                </div>

                <div class="flex justify-end gap-2 pt-2">
                    <button @click="reassignModal.open = false" class="btn btn-secondary btn-sm">Cancel</button>
                    <button @click="submitReassign" :disabled="busy || !reassignModal.pickSaId" class="btn btn-primary btn-sm">
                        {{ reassignModal.isLockedOverride ? 'Confirm Authorized Reassignment' : 'Save Primary Assignment' }}
                    </button>
                </div>
            </div>
        </app-modal>

        <!-- MODAL 5: REASSIGNMENT POOL MANAGER -->
        <app-modal :open="poolModal.open"
                   title="Unassigned & Marked-for-Reassignment S.A. Pool"
                   size="lg"
                   @close="poolModal.open = false">
            <div class="space-y-4 text-caption">
                <p class="text-muted">
                    New, unassigned, or explicitly marked-for-reassignment S.A.s enter the incremental matching pool without disturbing valid existing room assignments.
                </p>

                <div class="rounded-lg border border-line bg-page p-3 space-y-2">
                    <div class="font-bold text-navy">Mark an S.A. for the Reassignment Pool</div>
                    <div class="grid gap-2 sm:grid-cols-3">
                        <select v-model.number="poolModal.saId" class="input input-sm">
                            <option v-for="s in pool" :key="s.id" :value="s.id">
                                {{ s.name }} ({{ s.studentId }}) — {{ s.category }} [{{ s.assignmentStatus }}]
                            </option>
                        </select>
                        <input v-model="poolModal.reason" type="text" class="input input-sm"
                               placeholder="Reason for reassignment..." />
                        <button @click="toggleMarkForReassignment(poolModal.saId, true)"
                                :disabled="busy || !poolModal.saId"
                                class="btn btn-primary btn-sm">
                            Mark for Reassignment
                        </button>
                    </div>
                </div>

                <div class="max-h-64 overflow-y-auto divide-y divide-line border border-line rounded-lg">
                    <div v-for="s in pool" :key="'pm-' + s.id" class="p-2.5 flex items-center justify-between gap-2">
                        <div>
                            <div class="font-semibold text-ink">
                                {{ s.name }} <span class="text-muted">({{ s.studentId }})</span>
                                <span class="ml-1 rounded bg-navy/10 px-1.5 py-0.5 text-[10px] font-bold text-navy">{{ s.category }}</span>
                                <span v-if="s.assignmentStatus === 'UNASSIGNED'"
                                      class="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-900">
                                    UNASSIGNED
                                </span>
                                <span v-if="s.markedForReassignment"
                                      class="ml-1 rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-bold text-purple-900">
                                    MARKED FOR REASSIGNMENT
                                </span>
                            </div>
                            <div v-if="s.reassignmentReason" class="text-[11px] text-muted">
                                Reason: {{ s.reassignmentReason }}
                            </div>
                        </div>
                        <button v-if="s.markedForReassignment"
                                @click="toggleMarkForReassignment(s.id, false)"
                                class="btn btn-secondary btn-xs">
                            Clear Flag
                        </button>
                    </div>
                </div>
            </div>
        </app-modal>
    </template>
    `,
};
