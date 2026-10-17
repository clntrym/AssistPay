// Supervisor Management View: Categorized by ITO, ACADS, and OFFICES departments.
// Allows registering, editing, filtering, table/grid views, viewing supervised S.A.s, and automatic credentials generation with password change requirement.
const SupervisorManagementPage = {
    components: { AppIcon, PageHeader, AppModal, CredentialsPanel },

    setup() {
        const OFFICE_DEPARTMENTS = [
            "SHS-TVL", "TOOLS ROOM", "HRM BAR", "HR", "PSMO", "FMO", "PURCHASING",
            "OCM", "PRD", "REGISTRAR", "ACAD OFFICE", "OSA",
            "HSO", "LIBRARY", "NSTP", "SIR ALEX", "SHS OFFICE",
            "ITO OFFICE", "RECORDS", "ITJPO"
        ];

        const supervisors = Vue.ref([]);
        const departments = Vue.ref(OFFICE_DEPARTMENTS);
        const totalUniqueSaCount = Vue.ref(null);
        const selectedCategory = Vue.ref('ALL');
        const selectedDept = Vue.ref('ALL');
        const searchQuery = Vue.ref('');
        const viewMode = Vue.ref('table');
        const loading = Vue.ref(false);

        // ===== Form Modal State =====
        const isRegisterModalOpen = Vue.ref(false);
        const isEditMode = Vue.ref(false);
        const editId = Vue.ref(null);
        const saving = Vue.ref(false);
        const showConfirmModal = Vue.ref(false);

        // ===== Credentials Display Modal =====
        const isCredentialsModalOpen = Vue.ref(false);
        const createdCredentials = Vue.ref(null);
        const createdSupervisorName = Vue.ref('');

        const form = Vue.reactive({
            firstName: '',
            middleName: '',
            lastName: '',
            suffix: '',
            empId: '',
            category: 'OFFICES',
            dept: 'SHS-TVL',
            depts: ['SHS-TVL'],
            email: '',
            phone: '',
            status: 'Active'
        });

        const errors = Vue.reactive({
            firstName: '',
            middleName: '',
            lastName: '',
            empId: '',
            email: '',
            phone: ''
        });

        // ===== S.A. List Modal State =====
        const isSaModalOpen = Vue.ref(false);
        const viewingSupervisor = Vue.ref(null);
        const supervisedSaList = Vue.ref([]);
        const loadingSaList = Vue.ref(false);

        // Fetch supervisors from server
        const fetchSupervisors = async () => {
            loading.value = true;
            const res = await Model.request('supervisors', 'list');
            loading.value = false;

            if (res.success && Array.isArray(res.supervisors)) {
                supervisors.value = res.supervisors;
            }
            if (res.departments && Array.isArray(res.departments)) {
                departments.value = res.departments;
            }
            if (typeof res.totalUniqueSa === 'number') {
                totalUniqueSaCount.value = res.totalUniqueSa;
            }
        };

        Vue.onMounted(() => {
            fetchSupervisors();
        });

        const getFullName = (s) => {
            if (!s) return '';
            const mid = s.middleName ? ` ${s.middleName}` : '';
            const suf = s.suffix ? ` ${s.suffix}` : '';
            return `${s.firstName}${mid} ${s.lastName}${suf}`.trim();
        };

        const getInitials = (first, last) => {
            const f = first ? first.charAt(0) : '';
            const l = last ? last.charAt(0) : '';
            return `${f}${l}`.toUpperCase() || 'SV';
        };

        // Metric Card Computed Stats
        const stats = Vue.computed(() => {
            const list = supervisors.value;
            return {
                total: list.length,
                itoCount: list.filter(s => s.category === 'ITO').length,
                acadsCount: list.filter(s => s.category === 'ACADS').length,
                officesCount: list.filter(s => s.category === 'OFFICES' || s.hasOfficeUnits).length,
                totalSaAssigned: totalUniqueSaCount.value !== null
                    ? totalUniqueSaCount.value
                    : list.reduce((acc, curr) => acc + (curr.currentSa || 0), 0)
            };
        });

        // Filtered List
        const filteredSupervisors = Vue.computed(() => {
            const search = searchQuery.value.toLowerCase().trim();
            const cat = selectedCategory.value;
            const dept = selectedDept.value;

            return supervisors.value.filter(s => {
                const name = getFullName(s).toLowerCase();
                const empId = (s.empId || '').toLowerCase();
                const d = (s.dept || '').toLowerCase();
                const c = (s.category || '').toLowerCase();

                const matchesSearch = !search || name.includes(search) || empId.includes(search) || d.includes(search) || c.includes(search);
                const matchesCat = cat === 'ALL' || s.category === cat || (cat === 'OFFICES' && s.hasOfficeUnits);
                const matchesDept = dept === 'ALL' || s.dept === dept || (Array.isArray(s.depts) && s.depts.includes(dept));

                return matchesSearch && matchesCat && matchesDept;
            });
        });

        // DataTable state & sorting
        const sortKey = Vue.ref('name');
        const sortDir = Vue.ref('asc');
        const pageSize = Vue.ref(10);
        const page = Vue.ref(1);

        const sortBy = (key) => {
            if (sortKey.value === key) {
                sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
            } else {
                sortKey.value = key;
                sortDir.value = 'asc';
            }
            page.value = 1;
        };

        const getSortIcon = (key) => {
            if (sortKey.value !== key) return 'ChevronsUpDown';
            return sortDir.value === 'asc' ? 'ChevronUp' : 'ChevronDown';
        };

        Vue.watch([searchQuery, selectedCategory, selectedDept], () => {
            page.value = 1;
        });

        const sortedSupervisors = Vue.computed(() => {
            const list = [...filteredSupervisors.value];
            const key = sortKey.value;
            const dir = sortDir.value === 'asc' ? 1 : -1;

            list.sort((a, b) => {
                let res = 0;
                if (key === 'name') {
                    res = getFullName(a).localeCompare(getFullName(b));
                    if (res === 0) res = (a.empId || '').localeCompare(b.empId || '');
                } else if (key === 'empId') {
                    res = (a.empId || '').localeCompare(b.empId || '');
                } else if (key === 'category') {
                    res = (a.category || '').localeCompare(b.category || '');
                } else if (key === 'dept') {
                    res = (a.dept || '').localeCompare(b.dept || '');
                } else if (key === 'currentSa') {
                    res = (Number(a.currentSa) || 0) - (Number(b.currentSa) || 0);
                } else if (key === 'status') {
                    res = (a.status || '').localeCompare(b.status || '');
                }
                return res * dir;
            });
            return list;
        });

        const pageCount = Vue.computed(() => {
            if (pageSize.value <= 0) return 1;
            return Math.max(1, Math.ceil(sortedSupervisors.value.length / pageSize.value));
        });

        const paginatedSupervisors = Vue.computed(() => {
            if (pageSize.value <= 0) return sortedSupervisors.value;
            const start = (page.value - 1) * pageSize.value;
            return sortedSupervisors.value.slice(start, start + pageSize.value);
        });

        const rangeText = Vue.computed(() => {
            const total = sortedSupervisors.value.length;
            if (!total) return 'Showing 0 to 0 of 0 entries';
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
            if (current <= 4) {
                return [1, 2, 3, 4, 5, '...', total];
            }
            if (current >= total - 3) {
                return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
            }
            return [1, '...', current - 1, current, current + 1, '...', total];
        });

        const filterByCategory = (cat) => {
            selectedCategory.value = cat;
        };

        const resetFilters = () => {
            searchQuery.value = '';
            selectedDept.value = 'ALL';
            selectedCategory.value = 'ALL';
            page.value = 1;
        };

        const clearErrors = () => {
            errors.firstName = '';
            errors.middleName = '';
            errors.lastName = '';
            errors.empId = '';
            errors.email = '';
            errors.phone = '';
        };

        // Form Validation Logic
        const validateForm = () => {
            clearErrors();
            let valid = true;
            const nameRegex = /^[a-zA-Z\s\-\.\'ñÑ]+$/;

            if (!form.firstName.trim()) {
                errors.firstName = "First Name is required.";
                valid = false;
            } else if (!nameRegex.test(form.firstName.trim())) {
                errors.firstName = "First Name contains invalid characters.";
                valid = false;
            }

            if (form.middleName.trim() && !nameRegex.test(form.middleName.trim())) {
                errors.middleName = "Middle Name contains invalid characters.";
                valid = false;
            }

            if (!form.lastName.trim()) {
                errors.lastName = "Last Name is required.";
                valid = false;
            } else if (!nameRegex.test(form.lastName.trim())) {
                errors.lastName = "Last Name contains invalid characters.";
                valid = false;
            }

            if (!form.empId.trim()) {
                errors.empId = "Employee ID is required.";
                valid = false;
            } else if (!/^[A-Za-z0-9\-]+$/.test(form.empId.trim())) {
                errors.empId = "Employee ID may only contain letters, numbers, and hyphens.";
                valid = false;
            }

            if (!form.email.trim()) {
                errors.email = "Email Address is required.";
                valid = false;
            } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
                errors.email = "Enter a valid email format (e.g. name@ncst.edu.ph).";
                valid = false;
            }

            const cleanPhone = form.phone.replace(/\D/g, '');
            if (form.phone.trim()) {
                if (cleanPhone.length !== 11) {
                    errors.phone = "Contact phone number must be exactly 11 digits (e.g. 09171234567).";
                    valid = false;
                } else if (!cleanPhone.startsWith('09')) {
                    errors.phone = "Contact phone number must start with 09 (e.g. 09171234567).";
                    valid = false;
                }
            }

            // Duplicate check against existing supervisors list
            const currentEditId = isEditMode.value ? Number(editId.value) : 0;
            const normEmp = form.empId.trim().toLowerCase();
            const normEmail = form.email.trim().toLowerCase();
            const normFirst = form.firstName.trim().toLowerCase();
            const normLast = form.lastName.trim().toLowerCase();
            const normSuf = (form.suffix || '').trim().toLowerCase();

            for (const s of supervisors.value) {
                if (Number(s.id) === currentEditId) continue;

                if (normEmp && (s.empId || '').trim().toLowerCase() === normEmp) {
                    errors.empId = `Employee ID "${form.empId.trim()}" is already registered to ${getFullName(s)}. Duplicate registration is not allowed.`;
                    valid = false;
                }
                if (normEmail && (s.email || '').trim().toLowerCase() === normEmail) {
                    errors.email = `Email "${form.email.trim()}" is already registered to ${getFullName(s)}. Duplicate registration is not allowed.`;
                    valid = false;
                }
                if (
                    normFirst && normLast &&
                    (s.firstName || '').trim().toLowerCase() === normFirst &&
                    (s.lastName || '').trim().toLowerCase() === normLast &&
                    (s.suffix || '').trim().toLowerCase() === normSuf
                ) {
                    errors.firstName = `Supervisor "${getFullName(form)}" is already registered (${s.empId}). Duplicate registration is not allowed.`;
                    valid = false;
                }
                if (cleanPhone && (s.phone || '').replace(/\D/g, '') === cleanPhone) {
                    errors.phone = `Phone number "${cleanPhone}" is already registered to ${getFullName(s)}.`;
                    valid = false;
                }
            }

            return valid;
        };

        const syncFormDeptString = () => {
            const officeOnly = form.depts.filter(d => d !== 'ITO' && d !== 'ACADS');
            if (form.category === 'ITO') {
                form.depts = [...officeOnly, 'ITO'];
            } else if (form.category === 'ACADS') {
                form.depts = [...officeOnly, 'ACADS'];
            } else {
                form.depts = officeOnly.length ? officeOnly : [departments.value[0] || 'SHS-TVL'];
            }
            form.dept = form.depts.join(', ');
        };

        // Handle Department Selection in Form (works for ITO, ACADS, and OFFICES)
        const toggleFormDept = (deptName) => {
            if (deptName === 'ITO' || deptName === 'ACADS') return;
            const officeOnly = form.depts.filter(d => d !== 'ITO' && d !== 'ACADS');
            const idx = officeOnly.indexOf(deptName);
            if (idx >= 0) {
                if (form.category !== 'OFFICES' || officeOnly.length > 1) {
                    officeOnly.splice(idx, 1);
                }
            } else {
                officeOnly.push(deptName);
            }
            form.depts = officeOnly;
            syncFormDeptString();
        };

        const selectAllDepts = () => {
            form.depts = [...departments.value];
            syncFormDeptString();
        };

        const clearAllDepts = () => {
            if (form.category === 'ITO') {
                form.depts = ['ITO OFFICE', 'ITO'];
            } else if (form.category === 'ACADS') {
                form.depts = ['ACAD OFFICE', 'ACADS'];
            } else {
                form.depts = [departments.value[0] || 'SHS-TVL'];
            }
            syncFormDeptString();
        };

        // Handle Category Selection in Form
        const onFormCategoryChange = () => {
            const officeOnly = (form.depts || []).filter(d => d !== 'ITO' && d !== 'ACADS');
            if (form.category === 'ITO') {
                if (!officeOnly.length) officeOnly.push('ITO OFFICE');
                form.depts = [...officeOnly, 'ITO'];
            } else if (form.category === 'ACADS') {
                if (!officeOnly.length) officeOnly.push('ACAD OFFICE');
                form.depts = [...officeOnly, 'ACADS'];
            } else if (form.category === 'OFFICES') {
                form.depts = officeOnly.length ? officeOnly : [departments.value[0] || 'SHS-TVL'];
            }
            form.dept = form.depts.join(', ');
        };

        const openRegisterModal = () => {
            isEditMode.value = false;
            editId.value = null;
            clearErrors();
            const defaultDept = departments.value[0] || 'SHS-TVL';
            Object.assign(form, {
                firstName: '',
                middleName: '',
                lastName: '',
                suffix: '',
                empId: '',
                category: 'OFFICES',
                depts: [defaultDept],
                dept: defaultDept,
                email: '',
                phone: '',
                status: 'Active'
            });
            isRegisterModalOpen.value = true;
        };

        const editSupervisor = (s) => {
            isEditMode.value = true;
            editId.value = s.id;
            clearErrors();
            const sDepts = Array.isArray(s.depts) && s.depts.length ? s.depts : (s.dept ? s.dept.split(',').map(d => d.trim()) : [departments.value[0] || 'SHS-TVL']);
            Object.assign(form, {
                firstName: s.firstName || '',
                middleName: s.middleName || '',
                lastName: s.lastName || '',
                suffix: s.suffix || '',
                empId: s.empId || '',
                category: s.category || 'OFFICES',
                depts: [...sDepts],
                dept: sDepts.join(', '),
                email: s.email || '',
                phone: s.phone || '',
                status: s.status || 'Active'
            });
            syncFormDeptString();
            isRegisterModalOpen.value = true;
        };

        const closeRegisterModal = () => {
            isRegisterModalOpen.value = false;
            showConfirmModal.value = false;
        };

        const editReason = Vue.ref('');

        const promptSaveConfirmation = () => {
            if (!validateForm()) {
                Alerts.warning('Validation Required', 'Please review the highlighted fields in the form.');
                return;
            }
            editReason.value = '';
            showConfirmModal.value = true;
        };

        const confirmSave = async () => {
            if (isEditMode.value && String(editReason.value || '').trim().length < 3) {
                Alerts.warning('Reason Required', 'Please provide a reason for editing this supervisor record (at least 3 characters).');
                return;
            }
            showConfirmModal.value = false;
            saving.value = true;

            const action = isEditMode.value ? 'update' : 'create';
            const cleanPhone = form.phone.replace(/\D/g, '');
            syncFormDeptString();
            const activeDepts = [...form.depts];
            const payload = {
                ...form,
                depts: activeDepts,
                dept: activeDepts.join(', '),
                phone: cleanPhone,
                id: editId.value,
                reason: isEditMode.value ? String(editReason.value || '').trim() : undefined
            };

            const res = await Model.request('supervisors', action, payload);
            saving.value = false;

            if (res.success) {
                await Alerts.success("Supervisor Saved", res.message || (isEditMode.value ? 'Supervisor details updated successfully.' : 'Supervisor registered successfully!'));
                isRegisterModalOpen.value = false;

                if (res.credentials) {
                    createdCredentials.value = res.credentials;
                    createdSupervisorName.value = getFullName(form);
                    isCredentialsModalOpen.value = true;
                }

                fetchSupervisors();
            } else if (!res.cancelled) {
                Alerts.error('Save Failed', res.message || 'May naganap na error. Subukang muli.');
            }
        };

        const toggleStatus = async (s) => {
            const newStatus = s.status === 'Active' ? 'Inactive' : 'Active';
            const ok = await Alerts.confirm({
                title: `${newStatus === 'Inactive' ? 'Deactivate' : 'Activate'} Supervisor — ${getFullName(s)}?`,
                text: `Change status of ${getFullName(s)} to ${newStatus}?`,
                confirmText: `Yes, ${newStatus === 'Inactive' ? 'Deactivate' : 'Activate'}`,
                danger: newStatus === 'Inactive',
                requireReason: true
            });
            if (!ok) return;

            const res = await Model.request('supervisors', 'toggle_status', { id: s.id });

            if (res.success) {
                s.status = newStatus;
                await Alerts.success("Status Updated", res.message || `Status updated to ${newStatus} for ${getFullName(s)}.`);
                fetchSupervisors();
            } else if (!res.cancelled) {
                Alerts.error('Status Update Failed', res.message || 'Hindi na-update ang status.');
            }
        };

        const resetPassword = async (s) => {
            const ok = await Alerts.confirm({
                title: `Reset Password — ${getFullName(s)}?`,
                text: `Generate a new temporary password for ${getFullName(s)}?`,
                confirmText: 'Reset Password',
                requireReason: true
            });
            if (!ok) return;

            const res = await Model.request('supervisors', 'reset_password', { id: s.id });
            if (res.success && res.credentials) {
                createdCredentials.value = res.credentials;
                createdSupervisorName.value = getFullName(s);
                isCredentialsModalOpen.value = true;
                await Alerts.success("Password Reset", res.message || `Password reset for ${getFullName(s)}.`);
            } else if (!res.cancelled) {
                Alerts.error('Password Reset Failed', res.message || 'Failed to reset password.');
            }
        };

        // Open Supervised S.A. List Modal
        const openSaModal = async (s) => {
            viewingSupervisor.value = s;
            isSaModalOpen.value = true;
            loadingSaList.value = true;
            supervisedSaList.value = [];

            const res = await Model.request('supervisors', 'get_sa_list', { id: s.id });
            loadingSaList.value = false;

            if (res.success && Array.isArray(res.saList)) {
                supervisedSaList.value = res.saList;
            }
        };

        const closeSaModal = () => {
            isSaModalOpen.value = false;
        };

        return {
            supervisors, departments, selectedCategory, selectedDept, searchQuery, viewMode, loading,
            filteredSupervisors, sortedSupervisors, paginatedSupervisors, stats, getFullName, getInitials, filterByCategory, resetFilters,
            sortKey, sortDir, pageSize, page, sortBy, getSortIcon, pageCount, rangeText, visiblePages,
            isRegisterModalOpen, isEditMode, saving, form, errors, editReason, showConfirmModal, openRegisterModal, editSupervisor,
            closeRegisterModal, promptSaveConfirmation, confirmSave, onFormCategoryChange, toggleFormDept, selectAllDepts, clearAllDepts, toggleStatus, resetPassword,
            isCredentialsModalOpen, createdCredentials, createdSupervisorName,
            isSaModalOpen, viewingSupervisor, supervisedSaList, loadingSaList, openSaModal, closeSaModal
        };
    },

    template: `
    <div class="space-y-5">
        
        <!-- Header & Action Button -->
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
                <h1 class="text-2xl font-bold text-navy tracking-tight">Supervisor Management</h1>
                <p class="text-xs md:text-sm text-muted mt-0.5">Categorized by <strong>ITO</strong>, <strong>ACADS</strong>, and <strong>OFFICES</strong> departments.</p>
            </div>
            <div>
                <button @click="openRegisterModal" class="inline-flex items-center justify-center space-x-2 bg-navy hover:bg-navy-700 text-white text-xs font-semibold px-4 py-2.5 rounded-lg transition shadow-md hover:shadow-lg w-full sm:w-auto">
                    <app-icon name="UserPlus" :size="16" />
                    <span>Register Supervisor</span>
                </button>
            </div>
        </div>

        <!-- Metric Cards -->
        <div class="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-4">
            
            <!-- All Supervisors -->
            <div @click="filterByCategory('ALL')" class="bg-white border border-line rounded-xl p-3.5 flex items-center space-x-3 shadow-xs cursor-pointer hover:border-navy transition">
                <div class="w-9 h-9 rounded-lg bg-page text-navy flex items-center justify-center shrink-0">
                    <app-icon name="Users" :size="20" />
                </div>
                <div>
                    <div class="text-xl font-extrabold text-navy">{{ stats.total }}</div>
                    <div class="text-[11px] font-medium text-muted">All Supervisors</div>
                </div>
            </div>

            <!-- ITO Category -->
            <div @click="filterByCategory('ITO')" class="bg-white border border-line rounded-xl p-3.5 flex items-center space-x-3 shadow-xs cursor-pointer hover:border-info transition">
                <div class="w-9 h-9 rounded-lg bg-info/10 text-info flex items-center justify-center shrink-0">
                    <app-icon name="Laptop" :size="20" />
                </div>
                <div>
                    <div class="flex items-baseline space-x-1">
                        <span class="text-xl font-extrabold text-navy">{{ stats.itoCount }}</span>
                        <span class="text-[10px] text-info font-bold">(Unified)</span>
                    </div>
                    <div class="text-[11px] font-medium text-muted">ITO Category</div>
                </div>
            </div>

            <!-- ACADS Category -->
            <div @click="filterByCategory('ACADS')" class="bg-white border border-line rounded-xl p-3.5 flex items-center space-x-3 shadow-xs cursor-pointer hover:border-purple-500 transition">
                <div class="w-9 h-9 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
                    <app-icon name="BookOpen" :size="20" />
                </div>
                <div>
                    <div class="flex items-baseline space-x-1">
                        <span class="text-xl font-extrabold text-navy">{{ stats.acadsCount }}</span>
                        <span class="text-[10px] text-purple-600 font-bold">(Unified)</span>
                    </div>
                    <div class="text-[11px] font-medium text-muted">ACADS Category</div>
                </div>
            </div>

            <!-- OFFICES Category -->
            <div @click="filterByCategory('OFFICES')" class="bg-white border border-line rounded-xl p-3.5 flex items-center space-x-3 shadow-xs cursor-pointer hover:border-success transition">
                <div class="w-9 h-9 rounded-lg bg-success/10 text-success flex items-center justify-center shrink-0">
                    <app-icon name="Building2" :size="20" />
                </div>
                <div>
                    <div class="text-xl font-extrabold text-navy">{{ stats.officesCount }}</div>
                    <div class="text-[11px] font-medium text-muted">OFFICES Depts</div>
                </div>
            </div>

            <!-- Total S.A. Assigned -->
            <div class="bg-white border border-line rounded-xl p-3.5 flex items-center space-x-3 shadow-xs col-span-2 lg:col-span-1">
                <div class="w-9 h-9 rounded-lg bg-amber-50 text-warning flex items-center justify-center shrink-0">
                    <app-icon name="Users" :size="20" />
                </div>
                <div>
                    <div class="text-xl font-extrabold text-navy">{{ stats.totalSaAssigned }}</div>
                    <div class="text-[11px] font-medium text-muted">Total S.A. Assigned</div>
                </div>
            </div>
        </div>

        <!-- Filters & Search Toolbar -->
        <div class="bg-white border border-line rounded-xl p-4 space-y-3.5 shadow-xs">
            
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3">
                
                <!-- Search Input -->
                <div class="lg:col-span-5 relative">
                    <app-icon name="Search" :size="16" class="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                    <input v-model="searchQuery" type="text" placeholder="Search supervisor name, ID, or department..." 
                           class="w-full pl-9 pr-3 py-2 bg-page border border-line rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-navy/20 focus:bg-white transition">
                </div>

                <!-- Category Filter Dropdown -->
                <div class="lg:col-span-3">
                    <select v-model="selectedCategory" class="w-full px-3 py-2 bg-page border border-line rounded-lg text-xs font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-navy/20 focus:bg-white transition">
                        <option value="ALL">All S.A. Categories</option>
                        <option value="ITO">ITO (Information Technology)</option>
                        <option value="ACADS">ACADS (Academic Assistants)</option>
                        <option value="OFFICES">OFFICES (Specific Departments)</option>
                    </select>
                </div>

                <!-- Office / Department Specific Dropdown -->
                <div class="lg:col-span-2">
                    <select v-model="selectedDept" class="w-full px-3 py-2 bg-page border border-line rounded-lg text-xs font-medium text-ink focus:outline-none focus:ring-2 focus:ring-navy/20 focus:bg-white transition">
                        <option value="ALL">All Departments</option>
                        <option v-for="dept in departments" :key="dept" :value="dept">{{ dept }}</option>
                    </select>
                </div>

                <!-- View Switcher Table vs Grid -->
                <div class="lg:col-span-2 flex justify-end items-center">
                    <div class="inline-flex bg-page p-1 rounded-lg border border-line w-full justify-center">
                        <button @click="viewMode = 'table'" 
                                class="flex-1 py-1 px-3 text-xs font-medium rounded-md transition flex items-center justify-center space-x-1.5"
                                :class="viewMode === 'table' ? 'bg-white text-navy shadow-xs font-bold' : 'text-muted hover:text-ink'">
                            <app-icon name="List" :size="14" />
                            <span>Table</span>
                        </button>
                        <button @click="viewMode = 'grid'" 
                                class="flex-1 py-1 px-3 text-xs font-medium rounded-md transition flex items-center justify-center space-x-1.5"
                                :class="viewMode === 'grid' ? 'bg-white text-navy shadow-xs font-bold' : 'text-muted hover:text-ink'">
                            <app-icon name="LayoutGrid" :size="14" />
                            <span>Grid</span>
                        </button>
                    </div>
                </div>
            </div>

            <!-- Category Pills Quick Bar -->
            <div class="flex flex-wrap items-center gap-2 pt-1 border-t border-line/60">
                <span class="text-[11px] font-bold text-muted uppercase tracking-wider mr-1">Category:</span>
                
                <button @click="filterByCategory('ALL')" 
                        class="px-3 py-1 rounded-full text-xs font-semibold transition"
                        :class="selectedCategory === 'ALL' ? 'bg-navy text-white' : 'bg-page text-muted hover:bg-mist hover:text-navy'">
                    All ({{ stats.total }})
                </button>
                <button @click="filterByCategory('ITO')" 
                        class="px-3 py-1 rounded-full text-xs font-semibold transition"
                        :class="selectedCategory === 'ITO' ? 'bg-info text-white' : 'bg-info/10 text-info hover:bg-info/20'">
                    ITO ({{ stats.itoCount }} Lead)
                </button>
                <button @click="filterByCategory('ACADS')" 
                        class="px-3 py-1 rounded-full text-xs font-semibold transition"
                        :class="selectedCategory === 'ACADS' ? 'bg-purple-600 text-white' : 'bg-purple-50 text-purple-700 hover:bg-purple-100'">
                    ACADS ({{ stats.acadsCount }} Lead)
                </button>
                <button @click="filterByCategory('OFFICES')" 
                        class="px-3 py-1 rounded-full text-xs font-semibold transition"
                        :class="selectedCategory === 'OFFICES' ? 'bg-success text-white' : 'bg-success/10 text-success hover:bg-success/20'">
                    OFFICES ({{ stats.officesCount }} Depts)
                </button>
            </div>
        </div>

        <!-- Table View Container -->
        <div v-if="viewMode === 'table' && sortedSupervisors.length > 0" class="bg-white border border-line rounded-xl overflow-hidden shadow-xs">
            <!-- DataTable Top Toolbar: Page Size Selector & Count Badge -->
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line px-5 py-3.5 bg-mist/30">
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
                    <b class="text-ink">{{ sortedSupervisors.length }}</b> total supervisors found
                </span>
            </div>

            <div class="overflow-x-auto">
                <table class="w-full text-left border-collapse">
                    <thead>
                        <tr class="bg-page border-b border-line text-[11px] font-semibold text-muted uppercase tracking-wider select-none">
                            <th class="py-3 px-4">
                                <button type="button" @click="sortBy('name')" class="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-muted hover:text-ink transition-colors">
                                    Supervisor Name &amp; ID
                                    <app-icon :name="getSortIcon('name')" :size="13" />
                                </button>
                            </th>
                            <th class="py-3 px-4">
                                <button type="button" @click="sortBy('category')" class="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-muted hover:text-ink transition-colors">
                                    Category
                                    <app-icon :name="getSortIcon('category')" :size="13" />
                                </button>
                            </th>
                            <th class="py-3 px-4">
                                <button type="button" @click="sortBy('dept')" class="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-muted hover:text-ink transition-colors">
                                    Assigned Department / Scope
                                    <app-icon :name="getSortIcon('dept')" :size="13" />
                                </button>
                            </th>
                            <th class="py-3 px-4">
                                <button type="button" @click="sortBy('currentSa')" class="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-muted hover:text-ink transition-colors">
                                    Supervised S.A.s
                                    <app-icon :name="getSortIcon('currentSa')" :size="13" />
                                </button>
                            </th>
                            <th class="py-3 px-4">
                                <button type="button" @click="sortBy('status')" class="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-muted hover:text-ink transition-colors">
                                    Status
                                    <app-icon :name="getSortIcon('status')" :size="13" />
                                </button>
                            </th>
                            <th class="py-3 px-4 text-right">Actions</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-line text-xs">
                        <tr v-for="s in paginatedSupervisors" :key="s.id" class="hover:bg-mist/30 transition">
                            <td class="py-3 px-4">
                                <div class="flex items-center space-x-3">
                                    <div class="w-8 h-8 rounded-full bg-navy text-white font-bold text-xs flex items-center justify-center shrink-0">
                                        {{ getInitials(s.firstName, s.lastName) }}
                                    </div>
                                    <div>
                                        <div @click="openSaModal(s)" class="font-bold text-navy hover:text-info cursor-pointer">
                                            {{ getFullName(s) }}
                                        </div>
                                        <div class="text-[10px] text-muted font-mono">{{ s.empId }}</div>
                                    </div>
                                </div>
                            </td>
                            <td class="py-3 px-4">
                                <div class="flex flex-wrap gap-1">
                                    <span v-if="s.category === 'ITO'" class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-info/10 text-info border border-info/20">
                                        <app-icon name="Laptop" :size="12" class="mr-1" /> ITO
                                    </span>
                                    <span v-else-if="s.category === 'ACADS'" class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                                        <app-icon name="BookOpen" :size="12" class="mr-1" /> ACADS
                                    </span>
                                    <span v-if="s.category === 'OFFICES' || s.hasOfficeUnits" class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-success/10 text-success border border-success/20">
                                        <app-icon name="Building2" :size="12" class="mr-1" /> OFFICES
                                    </span>
                                </div>
                            </td>
                            <td class="py-3 px-4">
                                <span class="font-bold text-ink">{{ s.dept }}</span>
                                <span v-if="s.category !== 'OFFICES'" class="text-[10px] text-muted block">(Category + Office Scope)</span>
                            </td>
                            <td class="py-3 px-4">
                                <span class="font-bold text-ink">{{ s.currentSa }} S.A.s</span>
                            </td>
                            <td class="py-3 px-4">
                                <span class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold"
                                      :class="s.status === 'Active' ? 'bg-success/10 text-success border border-success/20' : 'bg-warning/10 text-warning border border-warning/20'">
                                    {{ s.status }}
                                </span>
                            </td>
                            <td class="py-3 px-4 text-right space-x-1">
                                <button @click="openSaModal(s)" title="View Supervised S.A.s" class="p-1.5 text-muted hover:text-navy hover:bg-mist rounded transition">
                                    <app-icon name="Users" :size="15" />
                                </button>
                                <button @click="editSupervisor(s)" title="Edit" class="p-1.5 text-muted hover:text-info hover:bg-info/10 rounded transition">
                                    <app-icon name="Pencil" :size="15" />
                                </button>
                                <button @click="resetPassword(s)" title="Reset Temporary Password" class="p-1.5 text-muted hover:text-navy hover:bg-mist rounded transition">
                                    <app-icon name="KeyRound" :size="15" />
                                </button>
                                <button @click="toggleStatus(s)" title="Toggle Active Status" class="p-1.5 text-muted hover:text-warning hover:bg-warning/10 rounded transition">
                                    <app-icon name="Power" :size="15" />
                                </button>
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
        </div>

        <!-- Grid View Container -->
        <div v-if="viewMode === 'grid' && sortedSupervisors.length > 0" class="space-y-4">
            <!-- DataTable Top Toolbar: Page Size Selector & Count Badge -->
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-line bg-white px-5 py-3.5 shadow-xs">
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
                    <b class="text-ink">{{ sortedSupervisors.length }}</b> total supervisors found
                </span>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                <div v-for="s in paginatedSupervisors" :key="s.id" class="bg-white border border-line rounded-xl p-4 shadow-xs hover:shadow-md transition flex flex-col justify-between">
                <div>
                    <div class="flex items-start justify-between">
                        <div class="flex items-center space-x-2.5">
                            <div class="w-9 h-9 rounded-full bg-navy text-white font-bold text-xs flex items-center justify-center">
                                {{ getInitials(s.firstName, s.lastName) }}
                            </div>
                            <div>
                                <h4 @click="openSaModal(s)" class="font-bold text-navy text-sm hover:text-info cursor-pointer">{{ getFullName(s) }}</h4>
                                <span class="text-[10px] font-mono text-muted">{{ s.empId }}</span>
                            </div>
                        </div>
                        <div class="flex flex-wrap gap-1 justify-end">
                            <span v-if="s.category === 'ITO'" class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-info/10 text-info border border-info/20">
                                <app-icon name="Laptop" :size="12" class="mr-1" /> ITO
                            </span>
                            <span v-else-if="s.category === 'ACADS'" class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700 border border-purple-200">
                                <app-icon name="BookOpen" :size="12" class="mr-1" /> ACADS
                            </span>
                            <span v-if="s.category === 'OFFICES' || s.hasOfficeUnits" class="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-success/10 text-success border border-success/20">
                                <app-icon name="Building2" :size="12" class="mr-1" /> OFFICES
                            </span>
                        </div>
                    </div>

                    <div class="mt-3.5 pt-3 border-t border-line space-y-1.5 text-xs">
                        <div class="flex items-center text-ink">
                            <app-icon name="Building2" :size="14" class="text-muted mr-1.5" />
                            <span class="font-bold">{{ s.dept }}</span>
                        </div>
                        <div class="flex items-center text-muted text-[11px]">
                            <app-icon name="Mail" :size="14" class="text-muted mr-1.5" />
                            <span>{{ s.email }}</span>
                        </div>
                    </div>

                    <div class="mt-3.5 bg-page p-2.5 rounded-lg border border-line flex justify-between items-center">
                        <span class="text-xs text-muted font-semibold">Active Supervised S.A.s</span>
                        <span class="text-navy font-bold text-xs">{{ s.currentSa }} S.A.s</span>
                    </div>
                </div>

                <div class="mt-4 pt-3 border-t border-line flex items-center justify-between text-xs">
                    <button @click="openSaModal(s)" class="text-info font-semibold hover:underline flex items-center space-x-1">
                        <app-icon name="Eye" :size="14" />
                        <span>View S.A.s</span>
                    </button>
                    <div class="space-x-1">
                        <button @click="editSupervisor(s)" title="Edit" class="p-1 text-muted hover:text-info">
                            <app-icon name="Pencil" :size="15" />
                        </button>
                        <button @click="resetPassword(s)" title="Reset Temporary Password" class="p-1 text-muted hover:text-navy">
                            <app-icon name="KeyRound" :size="15" />
                        </button>
                        <button @click="toggleStatus(s)" title="Toggle Active Status" class="p-1 text-muted hover:text-warning">
                            <app-icon name="Power" :size="15" />
                        </button>
                    </div>
                </div>
            </div>
            </div>

            <!-- Grid Pagination Footer -->
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-line bg-white px-5 py-3.5 shadow-xs">
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
        </div>

        <!-- Empty State -->
        <div v-if="sortedSupervisors.length === 0" class="bg-white border border-line rounded-xl p-12 text-center shadow-xs">
            <div class="w-16 h-16 bg-page text-muted rounded-full flex items-center justify-center mx-auto mb-3">
                <app-icon name="UserX" :size="32" />
            </div>
            <h3 class="text-base font-bold text-ink">No Supervisors Found</h3>
            <p class="text-xs text-muted mt-1 max-w-sm mx-auto">No supervisor records match the selected category or department filter.</p>
            <button @click="resetFilters" class="mt-4 inline-flex items-center space-x-2 text-xs font-semibold text-info hover:underline">
                <app-icon name="RotateCcw" :size="14" />
                <span>Reset Filters</span>
            </button>
        </div>

        <!-- ================= Modal: Register / Edit Supervisor ================= -->
        <div v-if="isRegisterModalOpen" class="fixed inset-0 bg-navy/60 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
            <div class="bg-white rounded-2xl shadow-2xl max-w-xl sm:max-w-2xl w-full overflow-hidden border border-line my-auto">
                
                <!-- Modal Header -->
                <div class="bg-navy px-5 py-4 text-white flex items-center justify-between">
                    <div class="flex items-center space-x-2.5">
                        <div class="w-8 h-8 rounded-lg bg-info/20 flex items-center justify-center text-gold">
                            <app-icon :name="isEditMode ? 'Pencil' : 'UserPlus'" :size="18" />
                        </div>
                        <div>
                            <h3 class="font-bold text-sm sm:text-base tracking-wide">{{ isEditMode ? 'Edit Supervisor' : 'Register Supervisor' }}</h3>
                            <p class="text-[11px] text-white/70">Assign S.A. Category (ITO, ACADS, or OFFICES) and Office Units</p>
                        </div>
                    </div>
                    <button @click="closeRegisterModal" class="text-white/70 hover:text-white transition">
                        <app-icon name="X" :size="20" />
                    </button>
                </div>

                <!-- Modal Form -->
                <form @submit.prevent="promptSaveConfirmation" class="p-5 space-y-4 max-h-[82vh] overflow-y-auto">
                    
                    <!-- Clean Single-Row Name Fields Grid -->
                    <div class="space-y-1">
                        <div class="grid grid-cols-1 sm:grid-cols-12 gap-3">
                            <div class="sm:col-span-4">
                                <label class="block text-xs font-semibold text-ink mb-1">First Name *</label>
                                <input type="text" v-model="form.firstName" required placeholder="e.g. Mark" 
                                       class="w-full px-3 py-2 border rounded-lg text-xs focus:ring-2 focus:ring-navy/20 focus:border-navy focus:outline-none transition"
                                       :class="errors.firstName ? 'border-danger bg-danger/5' : 'border-line bg-white'">
                                <p v-if="errors.firstName" class="text-[10px] text-danger mt-1 font-medium">{{ errors.firstName }}</p>
                            </div>

                            <div class="sm:col-span-3">
                                <label class="block text-xs font-semibold text-ink mb-1">Middle Name</label>
                                <input type="text" v-model="form.middleName" placeholder="e.g. Santos" 
                                       class="w-full px-3 py-2 border rounded-lg text-xs focus:ring-2 focus:ring-navy/20 focus:border-navy focus:outline-none transition"
                                       :class="errors.middleName ? 'border-danger bg-danger/5' : 'border-line bg-white'">
                                <p v-if="errors.middleName" class="text-[10px] text-danger mt-1 font-medium">{{ errors.middleName }}</p>
                            </div>

                            <div class="sm:col-span-3">
                                <label class="block text-xs font-semibold text-ink mb-1">Last Name *</label>
                                <input type="text" v-model="form.lastName" required placeholder="e.g. Cruz" 
                                       class="w-full px-3 py-2 border rounded-lg text-xs focus:ring-2 focus:ring-navy/20 focus:border-navy focus:outline-none transition"
                                       :class="errors.lastName ? 'border-danger bg-danger/5' : 'border-line bg-white'">
                                <p v-if="errors.lastName" class="text-[10px] text-danger mt-1 font-medium">{{ errors.lastName }}</p>
                            </div>

                            <div class="sm:col-span-2">
                                <label class="block text-xs font-semibold text-ink mb-1">Suffix</label>
                                <select v-model="form.suffix" class="w-full px-2 py-2 border border-line rounded-lg text-xs bg-white focus:ring-2 focus:ring-navy/20 focus:border-navy focus:outline-none">
                                    <option value="">None</option>
                                    <option value="Jr.">Jr.</option>
                                    <option value="Sr.">Sr.</option>
                                    <option value="III">III</option>
                                    <option value="IV">IV</option>
                                    <option value="V">V</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div>
                            <label class="block text-xs font-semibold text-ink mb-1">Employee ID *</label>
                            <input type="text" v-model="form.empId" required placeholder="e.g. EMP-2026-001" 
                                   class="w-full px-3 py-2 border rounded-lg text-xs focus:ring-2 focus:ring-navy/20 focus:border-navy focus:outline-none transition"
                                   :class="errors.empId ? 'border-danger bg-danger/5' : 'border-line bg-white'">
                            <p v-if="errors.empId" class="text-[10px] text-danger mt-1 font-medium">{{ errors.empId }}</p>
                        </div>
                        <div>
                            <label class="block text-xs font-semibold text-ink mb-1">Contact Phone (11 digits, starts 09)</label>
                            <input type="text" v-model="form.phone" placeholder="e.g. 09171234567" maxlength="11"
                                   class="w-full px-3 py-2 border rounded-lg text-xs focus:ring-2 focus:ring-navy/20 focus:border-navy focus:outline-none transition"
                                   :class="errors.phone ? 'border-danger bg-danger/5' : 'border-line bg-white'">
                            <p v-if="errors.phone" class="text-[10px] text-danger mt-1 font-medium">{{ errors.phone }}</p>
                        </div>
                    </div>

                    <div>
                        <label class="block text-xs font-semibold text-ink mb-1">Email Address *</label>
                        <input type="email" v-model="form.email" required placeholder="e.g. m.santos@ncst.edu.ph" 
                               class="w-full px-3 py-2 border rounded-lg text-xs focus:ring-2 focus:ring-navy/20 focus:border-navy focus:outline-none transition"
                               :class="errors.email ? 'border-danger bg-danger/5' : 'border-line bg-white'">
                        <p v-if="errors.email" class="text-[10px] text-danger mt-1 font-medium">{{ errors.email }}</p>
                    </div>

                    <!-- Category Selection -->
                    <div class="bg-page p-3 rounded-xl border border-line space-y-2">
                        <label class="block text-xs font-bold text-ink">Select S.A. Category *</label>
                        <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                            <label class="flex items-center space-x-2 bg-white p-2.5 border border-line rounded-lg cursor-pointer hover:border-info text-xs transition"
                                   :class="form.category === 'ITO' ? 'border-info ring-1 ring-info/20 bg-info/5' : ''">
                                <input type="radio" v-model="form.category" value="ITO" @change="onFormCategoryChange" class="text-info focus:ring-info">
                                <span class="font-bold text-info">ITO</span>
                            </label>
                            <label class="flex items-center space-x-2 bg-white p-2.5 border border-line rounded-lg cursor-pointer hover:border-purple-500 text-xs transition"
                                   :class="form.category === 'ACADS' ? 'border-purple-500 ring-1 ring-purple-500/20 bg-purple-50/50' : ''">
                                <input type="radio" v-model="form.category" value="ACADS" @change="onFormCategoryChange" class="text-purple-600 focus:ring-purple-500">
                                <span class="font-bold text-purple-700">ACADS</span>
                            </label>
                            <label class="flex items-center space-x-2 bg-white p-2.5 border border-line rounded-lg cursor-pointer hover:border-success text-xs transition"
                                   :class="form.category === 'OFFICES' ? 'border-success ring-1 ring-success/20 bg-success/5' : ''">
                                <input type="radio" v-model="form.category" value="OFFICES" @change="onFormCategoryChange" class="text-success focus:ring-success">
                                <span class="font-bold text-success">OFFICES</span>
                            </label>
                        </div>
                        <p class="text-[10px] text-muted italic">
                            <template v-if="form.category === 'ITO'">Includes all ITO Room/Lab S.A.s PLUS any specific Office/Department units selected below (e.g. ITO OFFICE, TOOLS ROOM).</template>
                            <template v-else-if="form.category === 'ACADS'">Includes all ACADS Room S.A.s PLUS any specific Office/Department units selected below (e.g. HRM BAR, ACAD OFFICE).</template>
                            <template v-else>OFFICES category allows choosing one or more specific campus office units below.</template>
                        </p>
                    </div>

                    <!-- Department Selection -->
                    <div>
                        <div class="flex items-center justify-between mb-1.5">
                            <label class="block text-xs font-semibold text-ink">Assigned Department / Unit * (Multiple selection allowed)</label>
                            <div class="flex items-center space-x-2 text-[11px]">
                                <button type="button" @click="selectAllDepts" class="text-info font-bold hover:underline">Select All</button>
                                <span class="text-muted">|</span>
                                <button type="button" @click="clearAllDepts" class="text-muted font-medium hover:underline">Clear All</button>
                            </div>
                        </div>

                        <!-- Category Scope Banner for ITO / ACADS -->
                        <div v-if="form.category === 'ITO'" class="mb-2 p-2.5 bg-info/10 border border-info/30 rounded-lg text-xs font-bold text-info flex items-center justify-between">
                            <span>ITO (All ITO Laboratories & Rooms)</span>
                            <span class="text-[10px] font-semibold">Included Automatically</span>
                        </div>
                        <div v-else-if="form.category === 'ACADS'" class="mb-2 p-2.5 bg-purple-50 border border-purple-200 rounded-lg text-xs font-bold text-purple-700 flex items-center justify-between">
                            <span>ACADS (All Academic Rooms & Labs)</span>
                            <span class="text-[10px] font-semibold">Included Automatically</span>
                        </div>

                        <!-- Multi-select Checkboxes Grid for Office / Department Units -->
                        <div class="border border-line rounded-xl p-3 bg-white space-y-2 max-h-48 overflow-y-auto touch-scroll table-scroll">
                            <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                                <label v-for="d in departments" :key="d" 
                                       @click.prevent="toggleFormDept(d)"
                                       class="flex items-center space-x-2 p-2 rounded-lg border text-[11px] font-medium cursor-pointer transition select-none"
                                       :class="form.depts.includes(d) ? 'border-navy bg-navy/5 text-navy font-bold shadow-xs' : 'border-line bg-page/40 text-ink hover:bg-mist'">
                                    <input type="checkbox" :checked="form.depts.includes(d)" class="rounded text-navy focus:ring-navy pointer-events-none">
                                    <span class="truncate">{{ d }}</span>
                                </label>
                            </div>
                        </div>

                        <!-- Selected Badges Summary -->
                        <div v-if="form.depts.length" class="mt-2.5 flex flex-wrap gap-1 items-center">
                            <span class="text-[11px] font-bold text-muted mr-1">Assigned Scope ({{ form.depts.length }}):</span>
                            <span v-for="d in form.depts" :key="'badge-'+d" 
                                  class="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full text-[10px] font-bold shadow-xs"
                                  :class="(d === 'ITO' || d === 'ACADS') ? 'bg-info text-white' : 'bg-navy text-white'">
                                <span>{{ d }}</span>
                                <button v-if="d !== 'ITO' && d !== 'ACADS'" type="button" @click.stop="toggleFormDept(d)" class="hover:text-gold ml-1 text-xs">×</button>
                            </span>
                        </div>
                    </div>

                    <div class="bg-success/10 border border-success/20 rounded-lg p-2.5 flex items-center justify-between">
                        <div class="flex items-center space-x-2">
                            <app-icon name="CircleCheck" :size="16" class="text-success" />
                            <span class="text-xs font-bold text-success">Status</span>
                        </div>
                        <span class="bg-success/20 text-success text-[10px] font-extrabold px-2.5 py-0.5 rounded-full uppercase tracking-wider">
                            DEFAULT: ACTIVE
                        </span>
                    </div>

                    <div class="pt-3 border-t border-line flex justify-end space-x-2">
                        <button type="button" @click="closeRegisterModal" 
                                class="px-4 py-2 border border-line text-ink hover:bg-page rounded-lg text-xs font-semibold transition">
                            Cancel
                        </button>
                        <button type="submit" :disabled="saving"
                                class="px-4 py-2 bg-navy hover:bg-navy-700 text-white rounded-lg text-xs font-semibold transition shadow-sm inline-flex items-center space-x-1.5 disabled:opacity-50">
                            <app-icon v-if="saving" name="LoaderCircle" :size="14" class="animate-spin" />
                            <span>{{ isEditMode ? 'Update Supervisor' : 'Save Supervisor' }}</span>
                        </button>
                    </div>
                </form>
            </div>
        </div>

        <!-- ================= Confirmation Modal ================= -->
        <div v-if="showConfirmModal" class="fixed inset-0 bg-navy/60 backdrop-blur-xs z-[60] flex items-center justify-center p-4">
            <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-line space-y-4">
                <div class="flex items-center space-x-3">
                    <div class="w-10 h-10 rounded-full bg-info/10 text-info flex items-center justify-center shrink-0">
                        <app-icon name="ShieldCheck" :size="22" />
                    </div>
                    <div>
                        <h3 class="font-bold text-sm text-navy">Confirm Save</h3>
                        <p class="text-xs text-muted">Are you sure you want to save this supervisor record?</p>
                    </div>
                </div>

                <div class="bg-page p-3.5 rounded-xl border border-line space-y-1.5 text-xs text-ink">
                    <div class="flex justify-between"><span class="text-muted font-medium">Name:</span> <span class="font-bold">{{ getFullName(form) }}</span></div>
                    <div class="flex justify-between"><span class="text-muted font-medium">Employee ID:</span> <span class="font-mono font-bold">{{ form.empId }}</span></div>
                    <div class="flex justify-between"><span class="text-muted font-medium">Category:</span> <span class="font-bold">{{ form.category }}</span></div>
                    <div class="flex justify-between"><span class="text-muted font-medium">Department:</span> <span class="font-bold">{{ form.dept }}</span></div>
                    <div class="flex justify-between"><span class="text-muted font-medium">Email:</span> <span>{{ form.email }}</span></div>
                    <div v-if="form.phone" class="flex justify-between"><span class="text-muted font-medium">Phone:</span> <span>{{ form.phone }}</span></div>
                </div>

                <div v-if="isEditMode">
                    <label class="field-label text-xs font-semibold text-navy">Reason for Editing Supervisor <span class="text-danger">*</span></label>
                    <textarea v-model="editReason" rows="2" maxlength="200"
                              class="input text-xs"
                              placeholder="Enter reason for editing supervisor details (no special characters)..."></textarea>
                </div>

                <div class="flex justify-end space-x-2 pt-2">
                    <button @click="showConfirmModal = false" class="px-4 py-2 border border-line text-ink hover:bg-page rounded-lg text-xs font-semibold transition">
                        Cancel
                    </button>
                    <button @click="confirmSave" :disabled="saving" class="px-4 py-2 bg-navy hover:bg-navy-700 text-white rounded-lg text-xs font-semibold transition shadow-sm inline-flex items-center space-x-1.5">
                        <app-icon v-if="saving" name="LoaderCircle" :size="14" class="animate-spin" />
                        <span>Yes, Save Supervisor</span>
                    </button>
                </div>
            </div>
        </div>

        <!-- ================= Modal: Account Credentials ================= -->
        <app-modal :open="isCredentialsModalOpen" 
                   title="Supervisor Account Credentials" 
                   description="Give these sign-in details to the supervisor privately. They must change their password the first time they sign in."
                   icon="KeyRound"
                   tone="navy"
                   @close="isCredentialsModalOpen = false">
            <credentials-panel v-if="createdCredentials" :credentials="createdCredentials" :name="createdSupervisorName" />
            <template #footer>
                <button type="button" @click="isCredentialsModalOpen = false" class="btn btn-primary">
                    Done
                </button>
            </template>
        </app-modal>

        <!-- ================= Modal: View Supervised S.A. List ================= -->
        <div v-if="isSaModalOpen" class="fixed inset-0 bg-navy/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
            <div class="bg-white rounded-xl shadow-2xl max-w-2xl w-full overflow-hidden border border-line">
                <div class="bg-navy px-5 py-4 text-white flex items-center justify-between">
                    <div>
                        <h3 class="font-bold text-sm">Supervised Student Assistants - {{ getFullName(viewingSupervisor) }}</h3>
                        <p class="text-[11px] text-white/70">Category: {{ viewingSupervisor?.category }} | Department: {{ viewingSupervisor?.dept }}</p>
                    </div>
                    <button @click="closeSaModal" class="text-white/70 hover:text-white transition">
                        <app-icon name="X" :size="20" />
                    </button>
                </div>

                <div class="p-5 max-h-96 overflow-y-auto">
                    <div class="flex justify-between items-center mb-3">
                        <span class="bg-info/10 text-info text-xs font-bold px-2.5 py-1 rounded-full">
                            {{ viewingSupervisor?.currentSa || 0 }} Assigned S.A.s
                        </span>
                    </div>

                    <div class="border border-line rounded-lg overflow-hidden">
                        <table class="w-full text-left border-collapse text-xs">
                            <thead class="bg-page border-b border-line font-semibold text-muted">
                                <tr>
                                    <th class="p-2.5">S.A. Name & ID</th>
                                    <th class="p-2.5">Category & Unit</th>
                                    <th class="p-2.5">Assigned Shift</th>
                                    <th class="p-2.5">Status</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-line">
                                <tr v-for="sa in supervisedSaList" :key="sa.id" class="hover:bg-mist/30">
                                    <td class="p-2.5">
                                        <div class="font-bold text-ink">{{ sa.name }}</div>
                                        <div class="text-[10px] text-muted font-mono">{{ sa.id }}</div>
                                    </td>
                                    <td class="p-2.5">
                                        <span class="font-semibold text-ink">{{ sa.category }}</span>
                                        <span class="text-muted block text-[10px]">{{ sa.dept }}</span>
                                    </td>
                                    <td class="p-2.5 font-medium text-ink">{{ sa.shift }}</td>
                                    <td class="p-2.5">
                                        <span class="bg-success/10 text-success text-[10px] font-bold px-2 py-0.5 rounded-full">ACTIVE</span>
                                    </td>
                                </tr>
                                <tr v-if="supervisedSaList.length === 0">
                                    <td colspan="4" class="p-4 text-center text-muted italic">No S.A.s currently assigned to this supervisor.</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="px-5 py-3 bg-page border-t border-line flex justify-end">
                    <button @click="closeSaModal" class="px-4 py-1.5 bg-navy text-white rounded-lg text-xs font-semibold hover:bg-navy-700 transition">Close</button>
                </div>
            </div>
        </div>

    </div>
    `
};
