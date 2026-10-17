const Header = {

    template: `
    <nav class="navbar bg-white border-bottom px-4">
        <b>
            <span class="badge bg-dark">
                STUDENT
            </span>
            To-Do List
        </b>
        <div>
            <template v-if="!user">
                <router-link to="/login" class="btn btn-light btn-sm me-1">
                    Login
                </router-link>
                <router-link to="/register" class="btn btn-light btn-sm">
                    Register
                </router-link>
            </template>

            <template v-else>
                <span class="text-muted me-2">
                    Student: <b>{{ user }}</b>
                </span>
                <button @click="$root.logout" class="btn btn-light btn-sm">
                    Logout
                </button>
            </template>
        </div>
    </nav>
    `,
    computed: {
        user() {
            return this.$root.user;
        }
    }
};

const Home = {
    template:`
    <div class="container mt-5">
        <div class="card text-center p-5">
            <h4>Welcome to Student To-Do List</h4>
            <p class="text-muted">
                Organize your study tasks,
                homework and assignments.
            </p>
            <router-link to="/login" class="btn btn-dark btn-sm">
                Sign In to Your Account
            </router-link>
        </div>
    </div>
    `
};

const Login = {
    data(){
        return {
            form:{
                login:"",
                password:""
            }
        }
    },

    template:`
    <div class="container mt-5">
        <div class="col-md-4 mx-auto">
            <h5 class="text-center">
                Student Login
            </h5>
            <div class="card p-4">
                <input v-model="form.login" class="form-control mb-3" placeholder="Username">
                <input v-model="form.password" type="password" class="form-control mb-3" placeholder="Password">
                <button @click="$root.login(form)" class="btn btn-dark">
                    Sign In
                </button>
            </div>
        </div>
    </div>
    `
};

const Register = {
    data(){
        return {
            form:{
                username:"",
                email:"",
                password:""
            }
        }
    },

    template:`
    <div class="container mt-5">
        <div class="col-md-4 mx-auto">
            <h5 class="text-center">
                Student Registration
            </h5>
            <div class="card p-4">
                <input v-model="form.username" class="form-control mb-3" placeholder="Username">
                <input v-model="form.email" class="form-control mb-3" placeholder="Student Email">
                <input v-model="form.password" type="password" class="form-control mb-3" placeholder="Password">
                <button @click="$root.register(form)" class="btn btn-dark">
                    Register Student Account
                </button>
                <div class="text-center mt-3">
                    <small class="text-muted">
                        Already have an account?
                        <router-link to="/login">
                            Sign In
                        </router-link>
                    </small>
                </div>
            </div>
        </div>
    </div>
    `
};

const Dashboard = {
    data(){
        return {
            tasks:[],
            modal:false,
            form:{
                id:0,
                title:"",
                subject:"",
                status:"Pending",
                notes:""
            }
        }
    },

    computed:{
        total(){
            return this.tasks.length;
        },
        pending(){
            return this.tasks.filter(
                x => x.status=="Pending"
            ).length;
        },
        progress(){
            return this.tasks.filter(
                x => x.status=="In Progress"
            ).length;
        },
        completed(){
            return this.tasks.filter(
                x => x.status=="Completed"
            ).length;
        }

    },

    async mounted(){
        this.load();
    },


    methods:{
        async load(){
            let r = await Model.tasks("get");
            if(r.success)
                this.tasks=r.tasks;
        },

        add(){
            this.form={
                id:0,
                title:"",
                subject:"",
                status:"Pending",
                notes:""
            };
            this.modal=true;
        },

        edit(task){
            this.form={...task};
            this.modal=true;
        },

        async save(){
            await Model.tasks("save",this.form);
            this.modal=false;
            this.load();
        },

        async toggle(id){
            await Model.tasks("toggle",{id});
            this.load();
        },

        async remove(id){
            if(confirm("Delete this task?")){
                await Model.tasks("delete",{id});
                this.load();
            }
        }
    },

    template:`
    <div class="container mt-4">
        <div class="d-flex justify-content-between">
            <div>
                <h5>My Student To-Do List</h5>
                <small class="text-muted">
                    Track your homework,
                    subjects and study progress
                </small>
            </div>
            <button @click="add" class="btn btn-dark btn-sm">
                + Add New Task
            </button>
        </div>

        <div class="row mt-3">
            <div class="col">
                <div class="card p-3">
                    TOTAL TASKS<br>
                    <b>{{total}}</b>
                </div>
            </div>
            <div class="col">
                <div class="card p-3">
                    PENDING<br>
                    <b>{{pending}}</b>
                </div>
            </div>
            <div class="col">
                <div class="card p-3">
                    IN PROGRESS<br>
                    <b>{{progress}}</b>
                </div>
            </div>
            <div class="col">
                <div class="card p-3">
                    COMPLETED<br>
                    <b>{{completed}}</b>
                </div>
            </div>
        </div>

        <table class="table mt-4">
            <thead>
                <tr>
                    <th>Task Title & Notes</th>
                    <th>Subject</th>
                    <th>Status</th>
                    <th>Actions</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="task in tasks">
                    <td>
                        <b>{{task.title}}</b>
                        <br>
                        <small>
                            {{task.notes}}
                        </small>
                    </td>
                    <td>
                        {{task.subject}}
                    </td>
                    <td>
                        <button @click="toggle(task.id)" class="btn btn-sm btn-light">
                            {{task.status}}
                        </button>
                    </td>
                    <td>
                        <button @click="edit(task)" class="btn btn-sm btn-light">
                            Edit
                        </button>
                        <button @click="remove(task.id)" class="btn btn-sm btn-danger">
                            Delete
                        </button>
                    </td>
                </tr>
            </tbody>
        </table>

        <div v-if="modal" class="position-fixed top-0 start-0 w-100 h-100 bg-dark bg-opacity-50">
            <div class="card p-4 position-absolute top-50 start-50 translate-middle" style="width:400px">
                <h5>Add New Task</h5>
                <input v-model="form.title" class="form-control mb-2" placeholder="Task Title">
                <input v-model="form.subject" class="form-control mb-2" placeholder="Subject / Category">
                <select v-model="form.status" class="form-select mb-2">
                    <option>Pending</option>
                    <option>In Progress</option>
                    <option>Completed</option>
                </select>
                <textarea v-model="form.notes" class="form-control mb-3" placeholder="Notes / Details"></textarea>
                <div class="text-end">
                    <button @click="modal=false" class="btn btn-light btn-sm">
                        Cancel
                    </button>
                    <button @click="save" class="btn btn-dark btn-sm">
                        Save Task
                    </button>
                </div>
            </div>
        </div>
    </div>
    `
};