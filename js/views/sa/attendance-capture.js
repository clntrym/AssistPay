// S.A. Face Recognition & Geofenced Attendance Capture
// Real-time facial biometrics match with face-api.js & 1km radius geofencing

const SaAttendanceCapturePage = {
    components: { AppIcon, PageHeader, AttendanceMap, AppModal },

    setup() {
        const loading = Vue.ref(true);
        const submitting = Vue.ref(false);
        const saInfo = Vue.ref(null);
        const todayLogs = Vue.ref([]);
        const latestLog = Vue.ref(null);

        // Official Duty Hours & Schedule State
        const todayDuty = Vue.ref(null);
        const weeklyDuty = Vue.ref([]);
        const showWeeklySchedule = Vue.ref(false);
        const currentLiveTime = Vue.ref('');
        const currentLiveDate = Vue.ref('');
        let clockTimer = null;

        const updateClock = () => {
            const now = new Date();
            currentLiveTime.value = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            currentLiveDate.value = now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        };

        const shiftStatusBadge = Vue.computed(() => {
            if (!todayDuty.value || !todayDuty.value.hasDutyToday) {
                return {
                    type: 'OFF',
                    text: 'Day Off / No Duty Today',
                    color: 'bg-slate-800 text-slate-400 border-slate-700'
                };
            }
            const now = new Date();
            const nowMins = now.getHours() * 60 + now.getMinutes();

            const startStr = todayDuty.value.expectedStartTime;
            const endStr = todayDuty.value.expectedEndTime;
            if (!startStr || !endStr) {
                return {
                    type: 'SCHEDULED',
                    text: 'Shift Scheduled Today',
                    color: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                };
            }

            const startParts = startStr.split(':');
            const startMins = parseInt(startParts[0], 10) * 60 + parseInt(startParts[1], 10);
            const endParts = endStr.split(':');
            const endMins = parseInt(endParts[0], 10) * 60 + parseInt(endParts[1], 10);

            if (nowMins < startMins) {
                const diff = startMins - nowMins;
                const diffH = Math.floor(diff / 60);
                const diffM = diff % 60;
                const timeText = diffH > 0 ? `${diffH}h ${diffM}m` : `${diffM}m`;
                return {
                    type: 'UPCOMING',
                    text: `Upcoming Shift (Starts in ${timeText})`,
                    color: 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                };
            } else if (nowMins >= startMins && nowMins <= endMins) {
                return {
                    type: 'ACTIVE',
                    text: 'On Duty / Active Shift Window',
                    color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 animate-pulse'
                };
            } else {
                return {
                    type: 'COMPLETED',
                    text: 'Shift Ended Today',
                    color: 'bg-slate-800 text-slate-300 border-slate-700'
                };
            }
        });
        const allowedLocations = Vue.ref([
            {
                id: 'ncst_main',
                name: 'NCST Main Campus',
                address: 'Felix Amada building / NCST Building 2, Dasmariñas, Cavite',
                lat: 14.327472,  // 14°19'38.9"N
                lng: 120.940472, // 120°56'25.7"E
                radiusMeters: 1000
            },
            {
                id: 'user_testing_location',
                name: 'Testing Location (General Trias)',
                address: 'Bella Vista / General Trias, Cavite (Test Zone)',
                lat: 14.335944,  // 14°20'09.4"N
                lng: 120.915667, // 120°54'56.4"E
                radiusMeters: 1000
            }
        ]);
        const selectedLocationId = Vue.ref('ncst_main');
        const maxRadiusMeters = Vue.ref(1000);

        // Geolocation State
        const userCoords = Vue.ref(null); // { lat, lng, accuracy }
        const geoError = Vue.ref('');
        const geoLoading = Vue.ref(true);
        let geoWatchId = null;

        // Biometrics & Camera State
        const faceVideoRef = Vue.ref(null);
        const isCameraActive = Vue.ref(false);
        const isModelLoading = Vue.ref(false);
        const cameraError = Vue.ref('');
        const hasRegisteredFace = Vue.ref(false);
        const registeredDescriptor = Vue.ref(null);

        // Detection & Verification State
        const isFaceDetecting = Vue.ref(false);
        const faceDetected = Vue.ref(false);
        const faceMatched = Vue.ref(false);
        const faceMatchConfidence = Vue.ref(0);
        const currentDescriptor = Vue.ref(null);
        const hudMessage = Vue.ref('Align your face within the frame');
        const lastSnapshot = Vue.ref('');

        // Anti-Spoofing & Liveness State (Strict Live Person Verification - Anti-Photo)
        const isLiveVerified = Vue.ref(false);
        const isStaticPhoto = Vue.ref(false);
        const blinkDetected = Vue.ref(false);
        const blinkCount = Vue.ref(0);
        const eyeAspectRatio = Vue.ref(0);

        let faceDetectInterval = null;
        let webcamStream = null;
        let modelsLoaded = false;

        // Haversine formula
        const calculateDistance = (lat1, lon1, lat2, lon2) => {
            const numLat1 = Number(lat1);
            const numLon1 = Number(lon1);
            const numLat2 = Number(lat2);
            const numLon2 = Number(lon2);
            if (isNaN(numLat1) || isNaN(numLon1) || isNaN(numLat2) || isNaN(numLon2)) return 0;
            const R = 6371000;
            const dLat = (numLat2 - numLat1) * Math.PI / 180;
            const dLon = (numLon2 - numLon1) * Math.PI / 180;
            const a =
                Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(numLat1 * Math.PI / 180) * Math.cos(numLat2 * Math.PI / 180) *
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return R * c;
        };

        const getDistanceToLoc = (loc) => {
            if (!userCoords.value || !loc || loc.lat == null || loc.lng == null) return null;
            return Math.round(calculateDistance(userCoords.value.lat, userCoords.value.lng, loc.lat, loc.lng));
        };

        const isLocWithinRadius = (loc) => {
            const dist = getDistanceToLoc(loc);
            return dist !== null && dist <= maxRadiusMeters.value;
        };

        const formatCoord = (val) => {
            const num = Number(val);
            return isNaN(num) ? '—' : num.toFixed(5);
        };

        // Computations for location & geofence
        const nearestLocationInfo = Vue.computed(() => {
            if (!userCoords.value || !Array.isArray(allowedLocations.value) || allowedLocations.value.length === 0) return null;
            let nearest = null;
            let minDist = Infinity;

            allowedLocations.value.forEach(loc => {
                if (loc && loc.lat != null && loc.lng != null) {
                    const dist = calculateDistance(userCoords.value.lat, userCoords.value.lng, loc.lat, loc.lng);
                    if (dist < minDist) {
                        minDist = dist;
                        nearest = { ...loc, distance: dist };
                    }
                }
            });
            return nearest;
        });

        let userSelectedLocationManually = false;
        const selectLocation = (locId) => {
            userSelectedLocationManually = true;
            selectedLocationId.value = locId;
        };

        const activeSelectedLocation = Vue.computed(() => {
            if (!Array.isArray(allowedLocations.value) || allowedLocations.value.length === 0) return null;
            return allowedLocations.value.find(l => l.id === selectedLocationId.value) || allowedLocations.value[0] || null;
        });

        const distanceToActiveLocation = Vue.computed(() => {
            if (!userCoords.value || !activeSelectedLocation.value || activeSelectedLocation.value.lat == null) return null;
            return calculateDistance(userCoords.value.lat, userCoords.value.lng, activeSelectedLocation.value.lat, activeSelectedLocation.value.lng);
        });

        // Is user within 1km of the ACTIVELY SELECTED authorized location?
        const isWithinGeofence = Vue.computed(() => {
            if (distanceToActiveLocation.value === null) return false;
            return distanceToActiveLocation.value <= maxRadiusMeters.value;
        });

        // Can the user log attendance right now? (Requires Geofence + Verified Face Match + Verified Live Person)
        const canSubmitAttendance = Vue.computed(() => {
            return isWithinGeofence.value && faceMatched.value && isLiveVerified.value && !submitting.value;
        });

        // ---------- Geolocation Setup ----------
        const startGeolocation = () => {
            geoLoading.value = true;
            geoError.value = '';

            if (!navigator.geolocation) {
                geoError.value = 'Geolocation is not supported by your browser.';
                geoLoading.value = false;
                return;
            }

            const options = {
                enableHighAccuracy: true,
                timeout: 15000,
                maximumAge: 5000
            };

            navigator.geolocation.getCurrentPosition(
                pos => {
                    userCoords.value = {
                        lat: pos.coords.latitude,
                        lng: pos.coords.longitude,
                        accuracy: Math.round(pos.coords.accuracy)
                    };
                    geoLoading.value = false;

                    // Automatically select whichever authorized location is closer ONLY on initial GPS fix if user hasn't selected manually
                    if (nearestLocationInfo.value && !userSelectedLocationManually) {
                        selectedLocationId.value = nearestLocationInfo.value.id;
                    }
                },
                err => {
                    console.warn('Geolocation error:', err);
                    geoError.value = 'Location access denied or unavailable. Please enable GPS permissions.';
                    geoLoading.value = false;
                },
                options
            );

            // Continuous watch
            if (geoWatchId) navigator.geolocation.clearWatch(geoWatchId);
            geoWatchId = navigator.geolocation.watchPosition(
                pos => {
                    userCoords.value = {
                        lat: pos.coords.latitude,
                        lng: pos.coords.longitude,
                        accuracy: Math.round(pos.coords.accuracy)
                    };
                },
                err => console.debug('Watch position error:', err),
                options
            );
        };

        // ---------- AI Face Model Loading ----------
        const loadFaceModels = async () => {
            if (modelsLoaded) return true;
            isModelLoading.value = true;
            try {
                if (typeof faceapi === 'undefined') {
                    throw new Error('face-api.min.js library is not loaded.');
                }
                const modelsPath = window.location.origin + window.location.pathname.replace(/\/[^/]*$/, '') + '/models';
                try {
                    await Promise.all([
                        faceapi.nets.tinyFaceDetector.loadFromUri(modelsPath),
                        faceapi.nets.faceLandmark68Net.loadFromUri(modelsPath),
                        faceapi.nets.faceRecognitionNet.loadFromUri(modelsPath)
                    ]);
                } catch (e1) {
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
                console.error('Failed to load face detection models:', err);
                cameraError.value = 'Could not load biometric face recognition models.';
                isModelLoading.value = false;
                return false;
            }
        };

        // ---------- Camera Streaming & Teardown ----------
        const stopCamera = () => {
            if (faceDetectInterval) {
                clearInterval(faceDetectInterval);
                faceDetectInterval = null;
            }
            if (webcamStream) {
                webcamStream.getTracks().forEach(t => {
                    try { t.stop(); } catch (e) {}
                });
                webcamStream = null;
            }
            if (faceVideoRef.value) {
                faceVideoRef.value.srcObject = null;
            }
            isCameraActive.value = false;
            faceDetected.value = false;
            faceMatched.value = false;
            isLiveVerified.value = false;
            isStaticPhoto.value = false;
            blinkDetected.value = false;
            blinkCount.value = 0;
            hudMessage.value = 'Camera is currently closed';
        };

        const startCamera = async () => {
            cameraError.value = '';
            faceDetected.value = false;
            faceMatched.value = false;
            isLiveVerified.value = false;
            isStaticPhoto.value = false;
            blinkDetected.value = false;
            blinkCount.value = 0;
            hudMessage.value = 'Requesting camera access...';

            const ok = await loadFaceModels();
            if (!ok) return;

            try {
                if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                    throw new Error('Webcam media devices not supported.');
                }

                const stream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        width: { ideal: 640 },
                        height: { ideal: 480 },
                        facingMode: 'user'
                    },
                    audio: false
                });

                webcamStream = stream;
                isCameraActive.value = true;
                hudMessage.value = 'Align your face within the frame';

                await Vue.nextTick();
                if (faceVideoRef.value) {
                    faceVideoRef.value.srcObject = stream;
                    faceVideoRef.value.play().catch(e => console.warn('Play error:', e));
                    startFaceDetectionLoop();
                }
            } catch (err) {
                console.error('Webcam start error:', err);
                stopCamera();
                cameraError.value = 'Camera access blocked or device unavailable. Please allow camera permissions.';
            }
        };

        // Helper to compute Euclidean distance between two 2D points (supports .x or ._x)
        const getPtX = (p) => (p && (p.x !== undefined ? p.x : p._x)) || 0;
        const getPtY = (p) => (p && (p.y !== undefined ? p.y : p._y)) || 0;
        const getPtDist = (p1, p2) => Math.hypot(getPtX(p1) - getPtX(p2), getPtY(p1) - getPtY(p2));

        // Eye Aspect Ratio (EAR) for Live Human Blink Detection
        const computeEyeEAR = (pts) => {
            if (!pts || pts.length < 6) return 0.3;
            const v1 = getPtDist(pts[1], pts[5]);
            const v2 = getPtDist(pts[2], pts[4]);
            const h = getPtDist(pts[0], pts[3]);
            return h > 0 ? (v1 + v2) / (2.0 * h) : 0.3;
        };

        // ---------- Real-time Face Verification & Liveness Loop ----------
        let eyeOpenFrames = 0;
        let eyeClosedFrames = 0;
        let matchStartTime = 0;
        let lastFaceDetectedTime = 0;
        let recentEARs = [];

        const startFaceDetectionLoop = () => {
            if (faceDetectInterval) clearInterval(faceDetectInterval);
            eyeOpenFrames = 0;
            eyeClosedFrames = 0;
            matchStartTime = 0;
            lastFaceDetectedTime = 0;
            recentEARs = [];

            // Run at ~130ms interval for responsive live blink tracking
            faceDetectInterval = setInterval(async () => {
                if (!isCameraActive.value || !faceVideoRef.value || faceVideoRef.value.paused || faceVideoRef.value.ended) {
                    return;
                }
                if (isFaceDetecting.value) return;

                isFaceDetecting.value = true;
                const now = Date.now();
                try {
                    const videoEl = faceVideoRef.value;
                    if (videoEl && videoEl.readyState >= 2) {
                        const opt = new faceapi.TinyFaceDetectorOptions({ inputSize: 256, scoreThreshold: 0.45 });
                        const detection = await faceapi.detectSingleFace(videoEl, opt)
                            .withFaceLandmarks()
                            .withFaceDescriptor();

                        if (detection && detection.descriptor && detection.landmarks) {
                            lastFaceDetectedTime = now;
                            faceDetected.value = true;
                            const currentDesc = Array.from(detection.descriptor);
                            currentDescriptor.value = currentDesc;

                            // Calculate EAR on both eyes for liveness (anti-spoofing)
                            const leftEye = detection.landmarks.getLeftEye();
                            const rightEye = detection.landmarks.getRightEye();
                            const leftEAR = computeEyeEAR(leftEye);
                            const rightEAR = computeEyeEAR(rightEye);
                            const avgEAR = (leftEAR + rightEAR) / 2.0;
                            eyeAspectRatio.value = Math.round(avgEAR * 100) / 100;

                            recentEARs.push(avgEAR);
                            if (recentEARs.length > 25) recentEARs.shift();

                            // Biometric Matching (threshold <= 0.50)
                            if (registeredDescriptor.value && registeredDescriptor.value.length === 128) {
                                const dist = faceapi.euclideanDistance(registeredDescriptor.value, currentDesc);
                                const confidence = Math.max(0, Math.min(100, Math.round((1 - (dist / 0.70)) * 100)));
                                faceMatchConfidence.value = confidence;

                                if (dist <= 0.50) {
                                    faceMatched.value = true;

                                    if (!matchStartTime) matchStartTime = now;

                                    // LIVENESS CHECK (Anti-Photo / Live Eye Blink Verification):
                                    // A static photo or screen picture has fixed, unchanging eyes.
                                    // A live human blinks: EAR transitions Open (>=0.22) -> Closed (<0.19) -> Open (>=0.22).
                                    if (avgEAR >= 0.22) {
                                        if (eyeClosedFrames >= 1 && eyeClosedFrames <= 7 && eyeOpenFrames >= 1) {
                                            // Valid dynamic blink detected!
                                            blinkDetected.value = true;
                                            blinkCount.value++;
                                            isLiveVerified.value = true;
                                            isStaticPhoto.value = false;
                                            eyeClosedFrames = 0;
                                            eyeOpenFrames = 1;
                                            hudMessage.value = `✓ Live Person Verified (${confidence}% match) — Ready`;
                                        } else {
                                            eyeOpenFrames++;
                                            if (eyeClosedFrames > 7) {
                                                eyeClosedFrames = 0; // Eye closed too long (e.g. photo with closed eyes)
                                            }
                                        }
                                    } else if (avgEAR < 0.19) {
                                        // Eyes in closed / blinking state
                                        eyeClosedFrames++;
                                    }

                                    // Check status after evaluating frame
                                    if (isLiveVerified.value) {
                                        hudMessage.value = `✓ Live Person Verified (${confidence}% match) — Ready`;
                                    } else {
                                        const elapsedMatch = now - matchStartTime;
                                        if (elapsedMatch > 2400) {
                                            // Suspected photo: face matched for > 2.4s without any blink
                                            isStaticPhoto.value = true;
                                            hudMessage.value = '⚠️ Static Photo Detected! Live capture required (Please blink)';
                                        } else {
                                            isStaticPhoto.value = false;
                                            hudMessage.value = `Face Matched (${confidence}%) · 👁️ Paki-kurap ang iyong mata (Blink)`;
                                        }
                                    }
                                } else {
                                    faceMatched.value = false;
                                    isLiveVerified.value = false;
                                    isStaticPhoto.value = false;
                                    matchStartTime = 0;
                                    hudMessage.value = `Access Denied: Unregistered Face (${confidence}% match)`;
                                }
                            } else {
                                faceMatched.value = false;
                                isLiveVerified.value = false;
                                hudMessage.value = 'Face detected (No biometric profile registered yet)';
                            }
                        } else {
                            faceDetected.value = false;
                            faceMatched.value = false;
                            
                            // If face was lost for more than 1.5s, reset liveness so nobody can substitute a photo
                            if (now - lastFaceDetectedTime > 1500) {
                                isLiveVerified.value = false;
                                isStaticPhoto.value = false;
                                blinkDetected.value = false;
                                matchStartTime = 0;
                                eyeClosedFrames = 0;
                                eyeOpenFrames = 0;
                                recentEARs = [];
                            }
                            hudMessage.value = 'Align your face within the frame';
                        }
                    }
                } catch (e) {
                    console.debug('Face detect loop error:', e);
                } finally {
                    isFaceDetecting.value = false;
                }
            }, 130);
        };

        // ---------- Attendance Submission with Live Frame Instant Check (SariSmarts Parity) ----------
        const logAttendance = async (logType) => {
            if (submitting.value) return;

            // 1. Check Geofence for the selected location
            if (!isWithinGeofence.value) {
                const distText = distanceToActiveLocation.value !== null
                    ? `${Math.round(distanceToActiveLocation.value)}m away from ${activeSelectedLocation.value?.name}`
                    : 'Location undetermined';
                Alerts.error(
                    'Outside Authorized Area',
                    `You cannot log attendance because you are outside the 1.0 km (1,000m) geofence range of ${activeSelectedLocation.value?.name} (${distText}).`
                );
                return;
            }

            // 2. Check Camera & Face Verification
            if (!isCameraActive.value) {
                await startCamera();
                Alerts.toast('info', 'Activating camera. Look at the camera and blink to verify your live identity.');
                return;
            }

            // 2.5 Strict Liveness Verification Check (Anti-Photo Enforcement)
            if (!isLiveVerified.value) {
                Alerts.warning(
                    'Live Face Capture Required',
                    'Bawal ang litrato, ID picture, o photo sa phone screen! Kailangan ay live capture ng mukha. Paki-tingin sa camera at kumurap (blink) para makumpirmang live person bago mag-record ng attendance.'
                );
                hudMessage.value = '⚠️ Live Capture Required: Paki-kurap ang iyong mata';
                return;
            }

            // 3. IMMEDIATE LIVE FRAME CAPTURE & VERIFICATION (Exact SariSmarts parity)
            hudMessage.value = 'Verifying live biometric frame...';
            const videoEl = faceVideoRef.value;
            if (!videoEl || videoEl.readyState < 2) {
                Alerts.error('Camera Error', 'Webcam stream is not ready. Please try again.');
                return;
            }

            const opt = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 });
            const liveDetection = await faceapi.detectSingleFace(videoEl, opt)
                .withFaceLandmarks()
                .withFaceDescriptor();

            if (!liveDetection || !liveDetection.descriptor) {
                Alerts.error('No Face Detected', 'Please look directly at the camera with clear lighting.');
                hudMessage.value = 'No face detected in live capture';
                return;
            }

            if (!registeredDescriptor.value || registeredDescriptor.value.length !== 128) {
                Alerts.error('Biometric Not Enrolled', 'No facial biometric profile is enrolled for your account. Please coordinate with the S.A. Coordinator.');
                return;
            }

            const liveDesc = Array.from(liveDetection.descriptor);
            const dist = faceapi.euclideanDistance(registeredDescriptor.value, liveDesc);
            const confidence = Math.max(0, Math.min(100, Math.round((1 - (dist / 0.70)) * 100)));

            // REJECT if another person (dist > 0.50 - exact SariSmarts threshold)
            if (dist > 0.50) {
                faceMatched.value = false;
                Alerts.error(
                    'Access Denied: Face Mismatch',
                    'The face in front of the camera does not match the registered Student Assistant profile! Only the registered student can record attendance.'
                );
                hudMessage.value = 'Access Denied: Face does not match registered profile';
                return;
            }

            // Capture snapshot from live verified canvas
            const canvas = document.createElement('canvas');
            canvas.width = videoEl.videoWidth || 640;
            canvas.height = videoEl.videoHeight || 480;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
            const snapshotBase64 = canvas.toDataURL('image/jpeg', 0.88);
            lastSnapshot.value = snapshotBase64;

            const actionLabels = {
                CHECK_IN: 'Check-In (Start Shift)',
                CHECK_OUT: 'Check-Out (End Shift)'
            };
            const label = actionLabels[logType] || logType;

            const confirmed = await Alerts.confirm({
                title: `Record ${label}?`,
                html: `
                    <div class="text-left text-body space-y-2 text-ink">
                        <p><strong>Action:</strong> ${label}</p>
                        <p><strong>Location:</strong> ${activeSelectedLocation.value?.name}</p>
                        <p><strong>Scheduled Duty Today:</strong> <span class="font-bold text-cyan-600">${todayDuty.value?.hasDutyToday ? (todayDuty.value.expectedCheckIn + ' – ' + todayDuty.value.expectedCheckOut + ' (' + (todayDuty.value.primaryLocation || 'Duty Station') + ')') : 'No set duty schedule for today'}</span></p>
                        <p><strong>Distance:</strong> ${Math.round(distanceToActiveLocation.value || 0)} meters from authorized location</p>
                        <p><strong>Biometric Match:</strong> <span class="text-emerald-600 font-bold">${confidence}% Match (Verified)</span></p>
                    </div>
                `,
                confirmText: `Confirm ${logType.replace('_', ' ')}`,
                icon: 'question'
            });

            if (!confirmed) return;

            submitting.value = true;
            try {
                const payload = {
                    logType,
                    latitude: userCoords.value?.lat,
                    longitude: userCoords.value?.lng,
                    targetLocationId: selectedLocationId.value,
                    descriptor: liveDesc,
                    confidence: confidence,
                    isLive: true,
                    photo: snapshotBase64
                };

                const res = await Model.request('attendance', 'log', payload);
                submitting.value = false;

                if (res.success) {
                    Store.toast('success', res.message || `${label} recorded successfully!`);

                    let alertHtml = `<div class="text-left space-y-2 text-sm"><p class="font-medium text-slate-800 dark:text-slate-100">${res.message}</p>`;
                    if (res.statusType) {
                        const statusColors = {
                            PRESENT: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-300 dark:border-emerald-700',
                            LATE: 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border-amber-300 dark:border-amber-700',
                            UNDERTIME: 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border-rose-300 dark:border-rose-700',
                            OVERTIME: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border-indigo-300 dark:border-indigo-700',
                            COMPLETED: 'bg-teal-50 text-teal-700 dark:bg-teal-950/60 dark:text-teal-300 border-teal-300 dark:border-teal-700'
                        };
                        const cls = statusColors[res.statusType] || 'bg-slate-100 text-slate-700 border-slate-300';
                        alertHtml += `
                            <div class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${cls}">
                                <span>Status: ${res.statusType}</span>
                            </div>
                        `;
                    }
                    if (res.smsNotification?.phone) {
                        const maskedPhone = res.smsNotification.phone.replace(/(\d{4})\d{4}(\d{3})/, '$1****$2');
                        alertHtml += `
                            <div class="mt-2.5 p-2.5 rounded-lg bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 text-xs text-sky-800 dark:text-sky-200 flex items-center gap-2">
                                <span class="text-base">📱</span>
                                <div>
                                    <div class="font-bold">SMS Alert Dispatched</div>
                                    <div class="text-[11px] opacity-90">Attendance status SMS dispatched to mobile <strong>${maskedPhone}</strong></div>
                                </div>
                            </div>
                        `;
                    }
                    alertHtml += '</div>';

                    Alerts.success({
                        title: 'Attendance Recorded!',
                        html: alertHtml
                    });
                    // Refresh status
                    await loadStatus();
                } else {
                    Alerts.error('Attendance Failed', res.message || 'Could not record attendance.');
                }
            } catch (err) {
                submitting.value = false;
                console.error('Submit attendance error:', err);
                Alerts.error('Server Error', 'Failed to submit attendance request.');
            }
        };

        // ---------- Initial Load ----------
        const loadStatus = async () => {
            loading.value = true;
            try {
                const res = await Model.request('attendance', 'status');
                if (res.success) {
                    saInfo.value = res.sa;
                    todayLogs.value = res.todayLogs || [];
                    latestLog.value = res.latestLog || null;
                    todayDuty.value = res.todayDuty || null;
                    weeklyDuty.value = res.weeklyDuty || [];
                    hasRegisteredFace.value = res.sa?.hasBiometrics || false;
                    registeredDescriptor.value = res.sa?.descriptor || null;
                    if (res.allowedLocations) allowedLocations.value = res.allowedLocations;
                    if (res.maxRadiusMeters) maxRadiusMeters.value = res.maxRadiusMeters;
                }
            } catch (err) {
                console.warn('Status load error:', err);
            } finally {
                loading.value = false;
            }
        };

        // Tab state: 'monitoring' | 'streak' | 'tokens'
        const route = VueRouter.useRoute();
        const activeTab = Vue.ref(route.query.tab || 'monitoring');

        // Tab 1: Detailed Attendance History Table
        const historyLoading = Vue.ref(false);
        const attendanceHistory = Vue.ref([]);
        const historyFilterStatus = Vue.ref('ALL');

        const loadHistoryTable = async () => {
            historyLoading.value = true;
            try {
                const r = await Model.request('attendance', 'sa_attendance_history_table');
                if (r && r.success) {
                    attendanceHistory.value = r.history || [];
                }
            } catch (err) {
                console.warn('History table load error:', err);
            } finally {
                historyLoading.value = false;
            }
        };

        const filteredAttendanceHistory = Vue.computed(() => {
            if (historyFilterStatus.value === 'ALL') return attendanceHistory.value;
            return attendanceHistory.value.filter(h => h.status === historyFilterStatus.value);
        });

        // Tab 2 & 3: Streak Calendar & Tokens
        const streakLoading = Vue.ref(false);
        const streakData = Vue.ref(null);
        const selectedCalMonth = Vue.ref(10);
        const selectedCalYear = Vue.ref(2026);

        const loadStreakData = async (m, y) => {
            streakLoading.value = true;
            try {
                const r = await Model.request('attendance', 'sa_streak_calendar', {
                    month: m || selectedCalMonth.value,
                    year: y || selectedCalYear.value
                });
                if (r && r.success) {
                    streakData.value = r;
                    if (r.calendar) {
                        selectedCalMonth.value = r.calendar.month;
                        selectedCalYear.value = r.calendar.year;
                    }
                }
            } catch (err) {
                console.warn('Streak data load error:', err);
            } finally {
                streakLoading.value = false;
            }
        };

        const prevCalMonth = () => {
            let m = selectedCalMonth.value - 1;
            let y = selectedCalYear.value;
            if (m < 1) { m = 12; y--; }
            selectedCalMonth.value = m;
            selectedCalYear.value = y;
            loadStreakData(m, y);
        };

        const nextCalMonth = () => {
            let m = selectedCalMonth.value + 1;
            let y = selectedCalYear.value;
            if (m > 12) { m = 1; y++; }
            selectedCalMonth.value = m;
            selectedCalYear.value = y;
            loadStreakData(m, y);
        };

        // Day click detail modal
        const dayModalOpen = Vue.ref(false);
        const selectedDayDetail = Vue.ref(null);
        const openDayModal = (day) => {
            selectedDayDetail.value = day;
            dayModalOpen.value = true;
        };

        const setTab = (tab) => {
            activeTab.value = tab;
            if (tab === 'monitoring' && attendanceHistory.value.length === 0) {
                loadHistoryTable();
            } else if ((tab === 'streak' || tab === 'tokens') && !streakData.value) {
                loadStreakData();
            }
        };

        Vue.onMounted(async () => {
            updateClock();
            clockTimer = setInterval(updateClock, 1000);
            startGeolocation();
            await loadStatus();
            await loadHistoryTable();
            await loadStreakData();
            // Camera is OFF on initial load as requested
        });

        Vue.onUnmounted(() => {
            if (clockTimer) clearInterval(clockTimer);
            stopCamera();
            if (geoWatchId) navigator.geolocation.clearWatch(geoWatchId);
        });

        return {
            loading, submitting, saInfo, todayLogs, latestLog,
            todayDuty, weeklyDuty, showWeeklySchedule, currentLiveTime, currentLiveDate, shiftStatusBadge,
            allowedLocations, selectedLocationId, maxRadiusMeters,
            userCoords, geoError, geoLoading, nearestLocationInfo,
            activeSelectedLocation, distanceToActiveLocation, isWithinGeofence,
            canSubmitAttendance, startGeolocation,
            faceVideoRef, isCameraActive, isModelLoading, cameraError,
            hasRegisteredFace, registeredDescriptor,
            faceDetected, faceMatched, faceMatchConfidence, hudMessage,
            isLiveVerified, isStaticPhoto, blinkDetected, blinkCount, eyeAspectRatio,
            startCamera, stopCamera, logAttendance, lastSnapshot,
            calculateDistance, getDistanceToLoc, isLocWithinRadius, formatCoord,
            selectLocation,
            activeTab, setTab, historyLoading, attendanceHistory, historyFilterStatus, filteredAttendanceHistory, loadHistoryTable,
            streakLoading, streakData, selectedCalMonth, selectedCalYear, loadStreakData, prevCalMonth, nextCalMonth,
            dayModalOpen, selectedDayDetail, openDayModal
        };
    },

    template: `
    <div class="space-y-5">
        <page-header title="Attendance Capture" section="Student Assistant"
                     subtitle="High-precision facial recognition & geofenced campus attendance logging." />

        <!-- 3-TAB NAVIGATION BAR -->
        <div class="flex items-center gap-2 border-b border-slate-200 dark:border-navy-700/80 pb-1">
            <button @click="setTab('monitoring')"
                    class="relative flex items-center gap-2 rounded-t-xl px-4 py-2.5 text-xs font-bold transition-colors cursor-pointer"
                    :class="activeTab === 'monitoring' ? 'bg-navy text-white dark:bg-white dark:text-navy shadow-xs' : 'text-slate-600 hover:text-navy dark:text-slate-400 dark:hover:text-white'">
                <app-icon name="ScanFace" :size="15" />
                <span>Attendance Monitoring</span>
            </button>

            <button @click="setTab('streak')"
                    class="relative flex items-center gap-2 rounded-t-xl px-4 py-2.5 text-xs font-bold transition-colors cursor-pointer"
                    :class="activeTab === 'streak' ? 'bg-navy text-white dark:bg-white dark:text-navy shadow-xs' : 'text-slate-600 hover:text-navy dark:text-slate-400 dark:hover:text-white'">
                <app-icon name="Flame" :size="15" class="text-orange-500" />
                <span>Streak Calendar</span>
                <span v-if="streakData?.streaks?.currentStreak" class="ml-1 rounded-full bg-orange-500/20 px-1.5 py-0.5 text-[10px] font-black text-orange-400">
                    {{ streakData.streaks.currentStreak }}d
                </span>
            </button>

            <button @click="setTab('tokens')"
                    class="relative flex items-center gap-2 rounded-t-xl px-4 py-2.5 text-xs font-bold transition-colors cursor-pointer"
                    :class="activeTab === 'tokens' ? 'bg-navy text-white dark:bg-white dark:text-navy shadow-xs' : 'text-slate-600 hover:text-navy dark:text-slate-400 dark:hover:text-white'">
                <app-icon name="Award" :size="15" class="text-amber-500" />
                <span>My Tokens</span>
                <span v-if="streakData?.tokens?.unlocked?.length" class="ml-1 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-black text-amber-400">
                    {{ streakData.tokens.unlocked.length }}
                </span>
            </button>
        </div>

        <!-- TAB 1: ATTENDANCE MONITORING -->
        <div v-show="activeTab === 'monitoring'" class="space-y-6">
            <!-- Unregistered Biometrics Warning Banner -->
            <div v-if="!loading && !hasRegisteredFace" 
             class="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-300">
            <app-icon name="TriangleAlert" :size="22" class="mt-0.5 shrink-0 text-amber-400" />
            <div class="text-[13px] leading-relaxed">
                <p class="font-bold text-amber-200 text-[14px]">Face Recognition Profile Not Enrolled</p>
                <p class="mt-0.5 text-amber-300/90">
                    Your account does not have a 128-point biometric face vector registered yet. 
                    Please coordinate with your <strong>S.A. Coordinator</strong> to register your face in the S.A. Management portal before taking attendance.
                </p>
            </div>
        </div>

        <!-- MAIN CYBERNETIC ATTENDANCE KIOSK (Matching Image 2) -->
        <div class="grid gap-6 lg:grid-cols-12">

            <!-- LEFT COLUMN: FACE RECOGNITION VIEWPORT & ACTION BUTTONS (8 cols on lg) -->
            <div class="space-y-5 lg:col-span-8">

                <!-- TODAY'S OFFICIAL DUTY HOURS & SCHEDULE CARD -->
                <div class="rounded-2xl border border-cyan-500/30 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 p-4 sm:p-5 text-white shadow-xl space-y-4">
                    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
                        <div class="flex items-center gap-3">
                            <div class="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.15)] shrink-0">
                                <app-icon name="Clock" :size="22" />
                            </div>
                            <div>
                                <div class="flex flex-wrap items-center gap-2">
                                    <h3 class="text-[16px] font-bold text-white tracking-wide">Today's Duty Hours</h3>
                                    <span v-if="shiftStatusBadge" 
                                          :class="shiftStatusBadge.color"
                                          class="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold">
                                        <span v-if="shiftStatusBadge.type === 'ACTIVE'" class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
                                        {{ shiftStatusBadge.text }}
                                    </span>
                                </div>
                                <p class="text-[12px] text-slate-400 font-mono mt-0.5">
                                    {{ todayDuty?.dateFormatted || currentLiveDate }} · <span class="text-cyan-300 font-semibold">{{ currentLiveTime }}</span>
                                </p>
                            </div>
                        </div>

                        <!-- Right Actions / Assigned Location -->
                        <div class="flex items-center gap-2">
                            <div v-if="todayDuty?.hasDutyToday" class="text-[12px] font-mono text-cyan-300 bg-cyan-500/10 border border-cyan-500/30 px-3 py-1.5 rounded-xl">
                                <span class="text-slate-400 text-[10px] block font-sans">ASSIGNED LOCATION</span>
                                <span class="font-bold text-white">{{ todayDuty?.primaryLocation }}</span>
                            </div>
                            <button v-if="weeklyDuty && weeklyDuty.length > 0" 
                                    type="button" @click="showWeeklySchedule = !showWeeklySchedule"
                                    class="btn btn-sm bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[11px] flex items-center gap-1 rounded-lg">
                                <app-icon name="Calendar" :size="13" />
                                <span>{{ showWeeklySchedule ? 'Hide Week' : 'View Week' }}</span>
                            </button>
                        </div>
                    </div>

                    <!-- 2 Main Stat Boxes: Expected Check-In & Expected Time-Out -->
                    <div v-if="todayDuty?.hasDutyToday" class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <!-- 1. Expected Check-In Time -->
                        <div class="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3.5 flex items-center justify-between">
                            <div class="flex items-center gap-3">
                                <div class="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.15)] shrink-0">
                                    <app-icon name="LogIn" :size="22" />
                                </div>
                                <div>
                                    <span class="text-[11px] font-semibold uppercase tracking-wider text-emerald-400 block">Scheduled Check-In (Time In)</span>
                                    <span class="text-[22px] font-black text-white font-mono leading-tight">{{ todayDuty.expectedCheckIn }}</span>
                                </div>
                            </div>
                            <span class="text-[11px] font-mono text-emerald-300 bg-emerald-500/15 px-2.5 py-1 rounded-lg border border-emerald-500/30 font-semibold shrink-0">
                                Shift Start
                            </span>
                        </div>

                        <!-- 2. Expected Time-Out / Check-Out Time -->
                        <div class="rounded-xl border border-rose-500/30 bg-rose-500/5 p-3.5 flex items-center justify-between">
                            <div class="flex items-center gap-3">
                                <div class="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-500/15 text-rose-400 border border-rose-500/30 shadow-[0_0_15px_rgba(244,63,94,0.15)] shrink-0">
                                    <app-icon name="LogOut" :size="22" />
                                </div>
                                <div>
                                    <span class="text-[11px] font-semibold uppercase tracking-wider text-rose-400 block">Scheduled Time-Out (Check-Out)</span>
                                    <span class="text-[22px] font-black text-white font-mono leading-tight">{{ todayDuty.expectedCheckOut }}</span>
                                </div>
                            </div>
                            <span class="text-[11px] font-mono text-rose-300 bg-rose-500/15 px-2.5 py-1 rounded-lg border border-rose-500/30 font-semibold shrink-0">
                                Shift End
                            </span>
                        </div>
                    </div>

                    <!-- Multiple Shifts Today Detail (if morning + afternoon) -->
                    <div v-if="todayDuty?.shifts && todayDuty.shifts.length > 1" class="pt-2 border-t border-slate-800/80">
                        <span class="text-[11px] text-slate-400 block font-semibold mb-1.5">Scheduled Shift Windows Today:</span>
                        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div v-for="(shift, sIdx) in todayDuty.shifts" :key="sIdx"
                                 class="rounded-lg bg-slate-900/80 border border-slate-800 px-3 py-2 flex items-center justify-between text-[12px]">
                                <span class="text-white font-mono font-bold">Shift {{ sIdx + 1 }}: {{ shift.startLabel }} – {{ shift.endLabel }}</span>
                                <span class="text-cyan-400 font-mono text-[11px]">{{ shift.location }} ({{ shift.hours }} hrs)</span>
                            </div>
                        </div>
                    </div>

                    <!-- If No Duty Today -->
                    <div v-else-if="!todayDuty?.hasDutyToday" class="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-center">
                        <p class="text-[13px] text-slate-300">You have <strong>no official duty shifts scheduled for today</strong> ({{ todayDuty?.dayName }}).</p>
                        <p class="text-[11px] text-slate-400 mt-0.5">Please check your weekly duty assignments or coordinate with your S.A. Coordinator.</p>
                    </div>

                    <!-- Collapsible Weekly Duty Schedule View -->
                    <div v-if="showWeeklySchedule && weeklyDuty && weeklyDuty.length > 0" class="pt-3 border-t border-slate-800/80 space-y-2">
                        <span class="text-[12px] font-bold text-cyan-300 block">Official Weekly Duty Schedule</span>
                        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
                            <div v-for="wDay in ['MON','TUE','WED','THU','FRI','SAT']" :key="wDay"
                                 class="rounded-lg border p-2 text-center text-[11px]"
                                 :class="todayDuty?.dayCode === wDay 
                                     ? 'border-cyan-500/60 bg-cyan-500/15 text-white shadow-[0_0_10px_rgba(6,182,212,0.15)]' 
                                     : 'border-slate-800 bg-slate-900/60 text-slate-400'">
                                <span class="font-bold block text-[11px]" :class="todayDuty?.dayCode === wDay ? 'text-cyan-300' : 'text-slate-300'">
                                    {{ wDay }} {{ todayDuty?.dayCode === wDay ? '(Today)' : '' }}
                                </span>
                                <div v-if="weeklyDuty.filter(d => d.day === wDay).length > 0" class="mt-1 space-y-1">
                                    <div v-for="(wShift, wIdx) in weeklyDuty.filter(d => d.day === wDay)" :key="wIdx" class="font-mono text-[10px] text-slate-300">
                                        {{ wShift.startLabel }} – {{ wShift.endLabel }}
                                    </div>
                                </div>
                                <span v-else class="text-[10px] text-slate-600 block mt-1">Off Duty</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Face Recognition Cyber Card -->
                <div class="relative overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 p-4 sm:p-5 text-white shadow-2xl">

                    <!-- Header -->
                    <div class="mb-4 flex items-center justify-between">
                        <div class="flex items-center gap-3">
                            <div class="flex h-11 w-11 items-center justify-center rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.2)]">
                                <app-icon name="ScanFace" :size="24" />
                            </div>
                            <div>
                                <h2 class="text-[17px] font-bold text-white tracking-wide">Face Recognition</h2>
                                <p class="text-[12px] text-slate-400">Look at the camera to verify your identity.</p>
                            </div>
                        </div>

                        <!-- Camera Status Pill & Controls -->
                        <div class="flex items-center gap-2">
                            <button v-if="!isCameraActive" @click="startCamera" :disabled="isModelLoading"
                                    class="btn btn-sm bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-[12px] flex items-center gap-1.5">
                                <app-icon v-if="isModelLoading" name="Loader" :size="14" class="animate-spin" />
                                <app-icon v-else name="Camera" :size="14" />
                                <span>{{ isModelLoading ? 'Loading AI Model...' : 'Open Camera' }}</span>
                            </button>
                            <div v-else class="flex items-center gap-2">
                                <span class="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-bold text-emerald-400">
                                    <span class="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
                                    Camera Active
                                </span>
                                <button @click="stopCamera" type="button"
                                        class="btn btn-sm bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 text-[11px] flex items-center gap-1">
                                    <app-icon name="VideoOff" :size="13" /> Turn Off
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- Video Viewport Frame -->
                    <div class="relative w-full aspect-[4/3] sm:aspect-[16/10] rounded-xl overflow-hidden bg-black border border-slate-800/80 shadow-2xl flex items-center justify-center">
                        <video ref="faceVideoRef" autoplay playsinline muted 
                               class="w-full h-full object-cover -scale-x-100"></video>

                        <!-- Cyber Corner Brackets (Image 2 style) -->
                        <div class="pointer-events-none absolute inset-3 z-10">
                            <div class="absolute top-0 left-0 w-8 sm:w-10 h-8 sm:h-10 border-t-2 border-l-2 border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.9)]"></div>
                            <div class="absolute top-0 right-0 w-8 sm:w-10 h-8 sm:h-10 border-t-2 border-r-2 border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.9)]"></div>
                            <div class="absolute bottom-0 left-0 w-8 sm:w-10 h-8 sm:h-10 border-b-2 border-l-2 border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.9)]"></div>
                            <div class="absolute bottom-0 right-0 w-8 sm:w-10 h-8 sm:h-10 border-b-2 border-r-2 border-cyan-400 shadow-[0_0_10px_rgba(6,182,212,0.9)]"></div>
                        </div>

                        <!-- Top Floating HUD: Real-time Biometrics Verification Badge -->
                        <div v-if="isCameraActive" class="absolute top-3 left-3 sm:top-4 sm:left-4 z-20 flex flex-wrap items-center gap-2 pointer-events-none">
                            <div v-if="faceMatched && isLiveVerified" 
                                 class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-950/90 border border-emerald-500/60 text-emerald-300 text-[11px] sm:text-[12px] font-mono shadow-[0_0_15px_rgba(16,185,129,0.3)] backdrop-blur-md">
                                <app-icon name="ShieldCheck" :size="14" class="text-emerald-400" />
                                <span>Live Verified (Real Person • {{ faceMatchConfidence }}%)</span>
                            </div>
                            <div v-else-if="faceMatched && isStaticPhoto" 
                                 class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-950/90 border border-rose-500/70 text-rose-300 text-[11px] sm:text-[12px] font-mono shadow-[0_0_20px_rgba(244,63,94,0.5)] backdrop-blur-md animate-pulse">
                                <app-icon name="CircleAlert" :size="14" class="text-rose-400" />
                                <span>⚠️ Photo Detected: Bawal ang Litrato!</span>
                            </div>
                            <div v-else-if="faceMatched && !isLiveVerified" 
                                 class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-950/90 border border-amber-500/60 text-amber-300 text-[11px] sm:text-[12px] font-mono shadow-[0_0_15px_rgba(245,158,11,0.3)] backdrop-blur-md">
                                <span class="h-2 w-2 rounded-full bg-amber-400 animate-ping"></span>
                                <span>Live Check: Paki-kurap ang iyong mata (Blink)</span>
                            </div>
                            <div v-else-if="faceDetected" 
                                 class="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-950/90 border border-rose-500/60 text-rose-300 text-[11px] sm:text-[12px] font-mono shadow-[0_0_15px_rgba(244,63,94,0.3)] backdrop-blur-md">
                                <app-icon name="CircleAlert" :size="14" class="text-rose-400" />
                                <span>Access Denied: Unregistered Face</span>
                            </div>
                        </div>

                        <!-- Animated Scanline (active when camera is running) -->
                        <div v-if="isCameraActive" class="pointer-events-none absolute left-3 right-3 h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_15px_rgba(6,182,212,1)] animate-scan-line z-10"></div>

                        <!-- Center Biometric Alignment Oval Guide -->
                        <div v-if="isCameraActive" class="pointer-events-none absolute inset-0 m-auto w-48 sm:w-56 h-64 sm:h-76 rounded-full border-2 transition-all duration-300 z-10 flex items-center justify-center biometric-reticle"
                             :class="faceMatched && isLiveVerified 
                                 ? 'border-emerald-400 shadow-[0_0_35px_rgba(52,211,153,0.6)] bg-emerald-500/10' 
                                 : (faceMatched && isStaticPhoto
                                     ? 'border-rose-500 shadow-[0_0_30px_rgba(244,63,94,0.6)] bg-rose-500/10 animate-pulse'
                                     : (faceMatched
                                         ? 'border-amber-400/80 shadow-[0_0_25px_rgba(251,191,36,0.5)] bg-amber-500/5'
                                         : (faceDetected 
                                             ? 'border-rose-500 shadow-[0_0_25px_rgba(244,63,94,0.5)] bg-rose-500/5' 
                                             : 'border-dashed border-cyan-400/70 shadow-[0_0_20px_rgba(6,182,212,0.25)] bg-cyan-500/5')))">
                            <div class="w-3.5 h-3.5 rounded-full" 
                                 :class="faceMatched && isLiveVerified 
                                     ? 'bg-emerald-400 animate-ping' 
                                     : (faceMatched && isStaticPhoto
                                         ? 'bg-rose-500' 
                                         : (faceMatched ? 'bg-amber-400 animate-bounce' : (faceDetected ? 'bg-rose-500' : 'bg-cyan-400/40')))"></div>
                        </div>

                        <!-- Bottom HUD Pill with Pagination Dots (Matching Image 2) -->
                        <div v-if="isCameraActive" class="absolute bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1.5 z-20 pointer-events-none w-[90%] max-w-md">
                            <div class="flex items-center justify-center text-center gap-2 px-4 py-1.5 rounded-full bg-slate-950/90 backdrop-blur-md border text-[11px] sm:text-[13px] font-mono shadow-2xl transition-colors duration-200"
                                 :class="faceMatched && isLiveVerified 
                                     ? 'border-emerald-500/60 text-emerald-300 bg-emerald-950/85 shadow-[0_0_20px_rgba(52,211,153,0.3)]' 
                                     : (faceMatched && isStaticPhoto
                                         ? 'border-rose-500/70 text-rose-200 bg-rose-950/90 shadow-[0_0_20px_rgba(244,63,94,0.4)]'
                                         : (faceMatched
                                             ? 'border-amber-500/60 text-amber-200 bg-amber-950/85 shadow-[0_0_15px_rgba(245,158,11,0.2)]'
                                             : (faceDetected 
                                                 ? 'border-rose-500/50 text-rose-200 bg-slate-950/85' 
                                                 : 'border-cyan-500/40 text-cyan-200 bg-slate-950/85')))">
                                <app-icon :name="faceMatched && isLiveVerified ? 'Check' : (faceMatched && isStaticPhoto ? 'CircleAlert' : (faceMatched ? 'Eye' : (faceDetected ? 'CircleAlert' : 'Scan')))" :size="15" 
                                          :class="faceMatched && isLiveVerified ? 'text-emerald-400' : (faceMatched && isStaticPhoto ? 'text-rose-400' : (faceMatched ? 'text-amber-400 animate-pulse' : (faceDetected ? 'text-rose-400' : 'text-cyan-400')))" />
                                <span>{{ hudMessage }}</span>
                            </div>

                            <!-- Pagination / Scan Step Dots -->
                            <div class="flex items-center gap-1">
                                <span class="h-1.5 w-1.5 rounded-full" :class="faceDetected ? 'bg-cyan-400' : 'bg-cyan-400/20'"></span>
                                <span class="h-1.5 w-1.5 rounded-full" :class="faceMatched ? 'bg-amber-400' : 'bg-cyan-400/40'"></span>
                                <span class="h-1.5 w-1.5 rounded-full" :class="faceMatched && isLiveVerified ? 'bg-emerald-400' : 'bg-cyan-400/40'"></span>
                            </div>
                        </div>

                        <!-- STATE: CAMERA CLOSED (DEFAULT INITIAL STATE, matching SA Registration) -->
                        <div v-if="!isCameraActive" class="absolute inset-0 bg-slate-950/95 flex flex-col items-center justify-center p-6 text-center z-30">
                            <div class="relative w-20 h-20 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-[0_0_20px_rgba(6,182,212,0.15)] mb-3">
                                <app-icon name="ScanFace" :size="38" />
                                <div class="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-slate-600 border-2 border-slate-900"></div>
                            </div>
                            <h3 class="text-[17px] font-bold text-white">Camera is currently closed</h3>
                            <p class="mt-1 max-w-md text-[13px] text-slate-300">
                                Click the button below to turn on the camera and verify your facial biometrics for attendance logging.
                            </p>
                            <div class="mt-5 flex flex-wrap items-center justify-center gap-3">
                                <button type="button" @click="startCamera" :disabled="isModelLoading"
                                        class="btn bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold px-6 py-2.5 rounded-xl shadow-lg shadow-cyan-500/20 transition-all flex items-center gap-2">
                                    <app-icon v-if="isModelLoading" name="Loader" :size="16" class="animate-spin" />
                                    <app-icon v-else name="Camera" :size="18" />
                                    <span>{{ isModelLoading ? 'Loading AI Model...' : 'Open Camera' }}</span>
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 2 Action Buttons: Check-In & Check-Out (Automatic 1-Hour Meal Break) -->
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">

                    <!-- 1. Check-In -->
                    <button type="button" @click="logAttendance('CHECK_IN')" 
                            :disabled="submitting || !isWithinGeofence"
                            class="group relative flex flex-col items-center justify-center p-5 rounded-xl border transition-all duration-200 text-center select-none"
                            :class="canSubmitAttendance
                                ? 'bg-gradient-to-b from-emerald-500/20 via-emerald-600/15 to-emerald-900/30 border-emerald-500/60 hover:border-emerald-400 hover:shadow-[0_0_25px_rgba(16,185,129,0.35)] cursor-pointer'
                                : (isWithinGeofence
                                    ? 'bg-slate-900/80 border-slate-700/80 hover:border-emerald-500/50 text-slate-300 cursor-pointer'
                                    : 'bg-slate-900/60 border-slate-800 text-slate-500 cursor-not-allowed opacity-50')">
                        <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 group-hover:scale-105 transition-transform mb-2">
                            <app-icon name="UserCheck" :size="24" />
                        </div>
                        <span class="text-[16px] font-bold text-white">Check-In</span>
                        <span class="text-[12px] text-emerald-400/80 mt-0.5">Start your duty shift</span>
                        <div v-if="todayDuty?.expectedCheckIn" class="mt-1 flex items-center gap-1 text-[11px] font-mono font-bold text-emerald-300 bg-emerald-950/80 px-2.5 py-0.5 rounded-lg border border-emerald-500/30">
                            <app-icon name="Clock" :size="12" />
                            <span>Sched Time In: {{ todayDuty.expectedCheckIn }}</span>
                        </div>
                        <span v-if="isCameraActive && faceMatched && isLiveVerified" class="text-[11px] text-emerald-400 font-mono mt-1 font-bold">
                            ✓ Live Person Verified ({{ faceMatchConfidence }}%) — Ready
                        </span>
                        <span v-else-if="isCameraActive && faceMatched && isStaticPhoto" class="text-[11px] text-rose-400 font-mono mt-1 font-bold">
                            🚫 Static Photo Detected (Attendance Locked)
                        </span>
                        <span v-else-if="isCameraActive && faceMatched && !isLiveVerified" class="text-[11px] text-amber-300 font-mono mt-1 font-bold animate-pulse">
                            👁️ Paki-kurap ang mata para mag-unlock
                        </span>
                        <span v-else-if="isCameraActive && faceDetected && !faceMatched" class="text-[11px] text-rose-400 font-mono mt-1">
                            ✕ Unregistered Face (Access Denied)
                        </span>
                    </button>

                    <!-- 2. Check-Out -->
                    <button type="button" @click="logAttendance('CHECK_OUT')" 
                            :disabled="submitting || !isWithinGeofence"
                            class="group relative flex flex-col items-center justify-center p-5 rounded-xl border transition-all duration-200 text-center select-none"
                            :class="canSubmitAttendance
                                ? 'bg-gradient-to-b from-rose-500/20 via-rose-600/15 to-rose-900/30 border-rose-500/60 hover:border-rose-400 hover:shadow-[0_0_25px_rgba(244,63,94,0.35)] cursor-pointer'
                                : (isWithinGeofence
                                    ? 'bg-slate-900/80 border-slate-700/80 hover:border-rose-500/50 text-slate-300 cursor-pointer'
                                    : 'bg-slate-900/60 border-slate-800 text-slate-500 cursor-not-allowed opacity-50')">
                        <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-rose-500/20 text-rose-400 group-hover:scale-105 transition-transform mb-2">
                            <app-icon name="LogOut" :size="24" />
                        </div>
                        <span class="text-[16px] font-bold text-white">Check-Out</span>
                        <span class="text-[12px] text-rose-400/80 mt-0.5">End your duty shift</span>
                        <div v-if="todayDuty?.expectedCheckOut" class="mt-1 flex items-center gap-1 text-[11px] font-mono font-bold text-rose-300 bg-rose-950/80 px-2.5 py-0.5 rounded-lg border border-rose-500/30">
                            <app-icon name="Clock" :size="12" />
                            <span>Sched Time Out: {{ todayDuty.expectedCheckOut }}</span>
                        </div>
                        <span v-if="isCameraActive && faceMatched && isLiveVerified" class="text-[11px] text-rose-400 font-mono mt-1 font-bold">
                            ✓ Live Person Verified ({{ faceMatchConfidence }}%) — Ready
                        </span>
                        <span v-else-if="isCameraActive && faceMatched && isStaticPhoto" class="text-[11px] text-rose-400 font-mono mt-1 font-bold">
                            🚫 Static Photo Detected (Attendance Locked)
                        </span>
                        <span v-else-if="isCameraActive && faceMatched && !isLiveVerified" class="text-[11px] text-amber-300 font-mono mt-1 font-bold animate-pulse">
                            👁️ Paki-kurap ang mata para mag-unlock
                        </span>
                        <span v-else-if="isCameraActive && faceDetected && !faceMatched" class="text-[11px] text-rose-400 font-mono mt-1">
                            ✕ Unregistered Face (Access Denied)
                        </span>
                    </button>
                </div>

            </div>

            <!-- RIGHT COLUMN: CURRENT LOCATION & GEOFENCE STATUS (4 cols on lg) -->
            <div class="space-y-4 lg:col-span-4">

                <!-- 1. Current Location Card -->
                <div class="rounded-2xl border border-slate-800 bg-slate-950 p-4 sm:p-5 text-white shadow-xl space-y-3">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <app-icon name="MapPin" :size="18" class="text-cyan-400" />
                            <h3 class="text-[15px] font-bold text-white">Current Location</h3>
                        </div>
                        <span v-if="geoLoading" class="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-400">
                            Locating...
                        </span>
                        <span v-else-if="isWithinGeofence" class="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-400">
                            <app-icon name="Check" :size="12" stroke-width="3" /> Within Authorized Area
                        </span>
                        <span v-else class="inline-flex items-center gap-1 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-rose-400">
                            <app-icon name="X" :size="12" stroke-width="3" /> Outside Authorized Area
                        </span>
                    </div>

                    <!-- Real Interactive Geofence Map GUI (parang map) -->
                    <attendance-map 
                        :campus-lat="activeSelectedLocation?.lat || 14.327472"
                        :campus-lng="activeSelectedLocation?.lng || 120.940472"
                        :campus-name="activeSelectedLocation?.name || 'NCST Main Campus'"
                        :radius-meters="activeSelectedLocation?.radiusMeters || 1000"
                        :user-lat="userCoords?.lat || null"
                        :user-lng="userCoords?.lng || null"
                        :user-accuracy="userCoords?.accuracy || 5"
                        :is-inside="isWithinGeofence"
                        :distance-meters="distanceToActiveLocation"
                        :dark="true"
                        height="h-52" />

                    <!-- Location Details -->
                    <div class="space-y-1.5 pt-1">
                        <div class="flex items-center gap-2">
                            <app-icon name="Building2" :size="16" class="text-cyan-400 shrink-0" />
                            <span class="font-bold text-[14px] text-white">{{ activeSelectedLocation?.name }}</span>
                        </div>
                        <p class="text-[12px] text-slate-400">
                            {{ isWithinGeofence 
                                ? 'You are inside the authorized attendance area of ' + (activeSelectedLocation?.name || 'NCST') + '.' 
                                : 'You are outside the 1.0 km radius of ' + (activeSelectedLocation?.name || 'NCST') + '. Move closer to the authorized area.' }}
                        </p>

                        <!-- Readout Values -->
                        <div class="grid grid-cols-2 gap-2 pt-2 text-[11px] font-mono text-slate-300">
                            <div class="rounded-lg bg-slate-900/80 border border-slate-800/80 p-2">
                                <span class="text-slate-500 block text-[10px]">DISTANCE</span>
                                <span :class="isWithinGeofence ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'">
                                    {{ distanceToActiveLocation !== null ? Math.round(distanceToActiveLocation) + ' m' : '—' }}
                                </span>
                            </div>
                            <div class="rounded-lg bg-slate-900/80 border border-slate-800/80 p-2">
                                <span class="text-slate-500 block text-[10px]">GPS ACCURACY</span>
                                <span class="text-cyan-300 font-bold">
                                    {{ userCoords?.accuracy ? '±' + userCoords.accuracy + ' m' : '—' }}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- 2. Geo Fencing Range Card -->
                <div class="rounded-2xl border border-slate-800 bg-slate-950 p-4 sm:p-5 text-white shadow-xl space-y-3">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <app-icon name="Shield" :size="18" class="text-cyan-400" />
                            <h3 class="text-[15px] font-bold text-white">Geo Fencing Range</h3>
                        </div>
                        <span class="text-[11px] font-medium text-slate-400">ℹ Approx. Radius</span>
                    </div>

                    <div class="flex items-center gap-3 rounded-xl bg-slate-900/80 border border-slate-800 p-3">
                        <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
                            <app-icon name="Landmark" :size="20" />
                        </div>
                        <div class="flex-1 min-w-0">
                            <h4 class="text-[13px] font-bold text-white truncate">{{ activeSelectedLocation?.name }}</h4>
                            <p class="text-[11px] text-slate-400">Radius: 1.0 km (1000 meters)</p>
                        </div>
                        <span :class="isWithinGeofence ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30' : 'text-rose-400 bg-rose-500/10 border-rose-500/30'"
                              class="rounded-full border px-2 py-0.5 text-[10px] font-bold shrink-0">
                            {{ isWithinGeofence ? 'Within Range' : 'Out of Range' }}
                        </span>
                    </div>

                    <!-- Target Location Quick Selector (Campus vs Testing Location) -->
                    <div class="space-y-1.5 pt-1">
                        <span class="text-[11px] text-slate-400 block font-medium">Authorized Locations:</span>
                        <div class="flex flex-col gap-1.5">
                            <button v-for="loc in allowedLocations" :key="loc.id"
                                    type="button" @click="selectLocation(loc.id)"
                                    class="w-full text-left px-3 py-2 rounded-lg border text-[12px] transition-colors flex items-center justify-between"
                                    :class="selectedLocationId === loc.id 
                                        ? 'border-cyan-500/50 bg-cyan-500/15 text-cyan-200' 
                                        : 'border-slate-800 bg-slate-900/50 text-slate-400 hover:text-slate-200'">
                                <div class="truncate">
                                    <span class="font-semibold block text-white">{{ loc.name }}</span>
                                    <span class="text-[10px] text-slate-400 font-mono">{{ formatCoord(loc.lat) }}, {{ formatCoord(loc.lng) }}</span>
                                </div>
                                <span v-if="userCoords && getDistanceToLoc(loc) !== null" class="text-[11px] font-mono font-bold"
                                      :class="isLocWithinRadius(loc) ? 'text-emerald-400' : 'text-slate-500'">
                                    {{ getDistanceToLoc(loc) }}m
                                </span>
                            </button>
                        </div>
                    </div>
                </div>

                <!-- 3. Alerts / Exceptions Card (Matching Image 2) -->
                <div class="rounded-2xl border border-slate-800 bg-slate-950 p-4 sm:p-5 text-white shadow-xl space-y-3">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <app-icon name="TriangleAlert" :size="18" class="text-rose-400" />
                            <h3 class="text-[15px] font-bold text-white">Alerts / Exceptions</h3>
                            <span v-if="!canSubmitAttendance" class="grid h-4 w-4 place-items-center rounded-full bg-rose-500 text-[10px] font-black text-white">1</span>
                        </div>
                        <button type="button" class="text-[11px] text-slate-400 hover:text-slate-200">Live Status</button>
                    </div>

                    <!-- Exception Box 1: Face Not Recognized (Image 2 style) -->
                    <div v-if="isCameraActive && faceDetected && !faceMatched" 
                         class="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-rose-300 space-y-2.5">
                        <div class="flex items-start justify-between">
                            <div class="flex items-center gap-2 text-rose-200 font-bold text-[13px]">
                                <app-icon name="CircleAlert" :size="16" class="text-rose-400 shrink-0" />
                                <span>Face Not Recognized</span>
                            </div>
                            <span class="text-[11px] text-rose-400 font-mono">{{ faceMatchConfidence }}%</span>
                        </div>
                        <div class="text-[11px] text-slate-300 space-y-1">
                            <p>We couldn't verify your face. Please make sure:</p>
                            <ul class="list-disc pl-4 space-y-0.5 text-slate-400">
                                <li>You are facing the camera directly</li>
                                <li>Good lighting is available</li>
                                <li>Your face is clearly visible</li>
                            </ul>
                        </div>
                        <button type="button" @click="startCamera" 
                                class="btn btn-sm w-full border border-rose-500/40 bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-[11px] rounded-lg">
                            <app-icon name="RefreshCw" :size="13" /> Try Again
                        </button>
                    </div>

                    <!-- Exception Box 2: Out of Geofence -->
                    <div v-else-if="!geoLoading && !isWithinGeofence" 
                         class="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-rose-300 space-y-2">
                        <div class="flex items-center gap-2 text-rose-200 font-bold text-[13px]">
                            <app-icon name="MapPinOff" :size="16" class="text-rose-400 shrink-0" />
                            <span>Out of Geofence Range</span>
                        </div>
                        <p class="text-[11px] text-slate-300">
                            You are {{ distanceToActiveLocation !== null ? Math.round(distanceToActiveLocation) + 'm' : '' }} away from {{ activeSelectedLocation?.name }}. Attendance is restricted within 1.0 km (1000m).
                        </p>
                        <button type="button" @click="startGeolocation" 
                                class="btn btn-sm w-full border border-rose-500/40 bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 text-[11px] rounded-lg">
                            <app-icon name="RefreshCw" :size="13" /> Refresh GPS Location
                        </button>
                    </div>

                    <!-- Exception Box 3: Biometrics not enrolled -->
                    <div v-else-if="!hasRegisteredFace" 
                         class="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-amber-300 space-y-1.5">
                        <div class="flex items-center gap-2 text-amber-200 font-bold text-[13px]">
                            <app-icon name="ShieldAlert" :size="16" class="text-amber-400 shrink-0" />
                            <span>Face Profile Not Enrolled</span>
                        </div>
                        <p class="text-[11px] text-slate-300">
                            Please contact your S.A. Coordinator to capture and register your facial biometrics.
                        </p>
                    </div>

                    <!-- Exception Box 4: Camera is Closed (Default State) -->
                    <div v-else-if="!isCameraActive" 
                         class="rounded-xl border border-cyan-500/30 bg-cyan-500/10 p-3.5 text-cyan-300 space-y-2">
                        <div class="flex items-center gap-2 text-cyan-200 font-bold text-[13px]">
                            <app-icon name="Camera" :size="16" class="text-cyan-400 shrink-0" />
                            <span>Camera is Currently Closed</span>
                        </div>
                        <p class="text-[11px] text-slate-300">
                            Turn on your camera to verify your face and unlock Check-In / Check-Out.
                        </p>
                        <button type="button" @click="startCamera" :disabled="isModelLoading"
                                class="btn btn-sm w-full border border-cyan-500/40 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-200 text-[11px] rounded-lg flex items-center justify-center gap-1.5">
                            <app-icon v-if="isModelLoading" name="Loader" :size="13" class="animate-spin" />
                            <app-icon v-else name="Camera" :size="13" />
                            <span>{{ isModelLoading ? 'Loading AI Model...' : 'Open Camera' }}</span>
                        </button>
                    </div>

                    <!-- Exception Box 5: Camera Active Looking for Face -->
                    <div v-else-if="isCameraActive && !faceMatched" 
                         class="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-amber-300 space-y-1.5">
                        <div class="flex items-center gap-2 text-amber-200 font-bold text-[13px]">
                            <app-icon name="Scan" :size="16" class="text-amber-400 shrink-0" />
                            <span>Verifying Face Biometrics</span>
                        </div>
                        <p class="text-[11px] text-slate-300">
                            Position your face inside the viewfinder until biometric identity is verified.
                        </p>
                    </div>

                    <!-- All Good Box: Ready to Clock In -->
                    <div v-else 
                         class="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3.5 text-emerald-300 space-y-1.5">
                        <div class="flex items-center gap-2 text-emerald-200 font-bold text-[13px]">
                            <app-icon name="CircleCheck" :size="16" class="text-emerald-400 shrink-0" />
                            <span>Biometric Verification Ready</span>
                        </div>
                        <p class="text-[11px] text-slate-300">
                            Face verified ({{ faceMatchConfidence }}%) and within campus range. Click Check-In or Check-Out anytime. Standard 1-hour lunch break (12:00 NN–1:00 PM) is deducted automatically.
                        </p>
                    </div>
                </div>

                <!-- 4. Today's Shift Activity Logs -->
                <div class="rounded-2xl border border-slate-800 bg-slate-950 p-4 sm:p-5 text-white shadow-xl space-y-3">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                            <app-icon name="ClipboardList" :size="18" class="text-cyan-400" />
                            <h3 class="text-[15px] font-bold text-white">Today's Activity</h3>
                        </div>
                        <span class="text-[11px] font-mono text-slate-400">{{ todayLogs.length }} recorded</span>
                    </div>

                    <div v-if="todayLogs.length === 0" class="py-4 text-center text-slate-500 text-[12px]">
                        No attendance activity recorded today yet.
                    </div>

                    <div v-else class="space-y-2">
                        <div v-for="log in todayLogs" :key="log.id" 
                             class="flex items-center justify-between p-2.5 rounded-lg border border-slate-800/80 bg-slate-900/60 text-[12px]">
                            <div class="flex items-center gap-2.5">
                                <span class="h-2 w-2 rounded-full" 
                                      :class="log.logType === 'CHECK_IN' ? 'bg-emerald-400' : (log.logType === 'CHECK_OUT' ? 'bg-rose-400' : 'bg-amber-400')"></span>
                                <div>
                                    <span class="font-bold text-white block">{{ log.logType.replace('_', ' ') }}</span>
                                    <span class="text-[10px] text-slate-400">{{ log.locationName }}</span>
                                </div>
                            </div>
                            <span class="font-mono font-bold text-cyan-300">{{ log.time }}</span>
                        </div>
                    </div>
                </div>

            </div>
        </div>

        <!-- SECTION 1B: DETAILED ATTENDANCE HISTORY TABLE -->
        <div class="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-navy-700 dark:bg-navy-800 space-y-4">
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 pb-3 dark:border-navy-700/60">
                <div>
                    <h3 class="text-sm font-bold text-navy dark:text-white">Attendance Duty History</h3>
                    <p class="text-xs text-slate-500 dark:text-slate-400">Complete historical record of duty shifts, recorded punches, break deductions, and credited hours.</p>
                </div>

                <div class="flex items-center gap-2">
                    <span class="text-xs text-slate-400">Filter status:</span>
                    <select v-model="historyFilterStatus"
                            class="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 dark:border-navy-600 dark:bg-navy-900 dark:text-slate-200">
                        <option value="ALL">All Records</option>
                        <option value="PRESENT">Present</option>
                        <option value="LATE">Late</option>
                        <option value="EXCUSED">Excused</option>
                        <option value="PENDING_VERIFICATION">Pending Verification</option>
                    </select>
                </div>
            </div>

            <div v-if="historyLoading" class="py-12 text-center text-xs text-slate-400">
                Loading attendance history records...
            </div>

            <div v-else-if="filteredAttendanceHistory.length === 0" class="py-12 text-center text-xs text-slate-400">
                No attendance records found for this filter.
            </div>

            <div v-else class="overflow-x-auto">
                <table class="w-full text-left text-xs">
                    <thead class="border-b border-slate-100 bg-slate-50/80 text-[11px] font-bold text-slate-500 dark:border-navy-700/60 dark:bg-navy-900/30 dark:text-slate-400">
                        <tr>
                            <th class="py-3 px-3">Date</th>
                            <th class="py-3 px-3">Scheduled Shift</th>
                            <th class="py-3 px-3">Check-In / Out</th>
                            <th class="py-3 px-3">Recorded</th>
                            <th class="py-3 px-3">Break Deduction</th>
                            <th class="py-3 px-3">Credited Hours</th>
                            <th class="py-3 px-3">Status</th>
                            <th class="py-3 px-3">Exceptions / Notes</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-slate-100 dark:divide-navy-700/50">
                        <tr v-for="h in filteredAttendanceHistory" :key="h.id" class="hover:bg-slate-50/70 dark:hover:bg-navy-700/30 transition">
                            <td class="py-3 px-3 font-semibold text-slate-900 dark:text-white">
                                {{ h.dutyDateFormatted }} <span class="text-[10px] text-slate-400 font-bold ml-1">({{ h.dayOfWeek }})</span>
                            </td>
                            <td class="py-3 px-3 text-slate-600 dark:text-slate-300 font-mono text-[11px]">{{ h.scheduledShift }}</td>
                            <td class="py-3 px-3 text-slate-700 dark:text-slate-300 font-mono text-[11px]">
                                <span class="text-emerald-600 font-semibold">{{ h.checkIn }}</span> &middot; <span class="text-slate-500">{{ h.checkOut }}</span>
                            </td>
                            <td class="py-3 px-3 text-slate-600 dark:text-slate-300">{{ h.recordedHours }}</td>
                            <td class="py-3 px-3 text-slate-500 dark:text-slate-400">
                                <span v-if="h.breakDeduction !== '0.00 hrs'" class="text-amber-600 font-semibold">-{{ h.breakDeduction }}</span>
                                <span v-else class="text-slate-400">—</span>
                            </td>
                            <td class="py-3 px-3 font-bold text-navy dark:text-white">{{ h.creditedHours }}</td>
                            <td class="py-3 px-3">
                                <span class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"
                                      :class="h.status === 'PRESENT' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' :
                                              (h.status === 'LATE' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' :
                                              (h.status === 'PENDING_VERIFICATION' ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300' : 'bg-slate-100 text-slate-700'))">
                                    <app-icon v-if="h.status === 'PRESENT'" name="Check" :size="10" />
                                    {{ h.statusLabel }}
                                </span>
                            </td>
                            <td class="py-3 px-3 text-slate-500 dark:text-slate-400 text-[11px]">{{ h.pendingException }}</td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <!-- TAB 2: STREAK CALENDAR -->
    <div v-show="activeTab === 'streak'" class="space-y-6">
        <!-- TOP STREAK KPIS -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
            <div class="rounded-2xl border border-orange-200/90 bg-white p-4 shadow-2xs dark:border-navy-700 dark:bg-navy-800 flex items-center gap-3.5">
                <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600 dark:bg-orange-950/50 dark:text-orange-400">
                    <app-icon name="Flame" :size="24" />
                </div>
                <div>
                    <div class="text-[11px] font-medium text-slate-500 dark:text-slate-400">Current Streak</div>
                    <div class="text-2xl font-black text-navy dark:text-white">{{ streakData?.streaks?.currentStreak || 0 }} days</div>
                    <div class="text-[10px] font-bold text-orange-600 dark:text-orange-400">Keep it up!</div>
                </div>
            </div>

            <div class="rounded-2xl border border-purple-200/90 bg-white p-4 shadow-2xs dark:border-navy-700 dark:bg-navy-800 flex items-center gap-3.5">
                <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-purple-100 text-purple-600 dark:bg-purple-950/50 dark:text-purple-400">
                    <app-icon name="Crown" :size="24" />
                </div>
                <div>
                    <div class="text-[11px] font-medium text-slate-500 dark:text-slate-400">Longest Streak</div>
                    <div class="text-2xl font-black text-navy dark:text-white">{{ streakData?.streaks?.longestStreak || 0 }} days</div>
                    <div class="text-[10px] font-bold text-purple-600 dark:text-purple-400">Semester Record</div>
                </div>
            </div>

            <div class="rounded-2xl border border-emerald-200/90 bg-white p-4 shadow-2xs dark:border-navy-700 dark:bg-navy-800 flex items-center gap-3.5">
                <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
                    <app-icon name="ClipboardCheck" :size="24" />
                </div>
                <div>
                    <div class="text-[11px] font-medium text-slate-500 dark:text-slate-400">Completed Shifts</div>
                    <div class="text-2xl font-black text-navy dark:text-white">{{ streakData?.streaks?.totalCompletedShifts || 0 }}</div>
                    <div class="text-[10px] font-bold text-emerald-600 dark:text-emerald-400">Verified by supervisor</div>
                </div>
            </div>

            <div class="rounded-2xl border border-blue-200/90 bg-white p-4 shadow-2xs dark:border-navy-700 dark:bg-navy-800 flex items-center gap-3.5">
                <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400">
                    <app-icon name="Clock" :size="24" />
                </div>
                <div>
                    <div class="text-[11px] font-medium text-slate-500 dark:text-slate-400">Monthly Credited</div>
                    <div class="text-2xl font-black text-navy dark:text-white">{{ streakData?.streaks?.monthlyCreditedHours || 0 }} hrs</div>
                    <div class="text-[10px] font-bold text-blue-600 dark:text-blue-400">{{ streakData?.calendar?.label || 'This Month' }}</div>
                </div>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <!-- MONTHLY INTERACTIVE CALENDAR (7 cols) -->
            <div class="lg:col-span-7 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-navy-700 dark:bg-navy-800">
                <div class="flex items-center justify-between mb-4">
                    <div class="flex items-center gap-2.5">
                        <app-icon name="Calendar" :size="18" class="text-blue-600" />
                        <div>
                            <h3 class="text-sm font-bold text-navy dark:text-white">Streak Calendar</h3>
                            <p class="text-[11px] text-slate-500 dark:text-slate-400">Click any date to view scheduled vs actual hours breakdown.</p>
                        </div>
                    </div>

                    <div class="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
                        <button @click="prevCalMonth" class="rounded-md p-1 hover:bg-slate-100 dark:hover:bg-navy-700 transition cursor-pointer">
                            <app-icon name="ChevronLeft" :size="14" />
                        </button>
                        <span class="px-2">{{ streakData?.calendar?.label || 'October 2026' }}</span>
                        <button @click="nextCalMonth" class="rounded-md p-1 hover:bg-slate-100 dark:hover:bg-navy-700 transition cursor-pointer">
                            <app-icon name="ChevronRight" :size="14" />
                        </button>
                    </div>
                </div>

                <!-- Legend -->
                <div class="flex items-center flex-wrap gap-4 text-[11px] mb-4 text-slate-600 dark:text-slate-400 border-b border-slate-100 dark:border-navy-700/60 pb-3">
                    <div class="flex items-center gap-1.5">
                        <span class="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
                        <span>Perfect Attendance</span>
                    </div>
                    <div class="flex items-center gap-1.5">
                        <span class="h-2.5 w-2.5 rounded-full bg-amber-400"></span>
                        <span>Attendance Exception</span>
                    </div>
                    <div class="flex items-center gap-1.5">
                        <span class="h-2.5 w-2.5 rounded-full bg-slate-300 dark:bg-slate-600"></span>
                        <span>Non-Duty Day</span>
                    </div>
                    <div class="flex items-center gap-1.5">
                        <span class="h-2.5 w-2.5 rounded-full bg-blue-500"></span>
                        <span>Pending Verification</span>
                    </div>
                </div>

                <!-- Calendar Grid -->
                <div class="grid grid-cols-7 gap-1 text-center text-[10px] font-bold text-slate-400 mb-1">
                    <span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span>
                </div>
                <div class="grid grid-cols-7 gap-1.5">
                    <div v-for="day in streakData?.calendar?.days || []" :key="day.date"
                         @click="openDayModal(day)"
                         class="h-10 rounded-xl flex flex-col items-center justify-center text-xs font-bold transition relative group cursor-pointer hover:scale-105 active:scale-95"
                         :class="day.status === 'PERFECT' ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300 border border-emerald-300/80 shadow-2xs' :
                                 (day.status === 'EXCEPTION' ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 border border-amber-300/80 shadow-2xs' :
                                 (day.status === 'PENDING' ? 'bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-300/80 shadow-2xs' :
                                 'bg-slate-50 text-slate-400 dark:bg-navy-900/30 dark:text-slate-500 border border-slate-100 dark:border-navy-800'))">
                        <span>{{ day.day }}</span>
                        <span v-if="day.status === 'PERFECT'" class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                        <span v-else-if="day.status === 'EXCEPTION'" class="h-1.5 w-1.5 rounded-full bg-amber-400"></span>
                        <span v-else-if="day.status === 'PENDING'" class="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                    </div>
                </div>
            </div>

            <!-- STREAK PET EVOLUTION (5 cols) -->
            <div class="lg:col-span-5 rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs dark:border-navy-700 dark:bg-navy-800 flex flex-col justify-between">
                <div>
                    <div class="flex items-center justify-between mb-4">
                        <div class="flex items-center gap-2">
                            <app-icon name="Sparkles" :size="18" class="text-amber-500" />
                            <div>
                                <h3 class="text-sm font-bold text-navy dark:text-white">Streak Pet Evolution</h3>
                                <p class="text-[11px] text-slate-500 dark:text-slate-400">Watch your attendance pet grow with every duty day!</p>
                            </div>
                        </div>
                        <span class="text-xs font-semibold text-slate-500 dark:text-slate-400">{{ streakData?.calendar?.label }}</span>
                    </div>

                    <!-- 4 Stages Pathway -->
                    <div class="grid grid-cols-4 gap-2 text-center my-4">
                        <div v-for="stg in streakData?.streakPet?.stages || []" :key="stg.stage" class="flex flex-col items-center">
                            <div class="h-12 w-12 rounded-full flex items-center justify-center text-xl border-2 transition"
                                 :class="stg.active ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-400/40 dark:bg-blue-950/40 shadow-sm' :
                                         (stg.unlocked ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40' : 'border-slate-200 bg-slate-50 opacity-50')">
                                {{ stg.emoji }}
                            </div>
                            <div class="mt-1 text-[10px] font-bold" :class="stg.active ? 'text-blue-600 dark:text-blue-400' : 'text-slate-700 dark:text-slate-300'">
                                {{ stg.range }}
                            </div>
                            <div class="text-[9px] text-slate-400 leading-tight">{{ stg.name }}</div>
                        </div>
                    </div>
                </div>

                <!-- Pet Status & Progress Bar -->
                <div class="rounded-xl border border-slate-100 bg-slate-50/80 p-4 dark:border-navy-700 dark:bg-navy-900/40 mt-3">
                    <div class="flex items-center gap-3">
                        <div class="h-10 w-10 rounded-full bg-blue-100 text-blue-700 grid place-items-center text-2xl shrink-0 dark:bg-blue-950/60 dark:text-blue-300">
                            {{ streakData?.streakPet?.stage === 4 ? '🦁' : (streakData?.streakPet?.stage === 3 ? '🐶' : (streakData?.streakPet?.stage === 2 ? '🦊' : '🐣')) }}
                        </div>
                        <div class="flex-1 min-w-0">
                            <div class="text-xs font-bold text-slate-900 dark:text-white">
                                Your Pet is at Stage {{ streakData?.streakPet?.stage }} ({{ streakData?.streakPet?.stageName }})!
                            </div>
                            <div class="text-[11px] text-slate-500 dark:text-slate-400 truncate">{{ streakData?.streakPet?.message }}</div>
                        </div>
                    </div>

                    <div class="mt-3 flex items-center gap-3">
                        <div class="flex-1 h-2 rounded-full bg-slate-200 dark:bg-navy-700 overflow-hidden">
                            <div class="h-full bg-blue-600 rounded-full transition-all duration-500"
                                 :style="{ width: (streakData?.streakPet?.percent || 0) + '%' }"></div>
                        </div>
                        <span class="text-[11px] font-bold text-slate-700 dark:text-slate-300 shrink-0">
                            {{ streakData?.streakPet?.progressDays || 0 }} / {{ streakData?.streakPet?.targetDays || 30 }} days
                        </span>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- TAB 3: MY TOKENS -->
    <div v-show="activeTab === 'tokens'" class="space-y-6">
        <!-- MYSTERY TOKEN CARD -->
        <div v-if="streakData?.mysteryToken" class="rounded-2xl bg-gradient-to-br from-[#0c1836] via-[#10224d] to-[#162f6d] p-6 text-white shadow-md relative overflow-hidden">
            <div class="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-blue-500/20 blur-2xl"></div>

            <div class="flex items-center justify-between mb-4 relative z-10">
                <div class="flex items-center gap-3">
                    <span class="text-2xl animate-bounce">🎁</span>
                    <div>
                        <h3 class="text-base font-bold text-white">{{ streakData.mysteryToken.title }}</h3>
                        <p class="text-xs text-white/70">Next month's surprise token is waiting for consistent S.A.s!</p>
                    </div>
                </div>
                <span class="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-300 border border-emerald-400/30">
                    {{ streakData.mysteryToken.targetMonthLabel }}
                </span>
            </div>

            <div class="my-4 rounded-xl bg-white/10 p-4 border border-white/15 relative z-10">
                <div class="text-[11px] uppercase tracking-wider font-bold text-amber-400 flex items-center gap-1">
                    <span>💡</span> Clue from Coordinator
                </div>
                <p class="text-sm font-medium text-white mt-1">"{{ streakData.mysteryToken.clue }}"</p>
            </div>
        </div>

        <!-- APPRECIATION BADGES GRID -->
        <div>
            <div class="mb-4">
                <h3 class="text-sm font-bold text-navy dark:text-white">Attendance Appreciation Tokens & Milestones</h3>
                <p class="text-xs text-slate-500 dark:text-slate-400">Tokens are honorary recognitions celebrating consistency, resilience, and exemplary duty performance.</p>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div v-for="tok in streakData?.tokens?.all || []" :key="tok.type"
                     class="rounded-2xl border p-5 transition flex flex-col justify-between"
                     :class="tok.isUnlocked ? 'border-amber-300 bg-white dark:border-amber-500/40 dark:bg-navy-800 shadow-sm' :
                                             'border-slate-200 bg-slate-50/60 dark:border-navy-700 dark:bg-navy-900/40 opacity-70'">
                    <div>
                        <div class="flex items-center justify-between mb-3">
                            <div class="flex h-11 w-11 items-center justify-center rounded-xl text-xl"
                                 :class="tok.isUnlocked ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 ring-2 ring-amber-300/60' :
                                                         'bg-slate-200 text-slate-500 dark:bg-navy-800 dark:text-slate-400'">
                                <app-icon :name="tok.icon" :size="22" />
                            </div>
                            <span class="rounded-full px-2 py-0.5 text-[10px] font-bold"
                                  :class="tok.isUnlocked ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' : 'bg-slate-200 text-slate-600 dark:bg-navy-700 dark:text-slate-400'">
                                {{ tok.isUnlocked ? 'Unlocked' : 'In Progress' }}
                            </span>
                        </div>

                        <h4 class="text-sm font-bold text-navy dark:text-white">{{ tok.name }}</h4>
                        <p class="mt-1 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">{{ tok.description }}</p>
                    </div>

                    <div class="mt-4 pt-3 border-t border-slate-100 dark:border-navy-700">
                        <div v-if="tok.isUnlocked" class="flex items-center gap-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                            <app-icon name="Check" :size="13" />
                            <span>Milestone Achieved</span>
                        </div>
                        <div v-else class="space-y-1.5">
                            <div class="flex items-center justify-between text-[11px] font-semibold text-slate-500">
                                <span>Progress</span>
                                <span>{{ tok.progress }} / {{ tok.target }} shifts</span>
                            </div>
                            <div class="h-1.5 rounded-full bg-slate-200 dark:bg-navy-700 overflow-hidden">
                                <div class="h-full bg-amber-500 rounded-full"
                                     :style="{ width: Math.round((tok.progress / tok.target) * 100) + '%' }"></div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- MODAL: DAY ATTENDANCE DETAIL -->
    <app-modal v-model="dayModalOpen" :title="selectedDayDetail ? ('Attendance Details — ' + selectedDayDetail.date) : 'Day Details'">
        <div v-if="selectedDayDetail" class="space-y-4 text-xs">
            <div class="flex items-center justify-between p-3 rounded-xl border"
                 :class="selectedDayDetail.status === 'PERFECT' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' :
                         (selectedDayDetail.status === 'EXCEPTION' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-slate-200 bg-slate-50 text-slate-700')">
                <div class="font-bold text-sm">{{ selectedDayDetail.statusLabel }}</div>
                <div class="text-xs font-semibold">{{ selectedDayDetail.dayOfWeek }} &middot; {{ selectedDayDetail.date }}</div>
            </div>

            <div class="grid grid-cols-2 gap-3">
                <div class="rounded-xl border border-slate-200 bg-white p-3 dark:border-navy-700 dark:bg-navy-900">
                    <span class="text-slate-400 block mb-0.5">Scheduled Shift</span>
                    <strong class="text-slate-800 dark:text-white font-mono text-xs">{{ selectedDayDetail.scheduledStart || '—' }} – {{ selectedDayDetail.scheduledEnd || '—' }}</strong>
                </div>

                <div class="rounded-xl border border-slate-200 bg-white p-3 dark:border-navy-700 dark:bg-navy-900">
                    <span class="text-slate-400 block mb-0.5">Actual Punches</span>
                    <strong class="text-slate-800 dark:text-white font-mono text-xs">{{ selectedDayDetail.actualIn || '—' }} – {{ selectedDayDetail.actualOut || '—' }}</strong>
                </div>

                <div class="rounded-xl border border-slate-200 bg-white p-3 dark:border-navy-700 dark:bg-navy-900">
                    <span class="text-slate-400 block mb-0.5">Recorded Hours</span>
                    <strong class="text-slate-800 dark:text-white text-xs">{{ selectedDayDetail.recordedHours }} hrs</strong>
                </div>

                <div class="rounded-xl border border-slate-200 bg-white p-3 dark:border-navy-700 dark:bg-navy-900">
                    <span class="text-slate-400 block mb-0.5">Credited Hours</span>
                    <strong class="text-navy dark:text-cyan-400 text-xs font-bold">{{ selectedDayDetail.creditedHours }} hrs</strong>
                </div>
            </div>

            <div v-if="selectedDayDetail.notes" class="p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-600">
                <span class="font-bold block mb-1">Supervisor / Verification Notes:</span>
                {{ selectedDayDetail.notes }}
            </div>
        </div>

        <template #footer>
            <button @click="dayModalOpen = false" class="btn btn-primary btn-sm bg-navy text-white">Close</button>
        </template>
    </app-modal>
    </div>
    `
};

