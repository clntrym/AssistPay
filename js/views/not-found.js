const NotFound = {
    components: { AppIcon },
    setup() {
        return { home: Vue.computed(() => Store.home) };
    },
    template: `
    <section class="mx-auto mt-10 max-w-md rounded-xl border border-line bg-white p-8 text-center shadow-card">
        <div class="mx-auto grid h-12 w-12 place-items-center rounded-full bg-mist text-navy">
            <app-icon name="SearchX" :size="22" />
        </div>
        <h1 class="mt-4 text-section-title text-navy">Page not found</h1>
        <p class="mt-1 text-body text-muted">This page doesn't exist, or your account can't open it.</p>
        <router-link :to="home"
            class="mt-6 inline-flex items-center gap-2 rounded-lg bg-navy px-4 py-2.5 text-[14px] font-semibold text-white transition-colors duration-150 hover:bg-navy-700">
            <app-icon name="LayoutDashboard" :size="16" /> Go to dashboard
        </router-link>
    </section>
    `
};
