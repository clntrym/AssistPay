// Model: the only place the frontend talks to the PHP API.
// Authentication uses the HttpOnly session cookie (never localStorage).
// Every POST carries the session's CSRF token in the X-CSRF-Token header.
const Model = {
    csrfToken: null,
    _inFlight: new Map(),

    // Read-only actions safe to deduplicate when identical requests are in flight simultaneously
    isReadOnlyAction(action) {
        const a = String(action || "").toLowerCase();
        return /^(list|get|me|my_|team_requests|admin_list|options|lookup|summary|supervisor_summary|sa_summary|supervisor_attendance_|admin_overview|supervisor_overview|sa_my_evaluation|class_list|office_list|rooms_overview|room_grid|matching_summary|schedule_view|school_balances|list_campaigns|campaign_details|overview|cutoffs_list|deduction_endorsement_list|.*_report)/.test(a);
    },

    // GET api/auth.php: who is signed in + a fresh CSRF token
    async session() {
        try {
            const res = await fetch("api/auth.php", { credentials: "same-origin" });
            const body = await res.json();
            this.csrfToken = body.csrfToken;
            Store.user = body.user;
            Store.semester = body.semester || null;
            if (body.expired) Store.notice = { type: "info", message: "Your session expired. Sign in again." };
            return body;
        } catch {
            Store.user = null;
            return { success: false, message: "Can't reach the server. Check that Apache and MySQL are running in XAMPP." };
        }
    },

    // Actions that Edit, Remove, Delete, or Archive records and MUST have a reason
    needsReason(endpoint, action, data = {}) {
        if (endpoint === "requests") return false;
        const a = String(action || "").toLowerCase();
        // Read-only or creation/auth actions do not require an edit/delete/archive reason
        if (!a || /^(list|get|me|my_|options|lookup|session|login|logout|create|add|register|upload|import|export|matching_summary|matching_run|schedule_view|schedule_finalize|schedule_publish|sa_schedule|office_staff|semesters|campaign_details|submit_response|supervisor_attendance_)/.test(a)) {
            return false;
        }
        // Save actions that are creating new records (no id) vs editing existing ones
        if (a === "semester_save" || a === "office_save") {
            return Boolean(data && data.id);
        }
        // Any action containing update, edit, delete, remove, archive, restore, unassign, unapprove, drop, clear, toggle, reset, reject, reopen, save_grade, save_settings, post_duty_save, review_plotted_duty, etc.
        return /(update|edit|delete|remove|archive|restore|unassign|unapprove|drop|clear|toggle|reset|reject|reopen|save_grade|save_subject_status|save_settings|post_duty_save|review_plotted_duty|admin_update_response)/.test(a);
    },

    formatActionLabel(action) {
        return String(action || "this action")
            .replace(/_/g, " ")
            .replace(/\b\w/g, c => c.toUpperCase());
    },

    async request(endpoint, action, data = {}, retried = false) {
        let payload = { ...data };

        // Deduplicate identical concurrent read-only requests
        const canDedup = !retried && this.isReadOnlyAction(action);
        const dedupKey = canDedup ? `${endpoint}:${action}:${JSON.stringify(payload)}` : null;
        if (dedupKey && this._inFlight.has(dedupKey)) {
            return this._inFlight.get(dedupKey).then(r =>
                typeof structuredClone === "function" ? structuredClone(r) : JSON.parse(JSON.stringify(r))
            );
        }

        const execPromise = (async () => {
            // Attach reason captured from a preceding Alerts.confirm / Alerts.prompt if present
            if (!retried && typeof Alerts !== "undefined" && Alerts.consumeReason) {
                const pendingReason = Alerts.consumeReason();
                if (pendingReason && !payload.reason) {
                    payload.reason = pendingReason;
                }
            }

            // If this is an Edit / Remove / Delete / Archive action and still has no reason, prompt for one
            if (!retried && this.needsReason(endpoint, action, payload)) {
                const existingReason = String(payload.reason || payload.remarks || payload.archive_reason || "").trim();
                if (!existingReason && typeof Alerts !== "undefined" && Alerts.prompt) {
                    const labelAction = this.formatActionLabel(action);
                    const promptedReason = await Alerts.prompt({
                        title: `Reason Required — ${labelAction}`,
                        html: `<p class="text-xs text-muted mb-1">Please provide a reason before proceeding with this edit, removal, deletion, or archive action.</p>`,
                        label: "Reason / Remarks *",
                        placeholder: "Enter reason (letters and numbers only, no special characters)...",
                        confirmText: "Confirm & Proceed",
                        minLength: 3
                    });
                    if (!promptedReason) {
                        return { success: false, cancelled: true, message: "Action cancelled. A reason is required." };
                    }
                    payload.reason = promptedReason;
                }
            }

            if (!this.csrfToken && !retried) {
                await this.session();
            }

            let res;
            try {
                res = await fetch(`api/${endpoint}.php`, {
                    method: "POST",
                    credentials: "same-origin",
                    headers: { "Content-Type": "application/json", "X-CSRF-Token": this.csrfToken || "" },
                    body: JSON.stringify({ ...payload, action })
                });
            } catch {
                return { success: false, message: "Can't reach the server. Check your connection and try again." };
            }

            let body;
            try {
                body = await res.json();
            } catch {
                body = { success: false, message: "The server sent an invalid response." };
            }

            // CSRF token went stale (e.g. another tab signed in): refresh once and retry
            if (res.status === 419 && !retried) {
                await this.session();
                return this.request(endpoint, action, payload, true);
            }

            // Signed out on the server (timeout, deactivated account, password changed elsewhere)
            if (res.status === 401 && Store.user && !(endpoint === "auth" && action === "login")) {
                Store.user = null;
                Store.notice = { type: "info", message: body.message };
                router.push("/login");
            }

            // Still on a temporary password: the server refuses everything else
            if (res.status === 403 && body.code === "PASSWORD_CHANGE_REQUIRED" && Store.user) {
                Store.user.mustChangePassword = true;
                router.push("/change-password");
            }
            return body;
        })();

        if (dedupKey) {
            this._inFlight.set(dedupKey, execPromise);
            execPromise.finally(() => this._inFlight.delete(dedupKey));
        }
        return execPromise;
    },

    async changePassword({ currentPassword, newPassword, confirmPassword }) {
        const r = await this.request("auth", "change_password", { currentPassword, newPassword, confirmPassword });
        if (r.success) {
            this.csrfToken = r.csrfToken;
            Store.user = r.user;
        }
        return r;
    },

    async login(login, password) {
        const r = await this.request("auth", "login", { login, password });
        if (r.success) {
            this.csrfToken = r.csrfToken;
            Store.user = r.user;
            Store.semester = r.semester || null;
        }
        return r;
    },

    async logout() {
        await this.request("auth", "logout");
        Store.user = null;
        await this.session(); // new anonymous session + CSRF token
    }
};
