const Model = {
    async auth(action, data = {}) {
        data.action = action;
        return fetch("php/auth.php", {
            method: "POST",
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify(data)
        }).then(r => r.json());

    },

    async tasks(action, data = {}) {
        data.action = action;
        return fetch("php/tasks.php", {
            method: "POST",
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify(data)
        }).then(r => r.json());
    }
};