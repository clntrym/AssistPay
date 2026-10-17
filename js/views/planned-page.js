// Placeholder shown for every page until its build step is reached.
// Each real page (e.g. js/views/admin/semester-setup.js) replaces it in router.js.
const PlannedPage = {
    components: { AppIcon, PageHeader },

    setup() {
        const route = VueRouter.useRoute();
        const page = Vue.computed(() => route.meta.page);
        const stepLabel = Vue.computed(() =>
            typeof page.value.step === "number" ? `Step ${page.value.step}` : page.value.step);
        return { page, stepLabel };
    },

    template: `
    <page-header :title="page.label" :subtitle="page.subtitle" :section="page.section" />

    <section class="rounded-xl border border-line bg-white p-6 shadow-card sm:p-8">
        <div class="flex flex-col gap-6 md:flex-row md:items-start">
            <div class="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-mist text-navy">
                <app-icon :name="page.icon" :size="22" />
            </div>

            <div class="flex-1">
                <div class="flex flex-wrap items-center gap-2">
                    <h2 class="text-card-title text-ink">This page isn't built yet</h2>
                    <span class="inline-flex items-center gap-1 rounded-full bg-gold/15 px-2.5 py-0.5 text-caption font-semibold text-navy">
                        <app-icon name="Clock" :size="12" /> {{ stepLabel }}
                    </span>
                </div>
                <p class="mt-1 max-w-prose text-body text-muted">
                    The layout and navigation are ready. The content below will be added in {{ stepLabel.toLowerCase() }}.
                </p>

                <ul v-if="page.planned.length" class="mt-5 grid gap-2 sm:grid-cols-2">
                    <li v-for="item in page.planned" :key="item"
                        class="flex items-start gap-2.5 rounded-lg border border-line bg-page px-3.5 py-2.5 text-body text-ink">
                        <app-icon name="Circle" :size="14" class="mt-1 text-disabled" />
                        {{ item }}
                    </li>
                </ul>
            </div>
        </div>
    </section>
    `
};
