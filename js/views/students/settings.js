const RegistrarSettingsPage = {
    components: { AppIcon, PageHeader, FormField },

    setup() {
        const profileForm = Vue.reactive({
            fullName: '',
            email: '',
            username: '',
            role: ''
        });
        const passwordForm = Vue.reactive({
            currentPassword: '',
            newPassword: '',
            confirmPassword: ''
        });
        const profileSaving = Vue.ref(false);
        const passwordSaving = Vue.ref(false);
        const showCurrentPw = Vue.ref(false);
        const showNewPw = Vue.ref(false);
        const showConfirmPw = Vue.ref(false);
        const lastLogin = Vue.ref('');
        const passwordChanged = Vue.ref('');

        const roleTitle = Vue.computed(() => {
            const role = (Store.user?.role || profileForm.role || '').toUpperCase();
            if (role === 'SUPERVISOR') return 'Supervisor Profile';
            if (role === 'REGISTRAR') return 'Registrar Profile';
            if (role === 'ADMIN') return 'Coordinator Profile';
            if (role === 'SA') return 'Student Assistant Profile';
            return 'Profile Information';
        });

        const roleBadge = Vue.computed(() => {
            const role = (Store.user?.role || profileForm.role || '').toUpperCase();
            if (role === 'SUPERVISOR') return 'Supervisor';
            if (role === 'REGISTRAR') return 'Registrar';
            if (role === 'ADMIN') return 'S.A. Coordinator';
            if (role === 'SA') return 'Student Assistant';
            return role || 'User';
        });

        const supervisorScope = Vue.computed(() => {
            if (Store.user?.office?.name) return Store.user.office.name;
            if (Store.user?.supervisorCategory) return Store.user.supervisorCategory;
            return null;
        });

        Vue.onMounted(() => {
            if (Store.user) {
                profileForm.fullName = Store.user.fullName || Store.user.name || '';
                profileForm.email = Store.user.email || '';
                profileForm.username = Store.user.username || '';
                profileForm.role = Store.user.role || '';
                lastLogin.value = Store.user.lastLoginAt || '';
                passwordChanged.value = Store.user.passwordChangedAt || '';
            }
        });

        const saveProfile = async () => {
            if (!profileForm.fullName.trim()) {
                Alerts.error('Validation', 'Full name is required.');
                return;
            }

            const confirmed = await Alerts.confirm({
                title: 'Save Profile Changes?',
                html: `Update your account name to <b>${Alerts.esc(profileForm.fullName.trim())}</b>?`,
                icon: 'question',
                confirmText: 'Save Profile',
                cancelText: 'Cancel'
            });
            if (!confirmed) return;

            profileSaving.value = true;
            const r = await Model.request('auth', 'update_profile', {
                fullName: profileForm.fullName.trim(),
                email: profileForm.email.trim()
            });
            profileSaving.value = false;
            if (r.success) {
                Store.toast('success', 'Profile updated successfully.');
                if (r.user) {
                    Store.user = r.user;
                }
            } else {
                Alerts.error('Could not update profile', r.message);
            }
        };

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
                Alerts.error('Validation', 'Password must be at least 8 characters long.');
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
                Store.toast('success', 'Password changed successfully.');
                passwordForm.currentPassword = '';
                passwordForm.newPassword = '';
                passwordForm.confirmPassword = '';
                if (r.csrfToken) Store.csrfToken = r.csrfToken;
            } else {
                Alerts.error('Could not update password', r.message);
            }
        };

        const fmtDate = d => {
            if (!d) return 'Never';
            const dt = new Date(d);
            return dt.toLocaleDateString('en-PH', { month: 'short', day: '2-digit', year: 'numeric' })
                + ' ' + dt.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', hour12: true });
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
            Store,
            profileForm, passwordForm, profileSaving, passwordSaving,
            showCurrentPw, showNewPw, showConfirmPw,
            lastLogin, passwordChanged,
            roleTitle, roleBadge, supervisorScope,
            saveProfile, changePassword, fmtDate,
            avatarPreview, avatarInputRef, avatarSaving, avatarError, avatarSuccess,
            triggerAvatarUpload, onAvatarFileSelected, cancelAvatarPreview, saveAvatar, removeAvatar
        };
    },

    template: `
    <div>
        <page-header title="Settings" subtitle="Manage your account profile, appearance theme, and security credentials." section="Account" />

        <!-- 1. Profile Picture Card -->
        <div class="card mb-6 p-5 sm:p-6">
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

        <!-- 2. Appearance / Theme Card -->
        <div class="card mb-6 p-5 sm:p-6">
            <div class="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div class="flex items-start gap-3">
                    <div class="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-mist text-navy">
                        <app-icon :name="Store.isDark ? 'Moon' : 'Sun'" :size="20" />
                    </div>
                    <div>
                        <h2 class="text-section-title text-navy">Appearance &amp; Color Scheme</h2>
                        <p class="text-caption text-muted">Customize the interface mode: Light or Dark.</p>
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

        <div class="grid items-start gap-6 lg:grid-cols-2">

            <!-- 3. Profile Information Card -->
            <div class="card p-5 sm:p-6">
                <div>
                    <div class="flex items-center gap-2 mb-5 border-b border-line pb-3">
                        <app-icon name="User" :size="20" class="text-navy" />
                        <div>
                            <h2 class="text-section-title text-navy">{{ roleTitle }}</h2>
                            <p class="text-caption text-muted">Your account contact information and assigned details.</p>
                        </div>
                    </div>

                    <!-- User Header Badge -->
                    <div class="flex items-center gap-4 p-4 mb-5 rounded-xl border border-line bg-page/50">
                        <img v-if="Store.user?.avatarUrl" :src="Store.user.avatarUrl" :alt="Store.user.name"
                             class="h-14 w-14 shrink-0 rounded-full object-cover ring-2 ring-navy/20 shadow-sm" />
                        <span v-else class="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-navy text-white text-xl font-bold shadow-sm">
                            {{ (profileForm.fullName || 'U').charAt(0).toUpperCase() }}
                        </span>
                        <div class="min-w-0 flex-1">
                            <p class="font-bold text-ink text-[16px] truncate">{{ profileForm.fullName || 'User' }}</p>
                            <div class="flex flex-wrap items-center gap-2 mt-1">
                                <span class="inline-flex items-center rounded-full bg-navy/10 px-2.5 py-0.5 text-[11px] font-bold text-navy">
                                    {{ roleBadge }}
                                </span>
                                <span v-if="supervisorScope" class="inline-flex items-center rounded-full bg-mist px-2.5 py-0.5 text-[11px] font-semibold text-navy">
                                    {{ supervisorScope }}
                                </span>
                                <span class="text-[12px] text-muted">@{{ profileForm.username }}</span>
                            </div>
                        </div>
                    </div>

                    <form @submit.prevent="saveProfile" class="space-y-4">
                        <form-field label="Full Name" required v-slot="f">
                            <input :id="f.id" v-model="profileForm.fullName" type="text" class="input" placeholder="Your full name" maxlength="120" />
                        </form-field>

                        <form-field label="Email Address" hint="Used for official notifications and correspondence." v-slot="f">
                            <input :id="f.id" v-model="profileForm.email" type="email" class="input" placeholder="supervisor@ncst.edu.ph" maxlength="150" />
                        </form-field>

                        <div class="grid grid-cols-2 gap-4">
                            <form-field label="Employee / Username ID" hint="Read-only identifier" v-slot="f">
                                <input :id="f.id" :value="profileForm.username" type="text" class="input font-semibold" readonly disabled />
                            </form-field>

                            <form-field label="Assigned Role" hint="Access level" v-slot="f">
                                <input :id="f.id" :value="roleBadge" type="text" class="input font-semibold text-navy" readonly disabled />
                            </form-field>
                        </div>

                        <div class="pt-3 flex justify-end">
                            <button type="submit" :disabled="profileSaving" class="btn btn-primary">
                                <app-icon :name="profileSaving ? 'LoaderCircle' : 'Save'" :size="16" :class="profileSaving ? 'animate-spin' : ''" />
                                <span>{{ profileSaving ? 'Saving...' : 'Save Profile' }}</span>
                            </button>
                        </div>
                    </form>
                </div>
            </div>

            <!-- 3. Security Settings & Account Info Column -->
            <div class="space-y-6">

                <!-- Change Password Card -->
                <div class="card p-5 sm:p-6">
                    <div>
                        <div class="flex items-center gap-2 mb-5 border-b border-line pb-3">
                            <app-icon name="Lock" :size="20" class="text-navy" />
                            <div>
                                <h2 class="text-section-title text-navy">Change Password</h2>
                                <p class="text-caption text-muted">Keep your account secure with a strong password.</p>
                            </div>
                        </div>

                        <form @submit.prevent="changePassword" class="space-y-4">
                            <form-field label="Current Password" required v-slot="f">
                                <div class="relative">
                                    <input :id="f.id" v-model="passwordForm.currentPassword" :type="showCurrentPw ? 'text' : 'password'" class="input pr-10" placeholder="••••••••" autocomplete="current-password" />
                                    <button @click="showCurrentPw = !showCurrentPw" type="button" class="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-navy transition-colors">
                                        <app-icon :name="showCurrentPw ? 'EyeOff' : 'Eye'" :size="16" />
                                    </button>
                                </div>
                            </form-field>

                            <form-field label="New Password" required hint="At least 8 characters long." v-slot="f">
                                <div class="relative">
                                    <input :id="f.id" v-model="passwordForm.newPassword" :type="showNewPw ? 'text' : 'password'" class="input pr-10" placeholder="••••••••" autocomplete="new-password" />
                                    <button @click="showNewPw = !showNewPw" type="button" class="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-navy transition-colors">
                                        <app-icon :name="showNewPw ? 'EyeOff' : 'Eye'" :size="16" />
                                    </button>
                                </div>
                            </form-field>

                            <form-field label="Confirm New Password" required v-slot="f">
                                <div class="relative">
                                    <input :id="f.id" v-model="passwordForm.confirmPassword" :type="showConfirmPw ? 'text' : 'password'" class="input pr-10" placeholder="••••••••" autocomplete="new-password" />
                                    <button @click="showConfirmPw = !showConfirmPw" type="button" class="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-navy transition-colors">
                                        <app-icon :name="showConfirmPw ? 'EyeOff' : 'Eye'" :size="16" />
                                    </button>
                                </div>
                                <p v-if="passwordForm.confirmPassword && passwordForm.newPassword !== passwordForm.confirmPassword" class="mt-1.5 flex items-center gap-1.5 text-caption text-danger">
                                    <app-icon name="CircleX" :size="14" /> Passwords do not match.
                                </p>
                            </form-field>

                            <div class="pt-3 flex justify-end">
                                <button type="submit" :disabled="passwordSaving" class="btn btn-primary">
                                    <app-icon :name="passwordSaving ? 'LoaderCircle' : 'KeyRound'" :size="16" :class="passwordSaving ? 'animate-spin' : ''" />
                                    <span>{{ passwordSaving ? 'Updating...' : 'Update Password' }}</span>
                                </button>
                            </div>
                        </form>
                    </div>
                </div>

                <!-- Account Info Card -->
                <div class="card p-5 sm:p-6">
                    <div class="flex items-center gap-2 mb-4 border-b border-line pb-3">
                        <app-icon name="ShieldCheck" :size="20" class="text-navy" />
                        <div>
                            <h2 class="text-section-title text-navy">Account Information</h2>
                            <p class="text-caption text-muted">Audit and sign-in status for this account.</p>
                        </div>
                    </div>
                    <div class="divide-y divide-line text-[13px]">
                        <div class="flex items-center justify-between py-2.5">
                            <span class="text-muted flex items-center gap-2">
                                <app-icon name="Clock" :size="14" /> Last Login
                            </span>
                            <span class="font-semibold text-ink">{{ fmtDate(lastLogin) }}</span>
                        </div>
                        <div class="flex items-center justify-between py-2.5">
                            <span class="text-muted flex items-center gap-2">
                                <app-icon name="KeyRound" :size="14" /> Password Last Changed
                            </span>
                            <span class="font-semibold text-ink">{{ fmtDate(passwordChanged) }}</span>
                        </div>
                        <div class="flex items-center justify-between py-2.5">
                            <span class="text-muted flex items-center gap-2">
                                <app-icon name="CheckCircle2" :size="14" /> Account Status
                            </span>
                            <span class="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700">
                                <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span> Active
                            </span>
                        </div>
                    </div>
                </div>

            </div>
        </div>
    </div>
    `
};
