// Top header: system name, current semester, profile menu.
const AppTopbar = {
    components: { AppIcon, AppModal },

    setup() {
        const menuOpen = Vue.ref(false);
        const menuRoot = Vue.ref(null);
        const notifOpen = Vue.ref(false);
        const notifRoot = Vue.ref(null);
        const perfectModalOpen = Vue.ref(false);
        const perfectModalLoading = Vue.ref(false);
        const perfectModalData = Vue.ref(null);
        let pollTimer = null;
        let initTimer = null;
        const onVisibilityChange = () => {
            if (!document.hidden) {
                Store.loadNotifications();
            }
        };

        const closeOnOutside = e => {
            if (menuRoot.value && !menuRoot.value.contains(e.target)) menuOpen.value = false;
            if (notifRoot.value && !notifRoot.value.contains(e.target)) notifOpen.value = false;
        };
        const closeOnEscape = e => {
            if (e.key === "Escape") {
                menuOpen.value = false;
                notifOpen.value = false;
            }
        };

        Vue.onMounted(() => {
            document.addEventListener("click", closeOnOutside);
            document.addEventListener("keydown", closeOnEscape);
            document.addEventListener("visibilitychange", onVisibilityChange);
            initTimer = setTimeout(() => Store.loadNotifications(), 120);
            pollTimer = setInterval(() => {
                if (!document.hidden) Store.loadNotifications();
            }, 25000);
        });

        Vue.onUnmounted(() => {
            document.removeEventListener("click", closeOnOutside);
            document.removeEventListener("keydown", closeOnEscape);
            document.removeEventListener("visibilitychange", onVisibilityChange);
            if (initTimer) clearTimeout(initTimer);
            if (pollTimer) clearInterval(pollTimer);
        });

        const router = VueRouter.useRouter();
        const menuItems = Vue.computed(() => {
            const role = Store.role;
            const settingsPath = role === "admin"
                ? "/admin/settings"
                : role === "registrar"
                    ? "/registrar/system/settings"
                    : role === "supervisor"
                        ? "/supervisor/settings"
                        : "/sa/profile";
            const profilePath = role === "sa" ? "/sa/profile" : settingsPath;
            return [
                { icon: "CircleUser", label: "My Profile", to: profilePath },
                { icon: "Settings", label: "Account Settings", to: settingsPath },
                { icon: "KeyRound", label: "Change Password", to: "/change-password" }
            ];
        });

        const openItem = item => {
            menuOpen.value = false;
            if (item.to) router.push(item.to);
            else Store.toast("info", `${item.label} is added in a later step.`);
        };

        const toggleNotif = () => {
            notifOpen.value = !notifOpen.value;
            if (notifOpen.value) {
                menuOpen.value = false;
                Store.loadNotifications();
            }
        };

        const openPerfectAttendanceModal = async notif => {
            perfectModalOpen.value = true;
            perfectModalLoading.value = true;
            perfectModalData.value = null;

            let m = 0;
            let y = 0;
            if (notif.link) {
                const match = notif.link.match(/month=(\d+)&year=(\d+)/);
                if (match) {
                    m = parseInt(match[1], 10);
                    y = parseInt(match[2], 10);
                }
            }

            try {
                const r = await Model.request("attendance", "perfect_attendance_notification_details", {
                    month: m,
                    year: y,
                    notificationId: notif.id
                });
                if (r && r.success) {
                    perfectModalData.value = r;
                }
            } catch (err) {
                console.error("Failed to load perfect attendance notification details:", err);
            } finally {
                perfectModalLoading.value = false;
            }
        };

        const viewFullPerfectAttendance = () => {
            perfectModalOpen.value = false;
            if (perfectModalData.value?.period) {
                const p = perfectModalData.value.period;
                router.push(`/admin/perfect-attendance?month=${p.month}&year=${p.year}`);
            } else {
                router.push('/admin/perfect-attendance');
            }
        };

        const clickNotif = async n => {
            if (!n.isRead) {
                n.isRead = true;
                Store.unreadCount = Math.max(0, Store.unreadCount - 1);
                Model.request("notifications", "mark_read", { id: n.id });
            }
            notifOpen.value = false;
            Store.pendingNotif = { ...n, clickedAt: Date.now() };
            window.dispatchEvent(new CustomEvent("assistpay:notification-clicked", { detail: n }));

            if (n.type === "PERFECT_ATTENDANCE") {
                openPerfectAttendanceModal(n);
                return;
            }

            if (n.link) {
                let clean = n.link.replace(/^#/, '');
                if (!clean.startsWith('/')) clean = '/' + clean;

                // Handle legacy /admin/sa/:id -> /admin/sa-management/:id?tab=CLASSES
                clean = clean.replace(/^\/admin\/sa\/(\d+)/, '/admin/sa-management/$1?tab=CLASSES');

                // Handle legacy /sa/my-schedule -> /sa/schedule
                if (clean === '/sa/my-schedule') clean = '/sa/schedule';

                // Handle generic requests route
                if (clean === '/requests' || clean.startsWith('/requests?')) {
                    clean = `/${Store.role || 'sa'}${clean}`;
                }

                // If still pointing to generic recommendations for a class schedule notification
                if (clean === '/admin/scheduling/recommendations' && (n.type === 'CLASS_SCHEDULE_CHANGED' || /class schedule/i.test(n.title || ''))) {
                    const m = (n.message || '').match(/class schedule of ([^(]+)\(/i) || (n.message || '').match(/class period of ([^(]+)\(/i);
                    const name = m ? m[1].trim() : '';
                    clean = name ? `/admin/scheduling/class-schedules?q=${encodeURIComponent(name)}` : '/admin/scheduling/class-schedules';
                }

                router.push(clean);
            }
        };

        const markAllRead = async () => {
            for (const n of Store.notifications) n.isRead = true;
            Store.unreadCount = 0;
            await Model.request("notifications", "mark_all_read");
        };

        const clearAllNotifs = async () => {
            Store.notifications = [];
            Store.unreadCount = 0;
            await Model.request("notifications", "clear_all");
        };

        const getNotifIcon = type => {
            switch (type) {
                case "PERFECT_ATTENDANCE": return "Trophy";
                case "SCHEDULE_PUBLISHED": return "CalendarCheck";
                case "DUTY_PLOT_SUBMITTED": return "CalendarPlus";
                case "DUTY_PLOT_SAVED": return "CheckCircle";
                case "DUTY_PLOT_CLEARED": return "CalendarX";
                case "DUTY_ASSIGNED": return "Briefcase";
                case "CLASS_SCHEDULE_CHANGED": return "CalendarClock";
                case "SA_EVALUATION_ACKNOWLEDGED":
                case "SA_EVALUATION_FINALIZED": return "ClipboardCheck";
                case "SA_EVALUATION_SUBMITTED":
                case "SA_EVALUATION_FOR_REVIEW": return "ClipboardList";
                case "SA_EVALUATION_RETURNED":
                case "SA_EVALUATION_CONCERN": return "RotateCcw";
                case "REQUEST_SUBMITTED":
                case "REQUEST_RESUBMITTED": return "Inbox";
                case "REQUEST_APPROVED_BY_SUPERVISOR":
                case "REQUEST_RECORDED": return "CheckCircle";
                case "REQUEST_RETURNED_TO_SA":
                case "REQUEST_RETURNED_FOR_CLARIFICATION":
                case "REQUEST_CLARIFICATION_SUBMITTED": return "RotateCcw";
                case "REQUEST_REJECTED": return "XCircle";
                default: return "Bell";
            }
        };

        const getNotifColor = type => {
            switch (type) {
                case "PERFECT_ATTENDANCE": return "text-amber-800 bg-amber-100 ring-1 ring-amber-300";
                case "SCHEDULE_PUBLISHED":
                case "SA_EVALUATION_FINALIZED":
                case "REQUEST_RECORDED": return "text-emerald-600 bg-emerald-50";
                case "DUTY_PLOT_SUBMITTED":
                case "SA_EVALUATION_ACKNOWLEDGED":
                case "REQUEST_SUBMITTED":
                case "REQUEST_RESUBMITTED": return "text-amber-600 bg-amber-50";
                case "DUTY_PLOT_SAVED":
                case "REQUEST_APPROVED_BY_SUPERVISOR": return "text-emerald-600 bg-emerald-50";
                case "DUTY_PLOT_CLEARED": return "text-slate-600 bg-slate-50";
                case "CLASS_SCHEDULE_CHANGED": return "text-indigo-600 bg-indigo-50";
                case "SA_EVALUATION_RETURNED":
                case "SA_EVALUATION_CONCERN":
                case "REQUEST_RETURNED_TO_SA":
                case "REQUEST_RETURNED_FOR_CLARIFICATION": return "text-orange-600 bg-orange-50";
                case "REQUEST_REJECTED": return "text-rose-600 bg-rose-50";
                default: return "text-blue-600 bg-blue-50";
            }
        };

        return {
            Store,
            menuOpen,
            menuRoot,
            notifOpen,
            notifRoot,
            perfectModalOpen,
            perfectModalLoading,
            perfectModalData,
            openPerfectAttendanceModal,
            viewFullPerfectAttendance,
            menuItems,
            openItem,
            toggleNotif,
            clickNotif,
            markAllRead,
            clearAllNotifs,
            getNotifIcon,
            getNotifColor
        };
    },

    template: `
    <header class="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-line bg-white px-4 sm:px-6">
        <button @click="Store.sidebarOpen = true"
                class="-ml-1 rounded-md p-2 text-navy hover:bg-mist lg:hidden"
                aria-label="Open menu" aria-controls="app-sidebar" :aria-expanded="Store.sidebarOpen">
            <app-icon name="Menu" :size="22" />
        </button>

        <p class="hidden min-w-0 truncate text-[13px] font-medium text-muted 2xl:block">
            NCST Student Assistant Scheduling, Attendance, and Allowance Management System
        </p>

        <div class="ml-auto flex items-center gap-2 sm:gap-3">
            <!-- Current semester -->
            <div v-if="Store.semester" class="hidden items-center gap-2 rounded-md bg-mist px-3 py-1.5 sm:flex">
                <app-icon name="CalendarDays" :size="16" class="text-navy" />
                <span class="whitespace-nowrap text-[13px] font-medium text-navy">{{ Store.semester.label }}</span>
                <span class="inline-flex items-center gap-1 rounded bg-success/10 px-1.5 py-0.5 text-[11px] font-semibold text-success">
                    <app-icon name="Check" :size="12" :stroke-width="3" /> {{ Store.semester.status }}
                </span>
            </div>

            <!-- Dark Mode Toggle (Available for all accounts) -->
            <button type="button"
                    @click="Store.toggleTheme()"
                    :aria-label="Store.isDark ? 'Switch to light theme' : 'Switch to dark theme'"
                    :title="Store.isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'"
                    class="relative inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-page/60 px-2.5 text-[12px] font-semibold text-navy transition-colors duration-150 hover:bg-mist">
                <app-icon :name="Store.isDark ? 'Moon' : 'Sun'" :size="17" :class="Store.isDark ? 'text-gold' : 'text-amber-500'" />
                <span class="hidden md:inline">{{ Store.isDark ? 'Dark' : 'Light' }}</span>
            </button>

            <!-- Notification Bell (Available for all accounts) -->
            <div ref="notifRoot" class="relative">
                <button @click="toggleNotif" :aria-expanded="notifOpen" aria-label="Notifications"
                        class="relative grid h-9 w-9 place-items-center rounded-lg text-navy transition-colors duration-150 hover:bg-page">
                    <app-icon name="Bell" :size="19" />
                    <!-- Unread Badge -->
                    <span v-if="Store.unreadCount > 0"
                          class="absolute -top-0.5 -right-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white shadow-sm ring-2 ring-white animate-pulse">
                        {{ Store.unreadCount > 9 ? '9+' : Store.unreadCount }}
                    </span>
                </button>

                <transition enter-active-class="transition duration-150 ease-out" enter-from-class="opacity-0 -translate-y-1"
                            leave-active-class="transition duration-100 ease-in" leave-to-class="opacity-0">
                    <div v-if="notifOpen"
                         class="absolute right-0 mt-2 w-80 sm:w-96 overflow-hidden rounded-xl border border-line bg-white shadow-lift z-50">
                        <!-- Header -->
                        <div class="flex items-center justify-between border-b border-line px-4 py-3 bg-page/50">
                            <div class="flex items-center gap-2">
                                <span class="text-[13px] font-bold text-ink">Notifications</span>
                                <span v-if="Store.unreadCount > 0" class="rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-bold text-danger">
                                    {{ Store.unreadCount }} new
                                </span>
                            </div>
                            <div class="flex items-center gap-2">
                                <button v-if="Store.unreadCount > 0" @click="markAllRead" class="text-[11px] font-medium text-navy hover:underline">
                                    Mark all as read
                                </button>
                                <button v-if="Store.notifications.length > 0" @click="clearAllNotifs" class="text-[11px] text-muted hover:text-danger hover:underline">
                                    Clear
                                </button>
                            </div>
                        </div>

                        <!-- Notification List -->
                        <div class="max-h-80 overflow-y-auto divide-y divide-line/60">
                            <div v-for="n in Store.notifications" :key="n.id"
                                 @click="clickNotif(n)"
                                 class="flex items-start gap-3 p-3 transition-colors cursor-pointer hover:bg-mist/50"
                                 :class="n.type === 'PERFECT_ATTENDANCE' ? 'bg-amber-50/70 border-l-4 border-l-amber-500' : (!n.isRead ? 'bg-blue-50/30' : '')">
                                <div class="grid h-8 w-8 shrink-0 place-items-center rounded-lg" :class="getNotifColor(n.type)">
                                    <app-icon :name="getNotifIcon(n.type)" :size="16" />
                                </div>
                                <div class="flex-1 min-w-0">
                                    <div class="flex items-center justify-between gap-1">
                                        <p class="truncate text-[12px] font-bold text-ink" :class="!n.isRead ? 'text-navy' : ''">
                                            {{ n.title }}
                                        </p>
                                        <span class="shrink-0 text-[10px] text-muted">{{ n.timeAgo }}</span>
                                    </div>
                                    <p class="mt-0.5 text-[12px] leading-relaxed text-muted line-clamp-2">
                                        {{ n.message }}
                                    </p>
                                </div>
                                <span v-if="!n.isRead" class="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-navy"></span>
                            </div>

                            <!-- Empty State -->
                            <div v-if="!Store.notifications.length" class="p-8 text-center text-muted">
                                <app-icon name="BellOff" :size="28" class="mx-auto mb-2 text-muted/60" />
                                <p class="text-caption font-semibold text-ink">No new notifications</p>
                                <p class="text-[11px] text-muted mt-0.5">Updates regarding duty, plotting, and schedules will appear here.</p>
                            </div>
                        </div>
                    </div>
                </transition>
            </div>

            <!-- Profile -->
            <div ref="menuRoot" class="relative">
                <button @click="menuOpen = !menuOpen" :aria-expanded="menuOpen" aria-haspopup="menu"
                        class="flex items-center gap-2.5 rounded-lg py-1 pl-1 pr-2 transition-colors duration-150 hover:bg-page">
                    <img v-if="Store.user?.avatarUrl" :src="Store.user.avatarUrl" :alt="Store.user.name"
                         class="h-9 w-9 rounded-full object-cover ring-2 ring-gold/70 shrink-0" />
                    <span v-else class="grid h-9 w-9 place-items-center rounded-full bg-navy text-[13px] font-semibold text-white ring-2 ring-gold/70 shrink-0">
                        {{ Store.initials }}
                    </span>
                    <span class="hidden text-left leading-tight sm:block">
                        <span class="block whitespace-nowrap text-[13px] font-semibold text-ink">{{ Store.user.name }}</span>
                        <span class="block whitespace-nowrap text-caption text-muted">{{ Store.userTitle }}</span>
                    </span>
                    <app-icon name="ChevronDown" :size="16" class="hidden text-muted sm:block" />
                </button>

                <transition enter-active-class="transition duration-150 ease-out" enter-from-class="opacity-0 -translate-y-1"
                            leave-active-class="transition duration-100 ease-in" leave-to-class="opacity-0">
                    <div v-if="menuOpen" role="menu"
                         class="absolute right-0 mt-2 w-64 overflow-hidden rounded-lg border border-line bg-white py-1 shadow-lift">
                        <div class="border-b border-line px-4 py-2.5 sm:hidden">
                            <p class="text-[13px] font-semibold text-ink">{{ Store.user.name }}</p>
                            <p class="text-caption text-muted">{{ Store.userTitle }}</p>
                        </div>

                        <!-- Theme Selector inside Profile Menu -->
                        <div class="border-b border-line px-4 py-2.5">
                            <div class="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-muted mb-1.5">
                                <span>Theme / Appearance</span>
                                <span class="text-navy font-bold capitalize">{{ Store.theme }}</span>
                            </div>
                            <div class="grid grid-cols-2 gap-1 rounded-lg bg-page p-1 border border-line">
                                <button type="button" @click="Store.setTheme('light')"
                                        class="flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition-colors"
                                        :class="Store.theme === 'light' ? 'bg-white text-navy shadow-sm' : 'text-muted hover:text-ink'">
                                    <app-icon name="Sun" :size="13" /> Light
                                </button>
                                <button type="button" @click="Store.setTheme('dark')"
                                        class="flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold transition-colors"
                                        :class="Store.theme === 'dark' ? 'bg-white text-navy shadow-sm' : 'text-muted hover:text-ink'">
                                    <app-icon name="Moon" :size="13" /> Dark
                                </button>
                            </div>
                        </div>

                        <button v-for="item in menuItems" :key="item.label" role="menuitem" @click="openItem(item)"
                                class="flex w-full items-center gap-3 px-4 py-2 text-left text-body text-ink hover:bg-mist">
                            <app-icon :name="item.icon" :size="16" class="text-muted" /> {{ item.label }}
                        </button>
                        <div class="my-1 border-t border-line"></div>
                        <button role="menuitem" @click="menuOpen = false; $root.logout()"
                                class="flex w-full items-center gap-3 px-4 py-2 text-left text-body text-danger hover:bg-danger/5">
                            <app-icon name="LogOut" :size="16" /> Logout
                        </button>
                    </div>
                </transition>
            </div>
        </div>

        <!-- PERFECT ATTENDANCE NOTIFICATION DETAILS MODAL (Screen 2) -->
        <app-modal :open="perfectModalOpen" @close="perfectModalOpen = false"
                   title="Perfect Attendance Achieved!"
                   :description="perfectModalData?.period?.label ? ('Congratulations! ' + (perfectModalData.qualifiedSas?.map(s => s.name).slice(0, 2).join(' and ') || 'Student Assistants') + (perfectModalData.qualifiedSas?.length > 2 ? ' and ' + (perfectModalData.qualifiedSas.length - 2) + ' others' : '') + ' qualified for Perfect Attendance for ' + perfectModalData.period.label + '.') : 'Monthly recognition for qualified Student Assistants.'"
                   icon="Trophy" tone="warning" size="lg">
            <div class="space-y-4">
                <!-- 3 Summary Stat Cards (Screen 2) -->
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div class="flex items-center gap-3 rounded-xl border border-line bg-page/50 p-3 shadow-2xs">
                        <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50 text-navy">
                            <app-icon name="Calendar" :size="16" />
                        </div>
                        <div>
                            <span class="block text-[10px] font-bold uppercase tracking-wider text-muted">Recognition Month</span>
                            <span class="block text-xs font-bold text-navy">{{ perfectModalData?.period?.label || 'Current Period' }}</span>
                        </div>
                    </div>

                    <div class="flex items-center gap-3 rounded-xl border border-amber-200/80 bg-amber-50/50 p-3 shadow-2xs">
                        <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-800">
                            <app-icon name="Users" :size="16" />
                        </div>
                        <div>
                            <span class="block text-[10px] font-bold uppercase tracking-wider text-amber-900">Qualified S.A.s</span>
                            <span class="block text-base font-black text-navy">{{ perfectModalData?.verification?.qualifiedCount || (perfectModalData?.qualifiedSas?.length || 0) }}</span>
                        </div>
                    </div>

                    <div class="flex items-center gap-3 rounded-xl border border-emerald-200/80 bg-emerald-50/50 p-3 shadow-2xs">
                        <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-800">
                            <app-icon name="ShieldCheck" :size="16" />
                        </div>
                        <div>
                            <span class="block text-[10px] font-bold uppercase tracking-wider text-emerald-900">Verification Status</span>
                            <span class="block text-xs font-bold text-emerald-800">Verified</span>
                        </div>
                    </div>
                </div>

                <!-- Information Notice Banner (Screen 2) -->
                <div class="flex items-center gap-2.5 rounded-xl border border-blue-200/80 bg-blue-50/60 p-3 text-xs text-navy">
                    <app-icon name="Info" :size="16" class="text-blue-600 shrink-0" />
                    <span class="font-medium text-[11px] leading-relaxed">
                        The system verified all required scheduled shifts and finalized attendance records for the selected period.
                    </span>
                </div>

                <!-- Qualified S.A.s List Header & Table (Screen 2) -->
                <div class="space-y-2">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <app-icon name="Users" :size="15" class="text-navy" />
                            <h3 class="text-xs font-bold text-navy">Qualified S.A.s</h3>
                        </div>
                        <button @click="viewFullPerfectAttendance" class="text-[11px] font-semibold text-navy hover:underline">
                            View All
                        </button>
                    </div>

                    <div class="max-h-56 overflow-y-auto rounded-xl border border-line bg-white shadow-2xs">
                        <table class="w-full text-left text-xs">
                            <thead class="sticky top-0 bg-page text-[10px] font-bold uppercase tracking-wider text-muted border-b border-line">
                                <tr>
                                    <th class="w-10 px-3 py-2 text-center">#</th>
                                    <th class="px-3 py-2">Name</th>
                                    <th class="px-3 py-2">Student ID</th>
                                    <th class="px-3 py-2">Department / Post</th>
                                    <th class="px-3 py-2 text-center">Status</th>
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-line/60">
                                <tr v-for="(sa, idx) in (perfectModalData?.qualifiedSas || [])" :key="sa.saProfileId"
                                    class="hover:bg-amber-50/30 transition-colors">
                                    <td class="px-3 py-2.5 text-center font-bold text-muted">{{ idx + 1 }}</td>
                                    <td class="px-3 py-2.5 font-bold text-ink">
                                        <div class="flex items-center gap-2">
                                            <div class="flex h-7 w-7 items-center justify-center rounded-full bg-navy text-[10px] font-bold text-white shrink-0">
                                                {{ (sa.name || '').charAt(0) }}
                                            </div>
                                            <span>{{ sa.name }}</span>
                                        </div>
                                    </td>
                                    <td class="px-3 py-2.5 font-mono text-[11px] font-semibold text-slate-600">{{ sa.studentId }}</td>
                                    <td class="px-3 py-2.5">
                                        <span class="font-semibold text-navy text-[11px]">{{ sa.department }}</span>
                                        <span class="block text-[10px] text-muted">{{ sa.location || 'Assigned Station' }}</span>
                                    </td>
                                    <td class="px-3 py-2.5 text-center">
                                        <span class="inline-flex items-center gap-0.5 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                                            <app-icon name="Check" :size="10" /> Verified
                                        </span>
                                    </td>
                                </tr>
                                <tr v-if="!perfectModalData?.qualifiedSas?.length">
                                    <td colspan="5" class="py-6 text-center text-xs text-muted">
                                        <div v-if="perfectModalLoading" class="flex items-center justify-center gap-2">
                                            <app-icon name="RefreshCw" :size="14" class="animate-spin text-navy" />
                                            <span>Loading details...</span>
                                        </div>
                                        <span v-else>No qualified Student Assistants for this period.</span>
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            <template #footer>
                <div class="flex items-center justify-end gap-2">
                    <button @click="perfectModalOpen = false"
                            class="rounded-lg border border-line bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-mist">
                        Close
                    </button>
                    <button @click="viewFullPerfectAttendance"
                            class="inline-flex items-center gap-1.5 rounded-lg bg-navy px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-navy-900 active:scale-95 transition-all">
                        <span>View Full Details</span>
                        <app-icon name="ArrowRight" :size="13" />
                    </button>
                </div>
            </template>
        </app-modal>
    </header>
    `
};
