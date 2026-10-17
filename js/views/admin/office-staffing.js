// Scheduling > Office Staffing.
// The Coordinator states how many S.A.s each office needs. The system never
// assumes a number (PDF business rules 5–6).
const OfficeStaffingPage = {
    components: { AppIcon, PageHeader, FormField, AppModal },

    setup() {
        const items = Vue.ref([]);
        const semester = Vue.ref(null);
        const loading = Vue.ref(true);
        const loadError = Vue.ref("");
        const saving = Vue.ref(false);

        const showForm = Vue.ref(false);
        const minWeeklySetting = Vue.ref(35);
        const blank = () => ({ id: 0, officeId: "", statusType: "REQUIRED", requiredSa: 1, operatingStart: "08:00", operatingEnd: "17:00", weeklyTargetHours: minWeeklySetting.value, notes: "" });
        const form = Vue.reactive(blank());
        const errors = Vue.reactive({});
        const formError = Vue.ref("");
        for (const key of Object.keys(blank())) {
            Vue.watch(() => form[key], () => { if (errors[key]) delete errors[key]; });
        }

        const load = async () => {
            loading.value = true;
            loadError.value = "";
            const r = await Model.request("scheduling", "office_list");
            loading.value = false;
            if (!r.success) { loadError.value = r.message; return; }
            items.value = r.items || [];
            semester.value = r.semester;
            if (r.minWeekly != null) minWeeklySetting.value = r.minWeekly;
        };
        Vue.onMounted(load);

        const searchQuery = Vue.ref("");
        const filterTab = Vue.ref("ALL");

        const counts = Vue.computed(() => {
            const list = items.value || [];
            return {
                total: list.length,
                req: list.filter(o => o.isActive && o.requiredSa !== null && o.requiredSa > 0).length,
                none: list.filter(o => o.isActive && (o.requiredSa === null || o.requiredSa === 0)).length,
                inactive: list.filter(o => !o.isActive).length
            };
        });

        const filteredItems = Vue.computed(() => {
            let list = items.value || [];
            const q = searchQuery.value.trim().toLowerCase();
            if (q) {
                list = list.filter(o =>
                    (o.name && o.name.toLowerCase().includes(q)) ||
                    (o.code && o.code.toLowerCase().includes(q))
                );
            }
            if (filterTab.value === "REQUIRED") {
                list = list.filter(o => o.isActive && o.requiredSa !== null && o.requiredSa > 0);
            } else if (filterTab.value === "NONE") {
                list = list.filter(o => o.isActive && (o.requiredSa === null || o.requiredSa === 0));
            } else if (filterTab.value === "INACTIVE") {
                list = list.filter(o => !o.isActive);
            }
            return list;
        });

        const totals = Vue.computed(() => {
            const activeList = (items.value || []).filter(o => o.isActive);
            const reqList = activeList.filter(o => o.requiredSa !== null && o.requiredSa > 0);
            return {
                offices: reqList.length,
                totalOffices: activeList.length,
                noSaOffices: activeList.filter(o => o.requiredSa === null || o.requiredSa === 0).length,
                required: reqList.reduce((n, o) => n + o.requiredSa, 0),
                assigned: reqList.reduce((n, o) => n + Math.min(o.assignedSa, o.requiredSa), 0),
                vacant: reqList.reduce((n, o) => n + Math.max(0, o.vacant), 0)
            };
        });

        const state = o => {
            if (!o.isActive) return "INACTIVE";
            if (o.requiredSa === null || o.requiredSa === 0) return "NONE";
            if (o.vacant > 0) return "VACANCY";
            return "COVERED";
        };
        const stateStyles = {
            COVERED: ["bg-emerald-50 text-emerald-700 border-emerald-200", "CircleCheck", "Covered"],
            VACANCY: ["bg-rose-50 text-rose-700 border-rose-200", "TriangleAlert", "Vacancy"],
            NONE: ["bg-slate-100 text-slate-600 border-slate-200", "CircleMinus", "No S.A. Needed"],
            INACTIVE: ["bg-gray-100 text-gray-500 border-gray-200", "Ban", "Inactive Office"]
        };

        // DataTable state & sorting
        const page = Vue.ref(1);
        const pageSize = Vue.ref(10);
        const sortKey = Vue.ref("name");
        const sortDir = Vue.ref("asc");

        const sortBy = (key) => {
            if (sortKey.value === key) {
                sortDir.value = sortDir.value === "asc" ? "desc" : "asc";
            } else {
                sortKey.value = key;
                sortDir.value = "asc";
            }
            page.value = 1;
        };

        const getSortIcon = (key) => {
            if (sortKey.value !== key) return "ChevronsUpDown";
            return sortDir.value === "asc" ? "ChevronUp" : "ChevronDown";
        };

        const sortedItems = Vue.computed(() => {
            const list = [...filteredItems.value];
            const key = sortKey.value;
            const dir = sortDir.value === "asc" ? 1 : -1;
            list.sort((a, b) => {
                let res = 0;
                if (key === "name") {
                    res = (a.name || "").localeCompare(b.name || "");
                    if (res === 0) res = (a.code || "").localeCompare(b.code || "");
                } else if (key === "code") {
                    res = (a.code || "").localeCompare(b.code || "");
                } else if (key === "state") {
                    res = state(a).localeCompare(state(b));
                } else if (key === "requiredSa") {
                    res = (Number(a.requiredSa) || 0) - (Number(b.requiredSa) || 0);
                } else if (key === "assignedSa") {
                    res = (Number(a.assignedSa) || 0) - (Number(b.assignedSa) || 0);
                } else if (key === "vacant") {
                    res = (Number(a.vacant) || 0) - (Number(b.vacant) || 0);
                } else if (key === "operatingHours") {
                    res = (a.operatingStart || "").localeCompare(b.operatingStart || "");
                } else if (key === "weeklyTargetHours") {
                    res = (Number(a.weeklyTargetHours) || 0) - (Number(b.weeklyTargetHours) || 0);
                }
                return res * dir;
            });
            return list;
        });

        const pageCount = Vue.computed(() => {
            if (pageSize.value <= 0) return 1;
            return Math.max(1, Math.ceil(sortedItems.value.length / pageSize.value));
        });

        const pagedItems = Vue.computed(() => {
            if (pageSize.value <= 0) return sortedItems.value;
            const start = (page.value - 1) * pageSize.value;
            return sortedItems.value.slice(start, start + pageSize.value);
        });

        const rangeText = Vue.computed(() => {
            const total = sortedItems.value.length;
            if (!total) return "Showing 0 to 0 of 0 entries";
            if (pageSize.value <= 0) return `Showing 1 to ${total} of ${total} entries`;
            const from = (page.value - 1) * pageSize.value + 1;
            const to = Math.min(total, from + pageSize.value - 1);
            return `Showing ${from} to ${to} of ${total} entries`;
        });

        const visiblePages = Vue.computed(() => {
            const total = pageCount.value;
            const current = page.value;
            if (total <= 7) {
                return Array.from({ length: total }, (_, i) => i + 1);
            }
            const pages = [];
            if (current <= 4) {
                for (let i = 1; i <= 5; i++) pages.push(i);
                pages.push("...");
                pages.push(total);
            } else if (current >= total - 3) {
                pages.push(1);
                pages.push("...");
                for (let i = total - 4; i <= total; i++) pages.push(i);
            } else {
                pages.push(1);
                pages.push("...");
                for (let i = current - 1; i <= current + 1; i++) pages.push(i);
                pages.push("...");
                pages.push(total);
            }
            return pages;
        });

        Vue.watch([searchQuery, filterTab, pageSize], () => {
            page.value = 1;
        });
        Vue.watch(pageCount, n => {
            if (page.value > n) page.value = n;
        });

        const openForm = o => {
            Object.assign(form, blank());
            if (o) {
                const hasReq = o.requiredSa !== null && o.requiredSa > 0;
                Object.assign(form, {
                    id: o.id || 0,
                    officeId: o.officeId,
                    statusType: "REQUIRED",
                    requiredSa: hasReq ? o.requiredSa : 1,
                    operatingStart: (o.operatingStart || "08:00:00").slice(0, 5),
                    operatingEnd: (o.operatingEnd || "17:00:00").slice(0, 5),
                    weeklyTargetHours: o.weeklyTargetHours ?? minWeeklySetting.value,
                    notes: o.notes || ""
                });
            }
            Object.keys(errors).forEach(k => delete errors[k]);
            formError.value = "";
            showForm.value = true;
        };

        const officeLabel = id => items.value.find(o => Number(o.officeId) === Number(id))?.name || "this office";

        const save = async () => {
            Object.keys(errors).forEach(k => delete errors[k]);
            formError.value = "";

            if (form.statusType === "NONE") {
                const ok = await Alerts.confirm({
                    title: "Set as No S.A. Needed?",
                    html: `<b class="text-ink">${Alerts.esc(officeLabel(form.officeId))}</b> will not require student assistants this semester.`,
                    confirmText: "Save"
                });
                if (!ok) return;
                saving.value = true;
                const r = await Model.request("scheduling", "office_save", {
                    semesterId: semester.value.id,
                    officeId: form.officeId,
                    statusType: "NONE",
                    id: form.id
                });
                saving.value = false;
                if (!r.success) { formError.value = r.message; return; }
                showForm.value = false;
                Store.toast("success", `${officeLabel(form.officeId)} set to No S.A. Needed.`);
                load();
                return;
            }

            const ok = await Alerts.confirm({
                title: form.id ? "Save this requirement?" : "Add this requirement?",
                html: `<b class="text-ink">${Alerts.esc(officeLabel(form.officeId))}</b><br>`
                    + `${form.requiredSa} S.A.(s) on duty, ${form.operatingStart}\u2013${form.operatingEnd}, `
                    + `${form.weeklyTargetHours} h per week`,
                confirmText: form.id ? "Save requirement" : "Add requirement"
            });
            if (!ok) return;
            saving.value = true;
            const r = await Model.request("scheduling", "office_save", { ...form, semesterId: semester.value.id });
            saving.value = false;
            if (!r.success) {
                if (r.errors) Object.assign(errors, r.errors);
                else formError.value = r.message;
                return;
            }
            showForm.value = false;
            await Alerts.success("Requirement Saved", "Office staffing requirement saved successfully.");
            load();
        };

        const setNoSa = async o => {
            if (o.assignedSa > 0) {
                const proceed = await Alerts.confirm({
                    title: "Assigned S.A. Warning",
                    html: `<b class="text-ink">${Alerts.esc(o.name)}</b> currently has <b class="text-ink">${o.assignedSa} S.A. assigned</b>.<br>Removing the requirement will remove the staffing requirement for this semester. Continue?`,
                    icon: "warning", danger: true, confirmText: "Set as No S.A. Needed"
                });
                if (!proceed) return;
            } else {
                const ok = await Alerts.confirm({
                    title: "Mark as No S.A. Needed?",
                    html: `<b class="text-ink">${Alerts.esc(o.name)}</b> will not require any Student Assistants this semester.`,
                    icon: "question", confirmText: "Set as No S.A. Needed"
                });
                if (!ok) return;
            }
            const r = await Model.request("scheduling", "office_delete", { id: o.id, officeId: o.officeId, semesterId: semester.value?.id });
            if (!r.success) { Alerts.error("Couldn't update requirement", r.message); return; }
            Store.toast("success", `${o.name} marked as No S.A. Needed.`);
            load();
        };

        const toggleActive = async o => {
            const action = o.isActive ? "deactivate" : "activate";
            const ok = await Alerts.confirm({
                title: `${o.isActive ? 'Deactivate' : 'Activate'} ${o.name}?`,
                html: o.isActive
                    ? `Deactivating <b class="text-ink">${Alerts.esc(o.name)}</b> will mark this office as inactive institution-wide.`
                    : `Activating <b class="text-ink">${Alerts.esc(o.name)}</b> will enable this office for staffing and assignments.`,
                icon: "warning",
                confirmText: o.isActive ? "Deactivate" : "Activate"
            });
            if (!ok) return;
            const r = await Model.request("scheduling", "office_toggle_active", { officeId: o.officeId });
            if (!r.success) { Alerts.error(`Couldn't ${action} office`, r.message); return; }
            Store.toast("success", `${o.name} has been ${o.isActive ? 'deactivated' : 'activated'}.`);
            load();
        };

        const remove = setNoSa;

        // ---------- who works this office ----------
        // The S.A. is assigned here, not somewhere else: the page shows who
        // holds the office, how many slots are still open, and who the system
        // would put in one. Office duty runs 8 to 5 and a week must land
        // between 35 and 51 credited hours.
        const panel = Vue.ref(null);      // { office, staff, vacancies, candidates, limits, loading }
        const working = Vue.ref(false);
        const DAY_SHORT = { MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat", SUN: "Sun" };

        const openStaff = async o => {
            if (!o.id) { openForm(o); return; }
            panel.value = { loading: true, office: { name: o.name, requiredSa: o.requiredSa, hours: o.operatingLabel },
                            staff: [], candidates: [], vacancies: 0, limits: null, search: "" };
            const r = await Model.request("scheduling", "office_staff", { id: o.id });
            if (!panel.value) return;
            if (!r.success) { Alerts.error("Couldn't open the office", r.message); panel.value = null; return; }
            panel.value = { ...r, requirementId: o.id, loading: false, search: "" };
        };

        const refreshPanel = async () => {
            if (!panel.value) return;
            const r = await Model.request("scheduling", "office_staff", { id: panel.value.requirementId });
            if (r.success && panel.value) panel.value = { ...r, requirementId: panel.value.requirementId, loading: false, search: "" };
            load();
        };

        const candidateRows = Vue.computed(() => {
            const p = panel.value;
            if (!p?.candidates) return [];
            const term = (p.search || "").trim().toLowerCase();
            return p.candidates.filter(c => !term || c.name.toLowerCase().includes(term) || (c.studentId || "").includes(term) || (c.currentOfficeName || "").toLowerCase().includes(term));
        });

        const weekText = pattern => (pattern || [])
            .map(b => `${DAY_SHORT[b.day]} ${b.startLabel}\u2013${b.endLabel}`).join(" \u00b7 ");

        // Assigning with `extend` lets the duty start earlier or finish later than
        // the office day, which is how a short week is brought up to the minimum.
        const assign = async (c, extend = false) => {
            const p = panel.value;
            const plan = extend ? c.extended : c;
            const isReassign = !!(c.isCurrentlyAssigned && c.currentOfficeName);
            const title = isReassign ? `Reassign ${c.name} to ${p.office.name}?` : `Put ${c.name} on ${p.office.name}?`;
            let confirmHtml = `<b class="text-ink">${Alerts.esc(weekText(plan.pattern))}</b><br>`
                + `<span class="text-caption">${plan.creditedHours} credited hours a week `
                + `(${p.limits.minWeekly}\u2013${p.limits.maxWeekly} allowed)`
                + (extend ? `, using the longer day ${Alerts.esc(c.extended.window)}` : "");

            if (isReassign) {
                confirmHtml += `</span><br><br><div class="rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-left text-[12px] text-amber-900">`
                    + `<strong class="font-bold">Supervisor Notice:</strong> Reassigning <b class="text-ink">${Alerts.esc(c.name)}</b> from <b class="text-ink">${Alerts.esc(c.currentOfficeName)}</b> to <b class="text-ink">${Alerts.esc(p.office.name)}</b> will notify both the current supervisor of ${Alerts.esc(c.currentOfficeName)} and the supervisor of ${Alerts.esc(p.office.name)}.</div>`;
            } else {
                confirmHtml += `. The office becomes theirs and their supervisor will be notified.</span>`;
            }

            const ok = await Alerts.confirm({
                title,
                html: confirmHtml,
                icon: isReassign ? "warning" : "question",
                confirmText: isReassign ? "Confirm Reassign" : "Assign"
            });
            if (!ok) return;

            working.value = true;
            let r = await Model.request("scheduling", "office_assign",
                { id: p.requirementId, saProfileId: c.saId, extend });

            // Their classes may leave less than the minimum free; that needs a deliberate yes
            if (!r.success && r.code === "BELOW_MINIMUM") {
                working.value = false;
                const minHrs = p.limits?.minWeekly ?? r.minWeekly ?? "";
                const go = await Alerts.confirm({
                    title: `Below the ${minHrs}-hour minimum`,
                    html: `Only <b class="text-ink">${r.creditedHours} hours</b> fit around ${Alerts.esc(c.name)}'s classes `
                        + `inside ${Alerts.esc(p.office.hours)}.<br>`
                        + `<span class="text-caption">Assign them anyway, or pick someone with more free time.</span>`,
                    icon: "warning", danger: true, confirmText: "Assign anyway"
                });
                if (!go) return;
                working.value = true;
                r = await Model.request("scheduling", "office_assign",
                    { id: p.requirementId, saProfileId: c.saId, extend, allowBelowMinimum: true });
            }
            working.value = false;

            if (!r.success) { Alerts.error("Couldn't assign this S.A.", r.message); return; }
            if (r.isReassignment) {
                await Alerts.success("S.A. Reassigned", `${r.name} has been reassigned from ${r.oldOfficeName} to ${p.office.name} (${r.creditedHours} credited hrs/wk). Both department supervisors were notified.`);
            } else {
                await Alerts.success("S.A. Assigned", `${r.name} is on ${p.office.name} \u2014 ${r.creditedHours} credited hours a week. The supervisor was notified.`);
            }
            if (r.belowMinimum) Store.toast("warning", `${r.name} is below the ${p.limits?.minWeekly ?? r.minWeekly}-hour minimum. Give them more duty when a slot opens.`, 8000);
            refreshPanel();
        };

        // ---------- hours added by hand ----------
        const hoursForm = Vue.ref(null);    // { saId, day, startTime, endTime, errors, error }
        const openHours = s => {
            hoursForm.value = { saId: s.saId, name: s.name, day: "MON", startTime: "07:00", endTime: "08:00",
                                errors: {}, error: "" };
        };
        const saveHours = async () => {
            const f = hoursForm.value;
            f.errors = {};
            f.error = "";
            const ok = await Alerts.confirm({
                title: "Add Duty Block?",
                html: `Add <b class="text-ink">${Alerts.esc(DAY_SHORT[f.day] || f.day)} ${Alerts.esc(f.startTime)}–${Alerts.esc(f.endTime)}</b> to <b class="text-ink">${Alerts.esc(f.name)}</b>'s office schedule?`,
                confirmText: "Add Block"
            });
            if (!ok) return;

            working.value = true;
            const r = await Model.request("scheduling", "office_hours_add", {
                id: panel.value.requirementId, saProfileId: f.saId,
                day: f.day, startTime: f.startTime, endTime: f.endTime
            });
            working.value = false;
            if (!r.success) {
                if (r.errors) f.errors = r.errors; else f.error = r.message;
                return;
            }
            hoursForm.value = null;
            await Alerts.success("Duty Block Added", `Hours added \u2014 ${r.creditedHours} credited hours a week.`);
            if (r.belowMinimum) Store.toast("warning", `Still under the ${panel.value.limits.minWeekly}-hour minimum.`, 7000);
            refreshPanel();
        };
        const removeHours = async (s, row) => {
            const ok = await Alerts.confirm({
                title: "Remove this duty block?",
                html: `<b class="text-ink">${DAY_SHORT[row.day]} ${row.startLabel}\u2013${row.endLabel}</b> `
                    + `comes off ${Alerts.esc(s.name)}'s week.`,
                icon: "warning", danger: true, confirmText: "Remove block"
            });
            if (!ok) return;
            working.value = true;
            const r = await Model.request("scheduling", "office_hours_delete", { id: row.id });
            working.value = false;
            if (!r.success) { Alerts.error("Couldn't remove the block", r.message); return; }
            await Alerts.success("Duty Block Removed", "Duty block removed successfully.");
            refreshPanel();
        };

        const unassign = async s => {
            const ok = await Alerts.confirm({
                title: `Take ${s.name} off this office?`,
                html: `Their ${s.duty.length} duty block(s) here are removed and they go back to the matching pool.`,
                icon: "warning", danger: true, confirmText: "Remove from office"
            });
            if (!ok) return;
            working.value = true;
            const r = await Model.request("scheduling", "office_unassign", { saProfileId: s.saId });
            working.value = false;
            if (!r.success) { Alerts.error("Couldn't remove this S.A.", r.message); return; }
            await Alerts.success("S.A. Removed", `${r.name} is off the office.`);
            refreshPanel();
        };

        return { items, semester, loading, loadError, load, saving,
                 searchQuery, filterTab, counts, filteredItems, sortedItems, totals,
                 page, pageSize, sortKey, sortDir, sortBy, getSortIcon, pageCount, pagedItems, rangeText, visiblePages,
                 state, stateStyles, form, errors, formError, showForm, openForm, save, remove, setNoSa, toggleActive,
                 panel, openStaff, working, candidateRows, assign, unassign, weekText, DAY_SHORT,
                 hoursForm, openHours, saveHours, removeHours, Format };
    },

    template: `
    <page-header title="Office Staffing Requirements" section="Scheduling"
                 :subtitle="semester ? 'Manage student assistant staffing requirements for ' + semester.label + '. Offices can be configured with S.A. slots or marked as No S.A. Needed.' : ''">
        <template #actions>
            <button @click="openForm(null)" class="btn btn-primary" :disabled="!semester"><app-icon name="Plus" :size="16" /> Add office requirement</button>
        </template>
    </page-header>

    <div v-if="loading" class="space-y-4" aria-busy="true">
        <div class="h-24 animate-pulse rounded-xl bg-white"></div>
        <div class="h-80 animate-pulse rounded-xl bg-white"></div>
    </div>

    <div v-else-if="loadError" class="card flex flex-col items-center px-6 py-12 text-center">
        <app-icon name="CircleX" :size="28" class="text-danger" />
        <p class="mt-3 text-body font-medium text-ink">Couldn't load office staffing</p>
        <p class="mt-1 text-caption text-muted">{{ loadError }}</p>
        <button @click="load" class="btn btn-secondary btn-sm mt-4"><app-icon name="RefreshCw" :size="14" /> Try again</button>
    </div>

    <template v-else>
        <!-- KPI Summary Cards -->
        <dl class="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div v-for="tile in [
                    { label: 'Offices Requiring S.A.', value: totals.offices + ' / ' + totals.totalOffices, sub: totals.noSaOffices + ' no S.A. needed' },
                    { label: 'S.A. Slots Required', value: totals.required },
                    { label: 'Slots Filled', value: totals.assigned },
                    { label: 'Vacant Slots', value: totals.vacant, warn: totals.vacant > 0 }]"
                 :key="tile.label" class="card px-4 py-3">
                <dt class="text-caption text-muted">{{ tile.label }}</dt>
                <dd class="text-[22px] font-bold" :class="tile.warn ? 'text-danger' : 'text-navy'">{{ tile.value }}</dd>
                <p v-if="tile.sub" class="text-[11px] text-muted mt-0.5">{{ tile.sub }}</p>
            </div>
        </dl>

        <!-- Unified Table Card -->
        <section class="card overflow-hidden">
            <!-- Table Header Toolbar -->
            <div class="border-b border-line px-5 py-4">
                <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div>
                        <h2 class="text-card-title text-navy">All Office Staffing & Requirements</h2>
                        <p class="text-caption text-muted mt-0.5">Offices with student assistant requirements and offices where no S.A. is needed.</p>
                    </div>

                    <!-- Search Input -->
                    <div class="relative w-full sm:w-64">
                        <span class="absolute inset-y-0 left-0 flex items-center pl-3 text-muted pointer-events-none">
                            <app-icon name="Search" :size="14" />
                        </span>
                        <input v-model="searchQuery" type="search" placeholder="Search office or code…"
                               class="input input-sm pl-9 w-full" />
                    </div>
                </div>

                <!-- Filter Tabs -->
                <div class="mt-4 flex flex-wrap items-center gap-1.5">
                    <button type="button" @click="filterTab = 'ALL'"
                            class="px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5"
                            :class="filterTab === 'ALL' ? 'bg-navy text-white shadow-sm' : 'bg-mist text-muted hover:text-ink'">
                        <span>All Offices</span>
                        <span class="rounded-full px-1.5 py-0.2 text-[10px]" :class="filterTab === 'ALL' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'">{{ counts.total }}</span>
                    </button>
                    <button type="button" @click="filterTab = 'REQUIRED'"
                            class="px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5"
                            :class="filterTab === 'REQUIRED' ? 'bg-navy text-white shadow-sm' : 'bg-mist text-muted hover:text-ink'">
                        <span>Requires S.A.</span>
                        <span class="rounded-full px-1.5 py-0.2 text-[10px]" :class="filterTab === 'REQUIRED' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'">{{ counts.req }}</span>
                    </button>
                    <button type="button" @click="filterTab = 'NONE'"
                            class="px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5"
                            :class="filterTab === 'NONE' ? 'bg-navy text-white shadow-sm' : 'bg-mist text-muted hover:text-ink'">
                        <span>No S.A. Needed</span>
                        <span class="rounded-full px-1.5 py-0.2 text-[10px]" :class="filterTab === 'NONE' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'">{{ counts.none }}</span>
                    </button>
                    <button v-if="counts.inactive > 0" type="button" @click="filterTab = 'INACTIVE'"
                            class="px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors inline-flex items-center gap-1.5"
                            :class="filterTab === 'INACTIVE' ? 'bg-navy text-white shadow-sm' : 'bg-mist text-muted hover:text-ink'">
                        <span>Inactive Offices</span>
                        <span class="rounded-full px-1.5 py-0.2 text-[10px]" :class="filterTab === 'INACTIVE' ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-700'">{{ counts.inactive }}</span>
                    </button>
                </div>
            </div>

            <!-- DataTable Top Toolbar: Page Size Selector & Count Badge -->
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-y border-line px-5 py-3.5 bg-mist/30">
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
                    <b class="text-ink">{{ sortedItems.length }}</b> total offices found
                </span>
            </div>

            <!-- Table -->
            <div class="overflow-x-auto">
                <table class="w-full min-w-[960px] text-left text-[13px] border-collapse">
                    <thead>
                        <tr class="border-b border-line bg-mist/60 text-[12px] font-semibold uppercase tracking-wider text-muted select-none">
                            <th class="px-5 py-3.5">
                                <button type="button" @click="sortBy('name')" class="inline-flex items-center gap-1.5 text-left hover:text-navy transition-colors font-semibold uppercase tracking-wider">
                                    Office
                                    <app-icon :name="getSortIcon('name')" :size="13" :class="sortKey === 'name' ? 'text-navy font-bold' : 'text-disabled'" />
                                </button>
                            </th>
                            <th class="px-5 py-3.5">
                                <button type="button" @click="sortBy('state')" class="inline-flex items-center gap-1.5 text-left hover:text-navy transition-colors font-semibold uppercase tracking-wider">
                                    Staffing Status
                                    <app-icon :name="getSortIcon('state')" :size="13" :class="sortKey === 'state' ? 'text-navy font-bold' : 'text-disabled'" />
                                </button>
                            </th>
                            <th class="px-5 py-3.5 text-center">
                                <button type="button" @click="sortBy('requiredSa')" class="inline-flex items-center justify-center gap-1.5 hover:text-navy transition-colors font-semibold uppercase tracking-wider">
                                    Required S.A.
                                    <app-icon :name="getSortIcon('requiredSa')" :size="13" :class="sortKey === 'requiredSa' ? 'text-navy font-bold' : 'text-disabled'" />
                                </button>
                            </th>
                            <th class="px-5 py-3.5 text-center">
                                <button type="button" @click="sortBy('assignedSa')" class="inline-flex items-center justify-center gap-1.5 hover:text-navy transition-colors font-semibold uppercase tracking-wider">
                                    Assigned S.A.
                                    <app-icon :name="getSortIcon('assignedSa')" :size="13" :class="sortKey === 'assignedSa' ? 'text-navy font-bold' : 'text-disabled'" />
                                </button>
                            </th>
                            <th class="px-5 py-3.5 text-center">
                                <button type="button" @click="sortBy('vacant')" class="inline-flex items-center justify-center gap-1.5 hover:text-navy transition-colors font-semibold uppercase tracking-wider">
                                    Vacancies
                                    <app-icon :name="getSortIcon('vacant')" :size="13" :class="sortKey === 'vacant' ? 'text-navy font-bold' : 'text-disabled'" />
                                </button>
                            </th>
                            <th class="px-5 py-3.5">
                                <button type="button" @click="sortBy('operatingHours')" class="inline-flex items-center gap-1.5 text-left hover:text-navy transition-colors font-semibold uppercase tracking-wider">
                                    Operating Hours
                                    <app-icon :name="getSortIcon('operatingHours')" :size="13" :class="sortKey === 'operatingHours' ? 'text-navy font-bold' : 'text-disabled'" />
                                </button>
                            </th>
                            <th class="px-5 py-3.5">
                                <button type="button" @click="sortBy('weeklyTargetHours')" class="inline-flex items-center gap-1.5 text-left hover:text-navy transition-colors font-semibold uppercase tracking-wider">
                                    Weekly Target
                                    <app-icon :name="getSortIcon('weeklyTargetHours')" :size="13" :class="sortKey === 'weeklyTargetHours' ? 'text-navy font-bold' : 'text-disabled'" />
                                </button>
                            </th>
                            <th class="px-5 py-3.5 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-line">
                        <tr v-for="o in pagedItems" :key="o.officeId" class="transition-colors duration-150 hover:bg-mist/50">
                            <td class="whitespace-nowrap px-5 py-3.5">
                                <div class="flex items-center gap-2.5">
                                    <span class="grid h-7 w-7 place-items-center rounded bg-navy/5 text-navy text-[11px] font-bold font-mono">
                                        {{ (o.code || o.name).slice(0, 3).toUpperCase() }}
                                    </span>
                                    <div>
                                        <span class="font-semibold text-ink">{{ o.name }}</span>
                                        <span class="block text-caption text-muted font-mono">{{ o.code }}</span>
                                    </div>
                                </div>
                            </td>
                            <td class="px-5 py-3.5">
                                <span class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-semibold border"
                                      :class="stateStyles[state(o)][0]">
                                    <app-icon :name="stateStyles[state(o)][1]" :size="12" />
                                    {{ state(o) === 'VACANCY' ? Math.max(0, o.vacant) + (o.vacant === 1 ? ' vacancy' : ' vacancies') : stateStyles[state(o)][2] }}
                                </span>
                            </td>
                            <td class="px-5 py-3.5 text-center">
                                <span v-if="o.requiredSa !== null && o.requiredSa > 0" class="font-bold text-ink">{{ o.requiredSa }}</span>
                                <span v-else class="text-muted">—</span>
                            </td>
                            <td class="px-5 py-3.5 text-center">
                                <span v-if="o.assignedSa > 0" class="font-bold text-ink">{{ o.assignedSa }}</span>
                                <span v-else-if="o.requiredSa !== null && o.requiredSa > 0" class="text-ink">0</span>
                                <span v-else class="text-muted">—</span>
                            </td>
                            <td class="px-5 py-3.5 text-center">
                                <span v-if="o.requiredSa !== null && o.requiredSa > 0"
                                      :class="o.vacant > 0 ? 'font-bold text-danger' : 'text-muted'">
                                    {{ Math.max(0, o.vacant) }}
                                </span>
                                <span v-else class="text-muted">—</span>
                            </td>
                            <td class="whitespace-nowrap px-5 py-3.5">
                                <span v-if="o.operatingLabel" class="text-ink font-medium">{{ o.operatingLabel }}</span>
                                <span v-else class="text-muted">—</span>
                            </td>
                            <td class="whitespace-nowrap px-5 py-3.5">
                                <span v-if="o.weeklyTargetHours" class="text-ink">{{ o.weeklyTargetHours }} hrs/wk</span>
                                <span v-else class="text-muted">—</span>
                            </td>
                            <td class="whitespace-nowrap px-5 py-3.5 text-right">
                                <div class="inline-flex items-center justify-end gap-1">
                                    <!-- When Requires S.A. -->
                                    <template v-if="o.isActive && o.requiredSa !== null && o.requiredSa > 0">
                                        <button @click="openStaff(o)" class="btn btn-sm"
                                                :class="o.vacant > 0 ? 'btn-primary' : 'btn-secondary'">
                                            <app-icon :name="o.vacant > 0 ? 'UserPlus' : 'Users'" :size="14" />
                                            {{ o.vacant > 0 ? 'Assign S.A.' : 'Staff' }}
                                        </button>
                                        <button @click="openForm(o)"
                                                class="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-mist hover:text-navy transition-colors"
                                                :aria-label="'Edit requirement for ' + o.name" title="Edit requirement">
                                            <app-icon name="Pencil" :size="15" />
                                        </button>
                                        <button @click="setNoSa(o)"
                                                class="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-rose-50 hover:text-danger transition-colors"
                                                :aria-label="'Mark ' + o.name + ' as No S.A. Needed'" title="Mark as No S.A. Needed">
                                            <app-icon name="CircleMinus" :size="15" />
                                        </button>
                                    </template>

                                    <!-- When Active but No S.A. Needed -->
                                    <template v-else-if="o.isActive">
                                        <button @click="openForm(o)" class="btn btn-secondary btn-sm">
                                            <app-icon name="Plus" :size="14" /> Set requirement
                                        </button>
                                        <button @click="toggleActive(o)"
                                                class="grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-slate-100 hover:text-slate-700 transition-colors"
                                                :aria-label="'Deactivate ' + o.name" title="Deactivate Office">
                                            <app-icon name="Power" :size="14" />
                                        </button>
                                    </template>

                                    <!-- When Office is Inactive -->
                                    <template v-else>
                                        <button @click="toggleActive(o)" class="btn btn-secondary btn-sm">
                                            <app-icon name="Power" :size="14" /> Activate Office
                                        </button>
                                    </template>
                                </div>
                            </td>
                        </tr>
                        <tr v-if="!sortedItems.length">
                            <td colspan="8" class="px-6 py-12 text-center text-muted">
                                <app-icon name="Building2" :size="28" class="mx-auto mb-2 text-muted/60" />
                                <p class="font-medium text-ink">No offices match your search or filter</p>
                                <p class="text-caption text-muted mt-0.5">Try choosing a different filter tab or clearing your search.</p>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- DataTable Footer: Showing X to Y of Z & Pagination controls -->
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-line px-5 py-3.5 bg-white">
                <p class="text-caption text-muted" aria-live="polite">
                    {{ rangeText }}
                </p>

                <nav v-if="pageCount > 1" class="flex items-center gap-1" aria-label="Pagination Navigation">
                    <button type="button" @click="page--" :disabled="page <= 1"
                            class="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1 text-[12px] font-semibold text-ink shadow-2xs hover:bg-page disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            aria-label="Previous page">
                        <app-icon name="ChevronLeft" :size="14" /> Prev
                    </button>

                    <template v-for="(p, idx) in visiblePages" :key="idx">
                        <span v-if="p === '...'" class="px-2 py-1 text-caption text-muted select-none">...</span>
                        <button v-else type="button" @click="page = p"
                                class="h-7 min-w-[28px] rounded-md px-2 text-[12px] font-semibold transition-colors"
                                :class="page === p ? 'bg-navy text-white shadow-xs' : 'border border-line bg-white text-ink hover:bg-page'">
                            {{ p }}
                        </button>
                    </template>

                    <button type="button" @click="page++" :disabled="page >= pageCount"
                            class="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2.5 py-1 text-[12px] font-semibold text-ink shadow-2xs hover:bg-page disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            aria-label="Next page">
                        Next <app-icon name="ChevronRight" :size="14" />
                    </button>
                </nav>
            </div>
        </section>
    </template>

    <!-- Add / Edit Requirement Modal -->
    <app-modal :open="showForm" :title="form.id ? 'Edit Office Requirement' : 'Set Office Requirement'" icon="Building2" @close="showForm = false"
               description="Specify student assistant requirements and operating hours for this office.">
        <form @submit.prevent="save" novalidate class="grid gap-4 sm:grid-cols-2">
            <form-field label="Office" required :error="errors.officeId" class="sm:col-span-2" v-slot="f">
                <select :id="f.id" v-model.number="form.officeId" class="input" :class="{ 'input-error': f.invalid }" :aria-invalid="f.invalid" :disabled="!!form.id">
                    <option value="" disabled>Choose an office</option>
                    <option v-for="o in items" :key="o.officeId" :value="o.officeId">{{ o.name }} ({{ o.code }})</option>
                </select>
            </form-field>

            <div class="sm:col-span-2 flex flex-col gap-1.5">
                <label class="text-caption font-semibold text-ink">Staffing Requirement Status</label>
                <div class="grid grid-cols-2 gap-2">
                    <label class="flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors"
                           :class="form.statusType === 'REQUIRED' ? 'border-navy bg-navy/5 text-navy font-semibold' : 'border-line text-muted hover:bg-mist'">
                        <input type="radio" v-model="form.statusType" value="REQUIRED" class="text-navy" />
                        <span>Requires S.A.</span>
                    </label>
                    <label class="flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors"
                           :class="form.statusType === 'NONE' ? 'border-navy bg-navy/5 text-navy font-semibold' : 'border-line text-muted hover:bg-mist'">
                        <input type="radio" v-model="form.statusType" value="NONE" class="text-navy" />
                        <span>No S.A. Needed</span>
                    </label>
                </div>
                <p v-if="form.statusType === 'NONE'" class="text-caption text-muted mt-1">
                    This office will be marked as not needing any Student Assistants for this semester.
                </p>
            </div>

            <template v-if="form.statusType === 'REQUIRED'">
                <form-field label="Required S.A. count" required :error="errors.requiredSa" hint="How many S.A.s this office needs." v-slot="f">
                    <input :id="f.id" v-model.number="form.requiredSa" type="number" min="1" max="20" class="input" :class="{ 'input-error': f.invalid }" :aria-invalid="f.invalid">
                </form-field>
                <form-field label="Weekly target hours" required :error="errors.weeklyTargetHours" hint="A target, not a limit." v-slot="f">
                    <input :id="f.id" v-model.number="form.weeklyTargetHours" type="number" min="1" max="60" step="0.5" class="input" :class="{ 'input-error': f.invalid }" :aria-invalid="f.invalid">
                </form-field>
                <form-field label="Opens at" required :error="errors.operatingStart" v-slot="f">
                    <input :id="f.id" v-model="form.operatingStart" type="time" class="input" :class="{ 'input-error': f.invalid }" :aria-invalid="f.invalid">
                </form-field>
                <form-field label="Closes at" required :error="errors.operatingEnd" v-slot="f">
                    <input :id="f.id" v-model="form.operatingEnd" type="time" class="input" :class="{ 'input-error': f.invalid }" :aria-invalid="f.invalid">
                </form-field>
                <form-field label="Notes" :error="errors.notes" class="sm:col-span-2" v-slot="f">
                    <input :id="f.id" v-model="form.notes" class="input" :class="{ 'input-error': f.invalid }" :aria-invalid="f.invalid" maxlength="160" placeholder="Optional notes for this office">
                </form-field>
            </template>
            <p v-if="formError" class="flex items-center gap-2 text-body text-danger sm:col-span-2" role="alert">
                <app-icon name="CircleX" :size="16" /> {{ formError }}
            </p>
        </form>
        <template #footer>
            <button @click="showForm = false" class="btn btn-secondary">Cancel</button>
            <button @click="save" :disabled="saving" class="btn btn-primary">
                <app-icon :name="saving ? 'LoaderCircle' : 'Check'" :size="16" :class="saving ? 'animate-spin' : ''" />
                {{ saving ? 'Saving…' : (form.statusType === 'NONE' ? 'Save as No S.A. Needed' : 'Save requirement') }}
            </button>
        </template>
    </app-modal>


    <!-- ------------------------------------------------ who works this office -->
    <app-modal :open="!!panel" :title="panel ? panel.office.name : ''" icon="Users" size="lg" @close="panel = null"
               :description="panel && panel.limits
                   ? 'Office duty runs ' + panel.limits.open + ' to ' + panel.limits.close + '. A week must land between '
                     + panel.limits.minWeekly + ' and ' + panel.limits.maxWeekly + ' credited hours.' : ''">
        <template v-if="panel">
            <div v-if="panel.loading" class="space-y-2 py-4" aria-busy="true">
                <div v-for="n in 4" :key="n" class="h-12 animate-pulse rounded-lg bg-page"></div>
            </div>
            <template v-else>
                <!-- on duty now -->
                <p class="text-caption font-semibold uppercase tracking-wide text-muted">
                    On duty ({{ panel.staff.length }} of {{ panel.office.requiredSa }})
                </p>
                <ul v-if="panel.staff.length" class="mt-2 divide-y divide-line rounded-lg border border-line">
                    <li v-for="s in panel.staff" :key="s.saId" class="flex flex-wrap items-start gap-3 px-3 py-2.5">
                        <div class="min-w-[220px] flex-1">
                            <router-link :to="'/admin/sa-management/' + s.saId" class="text-[13px] font-semibold text-navy hover:underline">
                                {{ s.name }}
                            </router-link>
                            <p class="text-[11px] text-muted">{{ s.studentId }} \u00b7 {{ s.course }} {{ s.yearLevel }}</p>
                            <div v-if="s.rows.length" class="mt-1 flex flex-wrap gap-1">
                                <span v-for="row in s.rows" :key="row.id"
                                      class="inline-flex items-center gap-1 rounded-full bg-mist px-2 py-0.5 text-[11px] text-navy">
                                    {{ DAY_SHORT[row.day] }} {{ row.startLabel }}–{{ row.endLabel }}
                                    <button @click="removeHours(s, row)" :disabled="working"
                                            class="text-muted hover:text-danger" :aria-label="'Remove ' + row.startLabel">
                                        <app-icon name="X" :size="11" />
                                    </button>
                                </span>
                            </div>
                            <p v-else class="mt-0.5 text-[11px] text-warning">No duty hours written yet.</p>

                            <!-- a short week is topped up here: earlier start, later finish -->
                            <button v-if="!hoursForm || hoursForm.saId !== s.saId" @click="openHours(s)" :disabled="working"
                                    class="mt-1.5 inline-flex items-center gap-1 text-[11px] font-medium text-navy hover:underline">
                                <app-icon name="Plus" :size="12" /> Add hours
                            </button>
                            <form v-else @submit.prevent="saveHours" class="mt-2 rounded-lg border border-line bg-page p-2">
                                <div class="flex flex-wrap items-end gap-2">
                                    <label class="text-[11px] text-muted">Day
                                        <select v-model="hoursForm.day" class="input mt-0.5 h-8 w-24 text-[12px]">
                                            <option v-for="(name, code) in DAY_SHORT" :key="code" :value="code">{{ name }}</option>
                                        </select>
                                    </label>
                                    <label class="text-[11px] text-muted">From
                                        <input v-model="hoursForm.startTime" type="time" class="input mt-0.5 h-8 w-[112px] text-[12px]" />
                                    </label>
                                    <label class="text-[11px] text-muted">To
                                        <input v-model="hoursForm.endTime" type="time" class="input mt-0.5 h-8 w-[112px] text-[12px]" />
                                    </label>
                                    <span class="flex items-center gap-2">
                                        <button type="submit" :disabled="working" class="btn btn-primary btn-sm">Add</button>
                                        <button type="button" @click="hoursForm = null" class="btn btn-ghost btn-sm">Cancel</button>
                                    </span>
                                </div>
                                <p class="mt-1.5 text-[11px] text-muted">
                                    Between {{ panel.limits.earliest }} and {{ panel.limits.latest }},
                                    up to {{ panel.limits.maxDaily }} hours a day and
                                    {{ panel.limits.maxWeekly }} credited hours a week.
                                </p>
                                <p v-if="hoursForm.error || hoursForm.errors.day || hoursForm.errors.startTime || hoursForm.errors.endTime"
                                   class="mt-1 text-[11px] font-medium text-danger">
                                    {{ hoursForm.error || hoursForm.errors.day || hoursForm.errors.startTime || hoursForm.errors.endTime }}
                                </p>
                            </form>
                        </div>
                        <div class="text-right">
                            <p class="text-[13px] font-bold" :class="s.belowMinimum ? 'text-warning' : 'text-navy'">
                                {{ s.creditedHours }} hrs
                            </p>
                            <p class="text-[11px] text-muted">credited</p>
                        </div>
                        <button @click="unassign(s)" :disabled="working" class="btn btn-ghost btn-sm shrink-0 text-danger">
                            <app-icon name="UserMinus" :size="14" /> Remove
                        </button>
                    </li>
                </ul>
                <p v-else class="mt-2 rounded-lg bg-page px-3 py-4 text-caption text-muted">
                    Nobody is on this office yet.
                </p>

                <!-- vacancies and who fits them -->
                <div class="mt-5 flex flex-wrap items-center justify-between gap-2">
                    <p class="text-caption font-semibold uppercase tracking-wide text-muted">
                        <span v-if="panel.vacancies" class="text-danger">{{ panel.vacancies }} vacant slot(s)</span>
                        <span v-else class="text-success">Fully staffed</span>
                    </p>
                    <div v-if="panel.vacancies" class="relative">
                        <app-icon name="Search" :size="14" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
                        <input v-model="panel.search" type="search" placeholder="Find an S.A."
                               class="h-8 w-48 rounded-lg border border-line bg-white pl-8 pr-2 text-[12px] text-ink placeholder:text-muted focus:border-navy focus:outline-none" />
                    </div>
                </div>

                <div v-if="panel.vacancies" class="mt-2 max-h-80 overflow-y-auto rounded-lg border border-line">
                    <div v-for="c in candidateRows" :key="c.saId"
                         class="flex flex-wrap items-start gap-3 border-b border-line px-3 py-2.5 last:border-0"
                         :class="c.eligible ? '' : 'bg-page/60'">
                        <div class="min-w-[220px] flex-1">
                            <p class="text-[13px] font-semibold text-ink flex items-center gap-1.5 flex-wrap">
                                {{ c.name }} <span class="font-normal text-muted">\u00b7 {{ c.studentId }}</span>
                                <span v-if="c.isCurrentlyAssigned && c.currentOfficeName"
                                      class="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-900 border border-amber-300 px-2 py-0.5 text-[10px] font-bold">
                                    <app-icon name="Building2" :size="10" /> Current: {{ c.currentOfficeName }}
                                </span>
                                <span v-else-if="!c.isCurrentlyAssigned"
                                      class="inline-flex items-center gap-1 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300 px-2 py-0.5 text-[10px] font-bold">
                                    <app-icon name="Sparkles" :size="10" /> Unassigned
                                </span>
                            </p>
                            <p class="text-[11px] text-muted">
                                {{ c.course }} {{ c.yearLevel }} \u00b7 {{ c.category }} \u00b7 already on {{ c.currentHours }} hrs
                            </p>
                            <p v-if="c.eligible" class="mt-0.5 text-[11px] text-ink">{{ weekText(c.pattern) }}</p>
                            <p v-else class="mt-0.5 text-[11px] font-medium text-danger">{{ c.conflicts.join('; ') }}</p>
                            <p v-if="c.preference" class="text-[11px] text-muted">{{ c.preference }}</p>
                        </div>
                        <div class="text-right">
                            <p class="text-[13px] font-bold" :class="c.belowMinimum ? 'text-warning' : 'text-navy'">
                                {{ c.creditedHours }} hrs
                            </p>
                            <p class="text-[11px] text-muted">after this</p>
                        </div>
                        <div class="flex shrink-0 flex-col items-end gap-1">
                            <button @click="assign(c)" :disabled="working || !c.eligible"
                                    class="btn btn-sm" :class="c.isCurrentlyAssigned ? 'btn-primary' : 'btn-secondary'">
                                <app-icon :name="c.isCurrentlyAssigned ? 'ArrowLeftRight' : 'UserPlus'" :size="14" />
                                {{ c.isCurrentlyAssigned ? 'Reassign' : 'Assign' }}
                            </button>
                            <button v-if="c.extended" @click="assign(c, true)" :disabled="working"
                                    class="btn btn-ghost btn-sm !text-[11px]"
                                    :title="'Duty from ' + c.extended.window + ' instead of the office day'">
                                <app-icon name="Clock" :size="12" /> {{ c.extended.window }} → {{ c.extended.creditedHours }} hrs
                            </button>
                        </div>
                    </div>
                    <p v-if="!candidateRows.length" class="px-3 py-6 text-center text-caption text-muted">
                        Nobody in the matching pool is free inside these hours.
                    </p>
                </div>
            </template>
        </template>
        <template #footer>
            <button @click="panel = null" class="btn btn-secondary">Close</button>
        </template>
    </app-modal>
    `
};
