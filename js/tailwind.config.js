// AssistPay design tokens (from INTEG_ASSISTPAY.pdf, "Color Theme" and "Fonts").
// Gold is an accent only — never a main background.
tailwind.config = {
    darkMode: "class",
    theme: {
        extend: {
            colors: {
                navy: {
                    DEFAULT: "#0F2747", // sidebar, headings, primary buttons
                    700: "#173A63"      // hover / active states
                },
                gold: "#F4B942",        // accent, highlights, important indicators
                mist: "#EAF2F8",        // light blue: selected areas, info panels
                ink: "#1F2937",         // main text
                muted: "#64748B",       // secondary text
                line: "#E2E8F0",        // card / input borders
                page: "#F8FAFC",        // main background
                disabled: "#CBD5E1",
                success: "#16A34A",
                warning: "#D97706",
                danger: "#DC2626",
                info: "#2563EB"
            },
            fontFamily: {
                sans: ["Poppins", "ui-sans-serif", "system-ui", "Segoe UI", "sans-serif"]
            },
            fontSize: {
                // Type scale from the PDF
                "page-title": ["28px", { lineHeight: "36px", fontWeight: "700" }],
                "section-title": ["19px", { lineHeight: "28px", fontWeight: "600" }],
                "card-title": ["16px", { lineHeight: "24px", fontWeight: "600" }],
                body: ["14px", { lineHeight: "22px" }],
                caption: ["12px", { lineHeight: "18px" }]
            },
            boxShadow: {
                card: "0 1px 2px rgba(15, 39, 71, 0.06), 0 1px 3px rgba(15, 39, 71, 0.04)",
                lift: "0 6px 16px rgba(15, 39, 71, 0.10)"
            }
        }
    }
};
