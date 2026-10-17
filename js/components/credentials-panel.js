// Shows sign-in details for a new or reset account. The temporary password is
// returned by the server once and never stored in plain text, so this is the only
// time the Coordinator can see it.
const CredentialsPanel = {
    components: { AppIcon },
    props: { credentials: { type: Object, required: true }, name: String },
    setup(props) {
        const copied = Vue.ref("");
        const copy = async (key, value) => {
            try {
                await navigator.clipboard.writeText(value);
                copied.value = key;
                setTimeout(() => { if (copied.value === key) copied.value = ""; }, 2000);
            } catch {
                Store.toast("warning", "Copy isn't available here. Select the text and copy it manually.");
            }
        };
        const rows = Vue.computed(() => {
            const list = [];
            if (props.credentials.saNumber) {
                list.push({ key: "saNumber", label: "S.A. Number", value: props.credentials.saNumber, mono: true });
            }
            list.push(
                { key: "username", label: "Username (Student ID)", value: props.credentials.username },
                { key: "email", label: "Or sign in with email", value: props.credentials.email },
                {
                    key: "password",
                    label: props.credentials.defaultPassword ? "Default password" : "Temporary password",
                    value: props.credentials.defaultPassword || props.credentials.temporaryPassword,
                    mono: true
                }
            );
            return list;
        });
        return { copied, copy, rows };
    },
    template: `
    <div>
        <dl class="divide-y divide-line overflow-hidden rounded-lg border border-line">
            <div v-for="row in rows" :key="row.key" class="flex items-center gap-3 px-4 py-3" :class="row.key === 'password' ? 'bg-gold/10' : (row.key === 'saNumber' ? 'bg-navy/5' : 'bg-white')">
                <div class="min-w-0 flex-1">
                    <dt class="text-caption text-muted">{{ row.label }}</dt>
                    <dd class="truncate text-[15px] font-semibold text-ink" :class="row.mono ? 'font-mono tracking-wider' : ''">{{ row.value }}</dd>
                </div>
                <button type="button" @click="copy(row.key, row.value)" class="btn btn-secondary btn-sm"
                        :aria-label="'Copy ' + row.label.toLowerCase()">
                    <app-icon :name="copied === row.key ? 'Check' : 'Copy'" :size="14" />
                    {{ copied === row.key ? 'Copied' : 'Copy' }}
                </button>
            </div>
        </dl>
        <p class="mt-3 flex items-start gap-2 text-caption text-muted">
            <app-icon name="TriangleAlert" :size="14" class="mt-0.5 shrink-0 text-warning" />
            <span v-if="credentials.mustChangePassword">
                Default password: <strong class="font-mono text-ink">ncst123456789</strong>. Give this to {{ name || 'the S.A.' }} privately. They will be automatically redirected to create their own new password upon their very first login.
            </span>
            <span v-else>
                This password is shown only once. Give it to {{ name || 'the S.A.' }} privately. They must replace it the first time they sign in.
            </span>
        </p>
    </div>
    `
};
