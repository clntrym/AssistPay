// Toast notifications. Trigger with: Store.toast("success", "Semester created successfully.")
// Status is shown with an icon + text, never color alone.
const ToastStack = {
    components: { AppIcon },
    setup() {
        const styles = {
            success: { icon: "CircleCheck", bar: "bg-success", text: "text-success" },
            warning: { icon: "TriangleAlert", bar: "bg-warning", text: "text-warning" },
            danger: { icon: "CircleX", bar: "bg-danger", text: "text-danger" },
            info: { icon: "Info", bar: "bg-info", text: "text-info" }
        };
        const hasSwal = typeof Swal !== "undefined";
        return { Store, styles, hasSwal };
    },
    template: `
    <div v-if="!hasSwal && Store.toasts && Store.toasts.length" class="pointer-events-none fixed right-4 top-4 z-[60] flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2"
         aria-live="polite" role="status">
        <transition-group
            enter-active-class="transition duration-200 ease-out"
            enter-from-class="translate-y-[-6px] opacity-0"
            leave-active-class="transition duration-150 ease-in"
            leave-to-class="opacity-0">
            <div v-for="t in Store.toasts" :key="t.id"
                 class="pointer-events-auto relative flex items-start gap-3 overflow-hidden rounded-lg border border-line bg-white py-3 pl-4 pr-3 shadow-lift">
                <span class="absolute inset-y-0 left-0 w-1" :class="styles[t.type].bar"></span>
                <app-icon :name="styles[t.type].icon" :size="18" :class="styles[t.type].text" class="mt-0.5" />
                <p class="flex-1 text-body text-ink">{{ t.message }}</p>
                <button @click="Store.dismiss(t.id)"
                        class="rounded p-0.5 text-muted transition-colors duration-150 hover:bg-page hover:text-ink"
                        aria-label="Dismiss notification">
                    <app-icon name="X" :size="16" />
                </button>
            </div>
        </transition-group>
    </div>
    `
};
