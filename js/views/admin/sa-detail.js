// One S.A. record (Coordinator).
// The header answers the questions asked of a record at a glance — where they
// are deployed, who supervises them, how many hours their week holds and whether
// their class schedule is on file — and the tabs hold the rest of the record.
const SaDetailPage = {
    components: { AppIcon, PageHeader, StatusBadge, SaProfileView, AppModal, CredentialsPanel, SaDisciplinaryPanel },

    setup() {
        const route = VueRouter.useRoute();
        const sa = Vue.ref(null);
        const week = Vue.ref(null);          // classes + duty for the running semester
        const loading = Vue.ref(true);
        const loadError = Vue.ref("");
        const tab = Vue.ref(route.query.tab || "OVERVIEW");

        const DAYS = { MON: "Monday", TUE: "Tuesday", WED: "Wednesday", THU: "Thursday", FRI: "Friday", SAT: "Saturday", SUN: "Sunday" };

        const activeSemester = Vue.ref(null);
        const isEnrollmentMode = Vue.computed(() => {
            const sem = activeSemester.value || Store.semester;
            return (sem?.dutyScheduleMode || '').toUpperCase() === 'ENROLLMENT';
        });

        const load = async () => {
            loading.value = true;
            loadError.value = "";
            const r = await Model.request("sa", "get", { id: Number(route.params.id) });
            loading.value = false;
            if (!r.success) { loadError.value = r.message; return; }
            if (r.semester) activeSemester.value = r.semester;
            sa.value = r.sa;
            const w = await Model.request("scheduling", "sa_schedule", { saProfileId: sa.value.id });
            if (w.success) week.value = w;
        };

        // ---------- Secret Face Biometric Tab & Keyboard / Click Triggers ----------
        const secretFaceUnlocked = Vue.ref(false);

        const toggleSecretFace = () => {
            secretFaceUnlocked.value = !secretFaceUnlocked.value;
            if (secretFaceUnlocked.value) {
                tab.value = "FACE";
                Store.toast("info", "Secret Face Biometrics mode unlocked! (Shortcut: Alt+F)");
            } else {
                if (tab.value === "FACE") tab.value = "OVERVIEW";
                stopCamera();
                Store.toast("info", "Secret Face Biometrics tab closed.");
            }
        };

        const handleKeyDown = (e) => {
            if ((e.altKey && e.key.toLowerCase() === 'f') || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f')) {
                e.preventDefault();
                toggleSecretFace();
            }
        };

        Vue.onMounted(() => {
            load();
            window.addEventListener('keydown', handleKeyDown);
        });

        Vue.onUnmounted(() => {
            window.removeEventListener('keydown', handleKeyDown);
            stopCamera();
        });

        Vue.watch(tab, (newTab) => {
            if (newTab !== "FACE") {
                stopCamera();
            }
        });

        Vue.watch(() => route.query.tab, (newTab) => {
            if (newTab) tab.value = newTab;
        });

        Vue.watch(() => route.params.id, (newId, oldId) => {
            if (newId && newId !== oldId) {
                if (route.query.tab) tab.value = route.query.tab;
                load();
            }
        });

        // ---------- Face Recognition Biometrics Engine ----------
        const faceVideoRef = Vue.ref(null);
        const isCameraActive = Vue.ref(false);
        const isModelLoading = Vue.ref(false);
        const isFaceDetecting = Vue.ref(false);
        const faceDetected = Vue.ref(false);
        const faceDetectionScore = Vue.ref(0);
        const faceStatusMessage = Vue.ref("Camera is closed. Click button below to activate webcam.");
        const cameraError = Vue.ref("");
        const faceSnapshot = Vue.ref("");
        const faceDescriptor = Vue.ref(null);
        const savingFace = Vue.ref(false);
        let faceDetectInterval = null;
        let webcamStream = null;
        let modelsLoaded = false;

        const loadFaceModels = async () => {
            if (modelsLoaded) return true;
            isModelLoading.value = true;
            faceStatusMessage.value = "Initializing biometric neural network...";
            try {
                if (typeof faceapi === "undefined") {
                    throw new Error("face-api library is not loaded.");
                }
                const modelsPath = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '') + '/models';
                try {
                    await Promise.all([
                        faceapi.nets.tinyFaceDetector.loadFromUri(modelsPath),
                        faceapi.nets.faceLandmark68Net.loadFromUri(modelsPath),
                        faceapi.nets.faceRecognitionNet.loadFromUri(modelsPath)
                    ]);
                } catch (e1) {
                    console.warn("Retrying models with relative path 'models'...", e1);
                    await Promise.all([
                        faceapi.nets.tinyFaceDetector.loadFromUri('models'),
                        faceapi.nets.faceLandmark68Net.loadFromUri('models'),
                        faceapi.nets.faceRecognitionNet.loadFromUri('models')
                    ]);
                }
                modelsLoaded = true;
                isModelLoading.value = false;
                return true;
            } catch (err) {
                console.error("Failed to load face detection models:", err);
                cameraError.value = "Failed to load facial recognition models. Please check network/models folder.";
                isModelLoading.value = false;
                faceStatusMessage.value = "Failed to load neural models.";
                return false;
            }
        };

        const stopCamera = () => {
            if (faceDetectInterval) {
                clearInterval(faceDetectInterval);
                faceDetectInterval = null;
            }
            if (webcamStream) {
                webcamStream.getTracks().forEach(track => {
                    try { track.stop(); } catch (e) {}
                });
                webcamStream = null;
            }
            if (faceVideoRef.value) {
                faceVideoRef.value.srcObject = null;
            }
            isCameraActive.value = false;
            isFaceDetecting.value = false;
            faceDetected.value = false;
            faceDetectionScore.value = 0;
            faceStatusMessage.value = "Camera is closed. Click button below to activate webcam.";
        };

        const startFaceDetectionLoop = () => {
            if (faceDetectInterval) clearInterval(faceDetectInterval);
            faceDetectInterval = setInterval(async () => {
                if (!isCameraActive.value || !faceVideoRef.value || faceVideoRef.value.paused || faceVideoRef.value.ended) {
                    return;
                }
                if (isFaceDetecting.value) return;

                isFaceDetecting.value = true;
                try {
                    const videoEl = faceVideoRef.value;
                    if (videoEl && videoEl.readyState >= 2) {
                        const opt = new faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
                        const detection = await faceapi.detectSingleFace(videoEl, opt);
                        if (detection) {
                            faceDetected.value = true;
                            faceDetectionScore.value = Math.round(detection.score * 100);
                            faceStatusMessage.value = `Face detected (${faceDetectionScore.value}% confidence). Ready to capture!`;
                        } else {
                            faceDetected.value = false;
                            faceDetectionScore.value = 0;
                            faceStatusMessage.value = "Looking for face... Please center inside the oval guide.";
                        }
                    }
                } catch (e) {
                    console.debug("Detection loop:", e);
                } finally {
                    isFaceDetecting.value = false;
                }
            }, 350);
        };

        const startCamera = async () => {
            cameraError.value = "";
            isFaceDetecting.value = false;
            faceDetected.value = false;
            faceStatusMessage.value = "Requesting camera access...";

            const ok = await loadFaceModels();
            if (!ok) return;

            try {
                if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                    throw new Error("Your browser or connection does not support webcam access.");
                }

                const stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        width: { ideal: 640 },
                        height: { ideal: 480 },
                        facingMode: "user"
                    },
                    audio: false
                });

                webcamStream = stream;
                isCameraActive.value = true;
                faceStatusMessage.value = "Align face inside the viewfinder guide.";

                await Vue.nextTick();
                if (faceVideoRef.value) {
                    faceVideoRef.value.srcObject = stream;
                    faceVideoRef.value.play().catch(e => console.warn("Video play error:", e));
                    startFaceDetectionLoop();
                }
            } catch (err) {
                console.error("Webcam access error:", err);
                stopCamera();
                if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                    cameraError.value = "Camera permission was denied. Please allow camera access in browser settings.";
                } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
                    cameraError.value = "No camera device found on this system.";
                } else {
                    cameraError.value = "Could not activate webcam: " + (err.message || err.name);
                }
            }
        };

        const captureFace = async () => {
            if (!faceVideoRef.value) return;
            const videoEl = faceVideoRef.value;

            faceStatusMessage.value = "Analyzing facial landmarks and extracting descriptor...";
            isFaceDetecting.value = true;

            try {
                const opt = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 });
                const detection = await faceapi.detectSingleFace(videoEl, opt)
                    .withFaceLandmarks()
                    .withFaceDescriptor();

                if (!detection || !detection.descriptor) {
                    Alerts.toast("warning", "No clear face detected. Please face the camera directly with good lighting.");
                    faceStatusMessage.value = "No clear face detected. Center yourself and try again.";
                    isFaceDetecting.value = false;
                    return;
                }

                const descArray = Array.from(detection.descriptor);
                if (descArray.length !== 128) {
                    Alerts.error("Biometric Error", "Could not generate 128-point biometric descriptor.");
                    isFaceDetecting.value = false;
                    return;
                }

                const canvas = document.createElement("canvas");
                canvas.width = videoEl.videoWidth || 640;
                canvas.height = videoEl.videoHeight || 480;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
                const snapshotDataUrl = canvas.toDataURL("image/jpeg", 0.88);

                faceDescriptor.value = descArray;
                faceSnapshot.value = snapshotDataUrl;
                faceStatusMessage.value = "Face biometric successfully captured!";

                stopCamera();
                Store.toast("success", "Face biometric profile captured successfully! Click Save to apply.");
            } catch (err) {
                console.error("Capture face error:", err);
                Alerts.error("Capture Failed", "An error occurred while capturing face biometrics: " + (err.message || err));
            } finally {
                isFaceDetecting.value = false;
            }
        };

        const retakeFace = () => {
            faceSnapshot.value = "";
            faceDescriptor.value = null;
            startCamera();
        };

        const cancelCapture = () => {
            faceSnapshot.value = "";
            faceDescriptor.value = null;
        };

        const saveFaceBiometrics = async () => {
            if (!faceDescriptor.value || !sa.value) return;
            savingFace.value = true;
            try {
                const r = await Model.request("sa", "save_face", {
                    saProfileId: sa.value.id,
                    faceDescriptor: JSON.stringify(faceDescriptor.value),
                    facePhoto: faceSnapshot.value
                });
                if (!r.success) {
                    Alerts.error("Saving Failed", r.message || "Could not save biometrics.");
                    return;
                }
                await Alerts.success("Biometrics Saved", r.message || "Face recognition biometrics saved successfully!");
                sa.value = r.sa;
                faceSnapshot.value = "";
                faceDescriptor.value = null;
                stopCamera();
            } catch (e) {
                console.error("saveFaceBiometrics:", e);
                Alerts.error("Error", "Failed to save biometric profile: " + (e.message || e));
            } finally {
                savingFace.value = false;
            }
        };

        const onDisciplinaryStatusChanged = ({ disciplinaryStatus, underAgreementAt }) => {
            if (sa.value) {
                sa.value.disciplinaryStatus = disciplinaryStatus;
                sa.value.underAgreementAt = underAgreementAt;
            }
        };

        const tabs = Vue.computed(() => {
            const list = [
                { value: "OVERVIEW", label: "Overview", icon: "LayoutDashboard" },
                { value: "WARNINGS", label: "Warnings & Attendance", icon: "ShieldAlert" },
                { value: "STUDENT", label: "Student information", icon: "User" },
                { value: "DEPLOYMENT", label: "Department & deployment", icon: "Building2" },
                { value: "CLASSES", label: "Class schedule", icon: "CalendarDays" },
                { value: "ACCOUNT", label: "Account", icon: "KeyRound" },
                { value: "BALANCE", label: "School balance", icon: "Wallet" }
            ];
            if (secretFaceUnlocked.value || sa.value?.biometrics?.hasFace) {
                list.push({
                    value: "FACE",
                    label: secretFaceUnlocked.value ? "Face recognition (Secret)" : "Face recognition",
                    icon: "ScanFace",
                    secret: true
                });
            }
            return list;
        });
        const sectionsFor = Vue.computed(() => ({
            STUDENT: ["personal", "academic"],
            DEPLOYMENT: ["assignment"],
            CLASSES: ["classes"],
            ACCOUNT: ["account"],
            BALANCE: ["benefits"]
        }[tab.value] || []));

        // ---------- the four figures in the header ----------
        const tiles = Vue.computed(() => {
            const s = sa.value;
            const w = week.value;
            if (!s) return [];
            const places = w && w.duty.length
                ? [...new Set(w.duty.map(d => d.location))].join(", ")
                : null;
            return [
                { label: "Deployment", value: places || "Not deployed yet", icon: "MapPin",
                  hint: places ? (w.duty.length + " period(s) this semester") : "Set by the finalized schedule",
                  tone: places ? "text-navy" : "text-muted" },
                { label: "Supervisor", value: s.supervisor ? s.supervisor.name : "None", icon: "UserCheck",
                  hint: s.office ? s.office.name : label("departmentType", s.departmentType),
                  tone: s.supervisor ? "text-navy" : "text-muted" },
                { label: "Weekly duty", value: w ? w.creditedHours + " hrs" : "—", icon: "Clock",
                  hint: w && w.dutyHours !== w.creditedHours
                      ? w.dutyHours + " hrs on the grid, less breaks"
                      : "Target " + s.weeklyTargetHours + " hrs",
                  tone: "text-navy" },
                { label: "Schedule check", value: !w ? "—" : (w.clashes.length ? w.clashes.length + " clash(es)"
                      : (w.classes.length ? "All clear" : "No class schedule")),
                  icon: w && w.clashes.length ? "TriangleAlert" : (w && w.classes.length ? "CircleCheck" : "Hourglass"),
                  hint: !w ? "" : (w.clashes.length ? "Duty sits on top of a class"
                      : (w.classes.length ? w.classes.length + " class period(s) on file" : "Duty for them is provisional")),
                  tone: w && w.clashes.length ? "text-danger" : (w && w.classes.length ? "text-success" : "text-warning") }
            ];
        });

        // duty grouped by day, for the Current assignment table
        const dutyByDay = Vue.computed(() => {
            const out = [];
            (week.value?.blocks || []).forEach(b => {
                const row = out.find(r => r.day === b.day);
                if (row) row.blocks.push(b);
                else out.push({ day: b.day, blocks: [b] });
            });
            return out;
        });
        const classesByDay = Vue.computed(() => {
            const out = [];
            (week.value?.classes || []).forEach(c => {
                const row = out.find(r => r.day === c.day);
                if (row) row.rows.push(c);
                else out.push({ day: c.day, rows: [c] });
            });
            return out;
        });

        // ---------- account ----------
        const resetting = Vue.ref(false);
        const credentials = Vue.ref(null);
        const emailNotice = Vue.ref(null);
        const resetPassword = async () => {
            const ok = await Alerts.confirm({
                title: "Reset password?",
                html: `A new temporary password will be created for <b class="text-ink">${Alerts.esc(sa.value.name)}</b> and emailed to their registered Gmail / school email.<br>`
                    + `<span class="text-caption">Their current password stops working right away, and they must set a new one at the next sign-in.</span>`,
                icon: "warning", confirmText: "Reset password"
            });
            if (!ok) return;
            resetting.value = true;
            const r = await Model.request("sa", "reset_password", { id: sa.value.id });
            resetting.value = false;
            if (!r.success) { Alerts.error("Couldn't reset the password", r.message); return; }
            credentials.value = r.credentials;
            emailNotice.value = r.emailNotice || null;
            await Alerts.success("Password Created", "Temporary password created successfully.");
            if (r.emailNotice && !r.emailNotice.sent) {
                Store.toast("warning", "Password reset, but the email could not be sent. Give the credentials manually.");
            }
            load();
        };

        // ---------- off the roster, and back ----------
        const busy = Vue.ref(false);
        const archive = async () => {
            const assigned = sa.value.assignmentStatus === "ASSIGNED";
            const reason = await Alerts.prompt({
                title: "Archive this S.A.?",
                html: `<b class="text-ink">${Alerts.esc(sa.value.name)}</b> (${Alerts.esc(sa.value.studentId)}) comes off the roster: `
                    + `no duty, no sign-in, and they leave the matching pool. The record and their history stay.`
                    + (assigned ? `<br><span class="text-danger">They are assigned duty this semester, and that duty is freed.</span>` : "")
                    + `<br><span class="text-caption">You can restore them later.</span>`,
                label: "Why are they being archived?",
                placeholder: "Graduated, resigned, dropped the programme…",
                danger: true, confirmText: "Archive S.A."
            });
            if (reason === null) return;

            busy.value = true;
            const r = await Model.request("sa", "archive", { id: sa.value.id, reason });
            busy.value = false;
            if (!r.success) { Alerts.error("Couldn't archive this S.A.", r.errors?.reason || r.message); return; }
            sa.value = r.sa;
            await Alerts.success("S.A. Archived", `${r.sa.name} archived successfully.`);
        };

        const restore = async () => {
            const ok = await Alerts.confirm({
                title: "Restore this S.A.?",
                html: `<b class="text-ink">${Alerts.esc(sa.value.name)}</b> goes back on the roster as Active and Unassigned, `
                    + `and can sign in again.<br><span class="text-caption">They rejoin the pool at the next matching run.</span>`,
                confirmText: "Restore S.A."
            });
            if (!ok) return;
            busy.value = true;
            const r = await Model.request("sa", "restore", { id: sa.value.id });
            busy.value = false;
            if (!r.success) { Alerts.error("Couldn't restore this S.A.", r.message); return; }
            sa.value = r.sa;
            await Alerts.success("S.A. Restored", `${r.sa.name} is back on the roster.`);
        };

        const initials = Vue.computed(() => sa.value ? (sa.value.firstName[0] + sa.value.lastName[0]).toUpperCase() : "");

        const reviewingPlot = Vue.ref(false);
        const reviewPlotted = async status => {
            reviewingPlot.value = true;
            const r = await Model.request("scheduling", "review_plotted_duty", {
                saProfileId: sa.value.id,
                status: status
            });
            reviewingPlot.value = false;
            if (!r.success) {
                Alerts.error("Review failed", r.message);
                return;
            }
            Store.toast("success", r.message);
            const w = await Model.request("scheduling", "sa_schedule", { saProfileId: sa.value.id });
            if (w.success) week.value = w;
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

        return { sa, week, loading, loadError, load, tab, tabs, sectionsFor, tiles, dutyByDay, classesByDay, DAYS,
                 resetting, credentials, emailNotice, resetPassword, initials, busy, archive, restore, label, Format,
                 reviewingPlot, reviewPlotted, onDisciplinaryStatusChanged,
                 secretFaceUnlocked, toggleSecretFace, faceVideoRef, isCameraActive, isModelLoading, isFaceDetecting,
                 faceDetected, faceDetectionScore, faceStatusMessage, cameraError, faceSnapshot, faceDescriptor,
                 savingFace, startCamera, stopCamera, captureFace, retakeFace, cancelCapture, saveFaceBiometrics, isEnrollmentMode,
                 copiedSaNumber, copySaNumber };
    },

    template: `
    <router-link to="/admin/sa-management" class="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-navy">
        <app-icon name="ArrowLeft" :size="15" /> All S.A.s
    </router-link>

    <div v-if="loading" class="space-y-4" aria-busy="true">
        <div class="h-40 animate-pulse rounded-xl bg-white"></div>
        <div class="grid gap-5 lg:grid-cols-2"><div v-for="n in 4" :key="n" class="h-56 animate-pulse rounded-xl bg-white"></div></div>
    </div>

    <div v-else-if="loadError" class="card flex flex-col items-center px-6 py-12 text-center">
        <app-icon name="CircleX" :size="28" class="text-danger" />
        <p class="mt-3 text-body font-medium text-ink">Couldn't load this S.A.</p>
        <p class="mt-1 text-caption text-muted">{{ loadError }}</p>
        <button @click="load" class="btn btn-secondary btn-sm mt-4"><app-icon name="RefreshCw" :size="14" /> Try again</button>
    </div>

    <template v-else>
        <!-- ------------------------------------------------ who they are -->
        <section class="mb-5 overflow-hidden rounded-xl bg-navy text-white shadow-sm">
            <div class="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
                <button type="button" @click="toggleSecretFace"
                        title="Secret Face Recognition Biometrics (Click or press Alt+F / Ctrl+Shift+F)"
                        class="group relative grid h-16 w-16 shrink-0 place-items-center rounded-full bg-white/10 text-[20px] font-bold text-white ring-2 ring-gold/70 transition-all hover:scale-105 hover:ring-cyan-400 focus:outline-none cursor-pointer">
                    <span>{{ initials }}</span>
                    <span class="absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full shadow-md transition-all"
                          :class="secretFaceUnlocked ? 'bg-cyan-400 text-slate-950 ring-2 ring-navy scale-110' : 'bg-white/20 text-white/80 group-hover:bg-cyan-400 group-hover:text-slate-950'">
                        <app-icon name="ScanFace" :size="12" />
                    </span>
                </button>
                <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2.5">
                        <h1 class="text-[24px] font-bold leading-tight">{{ sa.name }}</h1>
                        <span v-if="sa.saNumber" class="inline-flex items-center gap-1.5 rounded-md bg-gold/20 text-gold px-2.5 py-0.5 font-mono text-[12px] font-bold border border-gold/30">
                            <span>S.A. No: {{ sa.saNumber }}</span>
                            <button type="button" @click.stop="copySaNumber(sa.saNumber)" class="text-gold/80 hover:text-white transition-colors" title="Copy S.A. Number">
                                <app-icon :name="copiedSaNumber ? 'Check' : 'Copy'" :size="13" />
                            </button>
                        </span>
                    </div>
                    <p class="mt-0.5 text-body text-white/70">
                        Student ID: <span class="font-semibold text-white">{{ sa.studentId }}</span> · {{ sa.course }} {{ label('yearLevel', sa.yearLevel) }} ·
                        {{ sa.office ? sa.office.name : label('saCategory', sa.saCategory) }}
                    </p>
                    <div class="mt-2 flex flex-wrap items-center gap-1.5">
                        <span v-if="sa.archivedAt" class="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[12px] font-semibold text-white/80">
                            <app-icon name="Archive" :size="12" /> Archived
                        </span>
                        <status-badge v-if="isEnrollmentMode" group="saStatus" :value="sa.saStatus" />
                        <status-badge group="assignmentStatus" :value="sa.assignmentStatus" />
                        <status-badge group="disciplinaryStatus" :value="sa.disciplinaryStatus || 'GOOD_STANDING'" />
                        <status-badge v-if="sa.account.status === 'PENDING_ACTIVATION'" group="accountStatus" :value="sa.account.status" />
                    </div>
                </div>
                <div class="flex flex-wrap gap-2">
                    <button v-if="secretFaceUnlocked" type="button" @click="tab = 'FACE'" class="btn bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold flex items-center gap-1.5">
                        <app-icon name="ScanFace" :size="16" /> Face biometrics
                    </button>
                    <button v-if="sa.archivedAt" @click="restore" :disabled="busy" class="btn btn-secondary">
                        <app-icon name="ArchiveRestore" :size="16" /> Restore
                    </button>
                    <template v-else>
                        <button @click="archive" :disabled="busy" class="btn btn-secondary text-danger">
                            <app-icon name="Archive" :size="16" /> Archive
                        </button>
                        <button @click="resetPassword" class="btn btn-secondary" :disabled="sa.account.status === 'INACTIVE'"
                                :title="sa.account.status === 'INACTIVE' ? 'Set the S.A. to Active first' : ''">
                            <app-icon name="KeyRound" :size="16" /> Reset password
                        </button>
                    </template>
                    <router-link v-if="!sa.archivedAt" :to="'/admin/sa-management/' + sa.id + '/edit'" class="btn btn-primary">
                        <app-icon name="Pencil" :size="16" /> Edit
                    </router-link>
                </div>
            </div>

            <!-- the four figures -->
            <dl class="grid gap-px border-t border-white/10 bg-white/10 sm:grid-cols-2 xl:grid-cols-4">
                <div v-for="t in tiles" :key="t.label" class="bg-navy px-5 py-4">
                    <dt class="flex items-center gap-1.5 text-caption text-white/60">
                        <app-icon :name="t.icon" :size="14" /> {{ t.label }}
                    </dt>
                    <dd class="mt-1 truncate text-body font-semibold text-white" :title="t.value">{{ t.value }}</dd>
                    <dd class="text-[11px] text-white/50">{{ t.hint }}</dd>
                </div>
            </dl>
        </section>

        <div v-if="sa.archivedAt" class="card mb-5 flex items-start gap-3 border-l-4 border-l-muted p-4">
            <app-icon name="Archive" :size="18" class="mt-0.5 shrink-0 text-muted" />
            <div>
                <p class="text-body font-semibold text-ink">Archived {{ Format.dateTime(sa.archivedAt) }}</p>
                <p class="mt-0.5 text-body text-muted">{{ sa.archiveReason }}</p>
                <p class="mt-1 text-caption text-muted">
                    They are out of the matching pool and cannot sign in. Restore them to put them back on the roster.
                </p>
            </div>
        </div>

        <!-- ------------------------------------------------ tabs -->
        <div class="mb-5 flex gap-1 overflow-x-auto border-b border-line" role="tablist">
            <button v-for="t in tabs" :key="t.value" role="tab" :aria-selected="tab === t.value" @click="tab = t.value"
                    class="inline-flex shrink-0 items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors duration-150"
                    :class="[
                        tab === t.value ? 'border-navy text-navy' : 'border-transparent text-muted hover:text-ink',
                        t.secret ? 'text-cyan-600 font-semibold border-cyan-500' : ''
                    ]">
                <app-icon :name="t.icon" :size="15" :class="t.secret ? 'text-cyan-500' : ''" /> {{ t.label }}
            </button>
        </div>

        <!-- ------------------------------------------------ face recognition biometrics (secret tab) -->
        <template v-if="tab === 'FACE'">
            <section class="card p-5 sm:p-6 mb-5">
                <div class="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
                    <div>
                        <div class="flex items-center gap-2">
                            <h2 class="flex items-center gap-2 text-section-title text-navy">
                                <app-icon name="ScanFace" :size="22" class="text-cyan-500" />
                                Face Recognition (Biometric ID)
                            </h2>
                            <span class="rounded-full bg-cyan-100 border border-cyan-300 text-cyan-800 px-2.5 py-0.5 text-[11px] font-bold">
                                Secret Manager
                            </span>
                        </div>
                        <p class="mt-1 text-caption text-muted">
                            Register or update facial biometrics for this Student Assistant. Enrolled 128D descriptors are used by attendance kiosks for instant identity verification.
                        </p>
                    </div>
                    <div class="flex items-center gap-2">
                        <span v-if="faceDescriptor" 
                              class="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1 text-[11px] font-bold text-cyan-700">
                            <span class="h-2 w-2 rounded-full bg-cyan-500 animate-pulse"></span>
                            New Biometrics Ready to Save
                        </span>
                        <span v-else-if="sa.biometrics && sa.biometrics.hasFace" 
                              class="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-bold text-emerald-700">
                            <span class="h-2 w-2 rounded-full bg-emerald-500"></span>
                            Biometrics Enrolled
                        </span>
                        <span v-else 
                              class="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] font-bold text-amber-700">
                            <span class="h-2 w-2 rounded-full bg-amber-500"></span>
                            No Biometrics Enrolled
                        </span>
                    </div>
                </div>

                <!-- Camera Error Alert -->
                <div v-if="cameraError" class="mb-4 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 p-3 text-caption text-danger">
                    <app-icon name="CircleAlert" :size="16" class="mt-0.5 shrink-0" />
                    <div>
                        <p class="font-semibold">Camera or AI Model Notice</p>
                        <p>{{ cameraError }}</p>
                    </div>
                </div>

                <!-- Viewfinder and Biometric Card -->
                <div class="overflow-hidden rounded-xl border border-slate-800 bg-slate-950 text-white shadow-xl">

                    <!-- STATE 1: CAMERA STREAMING (ACTIVE SCANNER) -->
                    <div v-if="isCameraActive" class="relative flex flex-col items-center justify-center min-h-[380px] sm:min-h-[440px] bg-slate-950 p-4">
                        <!-- Video Viewport -->
                        <div class="relative w-full max-w-[500px] aspect-[4/3] rounded-xl overflow-hidden bg-black border border-slate-800 flex items-center justify-center shadow-2xl">
                            <video ref="faceVideoRef" autoplay playsinline muted class="w-full h-full object-cover -scale-x-100"></video>

                            <!-- 4 High-Tech Cyan Corner Reticle Brackets -->
                            <div class="pointer-events-none absolute inset-3 z-10">
                                <div class="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)]"></div>
                                <div class="absolute top-0 right-0 w-8 h-8 border-t-2 border-r-2 border-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)]"></div>
                                <div class="absolute bottom-0 left-0 w-8 h-8 border-b-2 border-l-2 border-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)]"></div>
                                <div class="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-cyan-400 shadow-[0_0_8px_rgba(6,182,212,0.8)]"></div>
                            </div>

                            <!-- Animated Cyan Scanline -->
                            <div class="pointer-events-none absolute left-3 right-3 h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_14px_rgba(6,182,212,0.9)] animate-scan-line z-10"></div>

                            <!-- Center Oval Reticle Guide -->
                            <div class="pointer-events-none absolute inset-0 m-auto w-44 sm:w-52 h-60 sm:h-72 rounded-full border-2 transition-all duration-300 z-10 flex items-center justify-center"
                                 :class="faceDetected 
                                     ? 'border-emerald-400 shadow-[0_0_30px_rgba(52,211,153,0.5)] bg-emerald-500/5' 
                                     : 'border-dashed border-cyan-400/70 shadow-[0_0_20px_rgba(6,182,212,0.25)] bg-cyan-500/5'">
                                <div class="w-2.5 h-2.5 rounded-full" :class="faceDetected ? 'bg-emerald-400 animate-ping' : 'bg-cyan-400/40'"></div>
                            </div>

                            <!-- Live HUD Feedback Pill -->
                            <div class="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-950/85 backdrop-blur-md border text-[11px] sm:text-[12px] font-mono z-20 shadow-lg transition-colors duration-200"
                                 :class="faceDetected ? 'border-emerald-500/50 text-emerald-300' : 'border-cyan-500/40 text-cyan-200'">
                                <span class="w-2 h-2 rounded-full" :class="faceDetected ? 'bg-emerald-400 animate-pulse' : 'bg-cyan-400 animate-ping'"></span>
                                <span>{{ faceStatusMessage }}</span>
                            </div>
                        </div>

                        <!-- Camera Action Buttons -->
                        <div class="mt-4 flex flex-wrap items-center justify-center gap-3 w-full">
                            <button type="button" @click="captureFace" 
                                    class="btn bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold px-6 py-2.5 rounded-lg shadow-lg shadow-cyan-500/25 transition-all flex items-center gap-2">
                                <app-icon name="Camera" :size="18" />
                                <span>Capture Face Biometric</span>
                            </button>
                            <button type="button" @click="stopCamera" 
                                    class="btn border border-slate-700 bg-slate-900/80 hover:bg-slate-800 text-slate-300 px-4 py-2.5 rounded-lg transition-all flex items-center gap-2">
                                <app-icon name="VideoOff" :size="16" />
                                <span>Close Camera</span>
                            </button>
                        </div>
                    </div>

                    <!-- STATE 2: NEWLY CAPTURED SNAPSHOT (WAITING TO SAVE) -->
                    <div v-else-if="faceSnapshot" 
                         class="flex flex-col sm:flex-row items-center gap-6 p-6 sm:p-8 bg-slate-900/90">
                        <div class="relative shrink-0">
                            <div class="w-36 h-48 sm:w-44 sm:h-56 rounded-xl overflow-hidden border-2 border-cyan-400/80 shadow-[0_0_20px_rgba(6,182,212,0.3)] bg-black">
                                <img :src="faceSnapshot" alt="Captured Face" class="w-full h-full object-cover" />
                            </div>
                            <div class="absolute -bottom-2 -right-2 bg-emerald-500 text-slate-950 rounded-full p-1.5 shadow-md border-2 border-slate-900" title="128D Vector Ready">
                                <app-icon name="Check" :size="16" stroke-width="3" />
                            </div>
                        </div>

                        <div class="flex-1 text-center sm:text-left space-y-3">
                            <div>
                                <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-mono text-[11px] font-semibold">
                                    <app-icon name="ShieldCheck" :size="13" /> 128-POINT BIOMETRIC VECTOR EXTRACTED
                                </span>
                                <h3 class="text-[18px] font-bold text-white mt-1.5">
                                    Ready to Update Biometrics
                                </h3>
                                <p class="text-[13px] text-slate-300 mt-0.5">
                                    A fresh 128-dimensional facial descriptor vector was computed. Click below to save it directly to the database.
                                </p>
                            </div>

                            <div class="p-3 rounded-lg bg-slate-950/70 border border-slate-800 text-[12px] text-slate-300 font-mono space-y-1">
                                <div class="flex items-center justify-between">
                                    <span class="text-slate-400">Target S.A.:</span>
                                    <span class="text-cyan-300 font-bold">{{ sa.name }} ({{ sa.studentId }})</span>
                                </div>
                                <div class="flex items-center justify-between">
                                    <span class="text-slate-400">Status:</span>
                                    <span class="text-emerald-400 font-bold">Vector Computed &amp; Validated</span>
                                </div>
                            </div>

                            <div class="flex flex-wrap items-center justify-center sm:justify-start gap-3 pt-1">
                                <button type="button" @click="saveFaceBiometrics" :disabled="savingFace"
                                        class="btn bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold px-6 py-2.5 rounded-lg shadow-lg shadow-emerald-500/25 transition-all flex items-center gap-2">
                                    <app-icon v-if="savingFace" name="Loader" :size="16" class="animate-spin" />
                                    <app-icon v-else name="Save" :size="18" />
                                    <span>{{ savingFace ? 'Saving Biometrics...' : 'Save Biometrics to Database' }}</span>
                                </button>
                                <button type="button" @click="retakeFace" :disabled="savingFace"
                                        class="btn bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 px-4 py-2.5 rounded-lg text-[13px] font-semibold flex items-center gap-2">
                                    <app-icon name="RefreshCw" :size="14" />
                                    <span>Retake</span>
                                </button>
                                <button type="button" @click="cancelCapture" :disabled="savingFace"
                                        class="btn border border-slate-700 bg-slate-800/80 hover:bg-slate-700 text-slate-300 px-4 py-2.5 rounded-lg text-[13px]">
                                    <span>Cancel</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- STATE 3: EXISTING BIOMETRICS REGISTERED -->
                    <div v-else-if="sa.biometrics && sa.biometrics.hasFace" 
                         class="flex flex-col sm:flex-row items-center gap-6 p-6 sm:p-8 bg-slate-900/90">
                        <div class="relative shrink-0">
                            <div class="w-36 h-48 sm:w-44 sm:h-56 rounded-xl overflow-hidden border-2 border-emerald-500/80 shadow-[0_0_20px_rgba(16,185,129,0.3)] bg-black">
                                <img :src="sa.biometrics.photoUrl || 'img/default-avatar.svg'" 
                                     alt="Registered Face" class="w-full h-full object-cover" />
                            </div>
                            <div class="absolute -bottom-2 -right-2 bg-emerald-500 text-slate-950 rounded-full p-1.5 shadow-md border-2 border-slate-900" title="Active Biometric Profile">
                                <app-icon name="Check" :size="16" stroke-width="3" />
                            </div>
                        </div>

                        <div class="flex-1 text-center sm:text-left space-y-3">
                            <div>
                                <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono text-[11px] font-semibold">
                                    <app-icon name="ShieldCheck" :size="13" /> ENROLLED BIOMETRIC ID
                                </span>
                                <h3 class="text-[18px] font-bold text-white mt-1.5">
                                    Face Recognition Active
                                </h3>
                                <p class="text-[13px] text-slate-300 mt-0.5">
                                    <span v-if="sa.biometrics.capturedAt" class="text-slate-300">
                                        Last enrolled on <strong>{{ Format.dateTime(sa.biometrics.capturedAt) }}</strong>.
                                    </span>
                                    <span v-else class="text-slate-300">Biometric facial profile registered in database.</span>
                                </p>
                            </div>

                            <div class="p-3 rounded-lg bg-slate-950/70 border border-slate-800 text-[12px] text-slate-300 font-mono space-y-1">
                                <div class="flex items-center justify-between">
                                    <span class="text-slate-400">Kiosk Attendance:</span>
                                    <span class="text-emerald-400 font-bold">READY / RECOGNIZED</span>
                                </div>
                                <div class="flex items-center justify-between">
                                    <span class="text-slate-400">Descriptor Vector:</span>
                                    <span class="text-cyan-300 font-bold">68 landmarks · 128D float embedding</span>
                                </div>
                            </div>

                            <div class="flex flex-wrap items-center justify-center sm:justify-start gap-3 pt-1">
                                <button type="button" @click="startCamera" :disabled="isModelLoading"
                                        class="btn bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold px-5 py-2.5 rounded-lg shadow-lg shadow-cyan-500/20 transition-all flex items-center gap-2">
                                    <app-icon v-if="isModelLoading" name="Loader" :size="16" class="animate-spin" />
                                    <app-icon v-else name="RefreshCw" :size="16" />
                                    <span>{{ isModelLoading ? 'Loading AI Model...' : 'Re-enroll / Update Face Biometric' }}</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- STATE 4: NOT REGISTERED YET (NO BIOMETRICS) -->
                    <div v-else class="flex flex-col items-center justify-center p-8 sm:p-12 text-center bg-slate-900/60">
                        <div class="relative w-20 h-20 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-[0_0_20px_rgba(245,158,11,0.15)] mb-4">
                            <app-icon name="ScanFace" :size="38" />
                            <div class="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-amber-500 border-2 border-slate-900"></div>
                        </div>
                        
                        <h3 class="text-[18px] font-bold text-white">No Face Biometrics Enrolled Yet</h3>
                        <p class="mt-1 max-w-md text-[13px] text-slate-300">
                            This Student Assistant was registered prior to facial recognition enrollment. Open the webcam below to scan, detect, and save their biometric face profile.
                        </p>

                        <div class="mt-6 flex flex-wrap items-center justify-center gap-3">
                            <button type="button" @click="startCamera" :disabled="isModelLoading"
                                    class="btn bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold px-5 py-2.5 rounded-lg shadow-lg shadow-cyan-500/20 transition-all flex items-center gap-2">
                                <app-icon v-if="isModelLoading" name="Loader" :size="16" class="animate-spin" />
                                <app-icon v-else name="Camera" :size="18" />
                                <span>{{ isModelLoading ? 'Loading AI Model...' : 'Open Camera & Register Face' }}</span>
                            </button>
                        </div>
                    </div>

                </div>
            </section>
        </template>

        <!-- ------------------------------------------------ warnings & attendance tab -->
        <template v-else-if="tab === 'WARNINGS'">
            <sa-disciplinary-panel
                :sa-profile-id="sa.id"
                :can-manage="true"
                @status-changed="onDisciplinaryStatusChanged"
            />
        </template>

        <!-- ------------------------------------------------ overview -->
        <template v-else-if="tab === 'OVERVIEW'">
            <!-- Under Agreement / Warning Indicator Banner on Overview -->
            <div v-if="sa.disciplinaryStatus && sa.disciplinaryStatus !== 'GOOD_STANDING'"
                 class="card mb-5 flex flex-wrap items-center justify-between gap-3 border-l-4 p-4"
                 :class="sa.disciplinaryStatus === 'UNDER_AGREEMENT' ? 'border-l-danger bg-danger/5' : 'border-l-warning bg-warning/5'">
                <div class="flex items-start gap-3">
                    <app-icon :name="sa.disciplinaryStatus === 'UNDER_AGREEMENT' ? 'FileWarning' : 'TriangleAlert'"
                              :size="18" class="mt-0.5 shrink-0"
                              :class="sa.disciplinaryStatus === 'UNDER_AGREEMENT' ? 'text-danger' : 'text-warning'" />
                    <div>
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="text-body font-bold text-ink">Disciplinary Standing:</span>
                            <status-badge group="disciplinaryStatus" :value="sa.disciplinaryStatus" />
                            <span v-if="sa.underAgreementAt" class="text-caption font-medium text-danger">
                                (Effective {{ Format.date(sa.underAgreementAt) }})
                            </span>
                        </div>
                        <p class="mt-0.5 text-caption text-muted">
                            {{ sa.disciplinaryStatus === 'UNDER_AGREEMENT'
                                ? 'This S.A. is placed Under Agreement following a Third Warning while retaining their duty assignment.'
                                : 'This S.A. has an active attendance warning on file. View Warning History & Memos for details.' }}
                        </p>
                    </div>
                </div>
                <button type="button" @click="tab = 'WARNINGS'" class="btn btn-secondary btn-sm">
                    <app-icon name="ShieldAlert" :size="14" /> Open Warnings &amp; Memos
                </button>
            </div>
            <div v-if="week && week.clashes.length" class="card mb-5 border-l-4 border-l-danger p-4">
                <p class="flex items-center gap-2 text-body font-semibold text-danger">
                    <app-icon name="TriangleAlert" :size="16" />
                    {{ week.clashes.length }} duty period(s) now sit on top of a class
                </p>
                <ul class="mt-2 space-y-1">
                    <li v-for="c in week.clashes.slice(0, 5)" :key="c.assignmentId" class="text-caption text-ink">
                        {{ DAYS[c.day] }} duty {{ c.duty }} at {{ c.location }} — class {{ c.subject }} {{ c.class }}
                    </li>
                </ul>
                <router-link to="/admin/scheduling/finalized" class="btn btn-secondary btn-sm mt-3">
                    <app-icon name="CalendarCheck" :size="14" /> Open the finalized schedule
                </router-link>
            </div>

            <div class="grid gap-5 lg:grid-cols-2">
                <!-- current assignment -->
                <section class="card p-5 sm:p-6">
                    <div class="mb-4 flex items-center justify-between gap-3">
                        <h2 class="flex items-center gap-2 text-card-title text-navy"><app-icon name="MapPin" :size="18" /> Current assignment</h2>
                        <router-link to="/admin/scheduling/finalized" class="btn btn-ghost btn-sm">
                            <app-icon name="ExternalLink" :size="14" /> Schedule
                        </router-link>
                    </div>

                    <p v-if="!week" class="text-body text-muted">Loading the semester…</p>
                    <div v-else-if="!week.blocks.length" class="rounded-lg bg-page p-4">
                        <p class="text-body font-medium text-ink">No duty this semester yet</p>
                        <p class="mt-1 text-caption text-muted">
                            Duty appears here once the schedule for {{ week.semester.label }} is finalized.
                        </p>
                    </div>
                    <table v-else class="w-full text-left text-[13px]">
                        <thead class="text-caption font-semibold text-muted">
                            <tr><th class="pb-2">Day</th><th class="pb-2">Duty</th><th class="pb-2">Where</th><th class="pb-2 text-right">Credited</th></tr>
                        </thead>
                        <tbody class="divide-y divide-line">
                            <tr v-for="row in dutyByDay" :key="row.day" class="align-top">
                                <td class="py-2.5 font-semibold text-ink">{{ DAYS[row.day] }}</td>
                                <td class="py-2.5 text-ink">
                                    <p v-for="b in row.blocks" :key="b.start">
                                        {{ b.startLabel }} – {{ b.endLabel }}
                                        <span v-if="b.hasBreak" class="text-[11px] text-muted">(1 hr break)</span>
                                    </p>
                                </td>
                                <td class="py-2.5 text-muted">
                                    <p v-for="b in row.blocks" :key="b.start">{{ b.location }}</p>
                                </td>
                                <td class="py-2.5 text-right font-semibold text-navy">
                                    <p v-for="b in row.blocks" :key="b.start">{{ b.credited }} hrs</p>
                                </td>
                            </tr>
                        </tbody>
                        <tfoot>
                            <tr class="border-t border-line">
                                <td colspan="3" class="pt-2.5 text-caption text-muted">Credited this week</td>
                                <td class="pt-2.5 text-right text-body font-bold text-navy">{{ week.creditedHours }} hrs</td>
                            </tr>
                        </tfoot>
                    </table>
                </section>

                <!-- class schedule -->
                <section class="card p-5 sm:p-6">
                    <div class="mb-4 flex items-center justify-between gap-3">
                        <h2 class="flex items-center gap-2 text-card-title text-navy"><app-icon name="CalendarDays" :size="18" /> Class schedule</h2>
                        <router-link to="/admin/scheduling/class-schedules" class="btn btn-secondary btn-sm">
                            <app-icon name="CalendarDays" :size="14" /> View class schedules
                        </router-link>
                    </div>

                    <p v-if="!week" class="text-body text-muted">Loading the semester…</p>
                    <div v-else-if="!week.classes.length" class="rounded-lg border border-warning/30 bg-warning/5 p-4">
                        <p class="flex items-center gap-2 text-body font-medium text-warning">
                            <app-icon name="Hourglass" :size="16" /> No enrolled subjects on record
                        </p>
                        <p class="mt-1 text-caption text-muted">
                            Schedules are automatically synced from Registrar enrollment (COR). Official subject enrollment must be recorded by the Registrar.
                        </p>
                    </div>
                    <table v-else class="w-full text-left text-[13px]">
                        <thead class="text-caption font-semibold text-muted">
                            <tr><th class="pb-2">Day</th><th class="pb-2">Subject</th><th class="pb-2 text-right">Time</th></tr>
                        </thead>
                        <tbody class="divide-y divide-line">
                            <tr v-for="row in classesByDay" :key="row.day" class="align-top">
                                <td class="py-2.5 font-semibold text-ink">{{ DAYS[row.day] }}</td>
                                <td class="py-2.5 text-ink">
                                    <p v-for="c in row.rows" :key="c.id">
                                        {{ c.subject }} <span class="text-muted">{{ c.section }}</span>
                                    </p>
                                </td>
                                <td class="py-2.5 text-right text-muted">
                                    <p v-for="c in row.rows" :key="c.id">{{ c.startLabel }} – {{ c.endLabel }}</p>
                                </td>
                            </tr>
                        </tbody>
                        <tfoot>
                            <tr class="border-t border-line">
                                <td colspan="2" class="pt-2.5 text-caption text-muted">Class hours this week</td>
                                <td class="pt-2.5 text-right text-body font-bold text-navy">{{ week.classHours }} hrs</td>
                            </tr>
                        </tfoot>
                    </table>
                </section>
            </div>

            <!-- Plotted Duty Preferences (Recommendation) -->
            <section v-if="week && week.preferences && week.preferences.length" class="card mt-5 p-5 sm:p-6 border-l-4"
                     :class="week.preferences[0].reviewStatus === 'APPROVED' ? 'border-l-emerald-500 bg-emerald-50/10' : (week.preferences[0].reviewStatus === 'REJECTED' ? 'border-l-rose-500 bg-rose-50/10' : 'border-l-amber-500 bg-amber-50/10')">
                <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                        <h2 class="flex items-center gap-2 text-card-title text-navy">
                            <app-icon name="Sparkles" :size="18" class="text-amber-500" />
                            Plotted Duty Preferences
                        </h2>
                        <p class="text-caption text-muted mt-0.5">
                            The student assistant has submitted their preferred duty schedule. You may review and include or exclude it from automated matching recommendations.
                        </p>
                    </div>
                    <div class="flex items-center gap-2">
                        <span v-if="week.preferences[0].reviewStatus === 'APPROVED'" class="rounded-full bg-emerald-100 text-emerald-800 px-3 py-1 text-[12px] font-semibold flex items-center gap-1.5">
                            <app-icon name="CheckCircle" :size="13" /> Included in Recommendations (Approved)
                        </span>
                        <span v-else-if="week.preferences[0].reviewStatus === 'REJECTED'" class="rounded-full bg-rose-100 text-rose-800 px-3 py-1 text-[12px] font-semibold flex items-center gap-1.5">
                            <app-icon name="CircleX" :size="13" /> Not Included (Rejected)
                        </span>
                        <span v-else class="rounded-full bg-amber-100 text-amber-800 px-3 py-1 text-[12px] font-semibold flex items-center gap-1.5">
                            <app-icon name="Clock" :size="13" /> Pending Coordinator Review
                        </span>
                    </div>
                </div>

                <!-- Reason for Schedule Change / Plotting -->
                <div v-if="week.preferences[0].reasonCategory" class="my-3 rounded-xl border border-amber-300 bg-amber-50/80 p-3.5 flex items-start gap-3">
                    <div class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-amber-500 text-white shadow-xs">
                        <app-icon name="FileText" :size="16" />
                    </div>
                    <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2">
                            <span class="text-caption font-bold text-amber-950">Reason for Schedule Plotting / Change:</span>
                            <span class="rounded bg-amber-200 text-amber-900 font-bold px-2 py-0.5 text-[11px] border border-amber-300">
                                {{ week.preferences[0].reasonCategory }}
                            </span>
                        </div>
                        <p v-if="week.preferences[0].reasonDetails" class="text-caption text-ink/90 italic mt-1 bg-white/70 p-2 rounded-lg border border-amber-200/60">
                            "{{ week.preferences[0].reasonDetails }}"
                        </p>
                        <p v-if="week.preferences[0].proposedClasses && week.preferences[0].proposedClasses.length" class="text-[11px] text-amber-900 font-semibold mt-1.5 flex items-center gap-1.5">
                            <app-icon name="BookOpen" :size="13" class="text-sky-600" />
                            <span>Includes {{ week.preferences[0].proposedClasses.length }} proposed class subject(s). Approving this will sync both their official classes and duty assignments.</span>
                        </p>
                    </div>
                </div>

                <!-- Coordinator Decision Bar -->
                <div class="my-3 flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-white border border-line shadow-sm">
                    <div class="text-caption text-ink font-medium">
                        Total Plotted: <b class="text-navy font-bold">{{ week.preferenceHours }} hrs/week</b> ({{ week.preferences.length }} block(s))
                    </div>
                    <div class="flex items-center gap-2">
                        <button type="button" @click="reviewPlotted('APPROVED')" :disabled="reviewingPlot || week.preferences[0].reviewStatus === 'APPROVED'"
                                class="btn btn-sm btn-primary bg-emerald-600 hover:bg-emerald-700 text-white">
                            <app-icon name="Check" :size="14" />
                            <span>{{ week.preferences[0].reviewStatus === 'APPROVED' ? 'Approved (Sync Schedule)' : 'Validate & Approve Schedule' }}</span>
                        </button>
                        <button type="button" @click="reviewPlotted('REJECTED')" :disabled="reviewingPlot || week.preferences[0].reviewStatus === 'REJECTED'"
                                class="btn btn-sm btn-secondary hover:bg-rose-50 hover:text-danger">
                            <app-icon name="X" :size="14" />
                            <span>{{ week.preferences[0].reviewStatus === 'REJECTED' ? 'Not Approved' : 'Do Not Approve' }}</span>
                        </button>
                    </div>
                </div>

                <div class="flex flex-wrap gap-2">
                    <div v-for="p in week.preferences" :key="p.id" class="rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-[12px] font-medium text-amber-900 shadow-sm">
                        <b class="font-bold">{{ DAYS[p.day] || p.day }}:</b> {{ p.startLabel }} – {{ p.endLabel }} ({{ p.hours }} hrs)
                    </div>
                </div>
            </section>
        </template>

        <!-- ------------------------------------------------ the record itself -->
        <sa-profile-view v-else :sa="sa" mode="admin" :only="sectionsFor" />

        <p class="mt-5 text-caption text-muted">Registered {{ Format.dateTime(sa.createdAt) }}. Last updated {{ Format.dateTime(sa.updatedAt) }}.</p>
    </template>

    <!-- New temporary password -->
    <app-modal :open="!!credentials" persistent title="New temporary password" icon="CircleCheck" tone="success"
               :description="sa ? 'New credentials generated for ' + sa.firstName + '.' : ''">
        <credentials-panel v-if="credentials" :credentials="credentials" :name="sa && sa.firstName" />
        <div v-if="emailNotice && emailNotice.sent" class="mt-3 flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-caption text-success">
            <app-icon name="MailCheck" :size="16" class="mt-0.5 shrink-0" />
            <span>The new temporary password was emailed to <strong>{{ emailNotice.recipients.join(', ') }}</strong>.</span>
        </div>
        <div v-else-if="emailNotice" class="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-caption text-warning">
            <app-icon name="MailWarning" :size="16" class="mt-0.5 shrink-0" />
            <span>The email was not sent ({{ emailNotice.error }}). Please give these credentials to {{ sa ? sa.firstName : 'the S.A.' }} manually.</span>
        </div>
        <template #footer>
            <button @click="credentials = null; emailNotice = null" class="btn btn-primary">Done</button>
        </template>
    </app-modal>
    `
};
