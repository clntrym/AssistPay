// Scheduling > Semester Setup.
// Every scheduling record belongs to a semester, and each semester keeps its own
// allowance rate so past allowances keep the rate they were paid at.
const SemesterSetupPage = {
    components: { AppIcon, PageHeader, FormField, AppModal, StatusBadge },

    setup() {
        const semesters = Vue.ref([]);
        const loading = Vue.ref(true);
        const loadError = Vue.ref("");
        const saving = Vue.ref(false);

        // How many S.A.s the school plans to run with; the Coordinator sets it per semester
        const DEFAULT_REQUIRED_SA = 80;
        const blank = () => ({ id: 0, academicYear: "", term: "1ST", startDate: "", endDate: "", status: "PLANNED",
                               requiredSa: DEFAULT_REQUIRED_SA });
        const form = Vue.reactive(blank());
        const errors = Vue.reactive({});
        const formError = Vue.ref("");
        const showForm = Vue.ref(false);

        const active = Vue.computed(() => semesters.value.find(s => s.status === "ACTIVE") || null);
        const terms = { "1ST": "1st Semester", "2ND": "2nd Semester", SUMMER: "Summer" };

        const load = async () => {
            loading.value = true;
            loadError.value = "";
            const r = await Model.request("scheduling", "semesters");
            loading.value = false;
            if (r.success) semesters.value = r.semesters;
            else loadError.value = r.message;
        };
        Vue.onMounted(load);

        for (const key of Object.keys(blank())) {
            Vue.watch(() => form[key], () => { if (errors[key]) delete errors[key]; });
        }

        const openCreate = () => {
            Object.assign(form, blank());
            // Suggest the next academic year
            const year = new Date().getFullYear();
            form.academicYear = `${year}-${year + 1}`;
            form.requiredSa = active.value?.requiredSa ?? DEFAULT_REQUIRED_SA;
            formError.value = "";
            Object.keys(errors).forEach(k => delete errors[k]);
            showForm.value = true;
        };

        const openEdit = s => {
            Object.assign(form, {
                id: s.id, academicYear: s.academicYear, term: s.term, startDate: s.startDate,
                endDate: s.endDate, status: s.status, requiredSa: s.requiredSa ?? DEFAULT_REQUIRED_SA
            });
            formError.value = "";
            Object.keys(errors).forEach(k => delete errors[k]);
            showForm.value = true;
        };

        const save = async () => {
            Object.keys(errors).forEach(k => delete errors[k]);
            formError.value = "";
            const ok = await Alerts.confirm({
                title: form.id ? "Save this semester?" : "Create this semester?",
                html: `<b class="text-ink">${Alerts.esc(terms[form.term] || form.term)} AY ${Alerts.esc(form.academicYear)}</b><br>`
                    + `${form.startDate} to ${form.endDate}, ${Alerts.esc(form.status.toLowerCase())}<br>`
                    + `Needs <b class="text-ink">${form.requiredSa} S.A.(s)</b> this semester`
                    + (form.status === "ACTIVE" ? `<br><span class="text-caption">Every scheduling screen switches to this semester.</span>` : ""),
                confirmText: form.id ? "Save semester" : "Create semester"
            });
            if (!ok) return;
            saving.value = true;
            const r = await Model.request("scheduling", "semester_save", { ...form });
            saving.value = false;
            if (!r.success) {
                if (r.errors) Object.assign(errors, r.errors);
                else formError.value = r.message;
                return;
            }
            semesters.value = r.semesters;
            showForm.value = false;
            await Alerts.success("Semester Saved", form.id ? "Semester updated successfully." : "Semester created successfully.");
            if (form.status === "ACTIVE") Model.session();   // refresh the semester in the top bar
        };

        const activate = async s => {
            const ok = await Alerts.confirm({
                title: "Set as active semester?",
                html: `<b class="text-ink">${Alerts.esc(s.label)}</b> becomes the semester every scheduling screen works on.<br>`
                    + `<span class="text-caption">The semester that is active now is closed.</span>`,
                icon: "warning", confirmText: "Set active"
            });
            if (!ok) return;
            const r = await Model.request("scheduling", "semester_activate", { id: s.id });
            if (!r.success) { Alerts.error("Couldn't change the active semester", r.message); return; }
            semesters.value = r.semesters;
            await Alerts.success("Active Semester Changed", `${s.label} is now the active semester.`);
            Model.session();
        };

        const remove = async s => {
            const ok = await Alerts.confirm({
                title: "Delete this semester?",
                html: `<b class="text-ink">${Alerts.esc(s.label)}</b> will be removed. This cannot be undone.<br>`
                    + `<span class="text-caption">Only a semester with no S.A.s and no scheduling records can be deleted.</span>`,
                icon: "warning", danger: true, confirmText: "Delete semester"
            });
            if (!ok) return;
            const r = await Model.request("scheduling", "semester_delete", { id: s.id });
            if (!r.success) { Alerts.error("Couldn't delete the semester", r.message); return; }
            semesters.value = r.semesters;
            await Alerts.success("Semester Deleted", "Semester deleted successfully.");
        };

        const totalRecords = s => s.counts.sas + s.counts.classes + s.counts.rooms + s.counts.offices;
        const isAdmin = Vue.computed(() => Store.user?.role === 'ADMIN');

        return { semesters, loading, loadError, load, saving, form, errors, formError, showForm, openCreate, openEdit,
                 save, active, terms, activate, remove, totalRecords, Format, isAdmin };
    },

    template: `
    <page-header title="Semester" section="Scheduling"
                 subtitle="Every scheduling record belongs to a semester. Only one semester is active at a time.">
    </page-header>

    <div v-if="loading" class="space-y-4" aria-busy="true">
        <div class="h-36 animate-pulse rounded-xl bg-white"></div>
        <div class="h-64 animate-pulse rounded-xl bg-white"></div>
    </div>

    <div v-else-if="loadError" class="card flex flex-col items-center px-6 py-12 text-center">
        <app-icon name="CircleX" :size="28" class="text-danger" />
        <p class="mt-3 text-body font-medium text-ink">Couldn't load semesters</p>
        <p class="mt-1 text-caption text-muted">{{ loadError }}</p>
        <button @click="load" class="btn btn-secondary btn-sm mt-4"><app-icon name="RefreshCw" :size="14" /> Try again</button>
    </div>

    <template v-else>
        <!-- Current semester -->
        <section v-if="active" class="card mb-5 p-5 sm:p-6">
            <div class="flex flex-col gap-5 lg:flex-row lg:items-center">
                <div class="flex items-start gap-4">
                    <span class="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-mist text-navy"><app-icon name="CalendarCheck" :size="22" /></span>
                    <div>
                        <p class="text-caption font-medium text-muted">Current semester</p>
                        <h2 class="text-[22px] font-bold leading-tight text-navy">{{ active.label }}</h2>
                        <p class="mt-1 text-body text-muted">{{ Format.date(active.startDate) }} to {{ Format.date(active.endDate) }}</p>
                    </div>
                </div>

                <dl v-if="isAdmin" class="grid flex-1 grid-cols-2 gap-3 sm:grid-cols-4">
                    <div class="rounded-lg bg-page px-4 py-3">
                        <dt class="text-caption text-muted">Active S.A.</dt>
                        <dd class="text-[20px] font-bold" :class="active.counts.activeSas >= active.requiredSa ? 'text-success' : 'text-navy'">
                            {{ active.counts.activeSas }}
                            <span class="text-[13px] font-medium text-muted">of {{ active.requiredSa }}</span>
                        </dd>
                    </div>
                    <div class="rounded-lg bg-page px-4 py-3">
                        <dt class="text-caption text-muted">Still to register</dt>
                        <dd class="text-[20px] font-bold text-navy">{{ Math.max(0, active.requiredSa - active.counts.activeSas) }}</dd>
                    </div>
                    <div class="rounded-lg bg-page px-4 py-3">
                        <dt class="text-caption text-muted">Scheduling records</dt>
                        <dd class="text-[20px] font-bold text-navy">{{ totalRecords(active) }}</dd>
                    </div>
                </dl>
            </div>
        </section>

        <section v-else class="card mb-5 flex flex-col items-center px-6 py-10 text-center">
            <span class="grid h-12 w-12 place-items-center rounded-full bg-gold/15 text-navy"><app-icon name="CalendarCog" :size="22" /></span>
            <p class="mt-3 text-body font-medium text-ink">No active semester</p>
            <p class="mt-1 max-w-md text-caption text-muted">Scheduling, class schedules and requirements all need an active semester. Select and activate an existing semester from the table below.</p>
        </section>

        <!-- All semesters -->
        <section class="card">
            <h2 class="border-b border-line px-5 py-4 text-card-title text-navy">All semesters</h2>
            <div class="overflow-x-auto touch-scroll table-scroll">
                <table class="w-full min-w-[750px] text-left text-[13px]">
                    <thead class="bg-page text-caption font-semibold text-muted">
                        <tr v-if="!isAdmin">
                            <th class="px-4 py-3">Academic Year</th>
                            <th class="px-4 py-3">Semester</th>
                            <th class="px-4 py-3">Start Date</th>
                            <th class="px-4 py-3">End Date</th>
                            <th class="px-4 py-3">Status</th>
                        </tr>
                        <tr v-else>
                            <th class="px-4 py-3">Semester</th>
                            <th class="px-4 py-3">Dates</th>
                            <th class="px-4 py-3">S.A. registered</th>
                            <th class="px-4 py-3">Records</th>
                            <th class="px-4 py-3">Status</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-line">
                        <tr v-for="s in semesters" :key="s.id" class="transition-colors duration-150 hover:bg-mist/50">
                            <template v-if="!isAdmin">
                                <td class="whitespace-nowrap px-4 py-3 font-semibold text-ink">{{ s.academicYear }}</td>
                                <td class="whitespace-nowrap px-4 py-3 font-medium text-navy">{{ terms[s.term] || s.term }}</td>
                                <td class="whitespace-nowrap px-4 py-3 text-muted">{{ Format.date(s.startDate) }}</td>
                                <td class="whitespace-nowrap px-4 py-3 text-muted">{{ Format.date(s.endDate) }}</td>
                            </template>
                            <template v-else>
                                <td class="whitespace-nowrap px-4 py-3 font-semibold text-ink">{{ s.label }}</td>
                                <td class="whitespace-nowrap px-4 py-3 text-muted">{{ Format.date(s.startDate) }} – {{ Format.date(s.endDate) }}</td>
                                <td class="whitespace-nowrap px-4 py-3">
                                    <span class="font-semibold" :class="s.counts.activeSas >= s.requiredSa ? 'text-success' : 'text-ink'">
                                        {{ s.counts.activeSas }}
                                    </span>
                                    <span class="text-muted"> of {{ s.requiredSa }}</span>
                                </td>
                                <td class="whitespace-nowrap px-4 py-3 text-muted">{{ totalRecords(s) }}</td>
                            </template>
                            <td class="px-4 py-3">
                                <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold"
                                      :class="{ 'bg-success/10 text-success': s.status === 'ACTIVE', 'bg-gold/20 text-navy': s.status === 'PLANNED', 'bg-slate-100 text-muted': s.status === 'CLOSED' }">
                                    <app-icon :name="s.status === 'ACTIVE' ? 'CircleCheck' : (s.status === 'PLANNED' ? 'Clock' : 'CircleSlash')" :size="12" />
                                    {{ s.status === 'ACTIVE' ? 'Active' : (s.status === 'PLANNED' ? 'Planned' : 'Closed') }}
                                </span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>
    </template>

    <!-- Create / edit -->
    <app-modal :open="showForm" :title="form.id ? 'Edit Semester S.A. Requirement' : 'Semester Details'" icon="CalendarCog" @close="showForm = false"
               description="Set the required S.A. headcount target and status for this semester.">
        <form @submit.prevent="save" novalidate class="grid gap-4 sm:grid-cols-2">
            <form-field label="Academic year" v-slot="f">
                <input :id="f.id" :value="form.academicYear" class="input bg-gray-50 font-semibold" disabled>
            </form-field>
            <form-field label="Semester" v-slot="f">
                <input :id="f.id" :value="terms[form.term] || form.term" class="input bg-gray-50 font-semibold text-navy" disabled>
            </form-field>
            <form-field label="Start date" v-slot="f">
                <input :id="f.id" :value="form.startDate" type="date" class="input bg-gray-50 text-muted" disabled>
            </form-field>
            <form-field label="End date" v-slot="f">
                <input :id="f.id" :value="form.endDate" type="date" class="input bg-gray-50 text-muted" disabled>
            </form-field>
            <form-field label="Required S.A. (Headcount needed)" required :error="errors.requiredSa"
                        hint="The S.A. headcount required for this semester. Registrations and matching are counted against this target." v-slot="f" class="sm:col-span-2">
                <input :id="f.id" v-model.number="form.requiredSa" type="number" min="1" max="1000" step="1" class="input ring-2 ring-navy/20 font-bold text-navy"
                       :class="{ 'input-error': f.invalid }" :aria-invalid="f.invalid" placeholder="80">
            </form-field>
            <form-field label="Status" required :error="errors.status"
                        hint="Setting this active closes the current active semester." v-slot="f" class="sm:col-span-2">
                <select :id="f.id" v-model="form.status" class="input" :class="{ 'input-error': f.invalid }" :aria-invalid="f.invalid">
                    <option value="PLANNED">Planned</option>
                    <option value="ACTIVE">Active</option>
                    <option value="CLOSED">Closed</option>
                </select>
            </form-field>
            <p v-if="formError" class="flex items-center gap-2 text-body text-danger sm:col-span-2" role="alert">
                <app-icon name="CircleX" :size="16" /> {{ formError }}
            </p>
        </form>
        <template #footer>
            <button @click="showForm = false" class="btn btn-secondary">Cancel</button>
            <button @click="save" :disabled="saving" class="btn btn-primary">
                <app-icon :name="saving ? 'LoaderCircle' : 'Check'" :size="16" :class="saving ? 'animate-spin' : ''" />
                {{ saving ? 'Saving…' : 'Save S.A. Requirement' }}
            </button>
        </template>
    </app-modal>

    <!-- Activate -->
    `
};
