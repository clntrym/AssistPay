// Label + control + error/hint. The control goes in the default slot and receives
// { id, invalid } so it can link itself to the label and error message.
//
// <form-field label="First name" required :error="errors.firstName" v-slot="f">
//     <input :id="f.id" v-model="form.firstName" class="input" :class="{ 'input-error': f.invalid }" :aria-invalid="f.invalid">
// </form-field>
const FormField = {
    components: { AppIcon },
    props: {
        label: { type: String, required: true },
        required: Boolean,
        error: String,
        hint: String,
        id: String
    },
    setup(props) {
        const fieldId = props.id || "f-" + Math.random().toString(36).slice(2, 9);
        return { fieldId };
    },
    template: `
    <div>
        <label :for="fieldId" class="field-label">
            {{ label }}<span v-if="required" class="text-danger" aria-hidden="true"> *</span>
            <span v-if="required" class="sr-only"> (required)</span>
        </label>
        <slot :id="fieldId" :invalid="!!error" />
        <p v-if="error" class="mt-1.5 flex items-start gap-1.5 text-caption text-danger" role="alert">
            <app-icon name="CircleX" :size="14" class="mt-0.5" /> {{ error }}
        </p>
        <p v-else-if="hint" class="mt-1.5 text-caption text-muted">{{ hint }}</p>
    </div>
    `
};
