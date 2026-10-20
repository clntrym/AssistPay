// Admin Settings (S.A. Coordinator Account, System Rules & Attendance Violation Configuration)
const AdminSettingsPage = {
    components: { AppIcon, PageHeader, FormField, AppModal },

    setup() {
        const loading = Vue.ref(true);
        const loadError = Vue.ref('');

        // 1. Account Profile
        const profileForm = Vue.reactive({
            firstName: '',
            middleName: '',
            lastName: '',
            suffix: '',
            email: '',
            username: '',
            role: ''
        });
        const profileSaving = Vue.ref(false);

        const parseName = (fullName) => {
            if (!fullName) return { firstName: '', middleName: '', lastName: '', suffix: '' };
            const parts = fullName.trim().split(/\s+/);
            const suffixes = ['jr', 'jr.', 'sr', 'sr.', 'iii', 'iv', 'v', 'ii', 'i'];
            let suffix = '';
            if (parts.length > 1 && suffixes.includes(parts[parts.length - 1].toLowerCase())) {
                suffix = parts.pop();
            }
            const lastName = parts.length > 1 ? parts.pop() : '';
            const firstName = parts.length > 0 ? parts.shift() : '';
            const middleName = parts.join(' ');
            return { firstName, middleName, lastName, suffix };
        };

        // 2. Security / Password
        const passwordForm = Vue.reactive({
            currentPassword: '',
            newPassword: '',
            confirmPassword: ''
        });
        const passwordSaving = Vue.ref(false);
        const showCurrentPw = Vue.ref(false);
        const showNewPw = Vue.ref(false);
        const showConfirmPw = Vue.ref(false);

        // 3. System Rules & Benefits
        const settingsForm = Vue.reactive({
            tuitionDiscountPct: 100,
            miscDiscountPct: 30,
            minWeeklyDutyHours: 35,
            maxWeeklyDutyHours: 50,
            defaultRequiredSa: 80,
            defaultHourlyRate: 8.00,
            excuseSlipGraceDays: 2,
            overtimeGraceDays: 2,
            sms_provider: 'ANDROID_GATEWAY',
            android_gateway_url: 'http://192.168.1.50:8080',
            android_gateway_user: '',
            android_gateway_pass: '',
            textbee_api_key: '',
            textbee_device_id: '',
            semaphore_api_key: 'd344578926adb485d0c8f4ccab1118d7',
            semaphore_sender_name: '',
            gemini_api_key: ''
        });
        const settingsSaving = Vue.ref(false);

        // 4. Attendance Violation & Disciplinary Settings (Semester-specific)
        const semesters = Vue.ref([]);
        const selectedSemesterId = Vue.ref(0);
        const violationRows = Vue.ref([]);
        const escalationMode = Vue.ref('CONTINUE_ACROSS_SEMESTERS');
        const violationReason = Vue.ref('');
        const violationHistory = Vue.ref([]);
        const showViolationHistory = Vue.ref(false);
        const violationSaving = Vue.ref(false);

        const load = async (semId = null) => {
            loading.value = true;
            loadError.value = '';
            const payload = semId ? { semesterId: semId } : {};
            const r = await Model.request('settings', 'get', payload);
            loading.value = false;

            if (!r.success) {
                loadError.value = r.message || "Could not load settings.";
                return;
            }

            if (r.user) {
                const parsed = parseName(r.user.fullName);
                profileForm.firstName = parsed.firstName;
                profileForm.middleName = parsed.middleName;
                profileForm.lastName = parsed.lastName;
                profileForm.suffix = parsed.suffix;
                profileForm.email = r.user.email || '';
                profileForm.username = r.user.username || '';
                profileForm.role = r.user.role || 'ADMIN';
            }

            if (r.settings) {
                Object.assign(settingsForm, r.settings);
            }

            semesters.value = r.semesters || [];
            selectedSemesterId.value = r.semesterId || (semesters.value[0]?.id ?? 0);
            violationRows.value = (r.violationSettings || []).map(item => ({ ...item }));
            escalationMode.value = r.escalationMode || 'CONTINUE_ACROSS_SEMESTERS';
            violationHistory.value = r.violationHistory || [];
        };

        Vue.onMounted(() => load());

        const onViolationSemesterChange = async () => {
            const r = await Model.request('violations', 'get_settings', { semesterId: selectedSemesterId.value });
            if (r.success) {
                violationRows.value = (r.settings || []).map(item => ({ ...item }));
                escalationMode.value = r.escalationMode || 'CONTINUE_ACROSS_SEMESTERS';
                violationHistory.value = r.history || [];
            }
        };

        const restoreDefaultChances = () => {
            const defaults = { LATES: 6, EXCUSE_SLIP: 6, AWOL: 2, NTI_NTO: 2, UNDERTIME: 3 };
            violationRows.value.forEach(row => {
                if (defaults[row.category] !== undefined) {
                    row.allowedChances = defaults[row.category];
                }
            });
            Store.toast('info', 'Default allowed chances restored in form. Click Save Attendance Violation Settings to apply.');
        };

        const saveViolationConfig = async () => {
            for (const row of violationRows.value) {
                if (row.allowedChances === '' || row.allowedChances === null || isNaN(row.allowedChances) || !Number.isInteger(Number(row.allowedChances))) {
                    Alerts.error('Validation', `${row.label} allowed chances must be a whole number.`);
                    return;
                }
                const val = Number(row.allowedChances);
                if (val < 0 || val > 50) {
                    Alerts.error('Validation', `${row.label} allowed chances must be between 0 and 50.`);
                    return;
                }
            }

            const categoriesPayload = {};
            violationRows.value.forEach(row => {
                categoriesPayload[row.category] = {
                    allowedChances: Number(row.allowedChances),
                    policyReference: row.policyReference
                };
            });

            violationSaving.value = true;
            const r = await Model.request('settings', 'save_violation_settings', {
                semesterId: selectedSemesterId.value,
                categories: categoriesPayload,
                escalationMode: escalationMode.value,
                reason: violationReason.value.trim() || 'Updated via SA Coordinator Settings'
            });
            violationSaving.value = false;

            if (!r.success) {
                Alerts.error('Could not save violation settings', r.message);
                return;
            }
            violationRows.value = (r.violationSettings || []).map(item => ({ ...item }));
            escalationMode.value = r.escalationMode || escalationMode.value;
            violationHistory.value = r.violationHistory || [];
            violationReason.value = '';
            await Alerts.success("Settings Saved", "Attendance violation settings and disciplinary policy saved successfully.");
        };

        // ---------- Save Profile ----------
        const saveProfile = async () => {
            if (!profileForm.firstName.trim()) {
                Alerts.error('Validation', 'First name is required.');
                return;
            }
            if (!profileForm.lastName.trim()) {
                Alerts.error('Validation', 'Last name is required.');
                return;
            }

            const fullName = [profileForm.firstName.trim(), profileForm.middleName.trim(), profileForm.lastName.trim(), profileForm.suffix.trim()].filter(Boolean).join(' ');

            const confirmed = await Alerts.confirm({
                title: 'Save Profile Changes?',
                html: `Update coordinator name to <b>${Alerts.esc(fullName)}</b>?`,
                icon: 'question',
                confirmText: 'Save Profile',
                cancelText: 'Cancel'
            });
            if (!confirmed) return;

            profileSaving.value = true;
            const r = await Model.request('auth', 'update_profile', {
                firstName: profileForm.firstName.trim(),
                middleName: profileForm.middleName.trim(),
                lastName: profileForm.lastName.trim(),
                suffix: profileForm.suffix.trim(),
                fullName,
                email: profileForm.email.trim()
            });
            profileSaving.value = false;

            if (r.success) {
                await Alerts.success("Profile Saved", "Profile updated successfully.");
                if (r.user) Store.user = r.user;
            } else {
                Alerts.error('Could not update profile', r.message);
            }
        };

        // ---------- Change Password ----------
        const changePassword = async () => {
            if (!passwordForm.currentPassword) {
                Alerts.error('Validation', 'Enter your current password.');
                return;
            }
            if (!passwordForm.newPassword) {
                Alerts.error('Validation', 'Enter a new password.');
                return;
            }
            if (passwordForm.newPassword.length < 8) {
                Alerts.error('Validation', 'New password must be at least 8 characters long.');
                return;
            }
            if (passwordForm.newPassword !== passwordForm.confirmPassword) {
                Alerts.error('Validation', 'New password and confirmation do not match.');
                return;
            }

            const confirmed = await Alerts.confirm({
                title: 'Change Password?',
                html: 'Are you sure you want to update your sign-in password?',
                icon: 'warning',
                confirmText: 'Update Password',
                cancelText: 'Cancel'
            });
            if (!confirmed) return;

            passwordSaving.value = true;
            const r = await Model.request('auth', 'change_password', {
                currentPassword: passwordForm.currentPassword,
                newPassword: passwordForm.newPassword,
                confirmPassword: passwordForm.confirmPassword
            });
            passwordSaving.value = false;

            if (r.success) {
                await Alerts.success("Password Updated", "Password updated successfully.");
                passwordForm.currentPassword = '';
                passwordForm.newPassword = '';
                passwordForm.confirmPassword = '';
                if (r.csrfToken) Store.csrfToken = r.csrfToken;
            } else {
                Alerts.error('Could not update password', r.message);
            }
        };

        // ---------- Save System Settings ----------
        const saveSettings = async () => {
            if (settingsForm.tuitionDiscountPct < 0 || settingsForm.tuitionDiscountPct > 100) {
                Alerts.error('Validation', 'Tuition discount must be between 0% and 100%.');
                return;
            }
            if (settingsForm.miscDiscountPct < 0 || settingsForm.miscDiscountPct > 100) {
                Alerts.error('Validation', 'Miscellaneous discount must be between 0% and 100%.');
                return;
            }
            if (settingsForm.minWeeklyDutyHours < 1) {
                Alerts.error('Validation', 'Minimum weekly duty hours must be at least 1 hour.');
                return;
            }
            if (settingsForm.maxWeeklyDutyHours > 168) {
                Alerts.error('Validation', 'Maximum weekly duty hours cannot exceed 168 hours.');
                return;
            }
            if (settingsForm.minWeeklyDutyHours > settingsForm.maxWeeklyDutyHours) {
                Alerts.error('Validation', 'Minimum duty hours cannot exceed maximum duty hours.');
                return;
            }
            if (settingsForm.defaultRequiredSa < 1) {
                Alerts.error('Validation', 'Default required S.A. count must be at least 1.');
                return;
            }
            if (!Number.isInteger(Number(settingsForm.defaultHourlyRate)) || String(settingsForm.defaultHourlyRate).trim().includes('.')) {
                Alerts.error('Validation', 'Default allowance rate must be a whole number (decimals like 9.5 or 9.25 are not allowed).');
                return;
            }
            if (settingsForm.defaultHourlyRate < 8) {
                Alerts.error('Validation', 'Allowance rate cannot be below ₱8.00/hr.');
                return;
            }
            if (settingsForm.excuseSlipGraceDays === '' || settingsForm.excuseSlipGraceDays === null || isNaN(settingsForm.excuseSlipGraceDays) || settingsForm.excuseSlipGraceDays < 0 || settingsForm.excuseSlipGraceDays > 14) {
                Alerts.error('Validation', 'Excuse Slip filing grace period must be a whole number between 0 and 14 days.');
                return;
            }
            if (settingsForm.overtimeGraceDays === '' || settingsForm.overtimeGraceDays === null || isNaN(settingsForm.overtimeGraceDays) || settingsForm.overtimeGraceDays < 0 || settingsForm.overtimeGraceDays > 14) {
                Alerts.error('Validation', 'Overtime filing grace period must be a whole number between 0 and 14 days.');
                return;
            }

            const confirmed = await Alerts.confirm({
                title: 'Save System Settings?',
                html: `<div class="text-left text-xs space-y-1 mt-1">
                    <p>• Tuition Coverage: <b>${settingsForm.tuitionDiscountPct}%</b></p>
                    <p>• Misc Fee Coverage: <b>${settingsForm.miscDiscountPct}%</b></p>
                    <p>• Weekly Duty Limits: <b>${settingsForm.minWeeklyDutyHours} to ${settingsForm.maxWeeklyDutyHours} hrs/week</b></p>
                    <p>• Default Required S.A.s: <b>${settingsForm.defaultRequiredSa} S.A.s</b></p>
                    <p>• Default Rate: <b>₱${Number(settingsForm.defaultHourlyRate).toFixed(2)}/hr</b></p>
                    <p>• Excuse Slip Grace Period: <b>${settingsForm.excuseSlipGraceDays} calendar day(s)</b></p>
                    <p>• Overtime Grace Period: <b>${settingsForm.overtimeGraceDays} calendar day(s)</b></p>
                </div>`,
                icon: 'question',
                confirmText: 'Save Settings',
                cancelText: 'Cancel'
            });
            if (!confirmed) return;

            settingsSaving.value = true;
            const r = await Model.request('settings', 'save_system_settings', { ...settingsForm });
            settingsSaving.value = false;

            if (r.success) {
                await Alerts.success("Settings Saved", "System settings saved successfully.");
                if (r.settings) Object.assign(settingsForm, r.settings);
            } else {
                Alerts.error('Could not save settings', r.message);
            }
        };

        // ---------- SMS Gateway Connection Test ----------
        const testPhone = Vue.ref('');
        const testSending = Vue.ref(false);
        const testResult = Vue.ref(null);

        const testSmsConnection = async () => {
            const cleanPhone = (testPhone.value || '').trim();
            if (!cleanPhone) {
                Alerts.error('Missing Phone Number', 'Please enter a mobile number (e.g. 09123456789) to test.');
                return;
            }
            testSending.value = true;
            testResult.value = null;
            try {
                const r = await Model.request('settings', 'test_sms_connection', {
                    phone: cleanPhone,
                    provider: settingsForm.sms_provider,
                    androidGatewayUrl: settingsForm.android_gateway_url,
                    androidGatewayUser: settingsForm.android_gateway_user,
                    androidGatewayPass: settingsForm.android_gateway_pass
                });
                testSending.value = false;
                testResult.value = r;
                if (r.success) {
                    Alerts.success('SMS Sent Successfully!', r.message);
                } else {
                    Alerts.error('SMS Gateway Connection Error', r.message);
                }
            } catch (err) {
                testSending.value = false;
                Alerts.error('Connection Error', 'Failed to communicate with SMS test endpoint.');
            }
        };

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

        return {
            Store, loading, loadError, profileForm, profileSaving,
            passwordForm, passwordSaving, showCurrentPw, showNewPw, showConfirmPw,
            settingsForm, settingsSaving,
            testPhone, testSending, testResult, testSmsConnection,
            semesters, selectedSemesterId, violationRows, escalationMode,
            violationReason, violationHistory, showViolationHistory, violationSaving,
            load, onViolationSemesterChange, restoreDefaultChances, saveViolationConfig,
            saveProfile, changePassword, saveSettings, Format,
            avatarPreview, avatarInputRef, avatarSaving, avatarError, avatarSuccess,
            triggerAvatarUpload, onAvatarFileSelected, cancelAvatarPreview, saveAvatar, removeAvatar
        };
    },

    template: `
    <div>
        <page-header title="Settings" section="S.A. Management"
                     subtitle="Configure Coordinator profile, security, attendance violation thresholds, warning policy, S.A. fee discount rules, and weekly duty hour limits." />

        <div v-if="loading" class="card space-y-4 p-6" aria-busy="true">
            <div v-for="n in 4" :key="n" class="h-12 animate-pulse rounded-lg bg-page"></div>
        </div>

        <div v-else-if="loadError" class="card flex flex-col items-center px-6 py-12 text-center">
            <app-icon name="CircleX" :size="28" class="text-danger" />
            <p class="mt-3 text-body font-medium text-ink">Couldn't load settings</p>
            <p class="mt-1 text-caption text-muted">{{ loadError }}</p>
            <button @click="load()" class="btn btn-secondary btn-sm mt-4">
                <app-icon name="RefreshCw" :size="14" /> Try again
            </button>
        </div>

        <div v-else class="space-y-6">

            <!-- 0. PROFILE PICTURE -->
            <div class="card p-5 sm:p-6">
                <div class="flex items-center gap-2 mb-4 border-b border-line pb-3">
                    <app-icon name="Camera" :size="20" class="text-navy" />
                    <div>
                        <h2 class="text-section-title text-navy">Profile Picture</h2>
                        <p class="text-caption text-muted">Upload a photo to personalize your AssistPay account.</p>
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
                            <h3 class="text-body font-bold text-ink">Personal Avatar</h3>
                            <p class="text-caption text-muted mt-0.5">
                                Upload a JPG, PNG, or WebP image. Maximum file size: 2 MB.
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

            <!-- 1. APPEARANCE / DARK MODE -->
            <div class="card p-5 sm:p-6">
                <div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                    <div class="flex items-start gap-2.5">
                        <app-icon :name="Store.isDark ? 'Moon' : 'Sun'" :size="22" class="mt-0.5 text-navy shrink-0" />
                        <div>
                            <h2 class="text-section-title text-navy">Appearance &amp; Color Scheme</h2>
                            <p class="text-caption text-muted">
                                Choose between Light or Dark color scheme.
                            </p>
                        </div>
                    </div>
                    <div class="grid grid-cols-2 gap-2 rounded-xl border border-line bg-page p-1.5 sm:w-auto">
                        <button type="button" @click="Store.setTheme('light')"
                                class="inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold transition-colors"
                                :class="Store.theme === 'light' ? 'bg-white text-navy shadow-sm' : 'text-muted hover:text-ink'">
                            <app-icon name="Sun" :size="15" /> Light
                        </button>
                        <button type="button" @click="Store.setTheme('dark')"
                                class="inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-[13px] font-semibold transition-colors"
                                :class="Store.theme === 'dark' ? 'bg-white text-navy shadow-sm' : 'text-muted hover:text-ink'">
                            <app-icon name="Moon" :size="15" /> Dark
                        </button>
                    </div>
                </div>
            </div>

            <!-- 1. ATTENDANCE VIOLATION & DISCIPLINARY WARNING SETTINGS -->
            <div class="card p-5 sm:p-6">
                <div class="flex flex-col justify-between gap-3 border-b border-line pb-4 lg:flex-row lg:items-center">
                    <div class="flex items-start gap-2.5">
                        <app-icon name="ShieldAlert" :size="22" class="mt-0.5 text-navy shrink-0" />
                        <div>
                            <h2 class="text-section-title text-navy">Attendance Violation &amp; Disciplinary Warning Settings</h2>
                            <p class="text-caption text-muted">
                                Configure the allowed chances per violation category for the selected semester. Exceeding the allowed chances triggers First, Second, or Third Warning evaluation and official Memo generation.
                            </p>
                        </div>
                    </div>

                    <div class="flex flex-wrap items-center gap-2">
                        <label class="text-[12px] font-semibold text-muted">Semester:</label>
                        <select v-model="selectedSemesterId" @change="onViolationSemesterChange"
                                class="input w-auto py-1.5 text-[13px]" aria-label="Select semester for violation limits">
                            <option v-for="s in semesters" :key="s.id" :value="s.id">
                                {{ s.label }} {{ s.status === 'ACTIVE' ? '(Active)' : '' }}
                            </option>
                        </select>
                        <button type="button" @click="restoreDefaultChances" class="btn btn-secondary btn-sm">
                            <app-icon name="RotateCcw" :size="14" /> Restore Defaults
                        </button>
                    </div>
                </div>

                <!-- Configurable Violation Categories Table -->
                <div class="mt-4 overflow-x-auto rounded-xl border border-line">
                    <table class="w-full min-w-[780px] text-left text-[13px]">
                        <thead class="bg-page text-caption font-semibold text-muted">
                            <tr>
                                <th class="px-4 py-3">Violation Category</th>
                                <th class="px-4 py-3 text-center">Default Allowed Chances</th>
                                <th class="px-4 py-3 w-[170px]">Allowed Chances (Semester)</th>
                                <th class="px-4 py-3">Applicable Institutional Policy / Rule</th>
                                <th class="px-4 py-3">Last Updated</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-line">
                            <tr v-for="row in violationRows" :key="row.category" class="hover:bg-mist/30">
                                <td class="px-4 py-3">
                                    <span class="font-bold text-navy">{{ row.label }}</span>
                                    <span class="mt-0.5 block text-[11px] text-muted">{{ row.description }}</span>
                                </td>
                                <td class="px-4 py-3 text-center">
                                    <span v-if="row.category === 'UNDERTIME'"
                                          class="inline-flex items-center rounded-full bg-gold/25 px-2.5 py-0.5 text-[11px] font-bold text-navy">
                                        Configurable ({{ row.defaultChances }})
                                    </span>
                                    <span v-else class="inline-flex items-center rounded-full bg-mist px-2.5 py-0.5 text-[12px] font-bold text-navy">
                                        {{ row.defaultChances }}
                                    </span>
                                </td>
                                <td class="px-4 py-3">
                                    <input v-model.number="row.allowedChances" type="number" min="0" max="50" step="1"
                                           class="input py-1.5 text-center font-bold text-navy"
                                           :aria-label="row.label + ' allowed chances'" />
                                </td>
                                <td class="px-4 py-3">
                                    <input v-model="row.policyReference" type="text" maxlength="160"
                                           class="input py-1.5 text-[12px]"
                                           placeholder="Applicable handbook / policy provision" />
                                </td>
                                <td class="px-4 py-3 text-[12px] text-muted">
                                    <span class="font-medium text-ink">{{ row.updatedByName || 'System Default' }}</span>
                                    <span v-if="row.updatedAt" class="block text-[11px]">{{ Format.dateTime(row.updatedAt) }}</span>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <!-- Cross-Semester Warning Escalation & Change Reason -->
                <div class="mt-4 grid gap-4 rounded-xl border border-line bg-page/50 p-4 sm:grid-cols-2">
                    <div>
                        <label class="field-label">Semester Reset &amp; Warning Escalation Policy</label>
                        <select v-model="escalationMode" class="input text-[13px]">
                            <option value="CONTINUE_ACROSS_SEMESTERS">
                                Reset violation counts each semester; continue warning level escalation across semesters
                            </option>
                            <option value="RESET_PER_SEMESTER">
                                Reset violation counts AND warning level sequence at the start of each new semester
                            </option>
                        </select>
                        <p class="mt-1 text-[11px] text-muted">
                            In both modes, semester-specific attendance violation counts and chances reset at the start of a new semester, while all historical warnings, memos, and Under Agreement records are permanently preserved.
                        </p>
                    </div>

                    <div>
                        <label class="field-label">Configuration Change Reason (Recorded in Audit History)</label>
                        <input v-model="violationReason" type="text" maxlength="200" class="input text-[13px]"
                               placeholder="e.g. Adjusted Undertime threshold per approved S.A. Committee resolution" />
                        <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
                            <button type="button" @click="showViolationHistory = !showViolationHistory"
                                    class="btn btn-secondary btn-sm">
                                <app-icon name="History" :size="14" />
                                {{ showViolationHistory ? 'Hide Change History' : 'Configuration History (' + violationHistory.length + ')' }}
                            </button>
                            <button type="button" @click="saveViolationConfig" :disabled="violationSaving"
                                    class="btn btn-primary btn-sm">
                                <app-icon :name="violationSaving ? 'LoaderCircle' : 'Save'" :size="14" :class="violationSaving ? 'animate-spin' : ''" />
                                {{ violationSaving ? 'Saving...' : 'Save Attendance Violation Settings' }}
                            </button>
                        </div>
                    </div>
                </div>

                <!-- Configuration Change History Table -->
                <div v-if="showViolationHistory" class="mt-4 border-t border-line pt-4">
                    <h3 class="mb-2 text-[13px] font-bold text-navy">Attendance Violation Settings Change History</h3>
                    <div v-if="!violationHistory.length" class="rounded-lg border border-dashed border-line py-6 text-center text-caption text-muted">
                        No configuration changes recorded for this semester yet.
                    </div>
                    <div v-else class="overflow-x-auto rounded-lg border border-line">
                        <table class="w-full text-left text-[12px]">
                            <thead class="bg-page font-semibold text-muted">
                                <tr>
                                    <th class="px-3 py-2">Date &amp; Time</th>
                                    <th class="px-3 py-2">Updated By</th>
                                    <th class="px-3 py-2">Category / Setting</th>
                                    <th class="px-3 py-2">Previous Value</th>
                                    <th class="px-3 py-2">New Value</th>
                                    <th class="px-3 py-2">Reason</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-line">
                                <tr v-for="h in violationHistory" :key="h.id">
                                    <td class="whitespace-nowrap px-3 py-2 text-muted">{{ Format.dateTime(h.changedAt) }}</td>
                                    <td class="px-3 py-2 font-medium text-ink">{{ h.changedByName }}</td>
                                    <td class="px-3 py-2 font-semibold text-navy">{{ h.categoryLabel }}</td>
                                    <td class="px-3 py-2 font-mono text-muted">{{ h.oldAllowedChances ?? '—' }}</td>
                                    <td class="px-3 py-2 font-mono font-bold text-navy">{{ h.newAllowedChances }}</td>
                                    <td class="px-3 py-2 text-muted">{{ h.changeReason || '—' }}</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <!-- 3. ACCOUNT PROFILE & SECURITY -->
            <div class="grid gap-6 lg:grid-cols-2">

                <!-- Account Information -->
                <div class="card p-5 sm:p-6 flex flex-col justify-between">
                    <div>
                        <div class="flex items-center gap-2 mb-4 border-b border-line pb-3">
                            <app-icon name="User" :size="20" class="text-navy" />
                            <div>
                                <h2 class="text-section-title text-navy">Coordinator Profile</h2>
                                <p class="text-caption text-muted">Your account contact information.</p>
                            </div>
                        </div>

                        <form @submit.prevent="saveProfile" class="space-y-4">
                            <div class="grid grid-cols-2 gap-3">
                                <form-field label="First Name" required v-slot="f">
                                    <input :id="f.id" v-model="profileForm.firstName" type="text" class="input" placeholder="Liza" maxlength="60">
                                </form-field>
                                <form-field label="Middle Name" v-slot="f">
                                    <input :id="f.id" v-model="profileForm.middleName" type="text" class="input" placeholder="Santos" maxlength="60">
                                </form-field>
                            </div>

                            <div class="grid grid-cols-3 gap-3">
                                <form-field label="Last Name" required class="col-span-2" v-slot="f">
                                    <input :id="f.id" v-model="profileForm.lastName" type="text" class="input" placeholder="Mendoza" maxlength="60">
                                </form-field>
                                <form-field label="Suffix" v-slot="f">
                                    <input :id="f.id" v-model="profileForm.suffix" type="text" class="input" placeholder="Jr." maxlength="10">
                                </form-field>
                            </div>

                            <form-field label="School Email" hint="Used for system notifications." v-slot="f">
                                <input :id="f.id" v-model="profileForm.email" type="email" class="input" placeholder="liza.mendoza@ncst.edu.ph" maxlength="150">
                            </form-field>

                            <div class="grid grid-cols-2 gap-4">
                                <form-field label="Username" hint="Read-only" v-slot="f">
                                    <input :id="f.id" :value="profileForm.username" type="text" class="input bg-gray-50 font-semibold" readonly>
                                </form-field>

                                <form-field label="Role" hint="Access level" v-slot="f">
                                    <input :id="f.id" value="S.A. Coordinator" type="text" class="input bg-gray-50 font-semibold text-navy" readonly>
                                </form-field>
                            </div>

                            <div class="pt-2 flex justify-end">
                                <button type="submit" :disabled="profileSaving" class="btn btn-primary">
                                    <app-icon :name="profileSaving ? 'LoaderCircle' : 'Save'" :size="16" :class="profileSaving ? 'animate-spin' : ''" />
                                    {{ profileSaving ? 'Saving...' : 'Save Profile' }}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>

                <!-- Password Change -->
                <div class="card p-5 sm:p-6 flex flex-col justify-between">
                    <div>
                        <div class="flex items-center gap-2 mb-4 border-b border-line pb-3">
                            <app-icon name="Lock" :size="20" class="text-navy" />
                            <div>
                                <h2 class="text-section-title text-navy">Change Password</h2>
                                <p class="text-caption text-muted">Keep your account secure with a strong password.</p>
                            </div>
                        </div>

                        <form @submit.prevent="changePassword" class="space-y-4">
                            <form-field label="Current Password" required v-slot="f">
                                <div class="relative">
                                    <input :id="f.id" v-model="passwordForm.currentPassword" :type="showCurrentPw ? 'text' : 'password'" class="input pr-10" placeholder="••••••••">
                                    <button type="button" @click="showCurrentPw = !showCurrentPw" class="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-navy">
                                        <app-icon :name="showCurrentPw ? 'EyeOff' : 'Eye'" :size="16" />
                                    </button>
                                </div>
                            </form-field>

                            <form-field label="New Password" required hint="At least 8 characters." v-slot="f">
                                <div class="relative">
                                    <input :id="f.id" v-model="passwordForm.newPassword" :type="showNewPw ? 'text' : 'password'" class="input pr-10" placeholder="••••••••">
                                    <button type="button" @click="showNewPw = !showNewPw" class="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-navy">
                                        <app-icon :name="showNewPw ? 'EyeOff' : 'Eye'" :size="16" />
                                    </button>
                                </div>
                            </form-field>

                            <form-field label="Confirm New Password" required v-slot="f">
                                <div class="relative">
                                    <input :id="f.id" v-model="passwordForm.confirmPassword" :type="showConfirmPw ? 'text' : 'password'" class="input pr-10" placeholder="••••••••">
                                    <button type="button" @click="showConfirmPw = !showConfirmPw" class="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-navy">
                                        <app-icon :name="showConfirmPw ? 'EyeOff' : 'Eye'" :size="16" />
                                    </button>
                                </div>
                            </form-field>

                            <div class="pt-2 flex justify-end">
                                <button type="submit" :disabled="passwordSaving" class="btn btn-primary">
                                    <app-icon :name="passwordSaving ? 'LoaderCircle' : 'KeyRound'" :size="16" :class="passwordSaving ? 'animate-spin' : ''" />
                                    {{ passwordSaving ? 'Updating...' : 'Update Password' }}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>

            </div>

            <!-- 3. S.A. FEE BENEFITS & DISCOUNTS -->
            <div class="card p-5 sm:p-6">
                <div class="flex items-center gap-2 mb-4 border-b border-line pb-3">
                    <app-icon name="Wallet" :size="20" class="text-navy" />
                    <div>
                        <h2 class="text-section-title text-navy">S.A. Fee Benefits &amp; Discounts</h2>
                        <p class="text-caption text-muted">Set default percentage discounts for Student Assistant tuition and fees.</p>
                    </div>
                </div>

                <div class="grid gap-4 sm:grid-cols-3">
                    <form-field label="Tuition Fee Discount (%)" required hint="Default 100% tuition coverage for S.A.s." v-slot="f">
                        <div class="relative">
                            <input :id="f.id" v-model.number="settingsForm.tuitionDiscountPct" type="number" min="0" max="100" class="input pr-8" placeholder="100">
                            <span class="absolute right-3 top-1/2 -translate-y-1/2 font-semibold text-muted text-xs">%</span>
                        </div>
                    </form-field>

                    <form-field label="Miscellaneous Fee Discount (%)" required hint="Default 30% miscellaneous fee coverage." v-slot="f">
                        <div class="relative">
                            <input :id="f.id" v-model.number="settingsForm.miscDiscountPct" type="number" min="0" max="100" class="input pr-8" placeholder="30">
                            <span class="absolute right-3 top-1/2 -translate-y-1/2 font-semibold text-muted text-xs">%</span>
                        </div>
                    </form-field>

                    <form-field label="Default Allowance Rate (₱/hr)" required hint="Whole numbers only (min ₱8/hr). The Coordinator can adjust this default or set custom rates per S.A." v-slot="f">
                        <div class="relative">
                            <span class="absolute left-3 top-1/2 -translate-y-1/2 font-semibold text-muted text-xs">₱</span>
                            <input :id="f.id" v-model.number="settingsForm.defaultHourlyRate" type="number" min="8" max="1000" step="1" class="input pl-8" placeholder="8">
                        </div>
                    </form-field>
                </div>

                <div class="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800 flex items-start gap-2">
                    <app-icon name="Info" :size="16" class="shrink-0 mt-0.5" />
                    <span><b>Fee Discount Note:</b> S.A.s automatically receive <b>100% Tuition Discount</b> and <b>30% Miscellaneous Fee Discount</b> based on these global rules.</span>
                </div>
            </div>

            <!-- 4. DUTY HOUR LIMITS & RULES -->
            <div class="card p-5 sm:p-6">
                <div class="flex items-center gap-2 mb-4 border-b border-line pb-3">
                    <app-icon name="Clock" :size="20" class="text-navy" />
                    <div>
                        <h2 class="text-section-title text-navy">Duty Hour Limits &amp; Allocation Rules</h2>
                        <p class="text-caption text-muted">Set required duty hour thresholds for S.A. scheduling.</p>
                    </div>
                </div>

                <div class="grid gap-4 sm:grid-cols-2">
                    <form-field label="Minimum Required Duty Hours" required hint="Minimum duty hours required for each S.A. per week." v-slot="f">
                        <div class="relative">
                            <input :id="f.id" v-model.number="settingsForm.minWeeklyDutyHours" type="number" min="1" max="168" class="input pr-16" placeholder="35">
                            <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted">hrs/week</span>
                        </div>
                    </form-field>

                    <form-field label="Maximum Allowed Duty Hours" required hint="Maximum duty hours allowed for each S.A. per week." v-slot="f">
                        <div class="relative">
                            <input :id="f.id" v-model.number="settingsForm.maxWeeklyDutyHours" type="number" min="1" max="168" class="input pr-16" placeholder="50">
                            <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted">hrs/week</span>
                        </div>
                    </form-field>
                </div>

                <div class="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-start gap-2">
                    <app-icon name="ShieldAlert" :size="16" class="shrink-0 mt-0.5 text-amber-600" />
                    <div>
                        <p class="font-bold">Weekly Duty Load Policy:</p>
                        <p class="mt-0.5">The weekly duty load of S.A.s is dynamically based on the minimum and maximum settings configured here for partner matching, room duty distribution, and validation.</p>
                    </div>
                </div>
            </div>

            <!-- 5. REQUIRED S.A. HEADCOUNT TARGET -->
            <div class="card p-5 sm:p-6">
                <div class="flex items-center justify-between border-b border-line pb-3 mb-4 flex-wrap gap-2">
                    <div class="flex items-center gap-2">
                        <app-icon name="Users" :size="20" class="text-navy" />
                        <div>
                            <h2 class="text-section-title text-navy">Required S.A. Headcount Target</h2>
                            <p class="text-caption text-muted">Set global default headcount requirement &amp; sync with Semester Setup.</p>
                        </div>
                    </div>
                    <router-link to="/admin/scheduling/semester-setup" class="btn btn-secondary btn-sm">
                        <app-icon name="CalendarCog" :size="14" /> Manage in Semester Setup →
                    </router-link>
                </div>

                <div class="grid gap-4 sm:grid-cols-2">
                    <form-field label="Default Required S.A. Headcount Target" required hint="Default total S.A. requirement for new semesters." v-slot="f">
                        <div class="relative">
                            <input :id="f.id" v-model.number="settingsForm.defaultRequiredSa" type="number" min="1" max="500" class="input pr-16" placeholder="80">
                            <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted">S.A.s</span>
                        </div>
                    </form-field>

                    <div class="flex flex-col justify-center p-3 bg-mist rounded-lg border border-line text-xs space-y-1">
                        <span class="font-semibold text-navy">Semester Setup Integration:</span>
                        <p class="text-muted">You can customize the required S.A. headcount for each specific semester term (e.g. 50, 80, 100 S.A.s) directly inside the <b>Semester Setup</b> page.</p>
                    </div>
                </div>
            </div>

            <!-- 6. REQUEST FILING GRACE PERIODS -->
            <div class="card p-5 sm:p-6">
                <div class="flex items-center gap-2 mb-4 border-b border-line pb-3">
                    <app-icon name="Clock" :size="20" class="text-navy" />
                    <div>
                        <h2 class="text-section-title text-navy">Request Filing Grace Periods</h2>
                        <p class="text-caption text-muted">Configure the allowed calendar-day grace window after attendance cutoffs for Excuse Slips and Overtime requests.</p>
                    </div>
                </div>

                <div class="grid gap-4 sm:grid-cols-2">
                    <form-field label="Excuse Slip Filing Grace Period" required hint="Default: 2 calendar days. Allowed filing window after cutoff end date (0 to 14 days)." v-slot="f">
                        <div class="relative">
                            <input :id="f.id" v-model.number="settingsForm.excuseSlipGraceDays" type="number" min="0" max="14" class="input pr-28" placeholder="2">
                            <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted">calendar days</span>
                        </div>
                    </form-field>

                    <form-field label="Overtime Filing Grace Period" required hint="Default: 2 calendar days. Allowed filing window after cutoff end date (0 to 14 days)." v-slot="f">
                        <div class="relative">
                            <input :id="f.id" v-model.number="settingsForm.overtimeGraceDays" type="number" min="0" max="14" class="input pr-28" placeholder="2">
                            <span class="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted">calendar days</span>
                        </div>
                    </form-field>
                </div>

                <div class="mt-4 p-3 bg-sky-50 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-800 rounded-lg text-xs text-sky-900 dark:text-sky-200 flex items-start gap-2">
                    <app-icon name="Info" :size="16" class="shrink-0 mt-0.5 text-sky-600" />
                    <div>
                        <p class="font-bold">Cutoff Deadline Calculation (Asia/Manila):</p>
                        <p class="mt-0.5">
                            For example, for the cutoff covering <b>October 16–31</b> with a <b>{{ settingsForm.excuseSlipGraceDays ?? 2 }}-calendar-day grace period</b>, the final deadline to file is <b>November 2 at 11:59:59 PM Philippine time</b>. At exactly <b>November 3 at 12:00:00 AM</b>, the standard filing window closes and submissions are blocked.
                        </p>
                    </div>
                </div>
            </div>

            <!-- 7. SMS GATEWAY & NOTIFICATION SETTINGS -->
            <div class="card p-5 sm:p-6">
                <div class="flex items-center gap-2 mb-4 border-b border-line pb-3">
                    <app-icon name="Smartphone" :size="20" class="text-navy" />
                    <div>
                        <h2 class="text-section-title text-navy">SMS Gateway &amp; Attendance Alerts</h2>
                        <p class="text-caption text-muted">Configure automatic SMS dispatch for S.A. attendance status (Present, Late, Undertime, Overtime, Absent).</p>
                    </div>
                </div>

                <!-- Provider Selector -->
                <div class="space-y-4">
                    <form-field label="SMS Gateway Provider" required hint="Select the delivery method for sending SMS to Student Assistants." v-slot="f">
                        <select :id="f.id" v-model="settingsForm.sms_provider" class="input font-semibold text-navy">
                            <option value="ANDROID_GATEWAY">📱 Android SMS Gateway (100% FREE using SIM with Unlimited SMS Promo)</option>
                            <option value="SEMAPHORE">🌐 Semaphore SMS API (semaphore.co)</option>
                            <option value="TEXTBEE">🐝 TextBee Gateway (Cloud-Paired Android SIM via textbee.dev)</option>
                        </select>
                    </form-field>

                    <!-- Android SMS Gateway Details -->
                    <div v-if="settingsForm.sms_provider === 'ANDROID_GATEWAY'" class="p-4 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-950/20 space-y-4">
                        <div class="flex items-start gap-2.5">
                            <span class="text-xl">📱</span>
                            <div>
                                <h3 class="text-sm font-bold text-emerald-900 dark:text-emerald-200">Android SMS Gateway (Local Wi-Fi / Hotspot Mode)</h3>
                                <p class="text-xs text-emerald-800/90 dark:text-emerald-300/80 mt-0.5">
                                    Connect your Android phone to the same Wi-Fi network or use the phone's Mobile Hotspot. The phone dispatches SMS directly using your SIM card's unlimited SMS promo without API fees!
                                </p>
                            </div>
                        </div>

                        <div class="grid gap-3 sm:grid-cols-3">
                            <form-field label="Android Phone IP / URL" required hint="Example: http://192.168.1.50:8080" v-slot="f" class="sm:col-span-2">
                                <input :id="f.id" v-model="settingsForm.android_gateway_url" type="text" class="input font-mono text-sm" placeholder="http://192.168.1.50:8080">
                            </form-field>
                            <form-field label="Port / Endpoint" hint="Default: 8080" v-slot="f">
                                <input :id="f.id" value="Local REST /message" class="input bg-gray-100 text-xs font-mono" readonly>
                            </form-field>
                        </div>

                        <div class="grid gap-3 sm:grid-cols-2">
                            <form-field label="App Username (Optional)" hint="If a username was configured in the Android app." v-slot="f">
                                <input :id="f.id" v-model="settingsForm.android_gateway_user" type="text" class="input text-sm" placeholder="admin">
                            </form-field>
                            <form-field label="App Password (Optional)" hint="If a password was configured in the Android app." v-slot="f">
                                <input :id="f.id" v-model="settingsForm.android_gateway_pass" type="password" class="input text-sm" placeholder="••••••••">
                            </form-field>
                        </div>

                        <!-- Step-by-Step Instructions Box -->
                        <div class="p-3 rounded-lg bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-800/60 text-xs text-slate-700 dark:text-slate-300 space-y-1.5">
                            <p class="font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-1.5">
                                <app-icon name="HelpCircle" :size="14" />
                                <span>How to set up (Quick Setup):</span>
                            </p>
                            <ol class="list-decimal pl-5 space-y-1 text-[11px] leading-relaxed">
                                <li>Download the free <strong>Android SMS Gateway</strong> app on your Android phone (from Play Store or GitHub: <code>capcom6/android-sms-gateway</code> or <code>SMS Gateway</code>).</li>
                                <li>Ensure the phone's SIM card is active with an <strong>Unlimited SMS Promo</strong> (Smart, Globe, Dito, TNT).</li>
                                <li>Connect the PC/Laptop and Phone to the <strong>same Wi-Fi network</strong>, or enable the phone's <strong>Hotspot</strong> and connect the PC to it.</li>
                                <li>Tap <strong>Start Server</strong> in the Android app. The IP address will appear there (e.g. <code>http://192.168.1.100:8080</code>). Paste it into the field above and click Test Send SMS!</li>
                            </ol>
                        </div>
                    </div>

                    <!-- Semaphore Details -->
                    <div v-else-if="settingsForm.sms_provider === 'SEMAPHORE'" class="p-4 rounded-xl border border-sky-300 dark:border-sky-800 bg-sky-50/50 dark:bg-sky-950/20 space-y-3">
                        <div class="flex items-start gap-2.5">
                            <span class="text-xl">🌐</span>
                            <div>
                                <h3 class="text-sm font-bold text-sky-900 dark:text-sky-200">Semaphore Cloud SMS Gateway (semaphore.co)</h3>
                                <p class="text-xs text-sky-800/90 dark:text-sky-300/80 mt-0.5">
                                    Requires an approved account and active SMS credits at semaphore.co.
                                </p>
                            </div>
                        </div>

                        <div class="grid gap-3 sm:grid-cols-2">
                            <form-field label="Semaphore API Key" required v-slot="f">
                                <input :id="f.id" v-model="settingsForm.semaphore_api_key" type="text" class="input font-mono text-sm" placeholder="d344578926adb485d0c8f4ccab1118d7">
                            </form-field>
                            <form-field label="Sender Name (Optional)" hint="Leave blank to use default sender" v-slot="f">
                                <input :id="f.id" v-model="settingsForm.semaphore_sender_name" type="text" class="input text-sm" placeholder="SEMAPHORE">
                            </form-field>
                        </div>
                    </div>

                    <!-- TextBee Details -->
                    <div v-else-if="settingsForm.sms_provider === 'TEXTBEE'" class="p-4 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 space-y-3">
                        <div class="flex items-start gap-2.5">
                            <span class="text-xl">🐝</span>
                            <div>
                                <h3 class="text-sm font-bold text-amber-900 dark:text-amber-200">TextBee Cloud-Paired Android Gateway (textbee.dev)</h3>
                                <p class="text-xs text-amber-800/90 dark:text-amber-300/80 mt-0.5">
                                    Pair your Android phone with textbee.dev using the QR code. Works even if your laptop and phone are on different Wi-Fi networks.
                                </p>
                            </div>
                        </div>

                        <div class="grid gap-3 sm:grid-cols-2">
                            <form-field label="TextBee API Key" required v-slot="f">
                                <input :id="f.id" v-model="settingsForm.textbee_api_key" type="text" class="input font-mono text-sm" placeholder="API Key from textbee.dev">
                            </form-field>
                            <form-field label="Device ID (Optional)" v-slot="f">
                                <input :id="f.id" v-model="settingsForm.textbee_device_id" type="text" class="input text-sm" placeholder="Device ID">
                            </form-field>
                        </div>
                    </div>

                    <!-- Live Test Connection Bar -->
                    <div class="p-3.5 rounded-xl border border-line bg-page flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                        <div class="flex items-center gap-2 flex-1">
                            <app-icon name="Send" :size="16" class="text-navy shrink-0" />
                            <input v-model="testPhone" type="text" maxlength="15" class="input py-1.5 text-xs font-mono max-w-[220px]" placeholder="Test number (09xxxxxxxxx)" />
                            <span class="text-[11px] text-muted hidden sm:inline">Test if SMS messages are delivered to the mobile phone before saving.</span>
                        </div>
                        <button type="button" @click="testSmsConnection" :disabled="testSending" class="btn btn-secondary btn-sm shrink-0">
                            <app-icon :name="testSending ? 'LoaderCircle' : 'Send'" :size="14" :class="testSending ? 'animate-spin' : ''" />
                            <span>{{ testSending ? 'Sending Test SMS...' : 'Test Send SMS' }}</span>
                        </button>
                    </div>
                </div>
            </div>

            <!-- Save Action Bar -->
            <div class="flex justify-end gap-3 rounded-xl border border-line bg-card p-4 shadow-card">
                <button type="button" @click="saveSettings" :disabled="settingsSaving" class="btn btn-primary">
                    <app-icon :name="settingsSaving ? 'LoaderCircle' : 'Save'" :size="16" :class="settingsSaving ? 'animate-spin' : ''" />
                    {{ settingsSaving ? 'Saving Settings...' : 'Save All System Settings' }}
                </button>
            </div>

        </div>
    </div>
    `
};
