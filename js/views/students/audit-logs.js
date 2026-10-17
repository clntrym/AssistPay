const RegistrarAuditLogsPage = {
    components: { AppIcon, PageHeader },

    setup() {
        const logs = Vue.ref([]);
        const loading = Vue.ref(false);
        const search = Vue.ref('');
        const actionFilter = Vue.ref('');
        const dateFrom = Vue.ref('');
        const dateTo = Vue.ref('');
        const page = Vue.ref(1);
        const totalPages = Vue.ref(1);
        const total = Vue.ref(0);
        const perPage = Vue.ref(25);
        const actionOptions = Vue.ref([]);

        const fetchLogs = async () => {
            loading.value = true;
            const r = await Model.request('students/get_student_audit', 'list', {
                page: page.value, perPage: perPage.value,
                search: search.value, actionFilter: actionFilter.value,
                dateFrom: dateFrom.value, dateTo: dateTo.value
            });
            loading.value = false;
            if (r.success) {
                logs.value = r.logs;
                total.value = r.total;
                totalPages.value = r.totalPages;
            }
        };

        const fetchActions = async () => {
            const r = await Model.request('students/get_student_audit', 'list_actions');
            if (r.success) actionOptions.value = r.actions;
        };

        Vue.onMounted(() => { fetchActions(); fetchLogs(); });

        const applyFilter = () => { page.value = 1; fetchLogs(); };
        const clearFilters = () => {
            search.value = ''; actionFilter.value = ''; dateFrom.value = ''; dateTo.value = '';
            page.value = 1; fetchLogs();
        };
        const goPage = p => { page.value = p; fetchLogs(); };

        const fmtDate = d => {
            if (!d) return '';
            const dt = new Date(d);
            return dt.toLocaleDateString('en-PH', { month: 'short', day: '2-digit', year: 'numeric' })
                + ' ' + dt.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true });
        };

        const actionColor = a => {
            if (a.startsWith('LOGIN')) return 'bg-blue-100 text-blue-700';
            if (a.startsWith('LOGOUT') || a === 'SESSION_EXPIRED') return 'bg-gray-100 text-gray-600';
            if (a.startsWith('SAVE') || a.startsWith('ADD') || a.startsWith('UPLOAD')) return 'bg-green-100 text-green-700';
            if (a.startsWith('DELETE') || a.startsWith('DROP')) return 'bg-red-100 text-red-700';
            if (a.startsWith('UPDATE') || a.startsWith('EDIT') || a.startsWith('APPROVE')) return 'bg-amber-100 text-amber-700';
            if (a === 'ACCESS_DENIED') return 'bg-red-100 text-red-700';
            return 'bg-navy/10 text-navy';
        };

        const pageNumbers = Vue.computed(() => {
            const pages = [];
            const tp = totalPages.value;
            const cp = page.value;
            let start = Math.max(1, cp - 2);
            let end = Math.min(tp, cp + 2);
            if (end - start < 4) {
                if (start === 1) end = Math.min(tp, start + 4);
                else start = Math.max(1, end - 4);
            }
            for (let i = start; i <= end; i++) pages.push(i);
            return pages;
        });

        return {
            logs, loading, search, actionFilter, dateFrom, dateTo, page, totalPages, total, perPage, actionOptions,
            fetchLogs, applyFilter, clearFilters, goPage, fmtDate, actionColor, pageNumbers
        };
    },

    template: `
    <div>
        <page-header title="My Audit Logs" subtitle="Track your own account activities and system actions." section="System" />

        <!-- Filters -->
        <div class="card mb-4 p-4">
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
                <div>
                    <label class="field-label">Search</label>
                    <input v-model="search" type="search" placeholder="Search action or details..." class="input text-[13px]" @keyup.enter="applyFilter" />
                </div>
                <div>
                    <label class="field-label">Action Type</label>
                    <select v-model="actionFilter" class="input text-[13px]">
                        <option value="">All Actions</option>
                        <option v-for="a in actionOptions" :key="a" :value="a">{{ a }}</option>
                    </select>
                </div>
                <div>
                    <label class="field-label">From</label>
                    <input v-model="dateFrom" type="date" class="input text-[13px]" />
                </div>
                <div>
                    <label class="field-label">To</label>
                    <input v-model="dateTo" type="date" class="input text-[13px]" />
                </div>
                <div class="flex gap-2">
                    <button @click="applyFilter" class="btn bg-navy text-white hover:bg-navy/90 px-4 py-2 text-[13px] rounded-lg flex-1">
                        <app-icon name="Search" :size="14" /> Filter
                    </button>
                    <button @click="clearFilters" class="btn bg-gray-200 text-ink hover:bg-gray-300 px-3 py-2 text-[13px] rounded-lg">
                        <app-icon name="X" :size="14" />
                    </button>
                </div>
            </div>
        </div>

        <!-- Results info -->
        <div class="flex items-center justify-between mb-3 px-1">
            <p class="text-[13px] text-muted">
                Showing <span class="font-semibold text-ink">{{ logs.length }}</span> of <span class="font-semibold text-ink">{{ total }}</span> entries
            </p>
            <div class="flex items-center gap-2 text-[13px]">
                <label class="text-muted">Per page:</label>
                <select v-model="perPage" @change="applyFilter" class="input py-1 px-2 text-[12px] w-16">
                    <option :value="10">10</option>
                    <option :value="25">25</option>
                    <option :value="50">50</option>
                    <option :value="100">100</option>
                </select>
            </div>
        </div>

        <!-- Table -->
        <div class="card overflow-hidden">
            <div v-if="loading" class="flex items-center justify-center py-16 text-muted">
                <app-icon name="LoaderCircle" :size="24" class="animate-spin" />
            </div>
            <div v-else-if="!logs.length" class="flex flex-col items-center gap-2 py-16 text-center">
                <app-icon name="FileSearch" :size="36" class="text-muted opacity-40" />
                <p class="text-caption text-muted">No audit logs found.</p>
            </div>
            <div v-else class="overflow-x-auto">
                <table class="w-full min-w-[700px] text-left text-[12px]">
                    <thead class="bg-page text-caption font-semibold text-muted">
                        <tr>
                            <th class="px-3 py-2.5 w-12">#</th>
                            <th class="px-3 py-2.5">Date & Time</th>
                            <th class="px-3 py-2.5">User</th>
                            <th class="px-3 py-2.5">Action</th>
                            <th class="px-3 py-2.5">Details</th>
                            <th class="px-3 py-2.5">IP Address</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-line">
                        <tr v-for="log in logs" :key="log.id" class="hover:bg-mist/50 transition-colors">
                            <td class="px-3 py-2.5 text-muted font-mono">{{ log.id }}</td>
                            <td class="px-3 py-2.5 whitespace-nowrap text-muted">{{ fmtDate(log.created_at) }}</td>
                            <td class="px-3 py-2.5 whitespace-nowrap">
                                <p class="font-semibold text-ink">{{ log.user_name }}</p>
                                <p v-if="log.user_role" class="text-[10px] text-muted">{{ log.user_role }}</p>
                            </td>
                            <td class="px-3 py-2.5 whitespace-nowrap">
                                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold" :class="actionColor(log.action)">
                                    {{ log.action }}
                                </span>
                            </td>
                            <td class="px-3 py-2.5 text-ink max-w-[300px] truncate" :title="log.details">{{ log.details || '—' }}</td>
                            <td class="px-3 py-2.5 text-muted font-mono text-[11px]">{{ log.ip_address }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Pagination -->
        <div v-if="totalPages > 1" class="flex items-center justify-center gap-1 mt-4">
            <button @click="goPage(page - 1)" :disabled="page <= 1"
                    class="px-3 py-1.5 rounded-lg text-[12px] font-semibold border border-line hover:bg-mist disabled:opacity-40 disabled:cursor-not-allowed">
                Prev
            </button>
            <button v-for="p in pageNumbers" :key="p" @click="goPage(p)"
                    class="px-3 py-1.5 rounded-lg text-[12px] font-semibold border"
                    :class="p === page ? 'bg-navy text-white border-navy' : 'border-line hover:bg-mist text-ink'">
                {{ p }}
            </button>
            <button @click="goPage(page + 1)" :disabled="page >= totalPages"
                    class="px-3 py-1.5 rounded-lg text-[12px] font-semibold border border-line hover:bg-mist disabled:opacity-40 disabled:cursor-not-allowed">
                Next
            </button>
        </div>
    </div>
    `
};
