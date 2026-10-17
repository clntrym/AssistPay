// <page-header title="Semester Setup" subtitle="..." section="Scheduling">
//     <template #actions><button>...</button></template>
// </page-header>
const PageHeader = {
    props: {
        title: { type: String, required: true },
        subtitle: String,
        section: String, // parent menu, shown as a breadcrumb
        stackActions: { type: Boolean, default: false }
    },
    template: `
    <div class="mb-6 flex flex-col gap-3"
         :class="stackActions ? '' : 'lg:flex-row lg:items-center lg:justify-between'">
        <div class="min-w-0 flex-1">
            <p v-if="section" class="mb-1 text-caption font-medium text-muted">{{ section }} /</p>
            <h1 class="text-[24px] font-bold leading-tight text-navy sm:text-page-title">{{ title }}</h1>
            <p v-if="subtitle" class="mt-1 text-body text-muted">{{ subtitle }}</p>
        </div>
        <div v-if="$slots.actions"
             class="flex flex-wrap items-center gap-2"
             :class="stackActions ? 'pt-1' : 'lg:justify-end'">
            <slot name="actions" />
        </div>
    </div>
    `
};
