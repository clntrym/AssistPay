const router = VueRouter.createRouter({
    history: VueRouter.createWebHashHistory(),
    routes: [
        {path:"/", component:Home},
        {path:"/login", component:Login},
        {path:"/register", component:Register},
        {path:"/dashboard", component:Dashboard}
    ]
});