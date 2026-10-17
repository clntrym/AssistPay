const RegistrarAcademicDocsPage = {
    components: { AppIcon, PageHeader, AppModal },

    setup() {
        const students    = Vue.ref([]);
        const searchQuery = Vue.ref('');
        const selected    = Vue.ref(null);
        const docs        = Vue.ref([]);
        const loading     = Vue.ref(false);
        const uploading   = Vue.ref(false);
        const error       = Vue.ref('');
        const previewDoc  = Vue.ref(null);
        const uploadTarget = Vue.ref(null); // student being uploaded to (modal)
        const dragging    = Vue.ref(false);
        const fileInput   = Vue.ref(null);

        const fetchStudents = async () => {
            loading.value = true;
            const r = await Model.request('students/academic_docs', 'list_students');
            loading.value = false;
            if (r.success) students.value = r.students;
        };

        Vue.onMounted(fetchStudents);

        const filteredStudents = Vue.computed(() => {
            const q = searchQuery.value.trim().toLowerCase();
            if (!q) return students.value;
            return students.value.filter(s =>
                s.student_number.toLowerCase().includes(q) ||
                s.name.toLowerCase().includes(q)
            );
        });

        const selectStudent = async s => {
            selected.value = s;
            docs.value = [];
            error.value = '';
            const r = await Model.request('students/academic_docs', 'list_cors', { studentId: s.id });
            if (r.success) docs.value = r.docs;
        };

        // Open upload modal for a specific student
        const openUpload = s => {
            uploadTarget.value = s;
            error.value = '';
            dragging.value = false;
        };

        const closeUpload = () => { uploadTarget.value = null; error.value = ''; };

        const pick = () => fileInput.value?.click();

        const handleFile = async file => {
            error.value = '';
            if (!file) return;
            if (!/\.(png|jpe?g|webp)$/i.test(file.name)) {
                error.value = 'Choose a photo (.jpg, .png, or .webp) of the COR.';
                if (fileInput.value) fileInput.value.value = '';
                return;
            }
            if (file.size > 10 * 1024 * 1024) {
                error.value = 'That image is over 10 MB. Use a smaller file.';
                if (fileInput.value) fileInput.value.value = '';
                return;
            }

            const target = uploadTarget.value || selected.value;
            if (!target) return;

            uploading.value = true;
            try {
                const dataUrl = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = e => resolve(e.target.result);
                    reader.onerror = () => reject(new Error('Could not read the file.'));
                    reader.readAsDataURL(file);
                });

                const r = await Model.request('students/academic_docs', 'upload_cor', {
                    studentId: target.id,
                    document: { data: dataUrl, type: file.type, name: file.name }
                });

                if (r.success) {
                    // Update counts in student list
                    const entry = students.value.find(s => s.id === target.id);
                    if (entry) {
                        entry.cor_count    = String(parseInt(entry.cor_count    || 0) + 1);
                        entry.pending_count = String(parseInt(entry.pending_count || 0) + 1);
                    }
                    closeUpload();
                    Store.toast('success', 'COR uploaded — redirecting to Pending Review.');
                    // Give the toast a moment to show, then navigate
                    setTimeout(() => router.push('/registrar/documents/pending'), 900);
                } else {
                    error.value = r.message || 'Upload failed.';
                }
            } catch (e) {
                error.value = e.message || 'Upload failed.';
            } finally {
                uploading.value = false;
                if (fileInput.value) fileInput.value.value = '';
            }
        };

        const onDrop = e => { dragging.value = false; handleFile(e.dataTransfer?.files?.[0]); };

        const deleteDoc = async doc => {
            const ok = await Alerts.confirm({
                title: 'Delete this COR?',
                html: `Remove <b class="text-ink">${Alerts.esc(doc.file_name)}</b>? This cannot be undone.`,
                icon: 'warning', danger: true, confirmText: 'Delete', cancelText: 'Cancel'
            });
            if (!ok) return;
            const r = await Model.request('students/academic_docs', 'delete_cor', { id: doc.id });
            if (r.success) {
                Store.toast('success', 'Document deleted.');
                docs.value = docs.value.filter(d => d.id !== doc.id);
                if (previewDoc.value?.id === doc.id) previewDoc.value = null;
                const entry = students.value.find(s => s.id === selected.value?.id);
                if (entry && parseInt(entry.cor_count) > 0) entry.cor_count = String(parseInt(entry.cor_count) - 1);
            } else {
                Alerts.error('Could not delete', r.message);
            }
        };

        const docUrl = doc => `api/students/cor_doc.php?id=${doc.id}`;

        const fmtSize = bytes => {
            const n = parseInt(bytes) || 0;
            if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
            return (n / (1024 * 1024)).toFixed(1) + ' MB';
        };

        return {
            students, searchQuery, selected, docs, loading, uploading, error,
            previewDoc, uploadTarget, dragging, fileInput, filteredStudents,
            selectStudent, openUpload, closeUpload, pick, handleFile, onDrop,
            deleteDoc, docUrl, fmtSize
        };
    },

    template: `
    <div>
        <page-header title="Academic Documents" subtitle="Upload and manage students' Certificates of Registration." section="Documents" />

        <div class="grid gap-6 lg:grid-cols-[340px_1fr]">

            <!-- Student list -->
            <div class="card flex flex-col">
                <div class="border-b border-line px-4 py-3">
                    <div class="relative">
                        <app-icon name="Search" :size="15" class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                        <input v-model="searchQuery" type="search" placeholder="Search by name or ID…"
                               class="input pl-9 py-2 text-[13px]" aria-label="Search students">
                    </div>
                </div>

                <div v-if="loading" class="flex items-center justify-center py-10 text-muted">
                    <app-icon name="LoaderCircle" :size="22" class="animate-spin" />
                </div>

                <ul v-else-if="filteredStudents.length" class="divide-y divide-line overflow-y-auto" style="max-height:calc(100vh - 240px)">
                    <li v-for="s in filteredStudents" :key="s.id"
                        class="flex items-center gap-2 px-3 py-2.5 transition-colors hover:bg-mist"
                        :class="selected?.id === s.id ? 'bg-navy/[0.06]' : ''">
                        <!-- Click row to view COR -->
                        <button @click="selectStudent(s)" class="min-w-0 flex-1 text-left">
                            <p class="truncate text-[13px] font-semibold text-ink leading-snug">{{ s.name }}</p>
                            <p class="truncate text-caption text-muted">{{ s.student_number }}</p>
                        </button>
                        <!-- Pending badge -->
                        <span v-if="parseInt(s.pending_count)"
                              class="shrink-0 rounded-full bg-warning/20 px-2 py-0.5 text-[11px] font-bold text-warning">
                            {{ s.pending_count }} pending
                        </span>
                        <!-- Approved COR badge -->
                        <span v-else-if="parseInt(s.cor_count)"
                              class="shrink-0 rounded-full bg-navy/10 px-2 py-0.5 text-[11px] font-bold text-navy">
                            {{ s.cor_count }}
                        </span>
                        <!-- Upload button always visible -->
                        <button @click.stop="openUpload(s)"
                                class="shrink-0 grid h-8 w-8 place-items-center rounded-lg border border-line bg-white text-navy hover:bg-navy hover:text-white transition-colors"
                                :title="'Upload COR for ' + s.name">
                            <app-icon name="Upload" :size="14" />
                        </button>
                    </li>
                </ul>

                <p v-else class="py-10 text-center text-caption text-muted">No students found.</p>
            </div>

            <!-- COR display panel -->
            <div>
                <div v-if="!selected" class="card flex flex-col items-center justify-center gap-3 py-24 text-center">
                    <span class="grid h-16 w-16 place-items-center rounded-2xl bg-mist text-navy">
                        <app-icon name="FileText" :size="28" />
                    </span>
                    <p class="text-body font-semibold text-ink">Select a student</p>
                    <p class="max-w-xs text-caption text-muted">Click a student's name to view their uploaded COR, or click the upload button to add one.</p>
                </div>

                <template v-else>
                    <div class="card mb-4 flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                        <div class="flex items-center gap-3">
                            <span class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-navy/10 text-navy font-bold text-[16px]">
                                {{ selected.name.charAt(0).toUpperCase() }}
                            </span>
                            <div>
                                <p class="font-semibold text-ink">{{ selected.name }}</p>
                                <p class="text-caption text-muted">{{ selected.student_number }}</p>
                            </div>
                        </div>
                        <button @click="openUpload(selected)" class="btn btn-primary btn-sm">
                            <app-icon name="Upload" :size="14" /> Upload COR
                        </button>
                    </div>

                    <div v-if="docs.length" class="space-y-4">
                        <div v-for="doc in docs" :key="doc.id" class="card overflow-hidden">
                            <div class="relative bg-page">
                                <img :src="docUrl(doc)" :alt="doc.file_name"
                                     class="w-full object-contain max-h-[72vh] cursor-zoom-in"
                                     @click="previewDoc = doc" loading="lazy">
                                <button @click="previewDoc = doc"
                                        class="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg bg-white/90 shadow text-ink hover:bg-white"
                                        title="View full size">
                                    <app-icon name="Maximize2" :size="14" />
                                </button>
                            </div>
                            <div class="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5">
                                <div class="min-w-0">
                                    <p class="truncate text-[13px] font-medium text-ink">{{ doc.file_name }}</p>
                                    <p class="text-caption text-muted">
                                        {{ fmtSize(doc.file_size) }} &middot; {{ doc.uploaded_at }}
                                        <template v-if="doc.uploaded_by"> &middot; {{ doc.uploaded_by }}</template>
                                    </p>
                                </div>
                                <button @click="deleteDoc(doc)"
                                        class="shrink-0 grid h-8 w-8 place-items-center rounded-md text-muted hover:bg-danger/5 hover:text-danger transition-colors"
                                        title="Delete">
                                    <app-icon name="Trash2" :size="14" />
                                </button>
                            </div>
                        </div>
                    </div>

                    <div v-else class="card flex flex-col items-center gap-2 py-14 text-center">
                        <app-icon name="FileImage" :size="36" class="text-muted opacity-30" />
                        <p class="text-body text-muted">No COR uploaded yet.</p>
                        <button @click="openUpload(selected)" class="btn btn-primary btn-sm mt-1">
                            <app-icon name="Upload" :size="14" /> Upload COR
                        </button>
                    </div>
                </template>
            </div>
        </div>

        <!-- Upload modal -->
        <app-modal :open="!!uploadTarget" size="md" icon="Upload"
                   :title="uploadTarget ? 'Upload COR — ' + uploadTarget.name : 'Upload COR'"
                   @close="closeUpload" :persistent="uploading">
            <template v-if="uploadTarget">
                <p class="mb-4 text-caption text-muted">
                    Student no. <strong class="text-ink">{{ uploadTarget.student_number }}</strong>
                </p>

                <!-- Drop zone -->
                <div class="rounded-xl border-2 border-dashed p-6 text-center transition-colors cursor-pointer"
                     :class="dragging ? 'border-navy bg-mist' : 'border-line'"
                     @click="pick" @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop">
                    <app-icon name="ImageUp" :size="32" class="mx-auto mb-2" :class="dragging ? 'text-navy' : 'text-muted'" />
                    <p class="text-body font-medium text-ink">Drop the COR photo here</p>
                    <p class="mt-1 text-caption text-muted">or click to browse your files</p>
                    <p class="mt-1 text-caption text-disabled">JPG, PNG, WEBP — up to 10 MB</p>
                </div>

                <input ref="fileInput" type="file" accept=".png,.jpg,.jpeg,.webp" class="sr-only"
                       @change="handleFile($event.target.files[0])" aria-label="Select COR image">

                <p v-if="error" class="mt-3 flex items-start gap-2 text-body text-danger" role="alert">
                    <app-icon name="CircleX" :size="16" class="mt-0.5 shrink-0" /> {{ error }}
                </p>

                <div v-if="uploading" class="mt-3 flex items-center gap-2 text-body text-muted">
                    <app-icon name="LoaderCircle" :size="16" class="animate-spin shrink-0" /> Uploading…
                </div>
            </template>
            <template #footer>
                <button @click="closeUpload" :disabled="uploading" class="btn btn-secondary">Cancel</button>
                <button @click="pick" :disabled="uploading" class="btn btn-primary">
                    <app-icon :name="uploading ? 'LoaderCircle' : 'Upload'" :size="15" :class="uploading ? 'animate-spin' : ''" />
                    {{ uploading ? 'Uploading…' : 'Choose File' }}
                </button>
            </template>
        </app-modal>

        <!-- Full-size preview modal -->
        <app-modal :open="!!previewDoc" size="xl" icon="FileImage"
                   :title="previewDoc?.file_name || 'Certificate of Registration'"
                   @close="previewDoc = null">
            <template v-if="previewDoc">
                <div class="overflow-auto rounded-lg border border-line bg-page">
                    <img :src="docUrl(previewDoc)" :alt="previewDoc.file_name" class="mx-auto block w-full object-contain">
                </div>
                <p class="mt-2 text-caption text-muted">
                    {{ fmtSize(previewDoc.file_size) }} &middot; {{ previewDoc.uploaded_at }}
                    <template v-if="previewDoc.uploaded_by"> &middot; {{ previewDoc.uploaded_by }}</template>
                </p>
            </template>
            <template #footer>
                <a :href="previewDoc ? docUrl(previewDoc) : '#'" target="_blank" rel="noopener" class="btn btn-secondary">
                    <app-icon name="ExternalLink" :size="14" /> Open in tab
                </a>
                <button @click="previewDoc = null" class="btn btn-primary">Close</button>
            </template>
        </app-modal>
    </div>
    `
};
