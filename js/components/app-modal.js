// <app-modal :open="show" title="Reset password?" @close="show = false" size="md">
//     body...
//     <template #footer> buttons </template>
// </app-modal>
// Closes on Escape and backdrop click (unless `persistent`), traps focus inside.
const AppModal = {
    components: { AppIcon },
    props: {
        open: Boolean,
        title: { type: String, required: true },
        description: String,
        icon: String,
        tone: { type: String, default: "navy" }, // navy | danger | warning | success
        size: { type: String, default: "md" },   // sm | md | lg | xl
        z: { type: String, default: "z-[55]" },  // z-index class
        persistent: Boolean                      // can't be dismissed by Esc/backdrop
    },
    emits: ["close"],
    setup(props, { emit }) {
        const panel = Vue.ref(null);
        let lastFocus = null;
        const titleId = "modal-" + Math.random().toString(36).slice(2, 8);

        const tones = {
            navy: "bg-mist text-navy", danger: "bg-danger/10 text-danger",
            warning: "bg-warning/10 text-warning", success: "bg-success/10 text-success"
        };
        const widths = { sm: "max-w-sm", md: "max-w-lg", lg: "max-w-3xl", xl: "max-w-5xl", "2xl": "max-w-6xl", full: "max-w-7xl" };

        const close = () => { if (!props.persistent) emit("close"); };

        const onKey = e => {
            if (!props.open) return;
            if (e.key === "Escape") close();
            if (e.key === "Tab" && panel.value) {
                const f = [...panel.value.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
                    .filter(el => !el.disabled && el.offsetParent !== null);
                if (!f.length) return;
                if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
                else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
            }
        };

        Vue.watch(() => props.open, async open => {
            if (open) {
                lastFocus = document.activeElement;
                document.body.style.overflow = "hidden";
                await Vue.nextTick();
                (panel.value?.querySelector("[autofocus]") || panel.value?.querySelector("button, input, select, textarea"))?.focus();
            } else {
                document.body.style.overflow = "";
                lastFocus?.focus?.();
            }
        });
        Vue.onMounted(() => document.addEventListener("keydown", onKey));
        Vue.onUnmounted(() => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; });

        return { panel, titleId, tones, widths, close };
    },
    template: `
    <teleport to="body">
        <transition enter-active-class="transition duration-150 ease-out" enter-from-class="opacity-0"
                    leave-active-class="transition duration-100 ease-in" leave-to-class="opacity-0">
            <div v-if="open" class="fixed inset-0 flex items-end justify-center bg-navy/50 p-0 sm:items-center sm:p-4"
                 :class="z" @mousedown.self="close">
                <div ref="panel" role="dialog" aria-modal="true" :aria-labelledby="titleId"
                     class="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-lift sm:rounded-xl"
                     :class="widths[size]">
                    <div class="flex items-start gap-3 border-b border-line px-5 py-4 sm:px-6">
                        <span v-if="icon" class="grid h-10 w-10 shrink-0 place-items-center rounded-full" :class="tones[tone]">
                            <app-icon :name="icon" :size="20" />
                        </span>
                        <div class="min-w-0 flex-1">
                            <h2 :id="titleId" class="text-card-title text-ink">{{ title }}</h2>
                            <p v-if="description" class="mt-0.5 text-body text-muted">{{ description }}</p>
                        </div>
                        <button v-if="!persistent" @click="close" class="-mr-1 rounded-md p-1.5 text-muted hover:bg-page hover:text-ink" aria-label="Close">
                            <app-icon name="X" :size="18" />
                        </button>
                    </div>
                    <div class="overflow-y-auto px-5 py-5 sm:px-6"><slot /></div>
                    <div v-if="$slots.footer" class="flex flex-col-reverse gap-2 border-t border-line bg-page px-5 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:px-6">
                        <slot name="footer" />
                    </div>
                </div>
            </div>
        </transition>
    </teleport>
    `
};
