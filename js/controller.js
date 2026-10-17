// App shell: login page, or sidebar + top bar + routed page once signed in.
const app = Vue.createApp({
    components: { AppSidebar, AppTopbar, ToastStack, CoordinatorAiChatbot },

    setup() {
        const router = VueRouter.useRouter();

        const logout = async () => {
            const ok = typeof Alerts !== "undefined"
                ? await Alerts.confirm({
                    title: "Sign Out",
                    text: "Are you sure you want to log out of AssistPay?",
                    confirmText: "Yes, Sign Out",
                    cancelText: "Cancel",
                    icon: "question",
                    danger: true,
                    requireReason: false
                })
                : window.confirm("Are you sure you want to log out?");

            if (!ok) return;

            await Model.logout();
            Store.sidebarOpen = false;
            router.replace("/login");

            if (typeof Swal !== "undefined") {
                Swal.fire({
                    icon: "success",
                    title: "Signed Out",
                    text: "You have been successfully logged out.",
                    timer: 1400,
                    showConfirmButton: false,
                    customClass: {
                        popup: "rounded-xl font-sans"
                    }
                });
            } else {
                Store.toast("success", "You've been signed out.");
            }
        };

        return { Store, logout };
    },

    template: `
    <!-- Full-screen pages: sign-in, and the required first-login password change -->
    <router-view v-if="$route.meta.public || Store.user?.mustChangePassword" />

    <template v-else-if="Store.user">
        <a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[70] focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-navy">
            Skip to content
        </a>
        <div class="flex h-full">
            <app-sidebar />
            <div class="flex min-w-0 flex-1 flex-col">
                <app-topbar />
                <main id="main" class="flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
                    <div class="mx-auto max-w-7xl">
                        <router-view />
                    </div>
                </main>
            </div>
        </div>
        <!-- S.A. Coordinator Free AI Chatbot -->
        <coordinator-ai-chatbot v-if="Store.user?.role === 'ADMIN'" />
    </template>

    <toast-stack />
    `
});

// Ask the server who is signed in BEFORE the first route is resolved
Model.session().then(result => {
    if (!result.success && result.message) Store.notice = { type: "info", message: result.message };
    app.use(router);
    app.mount("#app");
});
