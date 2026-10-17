// Shared app state.
// `user` is set ONLY from the server (api/auth.php). The role shown here decides
// which menu is displayed; the PHP API still checks the role on every request.
const ROLE_KEYS = { ADMIN: "admin", SUPERVISOR: "supervisor", SA: "sa", REGISTRAR: "registrar" };

const COLOR_SCHEME_KEY = "color-scheme";
const readStoredScheme = () => {
    try {
        const val = localStorage.getItem(COLOR_SCHEME_KEY);
        return val === "dark" ? "dark" : "light";
    } catch {
        return "light";
    }
};

const applySchemeToDom = (mode) => {
    if (typeof document === "undefined") return;
    const isDark = mode === "dark";
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.content = isDark ? "dark" : "light";
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    document.documentElement.classList.toggle("dark", isDark);
};

const Store = Vue.reactive({
    user: null,
    notice: null, // one-time message for the login page, e.g. session expired

    semester: null, // active semester { label, status, ... } from api/auth.php

    sidebarOpen: false, // mobile drawer
    toasts: [],
    notifications: [],
    unreadCount: 0,

    // Theme state: "light" | "dark"
    theme: readStoredScheme(),

    get isDark() {
        return this.theme === "dark";
    },

    setTheme(mode) {
        const next = mode === "dark" ? "dark" : "light";
        this.theme = next;
        try {
            localStorage.setItem(COLOR_SCHEME_KEY, next);
        } catch {}
        applySchemeToDom(next);
    },

    toggleTheme() {
        this.setTheme(this.isDark ? "light" : "dark");
    },

    async loadNotifications() {
        if (!this.user) return;
        const res = await Model.request("notifications", "list");
        if (res.success) {
            this.notifications = res.notifications || [];
            this.unreadCount = res.unreadCount || 0;
        }
    },

    get role() {
        return this.user ? ROLE_KEYS[this.user.role] : null;
    },

    get home() {
        if (!this.role) return "/login";
        return this.user.mustChangePassword ? "/change-password" : NAVIGATION[this.role].home;
    },

    get userTitle() {
        const u = this.user;
        if (!u) return "";
        if (u.role === "ADMIN") return "S.A. Coordinator";
        if (u.role === "SA") return "Student Assistant";
        if (u.role === "REGISTRAR") return "Academic Registrar";
        return `${u.office ? u.office.name : u.supervisorCategory} Supervisor`;
    },

    get initials() {
        if (!this.user) return "";
        const parts = this.user.name.trim().split(/\s+/);
        return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
    },

    // type: success | warning | danger | info | error
    toast(type, message, timeout = 4000) {
        const normalizedType = (type === "danger" || type === "error") ? "error" : (type || "info");
        if (typeof Alerts !== "undefined") {
            if (normalizedType === "success") {
                return Alerts.success(message);
            }
            if (normalizedType === "error") {
                return Alerts.error("Error", message);
            }
            if (normalizedType === "warning") {
                return Alerts.warning("Notice", message);
            }
            return Alerts.info("Notice", message);
        }
        if (typeof Swal !== "undefined") {
            return Swal.fire({
                icon: normalizedType,
                title: message,
                confirmButtonText: normalizedType === "success" ? "Done" : "OK",
                customClass: { popup: "rounded-xl font-sans", confirmButton: "btn btn-primary" },
                buttonsStyling: false
            });
        }
        const id = Date.now() + Math.random();
        this.toasts.push({ id, type: normalizedType === "error" ? "danger" : normalizedType, message });
        setTimeout(() => this.dismiss(id), timeout);
    },

    dismiss(id) {
        const i = this.toasts.findIndex(t => t.id === id);
        if (i !== -1) this.toasts.splice(i, 1);
    }
});

// Initialize DOM theme state and keep cross-tab changes in sync
applySchemeToDom(Store.theme);

if (typeof window !== "undefined") {
    window.addEventListener("storage", e => {
        if (e.key === COLOR_SCHEME_KEY || e.key === null) {
            Store.theme = readStoredScheme();
            applySchemeToDom(Store.theme);
        }
    });
}

const Toast = {
    success(msg, title) {
        if (typeof Alerts !== "undefined" && Alerts.success) {
            return Alerts.success(title ? title : msg, title ? msg : "");
        }
        if (typeof Swal !== "undefined") {
            return Swal.fire({
                icon: "success",
                title: title ? title : msg,
                text: title ? msg : undefined,
                confirmButtonText: "Done",
                customClass: { popup: "rounded-xl font-sans", confirmButton: "btn btn-primary" },
                buttonsStyling: false
            });
        }
        return Store.toast("success", msg);
    },
    error(msg, title = "Validation / Action Failed") {
        if (typeof Alerts !== "undefined" && Alerts.error) {
            return Alerts.error(title, msg);
        }
        if (typeof Swal !== "undefined") {
            return Swal.fire({
                icon: "error",
                title,
                text: msg,
                confirmButtonText: "Close",
                customClass: { popup: "rounded-xl font-sans", confirmButton: "btn btn-primary" },
                buttonsStyling: false
            });
        }
        return Store.toast("danger", msg);
    },
    warning(msg, title = "Validation Required") {
        if (typeof Alerts !== "undefined" && Alerts.warning) {
            return Alerts.warning(title, msg);
        }
        if (typeof Swal !== "undefined") {
            return Swal.fire({
                icon: "warning",
                title,
                text: msg,
                confirmButtonText: "OK",
                customClass: { popup: "rounded-xl font-sans", confirmButton: "btn btn-primary" },
                buttonsStyling: false
            });
        }
        return Store.toast("warning", msg);
    },
    info(msg, title = "Notice") {
        if (typeof Alerts !== "undefined" && Alerts.info) {
            return Alerts.info(title, msg);
        }
        if (typeof Swal !== "undefined") {
            return Swal.fire({
                icon: "info",
                title,
                text: msg,
                confirmButtonText: "Close",
                customClass: { popup: "rounded-xl font-sans", confirmButton: "btn btn-primary" },
                buttonsStyling: false
            });
        }
        return Store.toast("info", msg);
    }
};
window.Toast = Toast;

