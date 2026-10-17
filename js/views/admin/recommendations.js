// Scheduling > Recommendations (Slot view wrapper for DutyGridPage)
const RecommendationsPage = {
    components: {
        DutyGridView: typeof DutyGridPage !== "undefined" ? DutyGridPage : {}
    },
    setup() {
        Vue.onMounted(() => {
            if (window.location.hash === "#/admin/scheduling/recommendations/slots") {
                window.location.hash = "#/admin/scheduling/recommendations";
            }
        });
        return {};
    },
    template: `<div></div>`
};
