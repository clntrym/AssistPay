// Immediate Supervisor > Review Requests (#/supervisor/requests)
// Complete two-stage approval workflow with Supervisor decision and Coordinator handoff.

const SupervisorRequestsPage = {
    components: { AppIcon, PageHeader, AppModal, StatusBadge },

    setup() {
        const loading = Vue.ref(true);
        const loadError = Vue.ref("");
        const requests = Vue.ref([]);
        const summary = Vue.ref({
            total: 0,
            pendingSupervisorReview: 0,
            returnedToSa: 0,
            pendingCoordinatorRecording: 0,
            returnedForClarification: 0,
            recorded: 0,
            rejected: 0
        });

        // Search & Filters
        const searchQuery = Vue.ref("");
        const filterType = Vue.ref("");
        const filterStatus = Vue.ref("");
        const filterDepartment = Vue.ref("");
        const filterStartDate = Vue.ref("");
        const filterEndDate = Vue.ref("");

        // Pagination
        const currentPage = Vue.ref(1);
        const pageSize = Vue.ref(10);

        // Modals & Details View
        const showReviewModal = Vue.ref(false);
        const detailLoading = Vue.ref(false);
        const selectedRequest = Vue.ref(null);
        const selectedHistory = Vue.ref([]);

        // Action Confirmation Modals
        const showApproveModal = Vue.ref(false);
        const approveRemarks = Vue.ref("");

        const showReturnModal = Vue.ref(false);
        const returnRemarks = Vue.ref("");
        const returnError = Vue.ref("");

        const showRejectModal = Vue.ref(false);
        const rejectRemarks = Vue.ref("");
        const rejectError = Vue.ref("");

        const showClarificationModal = Vue.ref(false);
        const clarificationRemarks = Vue.ref("");
        const clarificationError = Vue.ref("");

        const submitting = Vue.ref(false);
        const actionError = Vue.ref("");

        const today = (new Date()).toLocaleDateString("en-CA");
        const supervisorDecisionSelection = Vue.ref("APPROVED");
        const reviewRemarks = Vue.ref("");
        const supervisorSignature = Vue.ref("");
        const supervisorCanvasRef = Vue.ref(null);
        let supPad = null;

        const drawFlourishOnCanvas = (canvas, role = "supervisor") => {
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

        const initSupervisorCanvas = () => {
            Vue.nextTick(() => {
                const canvas = supervisorCanvasRef.value;
                if (!canvas) return;

                if (typeof SignaturePad !== "undefined") {
                    if (canvas._sigPad) {
                        supPad = canvas._sigPad;
                    } else {
                        supPad = new SignaturePad(canvas, {
                            penColor: "#0F2C59",
                            backgroundColor: "#FFFFFF",
                            minWidth: 1.5,
                            maxWidth: 3.5,
                            throttle: 16
                        });
                        canvas._sigPad = supPad;
                    }

                    if (supervisorSignature.value && supervisorSignature.value.startsWith("data:image")) {
                        supPad.fromDataURL(supervisorSignature.value);
                    } else {
                        supPad.clear();
                    }

                    if (canvas._endStrokeHandler) {
                        supPad.removeEventListener("endStroke", canvas._endStrokeHandler);
                    }
                    canvas._endStrokeHandler = () => {
                        supervisorSignature.value = canvas.toDataURL("image/png");
                    };
                    supPad.addEventListener("endStroke", canvas._endStrokeHandler);
                    return;
                }

                // Fallback manual drawing
                const ctx = canvas.getContext("2d");
                if (supervisorSignature.value && supervisorSignature.value.startsWith("data:image")) {
                    const img = new Image();
                    img.onload = () => {
                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    };
                    img.src = supervisorSignature.value;
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
                        supervisorSignature.value = canvas.toDataURL("image/png");
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

        const clearSupervisorSignature = () => {
            if (supPad) {
                supPad.clear();
            } else if (supervisorCanvasRef.value) {
                const ctx = supervisorCanvasRef.value.getContext("2d");
                ctx.clearRect(0, 0, supervisorCanvasRef.value.width, supervisorCanvasRef.value.height);
            }
            supervisorSignature.value = "";
        };

        const adoptSupervisorElectronicSignature = () => {
            const canvas = supervisorCanvasRef.value;
            if (!canvas) return "";
            drawFlourishOnCanvas(canvas, "supervisor");
            const dataUrl = canvas.toDataURL("image/png");
            supervisorSignature.value = dataUrl;
            if (supPad) {
                supPad._isEmpty = false;
            }
            return dataUrl;
        };

        // Distinct departments among loaded requests
        const departments = Vue.computed(() => {
            const set = new Set();
            requests.value.forEach(r => {
                if (r.department) set.add(r.department);
            });
            return Array.from(set).sort();
        });

        // Pending My Review count includes pendingSupervisorReview and clarification requests assigned to Supervisor
        const pendingMyReviewCount = Vue.computed(() => {
            return (summary.value.pendingSupervisorReview || 0) + (summary.value.returnedForClarification || 0);
        });

        // Check whether any filter is currently applied
        const hasActiveFilters = Vue.computed(() => {
            return !!(searchQuery.value || filterType.value || filterStatus.value || filterDepartment.value || filterStartDate.value || filterEndDate.value);
        });

        // Reactive request filtering
        const filteredRequests = Vue.computed(() => {
            return requests.value.filter(req => {
                if (filterType.value && req.requestType !== filterType.value) return false;

                if (filterStatus.value) {
                    if (filterStatus.value === "PENDING_MY_REVIEW") {
                        const isPending = req.status === "PENDING_SUPERVISOR_REVIEW" ||
                            (req.status === "RETURNED_FOR_CLARIFICATION" && req.clarificationTarget === "SUPERVISOR");
                        if (!isPending) return false;
                    } else if (req.status !== filterStatus.value) {
                        return false;
                    }
                }

                if (filterDepartment.value && req.department !== filterDepartment.value) return false;

                if (filterStartDate.value) {
                    const reqDate = req.requestDate || (req.submittedAt ? req.submittedAt.slice(0, 10) : "");
                    if (reqDate && reqDate < filterStartDate.value) return false;
                }

                if (filterEndDate.value) {
                    const reqDate = req.requestEndDate || req.requestDate || (req.submittedAt ? req.submittedAt.slice(0, 10) : "");
                    if (reqDate && reqDate > filterEndDate.value) return false;
                }

                if (searchQuery.value) {
                    const q = searchQuery.value.toLowerCase();
                    const hay = [
                        req.requestCode,
                        req.requestRefNo,
                        req.saName,
                        req.studentId,
                        req.saNumber,
                        req.department,
                        req.location,
                        req.reasonCategory,
                        req.undertimeType,
                        req.explanation,
                        req.notes,
                        req.requestDate,
                        label("requestType", req.requestType),
                        label("requestStatus", req.status)
                    ].filter(Boolean).join(" ").toLowerCase();
                    if (!hay.includes(q)) return false;
                }

                return true;
            });
        });

        // Pagination Computations
        const totalPages = Vue.computed(() => {
            return Math.max(1, Math.ceil(filteredRequests.value.length / pageSize.value));
        });

        const paginatedRequests = Vue.computed(() => {
            const start = (currentPage.value - 1) * pageSize.value;
            return filteredRequests.value.slice(start, start + pageSize.value);
        });

        const setPage = p => {
            if (p >= 1 && p <= totalPages.value) {
                currentPage.value = p;
            }
        };

        // Reset page to 1 when filters change
        Vue.watch([searchQuery, filterType, filterStatus, filterDepartment, filterStartDate, filterEndDate], () => {
            currentPage.value = 1;
        });

        const resetFilters = () => {
            searchQuery.value = "";
            filterType.value = "";
            filterStatus.value = "";
            filterDepartment.value = "";
            filterStartDate.value = "";
            filterEndDate.value = "";
            currentPage.value = 1;
        };

        const canReview = req => {
            if (!req) return false;
            return req.status === "PENDING_SUPERVISOR_REVIEW" ||
                (req.status === "RETURNED_FOR_CLARIFICATION" && req.clarificationTarget === "SUPERVISOR");
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
                openReviewModal(match);
            } else if (targetId) {
                openReviewModal({ id: targetId });
            }
        };

        const loadData = async () => {
            loading.value = true;
            loadError.value = "";
            try {
                const res = await Model.request("requests", "team_requests");
                loading.value = false;
                if (!res.success) {
                    loadError.value = res.message || "Could not load team requests.";
                    return;
                }
                requests.value = Array.isArray(res.requests) ? res.requests : [];
                if (res.summary) summary.value = res.summary;
                checkDeepLink();
            } catch (err) {
                loading.value = false;
                loadError.value = err.message || "Network error loading requests.";
            }
        };

        if (route) {
            Vue.watch(() => [route.query.ref, route.query.requestCode, route.query.id], () => {
                checkDeepLink();
            });
        }

        const openReviewModal = async req => {
            selectedRequest.value = req;
            selectedHistory.value = [];
            actionError.value = "";
            reviewRemarks.value = "";
            supervisorSignature.value = "";
            supervisorDecisionSelection.value = "APPROVED";
            showReviewModal.value = true;
            detailLoading.value = true;

            if (canReview(req)) {
                initSupervisorCanvas();
            }

            try {
                const res = await Model.request("requests", "get", { id: req.id });
                detailLoading.value = false;
                if (res.success) {
                    if (res.request) selectedRequest.value = res.request;
                    selectedHistory.value = Array.isArray(res.history) ? res.history : [];
                    if (canReview(selectedRequest.value)) {
                        initSupervisorCanvas();
                    }
                }
            } catch (err) {
                detailLoading.value = false;
            }
        };

        const closeReviewModal = () => {
            showReviewModal.value = false;
            selectedRequest.value = null;
            selectedHistory.value = [];
            actionError.value = "";
            reviewRemarks.value = "";
            supervisorSignature.value = "";
            supervisorDecisionSelection.value = "APPROVED";
        };

        const refreshSelectedRequest = async id => {
            try {
                const detail = await Model.request("requests", "get", { id });
                if (detail && detail.success && detail.request) {
                    selectedRequest.value = detail.request;
                    selectedHistory.value = Array.isArray(detail.history) ? detail.history : [];
                    if (canReview(detail.request)) {
                        initSupervisorCanvas();
                    }
                }
            } catch (e) {
                console.error("Error refreshing request:", e);
            }
        };

        // Action Handlers
        const handleApproveRequest = async () => {
            if (!selectedRequest.value || submitting.value) return;
            supervisorDecisionSelection.value = "APPROVED";
            actionError.value = "";

            if (!supervisorSignature.value) {
                adoptSupervisorElectronicSignature();
            }

            const ok = await Alerts.confirm({
                title: "Approve Request?",
                text: `Are you sure you want to approve Request #${selectedRequest.value.id} (${selectedRequest.value.requestType || 'Request'}) and forward it to the S.A. Coordinator?`,
                icon: "question",
                confirmText: "Yes, Approve Request",
                requireReason: false
            });
            if (!ok) return;

            submitting.value = true;
            try {
                const res = await Model.request("requests", "supervisor_approve", {
                    id: selectedRequest.value.id,
                    remarks: reviewRemarks.value.trim(),
                    supervisorSignature: supervisorSignature.value
                });

                if (!res.success) {
                    actionError.value = res.message || "Unable to approve request.";
                    Alerts.error("Approval Failed", actionError.value);
                    return;
                }

                showApproveModal.value = false;
                await Alerts.success("Request Approved", res.message || "Request approved and forwarded to S.A. Coordinator.");
                if (Store.loadNotifications) Store.loadNotifications();

                await loadData();
                await refreshSelectedRequest(selectedRequest.value.id);
            } catch (err) {
                actionError.value = err.message || "Network error while approving request.";
                Alerts.error("Network Error", actionError.value);
            } finally {
                submitting.value = false;
            }
        };

        const handleRejectRequest = async () => {
            if (!selectedRequest.value || submitting.value) return;
            supervisorDecisionSelection.value = "NOT_APPROVED";
            actionError.value = "";

            const cleanReason = reviewRemarks.value.trim();
            if (!cleanReason) {
                actionError.value = "A non-empty reason for rejection is mandatory.";
                Alerts.warning("Mandatory Reason Required", actionError.value);
                return;
            }

            if (!supervisorSignature.value) {
                adoptSupervisorElectronicSignature();
            }

            const ok = await Alerts.confirm({
                title: "Reject Request?",
                text: "Are you sure you want to reject this request? This decision will be recorded in the official audit trail.",
                icon: "warning",
                danger: true,
                confirmText: "Yes, Reject Request",
                requireReason: false
            });
            if (!ok) return;

            submitting.value = true;
            try {
                const res = await Model.request("requests", "supervisor_reject", {
                    id: selectedRequest.value.id,
                    remarks: cleanReason,
                    supervisorSignature: supervisorSignature.value
                });

                if (!res.success) {
                    actionError.value = res.message || "Unable to reject request.";
                    Alerts.error("Rejection Failed", actionError.value);
                    return;
                }

                showRejectModal.value = false;
                await Alerts.success("Request Rejected", res.message || "Request has been rejected.");
                if (Store.loadNotifications) Store.loadNotifications();

                await loadData();
                await refreshSelectedRequest(selectedRequest.value.id);
            } catch (err) {
                actionError.value = err.message || "Network error while rejecting request.";
                Alerts.error("Network Error", actionError.value);
            } finally {
                submitting.value = false;
            }
        };

        const handleReturnForCorrection = async () => {
            if (!selectedRequest.value || submitting.value) return;
            actionError.value = "";

            const cleanReason = reviewRemarks.value.trim();
            if (!cleanReason) {
                actionError.value = "Correction instructions are required before returning this request.";
                Alerts.warning("Instructions Required", actionError.value);
                return;
            }

            const ok = await Alerts.confirm({
                title: "Return Request for Correction?",
                text: "This request will be returned to the Student Assistant with your instructions. Continue?",
                icon: "warning",
                confirmText: "Yes, Return Request",
                requireReason: false
            });
            if (!ok) return;

            submitting.value = true;
            try {
                const res = await Model.request("requests", "supervisor_return", {
                    id: selectedRequest.value.id,
                    remarks: cleanReason
                });

                if (!res.success) {
                    actionError.value = res.message || "Unable to return request.";
                    Alerts.error("Return Failed", actionError.value);
                    return;
                }

                showReturnModal.value = false;
                await Alerts.success("Returned for Correction", res.message || "Request returned to Student Assistant for correction.");
                if (Store.loadNotifications) Store.loadNotifications();

                await loadData();
                await refreshSelectedRequest(selectedRequest.value.id);
            } catch (err) {
                actionError.value = err.message || "Network error while returning request.";
                Alerts.error("Network Error", actionError.value);
            } finally {
                submitting.value = false;
            }
        };

        const handleClarificationToCoordinator = async () => {
            if (!selectedRequest.value || submitting.value) return;
            actionError.value = "";

            const cleanRemarks = reviewRemarks.value.trim() || clarificationRemarks.value.trim();
            if (!cleanRemarks) {
                actionError.value = "Clarification notes are required.";
                Alerts.warning("Clarification Required", actionError.value);
                return;
            }

            const ok = await Alerts.confirm({
                title: "Submit Clarification Notes?",
                text: "Submit your clarification notes back to the S.A. Coordinator?",
                icon: "question",
                confirmText: "Yes, Submit Clarification",
                requireReason: false
            });
            if (!ok) return;

            submitting.value = true;
            try {
                const res = await Model.request("requests", "supervisor_resubmit_clarification", {
                    id: selectedRequest.value.id,
                    remarks: cleanRemarks
                });

                if (!res.success) {
                    actionError.value = res.message || "Unable to submit clarification.";
                    Alerts.error("Clarification Failed", actionError.value);
                    return;
                }
                showClarificationModal.value = false;
                await Alerts.success("Clarification Submitted", res.message || "Clarification submitted to Coordinator.");
                if (Store.loadNotifications) Store.loadNotifications();

                await loadData();
                await refreshSelectedRequest(selectedRequest.value.id);
            } catch (err) {
                actionError.value = err.message || "Network error while submitting clarification.";
                Store.toast("error", actionError.value);
            } finally {
                submitting.value = false;
            }
        };

        // Aliases for template buttons and backward compatibility
        const confirmApprove = handleApproveRequest;
        const confirmReject = handleRejectRequest;
        const confirmReturn = handleReturnForCorrection;
        const confirmClarification = handleClarificationToCoordinator;
        const openApproveModal = handleApproveRequest;
        const openRejectModal = handleRejectRequest;
        const openReturnModal = handleReturnForCorrection;
        const openClarificationModal = () => {
            clarificationRemarks.value = "";
            clarificationError.value = "";
            showClarificationModal.value = true;
        };

        // Date and String Formatters
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
            if (type === "UNDERTIME") return "Hourglass";
            if (type === "CORRECTION") return "CalendarCheck";
            return "FileQuestion";
        };

        const typeBadgeTone = type => {
            if (type === "EXCUSE_SLIP") return "bg-info/10 text-info";
            if (type === "OVERTIME") return "bg-navy/10 text-navy";
            if (type === "UNDERTIME") return "bg-warning/15 text-warning";
            if (type === "CORRECTION") return "bg-amber-500/10 text-amber-700";
            return "bg-slate-100 text-slate-700";
        };

        Vue.onMounted(loadData);

        return {
            loading,
            loadError,
            requests,
            summary,
            searchQuery,
            filterType,
            filterStatus,
            filterDepartment,
            filterStartDate,
            filterEndDate,
            departments,
            hasActiveFilters,
            filteredRequests,
            paginatedRequests,
            currentPage,
            totalPages,
            pageSize,
            setPage,
            resetFilters,
            canReview,
            pendingMyReviewCount,
            loadData,
            showReviewModal,
            detailLoading,
            selectedRequest,
            selectedHistory,
            actionError,
            today,
            supervisorDecisionSelection,
            reviewRemarks,
            handleApproveRequest,
            handleRejectRequest,
            handleReturnForCorrection,
            handleClarificationToCoordinator,
            showApproveModal,
            approveRemarks,
            supervisorSignature,
            supervisorCanvasRef,
            clearSupervisorSignature,
            adoptSupervisorElectronicSignature,
            showReturnModal,
            returnRemarks,
            returnError,
            showRejectModal,
            rejectRemarks,
            rejectError,
            showClarificationModal,
            clarificationRemarks,
            clarificationError,
            submitting,
            openReviewModal,
            closeReviewModal,
            openApproveModal,
            openReturnModal,
            openRejectModal,
            openClarificationModal,
            confirmApprove,
            confirmReturn,
            confirmReject,
            confirmClarification,
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
        <page-header title="Review Requests"
                     subtitle="Review, approve, return for correction, or reject Excuse Slips, Overtime Forms, Undertime Forms, and Attendance Corrections submitted by your assigned Student Assistants.">
            <template #actions>
                <button @click="loadData" :disabled="loading" class="btn btn-secondary btn-sm">
                    <app-icon name="RefreshCw" :size="15" :class="{ 'animate-spin': loading }" /> Refresh
                </button>
            </template>
        </page-header>

        <!-- Summary Cards -->
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
            <!-- 1. Pending My Review -->
            <button @click="filterStatus = (filterStatus === 'PENDING_MY_REVIEW' ? '' : 'PENDING_MY_REVIEW')"
                    class="card p-4 text-left transition-all cursor-pointer group"
                    :class="filterStatus === 'PENDING_MY_REVIEW' ? 'ring-2 ring-warning border-warning shadow-xs' : 'hover:border-warning/40'">
                <div class="flex items-center justify-between">
                    <span class="text-caption font-semibold text-muted group-hover:text-ink transition-colors">Pending My Review</span>
                    <span class="grid h-8 w-8 place-items-center rounded-lg bg-warning/10 text-warning group-hover:bg-warning group-hover:text-white transition-colors">
                        <app-icon name="Clock" :size="16" />
                    </span>
                </div>
                <p class="mt-2 text-2xl font-bold text-warning">{{ pendingMyReviewCount }}</p>
                <p class="mt-0.5 text-[11px] text-muted">Awaiting your decision</p>
            </button>

            <!-- 2. Approved · Pending Coordinator Recording -->
            <button @click="filterStatus = (filterStatus === 'PENDING_COORDINATOR_RECORDING' ? '' : 'PENDING_COORDINATOR_RECORDING')"
                    class="card p-4 text-left transition-all cursor-pointer group"
                    :class="filterStatus === 'PENDING_COORDINATOR_RECORDING' ? 'ring-2 ring-info border-info shadow-xs' : 'hover:border-info/40'">
                <div class="flex items-center justify-between">
                    <span class="text-caption font-semibold text-muted group-hover:text-ink transition-colors">Approved · Pending Coordinator Recording</span>
                    <span class="grid h-8 w-8 place-items-center rounded-lg bg-info/10 text-info group-hover:bg-info group-hover:text-white transition-colors">
                        <app-icon name="UserCheck" :size="16" />
                    </span>
                </div>
                <p class="mt-2 text-2xl font-bold text-info">{{ summary.pendingCoordinatorRecording || 0 }}</p>
                <p class="mt-0.5 text-[11px] text-muted">Forwarded to S.A. Coordinator</p>
            </button>

            <!-- 3. Verified & Recorded -->
            <button @click="filterStatus = (filterStatus === 'RECORDED' ? '' : 'RECORDED')"
                    class="card p-4 text-left transition-all cursor-pointer group"
                    :class="filterStatus === 'RECORDED' ? 'ring-2 ring-success border-success shadow-xs' : 'hover:border-success/40'">
                <div class="flex items-center justify-between">
                    <span class="text-caption font-semibold text-muted group-hover:text-ink transition-colors">Verified &amp; Recorded</span>
                    <span class="grid h-8 w-8 place-items-center rounded-lg bg-success/10 text-success group-hover:bg-success group-hover:text-white transition-colors">
                        <app-icon name="CheckCircle2" :size="16" />
                    </span>
                </div>
                <p class="mt-2 text-2xl font-bold text-success">{{ summary.recorded || 0 }}</p>
                <p class="mt-0.5 text-[11px] text-muted">Completed workflow</p>
            </button>

            <!-- 4. Rejected -->
            <button @click="filterStatus = (filterStatus === 'REJECTED_BY_SUPERVISOR' ? '' : 'REJECTED_BY_SUPERVISOR')"
                    class="card p-4 text-left transition-all cursor-pointer group"
                    :class="filterStatus === 'REJECTED_BY_SUPERVISOR' ? 'ring-2 ring-danger border-danger shadow-xs' : 'hover:border-danger/40'">
                <div class="flex items-center justify-between">
                    <span class="text-caption font-semibold text-muted group-hover:text-ink transition-colors">Rejected</span>
                    <span class="grid h-8 w-8 place-items-center rounded-lg bg-danger/10 text-danger group-hover:bg-danger group-hover:text-white transition-colors">
                        <app-icon name="XCircle" :size="16" />
                    </span>
                </div>
                <p class="mt-2 text-2xl font-bold text-danger">{{ summary.rejected || 0 }}</p>
                <p class="mt-0.5 text-[11px] text-muted">Declined with recorded reason</p>
            </button>
        </div>

        <!-- Search & Filter Bar -->
        <div class="card p-4 mb-4 space-y-3">
            <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <!-- Search Box -->
                <div class="relative flex-1 max-w-md">
                    <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
                        <app-icon name="Search" :size="15" />
                    </span>
                    <input v-model.trim="searchQuery" type="text"
                           placeholder="Search by Request ID, S.A. name, student ID, or reason..."
                           class="input pl-9 py-2 text-caption w-full" />
                </div>

                <!-- Select Filters -->
                <div class="flex flex-wrap items-center gap-2">
                    <!-- Request Type -->
                    <select v-model="filterType" class="input w-auto py-2 text-caption">
                        <option value="">All Request Types</option>
                        <option value="EXCUSE_SLIP">Excuse Slip</option>
                        <option value="OVERTIME">Overtime (OT) Form</option>
                        <option value="UNDERTIME">Undertime Form</option>
                        <option value="CORRECTION">Attendance Correction</option>
                    </select>

                    <!-- Workflow Status -->
                    <select v-model="filterStatus" class="input w-auto py-2 text-caption">
                        <option value="">All Workflow Statuses</option>
                        <option value="PENDING_MY_REVIEW">Pending My Review</option>
                        <option value="PENDING_SUPERVISOR_REVIEW">Pending Supervisor Review</option>
                        <option value="PENDING_COORDINATOR_RECORDING">Approved · Pending Coordinator Recording</option>
                        <option value="RECORDED">Verified &amp; Recorded</option>
                        <option value="REJECTED_BY_SUPERVISOR">Rejected</option>
                        <option value="RETURNED_TO_SA">Returned to S.A.</option>
                        <option value="RETURNED_FOR_CLARIFICATION">Returned for Clarification</option>
                    </select>

                    <!-- Department -->
                    <select v-if="departments.length > 1" v-model="filterDepartment" class="input w-auto py-2 text-caption">
                        <option value="">All Departments / Areas</option>
                        <option v-for="d in departments" :key="d" :value="d">{{ d }}</option>
                    </select>

                    <!-- Reset Filters Button -->
                    <button v-if="hasActiveFilters"
                            @click="resetFilters"
                            class="btn btn-ghost btn-sm text-xs">
                        <app-icon name="RotateCcw" :size="13" /> Reset
                    </button>
                </div>
            </div>

            <!-- Date Range Filter Row -->
            <div class="flex flex-wrap items-center gap-3 pt-2.5 border-t border-line text-xs text-muted">
                <span class="font-medium text-slate-700 flex items-center gap-1.5">
                    <app-icon name="Calendar" :size="14" class="text-slate-400" />
                    <span>Filter Relevant Date:</span>
                </span>
                <div class="flex items-center gap-2">
                    <input type="date" v-model="filterStartDate"
                           class="input py-1 px-2.5 text-xs text-ink w-auto" />
                    <span class="text-muted">&ndash;</span>
                    <input type="date" v-model="filterEndDate"
                           class="input py-1 px-2.5 text-xs text-ink w-auto" />
                </div>
                <span v-if="filterStartDate || filterEndDate" class="text-[11px] text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-200">
                    Date active
                </span>
            </div>
        </div>

        <!-- Requests Table Card -->
        <div class="card overflow-hidden">
            <div v-if="loading" class="p-10 text-center text-muted text-body flex flex-col items-center justify-center gap-2">
                <div class="animate-spin text-blue-600">
                    <app-icon name="RefreshCw" :size="24" />
                </div>
                <span>Loading team requests...</span>
            </div>

            <div v-else-if="loadError" class="p-10 text-center">
                <app-icon name="CircleX" :size="28" class="mx-auto text-danger" />
                <p class="mt-2 text-body font-semibold text-ink">Unable to load team requests</p>
                <p class="mt-1 text-caption text-muted">{{ loadError }}</p>
                <button @click="loadData" class="btn btn-secondary btn-sm mt-3">
                    Try Again
                </button>
            </div>

            <div v-else-if="!filteredRequests.length" class="p-12 text-center">
                <div class="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full bg-mist text-navy">
                    <app-icon name="Inbox" :size="22" />
                </div>
                <p class="text-body font-semibold text-ink">No requests found</p>
                <p class="mt-1 text-caption text-muted max-w-md mx-auto">
                    {{ requests.length ? 'No requests match your current search or filter criteria.' : 'No Student Assistants under your supervision have submitted requests yet.' }}
                </p>
                <button v-if="hasActiveFilters" @click="resetFilters" class="btn btn-secondary btn-sm mt-3">
                    Clear Filters
                </button>
            </div>

            <div v-else>
                <div class="overflow-x-auto">
                    <table class="w-full text-left text-caption">
                        <thead>
                            <tr class="border-b border-line bg-page/60 text-[11px] font-semibold uppercase tracking-wider text-muted">
                                <th class="px-4 py-3 whitespace-nowrap">Request ID</th>
                                <th class="px-4 py-3 whitespace-nowrap">S.A. Name &amp; ID</th>
                                <th class="px-4 py-3 whitespace-nowrap">Assigned Area</th>
                                <th class="px-4 py-3 whitespace-nowrap">Request Type</th>
                                <th class="px-4 py-3 whitespace-nowrap">Relevant Date &amp; Schedule</th>
                                <th class="px-4 py-3 whitespace-nowrap">Submission Date</th>
                                <th class="px-4 py-3 whitespace-nowrap">Current Workflow Status</th>
                                <th class="px-4 py-3 text-right whitespace-nowrap">Actions</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-line">
                            <tr v-for="req in paginatedRequests" :key="req.id" class="hover:bg-page/50 transition-colors">
                                <!-- 1. Request ID -->
                                <td class="px-4 py-3.5 font-mono text-xs font-semibold text-navy whitespace-nowrap">
                                    <button @click="openReviewModal(req)" class="hover:underline text-navy font-bold">
                                        {{ req.requestCode || req.requestRefNo }}
                                    </button>
                                </td>

                                <!-- 2. S.A. Name & Student ID -->
                                <td class="px-4 py-3.5 whitespace-nowrap">
                                    <div class="font-semibold text-ink">{{ req.saName }}</div>
                                    <div class="text-[11px] text-muted">{{ req.studentId }} <span v-if="req.saNumber">· {{ req.saNumber }}</span></div>
                                </td>

                                <!-- 3. Assigned Area / Department -->
                                <td class="px-4 py-3.5 whitespace-nowrap">
                                    <span class="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                        {{ req.department || 'Unassigned' }}
                                    </span>
                                    <div v-if="req.location && req.location !== req.department" class="text-[11px] text-muted mt-0.5 truncate max-w-[150px]">
                                        {{ req.location }}
                                    </div>
                                </td>

                                <!-- 4. Request Type -->
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

                                <!-- 5. Relevant Date & Schedule -->
                                <td class="px-4 py-3.5 whitespace-nowrap">
                                    <div class="font-medium text-ink">{{ formatRelevantDate(req) }}</div>
                                    <div v-if="req.requestType === 'UNDERTIME' && req.actualTime" class="text-[11px] text-muted">
                                        Actual Departure: {{ formatTime(req.actualTime) }}
                                    </div>
                                    <div v-else-if="req.requestType === 'CORRECTION'" class="text-[11px] text-amber-700 font-medium">
                                        Requested Punch: {{ formatTime(req.requestedStart) }}
                                    </div>
                                    <div v-else-if="req.requestedStart && req.requestedEnd" class="text-[11px] text-muted">
                                        {{ formatTime(req.requestedStart) }} – {{ formatTime(req.requestedEnd) }}
                                        <span v-if="req.hoursAffected">({{ req.hoursAffected }}h)</span>
                                    </div>
                                    <div v-else-if="req.scheduledStart && req.scheduledEnd" class="text-[11px] text-muted">
                                        Shift: {{ formatTime(req.scheduledStart) }} – {{ formatTime(req.scheduledEnd) }}
                                    </div>
                                </td>

                                <!-- 6. Submission Date -->
                                <td class="px-4 py-3.5 text-muted whitespace-nowrap">
                                    {{ req.submittedAt ? formatDateTime(req.submittedAt) : formatDateTime(req.createdAt) }}
                                </td>

                                <!-- 7. Workflow Status -->
                                <td class="px-4 py-3.5 whitespace-nowrap">
                                    <status-badge group="requestStatus" :value="req.status" />
                                </td>

                                <!-- 8. Actions -->
                                <td class="px-4 py-3.5 text-right whitespace-nowrap">
                                    <button @click="openReviewModal(req)"
                                            class="btn btn-sm"
                                            :class="canReview(req) ? 'btn-primary' : 'btn-secondary'">
                                        <app-icon :name="canReview(req) ? 'ClipboardCheck' : 'Eye'" :size="14" />
                                        {{ canReview(req) ? 'Review' : 'View Details' }}
                                    </button>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <!-- Pagination Footer -->
                <div v-if="filteredRequests.length > pageSize" class="flex flex-wrap items-center justify-between gap-3 p-3.5 border-t border-line text-xs">
                    <div class="text-muted">
                        Showing <span class="font-semibold text-ink">{{ (currentPage - 1) * pageSize + 1 }}</span>
                        to <span class="font-semibold text-ink">{{ Math.min(currentPage * pageSize, filteredRequests.length) }}</span>
                        of <span class="font-semibold text-ink">{{ filteredRequests.length }}</span> requests
                    </div>
                    <div class="flex items-center gap-1.5">
                        <button @click="setPage(currentPage - 1)" :disabled="currentPage <= 1" class="btn btn-secondary btn-sm px-2.5 py-1 text-xs">
                            <app-icon name="ChevronLeft" :size="14" /> Previous
                        </button>
                        <span class="px-2 text-muted font-medium">Page {{ currentPage }} of {{ totalPages }}</span>
                        <button @click="setPage(currentPage + 1)" :disabled="currentPage >= totalPages" class="btn btn-secondary btn-sm px-2.5 py-1 text-xs">
                            Next <app-icon name="ChevronRight" :size="14" />
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- ================================================================= -->
        <!-- MODAL 1: REQUEST REVIEW & DETAILS MODAL -->
        <!-- ================================================================= -->
        <app-modal :open="showReviewModal"
                   :title="selectedRequest ? ('Request Review — ' + (selectedRequest.requestCode || selectedRequest.requestRefNo)) : 'Request Details'"
                   icon="ClipboardCheck" size="xl" @close="closeReviewModal">
            <div v-if="detailLoading" class="py-10 text-center text-muted text-body flex flex-col items-center justify-center gap-2">
                <div class="animate-spin text-blue-600">
                    <app-icon name="RefreshCw" :size="24" />
                </div>
                <span>Loading request details...</span>
            </div>

            <div v-else-if="selectedRequest" class="space-y-4 text-caption">
                <!-- Header Banner -->
                <div class="flex flex-wrap items-center justify-between gap-2 p-3.5 rounded-xl bg-page border border-line">
                    <div>
                        <span class="text-[11px] font-semibold uppercase text-muted">Request Type</span>
                        <div class="text-body font-bold text-ink mt-0.5 flex items-center gap-2">
                            <span>{{ label('requestType', selectedRequest.requestType) }}</span>
                            <span v-if="selectedRequest.requestType === 'UNDERTIME' && selectedRequest.undertimeType"
                                  class="text-xs font-semibold px-2 py-0.5 rounded-md bg-warning/15 text-warning">
                                {{ selectedRequest.undertimeType }}
                            </span>
                        </div>
                    </div>
                    <div class="text-right">
                        <span class="text-[11px] font-semibold uppercase text-muted block mb-1">Current Status</span>
                        <status-badge group="requestStatus" :value="selectedRequest.status" />
                    </div>
                </div>

                <!-- Student Assistant Details -->
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
                        <span class="text-[11px] text-muted block">Submitted On</span>
                        <span class="font-semibold text-ink">{{ formatDateTime(selectedRequest.submittedAt || selectedRequest.createdAt) }}</span>
                    </div>
                </div>

                <!-- Attendance Correction Comparison Card (for CORRECTION requests) -->
                <div v-if="selectedRequest.requestType === 'CORRECTION' || (selectedRequest.requestCode && selectedRequest.requestCode.includes('CORR'))"
                     class="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-2">
                    <div class="flex items-center gap-2">
                        <app-icon name="CalendarCheck" :size="16" class="text-amber-800" />
                        <span class="text-xs font-bold uppercase text-amber-800 tracking-wider">Attendance Correction Comparison</span>
                    </div>
                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-1">
                        <div class="p-3 rounded-lg bg-white border border-amber-200 shadow-xs">
                            <span class="text-[11px] text-muted block font-medium">Original Recorded Punch</span>
                            <span class="text-sm font-bold text-slate-800 mt-1 block">
                                {{ formatTime(selectedRequest.actualTime) || (selectedRequest.scheduledStart ? (formatTime(selectedRequest.scheduledStart) + ' (Scheduled)') : 'Missing Punch') }}
                            </span>
                            <span class="text-[11px] text-muted">Recorded machine timestamp</span>
                        </div>
                        <div class="p-3 rounded-lg bg-white border border-blue-200 shadow-xs">
                            <span class="text-[11px] text-blue-700 block font-semibold">Requested Corrected Value</span>
                            <span class="text-sm font-bold text-blue-700 mt-1 block">
                                {{ formatTime(selectedRequest.requestedStart) }}
                                <span v-if="selectedRequest.requestedEnd"> – {{ formatTime(selectedRequest.requestedEnd) }}</span>
                            </span>
                            <span class="text-[11px] text-muted">Proposed official timestamp</span>
                        </div>
                    </div>
                </div>

                <!-- Request Details Grid -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl border border-line">
                    <div>
                        <span class="text-[11px] text-muted block">Relevant Duty Date</span>
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

                    <!-- Overtime Task Schedule Table -->
                    <div class="sm:col-span-2" v-if="selectedRequest.overtimeRows && selectedRequest.overtimeRows.length">
                        <span class="text-[11px] font-semibold uppercase text-muted block mb-1.5">Overtime Duty Schedule</span>
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
                                        <td class="px-2.5 py-1.5 whitespace-nowrap">{{ formatDate(r.date) }}</td>
                                        <td class="px-2.5 py-1.5 font-medium text-ink">{{ r.task }}</td>
                                        <td class="px-2.5 py-1.5 whitespace-nowrap">{{ formatTime(r.regularStart) }} – {{ formatTime(r.regularEnd) }}</td>
                                        <td class="px-2.5 py-1.5 whitespace-nowrap">{{ formatTime(r.otStart) }} – {{ formatTime(r.otEnd) }}</td>
                                        <td class="px-2.5 py-1.5 font-semibold text-navy whitespace-nowrap">{{ r.otHours }} hrs</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <!-- Requester Explanation -->
                    <div class="sm:col-span-2" v-if="selectedRequest.explanation">
                        <span class="text-[11px] text-muted block">Student's Explanation / Justification</span>
                        <p class="mt-1 p-2.5 rounded-lg bg-page border border-line text-ink whitespace-pre-line">{{ selectedRequest.explanation }}</p>
                    </div>
                    <div class="sm:col-span-2" v-if="selectedRequest.notes">
                        <span class="text-[11px] text-muted block">Additional Details / Notes</span>
                        <p class="mt-0.5 text-ink whitespace-pre-line">{{ selectedRequest.notes }}</p>
                    </div>
                </div>

                <!-- Supporting Proof Attachment -->
                <div class="p-3.5 rounded-xl border border-line flex items-center justify-between gap-3">
                    <div>
                        <span class="text-[11px] font-semibold uppercase text-muted block">Supporting Proof / Attached Document</span>
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

                <!-- DECISION STATUS PANELS -->

                <!-- Rejection Notice Banner -->
                <div v-if="selectedRequest.status === 'REJECTED_BY_SUPERVISOR' || selectedRequest.supervisorDecision === 'REJECTED'"
                     class="p-4 rounded-xl bg-danger/10 border border-danger/30 space-y-1.5">
                    <div class="flex items-center gap-2">
                        <app-icon name="XCircle" :size="16" class="text-danger" />
                        <span class="text-xs font-bold uppercase text-danger tracking-wider">Reason for Rejection</span>
                    </div>
                    <p class="text-xs text-ink font-medium whitespace-pre-line bg-white/90 p-2.5 rounded-lg border border-danger/20">
                        {{ selectedRequest.supervisorRemarks || 'No rejection remarks recorded.' }}
                    </p>
                    <div class="text-[11px] text-muted">
                        Rejected by <span class="font-medium text-slate-800">{{ selectedRequest.supervisorName || 'Immediate Supervisor' }}</span>
                        on {{ formatDateTime(selectedRequest.supervisorActedAt) }}
                    </div>
                </div>

                <!-- Return Instructions Banner -->
                <div v-if="selectedRequest.status === 'RETURNED_TO_SA' || selectedRequest.supervisorDecision === 'RETURNED'"
                     class="p-4 rounded-xl bg-warning/10 border border-warning/30 space-y-1.5">
                    <div class="flex items-center gap-2">
                        <app-icon name="RotateCcw" :size="16" class="text-warning" />
                        <span class="text-xs font-bold uppercase text-warning tracking-wider">Correction Instructions from Supervisor</span>
                    </div>
                    <p class="text-xs text-ink font-medium whitespace-pre-line bg-white/90 p-2.5 rounded-lg border border-warning/20">
                        {{ selectedRequest.supervisorRemarks || 'No specific instructions provided.' }}
                    </p>
                    <div class="text-[11px] text-muted">
                        Returned by <span class="font-medium text-slate-800">{{ selectedRequest.supervisorName || 'Immediate Supervisor' }}</span>
                        on {{ formatDateTime(selectedRequest.supervisorActedAt) }}
                    </div>
                </div>

                <!-- Supervisor Approval Banner -->
                <div v-if="selectedRequest.supervisorDecision === 'APPROVED'"
                     class="p-3.5 rounded-xl bg-info/10 border border-info/30 space-y-1">
                    <div class="flex items-center gap-2">
                        <app-icon name="UserCheck" :size="15" class="text-info" />
                        <span class="text-xs font-bold uppercase text-info tracking-wider">Immediate Supervisor Endorsement</span>
                    </div>
                    <p class="text-xs text-ink whitespace-pre-line">
                        {{ selectedRequest.supervisorRemarks || 'Approved and endorsed to S.A. Coordinator for verification and recording.' }}
                    </p>
                    <div class="text-[11px] text-muted">
                        Endorsed by <span class="font-medium text-slate-800">{{ selectedRequest.supervisorName }}</span>
                        on {{ formatDateTime(selectedRequest.supervisorActedAt) }}
                    </div>
                </div>

                <!-- Coordinator Clarification Alert Banner -->
                <div v-if="selectedRequest.status === 'RETURNED_FOR_CLARIFICATION' || selectedRequest.coordinatorRemarks"
                     class="p-3.5 rounded-xl bg-purple-50 border border-purple-200 space-y-1">
                    <div class="flex items-center gap-2">
                        <app-icon name="HelpCircle" :size="15" class="text-purple-700" />
                        <span class="text-xs font-bold uppercase text-purple-700 tracking-wider">S.A. Coordinator Remarks / Clarification</span>
                    </div>
                    <p class="text-xs text-ink whitespace-pre-line bg-white p-2.5 rounded-lg border border-purple-100">
                        {{ selectedRequest.coordinatorRemarks || 'Coordinator returned this request for clarification.' }}
                    </p>
                    <div class="text-[11px] text-muted" v-if="selectedRequest.coordinatorName">
                        From <span class="font-medium text-slate-800">{{ selectedRequest.coordinatorName }}</span>
                        on {{ formatDateTime(selectedRequest.coordinatorActedAt) }}
                    </div>
                </div>

                <!-- Coordinator Final Recording Banner -->
                <div v-if="selectedRequest.status === 'RECORDED'"
                     class="p-3.5 rounded-xl bg-success/10 border border-success/30 space-y-1">
                    <div class="flex items-center gap-2">
                        <app-icon name="CheckCircle2" :size="15" class="text-success" />
                        <span class="text-xs font-bold uppercase text-success tracking-wider">Coordinator Verification &amp; Recording Complete</span>
                    </div>
                    <p class="text-xs text-ink">
                        {{ selectedRequest.coordinatorRemarks || 'Verified and recorded in official S.A. attendance and allowance roster.' }}
                    </p>
                    <div class="text-[11px] text-muted">
                        Recorded by <span class="font-medium text-slate-800">{{ selectedRequest.coordinatorName || 'S.A. Coordinator' }}</span>
                        on {{ formatDateTime(selectedRequest.recordedAt || selectedRequest.coordinatorActedAt) }}
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
                        <div class="rounded-xl border border-line bg-white p-3.5 flex flex-col justify-between space-y-3 shadow-xs"
                             :class="canReview(selectedRequest) ? 'ring-2 ring-navy/20 border-navy shadow-sm' : ''">
                            <div class="flex items-center justify-between gap-2">
                                <span class="font-bold text-slate-800 uppercase text-[11px] tracking-wide">2. Immediate Supervisor</span>
                                <span v-if="canReview(selectedRequest)" class="rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-800 shrink-0">Stage 1 Action</span>
                                <span v-else class="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 shrink-0">Stage 1</span>
                            </div>

                            <!-- Interactive Decision Choice when reviewable -->
                            <div v-if="canReview(selectedRequest)" class="grid grid-cols-2 gap-2">
                                <label class="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg border text-xs font-bold cursor-pointer transition-all"
                                       :class="supervisorDecisionSelection === 'APPROVED' ? 'bg-emerald-50 border-emerald-300 text-emerald-800 shadow-xs' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'">
                                    <input type="radio" value="APPROVED" v-model="supervisorDecisionSelection" class="hidden" />
                                    <app-icon name="Check" :size="13" />
                                    <span>Approved</span>
                                </label>
                                <label class="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg border text-xs font-bold cursor-pointer transition-all"
                                       :class="supervisorDecisionSelection === 'NOT_APPROVED' ? 'bg-rose-50 border-rose-300 text-rose-800 shadow-xs' : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'">
                                    <input type="radio" value="NOT_APPROVED" v-model="supervisorDecisionSelection" class="hidden" />
                                    <app-icon name="X" :size="13" />
                                    <span>Not Approved</span>
                                </label>
                            </div>
                            <div v-else class="flex items-center gap-2 text-xs">
                                <span v-if="selectedRequest.supervisorDecision === 'APPROVED'" class="inline-flex items-center gap-1 text-emerald-700 font-bold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md text-[11px]">
                                    <app-icon name="CheckCircle2" :size="12" /> Approved
                                </span>
                                <span v-else-if="selectedRequest.status === 'REJECTED_BY_SUPERVISOR' || selectedRequest.supervisorDecision === 'REJECTED' || selectedRequest.supervisorDecision === 'NOT_APPROVED'" class="inline-flex items-center gap-1 text-rose-700 font-bold bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md text-[11px]">
                                    <app-icon name="XCircle" :size="12" /> Not Approved
                                </span>
                                <span v-else class="text-slate-400 text-[11px] italic">Pending Your Decision</span>
                            </div>

                            <!-- Drawing Canvas when reviewable / Image when read-only -->
                            <div v-if="canReview(selectedRequest)" class="space-y-1.5">
                                <div class="flex items-center justify-between text-[11px]">
                                    <span class="text-slate-500 font-medium">Signature Pad:</span>
                                    <div class="flex items-center gap-1.5">
                                        <button type="button" @click="adoptSupervisorElectronicSignature"
                                                class="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md px-2 py-0.5 transition-colors">
                                            <app-icon name="PenTool" :size="11" />
                                            <span>Adopt E-Sig</span>
                                        </button>
                                        <button type="button" @click="clearSupervisorSignature"
                                                class="inline-flex items-center gap-1 text-[11px] font-bold text-rose-600 hover:text-rose-800 hover:bg-rose-50 rounded-md px-1.5 py-0.5 transition-colors">
                                            <app-icon name="Trash2" :size="11" />
                                            <span>Clear</span>
                                        </button>
                                    </div>
                                </div>
                                <div class="relative overflow-hidden rounded-lg border-2 border-slate-300 bg-white shadow-inner h-28">
                                    <canvas ref="supervisorCanvasRef" width="380" height="112" class="h-full w-full cursor-crosshair bg-white block" style="touch-action: none; background-color: #ffffff;"></canvas>
                                    <div v-if="!supervisorSignature" class="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-slate-400 font-medium">
                                        Draw signature or click Adopt E-Sig
                                    </div>
                                </div>
                            </div>
                            <div v-else class="h-28 rounded-lg border border-slate-200 bg-slate-50/60 flex items-center justify-center p-2 overflow-hidden">
                                <img v-if="selectedRequest.supervisorSignature" :src="selectedRequest.supervisorSignature" class="max-h-full max-w-full object-contain" alt="Supervisor Signature" />
                                <span v-else class="text-xs text-slate-400 italic">{{ selectedRequest.supervisorActedAt ? 'Signed by Supervisor' : 'Pending Your Decision' }}</span>
                            </div>

                            <div class="border-t border-slate-100 pt-2.5 mt-auto space-y-0.5">
                                <div class="font-bold text-slate-800 text-xs truncate">{{ selectedRequest.supervisorName || Store.user?.name || 'Immediate Supervisor' }}</div>
                                <div class="text-[11px] text-slate-500">Date: {{ canReview(selectedRequest) ? formatDate(today) : (selectedRequest.supervisorSignDate ? formatDate(selectedRequest.supervisorSignDate) : (selectedRequest.supervisorActedAt ? formatDate(selectedRequest.supervisorActedAt.slice(0, 10)) : 'Pending')) }}</div>
                            </div>
                        </div>

                        <!-- Col 3: S.A. Coordinator -->
                        <div class="rounded-xl border border-line bg-white p-3.5 flex flex-col justify-between space-y-3 shadow-xs">
                            <div class="flex items-center justify-between">
                                <span class="font-bold text-slate-800 uppercase text-[11px] tracking-wide">3. S.A. Coordinator</span>
                                <span class="rounded-full bg-blue-50 border border-blue-200 px-2 py-0.5 text-[10px] font-bold text-blue-700">Final Stage</span>
                            </div>

                            <div class="flex items-center gap-2 text-xs">
                                <span v-if="selectedRequest.status === 'RECORDED'" class="inline-flex items-center gap-1 text-emerald-700 font-bold bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md text-[11px]">
                                    <app-icon name="CheckCircle2" :size="12" /> Approved &amp; Recorded
                                </span>
                                <span v-else-if="selectedRequest.status === 'RETURNED_FOR_CLARIFICATION' || selectedRequest.coordinatorDecision === 'NOT_APPROVED'" class="inline-flex items-center gap-1 text-rose-700 font-bold bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md text-[11px]">
                                    <app-icon name="XCircle" :size="12" /> Not Approved
                                </span>
                                <span v-else class="text-slate-400 text-[11px] italic">Pending Final Stage</span>
                            </div>

                            <div class="h-28 rounded-lg border border-slate-200 bg-slate-50/60 flex items-center justify-center p-2 overflow-hidden text-center">
                                <img v-if="selectedRequest.coordinatorSignature" :src="selectedRequest.coordinatorSignature" class="max-h-full max-w-full object-contain" alt="Coordinator Signature" />
                                <div v-else class="text-xs text-slate-400 flex flex-col items-center justify-center gap-1.5 py-3">
                                    <div class="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                                        <app-icon name="Lock" :size="14" />
                                    </div>
                                    <span class="font-medium text-slate-500">Restricted to Coordinator</span>
                                </div>
                            </div>

                            <div class="border-t border-slate-100 pt-2.5 mt-auto space-y-0.5">
                                <div class="font-bold text-slate-800 text-xs truncate">{{ selectedRequest.coordinatorName || 'Ansherina A Sudario' }}</div>
                                <div class="text-[11px] text-slate-500">Date: {{ selectedRequest.coordinatorSignDate ? formatDate(selectedRequest.coordinatorSignDate) : (selectedRequest.recordedAt ? formatDate(selectedRequest.recordedAt.slice(0, 10)) : 'Pending') }}</div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Supervisor Decision Action Bar -->
                <div v-if="canReview(selectedRequest)" class="p-4 rounded-xl bg-mist/60 border border-line space-y-3">
                    <div class="flex items-center justify-between">
                        <div>
                            <h4 class="text-xs font-bold uppercase tracking-wider text-navy">
                                Supervisor Review Actions
                            </h4>
                            <p class="text-[11px] text-muted mt-0.5">
                                Select an action below to process this request. Rejections require a mandatory reason.
                            </p>
                        </div>
                    </div>

                    <!-- Mandatory Remarks / Reason / Instructions Field -->
                    <div class="space-y-1">
                        <label class="block text-[11px] font-bold text-slate-700">
                            Supervisor Reason / Remarks / Instructions
                            <span v-if="supervisorDecisionSelection === 'NOT_APPROVED'" class="text-rose-600 font-bold">* (Mandatory for Rejection)</span>
                            <span v-else class="text-slate-500 font-normal">(Mandatory for return; optional for approval)</span>
                        </label>
                        <textarea v-model.trim="reviewRemarks" rows="2"
                                  placeholder="Provide official remarks, rejection reasons, or correction instructions..."
                                  class="w-full rounded-xl border border-slate-300 bg-white p-2.5 text-xs text-slate-800 focus:border-[#0F2C59] focus:outline-none"
                                  :class="{ 'border-danger ring-1 ring-danger': actionError && !reviewRemarks.trim() }"></textarea>
                    </div>

                    <div v-if="actionError" class="p-2.5 rounded-lg bg-danger/10 border border-danger/30 text-danger text-xs font-medium">
                        {{ actionError }}
                    </div>

                    <div class="flex flex-wrap items-center justify-end gap-2 pt-1 border-t border-line/60">
                        <template v-if="selectedRequest.status === 'PENDING_SUPERVISOR_REVIEW'">
                            <button @click="handleRejectRequest" :disabled="submitting" class="btn btn-danger btn-sm">
                                <app-icon name="XCircle" :size="14" /> Reject Request
                            </button>
                            <button @click="handleReturnForCorrection" :disabled="submitting" class="btn btn-secondary btn-sm">
                                <app-icon name="RotateCcw" :size="14" /> Return for Correction
                            </button>
                            <button @click="handleApproveRequest" :disabled="submitting" class="btn btn-primary btn-sm">
                                <app-icon name="Check" :size="14" /> Approve &amp; Forward to Coordinator
                            </button>
                        </template>

                        <template v-else-if="selectedRequest.status === 'RETURNED_FOR_CLARIFICATION'">
                            <button @click="handleReturnForCorrection" :disabled="submitting" class="btn btn-secondary btn-sm">
                                <app-icon name="RotateCcw" :size="14" /> Return to S.A.
                            </button>
                            <button @click="handleClarificationToCoordinator" :disabled="submitting" class="btn btn-primary btn-sm">
                                <app-icon name="Send" :size="14" /> Submit Clarification to Coordinator
                            </button>
                        </template>
                    </div>
                </div>

                <!-- Request Timeline / Audit History -->
                <div class="p-3.5 rounded-xl border border-line">
                    <h4 class="text-[11px] font-semibold uppercase tracking-wider text-muted mb-3 flex items-center gap-1.5">
                        <app-icon name="History" :size="14" />
                        <span>Workflow History &amp; Audit Trail</span>
                    </h4>
                    <div v-if="!selectedHistory.length" class="text-muted text-xs">No history entries recorded yet.</div>
                    <ol v-else class="relative border-l border-line ml-2 space-y-3 text-xs">
                        <li v-for="h in selectedHistory" :key="h.id" class="ml-4">
                            <span class="absolute -left-1.5 mt-1 h-3 w-3 rounded-full bg-navy border-2 border-white"></span>
                            <div class="flex flex-wrap items-center justify-between gap-1">
                                <span class="font-semibold text-ink">{{ formatAction(h.action) }}</span>
                                <span class="text-[11px] text-muted">{{ formatDateTime(h.createdAt) }}</span>
                            </div>
                            <div class="text-[11px] text-muted mt-0.5">
                                By <span class="font-medium text-slate-800">{{ h.actorName }}</span> ({{ formatRole(h.actorRole) }}) &bull;
                                New Status: <span class="font-medium text-ink">{{ label('requestStatus', h.toStatus) }}</span>
                            </div>
                            <p v-if="h.remarks" class="mt-1 p-2 rounded bg-page border border-line text-ink whitespace-pre-line text-[11px]">
                                {{ h.remarks }}
                            </p>
                        </li>
                    </ol>
                </div>
            </div>

            <template #footer>
                <button @click="closeReviewModal" class="btn btn-secondary btn-sm">
                    Close
                </button>
            </template>
        </app-modal>

        <!-- ================================================================= -->
        <!-- MODAL 2: APPROVE CONFIRMATION MODAL -->
        <!-- ================================================================= -->
        <app-modal :open="showApproveModal"
                   :title="selectedRequest ? ('Approve Request — ' + (selectedRequest.requestCode || selectedRequest.requestRefNo)) : 'Approve Request'"
                   icon="Check" tone="navy" z="z-[60]" size="md" @close="showApproveModal = false">
            <div v-if="selectedRequest" class="space-y-4 text-xs">
                <!-- Summary Card -->
                <div class="p-3 rounded-lg bg-page border border-line space-y-1">
                    <div class="font-semibold text-ink text-sm">{{ selectedRequest.saName }}</div>
                    <div class="text-muted">{{ selectedRequest.studentId }} &bull; {{ selectedRequest.department }}</div>
                    <div class="font-medium text-blue-700 mt-1">
                        {{ label('requestType', selectedRequest.requestType) }} &bull; {{ formatRelevantDate(selectedRequest) }}
                    </div>
                </div>

                <!-- Explanation Banner -->
                <div class="p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-900 space-y-1">
                    <div class="font-bold flex items-center gap-1.5">
                        <app-icon name="Info" :size="15" class="text-blue-600" />
                        <span>Workflow Stage Notice</span>
                    </div>
                    <p class="text-[11px] leading-relaxed">
                        Approving this request forwards it to the <strong>S.A. Coordinator</strong> for official verification and recording.
                        The request status will update to <strong>Approved &bull; Pending Coordinator Recording</strong>.
                    </p>
                </div>

                <!-- Supervisor Decision & E-Signature Pad -->
                <div class="rounded-xl border border-slate-200 bg-page/60 p-3.5 space-y-3">
                    <div class="flex items-center justify-between">
                        <label class="inline-flex items-center gap-2 text-xs font-bold text-emerald-800">
                            <input type="checkbox" checked disabled class="h-4 w-4 rounded text-emerald-600 cursor-not-allowed" />
                            <span>Approved by Immediate Supervisor</span>
                        </label>
                        <div class="flex items-center gap-2">
                            <button type="button" @click="adoptSupervisorElectronicSignature"
                                    class="text-[10px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded px-2 py-0.5">
                                Adopt E-Sig
                            </button>
                            <button type="button" @click="clearSupervisorSignature"
                                    class="text-[10px] font-bold text-rose-600 hover:underline">
                                Clear Pad
                            </button>
                        </div>
                    </div>

                    <div class="relative overflow-hidden rounded-lg border border-slate-300 bg-white shadow-inner">
                        <canvas ref="supervisorCanvasRef" width="380" height="90" class="h-20 w-full cursor-crosshair" style="touch-action: none;"></canvas>
                        <div v-if="!supervisorSignature" class="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] text-slate-400 font-medium">
                            Draw your supervisor signature or click Adopt E-Sig
                        </div>
                    </div>

                    <div class="flex items-center justify-between text-[11px] text-slate-600 border-t border-slate-200 pt-1.5">
                        <span>Supervisor: <strong>{{ Store.user?.name || 'Immediate Supervisor' }}</strong></span>
                        <span>Date Signed: <strong>{{ (new Date()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }}</strong></span>
                    </div>
                </div>

                <!-- Optional Remarks Field -->
                <div>
                    <label class="field-label">
                        Supervisor Endorsement Remarks
                        <span class="text-muted font-normal">(Optional notes for the Coordinator)</span>
                    </label>
                    <textarea v-model.trim="approveRemarks" rows="2"
                              placeholder="Enter optional endorsement notes or confirmation comments..."
                              class="input w-full"></textarea>
                </div>
            </div>

            <template #footer>
                <div class="flex items-center justify-end gap-2">
                    <button @click="showApproveModal = false" :disabled="submitting" class="btn btn-secondary btn-sm">
                        Cancel
                    </button>
                    <button @click="confirmApprove" :disabled="submitting" class="btn btn-primary btn-sm">
                        <app-icon name="Check" :size="14" />
                        <span>{{ submitting ? 'Submitting Approval...' : 'Confirm &amp; Forward to Coordinator' }}</span>
                    </button>
                </div>
            </template>
        </app-modal>

        <!-- ================================================================= -->
        <!-- MODAL 3: RETURN FOR CORRECTION MODAL -->
        <!-- ================================================================= -->
        <app-modal :open="showReturnModal"
                   :title="selectedRequest ? ('Return for Correction — ' + (selectedRequest.requestCode || selectedRequest.requestRefNo)) : 'Return for Correction'"
                   icon="RotateCcw" tone="warning" z="z-[60]" size="md" @close="showReturnModal = false">
            <div v-if="selectedRequest" class="space-y-4 text-xs">
                <!-- Summary Card -->
                <div class="p-3 rounded-lg bg-page border border-line space-y-1">
                    <div class="font-semibold text-ink text-sm">{{ selectedRequest.saName }}</div>
                    <div class="text-muted">{{ selectedRequest.studentId }} &bull; {{ selectedRequest.department }}</div>
                    <div class="font-medium text-warning mt-1">
                        {{ label('requestType', selectedRequest.requestType) }} &bull; {{ formatRelevantDate(selectedRequest) }}
                    </div>
                </div>

                <!-- Explanation Banner -->
                <div class="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 space-y-1">
                    <div class="font-bold flex items-center gap-1.5">
                        <app-icon name="AlertTriangle" :size="15" class="text-amber-600" />
                        <span>Return to Student Assistant</span>
                    </div>
                    <p class="text-[11px] leading-relaxed">
                        The Student Assistant will receive a notification and can review your correction instructions, adjust details, attach revised documents, and resubmit.
                    </p>
                </div>

                <!-- Mandatory Correction Instructions Field -->
                <div>
                    <label class="field-label text-slate-800 font-bold">
                        Correction Instructions / Reason for Return
                        <span class="text-danger font-bold">*</span>
                    </label>
                    <textarea v-model.trim="returnRemarks" rows="3"
                              placeholder="Clearly specify what information, dates, duty hours, or supporting proof documents need correction..."
                              class="input w-full"
                              :class="{ 'border-danger ring-1 ring-danger': returnError }"></textarea>
                    <p v-if="returnError" class="mt-1 text-[11px] font-semibold text-danger">
                        {{ returnError }}
                    </p>
                </div>
            </div>

            <template #footer>
                <div class="flex items-center justify-end gap-2">
                    <button @click="showReturnModal = false" :disabled="submitting" class="btn btn-secondary btn-sm">
                        Cancel
                    </button>
                    <button @click="confirmReturn" :disabled="submitting || !returnRemarks.trim()" class="btn btn-warning btn-sm">
                        <app-icon name="RotateCcw" :size="14" />
                        <span>{{ submitting ? 'Returning Request...' : 'Return to S.A. for Correction' }}</span>
                    </button>
                </div>
            </template>
        </app-modal>

        <!-- ================================================================= -->
        <!-- MODAL 4: REJECT CONFIRMATION MODAL -->
        <!-- ================================================================= -->
        <app-modal :open="showRejectModal"
                   :title="selectedRequest ? ('Reject Request — ' + (selectedRequest.requestCode || selectedRequest.requestRefNo)) : 'Reject Request'"
                   icon="XCircle" tone="danger" z="z-[60]" size="md" @close="showRejectModal = false">
            <div v-if="selectedRequest" class="space-y-4 text-xs">
                <!-- Summary Card -->
                <div class="p-3 rounded-lg bg-page border border-line space-y-1">
                    <div class="font-semibold text-ink text-sm">{{ selectedRequest.saName }}</div>
                    <div class="text-muted">{{ selectedRequest.studentId }} &bull; {{ selectedRequest.department }}</div>
                    <div class="font-medium text-danger mt-1">
                        {{ label('requestType', selectedRequest.requestType) }} &bull; {{ formatRelevantDate(selectedRequest) }}
                    </div>
                </div>

                <!-- Warning Banner -->
                <div class="p-3 rounded-lg bg-red-50 border border-red-200 text-red-900 space-y-1">
                    <div class="font-bold flex items-center gap-1.5">
                        <app-icon name="OctagonAlert" :size="15" class="text-danger" />
                        <span>Permanent Decision Notice</span>
                    </div>
                    <p class="text-[11px] leading-relaxed">
                        Declining this request will update its status to <strong>Rejected</strong> and remove it from Coordinator forwarding.
                        The Student Assistant will be notified with your recorded reason for rejection.
                    </p>
                </div>

                <!-- Mandatory Reason for Rejection Field -->
                <div>
                    <label class="field-label text-slate-800 font-bold">
                        Reason for Rejection / Why Not Approved
                        <span class="text-danger font-bold">* (Mandatory)</span>
                    </label>
                    <textarea v-model.trim="rejectRemarks" rows="3"
                              placeholder="Please provide the official, non-empty reason for declining this request (mandatory)..."
                              class="input w-full"
                              :class="{ 'border-danger ring-1 ring-danger': rejectError }"></textarea>
                    <p v-if="rejectError" class="mt-1 text-[11px] font-semibold text-danger">
                        {{ rejectError }}
                    </p>
                </div>

                <!-- Supervisor Decision & E-Signature Pad -->
                <div class="rounded-xl border border-slate-200 bg-page/60 p-3.5 space-y-3">
                    <div class="flex items-center justify-between">
                        <label class="inline-flex items-center gap-2 text-xs font-bold text-rose-800">
                            <input type="checkbox" checked disabled class="h-4 w-4 rounded text-rose-600 cursor-not-allowed" />
                            <span>Not Approved by Immediate Supervisor</span>
                        </label>
                        <div class="flex items-center gap-2">
                            <button type="button" @click="adoptSupervisorElectronicSignature"
                                    class="text-[10px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded px-2 py-0.5">
                                Adopt E-Sig
                            </button>
                            <button type="button" @click="clearSupervisorSignature"
                                    class="text-[10px] font-bold text-rose-600 hover:underline">
                                Clear Pad
                            </button>
                        </div>
                    </div>

                    <div class="relative overflow-hidden rounded-lg border border-slate-300 bg-white shadow-inner">
                        <canvas ref="supervisorCanvasRef" width="380" height="90" class="h-20 w-full cursor-crosshair" style="touch-action: none;"></canvas>
                        <div v-if="!supervisorSignature" class="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] text-slate-400 font-medium">
                            Draw your supervisor signature or click Adopt E-Sig
                        </div>
                    </div>

                    <div class="flex items-center justify-between text-[11px] text-slate-600 border-t border-slate-200 pt-1.5">
                        <span>Supervisor: <strong>{{ Store.user?.name || 'Immediate Supervisor' }}</strong></span>
                        <span>Date Signed: <strong>{{ (new Date()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) }}</strong></span>
                    </div>
                </div>
            </div>

            <template #footer>
                <div class="flex items-center justify-end gap-2">
                    <button @click="showRejectModal = false" :disabled="submitting" class="btn btn-secondary btn-sm">
                        Cancel
                    </button>
                    <button @click="confirmReject" :disabled="submitting || !rejectRemarks.trim()" class="btn btn-danger btn-sm">
                        <app-icon name="XCircle" :size="14" />
                        <span>{{ submitting ? 'Rejecting Request...' : 'Confirm Rejection' }}</span>
                    </button>
                </div>
            </template>
        </app-modal>

        <!-- ================================================================= -->
        <!-- MODAL 5: SUBMIT CLARIFICATION TO COORDINATOR MODAL -->
        <!-- ================================================================= -->
        <app-modal :open="showClarificationModal"
                   :title="selectedRequest ? ('Submit Clarification — ' + (selectedRequest.requestCode || selectedRequest.requestRefNo)) : 'Submit Clarification'"
                   icon="Send" tone="navy" z="z-[60]" size="md" @close="showClarificationModal = false">
            <div v-if="selectedRequest" class="space-y-4 text-xs">
                <!-- Coordinator Remarks Display -->
                <div class="p-3 rounded-lg bg-purple-50 border border-purple-200 space-y-1">
                    <span class="text-[11px] font-semibold text-purple-700 uppercase">Coordinator Clarification Request:</span>
                    <p class="text-ink whitespace-pre-line">{{ selectedRequest.coordinatorRemarks || 'Clarification requested by Coordinator.' }}</p>
                </div>

                <!-- Mandatory Clarification Response Field -->
                <div>
                    <label class="field-label text-slate-800 font-bold">
                        Supervisor Clarification Response
                        <span class="text-danger font-bold">*</span>
                    </label>
                    <textarea v-model.trim="clarificationRemarks" rows="3"
                              placeholder="Provide the requested details or confirmation for the Coordinator..."
                              class="input w-full"
                              :class="{ 'border-danger ring-1 ring-danger': clarificationError }"></textarea>
                    <p v-if="clarificationError" class="mt-1 text-[11px] font-semibold text-danger">
                        {{ clarificationError }}
                    </p>
                </div>
            </div>

            <template #footer>
                <div class="flex items-center justify-end gap-2">
                    <button @click="showClarificationModal = false" :disabled="submitting" class="btn btn-secondary btn-sm">
                        Cancel
                    </button>
                    <button @click="confirmClarification" :disabled="submitting || !clarificationRemarks.trim()" class="btn btn-primary btn-sm">
                        <app-icon name="Send" :size="14" />
                        <span>{{ submitting ? 'Submitting Clarification...' : 'Send Clarification to Coordinator' }}</span>
                    </button>
                </div>
            </template>
        </app-modal>
    </div>
    `
};
window.SupervisorRequestsPage = SupervisorRequestsPage;
