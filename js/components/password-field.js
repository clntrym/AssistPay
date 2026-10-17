// <password-field id="new-password" label="New password" v-model="form.newPassword"
//                 autocomplete="new-password" :error="errors.newPassword" />
const PasswordField = {
    components: { AppIcon },
    props: {
        id: { type: String, required: true },
        label: { type: String, required: true },
        modelValue: { type: String, default: "" },
        autocomplete: { type: String, default: "current-password" },
        error: String,
        hint: String,
        disabled: Boolean
    },
    emits: ["update:modelValue"],
    setup() {
        const visible = Vue.ref(false);
        const capsLock = Vue.ref(false);
        const checkCaps = e => { capsLock.value = !!e.getModifierState?.("CapsLock"); };
        return { visible, capsLock, checkCaps };
    },
    template: `
    <div>
        <label :for="id" class="mb-1.5 block text-[13px] font-medium text-ink">{{ label }}</label>
        <div class="relative">
            <app-icon name="LockKeyhole" :size="18" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input :id="id" :value="modelValue" @input="$emit('update:modelValue', $event.target.value)"
                   :type="visible ? 'text' : 'password'" :autocomplete="autocomplete" :disabled="disabled"
                   maxlength="128" data-password-field="true" @keyup="checkCaps" @keydown="checkCaps"
                   :aria-invalid="!!error" :aria-describedby="error ? id + '-error' : (hint ? id + '-hint' : null)"
                   class="w-full rounded-lg border bg-white py-2.5 pl-10 pr-11 text-body text-ink transition-colors duration-150 focus:outline-none focus:ring-2 disabled:bg-page"
                   :class="error ? 'border-danger focus:border-danger focus:ring-danger/15' : 'border-line focus:border-navy focus:ring-navy/15'">
            <button type="button" @click="visible = !visible"
                    class="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted hover:bg-mist hover:text-navy"
                    :aria-label="visible ? 'Hide password' : 'Show password'" :aria-pressed="visible">
                <app-icon :name="visible ? 'EyeOff' : 'Eye'" :size="18" />
            </button>
        </div>
        <p v-if="error" :id="id + '-error'" class="mt-1.5 flex items-start gap-1.5 text-caption text-danger">
            <app-icon name="CircleX" :size="14" class="mt-0.5" /> {{ error }}
        </p>
        <p v-else-if="capsLock" class="mt-1.5 flex items-center gap-1.5 text-caption text-warning">
            <app-icon name="TriangleAlert" :size="14" /> Caps Lock is on.
        </p>
        <p v-else-if="hint" :id="id + '-hint'" class="mt-1.5 text-caption text-muted">{{ hint }}</p>
    </div>
    `
};
