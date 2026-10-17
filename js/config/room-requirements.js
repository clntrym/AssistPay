// AssistPay - Required S.A. Room Configurations (ACADS & ITO)
// S.A. Coordinators can review and edit these defaults in the Room Setup modal.

const RoomRequirements = (() => {
    // ==========================================
    // 1. REQUIRED S.A - ACADS
    // ==========================================
    const ACADS_ROOMS = [
        {
            key: "PHYSICS_LAB",
            name: "PHYSICS LAB (1403)",
            codes: ["1403"],
            keywords: ["PHYSICS"],
            requiredSa: 2,
            departmentType: "ACADS"
        },
        {
            key: "CHEMISTRY_LAB",
            name: "CHEMISTRY LAB (1404)",
            codes: ["1404"],
            keywords: ["CHEMISTRY"],
            requiredSa: 2,
            departmentType: "ACADS"
        },
        {
            key: "CRIM_LAB",
            name: "CRIM LAB (1407-1407-A&B)",
            codes: ["1407", "1407-A", "1407-B", "1407-A&B", "1407A", "1407B"],
            keywords: ["CRIM"],
            requiredSa: 2,
            departmentType: "ACADS"
        },
        {
            key: "ANNEX_ARCHI_LAB",
            name: "ANNEX ARCHI LAB (2401- 2401-A)",
            codes: ["2401", "2401-A", "2401A"],
            keywords: ["ANNEX", "ARCHI"],
            requiredSa: 2,
            departmentType: "ACADS"
        },
        {
            key: "MULTI_COLORED_ARCHI_LAB",
            name: "MULTI-COLORED ARCHI LAB (ARDR 1 to 5)",
            codes: ["ARDR 1", "ARDR 2", "ARDR 3", "ARDR 4", "ARDR 5", "ARDR1", "ARDR2", "ARDR3", "ARDR4", "ARDR5", "ARDR"],
            keywords: ["MULTI-COLORED", "ARDR"],
            requiredSa: 2,
            departmentType: "ACADS"
        },
        {
            key: "CRIS_BUILDING",
            name: "CRIS BUILDING (6301 - 6401)",
            codeRange: [6301, 6401],
            keywords: ["CRIS"],
            requiredSa: 2,
            departmentType: "ACADS"
        }
    ];

    // ==========================================
    // 2. REQUIRED S.A - ITO
    // ==========================================
    const ITO_ROOMS_2_SA = [
        "1106", "1107", "1108",
        "2206", "2207", "2211",
        "2301", "2304", "2305",
        "2306", "2307", "2308",
        "2309", "2310", "2312",
        "5301", "5401"
    ];

    const ITO_ROOMS_1_SA = [
        {
            code: "1303",
            name: "ABCOM LAB (1303)",
            keywords: ["ABCOM", "AB COMM", "ABCOMM"],
            requiredSa: 1,
            departmentType: "ITO"
        }
    ];

    /**
     * Determines the default configuration for a room when loading into Room Setup.
     * @param {Object} room - { code, description, building, ... }
     * @returns {Object} - { selected: boolean, departmentType: string, requiredSa: number }
     */
    function getDefaultConfig(room) {
        if (!room) return { selected: false, departmentType: "ACADS", requiredSa: 1 };

        const code = String(room.code || "").trim().toUpperCase();
        const desc = String(room.description || "").trim().toUpperCase();
        const bldg = String(room.building || "").trim().toUpperCase();

        // Check ITO 1 S.A. (ABCOM LAB / 1303)
        for (const item of ITO_ROOMS_1_SA) {
            if (code === item.code || item.keywords.some(k => desc.includes(k) || code.includes(k))) {
                return { selected: true, departmentType: "ITO", requiredSa: item.requiredSa, configName: item.name };
            }
        }

        // Check ITO 2 S.A. list
        if (ITO_ROOMS_2_SA.includes(code)) {
            return { selected: true, departmentType: "ITO", requiredSa: 2, configName: `ITO ROOM ${code}` };
        }

        // Check ACADS list
        for (const item of ACADS_ROOMS) {
            if (item.codes && item.codes.some(c => code === c || code.startsWith(c))) {
                return { selected: true, departmentType: "ACADS", requiredSa: item.requiredSa, configName: item.name };
            }
            if (item.codeRange) {
                const num = parseInt(code, 10);
                if (!isNaN(num) && num >= item.codeRange[0] && num <= item.codeRange[1]) {
                    return { selected: true, departmentType: "ACADS", requiredSa: item.requiredSa, configName: item.name };
                }
            }
            if (item.keywords && item.keywords.length) {
                const matchKeyword = item.keywords.every(k => desc.includes(k) || bldg.includes(k) || code.includes(k));
                if (matchKeyword) {
                    return { selected: true, departmentType: "ACADS", requiredSa: item.requiredSa, configName: item.name };
                }
            }
        }

        // Default fallback for unmatched rooms
        const isItoFallback = ["LAB", "COMP", "IT", "MAC", "CISCO"].some(k => desc.includes(k));
        return {
            selected: false,
            departmentType: isItoFallback ? "ITO" : "ACADS",
            requiredSa: 1,
            configName: null
        };
    }

    return {
        ACADS_ROOMS,
        ITO_ROOMS_2_SA,
        ITO_ROOMS_1_SA,
        getDefaultConfig
    };
})();

// Attach globally for browser and node
if (typeof window !== "undefined") window.RoomRequirements = RoomRequirements;
if (typeof globalThis !== "undefined") globalThis.RoomRequirements = RoomRequirements;
if (typeof module !== "undefined" && module.exports) module.exports = RoomRequirements;
