// AssistPay Attendance Map Component
// Genuine Google Maps & Geofence GUI with Roadmap / Satellite imagery, live coords, and geofence badge.
const AttendanceMap = {
    name: "AttendanceMap",
    components: { AppIcon },
    props: {
        campusLat: { type: Number, default: 14.327472 },
        campusLng: { type: Number, default: 120.940472 },
        campusName: { type: String, default: "NCST Main Campus" },
        radiusMeters: { type: Number, default: 1000 },
        userLat: { type: Number, default: null },
        userLng: { type: Number, default: null },
        userAccuracy: { type: Number, default: 5 },
        userName: { type: String, default: "" },
        isInside: { type: Boolean, default: true },
        distanceMeters: { type: Number, default: null },
        dark: { type: Boolean, default: false },
        height: { type: String, default: "h-52 sm:h-56" },
        zoom: { type: Number, default: 16 }
    },

    setup(props) {
        const viewMode = Vue.ref("m"); // 'm' for standard roadmap, 'h' for hybrid satellite
        const mapLoaded = Vue.ref(false);

        const activeLat = Vue.computed(() => {
            if (props.userLat !== null && props.userLat !== undefined && !isNaN(props.userLat)) {
                return Number(props.userLat);
            }
            return Number(props.campusLat) || 14.327472;
        });

        const activeLng = Vue.computed(() => {
            if (props.userLng !== null && props.userLng !== undefined && !isNaN(props.userLng)) {
                return Number(props.userLng);
            }
            return Number(props.campusLng) || 120.940472;
        });

        const googleEmbedUrl = Vue.computed(() => {
            const lat = activeLat.value;
            const lng = activeLng.value;
            const z = props.zoom || 16;
            const t = viewMode.value; // 'm' = road, 'h' = satellite/hybrid
            return `https://maps.google.com/maps?q=${lat},${lng}&t=${t}&z=${z}&ie=UTF8&iwloc=&output=embed`;
        });

        const googleMapsDirectUrl = Vue.computed(() => {
            return `https://www.google.com/maps/search/?api=1&query=${activeLat.value},${activeLng.value}`;
        });

        const formatCoordinate = (lat, lng) => {
            if (!lat || !lng) return "—";
            const latDir = lat >= 0 ? "N" : "S";
            const lngDir = lng >= 0 ? "E" : "W";
            return `${Math.abs(lat).toFixed(4)}°${latDir}, ${Math.abs(lng).toFixed(4)}°${lngDir}`;
        };

        const toggleSatellite = () => {
            viewMode.value = viewMode.value === "m" ? "h" : "m";
        };

        return {
            viewMode,
            mapLoaded,
            activeLat,
            activeLng,
            googleEmbedUrl,
            googleMapsDirectUrl,
            formatCoordinate,
            toggleSatellite
        };
    },

    template: `
    <div class="relative w-full overflow-hidden rounded-xl border transition-all duration-200 group"
         :class="[height, dark ? 'border-slate-800 bg-slate-950 shadow-xl' : 'border-line bg-page shadow-sm']">

        <!-- 1. REAL GOOGLE MAP EMBED (Genuine Map with real roads, streets, satellite & markers) -->
        <iframe 
            :src="googleEmbedUrl" 
            class="absolute inset-0 w-full h-full border-0 select-none z-0"
            loading="lazy" 
            allowfullscreen 
            referrerpolicy="no-referrer-when-downgrade"
            @load="mapLoaded = true">
        </iframe>

        <!-- 2. GEOFENCE RADIAL RING OVERLAY (Visual 1,000m perimeter guide centered over map) -->
        <div class="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
            <div class="h-36 w-36 sm:h-40 sm:w-40 rounded-full border-2 border-dashed transition-all duration-300"
                 :class="isInside 
                     ? 'border-emerald-500/80 bg-emerald-500/10 shadow-[0_0_20px_rgba(16,185,129,0.3)]' 
                     : 'border-rose-500/80 bg-rose-500/10 shadow-[0_0_20px_rgba(244,63,94,0.3)]'">
            </div>
        </div>

        <!-- 3. TOP-LEFT: CAMPUS NAME & GEOFENCE BADGE -->
        <div class="absolute top-2.5 left-2.5 z-20 flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-bold shadow-md backdrop-blur-md border pointer-events-auto select-none"
             :class="dark 
                 ? 'bg-slate-950/85 text-white border-slate-700/80' 
                 : 'bg-white/95 text-navy border-line'">
            <span class="h-2 w-2 rounded-full" :class="isInside ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'"></span>
            <span class="truncate max-w-[170px] sm:max-w-xs">{{ campusName }}</span>
            <span class="text-[10px] opacity-75 font-normal">({{ radiusMeters }}m Radius)</span>
        </div>

        <!-- 4. TOP-RIGHT: SATELLITE TOGGLE & OPEN IN GOOGLE MAPS -->
        <div class="absolute top-2.5 right-2.5 z-20 flex items-center gap-1.5 pointer-events-auto select-none">
            <!-- Satellite / Map Mode Pill -->
            <button type="button" @click="toggleSatellite" :title="viewMode === 'm' ? 'Switch to Satellite View' : 'Switch to Street Map'"
                    class="flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold shadow-md backdrop-blur-md border transition-all"
                    :class="dark 
                        ? (viewMode === 'h' ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-bold' : 'bg-slate-950/85 text-slate-200 border-slate-700 hover:bg-slate-800') 
                        : (viewMode === 'h' ? 'bg-navy text-white border-navy font-bold' : 'bg-white/95 text-navy border-line hover:bg-page')">
                <app-icon :name="viewMode === 'h' ? 'Layers' : 'Map'" :size="12" />
                <span>{{ viewMode === 'h' ? 'Satellite' : 'Street Map' }}</span>
            </button>

            <!-- External Google Maps Link -->
            <a :href="googleMapsDirectUrl" target="_blank" rel="noopener noreferrer" title="Open in Google Maps"
               class="flex h-7 w-7 items-center justify-center rounded-lg border shadow-md backdrop-blur-md transition-colors"
               :class="dark ? 'bg-slate-950/85 text-cyan-400 border-slate-700 hover:bg-slate-800' : 'bg-white/95 text-navy border-line hover:bg-page'">
                <app-icon name="ExternalLink" :size="13" />
            </a>
        </div>

        <!-- 5. BOTTOM-LEFT: DISTANCE & GEOFENCE STATUS PILL -->
        <div class="absolute bottom-2 left-2 z-20 flex flex-wrap items-center gap-1.5 rounded-lg px-2.5 py-1 text-[10px] sm:text-[11px] font-mono shadow-md backdrop-blur-md border pointer-events-auto select-none"
             :class="dark 
                 ? 'bg-slate-950/90 border-slate-800 text-slate-200' 
                 : 'bg-white/95 border-line text-ink'">
            <div class="flex items-center gap-1 font-semibold"
                 :class="isInside ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'">
                <app-icon :name="isInside ? 'Check' : 'AlertCircle'" :size="12" stroke-width="3" />
                <span>{{ isInside ? 'INSIDE AUTHORIZED RANGE' : 'OUTSIDE RANGE' }}</span>
            </div>
            <span class="opacity-40">·</span>
            <span class="font-bold text-ink dark:text-white">
                {{ distanceMeters !== null && distanceMeters !== undefined ? Math.round(distanceMeters) + 'm' : '0m away' }}
            </span>
            <template v-if="userName">
                <span class="opacity-40">·</span>
                <span class="font-bold text-navy dark:text-sky-300 font-sans">
                    {{ userName }}
                </span>
            </template>
            <span class="hidden sm:inline-block opacity-70">
                ({{ formatCoordinate(activeLat, activeLng) }})
            </span>
        </div>

        <!-- 6. BOTTOM-RIGHT: GOOGLE WATERMARK ACCENT -->
        <div class="absolute bottom-1.5 right-2 z-20 text-[9px] font-semibold pointer-events-none opacity-80"
             :class="dark ? 'text-slate-300' : 'text-slate-600'">
            Google Maps
        </div>
    </div>
    `
};
