// Coordinator / Admin > Requests (#/admin/requests)
// Verifies and records Supervisor-approved requests.
const AdminRequestsPage = {
    components: { AppIcon, PageHeader, AppModal, StatusBadge },

    setup() {
        const loading = Vue.ref(true);
        const loadError = Vue.ref("");
        const requests = Vue.ref([]);
        const summary = Vue.ref({
            total: 0,
            pendingSupervisorReview: 0,
            pendingCoordinatorRecording: 0,
            returnedForClarification: 0,
            recorded: 0,
            rejected: 0
        });

        const searchQuery = Vue.ref("");
        const filterDepartment = Vue.ref("");
        const filterType = Vue.ref("");
        const filterStatus = Vue.ref("");

        const showDetailModal = Vue.ref(false);
        const detailLoading = Vue.ref(false);
        const selectedRequest = Vue.ref(null);
        const selectedHistory = Vue.ref([]);
        const coordinatorRemarks = Vue.ref("");
        const actionError = Vue.ref("");
        const submitting = Vue.ref(false);
        const coordinatorSignature = Vue.ref("");
        const coordinatorCanvasRef = Vue.ref(null);
        const coordinatorDecisionSelection = Vue.ref("APPROVED");
        const today = (new Date()).toLocaleDateString("en-CA");
        let coordPad = null;

        const drawFlourishOnCanvas = (canvas, role = "coordinator") => {
            if (!canvas) return;
            const ctx = canvas.getContext("2d");
            ctx.save();
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = "#FFFFFF";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.strokeStyle = "#0F2C59";
            ctx.lineWidth = 2.5;
            ctx.lineCap = "round";
            ctx.lineJoin = "round";

            const cx = canvas.width / 2;
            const cy = canvas.height / 2;

            ctx.beginPath();
            if (role === "supervisor") {
                ctx.moveTo(cx - 85, cy + 5);
                ctx.bezierCurveTo(cx - 75, cy - 28, cx - 55, cy - 32, cx - 45, cy - 12);
                ctx.bezierCurveTo(cx - 35, cy + 8, cx - 60, cy + 12, cx - 72, cy + 20);
                ctx.bezierCurveTo(cx - 40, cy - 2, cx - 12, cy - 6, cx + 15, cy - 16);
                ctx.bezierCurveTo(cx + 35, cy - 22, cx + 52, cy - 4, cx + 38, cy + 8);
                ctx.bezierCurveTo(cx + 22, cy + 16, cx + 58, cy + 6, cx + 92, cy - 10);
                ctx.moveTo(cx - 68, cy + 24);
                ctx.bezierCurveTo(cx - 12, cy + 28, cx + 45, cy + 22, cx + 96, cy + 18);
            } else {
                ctx.moveTo(cx - 80, cy - 15);
                ctx.bezierCurveTo(cx - 65, cy + 22, cx - 55, cy + 24, cx - 45, cy - 5);
                ctx.bezierCurveTo(cx - 40, cy - 22, cx - 25, cy - 18, cx - 15, cy + 2);
                ctx.bezierCurveTo(cx - 8, cy + 16, cx + 5, cy + 14, cx + 15, cy - 8);
                ctx.bezierCurveTo(cx + 25, cy - 24, cx + 45, cy + 26, cx + 55, cy - 18);
                ctx.bezierCurveTo(cx + 62, cy - 28, cx + 70, cy + 20, cx + 75, cy + 22);
                ctx.moveTo(cx - 60, cy - 8);
                ctx.bezierCurveTo(cx - 20, cy - 12, cx + 30, cy - 6, cx + 85, cy + 8);
            }
            ctx.stroke();
            ctx.restore();
        };

        const initCoordinatorCanvas = () => {
            Vue.nextTick(() => {
                const canvas = coordinatorCanvasRef.value;
                if (!canvas) return;

                if (typeof SignaturePad !== "undefined") {
                    if (canvas._sigPad) {
                        coordPad = canvas._sigPad;
                    } else {
                        coordPad = new SignaturePad(canvas, {
                            penColor: "#0F2C59",
                            backgroundColor: "#FFFFFF",
                            minWidth: 1.5,
                            maxWidth: 3.5,
                            throttle: 16
                        });
                        canvas._sigPad = coordPad;
                    }

                    if (coordinatorSignature.value && coordinatorSignature.value.startsWith("data:image")) {
                        coordPad.fromDataURL(coordinatorSignature.value);
                    } else {
                        coordPad.clear();
                    }

                    if (canvas._endStrokeHandler) {
                        coordPad.removeEventListener("endStroke", canvas._endStrokeHandler);
                    }
                    canvas._endStrokeHandler = () => {
                        coordinatorSignature.value = canvas.toDataURL("image/png");
                    };
                    coordPad.addEventListener("endStroke", canvas._endStrokeHandler);
                    return;
                }

                // Fallback manual drawing
                const ctx = canvas.getContext("2d");
                if (coordinatorSignature.value && coordinatorSignature.value.startsWith("data:image")) {
                    const img = new Image();
                    img.onload = () => {
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    };
                    img.src = coordinatorSignature.value;
                } else {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                }

                if (canvas._initialized) return;
                canvas._initialized = true;

                let isDrawing = false;
                const getPos = e => {
                    const rect = canvas.getBoundingClientRect();
                    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
                    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
                    return {
                        x: (clientX - rect.left) * (canvas.width / (rect.width || canvas.width)),
                        y: (clientY - rect.top) * (canvas.height / (rect.height || canvas.height))
                    };
                };

                const startDraw = e => {
                    isDrawing = true;
                    const pos = getPos(e);
                    ctx.beginPath();
                    ctx.moveTo(pos.x, pos.y);
                    e.preventDefault();
                };

                const moveDraw = e => {
                    if (!isDrawing) return;
                    const pos = getPos(e);
                    ctx.lineTo(pos.x, pos.y);
                    ctx.strokeStyle = "#0F2C59";
                    ctx.lineWidth = 2.5;
                    ctx.lineCap = "round";
                    ctx.stroke();
                    e.preventDefault();
                };

                const stopDraw = () => {
                    if (!isDrawing) return;
                    isDrawing = false;
                    try {
                        coordinatorSignature.value = canvas.toDataURL("image/png");
                    } catch (_) {}
                };

                canvas.addEventListener("mousedown", startDraw);
                canvas.addEventListener("mousemove", moveDraw);
                canvas.addEventListener("mouseup", stopDraw);
                canvas.addEventListener("mouseleave", stopDraw);
                canvas.addEventListener("touchstart", startDraw, { passive: false });
                canvas.addEventListener("touchmove", moveDraw, { passive: false });
                canvas.addEventListener("touchend", stopDraw);
            });
        };

        const clearCoordinatorSignature = () => {
            if (coordPad) {
                coordPad.clear();
            } else if (coordinatorCanvasRef.value) {
                const ctx = coordinatorCanvasRef.value.getContext("2d");
                ctx.clearRect(0, 0, coordinatorCanvasRef.value.width, coordinatorCanvasRef.value.height);
            }
            coordinatorSignature.value = "";
        };

        const adoptCoordinatorElectronicSignature = () => {
            const canvas = coordinatorCanvasRef.value;
            if (!canvas) return "";
            drawFlourishOnCanvas(canvas, "coordinator");
            const dataUrl = canvas.toDataURL("image/png");
            coordinatorSignature.value = dataUrl;
            if (coordPad) {
                coordPad._isEmpty = false;
            }
            return dataUrl;
        };

        const departments = Vue.computed(() => {
            const set = new Set();
            requests.value.forEach(r => {
                if (r.department) set.add(r.department);
            });
            return Array.from(set).sort();
        });

        const filteredRequests = Vue.computed(() => {
            return requests.value.filter(req => {
                if (filterDepartment.value && req.department !== filterDepartment.value) return false;
                if (filterType.value && req.requestType !== filterType.value) return false;
                if (filterStatus.value && req.status !== filterStatus.value) return false;
                if (searchQuery.value) {
                    const q = searchQuery.value.toLowerCase();
                    const hay = [
                        req.requestCode,
                        req.saName,
                        req.studentId,
                        req.saNumber,
                        req.department,
                        req.supervisorName,
                        req.reasonCategory,
                        req.undertimeType,
                        req.explanation,
                        req.requestDate,
                        label("requestType", req.requestType),
                        label("requestStatus", req.status)
                    ].filter(Boolean).join(" ").toLowerCase();
                    if (!hay.includes(q)) return false;
                }
                return true;
            });
        });

        // DataTable state, sorting, and pagination
        const sortKey = Vue.ref("submittedAt");
        const sortDir = Vue.ref("desc");
        const page = Vue.ref(1);
        const pageSize = Vue.ref(10);

        const sortBy = (key) => {
            if (sortKey.value === key) {
                sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
            } else {
                sortKey.value = key;
                sortDir.value = (key === "submittedAt" || key === "requestDate") ? "desc" : "asc";
            }
            page.value = 1;
        };

        const getSortIcon = (key) => {
            if (sortKey.value !== key) return "ChevronsUpDown";
            return sortDir.value === "asc" ? "ChevronUp" : "ChevronDown";
        };

        Vue.watch([searchQuery, filterDepartment, filterType, filterStatus], () => {
            page.value = 1;
        });

        const sortedRequests = Vue.computed(() => {
            const list = [...filteredRequests.value];
            const key = sortKey.value;
            const dir = sortDir.value === "asc" ? 1 : -1;

            list.sort((a, b) => {
                let res = 0;
                if (key === "requestCode") {
                    res = (a.requestCode || "").localeCompare(b.requestCode || "");
                } else if (key === "saName") {
                    res = (a.saName || "").localeCompare(b.saName || "");
                } else if (key === "requestType") {
                    res = (a.requestType || "").localeCompare(b.requestType || "");
                } else if (key === "requestDate") {
                    const dateA = a.requestDate || a.dutyDate || "";
                    const dateB = b.requestDate || b.dutyDate || "";
                    res = dateA.localeCompare(dateB);
                } else if (key === "submittedAt") {
                    const dateA = a.submittedAt || a.createdAt || "";
                    const dateB = b.submittedAt || b.createdAt || "";
                    res = dateA.localeCompare(dateB);
                } else if (key === "status") {
                    res = (a.status || "").localeCompare(b.status || "");
                }
                return res * dir;
            });

            return list;
        });

        const pageCount = Vue.computed(() => {
            if (pageSize.value <= 0) return 1;
            return Math.max(1, Math.ceil(sortedRequests.value.length / pageSize.value));
        });

        const paginatedRequests = Vue.computed(() => {
            if (pageSize.value <= 0) return sortedRequests.value;
            const start = (page.value - 1) * pageSize.value;
            return sortedRequests.value.slice(start, start + pageSize.value);
        });

        const rangeText = Vue.computed(() => {
            const total = sortedRequests.value.length;
            if (!total) return "Showing 0 to 0 of 0 entries";
            if (pageSize.value <= 0) return `Showing 1 to ${total} of ${total} entries`;
            const from = (page.value - 1) * pageSize.value + 1;
            const to = Math.min(total, from + pageSize.value - 1);
            return `Showing ${from} to ${to} of ${total} entries`;
        });

        const visiblePages = Vue.computed(() => {
            const total = pageCount.value;
            const cur = page.value;
            if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
            const pages = [1];
            if (cur > 3) pages.push("...");
            const start = Math.max(2, cur - 1);
            const end = Math.min(total - 1, cur + 1);
            for (let i = start; i <= end; i++) pages.push(i);
            if (cur < total - 2) pages.push("...");
            pages.push(total);
            return pages;
        });

        const resetFilters = () => {
            searchQuery.value = "";
            filterDepartment.value = "";
            filterType.value = "";
            filterStatus.value = "";
            page.value = 1;
        };

        const canCoordinatorAct = req => {
            return Store.role === "admin" && req && req.status === "PENDING_COORDINATOR_RECORDING";
        };

        const route = VueRouter.useRoute ? VueRouter.useRoute() : null;

        const checkDeepLink = () => {
            if (!route) return;
            const targetRef = String(route.query.ref || route.query.requestCode || "").trim().toLowerCase();
            const targetId = Number(route.query.id || route.query.requestId || 0);
            if (!targetRef && !targetId) return;

            const match = requests.value.find(r => 
                (targetId && Number(r.id) === targetId) ||
                (targetRef && (
                    String(r.requestCode || "").trim().toLowerCase() === targetRef ||
                    String(r.referenceNumber || "").trim().toLowerCase() === targetRef ||
                    String(r.ref || "").trim().toLowerCase() === targetRef
                ))
            );
            if (match) {
                openDetails(match);
            } else if (targetId) {
                openDetails({ id: targetId });
            }
        };

        const loadData = async () => {
            loading.value = true;
            loadError.value = "";
            const res = await Model.request("requests", "admin_list");
            loading.value = false;
            if (!res.success) {
                loadError.value = res.message || "Could not load requests.";
                return;
            }
            requests.value = Array.isArray(res.requests) ? res.requests : [];
            if (res.summary) summary.value = res.summary;
            checkDeepLink();
        };

        if (route) {
            Vue.watch(() => [route.query.ref, route.query.requestCode, route.query.id], () => {
                checkDeepLink();
            });
        }

        const openDetails = async req => {
            selectedRequest.value = req;
            selectedHistory.value = [];
            coordinatorRemarks.value = "";
            coordinatorSignature.value = "";
            actionError.value = "";
            showDetailModal.value = true;
            initCoordinatorCanvas();
            detailLoading.value = true;
            const res = await Model.request("requests", "get", { id: req.id });
            detailLoading.value = false;
            if (res.success) {
                if (res.request) selectedRequest.value = res.request;
                selectedHistory.value = Array.isArray(res.history) ? res.history : [];
            }
        };

        const closeDetailModal = () => {
            showDetailModal.value = false;
            selectedRequest.value = null;
            selectedHistory.value = [];
            coordinatorRemarks.value = "";
            coordinatorSignature.value = "";
            actionError.value = "";
        };

        const submitCoordinatorAction = async actionName => {
            if (!selectedRequest.value) return;
            actionError.value = "";

            if (actionName === "coordinator_return_clarification" && !coordinatorRemarks.value) {
                actionError.value = "Please specify what clarification is needed before returning this request.";
                Alerts.warning("Clarification Required", actionError.value);
                return;
            }

            const isRecord = actionName === "coordinator_record";
            const ok = await Alerts.confirm({
                title: isRecord ? "Verify & Record Request?" : "Return for Clarification?",
                text: isRecord
                    ? `Officially record Request #${selectedRequest.value.id} (${selectedRequest.value.requestType}) for ${selectedRequest.value.saName}?`
                    : `Return Request #${selectedRequest.value.id} to the Supervisor and Student Assistant for clarification?`,
                icon: isRecord ? "question" : "warning",
                confirmText: isRecord ? "Yes, Record Request" : "Yes, Return Request",
                requireReason: false
            });
            if (!ok) return;

            if (!coordinatorSignature.value) {
                adoptCoordinatorElectronicSignature();
            }

            submitting.value = true;
            const res = await Model.request("requests", actionName, {
                id: selectedRequest.value.id,
                remarks: coordinatorRemarks.value,
                coordinatorSignature: coordinatorSignature.value
            });
            submitting.value = false;

            if (!res.success) {
                actionError.value = res.message || "Unable to process Coordinator action.";
                Alerts.error("Action Failed", actionError.value);
                return;
            }

            await Alerts.success("Decision Saved", res.message || "Coordinator decision saved.");
            if (Store.loadNotifications) Store.loadNotifications();
            await loadData();
            const detail = await Model.request("requests", "get", { id: selectedRequest.value.id });
            if (detail.success) {
                if (detail.request) selectedRequest.value = detail.request;
                selectedHistory.value = Array.isArray(detail.history) ? detail.history : [];
            }
            coordinatorRemarks.value = "";
            coordinatorSignature.value = "";
        };

        const formatRelevantDate = req => {
            if (!req) return "—";
            const start = formatDate(req.requestDate);
            if (req.requestEndDate && req.requestEndDate !== req.requestDate) {
                return `${start} – ${formatDate(req.requestEndDate)}`;
            }
            return start;
        };

        const formatDate = d => {
            if (!d) return "—";
            const dt = new Date(d + "T00:00:00");
            if (isNaN(dt.getTime())) return d;
            return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
        };

        const formatDateTime = dtStr => {
            if (!dtStr) return "—";
            const normalized = dtStr.includes("T") ? dtStr : dtStr.replace(" ", "T");
            const dt = new Date(normalized);
            if (isNaN(dt.getTime())) return dtStr;
            return dt.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
        };

        const formatTime = t => {
            if (!t) return "";
            const parts = String(t).split(":");
            if (parts.length < 2) return t;
            let h = parseInt(parts[0], 10);
            const m = parts[1];
            const ampm = h >= 12 ? "PM" : "AM";
            h = h % 12 || 12;
            return `${h}:${m} ${ampm}`;
        };

        const formatBytes = bytes => {
            const b = Number(bytes || 0);
            if (b < 1024) return b + " B";
            if (b < 1024 * 1024) return (b / 1024).toFixed(1) + " KB";
            return (b / (1024 * 1024)).toFixed(2) + " MB";
        };

        const formatAction = action => {
            const map = {
                CREATE_DRAFT: "Saved as Draft",
                UPDATE_DRAFT: "Updated Draft",
                SUBMIT: "Submitted Request",
                RESUBMIT: "Corrected & Resubmitted",
                SUPERVISOR_APPROVE: "Approved by Immediate Supervisor",
                SUPERVISOR_RETURN: "Returned to S.A. for Correction",
                SUPERVISOR_REJECT: "Rejected by Immediate Supervisor",
                SUPERVISOR_RESUBMIT_CLARIFICATION: "Clarification Submitted to Coordinator",
                COORDINATOR_RECORD: "Verified & Recorded by Coordinator",
                COORDINATOR_RETURN_CLARIFICATION: "Returned by Coordinator for Clarification",
                CANCEL: "Cancelled by Student Assistant"
            };
            return map[action] || action;
        };

        const formatRole = role => {
            if (role === "sa") return "Student Assistant";
            if (role === "supervisor") return "Immediate Supervisor";
            if (role === "admin") return "S.A. Coordinator";
            return role;
        };

        const typeIcon = type => {
            if (type === "EXCUSE_SLIP") return "FileText";
            if (type === "OVERTIME") return "Clock";
            return "Hourglass";
        };

        const typeBadgeTone = type => {
            if (type === "EXCUSE_SLIP") return "bg-info/10 text-info";
            if (type === "OVERTIME") return "bg-navy/10 text-navy";
            return "bg-warning/15 text-warning";
        };

        Vue.onMounted(loadData);

        return {
            loading,
            loadError,
            requests,
            summary,
            departments,
            searchQuery,
            filterDepartment,
            filterType,
            filterStatus,
            filteredRequests,
            sortKey,
            sortDir,
            page,
            pageSize,
            sortBy,
            getSortIcon,
            sortedRequests,
            pageCount,
            paginatedRequests,
            rangeText,
            visiblePages,
            resetFilters,
            canCoordinatorAct,
            loadData,
            showDetailModal,
            detailLoading,
            selectedRequest,
            selectedHistory,
            coordinatorRemarks,
            coordinatorSignature,
            coordinatorCanvasRef,
            coordinatorDecisionSelection,
            today,
            clearCoordinatorSignature,
            adoptCoordinatorElectronicSignature,
            actionError,
            submitting,
            openDetails,
            closeDetailModal,
            submitCoordinatorAction,
            formatRelevantDate,
            formatDate,
            formatDateTime,
            formatTime,
            formatBytes,
            formatAction,
            formatRole,
            typeIcon,
            typeBadgeTone,
            label
        };
    },

    template: `
    <div>
        <page-header title="Requests"
                     subtitle="Verify and record Supervisor-approved Excuse Slips, Overtime (OT) Forms, and Undertime Forms for the active semester.">
            <template #actions>
                <button @click="loadData" :disabled="loading" class="btn btn-secondary btn-sm">
                    <app-icon name="RefreshCw" :size="15" /> Refresh
                </button>
            </template>
        </page-header>

        <!-- Summary Cards -->
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
            <button @click="filterStatus = 'PENDING_SUPERVISOR_REVIEW'"
                    class="card p-4 text-left transition-all"
                    :class="filterStatus === 'PENDING_SUPERVISOR_REVIEW' ? 'ring-2 ring-warning border-warning' : 'hover:border-warning/40'">
                <div class="flex items-center justify-between">
                    <span class="text-caption font-medium text-muted">Pending Supervisor Review</span>
                    <span class="grid h-8 w-8 place-items-center rounded-lg bg-warning/10 text-warning">
                        <app-icon name="Clock" :size="16" />
                    </span>
                </div>
                <p class="mt-2 text-2xl font-bold text-warning">{{ summary.pendingSupervisorReview || 0 }}</p>
                <p class="mt-0.5 text-[11px] text-muted">Awaiting Immediate Supervisor</p>
            </button>

            <button @click="filterStatus = 'PENDING_COORDINATOR_RECORDING'"
                    class="card p-4 text-left transition-all"
                    :class="filterStatus === 'PENDING_COORDINATOR_RECORDING' ? 'ring-2 ring-info border-info' : 'hover:border-info/40'">
                <div class="flex items-center justify-between">
                    <span class="text-caption font-medium text-muted">Pending Coordinator Recording</span>
                    <span class="grid h-8 w-8 place-items-center rounded-lg bg-info/10 text-info">
                        <app-icon name="UserCheck" :size="16" />
                    </span>
                </div>
                <p class="mt-2 text-2xl font-bold text-info">{{ summary.pendingCoordinatorRecording || 0 }}</p>
                <p class="mt-0.5 text-[11px] text-muted">Approved by Supervisor · ready to record</p>
            </button>

            <button @click="filterStatus = 'RECORDED'"
                    class="card p-4 text-left transition-all"
                    :class="filterStatus === 'RECORDED' ? 'ring-2 ring-success border-success' : 'hover:border-success/40'">
                <div class="flex items-center justify-between">
                    <span class="text-caption font-medium text-muted">Recorded</span>
                    <span class="grid h-8 w-8 place-items-center rounded-lg bg-success/10 text-success">
                        <app-icon name="CheckCircle2" :size="16" />
                    </span>
                </div>
                <p class="mt-2 text-2xl font-bold text-success">{{ summary.recorded || 0 }}</p>
                <p class="mt-0.5 text-[11px] text-muted">Verified &amp; officially recorded</p>
            </button>

            <button @click="filterStatus = 'REJECTED_BY_SUPERVISOR'"
                    class="card p-4 text-left transition-all"
                    :class="filterStatus === 'REJECTED_BY_SUPERVISOR' ? 'ring-2 ring-danger border-danger' : 'hover:border-danger/40'">
                <div class="flex items-center justify-between">
                    <span class="text-caption font-medium text-muted">Rejected</span>
                    <span class="grid h-8 w-8 place-items-center rounded-lg bg-danger/10 text-danger">
                        <app-icon name="XCircle" :size="16" />
                    </span>
                </div>
                <p class="mt-2 text-2xl font-bold text-danger">{{ summary.rejected || 0 }}</p>
                <p class="mt-0.5 text-[11px] text-muted">Rejected by Supervisor</p>
            </button>
        </div>

        <!-- Search & Filter Bar -->
        <div class="card p-4 mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div class="relative flex-1 max-w-md">
                <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
                    <app-icon name="Search" :size="15" />
                </span>
                <input v-model.trim="searchQuery" type="text"
                       placeholder="Search by Request ID, S.A. name, student ID, department, or reason..."
                       class="input pl-9 py-2 text-caption" />
            </div>
            <div class="flex flex-wrap items-center gap-2">
                <select v-model="filterDepartment" class="input w-auto py-2 text-caption">
                    <option value="">All Departments</option>
                    <option v-for="dept in departments" :key="dept" :value="dept">{{ dept }}</option>
                </select>
                <select v-model="filterType" class="input w-auto py-2 text-caption">
                    <option value="">All Request Types</option>
                    <option value="EXCUSE_SLIP">Excuse Slip</option>
                    <option value="OVERTIME">Overtime (OT) Form</option>
                    <option value="UNDERTIME">Undertime Form</option>
                </select>
                <select v-model="filterStatus" class="input w-auto py-2 text-caption">
                    <option value="">All Statuses</option>
                    <option value="PENDING_COORDINATOR_RECORDING">Pending Coordinator Recording</option>
                    <option value="PENDING_SUPERVISOR_REVIEW">Pending Supervisor Review</option>
                    <option value="RETURNED_FOR_CLARIFICATION">Returned for Clarification</option>
                    <option value="RETURNED_TO_SA">Returned to S.A.</option>
                    <option value="RECORDED">Recorded</option>
                    <option value="REJECTED_BY_SUPERVISOR">Rejected by Supervisor</option>
                    <option value="CANCELLED">Cancelled</option>
                </select>
                <button v-if="searchQuery || filterDepartment || filterType || filterStatus"
                        @click="resetFilters"
                        class="btn btn-ghost btn-sm">
                    Reset
                </button>
            </div>
        </div>

        <!-- Requests Table -->
        <div class="card overflow-hidden">
            <div v-if="loading" class="p-10 text-center text-muted text-body">
                Loading requests...
            </div>

            <div v-else-if="loadError" class="p-10 text-center">
                <app-icon name="CircleX" :size="28" class="mx-auto text-danger" />
                <p class="mt-2 text-body font-semibold text-ink">Unable to load requests</p>
                <p class="mt-1 text-caption text-muted">{{ loadError }}</p>
            </div>

            <div v-else-if="!filteredRequests.length" class="p-12 text-center">
                <div class="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-mist text-navy">
                    <app-icon name="Inbox" :size="22" />
                </div>
                <p class="text-body font-semibold text-ink">No requests found</p>
                <p class="mt-1 text-caption text-muted max-w-md mx-auto">
                    {{ requests.length ? 'No requests match your current search or filter criteria.' : 'No Student Assistant requests have been submitted for the active semester yet.' }}
                </p>
            </div>

            <div v-else class="overflow-x-auto">
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
                        <b class="text-ink">{{ sortedRequests.length }}</b> total requests found
                    </span>
                </div>

                <table class="w-full text-left text-caption">
                    <thead>
                        <tr class="border-b border-line bg-page/60 text-[11px] font-semibold uppercase tracking-wider text-muted select-none">
                            <th class="px-4 py-3">
                                <button type="button" @click="sortBy('requestCode')" class="inline-flex items-center gap-1 hover:text-ink transition-colors font-semibold uppercase">
                                    Request ID
                                    <app-icon :name="getSortIcon('requestCode')" :size="13" />
                                </button>
                            </th>
                            <th class="px-4 py-3">
                                <button type="button" @click="sortBy('saName')" class="inline-flex items-center gap-1 hover:text-ink transition-colors font-semibold uppercase">
                                    S.A. Name
                                    <app-icon :name="getSortIcon('saName')" :size="13" />
                                </button>
                            </th>
                            <th class="px-4 py-3">
                                <button type="button" @click="sortBy('requestType')" class="inline-flex items-center gap-1 hover:text-ink transition-colors font-semibold uppercase">
                                    Request Type
                                    <app-icon :name="getSortIcon('requestType')" :size="13" />
                                </button>
                            </th>
                            <th class="px-4 py-3">
                                <button type="button" @click="sortBy('requestDate')" class="inline-flex items-center gap-1 hover:text-ink transition-colors font-semibold uppercase">
                                    Relevant Date
                                    <app-icon :name="getSortIcon('requestDate')" :size="13" />
                                </button>
                            </th>
                            <th class="px-4 py-3">
                                <button type="button" @click="sortBy('submittedAt')" class="inline-flex items-center gap-1 hover:text-ink transition-colors font-semibold uppercase">
                                    Submission Date
                                    <app-icon :name="getSortIcon('submittedAt')" :size="13" />
                                </button>
                            </th>
                            <th class="px-4 py-3">
                                <button type="button" @click="sortBy('status')" class="inline-flex items-center gap-1 hover:text-ink transition-colors font-semibold uppercase">
                                    Current Status
                                    <app-icon :name="getSortIcon('status')" :size="13" />
                                </button>
                            </th>
                            <th class="px-4 py-3 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-line">
                        <tr v-for="req in paginatedRequests" :key="req.id" class="hover:bg-page/50 transition-colors">
                            <td class="px-4 py-3.5 font-mono text-xs font-semibold text-navy">
                                {{ req.requestCode }}
                            </td>
                            <td class="px-4 py-3.5">
                                <div class="font-semibold text-ink">{{ req.saName }}</div>
                                <div class="text-[11px] text-muted">{{ req.studentId }} · {{ req.department || 'No Dept' }}</div>
                            </td>
                            <td class="px-4 py-3.5">
                                <div class="flex items-center gap-2.5">
                                    <span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg" :class="typeBadgeTone(req.requestType)">
                                        <app-icon :name="typeIcon(req.requestType)" :size="15" />
                                    </span>
                                    <div>
                                        <div class="font-semibold text-ink">{{ label('requestType', req.requestType) }}</div>
                                        <div class="text-[11px] text-muted truncate max-w-[200px]">
                                            <span v-if="req.requestType === 'UNDERTIME' && req.undertimeType">{{ req.undertimeType }} · </span>{{ req.reasonCategory }}
                                        </div>
                                    </div>
                                </div>
                            </td>
                            <td class="px-4 py-3.5">
                                <div class="font-medium text-ink">{{ formatRelevantDate(req) }}</div>
                                <div v-if="req.requestType === 'UNDERTIME' && req.actualTime" class="text-[11px] text-muted">
                                    Actual: {{ formatTime(req.actualTime) }}
                                </div>
                                <div v-else-if="req.requestedStart && req.requestedEnd" class="text-[11px] text-muted">
                                    {{ formatTime(req.requestedStart) }} – {{ formatTime(req.requestedEnd) }}
                                    <span v-if="req.hoursAffected">({{ req.hoursAffected }}h)</span>
                                </div>
                            </td>
                            <td class="px-4 py-3.5 text-muted">
                                <div>{{ req.submittedAt ? formatDateTime(req.submittedAt) : formatDateTime(req.createdAt) }}</div>
                                <div v-if="req.supervisorName" class="text-[11px] text-muted">
                                    Sup: {{ req.supervisorName }}
                                </div>
                            </td>
                            <td class="px-4 py-3.5">
                                <status-badge group="requestStatus" :value="req.status" />
                            </td>
                            <td class="px-4 py-3.5 text-right">
                                <button @click="openDetails(req)"
                                         class="btn btn-sm"
                                         :class="canCoordinatorAct(req) ? 'btn-primary' : 'btn-secondary'">
                                    <app-icon :name="canCoordinatorAct(req) ? 'CheckCircle2' : 'Eye'" :size="14" />
                                    {{ canCoordinatorAct(req) ? 'Verify & Record' : 'View Details' }}
                                </button>
                            </td>
                        </tr>
                    </tbody>
                </table>

                <!-- DataTable Footer: Showing X to Y of Z & Pagination controls -->
                <div v-if="sortedRequests.length > 0 && pageSize > 0" class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-line px-5 py-3.5 bg-mist/20 text-caption text-muted">
                    <div>{{ rangeText }}</div>
                    <div v-if="pageCount > 1" class="flex items-center gap-1">
                        <button type="button"
                                @click="page = Math.max(1, page - 1)"
                                :disabled="page <= 1"
                                class="rounded-md border border-line bg-white px-2.5 py-1 text-xs font-semibold text-ink shadow-2xs hover:bg-mist disabled:opacity-40 disabled:cursor-not-allowed">
                            Previous
                        </button>
                        <template v-for="(p, pi) in visiblePages" :key="'p-' + pi">
                            <span v-if="p === '...'" class="px-1 text-muted">…</span>
                            <button v-else
                                    type="button"
                                    @click="page = p"
                                    class="h-7 w-7 rounded-md text-xs font-bold transition-colors"
                                    :class="page === p ? 'bg-navy text-white shadow-xs' : 'border border-line bg-white text-ink hover:bg-mist'">
                                {{ p }}
                            </button>
                        </template>
                        <button type="button"
                                @click="page = Math.min(pageCount, page + 1)"
                                :disabled="page >= pageCount"
                                class="rounded-md border border-line bg-white px-2.5 py-1 text-xs font-semibold text-ink shadow-2xs hover:bg-mist disabled:opacity-40 disabled:cursor-not-allowed">
                            Next
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Detail & Coordinator Verification Modal -->
        <app-modal :open="showDetailModal"
                   :title="selectedRequest ? ('Request Details — ' + selectedRequest.requestCode) : 'Request Details'"
                   icon="ClipboardCheck" size="xl" @close="closeDetailModal">
            <div v-if="detailLoading" class="py-10 text-center text-muted text-body">
                Loading request details...
            </div>
            <div v-else-if="selectedRequest" class="space-y-4 text-caption">
                <!-- Status & Header Banner -->
                <div class="flex flex-wrap items-center justify-between gap-2 p-3.5 rounded-xl bg-page border border-line">
                    <div>
                        <span class="text-[11px] font-semibold uppercase text-muted">Request Type</span>
                        <div class="text-body font-bold text-ink mt-0.5">
                            {{ label('requestType', selectedRequest.requestType) }}
                            <span v-if="selectedRequest.requestType === 'UNDERTIME' && selectedRequest.undertimeType"
                                  class="ml-1.5 text-caption font-semibold text-warning">
                                ({{ selectedRequest.undertimeType }})
                            </span>
                        </div>
                    </div>
                    <div class="text-right">
                        <span class="text-[11px] font-semibold uppercase text-muted block mb-1">Current Status</span>
                        <status-badge group="requestStatus" :value="selectedRequest.status" />
                    </div>
                </div>

                <!-- S.A. & Assignment Info -->
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-mist/40 border border-line">
                    <div>
                        <span class="text-[11px] text-muted block">Student Assistant</span>
                        <span class="font-semibold text-ink">{{ selectedRequest.saName }}</span>
                        <span class="text-[11px] text-muted block">{{ selectedRequest.studentId }} {{ selectedRequest.saNumber ? '· ' + selectedRequest.saNumber : '' }}</span>
                    </div>
                    <div>
                        <span class="text-[11px] text-muted block">Course &amp; Department</span>
                        <span class="font-semibold text-ink">{{ selectedRequest.department || 'Unassigned' }}</span>
                        <span class="text-[11px] text-muted block">{{ selectedRequest.course || '—' }} {{ selectedRequest.location ? '· ' + selectedRequest.location : '' }}</span>
                    </div>
                    <div>
                        <span class="text-[11px] text-muted block">Immediate Supervisor</span>
                        <span class="font-semibold text-ink">{{ selectedRequest.supervisorName || 'Not yet assigned' }}</span>
                        <span v-if="selectedRequest.supervisorReviewedAt" class="text-[11px] text-success block">
                            Reviewed {{ formatDateTime(selectedRequest.supervisorReviewedAt) }}
                        </span>
                    </div>
                </div>

                <!-- Request Details Grid -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl border border-line">
                    <div>
                        <span class="text-[11px] text-muted block">Relevant Date</span>
                        <span class="font-semibold text-ink">{{ formatRelevantDate(selectedRequest) }}</span>
                    </div>
                    <div>
                        <span class="text-[11px] text-muted block">Reason Category</span>
                        <span class="font-semibold text-ink">{{ selectedRequest.reasonCategory }}</span>
                    </div>

                    <div v-if="selectedRequest.requestType === 'UNDERTIME'">
                        <span class="text-[11px] text-muted block">Undertime Type</span>
                        <span class="font-semibold text-ink">{{ selectedRequest.undertimeType || '—' }}</span>
                    </div>
                    <div v-if="selectedRequest.requestType === 'UNDERTIME'">
                        <span class="text-[11px] text-muted block">Actual Departure / Arrival Time</span>
                        <span class="font-semibold text-ink">{{ selectedRequest.actualTime ? formatTime(selectedRequest.actualTime) : '—' }}</span>
                    </div>

                    <div v-if="selectedRequest.scheduledStart || selectedRequest.scheduledEnd">
                        <span class="text-[11px] text-muted block">Scheduled Duty Shift</span>
                        <span class="font-semibold text-ink">{{ formatTime(selectedRequest.scheduledStart) }} – {{ formatTime(selectedRequest.scheduledEnd) }}</span>
                    </div>
                    <div v-if="selectedRequest.requestedStart || selectedRequest.requestedEnd">
                        <span class="text-[11px] text-muted block">{{ selectedRequest.requestType === 'OVERTIME' ? 'Requested Overtime Period' : 'Affected Duty Window' }}</span>
                        <span class="font-semibold text-ink">
                            {{ formatTime(selectedRequest.requestedStart) }} – {{ formatTime(selectedRequest.requestedEnd) }}
                            <span v-if="selectedRequest.hoursAffected">({{ selectedRequest.hoursAffected }} hrs)</span>
                        </span>
                    </div>

                    <div class="sm:col-span-2" v-if="selectedRequest.overtimeRows && selectedRequest.overtimeRows.length">
                        <span class="text-[11px] font-semibold uppercase text-muted block mb-1.5">Overtime Details Schedule</span>
                        <div class="overflow-x-auto rounded-lg border border-line">
                            <table class="w-full text-left text-xs">
                                <thead class="bg-page border-b border-line text-[10px] uppercase text-muted">
                                    <tr>
                                        <th class="px-2.5 py-1.5">Date</th>
                                        <th class="px-2.5 py-1.5">Task to Accomplish</th>
                                        <th class="px-2.5 py-1.5">Regular Time</th>
                                        <th class="px-2.5 py-1.5">O.T. Time</th>
                                        <th class="px-2.5 py-1.5">O.T. Hours</th>
                                    </tr>
                                </thead>
                                <tbody class="divide-y divide-line">
                                    <tr v-for="(r, i) in selectedRequest.overtimeRows" :key="i">
                                        <td class="px-2.5 py-1.5">{{ formatDate(r.date) }}</td>
                                        <td class="px-2.5 py-1.5 font-medium text-ink">{{ r.task }}</td>
                                        <td class="px-2.5 py-1.5">{{ formatTime(r.regularStart) }} – {{ formatTime(r.regularEnd) }}</td>
                                        <td class="px-2.5 py-1.5">{{ formatTime(r.otStart) }} – {{ formatTime(r.otEnd) }}</td>
                                        <td class="px-2.5 py-1.5 font-semibold text-navy">{{ r.otHours }} hrs</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <div class="sm:col-span-2" v-if="selectedRequest.explanation">
                        <span class="text-[11px] text-muted block">Explanation / Task Justification</span>
                        <p class="mt-1 p-2.5 rounded-lg bg-page border border-line text-ink whitespace-pre-line">{{ selectedRequest.explanation }}</p>
                    </div>
                    <div class="sm:col-span-2" v-if="selectedRequest.notes">
                        <span class="text-[11px] text-muted block">Additional Details / Notes</span>
                        <p class="mt-0.5 text-ink whitespace-pre-line">{{ selectedRequest.notes }}</p>
                    </div>
                </div>

                <!-- Supporting Proof Section -->
                <div class="p-3.5 rounded-xl border border-line flex items-center justify-between gap-3">
                    <div>
                        <span class="text-[11px] font-semibold uppercase text-muted block">Supporting Proof / Letter</span>
                        <p v-if="selectedRequest.hasProof" class="font-medium text-ink mt-0.5">
                            {{ selectedRequest.proofFileName || 'Attached Supporting Document' }}
                            <span v-if="selectedRequest.proofSizeBytes" class="text-[11px] text-muted ml-1">({{ formatBytes(selectedRequest.proofSizeBytes) }})</span>
                        </p>
                        <p v-else class="text-muted mt-0.5">No supporting document attached.</p>
                    </div>
                    <a v-if="selectedRequest.hasProof"
                       :href="selectedRequest.proofViewUrl || ('api/document.php?type=request&id=' + selectedRequest.id)"
                       target="_blank" rel="noopener"
                       class="btn btn-secondary btn-sm">
                        <app-icon name="Eye" :size="14" /> View / Download Proof
                    </a>
                </div>

                <!-- Supervisor & Coordinator Remarks -->
                <div v-if="selectedRequest.supervisorRemarks || selectedRequest.coordinatorRemarks" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div v-if="selectedRequest.supervisorRemarks" class="p-3 rounded-xl bg-warning/10 border border-warning/30">
                        <span class="text-[11px] font-semibold uppercase text-warning block">Immediate Supervisor Remarks</span>
                        <p class="mt-1 text-ink whitespace-pre-line">{{ selectedRequest.supervisorRemarks }}</p>
                        <span v-if="selectedRequest.supervisorName" class="mt-1 block text-[11px] text-muted">— {{ selectedRequest.supervisorName }}</span>
                    </div>
                    <div v-if="selectedRequest.coordinatorRemarks" class="p-3 rounded-xl bg-info/10 border border-info/30">
                        <span class="text-[11px] font-semibold uppercase text-info block">S.A. Coordinator Remarks</span>
                        <p class="mt-1 text-ink whitespace-pre-line">{{ selectedRequest.coordinatorRemarks }}</p>
                        <span v-if="selectedRequest.coordinatorName" class="mt-1 block text-[11px] text-muted">— {{ selectedRequest.coordinatorName }}</span>
                    </div>
                </div>

                <!-- Approval & Signatures Area (3-Column Role Layout) -->
                <div class="p-4 rounded-xl border border-line space-y-3.5 bg-mist/30">
                    <div class="flex items-center justify-between">
                        <h4 class="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                            <app-icon name="ShieldCheck" :size="16" class="text-blue-600" />
                            <span>Approval &amp; Signatures</span>
                        </h4>
                        <span class="text-[11px] text-muted font-medium">Role-Gated Verifications</span>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-3 gap-3.5 text-xs">
                        <!-- Col 1: Student Assistant -->
                        <div class="rounded-xl border border-line bg-white p-3.5 flex flex-col justify-between space-y-3 shadow-xs">
                            <div class="flex items-center justify-between">
                                <span class="font-bold text-slate-800 uppercase text-[11px] tracking-wide">1. Student Assistant</span>
                                <span class="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">Applicant</span>
                            </div>
                            <div class="h-28 rounded-lg border border-slate-200 bg-slate-50/60 flex items-center justify-center p-2 overflow-hidden">
                                <img v-if="selectedRequest.saSignature" :src="selectedRequest.saSignature" class="max-h-full max-w-full object-contain" alt="SA Signature" />
                                <span v-else class="text-xs text-slate-400 italic">No signature recorded</span>
                            </div>
                            <div class="border-t border-slate-100 pt-2.5 mt-auto space-y-0.5">
                                <div class="font-bold text-slate-800 text-xs truncate">{{ selectedRequest.saName }}</div>
                                <div class="text-[11px] text-slate-500">Signed: {{ selectedRequest.saSignDate ? formatDate(selectedRequest.saSignDate) : (selectedRequest.dateFiled ? formatDate(selectedRequest.dateFiled) : '—') }}</div>
                            </div>
                        </div>

                        <!-- Col 2: Immediate Supervisor -->
                        <div class="rounded-xl border border-line bg-white p-3.5 flex flex-col justify-between space-y-3 shadow-xs">
                            <div class="flex items-center justify-between">
                                <span class="font-bold text-slate-800 uppercase text-[11px] tracking-wide">2. Immediate Supervisor</span>
                                <span class="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-800">Stage 1</span>
                            </div>
                            <div class="flex items-center gap-2 text-xs">
                                <span v-if="selectedRequest.supervisorDecision === 'APPROVED'" class="inline-flex items-center gap-1 text-emerald-700 font-bold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md text-[11px]">
                                    <app-icon name="CheckCircle2" :size="12" /> Approved
                                </span>
                                <span v-else-if="selectedRequest.status === 'REJECTED_BY_SUPERVISOR' || selectedRequest.supervisorDecision === 'REJECTED' || selectedRequest.supervisorDecision === 'NOT_APPROVED'" class="inline-flex items-center gap-1 text-rose-700 font-bold bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md text-[11px]">
                                    <app-icon name="XCircle" :size="12" /> Not Approved
                                </span>
                                <span v-else class="text-slate-400 text-[11px] italic">Pending Review</span>
                            </div>
                            <div class="h-28 rounded-lg border border-slate-200 bg-slate-50/60 flex items-center justify-center p-2 overflow-hidden">
                                <img v-if="selectedRequest.supervisorSignature" :src="selectedRequest.supervisorSignature" class="max-h-full max-w-full object-contain" alt="Supervisor Signature" />
                                <span v-else class="text-xs text-slate-400 italic">{{ selectedRequest.supervisorActedAt ? 'Signed by Supervisor' : 'Pending Review' }}</span>
                            </div>
                            <div class="border-t border-slate-100 pt-2.5 mt-auto space-y-0.5">
                                <div class="font-bold text-slate-800 text-xs truncate">{{ selectedRequest.supervisorName || 'Immediate Supervisor' }}</div>
                                <div class="text-[11px] text-slate-500">Date: {{ selectedRequest.supervisorSignDate ? formatDate(selectedRequest.supervisorSignDate) : (selectedRequest.supervisorActedAt ? formatDate(selectedRequest.supervisorActedAt.slice(0, 10)) : 'Pending') }}</div>
                            </div>
                        </div>

                        <!-- Col 3: S.A. Coordinator -->
                        <div class="rounded-xl border border-line bg-white p-3.5 flex flex-col justify-between space-y-3 shadow-xs"
                             :class="canCoordinatorAct(selectedRequest) ? 'ring-2 ring-blue-500/20 border-blue-600 shadow-sm' : ''">
                            <div class="flex items-center justify-between gap-2">
                                <span class="font-bold text-slate-800 uppercase text-[11px] tracking-wide">3. S.A. Coordinator</span>
                                <span v-if="canCoordinatorAct(selectedRequest)" class="rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] font-bold text-blue-700 shrink-0">Final Stage Action</span>
                                <span v-else class="rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] font-bold text-blue-700 shrink-0">Final Stage</span>
                            </div>

                            <div v-if="canCoordinatorAct(selectedRequest)" class="grid grid-cols-2 gap-2">
                                <label class="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg border text-xs font-bold cursor-pointer transition-all"
                                       :class="coordinatorDecisionSelection === 'APPROVED' ? 'bg-emerald-50 border-emerald-300 text-emerald-800 shadow-xs' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'">
                                    <input type="radio" value="APPROVED" v-model="coordinatorDecisionSelection" class="hidden" />
                                    <app-icon name="Check" :size="13" />
                                    <span>Approved</span>
                                </label>
                                <label class="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg border text-xs font-bold cursor-pointer transition-all"
                                       :class="coordinatorDecisionSelection === 'NOT_APPROVED' ? 'bg-rose-50 border-rose-300 text-rose-800 shadow-xs' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'">
                                    <input type="radio" value="NOT_APPROVED" v-model="coordinatorDecisionSelection" class="hidden" />
                                    <app-icon name="X" :size="13" />
                                    <span>Not Approved</span>
                                </label>
                            </div>
                            <div v-else class="flex items-center gap-2 text-xs">
                                <span v-if="selectedRequest.status === 'RECORDED'" class="inline-flex items-center gap-1 text-emerald-700 font-bold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md text-[11px]">
                                    <app-icon name="CheckCircle2" :size="12" /> Approved &amp; Recorded
                                </span>
                                <span v-else-if="selectedRequest.status === 'RETURNED_FOR_CLARIFICATION' || selectedRequest.coordinatorDecision === 'NOT_APPROVED'" class="inline-flex items-center gap-1 text-rose-700 font-bold bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md text-[11px]">
                                    <app-icon name="XCircle" :size="12" /> Not Approved
                                </span>
                                <span v-else class="text-slate-400 text-[11px] italic">Pending Final Stage</span>
                            </div>

                            <!-- Canvas / Signature Area with its own top action bar -->
                            <div v-if="canCoordinatorAct(selectedRequest)" class="space-y-1.5">
                                <div class="flex items-center justify-between text-[11px]">
                                    <span class="text-slate-500 font-medium">Signature Pad:</span>
                                    <div class="flex items-center gap-1.5">
                                        <button type="button" @click="adoptCoordinatorElectronicSignature"
                                                class="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md px-2 py-0.5 transition-colors">
                                            <app-icon name="PenTool" :size="11" />
                                            <span>Adopt E-Sig</span>
                                        </button>
                                        <button type="button" @click="clearCoordinatorSignature"
                                                class="inline-flex items-center gap-1 text-[11px] font-bold text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-md px-1.5 py-0.5 transition-colors">
                                            <app-icon name="Trash2" :size="11" />
                                            <span>Clear</span>
                                        </button>
                                    </div>
                                </div>
                                <div class="relative overflow-hidden rounded-lg border-2 border-slate-300 bg-white shadow-inner h-28">
                                    <canvas ref="coordinatorCanvasRef" width="380" height="112" class="h-full w-full cursor-crosshair bg-white block" style="touch-action: none; background-color: #ffffff;"></canvas>
                                    <div v-if="!coordinatorSignature" class="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-400 font-medium">
                                        Draw signature or click Adopt E-Sig
                                    </div>
                                </div>
                            </div>
                            <div v-else class="h-28 rounded-lg border border-slate-200 bg-slate-50/60 flex items-center justify-center p-2 overflow-hidden text-center">
                                <img v-if="selectedRequest.coordinatorSignature" :src="selectedRequest.coordinatorSignature" class="max-h-full max-w-full object-contain" alt="Coordinator Signature" />
                                <div v-else class="text-xs text-slate-400 flex flex-col items-center justify-center gap-1.5 py-3">
                                    <div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                                        <app-icon name="Lock" :size="14" />
                                    </div>
                                    <span class="font-medium text-slate-500">Restricted to Coordinator</span>
                                </div>
                            </div>

                            <div class="border-t border-slate-100 pt-2.5 mt-auto space-y-0.5">
                                <div class="font-bold text-slate-800 text-xs truncate">{{ selectedRequest.coordinatorName || Store.user?.name || 'Ansherina A Sudario' }}</div>
                                <div class="text-[11px] text-slate-500">Date: {{ canCoordinatorAct(selectedRequest) ? formatDate(today) : (selectedRequest.coordinatorSignDate ? formatDate(selectedRequest.coordinatorSignDate) : (selectedRequest.recordedAt ? formatDate(selectedRequest.recordedAt.slice(0, 10)) : 'Pending')) }}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Workflow Notice when NOT awaiting Coordinator action -->
                <div v-if="!canCoordinatorAct(selectedRequest)" class="p-3.5 rounded-xl bg-page border border-line text-muted flex items-start gap-2.5">
                    <app-icon name="AlertCircle" :size="16" class="text-navy shrink-0 mt-0.5" />
                    <div>
                        <p class="font-semibold text-ink">Coordinator Recording Status</p>
                        <p v-if="selectedRequest.status === 'PENDING_SUPERVISOR_REVIEW'" class="text-[11px] text-muted mt-0.5">
                            This request is currently awaiting Immediate Supervisor review. Coordinator verification and recording are enabled only after Supervisor approval.
                        </p>
                        <p v-else-if="selectedRequest.status === 'RECORDED'" class="text-[11px] text-success mt-0.5">
                            This request has already been verified and officially recorded on {{ formatDateTime(selectedRequest.coordinatorRecordedAt) }}.
                        </p>
                        <p v-else class="text-[11px] text-muted mt-0.5">
                            No Coordinator action is available while the request is in <strong>{{ label('requestStatus', selectedRequest.status) }}</strong> status.
                        </p>
                    </div>
                </div>

                <!-- Coordinator Action Panel (Strictly for PENDING_COORDINATOR_RECORDING) -->
                <div v-if="canCoordinatorAct(selectedRequest)" class="p-4 rounded-xl bg-mist/60 border border-line space-y-3">
                    <div class="flex items-center justify-between">
                        <div>
                            <h4 class="text-xs font-bold uppercase tracking-wider text-navy">
                                S.A. Coordinator Verification &amp; Recording
                            </h4>
                            <p class="text-[11px] text-muted mt-0.5">
                                Review the supervisor's endorsement and record your official verification decision.
                            </p>
                        </div>
                        <span class="text-[11px] font-semibold text-info">Supervisor-Approved Request</span>
                    </div>

                    <div>
                        <label class="field-label">
                            Coordinator Remarks / Recording Note
                            <span class="text-muted font-normal">(Required when returning for clarification; optional when recording)</span>
                        </label>
                        <textarea v-model.trim="coordinatorRemarks" rows="2"
                                  placeholder="Enter official recording remarks or specify what clarification is needed from the Supervisor / S.A...."
                                  class="input"></textarea>
                    </div>

                    <div v-if="actionError" class="p-2.5 rounded-lg bg-danger/10 border border-danger/30 text-danger text-xs font-medium">
                        {{ actionError }}
                    </div>

                    <div class="flex flex-wrap items-center justify-end gap-2 pt-1">
                        <button @click="submitCoordinatorAction('coordinator_return_clarification')" :disabled="submitting"
                                class="btn btn-secondary btn-sm">
                            <app-icon name="RotateCcw" :size="14" /> Return for Clarification
                        </button>
                        <button @click="submitCoordinatorAction('coordinator_record')" :disabled="submitting"
                                class="btn btn-primary btn-sm">
                            <app-icon name="CheckCircle2" :size="14" /> Verify &amp; Record Request
                        </button>
                    </div>
                </div>

                <!-- Request History Timeline -->
                <div class="p-3.5 rounded-xl border border-line">
                    <h4 class="text-[11px] font-semibold uppercase tracking-wider text-muted mb-3">Workflow Audit History</h4>
                    <div v-if="!selectedHistory.length" class="text-muted">No history entries recorded yet.</div>
                    <ol v-else class="relative border-l border-line ml-2 space-y-3">
                        <li v-for="h in selectedHistory" :key="h.id" class="ml-4">
                            <span class="absolute -left-1.5 mt-1 h-3 w-3 rounded-full bg-navy border-2 border-white"></span>
                            <div class="flex flex-wrap items-center justify-between gap-1">
                                <span class="font-semibold text-ink">{{ formatAction(h.action) }}</span>
                                <span class="text-[11px] text-muted">{{ formatDateTime(h.createdAt) }}</span>
                            </div>
                            <div class="text-[11px] text-muted">
                                By {{ h.actorName }} ({{ formatRole(h.actorRole) }}) · Status: <span class="font-medium text-ink">{{ label('requestStatus', h.toStatus) }}</span>
                            </div>
                            <p v-if="h.remarks" class="mt-1 p-2 rounded bg-page border border-line text-ink whitespace-pre-line">{{ h.remarks }}</p>
                        </li>
                    </ol>
                </div>
            </div>

            <template #footer>
                <button @click="closeDetailModal" class="btn btn-secondary btn-sm">
                    Close
                </button>
            </template>
        </app-modal>
    </div>
    `
};
window.AdminRequestsPage = AdminRequestsPage;

