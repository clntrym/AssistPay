// Read-only S.A. record (PDF: Personal, Academic, Class Schedule, S.A. Assignment,
// Supervisor, Account Status — plus benefits and emergency contact).
// mode="admin" for the Coordinator, mode="self" for the S.A.'s own My Profile.
const SaProfileView = {
    components: { AppIcon, StatusBadge },
    props: {
        sa: { type: Object, required: true },
        mode: { type: String, default: "admin" },
        // Which cards to render. Left out, every card shows; the S.A. record page
        // passes a subset so each of its tabs holds one part of the record.
        only: { type: Array, default: null }
    },
    setup(props) {
        const sections = Vue.computed(() => {
            const s = props.sa;
            return {
                personal: [
                    ["S.A. Number", s.saNumber || "Not assigned"],
                    ["Student ID", s.studentId],
                    ["Full name", [s.firstName, s.middleName, s.lastName, s.suffix].filter(Boolean).join(" ")],
                    ["Date of birth", Format.date(s.birthDate)],
                    ["Sex", label("sex", s.sex)],
                    ["Contact number", Format.text(s.contactNumber)],
                    ["School email", s.schoolEmail],
                    ["Personal email", Format.text(s.personalEmail)]
                ],
                academic: [
                    ["Course / program", s.course],
                    ["Year level", label("yearLevel", s.yearLevel)],
                    ["Semester of record", s.semester.label],
                    ["Academic status", label("academicStatus", s.academicStatus)],
                    ["Enrollment status", label("enrollmentStatus", s.enrollmentStatus)],
                    ["Expected graduation", Format.month(s.expectedGraduation)]
                ],
                assignment: [
                    ["S.A. category", label("saCategory", s.saCategory)],
                    ["Department type", label("departmentType", s.departmentType)],
                    ["Department / office", s.office ? s.office.name : label("departmentType", s.departmentType)],
                    ["Disciplinary standing", label("disciplinaryStatus", s.disciplinaryStatus || "GOOD_STANDING") + (s.underAgreementAt ? " (since " + Format.date(s.underAgreementAt) + ")" : "")],
                    ["Appointment", Format.date(s.appointmentStart) + (s.appointmentEnd ? " to " + Format.date(s.appointmentEnd) : " (no end date)")],
                    ["Weekly target hours", s.weeklyTargetHours + " hrs/week"],
                    ["Reliever", s.isReliever ? "Yes" : "No"]
                ],
                emergency: [
                    ["Contact name", Format.text(s.emergencyName)],
                    ["Contact number", Format.text(s.emergencyNumber)],
                    ["Relationship", Format.text(s.emergencyRelationship)]
                ]
            };
        });
        const gridViewMode = Vue.ref("grid");

        const DAYS_LIST = [
            { code: "MON", label: "MON", name: "Monday" },
            { code: "TUE", label: "TUE", name: "Tuesday" },
            { code: "WED", label: "WED", name: "Wednesday" },
            { code: "THU", label: "THU", name: "Thursday" },
            { code: "FRI", label: "FRI", name: "Friday" },
            { code: "SAT", label: "SAT", name: "Saturday" },
            { code: "SUN", label: "SUN", name: "Sunday" }
        ];

        const dayNames = { MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday", SUN: "Sunday" };

        const formatTime12 = (m) => {
            const hrs = Math.floor(m / 60);
            const mins = m % 60;
            const h12 = hrs % 12 === 0 ? 12 : hrs % 12;
            const ampm = hrs >= 12 ? "PM" : "AM";
            return `${h12}:${String(mins).padStart(2, "0")}${ampm}`;
        };

        const TIME_SLOTS = [];
        for (let m = 420; m < 1320; m += 30) {
            const startStr = formatTime12(m);
            const endStr = formatTime12(m + 30);
            TIME_SLOTS.push({ min: m, label: `${startStr} - ${endStr}`, startStr, endStr });
        }

        const parseMin = (tStr) => {
            if (!tStr) return 420;
            const str = String(tStr).trim();
            const m12 = str.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
            if (m12) {
                let h = parseInt(m12[1], 10);
                const mins = parseInt(m12[2], 10);
                const ampm = (m12[3] || "").toUpperCase();
                if (ampm === "PM" && h < 12) h += 12;
                if (ampm === "AM" && h === 12) h = 0;
                return h * 60 + mins;
            }
            const m24 = str.match(/^(\d{1,2}):(\d{2})/);
            if (m24) return parseInt(m24[1], 10) * 60 + parseInt(m24[2], 10);
            return 420;
        };

        const normalizeDay = (d) => {
            if (!d) return "";
            const s = String(d).trim().toUpperCase();
            if (s.startsWith("MON")) return "MON";
            if (s.startsWith("TUE")) return "TUE";
            if (s.startsWith("WED")) return "WED";
            if (s.startsWith("THU")) return "THU";
            if (s.startsWith("FRI")) return "FRI";
            if (s.startsWith("SAT")) return "SAT";
            if (s.startsWith("SUN")) return "SUN";
            return s;
        };

        const getDayPeriods = (dayCode) => {
            return (props.sa.classes || []).filter(p => normalizeDay(p.day) === dayCode);
        };

        const getPeriodStyle = (p) => {
            const startM = parseMin(p.startTime);
            const endM = parseMin(p.endTime);
            const clampedStart = Math.max(420, Math.min(1320, startM));
            const clampedEnd = Math.max(clampedStart, Math.min(1320, endM));

            const topPx = ((clampedStart - 420) / 30) * 36;
            const durationMin = Math.max(30, clampedEnd - clampedStart);
            const heightPx = (durationMin / 30) * 36;

            return {
                top: `${topPx}px`,
                height: `${heightPx - 2}px`
            };
        };

        const COLOR_CLASSES = [
            { bg: "bg-sky-100/90", border: "border-sky-400", text: "text-sky-950", hover: "hover:bg-sky-200" },
            { bg: "bg-amber-100/90", border: "border-amber-400", text: "text-amber-950", hover: "hover:bg-amber-200" },
            { bg: "bg-purple-100/90", border: "border-purple-400", text: "text-purple-950", hover: "hover:bg-purple-200" },
            { bg: "bg-emerald-100/90", border: "border-emerald-400", text: "text-emerald-950", hover: "hover:bg-emerald-200" },
            { bg: "bg-rose-100/90", border: "border-rose-400", text: "text-rose-950", hover: "hover:bg-rose-200" },
            { bg: "bg-indigo-100/90", border: "border-indigo-400", text: "text-indigo-950", hover: "hover:bg-indigo-200" },
            { bg: "bg-teal-100/90", border: "border-teal-400", text: "text-teal-950", hover: "hover:bg-teal-200" }
        ];

        const getPeriodColor = (p, idx) => {
            const key = (p.subject || "") + (p.id || idx);
            let hash = 0;
            for (let i = 0; i < key.length; i++) hash = (hash << 5) - hash + key.charCodeAt(i);
            const colorIdx = Math.abs(hash) % COLOR_CLASSES.length;
            return COLOR_CLASSES[colorIdx];
        };

        const parseSubjectParts = (subjectStr) => {
            const s = String(subjectStr || "").trim();
            const parts = s.split(/\s*-\s*/);
            if (parts.length > 1) {
                return { code: parts[0], title: parts.slice(1).join(" - ") };
            }
            return { code: s, title: "" };
        };

        const copiedSaNumber = Vue.ref(false);
        const copySaNumber = async (num) => {
            if (!num) return;
            try {
                await navigator.clipboard.writeText(num);
                copiedSaNumber.value = true;
                Store.toast("success", `Copied S.A. Number: ${num}`);
                setTimeout(() => { copiedSaNumber.value = false; }, 2000);
            } catch (e) {
                Store.toast("info", `S.A. Number: ${num}`);
            }
        };

        const show = key => !props.only || props.only.includes(key);
        return { sections, dayNames, show, Format, label, gridViewMode, DAYS_LIST, TIME_SLOTS,
                 getDayPeriods, getPeriodStyle, getPeriodColor, parseSubjectParts,
                 copiedSaNumber, copySaNumber };
    },
    template: `
    <div class="grid gap-5 lg:grid-cols-2">

        <!-- Personal -->
        <section v-if="show('personal')" class="card p-5 sm:p-6 shadow-xs" :class="{ 'lg:col-span-2': only && only.length === 1 }" aria-labelledby="sec-personal">
            <h2 id="sec-personal" class="mb-4 flex items-center gap-2 text-card-title text-navy"><app-icon name="User" :size="18" /> Personal information</h2>
            <dl class="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <div v-for="[k, v] in sections.personal" :key="k">
                    <dt class="text-caption text-muted">{{ k }}</dt>
                    <dd class="break-words text-body font-medium text-ink flex items-center gap-2">
                        <span :class="k === 'S.A. Number' ? 'font-mono font-bold text-navy bg-navy/10 px-2 py-0.5 rounded text-[13px]' : ''">{{ v }}</span>
                        <button v-if="k === 'S.A. Number' && sa.saNumber" type="button" @click="copySaNumber(sa.saNumber)"
                                class="text-slate-400 hover:text-navy transition-colors inline-flex items-center"
                                :title="'Copy S.A. Number: ' + sa.saNumber">
                            <app-icon :name="copiedSaNumber ? 'Check' : 'Copy'" :size="14" />
                        </button>
                    </dd>
                </div>
            </dl>
        </section>

        <!-- Academic -->
        <section v-if="show('academic')" class="card p-5 sm:p-6 shadow-xs" :class="{ 'lg:col-span-2': only && only.length === 1 }" aria-labelledby="sec-academic">
            <h2 id="sec-academic" class="mb-4 flex items-center gap-2 text-card-title text-navy"><app-icon name="GraduationCap" :size="18" /> Academic information</h2>
            <dl class="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <div v-for="[k, v] in sections.academic" :key="k">
                    <dt class="text-caption text-muted">{{ k }}</dt>
                    <dd class="text-body font-medium text-ink">{{ v }}</dd>
                </div>
            </dl>
        </section>

        <!-- S.A. assignment + supervisor -->
        <section v-if="show('assignment')" class="card p-5 sm:p-6 shadow-xs" :class="{ 'lg:col-span-2': only && only.length === 1 }" aria-labelledby="sec-assignment">
            <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
                <h2 id="sec-assignment" class="flex items-center gap-2 text-card-title text-navy"><app-icon name="Building2" :size="18" /> S.A. assignment</h2>
                <div class="flex flex-wrap gap-1.5">
                    <status-badge group="saStatus" :value="sa.saStatus" />
                    <status-badge group="assignmentStatus" :value="sa.assignmentStatus" />
                    <status-badge group="disciplinaryStatus" :value="sa.disciplinaryStatus || 'GOOD_STANDING'" />
                </div>
            </div>
            <dl class="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <div v-for="[k, v] in sections.assignment" :key="k">
                    <dt class="text-caption text-muted">{{ k }}</dt>
                    <dd class="text-body font-medium text-ink">{{ v }}</dd>
                </div>
            </dl>
            <div class="mt-5 flex items-center gap-3 rounded-lg bg-mist px-4 py-3">
                <span class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white text-navy"><app-icon name="UserCheck" :size="17" /></span>
                <div>
                    <p class="text-caption text-muted">Supervisor</p>
                    <p class="text-body font-semibold text-ink">{{ sa.supervisor ? sa.supervisor.name : 'Not assigned yet' }}</p>
                </div>
            </div>
        </section>

        <!-- Class schedule -->
        <section v-if="show('classes')" class="card p-5 sm:p-6 lg:col-span-2 shadow-xs" aria-labelledby="sec-classes">
            <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                    <h2 id="sec-classes" class="flex items-center gap-2 text-card-title text-navy"><app-icon name="CalendarDays" :size="18" /> Class schedule</h2>
                    <p class="text-caption text-muted mt-0.5">Synced from Registrar Certificate of Registration (COR)</p>
                </div>
                <div v-if="sa.classes && sa.classes.length" class="flex items-center gap-2">
                    <div class="flex rounded-lg border border-line bg-white p-0.5 text-caption font-semibold">
                        <button type="button" @click="gridViewMode = 'grid'"
                                class="flex items-center gap-1 rounded-md px-2.5 py-1 transition-all"
                                :class="gridViewMode === 'grid' ? 'bg-navy text-white shadow-xs' : 'text-muted hover:text-ink'">
                            <app-icon name="LayoutGrid" :size="13" /> Visual Grid (7am - 10pm)
                        </button>
                        <button type="button" @click="gridViewMode = 'table'"
                                class="flex items-center gap-1 rounded-md px-2.5 py-1 transition-all"
                                :class="gridViewMode === 'table' ? 'bg-navy text-white shadow-xs' : 'text-muted hover:text-ink'">
                            <app-icon name="List" :size="13" /> List View
                        </button>
                    </div>
                </div>
            </div>

            <!-- If classes exist -->
            <div v-if="sa.classes && sa.classes.length">
                <!-- Visual Grid Matrix -->
                <div v-if="gridViewMode === 'grid'" class="overflow-auto rounded-xl border border-line bg-white shadow-card max-h-[60vh]">
                    <div class="min-w-[900px]">
                        <!-- Dark Navy Header Row -->
                        <div class="sticky top-0 z-30 grid grid-cols-[130px_repeat(7,minmax(0,1fr))] bg-navy text-white text-[12px] font-bold shadow-xs">
                            <div class="sticky left-0 z-40 bg-navy px-2 py-2.5 border-r border-navy-700 text-center uppercase tracking-wider text-[11px]">
                                TIME
                            </div>
                            <div v-for="d in DAYS_LIST" :key="d.code" class="px-2 py-2.5 text-center border-r border-navy-700 uppercase tracking-wider last:border-r-0 text-[11px]">
                                {{ d.label }}
                            </div>
                        </div>

                        <!-- Grid Body (30 slots x 36px = 1080px total height) -->
                        <div class="relative grid grid-cols-[130px_repeat(7,minmax(0,1fr))] select-none" style="height: 1080px;">
                            <div class="sticky left-0 z-20 bg-mist/90 border-r border-line text-[11px] font-bold text-navy">
                                <div v-for="t in TIME_SLOTS" :key="t.min"
                                     class="h-9 px-1 flex items-center justify-center border-b border-line/40 text-[10px] font-bold text-navy whitespace-nowrap">
                                    {{ t.label }}
                                </div>
                            </div>

                            <div v-for="d in DAYS_LIST" :key="d.code" class="relative border-r border-line last:border-r-0 bg-white">
                                <div v-for="t in TIME_SLOTS" :key="t.min" class="h-9 border-b border-line/40 transition-colors hover:bg-navy/5"></div>

                                <div v-for="(c, idx) in getDayPeriods(d.code)" :key="idx"
                                     :style="getPeriodStyle(c)"
                                     :title="c.subject + ' (' + (c.section || '—') + ') | ' + c.startTime + ' - ' + c.endTime"
                                     class="absolute left-1 right-1 rounded-md border px-2 py-1.5 shadow-xs transition-all hover:z-30 hover:shadow-md cursor-default flex flex-col justify-between overflow-hidden"
                                     :class="[getPeriodColor(c, idx).bg, getPeriodColor(c, idx).border, getPeriodColor(c, idx).text, getPeriodColor(c, idx).hover]">
                                    <div class="min-w-0 flex-1 leading-snug">
                                        <div class="flex items-center justify-between gap-1">
                                            <span class="font-bold text-[11px] truncate">{{ parseSubjectParts(c.subject).code }}</span>
                                            <span v-if="c.section" class="rounded bg-black/10 px-1 py-0.2 text-[9px] font-bold shrink-0">{{ c.section }}</span>
                                        </div>
                                        <div v-if="parseSubjectParts(c.subject).title" class="text-[10px] opacity-90 truncate font-medium">
                                            {{ parseSubjectParts(c.subject).title }}
                                        </div>
                                    </div>
                                    <div class="text-[9px] font-bold opacity-75 mt-0.5 truncate">
                                        {{ c.startTime }} – {{ c.endTime }}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Traditional List View -->
                <ul v-else class="divide-y divide-line">
                    <li v-for="(c, i) in sa.classes" :key="i" class="flex items-baseline gap-3 py-2">
                        <span class="w-24 shrink-0 text-caption font-semibold text-navy">{{ dayNames[c.day] }}</span>
                        <span class="w-40 shrink-0 text-body text-ink">{{ c.startTime }} – {{ c.endTime }}</span>
                        <span class="text-body font-medium text-ink">{{ c.subject }}</span>
                        <span v-if="c.section" class="text-caption text-muted">{{ c.section }}</span>
                    </li>
                </ul>

                <p class="mt-3 text-caption text-muted">
                    Matching never schedules duty during these periods.
                </p>
            </div>

            <!-- Empty State -->
            <div v-else class="flex flex-col items-center rounded-lg border border-dashed border-line px-6 py-8 text-center">
                <app-icon name="FileSpreadsheet" :size="28" class="text-disabled" />
                <p class="mt-3 text-body font-medium text-ink">No class schedule yet</p>
                <p class="mt-1 max-w-sm text-caption text-muted">
                    {{ mode === 'admin'
                        ? 'Enrolled subjects are synced automatically from the Registrar (COR). Matching uses them to detect class conflicts.'
                        : 'Your class schedule is automatically synced from your official enrollment in the Registrar.' }}
                </p>
            </div>
        </section>

        <!-- Benefits & allowance (Extended Full-Width Card) -->
        <section v-if="show('benefits')" class="card p-5 sm:p-6 lg:col-span-2 shadow-xs" aria-labelledby="sec-benefits">
            <div class="mb-4 flex flex-col justify-between gap-2 border-b border-line pb-3.5 sm:flex-row sm:items-center">
                <div>
                    <h2 id="sec-benefits" class="flex items-center gap-2 text-card-title text-navy">
                        <app-icon name="Wallet" :size="20" class="text-navy" />
                        Benefits and Allowance
                    </h2>
                    <p class="text-caption text-muted mt-0.5">{{ sa.semester.label }} • Institutional Scholarship &amp; Duty Compensation</p>
                </div>
                <div class="flex items-center gap-2">
                    <span class="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-3 py-1 text-[12px] font-bold text-emerald-800">
                        <app-icon name="ShieldCheck" :size="14" class="text-emerald-600" />
                        100% Tuition + 70% Misc Covered
                    </span>
                </div>
            </div>

            <!-- Top Summary Cards (Allowance Rate + Estimated Balance) -->
            <div class="mb-5 grid gap-4 sm:grid-cols-2">
                <!-- Allowance Rate Card -->
                <div class="flex items-center justify-between rounded-xl border border-line bg-page/70 p-4 transition-all hover:border-navy/30">
                    <div class="flex items-center gap-3">
                        <div class="grid h-11 w-11 place-items-center rounded-xl bg-navy/10 text-navy">
                            <app-icon name="Coins" :size="22" />
                        </div>
                        <div>
                            <span class="text-caption font-semibold text-muted">Allowance Rate</span>
                            <div class="flex items-baseline gap-1.5 mt-0.5">
                                <span class="text-[20px] font-extrabold text-navy">{{ Format.peso(sa.benefits.effectiveHourlyRate) }}</span>
                                <span class="text-[12px] font-medium text-muted">/ hour</span>
                            </div>
                        </div>
                    </div>
                    <span class="rounded-lg bg-navy/5 border border-navy/10 px-2.5 py-1 text-[11px] font-semibold text-navy">
                        {{ sa.benefits.saHourlyRate ? 'Custom Rate for S.A.' : 'Standard ' + sa.semester.label }}
                    </span>
                </div>

                <!-- Remaining Balance Card -->
                <div class="flex items-center justify-between rounded-xl border border-line bg-page/70 p-4 transition-all hover:border-navy/30">
                    <div class="flex items-center gap-3">
                        <div class="grid h-11 w-11 place-items-center rounded-xl bg-amber-100 text-amber-900">
                            <app-icon name="Receipt" :size="22" />
                        </div>
                        <div>
                            <span class="text-caption font-semibold text-muted">Estimated Remaining School Balance</span>
                            <div class="flex items-baseline gap-1.5 mt-0.5">
                                <span class="text-[20px] font-extrabold text-navy">
                                    {{ sa.benefits.balance !== null ? Format.peso(sa.benefits.balance) : '₱0.00' }}
                                </span>
                            </div>
                        </div>
                    </div>
                    <span v-if="sa.benefits.balance !== null" class="rounded-lg px-2.5 py-1 text-[11px] font-bold"
                          :class="Number(sa.benefits.balance) <= 0 ? 'bg-emerald-100 text-emerald-900' : 'bg-amber-100 text-amber-900'">
                        {{ Number(sa.benefits.balance) <= 0 ? 'Fully Covered' : 'Balance Remaining' }}
                    </span>
                </div>
            </div>

            <!-- Fee Assessment Breakdown from Registrar COR -->
            <div v-if="sa.benefits.assessment" class="mb-5 rounded-xl border border-line bg-mist/40 p-4 sm:p-5">
                <div class="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-line/60 pb-2.5">
                    <span class="text-caption font-bold uppercase tracking-wider text-navy flex items-center gap-1.5">
                        <app-icon name="FileText" :size="14" class="text-navy" />
                        Fee Assessment Breakdown (Registrar COR)
                    </span>
                    <span class="rounded bg-navy/10 px-2.5 py-0.5 text-[11px] font-bold text-navy">
                        Cash Basis Assessment
                    </span>
                </div>
                <div class="grid grid-cols-2 gap-3 text-[12px] sm:grid-cols-3 lg:grid-cols-6">
                    <div class="rounded-lg bg-white p-3 border border-line/60 shadow-2xs">
                        <span class="text-[11px] font-medium text-muted block mb-0.5">Tuition Fee</span>
                        <span class="font-bold text-ink text-[13px]">{{ Format.peso(sa.benefits.assessment.tuitionFee) }}</span>
                    </div>
                    <div class="rounded-lg bg-white p-3 border border-line/60 shadow-2xs">
                        <span class="text-[11px] font-medium text-muted block mb-0.5">Laboratory Fee</span>
                        <span class="font-bold text-ink text-[13px]">{{ Format.peso(sa.benefits.assessment.labFee) }}</span>
                    </div>
                    <div class="rounded-lg bg-white p-3 border border-line/60 shadow-2xs">
                        <span class="text-[11px] font-medium text-muted block mb-0.5">Miscellaneous Fee</span>
                        <span class="font-bold text-ink text-[13px]">{{ Format.peso(sa.benefits.assessment.miscFee) }}</span>
                    </div>
                    <div class="rounded-lg bg-white p-3 border border-line/60 shadow-2xs">
                        <span class="text-[11px] font-medium text-muted block mb-0.5">LMS Fee</span>
                        <span class="font-bold text-ink text-[13px]">{{ Format.peso(sa.benefits.assessment.lmsFee) }}</span>
                    </div>
                    <div class="rounded-lg bg-white p-3 border border-line/60 shadow-2xs">
                        <span class="text-[11px] font-medium text-muted block mb-0.5">OMR Fee</span>
                        <span class="font-bold text-ink text-[13px]">{{ Format.peso(sa.benefits.assessment.omrFee) }}</span>
                    </div>
                    <div class="rounded-lg bg-navy/5 p-3 border border-navy/20 shadow-2xs">
                        <span class="text-[11px] font-bold text-navy block mb-0.5">Total Assessment</span>
                        <span class="font-extrabold text-navy text-[13px]">{{ Format.peso(sa.benefits.assessment.cashTotal) }}</span>
                    </div>
                </div>
                <p class="mt-2.5 text-[11px] italic text-muted">
                    * Assessment synced from Registrar Certificate of Registration (COR). Payment verification and official receipting are administered by Finance / Cashier.
                </p>
            </div>

            <!-- Scholarship Coverage & Balance Computation Table -->
            <div v-if="sa.benefits.balance !== null" class="overflow-hidden rounded-xl border border-line bg-white shadow-2xs">
                <table class="w-full text-body text-left">
                    <thead class="bg-page text-[11px] font-bold uppercase text-muted border-b border-line">
                        <tr>
                            <th class="py-2.5 px-4">Fee Item</th>
                            <th class="py-2.5 px-4 text-center">Institutional S.A. Benefit</th>
                            <th class="py-2.5 px-4 text-right">Assessed Amount</th>
                            <th class="py-2.5 px-4 text-right">Benefit Covered</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-line text-[13px]">
                        <tr>
                            <td class="py-2.5 px-4 font-medium text-ink">Tuition Fee</td>
                            <td class="py-2.5 px-4 text-center">
                                <span class="rounded bg-emerald-100 text-emerald-900 px-2 py-0.5 text-[11px] font-bold">
                                    {{ sa.benefits.tuitionCoveragePct }}% Free Tuition
                                </span>
                            </td>
                            <td class="py-2.5 px-4 text-right text-muted">{{ Format.peso(sa.benefits.tuitionFee) }}</td>
                            <td class="py-2.5 px-4 text-right font-bold text-emerald-700">
                                − {{ Format.peso(sa.benefits.tuitionCovered || sa.benefits.tuitionFee) }}
                            </td>
                        </tr>
                        <tr>
                            <td class="py-2.5 px-4 font-medium text-ink">Miscellaneous Fee</td>
                            <td class="py-2.5 px-4 text-center">
                                <span class="rounded bg-sky-100 text-sky-900 px-2 py-0.5 text-[11px] font-bold">
                                    {{ sa.benefits.miscCoveragePct }}% Discount
                                </span>
                            </td>
                            <td class="py-2.5 px-4 text-right text-muted">{{ Format.peso(sa.benefits.miscFee) }}</td>
                            <td class="py-2.5 px-4 text-right font-bold text-emerald-700">
                                − {{ Format.peso(sa.benefits.miscCovered || (sa.benefits.miscFee * 0.7)) }}
                            </td>
                        </tr>
                        <tr class="bg-emerald-50/50">
                            <td colspan="2" class="py-3 px-4 font-bold text-emerald-900">
                                Total Covered by S.A. Benefit (100% Tuition + 70% Misc)
                            </td>
                            <td class="py-3 px-4 text-right font-bold text-muted">
                                {{ Format.peso((sa.benefits.tuitionFee || 0) + (sa.benefits.miscFee || 0)) }}
                            </td>
                            <td class="py-3 px-4 text-right font-extrabold text-emerald-700 text-[14px]">
                                − {{ Format.peso(sa.benefits.totalCovered || ((sa.benefits.tuitionCovered || 0) + (sa.benefits.miscCovered || 0))) }}
                            </td>
                        </tr>
                        <tr class="bg-page">
                            <td colspan="2" class="py-3.5 px-4 font-bold text-navy text-[14px]">
                                Estimated Remaining School Balance
                            </td>
                            <td colspan="2" class="py-3.5 px-4 text-right font-extrabold text-[18px] text-navy">
                                {{ Format.peso(sa.benefits.balance) }}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <p v-else class="rounded-lg bg-page px-4 py-3 text-caption text-muted">
                Tuition and miscellaneous fees haven't been entered for this semester.
            </p>
        </section>

        <!-- Emergency + account -->
        <section v-if="show('account')" class="card p-5 sm:p-6 shadow-xs" :class="{ 'lg:col-span-2': only && only.length === 1 }" aria-labelledby="sec-account">
            <h2 class="mb-4 flex items-center gap-2 text-card-title text-navy"><app-icon name="Phone" :size="18" /> Emergency contact</h2>
            <dl class="grid gap-x-6 gap-y-3 sm:grid-cols-3">
                <div v-for="[k, v] in sections.emergency" :key="k">
                    <dt class="text-caption text-muted">{{ k }}</dt>
                    <dd class="text-body font-medium text-ink">{{ v }}</dd>
                </div>
            </dl>

            <h2 id="sec-account" class="mb-4 mt-6 flex items-center gap-2 border-t border-line pt-5 text-card-title text-navy"><app-icon name="ShieldCheck" :size="18" /> Account status</h2>
            <dl class="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                <div>
                    <dt class="text-caption text-muted">Username</dt>
                    <dd class="text-body font-medium text-ink">{{ sa.account.username }}</dd>
                </div>
                <div>
                    <dt class="text-caption text-muted">Status</dt>
                    <dd class="mt-0.5"><status-badge group="accountStatus" :value="sa.account.status" /></dd>
                </div>
                <div>
                    <dt class="text-caption text-muted">Last sign-in</dt>
                    <dd class="text-body font-medium text-ink">{{ sa.account.lastLoginAt ? Format.dateTime(sa.account.lastLoginAt) : 'Never' }}</dd>
                </div>
                <div v-if="mode === 'admin'">
                    <dt class="text-caption text-muted">Password</dt>
                    <dd class="text-body font-medium text-ink">{{ sa.account.mustChangePassword ? 'Temporary, not yet changed' : 'Set by the S.A.' }}</dd>
                </div>
            </dl>
        </section>
    </div>
    `
};
