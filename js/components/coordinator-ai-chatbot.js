// AssistPay AI Coordinator Chatbot Component
// Floating, intelligent, and free AI assistant for S.A. Coordinators
const CoordinatorAiChatbot = {
    name: 'CoordinatorAiChatbot',
    components: { AppIcon },

    setup() {
        const isOpen = Vue.ref(false);
        const inputMessage = Vue.ref('');
        const isTyping = Vue.ref(false);
        const chatContainer = Vue.ref(null);
        const inputRef = Vue.ref(null);

        const messages = Vue.reactive([
            {
                id: 1,
                role: 'assistant',
                text: 'Good day, S.A. Coordinator! I am **AssistPay AI**, your live assistant directly connected to the AssistPay database. I am ready to answer your questions regarding S.A. rosters, deployment statuses, duty schedules, attendance, allowance computations, and NCST AssistPay policies. (You can also ask questions in Tagalog / Filipino!)',
                time: 'Just now',
                provider: 'Gemini 3.8 Flash'
            }
        ]);

        const quickPrompts = Vue.ref([
            'How many Student Assistants are in S.A. Management?',
            'How many S.A.s are deployed to ITO, ACADS, and OFFICES?',
            'How many active supervisors and duty stations are there?',
            'What is the policy for 1st, 2nd, and 3rd Warning memos?',
            'Ilan ang active S.A.s ngayon sa database?'
        ]);

        const toggleChat = () => {
            isOpen.value = !isOpen.value;
            if (isOpen.value) {
                Vue.nextTick(() => {
                    scrollToBottom();
                    if (inputRef.value) inputRef.value.focus();
                });
            }
        };

        const scrollToBottom = () => {
            if (chatContainer.value) {
                chatContainer.value.scrollTop = chatContainer.value.scrollHeight;
            }
        };

        const clearChat = () => {
            messages.splice(0, messages.length, {
                id: Date.now(),
                role: 'assistant',
                text: 'Chat history has been cleared. I am ready to assist you with any questions regarding S.A. Coordinator duties!',
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                provider: 'Free AI'
            });
        };

        const sendQuickPrompt = (prompt) => {
            inputMessage.value = prompt;
            sendMessage();
        };

        const sendMessage = async () => {
            const text = (inputMessage.value || '').trim();
            if (!text || isTyping.value) return;

            const userMsgId = Date.now();
            messages.push({
                id: userMsgId,
                role: 'user',
                text: text,
                time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            });

            inputMessage.value = '';
            isTyping.value = true;
            Vue.nextTick(() => scrollToBottom());

            try {
                // Prepare conversation payload for API
                const historyPayload = messages
                    .filter(m => m.role === 'user' || m.role === 'assistant')
                    .map(m => ({ role: m.role, content: m.text }));

                const res = await Model.request('ai', 'chat', {
                    messages: historyPayload
                });

                isTyping.value = false;

                if (res && res.success && res.reply) {
                    messages.push({
                        id: Date.now(),
                        role: 'assistant',
                        text: res.reply,
                        time: res.timestamp || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        provider: res.provider || 'Free AI'
                    });
                } else {
                    messages.push({
                        id: Date.now(),
                        role: 'assistant',
                        text: 'I apologize, the AI service encountered a temporary issue. Please try again.',
                        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                        provider: 'AssistPay Engine'
                    });
                }
            } catch (err) {
                isTyping.value = false;
                console.error('AI chat error:', err);
                messages.push({
                    id: Date.now(),
                    role: 'assistant',
                    text: 'Unable to connect to the AI server. Please check your internet connection or try again.',
                    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    provider: 'Offline Fallback'
                });
            }

            Vue.nextTick(() => scrollToBottom());
        };

        // Formats simple bold markdown and lists
        const formatMessageText = (txt) => {
            if (!txt) return '';
            let formatted = txt
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');

            // Bold **text**
            formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
            // Italic *text*
            formatted = formatted.replace(/\*(.*?)\*/g, '<em>$1</em>');
            // Inline code `code`
            formatted = formatted.replace(/`([^`]+)`/g, '<code class="px-1 py-0.5 rounded bg-black/10 dark:bg-white/10 text-xs font-mono font-bold">$1</code>');
            // Line breaks
            formatted = formatted.replace(/\n/g, '<br/>');

            return formatted;
        };

        return {
            isOpen,
            inputMessage,
            isTyping,
            messages,
            quickPrompts,
            chatContainer,
            inputRef,
            toggleChat,
            clearChat,
            sendMessage,
            sendQuickPrompt,
            formatMessageText
        };
    },

    template: `
    <div class="fixed bottom-5 right-5 z-50 select-none">

        <!-- FLOATING LAUNCHER BUTTON -->
        <button v-if="!isOpen" type="button" @click="toggleChat"
                class="group relative flex items-center gap-2.5 px-4 py-3 rounded-full bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-700 text-white shadow-xl hover:shadow-[0_0_25px_rgba(99,102,241,0.5)] hover:scale-105 active:scale-95 transition-all duration-300 border border-indigo-400/30">
            <div class="relative flex items-center justify-center h-7 w-7 rounded-full bg-white/20 text-white group-hover:rotate-12 transition-transform">
                <app-icon name="Bot" :size="18" />
                <span class="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5">
                    <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400"></span>
                </span>
            </div>
            <div class="text-left pr-1">
                <div class="text-xs font-bold leading-tight tracking-wide flex items-center gap-1.5">
                    <span>AssistPay AI</span>
                    <span class="text-[9px] uppercase px-1.5 py-0.2 rounded bg-white/25 text-white/95 font-black tracking-wider">Free AI</span>
                </div>
                <div class="text-[10px] text-white/80 leading-tight">S.A. Coordinator Assistant</div>
            </div>
        </button>

        <!-- CHATBOT WINDOW DIALOG -->
        <transition enter-active-class="transition duration-200 ease-out"
                    enter-from-class="transform scale-95 opacity-0 translate-y-4"
                    enter-to-class="transform scale-100 opacity-100 translate-y-0"
                    leave-active-class="transition duration-150 ease-in"
                    leave-from-class="transform scale-100 opacity-100 translate-y-0"
                    leave-to-class="transform scale-95 opacity-0 translate-y-4">
            <div v-if="isOpen" 
                 class="flex flex-col w-[92vw] sm:w-[420px] h-[580px] max-h-[82vh] rounded-2xl border border-indigo-200/80 dark:border-indigo-800/80 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden backdrop-blur-xl">

                <!-- TOP BAR / HEADER -->
                <div class="p-3.5 bg-gradient-to-r from-indigo-700 via-purple-700 to-indigo-800 text-white flex items-center justify-between shadow-md shrink-0">
                    <div class="flex items-center gap-2.5">
                        <div class="flex items-center justify-center h-9 w-9 rounded-xl bg-white/20 text-white shadow-inner">
                            <app-icon name="Bot" :size="20" />
                        </div>
                        <div>
                            <div class="flex items-center gap-2">
                                <span class="font-bold text-sm tracking-wide">AssistPay AI</span>
                                <span class="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-full bg-emerald-500/30 border border-emerald-400/50 text-emerald-200">
                                    Online • Free AI
                                </span>
                            </div>
                            <p class="text-[11px] text-indigo-100/80">S.A. Coordinator Intelligence</p>
                        </div>
                    </div>

                    <div class="flex items-center gap-1">
                        <button type="button" @click="clearChat" title="Clear chat history"
                                class="p-1.5 rounded-lg text-indigo-200 hover:text-white hover:bg-white/10 transition-colors">
                            <app-icon name="RotateCcw" :size="15" />
                        </button>
                        <button type="button" @click="toggleChat" title="Minimize chat"
                                class="p-1.5 rounded-lg text-indigo-200 hover:text-white hover:bg-white/10 transition-colors">
                            <app-icon name="Minus" :size="16" />
                        </button>
                    </div>
                </div>

                <!-- MESSAGES CONTAINER -->
                <div ref="chatContainer" class="flex-1 p-4 overflow-y-auto space-y-3.5 bg-slate-50/60 dark:bg-slate-950/40 text-xs">
                    
                    <div v-for="msg in messages" :key="msg.id" class="flex flex-col"
                         :class="msg.role === 'user' ? 'items-end' : 'items-start'">

                        <div class="flex items-end gap-2 max-w-[88%]"
                             :class="msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'">

                            <!-- Bot Avatar -->
                            <div v-if="msg.role === 'assistant'" class="h-6 w-6 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0 text-[11px]">
                                <app-icon name="Sparkles" :size="12" />
                            </div>

                            <!-- Bubble -->
                            <div class="p-3 rounded-2xl shadow-sm text-left leading-relaxed break-words"
                                 :class="msg.role === 'user' 
                                     ? 'bg-gradient-to-r from-indigo-600 to-indigo-700 text-white rounded-br-sm' 
                                     : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200/80 dark:border-slate-700/80 rounded-bl-sm'">
                                <div v-html="formatMessageText(msg.text)"></div>
                            </div>
                        </div>

                        <!-- Timestamp & Provider -->
                        <div class="mt-1 px-1 flex items-center gap-2 text-[10px] text-slate-400 dark:text-slate-500"
                             :class="msg.role === 'user' ? 'justify-end' : 'justify-start pl-8'">
                            <span>{{ msg.time }}</span>
                            <span v-if="msg.provider" class="text-[9px] opacity-75 font-mono">• {{ msg.provider }}</span>
                        </div>
                    </div>

                    <!-- Typing Indicator -->
                    <div v-if="isTyping" class="flex items-center gap-2 pl-8">
                        <div class="px-3.5 py-2.5 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm flex items-center gap-1.5">
                            <span class="h-2 w-2 rounded-full bg-indigo-500 animate-bounce"></span>
                            <span class="h-2 w-2 rounded-full bg-indigo-500 animate-bounce [animation-delay:0.2s]"></span>
                            <span class="h-2 w-2 rounded-full bg-indigo-500 animate-bounce [animation-delay:0.4s]"></span>
                            <span class="text-[11px] text-slate-500 dark:text-slate-400 ml-1">AssistPay AI is responding...</span>
                        </div>
                    </div>

                    <!-- Quick Prompt Chips (Shown after greeting) -->
                    <div v-if="messages.length <= 2 && !isTyping" class="pt-2 space-y-1.5">
                        <p class="text-[11px] font-semibold text-slate-500 dark:text-slate-400 pl-1">
                            Suggested Inquiries (English / Tagalog):
                        </p>
                        <div class="flex flex-col gap-1.5">
                            <button v-for="(p, idx) in quickPrompts" :key="idx" type="button"
                                    @click="sendQuickPrompt(p)"
                                    class="text-left px-3 py-1.5 rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/70 dark:bg-indigo-950/30 text-indigo-800 dark:text-indigo-300 hover:bg-indigo-100/80 dark:hover:bg-indigo-900/40 text-[11px] transition-colors flex items-center justify-between group">
                                <span>{{ p }}</span>
                                <app-icon name="ArrowRight" :size="12" class="opacity-0 group-hover:opacity-100 transition-opacity" />
                            </button>
                        </div>
                    </div>

                </div>

                <!-- FOOTER / INPUT BAR -->
                <div class="p-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 shrink-0">
                    <form @submit.prevent="sendMessage" class="flex items-center gap-2">
                        <input ref="inputRef" v-model="inputMessage" type="text" maxlength="500"
                               :disabled="isTyping"
                               placeholder="Ask AssistPay AI (e.g. How many S.A.s in management? / Pwede rin Tagalog)..." 
                               class="coordinator-chat-input flex-1 w-full rounded-xl px-3.5 py-2.5 text-sm font-semibold border-2 border-indigo-200 dark:border-slate-700 focus:outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-500/30 transition-all shadow-sm" />
                        <button type="submit" :disabled="!inputMessage.trim() || isTyping"
                                class="flex items-center justify-center h-10 w-10 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all shrink-0 shadow-md hover:shadow-indigo-500/30">
                            <app-icon name="Send" :size="16" />
                        </button>
                    </form>
                    <div class="mt-2 flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 px-1">
                        <span class="font-medium flex items-center gap-1">
                            <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                            Google Gemini 3.8 Flash • Live AssistPay Database
                        </span>
                        <span>Enter to send</span>
                    </div>
                </div>

            </div>
        </transition>

    </div>
    `
};

