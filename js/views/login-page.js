// One sign-in page for every role (PDF security checklist #2: no role selection).
// The server decides whether the account is a Coordinator, Supervisor or S.A.
const LoginPage = {
    components: { AppIcon },

    setup() {
        const router = VueRouter.useRouter();
        const route = VueRouter.useRoute();

        // "Remember" stores only the typed email / student ID in this browser,
        // never a password or session token (PDF security checklist #14).
        const REMEMBER_KEY = "assistpay.rememberedLogin";
        const remembered = (() => {
            try { return localStorage.getItem(REMEMBER_KEY) || ""; } catch { return ""; }
        })();

        const form = Vue.reactive({ username: remembered, password: "" });
        const remember = Vue.ref(!!remembered);
        const showPassword = Vue.ref(false);
        const capsLock = Vue.ref(false);
        const loading = Vue.ref(false);
        const error = Vue.ref("");
        const notice = Vue.ref(Store.notice);
        Store.notice = null;

        const features = [
            { icon: "CalendarDays", lines: ["Manage", "Schedules"] },
            { icon: "Users", lines: ["Coordinate", "With Ease"] },
            { icon: "ShieldCheck", lines: ["Build a", "Stronger NCST"] }
        ];

        const checkCaps = e => { capsLock.value = !!e.getModifierState?.("CapsLock"); };

        const submit = async () => {
            error.value = "";
            notice.value = null;
            const loginVal = String(form.username ?? "").trim();
            const passwordVal = String(form.password ?? "");
            if (!loginVal || passwordVal === "") {
                error.value = "Enter your school email or student ID, and your password.";
                return;
            }
            if (loginVal.length > 150) {
                error.value = "School email or student ID must be 150 characters or fewer.";
                return;
            }
            if (passwordVal.length > 128) {
                error.value = "Password must be 128 characters or fewer.";
                return;
            }
            loading.value = true;
            const r = await Model.login(loginVal, passwordVal);
            loading.value = false;

            if (!r.success) {
                error.value = r.message;
                form.password = "";
                if (typeof Swal !== "undefined") {
                    Swal.fire({
                        icon: "error",
                        title: "Sign In Failed",
                        text: r.message || "Invalid credentials. Please try again.",
                        confirmButtonText: "Try Again",
                        customClass: {
                            popup: "rounded-xl font-sans",
                            confirmButton: "btn btn-primary"
                        },
                        buttonsStyling: false
                    });
                }
                return;
            }
            form.password = "";
            try {
                if (remember.value) localStorage.setItem(REMEMBER_KEY, loginVal);
                else localStorage.removeItem(REMEMBER_KEY);
            } catch { /* private browsing: skip */ }

            if (typeof Swal !== "undefined") {
                await Swal.fire({
                    icon: "success",
                    title: "Welcome Back!",
                    text: `Login successful. Welcome, ${Store.user?.name?.split(" ")[0] || "User"}!`,
                    timer: 1400,
                    showConfirmButton: false,
                    customClass: {
                        popup: "rounded-xl font-sans"
                    }
                });
            } else {
                Store.toast("success", `Welcome, ${Store.user.name.split(" ")[0]}!`);
            }

            // Only follow the redirect if it belongs to this user's own area
            const target = route.query.redirect;
            const ownArea = `/${Store.role}/`;
            router.replace(typeof target === "string" && target.startsWith(ownArea) ? target : Store.home);
        };

        const forgot = () => {
            Store.toast("info", "Ask the S.A. Coordinator to reset your password. Email reset links are added in a later step.", 6000);
        };

        return { Store, form, remember, showPassword, capsLock, loading, error, notice, features, checkCaps, submit, forgot };
    },

    template: `
    <div class="touch-scroll no-scrollbar relative isolate flex h-full w-full flex-col overflow-y-auto lg:h-full lg:flex-row lg:overflow-hidden">
        <!-- one campus photo behind the whole page (fixed so it stays background during scroll on mobile) -->
        <img src="assets/ncst-campus.jpg" alt="" aria-hidden="true"
             class="pointer-events-none fixed inset-0 -z-10 h-full w-full object-cover object-center">

        <!-- ============ Brand panel: navy wash, light blur ============ -->
        <section class="touch-scroll no-scrollbar relative overflow-hidden bg-navy/[0.84] px-4 py-6 text-white backdrop-blur-[3px] sm:px-8 sm:py-8 lg:flex lg:w-[48%] xl:w-[50%] lg:flex-col lg:justify-between lg:py-12 xl:px-14 lg:h-full lg:overflow-y-auto">
            <div class="pointer-events-none absolute inset-0 bg-gradient-to-br from-navy/70 via-transparent to-navy-700/70" aria-hidden="true"></div>

            <!-- gold corner arcs -->
            <span aria-hidden="true" class="pointer-events-none absolute -left-36 -top-40 h-[320px] w-[320px] rounded-full border-[3px] border-gold/70 sm:h-[420px] sm:w-[420px]"></span>
            <span aria-hidden="true" class="pointer-events-none absolute -left-48 -top-52 h-[420px] w-[420px] rounded-full border border-gold/30 sm:h-[520px] sm:w-[520px]"></span>
            <span aria-hidden="true" class="pointer-events-none absolute -bottom-72 -right-56 hidden h-[520px] w-[520px] rounded-full border-[3px] border-gold/60 lg:block"></span>

            <!-- NCST lockup -->
            <div class="relative flex items-center gap-2.5 sm:gap-3">
                <img src="assets/logo-96.png" alt="NCST logo" aria-hidden="true" class="h-10 w-10 shrink-0 rounded-full ring-1 ring-white/20 sm:h-12 sm:w-12">
                <span class="h-8 w-px bg-white/25 sm:h-10" aria-hidden="true"></span>
                <div class="leading-tight">
                    <p class="text-[14px] font-bold tracking-wide sm:text-[16px]">NCST</p>
                    <p class="max-w-[200px] text-[9px] font-medium uppercase tracking-[0.10em] text-white/70 sm:max-w-[240px] sm:text-[10px] sm:tracking-[0.12em]">National College of Science and Technology</p>
                </div>
            </div>

            <!-- AssistPay lockup -->
            <div class="relative my-6 text-center sm:my-8 lg:my-auto">
                <img src="assets/logo-256.png" alt="AssistPay" class="mx-auto h-20 w-20 rounded-full shadow-[0_8px_26px_rgba(0,0,0,0.35)] ring-2 ring-white/20 sm:h-26 sm:w-26 lg:h-32 lg:w-32">
                <h1 class="mt-3.5 text-[32px] font-extrabold leading-none tracking-tight sm:mt-5 sm:text-[44px] lg:text-[52px]">
                    <span>ASSIST</span><span class="text-gold">PAY</span>
                </h1>
                <p class="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.25em] text-white/75 sm:mt-2 sm:text-[13px] sm:tracking-[0.35em]">NCST S.A. System</p>

                <span class="mx-auto mt-3.5 block h-[3px] w-12 rounded-full bg-gold sm:mt-5 sm:w-14" aria-hidden="true"></span>

                <p class="mt-3.5 text-[15px] font-semibold sm:mt-5 sm:text-[18px] lg:text-[19px]">Student Assistant Management System</p>
                <p class="mx-auto mt-2 max-w-sm text-[12px] italic leading-relaxed text-white/70 sm:mt-3 sm:text-[13px]">
                    “Smarter scheduling, smoother processes, a better NCST experience.”
                </p>

                <!-- what the system does -->
                <ul class="mx-auto mt-5 flex max-w-md items-stretch justify-center sm:mt-8">
                    <li v-for="(f, i) in features" :key="f.icon" class="flex flex-1 flex-col items-center px-1.5 sm:px-3"
                        :class="i > 0 ? 'border-l border-white/15' : ''">
                        <span class="grid h-9 w-9 place-items-center rounded-xl bg-white/10 text-gold ring-1 ring-white/15 sm:h-11 sm:w-11">
                            <app-icon :name="f.icon" :size="18" class="sm:hidden" />
                            <app-icon :name="f.icon" :size="20" class="hidden sm:block" />
                        </span>
                        <span class="mt-2 text-center text-[11px] font-semibold leading-tight text-white/85 sm:text-[12px]">
                            {{ f.lines[0] }}<br>{{ f.lines[1] }}
                        </span>
                    </li>
                </ul>
            </div>

            <div class="hidden lg:block" aria-hidden="true"></div>
        </section>

        <!-- ============ Sign-in panel: frosted glass ============ -->
        <main class="touch-scroll no-scrollbar relative flex flex-1 items-center justify-center bg-white/65 px-4 py-8 backdrop-blur-md sm:bg-white/60 sm:px-8 sm:py-12 lg:h-full lg:overflow-y-auto">
            <div class="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/60 via-transparent to-mist/60" aria-hidden="true"></div>

            <!-- Theme toggle on sign-in screen -->
            <button type="button"
                    @click="Store.toggleTheme()"
                    :aria-label="Store.isDark ? 'Switch to light theme' : 'Switch to dark theme'"
                    class="fixed right-4 top-4 z-20 inline-flex items-center gap-1.5 rounded-full border border-line bg-white/90 px-3 py-1.5 text-[12px] font-semibold text-navy shadow-card backdrop-blur transition-colors hover:bg-mist">
                <app-icon :name="Store.isDark ? 'Moon' : 'Sun'" :size="15" :class="Store.isDark ? 'text-gold' : 'text-amber-500'" />
                <span>{{ Store.isDark ? 'Dark Mode' : 'Light Mode' }}</span>
            </button>

            <div class="relative w-full max-w-[440px] rounded-2xl border border-white/80 bg-white/90 p-5 shadow-lift backdrop-blur-md sm:max-w-[460px] sm:rounded-3xl sm:p-8 lg:p-9">
                <span class="block h-[3px] w-10 rounded-full bg-gold" aria-hidden="true"></span>
                <h2 class="mt-3.5 text-[24px] font-bold leading-tight text-navy sm:mt-5 sm:text-[28px] lg:text-[30px]">Welcome back,</h2>
                <p class="mt-1 text-xs text-muted sm:text-body">Sign in to your AssistPay account.</p>

                <div v-if="notice" class="mt-5 flex items-start gap-2.5 rounded-lg border border-info/20 bg-info/5 px-3.5 py-3 text-xs text-ink sm:mt-6 sm:text-body" role="status">
                    <app-icon name="Info" :size="18" class="mt-0.5 shrink-0 text-info" /> {{ notice.message }}
                </div>

                <form @submit.prevent="submit" class="mt-5 space-y-4 sm:mt-7 sm:space-y-5" novalidate>
                    <div>
                        <label for="username" class="field-label text-[12px] sm:text-[13px]">School email / student ID</label>
                        <div class="relative">
                            <app-icon name="Mail" :size="18" class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                            <input id="username" v-model="form.username" type="text" autocomplete="username" autocapitalize="none"
                                   spellcheck="false" maxlength="150" required :disabled="loading" autofocus
                                   placeholder="Enter your school email or student ID"
                                   class="input min-h-[46px] bg-white/95 py-2.5 pl-11 pr-3 text-sm sm:min-h-[48px] sm:py-3 sm:text-body">
                        </div>
                    </div>

                    <div>
                        <label for="password" class="field-label text-[12px] sm:text-[13px]">Password</label>
                        <div class="relative">
                            <app-icon name="LockKeyhole" :size="18" class="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                            <input id="password" v-model="form.password" :type="showPassword ? 'text' : 'password'"
                                   autocomplete="current-password" maxlength="128" data-password-field="true" required :disabled="loading"
                                   @keyup="checkCaps" @keydown="checkCaps" placeholder="Enter your password"
                                   class="input min-h-[46px] bg-white/95 py-2.5 pl-11 pr-12 text-sm sm:min-h-[48px] sm:py-3 sm:text-body">
                            <button type="button" @click="showPassword = !showPassword"
                                    class="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-2 text-muted transition-colors duration-150 hover:bg-mist hover:text-navy active:scale-95"
                                    :aria-label="showPassword ? 'Hide password' : 'Show password'" :aria-pressed="showPassword">
                                <app-icon :name="showPassword ? 'Eye' : 'EyeOff'" :size="18" />
                            </button>
                        </div>
                        <p v-if="capsLock" class="mt-1.5 flex items-center gap-1.5 text-caption text-warning">
                            <app-icon name="TriangleAlert" :size="14" /> Caps Lock is on.
                        </p>
                    </div>

                    <div class="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                        <label class="inline-flex cursor-pointer items-center gap-2 text-[12px] text-ink select-none sm:text-[13px]">
                            <input type="checkbox" v-model="remember" class="h-4 w-4 rounded border-line text-navy focus:ring-navy/30">
                            <span>Remember my email / ID</span>
                        </label>
                        <button type="button" @click="forgot" class="text-[12px] font-medium text-info underline-offset-2 hover:underline sm:text-[13px]">
                            Forgot password?
                        </button>
                    </div>

                    <div v-if="error" class="flex items-start gap-2.5 rounded-lg border border-danger/20 bg-danger/5 px-3.5 py-3 text-xs text-danger sm:text-body" role="alert">
                        <app-icon name="CircleX" :size="18" class="mt-0.5 shrink-0" /> <span>{{ error }}</span>
                    </div>

                    <button type="submit" :disabled="loading"
                            class="flex w-full min-h-[46px] items-center justify-center gap-2.5 rounded-lg bg-gold px-4 py-3 text-[14px] font-bold text-navy shadow-sm transition-all duration-150 hover:bg-[#e5a92f] active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-disabled disabled:text-white sm:min-h-[48px] sm:rounded-xl sm:text-[15px]">
                        <app-icon :name="loading ? 'LoaderCircle' : 'LogIn'" :size="18" :class="loading ? 'animate-spin' : ''" />
                        {{ loading ? 'Signing in…' : 'Sign In' }}
                        <app-icon v-if="!loading" name="ArrowRight" :size="18" />
                    </button>
                </form>

                <div class="mt-5 flex items-start gap-2.5 rounded-lg bg-mist/90 p-3 sm:mt-6 sm:gap-3 sm:rounded-xl sm:p-3.5">
                    <app-icon name="ShieldCheck" :size="18" class="mt-0.5 shrink-0 text-info sm:hidden" />
                    <app-icon name="ShieldCheck" :size="20" class="mt-0.5 shrink-0 text-info hidden sm:block" />
                    <div class="text-[12px] leading-snug sm:text-[13px]">
                        <p class="font-medium text-ink">Your account is protected with secure authentication.</p>
                        <p class="mt-0.5 text-[11px] text-muted sm:text-caption">Access is limited to authorized personnel. Sessions end after 30 minutes of inactivity.</p>
                    </div>
                </div>

                <p class="mt-5 flex items-center justify-center gap-1.5 border-t border-line pt-3.5 text-[11px] text-muted sm:mt-6 sm:gap-2 sm:pt-4 sm:text-caption">
                    <app-icon name="Lock" :size="13" /> NCST Student Assistant System
                </p>
            </div>
        </main>
    </div>
    `
};
