// Left sidebar: full labels on desktop, slide-in drawer below 1024px.
// The Scheduling group is drawn as a numbered rail because its pages are the
// actual workflow order: Plan → Match → Review → Finalize → Publish.
const AppSidebar = {
    components: { AppIcon },

    setup() {
        const route = VueRouter.useRoute();
        const items = Vue.computed(() => NAVIGATION[Store.role].items);
        const openGroups = Vue.reactive({});

        // Sub-pages (e.g. /admin/sa-management/12/edit) keep their menu item highlighted
        const isActive = path => route.path === path || route.path.startsWith(path + "/");
        const groupActive = item => item.children?.some(c => isActive(c.path));
        const isOpen = item => openGroups[item.group] ?? groupActive(item);
        const toggle = item => { openGroups[item.group] = !isOpen(item); };

        // Close the mobile drawer after navigating
        Vue.watch(() => route.path, () => { Store.sidebarOpen = false; });

        return { Store, items, isActive, groupActive, isOpen, toggle };
    },

    template: `
    <!-- Mobile backdrop -->
    <transition enter-active-class="transition-opacity duration-200" enter-from-class="opacity-0"
                leave-active-class="transition-opacity duration-150" leave-to-class="opacity-0">
        <div v-if="Store.sidebarOpen" @click="Store.sidebarOpen = false"
             class="fixed inset-0 z-40 bg-navy/50 lg:hidden" aria-hidden="true"></div>
    </transition>

    <aside id="app-sidebar"
           class="fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-navy text-white transition-transform duration-200 lg:static lg:translate-x-0"
           :class="Store.sidebarOpen ? 'translate-x-0' : '-translate-x-full'"
           aria-label="Main navigation">

        <!-- Brand for Registrar -->
        <div v-if="Store.role === 'registrar'" class="flex items-center gap-3 border-b border-white/10 px-4 py-4">
            <div class="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-amber-500/80 bg-white/5 text-amber-400 shadow-sm">
                <app-icon name="Database" :size="20" />
            </div>
            <div class="leading-tight">
                <p class="text-[11px] font-bold tracking-wider text-white/80 uppercase">SMALL STUDENT</p>
                <p class="text-[15px] font-black tracking-wider text-white uppercase">INFO DATABASE</p>
            </div>
            <button @click="Store.sidebarOpen = false"
                    class="ml-auto rounded-md p-1.5 text-white/70 hover:bg-navy-700 hover:text-white lg:hidden"
                    aria-label="Close menu">
                <app-icon name="X" :size="20" />
            </button>
        </div>

        <!-- Brand for Admin / Other roles -->
        <div v-else class="flex items-center gap-3 border-b border-white/10 px-5 py-4">
            <img src="assets/logo-96.png" alt="NCST Student Assistant logo" class="h-11 w-11 rounded-full bg-white/5">
            <div class="leading-tight">
                <p class="text-[17px] font-bold tracking-wide">ASSISTPAY</p>
                <p class="text-[11px] font-medium tracking-wide text-white/60">NCST S.A. SYSTEM</p>
            </div>
            <button @click="Store.sidebarOpen = false"
                    class="ml-auto rounded-md p-1.5 text-white/70 hover:bg-navy-700 hover:text-white lg:hidden"
                    aria-label="Close menu">
                <app-icon name="X" :size="20" />
            </button>
        </div>

        <!-- Menu -->
        <nav class="sidebar-scroll flex-1 overflow-y-auto px-3 py-4">
            <ul class="space-y-0.5">
                <li v-for="item in items" :key="item.label">

                    <!-- Plain link -->
                    <router-link v-if="!item.children" :to="item.path"
                        class="relative flex items-center gap-3 rounded-md px-3 py-2.5 text-[14px] font-medium transition-colors duration-150"
                        :class="isActive(item.path) ? 'bg-navy-700 text-white' : 'text-white/75 hover:bg-navy-700/70 hover:text-white'"
                        :aria-current="isActive(item.path) ? 'page' : null">
                        <span v-if="isActive(item.path)" class="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-gold"></span>
                        <app-icon :name="item.icon" :class="isActive(item.path) ? 'text-gold' : ''" />
                        {{ item.label }}
                    </router-link>

                    <!-- Group (Scheduling) -->
                    <template v-else>
                        <button @click="toggle(item)" :aria-expanded="isOpen(item)" :aria-controls="'group-' + item.group"
                            class="relative flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-[14px] font-medium transition-colors duration-150"
                            :class="groupActive(item) ? 'text-white' : 'text-white/75 hover:bg-navy-700/70 hover:text-white'">
                            <span v-if="groupActive(item)" class="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-gold"></span>
                            <app-icon :name="item.icon" :class="groupActive(item) ? 'text-gold' : ''" />
                            {{ item.label }}
                            <app-icon name="ChevronDown" :size="16"
                                class="ml-auto transition-transform duration-200" :class="isOpen(item) ? 'rotate-180' : ''" />
                        </button>

                        <ol v-show="isOpen(item)" :id="'group-' + item.group" class="relative mb-1 ml-[22px] mt-1">
                            <!-- workflow rail -->
                            <span class="absolute bottom-3 left-[9px] top-3 w-px bg-white/15" aria-hidden="true"></span>
                            <li v-for="(child, i) in item.children" :key="child.path">
                                <router-link :to="child.path"
                                    class="relative flex items-center gap-3 rounded-md py-1.5 pl-0 pr-2 text-[13px] font-medium transition-colors duration-150"
                                    :class="isActive(child.path) ? 'text-white' : 'text-white/65 hover:text-white'"
                                    :aria-current="isActive(child.path) ? 'page' : null">
                                    <span class="relative z-10 grid h-[19px] w-[19px] shrink-0 place-items-center rounded-full text-[10px] font-semibold"
                                          :class="isActive(child.path) ? 'bg-gold text-navy' : 'border border-white/25 bg-navy text-white/60'">
                                        {{ i + 1 }}
                                    </span>
                                    <span class="rounded px-1.5 py-0.5" :class="isActive(child.path) ? 'bg-navy-700' : ''">{{ child.label }}</span>
                                </router-link>
                            </li>
                        </ol>
                    </template>
                </li>
            </ul>
        </nav>

        <!-- Dark Mode & Logout -->
        <div class="border-t border-white/10 p-3 space-y-1">
            <button type="button" @click="Store.toggleTheme()"
                :aria-label="Store.isDark ? 'Switch to light theme' : 'Switch to dark theme'"
                class="flex w-full items-center justify-between rounded-md px-3 py-2 text-[13px] font-medium text-white/80 transition-colors duration-150 hover:bg-navy-700/70 hover:text-white">
                <span class="flex items-center gap-3">
                    <app-icon name="Moon" :size="18" class="text-gold" />
                    <span>Dark Mode</span>
                </span>
                <span class="rounded-full px-2 py-0.5 text-[11px] font-bold"
                      :class="Store.isDark ? 'bg-gold text-navy' : 'bg-white/10 text-white/75'">
                    {{ Store.isDark ? 'ON' : 'OFF' }}
                </span>
            </button>
            <button @click="$root.logout()"
                class="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-[14px] font-medium text-white/75 transition-colors duration-150 hover:bg-navy-700/70 hover:text-white">
                <app-icon name="LogOut" />
                Logout
            </button>
        </div>
    </aside>
    `
};
