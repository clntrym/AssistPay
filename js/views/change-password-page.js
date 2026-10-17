// Change password, in two modes:
//  - Required: first sign-in with a temporary password. Full-screen, nothing else
//    is reachable until it's done (the API enforces this too).
//  - Normal: from the profile menu, inside the usual layout.
const ChangePasswordPage = {
    components: { AppIcon, PageHeader, PasswordField },

    setup() {
        const router = VueRouter.useRouter();
        const required = Vue.computed(() => !!Store.user?.mustChangePassword);

        const form = Vue.reactive({ currentPassword: "", newPassword: "", confirmPassword: "" });
        const errors = Vue.reactive({ currentPassword: "", newPassword: "", confirmPassword: "" });
        const formError = Vue.ref("");
        const saving = Vue.ref(false);

        // Clear a field's error as soon as the person edits it
        for (const field of Object.keys(form)) {
            Vue.watch(() => form[field], () => { errors[field] = ""; });
        }

        // Live hints only; the server applies the full policy (incl. common passwords)
        const rules = Vue.computed(() => {
            const pw = form.newPassword.toLowerCase();
            const u = Store.user;
            const personal = [u.username, ...u.name.split(/\s+/)]
                .map(s => s.toLowerCase()).filter(s => s.length >= 3);
            return [
                { label: "At least 12 characters", ok: [...form.newPassword].length >= 12 },
                { label: "Doesn't include your username or name", ok: pw.length > 0 && !personal.some(p => pw.includes(p)) },
                { label: "Both new passwords match", ok: form.confirmPassword.length > 0 && form.newPassword === form.confirmPassword }
            ];
        });

        const clearErrors = () => {
            Object.keys(errors).forEach(k => { errors[k] = ""; });
            formError.value = "";
        };

        const submit = async () => {
            clearErrors();
            if (!form.currentPassword) errors.currentPassword = required.value ? "Enter your temporary password." : "Enter your current password.";
            if (!form.newPassword) errors.newPassword = "Enter a new password.";
            if (!form.confirmPassword) errors.confirmPassword = "Enter the new password again.";
            if (Object.values(errors).some(Boolean)) return;

            saving.value = true;
            const r = await Model.changePassword({ ...form });
            saving.value = false;

            if (!r.success) {
                if (r.field && r.field in errors) errors[r.field] = r.message;
                else formError.value = r.message;
                if (r.field === "currentPassword") form.currentPassword = "";
                return;
            }

            Object.keys(form).forEach(k => { form[k] = ""; });
            Store.toast("success", r.message);
            router.replace(Store.home);
        };

        const signOut = async () => {
            const ok = typeof Alerts !== "undefined"
                ? await Alerts.confirm({
                    title: "Sign Out",
                    text: "Are you sure you want to sign out of AssistPay?",
                    confirmText: "Yes, Sign Out",
                    cancelText: "Cancel",
                    icon: "question",
                    danger: true,
                    requireReason: false
                })
                : window.confirm("Are you sure you want to log out?");

            if (!ok) return;
            await Model.logout();
            router.replace("/login");
            if (typeof Swal !== "undefined") {
                Swal.fire({
                    icon: "success",
                    title: "Signed Out",
                    text: "You have been successfully logged out.",
                    timer: 1400,
                    showConfirmButton: false,
                    customClass: { popup: "rounded-xl font-sans" }
                });
            }
        };

        return { Store, required, form, errors, formError, saving, rules, submit, signOut };
    },

    template: `
    <!-- REQUIRED (first sign-in) -->
    <div v-if="required" class="flex min-h-full items-start justify-center bg-page px-4 py-8 sm:items-center sm:py-12">
        <div class="w-full max-w-[440px]">
            <div class="mb-6 flex items-center justify-between gap-3">
                <div class="flex items-center gap-3">
                    <img src="assets/logo-96.png" alt="NCST Student Assistant logo" class="h-11 w-11 rounded-full">
                    <div class="leading-tight">
                        <p class="text-[17px] font-bold tracking-wide text-navy">ASSISTPAY</p>
                        <p class="text-[11px] font-medium tracking-wide text-muted">NCST S.A. SYSTEM</p>
                    </div>
                </div>
                <button type="button" @click="Store.toggleTheme()"
                        :aria-label="Store.isDark ? 'Switch to light theme' : 'Switch to dark theme'"
                        class="inline-flex items-center gap-1.5 rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12px] font-semibold text-navy hover:bg-mist">
                    <app-icon :name="Store.isDark ? 'Moon' : 'Sun'" :size="15" :class="Store.isDark ? 'text-gold' : 'text-amber-500'" />
                    <span>{{ Store.isDark ? 'Dark' : 'Light' }}</span>
                </button>
            </div>

            <section class="rounded-xl border border-line bg-white p-6 shadow-card sm:p-8">
                <span class="inline-flex items-center gap-1.5 rounded-full bg-gold/15 px-2.5 py-0.5 text-caption font-semibold text-navy">
                    <app-icon name="KeyRound" :size="13" /> First sign-in
                </span>
                <h1 class="mt-3 text-[24px] font-bold leading-tight text-navy">Set your own password</h1>
                <p class="mt-2 text-body text-muted">
                    Welcome, {{ Store.user.name.split(' ')[0] }}. Replace the temporary password from the S.A. Coordinator.
                    Your account becomes active once it's saved.
                </p>

                <form @submit.prevent="submit" class="mt-6 space-y-4" novalidate>
                    <password-field id="current-password" label="Temporary password" v-model="form.currentPassword"
                                    autocomplete="current-password" :error="errors.currentPassword" :disabled="saving" />
                    <password-field id="new-password" label="New password" v-model="form.newPassword"
                                    autocomplete="new-password" :error="errors.newPassword" :disabled="saving" />
                    <password-field id="confirm-password" label="Confirm new password" v-model="form.confirmPassword"
                                    autocomplete="new-password" :error="errors.confirmPassword" :disabled="saving" />

                    <ul class="space-y-1.5 rounded-lg bg-page px-3.5 py-3" aria-label="Password requirements">
                        <li v-for="rule in rules" :key="rule.label" class="flex items-center gap-2 text-caption"
                            :class="rule.ok ? 'text-success' : 'text-muted'">
                            <app-icon :name="rule.ok ? 'CircleCheck' : 'Circle'" :size="14" />
                            {{ rule.label }}<span class="sr-only">{{ rule.ok ? ' (done)' : ' (not yet)' }}</span>
                        </li>
                        <li class="pt-1 text-caption text-muted">Tip: a phrase of 3–4 random words is strong and easy to remember. Common passwords are rejected.</li>
                    </ul>

                    <div v-if="formError" class="flex items-start gap-2.5 rounded-lg border border-danger/20 bg-danger/5 px-3.5 py-3 text-body text-danger" role="alert">
                        <app-icon name="CircleX" :size="18" class="mt-0.5" /> <span>{{ formError }}</span>
                    </div>

                    <button type="submit" :disabled="saving"
                            class="flex w-full items-center justify-center gap-2 rounded-lg bg-navy px-4 py-2.5 text-[14px] font-semibold text-white transition-colors duration-150 hover:bg-navy-700 disabled:cursor-not-allowed disabled:bg-disabled">
                        <app-icon v-if="saving" name="LoaderCircle" :size="18" class="animate-spin" />
                        {{ saving ? 'Saving…' : 'Save password and continue' }}
                    </button>
                </form>
            </section>

            <p class="mt-5 text-center text-[13px] text-muted">
                Not {{ Store.user.name.split(' ')[0] }}?
                <button type="button" @click="signOut" class="font-medium text-navy underline-offset-2 hover:underline">Sign out</button>
            </p>
        </div>
    </div>

    <!-- NORMAL (profile menu) -->
    <template v-else>
        <page-header title="Change password" subtitle="You'll stay signed in on this device. Your other devices will be signed out." />

        <section class="max-w-xl rounded-xl border border-line bg-white p-6 shadow-card sm:p-8">
            <form @submit.prevent="submit" class="space-y-4" novalidate>
                <password-field id="current-password" label="Current password" v-model="form.currentPassword"
                                autocomplete="current-password" :error="errors.currentPassword" :disabled="saving" />
                <password-field id="new-password" label="New password" v-model="form.newPassword"
                                autocomplete="new-password" :error="errors.newPassword" :disabled="saving" />
                <password-field id="confirm-password" label="Confirm new password" v-model="form.confirmPassword"
                                autocomplete="new-password" :error="errors.confirmPassword" :disabled="saving" />

                <ul class="space-y-1.5 rounded-lg bg-page px-3.5 py-3" aria-label="Password requirements">
                    <li v-for="rule in rules" :key="rule.label" class="flex items-center gap-2 text-caption"
                        :class="rule.ok ? 'text-success' : 'text-muted'">
                        <app-icon :name="rule.ok ? 'CircleCheck' : 'Circle'" :size="14" />
                        {{ rule.label }}<span class="sr-only">{{ rule.ok ? ' (done)' : ' (not yet)' }}</span>
                    </li>
                    <li class="pt-1 text-caption text-muted">Common passwords and your current password are rejected.</li>
                </ul>

                <div v-if="formError" class="flex items-start gap-2.5 rounded-lg border border-danger/20 bg-danger/5 px-3.5 py-3 text-body text-danger" role="alert">
                    <app-icon name="CircleX" :size="18" class="mt-0.5" /> <span>{{ formError }}</span>
                </div>

                <div class="flex flex-wrap gap-2 pt-2">
                    <button type="submit" :disabled="saving"
                            class="inline-flex items-center gap-2 rounded-lg bg-navy px-4 py-2.5 text-[14px] font-semibold text-white transition-colors duration-150 hover:bg-navy-700 disabled:cursor-not-allowed disabled:bg-disabled">
                        <app-icon :name="saving ? 'LoaderCircle' : 'KeyRound'" :size="16" :class="saving ? 'animate-spin' : ''" />
                        {{ saving ? 'Saving…' : 'Change password' }}
                    </button>
                    <router-link :to="Store.home"
                            class="inline-flex items-center rounded-lg border border-line bg-white px-4 py-2.5 text-[14px] font-semibold text-ink transition-colors duration-150 hover:bg-page">
                        Cancel
                    </router-link>
                </div>
            </form>
        </section>
    </template>
    `
};
