// S.A. > My Profile: the signed-in S.A.'s own record, read-only, with tabs matching the Coordinator record view (including School balance).
const SaMyProfilePage = {
    components: { AppIcon, PageHeader, SaProfileView, SaDisciplinaryPanel },
    setup() {
        const route = VueRouter.useRoute();
        const sa = Vue.ref(null);
        const loading = Vue.ref(true);
        const loadError = Vue.ref("");
        const tab = Vue.ref(route.query.tab || "OVERVIEW");

        const tabs = [
            { value: "OVERVIEW", label: "Overview", icon: "LayoutDashboard" },
            { value: "BALANCE", label: "School balance", icon: "Wallet" },
            { value: "STUDENT", label: "Student information", icon: "User" },
            { value: "DEPLOYMENT", label: "Department & deployment", icon: "Building2" },
            { value: "CLASSES", label: "Class schedule", icon: "CalendarDays" },
            { value: "WARNINGS", label: "Warnings & Attendance", icon: "ShieldAlert" },
            { value: "ACCOUNT", label: "Account", icon: "KeyRound" }
        ];

        const sectionsFor = Vue.computed(() => ({
            STUDENT: ["personal", "academic"],
            DEPLOYMENT: ["assignment"],
            CLASSES: ["classes"],
            ACCOUNT: ["account"],
            BALANCE: ["benefits"]
        }[tab.value] || null));

        const load = async () => {
            loading.value = true;
            loadError.value = "";
            const r = await Model.request("sa", "me");
            loading.value = false;
            if (r.success) sa.value = r.sa;
            else loadError.value = r.message;
        };
        Vue.onMounted(load);

        // Profile Picture Upload
        const avatarPreview = Vue.ref(null);
        const avatarInputRef = Vue.ref(null);
        const avatarSaving = Vue.ref(false);
        const avatarError = Vue.ref('');
        const avatarSuccess = Vue.ref('');

        const triggerAvatarUpload = () => {
            avatarError.value = '';
            avatarSuccess.value = '';
            if (avatarInputRef.value) {
                avatarInputRef.value.click();
            }
        };

        const onAvatarFileSelected = (e) => {
            avatarError.value = '';
            avatarSuccess.value = '';
            const file = e.target.files?.[0];
            if (!file) return;

            const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
            if (!allowedMimes.includes(file.type)) {
                avatarError.value = 'Please select a valid JPG, PNG, or WebP image.';
                if (avatarInputRef.value) avatarInputRef.value.value = '';
                return;
            }

            if (file.size > 2 * 1024 * 1024) {
                avatarError.value = 'The selected image exceeds the maximum size of 2 MB.';
                if (avatarInputRef.value) avatarInputRef.value.value = '';
                return;
            }

            const reader = new FileReader();
            reader.onload = (loadEvt) => {
                avatarPreview.value = loadEvt.target.result;
            };
            reader.onerror = () => {
                avatarError.value = 'Could not read the selected image file.';
            };
            reader.readAsDataURL(file);
        };

        const cancelAvatarPreview = () => {
            avatarPreview.value = null;
            avatarError.value = '';
            if (avatarInputRef.value) avatarInputRef.value.value = '';
        };

        const saveAvatar = async () => {
            if (!avatarPreview.value) return;
            avatarSaving.value = true;
            avatarError.value = '';
            avatarSuccess.value = '';

            const r = await Model.request('settings', 'upload_avatar', { avatarData: avatarPreview.value });
            avatarSaving.value = false;

            if (r.success) {
                if (r.user && Store.user) {
                    Store.user.avatarUrl = r.user.avatarUrl;
                }
                avatarPreview.value = null;
                if (avatarInputRef.value) avatarInputRef.value.value = '';
                avatarSuccess.value = r.message || 'Profile picture updated successfully.';
                Store.toast('success', avatarSuccess.value);
            } else {
                avatarError.value = r.message || 'Could not update profile picture.';
            }
        };

        const removeAvatar = async () => {
            const confirmed = await Alerts.confirm({
                title: 'Remove Profile Picture?',
                html: 'Are you sure you want to remove your custom profile picture and revert to default initials?',
                icon: 'warning',
                confirmText: 'Remove Photo',
                cancelText: 'Cancel'
            });
            if (!confirmed) return;

            avatarSaving.value = true;
            avatarError.value = '';
            avatarSuccess.value = '';

            const r = await Model.request('settings', 'remove_avatar');
            avatarSaving.value = false;

            if (r.success) {
                if (Store.user) {
                    Store.user.avatarUrl = null;
                }
                avatarPreview.value = null;
                if (avatarInputRef.value) avatarInputRef.value.value = '';
                avatarSuccess.value = r.message || 'Profile picture removed successfully.';
                Store.toast('success', avatarSuccess.value);
            } else {
                avatarError.value = r.message || 'Could not remove profile picture.';
            }
        };

        const copiedSaNumber = Vue.ref(false);
        const copySaNumber = async (num) => {
            if (!num) return;
            try {
                await navigator.clipboard.writeText(num);
                copiedSaNumber.value = true;
                Store.toast("success", `Copied S.A. Number: ${num}`);
                setTimeout(() => { copiedSaNumber.value = false; }, 2000);
            } catch (e) {
                Store.toast("info", `S.A. Number: ${num}`);
            }
        };

        return {
            Store, sa, loading, loadError, load, tab, tabs, sectionsFor, Format, label,
            avatarPreview, avatarInputRef, avatarSaving, avatarError, avatarSuccess,
            triggerAvatarUpload, onAvatarFileSelected, cancelAvatarPreview, saveAvatar, removeAvatar,
            copiedSaNumber, copySaNumber
        };
    },
    template: `
    <page-header title="My Profile" subtitle="Your S.A. record, school balance, and benefits. To correct anything, contact the S.A. Coordinator.">
        <template #actions>
            <router-link to="/sa/school-balance" class="btn btn-primary btn-sm">
                <app-icon name="Wallet" :size="15" /> My School Balance
            </router-link>
            <router-link to="/change-password" class="btn btn-secondary btn-sm">
                <app-icon name="KeyRound" :size="15" /> Change password
            </router-link>
        </template>
    </page-header>

    <div v-if="loading" class="grid gap-5 lg:grid-cols-2" aria-busy="true">
        <div v-for="n in 4" :key="n" class="h-56 animate-pulse rounded-xl bg-white"></div>
    </div>
    <div v-else-if="loadError" class="card flex flex-col items-center px-6 py-12 text-center">
        <app-icon name="CircleX" :size="28" class="text-danger" />
        <p class="mt-3 text-body font-medium text-ink">Couldn't load your profile</p>
        <p class="mt-1 text-caption text-muted">{{ loadError }}</p>
        <button @click="load" class="btn btn-secondary btn-sm mt-4"><app-icon name="RefreshCw" :size="14" /> Try again</button>
    </div>
    <template v-else>
        <!-- Quick School Balance Banner on Profile -->
        <div v-if="sa.benefits" class="mb-5 rounded-xl border border-navy/20 bg-white p-4 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div class="flex items-start gap-3">
                <div class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-navy text-white">
                    <app-icon name="Wallet" :size="20" />
                </div>
                <div>
                    <div class="flex flex-wrap items-center gap-2">
                        <h3 class="text-body font-bold text-navy">
                            Estimated Remaining School Balance:
                            <span class="text-emerald-700">{{ sa.benefits.balance !== null ? Format.peso(sa.benefits.balance) : 'Not recorded' }}</span>
                        </h3>
                        <span class="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-800">
                            100% Tuition + 70% Misc Covered ({{ sa.benefits.totalCovered !== null ? Format.peso(sa.benefits.totalCovered) : '—' }})
                        </span>
                    </div>
                    <p class="text-caption text-muted mt-0.5">
                        Cash Assessment (Registrar COR): <strong class="text-ink">{{ sa.benefits.cashTotal !== null ? Format.peso(sa.benefits.cashTotal) : '—' }}</strong> ·
                        Allowance Rate: <strong class="text-ink">{{ Format.peso(sa.benefits.effectiveHourlyRate) }}/hr</strong>
                    </p>
                </div>
            </div>
            <button type="button" @click="tab = 'BALANCE'" class="btn btn-secondary btn-sm shrink-0">
                <app-icon name="Receipt" :size="14" /> View Full COR Breakdown
            </button>
        </div>

        <!-- Profile Picture Section -->
        <div class="card mb-5 p-5 sm:p-6">
            <div class="flex items-center gap-2 mb-4 border-b border-line pb-3">
                <app-icon name="Camera" :size="20" class="text-navy" />
                <div>
                    <h2 class="text-section-title text-navy">Profile Picture</h2>
                    <p class="text-caption text-muted">Upload a photo to personalize your AssistPay student assistant account.</p>
                </div>
            </div>

            <div v-if="avatarSuccess" class="mb-4 flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-caption text-emerald-800">
                <app-icon name="CheckCircle" :size="16" class="text-emerald-600 shrink-0" />
                <span>{{ avatarSuccess }}</span>
            </div>
            <div v-if="avatarError" class="mb-4 flex items-center gap-2 rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-caption text-rose-800">
                <app-icon name="CircleX" :size="16" class="text-rose-600 shrink-0" />
                <span>{{ avatarError }}</span>
            </div>

            <div class="flex flex-col gap-5 sm:flex-row sm:items-center">
                <!-- Circular Avatar Preview with Navy / Amber Border -->
                <div class="relative flex shrink-0 items-center justify-center">
                    <img v-if="avatarPreview" :src="avatarPreview" alt="Profile Preview"
                         class="h-28 w-28 rounded-full object-cover ring-4 ring-gold/80 shadow-md" />
                    <img v-else-if="Store.user?.avatarUrl" :src="Store.user.avatarUrl" :alt="Store.user.name"
                         class="h-28 w-28 rounded-full object-cover ring-4 ring-navy/20 shadow-md" />
                    <div v-else class="grid h-28 w-28 place-items-center rounded-full bg-navy text-2xl font-bold text-white ring-4 ring-navy/20 shadow-md">
                        {{ Store.initials }}
                    </div>

                    <span v-if="avatarPreview" class="absolute -bottom-1 -right-1 rounded-full bg-gold px-2 py-0.5 text-[10px] font-bold text-navy shadow">
                        Preview
                    </span>
                </div>

                <!-- Controls and Helper text -->
                <div class="flex-1 space-y-3">
                    <div>
                        <div class="flex flex-wrap items-center gap-2">
                            <h3 class="text-body font-bold text-ink">{{ sa.name }}</h3>
                            <span v-if="sa.saNumber" class="inline-flex items-center gap-1.5 rounded-md bg-navy/10 text-navy px-2.5 py-0.5 font-mono text-[12px] font-bold border border-navy/20">
                                <span>S.A. No: {{ sa.saNumber }}</span>
                                <button type="button" @click.stop="copySaNumber(sa.saNumber)" class="text-navy/70 hover:text-navy transition-colors" title="Copy S.A. Number">
                                    <app-icon :name="copiedSaNumber ? 'Check' : 'Copy'" :size="13" />
                                </button>
                            </span>
                        </div>
                        <p class="text-caption text-muted mt-0.5">
                            Student ID: <strong class="text-ink">{{ sa.studentId }}</strong> · {{ sa.course }} (Yr {{ sa.yearLevel }}) ·
                            <span class="text-navy font-semibold">{{ sa.office ? sa.office.name : label('saCategory', sa.saCategory) }}</span>
                        </p>
                    </div>

                    <!-- Hidden File Input -->
                    <input ref="avatarInputRef" type="file" accept="image/jpeg,image/png,image/webp" class="hidden" @change="onAvatarFileSelected" />

                    <div class="flex flex-wrap items-center gap-2.5">
                        <template v-if="avatarPreview">
                            <button type="button" @click="saveAvatar" :disabled="avatarSaving" class="btn btn-primary btn-sm">
                                <app-icon :name="avatarSaving ? 'LoaderCircle' : 'Check'" :size="15" :class="avatarSaving ? 'animate-spin' : ''" />
                                <span>{{ avatarSaving ? 'Saving...' : 'Save Photo' }}</span>
                            </button>
                            <button type="button" @click="cancelAvatarPreview" :disabled="avatarSaving" class="btn btn-secondary btn-sm">
                                <app-icon name="X" :size="15" />
                                <span>Cancel</span>
                            </button>
                        </template>
                        <template v-else>
                            <button v-if="Store.user?.avatarUrl" type="button" @click="triggerAvatarUpload" class="btn btn-secondary btn-sm">
                                <app-icon name="Camera" :size="15" />
                                <span>Change Photo</span>
                            </button>
                            <button v-else type="button" @click="triggerAvatarUpload" class="btn btn-primary btn-sm">
                                <app-icon name="Upload" :size="15" />
                                <span>Upload Photo</span>
                            </button>

                            <button v-if="Store.user?.avatarUrl" type="button" @click="removeAvatar" :disabled="avatarSaving"
                                    class="btn btn-secondary btn-sm text-rose-600 hover:bg-rose-50 hover:border-rose-200">
                                <app-icon name="Trash2" :size="15" />
                                <span>Remove Photo</span>
                            </button>
                        </template>
                    </div>
                </div>
            </div>
        </div>

        <!-- Appearance / Theme Card -->
        <div class="card mb-5 p-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div class="flex items-center gap-2.5">
                <app-icon :name="Store.isDark ? 'Moon' : 'Sun'" :size="19" class="text-navy shrink-0" />
                <div>
                    <h3 class="text-[13px] font-bold text-navy">Appearance &amp; Theme</h3>
                    <p class="text-[11px] text-muted">Choose Light or Dark theme.</p>
                </div>
            </div>
            <div class="grid grid-cols-2 gap-1.5 rounded-lg border border-line bg-page p-1 sm:w-auto">
                <button type="button" @click="Store.setTheme('light')"
                        class="inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-1.5 text-[12px] font-semibold transition-colors"
                        :class="Store.theme === 'light' ? 'bg-white text-navy shadow-sm' : 'text-muted hover:text-ink'">
                    <app-icon name="Sun" :size="13" /> Light
                </button>
                <button type="button" @click="Store.setTheme('dark')"
                        class="inline-flex items-center justify-center gap-1.5 rounded-md px-3.5 py-1.5 text-[12px] font-semibold transition-colors"
                        :class="Store.theme === 'dark' ? 'bg-white text-navy shadow-sm' : 'text-muted hover:text-ink'">
                    <app-icon name="Moon" :size="13" /> Dark
                </button>
            </div>
        </div>

        <!-- Tabs matching Coordinator SA Detail view -->
        <div class="mb-5 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
            <button v-for="t in tabs" :key="t.value" role="tab" :aria-selected="tab === t.value" @click="tab = t.value"
                    class="inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors duration-150"
                    :class="tab === t.value ? 'border-navy text-navy' : 'border-transparent text-muted hover:text-ink'">
                <app-icon :name="t.icon" :size="15" /> {{ t.label }}
            </button>
        </div>

        <template v-if="tab === 'WARNINGS'">
            <sa-disciplinary-panel :sa-profile-id="sa.id" :can-manage="false" :is-sa-owner="true" />
        </template>
        <template v-else-if="tab === 'OVERVIEW'">
            <div class="space-y-5">
                <sa-profile-view :sa="sa" mode="self" :only="['benefits', 'personal', 'academic', 'assignment', 'account', 'classes']" />
                <sa-disciplinary-panel :sa-profile-id="sa.id" :can-manage="false" :is-sa-owner="true" />
            </div>
        </template>
        <template v-else>
            <sa-profile-view :sa="sa" mode="self" :only="sectionsFor" />
        </template>
    </template>
    `
};
