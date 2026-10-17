// SweetAlert2 dialogs, themed to match AssistPay, plus Global Input Guard (SQLi protection)
// and mandatory Reason enforcement for Edit / Remove / Delete / Archive actions.
const Alerts = (() => {
    const base = {
        buttonsStyling: false,          // AssistPay button classes instead of SweetAlert's
        reverseButtons: true,           // confirm on the right, like the rest of the app
        focusConfirm: false,
        customClass: {
            popup: "rounded-xl font-sans",
            title: "text-section-title text-navy",
            htmlContainer: "text-body text-muted",
            actions: "gap-2",
            confirmButton: "btn btn-primary",
            cancelButton: "btn btn-secondary",
            denyButton: "btn btn-danger"
        }
    };

    let lastReason = "";
    let lastReasonTime = 0;

    const setLastReason = (r) => {
        lastReason = String(r || "").trim();
        lastReasonTime = Date.now();
    };

    const consumeReason = () => {
        if (lastReason && (Date.now() - lastReasonTime) < 30000) {
            const r = lastReason;
            lastReason = "";
            return r;
        }
        return "";
    };

    // Regex matching actions that Edit, Remove, Delete, or Archive records
    const REASON_ACTION_REGEX = /\b(remove|delete|archive|edit|update|modify|adjust|override|unassign|unapprove|drop|clear|deactivate|reset|reject|reopen|restore|change|replace|save\s+changes|save\s+rate|save\s+standard\s+rate)\b/i;

    // Regex matching action names that should NOT require a reason (create/register/view/login/etc.)
    const CREATE_ONLY_REGEX = /\b(register\s+new|create\s+new|add\s+new|sign\s+in|log\s+in|upload|import|export|print)\b/i;

    const needsReasonForDialog = ({ title = "", text = "", html = "", confirmText = "", requireReason }) => {
        if (typeof requireReason === "boolean") return requireReason;
        const combined = `${title} ${confirmText} ${text} ${html}`;
        if (CREATE_ONLY_REGEX.test(title) && !/\b(edit|update|remove|delete|archive|overwrite|replace)\b/i.test(combined)) {
            return false;
        }
        return REASON_ACTION_REGEX.test(combined);
    };

    // Truly dangerous characters for general input (blocks raw HTML tags, backticks, backslashes, pipes, null bytes):
    // Standard sentence and paragraph punctuation is fully allowed:
    // . , ' " : ; ! ? ( ) [ ] { } - _ / & % $ ₱ # @ + = *
    const FORBIDDEN_GENERAL_CHARS = /[<>`\\|\0]/g;
    // Email / Login field: allows alphanumeric, @, ., _, -, +, but blocks spaces and HTML/shell tags
    const FORBIDDEN_EMAIL_CHARS = /[<>`\\|\0\s]/g;
    // Phone field: allows digits, spaces, -
    const FORBIDDEN_PHONE_CHARS = /[^0-9\s\-]/g;
    // Number field: allows digits and decimal point
    const FORBIDDEN_NUMBER_CHARS = /[^0-9.]/g;

    const validateSafeText = (value) => {
        const s = String(value || "");
        if (/[<>`\\|\0]/.test(s)) {
            return "HTML tags (< >) and backslashes are not allowed in text fields.";
        }
        if (/(\bUNION\s+ALL\s+SELECT\b|\bUNION\s+SELECT\b|\bDROP\s+TABLE\b|\bDROP\s+DATABASE\b|\bOR\s+1\s*=\s*1\b|\bAND\s+1\s*=\s*1\b|\bSLEEP\s*\(|\bBENCHMARK\s*\(|--\s|--$|\/\*|\*\/)/i.test(s)) {
            return "SQL keywords or comment syntax are not allowed for security reasons.";
        }
        return null;
    };

    /** Asks before doing something. Automatically requires a Reason for Edit/Remove/Delete/Archive. */
    const confirm = async ({ title, text = "", html = "", confirmText = "Confirm", cancelText = "Cancel",
                             icon = "question", danger = false, width, requireReason, reasonLabel = "Reason / Remarks *",
                             reasonPlaceholder = "Enter reason or remarks..." } = {}) => {
        const askReason = needsReasonForDialog({ title, text, html, confirmText, requireReason });

        if (typeof Swal === "undefined") {
            const plainMsg = [title, text || String(html || "").replace(/<[^>]+>/g, " ")].filter(Boolean).join("\n\n");
            if (askReason) {
                const r = window.prompt(`${plainMsg}\n\n${reasonLabel}`, "");
                if (r === null) return false;
                const clean = String(r || "").replace(FORBIDDEN_GENERAL_CHARS, "").trim();
                if (clean.length < 3) {
                    if (typeof Store !== "undefined" && Store.toast) Store.toast("danger", "Please provide a valid reason (at least 3 characters).");
                    return false;
                }
                setLastReason(clean);
                return true;
            }
            return window.confirm(plainMsg);
        }

        if (askReason) {
            const bodyHtml = html || (text ? `<p class="mb-2">${esc(text)}</p>` : "");
            const r = await Swal.fire({
                ...base,
                icon,
                title,
                html: bodyHtml || undefined,
                width,
                input: "textarea",
                inputLabel: reasonLabel,
                inputPlaceholder: reasonPlaceholder,
                inputAttributes: {
                    "aria-label": reasonLabel,
                    maxlength: "200",
                    rows: "2"
                },
                showCancelButton: true,
                confirmButtonText: confirmText,
                cancelButtonText: cancelText,
                customClass: {
                    ...base.customClass,
                    confirmButton: danger ? "btn btn-danger" : "btn btn-primary",
                    input: "w-full !m-0 rounded-lg border border-line bg-white px-3 py-2 text-xs text-ink focus:border-navy focus:outline-none",
                    inputLabel: "w-full !m-0 !mt-3 !mb-1 text-left text-xs font-semibold text-navy"
                },
                inputValidator: value => {
                    const clean = String(value || "").replace(FORBIDDEN_GENERAL_CHARS, "").trim();
                    if (clean.length < 3) return "Please provide a valid reason (at least 3 characters).";
                    const sqliErr = validateSafeText(value);
                    if (sqliErr) return sqliErr;
                    return null;
                }
            });
            if (r.isConfirmed) {
                setLastReason(String(r.value || "").replace(FORBIDDEN_GENERAL_CHARS, "").trim());
                return true;
            }
            return false;
        }

        const r = await Swal.fire({
            ...base,
            icon, title, text: html ? undefined : text, html: html || undefined, width,
            showCancelButton: true,
            confirmButtonText: confirmText,
            cancelButtonText: cancelText,
            customClass: { ...base.customClass, confirmButton: danger ? "btn btn-danger" : "btn btn-primary" }
        });
        return r.isConfirmed;
    };

    /**
     * Asks for a short piece of writing before doing something — a reason, a
     * note. Resolves to the text, or null when the person backs out.
     */
    const prompt = async ({ title, html = "", label = "Reason / Remarks *", placeholder = "Enter reason (no special characters)...", confirmText = "Confirm",
                            cancelText = "Cancel", danger = false, minLength = 3, maxLength = 200 } = {}) => {
        if (typeof Swal === "undefined") {
            const plainMsg = [title, String(html || "").replace(/<[^>]+>/g, " "), label].filter(Boolean).join("\n\n");
            const val = window.prompt(plainMsg, "");
            if (val === null) return null;
            const clean = String(val || "").replace(FORBIDDEN_GENERAL_CHARS, "").trim();
            if (clean.length < minLength) return null;
            setLastReason(clean);
            return clean;
        }
        const r = await Swal.fire({
            ...base,
            icon: "question",
            title,
            html,
            input: "textarea",
            inputLabel: label,
            inputPlaceholder: placeholder,
            inputAttributes: { "aria-label": label || title, maxlength: String(maxLength), rows: "3" },
            showCancelButton: true,
            confirmButtonText: confirmText,
            cancelButtonText: cancelText,
            customClass: { ...base.customClass, confirmButton: danger ? "btn btn-danger" : "btn btn-primary",
                           input: "w-full !m-0 rounded-lg border border-line bg-white px-3 py-2 text-xs text-ink focus:border-navy focus:outline-none",
                           inputLabel: "w-full !m-0 !mt-3 !mb-1 text-left text-xs font-semibold text-navy" },
            inputValidator: value => {
                const text = String(value || "").trim();
                if (text.length < minLength) return `Please provide a reason of at least ${minLength} characters.`;
                if (text.length > maxLength) return `Use ${maxLength} characters or fewer.`;
                const sqliErr = validateSafeText(text);
                if (sqliErr) return sqliErr;
                return null;
            }
        });
        if (r.isConfirmed) {
            const clean = String(r.value || "").replace(FORBIDDEN_GENERAL_CHARS, "").trim();
            setLastReason(clean);
            return clean;
        }
        return null;
    };

    const hasHtmlTags = (str) => typeof str === "string" && /<[a-z][\s\S]*>/i.test(str);

    const success = (title, textOrHtml = "") => {
        let textVal = "";
        let htmlVal = "";
        let finalTitle = title;
        if (typeof title === "object" && title !== null) {
            textVal = title.text || "";
            htmlVal = title.html || "";
            finalTitle = title.title || "";
        } else if (hasHtmlTags(textOrHtml)) {
            htmlVal = textOrHtml;
        } else {
            textVal = textOrHtml;
        }

        if (typeof Swal === "undefined") {
            const fallbackText = textVal || String(htmlVal || "").replace(/<[^>]+>/g, " ").trim();
            if (typeof Store !== "undefined" && Store.toasts) {
                const id = Date.now() + Math.random();
                Store.toasts.push({ id, type: "success", message: [finalTitle, fallbackText].filter(Boolean).join(" — ") });
                setTimeout(() => Store.dismiss(id), 4000);
            }
            return Promise.resolve();
        }
        return Swal.fire({
            ...base,
            icon: "success",
            title: finalTitle,
            text: htmlVal ? undefined : (textVal || undefined),
            html: htmlVal || undefined,
            confirmButtonText: "Done"
        });
    };

    const error = (title, textOrHtml = "") => {
        let textVal = "";
        let htmlVal = "";
        let finalTitle = title;
        if (typeof title === "object" && title !== null) {
            textVal = title.text || "";
            htmlVal = title.html || "";
            finalTitle = title.title || "";
        } else if (hasHtmlTags(textOrHtml)) {
            htmlVal = textOrHtml;
        } else {
            textVal = textOrHtml;
        }

        if (typeof Swal === "undefined") {
            const fallbackText = textVal || String(htmlVal || "").replace(/<[^>]+>/g, " ").trim();
            if (typeof Store !== "undefined" && Store.toasts) {
                const id = Date.now() + Math.random();
                Store.toasts.push({ id, type: "danger", message: [finalTitle, fallbackText].filter(Boolean).join(" — ") });
                setTimeout(() => Store.dismiss(id), 4000);
            }
            return Promise.resolve();
        }
        return Swal.fire({
            ...base,
            icon: "error",
            title: finalTitle,
            text: htmlVal ? undefined : (textVal || undefined),
            html: htmlVal || undefined,
            confirmButtonText: "Close"
        });
    };

    const info = (title, html = "") => {
        let textVal = "";
        let htmlVal = "";
        let finalTitle = title;
        if (typeof title === "object" && title !== null) {
            textVal = title.text || "";
            htmlVal = title.html || "";
            finalTitle = title.title || "";
        } else if (hasHtmlTags(html)) {
            htmlVal = html;
        } else {
            htmlVal = html;
        }

        if (typeof Swal === "undefined") {
            const fallbackText = textVal || String(htmlVal || "").replace(/<[^>]+>/g, " ").trim();
            if (typeof Store !== "undefined" && Store.toasts) {
                const id = Date.now() + Math.random();
                Store.toasts.push({ id, type: "info", message: [finalTitle, fallbackText].filter(Boolean).join(" — ") });
                setTimeout(() => Store.dismiss(id), 4000);
            }
            return Promise.resolve();
        }
        return Swal.fire({
            ...base,
            icon: "info",
            title: finalTitle,
            html: htmlVal || undefined,
            confirmButtonText: "Close"
        });
    };

    const warning = (title, textOrHtml = "") => {
        let textVal = "";
        let htmlVal = "";
        let finalTitle = title;
        if (typeof title === "object" && title !== null) {
            textVal = title.text || "";
            htmlVal = title.html || "";
            finalTitle = title.title || "";
        } else if (hasHtmlTags(textOrHtml)) {
            htmlVal = textOrHtml;
        } else {
            textVal = textOrHtml;
        }

        if (typeof Swal === "undefined") {
            const fallbackText = textVal || String(htmlVal || "").replace(/<[^>]+>/g, " ").trim();
            if (typeof Store !== "undefined" && Store.toasts) {
                const id = Date.now() + Math.random();
                Store.toasts.push({ id, type: "warning", message: [finalTitle, fallbackText].filter(Boolean).join(" — ") });
                setTimeout(() => Store.dismiss(id), 4000);
            }
            return Promise.resolve();
        }
        return Swal.fire({
            ...base,
            icon: "warning",
            title: finalTitle,
            text: htmlVal ? undefined : (textVal || undefined),
            html: htmlVal || undefined,
            confirmButtonText: "OK"
        });
    };

    const validation = (title = "Validation Required", text = "") => {
        return warning(title, text);
    };

    const toast = (icon = "info", title = "") => {
        let swalIcon = icon;
        let swalTitle = title;
        if (["success", "error", "warning", "info", "question", "danger"].includes(String(title).toLowerCase())) {
            swalIcon = title;
            swalTitle = icon;
        }
        if (swalIcon === "danger") swalIcon = "error";
        if (!["success", "error", "warning", "info", "question"].includes(swalIcon)) {
            swalTitle = swalIcon;
            swalIcon = "info";
        }

        if (typeof Swal !== "undefined" && Swal.mixin) {
            const ToastSwal = Swal.mixin({
                toast: true,
                position: "top-end",
                showConfirmButton: false,
                timer: 3500,
                timerProgressBar: true,
                customClass: {
                    popup: "rounded-xl font-sans shadow-lg text-sm"
                },
                didOpen: (t) => {
                    t.addEventListener("mouseenter", Swal.stopTimer);
                    t.addEventListener("mouseleave", Swal.resumeTimer);
                }
            });
            return ToastSwal.fire({
                icon: swalIcon,
                title: String(swalTitle || "")
            });
        }
        return Promise.resolve();
    };

    /** Blocks the screen while a request runs; close it with Alerts.done(). */
    const working = (title = "Working…") => {
        if (typeof Swal === "undefined") return Promise.resolve();
        return Swal.fire({
            ...base, title, allowOutsideClick: false, allowEscapeKey: false,
            showConfirmButton: false, didOpen: () => Swal.showLoading()
        });
    };
    const done = () => {
        if (typeof Swal !== "undefined") Swal.close();
    };

    /** Escapes text that goes into an html: option. */
    const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

    // =========================================================================
    // GLOBAL INPUT GUARD: Block Special Characters across ALL Input Fields
    // =========================================================================
    let lastWarnToast = 0;
    const notifyBlockedChar = (el) => {
        if (el && el.classList) {
            el.classList.add("ring-2", "ring-danger/50", "border-danger");
            setTimeout(() => {
                el.classList.remove("ring-2", "ring-danger/50", "border-danger");
            }, 900);
        }
        const now = Date.now();
        if (now - lastWarnToast > 2500 && typeof Store !== "undefined" && Store.toast) {
            lastWarnToast = now;
            Store.toast("warning", "HTML tags (< >) and backslashes are not allowed in text fields.");
        }
    };

    const isPasswordInput = (el) => {
        if (!el || !el.tagName || el.tagName.toUpperCase() !== "INPUT") return false;
        const type = (el.getAttribute("type") || "").toLowerCase();
        if (type === "password") return true;
        if (el.dataset && el.dataset.passwordField === "true") return true;
        const auto = (el.getAttribute("autocomplete") || "").toLowerCase();
        if (auto === "current-password" || auto === "new-password") return true;
        const idOrName = `${el.id || ""} ${el.name || ""}`.toLowerCase();
        if (idOrName.includes("password")) return true;
        return false;
    };

    const getInputMode = (el) => {
        if (!el || !el.tagName) return "NONE";
        const tag = el.tagName.toUpperCase();
        if (tag !== "INPUT" && tag !== "TEXTAREA") return "NONE";
        if (isPasswordInput(el)) return "PASSWORD";
        const type = (el.getAttribute("type") || "text").toLowerCase();
        if (["file", "checkbox", "radio", "date", "time", "datetime-local", "month", "week", "color", "range", "hidden", "button", "submit", "reset"].includes(type)) {
            return "NONE";
        }
        if (type === "number") return "NUMBER";
        if (type === "tel") return "PHONE";
        const hint = `${type} ${el.id || ""} ${el.name || ""} ${el.placeholder || ""} ${el.getAttribute("aria-label") || ""} ${el.getAttribute("autocomplete") || ""}`.toLowerCase();
        if (type === "email" || hint.includes("email") || hint.includes("username")) {
            return "EMAIL";
        }
        if (hint.includes("phone") || hint.includes("contact") || hint.includes("mobile")) {
            return "PHONE";
        }
        return "TEXT";
    };

    const sanitizeByMode = (val, mode) => {
        let s = String(val ?? "");
        if (mode === "NONE" || mode === "PASSWORD") {
            return s;
        }
        if (mode === "NUMBER") {
            return s.replace(FORBIDDEN_NUMBER_CHARS, "");
        }
        if (mode === "PHONE") {
            return s.replace(FORBIDDEN_PHONE_CHARS, "");
        }
        if (mode === "EMAIL") {
            return s.replace(FORBIDDEN_EMAIL_CHARS, "").replace(/--+/g, "-");
        }
        // TEXT (includes search, text, textarea — never password)
        return s.replace(FORBIDDEN_GENERAL_CHARS, "").replace(/--+/g, "-");
    };

    if (typeof document !== "undefined") {
        // 1. Block forbidden keys immediately on keydown (never on password fields)
        document.addEventListener("keydown", (e) => {
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            if (!e.key || e.key.length !== 1) return; // Allow Backspace, Tab, Enter, Arrow keys, etc.
            const el = e.target;
            const mode = getInputMode(el);
            if (mode === "NONE" || mode === "PASSWORD") return;

            if (mode === "NUMBER") {
                if (["e", "E", "+", "-"].includes(e.key) || !/[0-9.]/.test(e.key)) {
                    e.preventDefault();
                    notifyBlockedChar(el);
                }
                return;
            }

            const cleaned = sanitizeByMode(e.key, mode);
            if (cleaned !== e.key) {
                e.preventDefault();
                notifyBlockedChar(el);
            }
        }, true);

        // 2. Sanitize on input / paste (catches paste, autofill, mobile keyboards; never on password fields)
        let isSanitizing = false;
        document.addEventListener("input", (e) => {
            if (isSanitizing) return;
            const el = e.target;
            const mode = getInputMode(el);
            if (mode === "NONE" || mode === "PASSWORD" || mode === "NUMBER") return;

            const original = el.value;
            if (!original) return;
            const cleaned = sanitizeByMode(original, mode);
            if (cleaned !== original) {
                isSanitizing = true;
                const pos = el.selectionStart ? Math.max(0, el.selectionStart - (original.length - cleaned.length)) : cleaned.length;
                el.value = cleaned;
                try { el.setSelectionRange(pos, pos); } catch {}
                el.dispatchEvent(new Event("input", { bubbles: true }));
                isSanitizing = false;
                notifyBlockedChar(el);
            }
        }, true);
    }

    return {
        confirm, prompt, success, error, info, warning, validation, toast, working, done, esc,
        setLastReason, consumeReason, validateSafeText, sanitizeByMode
    };
})();

