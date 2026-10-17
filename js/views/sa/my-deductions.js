// Student Assistant > My Deductions.
// S.A. views deduction announcements/polls posted by the Coordinator
// and replies whether they wish to avail of voluntary deductions (Yes/No).
const SaDeductionsPage = {
    components: { AppIcon, PageHeader, AppModal, FormField },

    setup() {
        const loading = Vue.ref(true);
        const loadError = Vue.ref("");
        const semester = Vue.ref(null);
        const campaigns = Vue.ref([]);

        // Reply Modal
        const showReplyModal = Vue.ref(false);
        const targetCampaign = Vue.ref(null);
        const replyForm = Vue.reactive({
            choice: "YES",
            amount: 500,
            notes: ""
        });
        const submitting = Vue.ref(false);

        const typeLabels = {
            TUITION: "Tuition Fee Balance"
        };

        const load = async () => {
            loading.value = true;
            loadError.value = "";
            const r = await Model.request("deductions", "list_campaigns");
            loading.value = false;
            if (!r.success) {
                loadError.value = r.message || "Failed to load deduction announcements.";
                return;
            }
            semester.value = r.semester;
            campaigns.value = r.campaigns || [];
        };

        Vue.onMounted(load);

        const openReplyModal = (c) => {
            targetCampaign.value = c;
            if (c.myResponse) {
                replyForm.choice = c.myResponse.choice || "YES";
                replyForm.amount = c.myResponse.amount || c.defaultAmount || 0;
                replyForm.notes = c.myResponse.notes || "";
            } else {
                replyForm.choice = "YES";
                replyForm.amount = c.defaultAmount || 500;
                replyForm.notes = "";
            }
            showReplyModal.value = true;
        };

        const submitReply = async () => {
            if (!targetCampaign.value) return;

            const ok = await Alerts.confirm({
                title: "Submit Deduction Response?",
                html: `Are you sure you want to submit your answer as <b>${replyForm.choice}</b>${replyForm.choice === "YES" ? ` (₱${Number(replyForm.amount || 0).toLocaleString("en-US", { minimumFractionDigits: 2 })})` : ""}?`,
                confirmText: "Yes, Submit Response",
                requireReason: false
            });
            if (!ok) return;

            submitting.value = true;
            const r = await Model.request("deductions", "sa_respond", {
                campaignId: targetCampaign.value.id,
                choice: replyForm.choice,
                amount: replyForm.choice === "YES" ? (Number(replyForm.amount) || 0) : 0,
                notes: replyForm.notes.trim()
            });
            submitting.value = false;
            if (!r.success) {
                Alerts.error("Submission Failed", r.message || "Failed to submit response.");
                return;
            }
            await Alerts.success("Response Saved", "Your deduction response has been recorded successfully!");
            showReplyModal.value = false;
            load();
        };

        const fmtPeso = val => "₱" + (Number(val) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        return {
            loading, loadError, semester, campaigns, load,
            showReplyModal, targetCampaign, replyForm, submitting,
            openReplyModal, submitReply, typeLabels, fmtPeso, Format
        };
    },

    template: `
    <div class="space-y-6">
        <!-- Page Header -->
        <page-header 
            title="My Allowance Deductions" 
            subtitle="View payroll deduction polls from the S.A. Coordinator and indicate if you wish to deduct from your monthly allowance."
            :breadcrumbs="[
                { label: 'Schedule', to: '/sa/schedule' },
                { label: 'My Deductions' }
            ]" />

        <!-- Loading / Error -->
        <div v-if="loading" class="card p-12 text-center text-muted">
            <app-icon name="LoaderCircle" :size="32" class="mx-auto mb-3 animate-spin text-navy" />
            <p class="font-medium text-ink">Loading deduction announcements…</p>
        </div>

        <div v-else-if="loadError" class="card border-danger/30 bg-danger/5 p-6 text-danger">
            <div class="flex items-center gap-3">
                <app-icon name="CircleAlert" :size="20" class="shrink-0" />
                <p class="font-medium">{{ loadError }}</p>
            </div>
        </div>

        <!-- No Campaigns State -->
        <div v-else-if="!campaigns.length" class="card p-12 text-center">
            <div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-mist text-muted">
                <app-icon name="Inbox" :size="32" />
            </div>
            <h2 class="text-[18px] font-bold text-navy">No Active Deduction Announcements</h2>
            <p class="mx-auto mt-2 max-w-md text-body text-muted">
                There are currently no deduction announcements posted for {{ semester?.label || 'this semester' }}. When the Coordinator posts one, you will receive a notification here.
            </p>
        </div>

        <!-- Campaign Cards -->
        <div v-else class="space-y-4">
            <div v-for="c in campaigns" :key="c.id" class="card p-5 transition hover:border-navy/40">
                <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div class="space-y-2">
                        <div class="flex flex-wrap items-center gap-2">
                            <h2 class="text-[18px] font-bold text-navy">{{ c.title }}</h2>
                            <span class="rounded bg-navy/10 px-2 py-0.5 text-[11px] font-semibold text-navy">
                                {{ typeLabels[c.deductionType] || c.deductionType }}
                            </span>
                            <span class="rounded px-2 py-0.5 text-[11px] font-bold uppercase"
                                  :class="c.status === 'OPEN' ? 'bg-success/15 text-success' : 'bg-gray-200 text-muted'">
                                {{ c.status }}
                            </span>
                        </div>

                        <p v-if="c.description" class="text-body text-ink">
                            {{ c.description }}
                        </p>

                        <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-muted">
                            <span>Posted: {{ Format.date(c.createdAt) }}</span>
                            <span v-if="c.deadline">Deadline: <b class="text-ink">{{ Format.date(c.deadline) }}</b></span>
                            <span v-if="c.defaultAmount > 0">Suggested Amount: <b class="text-ink">{{ fmtPeso(c.defaultAmount) }}</b></span>
                        </div>
                    </div>

                    <!-- Right Action Button -->
                    <div class="shrink-0">
                        <button v-if="c.status === 'OPEN' && !c.myResponse" @click="openReplyModal(c)" 
                                class="btn btn-sm btn-primary">
                            <app-icon name="Vote" :size="15" />
                            Respond to Poll
                        </button>
                        <span v-else-if="c.status !== 'OPEN'" class="text-caption font-semibold text-muted">
                            Poll Closed
                        </span>
                    </div>
                </div>

                <!-- My Current Response Status Banner -->
                <div class="mt-4 border-t border-line pt-3">
                    <div v-if="c.myResponse" class="rounded-lg p-3.5 transition"
                         :class="c.myResponse.choice === 'YES' ? 'bg-success/10 border border-success/30' : 'bg-gray-100 border border-line'">
                        <div class="flex items-start justify-between">
                            <div class="flex items-start gap-2.5">
                                <app-icon :name="c.myResponse.choice === 'YES' ? 'CheckCircle2' : 'XCircle'" :size="18" 
                                          :class="c.myResponse.choice === 'YES' ? 'text-success mt-0.5' : 'text-muted mt-0.5'" />
                                <div>
                                    <p class="font-bold text-[14px]"
                                       :class="c.myResponse.choice === 'YES' ? 'text-success' : 'text-ink'">
                                        {{ c.myResponse.choice === 'YES' ? 'You opted in for deduction: ' + fmtPeso(c.myResponse.amount) : 'You declined this deduction poll.' }}
                                    </p>
                                    <p v-if="c.myResponse.notes" class="mt-0.5 text-caption text-ink">
                                        Note: {{ c.myResponse.notes }}
                                    </p>
                                    <p class="mt-1 text-caption text-muted">
                                        Submitted on {{ Format.dateTime(c.myResponse.repliedAt) }}
                                    </p>
                                </div>
                            </div>
                            <span class="rounded px-2 py-0.5 text-[11px] font-bold uppercase"
                                  :class="c.myResponse.choice === 'YES' ? 'bg-success/20 text-success' : 'bg-gray-200 text-muted'">
                                {{ c.myResponse.status }}
                            </span>
                        </div>
                    </div>

                    <div v-else class="flex items-center justify-between rounded-lg border border-warning/30 bg-warning/10 p-3.5 text-warning">
                        <div class="flex items-center gap-2 text-body">
                            <app-icon name="Clock" :size="16" />
                            <span class="font-medium">You haven't responded to this deduction announcement yet.</span>
                        </div>
                        <button v-if="c.status === 'OPEN'" @click="openReplyModal(c)" class="text-caption font-bold underline hover:text-navy">
                            Respond Now →
                        </button>
                    </div>
                </div>
            </div>
        </div>

        <!-- Modal: Submit S.A. Response -->
        <app-modal :open="showReplyModal" :title="'Respond to: ' + targetCampaign?.title" @close="showReplyModal = false">
            <div v-if="targetCampaign" class="space-y-4">
                <div class="rounded-lg bg-mist/60 p-3.5">
                    <p class="font-bold text-navy">{{ targetCampaign.title }}</p>
                    <p v-if="targetCampaign.description" class="mt-1 text-caption text-ink">{{ targetCampaign.description }}</p>
                </div>

                <form-field label="Do you wish to avail of allowance deductions?" required>
                    <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <label class="flex cursor-pointer items-center gap-3 rounded-lg border p-3.5 transition"
                               :class="replyForm.choice === 'YES' ? 'border-success bg-success/10 font-bold text-success' : 'border-line bg-page text-muted'">
                            <input type="radio" value="YES" v-model="replyForm.choice" class="text-success" />
                            <div>
                                <p class="text-body font-bold text-ink">Yes, please deduct</p>
                                <p class="text-caption text-muted">Deduct from my monthly allowance</p>
                            </div>
                        </label>

                        <label class="flex cursor-pointer items-center gap-3 rounded-lg border p-3.5 transition"
                               :class="replyForm.choice === 'NO' ? 'border-navy bg-mist font-bold text-navy' : 'border-line bg-page text-muted'">
                            <input type="radio" value="NO" v-model="replyForm.choice" class="text-navy" />
                            <div>
                                <p class="text-body font-bold text-ink">No, do not deduct</p>
                                <p class="text-caption text-muted">I will not avail of this deduction</p>
                            </div>
                        </label>
                    </div>
                </form-field>

                <div v-if="replyForm.choice === 'YES'" class="space-y-3 rounded-lg border border-line bg-mist/30 p-3.5">
                    <form-field label="Deduction Amount (₱)" required>
                        <input v-model="replyForm.amount" type="number" step="0.5" min="1" 
                               class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none" />
                        <p class="mt-1 text-caption text-muted">
                            Suggested amount: {{ fmtPeso(targetCampaign.defaultAmount) }}. You may adjust according to your remaining balance.
                        </p>
                    </form-field>

                    <form-field label="Purpose / Remarks (Optional)">
                        <input v-model="replyForm.notes" type="text" placeholder="e.g. Tuition fee balance for prelims"
                               class="w-full rounded-lg border border-line bg-page px-3.5 py-2.5 text-body focus:border-navy focus:outline-none" />
                    </form-field>
                </div>
            </div>

            <template #footer>
                <div class="flex items-center justify-end gap-2">
                    <button @click="showReplyModal = false" class="btn btn-outline" :disabled="submitting">Cancel</button>
                    <button @click="submitReply" class="btn btn-primary" :disabled="submitting">
                        <app-icon :name="submitting ? 'LoaderCircle' : 'Check'" :size="16" :class="submitting ? 'animate-spin' : ''" />
                        {{ submitting ? 'Submitting…' : 'Submit Response' }}
                    </button>
                </div>
            </template>
        </app-modal>
    </div>
    `
};

