const app = Vue.createApp({

    components: {
        Header
    },

    data() {
        return {
            user: null
        };
    },

    template: `
        <Header/>
        <router-view/>
    `,

    methods: {
        async login(form) {
            let r = await Model.auth("login", form);
            if (r.success) {
                this.user = r.user;
                this.$router.push("/dashboard");
            } else {
                alert(r.message);
            }
        },

        async register(form) {
            let r = await Model.auth("register", form);
            if (r.success) {
                alert("Registration successful! You can now login.");
                form.username = "";
                form.email = "";
                form.password = "";
            } else {
                alert(r.message);
            }
        },

        async logout() {
            await Model.auth("logout");
            this.user = null;
            this.$router.push("/");
        }
    }
});

app.use(router);
app.mount("#app");